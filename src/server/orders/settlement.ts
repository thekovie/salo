import { and, eq, isNull, sql } from "drizzle-orm";
import { normalizeText, tidyText } from "@/lib/dish-name";
import { can, canEditPrice, type Actor } from "@/lib/permissions";
import type { Tx } from "@/server/db/client";
import { correctionSettlements, dishes, entryPayers, entrySettlements, orderBatches, orderCorrections, orderEntries, participants, rounds, sessions, sharedPrices } from "@/server/db/schema";
import { AppError, closed, forbidden } from "@/server/errors";
import { audienceOfEntries, notify, withMembers } from "@/server/notifications";
import { keyOfRow, resolvePeople } from "./person-refs";
import type { Applied, SessionRow } from "@/server/mutations";
import type { CorrectionPriceInput, EntrySettlementInput, RenameMeInput, ReceiptTotalInput, ServiceChargeInput, SharedPriceInput } from "./validation";

/**
 * Changes that never touch what the waiter is told (prices, the receipt's service charge, a person's name). Confirming
 * a round still passes when only these happened since the host looked (owner decision, KKB brief §6).
 */
export const NON_TICKET_EVENTS = ["entry.settled", "correction.priced", "session.serviceCharge", "session.receiptTotal", "receipt.set", "receipt.removed", "participant.renamed", "adjustment.set", "adjustment.removed", "price.defaultSet", "dish.unavailableTold", "serving.updated", "participant.cohostSet", "participant.cohostRevoked", "payment.recorded", "payment.updated", "payment.deleted", "host.transferred", "session.menuSet"] as const;

/** Length is checked again after tidying: NFKC can expand a few characters into many (DB CHECK is 1–40). */
export function tidyName(raw: string, message: string): string {
  const name = tidyText(raw);
  if (!name || name.length > 40) throw new AppError(422, "INVALID", message);
  return name;
}

export const conflict = (what: string) => new AppError(409, "CONFLICT", `Someone changed ${what} just now. Check the latest amount and try again.`);

/** Billing stays editable after End (host), but a cancelled order (ended before any round was confirmed) has nothing to bill. */
export async function assertBillable(tx: Tx, session: SessionRow): Promise<void> {
  if (session.status !== "CLOSED") return;
  const [confirmed] = await tx.select({ id: rounds.id }).from(rounds).where(and(eq(rounds.sessionId, session.id), eq(rounds.status, "CONFIRMED"))).limit(1);
  if (!confirmed) throw closed();
}

/** Price each and (host) Bill to for one source entry. Works on confirmed rounds: settlement rows are not order data. */
export async function setEntrySettlement(tx: Tx, session: SessionRow, actor: Actor, entryId: string, input: EntrySettlementInput): Promise<Applied<{ entryId: string; revision: number }>> {
  await assertBillable(tx, session);
  const [entry] = await tx
    .select({ id: orderEntries.id, deletedAt: orderEntries.deletedAt, submittedBy: orderBatches.submittedBy, attributionType: orderBatches.attributionType, attributedParticipantId: orderBatches.attributedParticipantId, collectiveLabel: orderBatches.collectiveLabel })
    .from(orderEntries)
    .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
    .where(and(eq(orderEntries.id, entryId), eq(orderBatches.sessionId, session.id)));
  if (!entry) throw new AppError(404, "ENTRY_NOT_FOUND", "That dish isn’t in this order any more.");
  if (entry.deletedAt) throw new AppError(409, "ENTRY_REMOVED", "That dish was removed. Undo the removal first.");
  if (input.unitPriceCentavos !== undefined && !canEditPrice(actor, entry)) throw forbidden("Only the host or the person who added this dish can price it.");
  if (input.unitPriceCentavos !== undefined && session.status === "CLOSED" && !can(actor, "price.editAny")) throw forbidden("Only the host can change prices after the order has ended.");
  if (input.billTo !== undefined || input.splitAmong !== undefined) {
    if (!can(actor, "billTo.set")) throw forbidden("Only the host can choose who pays for a shared dish.");
    const individual = entry.attributionType === "INDIVIDUAL" && (entry.attributedParticipantId || entry.collectiveLabel);
    if (individual) throw new AppError(422, "INVALID", "This dish is already for one person.");
    if (input.billTo && "participantId" in input.billTo) {
      const [person] = await tx.select({ id: participants.id }).from(participants).where(and(eq(participants.id, input.billTo.participantId), eq(participants.sessionId, session.id), isNull(participants.removedAt)));
      if (!person) throw new AppError(404, "PERSON_NOT_FOUND", "That person isn’t in this order.");
    }
  }

  const [current] = await tx.select().from(entrySettlements).where(eq(entrySettlements.entryId, entryId)).for("update");
  if ((current?.revision ?? 0) !== input.expectedRevision) throw conflict("this price");
  const payers = input.splitAmong ? await resolvePeople(tx, session.id, input.splitAmong, new Set((await tx.select().from(entryPayers).where(eq(entryPayers.entryId, entryId))).map(keyOfRow))) : null;
  const billTo =
    payers || input.billTo === null
      ? { billToParticipantId: null, billToLabel: null }
      : input.billTo === undefined
        ? {}
        : "participantId" in input.billTo
          ? { billToParticipantId: input.billTo.participantId, billToLabel: null }
          : { billToParticipantId: null, billToLabel: tidyName(input.billTo.label, "Keep the name under 40 characters.") };
  const price = input.unitPriceCentavos === undefined ? {} : { unitPriceCentavos: input.unitPriceCentavos };
  const revision = (current?.revision ?? 0) + 1;
  if (current) {
    await tx.update(entrySettlements).set({ ...price, ...billTo, revision, updatedBy: actor.participantId, updatedAt: new Date() }).where(eq(entrySettlements.entryId, entryId));
  } else {
    await tx.insert(entrySettlements).values({ entryId, sessionId: session.id, ...price, ...billTo, revision, updatedBy: actor.participantId });
  }
  // One mode at a time: a one-person Bill to (or clearing it) drops the split, a split clears Bill to.
  if (payers || input.billTo !== undefined) await tx.delete(entryPayers).where(eq(entryPayers.entryId, entryId));
  if (payers) await tx.insert(entryPayers).values(payers.map((p) => ({ entryId, sessionId: session.id, ...p })));
  // Prices never reset "I'm ready": they don't change what anyone ordered.
  return { result: { entryId, revision }, event: { type: "entry.settled", payload: { entryId } } };
}

