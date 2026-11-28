"use client";

import { LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useDirectSave, useRetryOnReconnect } from "@/hooks/use-direct-save";
import { canFocus, focusWhenFree } from "@/lib/focus";
import { priceRows, pricesLeft, type PriceRow as Row } from "@/lib/kkb";
import { formatPeso, parsePeso, toPesoInput } from "@/lib/money";
import type { SessionSnapshot } from "@/lib/snapshot";

interface Draft {
  text: string;
  baseRevision: number;
}

// Typed-but-unsaved prices live in sessionStorage (a tab's lifetime) so closing the sheet or losing signal keeps them.
const draftsKey = (sessionId: string) => `salo:prices:${sessionId}`;

function readDrafts(sessionId: string): Record<string, Draft> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(draftsKey(sessionId)) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Draft>) : {};
  } catch {
    return {};
  }
}

function writeDraft(sessionId: string, rowKey: string, draft: Draft | null) {
  try {
    const rest = Object.fromEntries(Object.entries(readDrafts(sessionId)).filter(([key]) => key !== rowKey));
    const next = draft ? { ...rest, [rowKey]: draft } : rest;
    if (Object.keys(next).length === 0) sessionStorage.removeItem(draftsKey(sessionId));
    else sessionStorage.setItem(draftsKey(sessionId), JSON.stringify(next));
  } catch {
    // Storage blocked or full: the value just isn't kept across a close.
  }
}

function readDraft(sessionId: string, rowKey: string): Draft | null {
  const draft = readDrafts(sessionId)[rowKey];
  return draft && typeof draft.text === "string" && typeof draft.baseRevision === "number" ? draft : null;
}

interface PricesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: SessionSnapshot;
  refresh: () => Promise<unknown>;
}

/**
 * The host's quick price entry: one row per dish + size (a table price that covers every order of it) and one per
 * replacement dish, unpriced first. Each row saves on its own, straight to the server.
 */
export function PricesSheet({ open, onOpenChange, snapshot, refresh }: PricesSheetProps) {
  const opener = useRef<Element | null>(null);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        onOpenAutoFocus={() => {
          opener.current = document.activeElement;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // The opener may have become text (all priced) or unmounted: land on the nearest heading instead.
          focusWhenFree(() => [canFocus(opener.current) ? opener.current : null, document.getElementById("kkb-completeness"), document.getElementById("what-next")]);
        }}
      >
        <SheetBody snapshot={snapshot} refresh={refresh} />
      </DrawerContent>
    </Drawer>
  );
}

