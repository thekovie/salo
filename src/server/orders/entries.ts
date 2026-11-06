import { and, count, eq, isNull } from "drizzle-orm";
import { normalizeText, optionalText, tidyText } from "@/lib/dish-name";
import type { Tx } from "@/server/db/client";
import { dishes, orderBatches, orderEntries, participants, rounds } from "@/server/db/schema";
import { AppError, forbidden } from "@/server/errors";
import type { Applied, SessionRow } from "@/server/mutations";
import { can, canEditEntry, type Actor } from "@/lib/permissions";
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
        const [person] = await tx.select({ id: participants.id }).from(participants).where(and(eq(participants.id, participantId), eq(participants.sessionId, session.id)));
        if (!person) throw new AppError(422, "UNKNOWN_PERSON", "That person isn’t in this order.");
      }
      return { attributionType: "INDIVIDUAL" as const, attributedParticipantId: participantId, collectiveLabel: participantId ? null : label };
    }
  }
}

export async function addEntry(tx: Tx, session: SessionRow, actor: Actor, input: AddEntryInput): Promise<Applied<EntryRef>> {
  if (!can(actor, "entry.add")) throw forbidden();
  const round = await draftRound(tx, session.id);
  const [{ value: active }] = await tx
    .select({ value: count() })
    .from(orderEntries)
    .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
    .where(and(eq(orderBatches.sessionId, session.id), isNull(orderEntries.deletedAt)));
  if (active >= LIMITS.entriesPerSession) throw new AppError(422, "TOO_MANY_ENTRIES", `An order can hold up to ${LIMITS.entriesPerSession} entries.`);

  const dish = await dishFor(tx, session.id, input.dishName);
  const [batch] = await tx
    .insert(orderBatches)
    .values({ sessionId: session.id, roundId: round.id, submittedBy: actor.participantId, ...(await batchValues(tx, session, actor, input.attribution)) })
    .returning({ id: orderBatches.id });
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
  return { result: { entryId: entry.id, revision: entry.revision }, event: { type: "entry.added", payload: { entryId: entry.id } } };
}

/** The entry with what permission checks need, scoped to this session (an id from another session is "not found"). */
async function loadEntry(tx: Tx, sessionId: string, entryId: string) {
  const [row] = await tx
    .select({ id: orderEntries.id, revision: orderEntries.revision, deletedAt: orderEntries.deletedAt, submittedBy: orderBatches.submittedBy, roundStatus: rounds.status })
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
  return { result: { entryId, revision }, event: { type: "entry.updated", payload: { entryId } } };
}

/** Removing is a soft delete so Undo can bring it back (brief 6.3, 6.5). */
export async function setEntryRemoved(tx: Tx, session: SessionRow, actor: Actor, entryId: string, removed: boolean): Promise<Applied<EntryRef>> {
  const entry = await loadEntry(tx, session.id, entryId);
  assertEditable(actor, entry);
  const revision = entry.revision + 1;
  await tx
    .update(orderEntries)
    .set({ revision, updatedAt: new Date(), deletedAt: removed ? new Date() : null })
    .where(eq(orderEntries.id, entryId));
  return { result: { entryId, revision }, event: { type: removed ? "entry.removed" : "entry.restored", payload: { entryId } } };
}
