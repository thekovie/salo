import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { requestClaim } from "@/server/orders/people";
import { claimSchema } from "@/server/orders/validation";

/** A guest asks for a dish the host recorded ("that's mine"). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    const { batchId } = await readJson(request, claimSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "claim.request" }, (tx, s) => requestClaim(tx, s, actor, batchId)), 201);
  });
}
