import { and, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { normalizeText, tidyText } from "@/lib/dish-name";
import { can, type Actor } from "@/lib/permissions";
import type { Tx } from "@/server/db/client";
import { adjustments, adjustmentShares, entryPayers, entrySettlements, orderBatches, orderEntries, participants, receiptPeople } from "@/server/db/schema";
import { AppError, forbidden } from "@/server/errors";
import type { Applied, SessionRow } from "@/server/mutations";
import { assertBillable, conflict } from "./settlement";
import { LIMITS, type AdjustmentInput } from "./validation";

const notFound = () => new AppError(404, "ADJUSTMENT_NOT_FOUND", "That discount or charge isn’t in this order any more.");

/** Another session's id looks the same as a missing one. */
async function lockOwn(tx: Tx, session: SessionRow, id: string) {
  const [row] = await tx.select().from(adjustments).where(eq(adjustments.id, id)).for("update");
  return row && row.sessionId === session.id ? row : undefined;
}

function label(raw: string): string {
  const name = tidyText(raw);
  if (!name || name.length > LIMITS.label) throw new AppError(422, "INVALID", "Keep the name under 40 characters.");
  return name;
}

// NFKC can expand a short note past the DB CHECK, so length is checked again after tidying.
function tidyNote(raw: string | null | undefined): string | null {
  const note = raw ? tidyText(raw) : "";
  if (note.length > LIMITS.label) throw new AppError(422, "INVALID", "Keep the note under 40 characters.");
  return note || null;
}

/** Create (`expectedRevision` 0) or replace one adjustment and its people, host only. Switching the method replaces the shares, never adds. */
export async function setAdjustment(tx: Tx, session: SessionRow, actor: Actor, id: string, input: AdjustmentInput): Promise<Applied<{ adjustmentId: string; revision: number }>> {
  if (!can(actor, "adjustment.set")) throw forbidden("Only the host can record discounts and extra charges.");
  await assertBillable(tx, session);
  const [existing] = await tx.select({ sessionId: adjustments.sessionId }).from(adjustments).where(eq(adjustments.id, id));
  if (existing && existing.sessionId !== session.id) throw notFound();
  const current = await lockOwn(tx, session, id);
  if (input.expectedRevision === 0 && current) throw conflict("this discount or charge");
  if (input.expectedRevision > 0 && !current) throw notFound();
  if (current && current.revision !== input.expectedRevision) throw conflict("this discount or charge");
  if (!current) {
    const [{ n }] = await tx.select({ n: count() }).from(adjustments).where(eq(adjustments.sessionId, session.id));
    if (n >= LIMITS.adjustmentsPerSession) throw new AppError(400, "TOO_MANY_ADJUSTMENTS", `An order can have up to ${LIMITS.adjustmentsPerSession} discounts and extra charges.`);
  }
  const ids = input.shares.flatMap((s) => (s.participantId ? [s.participantId] : []));
  if (ids.length) {
    const found = await tx.select({ id: participants.id }).from(participants).where(and(inArray(participants.id, ids), eq(participants.sessionId, session.id)));
    if (found.length !== ids.length) throw new AppError(404, "PERSON_NOT_FOUND", "That person isn’t in this order.");
  }

  const revision = (current?.revision ?? 0) + 1;
  const values = {
    direction: input.direction,
    category: input.category,
    note: tidyNote(input.note),
    amountCentavos: input.amountCentavos ?? null,
    percentBps: input.percentBps ?? null,
    method: input.method,
    revision,
    updatedBy: actor.participantId,
    updatedAt: new Date(),
  };
  if (current) {
    await tx.update(adjustments).set(values).where(eq(adjustments.id, id));
    await tx.delete(adjustmentShares).where(eq(adjustmentShares.adjustmentId, id));
  } else {
    await tx.insert(adjustments).values({ id, sessionId: session.id, ...values });
  }
  if (input.shares.length) {
    await tx.insert(adjustmentShares).values(
      input.shares.map((s) => ({ adjustmentId: id, sessionId: session.id, participantId: s.participantId ?? null, billToLabel: s.billToLabel ? label(s.billToLabel) : null, amountCentavos: s.amountCentavos ?? null })),
    );
  }
  return { result: { adjustmentId: id, revision }, event: { type: "adjustment.set", payload: { adjustmentId: id } } };
}

export async function removeAdjustment(tx: Tx, session: SessionRow, actor: Actor, id: string, expectedRevision: number): Promise<Applied<{ adjustmentId: string }>> {
  if (!can(actor, "adjustment.set")) throw forbidden("Only the host can record discounts and extra charges.");
  await assertBillable(tx, session);
  const current = await lockOwn(tx, session, id);
  if (!current) throw notFound();
  if (current.revision !== expectedRevision) throw conflict("this discount or charge");
  await tx.delete(adjustments).where(eq(adjustments.id, id));
  return { result: { adjustmentId: id }, event: { type: "adjustment.removed", payload: { adjustmentId: id } } };
}

/** Whether a typed name still has food of its own (dishes ordered for it, or dishes billed to it), so it keeps its KKB card. */
async function labelHasFood(tx: Tx, sessionId: string, key: string): Promise<boolean> {
  const ordered = await tx
    .selectDistinct({ label: orderBatches.collectiveLabel })
    .from(orderBatches)
    .innerJoin(orderEntries, eq(orderEntries.batchId, orderBatches.id))
    .where(and(eq(orderBatches.sessionId, sessionId), eq(orderBatches.attributionType, "INDIVIDUAL"), isNull(orderBatches.attributedParticipantId), isNotNull(orderBatches.collectiveLabel), isNull(orderEntries.deletedAt)));
  const billed = await tx.selectDistinct({ label: entrySettlements.billToLabel }).from(entrySettlements).where(and(eq(entrySettlements.sessionId, sessionId), isNotNull(entrySettlements.billToLabel)));
  const split = await tx.selectDistinct({ label: entryPayers.billToLabel }).from(entryPayers).where(and(eq(entryPayers.sessionId, sessionId), isNotNull(entryPayers.billToLabel)));
  return [...ordered, ...billed, ...split].some((r) => normalizeText(r.label ?? "") === key);
}

// A claim moves one draft batch only: while the typed name still has food, its shares stay on that card.
export async function adoptLabelShares(tx: Tx, sessionId: string, typedName: string, participantId: string): Promise<void> {
  const key = normalizeText(typedName);
  if (await labelHasFood(tx, sessionId, key)) return;
  await adoptReceiptLabel(tx, sessionId, key, participantId);
  const rows = await tx.select().from(adjustmentShares).where(and(eq(adjustmentShares.sessionId, sessionId), isNotNull(adjustmentShares.billToLabel)));
  for (const row of rows.filter((r) => normalizeText(r.billToLabel ?? "") === key)) {
    const [twin] = await tx.select().from(adjustmentShares).where(and(eq(adjustmentShares.adjustmentId, row.adjustmentId), eq(adjustmentShares.participantId, participantId)));
    if (!twin) {
      await tx.update(adjustmentShares).set({ participantId, billToLabel: null }).where(eq(adjustmentShares.id, row.id));
      continue;
    }
    if (row.amountCentavos !== null) await tx.update(adjustmentShares).set({ amountCentavos: (twin.amountCentavos ?? 0) + row.amountCentavos }).where(eq(adjustmentShares.id, twin.id));
    await tx.delete(adjustmentShares).where(eq(adjustmentShares.id, row.id));
  }
}

/** A typed name on an extra receipt becomes the claimant; if the claimant is already on one, the name's row just goes (one receipt per person). */
async function adoptReceiptLabel(tx: Tx, sessionId: string, key: string, participantId: string): Promise<void> {
  const rows = await tx.select().from(receiptPeople).where(and(eq(receiptPeople.sessionId, sessionId), isNotNull(receiptPeople.billToLabel)));
  const row = rows.find((r) => normalizeText(r.billToLabel ?? "") === key);
  if (!row) return;
  const [onOne] = await tx.select({ id: receiptPeople.id }).from(receiptPeople).where(and(eq(receiptPeople.sessionId, sessionId), eq(receiptPeople.participantId, participantId)));
  if (onOne) await tx.delete(receiptPeople).where(eq(receiptPeople.id, row.id));
  else await tx.update(receiptPeople).set({ participantId, billToLabel: null }).where(eq(receiptPeople.id, row.id));
}
