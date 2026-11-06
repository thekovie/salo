import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { normalizeText, tidyText } from "@/lib/dish-name";
import { can, type Actor } from "@/lib/permissions";
import type { Tx } from "@/server/db/client";
import { entryClaims, orderBatches, orderEntries, orderGroupMembers, orderGroups, participantRoundReadiness, participants, rounds } from "@/server/db/schema";
import { AppError, forbidden } from "@/server/errors";
import type { Applied, SessionRow } from "@/server/mutations";
import { LIMITS } from "./validation";

async function draftRoundId(tx: Tx, sessionId: string): Promise<string> {
  const [round] = await tx.select({ id: rounds.id }).from(rounds).where(and(eq(rounds.sessionId, sessionId), eq(rounds.status, "DRAFT")));
  if (!round) throw new AppError(409, "NO_OPEN_ROUND", "There’s no open round right now.");
  return round.id;
}

/**
 * "I'm ready" for the open round (brief 5.11). Advisory only: it never blocks the host. Stored with the revision the
 * participant saw; any later change of their own resets it (see `resetReadiness`).
 */
export async function setReady(tx: Tx, session: SessionRow, actor: Actor, ready: boolean): Promise<Applied<{ ready: boolean }>> {
  if (!can(actor, "ready.set")) throw forbidden();
  const roundId = await draftRoundId(tx, session.id);
  await tx
    .insert(participantRoundReadiness)
    .values({ participantId: actor.participantId, roundId, ready, acknowledgedRevision: session.revision + 1, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [participantRoundReadiness.participantId, participantRoundReadiness.roundId],
      set: { ready, acknowledgedRevision: session.revision + 1, updatedAt: new Date() },
    });
  return { result: { ready }, event: { type: "readiness.changed", payload: { participantId: actor.participantId } } };
}

/**
 * A change to someone's order after they said they were ready makes them not ready again (brief 5.11): the person who
 * made the change, whoever owns the dish, and whoever it is for. Called inside entry and claim mutations.
 */
