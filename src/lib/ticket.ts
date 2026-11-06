import { hasSubLines, preparationLabel, type Consolidated } from "./consolidate";

/** A change to a confirmed round, carried on a later round's ticket (brief 5.15, 8.12). */
export interface CorrectionView {
  id: string;
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
}

/** The line the waiter hears: "Cancel 1 × Chicken Katsu (No sauce) from round 1". */
export function correctionText(c: CorrectionView): string {
  const dish = c.preparation ? `${c.dishName} (${c.preparation})` : c.dishName;
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

export function buildTicketSnapshot(input: { roundNumber: number; title: string | null; ticket: Consolidated; corrections: CorrectionView[]; confirmedAt: string }): TicketSnapshot {
  return {
    roundNumber: input.roundNumber,
    title: input.title,
    dishes: input.ticket.dishes.map((dish) => ({
      name: dish.name,
      quantity: dish.quantity,
      lines: hasSubLines(dish) ? dish.preparations.map((p) => ({ label: preparationLabel(p), quantity: p.quantity })) : [],
    })),
    corrections: input.corrections.map(correctionText),
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
export function liveTicket(input: { roundNumber: number; title: string | null; ticket: Consolidated; corrections: CorrectionView[]; roundId: string }): TicketSnapshot {
  return buildTicketSnapshot({ ...input, corrections: input.corrections.filter((c) => c.targetRoundId === input.roundId), confirmedAt: "" });
}
