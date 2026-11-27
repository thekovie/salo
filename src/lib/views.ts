import { consolidate, preparationKey, type Consolidated } from "./consolidate";
import { normalizeText } from "./dish-name";
import { attributionLabel, everyone, type SessionSnapshot, type SnapshotEntry } from "./snapshot";

type Person = SessionSnapshot["participants"][number];

export interface PersonBucket {
  key: string;
  kind: "participant" | "name" | "table" | "unassigned";
  title: string;
  participantId: string | null;
  role: Person["role"] | null;
  cohost: boolean;
  entries: SnapshotEntry[];
  ticket: Consolidated;
}

/**
 * By person (brief 5.3): each joined person, then names typed by the host for people who did not join, then the whole
 * table, then dishes for nobody in particular. Group orders live in the group view. People with nothing yet still
 * appear, so the host can see who has not ordered.
 */
export function byPerson(entries: readonly SnapshotEntry[], people: readonly Person[]): PersonBucket[] {
  const individual = entries.filter((e) => e.attribution.type === "INDIVIDUAL");
  const joined: PersonBucket[] = people.map((p) => {
    const mine = individual.filter((e) => e.attribution.participantId === p.id);
    return { key: `p:${p.id}`, kind: "participant", title: p.displayName, participantId: p.id, role: p.role, cohost: p.cohost, entries: mine, ticket: consolidate(mine) };
  });
  const names = new Map<string, SnapshotEntry[]>();
  for (const e of individual) {
    if (e.attribution.participantId || !e.attribution.label) continue;
    const key = normalizeText(e.attribution.label);
    names.set(key, [...(names.get(key) ?? []), e]);
  }
  const typed: PersonBucket[] = [...names.entries()].map(([key, list]) => ({ key: `n:${key}`, kind: "name", title: list[0].attribution.label ?? "", participantId: null, role: null, cohost: false, entries: list, ticket: consolidate(list) }));
  const table = entries.filter((e) => e.attribution.type === "TABLE");
  const nobody = entries.filter((e) => e.attribution.type === "UNASSIGNED" || (e.attribution.type === "INDIVIDUAL" && !e.attribution.participantId && !e.attribution.label));
  const extra: PersonBucket[] = [];
  if (table.length) extra.push({ key: "table", kind: "table", title: "Whole table", participantId: null, role: null, cohost: false, entries: table, ticket: consolidate(table) });
  if (nobody.length) extra.push({ key: "unassigned", kind: "unassigned", title: "Not assigned", participantId: null, role: null, cohost: false, entries: nobody, ticket: consolidate(nobody) });
  return [...joined, ...typed, ...extra];
}

export interface GroupBucket {
  key: string;
  label: string;
  groupId: string | null;
  createdBy: string | null;
  memberIds: string[];
  entries: SnapshotEntry[];
  ticket: Consolidated;
}

/** By group (brief 5.9): collective orders by label (case and spacing ignored), with optional members. */
export function byGroup(entries: readonly SnapshotEntry[], groups: SessionSnapshot["groups"]): GroupBucket[] {
  const buckets = new Map<string, GroupBucket>();
  for (const g of groups) {
    buckets.set(normalizeText(g.label), { key: normalizeText(g.label), label: g.label, groupId: g.id, createdBy: g.createdBy, memberIds: g.memberIds, entries: [], ticket: consolidate([]) });
  }
  for (const e of entries) {
    if (e.attribution.type !== "GROUP" || !e.attribution.label) continue;
    const key = normalizeText(e.attribution.label);
    const bucket = buckets.get(key) ?? { key, label: e.attribution.label, groupId: null, createdBy: null, memberIds: [], entries: [], ticket: consolidate([]) };
    buckets.set(key, { ...bucket, entries: [...bucket.entries, e] });
  }
  return [...buckets.values()].map((b) => ({ ...b, ticket: consolidate(b.entries) }));
}

export interface DuplicateHint {
  participantId: string;
  personName: string;
  dishName: string;
  /** What the host recorded for this person. */
  hostEntry: SnapshotEntry;
  /** What the person added themselves. */
  ownEntry: SnapshotEntry;
}

/**
 * Possible double orders (brief 5.10, 5.12): the host recorded a dish for someone by name (or for them directly),
 * and that person also added the same dish preparation themselves. Only a hint: nothing is merged automatically.
 */
export function findLikelyDuplicates(entries: readonly SnapshotEntry[], people: readonly Person[]): DuplicateHint[] {
  const hostIds = new Set(people.filter((p) => p.role === "HOST").map((p) => p.id));
  const hints: DuplicateHint[] = [];
  for (const person of people) {
    if (person.role !== "GUEST") continue;
    const name = normalizeText(person.displayName);
    const recordedForThem = entries.filter(
      (e) =>
        hostIds.has(e.submittedBy) &&
        e.attribution.type === "INDIVIDUAL" &&
        (e.attribution.participantId === person.id || (!e.attribution.participantId && e.attribution.label != null && normalizeText(e.attribution.label) === name)),
    );
    const theirOwn = entries.filter((e) => e.submittedBy === person.id && e.attribution.participantId === person.id);
    for (const hostEntry of recordedForThem) {
      const ownEntry = theirOwn.find((e) => preparationKey(e) === preparationKey(hostEntry));
      if (ownEntry) hints.push({ participantId: person.id, personName: person.displayName, dishName: hostEntry.dishName, hostEntry, ownEntry });
    }
  }
  return hints;
}

