import { describe, expect, it } from "vitest";
import { allocate, buildKkb, type KkbInput } from "@/lib/kkb";
import { EMPTY_SETTLEMENT, type EntrySettlement, type SnapshotEntry } from "@/lib/snapshot";
import type { CorrectionView } from "@/lib/ticket";

let n = 0;
type Attribution = SnapshotEntry["attribution"];
const me = (id: string): Attribution => ({ type: "INDIVIDUAL", label: null, participantId: id });
const named = (label: string): Attribution => ({ type: "INDIVIDUAL", label, participantId: null });
const TABLE: Attribution = { type: "TABLE", label: null, participantId: null };
const group = (label: string): Attribution => ({ type: "GROUP", label, participantId: null });

function e(dish: string, quantity: number, attribution: Attribution, extra: Partial<SnapshotEntry> = {}): SnapshotEntry {
  n += 1;
  return { id: `e${n}`, batchId: `b${n}`, roundId: "r1", dishId: `d-${dish}`, dishName: dish, quantity, variant: null, instructions: null, createdAt: `2026-11-08T12:00:${String(n).padStart(2, "0")}Z`, revision: 1, submittedBy: "h", attribution, ...extra };
}
const price = (unitCentavos: number | null, billTo: EntrySettlement["billTo"] = null): EntrySettlement => ({ unitCentavos, billTo, revision: 1 });

const people = [
  { id: "h", displayName: "Host", role: "HOST" as const },
  { id: "ana", displayName: "Ana", role: "GUEST" as const },
  { id: "jd", displayName: "JD", role: "GUEST" as const },
];

function input(entries: SnapshotEntry[], over: Partial<KkbInput> = {}): KkbInput {
  return {
    participants: people,
    removedPeople: [],
    rounds: [
      { id: "r1", number: 1, status: "CONFIRMED", confirmedAt: "2026-11-08T12:30:00Z" },
      { id: "r2", number: 2, status: "DRAFT", confirmedAt: null },
    ],
    entries,
    corrections: [],
    groups: [],
    settlement: { ...EMPTY_SETTLEMENT, entries: {} },
    ...over,
  };
}
const withPrices = (base: KkbInput, prices: Record<string, EntrySettlement>, charge: number | null = null): KkbInput => ({
  ...base,
  settlement: { entries: prices, corrections: base.settlement.corrections, serviceCharge: { centavos: charge, revision: charge == null ? 0 : 1 } },
});
const correction = (over: Partial<CorrectionView>): CorrectionView => ({ id: `c${++n}`, sourceEntryId: null, sourceRoundNumber: 1, targetRoundId: "r2", dishName: "x", preparation: null, type: "QUANTITY", quantityDelta: null, replacement: null, explanation: null, ...over });

