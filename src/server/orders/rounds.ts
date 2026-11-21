import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, sql, sum } from "drizzle-orm";
import { getEnv } from "@/env";
import { consolidate, preparationLabel, isPlain } from "@/lib/consolidate";
import { confirmedIds } from "@/lib/effective-order";
import { can, type Actor } from "@/lib/permissions";
import { buildTicketSnapshot, type CorrectionView } from "@/lib/ticket";
import { optionalText } from "@/lib/dish-name";
import type { Tx } from "@/server/db/client";
import { confirmedRoundSnapshots, dishes, entryClaims, orderBatches, orderCorrections, orderEntries, rounds, sessionEvents, sessions } from "@/server/db/schema";
import { AppError, forbidden } from "@/server/errors";
import { notify, notifyCorrection } from "@/server/notifications";
import type { Applied, SessionRow } from "@/server/mutations";
import { NON_TICKET_EVENTS } from "./settlement";
import { LIMITS, type CorrectionBatchInput, type CorrectionInput } from "./validation";

type Db = Pick<Tx, "select">;

/** A cancelled order (ended before any round was confirmed) is deleted after a day, not the full closed retention. */
export const CANCELLED_RETENTION_DAYS = 1;

/** Corrections of a session with what the waiter needs to hear (dish, preparation, source round). */
export async function loadCorrections(tx: Db, sessionId: string): Promise<CorrectionView[]> {
  const rows = await tx
    .select({
      id: orderCorrections.id,
      sourceEntryId: orderCorrections.sourceEntryId,
      targetRoundId: orderCorrections.targetRoundId,
      type: orderCorrections.correctionType,
      quantityDelta: orderCorrections.quantityDelta,
      replacementData: orderCorrections.replacementData,
      explanation: orderCorrections.explanation,
      reason: orderCorrections.reason,
      groupId: orderCorrections.groupId,
      createdAt: orderCorrections.createdAt,
      sourceRoundNumber: rounds.roundNumber,
      dishName: dishes.canonicalName,
      variant: orderEntries.variant,
      instructions: orderEntries.specialInstructions,
    })
    .from(orderCorrections)
    .innerJoin(rounds, eq(rounds.id, orderCorrections.sourceRoundId))
    .innerJoin(orderEntries, eq(orderEntries.id, orderCorrections.sourceEntryId))
    .innerJoin(dishes, eq(dishes.id, orderEntries.dishId))
    .where(eq(orderCorrections.sessionId, sessionId))
    .orderBy(asc(orderCorrections.createdAt));
  return rows.map((r) => ({
    id: r.id,
    sourceEntryId: r.sourceEntryId,
    targetRoundId: r.targetRoundId,
    type: r.type === "REPLACE" ? "REPLACE" : "QUANTITY",
    quantityDelta: r.quantityDelta,
    replacement: (r.replacementData as { text?: string } | null)?.text ?? null,
    explanation: r.explanation,
    reason: r.reason,
    groupId: r.groupId,
    createdAt: r.createdAt.toISOString(),
    sourceRoundNumber: r.sourceRoundNumber,
    dishName: r.dishName,
    preparation: isPlain({ variant: r.variant, instructions: r.instructions }) ? null : preparationLabel({ variant: r.variant, instructions: r.instructions }),
  }));
}

async function draftRound(tx: Tx, sessionId: string) {
  const [round] = await tx.select().from(rounds).where(and(eq(rounds.sessionId, sessionId), eq(rounds.status, "DRAFT")));
  return round ?? null;
}

async function activeEntries(tx: Tx, roundId: string) {
  return tx
    .select({ entry: orderEntries, dishName: dishes.canonicalName, batch: orderBatches })
    .from(orderEntries)
    .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
    .innerJoin(dishes, eq(dishes.id, orderEntries.dishId))
    .where(and(eq(orderEntries.roundId, roundId), isNull(orderEntries.deletedAt)));
}

/** Whether anything that could change the waiter's ticket committed after `revision` (prices and names can't). */
async function ticketChangedSince(tx: Tx, sessionId: string, revision: number): Promise<boolean> {
  const [row] = await tx
    .select({ n: count() })
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, sessionId), sql`${sessionEvents.revision} > ${revision}`, sql`${sessionEvents.eventType} NOT IN (${sql.join(NON_TICKET_EVENTS.map((t) => sql`${t}`), sql`, `)})`));
  return row.n > 0;
}

