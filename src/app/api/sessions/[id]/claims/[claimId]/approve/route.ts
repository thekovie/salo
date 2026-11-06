import { isUuid } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, idempotencyKey, ok, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { resolveClaim } from "@/server/orders/people";

/** Host only. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; claimId: string }> }) {
  return handle(async () => {
    const { id, claimId } = await params;
    if (!isUuid(claimId)) throw new AppError(404, "CLAIM_NOT_FOUND", "That request isn’t there any more.");
    const actor = await requireActor(id);
    const key = idempotencyKey(request);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "claim.approve" }, (tx, s) => resolveClaim(tx, s, actor, claimId, true)));
  });
}
