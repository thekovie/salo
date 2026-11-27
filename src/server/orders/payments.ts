import { and, count, eq } from "drizzle-orm";
import { tidyText } from "@/lib/dish-name";
import { can, type Actor } from "@/lib/permissions";
import type { Tx } from "@/server/db/client";
import { participants, payments } from "@/server/db/schema";
import { AppError, forbidden } from "@/server/errors";
import type { Applied, SessionRow } from "@/server/mutations";
import { deleteNoticesBySource, notify } from "@/server/notifications";
import { keyOfRow, resolvePeople, type PersonRow } from "./person-refs";
import { assertBillable } from "./settlement";
import { LIMITS, type PayeeInput, type PaymentInput } from "./validation";

const notFound = () => new AppError(404, "PAYMENT_NOT_FOUND", "That payment isn’t in this order any more.");
const source = (id: string) => `payment:${id}`;

/** Another session's id looks the same as a missing one. */
async function lockOwn(tx: Tx, session: SessionRow, id: string) {
  const [row] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
  return row && row.sessionId === session.id ? row : undefined;
}

const sameRow = (row: typeof payments.$inferSelect, input: PaymentInput, payer: PersonRow, payee: PersonRow | null, note: string | null) =>
  keyOfRow({ participantId: row.participantId, billToLabel: row.label }) === keyOfRow(payer) &&
  (row.payeeParticipantId || row.payeeLabel ? keyOfRow({ participantId: row.payeeParticipantId, billToLabel: row.payeeLabel }) : null) === (payee ? keyOfRow(payee) : null) &&
  row.amountCentavos === input.amountCentavos &&
  row.method === input.method &&
  row.note === note;

/** Record one payment (host only). The same id with the same body is a 200 no-op; a different body is a 409. */
export async function recordPayment(tx: Tx, session: SessionRow, actor: Actor, id: string, input: PaymentInput): Promise<Applied<{ paymentId: string }>> {
  if (!can(actor, "settlement.record")) throw forbidden("Only the host can record payments.");
  await assertBillable(tx, session);
  const [existing] = await tx.select({ sessionId: payments.sessionId }).from(payments).where(eq(payments.id, id));
  if (existing && existing.sessionId !== session.id) throw notFound();

  // The payer may have left the order since; they must still belong to it. The payee must be active.
  const [payer] = await resolvePeople(tx, session.id, [input.payer], new Set(["participantId" in input.payer ? `p:${input.payer.participantId}` : ""]));
  if (payer.participantId) {
    const [member] = await tx.select({ id: participants.id }).from(participants).where(and(eq(participants.id, payer.participantId), eq(participants.sessionId, session.id)));
    if (!member) throw new AppError(404, "PERSON_NOT_FOUND", "That person isn’t in this order.");
  }
  const payee = input.payee ? (await resolvePeople(tx, session.id, [input.payee], new Set()))[0] : null;
  if (payee && keyOfRow(payee) === keyOfRow(payer)) throw new AppError(422, "INVALID", "Pick someone else.");
  const note = input.note ? tidyText(input.note) : null;
  if (note && note.length > LIMITS.label) throw new AppError(422, "INVALID", "Keep the note under 40 characters.");

  const current = await lockOwn(tx, session, id);
  const event = { type: "payment.recorded", payload: { paymentId: id } };
  if (current) {
    if (!sameRow(current, input, payer, payee, note)) throw new AppError(409, "CONFLICT", "That payment was already recorded with different details.");
    return { result: { paymentId: id }, event };
  }
  const [{ n }] = await tx.select({ n: count() }).from(payments).where(eq(payments.sessionId, session.id));
  if (n >= LIMITS.paymentsPerSession) throw new AppError(400, "TOO_MANY_PAYMENTS", `An order can have up to ${LIMITS.paymentsPerSession} payments.`);

  await tx.insert(payments).values({
    id,
    sessionId: session.id,
    participantId: payer.participantId,
    label: payer.billToLabel,
    payeeParticipantId: payee?.participantId ?? null,
    payeeLabel: payee?.billToLabel ?? null,
    amountCentavos: input.amountCentavos,
    method: input.method,
    note,
    createdBy: actor.participantId,
  });
  // A typed payer has no phone to tell; the host's own card is skipped because `notify` leaves the actor out.
  await notify(tx, session.id, { type: "payment.recorded", subject: { centavos: input.amountCentavos, host: actor.displayName }, recipients: [payer.participantId], dedupKey: source(id), source: [source(id)], actorId: actor.participantId });
  return { result: { paymentId: id }, event };
}

/** Fix the payee of a payment that needs review (host only). Anything else is a 409: payments are otherwise never edited. */
export async function fixPaymentPayee(tx: Tx, session: SessionRow, actor: Actor, id: string, input: PayeeInput): Promise<Applied<{ paymentId: string }>> {
  if (!can(actor, "settlement.record")) throw forbidden("Only the host can record payments.");
  await assertBillable(tx, session);
  const row = await lockOwn(tx, session, id);
  if (!row) throw notFound();
  const payerKey = keyOfRow({ participantId: row.participantId, billToLabel: row.label });
  const flagged = (row.payeeParticipantId || row.payeeLabel) && keyOfRow({ participantId: row.payeeParticipantId, billToLabel: row.payeeLabel }) === payerKey;
  if (!flagged) throw new AppError(409, "NOT_NEEDS_REVIEW", "That payment doesn’t need review any more.");
  const payee = input.payee ? (await resolvePeople(tx, session.id, [input.payee], new Set()))[0] : null;
  if (payee && keyOfRow(payee) === payerKey) throw new AppError(422, "INVALID", "Pick someone else.");
  await tx.update(payments).set({ payeeParticipantId: payee?.participantId ?? null, payeeLabel: payee?.billToLabel ?? null }).where(eq(payments.id, id));
  await deleteNoticesBySource(tx, session.id, [`payment-review:${id}`]);
  return { result: { paymentId: id }, event: { type: "payment.updated", payload: { paymentId: id } } };
}

export async function deletePayment(tx: Tx, session: SessionRow, actor: Actor, id: string): Promise<Applied<{ paymentId: string }>> {
  if (!can(actor, "settlement.record")) throw forbidden("Only the host can record payments.");
  await assertBillable(tx, session);
  if (!(await lockOwn(tx, session, id))) throw notFound();
  await tx.delete(payments).where(eq(payments.id, id));
  await deleteNoticesBySource(tx, session.id, [source(id)]);
  return { result: { paymentId: id }, event: { type: "payment.deleted", payload: { paymentId: id } } };
}
