import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { getEnv } from "@/env";
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from "@/lib/join-code";
import { hashToken, newToken } from "@/server/auth/credentials";
import type { Db } from "@/server/db/client";
import { participantCredentials, participants, rounds, sessionEvents, sessions } from "@/server/db/schema";

const MAX_CODE_ATTEMPTS = 8;

export function randomJoinCode(): string {
  return Array.from({ length: JOIN_CODE_LENGTH }, () => JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)]).join("");
}

export interface CreatedSession {
  sessionId: string;
  participantId: string;
  /** Raw host token: goes into the HttpOnly cookie and nowhere else. */
  token: string;
}

function isJoinCodeClash(error: unknown): boolean {
  const cause = (error as { cause?: { constraint_name?: string } }).cause;
  return cause?.constraint_name === "sessions_join_code_uq";
}

/**
 * "Start an order" (brief 5.2): a session, its host, the host's credential and draft Round 1, in one transaction.
 * No name, restaurant or headcount is required.
 */
export async function createSession(db: Db, title: string | null = null): Promise<CreatedSession> {
  const days = getEnv().INACTIVE_RETENTION_DAYS;
  for (let attempt = 1; ; attempt++) {
    const token = newToken();
    try {
      return await db.transaction(async (tx) => {
        const [session] = await tx
          .insert(sessions)
          .values({ title, joinCode: randomJoinCode(), revision: 1, expiresAt: sql`now() + make_interval(days => ${days})` })
          .returning({ id: sessions.id });
        const [host] = await tx.insert(participants).values({ sessionId: session.id, displayName: "Host", role: "HOST" }).returning({ id: participants.id });
        await tx.insert(participantCredentials).values({ sessionId: session.id, participantId: host.id, credentialType: "HOST", credentialHash: hashToken(token) });
        await tx.insert(rounds).values({ sessionId: session.id, roundNumber: 1 });
        await tx.insert(sessionEvents).values({ sessionId: session.id, revision: 1, eventType: "session.created", payload: {} });
        return { sessionId: session.id, participantId: host.id, token };
      });
    } catch (error) {
      // 32^6 codes: a clash is rare; try a fresh code a few times before giving up.
      if (isJoinCodeClash(error) && attempt < MAX_CODE_ATTEMPTS) continue;
      throw error;
    }
  }
}
