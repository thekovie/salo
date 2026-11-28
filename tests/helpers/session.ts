import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { hashToken, newToken } from "@/server/auth/credentials";
import { resolveActor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { participantCredentials, participants } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { addEntry } from "@/server/orders/entries";
import { addEntrySchema } from "@/server/orders/validation";
import type { Actor } from "@/lib/permissions";
import { createSession } from "@/server/sessions/create";

export const key = () => randomUUID();

export async function newSession(db: Db): Promise<{ host: Actor; sessionId: string; token: string }> {
  const created = await createSession(db);
  const host = await resolveActor(db, created.sessionId, created.token);
  if (!host) throw new Error("host credential did not resolve");
  return { host, sessionId: created.sessionId, token: created.token };
}

/** A guest inserted directly (the join flow ships in M2). */
export async function addGuest(db: Db, sessionId: string, displayName = "Guest"): Promise<Actor> {
  const token = newToken();
  const [guest] = await db.insert(participants).values({ sessionId, displayName, role: "GUEST" }).returning();
  await db.insert(participantCredentials).values({ sessionId, participantId: guest.id, credentialType: "GUEST", credentialHash: hashToken(token) });
  return { participantId: guest.id, sessionId, role: "GUEST", displayName };
}

export function add(db: Db, actor: Actor, input: Record<string, unknown>, idempotencyKey = key()) {
  const parsed = addEntrySchema.parse(input);
  return runMutation(db, actor, { idempotencyKey, type: "entry.add" }, (tx, s) => addEntry(tx, s, actor, parsed));
}

/** The stored served count of one line (0 when no row): what a client that saw the table as it is would send as `expectedServed`. */
export async function storedServed(db: Db, sessionId: string, roundId: string, lineKey: string): Promise<number> {
  const rows = (await db.execute(sql`SELECT served FROM served_counts WHERE session_id = ${sessionId} AND round_id = ${roundId} AND line_key = ${lineKey}`)) as unknown as { served: number }[];
  return rows[0]?.served ?? 0;
}