/**
 * "Confirmed with waiter" (brief 5.14): host only; refused unless the host has seen the latest committed revision
 * (so no change made meanwhile is left out); stores an immutable snapshot and freezes the round's entries.
 */
export async function confirmRound(tx: Tx, session: SessionRow, actor: Actor, roundId: string, expectedRevision: number): Promise<Applied<{ roundId: string }>> {
  if (!can(actor, "round.confirm")) throw forbidden("Only the host can confirm the order with the waiter.");
  const round = await draftRound(tx, session.id);
  if (!round || round.id !== roundId) throw new AppError(409, "ROUND_NOT_OPEN", "This round was already confirmed.");
  // A revision from the future was never seen; otherwise only ticket-affecting changes since then make it stale.
  if (expectedRevision > session.revision || (session.revision !== expectedRevision && (await ticketChangedSince(tx, session.id, expectedRevision)))) {
    throw new AppError(409, "STALE_REVISION", "The order changed since you looked. Check the latest ticket, then confirm again.");
  }
  const rows = await activeEntries(tx, round.id);
  const allCorrections = await loadCorrections(tx, session.id);
  const corrections = allCorrections.filter((c) => c.targetRoundId === round.id);
  if (rows.length === 0 && corrections.length === 0) throw new AppError(422, "EMPTY_ROUND", "There’s nothing to confirm in this round yet.");

  const confirmedAt = new Date();
  const ticket = consolidate(
    rows.map(({ entry, dishName, batch }) => ({
      id: entry.id,
      dishId: entry.dishId,
      dishName,
      quantity: entry.quantity,
      variant: entry.variant,
      instructions: entry.specialInstructions,
      createdAt: entry.createdAt.toISOString(),
      submittedBy: batch.submittedBy,
      attribution: { type: batch.attributionType, label: batch.collectiveLabel, participantId: batch.attributedParticipantId },
    })),
  );
  const snapshot = buildTicketSnapshot({ roundNumber: round.roundNumber, title: session.title, ticket, corrections, confirmedAt: confirmedAt.toISOString(), context: { corrections: allCorrections, confirmed: confirmedIds(await tx.select({ id: rounds.id, status: rounds.status }).from(rounds).where(eq(rounds.sessionId, session.id))) } });
  await tx.insert(confirmedRoundSnapshots).values({ roundId: round.id, snapshotRevision: session.revision, snapshotData: snapshot, confirmedBy: actor.participantId, confirmedAt });
  // Corrections are marked as said before the round freezes (the database refuses changes to confirmed rounds' corrections).
  await tx.update(orderCorrections).set({ communicatedAt: confirmedAt }).where(eq(orderCorrections.targetRoundId, round.id));
  await tx.update(rounds).set({ status: "CONFIRMED", confirmedAt, confirmedBy: actor.participantId }).where(eq(rounds.id, round.id));
  // Requests to take over dishes in this round can no longer be granted.
  await tx
    .update(entryClaims)
    .set({ status: "REJECTED", resolvedAt: confirmedAt })
    .where(and(eq(entryClaims.sessionId, session.id), eq(entryClaims.status, "PENDING"), sql`${entryClaims.batchId} IN (SELECT id FROM order_batches WHERE round_id = ${round.id})`));
  await notify(tx, session.id, { type: "round.confirmed", subject: { roundId: round.id, roundNumber: round.roundNumber }, recipients: "all", dedupKey: `round.confirmed:${round.id}`, actorId: actor.participantId });
  const told = Map.groupBy(corrections.filter((c) => c.reason !== "UNAVAILABLE"), (c) => c.groupId ?? c.id);
  for (const [key, group] of told) await notifyCorrection(tx, session.id, actor.participantId, key, group);
  return { result: { roundId: round.id }, event: { type: "round.confirmed", payload: { roundId: round.id } } };
}

