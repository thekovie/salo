import { getDb } from "@/server/db/client";
import { handle, ok, readJson, requireActor } from "@/server/http";
import { limitReads } from "@/server/limits";
import { markNotificationsRead } from "@/server/notifications";
import { markReadSchema } from "@/server/orders/validation";

/** Private state, so no revision bump and no event: only your own rows change, and repeating it changes nothing. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    limitReads(actor);
    return ok(await markNotificationsRead(getDb(), actor, await readJson(request, markReadSchema)));
  });
}
