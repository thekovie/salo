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
