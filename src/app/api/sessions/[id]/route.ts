import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { renameSessionSchema } from "@/server/orders/validation";
import { renameSession } from "@/server/sessions/rename";
import { getSnapshot } from "@/server/sessions/snapshot";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => ok(await getSnapshot(getDb(), await requireActor((await params).id))));
}

/** Rename the session (host only). */
export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    const { title } = await readJson(request, renameSessionSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "session.rename" }, (tx, s) => renameSession(tx, s, actor, title)));
  });
}
