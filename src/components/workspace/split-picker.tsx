"use client";

import { allocate } from "@/lib/allocate";
import { formatPeso } from "@/lib/money";
import type { Payer } from "./price-editor";

/** "₱260.00 each", or "₱260.34 or ₱260.33 each" when the centavos don't divide evenly. */
export function eachLabel(totalCentavos: number, ways: number): string {
  const shares = [...allocate(totalCentavos, Array.from({ length: ways }, (_, i) => [String(i), 1] as const)).values()];
  const high = Math.max(...shares);
  const low = Math.min(...shares);
  return high === low ? `${formatPeso(high)} each` : `${formatPeso(high)} or ${formatPeso(low)} each`;
}

interface SplitPickerProps {
  id: string;
  people: Payer[];
  selected: string[];
  onChange: (keys: string[]) => void;
  /** The whole dish (price × quantity) when known. */
  totalCentavos: number | null;
}

/** The checklist under "Split equally…" in Bill to: who shares the dish, and what each pays. */
export function SplitPicker({ id, people, selected, onChange, totalCentavos }: SplitPickerProps) {
  return (
    <fieldset className="mt-2 rounded-xl bg-ticket px-3 py-1.5">
      <legend className="sr-only">Who shares this dish</legend>
      <ul>
        {people.map((p) => (
          <li key={p.key}>
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 break-words text-sm">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-tomato"
                checked={selected.includes(p.key)}
                onChange={(e) => onChange(e.target.checked ? [...selected, p.key] : selected.filter((k) => k !== p.key))}
              />
              <span className="min-w-0">{p.title}</span>
            </label>
          </li>
        ))}
      </ul>
      <p id={`${id}-each`} aria-live="polite" className="min-h-5 pb-1 text-sm text-ink-soft">
        {selected.length < 2 ? "Pick at least 2 people." : totalCentavos != null ? <span className="tally">{eachLabel(totalCentavos, selected.length)}</span> : "No price yet, so no amounts to show."}
      </p>
    </fieldset>
  );
}
