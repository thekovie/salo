import { and, count, eq, isNull, sql } from "drizzle-orm";
import { normalizeText, optionalText, tidyText } from "@/lib/dish-name";
import type { Tx } from "@/server/db/client";
import { dishes, orderBatches, orderEntries, participants, rounds } from "@/server/db/schema";
import { AppError, forbidden } from "@/server/errors";
import type { Applied, SessionRow } from "@/server/mutations";
import { can, canEditEntry, type Actor } from "@/lib/permissions";
import { resetReadiness } from "./people";
import { LIMITS, type AddEntryInput, type AttributionInput, type UpdateEntryInput } from "./validation";

export interface EntryRef {
  entryId: string;
  revision: number;
}

async function draftRound(tx: Tx, sessionId: string) {
  const [round] = await tx.select({ id: rounds.id }).from(rounds).where(and(eq(rounds.sessionId, sessionId), eq(rounds.status, "DRAFT")));
  if (!round) throw new AppError(409, "NO_OPEN_ROUND", "There’s no open round. Start a new round to add more dishes.");
  return round;
}

/** The session's dish for this name, created on first use with the name as typed (conservative match, brief 5.5). */
async function dishFor(tx: Tx, sessionId: string, name: string) {
  const normalized = normalizeText(name);
  const [known] = await tx.select({ id: dishes.id }).from(dishes).where(and(eq(dishes.sessionId, sessionId), eq(dishes.normalizedName, normalized)));
  if (known) return known;
  const [{ value: dishCount }] = await tx.select({ value: count() }).from(dishes).where(eq(dishes.sessionId, sessionId));
  if (dishCount >= LIMITS.dishesPerSession) throw new AppError(422, "TOO_MANY_DISHES", `An order can hold up to ${LIMITS.dishesPerSession} different dishes.`);
  await tx.insert(dishes).values({ sessionId, canonicalName: tidyText(name), normalizedName: normalized }).onConflictDoNothing();
  const [dish] = await tx.select({ id: dishes.id }).from(dishes).where(and(eq(dishes.sessionId, sessionId), eq(dishes.normalizedName, normalized)));
  return dish;
}

async function batchValues(tx: Tx, session: SessionRow, actor: Actor, attribution: AttributionInput) {
  switch (attribution.type) {
    case "UNASSIGNED":
    case "TABLE":
      return { attributionType: attribution.type, attributedParticipantId: null, collectiveLabel: null };
    case "GROUP":
      return { attributionType: "GROUP" as const, attributedParticipantId: null, collectiveLabel: tidyText(attribution.label) };
    case "INDIVIDUAL": {
      const label = optionalText(attribution.label);
      const participantId = attribution.participantId ?? (label ? null : actor.participantId);
      if (participantId) {
        const [person] = await tx.select({ id: participants.id }).from(participants).where(and(eq(participants.id, participantId), eq(participants.sessionId, session.id), isNull(participants.removedAt)));
        if (!person) throw new AppError(422, "UNKNOWN_PERSON", "That person isn’t in this order.");
      }
      return { attributionType: "INDIVIDUAL" as const, attributedParticipantId: participantId, collectiveLabel: participantId ? null : label };
    }
  }
}

/** Active entries are capped, and so are entries ever created (so add/remove loops cannot grow a session forever). */
async function assertRoomForEntry(tx: Tx, sessionId: string, isNew = false) {
  const [counts] = await tx
    .select({ ever: count(), active: count(sql`CASE WHEN ${orderEntries.deletedAt} IS NULL THEN 1 END`) })
    .from(orderEntries)
    .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
    .where(eq(orderBatches.sessionId, sessionId));
  if (counts.active >= LIMITS.entriesPerSession || (isNew && counts.ever >= LIMITS.entriesEverPerSession)) {
    throw new AppError(422, "TOO_MANY_ENTRIES", `An order can hold up to ${LIMITS.entriesPerSession} entries.`);
  }
}

