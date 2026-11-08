"use client";

import { LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDirectSave } from "@/hooks/use-direct-save";
import type { Kkb, KkbBlocker } from "@/lib/kkb";
import { formatPeso, MAX_SERVICE_CHARGE_CENTAVOS, parsePeso, toPesoInput } from "@/lib/money";
import type { SettlementView } from "@/lib/snapshot";

interface ServiceChargeBlockProps {
  kkb: Kkb;
  live: SettlementView["serviceCharge"];
  sessionId: string;
  refresh: () => Promise<unknown>;
  /** Host, order still open. */
  canEdit: boolean;
  isHost: boolean;
}

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

/** Why the charge can't be split yet, in words that say what to do about it. */
export function blockerText(b: KkbBlocker, isHost: boolean): string {
  switch (b.kind) {
    case "unpriced":
      return `${items(b.units)} without a price (${b.where.join(", ")}).`;
    case "unbilled":
      return `No one is paying for ${b.dishes.join(", ")} yet. ${isHost ? "Use Bill to on each shared dish." : "The host can choose who pays."}`;
    case "pending":
      return `${b.count === 1 ? "A change is" : `${b.count} changes are`} still waiting to be confirmed with the waiter.`;
    case "zeroFood":
      return "There's no priced food to split the charge across yet.";
  }
}

/**
 * The receipt's one service charge, after everyone's food. Host types it; everyone sees whether it is split yet and,
 * if not, exactly what is holding it up. The receipt stays the final word on what the table owes.
 */
export function ServiceChargeBlock({ kkb, live, sessionId, refresh, canEdit, isHost }: ServiceChargeBlockProps) {
  const id = useId();
  const { state, save } = useDirectSave(refresh);
  const [base, setBase] = useState(live);
  const [text, setText] = useState(toPesoInput(live.centavos));
  const [error, setError] = useState("");
  const parsed = parsePeso(text, MAX_SERVICE_CHARGE_CENTAVOS);
  const changedElsewhere = live.revision !== base.revision;
  const saving = state.kind === "saving";

  function useTheirs() {
    setBase(live);
    setText(toPesoInput(live.centavos));
  }

  async function submit(event: React.FormEvent, clear = false) {
    event.preventDefault();
    const next = clear ? ({ ok: true, centavos: null } as const) : parsed;
    if (!next.ok) return setError(next.message);
    setError("");
    if (next.centavos === base.centavos && !changedElsewhere) return;
    if (await save(`/api/sessions/${sessionId}/service-charge`, "PUT", { expectedRevision: base.revision, centavos: next.centavos })) {
      setBase({ centavos: next.centavos, revision: base.revision + 1 });
      if (clear) setText("");
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl bg-paper p-4" id="kkb-service">
      <h3 id={`${id}-title`} className="text-lg">
        Service charge
      </h3>

      {canEdit ? (
        <form onSubmit={(e) => void submit(e)} noValidate className="mt-2 space-y-2">
          {changedElsewhere ? (
            <div role="alert" className="rounded-xl bg-saffron-wash px-3 py-2 text-sm text-ink">
              <p>
                Changed just now to <span className="tally font-semibold">{live.centavos == null ? "not entered" : formatPeso(live.centavos)}</span>. Your amount is still here.
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Button variant="outline" onClick={useTheirs}>
                  Use theirs
                </Button>
                <Button variant="ghost" onClick={() => setBase(live)}>
                  Keep mine
                </Button>
              </div>
            </div>
          ) : null}
          <label htmlFor={`${id}-amount`} className="text-sm font-semibold">
            Service charge from receipt (₱)
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={`${id}-amount`}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError("");
              }}
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              placeholder="e.g. 300"
              aria-invalid={Boolean(error) || !parsed.ok || undefined}
              aria-describedby={`${id}-hint`}
              className="tally min-h-11 min-w-0 flex-1 basis-40 rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base aria-invalid:border-bad"
            />
            <Button type="submit" variant="outline" disabled={saving}>
              {saving ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
              {saving ? "Saving…" : "Save"}
            </Button>
            {base.centavos != null ? (
              <Button variant="ghost" disabled={saving} onClick={(e) => void submit(e, true)}>
                Clear
              </Button>
            ) : null}
          </div>
          <p id={`${id}-hint`} className="text-sm text-ink-soft">
            {!parsed.ok ? <span className="text-bad">{parsed.message}</span> : "Blank = not entered yet · 0 = the receipt has none."}
          </p>
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
      ) : (
        <p className="mt-1 text-ink-soft">
          {live.centavos == null ? "Not entered yet. The host adds it from the receipt." : live.centavos === 0 ? "None on this receipt." : <span className="tally text-ink">{formatPeso(live.centavos)}</span>}
        </p>
      )}

      {kkb.charge.state === "blocked" ? (
        <div id="kkb-review" className="mt-3 rounded-xl bg-saffron-wash px-3 py-2.5 text-sm text-ink" tabIndex={-1}>
          <p className="font-semibold">Not yet allocated. To split {formatPeso(kkb.charge.centavos)} by food:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {kkb.charge.blockers.map((b) => (
              <li key={b.kind}>{blockerText(b, isHost)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 border-t-[1.5px] border-dashed border-rule pt-3 text-sm text-ink-soft">
        Confirmed food <span className="tally text-ink">{formatPeso(kkb.foodCentavos)}</span>
        {kkb.charge.state === "allocated" || kkb.charge.state === "blocked" ? (
          <>
            {" "}
            · Service charge <span className="tally text-ink">{formatPeso(kkb.charge.centavos)}</span>
          </>
        ) : null}
        . The receipt is the final word.
      </p>
    </section>
  );
}
