import { describe, expect, it } from "vitest";
import { formatPeso, MAX_SERVICE_CHARGE_CENTAVOS, MAX_UNIT_PRICE_CENTAVOS, parsePeso } from "@/lib/money";

describe("parsePeso", () => {
  it("reads whole pesos, centavos and blank", () => {
    expect(parsePeso("120")).toEqual({ ok: true, centavos: 12000 });
    expect(parsePeso("120.5")).toEqual({ ok: true, centavos: 12050 });
    expect(parsePeso("120.05")).toEqual({ ok: true, centavos: 12005 });
    expect(parsePeso("0")).toEqual({ ok: true, centavos: 0 });
    expect(parsePeso("  ")).toEqual({ ok: true, centavos: null });
  });

  it("forgives a peso sign, commas and spaces", () => {
    expect(parsePeso("₱1,200.00")).toEqual({ ok: true, centavos: 120000 });
    expect(parsePeso(" 1 200 ")).toEqual({ ok: true, centavos: 120000 });
  });

  it("rejects negatives, excess precision, junk and amounts over the limit", () => {
    expect(parsePeso("-5")).toMatchObject({ ok: false, message: "Can't be negative." });
    expect(parsePeso("1.234")).toMatchObject({ ok: false, message: "Up to 2 decimal places." });
    expect(parsePeso("abc")).toMatchObject({ ok: false });
    expect(parsePeso("1.")).toMatchObject({ ok: false });
    expect(parsePeso("100000")).toMatchObject({ ok: false, message: "That's over ₱99,999.99." });
    expect(parsePeso("99999.99")).toEqual({ ok: true, centavos: MAX_UNIT_PRICE_CENTAVOS });
  });

  it("takes a different limit for the receipt's service charge", () => {
    expect(parsePeso("500000", MAX_SERVICE_CHARGE_CENTAVOS)).toEqual({ ok: true, centavos: 50000000 });
    expect(parsePeso("1000000", MAX_SERVICE_CHARGE_CENTAVOS)).toMatchObject({ ok: false, message: "That's over ₱999,999.99." });
  });
});

describe("formatPeso", () => {
  it("prints pesos with two decimals and separators", () => {
    expect(formatPeso(24000)).toBe("₱240.00");
    expect(formatPeso(0)).toBe("₱0.00");
    expect(formatPeso(123456789)).toBe("₱1,234,567.89");
  });
});
