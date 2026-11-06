import { eq } from "drizzle-orm";
import { log } from "@/lib/logger";
import type { Actor } from "@/lib/permissions";
import type { Db } from "@/server/db/client";
import { sessions } from "@/server/db/schema";
import { eventsAfter, formatEvent } from "./events";
import { hub } from "./hub";

const HEARTBEAT_MS = 20_000;
const RETRY_MS = 3000;

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
export async function openEventStream(db: Db, actor: Actor, cursor: number | null, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
  let last = cursor ?? (await currentRevision(db, actor.sessionId));
  let flushing = false;
  let again = false;
  let closed = false;
  let push: (chunk: string) => void = () => {};

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
          }
        }
      } while (again && !closed);
    } catch (error) {
      log.warn("event stream read failed", { error, sessionId: actor.sessionId });
    } finally {
      flushing = false;
    }
  };

  const unsubscribe = await hub().subscribe(actor.sessionId, actor.participantId, (revision) => {
    if (!(revision <= last)) void flush();
  });
  if (!unsubscribe) return null;

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (heartbeat) clearInterval(heartbeat);
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
      heartbeat = setInterval(() => push(": ping\n\n"), HEARTBEAT_MS);
      signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      void flush();
    },
    cancel: cleanup,
  });
}
