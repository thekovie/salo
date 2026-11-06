"use client";

import { arrivalText, type Arrival } from "@/lib/arrivals";

/** Keep in step with --dur-arrival in globals.css. */
export const ARRIVAL_MS = 2800;
const MAX_VISIBLE = 2;

/**
 * Small live notes under the header when someone else adds a dish. They never take focus, never cover the composer,
 * and leave on their own; tapping one jumps to the dish.
 */
export function ArrivalPills({ arrivals, onSelect }: { arrivals: Arrival[]; onSelect: (arrival: Arrival) => void }) {
  const shown = arrivals.slice(-MAX_VISIBLE);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4.5rem)] z-40 flex flex-col items-center gap-1.5 px-4">
      {shown.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={() => onSelect(a)}
          className="arrival-pill pointer-events-auto inline-flex min-h-9 max-w-full cursor-pointer items-center gap-2 rounded-full bg-saffron-wash py-1 pr-3.5 pl-1 text-sm text-saffron-ink shadow-ticket ring-1 ring-saffron/40"
        >
          <span aria-hidden className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-saffron font-display text-sm text-ink">
            {a.who.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <span className="truncate">
            <span className="font-semibold">{a.who}</span>
            {arrivalText(a).slice(a.who.length)}
          </span>
        </button>
      ))}
    </div>
  );
}
