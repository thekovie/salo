import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { recordCorrection } from "@/server/orders/rounds";
import { correctionSchema } from "@/server/orders/validation";

/** Record a correction to a confirmed dish; it goes to the waiter with the open round (host only). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    const input = await readJson(request, correctionSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "correction.record" }, (tx, s) => recordCorrection(tx, s, actor, input)), 201);
  });
}
