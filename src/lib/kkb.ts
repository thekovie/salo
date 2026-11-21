import { isPlain, preparationKey, preparationLabel } from "./consolidate";
import { normalizeText } from "./dish-name";
import { confirmedIds, effectiveEntry } from "./effective-order";
import { formatPeso, formatPesoShort } from "./money";
import { everyone, sharedPriceKey, type SessionSnapshot, type SnapshotEntry } from "./snapshot";

/**
 * KKB ("kanya-kanyang bayad"): each person's food subtotal from confirmed rounds, and their share of the receipt's
 * service charge. Pure and derived from committed state, in integer centavos. The view and any export must use this
 * one calculation so rounding and "not yet" states always agree.
 */
export type KkbInput = Pick<SessionSnapshot, "participants" | "removedPeople" | "rounds" | "entries" | "corrections" | "groups" | "settlement">;

export interface KkbLine {
  entryId: string;
  /** The dish line this belongs to in Items (dish + size + notes); replacements add their own id. */
  dishKey: string;
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
  /** Where the price comes from: the line itself, the table price, or nowhere. Replacements are "line" or null. */
  priceSource: "line" | "table" | null;
  /** The table price key (`sharedPriceKey`) this line would follow; null for replacements. */
  tableKey: string | null;
  /** The table price for this dish + size, when one is set (even if the line has its own). */
  tableCentavos: number | null;
  hasTable: boolean;
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
  const confirmedRounds = confirmedIds(input.rounds);
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

/** A line's own price (override) first, then the table price for its dish + size, else unknown (never zero). */
function resolvePrice(settlement: Pick<KkbInput["settlement"], "entries" | "defaults">, entry: Pick<SnapshotEntry, "id" | "dishId" | "variant">) {
  const own = settlement.entries[entry.id];
  const tableKey = sharedPriceKey(entry.dishId, normalizeText(entry.variant ?? ""));
  const table = settlement.defaults[tableKey];
  const unit = own?.unitCentavos ?? table?.unitCentavos ?? null;
  const tableCentavos = table?.unitCentavos ?? null;
  const priceSource = own?.unitCentavos != null ? ("line" as const) : tableCentavos != null ? ("table" as const) : null;
  return { unit, priceSource, tableKey, revision: own?.revision ?? 0, tableCentavos };
}

function line(entry: SnapshotEntry, quantity: number, unit: number | null, priceRevision: number, priceSource: KkbLine["priceSource"] = unit == null ? null : "line", tableKey: string | null = null, tableCentavos: number | null = null): KkbLine {
  return {
    entryId: entry.id,
    dishKey: preparationKey(entry),
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
    priceSource,
    tableKey,
    tableCentavos,
    hasTable: tableCentavos != null,
  };
}

function entryLine(input: KkbInput, entry: SnapshotEntry, quantity: number): KkbLine {
  const p = resolvePrice(input.settlement, entry);
  return line(entry, quantity, p.unit, p.revision, p.priceSource, p.tableKey, p.tableCentavos);
}

function draftLine(input: KkbInput, entry: SnapshotEntry): KkbLine {
  return entryLine(input, entry, entry.quantity);
}

/** Confirmed quantity cancellations lower the count; a confirmed swap becomes "A → B" priced on its own. */
function confirmedLine(input: KkbInput, entry: SnapshotEntry, confirmedRounds: Set<string>): KkbLine | null {
  const { quantity, replacement, replacementId, pendingChange } = effectiveEntry(entry, input.corrections, confirmedRounds);
  if (quantity <= 0) return null;
  if (!replacementId) {
    return { ...entryLine(input, entry, quantity), pendingChange };
  }
  const price = input.settlement.corrections[replacementId];
  return { ...line(entry, quantity, price?.unitCentavos ?? null, price?.revision ?? 0), dishKey: `${preparationKey(entry)}|${replacementId}`, correctionId: replacementId, label: `${dishLabel(entry)} → ${replacement}`, pendingChange };
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

export interface PriceCompleteness {
  /** Distinct dish lines (dish + size + notes) in confirmed rounds. */
  total: number;
  /** Lines where every entry resolves to a price, a table price included. */
  priced: number;
  /** The first unpriced line in card order, for the "Show" link. */
  first: { sectionKey: string; line: KkbLine } | null;
}

export function priceCompleteness(kkb: Kkb): PriceCompleteness {
  const dishes = new Map<string, boolean>();
  let first: PriceCompleteness["first"] = null;
  for (const section of kkb.sections) {
    for (const line of section.lines) {
      if (line.billedTo) continue;
      const known = line.unitCentavos != null;
      dishes.set(line.dishKey, (dishes.get(line.dishKey) ?? true) && known);
      if (!known && !first) first = { sectionKey: section.key, line };
    }
  }
  const priced = [...dishes.values()].filter(Boolean).length;
  return { total: dishes.size, priced, first };
}

export type Reconciliation =
  | { state: "incomplete"; unpriced: number }
  | { state: "pending" }
  | { state: "matches" }
  | { state: "more" | "less"; differenceCentavos: number };

/** Salo's total (food plus the service charge, when entered) against the receipt. Only compared, never split. */
export function saloTotal(kkb: Kkb): number {
  return kkb.foodCentavos + (kkb.charge.state === "allocated" || kkb.charge.state === "blocked" ? kkb.charge.centavos : 0);
}

export const hasPending = (kkb: Kkb) => kkb.sections.some((s) => s.pendingChanges > 0);

export function reconcile(kkb: Kkb, receiptCentavos: number): Reconciliation {
  const { total, priced } = priceCompleteness(kkb);
  if (priced < total) return { state: "incomplete", unpriced: total - priced };
  if (hasPending(kkb)) return { state: "pending" };
  const difference = receiptCentavos - saloTotal(kkb);
  if (difference === 0) return { state: "matches" };
  return { state: difference > 0 ? "more" : "less", differenceCentavos: Math.abs(difference) };
}

const dishes = (n: number) => `${n} ${n === 1 ? "dish" : "dishes"}`;

/** Messenger-friendly text of the KKB view, from the same calculation. `dateLabel` is formatted on the device. */
export function kkbText(kkb: Kkb, title: string, dateLabel: string): string {
  const { charge } = kkb;
  const split = charge.state === "allocated";
  const out = [`${title} · ${dateLabel}`, ""];
  const people = kkb.sections.filter((s) => !s.shared && s.status !== "empty");
  for (const s of people) {
    const food = s.status === "none" ? "no prices yet" : formatPeso(s.pricedCentavos);
    if (s.serviceCentavos != null && s.totalCentavos != null) out.push(`${s.title}  ${food} + ${formatPeso(s.serviceCentavos)} service = ${formatPeso(s.totalCentavos)}`);
    else out.push(`${s.title}  ${food}${s.status !== "none" && (s.unpricedUnits > 0 || s.pendingChanges > 0) ? " so far" : ""}`);
  }
  if (!split && charge.state !== "none") out.push("", charge.state === "unset" ? "Service charge not entered yet, so these are food only." : "Service charge not split yet, so these are food only.");

  const open = kkb.sections.flatMap((s) => s.lines.filter((l) => !l.billedTo && (l.unitCentavos == null || s.shared)).map((l) => ({ s, l })));
  if (open.length > 0) {
    out.push("", "Not yet settled:");
    for (const { s, l } of open) out.push(`  ${l.label} ×${l.quantity} (${s.title})${l.unitCentavos == null ? ", no price" : ""}`);
  }

  const { total, priced } = priceCompleteness(kkb);
  const unbilled = kkb.sections.filter((s) => s.shared).reduce((sum, s) => sum + s.lines.filter((l) => !l.billedTo).length, 0);
  const reasons = [
    priced < total && `${dishes(total - priced)} no price`,
    unbilled > 0 && `${unbilled} shared ${unbilled === 1 ? "dish has" : "dishes have"} no payer`,
    charge.state === "unset" && "service charge not entered",
    hasPending(kkb) && "a change is pending with the waiter",
  ].filter(Boolean);
  const blocked = reasons.length > 0 || charge.state === "blocked" || open.length > 0;
  out.push("", blocked ? `Total not final: ${reasons.join(", ") || "some items are not settled"}` : `Total ${formatPeso(saloTotal(kkb))}`, "Made with Salo");
  return out.join("\n");
}

/** The dock's "My share" button text (D26); null when the viewer has nothing confirmed yet. */
export function myShareLabel(kkb: Kkb): string | null {
  const mine = kkb.sections.find((s) => s.isMe);
  if (!mine || mine.lines.length === 0 || mine.status === "empty") return null;
  if (mine.status === "none") return "My share · no prices yet";
  if (mine.totalCentavos != null) return `My share · ${formatPesoShort(mine.totalCentavos)}`;
  return `My share${mine.status === "complete" ? "" : " so far"} · ${formatPesoShort(mine.pricedCentavos)}`;
}

/** The same label under 430 px: "Share ₱1,240" (the full text stays the accessible name). */
export const shortShareLabel = (full: string): string => full.replace(/^My share(?: so far)? · (?=₱)/, "Share ").replace(/^My share/, "Share");
