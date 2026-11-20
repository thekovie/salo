import { LocalTime } from "@/components/ui/local-time";
import { correctionRows } from "@/lib/corrections";
import type { SessionSnapshot } from "@/lib/snapshot";

/** Every change to confirmed dishes, one row per change: pending ones go with the open round, told ones the waiter already heard. */
export function CorrectionsList({ snapshot, onRemove }: { snapshot: SessionSnapshot; onRemove?: (id: string, text: string) => void }) {
  const rows = correctionRows(snapshot);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="corrections-h" className="space-y-1">
      <h2 id="corrections-h" className="text-lg">
        Corrections
      </h2>
      <ul className="divide-y divide-ink/10 rounded-2xl bg-ticket px-4">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-2 py-2">
            <p>
              <span className="font-semibold">{row.text}</span>
              <span className="block text-sm text-ink-soft">
                {row.unavailable ? "Unavailable · " : ""}
                {row.told ? (
                  <>
                    Told the waiter {row.toldAt ? <LocalTime iso={row.toldAt} /> : null}
                  </>
                ) : (
                  <>Pending · goes with round {row.goesWithRound}</>
                )}
              </span>
            </p>
            {!row.told && onRemove ? (
              <button type="button" onClick={() => onRemove(row.id, row.text)} className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-full px-3 text-sm font-semibold text-ink hover:bg-ink/6">
                Remove<span className="sr-only">: {row.text}</span>
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
