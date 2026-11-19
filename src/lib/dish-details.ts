import { normalizeText, tidyText } from "./dish-name";

const MAX_VARIANT = 40;
const MAX_NOTE = 140;
export const MAX_VARIANT_SUGGESTIONS = 4;
const SIZE_WORDS = new Set(["small", "medium", "large", "regular", "solo", "sharing", "family", "hot", "iced"]);

interface EntryLike {
  dishName: string;
  variant: string | null;
}

export interface DishSplit {
  dish: string;
  variant: string | null;
  note: string | null;
}

/** Sizes already used for this dish in this order (same normalized name), in first-used order, up to four. */
export function variantSuggestions(dishName: string, entries: EntryLike[]): string[] {
  const key = normalizeText(dishName);
  if (!key) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    if (!e.variant || normalizeText(e.dishName) !== key || seen.has(normalizeText(e.variant))) continue;
    seen.add(normalizeText(e.variant));
    out.push(e.variant);
  }
  return out.slice(0, MAX_VARIANT_SUGGESTIONS);
}

/**
 * "Gyoza, large, no sauce" -> dish Gyoza, size large, note "no sauce". Only offered, never applied on its own.
 * The part after the first comma is a size when it matches one already used for that dish or a short size word,
 * otherwise a note; later parts join the note. Not offered for a name already in this order's dish list.
 */
export function splitDishName(typed: string, entries: EntryLike[], dishNames: string[]): DishSplit | null {
  if (!typed.includes(",")) return null;
  if (dishNames.some((n) => normalizeText(n) === normalizeText(typed))) return null;
  const [head, ...rest] = typed.split(",").map(tidyText).filter((_, i, all) => i === 0 || all[i] !== "");
  if (!head || rest.length === 0) return null;
  const [first, ...more] = rest;
  const isSize = first.length <= MAX_VARIANT && (SIZE_WORDS.has(normalizeText(first)) || variantSuggestions(head, entries).some((v) => normalizeText(v) === normalizeText(first)));
  const noteParts = isSize ? more : rest;
  const note = noteParts.join(", ").slice(0, MAX_NOTE) || null;
  return { dish: head, variant: isSize ? first : null, note };
}
