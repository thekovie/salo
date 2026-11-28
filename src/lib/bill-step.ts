import { billBlockers, dishes, enterPricesLabel, lowerFirst, priceCompleteness, pricesLeft, reconcile, type Kkb, type PriceRow } from "./kkb";
import { formatPeso } from "./money";
import { hasShare, paidByKey, paymentStatus } from "./payments";
import { reconcileReceipts } from "./receipts";
import type { SessionSnapshot } from "./snapshot";

/** Where "Go" lands: the Prices sheet, a line, or one of the KKB blocks. `pending` and `final` have nowhere to go. */
export type BillStepId = "prices" | "payers" | "pending" | "service" | "review" | "adjustment" | "receipt" | "payments" | "final";

export interface BillStep {
  id: BillStepId;
  /** Sentence case, what the host does. */
  text: string;
  /** What a guest or co-host is waiting on, lower case, without the "Shares so far · " prefix. */
  waiting: string;
  /** Shares can't move any more; the rest (receipt check, payments) is optional. */
  isFinal: boolean;
  /** The host has something to jump to. */
  canGo: boolean;
  /** Final, but the receipt disagrees: shown in the "next" tone, not the done one. */
  differs?: boolean;
}

type Input = Pick<SessionSnapshot, "settlement" | "participants" | "removedPeople">;

const step = (id: BillStepId, text: string, waiting: string, isFinal = false, canGo = true): BillStep => ({ id, text, waiting, isFinal, canGo });

export const FINAL_STEP: BillStep = step("final", "", "", true, false);

/**
 * The first open step of pricing and settling, in the order a table naturally does it. Nothing is locked: the receipt check and
 * payments come after the shares are final and never hold that back (`billFinal`).
 */
export function nextBillStep(kkb: Kkb, input: Input, rows: readonly PriceRow[]): BillStep {
  const { total, priced } = priceCompleteness(kkb);
  const left = pricesLeft(rows) || total - priced;
  if (priced < total || left > 0) return step("prices", enterPricesLabel(left), `waiting on ${dishes(total - priced || left)} without a price`);

  const blockers = billBlockers(kkb.sections);
  const unbilled = blockers.find((b) => b.kind === "unbilled");
  if (unbilled) {
    const n = unbilled.dishes.length;
    const what = dishes(n).replace(" ", " shared ");
    return step("payers", `Choose who pays for ${what}`, `waiting on the host to choose who pays for ${what}`);
  }
  if (blockers.some((b) => b.kind === "pending")) return step("pending", "Waiting on a change with the waiter", "waiting on a change with the waiter", false, false);

  if (kkb.charge.state === "unset") return step("service", "Add the service charge from the receipt", "waiting on the host to add the service charge");
  if (kkb.charge.state === "blocked") return step("review", "Service charge: no priced food to split it across yet", "waiting on the host to sort out the service charge");

  const open = kkb.adjustments.find((a) => a.state === "unallocated" || a.state === "flagged");
  if (open) {
    const label = lowerFirst(open.cardLabel);
    return step("adjustment", open.state === "flagged" ? `Fix the ${label}` : `Choose who gets the ${label}`, `waiting on the host to finish the ${label}`);
  }

  // One receipt compares against `receiptTotal`; several come with their own cards.
  const view = reconcileReceipts(kkb, input.settlement, input);
  const receipts = view ? view.cards.map((c) => ({ name: c.id === null ? "Receipt" : c.label, state: c.state })) : [{ name: "Receipt", state: input.settlement.receiptTotal.centavos == null ? { state: "enter" as const } : reconcile(kkb, input.settlement.receiptTotal.centavos) }];
  if (receipts.some((r) => r.state.state === "enter")) return step("receipt", "Check the total against the receipt", "", true);
  for (const r of receipts) {
    if (r.state.state === "more" || r.state.state === "less") return { ...step("receipt", `${r.name} is ${formatPeso(r.state.differenceCentavos)} ${r.state.state} than Salo's total`, "", true), differs: true };
  }

  const paid = paidByKey(input.settlement.payments);
  const owing = kkb.sections.filter(hasShare).map((s) => paymentStatus(s, paid.get(s.key) ?? 0, true).chip).filter((chip) => chip !== null);
  const done = owing.filter((chip) => chip === "paid").length;
  if (done < owing.length) return step("payments", `Record payments · ${done} of ${owing.length} paid`, "", true);
  return FINAL_STEP;
}

/** The KKB row's words: "Next: …" for the host, "Shares so far · waiting on …" for everyone else, "Shares are final" once nothing can move. */
export function stepRowText(s: BillStep, isHost: boolean): string {
  if (s.isFinal) return s.id === "final" ? "Shares are final" : isHost ? `Shares are final · ${s.text}` : "Shares are final";
  return isHost ? (s.canGo ? `Next: ${lowerFirst(s.text)}` : s.text) : `Shares so far · ${s.waiting}`;
}

/** Payments are only prompted in the KKB row (the "Optionally record payments" step stays quiet elsewhere). */
export const withoutPayments = (s: BillStep): BillStep => (s.id === "payments" ? FINAL_STEP : s);

/** For display: a separator never starts a wrapped line and "1 of 3 paid" never splits. */
export const keepDots = (text: string): string => text.replaceAll(" · ", "\u00a0· ").replace(/(\d+) of (\d+) paid/, "$1\u00a0of\u00a0$2\u00a0paid");
