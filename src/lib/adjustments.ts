import { allocate } from "./allocate";
import { normalizeText } from "./dish-name";
import { formatPeso } from "./money";
import type { Kkb, KkbInput, KkbSection } from "./kkb";
import type { AdjustmentCategory, SnapshotAdjustment } from "./snapshot";

/**
 * Receipt adjustments (discounts and extra charges), computed from what the host typed. Pure integer centavos: a
 * person's share is never stored, so it follows prices. Applied after the service charge, which stays on original food.
 */
export type AdjustmentState = "applied" | "waiting" | "unallocated" | "flagged";

export interface KkbAdjustment {
  id: string;
  direction: "discount" | "charge";
  /** "Senior citizen discount for Lola"; "for everyone" when it covers the whole table. */
  title: string;
  /** The title without "for …": what a person's card shows. */
  cardLabel: string;
  /** Second line: the note and how it is split, or why it isn't applied. */
  detail: string;
  state: AdjustmentState;
  /** Always positive; null while a percent waits for prices. */
  amountCentavos: number | null;
  /** The selected people's food a percent is taken from. */
  basisCentavos: number | null;
  shares: { key: string; name: string; centavos: number }[];
  problems: string[];
}

const CATEGORY_LABEL: Record<AdjustmentCategory, string> = { senior: "Senior citizen", pwd: "PWD", privilege: "Privilege card", promo: "Promotion", other: "Other" };
export const adjustmentCategoryLabel = (category: AdjustmentCategory) => CATEGORY_LABEL[category];

/** How a card or row names it, without the people: "Senior citizen discount", or the note for "Other". */
export function adjustmentLabel(a: Pick<SnapshotAdjustment, "category" | "direction" | "note">): string {
  if (a.category === "other") return a.note ?? `Other ${a.direction}`;
  return `${CATEGORY_LABEL[a.category]} ${a.direction}`;
}

export const personKey = (s: { participantId: string | null; label: string | null }) => (s.participantId ? `p:${s.participantId}` : `n:${normalizeText(s.label ?? "")}`);

/** `bps` of `basis` centavos, half up, exact in BigInt. */
export function percentOf(bps: number, basis: number): number {
  return Number((BigInt(bps) * BigInt(basis) + BigInt(5000)) / BigInt(10000));
}

export const percentLabel = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

const possessive = (name: string) => `${name}’s`;

function names(list: string[]) {
  return list.length <= 3 ? list.join(", ") : `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`;
}

interface Person {
  key: string;
  name: string;
  food: number;
  present: boolean;
}

