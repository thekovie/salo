import { isPlain, preparationKey, preparationLabel } from "./consolidate";
import { normalizeText } from "./dish-name";
import { confirmedIds, effectiveEntry } from "./effective-order";
import { attributionLabel, everyone, type SessionSnapshot, type SnapshotEntry } from "./snapshot";
import type { CorrectionView } from "./ticket";

type Source = Pick<SnapshotEntry, "id" | "roundId" | "dishId" | "dishName" | "quantity" | "variant" | "instructions" | "attribution" | "createdAt">;

/** One line of a confirmed round: a preparation, or (after a told swap) the replacement, keyed by its text. */
export const servingLineKey = (entry: Pick<SnapshotEntry, "dishId" | "variant" | "instructions">, replacement: string | null): string =>
  replacement ? `to:${normalizeText(replacement)}` : preparationKey(entry);

/**
 * Every confirmed entry placed on its line, with what is really ordered of it. Shared by the tracker and the server.
 * D21: of a replaced line, what was served beyond what the original still expects was served of the replaced
 * dishes, so the replacement only waits for the rest. `served` maps "roundId|lineKey" to the stored count.
 */
export function placeOnLines<E extends Pick<Source, "id" | "roundId" | "dishId" | "quantity" | "variant" | "instructions">>(
  entries: readonly E[],
  corrections: CorrectionView[],
  rounds: readonly { id: string; status: string }[],
  served: ReadonlyMap<string, number>,
) {
  const confirmed = confirmedIds(rounds);
  const placed = entries
    .filter((e) => confirmed.has(e.roundId))
    .map((entry) => {
      const eff = effectiveEntry(entry, corrections, confirmed);
      const from = preparationKey(entry);
      return { entry, eff, from, key: servingLineKey(entry, eff.replacement), expected: Math.max(0, eff.quantity) };
    });
  const left = new Map<string, number>();
  const remaining = (roundId: string, from: string) => placed.filter((p) => p.entry.roundId === roundId && p.key === from).reduce((sum, p) => sum + p.expected, 0);
  const cuts = new Map<string, number>();
  // Spread in id order so client and server (whose queries order entries differently) cut the same replacement lines.
  for (const p of [...placed].sort((a, b) => a.entry.id.localeCompare(b.entry.id))) {
    if (!p.eff.replacement) continue;
    const id = `${p.entry.roundId}|${p.from}`;
    const absorb = left.get(id) ?? Math.max(0, (served.get(id) ?? 0) - remaining(p.entry.roundId, p.from));
    const cut = Math.min(p.expected, absorb);
    left.set(id, absorb - cut);
    cuts.set(p.entry.id, cut);
  }
  return placed.map((p) => (cuts.get(p.entry.id) ? { ...p, expected: p.expected - (cuts.get(p.entry.id) ?? 0) } : p));
}

export interface TrackerLine {
  key: string;
  label: string;
  /** "Kovie ×2 · Miguel ×3" */
  people: string;
  expected: number;
  /** As stored; can exceed `expected` after a told cancellation. */
  served: number;
  /** What is shown as served: min(served, expected). */
  shown: number;
  /** D21: the original of a told replacement, kept as a read-only row of what was served before the swap. */
  history?: boolean;
  /** Served food that a told cancellation took off the order. */
  cancelledSince: number;
}

export interface TrackerRound {
  roundId: string;
  number: number;
  lines: TrackerLine[];
}

export interface Tracker {
  rounds: TrackerRound[];
  expected: number;
  served: number;
}

type TrackerInput = Pick<SessionSnapshot, "rounds" | "corrections" | "participants" | "removedPeople" | "servedCounts"> & { entries: readonly Source[] };

/** The food tracker: confirmed rounds → lines, from the same effective order KKB and Items read. */
export function trackerLines(snapshot: TrackerInput): Tracker {
  const people = everyone(snapshot);
  const servedBy = new Map(snapshot.servedCounts.map((c) => [`${c.roundId}|${c.lineKey}`, c.served]));
  const placed = placeOnLines(snapshot.entries, snapshot.corrections, snapshot.rounds, servedBy);
  const labelOf = (e: Source) => (isPlain(e) ? e.dishName : `${e.dishName} (${preparationLabel(e)})`);
  const rounds = snapshot.rounds
    .filter((r) => r.status === "CONFIRMED")
    .map((round): TrackerRound => {
      const byKey = new Map<string, typeof placed>();
      const mine = placed.filter((p) => p.entry.roundId === round.id).sort((a, b) => a.entry.createdAt.localeCompare(b.entry.createdAt) || a.entry.id.localeCompare(b.entry.id));
      for (const p of mine) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
      const lines = [...byKey.entries()].flatMap(([key, items]): TrackerLine[] => {
        const first = items[0];
        const expected = items.reduce((sum, i) => sum + i.expected, 0);
        const served = servedBy.get(`${round.id}|${key}`) ?? 0;
        if (expected === 0 && served === 0) return [];
        const who = new Map<string, number>();
        for (const i of items.filter((i) => i.expected > 0)) {
          const name = attributionLabel(i.entry, people) ?? "Not assigned";
          who.set(name, (who.get(name) ?? 0) + i.expected);
        }
        const label = first.eff.replacement ?? labelOf(first.entry);
        return [{ key, label, people: [...who].map(([n, q]) => `${n} ×${q}`).join(" · "), expected, served, shown: Math.min(served, expected), cancelledSince: Math.max(0, served - expected) }];
      });
      const history = [...new Map(mine.filter((p) => p.eff.replacement && !byKey.has(p.from)).map((p) => [p.from, p.entry])).entries()].flatMap(([key, entry]): TrackerLine[] => {
        const served = servedBy.get(`${round.id}|${key}`) ?? 0;
        return served > 0 ? [{ key, label: labelOf(entry), people: "", expected: served, served, shown: served, cancelledSince: 0, history: true }] : [];
      });
      return { roundId: round.id, number: round.number, lines: [...lines, ...history] };
    })
    .filter((r) => r.lines.length > 0);
  const all = rounds.flatMap((r) => r.lines);
  return { rounds, expected: all.reduce((s, l) => s + l.expected, 0), served: all.reduce((s, l) => s + l.shown, 0) };
}

export interface ServedRow {
  roundId: string;
  number: number;
  line: TrackerLine;
}

/**
 * Waiting (nothing or part served) first, then fully served, across all rounds. Each group keeps round order then
 * creation order. Bucketed on the server's count (`line.shown`), so a row only moves once the snapshot confirms it.
 */
export function groupServed(tracker: Tracker): { waiting: ServedRow[]; done: ServedRow[] } {
  const rows = tracker.rounds.flatMap((r) => r.lines.map((line): ServedRow => ({ roundId: r.roundId, number: r.number, line })));
  return { waiting: rows.filter((r) => r.line.shown < r.line.expected), done: rows.filter((r) => r.line.shown >= r.line.expected) };
}
