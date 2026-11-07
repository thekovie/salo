import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function nonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/**
 * The origins a state-changing request may come from: this app's public address, plus the address the request
 * itself was made to (useful for local trials on another port). Cookies are SameSite=Lax as well; this is the
 * second CSRF layer (brief 11.4).
 */
export function isSameOrigin(request: { headers: Pick<Headers, "get">; nextUrl: Pick<URL, "origin"> }, appUrl: string | undefined): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([request.nextUrl.origin]);
  if (appUrl) allowed.add(new URL(appUrl).origin);
  return allowed.has(origin);
}

/**
 * Two jobs. (1) API mutations must come from Salo's own pages (Origin check). (2) Pages get a Content-Security-Policy
 * with a fresh nonce: Next stamps its own scripts with it, so injected scripts without it do not run.
 */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request, process.env.APP_URL)) {
      return NextResponse.json({ error: { code: "FORBIDDEN_ORIGIN", message: "This request did not come from Salo." } }, { status: 403 });
    }
    // API routes render no pages: drop any client-supplied nonce or CSP header, then pass through.
    const headers = new Headers(request.headers);
    headers.delete("x-nonce");
    headers.delete("content-security-policy");
    return NextResponse.next({ request: { headers } });
  }

  const scriptNonce = nonce();
  const csp = buildCsp({
    nonce: scriptNonce,
    isDev: process.env.NODE_ENV === "development",
    isHttps: (process.env.APP_URL ?? "").startsWith("https://"),
  });
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", csp);
  headers.set("x-nonce", scriptNonce);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Everything except static files and generated images (icons and link previews carry no scripts).
  matcher: ["/((?!_next/static/|_next/image|favicon\\.ico$|icon\\.svg$|apple-icon$|opengraph-image$|(?:s|i)/[^/]+/opengraph-image$).*)"],
};
