import { describe, expect, it } from "vitest";
import type { SnapshotEntry } from "@/lib/snapshot";
import { byGroup, byPerson, findLikelyDuplicates, readinessSummary } from "@/lib/views";

let n = 0;
function e(dish: string, quantity: number, submittedBy: string, attribution: SnapshotEntry["attribution"], extra: Partial<SnapshotEntry> = {}): SnapshotEntry {
  n += 1;
  return { id: `e${n}`, batchId: `b${n}`, roundId: "r", dishId: `d-${dish}`, dishName: dish, quantity, variant: null, instructions: null, createdAt: `2026-11-06T12:00:${String(n).padStart(2, "0")}Z`, revision: 1, submittedBy, attribution, ...extra };
}
const people = [
  { id: "h", displayName: "Host", role: "HOST" as const },
  { id: "rafa", displayName: "Rafa", role: "GUEST" as const },
  { id: "jd", displayName: "JD", role: "GUEST" as const },
];
const none = { type: "UNASSIGNED" as const, label: null, participantId: null };

describe("byPerson", () => {
  it("lists joined people (even with nothing yet), typed names, whole table and unassigned", () => {
    const entries = [
      e("Katsu", 2, "h", { type: "INDIVIDUAL", label: "Miguel", participantId: null }),
      e("Katsu", 1, "rafa", { type: "INDIVIDUAL", label: null, participantId: "rafa" }),
      e("Rice", 3, "h", { type: "TABLE", label: null, participantId: null }),
      e("Tea", 1, "h", none),
      e("Gyoza", 1, "h", { type: "INDIVIDUAL", label: "miguel ", participantId: null }),
      e("Wings", 1, "h", { type: "GROUP", label: "Office", participantId: null }),
    ];
    const buckets = byPerson(entries, people);
    expect(buckets.map((b) => [b.title, b.ticket.totalItems])).toEqual([
      ["Host", 0],
      ["Rafa", 1],
      ["JD", 0],
      ["Miguel", 3],
      ["Whole table", 3],
      ["Not assigned", 1],
    ]);
  });
});

describe("byGroup", () => {
  it("collects collective orders by label and keeps declared groups with their members", () => {
    const entries = [e("Katsu", 2, "h", { type: "GROUP", label: "Miguel's group", participantId: null }), e("Tea", 3, "h", { type: "GROUP", label: "miguel's  GROUP", participantId: null })];
    const groups = byGroup(entries, [
      { id: "g1", label: "Miguel's group", createdBy: "h", memberIds: ["rafa", "jd"] },
      { id: "g2", label: "Office", createdBy: "h", memberIds: [] },
    ]);
    expect(groups.map((g) => [g.label, g.ticket.totalItems, g.memberIds.length])).toEqual([
      ["Miguel's group", 5, 2],
      ["Office", 0, 0],
    ]);
  });
});

describe("findLikelyDuplicates", () => {
  it("flags a dish the host recorded for a guest by name that the guest also added", () => {
    const hostCopy = e("Katsu", 1, "h", { type: "INDIVIDUAL", label: "rafa", participantId: null });
    const own = e("Katsu", 1, "rafa", { type: "INDIVIDUAL", label: null, participantId: "rafa" });
    const differentPrep = e("Katsu", 1, "h", { type: "INDIVIDUAL", label: "Rafa", participantId: null }, { instructions: "No sauce" });
    const hints = findLikelyDuplicates([hostCopy, own, differentPrep], people);
    expect(hints.map((h) => [h.personName, h.hostEntry.id, h.ownEntry.id])).toEqual([["Rafa", hostCopy.id, own.id]]);
  });

  it("does not flag a guest's dish for the whole table as a double", () => {
    const hostCopy = e("Gyoza", 1, "h", { type: "INDIVIDUAL", label: "Rafa", participantId: null });
    const forTable = e("Gyoza", 1, "rafa", { type: "TABLE", label: null, participantId: null });
    expect(findLikelyDuplicates([hostCopy, forTable], people)).toEqual([]);
  });

  it("does not flag same dishes for different people or for nobody", () => {
    const entries = [e("Katsu", 1, "h", none), e("Katsu", 1, "rafa", { type: "INDIVIDUAL", label: null, participantId: "rafa" }), e("Katsu", 1, "h", { type: "INDIVIDUAL", label: "JD", participantId: null })];
    expect(findLikelyDuplicates(entries, people)).toEqual([]);
  });
});

describe("readinessSummary", () => {
  it("counts guests only", () => {
    const summary = readinessSummary({ participants: people, readiness: [{ participantId: "rafa", ready: true }, { participantId: "jd", ready: false }, { participantId: "h", ready: true }] });
    expect([summary.ready, summary.total]).toEqual([1, 2]);
  });
});
