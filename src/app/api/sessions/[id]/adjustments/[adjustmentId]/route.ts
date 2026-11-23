import { isUuid } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { removeAdjustment, setAdjustment } from "@/server/orders/adjustments";
import { adjustmentSchema, removeAdjustmentSchema } from "@/server/orders/validation";

type Params = { params: Promise<{ id: string; adjustmentId: string }> };

async function target({ params }: Params) {
  const { id, adjustmentId } = await params;
  if (!isUuid(adjustmentId)) throw new AppError(404, "ADJUSTMENT_NOT_FOUND", "That discount or charge isn’t in this order any more.");
  return { actor: await requireActor(id), adjustmentId };
}

/** KKB: create or replace one discount or extra charge and who it applies to (host only, also after the order has ended). */
export async function PUT(request: Request, context: Params) {
  return handle(async () => {
    const { actor, adjustmentId } = await target(context);
    const key = idempotencyKey(request);
    const input = await readJson(request, adjustmentSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `adjustment.set:${adjustmentId}`, allowClosed: true }, (tx, s) => setAdjustment(tx, s, actor, adjustmentId, input)));
  });
}

export async function DELETE(request: Request, context: Params) {
  return handle(async () => {
    const { actor, adjustmentId } = await target(context);
    const key = idempotencyKey(request);
    const { expectedRevision } = await readJson(request, removeAdjustmentSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `adjustment.remove:${adjustmentId}`, allowClosed: true }, (tx, s) => removeAdjustment(tx, s, actor, adjustmentId, expectedRevision)));
  });
}
