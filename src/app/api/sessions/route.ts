import { z } from "zod";
import { cookies } from "next/headers";
import { getEnv } from "@/env";
import { clientIp } from "@/server/auth/client-ip";
import { credentialCookieName, credentialCookieOptions } from "@/server/auth/credentials";
import { createRateLimiter } from "@/server/auth/rate-limit";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, ok, readJson } from "@/server/http";
import { LIMITS } from "@/server/orders/validation";
import { createSession } from "@/server/sessions/create";
import { singleton } from "@/server/singleton";

const HOUR_MS = 60 * 60 * 1000;
/** Generous for a real table, tight for a script (brief 11.3). */
const limiter = singleton("create-session-limiter", () => createRateLimiter({ limit: 20, windowMs: HOUR_MS }));

const bodySchema = z.object({ title: z.string().trim().max(LIMITS.title).nullish() });

export async function POST(request: Request) {
  return handle(async () => {
    const { allowed, retryAfterMs } = limiter.hit(clientIp(request.headers));
    if (!allowed) throw new AppError(429, "RATE_LIMITED", `Too many new orders from this connection. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`);
    const { title } = await readJson(request, bodySchema);
    const created = await createSession(getDb(), title || null);
    (await cookies()).set(credentialCookieName(created.sessionId), created.token, credentialCookieOptions(getEnv().APP_URL));
    return ok({ id: created.sessionId }, 201);
  });
}
