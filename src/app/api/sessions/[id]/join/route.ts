import { cookies } from "next/headers";
import { z } from "zod";
import { getEnv } from "@/env";
import { resolveActor } from "@/server/auth/actor";
import { clientIp } from "@/server/auth/client-ip";
import { credentialCookieName, credentialCookieOptions } from "@/server/auth/credentials";
import { createTieredLimiter } from "@/server/auth/rate-limit";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { handle, ok, readJson } from "@/server/http";
import { LIMITS } from "@/server/orders/validation";
import { joinSession } from "@/server/sessions/join";
import { singleton } from "@/server/singleton";

const HOUR_MS = 60 * 60 * 1000;
/** Also slows down guessing join codes (brief 11.3). */
const limiter = singleton("join-limiter", () => createTieredLimiter({ limit: 30, windowMs: HOUR_MS }, { limit: 600, windowMs: HOUR_MS }));

const bodySchema = z.object({
  code: z.string().trim().min(1).max(12),
  displayName: z
    .string()
    .trim()
    .min(1, "Type your name.")
    .max(LIMITS.label, `Keep your name under ${LIMITS.label} characters.`)
    .refine((v) => !v.includes("\u0000"), "That name contains an invalid character."),
});

/** Join as a guest. The session id in the path must match the code (a code alone never reveals another session). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { allowed, retryAfterMs } = limiter.hit(clientIp(request.headers));
    if (!allowed) throw new AppError(429, "RATE_LIMITED", `Too many tries. Wait ${Math.ceil(retryAfterMs / 60000)} minutes.`);
    const { id } = await params;
    const { code, displayName } = await readJson(request, bodySchema);
    const store = await cookies();
    // Already in this order on this browser (a second tab, a double tap): keep that identity, host or guest.
    if (await resolveActor(getDb(), id, store.get(credentialCookieName(id))?.value)) return ok({ id }, 200);
    const joined = await joinSession(getDb(), code, displayName, id);
    store.set(credentialCookieName(joined.sessionId), joined.token, credentialCookieOptions(getEnv().APP_URL));
    return ok({ id: joined.sessionId }, 201);
  });
}
