import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, idempotencyKey, ok, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { isUuid } from "@/server/auth/actor";
import { restoreParticipant } from "@/server/orders/people";

/** Undo a removal (host only): the guest is back, with the open-round dishes that left with them. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; pid: string }> }) {
  return handle(async () => {
    const { id, pid } = await params;
    const actor = await requireActor(id);
    if (!isUuid(pid)) throw new AppError(404, "PERSON_NOT_FOUND", "That person isn’t in this order.");
    const key = idempotencyKey(request);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `participant.restore:${pid}` }, (tx, s) => restoreParticipant(tx, s, actor, pid)));
  });
}
