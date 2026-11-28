"use client";

import { CircleAlert, CircleCheck, Pencil, Plus } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { hasPending, reconcile, saloTotal, type Kkb, type Reconciliation } from "@/lib/kkb";
import { formatPeso } from "@/lib/money";
import { MAX_EXTRA_RECEIPTS, reconcileReceipts, type ReceiptCard, type ReceiptState } from "@/lib/receipts";
import type { SessionSnapshot, SettlementView } from "@/lib/snapshot";
import { cn } from "@/lib/utils";
import { AmountEditor } from "./amount-editor";
import { ReceiptSheet } from "./receipt-sheet";

interface ReceiptCheckBlockProps {
  kkb: Kkb;
  live: SettlementView["receiptTotal"];
  sessionId: string;
  refresh: () => Promise<unknown>;
  /** Host. */
  canEdit: boolean;
  snapshot: SessionSnapshot;
}

const dishes = (n: number) => `${n} ${n === 1 ? "dish has" : "dishes have"}`;

interface Difference {
  ok: boolean;
  /** First line: the amount sentence; second line: what to do. */
  lines: string[];
}

/** How Salo's total sits against the receipt (`where`: "the receipt", or "this receipt" with several). Only a comparison, nothing is split. */
function difference(kkb: Kkb, r: Reconciliation, where = "the receipt"): Difference {
  if (r.state === "incomplete") return { ok: false, lines: [`${dishes(r.unpriced)} no price yet${hasPending(kkb) ? " and a change is waiting for the waiter" : ""}, so this can't match.`] };
  if (r.state === "pending") return { ok: false, lines: ["A change is still waiting for the waiter, so this may not match yet."] };
  if (r.state === "waiting") return { ok: false, lines: ["A shared dish has no payer yet, so discounts and extras aren’t counted. This may not match yet."] };
  if (r.state === "matches") return { ok: true, lines: ["Matches the receipt."] };
  const advice =
    r.state === "more"
      ? `Check the receipt for items missing in Salo.${kkb.charge.state === "unset" ? " The service charge isn't entered yet; it may be part of this." : ""}`
      : "Check for dishes missing from the receipt, or prices typed too high.";
  return { ok: false, lines: [`${formatPeso(r.differenceCentavos)} ${r.state} on ${where}. Not split.`, advice] };
}

function DifferenceChip({ kkb, state, where }: { kkb: Kkb; state: Reconciliation; where?: string }) {
  const { ok, lines } = difference(kkb, state, where);
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <div role="status" className={cn("flex items-start gap-2 rounded-2xl px-3 py-2.5 text-sm text-ink", ok ? "bg-ok-wash" : "bg-saffron-wash")}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", ok && "text-ok")} aria-hidden />
      <p>
        {lines.map((l, i) => (
          <span key={i} className={cn("block", i === 0 && "font-semibold")}>
            {l}
          </span>
        ))}
      </p>
    </div>
  );
}

/** KKB's "Check against the receipt": everyone sees it; only the host types the receipt total. */
export function ReceiptCheckBlock({ kkb, live, sessionId, refresh, canEdit, snapshot }: ReceiptCheckBlockProps) {
  const id = useId();
  const { charge } = kkb;
  const adjusted = kkb.adjustments.length > 0;
  const anyWaiting = kkb.adjustments.some((a) => a.state === "waiting");
  const net = kkb.adjustedTotal - saloTotal(kkb);
  const view = reconcileReceipts(kkb, snapshot.settlement, snapshot);
  const [sheet, setSheet] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const chip = live.centavos == null ? null : <DifferenceChip kkb={kkb} state={reconcile(kkb, live.centavos)} />;
  const row = (label: string, value: React.ReactNode, strong = false) => (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "border-t-[1.5px] border-dashed border-rule pt-1")}>
      <dt className={strong ? "font-semibold" : "text-sm text-ink-soft"}>{label}</dt>
      <dd className="tally text-ink">{value}</dd>
    </div>
  );

  return (
    <section aria-labelledby={`${id}-title`} id="kkb-receipt" tabIndex={-1} className="scroll-mt-4 rounded-2xl bg-paper p-4 focus:outline-2 focus:outline-offset-2 focus:outline-ink">
      <h3 id={`${id}-title`} className="text-lg">
        Check against the receipt
      </h3>
      <dl className="mt-2 space-y-0.5">
        {row("Food in Salo", formatPeso(kkb.foodCentavos))}
        {row("Service charge", charge.state === "unset" ? <span className="font-sans text-sm text-ink-soft">not entered</span> : charge.state === "none" ? formatPeso(0) : formatPeso(charge.centavos))}
        {row("Salo total", formatPeso(saloTotal(kkb)), true)}
        {adjusted ? row("Discounts and extras", anyWaiting ? <span className="font-sans text-sm text-ink-soft">waiting for prices</span> : `${net < 0 ? "−" : net > 0 ? "+" : ""}${formatPeso(Math.abs(net))}`) : null}
        {adjusted && !anyWaiting ? row("Adjusted total", formatPeso(kkb.adjustedTotal), true) : null}
        {canEdit || view ? null : row("Receipt total", live.centavos == null ? <span className="font-sans text-sm text-ink-soft">not entered</span> : formatPeso(live.centavos))}
      </dl>
      {view ? (
        <ReceiptCards view={view} kkb={kkb} canEdit={canEdit} live={live} sessionId={sessionId} refresh={refresh} onEdit={(rid) => setSheet({ open: true, id: rid })} />
      ) : (
        <>
        {canEdit ? (
          <AmountEditor label="Receipt total (₱)" hint="The total printed on the receipt. Blank = not entered yet." path={`/api/sessions/${sessionId}/receipt-total`} live={live} refresh={refresh}>
            {chip}
          </AmountEditor>
        ) : (
          <div className="mt-2">{chip}</div>
        )}
        {live.centavos == null ? <p role="status" className="mt-2 text-sm text-ink">{canEdit ? "Enter the receipt total to compare it with Salo's." : "The host adds the receipt total to compare."}</p> : null}
        </>
      )}
      {canEdit && snapshot.settlement.receipts.length < MAX_EXTRA_RECEIPTS ? (
        <Button variant="outline" className="mt-2" onClick={() => setSheet({ open: true, id: null })}>
          <Plus className="size-5" aria-hidden />
          Add another receipt
        </Button>
      ) : null}
      {canEdit ? <ReceiptSheet key={sheet.id ?? "new"} open={sheet.open} onOpenChange={(o) => setSheet((v) => ({ ...v, open: o }))} existing={snapshot.settlement.receipts.find((r) => r.id === sheet.id) ?? null} snapshot={snapshot} refresh={refresh} /> : null}
    </section>
  );
}

