import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { closeSession } from "@/server/orders/rounds";

/** End session (host only): read-only from now on, deleted after the closed-retention period. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "session.close" }, (tx, s) => closeSession(tx, s, actor)));
  });
}
