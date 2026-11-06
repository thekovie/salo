import { and, count, eq, sql } from "drizzle-orm";
import { getEnv } from "@/env";
import { tidyText } from "@/lib/dish-name";
import { isJoinCode, normalizeJoinCode } from "@/lib/join-code";
import { hashToken, newToken } from "@/server/auth/credentials";
import type { Db } from "@/server/db/client";
import { participantCredentials, participants, rounds, sessionEvents, sessions } from "@/server/db/schema";
import { AppError, closed } from "@/server/errors";
import { EVENTS_CHANNEL } from "@/server/mutations";
import { LIMITS } from "@/server/orders/validation";

export interface InviteInfo {
  sessionId: string;
  title: string | null;
  status: "OPEN" | "CLOSED";
  roundNumber: number;
}

/** What an invite link may reveal before joining: the order's name and round, never dishes or people. */
export async function findInvite(db: Db, rawCode: string): Promise<InviteInfo | null> {
  const code = normalizeJoinCode(rawCode);
  if (!isJoinCode(code)) return null;
  const [row] = await db
    .select({ sessionId: sessions.id, title: sessions.title, status: sessions.status, roundNumber: sql<number>`coalesce(max(${rounds.roundNumber}), 1)` })
    .from(sessions)
    .leftJoin(rounds, eq(rounds.sessionId, sessions.id))
    .where(eq(sessions.joinCode, code))
    .groupBy(sessions.id);
  return row ?? null;
}

export interface Joined {
  sessionId: string;
  participantId: string;
  token: string;
}

/**
 * A guest joins with the session's code and a display name (brief 5.6). The invitation only ever creates GUEST
 * credentials. Display names may repeat; identity is the new participant id.
 */
export async function joinSession(db: Db, rawCode: string, rawName: string, expectedSessionId?: string): Promise<Joined> {
  const code = normalizeJoinCode(rawCode);
  const displayName = tidyText(rawName);
  if (!isJoinCode(code)) throw new AppError(404, "INVITE_NOT_FOUND", "That code doesn’t match an order. Check it with the host.");
  if (!displayName) throw new AppError(422, "INVALID", "Type your name so the table knows whose order is whose.");
  const days = getEnv().INACTIVE_RETENTION_DAYS;
  const token = newToken();

  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(sessions).where(eq(sessions.joinCode, code)).for("update");
    if (!session || (expectedSessionId && session.id !== expectedSessionId)) throw new AppError(404, "INVITE_NOT_FOUND", "That code doesn’t match an order. Check it with the host.");
    if (session.status === "CLOSED") throw closed();
    const [{ value: people }] = await tx.select({ value: count() }).from(participants).where(eq(participants.sessionId, session.id));
    if (people >= LIMITS.participantsPerSession) throw new AppError(422, "TABLE_FULL", `This order already has ${LIMITS.participantsPerSession} people.`);

    const [guest] = await tx.insert(participants).values({ sessionId: session.id, displayName, role: "GUEST" }).returning({ id: participants.id });
    await tx.insert(participantCredentials).values({ sessionId: session.id, participantId: guest.id, credentialType: "GUEST", credentialHash: hashToken(token) });
    const revision = session.revision + 1;
    await tx
      .update(sessions)
      .set({ revision, updatedAt: sql`now()`, lastActivityAt: sql`now()`, expiresAt: sql`now() + make_interval(days => ${days})` })
      .where(and(eq(sessions.id, session.id)));
    await tx.insert(sessionEvents).values({ sessionId: session.id, revision, eventType: "participant.joined", payload: { participantId: guest.id } });
    await tx.execute(sql`SELECT pg_notify(${EVENTS_CHANNEL}, ${`${session.id}:${revision}`})`);
    return { sessionId: session.id, participantId: guest.id, token };
  });
}