describe("buildKkb food subtotals", () => {
  it("the brief's example: Ana has a priced subtotal with one unpriced item; the platter stays shared", () => {
    const katsu = e("Chicken Katsu", 2, me("ana"));
    const tea = e("Iced Tea", 1, me("ana"));
    const platter = e("Gyoza platter", 1, TABLE);
    const kkb = buildKkb(withPrices(input([katsu, tea, platter]), { [katsu.id]: price(12000), [platter.id]: price(36000) }), "ana");

    const ana = kkb.sections[0];
    expect(ana).toMatchObject({ title: "Ana", isMe: true, status: "partial", pricedCentavos: 24000, unpricedUnits: 1 });
    expect(ana.lines.map((l) => [l.label, l.quantity, l.unitCentavos, l.subtotalCentavos])).toEqual([
      ["Chicken Katsu", 2, 12000, 24000],
      ["Iced Tea", 1, null, null],
    ]);
    const table = kkb.sections.find((s) => s.kind === "table")!;
    expect(table).toMatchObject({ title: "Whole table", pricedCentavos: 36000, unpricedUnits: 0, shared: true });

    // Pricing the tea completes Ana's food subtotal.
    const done = buildKkb(withPrices(input([katsu, tea, platter]), { [katsu.id]: price(12000), [tea.id]: price(6000), [platter.id]: price(36000) }), "ana");
    expect(done.sections[0]).toMatchObject({ status: "complete", pricedCentavos: 30000, unpricedUnits: 0 });
  });

  it("an order without any prices reads as 'none', never as ₱0.00", () => {
    const kkb = buildKkb(input([e("Sisig", 1, me("jd"))]), "h");
    expect(kkb.sections.find((s) => s.title === "JD")).toMatchObject({ status: "none", pricedCentavos: 0, unpricedUnits: 1 });
    expect(kkb.charge).toEqual({ state: "unset" });
  });

  it("two entries for the same dish keep their own prices", () => {
    const a = e("Katsu", 1, me("ana"));
    const b = e("Katsu", 2, me("ana"));
    const kkb = buildKkb(withPrices(input([a, b]), { [a.id]: price(12000), [b.id]: price(15000) }), "ana");
    expect(kkb.sections[0].pricedCentavos).toBe(12000 + 30000);
  });

  it("the person a dish is for pays, not the person who typed it; same names stay distinct", () => {
    const people2 = [...people, { id: "ana2", displayName: "Ana", role: "GUEST" as const }];
    const forAna = e("Katsu", 1, me("ana"), { submittedBy: "h" });
    const forAna2 = e("Ramen", 1, me("ana2"), { submittedBy: "ana2" });
    const kkb = buildKkb(withPrices(input([forAna, forAna2], { participants: people2 }), { [forAna.id]: price(100), [forAna2.id]: price(200) }), "h");
    const anas = kkb.sections.filter((s) => s.title === "Ana");
    expect(anas.map((s) => [s.participantId, s.pricedCentavos])).toEqual([
      ["ana", 100],
      ["ana2", 200],
    ]);
  });

  it("puts the viewer first, then people, typed names, groups, whole table, unassigned", () => {
    const kkb = buildKkb(
      input([
        e("A", 1, me("ana")),
        e("B", 1, me("jd")),
        e("C", 1, named("Lola")),
        e("D", 1, group("Barkada")),
        e("E", 1, TABLE),
        e("F", 1, { type: "UNASSIGNED", label: null, participantId: null }),
      ]),
      "jd",
    );
    expect(kkb.sections.map((s) => s.title)).toEqual(["JD", "Ana", "Lola", "Barkada", "Whole table", "Not assigned"]);
  });

  it("lists draft entries separately; they never count", () => {
    const confirmed = e("Katsu", 1, me("ana"));
    const draft = e("Halo-halo", 1, me("ana"), { roundId: "r2" });
    const kkb = buildKkb(withPrices(input([confirmed, draft]), { [confirmed.id]: price(100), [draft.id]: price(900) }), "ana");
    expect(kkb.sections[0]).toMatchObject({ pricedCentavos: 100, status: "complete" });
    expect(kkb.sections[0].drafts.map((l) => [l.label, l.unitCentavos])).toEqual([["Halo-halo", 900]]);
  });

  it("applies confirmed cancellations, flags pending ones, and prices replacements separately", () => {
    const katsu = e("Katsu", 3, me("ana"));
    const sisig = e("Sisig", 2, me("jd"));
    const confirmedCancel = correction({ sourceEntryId: katsu.id, type: "QUANTITY", quantityDelta: -1, targetRoundId: "r1b" });
    const pendingCancel = correction({ sourceEntryId: katsu.id, type: "QUANTITY", quantityDelta: -1 });
    const swap = correction({ sourceEntryId: sisig.id, type: "REPLACE", replacement: "Bangus Sisig", targetRoundId: "r1b" });
    const base = input([katsu, sisig], {
      rounds: [
        { id: "r1", number: 1, status: "CONFIRMED", confirmedAt: "x" },
        { id: "r1b", number: 2, status: "CONFIRMED", confirmedAt: "y" },
        { id: "r2", number: 3, status: "DRAFT", confirmedAt: null },
      ],
      corrections: [confirmedCancel, pendingCancel, swap],
    });
    const priced = withPrices(base, { [katsu.id]: price(10000), [sisig.id]: price(20000) });
    const kkb = buildKkb(priced, "h");
    const ana = kkb.sections.find((s) => s.title === "Ana")!;
    expect(ana.lines[0]).toMatchObject({ quantity: 2, subtotalCentavos: 20000, pendingChange: true });
    expect(ana.status).toBe("partial");
    const jd = kkb.sections.find((s) => s.title === "JD")!;
    expect(jd.lines[0]).toMatchObject({ label: "Sisig → Bangus Sisig", quantity: 2, unitCentavos: null, correctionId: swap.id });
    expect(jd.unpricedUnits).toBe(2);

    const swapPriced = { ...priced, settlement: { ...priced.settlement, corrections: { [swap.id]: { unitCentavos: 22000, revision: 1 } } } };
    expect(buildKkb(swapPriced, "h").sections.find((s) => s.title === "JD")).toMatchObject({ status: "complete", pricedCentavos: 44000 });
  });
});

