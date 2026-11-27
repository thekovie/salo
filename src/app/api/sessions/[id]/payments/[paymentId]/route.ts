import { isUuid } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { deletePayment, fixPaymentPayee, recordPayment } from "@/server/orders/payments";
import { payeeSchema, paymentSchema } from "@/server/orders/validation";

type Params = { params: Promise<{ id: string; paymentId: string }> };

async function target({ params }: Params) {
  const { id, paymentId } = await params;
  if (!isUuid(paymentId)) throw new AppError(404, "PAYMENT_NOT_FOUND", "That payment isn’t in this order any more.");
  return { actor: await requireActor(id), paymentId };
}

/** KKB: record one payment (host only, also after the order has ended). The id is client-minted, so a retry never duplicates. */
export async function PUT(request: Request, context: Params) {
  return handle(async () => {
    const { actor, paymentId } = await target(context);
    const key = idempotencyKey(request);
    const input = await readJson(request, paymentSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `payment.set:${paymentId}`, allowClosed: true }, (tx, s) => recordPayment(tx, s, actor, paymentId, input)));
  });
}

/** KKB: set the payee of a payment that needs review (host only). Other payments are never edited. */
export async function PATCH(request: Request, context: Params) {
  return handle(async () => {
    const { actor, paymentId } = await target(context);
    const key = idempotencyKey(request);
    const input = await readJson(request, payeeSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `payment.payee:${paymentId}`, allowClosed: true }, (tx, s) => fixPaymentPayee(tx, s, actor, paymentId, input)));
  });
}

/** Delete and record again. No body. */
export async function DELETE(request: Request, context: Params) {
  return handle(async () => {
    const { actor, paymentId } = await target(context);
    const key = idempotencyKey(request);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `payment.delete:${paymentId}`, allowClosed: true }, (tx, s) => deletePayment(tx, s, actor, paymentId)));
  });
}
