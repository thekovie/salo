import { names, personKey } from "./adjustments";
import { reconcile, type Kkb, type Reconciliation } from "./kkb";
import { everyone, type SessionSnapshot, type SettlementView, type SnapshotReceipt } from "./snapshot";

/** Extra receipts one order can hold (the main receipt is extra to this). */
export const MAX_EXTRA_RECEIPTS = 10;

export const receiptName = (list: readonly SnapshotReceipt[], r: SnapshotReceipt): string => r.label ?? `Receipt ${list.findIndex((x) => x.id === r.id) + 2}`;

export type ReceiptState = Reconciliation | { state: "enter" } | { state: "empty" };

/** One receipt compared with what Salo expects for the people it covers. The main receipt carries everyone not on an extra one. */
export interface ReceiptCard {
  /** null for the main receipt. */
  id: string | null;
  label: string;
  covers: string;
  /** What Salo expects this receipt to total: the covered cards plus their flagged adjustments (main: the rest of the adjusted total). */
  expectedCentavos: number;
  /** Discounts and extra charges applied to the people on it. */
  adjustments: string[];
  /** Decide-later amounts, landing on the main receipt. */
  unassigned: { label: string; centavos: number }[];
  /** "Ana has nothing on the bill". */
  flags: string[];
  totalCentavos: number | null;
  revision: number;
  state: ReceiptState;
}

export interface ReceiptsView {
  cards: ReceiptCard[];
  /** Σ receipt totals against Salo's adjusted total, once every total is in and nothing blocks the check. */
  overall: { receiptsCentavos: number; saloCentavos: number; matches: boolean } | null;
}

/** Per-receipt reconciliation (`reconcile` stays the single-receipt check). Null when there are no extra receipts. */
export function reconcileReceipts(kkb: Kkb, settlement: SettlementView, people: Pick<SessionSnapshot, "participants" | "removedPeople">): ReceiptsView | null {
  const extras = settlement.receipts;
  if (extras.length === 0) return null;
  const nameOf = new Map(everyone(people).map((p) => [`p:${p.id}`, p.displayName]));
  const cards = new Map(kkb.sections.filter((s) => !s.shared).map((s) => [s.key, s]));
  const gate = reconcile(kkb, kkb.adjustedTotal);
  const blocked = gate.state !== "matches";
  const compare = (total: number | null, expected: number): ReceiptState => {
    if (blocked) return gate;
    if (total == null) return { state: "enter" };
    const difference = total - expected;
    return difference === 0 ? { state: "matches" } : { state: difference > 0 ? "more" : "less", differenceCentavos: Math.abs(difference) };
  };

  const covered = new Set<string>();
  const extraCards = extras.map((r): ReceiptCard => {
    const keys = r.people.map((p) => personKey(p));
    keys.forEach((k) => covered.add(k));
    const label = (k: string, p: (typeof r.people)[number]) => cards.get(k)?.title ?? nameOf.get(k) ?? p.label ?? "Someone";
    const flagged = kkb.adjustments.filter((a) => a.state === "flagged").flatMap((a) => a.shares.filter((sh) => keys.includes(sh.key)).map((sh) => (a.direction === "discount" ? -sh.centavos : sh.centavos)));
    const expected = keys.reduce((sum, k) => sum + (cards.get(k)?.totalCentavos ?? cards.get(k)?.pricedCentavos ?? 0), 0) + flagged.reduce((a, b) => a + b, 0);
    const named = r.people.map((p, j) => label(keys[j], p));
    return {
      id: r.id,
      label: receiptName(extras, r),
      covers: names(named),
      expectedCentavos: expected,
      adjustments: kkb.adjustments.filter((a) => a.shares.some((sh) => keys.includes(sh.key))).map((a) => a.cardLabel),
      unassigned: [],
      flags: r.people.flatMap((p, j) => ((cards.get(keys[j])?.pricedCentavos ?? 0) === 0 ? [`${named[j]} has nothing on the bill`] : [])),
      totalCentavos: r.totalCentavos,
      revision: r.revision,
      // A claim can empty a receipt (its only typed name was someone already on another receipt): nothing to compare yet.
      state: r.people.length === 0 ? { state: "empty" } : compare(r.totalCentavos, expected),
    };
  });

  const mainExpected = kkb.adjustedTotal - extraCards.reduce((sum, c) => sum + c.expectedCentavos, 0);
  const mainPeople = [...cards.values()].filter((s) => s.lines.length > 0 && !covered.has(s.key)).map((s) => s.title).sort((a, b) => a.localeCompare(b));
  const main: ReceiptCard = {
    id: null,
    label: "Main receipt",
    covers: names(mainPeople),
    expectedCentavos: mainExpected,
    adjustments: [],
    unassigned: kkb.adjustments.filter((a) => a.state === "unallocated").map((a) => ({ label: a.cardLabel, centavos: (a.direction === "discount" ? -1 : 1) * (a.amountCentavos ?? 0) })),
    flags: [],
    totalCentavos: settlement.receiptTotal.centavos,
    revision: settlement.receiptTotal.revision,
    state: compare(settlement.receiptTotal.centavos, mainExpected),
  };
  const all = [main, ...extraCards];
  const entered = all.every((c) => c.totalCentavos != null);
  const receiptsCentavos = all.reduce((sum, c) => sum + (c.totalCentavos ?? 0), 0);
  return { cards: all, overall: entered && !blocked ? { receiptsCentavos, saloCentavos: kkb.adjustedTotal, matches: receiptsCentavos === kkb.adjustedTotal } : null };
}
