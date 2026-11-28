import { isUuid } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { transferHost } from "@/server/orders/people";
import { transferHostSchema } from "@/server/orders/validation";

/** Hand the order to another guest (host only). The old host becomes a guest in the same transaction. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const actor = await requireActor(id);
    const key = idempotencyKey(request);
    const { participantId, displayName } = await readJson(request, transferHostSchema);
    if (!isUuid(participantId)) throw new AppError(404, "PERSON_NOT_FOUND", "That person isn’t in this order.");
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: `host.transfer:${participantId}` }, (tx, s, fresh) => transferHost(tx, s, fresh, participantId, displayName)));
  });
}
