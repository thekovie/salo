import { describe, expect, it } from "vitest";
import { buildKkb, reconcile, type KkbInput } from "@/lib/kkb";
import { reconcileReceipts } from "@/lib/receipts";
import { EMPTY_SETTLEMENT, type SnapshotAdjustment, type SnapshotEntry, type SnapshotReceipt } from "@/lib/snapshot";

const people = [
  { id: "h", displayName: "Host", role: "HOST" as const, cohost: false },
  { id: "ana", displayName: "Ana", role: "GUEST" as const, cohost: false },
  { id: "liza", displayName: "Liza", role: "GUEST" as const, cohost: false },
  { id: "bo", displayName: "Bo", role: "GUEST" as const, cohost: false },
];
let n = 0;
const dish = (name: string, who: string): SnapshotEntry => {
  n += 1;
  return { id: `e${n}`, batchId: `b${n}`, roundId: "r1", dishId: `d${n}`, dishName: name, quantity: 1, variant: null, instructions: null, createdAt: `2026-11-08T12:00:${String(n).padStart(2, "0")}Z`, revision: 1, submittedBy: "h", attribution: { type: "INDIVIDUAL", label: null, participantId: who } };
};
const senior = (over: Partial<SnapshotAdjustment> = {}): SnapshotAdjustment => ({ id: "a1", direction: "discount", category: "senior", note: null, amountCentavos: 2000, percentBps: null, method: "individual", shares: [{ participantId: "liza", label: null, amountCentavos: null }], revision: 1, ...over });
const receipt = (over: Partial<SnapshotReceipt> = {}): SnapshotReceipt => ({ id: "r-2", label: null, totalCentavos: null, people: [{ participantId: "liza", label: null }], revision: 1, ...over });

function scene(adjustments: SnapshotAdjustment[] = [], receipts: SnapshotReceipt[] = [], main: number | null = null) {
  const a = dish("Rice", "ana");
  const l = dish("Katsu", "liza");
  const b = dish("Ribs", "bo");
  const prices = { [a.id]: { unitCentavos: 10000, billTo: null, revision: 1 }, [l.id]: { unitCentavos: 20000, billTo: null, revision: 1 }, [b.id]: { unitCentavos: 30000, billTo: null, revision: 1 } };
  const input: KkbInput = {
    participants: people,
    removedPeople: [],
    rounds: [{ id: "r1", number: 1, status: "CONFIRMED", confirmedAt: "2026-11-08T12:30:00Z" }],
    entries: [a, l, b],
    corrections: [],
    groups: [],
    settlement: { ...EMPTY_SETTLEMENT, entries: prices, serviceCharge: { centavos: 0, revision: 1 }, adjustments, receipts, receiptTotal: { centavos: main, revision: main == null ? 0 : 1 } },
  };
  return { input, kkb: buildKkb(input, "h") };
}
const view = (s: ReturnType<typeof scene>) => reconcileReceipts(s.kkb, s.input.settlement, s.input);

describe("reconcileReceipts", () => {
  it("is null with no extra receipts, and the single-receipt reconcile is unchanged", () => {
    const s = scene();
    expect(view(s)).toBeNull();
    expect(reconcile(s.kkb, 60000)).toEqual({ state: "matches" });
  });

  it("main expects the adjusted total minus the extras; the extra expects its people's cards", () => {
    const s = scene([], [receipt({ totalCentavos: 20000 })], 40000);
    const v = view(s)!;
    expect(v.cards.map((c) => [c.label, c.expectedCentavos, c.state.state])).toEqual([["Main receipt", 40000, "matches"], ["Receipt 2", 20000, "matches"]]);
    expect(v.overall).toEqual({ receiptsCentavos: 60000, saloCentavos: 60000, matches: true });
  });

  it("an applied discount sits on the receipt of the person it is for", () => {
    const s = scene([senior()], [receipt({ totalCentavos: 18000 })], 40000);
    const v = view(s)!;
    expect(v.cards[1]).toMatchObject({ expectedCentavos: 18000, adjustments: ["Senior citizen discount"] });
    expect(v.cards[1].state).toEqual({ state: "matches" });
    expect(v.cards[0].expectedCentavos).toBe(40000);
  });

  it("a flagged adjustment still lands on its person's receipt", () => {
    const s = scene([senior({ amountCentavos: 99000 })], [receipt()], null);
    expect(s.kkb.adjustments[0].state).toBe("flagged");
    expect(view(s)!.cards[1].expectedCentavos).toBe(20000 - 99000);
  });

  it("someone with nothing on the bill is flagged; a total not entered says so", () => {
    const s = scene([], [receipt({ people: [{ participantId: "h", label: null }] })]);
    const v = view(s)!;
    expect(v.cards[1].flags).toEqual(["Host has nothing on the bill"]);
    expect(v.cards[1].state).toEqual({ state: "enter" });
    expect(v.overall).toBeNull();
  });

  it("a receipt a claim left with nobody shows no comparison, even with a total", () => {
    const s = scene([], [receipt({ people: [], totalCentavos: 50000 })], 60000);
    const v = view(s)!;
    expect(v.cards[1]).toMatchObject({ expectedCentavos: 0, state: { state: "empty" }, flags: [] });
    expect(v.cards[0].expectedCentavos).toBe(60000);

    const unpriced = { ...s.input, settlement: { ...s.input.settlement, entries: { ...s.input.settlement.entries, [s.input.entries[0].id]: { unitCentavos: null, billTo: null, revision: 1 } } } };
    const blocked = reconcileReceipts(buildKkb(unpriced, "h"), unpriced.settlement, unpriced)!;
    expect(blocked.cards[0].state.state).toBe("incomplete");
    expect(blocked.cards[1].state).toEqual({ state: "empty" });
  });

  it("decide-later amounts are listed on the main receipt", () => {
    const s = scene([senior({ method: "unallocated", shares: [], amountCentavos: 3000 })], [receipt()]);
    expect(view(s)!.cards[0].unassigned).toEqual([{ label: "Senior citizen discount", centavos: -3000 }]);
  });
});
