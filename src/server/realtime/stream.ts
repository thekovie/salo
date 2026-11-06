import { eq } from "drizzle-orm";
import { log } from "@/lib/logger";
import type { Actor } from "@/lib/permissions";
import type { Db } from "@/server/db/client";
import { sessions } from "@/server/db/schema";
import { eventsAfter, formatEvent } from "./events";
import { hub } from "./hub";

const HEARTBEAT_MS = 20_000;
const RETRY_MS = 3000;
/**
 * Streams end after this long; the browser reconnects at once with Last-Event-ID and misses nothing. This re-checks
 * the credential and the connection caps regularly and frees slots held by forgotten tabs.
 */
export const MAX_STREAM_MS = 15 * 60 * 1000;

async function currentRevision(db: Db, sessionId: string): Promise<number> {
  const [row] = await db.select({ revision: sessions.revision }).from(sessions).where(eq(sessions.id, sessionId));
  return row?.revision ?? 0;
}

/**
 * A session's event stream (brief 7.5–7.8). Starts after `cursor` (Last-Event-ID on reconnect, or the revision the
 * page was rendered at), replays what was missed from the durable log, then follows NOTIFY. Sends a `resync` event
 * when history cannot be replayed, a heartbeat comment every 20 s so proxies keep the connection open, and cleans
 * up when the client goes away. Returns null when the connection caps are reached.
 */
export async function openEventStream(db: Db, actor: Actor, address: string, cursor: number | null, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
  let last = cursor ?? (await currentRevision(db, actor.sessionId));
  let flushing = false;
  let again = false;
  let closed = false;
  let push: (chunk: string) => void = () => {};
  let end: () => void = () => {};

  const flush = async () => {
    if (flushing) {
      again = true;
      return;
    }
    flushing = true;
    try {
      do {
        again = false;
        const replay = await eventsAfter(db, actor.sessionId, last);
        if (replay.kind === "resync") {
          last = await currentRevision(db, actor.sessionId);
          push(`id: ${last}\nevent: resync\ndata: {}\n\n`);
        } else {
          for (const event of replay.events) {
            push(formatEvent(event));
            last = event.id;
            // Removed from the order: they get this last event (their screen then says so) and nothing after it.
            if (event.type === "participant.removed" && event.payload.participantId === actor.participantId) {
              end();
              return;
            }
          }
        }
      } while (again && !closed);
    } catch (error) {
      log.warn("event stream read failed", { error, sessionId: actor.sessionId });
    } finally {
      flushing = false;
    }
  };

  const unsubscribe = await hub().subscribe(actor.sessionId, actor.participantId, address, (revision) => {
    if (!(revision <= last)) void flush();
  });
  if (!unsubscribe) return null;

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (heartbeat) clearInterval(heartbeat);
    if (lifetime) clearTimeout(lifetime);
  };

  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      push(`retry: ${RETRY_MS}\n\n`);
      heartbeat = setInterval(() => {
        push(": ping\n\n");
        // Also re-read the log: if an earlier read failed (a database hiccup), nothing else would retry it.
        void flush();
      }, HEARTBEAT_MS);
      end = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      // The client may have gone while we were subscribing: an already-aborted signal never fires "abort".
      if (signal.aborted) return end();
      signal.addEventListener("abort", end, { once: true });
      lifetime = setTimeout(() => end(), MAX_STREAM_MS);
      void flush();
    },
    cancel: cleanup,
  });
}