export async function addEntry(tx: Tx, session: SessionRow, actor: Actor, input: AddEntryInput): Promise<Applied<EntryRef>> {
  if (!can(actor, "entry.add")) throw forbidden();
  // A dish added while offline belongs to the round the person was adding to. If that round was confirmed with the
  // waiter meanwhile, refuse instead of quietly slipping it into the next round; the person decides what to do.
  if (input.roundId) {
    const [target] = await tx.select({ number: rounds.roundNumber, status: rounds.status }).from(rounds).where(and(eq(rounds.id, input.roundId), eq(rounds.sessionId, session.id)));
    if (!target) throw new AppError(404, "ROUND_NOT_FOUND", "That round isn’t part of this order.");
    if (target.status !== "DRAFT") throw new AppError(409, "ROUND_CLOSED", `Round ${target.number} was confirmed with the waiter before this dish was saved.`);
  }
  const round = await draftRound(tx, session.id);
  await assertRoomForEntry(tx, session.id, true);

  const dish = await dishFor(tx, session.id, input.dishName);
  const [batch] = await tx
    .insert(orderBatches)
    .values({ sessionId: session.id, roundId: round.id, submittedBy: actor.participantId, ...(await batchValues(tx, session, actor, input.attribution)) })
    .returning({ id: orderBatches.id, attributedParticipantId: orderBatches.attributedParticipantId });
  const [entry] = await tx
    .insert(orderEntries)
    .values({
      batchId: batch.id,
      roundId: round.id,
      dishId: dish.id,
      quantity: input.quantity,
      variant: optionalText(input.variant),
      specialInstructions: optionalText(input.instructions),
    })
    .returning({ id: orderEntries.id, revision: orderEntries.revision });
  await resetReadiness(tx, round.id, [actor.participantId, batch.attributedParticipantId]);
  return { result: { entryId: entry.id, revision: entry.revision }, event: { type: "entry.added", payload: { entryId: entry.id } } };
}

/** The entry with what permission checks need, scoped to this session (an id from another session is "not found"). */
async function loadEntry(tx: Tx, sessionId: string, entryId: string) {
  const [row] = await tx
    .select({ id: orderEntries.id, revision: orderEntries.revision, deletedAt: orderEntries.deletedAt, submittedBy: orderBatches.submittedBy, attributedParticipantId: orderBatches.attributedParticipantId, roundId: orderEntries.roundId, roundStatus: rounds.status })
    .from(orderEntries)
    .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
    .innerJoin(rounds, eq(rounds.id, orderEntries.roundId))
    .where(and(eq(orderEntries.id, entryId), eq(orderBatches.sessionId, sessionId)))
    .for("update", { of: orderEntries });
  if (!row) throw new AppError(404, "ENTRY_NOT_FOUND", "That dish isn’t in this order any more.");
  return row;
}

function assertEditable(actor: Actor, entry: Awaited<ReturnType<typeof loadEntry>>) {
  if (entry.roundStatus !== "DRAFT") throw new AppError(409, "ROUND_CONFIRMED", "This round was already confirmed with the waiter. Record a correction instead.");
  if (!canEditEntry(actor, entry)) throw forbidden("Only the host or the person who added this dish can change it.");
}

export async function updateEntry(tx: Tx, session: SessionRow, actor: Actor, entryId: string, input: UpdateEntryInput): Promise<Applied<EntryRef>> {
  const entry = await loadEntry(tx, session.id, entryId);
  assertEditable(actor, entry);
  if (entry.deletedAt) throw new AppError(409, "ENTRY_REMOVED", "That dish was removed. Undo the removal first.");
  if (entry.revision !== input.expectedRevision) {
    throw new AppError(409, "CONFLICT", "Someone changed this dish just now. Check the latest version and try again.");
  }
  const revision = entry.revision + 1;
  await tx
    .update(orderEntries)
    .set({
      revision,
      updatedAt: new Date(),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.variant !== undefined ? { variant: optionalText(input.variant) } : {}),
      ...(input.instructions !== undefined ? { specialInstructions: optionalText(input.instructions) } : {}),
    })
    .where(eq(orderEntries.id, entryId));
  await resetReadiness(tx, entry.roundId, [actor.participantId, entry.submittedBy, entry.attributedParticipantId]);
  return { result: { entryId, revision }, event: { type: "entry.updated", payload: { entryId } } };
}

/** Removing is a soft delete so Undo can bring it back (brief 6.3, 6.5). */
export async function setEntryRemoved(tx: Tx, session: SessionRow, actor: Actor, entryId: string, removed: boolean): Promise<Applied<EntryRef>> {
  const entry = await loadEntry(tx, session.id, entryId);
  assertEditable(actor, entry);
  if (Boolean(entry.deletedAt) === removed) {
    // Already in the requested state: nothing changes, so other devices' revisions stay valid.
    return { result: { entryId, revision: entry.revision }, event: { type: removed ? "entry.removed" : "entry.restored", payload: { entryId, unchanged: true } } };
  }
  if (!removed) await assertRoomForEntry(tx, session.id);
  const revision = entry.revision + 1;
  await tx
    .update(orderEntries)
    .set({ revision, updatedAt: new Date(), deletedAt: removed ? new Date() : null })
    .where(eq(orderEntries.id, entryId));
  await resetReadiness(tx, entry.roundId, [actor.participantId, entry.submittedBy, entry.attributedParticipantId]);
  return { result: { entryId, revision }, event: { type: removed ? "entry.removed" : "entry.restored", payload: { entryId } } };
}
