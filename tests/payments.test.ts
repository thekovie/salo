import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildKkb, kkbText, type KkbInput } from "@/lib/kkb";
import { billFinal, paidByKey, paymentStatus, paymentTotals } from "@/lib/payments";
import { EMPTY_SETTLEMENT, type SnapshotAdjustment, type SnapshotEntry, type SnapshotPayment } from "@/lib/snapshot";

let n = 0;
const mine = (id: string): SnapshotEntry["attribution"] => ({ type: "INDIVIDUAL", label: null, participantId: id });
function entry(dish: string, quantity: number, attribution: SnapshotEntry["attribution"], roundId = "r1"): SnapshotEntry {
  n += 1;
  return { id: `e${n}`, batchId: `b${n}`, roundId, dishId: `d-${dish}`, dishName: dish, quantity, variant: null, instructions: null, createdAt: `2026-11-08T12:00:${String(n).padStart(2, "0")}Z`, revision: 1, submittedBy: "h", attribution };
}
const people = [
  { id: "h", displayName: "Host", role: "HOST" as const, cohost: false },
  { id: "ana", displayName: "Ana", role: "GUEST" as const, cohost: false },
  { id: "jd", displayName: "JD", role: "GUEST" as const, cohost: false },
];
const pay = (over: Partial<SnapshotPayment> & { who?: string }): SnapshotPayment => ({ id: `p${++n}`, payer: { participantId: over.who ?? "ana", label: null }, payee: null, amountCentavos: 1000, method: null, note: null, createdAt: "2026-11-08T13:00:00Z", needsReview: false, ...over });

type Over = { charge?: number | null; unpriced?: boolean; adjustments?: SnapshotAdjustment[]; payments?: SnapshotPayment[]; removed?: boolean; extra?: SnapshotEntry[]; draftOnly?: boolean };
/** Host 100.00, Ana 300.00, JD 600.00 of food (no service charge unless asked). */
function scene(over: Over = {}) {
  const host = entry("Rice", 1, mine("h"));
  const ana = entry("Katsu", 1, mine("ana"));
  const jd = entry("Ribs", 1, mine("jd"));
  const prices = { [host.id]: { unitCentavos: 10000, billTo: null, revision: 1 }, [ana.id]: { unitCentavos: 30000, billTo: null, revision: 1 }, [jd.id]: { unitCentavos: over.unpriced ? null : 60000, billTo: null, revision: 1 } };
  const input: KkbInput = {
    participants: over.removed ? people.filter((p) => p.id !== "ana") : people,
    removedPeople: over.removed ? [{ id: "ana", displayName: "Ana" }] : [],
    rounds: [{ id: "r1", number: 1, status: "CONFIRMED", confirmedAt: "2026-11-08T12:30:00Z" }],
    entries: [host, ana, jd, ...(over.extra ?? [])],
    corrections: [],
    groups: [],
    settlement: { ...EMPTY_SETTLEMENT, entries: prices, serviceCharge: { centavos: over.charge === undefined ? 0 : over.charge, revision: 1 }, adjustments: over.adjustments ?? [], payments: over.payments ?? [] },
  };
  return { input, kkb: buildKkb(input, "h"), prices };
}
const card = (kkb: ReturnType<typeof buildKkb>, id: string) => kkb.sections.find((s) => s.key === `p:${id}`)!;
const statusOf = (over: Over, id: string, paid: number) => {
  const { kkb } = scene(over);
  return paymentStatus(card(kkb, id), paid, billFinal(kkb));
};

