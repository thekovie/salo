import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocate, billBlockers, billFinal, buildKkb, myShareLabel, priceCompleteness, reconcile, type Bucket, type Kkb, type KkbInput, type KkbLine } from "@/lib/kkb";
import { percentOf, personKey } from "@/lib/adjustments";
import { MAX_UNIT_PRICE_CENTAVOS, parsePeso, toPesoInput } from "@/lib/money";
import { obligationOf, paidByKey, paymentStatus, paymentTotals, hasShare } from "@/lib/payments";
import { reconcileReceipts } from "@/lib/receipts";
import { splitLine } from "@/lib/splits";
import { EMPTY_SETTLEMENT, type EntrySettlement, type SnapshotAdjustment, type SnapshotEntry, type SnapshotPayment, type SnapshotReceipt } from "@/lib/snapshot";

// Random seed each run (D83); replay a failure with FC_SEED=<printed seed>.
const seed = process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined;
const check = (property: Parameters<typeof fc.assert>[0]) => fc.assert(property, { numRuns: 200, ...(seed === undefined ? {} : { seed }) });

describe("allocate", () => {
  const weights = fc.uniqueArray(fc.tuple(fc.string({ minLength: 1, maxLength: 6 }), fc.integer({ min: 0, max: 1_000_000_000 })), { selector: ([k]) => k, minLength: 1, maxLength: 20 });
  const charge = fc.integer({ min: 0, max: 1_000_000_000_000 });

  it("shares are non-negative and sum to the charge (all zero when no weight)", () =>
    check(
      fc.property(charge, weights, (c, w) => {
        const shares = [...allocate(c, w).values()];
        expect(shares.every((s) => s >= 0 && Number.isInteger(s))).toBe(true);
        const total = shares.reduce((a, b) => a + b, 0);
        expect(total).toBe(w.some(([, x]) => x > 0) ? c : 0);
      }),
    ));

  it("does not depend on the order of the payers", () =>
    check(fc.property(charge, weights, (c, w) => {
      const reversed = [...w].reverse();
      expect([...allocate(c, reversed)].sort()).toEqual([...allocate(c, w)].sort());
    })));
});

describe("percentOf", () => {
  const basis = fc.integer({ min: 0, max: 10_000_000_000 });
  const bps = fc.integer({ min: 1, max: 10_000 });

  it("stays within [0, basis], grows with bps, and 100% is the whole basis", () =>
    check(
      fc.property(bps, bps, basis, (a, b, base) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(percentOf(lo, base)).toBeGreaterThanOrEqual(0);
        expect(percentOf(hi, base)).toBeLessThanOrEqual(base);
        expect(percentOf(lo, base)).toBeLessThanOrEqual(percentOf(hi, base));
        expect(percentOf(10_000, base)).toBe(base);
      }),
    ));
});

describe("parsePeso", () => {
  it("round-trips toPesoInput across the allowed range", () =>
    check(fc.property(fc.integer({ min: 0, max: MAX_UNIT_PRICE_CENTAVOS }), (c) => {
      expect(parsePeso(toPesoInput(c))).toEqual({ ok: true, centavos: c });
    })));

  it("reads blank as unknown, not zero", () => check(fc.property(fc.stringMatching(/^[ ₱,]{0,6}$/), (s) => {
      expect(parsePeso(s)).toEqual({ ok: true, centavos: null });
    })));
});

// ---- bill generator ----

const MAX_PEOPLE = 12;
const idOf = (i: number) => `p${i}`;
const ref = (i: number) => ({ participantId: idOf(i), label: null });

interface EntrySpec { owner: number; qty: number; unit: number | null; draft: boolean; mode: "own" | "billed" | "split" | "unbilled"; payee: number; splitters: number[] }
interface AdjSpec { direction: "discount" | "charge"; method: SnapshotAdjustment["method"]; useBps: boolean; bps: number; amount: number; picks: number[]; parts: number[] }
interface SceneSpec { n: number; clean: boolean; entries: EntrySpec[]; charge: number | null; adjustments: AdjSpec[] }

