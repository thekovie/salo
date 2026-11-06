import { normalizeText } from "./dish-name";

export type AttributionType = "INDIVIDUAL" | "GROUP" | "TABLE" | "UNASSIGNED";

/** One accepted source entry, as the consolidation sees it. */
export interface SourceEntry {
  id: string;
  dishId: string;
  dishName: string;
  quantity: number;
  variant: string | null;
  instructions: string | null;
  createdAt: string;
  attribution: { type: AttributionType; label: string | null; participantId: string | null };
  submittedBy: string;
}

/** A distinct preparation of one dish: same dish, same variant, same instructions. */
export interface PreparationLine {
  key: string;
  variant: string | null;
  instructions: string | null;
  quantity: number;
  entries: SourceEntry[];
}

export interface ConsolidatedDish {
  dishId: string;
  name: string;
  quantity: number;
  preparations: PreparationLine[];
}

export interface Consolidated {
  dishes: ConsolidatedDish[];
  totalItems: number;
}

export function preparationKey(entry: Pick<SourceEntry, "dishId" | "variant" | "instructions">): string {
  const part = (value: string | null) => (value == null ? "" : normalizeText(value));
  return JSON.stringify([entry.dishId, part(entry.variant), part(entry.instructions)]);
}

/**
 * Consolidated quantity = sum of active source-entry quantities per dish preparation (brief 9). Pure and derived:
 * source entries are never changed. Dishes keep the order they were first added; within a dish the plain
 * preparation comes first, then the others in the order they first appeared.
 */
export function consolidate(entries: readonly SourceEntry[]): Consolidated {
  const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const dishes = new Map<string, { name: string; preparations: Map<string, PreparationLine> }>();

  for (const entry of sorted) {
    const dish = dishes.get(entry.dishId) ?? { name: entry.dishName, preparations: new Map<string, PreparationLine>() };
    const key = preparationKey(entry);
    const line = dish.preparations.get(key);
    dish.preparations.set(
      key,
      line
        ? { ...line, quantity: line.quantity + entry.quantity, entries: [...line.entries, entry] }
        : { key, variant: entry.variant, instructions: entry.instructions, quantity: entry.quantity, entries: [entry] },
    );
    dishes.set(entry.dishId, dish);
  }

  const result = [...dishes.entries()].map(([dishId, dish]) => {
    const preparations = [...dish.preparations.values()];
    const plain = preparations.filter(isPlain);
    const others = preparations.filter((line) => !isPlain(line));
    return {
      dishId,
      name: dish.name,
      quantity: preparations.reduce((sum, line) => sum + line.quantity, 0),
      preparations: [...plain, ...others],
    };
  });
  return { dishes: result, totalItems: result.reduce((sum, dish) => sum + dish.quantity, 0) };
}

export function isPlain(line: Pick<PreparationLine, "variant" | "instructions">): boolean {
  return line.variant == null && line.instructions == null;
}

/** "Large · no ice", or "Regular" for the plain preparation when a dish has several. */
export function preparationLabel(line: Pick<PreparationLine, "variant" | "instructions">): string {
  return [line.variant, line.instructions].filter(Boolean).join(" · ") || "Regular";
}

/** Whether a dish needs sub-lines: more than one preparation, or a single one with a variant or instructions. */
export function hasSubLines(dish: ConsolidatedDish): boolean {
  return dish.preparations.length > 1 || !isPlain(dish.preparations[0]);
}

/** The ticket as plain text, for "Copy order" (brief 5.13). */
export function ticketText(title: string, consolidated: Consolidated): string {
  const lines = [title, ""];
  for (const dish of consolidated.dishes) {
    lines.push(`${dish.name} ×${dish.quantity}`);
    if (hasSubLines(dish)) for (const line of dish.preparations) lines.push(`  - ${preparationLabel(line)} ×${line.quantity}`);
  }
  lines.push("", `Total: ${consolidated.totalItems} ${consolidated.totalItems === 1 ? "item" : "items"}`);
  return lines.join("\n");
}
