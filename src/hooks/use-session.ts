"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, ApiError, newKey } from "@/lib/api-client";
import { coalesceTarget, fromStored, nextToSend, revisionToSend, toStored } from "@/lib/queue";
import { normalizeText, optionalText, tidyText } from "@/lib/dish-name";
import type { SessionSnapshot, SnapshotEntry } from "@/lib/snapshot";

export type AddInput = {
  dishName: string;
  quantity: number;
  variant?: string | null;
  instructions?: string | null;
  attribution: { type: "UNASSIGNED" | "TABLE" } | { type: "INDIVIDUAL"; label?: string | null; participantId?: string | null } | { type: "GROUP"; label: string };
  /** The round the person was adding to. The server refuses (ROUND_CLOSED) if it was confirmed meanwhile. */
  roundId?: string;
};

export type Op =
  | { kind: "add"; input: AddInput }
  | { kind: "update"; entry: SnapshotEntry; quantity: number }
  | { kind: "remove"; entry: SnapshotEntry }
  | { kind: "restore"; entry: SnapshotEntry }
  | { kind: "rename"; title: string | null }
  | { kind: "ready"; ready: boolean }
  | { kind: "claim"; batchId: string; dishName: string }
  | { kind: "resolveClaim"; claimId: string; approve: boolean; dishName: string }
  | { kind: "groupMembers"; label: string; memberIds: string[] }
  | { kind: "confirm"; roundId: string; roundNumber: number; expectedRevision: number }
  | { kind: "openRound"; roundNumber: number }
  | { kind: "correction"; sourceEntryId: string; dishName: string; type: "QUANTITY" | "REPLACE"; quantity?: number; replacement?: string; explanation?: string }
  | { kind: "removeCorrection"; correctionId: string; dishName: string }
  | { kind: "close" }
  | { kind: "removeGuest"; participantId: string; name: string; reason: string | null }
  | { kind: "restoreGuest"; participantId: string; name: string };

type Status =
  | "queued" // waiting its turn
  | "sending" // request in flight
  | "waiting" // no connection: retried automatically with backoff (same idempotency key, so never applied twice)
  | "committed" // the server applied it; kept on screen until a snapshot at least this new arrives
  | "failed"; // refused by the server; not drawn, listed with the reason until dismissed

export interface Pending {
  key: string;
  op: Op;
  status: Status;
  createdAt: string;
  error?: string;
  code?: string;
  committedRevision?: number;
  attempts: number;
}

export type SyncState = "saving" | "saved" | "reconnecting" | "unsynced" | "conflict" | "failed";

type MutationResponse = { result: { entryId?: string; revision?: number }; revision: number };

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;
const RESYNC_INTERVAL_MS = 5000;
/** When the stream was refused outright (EventSource gives up), try a fresh connection after this long. */
const STREAM_RESTART_MS = 5000;
const STREAM_RESTART_MAX_MS = 60_000;
const REFRESH_RETRY_MS = 3000;
/** Without live updates (stream refused or down), catch up this often so the ticket never goes stale. */
const POLL_WITHOUT_STREAM_MS = 10_000;

/** The entry a change is about, if any (for coalescing and revision tracking). */
export const entryOf = (op: Op): string | null => (op.kind === "update" || op.kind === "remove" || op.kind === "restore" ? op.entry.id : null);

const OP_KINDS = new Set(["add", "update", "remove", "restore", "rename", "ready", "claim", "resolveClaim", "groupMembers", "confirm", "openRound", "correction", "removeCorrection", "close", "removeGuest", "restoreGuest"]);
const isOp = (value: unknown): value is Op => typeof value === "object" && value !== null && OP_KINDS.has((value as { kind?: string }).kind ?? "");