describe("paymentStatus", () => {
  it("unpaid, partly paid, paid and overpaid on a final bill", () => {
    expect(statusOf({}, "ana", 0)).toMatchObject({ chip: "unpaid", left: 30000, final: true });
    expect(statusOf({}, "ana", 10000)).toMatchObject({ chip: "partly", left: 20000, overpaid: 0 });
    expect(statusOf({}, "ana", 30000)).toMatchObject({ chip: "paid", left: 0 });
    expect(statusOf({}, "ana", 31000)).toMatchObject({ chip: "paid", left: -1000, overpaid: 1000 });
  });

  it("is never Paid while the bill can still move, whatever the piece", () => {
    const unpricedDish = scene({ unpriced: true });
    expect(billFinal(unpricedDish.kkb)).toBe(false);
    expect(paymentStatus(card(unpricedDish.kkb, "ana"), 99999, false).chip).toBe("partly");
    expect(billFinal(scene({ charge: null }).kkb)).toBe(false); // service charge not entered: unset
    const billable = entry("Pata", 1, { type: "TABLE", label: null, participantId: null });
    expect(billFinal(scene({ extra: [billable] }).kkb)).toBe(false); // shared dish nobody is billed for
    const draftOnly = entry("Soda", 1, mine("ana"), "r2");
    expect(billFinal(scene({ extra: [draftOnly] }).kkb)).toBe(true); // drafts never count
  });

  it("blocked service charge and unresolved adjustments are not final", () => {
    expect(billFinal(scene({ charge: 5000, unpriced: true }).kkb)).toBe(false);
    const unassigned: SnapshotAdjustment = { id: "a1", direction: "discount", category: "promo", note: null, amountCentavos: 1000, percentBps: null, method: "unallocated", shares: [], revision: 1 };
    const s = scene({ adjustments: [unassigned] });
    expect(s.kkb.unresolved).toBe(true);
    expect(billFinal(s.kkb)).toBe(false);
    expect(billFinal(scene({ charge: 5000 }).kkb)).toBe(true);
  });

  it("a card with no price or no obligation gets no chip and no balance", () => {
    const s = scene({ unpriced: true });
    expect(paymentStatus(card(s.kkb, "jd"), 500, false)).toMatchObject({ chip: null, obligation: 0, paid: 500 });
    const zero = scene({ adjustments: [{ id: "a1", direction: "discount", category: "promo", note: null, amountCentavos: 10000, percentBps: null, method: "individual", shares: [{ participantId: "h", label: null, amountCentavos: null }], revision: 1 }] });
    expect(paymentStatus(card(zero.kkb, "h"), 0, true).chip).toBeNull();
  });

  it("a price change after paying recomputes what is left; the payment is untouched", () => {
    const payments = [pay({ amountCentavos: 30000 })];
    const s = scene({ payments });
    expect(paymentStatus(card(s.kkb, "ana"), 30000, billFinal(s.kkb)).chip).toBe("paid");
    const raised = scene({ payments });
    const ana = raised.input.entries[1];
    raised.input.settlement.entries[ana.id] = { unitCentavos: 40000, billTo: null, revision: 2 };
    const kkb = buildKkb(raised.input, "h");
    expect(paymentStatus(card(kkb, "ana"), 30000, billFinal(kkb))).toMatchObject({ chip: "partly", left: 10000 });
    raised.input.settlement.entries[ana.id] = { unitCentavos: 20000, billTo: null, revision: 3 };
    expect(paymentStatus(card(buildKkb(raised.input, "h"), "ana"), 30000, true)).toMatchObject({ chip: "paid", overpaid: 10000 });
    expect(raised.input.settlement.payments).toBe(payments);
  });

  it("the obligation includes service charge, adjustments and a split share", () => {
    const senior: SnapshotAdjustment = { id: "a1", direction: "discount", category: "senior", note: null, amountCentavos: 5000, percentBps: null, method: "individual", shares: [{ participantId: "ana", label: null, amountCentavos: null }], revision: 1 };
    const s = scene({ charge: 10000, adjustments: [senior] });
    expect(card(s.kkb, "ana").totalCentavos).toBe(30000 + 3000 - 5000);
    expect(statusOf({ charge: 10000, adjustments: [senior] }, "ana", 28000)).toMatchObject({ chip: "paid", obligation: 28000 });

    const pata = entry("Crispy Pata", 1, { type: "TABLE", label: null, participantId: null });
    const split = scene({ extra: [pata] });
    split.input.settlement.entries[pata.id] = { unitCentavos: 39000, billTo: null, splitAmong: [{ participantId: "ana", label: null }, { participantId: "jd", label: null }], revision: 1 };
    const kkb = buildKkb(split.input, "h");
    expect(card(kkb, "ana").pricedCentavos).toBe(30000 + 19500);
    expect(billFinal(kkb)).toBe(true);
  });
});

