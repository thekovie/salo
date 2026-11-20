"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";
import { DrawerClose, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { searchPreps, type Prep } from "@/lib/corrections";
import { normalizeText } from "@/lib/dish-name";

const SEARCH_FROM = 8;

/** Step one of the correction sheet: the round's dish lines, searchable once the list is long. */
export function DishPicker({ roundNumber, preps, onPick }: { roundNumber: number; preps: Prep[]; onPick: (prep: Prep) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const needle = normalizeText(query);
  const shown = searchPreps(preps, needle);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <DrawerTitle className="font-display text-2xl font-medium">Change a dish</DrawerTitle>
          <DrawerDescription className="mt-0.5 text-sm text-ink-soft">Round {roundNumber} · pick the line to change</DrawerDescription>
        </div>
        <DrawerClose aria-label="Close" className="-mt-1.5 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
          <X className="size-5" aria-hidden />
        </DrawerClose>
      </div>
      {preps.length >= SEARCH_FROM ? (
        <div className="mt-3">
          <label htmlFor={`${id}-q`} className="text-sm font-semibold">
            Search dishes
          </label>
          <input id={`${id}-q`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base [&::-webkit-search-cancel-button]:appearance-none" />
        </div>
      ) : null}
      <ul className="mt-3 divide-y divide-ink/10">
        {shown.map((p) => (
          <li key={p.key}>
            {p.kind === "replaced" ? (
              <div className="flex min-h-11 items-center justify-between gap-3 py-2 text-base text-ink-soft">
                <span>{p.label}</span>
                <span>
                  <span className="tally">×{p.ordered}</span> — Replaced
                </span>
              </div>
            ) : (
              <button
                type="button"
                data-pick=""
                aria-label={p.replaces ? `${p.label} ×${p.left}, replacement for ${p.replaces.label}` : undefined}
                onClick={() => onPick(p)}
                className={`flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 py-2 text-left text-base hover:bg-ink/6 has-[.block]:items-start ${p.replaces ? "pl-5" : ""}`}
              >
                <span>
                  {p.replaces ? <span aria-hidden>↳ </span> : null}
                  {p.label}
                  {p.pendingTo ? <span className="block text-sm text-ink-soft">change pending (→ {p.pendingTo})</span> : null}
                </span>
                <span className="text-ink-soft">
                  <span className="tally">×{p.left}</span>
                  {p.replaces ? " — Replacement" : ""}
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {shown.length === 0 ? <p className="mt-3 text-ink-soft">No dish matches.</p> : null}
    </div>
  );
}