function request(sessionId: string, op: Op, latest: SessionSnapshot, ownRevisions: ReadonlyMap<string, ReadonlySet<number>>) {
  const base = `/api/sessions/${sessionId}`;
  switch (op.kind) {
    case "add":
      return { path: `${base}/entries`, method: "POST", body: op.input as unknown };
    case "update": {
      // The revision the person saw when they made the change, moved forward only over this device's own changes:
      // if someone else changed the entry meanwhile, the server says so (409) instead of being silently overwritten.
      const current = latest.entries.find((e) => e.id === op.entry.id);
      const expectedRevision = revisionToSend(op.entry.revision, current?.revision, ownRevisions.get(op.entry.id));
      return { path: `${base}/entries/${op.entry.id}`, method: "PATCH", body: { expectedRevision, quantity: op.quantity } };
    }
    case "remove":
      return { path: `${base}/entries/${op.entry.id}`, method: "DELETE", body: undefined };
    case "restore":
      return { path: `${base}/entries/${op.entry.id}/restore`, method: "POST", body: undefined };
    case "rename":
      return { path: base, method: "PATCH", body: { title: op.title } };
    case "ready":
      return { path: `${base}/readiness`, method: "PUT", body: { ready: op.ready } };
    case "claim":
      return { path: `${base}/claims`, method: "POST", body: { batchId: op.batchId } };
    case "resolveClaim":
      return { path: `${base}/claims/${op.claimId}/${op.approve ? "approve" : "reject"}`, method: "POST", body: undefined };
    case "groupMembers":
      return { path: `${base}/groups`, method: "PUT", body: { label: op.label, memberIds: op.memberIds } };
    case "confirm":
      return { path: `${base}/rounds/${op.roundId}/confirm`, method: "POST", body: { expectedRevision: op.expectedRevision } };
    case "openRound":
      return { path: `${base}/rounds`, method: "POST", body: undefined };
    case "correction":
      return { path: `${base}/corrections`, method: "POST", body: { sourceEntryId: op.sourceEntryId, type: op.type, quantity: op.quantity, replacement: op.replacement, explanation: op.explanation } };
    case "removeCorrection":
      return { path: `${base}/corrections/${op.correctionId}`, method: "DELETE", body: undefined };
    case "close":
      return { path: `${base}/close`, method: "POST", body: undefined };
    case "removeGuest":
      return { path: `${base}/participants/${op.participantId}/remove`, method: "POST", body: { reason: op.reason } };
    case "restoreGuest":
      return { path: `${base}/participants/${op.participantId}/restore`, method: "POST", body: undefined };
  }
}

/** What a change was, in words, for the "not saved" list. */
export function describeOp(op: Op): string {
  switch (op.kind) {
    case "add":
      return `Add ${tidyText(op.input.dishName)} ×${op.input.quantity}`;
    case "update":
      return `Change ${op.entry.dishName} to ×${op.quantity}`;
    case "remove":
      return `Remove ${op.entry.dishName}`;
    case "restore":
      return `Bring back ${op.entry.dishName}`;
    case "rename":
      return "Rename the order";
    case "ready":
      return op.ready ? "Mark yourself ready" : "Mark yourself not ready";
    case "claim":
      return `Claim ${op.dishName}`;
    case "resolveClaim":
      return `${op.approve ? "Approve" : "Decline"} the claim for ${op.dishName}`;
    case "groupMembers":
      return `Update ${op.label}`;
    case "confirm":
      return `Confirm round ${op.roundNumber}`;
    case "openRound":
      return `Start round ${op.roundNumber}`;
    case "correction":
      return `Correct ${op.dishName}`;
    case "removeCorrection":
      return `Remove the correction for ${op.dishName}`;
    case "close":
      return "End the order";
    case "removeGuest":
      return `Remove ${op.name}`;
    case "restoreGuest":
      return `Bring back ${op.name}`;
  }
}

/**
 * The client's view of a session: the last committed snapshot plus changes still on their way, drawn on top and
 * marked pending. Changes go to the server one at a time, in the order they were made (so Undo can never overtake
 * the change it undoes); a quantity tapped several times while waiting is sent once, with the final number. A
 * change leaves the screen only when a snapshot that includes it has arrived, so nothing silently disappears.
 * ponytail: refetches the whole snapshot after each change; per-event patches if payloads ever grow.
 */
