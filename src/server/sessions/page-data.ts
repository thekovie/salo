import "server-only";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { isUuid, removedFrom, resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { sessions } from "@/server/db/schema";
import type { Actor } from "@/lib/permissions";
import { getSnapshot } from "./snapshot";

/** For server pages: the visitor's identity in this session and the snapshot, or null when they are not part of it. */
export async function loadSessionForPage(sessionId: string) {
  const token = (await cookies()).get(credentialCookieName(sessionId))?.value;
  const actor: Actor | null = await resolveActor(getDb(), sessionId, token);
  if (!actor) return null;
  return { actor, snapshot: await getSnapshot(getDb(), actor) };
}

/**
 * The invite code of an open order, for someone holding its room link but not in it (a friend the link was forwarded
 * to, or a link-preview crawler). The room id is a random UUID, far harder to guess than the join code it leads to,
 * so this grants nothing the code does not.
 */
export async function openInviteCode(sessionId: string): Promise<string | null> {
  if (!isUuid(sessionId)) return null;
  const [row] = await getDb()
    .select({ joinCode: sessions.joinCode })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.status, "OPEN")))
    .limit(1);
  return row?.joinCode ?? null;
}

/** For a guest the host removed, the host's note (possibly null). Undefined for everyone else. */
export async function removedNotice(sessionId: string) {
  const token = (await cookies()).get(credentialCookieName(sessionId))?.value;
  return removedFrom(getDb(), sessionId, token);
}
