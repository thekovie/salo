import { isUuid } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, idempotencyKey, ok, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { removeCorrection } from "@/server/orders/rounds";

/** Take back a correction that has not reached the waiter yet (host only). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; correctionId: string }> }) {
  return handle(async () => {
    const { id, correctionId } = await params;
    if (!isUuid(correctionId)) throw new AppError(404, "CORRECTION_NOT_FOUND", "That correction isn’t there any more.");
    const actor = await requireActor(id);
    const key = idempotencyKey(request);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `correction.remove:${correctionId}` }, (tx, s) => removeCorrection(tx, s, actor, correctionId)));
  });
}
