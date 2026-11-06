import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { participantCredentials, participants } from "@/server/db/schema";
import type { Actor } from "@/lib/permissions";
import { hashToken } from "./credentials";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

/** Who is asking, from their session cookie. Null when the token is missing, unknown, revoked or for another session. */
export async function resolveActor(db: Db, sessionId: string, token: string | undefined): Promise<Actor | null> {
  if (!token || !isUuid(sessionId) || token.length > 128) return null;
  const [row] = await db
    .select({ participantId: participants.id, role: participants.role, displayName: participants.displayName, sessionId: participants.sessionId })
    .from(participantCredentials)
    .innerJoin(participants, eq(participants.id, participantCredentials.participantId))
    .where(
      and(
        eq(participantCredentials.credentialHash, hashToken(token)),
        eq(participantCredentials.sessionId, sessionId),
        isNull(participantCredentials.revokedAt),
      ),
    );
  return row ?? null;
}
