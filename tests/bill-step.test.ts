import { describe, expect, it } from "vitest";
import { keepDots, nextBillStep, stepRowText, withoutPayments } from "@/lib/bill-step";
import { buildKkb, kkbText, myShareLabel, priceRows, type KkbInput } from "@/lib/kkb";
import { recordText } from "@/lib/kkb-record";
import { EMPTY_SETTLEMENT, type SessionSnapshot, type SnapshotAdjustment, type SnapshotEntry, type SnapshotPayment } from "@/lib/snapshot";
import { dineDate } from "@/lib/time";
import type { CorrectionView } from "@/lib/ticket";

let n = 0;
const mine = (id: string): SnapshotEntry["attribution"] => ({ type: "INDIVIDUAL", label: null, participantId: id });
const TABLE: SnapshotEntry["attribution"] = { type: "TABLE", label: null, participantId: null };
function entry(dish: string, quantity: number, attribution: SnapshotEntry["attribution"], roundId = "r1"): SnapshotEntry {
  n += 1;
  return { id: `e${n}`, batchId: `b${n}`, roundId, dishId: `d-${dish}`, dishName: dish, quantity, variant: null, instructions: null, createdAt: `2026-11-08T12:00:${String(n).padStart(2, "0")}Z`, revision: 1, submittedBy: "h", attribution };
}
const people = [
  { id: "h", displayName: "Host", role: "HOST" as const, cohost: false },
  { id: "ana", displayName: "Ana", role: "GUEST" as const, cohost: false },
  { id: "jd", displayName: "JD", role: "GUEST" as const, cohost: false },
];
const pay = (who: string, amountCentavos: number): SnapshotPayment => ({ id: `p${++n}`, payer: { participantId: who, label: null }, payee: null, amountCentavos, method: null, note: null, createdAt: "2026-11-08T13:00:00Z", needsReview: false });
const senior = (over: Partial<SnapshotAdjustment> = {}): SnapshotAdjustment => ({ id: "a1", direction: "discount", category: "senior", note: null, amountCentavos: 1000, percentBps: null, method: "unallocated", shares: [], revision: 1, ...over });

interface Over {
  charge?: number | null;
  unpriced?: boolean;
  extra?: SnapshotEntry[];
  extraPrices?: Record<string, number>;
  receipt?: number | null;
  payments?: SnapshotPayment[];
  adjustments?: SnapshotAdjustment[];
  pendingCancel?: boolean;
  zero?: boolean;
}
/** Host 100.00, Ana 300.00, JD 600.00 of food; service charge none unless asked. */
function scene(over: Over = {}) {
  const host = entry("Rice", 1, mine("h"));
  const ana = entry("Katsu", 1, mine("ana"));
  const jd = entry("Ribs", 1, mine("jd"));
  const entries = [host, ana, jd, ...(over.extra ?? [])];
  const prices = Object.fromEntries([
    [host.id, over.zero ? 0 : 10000],
    [ana.id, over.zero ? 0 : 30000],
    [jd.id, over.unpriced ? null : over.zero ? 0 : 60000],
    ...Object.entries(over.extraPrices ?? {}),
  ].map(([id, u]) => [id, { unitCentavos: u as number | null, billTo: null, revision: 1 }]));
  const input: KkbInput = {
    participants: people,
    removedPeople: [],
    rounds: [
      { id: "r1", number: 1, status: "CONFIRMED", confirmedAt: "2026-11-08T12:30:00Z" },
      { id: "r2", number: 2, status: "DRAFT", confirmedAt: null },
    ],
    entries,
    corrections: over.pendingCancel ? [{ id: "c1", sourceEntryId: ana.id, sourceRoundNumber: 1, targetRoundId: "r2", dishName: "Katsu", preparation: null, type: "QUANTITY", quantityDelta: -1, replacement: null, explanation: null, reason: null, groupId: null, createdAt: "2026-11-09T12:00:00Z" } satisfies CorrectionView] : [],
    groups: [],
    settlement: {
      ...EMPTY_SETTLEMENT,
      entries: prices,
      serviceCharge: { centavos: over.charge === undefined ? 0 : over.charge, revision: 1 },
      receiptTotal: { centavos: over.receipt === undefined ? null : over.receipt, revision: 1 },
      adjustments: over.adjustments ?? [],
      payments: over.payments ?? [],
    },
  };
  const snapshot = { ...input, servedCounts: [], session: { title: "T" } } as unknown as SessionSnapshot;
  const kkb = buildKkb(input, "h");
  return { kkb, snapshot, step: () => nextBillStep(kkb, snapshot, priceRows(input)) };
}

