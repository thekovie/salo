"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRowFocusFallback } from "@/hooks/use-row-focus-fallback";
import type { ServedEdit } from "@/hooks/use-served-edits";
import type { Tracker, TrackerLine } from "@/lib/serving";
import { cn } from "@/lib/utils";
import { Stepper } from "./stepper";

type Filter = "all" | "waiting" | "served";

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

/** Food tracker (F06): what has arrived per round and dish, with the host's steppers. */
export function ServedSection({ tracker, canEdit, edits, bump, retry, onChange }: ServedSectionProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const focus = useRowFocusFallback<HTMLDivElement>("[data-serve-row]", '[data-serve-chips] [aria-pressed="true"]');

  const shownOf = (roundId: string, line: TrackerLine) => {
    const e = edits[`${roundId}|${line.key}`];
    return Math.max(0, Math.min(line.expected, line.shown + (e?.sending ?? 0) + (e?.unsent ?? 0)));
  };
  const rounds = tracker.rounds.map((r) => ({ ...r, lines: r.lines.map((line) => ({ line, shown: shownOf(r.roundId, line) })) }));
  const all = rounds.flatMap((r) => r.lines);
  const expected = all.reduce((s, l) => s + l.line.expected, 0);
  const served = all.reduce((s, l) => s + l.shown, 0);
  const waiting = expected - served;
  const visible = (l: { line: TrackerLine; shown: number }) => filter === "all" || (filter === "waiting") === l.shown < l.line.expected;
  const shownRounds = rounds.map((r) => ({ ...r, lines: r.lines.filter(visible) })).filter((r) => r.lines.length > 0);

  if (all.length === 0) return null;
  const chip = (value: Filter, text: string) => (
    <button
      key={value}
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      className={cn("min-h-11 cursor-pointer rounded-full px-4 text-sm font-semibold", filter === value ? "bg-ink text-paper" : "border-[1.5px] border-input bg-ticket hover:bg-paper")}
    >
      {text}
    </button>
  );

  return (
    <section aria-labelledby="served-h" data-testid="served-section" className="rounded-2xl bg-paper p-4">
      <h2 id="served-h" tabIndex={-1} className="text-lg">
        Served
      </h2>
      <p role="status" aria-live="polite" className="mt-0.5 text-ink-soft" data-testid="served-summary">
        {waiting === 0 ? `All ${expected} served. Kain na!` : `${served} of ${expected} served · ${waiting} waiting`}
      </p>
      <div role="progressbar" aria-label="Food served" aria-valuemin={0} aria-valuemax={expected} aria-valuenow={served} className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
        <div className="h-full origin-left rounded-full bg-ok transition-transform duration-200 motion-reduce:transition-none" style={{ transform: `scaleX(${expected ? served / expected : 0})` }} />
      </div>
      <div data-serve-chips className="mt-3 flex flex-wrap gap-2">
        {chip("all", "All")}
        {chip("waiting", `Waiting ${waiting}`)}
        {chip("served", "Served")}
      </div>
      <div {...focus}>
        {shownRounds.length === 0 ? <p className="mt-3 text-sm text-ink-soft">Nothing here.</p> : null}
        {shownRounds.map((r) => (
          <div key={r.roundId} className="mt-3">
            <h3 className="text-xs font-semibold tracking-wide text-ink-soft uppercase">Round {r.number}</h3>
            <ul className="divide-y divide-ink/10">
              {r.lines.map(({ line, shown }) => {
                const edit = edits[`${r.roundId}|${line.key}`];
                const done = shown >= line.expected;
                const busy = Boolean(edit);
                if (line.history) {
                  return (
                    <li key={line.key} data-serve-row className="py-2.5">
                      <p className="font-semibold">{line.label}</p>
                      <p className="text-sm text-ink-soft">{line.served} served · rest replaced</p>
                    </li>
                  );
                }
                return (
                  <li key={line.key} data-serve-row className="py-2.5">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
                      <p className="font-semibold">{line.label}</p>
                      {canEdit ? (
                        <div className="col-start-2 row-start-1">
                          <Stepper value={shown} min={0} max={line.expected} label={`${line.label} served`} onChange={(next) => bump(r.roundId, line.key, next - shown)} />
                        </div>
                      ) : null}
                      <p className="col-span-full text-sm text-ink-soft">
                        {line.cancelledSince > 0 && !busy
                          ? `Now ${line.shown} of ${line.expected} served · ${line.cancelledSince} were cancelled`
                          : done
                            ? `✓ Served ${shown}`
                            : `${shown} of ${line.expected} served · ${line.expected - shown} waiting`}
                      </p>
                      {line.people ? <p className="col-span-full text-sm text-ink-soft">{line.people}</p> : null}
                    </div>
                    {canEdit ? (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {!done ? (
                          <Button variant="outline" onClick={() => bump(r.roundId, line.key, line.expected - shown, true)}>
                            <Check className="size-5" aria-hidden /> All served<span className="sr-only">: {line.label}</span>
                          </Button>
                        ) : null}
                        {line.expected > 0 ? (
                          <Button variant="outline" onClick={() => onChange(r.roundId, line.key)}>
                            Change…<span className="sr-only"> {line.label}, round {r.number}</span>
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {edit?.failed ? (
                      <p role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-sm text-bad">
                        Couldn’t save this.
                        <button type="button" onClick={() => retry(r.roundId, line.key)} className="min-h-11 cursor-pointer rounded-full border-[1.5px] border-bad px-3 font-semibold hover:bg-bad/10">
                          Try again<span className="sr-only">: {line.label}</span>
                        </button>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
