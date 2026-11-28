"use client";

import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useDirectSave, useRetryOnReconnect } from "@/hooks/use-direct-save";
import type { KkbSection } from "@/lib/kkb";
import { formatPeso, MAX_SERVICE_CHARGE_CENTAVOS, parsePeso, toPesoInput } from "@/lib/money";
import type { PaymentStatus } from "@/lib/payments";
import { PAYMENT_METHODS, type PaymentMethod, type PersonRef, type SessionSnapshot } from "@/lib/snapshot";
import { pillOption } from "./price-editor";

export const METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Cash", gcash: "GCash", maya: "Maya", bank: "Bank", other: "Other" };
const RESTAURANT = "restaurant";

interface PaymentSheetProps {
  /** The card being paid toward; null closes the sheet. */
  section: KkbSection | null;
  status: PaymentStatus | null;
  snapshot: SessionSnapshot;
  /** Everyone's card, for the "Paid to" choices. */
  cards: readonly KkbSection[];
  refresh: () => Promise<unknown>;
  onClose: () => void;
}

export function PaymentSheet({ section, ...rest }: PaymentSheetProps) {
  return (
    <Drawer open={section != null} onOpenChange={(open) => !open && rest.onClose()}>
      <DrawerContent>{section ? <Inner key={section.key} section={section} {...rest} /> : null}</DrawerContent>
    </Drawer>
  );
}

export interface Option {
  key: string;
  title: string;
  ref: PersonRef | null;
}

/** Who can receive: the host, other people on the order who have a card, typed names, and the restaurant. Never the payer. */
export function payeeOptions(snapshot: SessionSnapshot, payerKey: string, cards: readonly KkbSection[]): Option[] {
  const hostId = snapshot.me.participantId;
  const people: Option[] = [
    ...snapshot.participants.filter((p) => p.id === hostId || cards.some((c) => c.participantId === p.id)).map((p) => ({ key: `p:${p.id}`, title: p.id === hostId ? `${p.displayName} (you)` : p.displayName, ref: { participantId: p.id, label: null } })),
    ...cards.filter((c) => c.kind === "name").map((c) => ({ key: c.key, title: c.title, ref: { participantId: null, label: c.title } })),
  ];
  return [...people.filter((p) => p.key !== payerKey), { key: RESTAURANT, title: "Restaurant", ref: null }];
}

function Inner({ section, status, snapshot, cards, refresh, onClose }: PaymentSheetProps & { section: KkbSection }) {
  const id = useId();
  // Minted when the drawer opens and kept until saved, so a retry (or a double tap) records once.
  const [paymentId] = useState(() => crypto.randomUUID());
  const { state, save } = useDirectSave(refresh);
  const options = useMemo(() => payeeOptions(snapshot, section.key, cards), [snapshot, section.key, cards]);
  const hostKey = `p:${snapshot.me.participantId}`;
  const [payee, setPayee] = useState(section.key === hostKey ? RESTAURANT : hostKey);
  const left = status && status.left > 0 ? status.left : 0;
  const [amountText, setAmountText] = useState(left > 0 ? toPesoInput(left) : "");
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [note, setNote] = useState("");
  const amount = parsePeso(amountText, MAX_SERVICE_CHARGE_CENTAVOS);
  const centavos = amount.ok && amount.centavos ? amount.centavos : null;
  const saving = state.kind === "saving";
  const chosen = options.find((o) => o.key === payee) ?? options[options.length - 1];
  const submit = async () => {
    if (centavos == null) return;
    const body = { payer: section.participantId ? { participantId: section.participantId } : { label: section.title }, payee: chosen.ref?.participantId ? { participantId: chosen.ref.participantId } : chosen.ref ? { label: chosen.ref.label } : null, amountCentavos: centavos, method, note: note.trim() || null };
    if (await save(`/api/sessions/${snapshot.session.id}/payments/${paymentId}`, "PUT", body)) onClose();
  };
  useRetryOnReconnect(state.kind === "error" && state.retryable, () => void submit());
  const subline = !status || status.obligation === 0 ? "No prices yet" : left > 0 ? `${formatPeso(left)} left of ${formatPeso(status.obligation)}${status.final ? "" : " so far"}` : "Nothing left to pay";

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
          <DrawerTitle className="font-display text-2xl font-medium break-words">Record payment from {section.title}</DrawerTitle>
          <DrawerDescription className="mt-0.5 text-sm text-ink-soft">{subline}</DrawerDescription>
        </div>
        <DrawerClose aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
          <X className="size-5" aria-hidden />
        </DrawerClose>
      </div>

      <label className="mt-3 block text-sm font-semibold">
        Amount (₱)
        <input
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          placeholder="e.g. 500"
          aria-invalid={!amount.ok || undefined}
          aria-describedby={!amount.ok ? `${id}-amount` : undefined}
          className="tally mt-1 block min-h-11 w-full min-w-0 rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base font-normal aria-invalid:border-bad"
        />
      </label>
      {!amount.ok ? (
        <p id={`${id}-amount`} className="mt-1 text-sm text-bad">
          {amount.message}
        </p>
      ) : null}

      <fieldset className="mt-3">
        <legend className="text-sm font-semibold">Paid to</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {options.map((o) => (
            <label key={o.key} className={pillOption}>
              <input type="radio" name={`${id}-to`} value={o.key} checked={chosen.key === o.key} onChange={() => setPayee(o.key)} className="sr-only" />
              {o.title}
            </label>
          ))}
        </div>
      </fieldset>

      <div role="group" aria-labelledby={`${id}-method`} className="mt-3">
        <p id={`${id}-method`} className="text-sm font-semibold">
          Method <span className="font-normal text-ink-soft">optional</span>
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={method === m}
              onClick={() => setMethod(method === m ? null : m)}
              className="min-h-11 cursor-pointer rounded-full border-[1.5px] border-input bg-ticket px-3.5 text-sm font-semibold aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-3 block text-sm font-semibold">
        Note <span className="font-normal text-ink-soft">optional</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={40} autoComplete="off" placeholder="e.g. for drinks" className="mt-1 block min-h-11 w-full min-w-0 rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base font-normal" />
      </label>

      <div className="mt-4">
        <Button type="submit" disabled={saving || centavos == null} className="w-full">
          {saving ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
          {saving ? "Saving…" : centavos != null ? `Record ${formatPeso(centavos)}` : "Record payment"}
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
          {state.kind === "conflict" ? <p className="mt-2 text-sm text-ink">That payment was already recorded with different details.</p> : null}
        </div>
      </div>
    </form>
  );
}
