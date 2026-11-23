import { describe, expect, it } from "vitest";
import { allocateCancel, correctionRows, prepPeople, preparationsOfRound, searchPreps, visiblePreps } from "@/lib/corrections";
import type { SnapshotEntry } from "@/lib/snapshot";
import { buildTicketSnapshot, correctionText, groupCorrections, type CorrectionView } from "@/lib/ticket";
import { consolidate } from "@/lib/consolidate";
import { effectiveEntry } from "@/lib/effective-order";

const entry = (id: string, who: string, quantity: number, createdAt: string): SnapshotEntry => ({
  id, roundId: "r1", batchId: `b${id}`, dishId: "d1", dishName: "Katsu", quantity, variant: "Large", instructions: null, createdAt, revision: 1, submittedBy: who,
  attribution: { type: "INDIVIDUAL", label: null, participantId: who },
});
const people = [{ id: "a", displayName: "Ana", role: "HOST" as const, cohost: false }, { id: "b", displayName: "Ben", role: "GUEST" as const, cohost: false }];
const fix = (id: string, entryId: string, delta: number, groupId: string | null): CorrectionView => ({
  id, sourceEntryId: entryId, sourceRoundNumber: 1, targetRoundId: "r2", dishName: "Katsu", preparation: "Large", type: "QUANTITY", quantityDelta: delta, replacement: null, explanation: null, reason: null, groupId, createdAt: "2026-11-20T10:00:00Z",
});

