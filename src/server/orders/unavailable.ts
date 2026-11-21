import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { optionalText } from "@/lib/dish-name";
import { can, type Actor } from "@/lib/permissions";
import type { Tx } from "@/server/db/client";
import { dishes, orderBatches, orderCorrections, orderEntries, rounds } from "@/server/db/schema";
import { AppError, forbidden } from "@/server/errors";
import { audienceOfEntries, forRecipient, notify, withMembers } from "@/server/notifications";
import type { Applied, SessionRow } from "@/server/mutations";
import { resetReadiness } from "./people";
import { assertCorrectionRoom, cancelledBySource } from "./rounds";
import type { UnavailableInput } from "./validation";

export interface UnavailableResult {
  /** Draft entries taken off (Undo brings them back). */
  removedEntryIds: string[];
  removed: number;
  /** Confirmed portions cancelled now (or swapped, when a replacement was given). Never undone. */
  cancelled: number;
  replaced: number;
}

/** D4: confirmed rows target their own confirmed round so billing applies them at once; the DB then freezes them. */
export async function markDishUnavailable(tx: Tx, session: SessionRow, actor: Actor, dishId: string, input: UnavailableInput): Promise<Applied<UnavailableResult>> {
  if (!can(actor, "dish.unavailable")) throw forbidden("Only the host can mark a dish unavailable.");
  const [dish] = await tx.select({ id: dishes.id, name: dishes.canonicalName }).from(dishes).where(and(eq(dishes.id, dishId), eq(dishes.sessionId, session.id)));
  if (!dish) throw new AppError(404, "DISH_NOT_FOUND", "That dish isn’t in this order.");
  const entries = await tx
    .select({ id: orderEntries.id, quantity: orderEntries.quantity, revision: orderEntries.revision, roundId: orderEntries.roundId, roundStatus: rounds.status, submittedBy: orderBatches.submittedBy, forId: orderBatches.attributedParticipantId, attrType: orderBatches.attributionType, label: orderBatches.collectiveLabel })
    .from(orderEntries)
    .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
    .innerJoin(rounds, eq(rounds.id, orderEntries.roundId))
    .where(and(eq(orderEntries.dishId, dish.id), eq(orderBatches.sessionId, session.id), isNull(orderEntries.deletedAt)))
    .for("update", { of: orderEntries });
  const draft = entries.filter((e) => e.roundStatus === "DRAFT");
  const confirmed = entries.filter((e) => e.roundStatus === "CONFIRMED");
  const confirmedIds = confirmed.map((e) => e.id);
  // What billing still counts: only corrections already told reduce it, so a pending cancel must not shrink "what's left".
  const cancelledSoFar = await cancelledBySource(tx, confirmedIds, true);
  // A told swap means the entry no longer counts as this dish.
  const swapped = confirmedIds.length
    ? new Set(
        (
          await tx
            .select({ id: orderCorrections.sourceEntryId })
            .from(orderCorrections)
            .innerJoin(rounds, eq(rounds.id, orderCorrections.targetRoundId))
            .where(and(inArray(orderCorrections.sourceEntryId, confirmedIds), eq(orderCorrections.correctionType, "REPLACE"), eq(rounds.status, "CONFIRMED")))
        ).map((r) => r.id),
      )
    : new Set<string | null>();
  const told = confirmed.filter((e) => !swapped.has(e.id)).map((e) => ({ ...e, left: e.quantity - (cancelledSoFar.get(e.id) ?? 0) })).filter((e) => e.left > 0);
  if (draft.length === 0 && told.length === 0) throw new AppError(409, "NOTHING_LEFT", "None of this dish is left in the order.");

  const now = new Date();
  for (const e of draft) {
    await tx.update(orderEntries).set({ revision: e.revision + 1, updatedAt: now, deletedAt: now }).where(eq(orderEntries.id, e.id));
  }
  if (draft.length) await resetReadiness(tx, draft[0].roundId, draft.flatMap((e) => [actor.participantId, e.submittedBy, e.forId]));

  const replacement = optionalText(input.replacement);
  // Changes still waiting for the next round on these dishes are moot now; a pending cancel becomes a told one below when replacing.
  const dropped = confirmedIds.length
    ? await tx
        .delete(orderCorrections)
        .where(and(inArray(orderCorrections.sourceEntryId, confirmedIds), sql`${orderCorrections.targetRoundId} IN (SELECT id FROM rounds WHERE status = 'DRAFT')`))
        .returning({ groupId: orderCorrections.groupId, id: orderCorrections.id, sourceEntryId: orderCorrections.sourceEntryId, type: orderCorrections.correctionType, delta: orderCorrections.quantityDelta })
    : [];
  const pendingCancel = new Map<string, number>();
  for (const r of dropped) if (r.type === "QUANTITY") pendingCancel.set(r.sourceEntryId!, (pendingCancel.get(r.sourceEntryId!) ?? 0) + Math.abs(r.delta ?? 0));

  const groupId = randomUUID();
  const rowFor = (e: (typeof told)[number], type: "QUANTITY" | "REPLACE", cancel = 0) => ({
    sessionId: session.id,
    sourceRoundId: e.roundId,
    sourceEntryId: e.id,
    targetRoundId: e.roundId,
    correctionType: type,
    quantityDelta: type === "QUANTITY" ? -cancel : null,
    replacementData: type === "REPLACE" ? { text: replacement } : null,
    explanation: optionalText(input.note),
    reason: "UNAVAILABLE" as const,
    groupId,
    createdBy: actor.participantId,
    communicatedAt: now,
  });
  // Replacing covers what remains after the cancels the host had already queued; those become told cancels.
  const rows = told.flatMap((e) => {
    if (!replacement) return [rowFor(e, "QUANTITY", e.left)];
    const cancel = pendingCancel.get(e.id) ?? 0;
    return [...(cancel > 0 ? [rowFor(e, "QUANTITY", cancel)] : []), ...(e.left - cancel > 0 ? [rowFor(e, "REPLACE")] : [])];
  });
  if (rows.length) {
    await assertCorrectionRoom(tx, session.id, rows.length);
    await tx.insert(orderCorrections).values(rows);
  }
  const cancelledOf = (e: (typeof told)[number]) => (replacement ? Math.min(pendingCancel.get(e.id) ?? 0, e.left) : e.left);
  const affected = await withMembers(tx, session.id, [
    ...draft.map((e) => ({ ...e, removed: e.quantity, cancelled: 0, replaced: 0 })),
    ...told.map((e) => ({ ...e, removed: 0, cancelled: cancelledOf(e), replaced: replacement ? e.left - cancelledOf(e) : 0 })),
  ]);
  const total = (list: typeof affected, key: "removed" | "cancelled" | "replaced") => list.reduce((sum, e) => sum + e[key], 0);
  await notify(tx, session.id, {
    type: "dish.unavailable",
    recipients: audienceOfEntries(affected),
    subject: (id) => {
      const mine = forRecipient(affected, id);
      return { dishId: dish.id, dishName: dish.name, removed: total(mine, "removed"), cancelled: total(mine, "cancelled"), replaced: total(mine, "replaced"), replacement: replacement ?? null };
    },
    dedupKey: `dish.unavailable:${groupId}`,
    source: draft.map((e) => `entry:${e.id}`),
    actorId: actor.participantId,
  });
  const cancelled = total(affected, "cancelled");
  const replaced = total(affected, "replaced");
  return {
    result: { removedEntryIds: draft.map((e) => e.id), removed: draft.reduce((sum, e) => sum + e.quantity, 0), cancelled, replaced },
    // The open round's ticket is stale when its dishes or its pending corrections changed; a told-only change never touches it.
    event: { type: draft.length || dropped.length ? "dish.unavailable" : "dish.unavailableTold", payload: { dishId: dish.id } },
  };
}
