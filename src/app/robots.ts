import type { MetadataRoute } from "next";
import { getEnv } from "@/env";

// Built per request: APP_URL is a runtime setting (Coolify), not a build-time one.
export const dynamic = "force-dynamic";

/** Only the landing page belongs in search. Sessions and invites are private (also sent as X-Robots-Tag). */
export default function robots(): MetadataRoute.Robots {
  const base = getEnv().APP_URL;
  return {
    rules: [{ userAgent: "*", allow: "/$", disallow: ["/s/", "/j/", "/api/"] }],
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}
