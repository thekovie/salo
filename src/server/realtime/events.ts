import { and, asc, eq, gt } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { sessionEvents, sessions } from "@/server/db/schema";

/** One event as the stream sends it (brief 7.5). The id is the session revision, so ids are ordered and gap-free. */
export interface StreamEvent {
  id: number;
  sessionId: string;
  type: string;
  revision: number;
  at: string;
  payload: Record<string, unknown>;
}

/** Replay is capped: a client that missed more than this reloads the snapshot instead. */
export const REPLAY_LIMIT = 200;

export type Replay = { kind: "events"; events: StreamEvent[] } | { kind: "resync" };

/**
 * Events after `after`, from the durable log. Revisions are gap-free per session, so a missing revision means the
 * history is not available (or too long to replay) and the client must fetch the snapshot instead (brief 7.6).
 */
export async function eventsAfter(db: Db, sessionId: string, after: number): Promise<Replay> {
  const rows = await db
    .select()
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, sessionId), gt(sessionEvents.revision, after)))
    .orderBy(asc(sessionEvents.revision))
    .limit(REPLAY_LIMIT + 1);
  if (rows.length > REPLAY_LIMIT) return { kind: "resync" };
  if (rows.length === 0) {
    // Nothing logged after the cursor: fine if the session is really at that revision, a lost history otherwise.
    const [session] = await db.select({ revision: sessions.revision }).from(sessions).where(eq(sessions.id, sessionId));
    return session && session.revision > after ? { kind: "resync" } : { kind: "events", events: [] };
  }
  const contiguous = rows.every((row, i) => row.revision === after + 1 + i);
  if (!contiguous) return { kind: "resync" };
  return {
    kind: "events",
    events: rows.map((row) => ({ id: row.revision, sessionId: row.sessionId, type: row.eventType, revision: row.revision, at: row.createdAt.toISOString(), payload: row.payload as Record<string, unknown> })),
  };
}

/** Server-Sent Events wire format. */
export function formatEvent(event: StreamEvent): string {
  return `id: ${event.id}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`;
}

export function parseCursor(value: string | null | undefined): number | null {
  if (value == null || !/^\d{1,15}$/.test(value)) return null;
  return Number(value);
}
