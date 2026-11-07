import { z } from "zod";
import { cookies } from "next/headers";
import { getEnv } from "@/env";
import { clientIp } from "@/server/auth/client-ip";
import { credentialCookieName, credentialCookieOptions } from "@/server/auth/credentials";
import { createTieredLimiter } from "@/server/auth/rate-limit";
import { createReplayStore, optionalIdempotencyKey } from "@/server/auth/replay";
import { verifyTurnstile } from "@/server/auth/turnstile";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, ok, readJson } from "@/server/http";
import { LIMITS } from "@/server/orders/validation";
import { createSession } from "@/server/sessions/create";
import { singleton } from "@/server/singleton";

const HOUR_MS = 60 * 60 * 1000;
/** Generous for a real table, tight for a script (brief 11.3). */
// Built on first use, not at import: the build has no runtime environment to read the limit from.
const limiter = () => singleton("create-session-limiter", () => createTieredLimiter({ limit: getEnv().NEW_ORDERS_PER_HOUR, windowMs: HOUR_MS }, { limit: getEnv().NEW_ORDERS_PER_HOUR * 15, windowMs: HOUR_MS }));

const bodySchema = z.object({ title: z.string().trim().max(LIMITS.title).nullish(), turnstileToken: z.string().max(4096).optional() });

const created = createReplayStore<{ sessionId: string; token: string }>("create-session");

export async function POST(request: Request) {
  return handle(async () => {
    // A retry after a lost response: same order, same cookie, no second order and no extra rate-limit hit.
    const key = optionalIdempotencyKey(request);
    const previous = key ? created.get(key) : undefined;
    if (previous) {
      (await cookies()).set(credentialCookieName(previous.sessionId), previous.token, credentialCookieOptions(getEnv().APP_URL));
      return ok({ id: previous.sessionId }, 200);
    }
    const { allowed, retryAfterMs } = limiter().hit(clientIp(request.headers));
    if (!allowed) throw new AppError(429, "RATE_LIMITED", `Too many new orders from this connection. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`);
    const { title, turnstileToken } = await readJson(request, bodySchema);
    // Bot check (Cloudflare Turnstile) when configured: only a person on our own site may start an order.
    const env = getEnv();
    if (env.TURNSTILE_SECRET_KEY) {
      if (!turnstileToken) throw new AppError(403, "BOT_CHECK_FAILED", "Please finish the quick check first.");
      const check = await verifyTurnstile({
        secret: env.TURNSTILE_SECRET_KEY,
        token: turnstileToken,
        ip: clientIp(request.headers),
        idempotencyKey: key,
        expectedHostname: new URL(env.APP_URL).hostname,
      });
      if (!check.ok && check.reason === "unavailable") throw new AppError(503, "BOT_CHECK_UNAVAILABLE", "We couldn’t run the quick check just now. Try again in a moment.");
      if (!check.ok) throw new AppError(403, "BOT_CHECK_FAILED", "The quick check didn’t pass. Try again.");
    }
    const session = await createSession(getDb(), title || null);
    if (key) created.set(key, session);
    (await cookies()).set(credentialCookieName(session.sessionId), session.token, credentialCookieOptions(getEnv().APP_URL));
    return ok({ id: session.sessionId }, 201);
  });
}
