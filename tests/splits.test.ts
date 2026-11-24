import { describe, expect, it } from "vitest";
import { buildKkb, kkbText, priceCompleteness, type KkbInput } from "@/lib/kkb";
import { EMPTY_SETTLEMENT, type EntrySettlement, type SnapshotAdjustment, type SnapshotEntry } from "@/lib/snapshot";
import type { CorrectionView } from "@/lib/ticket";

const TABLE: SnapshotEntry["attribution"] = { type: "TABLE", label: null, participantId: null };
const ids = ["h", "jun", "liza", "ana", "bo", "cy", "di", "ed"];
const people = ids.map((id, i) => ({ id, displayName: id === "h" ? "Host" : id[0].toUpperCase() + id.slice(1), role: i === 0 ? ("HOST" as const) : ("GUEST" as const), cohost: false }));

let n = 0;
function dish(name: string, quantity: number, attribution: SnapshotEntry["attribution"] = TABLE): SnapshotEntry {
  n += 1;
  return { id: `e${n}`, batchId: `b${n}`, roundId: "r1", dishId: `d-${name}`, dishName: name, quantity, variant: null, instructions: null, createdAt: `2026-11-08T12:00:${String(n).padStart(2, "0")}Z`, revision: 1, submittedBy: "h", attribution };
}
const own = (id: string): SnapshotEntry["attribution"] => ({ type: "INDIVIDUAL", label: null, participantId: id });
const who = (...list: string[]) => list.map((id) => ({ participantId: id, label: null }));
const row = (unitCentavos: number | null, splitAmong?: EntrySettlement["splitAmong"]): EntrySettlement => ({ unitCentavos, billTo: null, ...(splitAmong ? { splitAmong } : {}), revision: 1 });

function scene(entries: SnapshotEntry[], prices: Record<string, EntrySettlement>, over: { charge?: number | null; adjustments?: SnapshotAdjustment[]; corrections?: CorrectionView[]; settlement?: Partial<KkbInput["settlement"]> } = {}): KkbInput {
  return {
    participants: people,
    removedPeople: [],
    rounds: [{ id: "r1", number: 1, status: "CONFIRMED", confirmedAt: "2026-11-08T12:30:00Z" }],
    entries,
    corrections: over.corrections ?? [],
    groups: [],
    settlement: { ...EMPTY_SETTLEMENT, entries: prices, serviceCharge: { centavos: over.charge ?? null, revision: 1 }, adjustments: over.adjustments ?? [], ...over.settlement },
  };
}
const card = (input: KkbInput, id: string) => buildKkb(input, "h").sections.find((s) => s.key === `p:${id}`);