describe("nextBillStep order", () => {
  it("1 prices: names how many are left, for the host and the guests", () => {
    const s = scene({ unpriced: true, charge: null }).step();
    expect(s).toMatchObject({ id: "prices", text: "Enter prices · 1 left", waiting: "waiting on 1 dish without a price" });
    expect(stepRowText(s, false)).toBe("Shares so far · waiting on 1 dish without a price");
  });

  it("2 payers: a shared dish nobody pays for", () => {
    const platter = entry("Gyoza", 2, TABLE);
    const s = scene({ extra: [platter], extraPrices: { [platter.id]: 5000 } }).step();
    expect(s).toMatchObject({ id: "payers", text: "Choose who pays for 1 shared dish", waiting: "waiting on the host to choose who pays for 1 shared dish" });
  });

  it("3 pending: a change waiting for the waiter has no button", () => {
    const s = scene({ pendingCancel: true }).step();
    expect(s).toMatchObject({ id: "pending", text: "Waiting on a change with the waiter", canGo: false });
    expect(stepRowText(s, true)).toBe("Waiting on a change with the waiter");
    expect(stepRowText(s, false)).toBe("Shares so far · waiting on a change with the waiter");
  });

  it("4 service: charge not entered; 7 receipt soft step follows once it is", () => {
    const s = scene({ charge: null }).step();
    expect(s).toMatchObject({ id: "service", text: "Add the service charge from the receipt", waiting: "waiting on the host to add the service charge", isFinal: false, canGo: true });
    expect(stepRowText(s, true)).toBe("Next: add the service charge from the receipt");
  });

  it("5 review: a charge with no priced food to split it across", () => {
    const s = scene({ zero: true, charge: 1000 }).step();
    expect(s).toMatchObject({ id: "review", text: "Service charge: no priced food to split it across yet", waiting: "waiting on the host to sort out the service charge" });
    expect(stepRowText(s, true)).toBe("Next: service charge: no priced food to split it across yet");
  });

  it("6 adjustment: unassigned, then flagged reads 'Fix'", () => {
    expect(myShareLabel(scene({ adjustments: [senior()] }).kkb)).toMatch(/^My share so far/);
    const s = scene({ adjustments: [senior()] }).step();
    expect(s.id).toBe("adjustment");
    expect(s.text).toBe("Choose who gets the senior citizen discount");
    expect(s.waiting).toBe("waiting on the host to finish the senior citizen discount");
    const flagged = scene({ adjustments: [senior({ method: "individual", amountCentavos: 99999, shares: [{ participantId: "ana", label: null, amountCentavos: null }] })] }).step();
    expect(flagged.text).toBe("Fix the senior citizen discount");
  });

  it("7 and 8 are soft: shares already final, the receipt check follows", () => {
    const enter = scene().step();
    expect(enter).toMatchObject({ id: "receipt", text: "Check the total against the receipt", isFinal: true });
    expect(stepRowText(enter, true)).toBe("Shares are final · Check the total against the receipt");
    expect(stepRowText(enter, false)).toBe("Shares are final");
    const more = scene({ receipt: 115000 }).step();
    expect(more).toMatchObject({ id: "receipt", text: "Receipt is ₱150.00 more than Salo's total", isFinal: true, differs: true });
    expect(enter.differs).toBeUndefined();
    expect(scene({ receipt: 99000 }).step().text).toBe("Receipt is ₱10.00 less than Salo's total");
  });

  it("9 payments counts cards paid; 10 final when everyone has", () => {
    const some = scene({ receipt: 100000, payments: [pay("h", 10000)] }).step();
    expect(some).toMatchObject({ id: "payments", text: "Record payments · 1 of 3 paid", isFinal: true });
    expect(withoutPayments(some).id).toBe("final");
    const all = scene({ receipt: 100000, payments: [pay("h", 10000), pay("ana", 30000), pay("jd", 60000)] }).step();
    expect(all.id).toBe("final");
    expect(stepRowText(all, true)).toBe("Shares are final");
    expect(all.canGo).toBe(false);
  });

  it("the earlier step always wins", () => {
    expect(scene({ unpriced: true, charge: null, adjustments: [senior()] }).step().id).toBe("prices");
    expect(scene({ charge: null, adjustments: [senior()] }).step().id).toBe("service");
  });
});

