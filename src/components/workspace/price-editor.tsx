"use client";

import { LoaderCircle } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDirectSave, useRetryOnReconnect } from "@/hooks/use-direct-save";
import { personKey } from "@/lib/adjustments";
import { normalizeText } from "@/lib/dish-name";
import type { KkbLine } from "@/lib/kkb";
import { formatPeso, parsePeso, toPesoInput } from "@/lib/money";
import type { EntrySettlement } from "@/lib/snapshot";
import { SplitPicker } from "./split-picker";

/** Someone the host can bill a shared dish to: a joined person or a name typed for someone without a phone. */
export interface Payer {
  key: string;
  title: string;
  participantId: string | null;
  label: string | null;
}

/** The table price this line could set or follow (host only): one dish + size. */
export interface TablePrice {
  dishId: string;
  variant: string | null;
  /** "Chicken Katsu (Large)" */
  label: string;
  /** Lines that will follow it: no price of their own, across all rounds. */
  lines: number;
  live: { unitCentavos: number | null; revision: number };
}

interface PriceEditorProps {
  line: KkbLine;
  sessionId: string;
  refresh: () => Promise<unknown>;
  canPrice: boolean;
  canBillTo: boolean;
  payers: Payer[];
  /** Set for the host on a dish line; lets "Every … here" set the table price. */
  table: TablePrice | null;
  /** What the server has now (updates live while the editor is open). */
  live: Pick<EntrySettlement, "unitCentavos" | "revision">;
  /** Who pays, from the entry (a replacement's price has its own revision, so this is separate). */
  bill: Pick<EntrySettlement, "billTo" | "splitAmong" | "revision">;
  /** People already in this dish's split who have since left: still listed, ticked, so the host can untick them. */
  leftPayers: Payer[];
  onDone: (saved: boolean) => void;
}

const NOBODY = "none";
const SPLIT = "split";
const billKeyOf = (b: Pick<EntrySettlement, "billTo" | "splitAmong">) => (b.splitAmong?.length ? SPLIT : b.billTo?.participantId ? `p:${b.billTo.participantId}` : b.billTo?.label ? `n:${normalizeText(b.billTo.label)}` : NOBODY);
const splitKeysOf = (b: Pick<EntrySettlement, "splitAmong">) => (b.splitAmong ?? []).map(personKey);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));

/**
 * Inline price (and, for the host on shared dishes, "Bill to") editor on one KKB line. Saves straight to the server so
 * a refusal or someone else's change shows right here, next to the amount the person typed, which is kept.
 */
