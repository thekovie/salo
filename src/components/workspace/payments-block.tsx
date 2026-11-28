"use client";

import { CircleAlert, Trash2 } from "lucide-react";
import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError, newKey } from "@/lib/api-client";
import { formatPeso } from "@/lib/money";
import type { PaymentStatus, PaymentTotals } from "@/lib/payments";
import { everyone, type PersonRef, type SessionSnapshot, type SnapshotPayment } from "@/lib/snapshot";
import { ConfirmDialog } from "./confirm-dialog";
import { METHOD_LABEL } from "./payment-sheet";

export function nameOf(ref: PersonRef | null, snapshot: SessionSnapshot): string {
  if (!ref) return "Restaurant";
  return ref.participantId ? (everyone(snapshot).find((p) => p.id === ref.participantId)?.displayName ?? "Someone") : (ref.label ?? "Someone");
}

/** "GCash · to Ana · for drinks" after the amount; `from` names the payer instead (payments not matched to a share). */
function lineText(p: SnapshotPayment, snapshot: SessionSnapshot, from: boolean): string {
  return [p.method ? METHOD_LABEL[p.method] : null, from ? `from ${nameOf(p.payer, snapshot)}` : `to ${nameOf(p.payee, snapshot)}`, p.note].filter(Boolean).join(" · ");
}

interface LineProps {
  payment: SnapshotPayment;
  snapshot: SessionSnapshot;
  from: boolean;
  canDelete: boolean;
  /** The host's "Fix" for a payment that needs review; null for everyone else. */
  onFix: ((id: string) => void) | null;
  refresh: () => Promise<unknown>;
}

function PaymentLine({ payment, snapshot, from, canDelete, onFix, refresh }: LineProps) {
  const amount = formatPeso(payment.amountCentavos);
  const who = nameOf(payment.payer, snapshot);
  // One key per dialog, so a retry after a lost answer replays instead of failing on a payment that is already gone.
  const key = useRef(newKey());
  return (
    <li className="flex items-center gap-2">
      <span className="min-w-0 flex-1 break-words text-sm text-ink-soft">
        <span className="tally text-ink">{amount}</span> · {lineText(payment, snapshot, from)}
        {payment.needsReview ? (
          <span className="mt-1 flex w-fit items-center gap-1 rounded-full bg-saffron-wash px-2 py-0.5 text-xs font-semibold text-saffron-ink">
            <CircleAlert className="size-3.5" aria-hidden />
            Needs review
          </span>
        ) : null}
      </span>
      {onFix && payment.needsReview ? (
        <Button variant="outline" onClick={() => onFix(payment.id)} aria-label={`Fix ${amount} payment from ${who}`} className="-my-2.5 shrink-0">
          Fix
        </Button>
      ) : null}
      {canDelete ? (
        <ConfirmDialog
          danger
          title={`Delete ${amount} payment from ${who}?`}
          body={<p>{payment.needsReview ? "It was not counted in what they have paid." : "It comes off what they have paid. You can record it again."}</p>}
          confirmLabel="Delete"
          dismissLabel="Keep"
          busyLabel="Deleting…"
          onConfirm={async () => {
            try {
              await api(`/api/sessions/${snapshot.session.id}/payments/${payment.id}`, { method: "DELETE", idempotencyKey: key.current });
              await refresh().catch(() => undefined);
              return null;
            } catch (error) {
              if (error instanceof ApiError) return error.isNetwork ? "You're offline. Try again when you're back." : error.message;
              return "Something went wrong. Try again.";
            }
          }}
          trigger={(open) => (
            <Button variant="ghost" size="icon" onClick={open} aria-label={`Delete ${amount} payment from ${who}`} className="-my-2.5 shrink-0">
              <Trash2 className="size-5" aria-hidden />
            </Button>
          )}
        />
      ) : null}
    </li>
  );
}

interface CardRowsProps {
  status: PaymentStatus | null;
  payments: SnapshotPayment[];
  snapshot: SessionSnapshot;
  isHost: boolean;
  refresh: () => Promise<unknown>;
  onFix: ((id: string) => void) | null;
  /** The host's "Record payment" for a card with a share. */
  onRecord: (() => void) | null;
  /** Show the balance: the order has at least one payment. */
  showBalance: boolean;
}

/** Paid, each payment, and what is left, at the end of a person's card; the host's Record payment closes it. */
export function CardPaymentRows({ status, payments, snapshot, isHost, refresh, onRecord, onFix, showBalance }: CardRowsProps) {
  const balance = showBalance && status?.chip != null;
  if (payments.length === 0 && !balance && !onRecord) return null;
  const left = !status ? 0 : status.final && status.overpaid > 0 ? status.overpaid : Math.max(0, status.left);
  const leftLabel = !status ? "" : status.final ? (status.overpaid > 0 ? "Overpaid" : "Left to pay") : "Left to pay so far";
  return (
    <div className="mt-1 space-y-0.5">
      {payments.length > 0 && status ? (
        <>
          <p className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-ink-soft">Paid</span>
            <span className="tally text-ink">{formatPeso(status.paid)}</span>
          </p>
          <ul className="space-y-1.5">
            {payments.map((p) => (
              <PaymentLine key={p.id} payment={p} snapshot={snapshot} from={false} canDelete={isHost} onFix={onFix} refresh={refresh} />
            ))}
          </ul>
        </>
      ) : null}
      {balance ? (
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-ink-soft">{leftLabel}</span>
          <span className="tally text-ink">{formatPeso(left)}</span>
        </p>
      ) : null}
      {onRecord ? (
        <Button variant="outline" className="mt-2 w-full" onClick={onRecord} data-record-payment="">
          Record payment
        </Button>
      ) : null}
    </div>
  );
}

/** Table-wide payments: shown once something is recorded, to everyone. Payments with no matching card are listed so they can still be deleted. */
export function PaymentsBlock({ totals, snapshot, isHost, onFix, refresh }: { totals: PaymentTotals; snapshot: SessionSnapshot; isHost: boolean; onFix: ((id: string) => void) | null; refresh: () => Promise<unknown> }) {
  const id = useId();
  if (snapshot.settlement.payments.length === 0) return null;
  return (
    <section aria-labelledby={`${id}-title`} id="kkb-payments" tabIndex={-1} className="scroll-mt-4 rounded-2xl bg-paper p-4 focus:outline-2 focus:outline-offset-2 focus:outline-ink">
      <h3 id={`${id}-title`} className="text-lg">
        Payments
      </h3>
      <dl className="mt-1 space-y-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-ink-soft">Collected</dt>
          <dd className="tally text-ink">
            {formatPeso(totals.collected)}
            {totals.of > 0 ? (
              <>
                {" "}
                <span className="font-sans text-sm text-ink-soft">of</span> {formatPeso(totals.of)}
              </>
            ) : null}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-ink-soft">{totals.final ? "Left to pay" : "Left to pay so far"}</dt>
          <dd className="tally text-ink">{formatPeso(totals.left)}</dd>
        </div>
      </dl>
      {totals.orphans.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-sm font-semibold">Not matched to a share</h4>
          <ul className="space-y-1.5">
            {totals.orphans.map((p) => (
              <PaymentLine key={p.id} payment={p} snapshot={snapshot} from canDelete={isHost} onFix={onFix} refresh={refresh} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
