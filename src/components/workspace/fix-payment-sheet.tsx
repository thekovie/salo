"use client";

import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useDirectSave, useRetryOnReconnect } from "@/hooks/use-direct-save";
import type { KkbSection } from "@/lib/kkb";
import { formatPeso } from "@/lib/money";
import { personKey } from "@/lib/adjustments";
import type { SessionSnapshot, SnapshotPayment } from "@/lib/snapshot";
import { payeeOptions } from "./payment-sheet";
import { nameOf } from "./payments-block";
import { pillOption } from "./price-editor";

interface Props {
  /** The payment being fixed; null closes the drawer. */
  payment: SnapshotPayment | null;
  snapshot: SessionSnapshot;
  cards: readonly KkbSection[];
  refresh: () => Promise<unknown>;
  onClose: () => void;
}

/** The payee-only form for a payment that needs review: no pill is chosen until the host picks one. */
export function FixPaymentSheet({ payment, ...rest }: Props) {
  return (
    <Drawer open={payment != null} onOpenChange={(open) => !open && rest.onClose()}>
      <DrawerContent>{payment ? <Inner key={payment.id} payment={payment} {...rest} /> : null}</DrawerContent>
    </Drawer>
  );
}

function Inner({ payment, snapshot, cards, refresh, onClose }: Props & { payment: SnapshotPayment }) {
  const id = useId();
  const { state, save } = useDirectSave(refresh);
  const options = useMemo(() => payeeOptions(snapshot, personKey(payment.payer), cards), [snapshot, payment.payer, cards]);
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = options.find((o) => o.key === picked);
  const saving = state.kind === "saving";
  const submit = async () => {
    if (!chosen) return;
    const payee = chosen.ref?.participantId ? { participantId: chosen.ref.participantId } : chosen.ref ? { label: chosen.ref.label } : null;
    if (await save(`/api/sessions/${snapshot.session.id}/payments/${payment.id}`, "PATCH", { payee })) onClose();
  };
  useRetryOnReconnect(state.kind === "error" && state.retryable, () => void submit());

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
      aria-busy={saving}
      data-ph-mask=""
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <DrawerTitle className="font-display text-2xl font-medium break-words">Fix payment</DrawerTitle>
          <DrawerDescription className="mt-0.5 text-sm text-ink-soft">
            Who received {formatPeso(payment.amountCentavos)} from {nameOf(payment.payer, snapshot)}?
          </DrawerDescription>
        </div>
        <DrawerClose aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
          <X className="size-5" aria-hidden />
        </DrawerClose>
      </div>

      <fieldset className="mt-3">
        <legend className="text-sm font-semibold">Paid to</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {options.map((o) => (
            <label key={o.key} className={pillOption}>
              <input type="radio" name={`${id}-to`} value={o.key} checked={picked === o.key} onChange={() => setPicked(o.key)} className="sr-only" />
              {o.title}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <Button type="submit" disabled={saving || !chosen} className="w-full">
          {saving ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
          {saving ? "Saving…" : "Save"}
        </Button>
        <div role="status" aria-live="polite">
          {state.kind === "error" ? (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-bad">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              <span>{state.retryable ? "Not saved ·" : state.message}</span>
              {state.retryable ? (
                <button type="button" onClick={() => void submit()} className="min-h-11 cursor-pointer font-semibold underline underline-offset-2">
                  Try again
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
