import { describe, expect, it } from "vitest";
import { groupServed, trackerLines } from "@/lib/serving";
import { applyTap, settle, type ServedEdit } from "@/hooks/use-served-edits";

const edit = (over: Partial<ServedEdit> = {}): ServedEdit => ({ unsent: 0, sending: 0, key: null, failed: null, committedRevision: null, seen: 0, expected: 0, ...over });

describe("served taps", () => {
  it("stops counting a sent delta once the snapshot holds the revision the POST returned", () => {
    const sent = edit({ sending: 1, key: "k", committedRevision: 7 });
    expect(settle(sent, 6).sending).toBe(1);
    expect(settle(sent, 7).sending).toBe(0);
    expect(settle(sent, 9).sending).toBe(0);
  });

  it("keeps counting a delta whose POST has not returned", () => {
    expect(settle(edit({ sending: 1, key: "k" }), 99).sending).toBe(1);
  });

  it("drops an edit that nets to zero, but not one that is in flight or failed", () => {
    expect(applyTap(edit({ unsent: 1 }), -1, 0)).toBeNull();
    expect(applyTap(undefined, 0, 0)).toBeNull();
    expect(applyTap(edit({ sending: 2, key: "k" }), 0, 0)).toMatchObject({ sending: 2 });
    expect(applyTap(edit({ failed: "no", sending: 1, key: "k" }), 1, 0)).toMatchObject({ unsent: 1, failed: "no" });
  });
});

describe("served precondition", () => {
  it("takes the seen count from the first unsent tap of a batch and keeps it for the rest", () => {
    const first = applyTap(undefined, 1, 3)!;
    expect(first.seen).toBe(3);
    expect(applyTap(first, 1, 4)).toMatchObject({ unsent: 2, seen: 3 });
  });

  it("starts a new seen count when a batch is sent and the next tap lands", () => {
    const inFlight = edit({ sending: 1, key: "k", expected: 3, seen: 3 });
    expect(applyTap(inFlight, 1, 4)).toMatchObject({ unsent: 1, seen: 4, expected: 3 });
  });

  it("stops counting a batch the server did not apply once the snapshot holds the revision it returned", () => {
    const refused = edit({ sending: 1, key: "k", committedRevision: 12 });
    expect(settle(refused, 11).sending).toBe(1);
    expect(settle(refused, 12).sending).toBe(0);
  });
});

describe("tracker order", () => {
  const entry = (id: string, dish: string, who: string, createdAt: string) => ({ id, roundId: "r1", dishId: dish, dishName: dish, quantity: 1, variant: null, instructions: null, createdAt, attribution: { type: "INDIVIDUAL" as const, participantId: null, label: who } });
  const snapshot = (entries: ReturnType<typeof entry>[]) => ({ rounds: [{ id: "r1", number: 1, status: "CONFIRMED" }], corrections: [], participants: [], removedPeople: [], servedCounts: [], entries }) as unknown as Parameters<typeof trackerLines>[0];

  it("orders lines and names by first creation, whatever order the entries arrive in", () => {
    const a = entry("1", "Gyoza", "Rafa", "2026-01-01T10:00:00Z");
    const b = entry("2", "Katsu", "Kovie", "2026-01-01T10:01:00Z");
    const c = entry("3", "Gyoza", "Kovie", "2026-01-01T10:02:00Z");
    for (const order of [[a, b, c], [c, b, a], [b, c, a]]) {
      const [round] = trackerLines(snapshot(order)).rounds;
      expect(round.lines.map((l) => l.label)).toEqual(["Gyoza", "Katsu"]);
      expect(round.lines[0].people).toBe("Rafa ×1 · Kovie ×1");
    }
  });
});

describe("served grouping", () => {
  const line = (key: string, expected: number, shown: number, history = false) => ({ key, label: key, people: "", expected, served: shown, shown, cancelledSince: 0, history });
  const tracker = {
    rounds: [
      { roundId: "r1", number: 1, lines: [line("a", 2, 2), line("b", 3, 1), line("old", 1, 1, true)] },
      { roundId: "r2", number: 2, lines: [line("c", 1, 0), line("d", 4, 4)] },
    ],
    expected: 0,
    served: 0,
  };

  it("puts zero and partial first and fully served after, each in round then creation order", () => {
    const { waiting, done } = groupServed(tracker);
    expect(waiting.map((r) => r.line.key)).toEqual(["b", "c"]);
    expect(done.map((r) => [r.number, r.line.key])).toEqual([[1, "a"], [1, "old"], [2, "d"]]);
  });

  it("keeps history rows in the fully served group", () => {
    expect(groupServed(tracker).done.some((r) => r.line.history)).toBe(true);
  });
});
