import { describe, expect, it } from "vitest";
import { buildKkb, kkbText, myShareLabel, reconcile, type KkbInput } from "@/lib/kkb";
import { allocate } from "@/lib/allocate";
import { percentOf } from "@/lib/adjustments";
import { EMPTY_SETTLEMENT, type SnapshotAdjustment, type SnapshotEntry } from "@/lib/snapshot";

let n = 0;
const mine = (id: string): SnapshotEntry["attribution"] => ({ type: "INDIVIDUAL", label: null, participantId: id });
function entry(dish: string, quantity: number, who: string): SnapshotEntry {
  n += 1;
  return { id: `e${n}`, batchId: `b${n}`, roundId: "r1", dishId: `d-${dish}`, dishName: dish, quantity, variant: null, instructions: null, createdAt: `2026-11-08T12:00:${String(n).padStart(2, "0")}Z`, revision: 1, submittedBy: "h", attribution: mine(who) };
}
const people = [
  { id: "h", displayName: "Host", role: "HOST" as const, cohost: false },
  { id: "ana", displayName: "Ana", role: "GUEST" as const, cohost: false },
  { id: "jd", displayName: "JD", role: "GUEST" as const, cohost: false },
];

/** Host 100.00, Ana 300.00, JD 600.00 of food: 1,000.00 in all. */
function scene(adjustments: SnapshotAdjustment[], over: { charge?: number | null; unpriced?: boolean } = {}): KkbInput {
  const host = entry("Rice", 1, "h");
  const ana = entry("Katsu", 1, "ana");
  const jd = entry("Ribs", 1, "jd");
  const prices = { [host.id]: { unitCentavos: 10000, billTo: null, revision: 1 }, [ana.id]: { unitCentavos: 30000, billTo: null, revision: 1 }, [jd.id]: { unitCentavos: over.unpriced ? null : 60000, billTo: null, revision: 1 } };
  return {
    participants: people,
    removedPeople: [],
    rounds: [{ id: "r1", number: 1, status: "CONFIRMED", confirmedAt: "2026-11-08T12:30:00Z" }],
    entries: [host, ana, jd],
    corrections: [],
    groups: [],
    settlement: { ...EMPTY_SETTLEMENT, entries: prices, serviceCharge: { centavos: over.charge ?? null, revision: over.charge == null ? 0 : 1 }, adjustments },
  };
}
let seq = 0;
const adj = (over: Partial<SnapshotAdjustment>): SnapshotAdjustment => ({
  id: `a${++seq}`,
  direction: "discount",
  category: "senior",
  note: null,
  amountCentavos: 5000,
  percentBps: null,
  method: "individual",
  shares: [{ participantId: "ana", label: null, amountCentavos: null }],
  revision: 1,
  ...over,
});
const share = (participantId: string, amountCentavos: number | null = null) => ({ participantId, label: null, amountCentavos });
const section = (input: KkbInput, id: string) => buildKkb(input, "h").sections.find((s) => s.key === `p:${id}`)!;