/** Price each for a replacement ("Change it to …"). Host only, like corrections themselves. */
export async function setCorrectionPrice(tx: Tx, session: SessionRow, actor: Actor, correctionId: string, input: CorrectionPriceInput): Promise<Applied<{ correctionId: string; revision: number }>> {
  await assertBillable(tx, session);
  if (!can(actor, "price.editAny")) throw forbidden("Only the host can price a change.");
  const [correction] = await tx.select({ type: orderCorrections.correctionType }).from(orderCorrections).where(and(eq(orderCorrections.id, correctionId), eq(orderCorrections.sessionId, session.id)));
  if (!correction) throw new AppError(404, "CORRECTION_NOT_FOUND", "That change isn’t in this order any more.");
  if (correction.type !== "REPLACE") throw new AppError(422, "INVALID", "Only a replacement dish can have its own price.");
  const [current] = await tx.select().from(correctionSettlements).where(eq(correctionSettlements.correctionId, correctionId)).for("update");
  if ((current?.revision ?? 0) !== input.expectedRevision) throw conflict("this price");
  const revision = (current?.revision ?? 0) + 1;
  if (current) {
    await tx.update(correctionSettlements).set({ unitPriceCentavos: input.unitPriceCentavos, revision, updatedBy: actor.participantId, updatedAt: new Date() }).where(eq(correctionSettlements.correctionId, correctionId));
  } else {
    await tx.insert(correctionSettlements).values({ correctionId, sessionId: session.id, unitPriceCentavos: input.unitPriceCentavos, revision, updatedBy: actor.participantId });
  }
  return { result: { correctionId, revision }, event: { type: "correction.priced", payload: { correctionId } } };
}

/**
 * The table price for one dish + size (host only). Null removes it. `clearEntryId` drops that line's own price in the
 * same change ("Every … here"), so the line follows the table price. Lines with their own price are never touched otherwise.
 */