describe("shared-dish splits", () => {
  it.each([2, 3, 4, 5, 6, 7])("shares of an odd-centavo dish add up to the subtotal across %i people", (count) => {
    const platter = dish("Crispy Pata", 1);
    const payers = ids.slice(1, count + 1);
    const input = scene([platter], { [platter.id]: row(78001, who(...payers)) });
    const kkb = buildKkb(input, "h");
    const shares = payers.map((id) => card(input, id)!.pricedCentavos);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(78001);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    expect(kkb.foodCentavos).toBe(78001);
  });

  it("each payer card shows its share, the shared section lists the dish uncounted, and the service charge unblocks", () => {
    const platter = dish("Crispy Pata", 1);
    const rice = dish("Rice", 1, own("jun"));
    const input = scene([platter, rice], { [platter.id]: row(78000, who("jun", "liza")), [rice.id]: row(10000) }, { charge: 8800 });
    const kkb = buildKkb(input, "h");
    const jun = card(input, "jun")!;
    expect(jun.lines.find((l) => l.label === "Crispy Pata")).toMatchObject({ subtotalCentavos: 39000, splitOfCentavos: 78000, splitWays: 2, billedFrom: "Whole table" });
    const table = kkb.sections.find((s) => s.kind === "table")!;
    expect(table.lines[0]).toMatchObject({ billedTo: "Jun, Liza", splitWays: 2 });
    expect(table.pricedCentavos).toBe(0);
    expect(kkb.charge.state).toBe("allocated");
    // 88.00 service by food: Jun 490.00, Liza 390.00.
    expect(jun.serviceCentavos).toBe(4900);
    expect(card(input, "liza")!.serviceCentavos).toBe(3900);
  });

  it("an unpriced 3-way split counts the dish once: blockers, completeness and one 'Not yet settled' line", () => {
    const platter = dish("Crispy Pata", 2);
    const input = scene([platter], {}, { charge: 5000, settlement: { entries: { [platter.id]: row(null, who("jun", "liza", "ana")) } } });
    const kkb = buildKkb(input, "h");
    expect(kkb.charge).toMatchObject({ state: "blocked", blockers: [{ kind: "unpriced", units: 2 }] });
    expect(priceCompleteness(kkb)).toMatchObject({ total: 1, priced: 0 });
    const text = kkbText(kkb, "T", "d");
    expect(text.match(/Crispy Pata ×2/g)).toHaveLength(1);
    expect(text).toContain("Crispy Pata ×2 (Whole table), no price");
    expect(text).toContain("1 dish no price");
  });

  it("price changes and quantity corrections recompute the shares", () => {
    const platter = dish("Crispy Pata", 2);
    const base = (unit: number, corrections: CorrectionView[] = []) => scene([platter], { [platter.id]: row(unit, who("jun", "liza")) }, { corrections });
    expect(card(base(10000), "jun")!.pricedCentavos).toBe(10000);
    expect(card(base(12000), "jun")!.pricedCentavos).toBe(12000);
    const cut: CorrectionView = { id: "c1", sourceEntryId: platter.id, sourceRoundNumber: 1, targetRoundId: "r2", dishName: "Crispy Pata", preparation: null, type: "QUANTITY", quantityDelta: -1, replacement: null, explanation: null, reason: null, groupId: null, createdAt: "2026-11-08T13:00:00Z" };
    const input = { ...base(10000, [cut]), rounds: [{ id: "r1", number: 1, status: "CONFIRMED" as const, confirmedAt: "x" }, { id: "r2", number: 2, status: "CONFIRMED" as const, confirmedAt: "y" }] };
    expect(card(input, "jun")!.pricedCentavos).toBe(5000);
  });

  it("a replaced shared dish follows the entry's split at the replacement's price", () => {
    const platter = dish("Crispy Pata", 1);
    const swap: CorrectionView = { id: "c1", sourceEntryId: platter.id, sourceRoundNumber: 1, targetRoundId: "r2", dishName: "Crispy Pata", preparation: null, type: "REPLACE", quantityDelta: null, replacement: "Sisig", explanation: null, reason: null, groupId: null, createdAt: "2026-11-08T13:00:00Z" };
    const input = scene([platter], { [platter.id]: row(null, who("jun", "liza")) }, { corrections: [swap], settlement: { corrections: { c1: { unitCentavos: 50000, revision: 1 } } } });
    const withRounds = { ...input, rounds: [{ id: "r1", number: 1, status: "CONFIRMED" as const, confirmedAt: "x" }, { id: "r2", number: 2, status: "CONFIRMED" as const, confirmedAt: "y" }] };
    expect(card(withRounds, "jun")!.lines[0]).toMatchObject({ subtotalCentavos: 25000, correctionId: "c1", splitWays: 2 });
  });

  it("a left person keeps their share on their (left) card", () => {
    const platter = dish("Crispy Pata", 1);
    const input = { ...scene([platter], { [platter.id]: row(10000, who("jun", "gone")) }), removedPeople: [{ id: "gone", displayName: "Gone" }] };
    const kkb = buildKkb(input, "h");
    expect(kkb.sections.find((s) => s.key === "p:gone")).toMatchObject({ title: "Gone (left)", pricedCentavos: 5000 });
  });

  it("typed names split by normalized name, so Ana and ana are one payer", () => {
    const platter = dish("Crispy Pata", 1);
    const input = scene([platter], { [platter.id]: row(9000, [{ participantId: "jun", label: null }, { participantId: null, label: "Lola" }]) });
    expect(buildKkb(input, "h").sections.find((s) => s.key === "n:lola")).toMatchObject({ pricedCentavos: 4500 });
  });

  it("split + service charge + a proportional discount sum to the adjusted total", () => {
    const platter = dish("Crispy Pata", 1);
    const rice = dish("Rice", 1, own("liza"));
    const discount: SnapshotAdjustment = { id: "a1", direction: "discount", category: "senior", note: null, amountCentavos: null, percentBps: 2000, method: "proportional", shares: [{ participantId: "jun", label: null, amountCentavos: null }, { participantId: "liza", label: null, amountCentavos: null }], revision: 1 };
    const input = scene([platter, rice], { [platter.id]: row(78001, who("jun", "liza")), [rice.id]: row(10000) }, { charge: 8801, adjustments: [discount] });
    const kkb = buildKkb(input, "h");
    const sum = kkb.sections.filter((s) => !s.shared).reduce((t, s) => t + (s.totalCentavos ?? 0), 0);
    expect(kkb.adjustments[0].state).toBe("applied");
    expect(sum).toBe(kkb.adjustedTotal);
    expect(kkb.adjustedTotal).toBe(kkb.foodCentavos + 8801 - kkb.adjustments[0].amountCentavos!);
  });

  it("with no split the Copy summary is unchanged: a split's shares just sit inside each person's total", () => {
    const platter = dish("Crispy Pata", 1);
    const plain = buildKkb(scene([platter], { [platter.id]: { unitCentavos: 10000, billTo: { participantId: "jun", label: null }, revision: 1 } }), "h");
    expect(kkbText(plain, "T", "d")).toContain("Jun  ₱100.00");
    const split = buildKkb(scene([platter], { [platter.id]: row(10000, who("jun", "liza")) }), "h");
    const text = kkbText(split, "T", "d");
    expect(text).toContain("Jun  ₱50.00");
    expect(text).toContain("Liza  ₱50.00");
    expect(text).not.toContain("Not yet settled");
  });
});
