import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { setReady } from "@/server/orders/people";
import { readySchema } from "@/server/orders/validation";

/** Mark yourself ready (or not) for the open round. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    const { ready } = await readJson(request, readySchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "ready.set" }, (tx, s) => setReady(tx, s, actor, ready)));
  });
}
