"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, newKey } from "@/lib/api-client";
import { normalizeText, optionalText, tidyText } from "@/lib/dish-name";
import type { SessionSnapshot, SnapshotEntry } from "@/lib/snapshot";

export type AddInput = {
  dishName: string;
  quantity: number;
  variant?: string | null;
  instructions?: string | null;
  attribution: { type: "UNASSIGNED" | "TABLE" } | { type: "INDIVIDUAL"; label?: string | null; participantId?: string | null } | { type: "GROUP"; label: string };
};

type Op =
  | { kind: "add"; input: AddInput }
  | { kind: "update"; entryId: string; expectedRevision: number; quantity: number }
  | { kind: "remove"; entryId: string }
  | { kind: "restore"; entryId: string }
  | { kind: "rename"; title: string | null };

export interface Pending {
  key: string;
  op: Op;
  status: "saving" | "failed";
  error?: string;
  createdAt: string;
}

export type SyncState = "saving" | "saved" | "unsynced" | "conflict" | "failed";

function request(sessionId: string, op: Op) {
  const base = `/api/sessions/${sessionId}`;
  switch (op.kind) {
    case "add":
      return { path: `${base}/entries`, method: "POST", body: op.input };
    case "update":
      return { path: `${base}/entries/${op.entryId}`, method: "PATCH", body: { expectedRevision: op.expectedRevision, quantity: op.quantity } };
    case "remove":
      return { path: `${base}/entries/${op.entryId}`, method: "DELETE", body: undefined };
    case "restore":
      return { path: `${base}/entries/${op.entryId}/restore`, method: "POST", body: undefined };
    case "rename":
      return { path: base, method: "PATCH", body: { title: op.title } };
  }
}

/**
 * The client's view of a session: the last committed server snapshot plus the changes still on their way. Pending
 * changes are drawn on top (marked as pending) and never silently dropped: a failure stays visible with Retry.
 * ponytail: refetches the whole snapshot after each change; per-event patches if payloads ever grow.
 */
export function useSession(initial: SessionSnapshot) {
  const [snapshot, setSnapshot] = useState(initial);
  const [pending, setPending] = useState<Pending[]>([]);
  const [online, setOnline] = useState(true);
  const revisionRef = useRef(initial.session.revision);

  const refresh = useCallback(async () => {
    const next = await api<SessionSnapshot>(`/api/sessions/${initial.session.id}/sync`);
    // Never step backwards: a slow response for an older revision is ignored.
    if (next.session.revision >= revisionRef.current) {
      revisionRef.current = next.session.revision;
      setSnapshot(next);
    }
    return next;
  }, [initial.session.id]);

  const send = useCallback(
    async (item: Pending) => {
      setPending((list) => list.map((p) => (p.key === item.key ? { ...p, status: "saving", error: undefined } : p)));
      const { path, method, body } = request(initial.session.id, item.op);
      try {
        const result = await api<{ result: { entryId?: string; revision?: number }; revision: number }>(path, { method, body, idempotencyKey: item.key });
        await refresh().catch(() => undefined);
        setPending((list) => list.filter((p) => p.key !== item.key));
        return result.result;
      } catch (error) {
        const err = error instanceof ApiError ? error : new ApiError(0, "UNKNOWN", "Something went wrong.");
        if (err.code === "CONFLICT" || err.code === "ENTRY_NOT_FOUND") {
          // The server moved on: show the latest state and drop the stale change, saying why.
          await refresh().catch(() => undefined);
        }
        setPending((list) => list.map((p) => (p.key === item.key ? { ...p, status: "failed", error: err.message } : p)));
        return null;
      }
    },
    [initial.session.id, refresh],
  );

  const mutate = useCallback(
    (op: Op) => {
      const item: Pending = { key: newKey(), op, status: "saving", createdAt: new Date().toISOString() };
      setPending((list) => [...list, item]);
      return send(item);
    },
    [send],
  );

  const retry = useCallback((key: string) => {
    const item = pending.find((p) => p.key === key);
    if (item) void send(item);
  }, [pending, send]);

  const dismiss = useCallback((key: string) => setPending((list) => list.filter((p) => p.key !== key)), []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const entries = useMemo(() => overlay(snapshot, pending), [snapshot, pending]);

  const sync: SyncState = pending.some((p) => p.status === "failed")
    ? pending.some((p) => p.error?.includes("changed")) ? "conflict" : online ? "failed" : "unsynced"
    : !online
      ? "unsynced"
      : pending.length > 0
        ? "saving"
        : "saved";

  return { snapshot, entries, pending, sync, mutate, retry, dismiss, refresh };
}

export type OverlayEntry = SnapshotEntry & { pending?: boolean };

/** Committed entries with pending changes drawn on top. A pending add joins its dish when the name already exists. */
function overlay(snapshot: SessionSnapshot, pending: Pending[]): OverlayEntry[] {
  let list: OverlayEntry[] = snapshot.entries;
  for (const { op, key, createdAt } of pending) {
    if (op.kind === "update") list = list.map((e) => (e.id === op.entryId ? { ...e, quantity: op.quantity, pending: true } : e));
    if (op.kind === "remove") list = list.filter((e) => e.id !== op.entryId);
    if (op.kind === "add") {
      const name = tidyText(op.input.dishName);
      const existing = list.find((e) => normalizeText(e.dishName) === normalizeText(name));
      const attribution = op.input.attribution;
      list = [
        ...list,
        {
          id: `pending:${key}`,
          roundId: snapshot.activeRoundId,
          dishId: existing?.dishId ?? `pending-dish:${normalizeText(name)}`,
          dishName: existing?.dishName ?? name,
          quantity: op.input.quantity,
          variant: optionalText(op.input.variant),
          instructions: optionalText(op.input.instructions),
          createdAt,
          revision: 0,
          submittedBy: snapshot.me.participantId,
          attribution: {
            type: attribution.type,
            label: "label" in attribution ? (attribution.label ?? null) : null,
            participantId: "participantId" in attribution ? (attribution.participantId ?? null) : null,
          },
          pending: true,
        },
      ];
    }
  }
  return list;
}