const person = fc.nat(MAX_PEOPLE - 1);
const entrySpec: fc.Arbitrary<EntrySpec> = fc.record({
  owner: person,
  qty: fc.integer({ min: 1, max: 20 }),
  unit: fc.option(fc.integer({ min: 0, max: 500_000 }), { nil: null, freq: 4 }),
  draft: fc.integer({ min: 0, max: 7 }).map((x) => x === 0),
  mode: fc.constantFrom("own", "own", "own", "billed", "split", "unbilled"),
  payee: person,
  splitters: fc.uniqueArray(person, { minLength: 2, maxLength: 4 }),
});
const adjSpec: fc.Arbitrary<AdjSpec> = fc.record({
  direction: fc.constantFrom("discount", "charge"),
  method: fc.constantFrom("proportional", "equal", "manual", "individual", "unallocated"),
  useBps: fc.boolean(),
  bps: fc.integer({ min: 1, max: 10_000 }),
  amount: fc.integer({ min: 1, max: 60_000 }),
  picks: fc.uniqueArray(person, { minLength: 1, maxLength: 6 }),
  parts: fc.array(fc.integer({ min: 0, max: 20_000 }), { minLength: 6, maxLength: 6 }),
});
const sceneSpec: fc.Arbitrary<SceneSpec> = fc.record({
  n: fc.integer({ min: 1, max: MAX_PEOPLE }),
  clean: fc.boolean(),
  entries: fc.array(entrySpec, { maxLength: 30 }),
  charge: fc.option(fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 500_000 })), { nil: null }),
  adjustments: fc.array(adjSpec, { maxLength: 4 }),
});

/** `clean` scenes have every dish priced and nothing left unbilled, so the no-blocker invariants are exercised often. */
function sceneOf(spec: SceneSpec, opts: { adjustments?: boolean; drafts?: boolean } = {}): KkbInput {
  const { n, clean } = spec;
  const at = (i: number) => i % n;
  const participants = Array.from({ length: n }, (_, i) => ({ id: idOf(i), displayName: `Person ${i}`, role: i === 0 ? ("HOST" as const) : ("GUEST" as const), cohost: false }));
  const entries: SnapshotEntry[] = [];
  const prices: Record<string, EntrySettlement> = {};
  spec.entries.forEach((s, k) => {
    if (s.draft && opts.drafts === false) return;
    const mode = clean && s.mode === "unbilled" ? "own" : s.mode;
    const id = `e${k}`;
    const attribution = mode === "own" ? { type: "INDIVIDUAL" as const, label: null, participantId: idOf(at(s.owner)) } : { type: "TABLE" as const, label: null, participantId: null };
    entries.push({ id, batchId: `b${k}`, roundId: s.draft ? "r2" : "r1", dishId: `d${k % 5}`, dishName: `Dish ${k % 5}`, quantity: s.qty, variant: null, instructions: null, createdAt: `2026-11-08T12:00:${String(k % 60).padStart(2, "0")}Z`, revision: 1, submittedBy: "p0", attribution });
    const splitters = [...new Set(s.splitters.map(at))];
    const unit = clean ? (s.unit ?? 1000) : s.unit;
    prices[id] = { unitCentavos: unit, billTo: mode === "billed" ? ref(at(s.payee)) : null, ...(mode === "split" && splitters.length > 1 ? { splitAmong: splitters.map(ref) } : {}), revision: 1 };
  });
  return {
    participants,
    removedPeople: [],
    rounds: [
      { id: "r1", number: 1, status: "CONFIRMED", confirmedAt: "2026-11-08T12:30:00Z" },
      { id: "r2", number: 2, status: "DRAFT", confirmedAt: null },
    ],
    entries,
    corrections: [],
    groups: [],
    settlement: { ...EMPTY_SETTLEMENT, entries: prices, serviceCharge: { centavos: spec.charge, revision: spec.charge == null ? 0 : 1 }, adjustments: opts.adjustments === false ? [] : spec.adjustments.map((a, k) => adjustmentOf(a, k, n)) },
  };
}

