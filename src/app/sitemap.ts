import type { MetadataRoute } from "next";
import { getEnv } from "@/env";

// Built per request: APP_URL is a runtime setting (Coolify), not a build-time one.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: new URL("/", getEnv().APP_URL).toString(), changeFrequency: "monthly", priority: 1 }];
}