function SheetBody({ snapshot, refresh }: { snapshot: SessionSnapshot; refresh: () => Promise<unknown> }) {
  const rows = useMemo(() => priceRows(snapshot), [snapshot]);
  // Layout is frozen when a row is first seen (at open, or when it arrives later) so it doesn't jump away the moment
  // it is priced; reopening re-sorts.
  const [frozen, setFrozen] = useState(() => rows.map((r) => ({ key: r.key, needs: r.needsPrice })));
  const arrived = rows.filter((r) => !frozen.some((f) => f.key === r.key));
  if (arrived.length) setFrozen([...frozen, ...arrived.map((r) => ({ key: r.key, needs: r.needsPrice }))]);
  const rank = (key: string) => {
    const i = frozen.findIndex((f) => f.key === key);
    return i < 0 ? frozen.length : i;
  };
  const sorted = [...rows].sort((a, b) => rank(a.key) - rank(b.key));
  const needsNow = (r: Row) => frozen.find((f) => f.key === r.key)?.needs ?? r.needsPrice;
  const needs = sorted.filter(needsNow);
  const priced = sorted.filter((r) => !needsNow(r));
  const left = pricesLeft(rows);
  const hasLaterEmpty = (r: Row) => sorted.slice(sorted.indexOf(r) + 1).some((x) => x.needsPrice);

  return (
    <div data-prices-list>
      <div className="flex items-start justify-between gap-3">
        <div>
          <DrawerTitle className="font-display text-2xl font-medium">Enter prices</DrawerTitle>
          <DrawerDescription className="mt-0.5 text-sm text-ink-soft">{left > 0 ? `${left} ${left === 1 ? "price" : "prices"} left · a price covers every order of that dish and size` : "All prices in"}</DrawerDescription>
        </div>
        <DrawerClose aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
          <X className="size-5" aria-hidden />
        </DrawerClose>
      </div>
      {[
        { id: "needs", title: "Needs a price", list: needs },
        { id: "priced", title: "Priced", list: priced },
      ].map(({ id, title, list }) =>
        list.length === 0 ? null : (
          <section key={id} aria-labelledby={`prices-${id}`} className="mt-4">
            <h3 id={`prices-${id}`} className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
              {title}
            </h3>
            <ul className="divide-y-[1.5px] divide-dashed divide-rule" data-ph-mask="">
              {list.map((row) => (
                <PriceRow key={row.key} row={row} sessionId={snapshot.session.id} refresh={refresh} hasNext={hasLaterEmpty(row)} />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

function PriceRow({ row, sessionId, refresh, hasNext }: { row: Row; sessionId: string; refresh: () => Promise<unknown>; hasNext: boolean }) {
  const id = useId();
  const { state, save } = useDirectSave(refresh);
  const busy = useRef(false);
  // An edit made while a save is in flight is sent as soon as that save settles.
  const pending = useRef(false);
  const [restored] = useState(() => readDraft(sessionId, row.key));
  const [text, setText] = useState(restored?.text ?? toPesoInput(row.unitCentavos));
  // What this row was last known to hold on the server, so a save can say which revision it expects.
  const [base, setBase] = useState({ revision: restored?.baseRevision ?? row.revision, centavos: row.unitCentavos });
  const [notSaved, setNotSaved] = useState(restored !== null);
  const [saved, setSaved] = useState(false);
  const parsed = parsePeso(text);
  const dirty = text !== toPesoInput(base.centavos) || notSaved;
  // The server already holds what was typed (our own save's live refetch, or a retry whose reply was lost): not a conflict.
  const serverHasMine = parsed.ok && row.unitCentavos === parsed.centavos;
  const changedElsewhere = dirty && row.revision > base.revision && !serverHasMine;

  // Untouched and someone else changed it: just follow the server.
  if (!dirty && row.revision > base.revision) {
    setBase({ revision: row.revision, centavos: row.unitCentavos });
    setText(toPesoInput(row.unitCentavos));
  } else if (dirty && row.revision > base.revision && serverHasMine && state.kind !== "saving") {
    setBase({ revision: row.revision, centavos: row.unitCentavos });
    setNotSaved(false);
  }

  useEffect(() => {
    if (!notSaved && text === toPesoInput(base.centavos)) writeDraft(sessionId, row.key, null);
  }, [notSaved, text, base.centavos, sessionId, row.key]);

  const latestText = useRef(text);
  useEffect(() => {
    latestText.current = text;
  });

  async function commit(from = base): Promise<void> {
    if (busy.current) {
      pending.current = true;
      return;
    }
    const sent = latestText.current;
    const parsed = parsePeso(sent);
    if (!parsed.ok || (from === base && changedElsewhere)) return;
    if (parsed.centavos === from.centavos) {
      setText(toPesoInput(parsed.centavos));
      setNotSaved(false);
      writeDraft(sessionId, row.key, null);
      return;
    }
    busy.current = true;
    const path = row.correctionId ? `/api/sessions/${sessionId}/corrections/${row.correctionId}/price` : `/api/sessions/${sessionId}/prices`;
    const body = row.correctionId
      ? { expectedRevision: from.revision, unitPriceCentavos: parsed.centavos }
      : { dishId: row.dishId, variant: row.variant, unitCentavos: parsed.centavos, expectedRevision: from.revision };
    const ok = await save(path, "PUT", body).finally(() => (busy.current = false));
    // The server moved this price on by exactly one.
    const next = ok ? { revision: from.revision + 1, centavos: parsed.centavos } : from;
    if (!ok) writeDraft(sessionId, row.key, { text: sent, baseRevision: from.revision });
    if (ok) {
      setBase(next);
      setText((now) => (now === sent ? toPesoInput(parsed.centavos) : now));
      setNotSaved(false);
      setSaved(true);
    }
    if (pending.current) {
      pending.current = false;
      if (latestText.current !== sent) await commit(next);
    }
  }

  // A value restored as "Not saved" retries on reconnect too, not only one whose save failed while open.
  useRetryOnReconnect((state.kind === "error" && state.retryable) || (notSaved && state.kind === "idle"), () => void commit());

  function onChange(next: string) {
    setText(next);
    setSaved(false);
    writeDraft(sessionId, row.key, next === toPesoInput(base.centavos) ? null : { text: next, baseRevision: base.revision });
  }

  function useTheirs() {
    setBase({ revision: row.revision, centavos: row.unitCentavos });
    setText(toPesoInput(row.unitCentavos));
    setNotSaved(false);
    writeDraft(sessionId, row.key, null);
  }

  function keepMine() {
    const rebased = { revision: row.revision, centavos: row.unitCentavos };
    setBase(rebased);
    void commit(rebased);
  }

  function onEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const field = event.currentTarget;
    if (!parsed.ok) return;
    void commit();
    const fields = [...(field.closest("[data-prices-list]")?.querySelectorAll<HTMLInputElement>("[data-price-field]") ?? [])];
    const next = fields.slice(fields.indexOf(field) + 1).find((f) => f.value === "");
    if (next) next.focus();
    else field.blur();
  }

  const ownOnly = !row.correctionId && row.own === row.lines;
  const saving = state.kind === "saving";
  const status = saving ? "Saving…" : saved ? "Saved" : "";
  const errorText = !parsed.ok ? parsed.message : "";
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 pt-2.5">
          <p className="leading-snug break-words">{row.label}</p>
          {!ownOnly && row.own > 0 ? (
            <p className="text-sm text-ink-soft">
              {row.ownQuantity} of {row.quantity} {row.ownQuantity === 1 ? "has its" : "have their"} own price
            </p>
          ) : null}
          {/* Its line is always reserved, so "Saving…"/"Saved" never changes a row's height under the next field. */}
          <p role="status" className="flex min-h-5 items-center gap-1.5 text-sm text-ink-soft">
            {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {status}
          </p>
        </div>
        <span className="tally shrink-0 pt-2.5 text-tomato-ink">×{row.quantity}</span>
        {ownOnly ? (
          // Same box as the ₱ + field, so the ×n column stays in line.
          <span className="flex shrink-0 items-center gap-2">
            <span aria-hidden className="invisible">
              ₱
            </span>
            <span className="flex min-h-11 w-24 items-center justify-end text-sm text-ink-soft">Own prices</span>
          </span>
        ) : (
          <label className="flex shrink-0 items-center gap-2">
            <span aria-hidden className="text-ink-soft">
              ₱
            </span>
            <input
              data-price-field
              aria-label={`Price each for ${row.label}`}
              aria-invalid={Boolean(errorText) || undefined}
              aria-describedby={`${id}-note`}
              value={text}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={onEnter}
              inputMode="decimal"
              enterKeyHint={hasNext ? "next" : "done"}
              autoComplete="off"
              placeholder="0.00"
              className="tally min-h-11 w-24 rounded-xl border-[1.5px] border-input bg-ticket px-3 text-right text-base aria-invalid:border-bad"
            />
          </label>
        )}
      </div>
      <div id={`${id}-note`}>
        {errorText ? <p className="mt-1 text-right text-sm text-bad">{errorText}</p> : null}
        {changedElsewhere ? (
          <div role="alert" className="mt-2 rounded-xl bg-saffron-wash px-3 py-2 text-sm text-ink">
            <p>
              Someone changed this just now to <span className="tally font-semibold">{row.unitCentavos == null ? "no price" : formatPeso(row.unitCentavos)}</span>. Your amount is still here.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Button size="md" variant="outline" onClick={useTheirs}>
                Use theirs
              </Button>
              <Button size="md" variant="ghost" onClick={keepMine}>
                Keep mine
              </Button>
            </div>
          </div>
        ) : state.kind === "error" || (notSaved && !saving) ? (
          <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-bad-wash px-3 py-2 text-sm text-bad">
            <span className="flex-1">{state.kind === "error" ? `Not saved. ${state.message}` : "Not saved"}</span>
            {state.kind !== "error" || state.retryable ? (
              <button type="button" onClick={() => void commit()} className="min-h-11 cursor-pointer rounded-full border-[1.5px] border-bad px-3 font-semibold hover:bg-bad/10">
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
