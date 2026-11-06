import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { setGroupMembers } from "@/server/orders/people";
import { groupMembersSchema } from "@/server/orders/validation";

/** Set the optional members of a collective group, by its label. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    const { label, memberIds } = await readJson(request, groupMembersSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "group.members" }, (tx, s) => setGroupMembers(tx, s, actor, label, memberIds)));
  });
}
