import { describe, expect, it } from "vitest";
import { MENU_REASONS as R, parseMenuUrl } from "@/lib/menu-url";

const ok = (input: string) => {
  const r = parseMenuUrl(input);
  if (!r.ok) throw new Error(`${input}: ${r.reason}`);
  return r;
};
const reason = (input: string) => {
  const r = parseMenuUrl(input);
  if (r.ok) throw new Error(`${input} was accepted as ${r.url}`);
  return r.reason;
};

describe("parseMenuUrl accepts", () => {
  it("https links, keeping path, query and fragment", () => {
    expect(ok("https://ramennagi.com.ph/menu?x=1#drinks")).toEqual({ ok: true, url: "https://ramennagi.com.ph/menu?x=1#drinks", domain: "ramennagi.com.ph" });
  });
  it("a missing scheme (https is added), with spaces around", () => {
    expect(ok("  ramennagi.com.ph/menu ").url).toBe("https://ramennagi.com.ph/menu");
    expect(ok("example.com").url).toBe("https://example.com/");
  });
  it("IDN as punycode, and keeps www in the domain", () => {
    expect(ok("https://münchen.de").domain).toBe("xn--mnchen-3ya.de");
    expect(ok("https://www.example.com").domain).toBe("www.example.com");
  });
  it("normalises odd schemes, backslashes and tabs instead of rejecting", () => {
    expect(ok("https:example.com").url).toBe("https://example.com/");
    expect(ok("https:/\\evil.com").url).toBe("https://evil.com/");
    expect(ok("https://example.com\\@evil.com")).toMatchObject({ url: "https://example.com/@evil.com", domain: "example.com" });
    expect(ok("https://exam\tple.com").domain).toBe("example.com");
    expect(ok("https://example.com/a@b#c@d").domain).toBe("example.com");
  });
  it("drops one trailing dot and :443", () => {
    expect(ok("https://example.com./x").url).toBe("https://example.com/x");
    expect(ok("https://example.com:443/x").url).toBe("https://example.com/x");
  });
  it("accepts an xn-- label and a link just under the cap", () => {
    expect(ok("xn--mnchen-3ya.de").ok).toBe(true);
    expect(ok(`https://example.com/${"a".repeat(480)}`).ok).toBe(true);
  });
});

describe("parseMenuUrl rejects", () => {
  it.each(["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "intent://x#Intent;end", "ftp://example.com", "mailto:a@b.com", "myapp://open"])("scheme %s", (input) => {
    expect(reason(input)).toBe(R.scheme);
  });
  it("http, with its own hint", () => expect(reason("http://example.com")).toBe(R.http));
  it("credentials", () => {
    expect(reason("https://user:pw@example.com")).toBe(R.credentials);
    expect(reason("https://user@example.com")).toBe(R.credentials);
  });
  it.each(["127.0.0.1", "2130706433", "0x7f.1", "0177.0.0.1", "127.1", "１２７.０.０.１", "[::1]", "[::ffff:127.0.0.1]", "10.0.0.1", "192.168.1.1", "169.254.169.254", "8.8.8.8", "https://8.8.8.8/menu"])("IP address %s", (input) => {
    expect(reason(input)).toBe(R.ip);
  });
  it.each(["localhost", "localhost.", "https://printer.local", "foo.local.", "x.internal.", "a.localhost", "router.home.arpa", "intranet", "a", "a..b", ".com", "-a.com", "exa_mple.com"])("local or malformed host %s", (input) => {
    expect(reason(input)).toBe(R.local);
  });
  it.each(["localhost:3000", "example.com:8080/x", "https://example.com:8443"])("port %s", (input) => {
    expect(reason(input)).toBe(input.startsWith("localhost") ? R.local : R.port);
  });
  it("too long: raw input, and a short input that grows past 500 when normalised", () => {
    expect(reason(`https://example.com/${"a".repeat(500)}`)).toBe(R.tooLong);
    expect(reason(`https://example.com/${"a".repeat(3000)}`)).toBe(R.tooLong);
    // 130 spaces become %20 (3 chars each): 130 raw chars -> 390 stored; 200 -> 600.
    expect(parseMenuUrl(`https://example.com/${"é ".repeat(100)}`)).toEqual({ ok: false, reason: R.tooLong });
  });
  it("empty and unparseable input", () => {
    expect(reason("")).toBe(R.unparseable);
    expect(reason("https://")).toBe(R.unparseable);
    expect(reason("example.123")).toBe(R.unparseable);
  });
});
