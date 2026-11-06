import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { isJoinCode, normalizeJoinCode } from "@/lib/join-code";
import { clientIp } from "@/server/auth/client-ip";
import { createRateLimiter } from "@/server/auth/rate-limit";
import { getDb } from "@/server/db/client";
import { singleton } from "@/server/singleton";
import { findInvite, type InviteInfo } from "./join";

const HOUR_MS = 60 * 60 * 1000;
/**
 * Wrong codes per client address per hour. Real guests type a code once or twice; guessing needs millions of misses.
 * Only misses count, so a table sharing one Wi-Fi stays far below it; once an address is over, every lookup from it
 * waits (a hit must not keep answering, or guessing would continue).
 */
const missLimiter = singleton("invite-miss-limiter", () => createRateLimiter({ limit: 40, windowMs: HOUR_MS }));

export type InviteLookup = { kind: "found"; invite: InviteInfo } | { kind: "missing" } | { kind: "limited" };

/**
 * Look up an invite for a page or preview, throttling guesses (brief 11.3). Cached per request, so the page and its
 * metadata count as one lookup.
 */
export const lookupInvite = cache(async (rawCode: string): Promise<InviteLookup> => {
  const key = clientIp(await headers());
  if (missLimiter.isLimited(key)) return { kind: "limited" };
  const code = normalizeJoinCode(rawCode);
  const invite = isJoinCode(code) ? await findInvite(getDb(), code) : null;
  if (invite) return { kind: "found", invite };
  missLimiter.hit(key);
  return { kind: "missing" };
});
