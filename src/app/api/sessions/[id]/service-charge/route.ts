import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { setServiceCharge } from "@/server/orders/settlement";
import { serviceChargeSchema } from "@/server/orders/validation";

type Params = { params: Promise<{ id: string }> };

/** KKB: the receipt's service charge (host only). `centavos: null` clears it; 0 means the receipt has none. */
export async function PUT(request: Request, { params }: Params) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    const input = await readJson(request, serviceChargeSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "session.serviceCharge" }, (tx, s) => setServiceCharge(tx, s, actor, input)));
  });
}
