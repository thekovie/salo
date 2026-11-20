import { z } from "zod";
import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { recordCorrection, recordCorrections } from "@/server/orders/rounds";
import { correctionBatchSchema, correctionSchema } from "@/server/orders/validation";

/** Record a correction to confirmed dishes; it goes to the waiter with the open round (host only). `entries` = one change across several people's dishes. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    const input = await readJson(request, z.union([correctionBatchSchema, correctionSchema]));
    const options = { idempotencyKey: key, type: "correction.record" };
    if ("entries" in input) return ok(await runMutation(getDb(), actor, options, (tx, s) => recordCorrections(tx, s, actor, input)), 201);
    return ok(await runMutation(getDb(), actor, options, (tx, s) => recordCorrection(tx, s, actor, input)), 201);
  });
}
