/** Prices are whole centavos (PHP only); never floats. */
export const MAX_UNIT_PRICE_CENTAVOS = 9_999_999; // ₱99,999.99 per dish
export const MAX_SERVICE_CHARGE_CENTAVOS = 99_999_999; // ₱999,999.99 per receipt

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatPeso(centavos: number): string {
  return PESO.format(centavos / 100);
}

export type PesoParse = { ok: true; centavos: number | null } | { ok: false; message: string };

/** What someone typed into a price field → centavos. Blank is `null` (unknown / not entered), not zero. */
export function parsePeso(text: string, max: number = MAX_UNIT_PRICE_CENTAVOS): PesoParse {
  const cleaned = text.replace(/[₱,\s]/g, "");
  if (cleaned === "") return { ok: true, centavos: null };
  if (cleaned.startsWith("-")) return { ok: false, message: "Can't be negative." };
  if (/^\d+\.\d{3,}$/.test(cleaned)) return { ok: false, message: "Up to 2 decimal places." };
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return { ok: false, message: "Use numbers only, like 120 or 120.50." };
  const centavos = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(centavos) || centavos > max) return { ok: false, message: `That's over ${formatPeso(max)}.` };
  return { ok: true, centavos };
}

/** Centavos back into what goes in a price field ("120.00"), or blank. */
export function toPesoInput(centavos: number | null | undefined): string {
  return centavos == null ? "" : (centavos / 100).toFixed(2);
}