export interface OrderingEntry {
  roundId: string;
  submittedBy: string;
  attribution: { type: string; label: string | null; participantId: string | null };
}

/**
 * Guests who have something in the round: a dish for them, one they added, one typed under their name, or one for a
 * group they are in. Whole-table and unassigned dishes belong to nobody, so they don't count.
 */
export function orderingIds(
  entries: readonly OrderingEntry[],
  people: readonly { id: string; displayName: string }[],
  groups: readonly { label: string; memberIds: readonly string[] }[],
  roundId: string,
): Set<string> {
  const names = new Map(people.map((p) => [normalizeText(p.displayName), p.id]));
  const ids = new Set<string>();
  for (const { submittedBy, attribution: a, roundId: entryRound } of entries) {
    if (entryRound !== roundId) continue;
    ids.add(submittedBy);
    if (a.type === "INDIVIDUAL") {
      const typed = !a.participantId && a.label ? names.get(normalizeText(a.label)) : undefined;
      if (a.participantId) ids.add(a.participantId);
      else if (typed) ids.add(typed);
    } else if (a.type === "GROUP" && a.label) {
      const key = normalizeText(a.label);
      for (const g of groups) if (normalizeText(g.label) === key) g.memberIds.forEach((id) => ids.add(id));
    }
  }
  return ids;
}

/** Guests counted for readiness: those ordering, plus any who said ready anyway. */
export function readinessOf(guestIds: readonly string[], ordering: ReadonlySet<string>, readyIds: ReadonlySet<string>) {
  const counted = guestIds.filter((id) => ordering.has(id) || readyIds.has(id));
  const ready = counted.filter((id) => readyIds.has(id));
  return { ready: ready.length, total: counted.length, readyIds: new Set(ready), noOrderIds: new Set(guestIds.filter((id) => !ordering.has(id) && !readyIds.has(id))) };
}

/** "2 of 3 ready": guests only; the host decides when to order. Guests with nothing in the round don't count. */
export function readinessSummary(snapshot: Pick<SessionSnapshot, "participants" | "readiness" | "groups">, entries: readonly OrderingEntry[], activeRoundId: string) {
  const guests = snapshot.participants.filter((p) => p.role === "GUEST");
  const ready = new Set(snapshot.readiness.filter((r) => r.ready).map((r) => r.participantId));
  return readinessOf(guests.map((g) => g.id), orderingIds(entries, guests, snapshot.groups, activeRoundId), ready);
}

export interface MyOrderRow<E extends SnapshotEntry> {
  entry: E;
  /** Who it is for, when that isn't just me. */
  forName: string | null;
  /** Who added it, when that isn't me. */
  addedBy: string | null;
}

export interface MyOrderGroups<E extends SnapshotEntry> {
  forYou: MyOrderRow<E>[];
  /** Dishes the host typed under my display name (not linked to me until I claim them). */
  typedForYou: MyOrderRow<E>[];
  byYou: MyOrderRow<E>[];
  shared: MyOrderRow<E>[];
}

/** One guest's view of the open round: what is for them, what they added for others, and what the table shares. Others' dishes for others are left out. */
export function myOrderRows<E extends SnapshotEntry>(entries: readonly E[], snapshot: Pick<SessionSnapshot, "participants" | "removedPeople" | "groups">, meId: string): MyOrderGroups<E> {
  const people = everyone(snapshot);
  const myName = normalizeText(people.find((p) => p.id === meId)?.displayName ?? "");
  const myGroups = new Set(snapshot.groups.filter((g) => g.memberIds.includes(meId)).map((g) => normalizeText(g.label)));
  const hostIds = new Set(snapshot.participants.filter((p) => p.role === "HOST").map((p) => p.id));
  const out: MyOrderGroups<E> = { forYou: [], typedForYou: [], byYou: [], shared: [] };
  for (const entry of entries) {
    const { type, label, participantId } = entry.attribution;
    const mine = entry.submittedBy === meId;
    const row: MyOrderRow<E> = { entry, forName: attributionLabel(entry, people), addedBy: mine ? null : (people.find((p) => p.id === entry.submittedBy)?.displayName ?? "Someone") };
    if (participantId === meId) out.forYou.push({ ...row, forName: null });
    else if (type === "INDIVIDUAL" && !participantId && label && normalizeText(label) === myName) (!mine && hostIds.has(entry.submittedBy) ? out.typedForYou : out.forYou).push({ ...row, forName: null });
    else if (type === "TABLE" || (type === "GROUP" && label && myGroups.has(normalizeText(label)))) out.shared.push(row);
    else if (mine) out.byYou.push(row);
  }
  return out;
}
