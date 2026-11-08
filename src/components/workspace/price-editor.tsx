"use client";

import { LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDirectSave } from "@/hooks/use-direct-save";
import type { KkbLine } from "@/lib/kkb";
import { formatPeso, parsePeso, toPesoInput } from "@/lib/money";
import type { EntrySettlement } from "@/lib/snapshot";

/** Someone the host can bill a shared dish to: a joined person or a name typed for someone without a phone. */
export interface Payer {
  key: string;
  title: string;
  participantId: string | null;
  label: string | null;
}

interface PriceEditorProps {
  line: KkbLine;
  sessionId: string;
  refresh: () => Promise<unknown>;
  canPrice: boolean;
  canBillTo: boolean;
  payers: Payer[];
  /** What the server has now (updates live while the editor is open). */
  live: Pick<EntrySettlement, "unitCentavos" | "billTo" | "revision">;
  onDone: (saved: boolean) => void;
}

const NOBODY = "none";
const billKeyOf = (billTo: EntrySettlement["billTo"]) => (billTo?.participantId ? `p:${billTo.participantId}` : billTo?.label ? `n:${billTo.label.toLowerCase()}` : NOBODY);

/**
 * Inline price (and, for the host on shared dishes, "Bill to") editor on one KKB line. Saves straight to the server so
 * a refusal or someone else's change shows right here, next to the amount the person typed, which is kept.
 */
export function PriceEditor({ line, sessionId, refresh, canPrice, canBillTo, payers, live, onDone }: PriceEditorProps) {
  const id = useId();
  const { state, save } = useDirectSave(refresh);
  const [base, setBase] = useState(live);
  const [text, setText] = useState(toPesoInput(live.unitCentavos));
  const [billKey, setBillKey] = useState(billKeyOf(live.billTo));
  const [error, setError] = useState("");
  const parsed = parsePeso(text);
  const changedElsewhere = live.revision !== base.revision;

  function adoptLatest() {
    setBase(live);
    setText(toPesoInput(live.unitCentavos));
    setBillKey(billKeyOf(live.billTo));
  }

  async function submit(event: React.FormEvent, clear = false) {
    event.preventDefault();
    const next = clear ? ({ ok: true, centavos: null } as const) : parsed;
    if (!next.ok) return setError(next.message);
    setError("");
    const payer = payers.find((p) => p.key === billKey);
    const priceChanged = canPrice && next.centavos !== base.unitCentavos;
    const billChanged = canBillTo && billKey !== billKeyOf(base.billTo);
    if (!priceChanged && !billChanged) return onDone(false);
    const path = line.correctionId ? `/api/sessions/${sessionId}/corrections/${line.correctionId}/price` : `/api/sessions/${sessionId}/entries/${line.entryId}/settlement`;
    const body = line.correctionId
      ? { expectedRevision: base.revision, unitPriceCentavos: next.centavos }
      : {
          expectedRevision: base.revision,
          ...(priceChanged ? { unitPriceCentavos: next.centavos } : {}),
          ...(billChanged ? { billTo: payer ? (payer.participantId ? { participantId: payer.participantId } : { label: payer.label }) : null } : {}),
        };
    if (await save(path, "PUT", body)) onDone(true);
  }

  const saving = state.kind === "saving";
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="ease-in-panel mt-2 space-y-2 rounded-2xl bg-paper p-3" aria-label={`Price for ${line.label}`}>
      {changedElsewhere ? (
        <div role="alert" className="rounded-xl bg-saffron-wash px-3 py-2 text-sm text-ink">
          <p>
            Someone changed this just now to <span className="tally font-semibold">{live.unitCentavos == null ? "no price" : formatPeso(live.unitCentavos)}</span>. Your
            amount is still here.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <Button size="md" variant="outline" onClick={adoptLatest}>
              Use theirs
            </Button>
            <Button size="md" variant="ghost" onClick={() => setBase(live)}>
              Keep mine
            </Button>
          </div>
        </div>
      ) : null}

      {canPrice ? (
        <div>
          <label htmlFor={`${id}-price`} className="text-sm font-semibold">
            Price each (₱)
          </label>
          <input
            id={`${id}-price`}
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError("");
            }}
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="e.g. 120"
            aria-invalid={Boolean(error) || !parsed.ok || undefined}
            aria-describedby={`${id}-line`}
            className="tally mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base aria-invalid:border-bad"
          />
          <p id={`${id}-line`} aria-live="polite" className="mt-1 min-h-5 text-sm text-ink-soft">
            {!parsed.ok ? (
              <span className="text-bad">{parsed.message}</span>
            ) : parsed.centavos != null && line.quantity > 1 ? (
              <span className="tally">
                {formatPeso(parsed.centavos)} × {line.quantity} = {formatPeso(parsed.centavos * line.quantity)}
              </span>
            ) : parsed.centavos == null ? (
              "Blank means not known yet."
            ) : null}
          </p>
        </div>
      ) : null}

      {canBillTo ? (
        <fieldset>
          <legend className="text-sm font-semibold">Bill to</legend>
          <p className="text-sm text-ink-soft">The whole dish goes to one person. Leave it on No one yet if the table hasn&rsquo;t decided.</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[{ key: NOBODY, title: "No one yet" }, ...payers].map((p) => (
              <label key={p.key} className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-[1.5px] border-input bg-ticket px-3.5 text-sm font-semibold has-checked:border-ink has-checked:bg-ink has-checked:text-paper has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink">
                <input type="radio" name={`${id}-bill`} value={p.key} checked={billKey === p.key} onChange={() => setBillKey(p.key)} className="sr-only" />
                {p.title}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
          {saving ? "Saving…" : "Save"}
        </Button>
        {canPrice && base.unitCentavos != null ? (
          <Button variant="ghost" disabled={saving} onClick={(e) => void submit(e, true)}>
            Clear price
          </Button>
        ) : null}
        <Button variant="ghost" disabled={saving} onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
      {state.kind === "conflict" && !changedElsewhere ? (
        <p role="alert" className="rounded-xl bg-saffron-wash px-3 py-2 text-sm text-ink">
          Someone changed this just now. Loading the latest amount; your amount is still here.
        </p>
      ) : null}
      {error || state.kind === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-bad-wash px-3 py-2 text-sm text-bad">
          <span className="flex-1">{error || (state.kind === "error" ? `Not saved. ${state.message}` : "")}</span>
          {state.kind === "error" && state.retryable && !error ? (
            <button type="submit" className="min-h-11 cursor-pointer rounded-full border-[1.5px] border-bad px-3 font-semibold hover:bg-bad/10">
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
