import { allocate } from "./allocate";
import { normalizeText } from "./dish-name";
import type { Bucket, KkbInput, KkbLine } from "./kkb";
import type { PersonRef } from "./snapshot";

/** A Bill to or split person as the card they pay on. */
export function bucketOfPerson(p: PersonRef | null | undefined, nameOf: (id: string) => string): Bucket | null {
  if (p?.participantId) return { key: `p:${p.participantId}`, kind: "participant", title: nameOf(p.participantId), participantId: p.participantId };
  if (p?.label) return { key: `n:${normalizeText(p.label)}`, kind: "name", title: p.label, participantId: null };
  return null;
}

/** The people a shared dish is split equally between (stored as who only), as card buckets, sorted by name. */
export function splitPayersOf(input: KkbInput, entryId: string, nameOf: (id: string) => string): Bucket[] {
  const people = input.settlement.entries[entryId]?.splitAmong ?? [];
  return people
    .flatMap((p) => bucketOfPerson(p, nameOf) ?? [])
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * One copy of a split line per payer (their equal share of the subtotal, largest remainder), plus the listed, uncounted
 * line the shared section keeps. Shares always add up to the subtotal, and follow price and quantity because nothing is stored.
 */
export function splitLine(line: KkbLine, payers: Bucket[], originTitle: string): { copies: { payer: Bucket; line: KkbLine }[]; listed: KkbLine } {
  const shares = line.subtotalCentavos == null ? null : allocate(line.subtotalCentavos, payers.map((p) => [p.key, 1] as const));
  const base = { ...line, billable: true, splitWays: payers.length };
  return {
    copies: payers.map((payer) => ({ payer, line: { ...base, subtotalCentavos: shares ? (shares.get(payer.key) ?? 0) : null, splitOfCentavos: line.subtotalCentavos, billedFrom: originTitle } })),
    listed: { ...base, billedTo: payers.map((p) => p.title).join(", ") },
  };
}
