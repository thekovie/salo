import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { updateServed } from "@/server/orders/serving";
import { servingSchema } from "@/server/orders/validation";

type Params = { params: Promise<{ id: string }> };

/** Food tracker: the host or a co-host changes how many of one line have been served, by a delta clamped to 0..expected. */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    const input = await readJson(request, servingSchema);
    const type = `serving.update:${input.roundId}|${input.lineKey}`;
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type, usesFreshActor: true }, (tx, s, fresh) => updateServed(tx, s, fresh, input)));
  });
}
