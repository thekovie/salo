import { AppError } from "@/server/errors";
import { getDb } from "@/server/db/client";
import { isUuid } from "@/server/auth/actor";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { setEntrySettlement } from "@/server/orders/settlement";
import { entrySettlementSchema } from "@/server/orders/validation";

type Params = { params: Promise<{ id: string; entryId: string }> };

/** KKB: price each and (host) Bill to for one entry, draft or confirmed, while the order is open. */
export async function PUT(request: Request, { params }: Params) {
  return handle(async () => {
    const { id, entryId } = await params;
    if (!isUuid(entryId)) throw new AppError(404, "ENTRY_NOT_FOUND", "That dish isn’t in this order any more.");
    const actor = await requireActor(id);
    const key = idempotencyKey(request);
    const input = await readJson(request, entrySettlementSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `entry.settle:${entryId}` }, (tx, s) => setEntrySettlement(tx, s, actor, entryId, input)));
  });
}
