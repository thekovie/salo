import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { isUuid } from "@/server/auth/actor";
import { setCohost } from "@/server/orders/people";
import { cohostSchema } from "@/server/orders/validation";

/** Make a guest a co-host, or stop that (host only). A co-host can mark food served and nothing else. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string; pid: string }> }) {
  return handle(async () => {
    const { id, pid } = await params;
    const actor = await requireActor(id);
    if (!isUuid(pid)) throw new AppError(404, "PERSON_NOT_FOUND", "That person isn’t in this order.");
    const key = idempotencyKey(request);
    const { cohost } = await readJson(request, cohostSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `participant.cohost:${pid}` }, (tx, s) => setCohost(tx, s, actor, pid, cohost)));
  });
}