function adjustmentOf(a: AdjSpec, k: number, n: number): SnapshotAdjustment {
  const picks = [...new Set(a.picks.map((i) => i % n))];
  const manual = a.method === "manual";
  const parts: number[] = picks.map((_, j) => a.parts[j]);
  if (manual && parts.every((p) => p <= 0)) parts[0] = 1;
  const people = a.method === "unallocated" ? [] : a.method === "individual" ? [picks[0]] : picks;
  const percent = a.useBps && !manual && a.method !== "unallocated";
  return {
    id: `a${k}`,
    direction: a.direction,
    category: "promo",
    note: null,
    amountCentavos: percent ? null : manual ? parts.reduce((x, y) => x + y, 0) : a.amount,
    percentBps: percent ? a.bps : null,
    method: a.method,
    shares: people.map((i, j) => ({ ...ref(i), amountCentavos: manual ? parts[j] : null })),
    revision: 1,
  };
}

const build = (spec: SceneSpec, opts?: Parameters<typeof sceneOf>[1]) => {
  const input = sceneOf(spec, opts);
  return { input, kkb: buildKkb(input, "p0") };
};
const cards = (kkb: Kkb) => kkb.sections.filter((s) => !s.shared);
const cardTotal = (s: { totalCentavos: number | null; pricedCentavos: number }) => s.totalCentavos ?? s.pricedCentavos;
const sign = (a: { direction: "discount" | "charge" }) => (a.direction === "discount" ? -1 : 1);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("buildKkb and applyAdjustments", () => {
  let appliedRuns = 0;

  it("with nothing blocking and every adjustment applied, the cards add up to the adjusted total", () => {
    check(
      fc.property(sceneSpec, (spec) => {
        const { kkb } = build(spec);
        const settled = billBlockers(kkb.sections).length === 0 && kkb.charge.state !== "blocked" && priceCompleteness(kkb).total === priceCompleteness(kkb).priced && kkb.adjustments.every((a) => a.state === "applied");
        if (!settled) return;
        appliedRuns += 1;
        expect(sum(cards(kkb).map(cardTotal))).toBe(kkb.adjustedTotal);
      }),
    );
    expect(appliedRuns).toBeGreaterThan(0);
  });

  it("flagged, unassigned and waiting adjustments move the total but no card; waiting ones move nothing", () =>
    check(
      fc.property(sceneSpec, (spec) => {
        const { kkb } = build(spec);
        const { kkb: base } = build(spec, { adjustments: false });
        const moved = kkb.adjustments.filter((a) => a.state !== "waiting");
        expect(kkb.adjustedTotal - base.adjustedTotal).toBe(sum(moved.map((a) => sign(a) * (a.amountCentavos ?? 0))));
        for (const s of cards(kkb)) {
          const before = cards(base).find((b) => b.key === s.key)!;
          const applied = kkb.adjustments.filter((a) => a.state === "applied").flatMap((a) => a.shares.filter((sh) => sh.key === s.key).map((sh) => sign(a) * sh.centavos));
          expect(cardTotal(s)).toBe(cardTotal(before) + sum(applied));
        }
      }),
    ));

  it("an applied adjustment's shares add up to its amount", () =>
    check(
      fc.property(sceneSpec, (spec) => {
        for (const a of build(spec).kkb.adjustments.filter((x) => x.state === "applied")) {
          expect(sum(a.shares.map((s) => s.centavos))).toBe(a.amountCentavos);
        }
      }),
    ));
});