/** Additional orders (brief 5.15): a new draft round after the last one was confirmed. Host only. */
export async function openRound(tx: Tx, session: SessionRow, actor: Actor): Promise<Applied<{ roundId: string }>> {
  if (!can(actor, "round.open")) throw forbidden("Only the host can start a new round.");
  if (await draftRound(tx, session.id)) throw new AppError(409, "ROUND_OPEN", "There’s already an open round.");
  const [{ value: roundCount }] = await tx.select({ value: count() }).from(rounds).where(eq(rounds.sessionId, session.id));
  if (roundCount >= LIMITS.roundsPerSession) throw new AppError(422, "TOO_MANY_ROUNDS", `An order can have up to ${LIMITS.roundsPerSession} rounds.`);
  const [last] = await tx.select({ number: rounds.roundNumber }).from(rounds).where(eq(rounds.sessionId, session.id)).orderBy(desc(rounds.roundNumber)).limit(1);
  const [round] = await tx
    .insert(rounds)
    .values({ sessionId: session.id, roundNumber: (last?.number ?? 0) + 1 })
    .returning({ id: rounds.id });
  await notify(tx, session.id, { type: "round.opened", subject: { roundId: round.id, roundNumber: (last?.number ?? 0) + 1 }, recipients: "all", dedupKey: `round.opened:${round.id}`, actorId: actor.participantId });
  return { result: { roundId: round.id }, event: { type: "round.opened", payload: { roundId: round.id } } };
}

/** How much of each entry is already cancelled: every QUANTITY correction counts, pending or told (`toldOnly`: only those billing already applies). */
export async function cancelledBySource(tx: Tx, entryIds: string[], toldOnly = false): Promise<Map<string, number>> {
  if (entryIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: orderCorrections.sourceEntryId, cancelled: sum(sql`-${orderCorrections.quantityDelta}`).mapWith(Number) })
    .from(orderCorrections)
    .innerJoin(rounds, eq(rounds.id, orderCorrections.targetRoundId))
    .where(and(inArray(orderCorrections.sourceEntryId, entryIds), eq(orderCorrections.correctionType, "QUANTITY"), toldOnly ? eq(rounds.status, "CONFIRMED") : undefined))
    .groupBy(orderCorrections.sourceEntryId);
  return new Map(rows.map((r) => [r.id as string, r.cancelled ?? 0]));
}

/** Corrections are capped per session; a batch is all-or-nothing against the cap. */
export async function assertCorrectionRoom(tx: Tx, sessionId: string, adding: number) {
  const [{ value }] = await tx.select({ value: count() }).from(orderCorrections).where(eq(orderCorrections.sessionId, sessionId));
  if (value + adding > LIMITS.correctionsPerSession) throw new AppError(422, "TOO_MANY_CORRECTIONS", `An order can have up to ${LIMITS.correctionsPerSession} corrections.`);
}

/** One row per source entry (billing is per person); a batch shares a group id and is all-or-nothing against the cap. */
export async function recordCorrections(tx: Tx, session: SessionRow, actor: Actor, input: CorrectionBatchInput): Promise<Applied<{ correctionIds: string[]; groupId: string | null }>> {
  if (!can(actor, "round.open")) throw forbidden("Only the host can record corrections.");
  const target = await draftRound(tx, session.id);
  if (!target) throw new AppError(409, "NO_OPEN_ROUND", "Start a new round first; corrections go to the waiter with it.");
  const ids = input.entries.map((e) => e.sourceEntryId);
  const sources = await tx
    .select({ id: orderEntries.id, quantity: orderEntries.quantity, roundId: orderEntries.roundId, roundStatus: rounds.status })
    .from(orderEntries)
    .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
    .innerJoin(rounds, eq(rounds.id, orderEntries.roundId))
    .where(and(inArray(orderEntries.id, ids), eq(orderBatches.sessionId, session.id), isNull(orderEntries.deletedAt)))
    .for("update", { of: orderEntries });
  const byId = new Map(sources.map((s) => [s.id, s]));
  if (byId.size !== new Set(ids).size) throw new AppError(404, "ENTRY_NOT_FOUND", "That dish isn’t in this order.");
  if (sources.some((s) => s.roundStatus !== "CONFIRMED")) throw new AppError(409, "NOT_CONFIRMED", "This dish isn’t confirmed yet; change it directly.");
  await assertCorrectionRoom(tx, session.id, ids.length);
  const replacement = optionalText(input.replacement);
  if (input.type === "REPLACE" && !replacement) throw new AppError(422, "INVALID", "Say what to change it to.");
  // Cancels count pending or told; a swap only needs something left once the told cancels are applied.
  const cancelled = await cancelledBySource(tx, ids, input.type === "REPLACE");
  const groupId = ids.length > 1 ? randomUUID() : null;
  const rows = input.entries.map(({ sourceEntryId, quantity }) => {
    const source = byId.get(sourceEntryId)!;
    if (input.type === "QUANTITY") {
      // Cancellations add up: never cancel more of a dish than was ordered.
      const left = source.quantity - (cancelled.get(source.id) ?? 0);
      if (left <= 0) throw new AppError(409, "ALREADY_CANCELLED", "All of this dish is already cancelled.");
      if (!quantity || quantity > left) throw new AppError(422, "INVALID", `You can cancel between 1 and ${left}.`);
    }
    if (input.type === "REPLACE" && source.quantity - (cancelled.get(source.id) ?? 0) <= 0) throw new AppError(409, "ALREADY_CANCELLED", "All of this dish is already cancelled; there is nothing left to change.");
    return {
      sessionId: session.id,
      sourceRoundId: source.roundId,
      sourceEntryId: source.id,
      targetRoundId: target.id,
      correctionType: input.type,
      quantityDelta: input.type === "QUANTITY" ? -(quantity ?? 0) : null,
      replacementData: input.type === "REPLACE" ? { text: replacement } : null,
      explanation: optionalText(input.explanation),
      groupId,
      createdBy: actor.participantId,
    };
  });
  const created = await tx.insert(orderCorrections).values(rows).returning({ id: orderCorrections.id });
  const correctionIds = created.map((c) => c.id);
  return { result: { correctionIds, groupId }, event: { type: "correction.recorded", payload: { correctionIds } } };
}

