import { normalizeText } from "@/lib/dish-name";
import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { setSharedPrice } from "@/server/orders/settlement";
import { sharedPriceSchema } from "@/server/orders/validation";

type Params = { params: Promise<{ id: string }> };

/** KKB: the table price for one dish + size (host only). A null price removes it. */
export async function PUT(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const actor = await requireActor(id);
    const key = idempotencyKey(request);
    const input = await readJson(request, sharedPriceSchema);
    const type = `price.default:${input.dishId}|${normalizeText(input.variant ?? "")}`;
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type }, (tx, s) => setSharedPrice(tx, s, actor, input)));
  });
}