type View = NonNullable<ReturnType<typeof reconcileReceipts>>;

const GATES: ReceiptState["state"][] = ["incomplete", "pending", "waiting"];

/** With extra receipts: one card per receipt, Main first, each against what Salo expects for the people on it. */
function ReceiptCards({ view, kkb, canEdit, live, sessionId, refresh, onEdit }: { view: View; kkb: Kkb; canEdit: boolean; live: SettlementView["receiptTotal"]; sessionId: string; refresh: () => Promise<unknown>; onEdit: (id: string) => void }) {
  const gate = view.cards[0].state;
  const blocked = GATES.includes(gate.state);
  const enterCopy = (c: ReceiptCard) => (c.id !== null ? (canEdit ? "Tap the pencil to enter this receipt's total." : "The host adds this receipt's total.") : canEdit ? "Enter the receipt total to compare it with Salo's." : "The host adds the receipt total to compare.");
  const status = (c: ReceiptCard) => (blocked || c.state.state === "empty" ? null : c.state.state === "enter" ? <p role="status" className="text-sm text-ink">{enterCopy(c)}</p> : <DifferenceChip kkb={kkb} state={c.state} where="this receipt" />);
  return (
    <div className="mt-2 space-y-2">
      {view.cards.map((c) => (
        <section key={c.id ?? "main"} aria-label={c.label} className="rounded-2xl bg-ticket p-3">
          <div className="flex items-start justify-between gap-2">
            <h4 className="min-w-0 break-words font-semibold">{c.label}</h4>
            {c.id && canEdit ? (
              <button type="button" onClick={() => onEdit(c.id!)} aria-label={`Edit ${c.label}`} className="-my-2.5 -mr-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
                <Pencil className="size-4 text-ink-soft" aria-hidden />
              </button>
            ) : null}
          </div>
          <p className="break-words text-sm text-ink-soft">
            {c.state.state === "empty" ? (canEdit ? "Covers nobody yet. Tap the pencil to pick who." : "Covers nobody yet.") : (
              <>
                {c.covers} · <span className="whitespace-nowrap">Salo <span className="tally text-ink">{formatPeso(c.expectedCentavos)}</span></span>
              </>
            )}
          </p>
          {c.adjustments.map((a) => (
            <p key={a} className="text-sm text-ink-soft">
              {a}
            </p>
          ))}
          {c.unassigned.map((u) => (
            <p key={u.label} className="flex items-baseline justify-between gap-3 text-sm">
              <span>Not assigned: {u.label}</span>
              <span className="tally">
                {u.centavos < 0 ? "−" : "+"}
                {formatPeso(Math.abs(u.centavos))}
              </span>
            </p>
          ))}
          {c.flags.map((f) => (
            <p key={f} className="flex items-start gap-1 text-sm text-bad">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {f}
            </p>
          ))}
          {c.id === null && canEdit ? (
            <AmountEditor label="Receipt total (₱)" hint="The total printed on the receipt. Blank = not entered yet." path={`/api/sessions/${sessionId}/receipt-total`} live={live} refresh={refresh}>
              {status(c)}
            </AmountEditor>
          ) : (
            <p className="mt-1 flex items-baseline justify-between gap-3 text-sm">
              <span>Receipt total</span>
              <span className="tally">{c.totalCentavos == null ? <span className="font-sans text-ink-soft">not entered</span> : formatPeso(c.totalCentavos)}</span>
            </p>
          )}
          {(c.id === null && canEdit) || blocked || c.state.state === "empty" ? null : <div className="mt-2">{status(c)}</div>}
        </section>
      ))}
      {blocked ? <DifferenceChip kkb={kkb} state={gate as Reconciliation} /> : null}
      {view.overall ? (
        <p role="status" className="flex items-start gap-2 text-sm">
          {view.overall.matches ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span>
            <span className="whitespace-nowrap">All receipts <span className="tally">{formatPeso(view.overall.receiptsCentavos)}</span></span> · <span className="whitespace-nowrap">Salo <span className="tally">{formatPeso(view.overall.saloCentavos)}</span></span>
            {view.overall.matches ? <span className="sr-only"> matches</span> : null}
          </span>
        </p>
      ) : null}
    </div>
  );
}
