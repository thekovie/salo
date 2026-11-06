import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { isUuid } from "@/server/auth/actor";
import { removeParticipant } from "@/server/orders/people";
import { removeParticipantSchema } from "@/server/orders/validation";

/** Remove a guest (host only), with an optional reason only that guest sees. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; pid: string }> }) {
  return handle(async () => {
    const { id, pid } = await params;
    const actor = await requireActor(id);
    if (!isUuid(pid)) throw new AppError(404, "PERSON_NOT_FOUND", "That person isn’t in this order.");
    const key = idempotencyKey(request);
    const { reason } = await readJson(request, removeParticipantSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "participant.remove" }, (tx, s) => removeParticipant(tx, s, actor, pid, reason ?? null)));
  });
}
