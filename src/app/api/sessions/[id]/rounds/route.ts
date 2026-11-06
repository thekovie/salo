import { getDb } from "@/server/db/client";
import { handle, idempotencyKey, ok, requireActor } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { openRound } from "@/server/orders/rounds";
import { getSnapshot } from "@/server/sessions/snapshot";

/** Round history with confirmed tickets (also part of the snapshot). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const snapshot = await getSnapshot(getDb(), await requireActor((await params).id));
    return ok({ rounds: snapshot.rounds, tickets: snapshot.tickets, corrections: snapshot.corrections });
  });
}

/** Start the next round (host only). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const key = idempotencyKey(request);
    return ok(await runMutation(getDb(), actor, { idempotencyKey: key, type: "round.open" }, (tx, s) => openRound(tx, s, actor)), 201);
  });
}
