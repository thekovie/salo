import { singleton } from "@/server/singleton";

const TTL_MS = 10 * 60 * 1000;
const MAX_KEYS = 2000;

interface Remembered<T> {
  value: T;
  expiresAt: number;
}

/**
 * Starting or joining an order can't go through `runMutation` (there is no order or person yet), so a retry after a
 * lost response would create a second order or a duplicate guest. The client sends an Idempotency-Key; this
 * remembers the outcome for ten minutes so the retry gets the same order, the same guest, and the same cookie.
 * ponytail: in process memory (one instance, like the rate limits); a table in PostgreSQL before scaling out.
 */
export function createReplayStore<T>(name: string) {
  return singleton(`replay:${name}`, () => {
    const map = new Map<string, Remembered<T>>();
    return {
      get(key: string, now = Date.now()): T | undefined {
        const hit = map.get(key);
        if (!hit) return undefined;
        if (hit.expiresAt <= now) {
          map.delete(key);
          return undefined;
        }
        return hit.value;
      },
      set(key: string, value: T, now = Date.now()) {
        map.delete(key);
        if (map.size >= MAX_KEYS) map.delete(map.keys().next().value as string);
        map.set(key, { value, expiresAt: now + TTL_MS });
      },
    };
  });
}

const KEY = /^[A-Za-z0-9_-]{8,128}$/;

/** The request's Idempotency-Key if present and well-formed; otherwise undefined (old clients keep working). */
export function optionalIdempotencyKey(request: Request): string | undefined {
  const key = request.headers.get("idempotency-key") ?? "";
  return KEY.test(key) ? key : undefined;
}
