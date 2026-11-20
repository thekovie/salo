import { isUuid } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { markDishUnavailable } from "@/server/orders/unavailable";
import { unavailableSchema } from "@/server/orders/validation";

/** "The waiter said it's out": take the whole dish off the order, now (host only). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; dishId: string }> }) {
  return handle(async () => {
    const { id, dishId } = await params;
    if (!isUuid(dishId)) throw new AppError(404, "DISH_NOT_FOUND", "That dish isn’t in this order.");
    const actor = await requireActor(id);
    const key = idempotencyKey(request);
    const input = await readJson(request, unavailableSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `dish.unavailable:${dishId}` }, (tx, s) => markDishUnavailable(tx, s, actor, dishId, input)));
  });
}
