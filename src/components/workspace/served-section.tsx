"use client";

import { Check, ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useRowFocusFallback } from "@/hooks/use-row-focus-fallback";
import type { ServedEdit } from "@/hooks/use-served-edits";
import { focusIsLost } from "@/lib/focus";
import { groupServed, type ServedRow, type Tracker } from "@/lib/serving";
import { Stepper } from "./stepper";

interface ServedSectionProps {
  tracker: Tracker;
  /** The host while the order is open; everyone else (and an ended order) only reads. */
  canEdit: boolean;
  edits: Record<string, ServedEdit>;
  bump: (roundId: string, lineKey: string, delta: number, immediately?: boolean) => void;
  retry: (roundId: string, lineKey: string) => void;
  /** Host: open the correction sheet on this line. */
  onChange: (roundId: string, lineKey: string) => void;
}

/** Above this many fully served dishes the group starts collapsed. */
const COLLAPSE_ABOVE = 5;

const rowKey = (row: ServedRow) => `${row.roundId}|${row.line.key}`;

/** Food tracker (F06): what has arrived per round and dish. Waiting food first with the host's steppers, fully served below. */
export function ServedSection({ tracker, canEdit, edits, bump, retry, onChange }: ServedSectionProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [doneOpen, setDoneOpen] = useState<boolean | null>(null);
  const followKey = useRef<string | null>(null);

  const { waiting, done } = groupServed(tracker);
  const rows = [...waiting, ...done];
  const shownOf = (row: ServedRow) => {
    const e = edits[rowKey(row)];
    return Math.max(0, Math.min(row.line.expected, row.line.shown + (e?.sending ?? 0) + (e?.unsent ?? 0)));
  };
  const expected = rows.reduce((s, r) => s + r.line.expected, 0);
  const served = rows.reduce((s, r) => s + shownOf(r), 0);
  const left = expected - served;

  // An undo that moves a row back to Waiting unmounts the control it was on: follow that dish's − into the new row.
  useLayoutEffect(() => {
    const key = followKey.current;
    // Safari lands a tap on the nearest focusable ancestor, so "lost" also means "on no control".
    if (!key || !(focusIsLost() || !document.activeElement?.matches("button, input, select, textarea, summary, a[href]"))) return;
    const row = document.querySelector(`[data-serve-group="waiting"][data-serve-key="${CSS.escape(key)}"]`);
    // At 0 served the − is disabled: land on the + (or the row's first control) instead of dropping to the page.
    const target = row?.querySelector<HTMLElement>('[role="group"] button:not(:disabled)') ?? row?.querySelector<HTMLElement>("button:not(:disabled)");
    if (!target) return;
    followKey.current = null;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center" });
  });
  const focus = useRowFocusFallback<HTMLDivElement>("[data-serve-row]", "#served-h");
  const follow = (target: EventTarget) => {
    const row = (target as HTMLElement).closest<HTMLElement>("[data-serve-key]");
    followKey.current = row?.dataset.serveGroup === "done" ? (row.dataset.serveKey ?? null) : null;
  };

  if (rows.length === 0) return null;
  const toggle = (key: string) => setExpanded((set) => new Set(set.has(key) ? [...set].filter((k) => k !== key) : [...set, key]));

  const tag = (row: ServedRow) => <span className="round-label text-xs">Round {row.number}</span>;
  const failure = (row: ServedRow) =>
    edits[rowKey(row)]?.failed ? (
      <p role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-sm text-bad">
        Couldn’t save this.
        <button type="button" onClick={() => retry(row.roundId, row.line.key)} className="min-h-11 cursor-pointer rounded-full border-[1.5px] border-bad px-3 font-semibold hover:bg-bad/10">
          Try again<span className="sr-only">: {row.line.label}</span>
        </button>
      </p>
    ) : null;
  const stepper = (row: ServedRow) => (
    <Stepper value={shownOf(row)} min={0} max={row.line.expected} label={`${row.line.label} served`} onChange={(next) => bump(row.roundId, row.line.key, next - shownOf(row))} />
  );
  const changeButton = (row: ServedRow) =>
    row.line.expected > 0 ? (
      <Button variant="outline" onClick={() => onChange(row.roundId, row.line.key)}>
        Change…<span className="sr-only"> {row.line.label}, round {row.number}</span>
      </Button>
    ) : null;

  const waitingRow = (row: ServedRow) => {
    const { line } = row;
    const shown = shownOf(row);
    const isDone = shown >= line.expected;
    return (
      <li key={rowKey(row)} data-serve-row data-serve-group="waiting" data-serve-key={rowKey(row)} className="py-2.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
          <p className="font-semibold">{line.label}</p>
          {canEdit ? <div className="col-start-2 row-start-1">{stepper(row)}</div> : null}
          <p className="col-span-full flex flex-wrap items-baseline gap-x-2 text-sm text-ink-soft">
            {tag(row)}
            {line.cancelledSince > 0 && !edits[rowKey(row)]
              ? `Now ${line.shown} of ${line.expected} served · ${line.cancelledSince} were cancelled`
              : isDone
                ? `✓ Served ${shown}`
                : `${shown} of ${line.expected} served · ${line.expected - shown} waiting`}
          </p>
          {line.people ? <p className="col-span-full text-sm text-ink-soft">{line.people}</p> : null}
        </div>
        {canEdit ? (
          <div className="mt-1 flex flex-wrap gap-2">
            {!isDone ? (
              <Button variant="outline" onClick={() => bump(row.roundId, line.key, line.expected - shown, true)}>
                <Check className="size-5" aria-hidden /> All served<span className="sr-only">: {line.label}</span>
              </Button>
            ) : null}
            {changeButton(row)}
          </div>
        ) : null}
        {failure(row)}
      </li>
    );
  };

  const doneRow = (row: ServedRow) => {
    const { line } = row;
    const key = rowKey(row);
    const shown = shownOf(row);
    const open = canEdit && !line.history && (expanded.has(key) || Boolean(edits[key]));
    const meta = (
      <span className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-soft">
        {tag(row)}
        {line.history ? `${line.served} served · rest replaced` : line.people}
        {line.cancelledSince > 0 ? ` · ${line.cancelledSince} were cancelled` : ""}
      </span>
    );
    const head = (
      <>
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 font-semibold">
            {line.label}
            {line.history ? null : <span className="tally ml-1.5 text-tomato-ink">×{line.expected}</span>}
          </span>
          {line.history ? null : (
            <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-ok">
              {shown >= line.expected ? "All ✓" : `${shown} of ${line.expected}`}
              {canEdit ? <ChevronDown className={`size-4 text-ink-soft transition-transform ${open ? "rotate-180" : ""}`} aria-hidden /> : null}
            </span>
          )}
        </span>
        {meta}
      </>
    );
    return (
      <li key={key} data-serve-row data-serve-group="done" data-serve-key={key} className="py-1">
        {canEdit && !line.history ? (
          <button type="button" aria-expanded={open} onClick={() => toggle(key)} className="block min-h-11 w-full cursor-pointer rounded-xl px-1 py-0.5 text-left hover:bg-ink/6">
            {head}
          </button>
        ) : (
          <div className="px-1 py-1">{head}</div>
        )}
        {open ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {stepper(row)}
            {changeButton(row)}
          </div>
        ) : null}
        {failure(row)}
      </li>
    );
  };

  const doneIsOpen = doneOpen ?? done.length <= COLLAPSE_ABOVE;
  return (
    <section aria-labelledby="served-h" data-testid="served-section" className="rounded-2xl bg-paper p-4">
      <h2 id="served-h" tabIndex={-1} className="text-lg">
        Served
      </h2>
      <p role="status" aria-live="polite" className="mt-0.5 text-ink-soft" data-testid="served-summary">
        {left === 0 ? `All ${expected} served. Kain na!` : `${served} of ${expected} served · ${left} waiting`}
      </p>
      <div role="progressbar" aria-label="Food served" aria-valuemin={0} aria-valuemax={expected} aria-valuenow={served} className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
        <div className="h-full origin-left rounded-full bg-ok transition-transform duration-200 motion-reduce:transition-none" style={{ transform: `scaleX(${expected ? served / expected : 0})` }} />
      </div>
      <div
        {...focus}
        onFocus={(event) => {
          focus.onFocus(event);
          follow(event.target);
        }}
        // Safari does not focus a tapped button, so a tap on a Fully served row counts too.
        onClickCapture={(event) => follow(event.target)}
      >
        {waiting.length > 0 ? (
          <div className="mt-3">
            <h3 className="text-xs font-semibold tracking-wide text-ink-soft uppercase">Waiting</h3>
            <ul className="divide-y divide-ink/10">{waiting.map(waitingRow)}</ul>
          </div>
        ) : null}
        {done.length > 0 ? (
          <details open={doneIsOpen} onToggle={(event) => event.currentTarget.open !== doneIsOpen && setDoneOpen(event.currentTarget.open)} className="mt-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold tracking-wide text-ink-soft uppercase [&::-webkit-details-marker]:hidden">
              <span>Fully served ({done.length})</span>
              <ChevronDown className={`size-4 ${doneIsOpen ? "rotate-180" : ""}`} aria-hidden />
            </summary>
            <ul className="divide-y divide-ink/10">{done.map(doneRow)}</ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}
