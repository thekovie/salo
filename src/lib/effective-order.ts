import type { SnapshotEntry } from "./snapshot";
import type { CorrectionView } from "./ticket";

/** Ids of the rounds the waiter has been told about. */
export const confirmedIds = (rounds: readonly { id: string; status: string }[]): Set<string> => new Set(rounds.filter((r) => r.status === "CONFIRMED").map((r) => r.id));

/** What one confirmed entry amounts to once the corrections the waiter has been told about are applied. */
export interface EffectiveEntry {
  /** Original quantity minus confirmed cancellations (zero or less = gone). */
  quantity: number;
  /** The latest confirmed swap, "Pork Katsu", or null. */
  replacement: string | null;
  /** Id of that swap, which carries its own price. */
  replacementId: string | null;
  /** A cancellation or swap is waiting in a round that isn't confirmed yet. */
  pendingChange: boolean;
}

/**
 * The one answer to "how many of this confirmed dish are really ordered": only corrections whose target round is
 * CONFIRMED count; the rest are pending. KKB and Items both use it so they never disagree.
 */
export function effectiveEntry(entry: Pick<SnapshotEntry, "id" | "quantity">, corrections: CorrectionView[], confirmedRounds: ReadonlySet<string>): EffectiveEntry {
  const fixes = corrections.filter((c) => c.sourceEntryId === entry.id);
  const done = fixes.filter((c) => confirmedRounds.has(c.targetRoundId));
  const cancelled = done.filter((c) => c.type === "QUANTITY").reduce((sum, c) => sum + Math.abs(c.quantityDelta ?? 0), 0);
  const swap = [...done].reverse().find((c) => c.type === "REPLACE" && c.replacement);
  return {
    quantity: entry.quantity - cancelled,
    replacement: swap?.replacement ?? null,
    replacementId: swap?.id ?? null,
    pendingChange: fixes.some((c) => !confirmedRounds.has(c.targetRoundId)),
  };
}
