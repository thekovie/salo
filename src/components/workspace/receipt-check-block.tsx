"use client";

import { useId } from "react";
import { hasPending, reconcile, saloTotal, type Kkb } from "@/lib/kkb";
import { formatPeso } from "@/lib/money";
import type { SettlementView } from "@/lib/snapshot";
import { cn } from "@/lib/utils";
import { AmountEditor } from "./amount-editor";

interface ReceiptCheckBlockProps {
  kkb: Kkb;
  live: SettlementView["receiptTotal"];
  sessionId: string;
  refresh: () => Promise<unknown>;
  /** Host, order still open. */
  canEdit: boolean;
}

const dishes = (n: number) => `${n} ${n === 1 ? "dish has" : "dishes have"}`;

/** The one line under the rows: how Salo's total sits against the receipt. Only a comparison, nothing is split. */
function differenceText(kkb: Kkb, receipt: number): string {
  const r = reconcile(kkb, receipt);
  if (r.state === "incomplete") return `${dishes(r.unpriced)} no price yet${hasPending(kkb) ? " and a change is waiting for the waiter" : ""}, so this can't match.`;
  if (r.state === "pending") return "A change is still waiting for the waiter, so this may not match yet.";
  if (r.state === "matches") return "Matches the receipt.";
  const advice =
    r.state === "more"
      ? `Check the receipt for items missing in Salo.${kkb.charge.state === "unset" ? " The service charge isn't entered yet; it may be part of this." : ""}`
      : "Check for dishes missing from the receipt, or prices typed too high.";
  return `${formatPeso(r.differenceCentavos)} ${r.state} on the receipt. Not split. ${advice}`;
}

/** KKB's "Check against the receipt": everyone sees it; only the host types the receipt total. */
export function ReceiptCheckBlock({ kkb, live, sessionId, refresh, canEdit }: ReceiptCheckBlockProps) {
  const id = useId();
  const { charge } = kkb;
  const row = (label: string, value: React.ReactNode, strong = false) => (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "border-t-[1.5px] border-dashed border-rule pt-1")}>
      <dt className={strong ? "font-semibold" : "text-sm text-ink-soft"}>{label}</dt>
      <dd className="tally text-ink">{value}</dd>
    </div>
  );

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl bg-paper p-4" id="kkb-receipt">
      <h3 id={`${id}-title`} className="text-lg">
        Check against the receipt
      </h3>
      <dl className="mt-2 space-y-0.5">
        {row("Food in Salo", formatPeso(kkb.foodCentavos))}
        {row("Service charge", charge.state === "unset" ? <span className="font-sans text-sm text-ink-soft">not entered</span> : charge.state === "none" ? formatPeso(0) : formatPeso(charge.centavos))}
        {row("Salo total", formatPeso(saloTotal(kkb)), true)}
        {canEdit ? null : row("Receipt total", live.centavos == null ? <span className="font-sans text-sm text-ink-soft">not entered</span> : formatPeso(live.centavos))}
      </dl>
      {canEdit ? <AmountEditor label="Receipt total (₱)" hint="The total printed on the receipt. Blank = not entered yet." path={`/api/sessions/${sessionId}/receipt-total`} live={live} refresh={refresh} /> : null}
      <p role="status" className="mt-2 text-sm text-ink">
        {live.centavos == null ? (canEdit ? "Enter the receipt total to compare it with Salo's." : "The host adds the receipt total to compare.") : differenceText(kkb, live.centavos)}
      </p>
    </section>
  );
}
