import { isPlain, preparationLabel } from "./consolidate";
import { normalizeText } from "./dish-name";
import { everyone, type SessionSnapshot, type SnapshotEntry } from "./snapshot";

/**
 * KKB ("kanya-kanyang bayad"): each person's food subtotal from confirmed rounds, and their share of the receipt's
 * service charge. Pure and derived from committed state, in integer centavos. The view and any export must use this
 * one calculation so rounding and "not yet" states always agree.
 */
export type KkbInput = Pick<SessionSnapshot, "participants" | "removedPeople" | "rounds" | "entries" | "corrections" | "groups" | "settlement">;

export interface KkbLine {
  entryId: string;
  /** The confirmed replacement whose price applies to this line, if any. */
  correctionId: string | null;
  label: string;
  quantity: number;
  unitCentavos: number | null;
  subtotalCentavos: number | null;
  /** A cancellation or swap is waiting for the next confirmed round. */
  pendingChange: boolean;
  /** On a payer's card: the shared section this dish was billed from ("Whole table"). */
  billedFrom: string | null;
  /** In a shared section: who the host billed this dish to. */
  billedTo: string | null;
  /** Shared or unassigned by attribution, so the host may set Bill to. */
  billable: boolean;
  submittedBy: string;
  /** Revision of the price being shown (entry's or replacement's), 0 when never set. */
  priceRevision: number;
}

export type KkbSectionKind = "participant" | "name" | "group" | "table" | "unassigned";

export interface KkbSection {
  key: string;
  kind: KkbSectionKind;
  title: string;
  participantId: string | null;
  isMe: boolean;
  /** Group, whole table or unassigned: no individual payer. */
  shared: boolean;
  /** For groups: member names, never used to assign a payer. */
  memberNames: string[];
  lines: KkbLine[];
  drafts: KkbLine[];
  pricedCentavos: number;
  unpricedUnits: number;
  pendingChanges: number;
  status: "complete" | "partial" | "none" | "empty";
  /** This payer's share of the service charge, once allocated. */
  serviceCentavos: number | null;
  totalCentavos: number | null;
}

export type KkbBlocker =
  | { kind: "unpriced"; units: number; where: string[] }
  | { kind: "unbilled"; dishes: string[] }
  | { kind: "pending"; count: number }
  | { kind: "zeroFood" };

export type KkbCharge = { state: "unset" } | { state: "none" } | { state: "blocked"; centavos: number; blockers: KkbBlocker[] } | { state: "allocated"; centavos: number };

export interface Kkb {
  sections: KkbSection[];
  charge: KkbCharge;
  /** Priced confirmed food across everyone, shared included. */
  foodCentavos: number;
}

const KIND_ORDER: Record<KkbSectionKind, number> = { participant: 0, name: 1, group: 2, table: 3, unassigned: 4 };

interface Bucket {
  key: string;
  kind: KkbSectionKind;
  title: string;
  participantId: string | null;
}

export function buildKkb(input: KkbInput, meId: string): Kkb {
  const people = everyone(input);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.displayName ?? "Someone";
  const confirmedRounds = new Set(input.rounds.filter((r) => r.status === "CONFIRMED").map((r) => r.id));
  const groupMembers = new Map(input.groups.map((g) => [normalizeText(g.label), g.memberIds.map(nameOf)]));
  const buckets = new Map<string, Bucket & { lines: KkbLine[]; drafts: KkbLine[] }>();
  const bucket = (b: Bucket) => {
    const found = buckets.get(b.key) ?? { ...b, lines: [], drafts: [] };
    buckets.set(b.key, found);
    return found;
  };

  for (const entry of input.entries) {
    const confirmed = confirmedRounds.has(entry.roundId);
    const line = confirmed ? confirmedLine(input, entry, confirmedRounds) : draftLine(input, entry);
    if (!line) continue;
    const origin = bucketOf(entry, nameOf);
    const billTo = isShared(origin.kind) ? payerOfBillTo(input, entry, nameOf) : null;
    if (!billTo) {
      const target = bucket(origin);
      (confirmed ? target.lines : target.drafts).push({ ...line, billable: isShared(origin.kind) });
      continue;
    }
    // Billed: counted on the payer's card, and still listed (not counted) where the table expects to see it.
    const payer = bucket(billTo);
    (confirmed ? payer.lines : payer.drafts).push({ ...line, billable: true, billedFrom: origin.title });
    const shared = bucket(origin);
    (confirmed ? shared.lines : shared.drafts).push({ ...line, billable: true, billedTo: billTo.title });
  }

  const sections = [...buckets.values()].map((b) => toSection(b, meId, groupMembers));
  const ordered = [...sections.filter((s) => s.isMe), ...sections.filter((s) => !s.isMe).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])];
  return withCharge(ordered, input.settlement.serviceCharge.centavos);
}

function isShared(kind: KkbSectionKind) {
  return kind === "group" || kind === "table" || kind === "unassigned";
}

function bucketOf(entry: SnapshotEntry, nameOf: (id: string) => string): Bucket {
  const { type, label, participantId } = entry.attribution;
  if (type === "INDIVIDUAL" && participantId) return { key: `p:${participantId}`, kind: "participant", title: nameOf(participantId), participantId };
  if (type === "INDIVIDUAL" && label) return { key: `n:${normalizeText(label)}`, kind: "name", title: label, participantId: null };
  if (type === "GROUP" && label) return { key: `g:${normalizeText(label)}`, kind: "group", title: label, participantId: null };
  if (type === "TABLE") return { key: "table", kind: "table", title: "Whole table", participantId: null };
  return { key: "unassigned", kind: "unassigned", title: "Not assigned", participantId: null };
}

