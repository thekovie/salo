import { and, eq, isNull } from "drizzle-orm";
import { isPlain, preparationLabel } from "@/lib/consolidate";
import { can, type Actor } from "@/lib/permissions";
import { placeOnLines } from "@/lib/serving";
import type { Tx } from "@/server/db/client";
import { dishes, orderBatches, orderEntries, rounds, servedCounts } from "@/server/db/schema";
import { AppError, forbidden } from "@/server/errors";
import { audienceOfEntries, notify, withMembers } from "@/server/notifications";
import type { Applied, SessionRow } from "@/server/mutations";
import { loadCorrections } from "./rounds";
import type { ServingInput } from "./validation";

/** The served tally for one line of a confirmed round. The change is a delta; the result is clamped to 0..expected. */
export async function updateServed(tx: Tx, session: SessionRow, actor: Actor, input: ServingInput): Promise<Applied<{ served: number; revision: number; applied: boolean }>> {
  if (!can(actor, "serving.update")) throw forbidden("Only the host and co-hosts can mark food as served.");
  const roundRows = await tx.select({ id: rounds.id, status: rounds.status }).from(rounds).where(eq(rounds.sessionId, session.id));
  const round = roundRows.find((r) => r.id === input.roundId);
  if (!round) throw new AppError(404, "ROUND_NOT_FOUND", "That round isn’t in this order.");
  if (round.status !== "CONFIRMED") throw new AppError(409, "ROUND_NOT_CONFIRMED", "Food can be tracked once the round is confirmed.");

  const entries = await tx
    .select({ id: orderEntries.id, roundId: orderEntries.roundId, dishId: orderEntries.dishId, quantity: orderEntries.quantity, variant: orderEntries.variant, instructions: orderEntries.specialInstructions, dishName: dishes.canonicalName, attrType: orderBatches.attributionType, forId: orderBatches.attributedParticipantId, label: orderBatches.collectiveLabel })
    .from(orderEntries)
    .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
    .innerJoin(dishes, eq(dishes.id, orderEntries.dishId))
    .where(and(eq(orderBatches.sessionId, session.id), eq(orderEntries.roundId, input.roundId), isNull(orderEntries.deletedAt)));
  const stored = await tx.select().from(servedCounts).where(and(eq(servedCounts.sessionId, session.id), eq(servedCounts.roundId, input.roundId)));
  const servedMap = new Map(stored.map((c) => [`${c.roundId}|${c.lineKey}`, c.served]));
  const onLine = placeOnLines(entries, await loadCorrections(tx, session.id), roundRows, servedMap).filter((p) => p.key === input.lineKey);
  if (onLine.length === 0) throw new AppError(404, "LINE_NOT_FOUND", "That dish isn’t in this round any more.");
  const expected = onLine.reduce((sum, p) => sum + p.expected, 0);

  const where = and(eq(servedCounts.sessionId, session.id), eq(servedCounts.roundId, input.roundId), eq(servedCounts.lineKey, input.lineKey));
  const [current] = await tx.select().from(servedCounts).where(where).for("update");
  const before = Math.min(current?.served ?? 0, expected);
  const stale = input.expectedServed !== before;
  const served = stale ? before : Math.max(0, Math.min(expected, before + input.delta));
  // A stale tap changes nothing: the reply carries the count the sender missed.
  if (stale) return { result: { served, revision: current?.revision ?? 0, applied: false }, event: { type: "serving.updated", payload: { roundId: input.roundId, actorId: actor.participantId } } };
  const revision = (current?.revision ?? 0) + 1;
  if (current) await tx.update(servedCounts).set({ served, revision, updatedBy: actor.participantId, updatedAt: new Date() }).where(where);
  else await tx.insert(servedCounts).values({ sessionId: session.id, roundId: input.roundId, lineKey: input.lineKey, served, revision, updatedBy: actor.participantId });
  // Once per line: coming back to "all served" after a dip is not news (dedup holds).
  if (expected > 0 && before < expected && served === expected) {
    const first = onLine[0];
    await notify(tx, session.id, {
      type: "food.served",
      recipients: audienceOfEntries(await withMembers(tx, session.id, onLine.filter((p) => p.expected > 0).map((p) => ({ id: p.entry.id, quantity: p.expected, attrType: p.entry.attrType, forId: p.entry.forId, label: p.entry.label })))),
      subject: { roundId: input.roundId, lineKey: input.lineKey, label: first.eff.replacement ?? (isPlain(first.entry) ? first.entry.dishName : `${first.entry.dishName} (${preparationLabel(first.entry)})`) },
      dedupKey: `served:${input.roundId}|${input.lineKey}`,
      actorId: actor.participantId,
    });
  }
  return { result: { served, revision, applied: true }, event: { type: "serving.updated", payload: { roundId: input.roundId, actorId: actor.participantId } } };
}
