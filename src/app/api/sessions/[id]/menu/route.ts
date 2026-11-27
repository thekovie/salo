import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, readJson, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { menuLinkSchema } from "@/server/orders/validation";
import { setMenuLink } from "@/server/sessions/menu";

/** Set, change or remove the restaurant menu link (host only, open orders). The server never fetches the link. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    const input = await readJson(request, menuLinkSchema);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "session.menu" }, (tx, s) => setMenuLink(tx, s, actor, input)));
  });
}
