/**
 * The rules of the client's change queue, kept pure so they can be tested without a browser. The hook in
 * `src/hooks/use-session.ts` owns the state and the network; these functions decide what happens next.
 */

export type QueueStatus = "queued" | "sending" | "waiting" | "committed" | "failed";

export interface QueueItem<Op> {
  key: string;
  op: Op;
  status: QueueStatus;
}

/** Still on its way: everything except changes the server applied or refused. */
const unfinished = (status: QueueStatus) => status === "queued" || status === "sending" || status === "waiting";

/**
 * The next change to send, strictly in the order they were made. A change waiting for the network (or already in
 * flight) holds back everything after it, so an Undo can never reach the server before the change it undoes.
 * Refused changes ("failed") don't block: they wait for the person's Retry or Discard.
 */
export function nextToSend<T extends QueueItem<unknown>>(list: readonly T[]): T | null {
  const first = list.find((item) => unfinished(item.status));
  return first?.status === "queued" ? first : null;
}

/**
 * Several taps on one stepper before the earlier tap was sent: keep one change with the final number. Only the
 * latest unsent update of that entry can absorb a new one, and only if nothing else for that entry came after it.
 */
export function coalesceTarget<Op extends { kind: string }, T extends QueueItem<Op>>(list: readonly T[], entryId: string, entryOf: (op: Op) => string | null): T | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    if (entryOf(item.op) !== entryId) continue;
    const canAbsorb = item.op.kind === "update" && (item.status === "queued" || item.status === "waiting");
    return canAbsorb ? item : null;
  }
  return null;
}

/**
 * Which entry revision to send as `expectedRevision`. A change carries the revision the person saw when they made it
 * (`base`). If the entry has moved on since, that's fine only when every step came from this device's own
 * committed changes; otherwise someone else changed it and the server must say "changed elsewhere" (409) rather
 * than this change silently overwriting theirs.
 */
export function revisionToSend(base: number, latest: number | undefined, ownRevisions: ReadonlySet<number> | undefined): number {
  if (latest === undefined || latest <= base) return base;
  for (let r = base + 1; r <= latest; r++) if (!ownRevisions?.has(r)) return base;
  return latest;
}

export interface StoredItem<Op> {
  key: string;
  op: Op;
  status: "queued" | "waiting" | "failed";
  createdAt: string;
  attempts: number;
  error?: string;
  code?: string;
}

/**
 * What survives a reload: unsent and refused changes with their idempotency keys (so a change that did reach the
 * server before the reload is never applied twice). Applied changes are left out; an in-flight one goes back to
 * the queue and is resent with the same key.
 */
export function toStored<Op>(list: readonly (QueueItem<Op> & { createdAt: string; attempts: number; error?: string; code?: string })[]): StoredItem<Op>[] {
  return list
    .filter((item) => item.status !== "committed")
    .map((item) => ({
      key: item.key,
      op: item.op,
      status: item.status === "sending" ? "queued" : (item.status as StoredItem<Op>["status"]),
      createdAt: item.createdAt,
      attempts: item.attempts,
      ...(item.error ? { error: item.error } : {}),
      ...(item.code ? { code: item.code } : {}),
    }));
}

/** Reads back what `toStored` wrote; anything unreadable is dropped rather than trusted. */
export function fromStored<Op>(raw: string | null, isOp: (op: unknown) => op is Op): StoredItem<Op>[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredItem<Op> =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as StoredItem<Op>).key === "string" &&
        ["queued", "waiting", "failed"].includes((item as StoredItem<Op>).status) &&
        isOp((item as StoredItem<Op>).op),
    );
  } catch {
    return [];
  }
}
