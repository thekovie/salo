import { clientIp } from "@/server/auth/client-ip";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, requireActor } from "@/server/http";
import { parseCursor } from "@/server/realtime/events";
import { openEventStream } from "@/server/realtime/stream";

export const dynamic = "force-dynamic";

/** Session event stream (SSE). Authenticated like every other session endpoint; strangers get 404. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor((await params).id);
    const url = new URL(request.url);
    // EventSource sends Last-Event-ID on reconnect; the first connection passes the rendered revision as ?after=.
    const cursor = parseCursor(request.headers.get("last-event-id")) ?? parseCursor(url.searchParams.get("after"));
    const stream = await openEventStream(getDb(), actor, clientIp(request.headers), cursor, request.signal);
    if (!stream) throw new AppError(503, "TOO_MANY_STREAMS", "Too many open connections. Close other tabs of this order.");
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Tells nginx-style proxies (and Coolify's Traefik setups that honour it) not to buffer the stream.
        "X-Accel-Buffering": "no",
      },
    });
  });
}
