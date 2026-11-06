"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

export type View = "order" | "people" | "groups";

const VIEWS: { id: View; label: string }[] = [
  { id: "order", label: "Order" },
  { id: "people", label: "People" },
  { id: "groups", label: "Groups" },
];

/** Segmented tabs (WAI-ARIA tabs pattern: arrow keys move between them). The consolidated order is the default. */
export function ViewTabs({ view, onChange, counts }: { view: View; onChange: (view: View) => void; counts: Partial<Record<View, number>> }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(event: React.KeyboardEvent, index: number) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + VIEWS.length) % VIEWS.length;
    onChange(VIEWS[next].id);
    refs.current[next]?.focus();
  }
  return (
    <div role="tablist" aria-label="Views" className="mb-4 grid grid-cols-3 gap-1 rounded-full bg-ink/6 p-1">
      {VIEWS.map((v, i) => (
        <button
          key={v.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="tab"
          id={`tab-${v.id}`}
          aria-selected={view === v.id}
          aria-controls={`panel-${v.id}`}
          tabIndex={view === v.id ? 0 : -1}
          onClick={() => onChange(v.id)}
          onKeyDown={(e) => onKey(e, i)}
          className={cn(
            "min-h-11 cursor-pointer rounded-full text-sm font-semibold transition-colors",
            view === v.id ? "bg-ticket text-ink shadow-ticket" : "text-ink-soft hover:text-ink",
          )}
        >
          {v.label}
          {counts[v.id] ? <span className="tally ml-1.5 text-xs text-ink-soft">{counts[v.id]}</span> : null}
        </button>
      ))}
    </div>
  );
}