export async function setSharedPrice(tx: Tx, session: SessionRow, actor: Actor, input: SharedPriceInput): Promise<Applied<{ revision: number }>> {
  await assertBillable(tx, session);
  if (!can(actor, "price.default")) throw forbidden("Only the host can set a table price.");
  const [dish] = await tx.select({ id: dishes.id, name: dishes.canonicalName }).from(dishes).where(and(eq(dishes.id, input.dishId), eq(dishes.sessionId, session.id)));
  if (!dish) throw new AppError(404, "DISH_NOT_FOUND", "That dish isn’t in this order any more.");
  const variantKey = normalizeText(input.variant ?? "");
  const key = and(eq(sharedPrices.sessionId, session.id), eq(sharedPrices.dishId, input.dishId), eq(sharedPrices.variantKey, variantKey));
  const [current] = await tx.select().from(sharedPrices).where(key).for("update");
  if ((current?.revision ?? 0) !== input.expectedRevision) throw conflict("this table price");

  if (input.clearEntryId) {
    const [entry] = await tx
      .select({ dishId: orderEntries.dishId, variant: orderEntries.variant })
      .from(orderEntries)
      .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
      .where(and(eq(orderEntries.id, input.clearEntryId), eq(orderBatches.sessionId, session.id)));
    if (!entry || entry.dishId !== input.dishId || normalizeText(entry.variant ?? "") !== variantKey) throw new AppError(404, "ENTRY_NOT_FOUND", "That dish isn’t in this order any more.");
    const [own] = await tx.select({ revision: entrySettlements.revision }).from(entrySettlements).where(eq(entrySettlements.entryId, input.clearEntryId)).for("update");
    if ((own?.revision ?? 0) !== input.expectedEntryRevision) throw conflict("this line's price");
    if (own) {
      await tx
        .update(entrySettlements)
        .set({ unitPriceCentavos: null, revision: sql`${entrySettlements.revision} + 1`, updatedBy: actor.participantId, updatedAt: new Date() })
        .where(eq(entrySettlements.entryId, input.clearEntryId));
    }
  }

  const revision = (current?.revision ?? 0) + 1;
  // A cleared table price keeps its row (price null) so the revision never restarts and a stale editor can't win.
  if (current) await tx.update(sharedPrices).set({ unitCentavos: input.unitCentavos, revision, updatedBy: actor.participantId, updatedAt: new Date() }).where(key);
  else await tx.insert(sharedPrices).values({ sessionId: session.id, dishId: input.dishId, variantKey, unitCentavos: input.unitCentavos, revision, updatedBy: actor.participantId });
  if ((current?.unitCentavos ?? null) !== input.unitCentavos) {
    const lines = await tx
      .select({ id: orderEntries.id, quantity: orderEntries.quantity, variant: orderEntries.variant, attrType: orderBatches.attributionType, forId: orderBatches.attributedParticipantId, label: orderBatches.collectiveLabel })
      .from(orderEntries)
      .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
      .leftJoin(entrySettlements, eq(entrySettlements.entryId, orderEntries.id))
      .where(and(eq(orderEntries.dishId, input.dishId), eq(orderBatches.sessionId, session.id), isNull(orderEntries.deletedAt), isNull(entrySettlements.unitPriceCentavos)));
    const size = tidyText(input.variant ?? "");
    await notify(tx, session.id, {
      type: "price.defaultSet",
      recipients: audienceOfEntries(await withMembers(tx, session.id, lines.filter((l) => normalizeText(l.variant ?? "") === variantKey))),
      subject: { dishId: input.dishId, label: size ? `${dish.name} (${size})` : dish.name, centavos: input.unitCentavos },
      dedupKey: `price.defaultSet:${input.dishId}|${variantKey}|${revision}`,
      actorId: actor.participantId,
    });
  }
  return { result: { revision }, event: { type: "price.defaultSet", payload: { dishId: input.dishId } } };
}

/** The receipt's service charge: null = not entered, 0 = none on the receipt. Host only. */
export async function setServiceCharge(tx: Tx, session: SessionRow, actor: Actor, input: ServiceChargeInput): Promise<Applied<{ revision: number }>> {
  await assertBillable(tx, session);
  if (!can(actor, "serviceCharge.set")) throw forbidden("Only the host can enter the service charge.");
  if (session.serviceChargeRevision !== input.expectedRevision) throw conflict("the service charge");
  const revision = session.serviceChargeRevision + 1;
  await tx.update(sessions).set({ serviceChargeCentavos: input.centavos, serviceChargeRevision: revision }).where(eq(sessions.id, session.id));
  return { result: { revision }, event: { type: "session.serviceCharge", payload: {} } };
}

/** The receipt's printed total, only compared with Salo's (never split). null = not entered. Host only. */
export async function setReceiptTotal(tx: Tx, session: SessionRow, actor: Actor, input: ReceiptTotalInput): Promise<Applied<{ revision: number }>> {
  await assertBillable(tx, session);
  if (!can(actor, "receipt.set")) throw forbidden("Only the host can enter the receipt total.");
  if (session.receiptTotalRevision !== input.expectedRevision) throw conflict("the receipt total");
  const revision = session.receiptTotalRevision + 1;
  await tx.update(sessions).set({ receiptTotalCentavos: input.centavos, receiptTotalRevision: revision }).where(eq(sessions.id, session.id));
  return { result: { revision }, event: { type: "session.receiptTotal", payload: {} } };
}

/** The host's own name (it starts as "Host"; starting an order stays one tap). */
export async function renameMe(tx: Tx, session: SessionRow, actor: Actor, input: RenameMeInput): Promise<Applied<{ participantId: string }>> {
  if (!can(actor, "participant.renameSelf")) throw forbidden("Only the host can change their name here.");
  const displayName = tidyName(input.displayName, "Type your name (up to 40 characters) so the table knows whose order is whose.");
  await tx.update(participants).set({ displayName }).where(and(eq(participants.id, actor.participantId), eq(participants.sessionId, session.id)));
  return { result: { participantId: actor.participantId }, event: { type: "participant.renamed", payload: { participantId: actor.participantId } } };
}
