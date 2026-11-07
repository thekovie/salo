interface CspOptions {
  /** Fresh per request. Next adds it to its own scripts when it sees it in the request's CSP header. */
  nonce: string;
  isDev: boolean;
  /** Only upgrade to https when the app is actually served over it (plain http works for local trials). */
  isHttps: boolean;
}

/**
 * Content-Security-Policy for every page. Scripts, styles, fonts and connections stay on this origin (fonts are
 * self-hosted by next/font); pictures may also be data: or blob: URLs (the invite QR code). Scripts need this request's nonce
 * (`strict-dynamic` lets those scripts load their own chunks). Styles allow inline because React sets style attributes.
 */
export function buildCsp({ nonce, isDev, isHttps }: CspOptions): string {
  const directives = [
    "default-src 'self'",
    // challenges.cloudflare.com: the Turnstile bot check on /new (older browsers ignore strict-dynamic and use the list).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    // PostHog's session-replay recorder compresses in a worker built from a blob.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (isHttps) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