export function useSession(initial: SessionSnapshot) {
  const sessionId = initial.session.id;
  const [snapshot, setSnapshotState] = useState(initial);
  const snapshotRef = useRef(initial);
  const [pending, setPendingState] = useState<Pending[]>([]);
  const queueRef = useRef<Pending[]>([]);
  const resolvers = useRef(new Map<string, { resolve: (result: MutationResponse["result"] | null) => void; onError?: (message: string) => void }>());
  const pumping = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  // Entry revisions produced by this device's own committed changes (see revisionToSend).
  const ownRevisions = useRef(new Map<string, Set<number>>());
  const storageKey = `salo:queue:${sessionId}`;

  const setQueue = useCallback(
    (update: (list: Pending[]) => Pending[]) => {
      queueRef.current = update(queueRef.current);
      setPendingState(queueRef.current);
      // Unsent and refused changes survive a reload, with their idempotency keys (never applied twice).
      try {
        const stored = toStored(queueRef.current);
        if (stored.length) localStorage.setItem(storageKey, JSON.stringify(stored));
        else localStorage.removeItem(storageKey);
      } catch {
        // Storage blocked: the queue lives in memory only.
      }
    },
    [storageKey],
  );

  const patch = useCallback((key: string, fields: Partial<Pending>) => setQueue((list) => list.map((p) => (p.key === key ? { ...p, ...fields } : p))), [setQueue]);

  const finish = useCallback((key: string, result: MutationResponse["result"] | null, error?: string) => {
    const entry = resolvers.current.get(key);
    if (error) entry?.onError?.(error);
    entry?.resolve(result);
    resolvers.current.delete(key);
  }, []);

  /** Apply a snapshot (never an older one) and drop the committed changes it already contains. */
  const applySnapshot = useCallback(
    (next: SessionSnapshot) => {
      if (next.session.revision < snapshotRef.current.session.revision) return;
      snapshotRef.current = next;
      setSnapshotState(next);
      setQueue((list) => list.filter((p) => !(p.status === "committed" && (p.committedRevision ?? Infinity) <= next.session.revision)));
    },
    [setQueue],
  );

  const refresh = useCallback(async () => {
    const next = await api<SessionSnapshot>(`/api/sessions/${sessionId}/sync`);
    applySnapshot(next);
    return next;
  }, [sessionId, applySnapshot]);

  // Many events can arrive at once (a burst of taps elsewhere): fetch the snapshot once, then once more if needed.
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  const scheduleRefresh = useCallback(async () => {
    if (refreshing.current) {
      refreshAgain.current = true;
      return;
    }
    refreshing.current = true;
    let failed = false;
    try {
      do {
        refreshAgain.current = false;
        failed = await refresh().then(
          () => false,
          () => true,
        );
      } while (refreshAgain.current && !failed);
    } finally {
      refreshing.current = false;
    }
    // The event that asked for this fetch will not be replayed, so a failed fetch must retry on its own.
    if (failed) setTimeout(() => void scheduleRefreshRef.current(), REFRESH_RETRY_MS);
  }, [refresh]);
  const scheduleRefreshRef = useRef(scheduleRefresh);
  useEffect(() => {
    scheduleRefreshRef.current = scheduleRefresh;
  }, [scheduleRefresh]);

  const [stream, setStream] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [streamGeneration, setStreamGeneration] = useState(0);
  const restarts = useRef(0);

  // Live updates (brief 7.5–7.6): events say "something changed at revision N"; the snapshot says what. EventSource
  // reconnects by itself and sends Last-Event-ID, so the server replays what was missed (or asks for a resync).
  useEffect(() => {
    const source = new EventSource(`/api/sessions/${sessionId}/events?after=${snapshotRef.current.session.revision}`);
    let dropped = false;
    let restart: ReturnType<typeof setTimeout> | undefined;
    source.addEventListener("change", (event) => {
      if (Number((event as MessageEvent).lastEventId) > snapshotRef.current.session.revision) void scheduleRefresh();
    });
    source.addEventListener("resync", () => void scheduleRefresh());
    source.onopen = () => {
      restarts.current = 0;
      setStream("live");
      // Back after a drop: make sure nothing was missed even if replay was partial.
      if (dropped) void scheduleRefresh();
      dropped = false;
    };
    source.onerror = () => {
      dropped = true;
      setStream("reconnecting");
      if (source.readyState === EventSource.CLOSED) {
        // Refused outright (busy, gone, not allowed): back off instead of hammering the server.
        const delay = Math.min(STREAM_RESTART_MS * 2 ** restarts.current, STREAM_RESTART_MAX_MS);
        restarts.current += 1;
        restart = setTimeout(() => setStreamGeneration((g) => g + 1), delay);
      }
    };
    return () => {
      source.close();
      if (restart) clearTimeout(restart);
    };
  }, [sessionId, scheduleRefresh, streamGeneration]);

  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        // Strictly in order: a change still waiting for the network holds back everything after it.
        const item = nextToSend(queueRef.current);
        if (!item) break;
        patch(item.key, { status: "sending" });
        const { path, method, body } = request(sessionId, item.op, snapshotRef.current, ownRevisions.current);
        try {
          const response = await api<MutationResponse>(path, { method, body, idempotencyKey: item.key });
          const entryId = entryOf(item.op);
          if (entryId && typeof response.result.revision === "number") {
            ownRevisions.current.set(entryId, (ownRevisions.current.get(entryId) ?? new Set()).add(response.result.revision));
          }
          patch(item.key, { status: "committed", committedRevision: response.revision });
          finish(item.key, response.result);
          // If this refresh fails, the change stays drawn as committed and the resync timer catches up.
          await refresh().catch(() => undefined);
        } catch (error) {
          const err = error instanceof ApiError ? error : new ApiError(0, "NETWORK", "No connection.");
          if (err.isNetwork) {
            // Pause the whole queue: later changes may depend on this one. Retried with the same key.
            const attempts = item.attempts + 1;
            patch(item.key, { status: "waiting", attempts, error: err.message, code: err.code });
            const delay = Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
            if (retryTimer.current) clearTimeout(retryTimer.current);
            retryTimer.current = setTimeout(() => {
              setQueue((list) => list.map((p) => (p.status === "waiting" ? { ...p, status: "queued" } : p)));
              void pump();
            }, delay);
            break;
          }
          // Refused (conflict, removed, confirmed, invalid…): show the latest state and say what was not saved.
          if (err.status === 409 || err.status === 404) await refresh().catch(() => undefined);
          if (resolvers.current.get(item.key)?.onError) {
            // The caller reports this failure itself (e.g. confirmation): nothing to list as "not saved".
            setQueue((list) => list.filter((p) => p.key !== item.key));
          } else {
            patch(item.key, { status: "failed", error: err.message, code: err.code });
          }
          finish(item.key, null, err.message);
        }
      }
    } finally {
      pumping.current = false;
    }
  }, [sessionId, patch, finish, refresh, setQueue]);

  const mutate = useCallback(
    (op: Op, options: { onError?: (message: string) => void } = {}): Promise<MutationResponse["result"] | null> => {
      // Several taps on one stepper before the earlier one was sent (queued or waiting for the network): keep one
      // change with the final number, still based on the revision the first tap saw.
      if (op.kind === "update") {
        const target = coalesceTarget(queueRef.current, op.entry.id, entryOf);
        if (target) {
          patch(target.key, { op: { ...op, entry: (target.op as Extract<Op, { kind: "update" }>).entry } });
          return Promise.resolve(null);
        }
      }
      const item: Pending = { key: newKey(), op, status: "queued", createdAt: new Date().toISOString(), attempts: 0 };
      const promise = new Promise<MutationResponse["result"] | null>((resolve) => resolvers.current.set(item.key, { resolve, onError: options.onError }));
      setQueue((list) => [...list, item]);
      void pump();
      return promise;
    },
    [patch, pump, setQueue],
  );

  const dismiss = useCallback((key: string) => setQueue((list) => list.filter((p) => p.key !== key)), [setQueue]);
  /**
   * Send a refused change again, in its original place in the order. Same idempotency key, so it can never be applied
   * twice; a changed request (e.g. "add to round 2 instead") gets a new key, since it is a different change.
   */
  const retry = useCallback(
    (key: string, changeOp?: (op: Op) => Op) => {
      setQueue((list) =>
        list.map((p) => (p.key === key ? { ...p, ...(changeOp ? { op: changeOp(p.op), key: newKey() } : {}), status: "queued", error: undefined, code: undefined } : p)),
      );
      void pump();
    },
    [setQueue, pump],
  );

  // After a reload: bring back changes that were never sent (or were refused), then send them in order.
  useEffect(() => {
    const timer = setTimeout(() => {
      let stored: ReturnType<typeof fromStored<Op>> = [];
      try {
        stored = fromStored(localStorage.getItem(storageKey), isOp);
      } catch {
        return;
      }
      if (stored.length === 0) return;
      const known = new Set(queueRef.current.map((p) => p.key));
      setQueue((list) => [...stored.filter((s) => !known.has(s.key)).map((s) => ({ ...s, attempts: s.attempts ?? 0 })), ...list]);
      void pump();
    }, 0);
    return () => clearTimeout(timer);
  }, [storageKey, setQueue, pump]);

  // Catch up whenever we may have missed something: back online, tab visible again, and while changes await a snapshot.
  useEffect(() => {
    const resume = () => {
      if (!navigator.onLine) return;
      setQueue((list) => list.map((p) => (p.status === "waiting" ? { ...p, status: "queued" } : p)));
      void pump();
      void refresh().catch(() => undefined);
    };
    const visible = () => document.visibilityState === "visible" && resume();
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", visible);
    const timer = setInterval(() => {
      if (queueRef.current.some((p) => p.status === "committed")) void refresh().catch(() => undefined);
    }, RESYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", visible);
      clearInterval(timer);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [pump, refresh, setQueue]);

  // No live connection (refused when a crowded Wi-Fi hits the per-address cap, or simply down): poll instead.
  useEffect(() => {
    if (stream === "live") return;
    const timer = setInterval(() => {
      if (navigator.onLine && document.visibilityState === "visible") void refresh().catch(() => undefined);
    }, POLL_WITHOUT_STREAM_MS);
    return () => clearInterval(timer);
  }, [stream, refresh]);

  const entries = useMemo(() => overlay(snapshot, pending), [snapshot, pending]);

  const failed = pending.filter((p) => p.status === "failed");
  const sync: SyncState = failed.some((p) => p.code === "CONFLICT")
    ? "conflict"
    : failed.length > 0
      ? "failed"
      : !online || pending.some((p) => p.status === "waiting")
        ? "unsynced"
        : pending.length > 0
          ? "saving"
          : stream === "reconnecting"
            ? "reconnecting"
            : "saved";

  /** The latest committed version of an entry (for Undo after an add). */
  const entryById = useCallback((id: string) => snapshotRef.current.entries.find((e) => e.id === id), []);

  return { snapshot, entries, pending, failed, sync, mutate, dismiss, retry, refresh, entryById, online, stream };
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export type OverlayEntry = SnapshotEntry & { pending?: boolean };

/**
 * Committed entries with unconfirmed changes drawn on top. Refused changes are not drawn. A pending add joins its dish
 * when the name already exists and sorts after everything the server has (no client-clock reordering).
 */
export function overlay(snapshot: SessionSnapshot, pending: Pending[]): OverlayEntry[] {
  let list: OverlayEntry[] = snapshot.entries;
  const latest = snapshot.entries.reduce((max, e) => (e.createdAt > max ? e.createdAt : max), "");
  let order = 0;
  for (const { op, key, status } of pending) {
    if (status === "failed") continue;
    if (op.kind === "update") list = list.map((e) => (e.id === op.entry.id ? { ...e, quantity: op.quantity, pending: true } : e));
    if (op.kind === "remove") list = list.filter((e) => e.id !== op.entry.id);
    if (op.kind === "restore" && !list.some((e) => e.id === op.entry.id)) list = [...list, { ...op.entry, pending: true }];
    if (op.kind === "add") {
      if (status === "committed") continue; // the snapshot that includes it is on its way; drawn below until then
      list = [...list, pendingAdd(snapshot, op.input, key, latest, order++)];
    }
  }
  // Committed adds whose snapshot has not arrived yet stay visible.
  for (const { op, key, status } of pending) {
    if (op.kind === "add" && status === "committed") list = [...list, pendingAdd(snapshot, op.input, key, latest, order++)];
  }
  return list;
}

function pendingAdd(snapshot: SessionSnapshot, input: AddInput, key: string, latest: string, order: number): OverlayEntry {
  const name = tidyText(input.dishName);
  const existing = snapshot.entries.find((e) => normalizeText(e.dishName) === normalizeText(name));
  const attribution = input.attribution;
  return {
    id: `pending:${key}`,
    roundId: input.roundId ?? snapshot.activeRoundId,
    batchId: `pending:${key}`,
    dishId: existing?.dishId ?? `pending-dish:${normalizeText(name)}`,
    dishName: existing?.dishName ?? name,
    quantity: input.quantity,
    variant: optionalText(input.variant),
    instructions: optionalText(input.instructions),
    // Sorts after every server entry, in the order the adds were made.
    createdAt: `${latest || "0"}~${String(order).padStart(4, "0")}`,
    revision: 0,
    submittedBy: snapshot.me.participantId,
    attribution: {
      type: attribution.type,
      label: "label" in attribution ? (attribution.label ?? null) : null,
      participantId: "participantId" in attribution ? (attribution.participantId ?? null) : null,
    },
    pending: true,
  };
}
