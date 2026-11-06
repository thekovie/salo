/**
 * Conservative text identity (brief 5.5): "Chicken Katsu" and "chicken  katsu" are the same dish; "Chicken Cutlet"
 * never is. Only Unicode compatibility forms, surrounding/repeated whitespace and letter case are ignored.
 */
export function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

/** How a name is shown: as first typed, tidied (no stray spaces). */
export function tidyText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** Optional free text (variant, instructions, labels): empty after tidying means "none". */
export function optionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const tidy = tidyText(value);
  return tidy === "" ? null : tidy;
}
