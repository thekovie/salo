import { and, eq, isNull } from "drizzle-orm";
import { can, type Actor } from "@/lib/permissions";
import { placeOnLines } from "@/lib/serving";
import type { Tx } from "@/server/db/client";
import { orderBatches, orderEntries, rounds, servedCounts } from "@/server/db/schema";
import { AppError, forbidden } from "@/server/errors";
import type { Applied, SessionRow } from "@/server/mutations";
import { loadCorrections } from "./rounds";
import type { ServingInput } from "./validation";

/** The host's served tally for one line of a confirmed round. The change is a delta; the result is clamped to 0..expected. */
export async function updateServed(tx: Tx, session: SessionRow, actor: Actor, input: ServingInput): Promise<Applied<{ served: number; revision: number }>> {
  if (!can(actor, "serving.update")) throw forbidden("Only the host can mark food as served.");
  const roundRows = await tx.select({ id: rounds.id, status: rounds.status }).from(rounds).where(eq(rounds.sessionId, session.id));
  const round = roundRows.find((r) => r.id === input.roundId);
  if (!round) throw new AppError(404, "ROUND_NOT_FOUND", "That round isn’t in this order.");
  if (round.status !== "CONFIRMED") throw new AppError(409, "ROUND_NOT_CONFIRMED", "Food can be tracked once the round is confirmed.");

  const entries = await tx
    .select({ id: orderEntries.id, roundId: orderEntries.roundId, dishId: orderEntries.dishId, quantity: orderEntries.quantity, variant: orderEntries.variant, instructions: orderEntries.specialInstructions })
    .from(orderEntries)
    .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
    .where(and(eq(orderBatches.sessionId, session.id), eq(orderEntries.roundId, input.roundId), isNull(orderEntries.deletedAt)));
  const stored = await tx.select().from(servedCounts).where(and(eq(servedCounts.sessionId, session.id), eq(servedCounts.roundId, input.roundId)));
  const servedMap = new Map(stored.map((c) => [`${c.roundId}|${c.lineKey}`, c.served]));
  const onLine = placeOnLines(entries, await loadCorrections(tx, session.id), roundRows, servedMap).filter((p) => p.key === input.lineKey);
  if (onLine.length === 0) throw new AppError(404, "LINE_NOT_FOUND", "That dish isn’t in this round any more.");
  const expected = onLine.reduce((sum, p) => sum + p.expected, 0);

  const where = and(eq(servedCounts.sessionId, session.id), eq(servedCounts.roundId, input.roundId), eq(servedCounts.lineKey, input.lineKey));
  const [current] = await tx.select().from(servedCounts).where(where).for("update");
  const served = Math.max(0, Math.min(expected, Math.min(current?.served ?? 0, expected) + input.delta));
  const revision = (current?.revision ?? 0) + 1;
  if (current) await tx.update(servedCounts).set({ served, revision, updatedBy: actor.participantId, updatedAt: new Date() }).where(where);
  else await tx.insert(servedCounts).values({ sessionId: session.id, roundId: input.roundId, lineKey: input.lineKey, served, revision, updatedBy: actor.participantId });
  return { result: { served, revision }, event: { type: "serving.updated", payload: { roundId: input.roundId } } };
}
