import { hasSubLines, preparationLabel, type Consolidated } from "./consolidate";

/** A change to a confirmed round, carried on a later round's ticket (brief 5.15, 8.12). */
export interface CorrectionView {
  id: string;
  sourceEntryId: string | null;
  sourceRoundNumber: number;
  targetRoundId: string;
  dishName: string;
  /** "No sauce", "Large · less ice", or null for the plain preparation. */
  preparation: string | null;
  type: "QUANTITY" | "REPLACE";
  /** Negative: how many to cancel. */
  quantityDelta: number | null;
  /** What to change it to, as said to the waiter. */
  replacement: string | null;
  explanation: string | null;
  /** "UNAVAILABLE": the waiter said it's out; told at once (it targets the dish's own confirmed round). */
  reason: "UNAVAILABLE" | null;
  /** Rows written by one change share it; shown as one. */
  groupId: string | null;
  createdAt: string;
}

/** Corrections written by one change (a row without a group is its own), listed by source dish in the order each dish first changed, oldest first within a dish. */
export function groupCorrections(corrections: CorrectionView[]): CorrectionView[][] {
  const groups = new Map<string, CorrectionView[]>();
  for (const c of corrections) {
    const k = c.groupId ? `${c.groupId}:${c.type}` : c.id; // a Replace-with change can hold cancels and swaps; each reads as its own line
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const bySource = new Map<string, CorrectionView[][]>();
  for (const g of groups.values()) {
    const k = `${g[0].dishName}|${g[0].preparation ?? ""}`.toLowerCase();
    bySource.set(k, [...(bySource.get(k) ?? []), g]);
  }
  return [...bySource.values()].flatMap((gs) => gs.sort((a, b) => a[0].createdAt.localeCompare(b[0].createdAt)));
}

/** One row standing for a group: same dish, summed cancellation. */
export const mergeGroup = (group: CorrectionView[]): CorrectionView => ({ ...group[0], quantityDelta: group[0].type === "QUANTITY" ? group.reduce((sum, c) => sum + (c.quantityDelta ?? 0), 0) : group[0].quantityDelta });

/** Every correction plus the rounds the waiter has heard: what "was this dish already swapped away?" needs. */
export interface SwapContext {
  corrections: CorrectionView[];
  confirmed: ReadonlySet<string>;
}

/** A cancel made after a told swap hits the replacement, not the original: its name, or null. */
export function swappedTo(c: CorrectionView, ctx?: SwapContext): string | null {
  if (!ctx || c.type !== "QUANTITY" || !c.sourceEntryId) return null;
  const swaps = ctx.corrections.filter((s) => s.sourceEntryId === c.sourceEntryId && s.type === "REPLACE" && s.replacement && ctx.confirmed.has(s.targetRoundId) && s.createdAt < c.createdAt);
  return swaps.at(-1)?.replacement ?? null;
}

/** The line the waiter hears: "Cancel 1 × Chicken Katsu (No sauce) from round 1". */
export function correctionText(c: CorrectionView, ctx?: SwapContext): string {
  const original = c.preparation ? `${c.dishName} (${c.preparation})` : c.dishName;
  const replacement = swappedTo(c, ctx);
  const dish = replacement ? `${replacement} (was ${original})` : original;
  const main =
    c.type === "QUANTITY" ? `Cancel ${Math.abs(c.quantityDelta ?? 0)} × ${dish}` : `Change ${dish} to ${c.replacement ?? "…"}`;
  return `${main} from round ${c.sourceRoundNumber}${c.explanation ? ` (${c.explanation})` : ""}`;
}

/** The immutable record kept when the host confirms a round with the waiter (brief 5.14, 8.11). */
export interface TicketSnapshot {
  roundNumber: number;
  title: string | null;
  dishes: { name: string; quantity: number; lines: { label: string; quantity: number }[] }[];
  corrections: string[];
  totalItems: number;
  confirmedAt: string;
}

export function buildTicketSnapshot(input: { roundNumber: number; title: string | null; ticket: Consolidated; corrections: CorrectionView[]; confirmedAt: string; context?: SwapContext }): TicketSnapshot {
  return {
    roundNumber: input.roundNumber,
    title: input.title,
    dishes: input.ticket.dishes.map((dish) => ({
      name: dish.name,
      quantity: dish.quantity,
      lines: hasSubLines(dish) ? dish.preparations.map((p) => ({ label: preparationLabel(p), quantity: p.quantity })) : [],
    })),
    corrections: groupCorrections(input.corrections).map((g) => correctionText(mergeGroup(g), input.context)),
    totalItems: input.ticket.totalItems,
    confirmedAt: input.confirmedAt,
  };
}

/** Plain-text ticket for "Copy as text" (brief 5.13); corrections are listed apart from new dishes. */
export function snapshotText(ticket: Pick<TicketSnapshot, "roundNumber" | "title" | "dishes" | "corrections" | "totalItems">): string {
  const lines = [`${ticket.title ? `${ticket.title} · ` : ""}Round ${ticket.roundNumber}`, ""];
  for (const dish of ticket.dishes) {
    lines.push(`${dish.name} ×${dish.quantity}`);
    for (const line of dish.lines) lines.push(`  - ${line.label} ×${line.quantity}`);
  }
  if (ticket.corrections.length) lines.push("", "Corrections:", ...ticket.corrections.map((c) => `  - ${c}`));
  lines.push("", `Total: ${ticket.totalItems} ${ticket.totalItems === 1 ? "item" : "items"}`);
  return lines.join("\n");
}

/** The live ticket of an open round: its entries plus the corrections it carries (same shape as a confirmed one). */
export function liveTicket(input: { roundNumber: number; title: string | null; ticket: Consolidated; corrections: CorrectionView[]; roundId: string; confirmed: ReadonlySet<string> }): TicketSnapshot {
  return buildTicketSnapshot({ ...input, corrections: input.corrections.filter((c) => c.targetRoundId === input.roundId), confirmedAt: "", context: { corrections: input.corrections, confirmed: input.confirmed } });
}
