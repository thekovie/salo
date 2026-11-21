"use client";

import { LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDirectSave } from "@/hooks/use-direct-save";
import { formatPeso, MAX_SERVICE_CHARGE_CENTAVOS, parsePeso, toPesoInput } from "@/lib/money";

interface AmountEditorProps {
  /** The field's label, e.g. "Service charge from receipt (₱)". */
  label: string;
  hint: string;
  path: string;
  live: { centavos: number | null; revision: number };
  refresh: () => Promise<unknown>;
  /** Shown between the field row and the hint. */
  children?: React.ReactNode;
}

/**
 * One host-typed receipt amount (service charge, receipt total) saved directly: stale writes show the latest value
 * with Use theirs / Keep mine, and a refusal stays next to what was typed.
 */
export function AmountEditor({ label, hint, path, live, refresh, children }: AmountEditorProps) {
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
    if (await save(path, "PUT", { expectedRevision: base.revision, centavos: next.centavos })) {
      setBase({ centavos: next.centavos, revision: base.revision + 1 });
      if (clear) setText("");
    }
  }

  return (
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
            {label}
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
              className="tally min-h-11 min-w-0 flex-1 basis-24 rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base aria-invalid:border-bad"
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
          {children}
          <p id={`${id}-hint`} className="text-sm text-ink-soft">
            {!parsed.ok ? <span className="text-bad">{parsed.message}</span> : hint}
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
  );
}
