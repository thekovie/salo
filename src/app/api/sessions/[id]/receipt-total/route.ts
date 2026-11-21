import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { setReceiptTotal } from "@/server/orders/settlement";
import { receiptTotalSchema } from "@/server/orders/validation";

type Params = { params: Promise<{ id: string }> };

/** KKB: the receipt's printed total (host only), compared with Salo's. `centavos: null` clears it. */
export async function PUT(request: Request, { params }: Params) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    const input = await readJson(request, receiptTotalSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "session.receiptTotal" }, (tx, s) => setReceiptTotal(tx, s, actor, input)));
  });
}