function payerOfBillTo(input: KkbInput, entry: SnapshotEntry, nameOf: (id: string) => string): Bucket | null {
  const billTo = input.settlement.entries[entry.id]?.billTo;
  if (billTo?.participantId) return { key: `p:${billTo.participantId}`, kind: "participant", title: nameOf(billTo.participantId), participantId: billTo.participantId };
  if (billTo?.label) return { key: `n:${normalizeText(billTo.label)}`, kind: "name", title: billTo.label, participantId: null };
  return null;
}

function dishLabel(entry: SnapshotEntry) {
  return isPlain(entry) ? entry.dishName : `${entry.dishName} (${preparationLabel(entry)})`;
}

function line(entry: SnapshotEntry, quantity: number, unit: number | null, priceRevision: number): KkbLine {
  return {
    entryId: entry.id,
    correctionId: null,
    label: dishLabel(entry),
    quantity,
    unitCentavos: unit,
    subtotalCentavos: unit == null ? null : unit * quantity,
    pendingChange: false,
    billedFrom: null,
    billedTo: null,
    billable: false,
    submittedBy: entry.submittedBy,
    priceRevision,
  };
}

function draftLine(input: KkbInput, entry: SnapshotEntry): KkbLine {
  const price = input.settlement.entries[entry.id];
  return line(entry, entry.quantity, price?.unitCentavos ?? null, price?.revision ?? 0);
}

/** Confirmed quantity cancellations lower the count; a confirmed swap becomes "A → B" priced on its own. */
function confirmedLine(input: KkbInput, entry: SnapshotEntry, confirmedRounds: Set<string>): KkbLine | null {
  const fixes = input.corrections.filter((c) => c.sourceEntryId === entry.id);
  const done = fixes.filter((c) => confirmedRounds.has(c.targetRoundId));
  const pendingChange = fixes.some((c) => !confirmedRounds.has(c.targetRoundId));
  const cancelled = done.filter((c) => c.type === "QUANTITY").reduce((sum, c) => sum + Math.abs(c.quantityDelta ?? 0), 0);
  const quantity = entry.quantity - cancelled;
  if (quantity <= 0) return null;
  const swap = [...done].reverse().find((c) => c.type === "REPLACE" && c.replacement);
  if (!swap) {
    const price = input.settlement.entries[entry.id];
    return { ...line(entry, quantity, price?.unitCentavos ?? null, price?.revision ?? 0), pendingChange };
  }
  const price = input.settlement.corrections[swap.id];
  return { ...line(entry, quantity, price?.unitCentavos ?? null, price?.revision ?? 0), correctionId: swap.id, label: `${dishLabel(entry)} → ${swap.replacement}`, pendingChange };
}

function toSection(b: Bucket & { lines: KkbLine[]; drafts: KkbLine[] }, meId: string, groupMembers: Map<string, string[]>): KkbSection {
  const counted = b.lines.filter((l) => !l.billedTo);
  const pricedCentavos = counted.reduce((sum, l) => sum + (l.subtotalCentavos ?? 0), 0);
  const unpricedUnits = counted.filter((l) => l.unitCentavos == null).reduce((sum, l) => sum + l.quantity, 0);
  const pendingChanges = counted.filter((l) => l.pendingChange).length;
  const anyPriced = counted.some((l) => l.unitCentavos != null);
  const status = counted.length === 0 ? "empty" : !anyPriced ? "none" : unpricedUnits === 0 && pendingChanges === 0 ? "complete" : "partial";
  return {
    key: b.key,
    kind: b.kind,
    title: b.title,
    participantId: b.participantId,
    isMe: b.participantId === meId,
    shared: isShared(b.kind),
    memberNames: b.kind === "group" ? (groupMembers.get(b.key.slice(2)) ?? []) : [],
    lines: b.lines,
    drafts: b.drafts,
    pricedCentavos,
    unpricedUnits,
    pendingChanges,
    status,
    serviceCentavos: null,
    totalCentavos: null,
  };
}

function withCharge(sections: KkbSection[], charge: number | null): Kkb {
  const foodCentavos = sections.reduce((sum, s) => sum + s.pricedCentavos, 0);
  if (charge == null) return { sections, charge: { state: "unset" }, foodCentavos };
  if (charge === 0) return { sections, charge: { state: "none" }, foodCentavos };

  const blockers: KkbBlocker[] = [];
  const unpriced = sections.filter((s) => s.unpricedUnits > 0);
  if (unpriced.length) blockers.push({ kind: "unpriced", units: unpriced.reduce((sum, s) => sum + s.unpricedUnits, 0), where: unpriced.map((s) => s.title) });
  const unbilled = sections.filter((s) => s.shared).flatMap((s) => s.lines.filter((l) => !l.billedTo).map((l) => l.label));
  if (unbilled.length) blockers.push({ kind: "unbilled", dishes: unbilled });
  const pending = sections.reduce((sum, s) => sum + s.pendingChanges, 0);
  if (pending) blockers.push({ kind: "pending", count: pending });
  const payers = sections.filter((s) => !s.shared && s.lines.length > 0);
  if (blockers.length === 0 && payers.every((s) => s.pricedCentavos === 0)) blockers.push({ kind: "zeroFood" });
  if (blockers.length) return { sections, charge: { state: "blocked", centavos: charge, blockers }, foodCentavos };

  const shares = allocate(
    charge,
    payers.map((s) => [s.key, s.pricedCentavos] as const),
  );
  const allocated = sections.map((s) => {
    const share = shares.get(s.key);
    return share === undefined ? s : { ...s, serviceCentavos: share, totalCentavos: s.pricedCentavos + share };
  });
  return { sections: allocated, charge: { state: "allocated", centavos: charge }, foodCentavos };
}

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