describe("correction sheet helpers", () => {
  it("lists people newest first with what is left", () => {
    const [prep] = preparationsOfRound([entry("e1", "a", 2, "2026-11-20T09:00:00Z"), entry("e2", "b", 3, "2026-11-20T09:05:00Z")], [fix("c1", "e2", -3, null)], people, new Set());
    expect(prep.entries.map((e) => [e.who, e.ordered, e.left])).toEqual([["Ben", 3, 0], ["Ana", 2, 2]]);
  });

  it("cancels come only from the chosen person's own entries, newest first", () => {
    const [prep] = preparationsOfRound(
      [entry("e1", "a", 2, "2026-11-20T09:00:00Z"), entry("e2", "b", 3, "2026-11-20T09:05:00Z"), entry("e3", "a", 2, "2026-11-20T09:10:00Z")],
      [],
      people,
      new Set(),
    );
    const ana = prepPeople(prep);
    expect(ana.map((p) => [p.who, p.left])).toEqual([["Ana", 4], ["Ben", 3]]);
    const [anaKey, benKey] = ana.map((p) => p.key);
    expect(allocateCancel(ana, { [anaKey]: 3, [benKey]: 0 })).toEqual([{ sourceEntryId: "e3", quantity: 2 }, { sourceEntryId: "e1", quantity: 1 }]);
    expect(allocateCancel(ana, { [benKey]: 1 })).toEqual([{ sourceEntryId: "e2", quantity: 1 }]);
    expect(allocateCancel(ana, {})).toEqual([]);
  });

  it("two people with the same display name keep separate buckets", () => {
    const twins = [{ id: "Ana", displayName: "Sam" }, { id: "Ben", displayName: "Sam" }] as unknown as Parameters<typeof preparationsOfRound>[2];
    const [prep] = preparationsOfRound([entry("e1", "Ana", 1, "2026-01-01T00:00:00Z"), entry("e2", "Ben", 1, "2026-01-01T00:01:00Z")], [], twins, new Set());
    const sams = prepPeople(prep);
    expect(sams).toHaveLength(2);
    expect(allocateCancel(sams, { [sams[0].key]: 1 })).toEqual([{ sourceEntryId: sams[0].entries[0].entryId, quantity: 1 }]);
  });

  it("a batch is one ticket line and one list row", () => {
    const group = [fix("c1", "e1", -1, "g"), fix("c2", "e2", -2, "g")];
    expect(groupCorrections(group)).toHaveLength(1);
    const ticket = buildTicketSnapshot({ roundNumber: 2, title: null, ticket: consolidate([]), corrections: group, confirmedAt: "" });
    expect(ticket.corrections).toEqual(["Cancel 3 × Katsu (Large) from round 1"]);
    const rows = correctionRows({ corrections: group, rounds: [{ id: "r2", number: 2, status: "DRAFT", confirmedAt: null }] });
    expect(rows).toMatchObject([{ text: "Katsu (Large) −3", told: false, goesWithRound: 2 }]);
  });

  describe("replaced dishes", () => {
    const told = new Set(["r2"]);
    const swap = (id: string, entryId: string, to: string, at = "2026-11-20T10:00:00Z"): CorrectionView => ({ ...fix(id, entryId, 0, null), type: "REPLACE", quantityDelta: null, replacement: to, createdAt: at });
    const e1 = entry("e1", "a", 1, "2026-11-20T09:00:00Z");

    it("a told swap leaves a history row and an actionable replacement line", () => {
      const lines = visiblePreps(preparationsOfRound([e1], [swap("s1", "e1", "Pork Katsu")], people, told));
      expect(lines.map((l) => [l.kind, l.label, l.kind === "replaced" ? l.ordered : l.left])).toEqual([["replaced", "Katsu (Large)", 1], ["replacement", "Pork Katsu", 1]]);
    });

    it("a pending swap keeps the original active with a note and adds no replacement line", () => {
      const lines = visiblePreps(preparationsOfRound([e1], [swap("s1", "e1", "Pork Katsu")], people, new Set()));
      expect(lines.map((l) => [l.kind, l.left, l.pendingTo])).toEqual([["dish", 1, "Pork Katsu"]]);
    });

    it("cancelling one of a replacement lowers it only, and effectiveEntry agrees", () => {
      const two = entry("e1", "a", 2, "2026-11-20T09:00:00Z");
      const corrections = [swap("s1", "e1", "Pork Katsu"), { ...fix("c1", "e1", -1, null), createdAt: "2026-11-20T10:30:00Z" }];
      const lines = visiblePreps(preparationsOfRound([two], corrections, people, told));
      expect(lines.map((l) => [l.kind, l.kind === "replaced" ? l.ordered : l.left])).toEqual([["replaced", 2], ["replacement", 1]]);
      expect(effectiveEntry(two, corrections, told).quantity).toBe(1);
    });

    it("re-replacing shows only the newest replacement", () => {
      const corrections = [swap("s1", "e1", "Pork Katsu"), swap("s2", "e1", "Beef Katsu", "2026-11-20T11:00:00Z")];
      expect(visiblePreps(preparationsOfRound([e1], corrections, people, told)).map((l) => l.label)).toEqual(["Katsu (Large)", "Beef Katsu"]);
    });

    it("a fully cancelled replacement leaves only the history row", () => {
      const corrections = [swap("s1", "e1", "Pork Katsu"), { ...fix("c1", "e1", -1, null), createdAt: "2026-11-20T10:30:00Z" }];
      expect(visiblePreps(preparationsOfRound([e1], corrections, people, told)).map((l) => l.kind)).toEqual(["replaced"]);
    });

    it("the history row counts cancels up to the first swap, even after a re-replace", () => {
      const three = entry("e1", "a", 3, "2026-11-20T09:00:00Z");
      const corrections = [swap("s1", "e1", "Pork Katsu"), { ...fix("c1", "e1", -1, null), createdAt: "2026-11-20T10:30:00Z" }, swap("s2", "e1", "Beef Katsu", "2026-11-20T11:00:00Z")];
      const lines = visiblePreps(preparationsOfRound([three], corrections, people, told));
      expect(lines.map((l) => [l.kind, l.label, l.kind === "replaced" ? l.ordered : l.left])).toEqual([["replaced", "Katsu (Large)", 3], ["replacement", "Beef Katsu", 2]]);
    });

    it("a cancel made on a replacement names the replacement, on the ticket and in the list", () => {
      const cancelled = { ...fix("c1", "e1", -1, null), createdAt: "2026-11-20T10:30:00Z", targetRoundId: "r3" };
      const corrections = [swap("s1", "e1", "Pork Katsu"), cancelled];
      const confirmed = new Set(["r2"]);
      const ticket = buildTicketSnapshot({ roundNumber: 3, title: null, ticket: consolidate([]), corrections: [cancelled], confirmedAt: "", context: { corrections, confirmed } });
      expect(ticket.corrections).toEqual(["Cancel 1 × Pork Katsu (was Katsu (Large)) from round 1"]);
      const rounds = [{ id: "r2", number: 2, status: "CONFIRMED" as const, confirmedAt: "x" }, { id: "r3", number: 3, status: "DRAFT" as const, confirmedAt: null }];
      expect(correctionRows({ corrections, rounds }).map((r) => r.text)).toEqual(["Katsu (Large) changed to Pork Katsu", "Pork Katsu −1"]);
    });

    it("a cancel made while the swap is still pending keeps naming the original", () => {
      const cancelled = { ...fix("c1", "e1", -1, null), createdAt: "2026-11-20T10:30:00Z", targetRoundId: "r3" };
      const corrections = [{ ...swap("s1", "e1", "Pork Katsu"), targetRoundId: "r3" }, cancelled];
      const ticket = buildTicketSnapshot({ roundNumber: 3, title: null, ticket: consolidate([]), corrections: [cancelled], confirmedAt: "", context: { corrections, confirmed: told } });
      expect(ticket.corrections).toEqual(["Cancel 1 × Katsu (Large) from round 1"]);
    });

    it("D19: the replacement sits directly under its original, which keeps its place", () => {
      const rice = { ...entry("e0", "a", 1, "2026-11-20T08:00:00Z"), dishId: "d0", dishName: "Rice", variant: null };
      const tail = { ...entry("e9", "a", 1, "2026-11-20T09:30:00Z"), dishId: "d2", dishName: "Tea", variant: null };
      const lines = visiblePreps(preparationsOfRound([rice, e1, tail], [swap("s1", "e1", "Pork Katsu")], people, told));
      expect(lines.map((l) => l.label)).toEqual(["Rice", "Katsu (Large)", "Pork Katsu", "Tea"]);
    });

    it("D19: several replacements of one original follow the order they were told", () => {
      const e2 = entry("e2", "b", 1, "2026-11-20T09:05:00Z");
      const corrections = [swap("s1", "e1", "Pork Katsu", "2026-11-20T10:00:00Z"), swap("s2", "e2", "Beef Katsu", "2026-11-20T11:00:00Z")];
      const lines = visiblePreps(preparationsOfRound([e1, e2], corrections, people, told));
      expect(lines.map((l) => l.label)).toEqual(["Katsu (Large)", "Pork Katsu", "Beef Katsu"]);
    });

    it("D19: searching a replacement keeps its history row above it", () => {
      const lines = visiblePreps(preparationsOfRound([e1], [swap("s1", "e1", "Pork Katsu")], people, told));
      expect(searchPreps(lines, "pork").map((l) => l.label)).toEqual(["Katsu (Large)", "Pork Katsu"]);
      expect(searchPreps(lines, "zzz")).toEqual([]);
    });

    it("D19: correction rows group by source dish, oldest first inside a dish", () => {
      const soup = { ...fix("c0", "e5", -1, null), dishName: "Soup", preparation: null, createdAt: "2026-11-20T10:10:00Z" };
      const corrections = [
        swap("s1", "e1", "Pork Katsu", "2026-11-20T10:00:00Z"),
        soup,
        { ...fix("c1", "e1", -1, null), createdAt: "2026-11-20T10:30:00Z" },
      ];
      const rounds = [{ id: "r2", number: 2, status: "CONFIRMED" as const, confirmedAt: "x" }];
      expect(correctionRows({ corrections, rounds }).map((r) => r.text)).toEqual(["Katsu (Large) changed to Pork Katsu", "Pork Katsu ×1 cancelled", "Soup ×1 cancelled"]);
      expect(buildTicketSnapshot({ roundNumber: 2, title: null, ticket: consolidate([]), corrections, confirmedAt: "" }).corrections.map((c) => c.split(" from")[0])).toEqual(["Change Katsu (Large) to Pork Katsu", "Cancel 1 × Katsu (Large)", "Cancel 1 × Soup"]);
    });

    it("D13: a cancel written in the same change as the swap names the original", () => {
      const same = "2026-11-20T10:00:00Z";
      const cancelled = { ...fix("c1", "e1", -1, null), createdAt: same };
      const corrections = [{ ...swap("s1", "e1", "Pork Katsu"), createdAt: same }, cancelled];
      expect(correctionText(cancelled, { corrections, confirmed: new Set(["r2"]) })).toBe("Cancel 1 × Katsu (Large) from round 1");
    });
  });
});
