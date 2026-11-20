import { consolidate, preparationLabel } from "./consolidate";
import { normalizeText } from "./dish-name";
import { confirmedIds, effectiveEntry } from "./effective-order";
import { audienceOf } from "./notifications";
import { attributionLabel, type SessionSnapshot, type SnapshotEntry } from "./snapshot";
import { groupCorrections, mergeGroup, swappedTo, type CorrectionView } from "./ticket";

type People = SessionSnapshot["participants"];

/** One person's entry inside a preparation, with what can still be cancelled (told and pending cancels both count). */
export interface PrepEntry {
  entryId: string;
  /** Attribution identity, so two people with the same display name never share a bucket. */
  key: string;
  who: string;
  ordered: number;
  left: number;
}

/** A line of one confirmed round: a dish, the replacement a told swap left behind, or the history row of what was swapped away. */
export interface Prep {
  key: string;
  kind: "dish" | "replacement" | "replaced";
  label: string;
  dishId: string;
  dishName: string;
  ordered: number;
  left: number;
  entries: PrepEntry[];
  /** A swap not yet told to the waiter: the line stays as confirmed. */
  pendingTo: string | null;
  /** A replacement line: the history row it sits under, and what it replaced. */
  replaces: { key: string; label: string } | null;
}

function entryState(e: Pick<SnapshotEntry, "id" | "quantity">, corrections: CorrectionView[], confirmed: ReadonlySet<string>) {
  const mine = corrections.filter((c) => c.sourceEntryId === e.id);
  const eff = effectiveEntry(e, corrections, confirmed);
  const pendingCancel = mine.filter((c) => c.type === "QUANTITY" && !confirmed.has(c.targetRoundId)).reduce((sum, c) => sum + Math.abs(c.quantityDelta ?? 0), 0);
  const swap = eff.replacement ? mine.find((c) => c.type === "REPLACE" && c.replacement && confirmed.has(c.targetRoundId)) : undefined;
  const cancelledBefore = mine.filter((c) => c.type === "QUANTITY" && confirmed.has(c.targetRoundId) && swap && c.createdAt <= swap.createdAt).reduce((sum, c) => sum + Math.abs(c.quantityDelta ?? 0), 0);
  return {
    replacement: eff.replacement,
    swapAt: swap?.createdAt ?? "",
    effective: Math.max(0, eff.quantity),
    left: Math.max(0, eff.quantity - pendingCancel),
    replacedQty: swap ? Math.max(0, e.quantity - cancelledBefore) : 0,
    pendingTo: [...mine].reverse().find((c) => c.type === "REPLACE" && c.replacement && !confirmed.has(c.targetRoundId))?.replacement ?? null,
  };
}

/** The lines "Change a dish…" works on. Billing reads effectiveEntry; so does this, so a swapped entry only ever counts under its replacement. */
export function preparationsOfRound(entries: SnapshotEntry[], corrections: CorrectionView[], people: People, confirmed: ReadonlySet<string>): Prep[] {
  const swaps = new Map<string, Prep>();
  const toldAt = new Map<string, string>();
  const dishes = consolidate(entries).dishes.flatMap((dish) =>
    dish.preparations.flatMap((p): Prep[] => {
      const plain = dish.preparations.length === 1 && !p.variant && !p.instructions;
      const label = plain ? dish.name : `${dish.name} (${preparationLabel(p)})`;
      const rows = [...p.entries]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) // newest first: the one a table most often means
        .map((e) => ({ e, key: whoKey(e.attribution), who: attributionLabel(e, people) ?? "Not assigned", ...entryState(e, corrections, confirmed) }));
      for (const r of rows.filter((r) => r.replacement)) {
        const swapKey = `to:${normalizeText(r.replacement ?? "")}|${r.key}`;
        const line = swaps.get(swapKey) ?? { key: swapKey, kind: "replacement", label: r.replacement ?? "", dishId: r.e.dishId, dishName: r.replacement ?? "", ordered: 0, left: 0, entries: [], pendingTo: null, replaces: { key: `replaced:${p.key}`, label } };
        toldAt.set(swapKey, [toldAt.get(swapKey), r.swapAt].filter(Boolean).sort()[0] ?? "");
        swaps.set(swapKey, { ...line, ordered: line.ordered + r.effective, left: line.left + r.left, pendingTo: line.pendingTo ?? r.pendingTo, entries: [...line.entries, { entryId: r.e.id, key: r.key, who: r.who, ordered: r.effective, left: r.left }] });
      }
      const own = rows.filter((r) => !r.replacement);
      const line: Prep = {
        key: p.key,
        kind: "dish",
        label,
        dishId: dish.dishId,
        dishName: dish.name,
        ordered: own.reduce((sum, r) => sum + r.e.quantity, 0),
        left: own.reduce((sum, r) => sum + r.left, 0),
        entries: own.map((r) => ({ entryId: r.e.id, key: r.key, who: r.who, ordered: r.e.quantity, left: r.left })),
        pendingTo: own.find((r) => r.pendingTo)?.pendingTo ?? null,
        replaces: null,
      };
      const replacedQty = rows.reduce((sum, r) => sum + r.replacedQty, 0);
      return replacedQty > 0 ? [line, { ...line, key: `replaced:${p.key}`, kind: "replaced", ordered: replacedQty, left: 0, entries: [], pendingTo: null, replaces: null }] : [line];
    }),
  );
  const lines = [...swaps.values()];
  const twins = (l: Prep) => lines.filter((o) => normalizeText(o.label) === normalizeText(l.label)).length > 1;
  const named = lines.map((l) => (twins(l) ? { ...l, label: `${l.label} · ${l.entries[0].who}` } : l)).sort((a, b) => (toldAt.get(a.key) ?? "").localeCompare(toldAt.get(b.key) ?? ""));
  const under = (key: string) => named.filter((l) => l.replaces?.key === key);
  const placed = dishes.flatMap((p) => (p.kind === "replaced" ? [p, ...under(p.key)] : [p]));
  return [...placed, ...named.filter((l) => !placed.includes(l))];
}

