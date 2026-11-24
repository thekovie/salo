import { isUuid } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { removeReceipt, setReceipt } from "@/server/orders/receipts";
import { receiptSchema, removeReceiptSchema } from "@/server/orders/validation";

type Params = { params: Promise<{ id: string; receiptId: string }> };

async function target({ params }: Params) {
  const { id, receiptId } = await params;
  if (!isUuid(receiptId)) throw new AppError(404, "RECEIPT_NOT_FOUND", "That receipt isn’t in this order any more.");
  return { actor: await requireActor(id), receiptId };
}

/** KKB: create or replace one extra receipt and the people it covers (host only, also after the order has ended). */
export async function PUT(request: Request, context: Params) {
  return handle(async () => {
    const { actor, receiptId } = await target(context);
    const key = idempotencyKey(request);
    const input = await readJson(request, receiptSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `receipt.set:${receiptId}`, allowClosed: true }, (tx, s) => setReceipt(tx, s, actor, receiptId, input)));
  });
}

export async function DELETE(request: Request, context: Params) {
  return handle(async () => {
    const { actor, receiptId } = await target(context);
    const key = idempotencyKey(request);
    const { expectedRevision } = await readJson(request, removeReceiptSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `receipt.remove:${receiptId}`, allowClosed: true }, (tx, s) => removeReceipt(tx, s, actor, receiptId, expectedRevision)));
  });
}