/** Adds the adjustments to a built Kkb. `waiting`: some dish has no price, payer or is pending (the service charge's blockers). */
export function applyAdjustments(kkb: Kkb, input: KkbInput, waiting: boolean, baseTotal: number): Kkb {
  const list = input.settlement.adjustments;
  if (list.length === 0) return { ...kkb, adjustments: [], adjustedTotal: baseTotal, unresolved: false };

  const active = new Set(input.participants.map((p) => p.id));
  const byKey = new Map(kkb.sections.filter((s) => !s.shared).map((s) => [s.key, s]));
  const eligible = kkb.sections.filter((s) => !s.shared && s.pricedCentavos > 0);
  // What each payer still owes, so two discounts on one person are capped together.
  const running = new Map([...byKey].map(([key, s]) => [key, s.pricedCentavos + (s.serviceCentavos ?? 0)]));
  const cards = new Map<string, { id: string; label: string; centavos: number }[]>();
  let delta = 0;

  const results = list.map((a): KkbAdjustment => {
    const sign = a.direction === "discount" ? -1 : 1;
    const label = adjustmentLabel(a);
    const picked: Person[] = a.shares.map((sh) => {
      const key = personKey(sh);
      const section: KkbSection | undefined = byKey.get(key);
      const name = section?.title ?? sh.label ?? "Someone";
      return { key, name, food: section?.pricedCentavos ?? 0, present: !sh.participantId || active.has(sh.participantId) };
    });
    const everyone = picked.length > 1 && eligible.length === picked.length && eligible.every((s) => picked.some((p) => p.key === s.key));
    const who = a.method === "unallocated" ? "" : everyone ? " for everyone" : picked.length ? ` for ${names(picked.map((p) => p.name))}` : "";
    const method = { proportional: "Split by what each ordered", equal: "Split equally", manual: "Exact amounts", individual: "", unallocated: "Not assigned yet" }[a.method];
    const basis = picked.reduce((sum, p) => sum + p.food, 0);
    const percent = a.percentBps == null ? null : a.method === "individual" ? `${percentLabel(a.percentBps)} of ${possessive(picked[0]?.name ?? "their")} food` : `${percentLabel(a.percentBps)} of selected food`;
    const noteLine = a.category === "other" ? "" : (a.note ?? "");
    const base = { id: a.id, direction: a.direction, title: `${label}${who}`, cardLabel: label, shares: [], problems: [] as string[] };
    const detail = (extra: string) => [noteLine, extra].filter(Boolean).join(" · ");
    const amount = a.amountCentavos ?? (a.percentBps != null ? percentOf(a.percentBps, basis) : 0);

    // An unassigned amount is never split, so it doesn't wait for prices.
    if (a.method === "unallocated") {
      delta += sign * amount;
      return { ...base, detail: detail(method), state: "unallocated", amountCentavos: amount, basisCentavos: null };
    }
    if (waiting) return { ...base, detail: detail("Waiting for prices"), state: "waiting", amountCentavos: a.percentBps != null ? null : amount, basisCentavos: null };

    const shareOf = new Map<string, number>();
    if (a.method === "proportional") allocate(amount, picked.map((p) => [p.key, p.food] as const)).forEach((v, k) => shareOf.set(k, v));
    else if (a.method === "equal") allocate(amount, picked.map((p) => [p.key, 1] as const)).forEach((v, k) => shareOf.set(k, v));
    else if (a.method === "individual") shareOf.set(picked[0].key, amount);
    else a.shares.forEach((sh) => shareOf.set(personKey(sh), sh.amountCentavos ?? 0));
    const shares = picked.map((p) => ({ key: p.key, name: p.name, centavos: shareOf.get(p.key) ?? 0 }));

    const problems = picked.flatMap((p) => (!p.present ? [`${p.name} was removed from this order`] : p.food === 0 ? [`${p.name} has no food on the bill`] : []));
    if (a.direction === "discount") {
      for (const s of shares) {
        const cap = running.get(s.key) ?? 0;
        if (s.centavos > cap && byKey.has(s.key)) problems.push(`${formatPeso(s.centavos)} is more than ${possessive(s.name)} ${formatPeso(cap)}. Not on their share yet.`);
      }
    }
    delta += sign * amount;
    const detailText = detail(percent ?? method);
    if (problems.length) return { ...base, detail: detailText, state: "flagged", amountCentavos: amount, basisCentavos: a.percentBps != null ? basis : null, shares, problems };
    for (const s of shares) {
      running.set(s.key, (running.get(s.key) ?? 0) + sign * s.centavos);
      cards.set(s.key, [...(cards.get(s.key) ?? []), { id: a.id, label, centavos: sign * s.centavos }]);
    }
    return { ...base, detail: detailText, state: "applied", amountCentavos: amount, basisCentavos: a.percentBps != null ? basis : null, shares, problems };
  });

  const sections = kkb.sections.map((s) => {
    const mine = cards.get(s.key);
    if (!mine) return s;
    return { ...s, adjustments: mine, totalCentavos: (s.totalCentavos ?? s.pricedCentavos) + mine.reduce((sum, m) => sum + m.centavos, 0) };
  });
  return { ...kkb, sections, adjustments: results, adjustedTotal: baseTotal + delta, unresolved: results.some((r) => r.state !== "applied") };
}
