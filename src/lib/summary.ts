import { consolidate, isPlain, preparationLabel } from "./consolidate";
import { everyone, type SessionSnapshot, type SnapshotEntry } from "./snapshot";
import { byGroup, byPerson } from "./views";

/** One block of the "who ordered what" summary: a person, a group, the whole table, or nobody in particular. */
export interface SummarySection {
  title: string;
  /** "host", "shared by Rafa, JD", "shared by the table"… */
  note: string | null;
  items: number;
  lines: { label: string; quantity: number }[];
}

export interface OrderSummary {
  title: string;
  /** Confirmed round numbers included, in order. */
  rounds: number[];
  sections: SummarySection[];
  total: number;
  /** An open round with dishes that never reached the waiter (left out of the summary). */
  unconfirmedRound: number | null;
}

/**
 * What was actually ordered, per entry: confirmed rounds only, with corrections applied. A cancellation lowers the
 * entry's count (gone at zero); a replacement becomes its own line, "Chicken Katsu → Pork Katsu".
 */
function settledEntries(snapshot: SessionSnapshot): SnapshotEntry[] {
  const confirmed = new Set(snapshot.rounds.filter((r) => r.status === "CONFIRMED").map((r) => r.id));
  return snapshot.entries
    .filter((e) => confirmed.has(e.roundId))
    .flatMap((e) => {
      const fixes = snapshot.corrections.filter((c) => c.sourceEntryId === e.id);
      const cancelled = fixes.filter((c) => c.type === "QUANTITY").reduce((n, c) => n + Math.abs(c.quantityDelta ?? 0), 0);
      const quantity = e.quantity - cancelled;
      if (quantity <= 0) return [];
      const replaced = [...fixes].reverse().find((c) => c.type === "REPLACE" && c.replacement);
      return [replaced ? { ...e, quantity, dishId: `replaced:${e.id}`, dishName: `${e.dishName} → ${replaced.replacement}` } : { ...e, quantity }];
    });
}

function linesOf(entries: SnapshotEntry[]): SummarySection["lines"] {
  return consolidate(entries).dishes.flatMap((dish) =>
    dish.preparations.map((p) => ({ label: isPlain(p) ? dish.name : `${dish.name} (${preparationLabel(p)})`, quantity: p.quantity })),
  );
}

const TABLE_NOTE = "shared by the table";
const NOBODY_NOTE = "not assigned to anyone";

/** "Who ordered what" for settling up later (owner request): people, then groups, then the whole table and the rest. */
export function buildSummary(snapshot: SessionSnapshot): OrderSummary {
  const entries = settledEntries(snapshot);
  const people = everyone(snapshot);
  const name = (id: string) => people.find((p) => p.id === id)?.displayName ?? "Someone";
  const section = (title: string, note: string | null, list: SnapshotEntry[]): SummarySection => ({
    title,
    note,
    items: list.reduce((n, e) => n + e.quantity, 0),
    lines: linesOf(list),
  });

  const personal = byPerson(entries, people)
    .filter((b) => b.entries.length > 0)
    .map((b) => section(b.title, b.role === "HOST" ? (b.title.toLowerCase() === "host" ? null : "host") : b.kind === "table" ? TABLE_NOTE : b.kind === "unassigned" ? NOBODY_NOTE : null, b.entries));
  const groups = byGroup(entries, snapshot.groups)
    .filter((g) => g.entries.length > 0)
    .map((g) => section(g.label, g.memberIds.length > 0 ? `shared by ${g.memberIds.map(name).join(", ")}` : "members not set", g.entries));
  const isShared = (s: SummarySection) => s.note === TABLE_NOTE || s.note === NOBODY_NOTE;

  const draft = snapshot.rounds.find((r) => r.status === "DRAFT");
  const draftHasDishes = Boolean(draft && snapshot.entries.some((e) => e.roundId === draft.id));
  return {
    title: snapshot.session.title ?? "Table order",
    rounds: snapshot.rounds.filter((r) => r.status === "CONFIRMED").map((r) => r.number),
    sections: [...personal.filter((s) => !isShared(s)), ...groups, ...personal.filter(isShared)],
    total: entries.reduce((n, e) => n + e.quantity, 0),
    unconfirmedRound: draftHasDishes && draft ? draft.number : null,
  };
}

export const itemsLabel = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

export function roundsLabel(rounds: number[]): string {
  if (rounds.length === 0) return "no confirmed rounds yet";
  if (rounds.length === 1) return `round ${rounds[0]}`;
  return `rounds ${rounds[0]}–${rounds[rounds.length - 1]}`;
}

/** Plain text that reads well pasted into a group chat. `dateLabel` is formatted on the device (its own time zone). */
export function summaryText(summary: OrderSummary, dateLabel: string): string {
  const out = [`${summary.title} · ${dateLabel}`, `Who ordered what (${roundsLabel(summary.rounds)})`];
  for (const s of summary.sections) {
    out.push("", `${s.title}${s.note ? ` (${s.note})` : ""}: ${itemsLabel(s.items)}`);
    for (const line of s.lines) out.push(`  ${line.label} ×${line.quantity}`);
  }
  if (summary.unconfirmedRound) out.push("", `Round ${summary.unconfirmedRound} was never confirmed with the waiter (not included).`);
  out.push("", `Total: ${itemsLabel(summary.total)} · no prices included`, "Made with Salo");
  return out.join("\n");
}