/** What the picker lists: lines with something left, plus the history rows. */
export const visiblePreps = (preps: Prep[]): Prep[] => preps.filter((p) => p.left > 0 || p.kind === "replaced");

/** Search keeps a replaced dish's history row above a matching replacement. */
export function searchPreps(preps: Prep[], needle: string): Prep[] {
  const hit = (p: Prep) => normalizeText(p.label).includes(needle);
  return preps.filter((p) => hit(p) || preps.some((r) => r.replaces?.key === p.key && hit(r)));
}

/** A person's share of a preparation: the entries shown under their name in Whose?, newest first. */
export interface PrepPerson {
  key: string;
  who: string;
  ordered: number;
  left: number;
  entries: PrepEntry[];
}

const whoKey = (a: SnapshotEntry["attribution"]) => `${a.type}|${a.participantId ?? ""}|${(a.label ?? "").toLowerCase()}`;

export function prepPeople(prep: Prep): PrepPerson[] {
  const byWho = new Map<string, PrepPerson>();
  for (const e of prep.entries) {
    const person = byWho.get(e.key) ?? { key: e.key, who: e.who, ordered: 0, left: 0, entries: [] };
    byWho.set(e.key, { ...person, ordered: person.ordered + e.ordered, left: person.left + e.left, entries: [...person.entries, e] });
  }
  return [...byWho.values()];
}

/** Turns "how many to cancel per person" into per-source-entry rows; never takes from another person's entries. */
export function allocateCancel(people: PrepPerson[], counts: Record<string, number>): { sourceEntryId: string; quantity: number }[] {
  return people.flatMap((person) => {
    let todo = Math.min(counts[person.key] ?? 0, person.left);
    return person.entries.flatMap((e) => {
      const take = Math.min(todo, e.left);
      todo -= take;
      return take > 0 ? [{ sourceEntryId: e.entryId, quantity: take }] : [];
    });
  });
}

/** What is still ordered of a dish across every round: confirmed after told cancellations, plus open-round entries. */
export function dishRemaining(dishId: string, entries: SnapshotEntry[], snapshot: Pick<SessionSnapshot, "rounds" | "corrections">): number {
  const told = confirmedIds(snapshot.rounds);
  return entries
    .filter((e) => e.dishId === dishId)
    .reduce((sum, e) => {
      if (!told.has(e.roundId)) return sum + e.quantity;
      const left = effectiveEntry(e, snapshot.corrections, told);
      return sum + (left.replacement ? 0 : Math.max(0, left.quantity));
    }, 0);
}

/** Who hears that this dish is unavailable: open-round lines (removed) and confirmed lines with some left (the server skips cancelled and swapped ones). */
export function correctionAudience(dishId: string, entries: SnapshotEntry[], snapshot: Pick<SessionSnapshot, "rounds" | "corrections" | "groups">): string[] | "all" {
  const told = confirmedIds(snapshot.rounds);
  const live = entries.filter((e) => {
    if (e.dishId !== dishId) return false;
    if (!told.has(e.roundId)) return e.quantity > 0;
    const left = effectiveEntry(e, snapshot.corrections, told);
    return !left.replacement && left.quantity > 0;
  });
  return audienceOf(
    live.map((e) => {
      const group = e.attribution.label ? snapshot.groups.find((g) => normalizeText(g.label) === normalizeText(e.attribution.label!)) : undefined;
      return { type: e.attribution.type, participantId: e.attribution.participantId, memberIds: group?.memberIds };
    }),
  );
}

export interface CorrectionRow {
  id: string;
  text: string;
  /** Pending = goes with the open round; told = the waiter already heard it. */
  told: boolean;
  unavailable: boolean;
  /** When the waiter was told, or the round number it goes with. */
  toldAt: string | null;
  goesWithRound: number | null;
}

/** One row per change (a batch or a whole-dish action is one row). */
export function correctionRows(snapshot: Pick<SessionSnapshot, "corrections" | "rounds">): CorrectionRow[] {
  const ctx = { corrections: snapshot.corrections, confirmed: confirmedIds(snapshot.rounds) };
  return groupCorrections(snapshot.corrections).map((group) => {
    const c = mergeGroup(group);
    const round = snapshot.rounds.find((r) => r.id === c.targetRoundId);
    const told = round?.status === "CONFIRMED";
    const qty = Math.abs(c.quantityDelta ?? 0);
    const dish = swappedTo(c, ctx) ?? (c.reason === "UNAVAILABLE" || !c.preparation ? c.dishName : `${c.dishName} (${c.preparation})`);
    const text =
      c.type === "QUANTITY"
        ? told
          ? `${dish} ×${qty} cancelled`
          : `${dish} −${qty}`
        : `${dish} changed to ${c.replacement ?? "…"}`;
    return { id: c.id, text, told, unavailable: c.reason === "UNAVAILABLE", toldAt: told ? (c.reason ? c.createdAt : (round?.confirmedAt ?? null)) : null, goesWithRound: told ? null : (round?.number ?? null) };
  });
}