export function PriceEditor({ line, sessionId, refresh, canPrice, canBillTo, payers, table, live, bill, leftPayers, onDone }: PriceEditorProps) {
  const id = useId();
  const { state, save } = useDirectSave(refresh);
  const lastClear = useRef(false);
  useRetryOnReconnect(state.kind === "error" && state.retryable, () => void submit(undefined, lastClear.current));
  const [base, setBase] = useState(live);
  const [baseTable, setBaseTable] = useState(table?.live ?? null);
  const [every, setEvery] = useState(line.priceSource !== "line"); // a line with its own price opens on "Only this line"
  const [text, setText] = useState(toPesoInput(line.unitCentavos));
  const [billBase, setBillBase] = useState(bill);
  const [billKey, setBillKey] = useState(billKeyOf(bill));
  const [splitKeys, setSplitKeys] = useState(splitKeysOf(bill));
  const [error, setError] = useState("");
  const parsed = parsePeso(text);
  const everyMode = Boolean(table && baseTable) && every;
  const theirs = everyMode ? table!.live : live;
  const changedElsewhere = live.revision !== base.revision || bill.revision !== billBase.revision || (everyMode && table!.live.revision !== baseTable!.revision);

  function keepMine() {
    setBase(live);
    setBillBase(bill);
    setBaseTable(table?.live ?? null);
  }

  function adoptLatest() {
    keepMine();
    setText(toPesoInput(theirs.unitCentavos));
    setBillKey(billKeyOf(bill));
    setSplitKeys(splitKeysOf(bill));
  }

  async function submit(event?: React.FormEvent, clear = false) {
    event?.preventDefault();
    lastClear.current = clear;
    const next = clear ? ({ ok: true, centavos: null } as const) : parsed;
    if (!next.ok) return setError(next.message);
    setError("");
    const everyone = [...payers, ...leftPayers];
    const payer = payers.find((p) => p.key === billKey);
    const splitting = billKey === SPLIT;
    const personOf = (p: Payer) => (p.participantId ? { participantId: p.participantId } : { label: p.label });
    const billChanged = canBillTo && (billKey !== billKeyOf(billBase) || (splitting && !sameSet(splitKeys, splitKeysOf(billBase))));
    // "Every …": the table price, and the line's own price (if any) is cleared in the same request.
    const tableChanged = everyMode && canPrice && next.centavos !== baseTable!.unitCentavos;
    // "Only this line": its own price; typing the price it already shows (inherited) is not a change.
    const priceChanged = !everyMode && canPrice && next.centavos !== base.unitCentavos && !(base.unitCentavos == null && next.centavos === line.unitCentavos);
    if (!priceChanged && !billChanged && !tableChanged) return onDone(false);
    const billBody = billChanged ? (splitting ? { splitAmong: everyone.filter((p) => splitKeys.includes(p.key)).map(personOf) } : { billTo: payer ? personOf(payer) : null }) : {};
    const entryPath = `/api/sessions/${sessionId}/entries/${line.entryId}/settlement`;
    if (line.correctionId) {
      // A replacement's price and its payer live on different rows, so two saves; a refusal on either keeps what was typed.
      if (priceChanged) {
        if (!(await save(`/api/sessions/${sessionId}/corrections/${line.correctionId}/price`, "PUT", { expectedRevision: base.revision, unitPriceCentavos: next.centavos }))) return;
        setBase({ unitCentavos: next.centavos, revision: base.revision + 1 });
      }
      if (billChanged && !(await save(entryPath, "PUT", { expectedRevision: billBase.revision, ...billBody }))) return;
    } else if (priceChanged || billChanged) {
      if (!(await save(entryPath, "PUT", { expectedRevision: base.revision, ...(priceChanged ? { unitPriceCentavos: next.centavos } : {}), ...billBody }))) return;
    }
    if (tableChanged) {
      // Removing the table price never wipes a line's own price; setting one does, if the line hasn't changed since it was seen.
      const clear = next.centavos != null && line.priceSource === "line";
      const body = {
        dishId: table!.dishId,
        variant: table!.variant,
        unitCentavos: next.centavos,
        expectedRevision: baseTable!.revision,
        ...(clear ? { clearEntryId: line.entryId, expectedEntryRevision: base.revision + (billChanged ? 1 : 0) } : {}),
      };
      if (!(await save(`/api/sessions/${sessionId}/prices`, "PUT", body))) return;
    }
    onDone(true);
  }

  const saving = state.kind === "saving";
  const canSplit = payers.length >= 2 || billKeyOf(bill) === SPLIT;
  // The whole dish: the typed price when this editor sets it, else what the line shows (a split copy knows the full amount).
  const splitTotal = canPrice && parsed.ok && parsed.centavos != null ? parsed.centavos * line.quantity : (line.splitOfCentavos ?? line.subtotalCentavos);
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="ease-in-panel mt-2 space-y-2 rounded-2xl bg-paper p-3" aria-label={`Price for ${line.label}`}>
      {changedElsewhere ? (
        <div role="alert" className="rounded-xl bg-saffron-wash px-3 py-2 text-sm text-ink">
          <p>
            Someone changed this just now to <span className="tally font-semibold">{theirs.unitCentavos == null ? "no price" : formatPeso(theirs.unitCentavos)}</span>. Your
            amount is still here.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <Button size="md" variant="outline" onClick={adoptLatest}>
              Use theirs
            </Button>
            <Button size="md" variant="ghost" onClick={keepMine}>
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
              everyMode ? (
                "Blank removes the table price."
              ) : line.hasTable && line.tableCentavos != null ? (
                <>
                  Blank uses the table price <span className="tally">{formatPeso(line.tableCentavos)}</span>.
                </>
              ) : (
                "Blank means not known yet."
              )
            ) : null}
          </p>
        </div>
      ) : null}

      {canPrice && table ? (
        <fieldset>
          <legend className="text-sm font-semibold">Apply this price to</legend>
          <div className="mt-1.5 space-y-1.5">
            {[
              { value: true, label: `Every ${table.label} here (${table.lines} ${table.lines === 1 ? "line" : "lines"})` },
              { value: false, label: "Only this line" },
            ].map((o) => (
              <label key={String(o.value)} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border-[1.5px] border-input bg-ticket px-3 text-sm has-checked:border-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink">
                <input type="radio" name={`${id}-scope`} checked={every === o.value} onChange={() => setEvery(o.value)} className="size-4 shrink-0 accent-ink" />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {canBillTo ? (
        <fieldset>
          <legend className="text-sm font-semibold">Bill to</legend>
          <p className="text-sm text-ink-soft">
            {canSplit ? "One person pays, or split it equally." : "The whole dish goes to one person."} Leave it on No one yet if the table hasn&rsquo;t decided.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[{ key: NOBODY, title: "No one yet" }, ...payers, ...(canSplit ? [{ key: SPLIT, title: "Split equally…" }] : [])].map((p) => (
              <label key={p.key} className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-[1.5px] border-input bg-ticket px-3.5 text-sm font-semibold has-checked:border-ink has-checked:bg-ink has-checked:text-paper has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink">
                <input type="radio" name={`${id}-bill`} value={p.key} checked={billKey === p.key} onChange={() => setBillKey(p.key)} className="sr-only" />
                {p.title}
              </label>
            ))}
          </div>
          {canSplit && billKey === SPLIT ? <SplitPicker id={id} people={[...payers, ...leftPayers]} selected={splitKeys} onChange={setSplitKeys} totalCentavos={splitTotal} /> : null}
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving || (billKey === SPLIT && splitKeys.length < 2)}>
          {saving ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" disabled={saving} onClick={() => onDone(false)}>
          Cancel
        </Button>
      </div>
      {canPrice && (everyMode ? baseTable!.unitCentavos != null : base.unitCentavos != null) ? (
        <Button variant="ghost" disabled={saving} onClick={(e) => void submit(e, true)}>
          {everyMode ? "Remove table price" : "Clear price"}
        </Button>
      ) : null}
      {state.kind === "conflict" && !changedElsewhere ? (
        <p role="alert" className="rounded-xl bg-saffron-wash px-3 py-2 text-sm text-ink">
          Someone changed this just now. Loading the latest amount; your amount is still here.
        </p>
      ) : null}
      {error || state.kind === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-bad-wash px-3 py-2 text-sm text-bad">
          <span className="flex-1">{error || (state.kind === "error" ? `Not saved. ${state.message}` : "")}</span>
          {state.kind === "error" && state.retryable && !error ? (
            <button type="button" onClick={(e) => void submit(e, lastClear.current)} className="min-h-11 cursor-pointer rounded-full border-[1.5px] border-bad px-3 font-semibold hover:bg-bad/10">
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
