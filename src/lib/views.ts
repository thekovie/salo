import { consolidate, preparationKey, type Consolidated } from "./consolidate";
import { normalizeText } from "./dish-name";
import type { SessionSnapshot, SnapshotEntry } from "./snapshot";

type Person = SessionSnapshot["participants"][number];

export interface PersonBucket {
  key: string;
  kind: "participant" | "name" | "table" | "unassigned";
  title: string;
  participantId: string | null;
  role: Person["role"] | null;
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
    return { key: `p:${p.id}`, kind: "participant", title: p.displayName, participantId: p.id, role: p.role, entries: mine, ticket: consolidate(mine) };
  });
  const names = new Map<string, SnapshotEntry[]>();
  for (const e of individual) {
    if (e.attribution.participantId || !e.attribution.label) continue;
    const key = normalizeText(e.attribution.label);
    names.set(key, [...(names.get(key) ?? []), e]);
  }
  const typed: PersonBucket[] = [...names.entries()].map(([key, list]) => ({ key: `n:${key}`, kind: "name", title: list[0].attribution.label ?? "", participantId: null, role: null, entries: list, ticket: consolidate(list) }));
  const table = entries.filter((e) => e.attribution.type === "TABLE");
  const nobody = entries.filter((e) => e.attribution.type === "UNASSIGNED" || (e.attribution.type === "INDIVIDUAL" && !e.attribution.participantId && !e.attribution.label));
  const extra: PersonBucket[] = [];
  if (table.length) extra.push({ key: "table", kind: "table", title: "Whole table", participantId: null, role: null, entries: table, ticket: consolidate(table) });
  if (nobody.length) extra.push({ key: "unassigned", kind: "unassigned", title: "Not assigned", participantId: null, role: null, entries: nobody, ticket: consolidate(nobody) });
  return [...joined, ...typed, ...extra];
}

export interface GroupBucket {
  key: string;
  label: string;
  groupId: string | null;
  memberIds: string[];
  entries: SnapshotEntry[];
  ticket: Consolidated;
}

/** By group (brief 5.9): collective orders by label (case and spacing ignored), with optional members. */
export function byGroup(entries: readonly SnapshotEntry[], groups: SessionSnapshot["groups"]): GroupBucket[] {
  const buckets = new Map<string, GroupBucket>();
  for (const g of groups) {
    buckets.set(normalizeText(g.label), { key: normalizeText(g.label), label: g.label, groupId: g.id, memberIds: g.memberIds, entries: [], ticket: consolidate([]) });
  }
  for (const e of entries) {
    if (e.attribution.type !== "GROUP" || !e.attribution.label) continue;
    const key = normalizeText(e.attribution.label);
    const bucket = buckets.get(key) ?? { key, label: e.attribution.label, groupId: null, memberIds: [], entries: [], ticket: consolidate([]) };
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
    const theirOwn = entries.filter((e) => e.submittedBy === person.id);
    for (const hostEntry of recordedForThem) {
      const ownEntry = theirOwn.find((e) => preparationKey(e) === preparationKey(hostEntry));
      if (ownEntry) hints.push({ participantId: person.id, personName: person.displayName, dishName: hostEntry.dishName, hostEntry, ownEntry });
    }
  }
  return hints;
}

/** "2 of 3 ready": guests only; the host decides when to order. */
export function readinessSummary(snapshot: Pick<SessionSnapshot, "participants" | "readiness">) {
  const guests = snapshot.participants.filter((p) => p.role === "GUEST");
  const ready = guests.filter((g) => snapshot.readiness.some((r) => r.participantId === g.id && r.ready));
  return { ready: ready.length, total: guests.length, readyIds: new Set(ready.map((g) => g.id)) };
}