export async function resetReadiness(tx: Tx, roundId: string, participantIds: (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(participantIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  await tx
    .update(participantRoundReadiness)
    .set({ ready: false, updatedAt: new Date() })
    .where(and(inArray(participantRoundReadiness.participantId, ids), eq(participantRoundReadiness.roundId, roundId), eq(participantRoundReadiness.ready, true)));
}

/**
 * Name the people in a collective group (brief 5.9: optional). The group is matched to orders by its label; nothing
 * assumes which member gets which dish. An empty member list keeps the label and clears the members.
 */
export async function setGroupMembers(tx: Tx, session: SessionRow, actor: Actor, rawLabel: string, memberIds: string[]): Promise<Applied<{ groupId: string }>> {
  const label = tidyText(rawLabel);
  if (!label || label.length > LIMITS.label) throw new AppError(422, "INVALID", "Give the group a name under 40 characters.");
  const unique = [...new Set(memberIds)];
  if (unique.length > 0) {
    const found = await tx.select({ id: participants.id }).from(participants).where(and(eq(participants.sessionId, session.id), inArray(participants.id, unique)));
    if (found.length !== unique.length) throw new AppError(422, "UNKNOWN_PERSON", "Someone in that list isn’t in this order.");
  }
  const [existing] = await tx
    .select({ id: orderGroups.id, createdBy: orderGroups.createdBy })
    .from(orderGroups)
    .where(and(eq(orderGroups.sessionId, session.id), eq(orderGroups.normalizedLabel, normalizeText(label))));
  // Whoever first named the group's members, or the host, may change them; others see them but cannot overwrite them.
  if (existing && actor.role !== "HOST" && existing.createdBy !== actor.participantId) {
    throw forbidden("Only the host or the person who set up this group can change its members.");
  }
  let group = existing;
  if (!group) {
    const [{ value: groupCount }] = await tx.select({ value: count() }).from(orderGroups).where(eq(orderGroups.sessionId, session.id));
    if (groupCount >= LIMITS.groupsPerSession) throw new AppError(422, "TOO_MANY_GROUPS", `An order can have up to ${LIMITS.groupsPerSession} groups.`);
    [group] = await tx
      .insert(orderGroups)
      .values({ sessionId: session.id, label, normalizedLabel: normalizeText(label), createdBy: actor.participantId })
      .returning({ id: orderGroups.id, createdBy: orderGroups.createdBy });
  }
  await tx.delete(orderGroupMembers).where(eq(orderGroupMembers.groupId, group.id));
  if (unique.length > 0) await tx.insert(orderGroupMembers).values(unique.map((participantId) => ({ groupId: group.id, participantId })));
  return { result: { groupId: group.id }, event: { type: "group.updated", payload: { groupId: group.id } } };
}

/** The batch with its owner and round, scoped to the session. */
async function loadBatch(tx: Tx, sessionId: string, batchId: string) {
  const [batch] = await tx
    .select({ id: orderBatches.id, roundId: orderBatches.roundId, submittedBy: orderBatches.submittedBy, roundStatus: rounds.status, attributionType: orderBatches.attributionType, attributedParticipantId: orderBatches.attributedParticipantId })
    .from(orderBatches)
    .innerJoin(rounds, eq(rounds.id, orderBatches.roundId))
    .where(and(eq(orderBatches.id, batchId), eq(orderBatches.sessionId, sessionId)));
  if (!batch) throw new AppError(404, "ENTRY_NOT_FOUND", "That dish isn’t in this order any more.");
  return batch;
}

/**
 * "That's mine" (brief 5.10): a guest asks to take over a dish the host recorded (for them by name, or for nobody).
 * Nothing changes until the host approves; names alone never merge anything.
 */
export async function requestClaim(tx: Tx, session: SessionRow, actor: Actor, batchId: string): Promise<Applied<{ claimId: string }>> {
  if (actor.role !== "GUEST") throw forbidden("Only guests claim dishes. As the host you can change any dish directly.");
  const batch = await loadBatch(tx, session.id, batchId);
  if (batch.roundStatus !== "DRAFT") throw new AppError(409, "ROUND_CONFIRMED", "This round was already confirmed with the waiter.");
  if (batch.submittedBy === actor.participantId) throw new AppError(409, "ALREADY_YOURS", "This dish is already yours.");
  const [owner] = await tx.select({ role: participants.role }).from(participants).where(eq(participants.id, batch.submittedBy));
  if (owner?.role !== "HOST") throw forbidden("You can only claim dishes the host added.");
  if (batch.attributedParticipantId && batch.attributedParticipantId !== actor.participantId) throw forbidden("This dish is already marked as someone else’s.");
  const [active] = await tx
    .select({ id: orderEntries.id })
    .from(orderEntries)
    .where(and(eq(orderEntries.batchId, batchId), isNull(orderEntries.deletedAt)))
    .limit(1);
  if (!active) throw new AppError(404, "ENTRY_NOT_FOUND", "That dish isn’t in this order any more.");
  const [claim] = await tx
    .insert(entryClaims)
    .values({ sessionId: session.id, batchId, requestedBy: actor.participantId })
    .onConflictDoNothing()
    .returning({ id: entryClaims.id });
  if (!claim) throw new AppError(409, "CLAIM_PENDING", "You already asked for this one. Waiting for the host.");
  return { result: { claimId: claim.id }, event: { type: "claim.requested", payload: { claimId: claim.id } } };
}

/** The host approves (the dish becomes the guest's, for the guest) or declines. Other pending claims on it close. */
export async function resolveClaim(tx: Tx, session: SessionRow, actor: Actor, claimId: string, approve: boolean): Promise<Applied<{ claimId: string; status: "APPROVED" | "REJECTED" }>> {
  if (!can(actor, "claim.approve")) throw forbidden("Only the host can approve claims.");
  const [claim] = await tx
    .select()
    .from(entryClaims)
    .where(and(eq(entryClaims.id, claimId), eq(entryClaims.sessionId, session.id)))
    .for("update");
  if (!claim) throw new AppError(404, "CLAIM_NOT_FOUND", "That request isn’t there any more.");
  if (claim.status !== "PENDING") throw new AppError(409, "CLAIM_RESOLVED", "That request was already answered.");
  const status = approve ? ("APPROVED" as const) : ("REJECTED" as const);
  if (approve) {
    const batch = await loadBatch(tx, session.id, claim.batchId);
    if (batch.roundStatus !== "DRAFT") throw new AppError(409, "ROUND_CONFIRMED", "This round was already confirmed with the waiter.");
    const [active] = await tx
      .select({ id: orderEntries.id })
      .from(orderEntries)
      .where(and(eq(orderEntries.batchId, claim.batchId), isNull(orderEntries.deletedAt)))
      .limit(1);
    if (!active) throw new AppError(409, "ENTRY_REMOVED", "That dish was removed, so there’s nothing to hand over. Decline the request instead.");
    if (batch.attributedParticipantId && batch.attributedParticipantId !== claim.requestedBy) {
      throw new AppError(409, "CLAIM_STALE", "This dish is now marked for someone else. Decline the request, or change who it’s for first.");
    }
    await tx
      .update(orderBatches)
      .set({ submittedBy: claim.requestedBy, attributionType: "INDIVIDUAL", attributedParticipantId: claim.requestedBy, collectiveLabel: null, groupId: null })
      .where(eq(orderBatches.id, claim.batchId));
    await tx
      .update(entryClaims)
      .set({ status: "REJECTED", resolvedAt: new Date() })
      .where(and(eq(entryClaims.batchId, claim.batchId), eq(entryClaims.status, "PENDING")));
    await resetReadiness(tx, batch.roundId, [claim.requestedBy, batch.attributedParticipantId]);
  }
  await tx.update(entryClaims).set({ status, resolvedAt: new Date() }).where(eq(entryClaims.id, claimId));
  return { result: { claimId, status }, event: { type: "attribution.changed", payload: { claimId, batchId: claim.batchId, status } } };
}

/** Open-round entries a guest submitted themselves: what leaves the ticket when the host removes them. */
async function openEntriesOf(tx: Tx, sessionId: string, participantId: string, deletedAt: Date | null) {
  return tx
    .select({ id: orderEntries.id, revision: orderEntries.revision })
    .from(orderEntries)
    .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
    .innerJoin(rounds, eq(rounds.id, orderEntries.roundId))
    .where(
      and(
        eq(orderBatches.sessionId, sessionId),
        eq(orderBatches.submittedBy, participantId),
        eq(rounds.status, "DRAFT"),
        deletedAt ? eq(orderEntries.deletedAt, deletedAt) : isNull(orderEntries.deletedAt),
      ),
    );
}

async function loadGuest(tx: Tx, sessionId: string, participantId: string) {
  const [person] = await tx
    .select({ id: participants.id, role: participants.role, removedAt: participants.removedAt })
    .from(participants)
    .where(and(eq(participants.id, participantId), eq(participants.sessionId, sessionId)))
    .for("update");
  if (!person) throw new AppError(404, "PERSON_NOT_FOUND", "That person isn’t in this order.");
  if (person.role === "HOST") throw new AppError(409, "CANNOT_REMOVE_HOST", "The host can’t be removed.");
  return person;
}

/**
 * The host removes a guest (owner request): they lose access at once, their own dishes in the open round come off the
 * ticket, and their pending claims, readiness and group memberships go. Confirmed rounds are frozen and stay as they
 * are. The reason is stored for the removed guest only; the event carries just the id. They may join again.
 */
export async function removeParticipant(tx: Tx, session: SessionRow, actor: Actor, participantId: string, rawReason: string | null): Promise<Applied<{ removedEntries: number }>> {
  if (!can(actor, "participant.remove")) throw forbidden("Only the host can remove people.");
  const person = await loadGuest(tx, session.id, participantId);
  if (person.removedAt) throw new AppError(409, "ALREADY_REMOVED", "They were already removed.");
  const reason = rawReason ? tidyText(rawReason).slice(0, LIMITS.removalReason) || null : null;
  const now = new Date();
  const entries = await openEntriesOf(tx, session.id, participantId, null);
  for (const entry of entries) {
    await tx.update(orderEntries).set({ deletedAt: now, updatedAt: now, revision: entry.revision + 1 }).where(eq(orderEntries.id, entry.id));
  }
  await tx.update(participants).set({ removedAt: now, removedReason: reason }).where(eq(participants.id, participantId));
  await tx.update(entryClaims).set({ status: "REJECTED", resolvedAt: now }).where(and(eq(entryClaims.requestedBy, participantId), eq(entryClaims.status, "PENDING")));
  await tx.delete(participantRoundReadiness).where(eq(participantRoundReadiness.participantId, participantId));
  await tx.delete(orderGroupMembers).where(eq(orderGroupMembers.participantId, participantId));
  return { result: { removedEntries: entries.length }, event: { type: "participant.removed", payload: { participantId } } };
}

/** The host's Undo: the guest is back, and the dishes that left with them return if their round is still open. */
export async function restoreParticipant(tx: Tx, session: SessionRow, actor: Actor, participantId: string): Promise<Applied<{ restoredEntries: number }>> {
  if (!can(actor, "participant.remove")) throw forbidden("Only the host can do that.");
  const person = await loadGuest(tx, session.id, participantId);
  if (!person.removedAt) return { result: { restoredEntries: 0 }, event: { type: "participant.restored", payload: { participantId } } };
  const entries = await openEntriesOf(tx, session.id, participantId, person.removedAt);
  await assertRoomForPerson(tx, session.id);
  const now = new Date();
  for (const entry of entries) {
    await tx.update(orderEntries).set({ deletedAt: null, updatedAt: now, revision: entry.revision + 1 }).where(eq(orderEntries.id, entry.id));
  }
  await tx.update(participants).set({ removedAt: null, removedReason: null }).where(eq(participants.id, participantId));
  return { result: { restoredEntries: entries.length }, event: { type: "participant.restored", payload: { participantId } } };
}

/** Bringing someone back must not push the table past the active-people cap (they may have been replaced meanwhile). */
async function assertRoomForPerson(tx: Tx, sessionId: string) {
  const [{ value }] = await tx
    .select({ value: count() })
    .from(participants)
    .where(and(eq(participants.sessionId, sessionId), isNull(participants.removedAt)));
  if (value >= LIMITS.participantsPerSession) throw new AppError(422, "TABLE_FULL", `This order already has ${LIMITS.participantsPerSession} people.`);
}
