import { describe, expect, it } from "vitest";
import { consolidate, hasSubLines, preparationKey, preparationLabel, ticketText, type SourceEntry } from "@/lib/consolidate";
import { normalizeText, optionalText, tidyText } from "@/lib/dish-name";

let seq = 0;
function entry(dishId: string, dishName: string, quantity: number, extra: Partial<SourceEntry> = {}): SourceEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    dishId,
    dishName,
    quantity,
    variant: null,
    instructions: null,
    createdAt: new Date(Date.UTC(2026, 10, 6, 12, 0, seq)).toISOString(),
    attribution: { type: "UNASSIGNED", label: null, participantId: null },
    submittedBy: "host",
    ...extra,
  };
}

describe("dish name normalization (conservative)", () => {
  it("treats case, repeated spaces and compatibility forms as the same dish", () => {
    expect(normalizeText("  Chicken   Katsu ")).toBe(normalizeText("chicken katsu"));
    expect(normalizeText("Ｃｈｉｃｋｅｎ Katsu")).toBe("chicken katsu");
  });

  it("never equates different words", () => {
    expect(normalizeText("Chicken Katsu")).not.toBe(normalizeText("Chicken Cutlet"));
    expect(normalizeText("Iced Tea")).not.toBe(normalizeText("Iced Teas"));
  });

  it("tidies display text and turns blank optional text into null", () => {
    expect(tidyText("  Gyoza  ")).toBe("Gyoza");
    expect(optionalText("   ")).toBeNull();
    expect(optionalText(undefined)).toBeNull();
    expect(optionalText(" no  sauce ")).toBe("no sauce");
  });
});

describe("consolidate", () => {
  it("sums identical dishes across people (brief 5.8: Miguel ×2 + Rafa ×1 = 3)", () => {
    const result = consolidate([
      entry("katsu", "Chicken Katsu", 2, { attribution: { type: "INDIVIDUAL", label: "Miguel", participantId: null } }),
      entry("katsu", "Chicken Katsu", 1, { attribution: { type: "INDIVIDUAL", label: "Rafa", participantId: null } }),
    ]);
    expect(result.dishes).toHaveLength(1);
    expect(result.dishes[0]).toMatchObject({ name: "Chicken Katsu", quantity: 3 });
    expect(result.dishes[0].preparations[0].entries).toHaveLength(2);
    expect(result.totalItems).toBe(3);
  });

  it("keeps different preparations and sizes distinguishable under one heading (brief 9)", () => {
    const result = consolidate([
      entry("katsu", "Chicken Katsu", 2),
      entry("katsu", "Chicken Katsu", 1, { instructions: "No sauce" }),
      entry("tea", "Iced Tea", 1, { variant: "Regular" }),
      entry("tea", "Iced Tea", 1, { variant: "Large" }),
      entry("katsu", "Chicken Katsu", 1, { instructions: "no  SAUCE" }),
    ]);
    const katsu = result.dishes[0];
    expect(katsu.quantity).toBe(4);
    expect(katsu.preparations.map((p) => [preparationLabel(p), p.quantity])).toEqual([
      ["Regular", 2],
      ["No sauce", 2],
    ]);
    const tea = result.dishes[1];
    expect(tea.preparations.map((p) => [preparationLabel(p), p.quantity])).toEqual([
      ["Regular", 1],
      ["Large", 1],
    ]);
    expect(result.totalItems).toBe(6);
  });

  it("puts the plain preparation first and keeps dishes in the order first added", () => {
    const result = consolidate([entry("gyoza", "Gyoza", 1), entry("katsu", "Chicken Katsu", 1, { variant: "Large" }), entry("katsu", "Chicken Katsu", 1)]);
    expect(result.dishes.map((d) => d.name)).toEqual(["Gyoza", "Chicken Katsu"]);
    expect(result.dishes[1].preparations.map(preparationLabel)).toEqual(["Regular", "Large"]);
    expect(hasSubLines(result.dishes[0])).toBe(false);
    expect(hasSubLines(result.dishes[1])).toBe(true);
  });

  it("does not change its input and treats variant and instructions as one preparation key", () => {
    const input = [entry("a", "A", 1, { variant: "L", instructions: "x" })];
    const frozen = JSON.stringify(input);
    consolidate(input);
    expect(JSON.stringify(input)).toBe(frozen);
    expect(preparationKey({ dishId: "a", variant: "L", instructions: "x" })).not.toBe(preparationKey({ dishId: "a", variant: "Lx", instructions: null }));
  });

  it("returns an empty ticket for no entries", () => {
    expect(consolidate([])).toEqual({ dishes: [], totalItems: 0 });
  });
});

describe("ticketText", () => {
  it("formats the waiter ticket as copyable text (brief 5.13 example)", () => {
    const result = consolidate([
      entry("katsu", "Chicken Katsu", 2),
      entry("katsu", "Chicken Katsu", 1, { instructions: "No sauce" }),
      entry("gyoza", "Gyoza", 2),
      entry("pata", "Crispy Pata", 1),
      entry("tea", "Iced Tea", 4),
    ]);
    expect(ticketText("Round 1", result)).toBe(
      ["Round 1", "", "Chicken Katsu ×3", "  - Regular ×2", "  - No sauce ×1", "Gyoza ×2", "Crispy Pata ×1", "Iced Tea ×4", "", "Total: 10 items"].join("\n"),
    );
  });
});
