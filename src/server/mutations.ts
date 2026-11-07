import { and, eq, sql } from "drizzle-orm";
import { getEnv } from "@/env";
import type { Db, Tx } from "@/server/db/client";
import { mutationRecords, participants, sessionEvents, sessions } from "@/server/db/schema";
import { AppError, closed, notFound } from "@/server/errors";
import { limitMutations } from "@/server/limits";
import type { Actor } from "@/lib/permissions";

export type SessionRow = typeof sessions.$inferSelect;

export interface MutationEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface Applied<T> {
  result: T;
  event: MutationEvent;
}

export interface MutationOutcome<T> {
  result: T;
  /** The session revision this mutation produced (or produced the first time, for a replay). */
  revision: number;
  replayed: boolean;
}

interface Options {
  idempotencyKey: string;
  type: string;
  /** Only closing-related mutations may run on a closed session. */
  allowClosed?: boolean;
}

export const EVENTS_CHANNEL = "salo_events";

/**
 * The one way state changes (brief 7.4): in a single transaction, lock the session row (mutations on one session run
 * one at a time), replay a retried idempotency key instead of applying it twice, apply the change, bump the session
 * revision, append a durable event, and ring the NOTIFY bell. NOTIFY is delivered only if the transaction commits.
 */
export async function runMutation<T>(
  db: Db,
  actor: Actor,
  options: Options,
  apply: (tx: Tx, session: SessionRow) => Promise<Applied<T>>,
): Promise<MutationOutcome<T>> {
  limitMutations(actor);
  const inactiveDays = getEnv().INACTIVE_RETENTION_DAYS;
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, actor.sessionId)).for("update");
    if (!session) throw notFound();
    // Checked again under the lock: a change sent just before the host removed this guest waits behind the removal
    // and must not land after it.
    const [me] = await tx.select({ removedAt: participants.removedAt }).from(participants).where(eq(participants.id, actor.participantId));
    if (!me) throw notFound();
    if (me.removedAt) throw new AppError(403, "REMOVED", "The host removed you from this order.");

    const [previous] = await tx
      .select({ result: mutationRecords.result, mutationType: mutationRecords.mutationType })
      .from(mutationRecords)
      .where(
        and(
          eq(mutationRecords.sessionId, session.id),
          eq(mutationRecords.actorId, actor.participantId),
          eq(mutationRecords.idempotencyKey, options.idempotencyKey),
        ),
      );
    if (previous) {
      // A key belongs to one change (its kind and its target, e.g. `entry.update:<id>`); reusing it for another change
      // is a client bug, not a retry.
      if (previous.mutationType !== options.type) throw new AppError(422, "IDEMPOTENCY_KEY_REUSED", "This request key was already used for a different change.");
      const stored = previous.result as { result: T; revision: number };
      return { result: stored.result, revision: stored.revision, replayed: true };
    }

    if (session.status === "CLOSED" && !options.allowClosed) throw closed();
    // Past its deletion date: gone (and never revived by a late change), even before the hourly cleanup runs.
    if (session.expiresAt.getTime() <= Date.now()) throw notFound();

    const { result, event } = await apply(tx, session);
    const revision = session.revision + 1;
    await tx
      .update(sessions)
      .set({
        revision,
        updatedAt: sql`now()`,
        lastActivityAt: sql`now()`,
        // An open session's deletion date slides with activity; a closed one keeps its fixed date.
        expiresAt: sql`CASE WHEN ${sessions.status} = 'OPEN' THEN now() + make_interval(days => ${inactiveDays}) ELSE ${sessions.expiresAt} END`,
      })
      .where(eq(sessions.id, session.id));
    await tx.insert(sessionEvents).values({ sessionId: session.id, revision, eventType: event.type, payload: event.payload });
    await tx.execute(sql`SELECT pg_notify(${EVENTS_CHANNEL}, ${`${session.id}:${revision}`})`);
    await tx.insert(mutationRecords).values({
      sessionId: session.id,
      actorId: actor.participantId,
      idempotencyKey: options.idempotencyKey,
      mutationType: options.type,
      result: { result, revision },
    });
    return { result, revision, replayed: false };
  });
}
