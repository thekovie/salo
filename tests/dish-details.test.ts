import { describe, expect, it } from "vitest";
import { splitDishName, variantSuggestions } from "@/lib/dish-details";

const entries = [
  { dishName: "Gyoza", variant: "Large" },
  { dishName: "gyoza ", variant: "large" },
  { dishName: "Gyoza", variant: "Jumbo" },
  { dishName: "Gyoza", variant: null },
  { dishName: "Sisig", variant: "Sizzling" },
];

describe("variantSuggestions", () => {
  it("lists sizes already used for the same dish, once each", () => {
    expect(variantSuggestions("GYOZA", entries)).toEqual(["Large", "Jumbo"]);
  });
  it("is empty for a new dish or a blank name", () => {
    expect(variantSuggestions("Ramen", entries)).toEqual([]);
    expect(variantSuggestions("  ", entries)).toEqual([]);
  });
  it("caps at four", () => {
    const many = ["a", "b", "c", "d", "e"].map((variant) => ({ dishName: "X", variant }));
    expect(variantSuggestions("X", many)).toHaveLength(4);
  });
});

describe("splitDishName", () => {
  it("offers nothing without a comma", () => {
    expect(splitDishName("Gyoza", [], [])).toBeNull();
  });
  it("treats a size word as the size", () => {
    expect(splitDishName("Gyoza, large", [], [])).toEqual({ dish: "Gyoza", variant: "large", note: null });
  });
  it("treats a size already used for that dish as the size", () => {
    expect(splitDishName("Gyoza, Jumbo", entries, [])).toEqual({ dish: "Gyoza", variant: "Jumbo", note: null });
  });
  it("makes anything else a note, and joins further parts into the note", () => {
    expect(splitDishName("Katsu, no sauce", [], [])).toEqual({ dish: "Katsu", variant: null, note: "no sauce" });
    expect(splitDishName("Katsu, large, no sauce, extra rice", [], [])).toEqual({ dish: "Katsu", variant: "large", note: "no sauce, extra rice" });
  });
  it("ignores empty parts and refuses an empty dish", () => {
    expect(splitDishName("Katsu,, large", [], [])).toEqual({ dish: "Katsu", variant: "large", note: null });
    expect(splitDishName(", large", [], [])).toBeNull();
    expect(splitDishName("Katsu,", [], [])).toBeNull();
  });
  it("never offers for a name already in this order", () => {
    expect(splitDishName("Gyoza, large", [], ["gyoza,  large"])).toBeNull();
  });
});
