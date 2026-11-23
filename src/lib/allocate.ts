/**
 * Largest remainder, in exact integers (BigInt: charge × weight can pass 2^53): each payer gets
 * floor(charge × weight / total), then the centavos left over go to the largest remainders, ties broken by payer key.
 * The shares always add up to `charge`.
 */
export function allocate(charge: number, weights: readonly (readonly [string, number])[]): Map<string, number> {
  const sorted = [...weights].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const total = sorted.reduce((sum, [, w]) => sum + BigInt(w), BigInt(0));
  if (total === BigInt(0)) return new Map(sorted.map(([key]) => [key, 0]));
  const big = BigInt(charge);
  const parts = sorted.map(([key, w]) => ({ key, share: (big * BigInt(w)) / total, remainder: (big * BigInt(w)) % total }));
  const leftover = charge - parts.reduce((sum, p) => sum + Number(p.share), 0);
  // Stable sort keeps key order among equal remainders.
  const winners = new Set([...parts].sort((a, b) => (a.remainder === b.remainder ? 0 : a.remainder > b.remainder ? -1 : 1)).slice(0, leftover).map((p) => p.key));
  return new Map(parts.map((p) => [p.key, Number(p.share) + (winners.has(p.key) ? 1 : 0)]));
}
