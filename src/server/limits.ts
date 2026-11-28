import { createRateLimiter } from "@/server/auth/rate-limit";
import { AppError } from "@/server/errors";
import type { Actor } from "@/lib/permissions";
import { singleton } from "@/server/singleton";

const MINUTE_MS = 60_000;
/** Far above any real table (a fast host adds a dish every few seconds), low enough to stop a script. */
const mutationLimiter = singleton("mutation-limiter", () => createRateLimiter({ limit: 120, windowMs: MINUTE_MS }));

/** Per-participant cap on changes, checked by runMutation before any database work. */
export function limitMutations(actor: Actor): void {
  const { allowed, retryAfterMs } = mutationLimiter.hit(actor.participantId);
  if (!allowed) throw new AppError(429, "RATE_LIMITED", `Too many changes at once. Wait ${Math.ceil(retryAfterMs / 1000)} seconds.`);
}


/** A menu link is a rare change; 10 per 10 minutes per host stops a script without touching real use. */
const menuLimiter = singleton("menu-limiter", () => createRateLimiter({ limit: 10, windowMs: 10 * MINUTE_MS }));

export function limitMenuChanges(actor: Actor): void {
  const { allowed, retryAfterMs } = menuLimiter.hit(actor.participantId);
  if (!allowed) throw new AppError(429, "RATE_LIMITED", `Too many changes. Wait ${waitText(retryAfterMs)}.`);
}

/** "45 seconds", or "about 10 minutes" once a count of seconds stops being readable. */
export function waitText(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return seconds <= 90 ? `${seconds} seconds` : `about ${Math.ceil(seconds / 60)} minutes`;
}

/**
 * Full snapshots per participant. A phone asks for one after each change it hears about (coalesced, so a busy table
 * stays well under this); a script looping /sync would run four-plus queries per call.
 */
const readLimiter = singleton("snapshot-limiter", () => createRateLimiter({ limit: 120, windowMs: MINUTE_MS }));

export function limitReads(actor: Actor): void {
  const { allowed, retryAfterMs } = readLimiter.hit(actor.participantId);
  if (!allowed) throw new AppError(429, "RATE_LIMITED", `Too many refreshes. Wait ${Math.ceil(retryAfterMs / 1000)} seconds.`);
}
