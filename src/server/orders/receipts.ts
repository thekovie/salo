import { and, count, eq, ne } from "drizzle-orm";
import { tidyText } from "@/lib/dish-name";
import { can, type Actor } from "@/lib/permissions";
import type { Tx } from "@/server/db/client";
import { receiptPeople, receipts } from "@/server/db/schema";
import { AppError, forbidden } from "@/server/errors";
import type { Applied, SessionRow } from "@/server/mutations";
import { keyOfRow, resolvePeople } from "./person-refs";
import { assertBillable, conflict } from "./settlement";
import { LIMITS, type ReceiptInput } from "./validation";

const notFound = () => new AppError(404, "RECEIPT_NOT_FOUND", "That receipt isn’t in this order any more.");

/** Another session's id looks the same as a missing one. */
async function lockOwn(tx: Tx, session: SessionRow, id: string) {
  const [row] = await tx.select().from(receipts).where(eq(receipts.id, id)).for("update");
  return row && row.sessionId === session.id ? row : undefined;
}

/** Create (`expectedRevision` 0) or replace one extra receipt and the people it covers, host only. */
export async function setReceipt(tx: Tx, session: SessionRow, actor: Actor, id: string, input: ReceiptInput): Promise<Applied<{ receiptId: string; revision: number }>> {
  if (!can(actor, "receipt.set")) throw forbidden("Only the host can record receipts.");
  await assertBillable(tx, session);
  const [existing] = await tx.select({ sessionId: receipts.sessionId }).from(receipts).where(eq(receipts.id, id));
  if (existing && existing.sessionId !== session.id) throw notFound();
  const current = await lockOwn(tx, session, id);
  if (input.expectedRevision === 0 && current) throw conflict("this receipt");
  if (input.expectedRevision > 0 && !current) throw notFound();
  if (current && current.revision !== input.expectedRevision) throw conflict("this receipt");
  if (!current) {
    const [{ n }] = await tx.select({ n: count() }).from(receipts).where(eq(receipts.sessionId, session.id));
    if (n >= LIMITS.receiptsPerSession) throw new AppError(400, "TOO_MANY_RECEIPTS", `An order can have up to ${LIMITS.receiptsPerSession} extra receipts.`);
  }
  const label = input.label ? tidyText(input.label) : "";
  if (label.length > LIMITS.label) throw new AppError(422, "INVALID", "Keep the label under 40 characters.");

  const mine = await tx.select().from(receiptPeople).where(eq(receiptPeople.receiptId, id));
  const people = await resolvePeople(tx, session.id, input.people, new Set(mine.map(keyOfRow)));
  const others = new Set((await tx.select().from(receiptPeople).where(and(eq(receiptPeople.sessionId, session.id), ne(receiptPeople.receiptId, id)))).map(keyOfRow));
  if (people.some((p) => others.has(keyOfRow(p)))) throw new AppError(409, "ALREADY_ON_RECEIPT", "Someone you picked is already on another receipt.");

  const revision = (current?.revision ?? 0) + 1;
  const values = { label: label || null, totalCentavos: input.totalCentavos, revision, updatedBy: actor.participantId, updatedAt: new Date() };
  if (current) {
    await tx.update(receipts).set(values).where(eq(receipts.id, id));
    await tx.delete(receiptPeople).where(eq(receiptPeople.receiptId, id));
  } else {
    await tx.insert(receipts).values({ id, sessionId: session.id, ...values });
  }
  await tx.insert(receiptPeople).values(people.map((p) => ({ receiptId: id, sessionId: session.id, ...p })));
  return { result: { receiptId: id, revision }, event: { type: "receipt.set", payload: { receiptId: id } } };
}

export async function removeReceipt(tx: Tx, session: SessionRow, actor: Actor, id: string, expectedRevision: number): Promise<Applied<{ receiptId: string }>> {
  if (!can(actor, "receipt.set")) throw forbidden("Only the host can record receipts.");
  await assertBillable(tx, session);
  const current = await lockOwn(tx, session, id);
  if (!current) throw notFound();
  if (current.revision !== expectedRevision) throw conflict("this receipt");
  await tx.delete(receipts).where(eq(receipts.id, id));
  return { result: { receiptId: id }, event: { type: "receipt.removed", payload: { receiptId: id } } };
}
