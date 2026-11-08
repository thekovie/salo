import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { renameMe } from "@/server/orders/settlement";
import { renameMeSchema } from "@/server/orders/validation";

type Params = { params: Promise<{ id: string }> };

/** The host's own name (it starts as "Host"). */
export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    const input = await readJson(request, renameMeSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `participant.rename:${actor.participantId}` }, (tx, s) => renameMe(tx, s, actor, input)));
  });
}
