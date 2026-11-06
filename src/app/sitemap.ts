import type { MetadataRoute } from "next";
import { getEnv } from "@/env";

// Built per request: APP_URL is a runtime setting (Coolify), not a build-time one.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getEnv().APP_URL;
  return [
    { url: new URL("/", base).toString(), changeFrequency: "monthly", priority: 1 },
    { url: new URL("/privacy", base).toString(), changeFrequency: "yearly", priority: 0.3 },
    { url: new URL("/cookies", base).toString(), changeFrequency: "yearly", priority: 0.3 },
  ];
}