describe("unpriced dishes are never free (Q3)", () => {
  it("a confirmed dish without a price adds nothing, keeps its subtotal null and keeps the bill open", () =>
    check(
      fc.property(sceneSpec, (spec) => {
        const { input, kkb } = build(spec);
        const confirmed = input.entries.filter((e) => e.roundId === "r1");
        const unpriced = confirmed.filter((e) => input.settlement.entries[e.id].unitCentavos == null);
        // Own and billed entries sit on exactly one card; split ones are checked through the line invariant below.
        const food = sum(confirmed.map((e) => (input.settlement.entries[e.id].unitCentavos ?? 0) * e.quantity));
        expect(kkb.foodCentavos).toBe(food);
        for (const l of kkb.sections.flatMap((s) => s.lines)) if (l.unitCentavos == null) expect(l.subtotalCentavos).toBeNull();
        if (unpriced.length === 0) return;
        expect(billFinal(kkb)).toBe(false);
        expect(reconcile(kkb, kkb.adjustedTotal).state).toBe("incomplete");
        for (const s of kkb.sections) {
          if (s.unpricedUnits > 0) expect(s.status).toMatch(/^(none|partial)$/);
        }
        const mine = kkb.sections.find((s) => s.isMe);
        if (mine?.status === "none") expect(myShareLabel(kkb)).toBe("My share · no prices yet");
        if (mine?.status === "partial") expect(myShareLabel(kkb)).toContain("so far");
      }),
    ));

  it("drafts are outside price completeness and the final bill", () =>
    check(
      fc.property(sceneSpec, (spec) => {
        const withDrafts = build(spec).kkb;
        const without = build(spec, { drafts: false }).kkb;
        const [a, b] = [priceCompleteness(withDrafts), priceCompleteness(without)];
        expect([a.total, a.priced]).toEqual([b.total, b.priced]);
        expect(billFinal(withDrafts)).toBe(billFinal(without));
        expect(withDrafts.foodCentavos).toBe(without.foodCentavos);
      }),
    ));
});

describe("splitLine", () => {
  const payer = (i: number): Bucket => ({ key: `p:${idOf(i)}`, kind: "participant", title: `P${i}`, participantId: idOf(i) });
  const lineOf = (subtotal: number | null): KkbLine => ({ entryId: "e", dishKey: "d", correctionId: null, label: "Dish", quantity: 1, unitCentavos: subtotal, subtotalCentavos: subtotal, pendingChange: false, billedFrom: null, billedTo: null, billable: true, submittedBy: "p0", priceSource: subtotal == null ? null : "line", tableKey: null, tableCentavos: null, hasTable: false, splitWays: null, splitOfCentavos: null, priceRevision: 1 });

  it("copies add up to the subtotal, and an unknown price stays unknown", () =>
    check(
      fc.property(fc.option(fc.integer({ min: 0, max: 200_000_000 }), { nil: null }), fc.integer({ min: 2, max: 8 }), (subtotal, count) => {
        const { copies } = splitLine(lineOf(subtotal), Array.from({ length: count }, (_, i) => payer(i)), "Whole table");
        if (subtotal == null) {
          expect(copies.every((c) => c.line.subtotalCentavos === null)).toBe(true);
          return;
        }
        expect(sum(copies.map((c) => c.line.subtotalCentavos ?? NaN))).toBe(subtotal);
      }),
    ));
});

