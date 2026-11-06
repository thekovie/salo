import { describe, expect, it } from "vitest";
import { consolidate, type SourceEntry } from "@/lib/consolidate";
import { buildTicketSnapshot, correctionText, snapshotText, type CorrectionView } from "@/lib/ticket";

const entry = (id: string, dishName: string, quantity: number, instructions: string | null = null): SourceEntry => ({
  id,
  dishId: dishName,
  dishName,
  quantity,
  variant: null,
  instructions,
  createdAt: `2026-11-06T12:00:0${id}Z`,
  attribution: { type: "UNASSIGNED", label: null, participantId: null },
  submittedBy: "h",
});

const cancel: CorrectionView = { id: "c1", sourceEntryId: "e1", sourceRoundNumber: 1, targetRoundId: "r2", dishName: "Chicken Katsu", preparation: "No sauce", type: "QUANTITY", quantityDelta: -1, replacement: null, explanation: null };
const change: CorrectionView = { id: "c2", sourceEntryId: "e2", sourceRoundNumber: 1, targetRoundId: "r2", dishName: "Iced Tea", preparation: null, type: "REPLACE", quantityDelta: null, replacement: "Large", explanation: "they asked" };

describe("corrections", () => {
  it("reads like something to say to the waiter", () => {
    expect(correctionText(cancel)).toBe("Cancel 1 × Chicken Katsu (No sauce) from round 1");
    expect(correctionText(change)).toBe("Change Iced Tea to Large from round 1 (they asked)");
  });
});

describe("ticket snapshot", () => {
  it("captures the round as confirmed, with corrections apart from new dishes (brief 5.15)", () => {
    const ticket = consolidate([entry("1", "Iced Tea", 2), entry("2", "Rice", 3), entry("3", "Rice", 1, "Garlic")]);
    const snapshot = buildTicketSnapshot({ roundNumber: 2, title: "Ramen Nagi", ticket, corrections: [cancel], confirmedAt: "2026-11-06T13:00:00.000Z" });
    expect(snapshot).toEqual({
      roundNumber: 2,
      title: "Ramen Nagi",
      dishes: [
        { name: "Iced Tea", quantity: 2, lines: [] },
        { name: "Rice", quantity: 4, lines: [{ label: "Regular", quantity: 3 }, { label: "Garlic", quantity: 1 }] },
      ],
      corrections: ["Cancel 1 × Chicken Katsu (No sauce) from round 1"],
      totalItems: 6,
      confirmedAt: "2026-11-06T13:00:00.000Z",
    });
    expect(snapshotText(snapshot)).toBe(
      ["Ramen Nagi · Round 2", "", "Iced Tea ×2", "Rice ×4", "  - Regular ×3", "  - Garlic ×1", "", "Corrections:", "  - Cancel 1 × Chicken Katsu (No sauce) from round 1", "", "Total: 6 items"].join("\n"),
    );
  });
});
