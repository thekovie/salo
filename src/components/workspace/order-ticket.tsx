"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { OverlayEntry } from "@/hooks/use-session";
import { consolidate, hasSubLines, preparationLabel, type ConsolidatedDish } from "@/lib/consolidate";
import { normalizeText } from "@/lib/dish-name";
import { attributionLabel, type SessionSnapshot } from "@/lib/snapshot";
import { Ticker } from "@/components/motion/ticker";
import { cn } from "@/lib/utils";
import { transitionName } from "@/lib/view-transition";
import { Stepper } from "./stepper";

export interface TicketActions {
  setQuantity: (entry: OverlayEntry, quantity: number) => void;
  remove: (entry: OverlayEntry) => void;
  canEdit: (entry: OverlayEntry) => boolean;
}

interface OrderTicketProps {
  entries: OverlayEntry[];
  people: SessionSnapshot["participants"];
  roundNumber: number;
  copy: 1 | 2 | 3;
  actions: TicketActions;
  /** Read-only ticket (confirmed round, closed session). */
  readOnly?: boolean;
  /** Dishes someone else just added, by dish id: a short "+2 · JD" tag on the row. */
  recent?: ReadonlyMap<string, { key: string; label: string }>;
}

/** Who it's for, plus size and instructions unless a heading above already says them. */
function describe(entry: OverlayEntry, people: SessionSnapshot["participants"], withPreparation = true): string {
  return [attributionLabel(entry, people), ...(withPreparation ? [entry.variant, entry.instructions] : [])].filter(Boolean).join(" · ");
}

/** A dish still on its way to the server has no id yet: its stepper stays in place but waits (it never unmounts under the finger). */
const isUnsavedAdd = (entry: OverlayEntry) => entry.id.startsWith("pending:");

/** One source entry with its own stepper: editing never touches anyone else's entry (brief 6.4). */
function SourceRow({ entry, people, actions, readOnly, underHeading }: { entry: OverlayEntry; people: SessionSnapshot["participants"]; actions: TicketActions; readOnly?: boolean; underHeading: boolean }) {
  const detail = describe(entry, people, !underHeading) || (underHeading ? "Not assigned" : "No details");
  const editable = !readOnly && actions.canEdit(entry);
  const unsaved = isUnsavedAdd(entry);
  return (
    <li className={cn("flex items-center justify-between gap-3 py-1 pl-3", entry.pending && "opacity-60")}>
      <span className="min-w-0 text-[0.95rem] text-ink-soft">
        {detail}
        {entry.pending ? <span className="ml-2 text-xs font-semibold text-saffron-ink">Saving…</span> : null}
      </span>
      {editable ? (
        <Stepper value={entry.quantity} disabled={unsaved} label={[entry.dishName, entry.variant, entry.instructions, attributionLabel(entry, people)].filter(Boolean).join(", ")} onChange={(q) => actions.setQuantity(entry, q)} onRemove={() => actions.remove(entry)} />
      ) : (
        <span className="tally pr-3 text-lg text-tomato-ink">×{entry.quantity}</span>
      )}
    </li>
  );
}

