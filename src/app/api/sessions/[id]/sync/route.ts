import { getDb } from "@/server/db/client";
import { handle, ok, requireActor } from "@/server/http";
import { limitReads } from "@/server/limits";
import { getSnapshot } from "@/server/sessions/snapshot";

/** The authoritative snapshot, used after reconnecting or when events cannot be replayed (brief 7.6). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    limitReads(actor);
    return ok(await getSnapshot(getDb(), actor));
  });
}
