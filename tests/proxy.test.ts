import { describe, expect, it } from "vitest";
import { isSameOrigin } from "@/proxy";

const request = (origin: string | null, url = "http://localhost:3000/api/sessions") => ({
  headers: new Headers(origin ? { origin } : {}),
  nextUrl: new URL(url),
});

describe("isSameOrigin (CSRF layer for API mutations)", () => {
  it("accepts requests from the app's own origin or APP_URL", () => {
    expect(isSameOrigin(request("http://localhost:3000"), undefined)).toBe(true);
    expect(isSameOrigin(request("https://salo.example.com", "http://app:3000/api/x"), "https://salo.example.com")).toBe(true);
  });

  it("refuses other origins and requests without an Origin header", () => {
    expect(isSameOrigin(request("https://evil.example"), "https://salo.example.com")).toBe(false);
    expect(isSameOrigin(request(null), "https://salo.example.com")).toBe(false);
    expect(isSameOrigin(request("https://salo.example.com.evil.example"), "https://salo.example.com")).toBe(false);
  });
});
