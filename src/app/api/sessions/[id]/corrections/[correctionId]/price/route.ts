import { AppError } from "@/server/errors";
import { getDb } from "@/server/db/client";
import { isUuid } from "@/server/auth/actor";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { setCorrectionPrice } from "@/server/orders/settlement";
import { correctionPriceSchema } from "@/server/orders/validation";

type Params = { params: Promise<{ id: string; correctionId: string }> };

/** KKB: price each for a replacement dish (host only). */
export async function PUT(request: Request, { params }: Params) {
  return handle(async () => {
    const { id, correctionId } = await params;
    if (!isUuid(correctionId)) throw new AppError(404, "CORRECTION_NOT_FOUND", "That change isn’t in this order any more.");
    const actor = await requireActor(id);
    const key = idempotencyKey(request);
    const input = await readJson(request, correctionPriceSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `correction.price:${correctionId}` }, (tx, s) => setCorrectionPrice(tx, s, actor, correctionId, input)));
  });
}
