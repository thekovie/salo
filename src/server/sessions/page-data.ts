import "server-only";
import { cookies } from "next/headers";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import type { Actor } from "@/lib/permissions";
import { getSnapshot } from "./snapshot";

/** For server pages: the visitor's identity in this session and the snapshot, or null when they are not part of it. */
export async function loadSessionForPage(sessionId: string) {
  const token = (await cookies()).get(credentialCookieName(sessionId))?.value;
  const actor: Actor | null = await resolveActor(getDb(), sessionId, token);
  if (!actor) return null;
  return { actor, snapshot: await getSnapshot(getDb(), actor) };
}
