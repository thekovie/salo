import { isUuid } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { confirmRound } from "@/server/orders/rounds";
import { confirmSchema } from "@/server/orders/validation";

/** "Confirmed with waiter" (host only). The body carries the revision the host reviewed. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; roundId: string }> }) {
  return handle(async () => {
    const { id, roundId } = await params;
    if (!isUuid(roundId)) throw new AppError(404, "ROUND_NOT_OPEN", "This round isn’t open.");
    const actor = await requireActor(id);
    const key = idempotencyKey(request);
    const { expectedRevision } = await readJson(request, confirmSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "round.confirm" }, (tx, s) => confirmRound(tx, s, actor, roundId, expectedRevision)));
  });
}
