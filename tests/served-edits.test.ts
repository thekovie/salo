import { describe, expect, it } from "vitest";
import { trackerLines } from "@/lib/serving";
import { applyTap, settle, type ServedEdit } from "@/hooks/use-served-edits";

const edit = (over: Partial<ServedEdit> = {}): ServedEdit => ({ unsent: 0, sending: 0, key: null, failed: null, committedRevision: null, ...over });

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
    expect(applyTap(edit({ unsent: 1 }), -1)).toBeNull();
    expect(applyTap(undefined, 0)).toBeNull();
    expect(applyTap(edit({ sending: 2, key: "k" }), 0)).toMatchObject({ sending: 2 });
    expect(applyTap(edit({ failed: "no", sending: 1, key: "k" }), 1)).toMatchObject({ unsent: 1, failed: "no" });
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
