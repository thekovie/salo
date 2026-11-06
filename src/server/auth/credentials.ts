import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, URL-safe: the participant's secret, kept only in their HttpOnly cookie. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the database stores instead of the token. Tokens are high-entropy, so a plain SHA-256 is enough. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const COOKIE_PREFIX = "salo_s_";
/** One cookie per session, so a phone can be the host of one table and a guest at another. */
export const credentialCookieName = (sessionId: string) => `${COOKIE_PREFIX}${sessionId}`;

export function sessionIdFromCookieName(name: string): string | null {
  return name.startsWith(COOKIE_PREFIX) ? name.slice(COOKIE_PREFIX.length) : null;
}

export const CREDENTIAL_MAX_AGE_S = 60 * 60 * 24 * 31;

export function credentialCookieOptions(appUrl: string) {
  return {
    httpOnly: true,
    secure: appUrl.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: CREDENTIAL_MAX_AGE_S,
  };
}
