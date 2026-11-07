import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { participantCredentials, participants, sessions } from "@/server/db/schema";
import type { Actor } from "@/lib/permissions";
import { hashToken } from "./credentials";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

type Identity = Actor & { removedAt: Date | null; removedReason: string | null };

/** The participant behind a session cookie, removed or not. Null when the token is missing, unknown, revoked or foreign. */
async function lookup(db: Db, sessionId: string, token: string | undefined): Promise<Identity | null> {
  if (!token || !isUuid(sessionId) || token.length > 128) return null;
  const [row] = await db
    .select({
      participantId: participants.id,
      role: participants.role,
      displayName: participants.displayName,
      sessionId: participants.sessionId,
      removedAt: participants.removedAt,
      removedReason: participants.removedReason,
    })
    .from(participantCredentials)
    .innerJoin(participants, eq(participants.id, participantCredentials.participantId))
    // An order past its deletion date is gone, even before the hourly cleanup removes it.
    .innerJoin(sessions, and(eq(sessions.id, participantCredentials.sessionId), gt(sessions.expiresAt, sql`now()`)))
    .where(
      and(
        eq(participantCredentials.credentialHash, hashToken(token)),
        eq(participantCredentials.sessionId, sessionId),
        isNull(participantCredentials.revokedAt),
        or(isNull(participantCredentials.expiresAt), gt(participantCredentials.expiresAt, sql`now()`)),
      ),
    );
  return row ?? null;
}

/**
 * Who is asking, from their session cookie. A guest the host removed is nobody here: they can join again as a new
 * guest, and every session route treats them as a stranger (see `removedFrom` for telling them why).
 */
export async function resolveActor(db: Db, sessionId: string, token: string | undefined): Promise<Actor | null> {
  const row = await lookup(db, sessionId, token);
  if (!row || row.removedAt) return null;
  return { participantId: row.participantId, role: row.role, displayName: row.displayName, sessionId: row.sessionId };
}

/** For a guest the host removed: the host's reason (possibly null). Undefined for everyone else. */
export async function removedFrom(db: Db, sessionId: string, token: string | undefined): Promise<{ reason: string | null } | undefined> {
  const row = await lookup(db, sessionId, token);
  return row?.removedAt ? { reason: row.removedReason } : undefined;
}
