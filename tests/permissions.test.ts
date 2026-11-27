import { describe, expect, it } from "vitest";
import { can, canEditEntry } from "@/lib/permissions";

const host = { role: "HOST" as const, participantId: "h" };
const guest = { role: "GUEST" as const, participantId: "g" };

describe("permissions", () => {
  it("keeps confirmation, rounds, closing, renaming and claim approval host-only", () => {
    for (const action of ["round.confirm", "round.open", "session.close", "session.rename", "claim.approve", "entry.editAny"] as const) {
      expect(can(host, action), action).toBe(true);
      expect(can(guest, action), action).toBe(false);
    }
  });

  it("lets guests add dishes, edit their own, and mark ready", () => {
    expect(can(guest, "entry.add")).toBe(true);
    expect(can(guest, "ready.set")).toBe(true);
    expect(canEditEntry(guest, { submittedBy: "g" })).toBe(true);
    expect(canEditEntry(guest, { submittedBy: "h" })).toBe(false);
    expect(canEditEntry(host, { submittedBy: "g" })).toBe(true);
  });
});

describe("table prices", () => {
  it("only the host sets them", () => {
    expect(can(host, "price.default")).toBe(true);
    expect(can(guest, "price.default")).toBe(false);
  });
});

describe("unavailable", () => {
  it("only the host marks a dish unavailable", () => {
    expect(can(host, "dish.unavailable")).toBe(true);
    expect(can(guest, "dish.unavailable")).toBe(false);
  });
});

describe("co-host", () => {
  const cohost = { role: "GUEST" as const, participantId: "c", cohost: true };

  it("may update serving and nothing else the host alone may do", () => {
    expect(can(cohost, "serving.update")).toBe(true);
    for (const action of ["entry.editAny", "session.rename", "round.confirm", "round.open", "session.close", "claim.approve", "participant.remove", "price.editAny", "price.default", "dish.unavailable", "billTo.set", "serviceCharge.set", "receipt.set", "adjustment.set", "participant.renameSelf", "cohost.set", "settlement.record"] as const) {
      expect(can(cohost, action), action).toBe(false);
    }
  });

  it("is a plain guest otherwise, and a guest without the mark cannot serve", () => {
    expect(can(cohost, "entry.add")).toBe(true);
    expect(can(guest, "serving.update")).toBe(false);
    expect(can(host, "cohost.set")).toBe(true);
  });
});
