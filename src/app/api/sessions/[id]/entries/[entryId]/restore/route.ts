import { AppError } from "@/server/errors";
import { getDb } from "@/server/db/client";
import { isUuid } from "@/server/auth/actor";
import { handle, idempotencyKey, ok, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { setEntryRemoved } from "@/server/orders/entries";

/** Undo a removal. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  return handle(async () => {
    const { id, entryId } = await params;
    if (!isUuid(entryId)) throw new AppError(404, "ENTRY_NOT_FOUND", "That dish isn’t in this order any more.");
    const actor = await requireActor(id);
    const key = idempotencyKey(request);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "entry.restore" }, (tx, s) => setEntryRemoved(tx, s, actor, entryId, false)));
  });
}
