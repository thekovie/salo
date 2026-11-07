const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_ACTION = "create-order";
const TIMEOUT_MS = 5000;
/** Cloudflare's published test secrets (always pass / always fail / token already spent). */
const TEST_SECRET = /^[123]x0{31}AA$/;

export type TurnstileResult = { ok: true } | { ok: false; reason: "failed" | "unavailable" };

interface SiteverifyResponse {
  success: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
}

/**
 * Asks Cloudflare whether a Turnstile token came from a person on our own site, for the "start an order" action.
 * Never fails open: if Cloudflare can't be reached, the answer is "unavailable" and no order is created.
 */
export async function verifyTurnstile(
  input: { secret: string; token: string; ip?: string; idempotencyKey?: string; expectedHostname: string },
  fetcher: typeof fetch = fetch,
): Promise<TurnstileResult> {
  const body = new URLSearchParams({ secret: input.secret, response: input.token });
  if (input.ip && input.ip !== "unknown") body.set("remoteip", input.ip);
  if (input.idempotencyKey) body.set("idempotency_key", input.idempotencyKey);
  let data: SiteverifyResponse;
  try {
    const response = await fetcher(SITEVERIFY, { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return { ok: false, reason: "unavailable" };
    data = (await response.json()) as SiteverifyResponse;
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!data.success) return { ok: false, reason: "failed" };
  // Test secrets answer for a dummy site; real ones must be for our host and our action.
  if (TEST_SECRET.test(input.secret)) return { ok: true };
  if (data.hostname !== input.expectedHostname || data.action !== TURNSTILE_ACTION) return { ok: false, reason: "failed" };
  return { ok: true };
}
