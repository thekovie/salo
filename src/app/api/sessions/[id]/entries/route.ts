import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { addEntry } from "@/server/orders/entries";
import { addEntrySchema } from "@/server/orders/validation";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    const input = await readJson(request, addEntrySchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "entry.add" }, (tx, s) => addEntry(tx, s, actor, input)), 201);
  });
}
