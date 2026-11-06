import { AppError } from "@/server/errors";
import { getDb } from "@/server/db/client";
import { isUuid } from "@/server/auth/actor";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { setEntryRemoved, updateEntry } from "@/server/orders/entries";
import { updateEntrySchema } from "@/server/orders/validation";

type Params = { params: Promise<{ id: string; entryId: string }> };

async function context(request: Request, params: Params["params"]) {
  const { id, entryId } = await params;
  if (!isUuid(entryId)) throw new AppError(404, "ENTRY_NOT_FOUND", "That dish isn’t in this order any more.");
  return { actor: await requireActor(id), entryId, key: idempotencyKey(request) };
}

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, entryId, key } = await context(request, params);
    const input = await readJson(request, updateEntrySchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "entry.update" }, (tx, s) => updateEntry(tx, s, actor, entryId, input)));
  });
}

/** Soft delete: the entry can be restored with POST …/restore (Undo). */
export async function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    const { actor, entryId, key } = await context(request, params);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "entry.remove" }, (tx, s) => setEntryRemoved(tx, s, actor, entryId, true)));
  });
}
