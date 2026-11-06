import { log } from "@/lib/logger";
import { getDb } from "@/server/db/client";
import { EVENTS_CHANNEL } from "@/server/mutations";
import { singleton } from "@/server/singleton";

type Listener = (revision: number) => void;

/** Caps so one table or one script cannot exhaust the single app instance (brief 7.8). */
export const MAX_STREAMS = 500;
export const MAX_STREAMS_PER_PARTICIPANT = 4;

/**
 * One LISTEN connection per process, fanned out to the open streams of each session. NOTIFY is only the doorbell:
 * streams always read what to send from the durable event log, so a missed notification costs latency, never data.
 */
class Hub {
  private listeners = new Map<string, Set<Listener>>();
  private perParticipant = new Map<string, number>();
  private total = 0;
  private listening: Promise<void> | null = null;

  private ensureListening(): Promise<void> {
    this.listening ??= getDb()
      .$client.listen(
        EVENTS_CHANNEL,
        (payload) => {
          const [sessionId, rev] = payload.split(":");
          const revision = Number(rev);
          for (const listener of this.listeners.get(sessionId) ?? []) listener(revision);
        },
        // postgres.js re-runs LISTEN after reconnecting; wake every stream so it re-reads the log.
        () => {
          for (const set of this.listeners.values()) for (const listener of set) listener(Number.NaN);
        },
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        this.listening = null;
        log.error("realtime listen failed", { error });
        throw error;
      });
    return this.listening;
  }

  /** Returns an unsubscribe function, or null when a connection cap is reached. */
  async subscribe(sessionId: string, participantId: string, listener: Listener): Promise<(() => void) | null> {
    const mine = this.perParticipant.get(participantId) ?? 0;
    if (this.total >= MAX_STREAMS || mine >= MAX_STREAMS_PER_PARTICIPANT) return null;
    await this.ensureListening();
    this.total += 1;
    this.perParticipant.set(participantId, mine + 1);
    const set = this.listeners.get(sessionId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(sessionId, set);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.total -= 1;
      const left = (this.perParticipant.get(participantId) ?? 1) - 1;
      if (left <= 0) this.perParticipant.delete(participantId);
      else this.perParticipant.set(participantId, left);
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(sessionId);
    };
  }

  stats() {
    return { streams: this.total, sessions: this.listeners.size };
  }
}

export const hub = () => singleton("realtime-hub", () => new Hub());
