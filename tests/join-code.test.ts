import { describe, expect, it } from "vitest";
import { isJoinCode, JOIN_CODE_ALPHABET, normalizeJoinCode } from "@/lib/join-code";

describe("join codes", () => {
  it("forgives case, spaces, dashes and look-alike letters", () => {
    expect(normalizeJoinCode("k7p 2-qx")).toBe("K7P2QX");
    expect(normalizeJoinCode("ilou00")).toBe("110V00");
  });

  it("accepts only six characters from the unambiguous alphabet", () => {
    expect(isJoinCode("K7P2QX")).toBe(true);
    expect(isJoinCode("K7P2Q")).toBe(false);
    expect(isJoinCode("K7P2QI")).toBe(false);
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[ILOU]/);
  });
});
