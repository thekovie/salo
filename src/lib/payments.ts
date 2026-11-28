import { personKey } from "./adjustments";
import { billFinal, type Kkb, type KkbSection } from "./kkb";
import type { SnapshotPayment } from "./snapshot";

/** A card the viewer can pay toward: one person's (not shared) with something confirmed on it. */
export const hasShare = (s: KkbSection) => !s.shared && s.lines.length > 0;

export { billFinal };

export const obligationOf = (s: KkbSection) => s.totalCentavos ?? s.pricedCentavos;

/** Payments that need review (payer == payee after a claim) count toward nothing until the host fixes the payee. */
export const paidByKey = (payments: readonly SnapshotPayment[]): Map<string, number> => {
  const paid = new Map<string, number>();
  for (const p of payments.filter((x) => !x.needsReview)) paid.set(personKey(p.payer), (paid.get(personKey(p.payer)) ?? 0) + p.amountCentavos);
  return paid;
};

export interface PaymentStatus {
  /** null: no chip and no "Left to pay" row (no price yet, or nothing to pay). */
  chip: "unpaid" | "partly" | "paid" | null;
  obligation: number;
  /** Obligation minus paid; negative when overpaid. */
  left: number;
  overpaid: number;
  paid: number;
  /** False while the bill can still move: the balance reads "so far" and the chip never says Paid. */
  final: boolean;
}

export function paymentStatus(section: KkbSection, paid: number, final: boolean): PaymentStatus {
  const obligation = obligationOf(section);
  const left = obligation - paid;
  const overpaid = Math.max(0, -left);
  const base = { obligation, left, overpaid, paid, final };
  if (section.status === "none" || section.status === "empty" || obligation === 0) return { ...base, chip: null };
  if (paid === 0) return { ...base, chip: "unpaid" };
  return { ...base, chip: final && paid >= obligation ? "paid" : "partly" };
}

export interface PaymentTotals {
  collected: number;
  of: number;
  /** Sum of each person's own shortfall: an overpayment never hides someone else's debt. */
  left: number;
  /** Payments whose payer has no card (anymore). */
  orphans: SnapshotPayment[];
  /** False while the bill can still move: the block's balance reads "so far". */
  final: boolean;
}

export function paymentTotals(kkb: Kkb, payments: readonly SnapshotPayment[]): PaymentTotals {
  const paid = paidByKey(payments);
  const cards = kkb.sections.filter((s) => !s.shared);
  const withShare = cards.filter(hasShare);
  const keys = new Set(cards.map((s) => s.key));
  return {
    collected: payments.reduce((sum, p) => sum + (p.needsReview ? 0 : p.amountCentavos), 0),
    of: withShare.reduce((sum, s) => sum + obligationOf(s), 0),
    left: withShare.reduce((sum, s) => sum + Math.max(0, obligationOf(s) - (paid.get(s.key) ?? 0)), 0),
    orphans: payments.filter((p) => !keys.has(personKey(p.payer))),
    final: billFinal(kkb),
  };
}