describe("buildKkb service charge", () => {
  it("allocates in proportion to food: ₱600 of ₱3,000 with ₱300 → ₱60, ₱660 total", () => {
    const a = e("Set A", 1, me("ana"));
    const b = e("Set B", 1, me("jd"));
    const kkb = buildKkb(withPrices(input([a, b]), { [a.id]: price(60000), [b.id]: price(240000) }, 30000), "ana");
    expect(kkb.charge).toMatchObject({ state: "allocated", centavos: 30000 });
    expect(kkb.sections[0]).toMatchObject({ pricedCentavos: 60000, serviceCentavos: 6000, totalCentavos: 66000 });
    expect(kkb.foodCentavos).toBe(300000);
  });

  it("an explicit ₱0.00 means no charge to allocate", () => {
    const a = e("Set A", 1, me("ana"));
    const kkb = buildKkb(withPrices(input([a]), { [a.id]: price(100) }, 0), "ana");
    expect(kkb.charge).toEqual({ state: "none" });
    expect(kkb.sections[0].serviceCentavos).toBeNull();
  });

  it("stays unallocated while anything is unpriced, shared without a payer, or pending, and says why", () => {
    const a = e("Katsu", 1, me("ana"));
    const tea = e("Tea", 1, me("ana"));
    const platter = e("Platter", 1, TABLE);
    const kkb = buildKkb(
      withPrices(input([a, tea, platter], { corrections: [correction({ sourceEntryId: a.id, quantityDelta: -1 })] }), { [a.id]: price(100), [platter.id]: price(500) }, 1000),
      "ana",
    );
    expect(kkb.charge.state).toBe("blocked");
    if (kkb.charge.state !== "blocked") return;
    expect(kkb.charge.blockers).toEqual([
      { kind: "unpriced", units: 1, where: ["Ana"] },
      { kind: "unbilled", dishes: ["Platter"] },
      { kind: "pending", count: 1 },
    ]);
    expect(kkb.sections[0].serviceCentavos).toBeNull();
  });

  it("a host's Bill to moves a shared dish to one payer and unblocks the charge", () => {
    const a = e("Katsu", 1, me("ana"));
    const platter = e("Platter", 1, TABLE);
    const kkb = buildKkb(withPrices(input([a, platter]), { [a.id]: price(10000), [platter.id]: price(30000, { participantId: "jd", label: null }) }, 4000), "jd");
    expect(kkb.charge.state).toBe("allocated");
    const jd = kkb.sections[0];
    expect(jd).toMatchObject({ title: "JD", pricedCentavos: 30000, serviceCentavos: 3000 });
    expect(jd.lines[0]).toMatchObject({ label: "Platter", billedFrom: "Whole table" });
    const table = kkb.sections.find((s) => s.kind === "table")!;
    expect(table).toMatchObject({ pricedCentavos: 0 });
    expect(table.lines[0]).toMatchObject({ billedTo: "JD" });
  });

  it("a positive charge with no eligible food stays unallocated", () => {
    const a = e("Water", 1, me("ana"));
    const kkb = buildKkb(withPrices(input([a]), { [a.id]: price(0) }, 500), "ana");
    expect(kkb.charge).toMatchObject({ state: "blocked", blockers: [{ kind: "zeroFood" }] });
  });
});

describe("allocate (largest remainder)", () => {
  it("sums exactly to the charge and breaks ties by payer key", () => {
    expect(allocate(100, [["b", 1], ["a", 1], ["c", 1]])).toEqual(new Map([["a", 34], ["b", 33], ["c", 33]]));
    const shares = allocate(1001, [["x", 333], ["y", 333], ["z", 334]]);
    expect([...shares.values()].reduce((s, v) => s + v, 0)).toBe(1001);
  });

  it("handles big totals without float error", () => {
    const shares = allocate(99_999_999, [["a", 9_999_999 * 99 * 150], ["b", 9_999_999 * 99 * 150 + 1]]);
    expect([...shares.values()].reduce((s, v) => s + v, 0)).toBe(99_999_999);
  });
});