describe("kkbText so far and final", () => {
  it("a final bill's lines carry no 'so far'; the same bill without a charge does", () => {
    expect(kkbText(scene({ charge: 0 }).kkb, "T", "D")).not.toContain("so far");
    expect(kkbText(scene({ charge: null }).kkb, "T", "D")).toContain("Ana  ₱300.00 so far");
    expect(kkbText(scene({ charge: 1000, adjustments: [senior()] }).kkb, "T", "D")).toMatch(/service = ₱\d[\d,.]+ so far/);
  });
});

describe("full record", () => {
  it("a card with no price is never called paid", () => {
    const { kkb, snapshot } = scene({ unpriced: true, charge: null, payments: [pay("ana", 30000)] });
    const text = recordText(kkb, snapshot);
    expect(text).not.toMatch(/JD paid ₱0\.00 · paid/);
    expect(text).toContain("JD paid ₱0.00 · no price yet");
  });

  it("off is the same text; on adds each section before 'Made with Salo'", () => {
    const base = scene({ charge: 0, receipt: 99000, adjustments: [senior({ method: "individual", amountCentavos: 1000, shares: [{ participantId: "ana", label: null, amountCentavos: null }] })] });
    const plain = kkbText(base.kkb, "T", "D");
    expect(kkbText(base.kkb, "T", "D", {})).toBe(plain);
    const full = kkbText(base.kkb, "T", "D", { record: recordText(base.kkb, base.snapshot) });
    for (const heading of ["Orders", "Served", "Receipt", "Payments"]) expect(full).toContain(`\n${heading}\n`);
    expect(full).not.toContain("\nCorrections\n");
    expect(full).toContain("Round 1\n  Host: Rice ×1\n  Ana: Katsu ×1");
    expect(full).toContain("0 of 3 plates served");
    expect(full).toContain("Payments\n  None recorded");
    expect(full.endsWith("\n\nMade with Salo")).toBe(true);
    expect(full.startsWith(plain.replace(/\nMade with Salo$/, ""))).toBe(true);
  });

  it("lists corrections, payments and a receipt that doesn't match", () => {
    const s = scene({ charge: 0, receipt: 69000, payments: [pay("ana", 10000)] });
    const ana = s.snapshot.entries.find((e) => e.dishName === "Katsu")!;
    const cancelled: CorrectionView = { id: "c1", sourceEntryId: ana.id, sourceRoundNumber: 1, targetRoundId: "r1", dishName: "Katsu", preparation: null, type: "QUANTITY", quantityDelta: -1, replacement: null, explanation: null, reason: "UNAVAILABLE", groupId: null, createdAt: "2026-11-09T12:00:00Z" };
    const snap = { ...s.snapshot, corrections: [cancelled] } as SessionSnapshot;
    const kkb = buildKkb(snap, "h");
    const text = recordText(kkb, snap);
    expect(text).toContain("Corrections\n  Round 1: Katsu ×1 → cancelled (out of stock)");
    expect(text).toContain("Receipt total ₱690.00 · ₱10.00 less than Salo's total");
  });

  it("payments: a line per card with what is paid and left", () => {
    const s = scene({ charge: 0, receipt: 100000, payments: [pay("ana", 10000)] });
    const text = recordText(s.kkb, s.snapshot);
    expect(text).toContain("Ana paid ₱100.00 · ₱200.00 left");
    expect(text).toContain("JD paid ₱0.00 · ₱600.00 left");
  });
});

describe("dineDate", () => {
  const rounds = [
    { confirmedAt: null },
    { confirmedAt: "2026-11-28T12:00:00Z" },
    { confirmedAt: "2026-11-30T12:00:00Z" },
  ];
  it("is the first confirmed round's day, not today", () => {
    expect(dineDate(rounds, new Date("2026-12-05T12:00:00Z"), "en-US")).toBe("Sat, Nov 28");
  });
  it("falls back to today when nothing is confirmed", () => {
    expect(dineDate([{ confirmedAt: null }], new Date("2026-12-05T12:00:00Z"), "en-US")).toBe("Sat, Dec 5");
  });
});

describe("keepDots", () => {
  it("keeps separators and the paid count off a line start", () => {
    expect(keepDots("Shares are final · Record payments · 1 of 3 paid")).toBe("Shares are final · Record payments · 1 of 3 paid");
  });
});