describe("adjustment shares", () => {
  it("one person takes the whole amount", () => {
    expect(section(scene([adj({})]), "ana").totalCentavos).toBe(25000);
    expect(section(scene([adj({})]), "jd").totalCentavos).toBeNull();
  });

  it("proportional, equal and manual shares always sum to the amount", () => {
    const methods = [
      adj({ method: "proportional", amountCentavos: 10001, shares: [share("h"), share("ana"), share("jd")] }),
      adj({ method: "equal", amountCentavos: 10001, shares: [share("h"), share("ana"), share("jd")] }),
      adj({ method: "manual", amountCentavos: 10001, shares: [share("h", 1), share("ana", 5000), share("jd", 5000)] }),
    ];
    for (const a of methods) {
      const [result] = buildKkb(scene([a]), "h").adjustments;
      expect(result.state).toBe("applied");
      expect(result.shares.reduce((sum, s) => sum + s.centavos, 0)).toBe(10001);
    }
  });

  it("percent is half-up of the selected food, per method", () => {
    expect(percentOf(1250, 30000)).toBe(3750);
    expect(percentOf(1, 5000)).toBe(1);
    expect(percentOf(1, 4999)).toBe(0);
    const [result] = buildKkb(scene([adj({ amountCentavos: null, percentBps: 2000 })]), "h").adjustments;
    expect(result.amountCentavos).toBe(6000);
    const [spread] = buildKkb(scene([adj({ amountCentavos: null, percentBps: 1000, method: "proportional", shares: [share("ana"), share("jd")] })]), "h").adjustments;
    expect(spread.amountCentavos).toBe(9000);
  });

  it("a charge adds and a discount subtracts, after the service charge", () => {
    const input = scene([adj({ direction: "charge", category: "other", note: "Corkage", amountCentavos: 1000, shares: [share("jd")] })], { charge: 11000 });
    expect(section(input, "jd").serviceCentavos).toBe(6600);
    expect(section(input, "jd").totalCentavos).toBe(60000 + 6600 + 1000);
    expect(buildKkb(input, "h").adjustedTotal).toBe(100000 + 11000 + 1000);
  });

  it("decide later changes no card but still counts in the adjusted total, and totals read so far", () => {
    const input = scene([adj({ method: "unallocated", shares: [] })]);
    const kkb = buildKkb(input, "h");
    expect(kkb.adjustments[0].state).toBe("unallocated");
    expect(kkb.sections.every((s) => s.adjustments.length === 0)).toBe(true);
    expect(kkb.adjustedTotal).toBe(100000 - 5000);
    expect(kkb.unresolved).toBe(true);
    expect(myShareLabel(buildKkb(input, "h"))).toMatch(/so far/);
    expect(kkbText(kkb, "Dinner", "Nov 8")).toContain("Not assigned");
  });

  it("an unpriced dish makes it wait: no shares until every dish has a price", () => {
    const kkb = buildKkb(scene([adj({ amountCentavos: null, percentBps: 1000 })], { unpriced: true }), "h");
    expect(kkb.adjustments[0].state).toBe("waiting");
    expect(kkb.adjustments[0].shares).toEqual([]);
    expect(kkb.unresolved).toBe(true);
  });

  it("more than the selected food is flagged and changes no card, but counts in the total", () => {
    const kkb = buildKkb(scene([adj({ amountCentavos: 40000 })]), "h");
    expect(kkb.adjustments[0].state).toBe("flagged");
    expect(kkb.sections.every((s) => s.adjustments.length === 0)).toBe(true);
    expect(kkb.adjustedTotal).toBe(100000 - 40000);
  });

  it("someone with no food is flagged too", () => {
    const kkb = buildKkb(scene([adj({ shares: [share("zed")] })]), "h");
    expect(kkb.adjustments[0].state).toBe("flagged");
  });

  it("with no adjustments the output has no adjustment trace", () => {
    const kkb = buildKkb(scene([]), "h");
    expect(kkb.adjustedTotal).toBe(100000);
    expect(kkb.unresolved).toBe(false);
    expect(kkbText(kkb, "Dinner", "Nov 8")).not.toMatch(/discount|Not assigned/i);
  });
});

describe("reconcile uses the adjusted total", () => {
  it("matches the receipt that includes the discount", () => {
    const kkb = buildKkb(scene([adj({})]), "h");
    expect(reconcile(kkb, 95000)).toEqual({ state: "matches" });
    expect(reconcile(kkb, 100000)).toMatchObject({ state: "more", differenceCentavos: 5000 });
  });
});

describe("allocate", () => {
  it("largest remainder, ties by key, always sums", () => {
    const out = allocate(100, [["b", 1], ["a", 1], ["c", 1]]);
    expect([...out.values()].reduce((a, b) => a + b, 0)).toBe(100);
    expect(out.get("a")).toBe(34);
  });
});

describe("verify round 1 regressions", () => {
  function unbilledScene(): KkbInput {
    const base = scene([adj({})]);
    const table = { ...entry("Crispy pata", 1, "h"), attribution: { type: "TABLE" as const, label: null, participantId: null } };
    return { ...base, entries: [...base.entries, table], settlement: { ...base.settlement, entries: { ...base.settlement.entries, [table.id]: { unitCentavos: 20000, billTo: null, revision: 1 } } } };
  }

  it("a waiting adjustment stops the receipt comparison instead of reporting a false mismatch", () => {
    const kkb = buildKkb(unbilledScene(), "h");
    expect(kkb.adjustments[0].state).toBe("waiting");
    expect(reconcile(kkb, 115000)).toEqual({ state: "waiting" });
  });

  it("a Decide later amount isn't held back by a shared dish with no payer (follow-up 3)", () => {
    const base = unbilledScene();
    const input = { ...base, settlement: { ...base.settlement, adjustments: [adj({ direction: "charge", category: "other", note: "Corkage", amountCentavos: 20000, method: "unallocated", shares: [] })] } };
    const kkb = buildKkb(input, "h");
    expect(kkb.adjustments[0].state).toBe("unallocated");
    expect(kkb.adjustedTotal).toBe(kkb.foodCentavos + 20000);
  });

  it("Total not final names a flagged adjustment as needing a fix, not as unassigned", () => {
    const text = kkbText(buildKkb(scene([adj({ amountCentavos: 99999 })]), "h"), "T", "today");
    expect(text).toContain("an adjustment needs fixing");
    expect(text).not.toContain("an adjustment isn't assigned");
  });
});
