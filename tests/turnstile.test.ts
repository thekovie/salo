import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "@/server/auth/turnstile";

const real = { secret: "0x4AAAAAAAreal-secret", token: "tok", expectedHostname: "salo.thekovie.com" };
const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

describe("Turnstile bot check", () => {
  it("passes a token Cloudflare vouches for, for our host and action", async () => {
    expect(await verifyTurnstile(real, reply({ success: true, hostname: "salo.thekovie.com", action: "create-order" }))).toEqual({ ok: true });
  });

  it("refuses a failed token, another site's token, or another action", async () => {
    expect(await verifyTurnstile(real, reply({ success: false, "error-codes": ["invalid-input-response"] }))).toEqual({ ok: false, reason: "failed" });
    expect(await verifyTurnstile(real, reply({ success: true, hostname: "evil.example", action: "create-order" }))).toEqual({ ok: false, reason: "failed" });
    expect(await verifyTurnstile(real, reply({ success: true, hostname: "salo.thekovie.com", action: "login" }))).toEqual({ ok: false, reason: "failed" });
  });

  it("never fails open when Cloudflare can't be reached", async () => {
    expect(await verifyTurnstile(real, vi.fn(async () => Promise.reject(new Error("timeout"))))).toEqual({ ok: false, reason: "unavailable" });
    expect(await verifyTurnstile(real, reply({}, false))).toEqual({ ok: false, reason: "unavailable" });
  });

  it("accepts Cloudflare's always-pass test secret without a real hostname", async () => {
    const test = { ...real, secret: "1x0000000000000000000000000000000AA" };
    expect(await verifyTurnstile(test, reply({ success: true, hostname: "example.com", action: "" }))).toEqual({ ok: true });
  });
});
