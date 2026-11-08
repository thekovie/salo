import { describe, expect, it } from "vitest";
import { GUEST_GUIDE, HOST_GUIDE } from "@/components/onboarding/guide-steps";
import { EMPTY_SETTLEMENT, type SessionSnapshot } from "@/lib/snapshot";

const base: SessionSnapshot = {
  session: { id: "s", title: null, status: "OPEN", revision: 1, joinCode: "ABCDEF", closedAt: null, expiresAt: "2026-12-01T00:00:00Z" },
  me: { participantId: "h", role: "HOST", displayName: "Host" },
  rounds: [{ id: "r1", number: 1, status: "DRAFT", confirmedAt: null }],
  activeRoundId: "r1",
  participants: [{ id: "h", displayName: "Host", role: "HOST" }],
  removedPeople: [],
  entries: [],
  dishNames: [],
  claims: [],
  readiness: [],
  groups: [],
  corrections: [],
  tickets: {},
  settlement: EMPTY_SETTLEMENT,
};
const done = (steps: typeof HOST_GUIDE, s: SessionSnapshot) => steps.filter((step) => step.done?.(s)).map((step) => step.id);

describe("setup guide checklist", () => {
  it("a brand-new order has nothing ticked", () => {
    expect(done(HOST_GUIDE, base)).toEqual([]);
  });

  it("ticks what the table has actually used", () => {
    const used: SessionSnapshot = {
      ...base,
      session: { ...base.session, title: "Mang Inasal" },
      me: { ...base.me, displayName: "Kovie" },
      participants: [...base.participants, { id: "g", displayName: "Ana", role: "GUEST" }],
      rounds: [{ id: "r1", number: 1, status: "CONFIRMED", confirmedAt: "x" }],
      entries: [{ id: "e1", batchId: "b1", roundId: "r1", dishId: "d", dishName: "Sisig", quantity: 1, variant: null, instructions: null, createdAt: "x", revision: 1, submittedBy: "h", attribution: { type: "INDIVIDUAL", label: null, participantId: "h" } }],
      settlement: { entries: { e1: { unitCentavos: 100, billTo: null, revision: 1 } }, corrections: {}, serviceCharge: { centavos: 0, revision: 1 } },
    };
    expect(done(HOST_GUIDE, used)).toEqual(["setup", "invite", "add", "forPrice", "review", "kkb"]);
  });

  it("every step a guest or host sees has a title, body and a last 'all set' page", () => {
    for (const steps of [HOST_GUIDE, GUEST_GUIDE]) {
      expect(steps.at(-1)?.id).toBe("done");
      for (const step of steps) expect(step.title && step.body).toBeTruthy();
    }
  });
});