function DishRow({ dish, people, actions, readOnly, washKey, fresh, tag }: { dish: ConsolidatedDish; people: SessionSnapshot["participants"]; actions: TicketActions; readOnly?: boolean; washKey: string; fresh: boolean; tag?: { key: string; label: string } }) {
  const [open, setOpen] = useState(false);
  const entries = dish.preparations.flatMap((p) => p.entries) as OverlayEntry[];
  const single = entries.length === 1 ? entries[0] : null;
  const pending = entries.some((e) => e.pending);
  const sub = single ? describe(single, people) : "";
  const editableSingle = single && !readOnly && actions.canEdit(single);
  const panelId = `dish-${dish.dishId}`;

  return (
    <li className="relative px-5 py-2.5" data-testid="dish-row" data-dish={normalizeText(dish.name)} style={{ viewTransitionName: transitionName("dish", dish.dishId) }}>
      {/* Remounts (and replays) whenever someone adds this dish again, here or on another phone. */}
      {fresh ? <span key={washKey} aria-hidden className="wash pointer-events-none absolute inset-0" /> : null}
      <div className="flex min-h-11 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg leading-snug">
            {dish.name}
            {tag ? (
              <span key={tag.key} className="arrival-tag ml-2 inline-block rounded-full bg-saffron px-2 py-0.5 align-middle font-sans text-xs font-semibold text-ink">
                {tag.label}
              </span>
            ) : null}
          </p>
          {sub ? <p className="text-sm text-ink-soft">{sub}</p> : null}
          {pending && single ? <p className="text-xs font-semibold text-saffron-ink">Saving…</p> : null}
        </div>
        {editableSingle ? (
          <Stepper size="lg" value={single.quantity} disabled={isUnsavedAdd(single)} label={dish.name} onChange={(q) => actions.setQuantity(single, q)} onRemove={() => actions.remove(single)} />
        ) : single ? (
          <span className="tally text-3xl text-tomato-ink" aria-label={`${single.quantity} ${dish.name}`}>
            <Ticker value={single.quantity} prefix="×" />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className="-mr-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full px-2 hover:bg-ink/6"
          >
            <Ticker value={dish.quantity} prefix="×" className="tally text-3xl text-tomato-ink" />
            <span className="sr-only">{open ? `Hide who ordered ${dish.name}` : `Show who ordered ${dish.name}`}</span>
            <ChevronDown className={cn("size-5 text-ink-soft transition-transform duration-200 ease-[var(--ease-out-expo)]", open && "rotate-180")} aria-hidden />
          </button>
        )}
      </div>

      {!single && hasSubLines(dish) && !open ? (
        <ul className="mt-1 space-y-0.5 border-l-[1.5px] border-rule pl-3 text-ink-soft">
          {dish.preparations.map((line) => (
            <li key={line.key} className="flex justify-between gap-3">
              <span>{preparationLabel(line)}</span>
              <span className="tally">×{line.quantity}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {!single && open ? (
        <div id={panelId} className="ease-in-panel mt-1 space-y-2">
          {dish.preparations.map((line) => (
            <div key={line.key}>
              {hasSubLines(dish) ? (
                <p className="flex justify-between text-sm font-semibold text-ink">
                  <span>{preparationLabel(line)}</span>
                  <span className="tally text-tomato-ink">×{line.quantity}</span>
                </p>
              ) : null}
              <ul className="border-l-[1.5px] border-rule">
                {(line.entries as OverlayEntry[]).map((entry) => (
                  <SourceRow key={entry.id} entry={entry} people={people} actions={actions} readOnly={readOnly} underHeading={hasSubLines(dish)} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/** The round's order pad: consolidated dishes, big counts, source entries one tap away. */
export function OrderTicket({ entries, people, roundNumber, copy, actions, readOnly, recent }: OrderTicketProps) {
  const consolidated = consolidate(entries);
  // Only dishes that land while you watch get the highlighter swipe; the ones already there on load do not flash.
  const washKeyOf = (dish: ConsolidatedDish) => `${dish.dishId}:${dish.preparations.reduce((n, p) => n + p.entries.length, 0)}`;
  const [initialKeys] = useState(() => new Set(consolidated.dishes.map(washKeyOf)));
  return (
    <section aria-labelledby="ticket-title" data-ph-mask="" className={cn("ticket", copy === 2 && "ticket-copy-2", copy === 3 && "ticket-copy-3")}>
      <div className="flex items-baseline justify-between px-5 pb-2">
        <h2 id="ticket-title" className="font-mono text-sm font-medium tracking-[0.14em] text-tomato-ink uppercase">
          Round {roundNumber}
        </h2>
        <span className="tally text-sm text-ink-soft">
          <Ticker value={consolidated.totalItems} /> {consolidated.totalItems === 1 ? "item" : "items"}
        </span>
      </div>
      {consolidated.dishes.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="font-display text-xl">Wala pang order.</p>
          <p className="mt-1 text-ink-soft">{readOnly ? "No dishes in this round." : "Type the first dish below. Same dishes get counted together."}</p>
        </div>
      ) : (
        <ul className="divide-y-[1.5px] divide-dashed divide-rule">
          {consolidated.dishes.map((dish) => (
            <DishRow key={dish.dishId} dish={dish} people={people} actions={actions} readOnly={readOnly} washKey={washKeyOf(dish)} fresh={!initialKeys.has(washKeyOf(dish))} tag={recent?.get(dish.dishId)} />
          ))}
        </ul>
      )}
    </section>
  );
}
