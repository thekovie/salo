import { and, asc, eq, isNull } from "drizzle-orm";
import type { SessionSnapshot } from "@/lib/snapshot";
import type { Db } from "@/server/db/client";
import { dishes, entryClaims, orderBatches, orderEntries, orderGroupMembers, orderGroups, participantRoundReadiness, participants, rounds, sessions } from "@/server/db/schema";
import { notFound } from "@/server/errors";
import { LIMITS } from "@/server/orders/validation";
import type { Actor } from "@/lib/permissions";

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/**
 * The authoritative state of a session at one revision. Read in a REPEATABLE READ transaction so the revision and the
 * rows it describes always match, even while other mutations commit.
 */
export async function getSnapshot(db: Db, actor: Actor): Promise<SessionSnapshot> {
  return db.transaction(
    async (tx) => {
      const [session] = await tx.select().from(sessions).where(eq(sessions.id, actor.sessionId));
      if (!session) throw notFound();
      const [roundRows, people, entryRows, dishRows] = await Promise.all([
        tx.select().from(rounds).where(eq(rounds.sessionId, session.id)).orderBy(asc(rounds.roundNumber)),
        tx.select({ id: participants.id, displayName: participants.displayName, role: participants.role }).from(participants).where(eq(participants.sessionId, session.id)).orderBy(asc(participants.createdAt)),
        tx
          .select({ entry: orderEntries, batch: orderBatches, dishName: dishes.canonicalName })
          .from(orderEntries)
          .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
          .innerJoin(dishes, eq(dishes.id, orderEntries.dishId))
          .where(and(eq(orderBatches.sessionId, session.id), isNull(orderEntries.deletedAt)))
          .orderBy(asc(orderEntries.createdAt)),
        tx.select({ name: dishes.canonicalName }).from(dishes).where(eq(dishes.sessionId, session.id)).orderBy(asc(dishes.canonicalName))
          .limit(LIMITS.dishesPerSession),
      ]);
      const draft = roundRows.find((r) => r.status === "DRAFT") ?? roundRows[roundRows.length - 1];
      const [claimRows, readyRows, groupRows, memberRows] = await Promise.all([
        tx.select().from(entryClaims).where(and(eq(entryClaims.sessionId, session.id), eq(entryClaims.status, "PENDING"))).orderBy(asc(entryClaims.createdAt)),
        tx.select().from(participantRoundReadiness).where(eq(participantRoundReadiness.roundId, draft.id)),
        tx.select().from(orderGroups).where(eq(orderGroups.sessionId, session.id)).orderBy(asc(orderGroups.createdAt)),
        tx
          .select({ groupId: orderGroupMembers.groupId, participantId: orderGroupMembers.participantId })
          .from(orderGroupMembers)
          .innerJoin(orderGroups, eq(orderGroups.id, orderGroupMembers.groupId))
          .where(eq(orderGroups.sessionId, session.id)),
      ]);
      const membersByGroup = new Map<string, string[]>();
      for (const m of memberRows) membersByGroup.set(m.groupId, [...(membersByGroup.get(m.groupId) ?? []), m.participantId]);
      const me = people.find((p) => p.id === actor.participantId);
      return {
        session: {
          id: session.id,
          title: session.title,
          status: session.status,
          revision: session.revision,
          joinCode: session.joinCode,
          closedAt: iso(session.closedAt),
          expiresAt: session.expiresAt.toISOString(),
        },
        me: { participantId: actor.participantId, role: actor.role, displayName: me?.displayName ?? actor.displayName },
        rounds: roundRows.map((r) => ({ id: r.id, number: r.roundNumber, status: r.status, confirmedAt: iso(r.confirmedAt) })),
        activeRoundId: draft.id,
        participants: people,
        entries: entryRows.map(({ entry, batch, dishName }) => ({
          id: entry.id,
          roundId: entry.roundId,
          dishId: entry.dishId,
          dishName,
          quantity: entry.quantity,
          variant: entry.variant,
          instructions: entry.specialInstructions,
          createdAt: entry.createdAt.toISOString(),
          revision: entry.revision,
          batchId: batch.id,
          submittedBy: batch.submittedBy,
          attribution: { type: batch.attributionType, label: batch.collectiveLabel, participantId: batch.attributedParticipantId },
        })),
        dishNames: dishRows.map((d) => d.name),
        claims: claimRows.map((c) => ({ id: c.id, batchId: c.batchId, requestedBy: c.requestedBy, createdAt: c.createdAt.toISOString() })),
        readiness: readyRows.map((r) => ({ participantId: r.participantId, ready: r.ready })),
        groups: groupRows.map((g) => ({ id: g.id, label: g.label, createdBy: g.createdBy, memberIds: membersByGroup.get(g.id) ?? [] })),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