/** The original single-dish form of {@link recordCorrections}. */
export async function recordCorrection(tx: Tx, session: SessionRow, actor: Actor, input: CorrectionInput): Promise<Applied<{ correctionId: string }>> {
  const { result, event } = await recordCorrections(tx, session, actor, { entries: [{ sourceEntryId: input.sourceEntryId, quantity: input.quantity }], type: input.type, replacement: input.replacement, explanation: input.explanation });
  return { result: { correctionId: result.correctionIds[0] }, event };
}

/** Take back a correction before its round is confirmed; a batch is taken back as a whole. */
export async function removeCorrection(tx: Tx, session: SessionRow, actor: Actor, correctionId: string): Promise<Applied<{ correctionId: string }>> {
  if (!can(actor, "round.open")) throw forbidden("Only the host can change corrections.");
  const [row] = await tx
    .select({ id: orderCorrections.id, groupId: orderCorrections.groupId, targetStatus: rounds.status })
    .from(orderCorrections)
    .innerJoin(rounds, eq(rounds.id, orderCorrections.targetRoundId))
    .where(and(eq(orderCorrections.id, correctionId), eq(orderCorrections.sessionId, session.id)));
  if (!row) throw new AppError(404, "CORRECTION_NOT_FOUND", "That correction isn’t there any more.");
  if (row.targetStatus !== "DRAFT") throw new AppError(409, "ROUND_CONFIRMED", "That correction was already given to the waiter.");
  await tx.delete(orderCorrections).where(row.groupId ? and(eq(orderCorrections.groupId, row.groupId), eq(orderCorrections.sessionId, session.id)) : eq(orderCorrections.id, correctionId));
  return { result: { correctionId }, event: { type: "correction.removed", payload: { correctionId } } };
}

/**
 * End session (brief 5.16): read-only from now on; deleted after the closed-retention period. Host only. An open round
 * that was never confirmed stays as it was (visible, not sent anywhere). Ending before any confirmation is a cancel.
 */
export async function closeSession(tx: Tx, session: SessionRow, actor: Actor): Promise<Applied<{ closedAt: string; expiresAt: string }>> {
  if (!can(actor, "session.close")) throw forbidden("Only the host can end the order.");
  // Nothing ever confirmed with the waiter = the table called it off: keep it just long enough for guests to see that.
  const [confirmed] = await tx.select({ id: rounds.id }).from(rounds).where(and(eq(rounds.sessionId, session.id), eq(rounds.status, "CONFIRMED"))).limit(1);
  const days = confirmed ? getEnv().CLOSED_RETENTION_DAYS : CANCELLED_RETENTION_DAYS;
  const closedAt = new Date();
  const expiresAt = new Date(closedAt.getTime() + days * 86_400_000);
  await tx.update(sessions).set({ status: "CLOSED", closedAt, expiresAt }).where(eq(sessions.id, session.id));
  await tx.update(entryClaims).set({ status: "REJECTED", resolvedAt: closedAt }).where(and(eq(entryClaims.sessionId, session.id), eq(entryClaims.status, "PENDING")));
  await notify(tx, session.id, { type: "order.ended", subject: { cancelled: !confirmed }, recipients: "all", dedupKey: "order.ended", actorId: actor.participantId });
  return { result: { closedAt: closedAt.toISOString(), expiresAt: expiresAt.toISOString() }, event: { type: "session.closed", payload: {} } };
}
