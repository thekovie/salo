import { and, eq, isNull } from "drizzle-orm";
import { tidyText } from "@/lib/dish-name";
import { can, canEditPrice, type Actor } from "@/lib/permissions";
import type { Tx } from "@/server/db/client";
import { correctionSettlements, entrySettlements, orderBatches, orderCorrections, orderEntries, participants, sessions } from "@/server/db/schema";
import { AppError, forbidden } from "@/server/errors";
import type { Applied, SessionRow } from "@/server/mutations";
import type { CorrectionPriceInput, EntrySettlementInput, RenameMeInput, ServiceChargeInput } from "./validation";

/**
 * Changes that never touch what the waiter is told (prices, the receipt's service charge, a person's name). Confirming
 * a round still passes when only these happened since the host looked (owner decision, KKB brief §6).
 */
export const NON_TICKET_EVENTS = ["entry.settled", "correction.priced", "session.serviceCharge", "participant.renamed"] as const;

/** Length is checked again after tidying: NFKC can expand a few characters into many (DB CHECK is 1–40). */
function tidyName(raw: string, message: string): string {
  const name = tidyText(raw);
  if (!name || name.length > 40) throw new AppError(422, "INVALID", message);
  return name;
}

const conflict = (what: string) => new AppError(409, "CONFLICT", `Someone changed ${what} just now. Check the latest amount and try again.`);

/** Price each and (host) Bill to for one source entry. Works on confirmed rounds: settlement rows are not order data. */
export async function setEntrySettlement(tx: Tx, session: SessionRow, actor: Actor, entryId: string, input: EntrySettlementInput): Promise<Applied<{ entryId: string; revision: number }>> {
  const [entry] = await tx
    .select({ id: orderEntries.id, deletedAt: orderEntries.deletedAt, submittedBy: orderBatches.submittedBy, attributionType: orderBatches.attributionType, attributedParticipantId: orderBatches.attributedParticipantId, collectiveLabel: orderBatches.collectiveLabel })
    .from(orderEntries)
    .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
    .where(and(eq(orderEntries.id, entryId), eq(orderBatches.sessionId, session.id)));
  if (!entry) throw new AppError(404, "ENTRY_NOT_FOUND", "That dish isn’t in this order any more.");
  if (entry.deletedAt) throw new AppError(409, "ENTRY_REMOVED", "That dish was removed. Undo the removal first.");
  if (input.unitPriceCentavos !== undefined && !canEditPrice(actor, entry)) throw forbidden("Only the host or the person who added this dish can price it.");
  if (input.billTo !== undefined) {
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
  const billTo =
    input.billTo === undefined
      ? {}
      : input.billTo === null
        ? { billToParticipantId: null, billToLabel: null }
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
  // Prices never reset "I'm ready": they don't change what anyone ordered.
  return { result: { entryId, revision }, event: { type: "entry.settled", payload: { entryId } } };
}

/** Price each for a replacement ("Change it to …"). Host only, like corrections themselves. */
export async function setCorrectionPrice(tx: Tx, session: SessionRow, actor: Actor, correctionId: string, input: CorrectionPriceInput): Promise<Applied<{ correctionId: string; revision: number }>> {
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

/** The receipt's service charge: null = not entered, 0 = none on the receipt. Host only. */
export async function setServiceCharge(tx: Tx, session: SessionRow, actor: Actor, input: ServiceChargeInput): Promise<Applied<{ revision: number }>> {
  if (!can(actor, "serviceCharge.set")) throw forbidden("Only the host can enter the service charge.");
  if (session.serviceChargeRevision !== input.expectedRevision) throw conflict("the service charge");
  const revision = session.serviceChargeRevision + 1;
  await tx.update(sessions).set({ serviceChargeCentavos: input.centavos, serviceChargeRevision: revision }).where(eq(sessions.id, session.id));
  return { result: { revision }, event: { type: "session.serviceCharge", payload: {} } };
}

/** The host's own name (it starts as "Host"; starting an order stays one tap). */
export async function renameMe(tx: Tx, session: SessionRow, actor: Actor, input: RenameMeInput): Promise<Applied<{ participantId: string }>> {
  if (!can(actor, "participant.renameSelf")) throw forbidden("Only the host can change their name here.");
  const displayName = tidyName(input.displayName, "Type your name (up to 40 characters) so the table knows whose order is whose.");
  await tx.update(participants).set({ displayName }).where(and(eq(participants.id, actor.participantId), eq(participants.sessionId, session.id)));
  return { result: { participantId: actor.participantId }, event: { type: "participant.renamed", payload: { participantId: actor.participantId } } };
}
