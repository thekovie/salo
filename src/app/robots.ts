import type { MetadataRoute } from "next";
import { getEnv } from "@/env";

// Built per request: APP_URL is a runtime setting (Coolify), not a build-time one.
export const dynamic = "force-dynamic";

/**
 * Only the landing page belongs in search. Sessions and invites stay out through `noindex` (meta + X-Robots-Tag), not
 * Disallow: link-preview crawlers (Messenger, Viber, X, Slack…) honour robots.txt, and a disallowed invite gets no card.
 * Crawlers also have to fetch a page to see its noindex.
 */
export default function robots(): MetadataRoute.Robots {
  const base = getEnv().APP_URL;
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: "/api/" }],
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}