describe("reconcileReceipts", () => {
  const receiptGroups = fc.array(fc.uniqueArray(person, { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 3 });

  it("a receipt entered at what Salo expects matches, and an extra expects its people's cards plus their flagged shares", () => {
    let ran = 0;
    check(
      fc.property(sceneSpec, receiptGroups, (spec, groups) => {
        const input = sceneOf(spec);
        const taken = new Set<number>();
        const extras: SnapshotReceipt[] = groups.flatMap((g, k) => {
          const people = [...new Set(g.map((i) => i % spec.n))].filter((i) => !taken.has(i));
          people.forEach((i) => taken.add(i));
          return people.length ? [{ id: `x${k}`, label: null, totalCentavos: null, people: people.map(ref), revision: 1 }] : [];
        });
        if (extras.length === 0) return;
        const open = { ...input, settlement: { ...input.settlement, receipts: extras } };
        const kkb = buildKkb(open, "p0");
        if (reconcile(kkb, kkb.adjustedTotal).state !== "matches") return;
        const first = reconcileReceipts(kkb, open.settlement, open)!;
        const entered = {
          ...open,
          settlement: { ...open.settlement, receiptTotal: { centavos: first.cards[0].expectedCentavos, revision: 1 }, receipts: extras.map((r, k) => ({ ...r, totalCentavos: first.cards[k + 1].expectedCentavos })) },
        };
        const view = reconcileReceipts(kkb, entered.settlement, entered)!;
        ran += 1;
        expect(view.cards.map((c) => c.state.state)).toEqual(view.cards.map(() => "matches"));
        expect(view.overall).toEqual({ receiptsCentavos: kkb.adjustedTotal, saloCentavos: kkb.adjustedTotal, matches: true });
        extras.forEach((r, k) => {
          const keys = r.people.map(personKey);
          const flagged = kkb.adjustments.filter((a) => a.state === "flagged").flatMap((a) => a.shares.filter((s) => keys.includes(s.key)).map((s) => sign(a) * s.centavos));
          const expected = sum(keys.map((key) => cards(kkb).find((c) => c.key === key)).map((c) => (c ? cardTotal(c) : 0))) + sum(flagged);
          expect(view.cards[k + 1].expectedCentavos).toBe(expected);
        });
      }),
    );
    expect(ran).toBeGreaterThan(0);
  });
});

describe("payments", () => {
  const paymentsArb = fc.array(fc.record({ payer: fc.nat(MAX_PEOPLE + 2), amount: fc.integer({ min: 1, max: 2_000_000 }), review: fc.boolean() }), { maxLength: 15 });
  const paymentOf = (p: { payer: number; amount: number; review: boolean }, k: number): SnapshotPayment => ({ id: `pay${k}`, payer: ref(p.payer), payee: null, amountCentavos: p.amount, method: null, note: null, createdAt: "2026-11-08T13:00:00Z", needsReview: p.review });

  it("left is each person's own shortfall, needs-review payments count nowhere, collected includes orphans", () =>
    check(
      fc.property(sceneSpec, paymentsArb, (spec, specs) => {
        const { kkb } = build(spec);
        const payments = specs.map(paymentOf);
        const totals = paymentTotals(kkb, payments);
        const paid = new Map<string, number>();
        for (const p of payments) if (!p.needsReview) paid.set(`p:${p.payer.participantId}`, (paid.get(`p:${p.payer.participantId}`) ?? 0) + p.amountCentavos);
        const mine = cards(kkb).filter((s) => s.lines.length > 0);
        expect(totals.left).toBe(sum(mine.map((s) => Math.max(0, cardTotal(s) - (paid.get(s.key) ?? 0)))));
        expect(totals.left).toBeGreaterThanOrEqual(0);
        expect(totals.left).toBeLessThanOrEqual(totals.of);
        expect(totals.collected).toBe(sum(payments.filter((p) => !p.needsReview).map((p) => p.amountCentavos)));

        const reviewed = paymentTotals(kkb, payments.filter((p) => !p.needsReview));
        expect({ ...totals, orphans: totals.orphans.filter((p) => !p.needsReview) }).toEqual({ ...reviewed, orphans: reviewed.orphans });

        for (const s of mine.filter(hasShare)) {
          expect(paymentStatus(s, paidByKey(payments).get(s.key) ?? 0, false).chip).not.toBe("paid");
          expect(paymentStatus(s, obligationOf(s), true).chip).toBe(obligationOf(s) === 0 || s.status === "none" ? null : "paid");
        }
      }),
    ));
});
