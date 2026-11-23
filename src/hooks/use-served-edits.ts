"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, newKey } from "@/lib/api-client";

/** Taps on one line collected into one request this long after the last tap (the mutation limiter is 120/min). */
export const SERVED_COALESCE_MS = 300;

export interface ServedEdit {
  /** Tapped, not sent yet. */
  unsent: number;
  /** Sent (or being retried) and not yet in a snapshot. */
  sending: number;
  key: string | null;
  failed: string | null;
  /** The session revision the accepted POST produced; the snapshot holding it already counts `sending`. */
  committedRevision: number | null;
}

type LineEdit = ServedEdit & { roundId: string; lineKey: string };

/** One more tap on a line's edit; null when nothing is left to send, show or retry. */
export function applyTap<E extends ServedEdit>(edit: E | undefined, delta: number): E | null {
  const next = { ...(edit ?? { unsent: 0, sending: 0, key: null, failed: null, committedRevision: null }), unsent: (edit?.unsent ?? 0) + delta } as E;
  return next.unsent === 0 && !next.sending && !next.failed ? null : next;
}

/** A sent delta stops counting once a snapshot at or past its revision holds it (the rule applySnapshot uses). */
export const settle = <E extends ServedEdit>(edit: E, revision: number): E => (edit.committedRevision !== null && edit.committedRevision <= revision ? { ...edit, sending: 0 } : edit);

const idOf = (roundId: string, lineKey: string) => `${roundId}|${lineKey}`;

/**
 * The host's served taps: shown at once, sent as one delta per line after a short pause. A failed send keeps its
 * delta and idempotency key so "Try again" can never count twice; the server clamps to 0..expected.
 */
export function useServedEdits(sessionId: string, refresh: () => Promise<unknown>, revision: number) {
  const edits = useRef<Record<string, LineEdit>>({});
  const [view, setView] = useState<Record<string, ServedEdit>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const put = useCallback((id: string, next: LineEdit | null) => {
    const rest = { ...edits.current };
    delete rest[id];
    edits.current = next ? { ...rest, [id]: next } : rest;
    setView(edits.current);
  }, []);

  const send = useCallback(
    async (id: string) => {
      for (;;) {
        let e = edits.current[id];
        if (!e || (e.sending && !e.failed)) return;
        if (!e.sending) {
          if (!e.unsent) return;
          e = { ...e, sending: e.unsent, unsent: 0, key: newKey(), committedRevision: null };
        }
        put(id, { ...e, failed: null });
        try {
          const done = await api<{ revision: number }>(`/api/sessions/${sessionId}/serving`, { method: "POST", body: { roundId: e.roundId, lineKey: e.lineKey, delta: e.sending }, idempotencyKey: e.key ?? newKey() });
          put(id, { ...edits.current[id], committedRevision: done.revision });
          await refresh().catch(() => undefined);
        } catch (error) {
          put(id, { ...edits.current[id], failed: error instanceof ApiError ? error.message : "Couldn’t save." });
          return;
        }
        const now = { ...edits.current[id], sending: 0, key: null, committedRevision: null };
        put(id, now.unsent ? now : null);
        if (!now.unsent) return;
        await new Promise((resolve) => setTimeout(resolve, SERVED_COALESCE_MS));
      }
    },
    [sessionId, refresh, put],
  );

  const bump = useCallback(
    (roundId: string, lineKey: string, delta: number, immediately = false) => {
      const id = idOf(roundId, lineKey);
      clearTimeout(timers.current.get(id));
      const next = applyTap(edits.current[id] ?? { roundId, lineKey, unsent: 0, sending: 0, key: null, failed: null, committedRevision: null }, delta);
      put(id, next);
      if (next) timers.current.set(id, setTimeout(() => void send(id), immediately ? 0 : SERVED_COALESCE_MS));
    },
    [put, send],
  );

  const retry = useCallback((roundId: string, lineKey: string) => void send(idOf(roundId, lineKey)), [send]);

  useEffect(() => {
    const resend = () => Object.keys(edits.current).forEach((id) => edits.current[id]?.failed && void send(id));
    window.addEventListener("online", resend);
    return () => window.removeEventListener("online", resend);
  }, [send]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const settled = useMemo(() => Object.fromEntries(Object.entries(view).map(([id, e]) => [id, settle(e, revision)])), [view, revision]);
  return { edits: settled, bump, retry };
}