describe("paymentTotals", () => {
  it("Left to pay is the sum of each person's shortfall; one overpayment hides nobody's debt", () => {
    const payments = [pay({ who: "ana", amountCentavos: 50000 }), pay({ who: "jd", amountCentavos: 10000 })];
    const { kkb } = scene({ payments });
    expect(paymentTotals(kkb, payments)).toMatchObject({ collected: 60000, of: 100000, left: 10000 + 50000, orphans: [] });
  });

  it("a person who left keeps their payments and card; a payer with no card is an orphan", () => {
    const left = pay({ who: "ana", amountCentavos: 5000 });
    const stranger = pay({ payer: { participantId: null, label: "Pedro" }, amountCentavos: 30000 });
    const { kkb } = scene({ removed: true, payments: [left, stranger] });
    expect(card(kkb, "ana").title).toBe("Ana (left)");
    const totals = paymentTotals(kkb, [left, stranger]);
    expect(totals.orphans).toEqual([stranger]);
    expect(totals.collected).toBe(35000);
    expect(totals.left).toBe(100000 - 5000);
  });

  it("a payment that needs review counts nowhere until the payee is fixed", () => {
    const flagged = pay({ who: "ana", amountCentavos: 50000, needsReview: true });
    const { kkb } = scene({ payments: [flagged] });
    expect(paidByKey([flagged]).size).toBe(0);
    expect(paymentTotals(kkb, [flagged])).toMatchObject({ collected: 0, of: 100000, left: 100000, orphans: [] });
    expect(paymentStatus(card(kkb, "ana"), paidByKey([flagged]).get("p:ana") ?? 0, true)).toMatchObject({ chip: "unpaid", paid: 0, left: 30000 });
    const fixed = { ...flagged, needsReview: false };
    expect(paymentTotals(kkb, [fixed])).toMatchObject({ collected: 50000, left: 100000 - 30000 });
  });

  it("a flagged payment whose payer has no card is still an orphan, and still counts nowhere", () => {
    const flagged = pay({ payer: { participantId: null, label: "Pedro" }, amountCentavos: 30000, needsReview: true });
    const totals = paymentTotals(scene({ payments: [flagged] }).kkb, [flagged]);
    expect(totals.orphans).toEqual([flagged]);
    expect(totals.collected).toBe(0);
  });

  it("matches the export baseline: kkbText ignores payments", () => {
    const base = scene({ charge: 28800 }).input;
    const withPayments = { ...base, settlement: { ...base.settlement, payments: [pay({ amountCentavos: 100 })] } };
    expect(kkbText(buildKkb(withPayments, "h"), "Max's Restaurant", "Tue, Nov 24")).toBe(kkbText(buildKkb(base, "h"), "Max's Restaurant", "Tue, Nov 24"));
  });

  it("the shipped export text keeps the .shots/before baseline shape", () => {
    const baseline = readFileSync(".shots/before/kkb-export.txt", "utf8");
    const host = entry("Rice", 8, mine("h"));
    const jun = entry("Sisig", 1, mine("jun"));
    const liza = entry("Pata", 1, mine("liza"));
    const input: KkbInput = {
      participants: [{ id: "h", displayName: "Host", role: "HOST", cohost: false }, { id: "jun", displayName: "Jun", role: "GUEST", cohost: false }, { id: "liza", displayName: "Liza", role: "GUEST", cohost: false }],
      removedPeople: [],
      rounds: [{ id: "r1", number: 1, status: "CONFIRMED", confirmedAt: "2026-11-24T12:30:00Z" }],
      entries: [host, jun, liza],
      corrections: [],
      groups: [],
      settlement: {
        ...EMPTY_SETTLEMENT,
        entries: { [host.id]: { unitCentavos: 10000, billTo: null, revision: 1 }, [jun.id]: { unitCentavos: 112000, billTo: null, revision: 1 }, [liza.id]: { unitCentavos: 96000, billTo: null, revision: 1 } },
        serviceCharge: { centavos: 28800, revision: 1 },
        adjustments: [{ id: "a1", direction: "discount", category: "senior", note: null, amountCentavos: 19200, percentBps: null, method: "individual", shares: [{ participantId: "liza", label: null, amountCentavos: null }], revision: 1 }],
        payments: [pay({ who: "jun", amountCentavos: 50000 })],
      },
    };
    expect(kkbText(buildKkb(input, "h"), "Max's Restaurant", "Tue, Nov 24")).toBe(baseline);
  });
});
