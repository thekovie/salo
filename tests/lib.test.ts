import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/csp";
import { formatLog } from "@/lib/logger";
import { createRateLimiter, createTieredLimiter } from "@/server/auth/rate-limit";

describe("logger", () => {
  it("writes one JSON line and redacts sensitive keys at any depth", () => {
    const line = formatLog("error", "boom", { password: "p", nested: { apiKey: "k", ok: 1 }, list: [{ token: "t" }] }, new Date("2026-11-04T00:00:00Z"));
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ time: "2026-11-04T00:00:00.000Z", level: "error", message: "boom", password: "[redacted]", nested: { apiKey: "[redacted]", ok: 1 }, list: [{ token: "[redacted]" }] });
    expect(line).not.toContain("\n");
  });

  it("serializes an Error to name and message only (no stack)", () => {
    const parsed = JSON.parse(formatLog("warn", "x", { error: new TypeError("bad") }));
    expect(parsed.error).toEqual({ name: "TypeError", message: "bad" });
  });
});

describe("logger edge cases", () => {
  it("never prints a value below the depth limit, so a deep secret cannot leak and a cycle cannot throw", () => {
    const deep = { a: { b: { c: { d: { password: "hunter2" } } } } };
    expect(formatLog("info", "x", deep)).not.toContain("hunter2");
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(() => formatLog("info", "x", cyclic)).not.toThrow();
  });

  it("keeps the envelope intact when a caller passes fields named like it", () => {
    const parsed = JSON.parse(formatLog("warn", "real message", { message: "spoof", level: "info", time: "never" }, new Date("2026-11-04T00:00:00Z")));
    expect(parsed).toMatchObject({ message: "real message", level: "warn", time: "2026-11-04T00:00:00.000Z" });
  });
});

describe("buildCsp", () => {
  it("requires the request nonce for scripts and never allows inline or eval in production", () => {
    const csp = buildCsp({ nonce: "abc", isDev: false, isHttps: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("keeps pictures and connections on this origin (the QR code is a data URL)", () => {
    const csp = buildCsp({ nonce: "abc", isDev: false, isHttps: true });
    expect(csp).toContain("img-src 'self' data: blob:;");
    expect(csp).toContain("connect-src 'self'");
  });

  it("allows eval only in development and upgrades only over https", () => {
    const csp = buildCsp({ nonce: "abc", isDev: true, isHttps: false });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});

describe("createRateLimiter", () => {
  it("allows up to the limit per window, then blocks until the window resets", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect(limiter.hit("k").allowed).toBe(true);
    expect(limiter.hit("k").allowed).toBe(true);
    const blocked = limiter.hit("k");
    expect(blocked).toEqual({ allowed: false, retryAfterMs: 1000 });
    expect(limiter.isLimited("k")).toBe(true);
    t = 1000;
    expect(limiter.hit("k").allowed).toBe(true);
  });

  it("stays bounded: the oldest key is evicted when too many distinct keys arrive", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 3 });
    for (const key of ["a", "b", "c", "d", "e"]) limiter.hit(key);
    expect(limiter.size()).toBe(3);
  });
});

describe("createTieredLimiter", () => {
  it("still stops a client that rotates through more addresses than the table can hold", () => {
    const limiter = createTieredLimiter({ limit: 2, windowMs: 60_000, maxKeys: 10 }, { limit: 50, windowMs: 60_000 });
    let allowed = 0;
    for (let i = 0; i < 1000; i++) if (limiter.hit(`2001:db8:${i}::/64`).allowed) allowed++;
    expect(allowed).toBe(50);
    expect(limiter.isLimited("198.51.100.7")).toBe(true);
  });

  it("does not let one noisy client spend the shared budget", () => {
    const limiter = createTieredLimiter({ limit: 2, windowMs: 60_000 }, { limit: 5, windowMs: 60_000 });
    for (let i = 0; i < 100; i++) limiter.hit("203.0.113.1");
    expect(limiter.hit("203.0.113.2").allowed).toBe(true);
  });
});
