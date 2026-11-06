import { describe, expect, it } from "vitest";
import { parseEnv } from "@/env";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/salo", APP_URL: "http://localhost:3000" };

describe("parseEnv", () => {
  it("accepts a minimal development environment and fills retention defaults", () => {
    const env = parseEnv(base);
    expect(env).toMatchObject({ NODE_ENV: "development", CLOSED_RETENTION_DAYS: 7, INACTIVE_RETENTION_DAYS: 30 });
  });

  it("refuses a non-postgres database URL and treats empty values as missing", () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: "mysql://x" })).toThrow(/postgres/);
    expect(() => parseEnv({ ...base, APP_URL: "" })).toThrow(/APP_URL/);
  });

  it("treats PostHog as optional and checks the key's shape", () => {
    expect(parseEnv(base).POSTHOG_KEY).toBeUndefined();
    expect(parseEnv({ ...base, POSTHOG_KEY: "" }).POSTHOG_KEY).toBeUndefined();
    expect(parseEnv({ ...base, POSTHOG_KEY: "phc_abc123XYZ" }).POSTHOG_KEY).toBe("phc_abc123XYZ");
    expect(() => parseEnv({ ...base, POSTHOG_KEY: "sk_live_nope" })).toThrow(/POSTHOG_KEY/);
  });

  it("requires https in production except on localhost", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production", APP_URL: "http://salo.example.com" })).toThrow(/https/);
    expect(parseEnv({ ...base, NODE_ENV: "production" }).APP_URL).toBe("http://localhost:3000");
  });
});
