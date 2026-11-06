import "server-only";
import { desc, eq, inArray, and } from "drizzle-orm";
import { cookies } from "next/headers";
import { hashToken, sessionIdFromCookieName } from "@/server/auth/credentials";
import { isUuid } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { participantCredentials, participants, rounds, sessions } from "@/server/db/schema";

const MAX_RESUME = 5;

export interface Resumable {
  id: string;
  title: string | null;
  role: "HOST" | "GUEST";
  status: "OPEN" | "CLOSED";
  roundNumber: number;
  updatedAt: string;
}

/** Sessions this browser holds a valid credential for (brief 5.1 "Resume"), newest first. */
export async function listResumable(): Promise<Resumable[]> {
  const pairs = (await cookies())
    .getAll()
    .map((c) => ({ sessionId: sessionIdFromCookieName(c.name), hash: hashToken(c.value) }))
    .filter((p): p is { sessionId: string; hash: string } => p.sessionId !== null && isUuid(p.sessionId))
    .slice(0, 20);
  if (pairs.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({ id: sessions.id, title: sessions.title, status: sessions.status, updatedAt: sessions.updatedAt, role: participants.role, hash: participantCredentials.credentialHash })
    .from(participantCredentials)
    .innerJoin(participants, eq(participants.id, participantCredentials.participantId))
    .innerJoin(sessions, eq(sessions.id, participantCredentials.sessionId))
    .where(inArray(participantCredentials.credentialHash, pairs.map((p) => p.hash)))
    .orderBy(desc(sessions.updatedAt))
    .limit(MAX_RESUME);
  const valid = rows.filter((r) => pairs.some((p) => p.sessionId === r.id && p.hash === r.hash));
  if (valid.length === 0) return [];
  const roundRows = await db
    .select({ sessionId: rounds.sessionId, number: rounds.roundNumber })
    .from(rounds)
    .where(and(inArray(rounds.sessionId, valid.map((r) => r.id))));
  return valid.map((r) => ({
    id: r.id,
    title: r.title,
    role: r.role,
    status: r.status,
    roundNumber: Math.max(1, ...roundRows.filter((x) => x.sessionId === r.id).map((x) => x.number)),
    updatedAt: r.updatedAt.toISOString(),
  }));
}
