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
  /** The served count the first unsent tap stood on; sent as `expectedServed` so a tap on a stale count applies nothing. */
  seen: number;
  /** `seen` of the batch being sent (kept for a retry). */
  expected: number;
}

export type LineEdit = ServedEdit & { roundId: string; lineKey: string };

/** One more tap on a line's edit; null when nothing is left to send, show or retry. */
export function applyTap<E extends ServedEdit>(edit: E | undefined, delta: number, seen: number): E | null {
  const base = edit ?? { unsent: 0, sending: 0, key: null, failed: null, committedRevision: null, seen, expected: seen };
  const next = { ...base, unsent: base.unsent + delta, seen: base.unsent === 0 ? seen : base.seen } as E;
  return next.unsent === 0 && !next.sending && !next.failed ? null : next;
}

/** A sent delta stops counting once a snapshot at or past its revision holds it (the rule applySnapshot uses). */
export const settle = <E extends ServedEdit>(edit: E, revision: number): E => (edit.committedRevision !== null && edit.committedRevision <= revision ? { ...edit, sending: 0 } : edit);

const idOf = (roundId: string, lineKey: string) => `${roundId}|${lineKey}`;

const servedKey = (sessionId: string) => `salo:served:${sessionId}`;

/**
 * What survives a reload: taps not sent yet, refused ones, and sends whose answer never arrived (kept with their key and
 * `expected`, so a resend replays instead of counting twice). Accepted ones are left out; the snapshot has them.
 */
export function toStoredServed(list: readonly LineEdit[]): LineEdit[] {
  return list
    .filter((e) => e.unsent > 0 || e.failed || (e.sending > 0 && e.committedRevision === null))
    .map((e) => ({ ...e, failed: null, committedRevision: null }));
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** Reads back what `toStoredServed` wrote; anything unreadable is dropped rather than trusted. */
export function fromStoredServed(raw: string | null): LineEdit[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item: Partial<LineEdit> | null) => {
      if (!item || typeof item.roundId !== "string" || typeof item.lineKey !== "string") return [];
      if (![item.unsent, item.sending, item.seen, item.expected].every(isCount)) return [];
      if (item.sending && typeof item.key !== "string") return [];
      const edit: LineEdit = { roundId: item.roundId, lineKey: item.lineKey, unsent: item.unsent!, sending: item.sending!, key: item.sending ? item.key! : null, failed: null, committedRevision: null, seen: item.seen!, expected: item.expected! };
      return edit.unsent || edit.sending ? [edit] : [];
    });
  } catch {
    return [];
  }
}

function writeStored(sessionId: string, list: readonly LineEdit[]) {
  try {
    const keep = toStoredServed(list);
    if (keep.length) window.localStorage.setItem(servedKey(sessionId), JSON.stringify(keep));
    else window.localStorage.removeItem(servedKey(sessionId));
  } catch {
    // Storage blocked or full: taps still work, they just don't survive a reload.
  }
}

/**
 * The served taps of the host and co-hosts: shown at once, sent as one delta per line after a short pause. A failed send keeps its
 * delta and idempotency key so "Try again" can never count twice; the server clamps to 0..expected.
 */
export function useServedEdits(sessionId: string, refresh: () => Promise<unknown>, revision: number, canServe: boolean) {
  const edits = useRef<Record<string, LineEdit>>({});
  const [view, setView] = useState<Record<string, ServedEdit>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const put = useCallback((id: string, next: LineEdit | null) => {
    const rest = { ...edits.current };
    delete rest[id];
    edits.current = next ? { ...rest, [id]: next } : rest;
    setView(edits.current);
    writeStored(sessionId, Object.values(edits.current));
  }, [sessionId]);

  /** Revoked (or removed): nothing left to send, and no stuck "Couldn’t save this" row. */
  const dropAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    edits.current = {};
    setView({});
    writeStored(sessionId, []);
  }, [sessionId]);

  // Losing the role drops every edit, so a later re-grant can't bring back a dead tap. View is reset during render
  // (React's "previous value" pattern); refs and timers in the effect.
  const [servedWith, setServedWith] = useState(canServe);
  if (servedWith !== canServe) {
    setServedWith(canServe);
    if (!canServe) setView({});
  }
  useEffect(() => {
    if (canServe) return;
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    edits.current = {};
    writeStored(sessionId, []);
  }, [canServe, sessionId]);

  const send = useCallback(
    async (id: string) => {
      for (;;) {
        let e = edits.current[id];
        if (!e || (e.sending && !e.failed)) return;
        if (!e.sending) {
          if (!e.unsent) return;
          e = { ...e, sending: e.unsent, unsent: 0, key: newKey(), committedRevision: null, expected: e.seen };
        }
        put(id, { ...e, failed: null });
        try {
          const done = await api<{ revision: number }>(`/api/sessions/${sessionId}/serving`, { method: "POST", body: { roundId: e.roundId, lineKey: e.lineKey, expectedServed: e.expected, delta: e.sending }, idempotencyKey: e.key ?? newKey() });
          if (!edits.current[id]) return;
          put(id, { ...edits.current[id], committedRevision: done.revision });
          await refresh().catch(() => undefined);
        } catch (error) {
          if (error instanceof ApiError && error.status === 403) return dropAll();
          if (!edits.current[id]) return;
          put(id, { ...edits.current[id], failed: error instanceof ApiError ? error.message : "Couldn’t save." });
          return;
        }
        if (!edits.current[id]) return;
        const now = { ...edits.current[id], sending: 0, key: null, committedRevision: null };
        put(id, now.unsent ? now : null);
        if (!now.unsent) return;
        await new Promise((resolve) => setTimeout(resolve, SERVED_COALESCE_MS));
      }
    },
    [sessionId, refresh, put, dropAll],
  );

  const bump = useCallback(
    (roundId: string, lineKey: string, delta: number, seen: number, immediately = false) => {
      const id = idOf(roundId, lineKey);
      clearTimeout(timers.current.get(id));
      const next = applyTap(edits.current[id] ?? { roundId, lineKey, unsent: 0, sending: 0, key: null, failed: null, committedRevision: null, seen, expected: seen }, delta, seen);
      put(id, next);
      if (next) timers.current.set(id, setTimeout(() => void send(id), immediately ? 0 : SERVED_COALESCE_MS));
    },
    [put, send],
  );

  const retry = useCallback((roundId: string, lineKey: string) => void send(idOf(roundId, lineKey)), [send]);

  // A reload with unsent or unanswered taps: resend them (in-flight ones with their stored key, so nothing counts twice).
  useEffect(() => {
    if (!canServe) return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(servedKey(sessionId));
    } catch {
      return;
    }
    for (const stored of fromStoredServed(raw)) {
      const id = idOf(stored.roundId, stored.lineKey);
      if (edits.current[id]) continue;
      // `failed` marks an in-flight send as resendable (send() skips one that is still being awaited).
      put(id, { ...stored, failed: stored.sending ? "Couldn’t save." : null });
      void send(id);
    }
  }, [sessionId, canServe, put, send]);

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
