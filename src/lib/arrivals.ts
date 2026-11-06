import type { SnapshotEntry } from "./snapshot";

/** Someone else's new dish (or dishes), worth a small "JD added Gyoza ×2" line. */
export interface Arrival {
  key: string;
  who: string;
  /** One dish: its name and quantity. Several from the same person at once: count only. */
  dishName: string | null;
  quantity: number;
  count: number;
  /** For scrolling to the row and tagging it. */
  dishId: string;
}

/** Above this many new entries in one step it was a resync or a reconnect, not someone typing: stay quiet. */
const BURST_LIMIT = 8;

/**
 * Entries in `next` that were not in `prev`, added by someone other than me, grouped by who added them. Pure, so the
 * workspace can call it during render when the snapshot changes.
 */
export function arrivalsBetween(prev: readonly SnapshotEntry[], next: readonly SnapshotEntry[], meId: string, nameOf: (id: string) => string): Arrival[] {
  const seen = new Set(prev.map((e) => e.id));
  const fresh = next.filter((e) => !seen.has(e.id) && e.submittedBy !== meId);
  if (fresh.length === 0 || fresh.length > BURST_LIMIT) return [];
  const bySubmitter = new Map<string, SnapshotEntry[]>();
  for (const e of fresh) bySubmitter.set(e.submittedBy, [...(bySubmitter.get(e.submittedBy) ?? []), e]);
  return [...bySubmitter.entries()].map(([submitter, list]) => ({
    key: list.map((e) => e.id).join(","),
    who: nameOf(submitter),
    dishName: list.length === 1 ? list[0].dishName : null,
    quantity: list.length === 1 ? list[0].quantity : list.reduce((n, e) => n + e.quantity, 0),
    count: list.length,
    dishId: list[list.length - 1].dishId,
  }));
}

export function arrivalText(a: Arrival): string {
  return a.dishName ? `${a.who} added ${a.dishName} ×${a.quantity}` : `${a.who} added ${a.count} dishes`;
}
