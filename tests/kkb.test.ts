import { describe, expect, it } from "vitest";
import { allocate, buildKkb, hasPending, kkbText, myShareLabel, priceCompleteness, priceRows, pricesLeft, shortShareLabel, reconcile, type KkbInput } from "@/lib/kkb";
import { EMPTY_SETTLEMENT, type EntrySettlement, type SnapshotEntry } from "@/lib/snapshot";
import type { CorrectionView } from "@/lib/ticket";

let n = 0;
type Attribution = SnapshotEntry["attribution"];
const me = (id: string): Attribution => ({ type: "INDIVIDUAL", label: null, participantId: id });
const named = (label: string): Attribution => ({ type: "INDIVIDUAL", label, participantId: null });
const TABLE: Attribution = { type: "TABLE", label: null, participantId: null };
const group = (label: string): Attribution => ({ type: "GROUP", label, participantId: null });

function e(dish: string, quantity: number, attribution: Attribution, extra: Partial<SnapshotEntry> = {}): SnapshotEntry {
  n += 1;
  return { id: `e${n}`, batchId: `b${n}`, roundId: "r1", dishId: `d-${dish}`, dishName: dish, quantity, variant: null, instructions: null, createdAt: `2026-11-08T12:00:${String(n).padStart(2, "0")}Z`, revision: 1, submittedBy: "h", attribution, ...extra };
}
const price = (unitCentavos: number | null, billTo: EntrySettlement["billTo"] = null): EntrySettlement => ({ unitCentavos, billTo, revision: 1 });

const people = [
  { id: "h", displayName: "Host", role: "HOST" as const, cohost: false },
  { id: "ana", displayName: "Ana", role: "GUEST" as const, cohost: false },
  { id: "jd", displayName: "JD", role: "GUEST" as const, cohost: false },
];

function input(entries: SnapshotEntry[], over: Partial<KkbInput> = {}): KkbInput {
  return {
    participants: people,
    removedPeople: [],
    rounds: [
      { id: "r1", number: 1, status: "CONFIRMED", confirmedAt: "2026-11-08T12:30:00Z" },
      { id: "r2", number: 2, status: "DRAFT", confirmedAt: null },
    ],
    entries,
    corrections: [],
    groups: [],
    settlement: { ...EMPTY_SETTLEMENT, entries: {} },
    ...over,
  };
}
const withPrices = (base: KkbInput, prices: Record<string, EntrySettlement>, charge: number | null = null): KkbInput => ({
  ...base,
  settlement: { ...base.settlement, entries: prices, serviceCharge: { centavos: charge, revision: charge == null ? 0 : 1 } },
});
const correction = (over: Partial<CorrectionView>): CorrectionView => ({ id: `c${++n}`, sourceEntryId: null, sourceRoundNumber: 1, targetRoundId: "r2", dishName: "x", preparation: null, type: "QUANTITY", quantityDelta: null, replacement: null, explanation: null, reason: null, groupId: null, createdAt: "2026-11-06T12:00:00Z", ...over });

describe("buildKkb food subtotals", () => {
  it("the brief's example: Ana has a priced subtotal with one unpriced item; the platter stays shared", () => {
    const katsu = e("Chicken Katsu", 2, me("ana"));
    const tea = e("Iced Tea", 1, me("ana"));
    const platter = e("Gyoza platter", 1, TABLE);
    const kkb = buildKkb(withPrices(input([katsu, tea, platter]), { [katsu.id]: price(12000), [platter.id]: price(36000) }), "ana");

    const ana = kkb.sections[0];
    expect(ana).toMatchObject({ title: "Ana", isMe: true, status: "partial", pricedCentavos: 24000, unpricedUnits: 1 });
    expect(ana.lines.map((l) => [l.label, l.quantity, l.unitCentavos, l.subtotalCentavos])).toEqual([
      ["Chicken Katsu", 2, 12000, 24000],
      ["Iced Tea", 1, null, null],
    ]);
    const table = kkb.sections.find((s) => s.kind === "table")!;
    expect(table).toMatchObject({ title: "Whole table", pricedCentavos: 36000, unpricedUnits: 0, shared: true });

    // Pricing the tea completes Ana's food subtotal.
    const done = buildKkb(withPrices(input([katsu, tea, platter]), { [katsu.id]: price(12000), [tea.id]: price(6000), [platter.id]: price(36000) }), "ana");
    expect(done.sections[0]).toMatchObject({ status: "complete", pricedCentavos: 30000, unpricedUnits: 0 });
  });

  it("an order without any prices reads as 'none', never as ₱0.00", () => {
    const kkb = buildKkb(input([e("Sisig", 1, me("jd"))]), "h");
    expect(kkb.sections.find((s) => s.title === "JD")).toMatchObject({ status: "none", pricedCentavos: 0, unpricedUnits: 1 });
    expect(kkb.charge).toEqual({ state: "unset" });
  });

  it("two entries for the same dish keep their own prices", () => {
    const a = e("Katsu", 1, me("ana"));
    const b = e("Katsu", 2, me("ana"));
    const kkb = buildKkb(withPrices(input([a, b]), { [a.id]: price(12000), [b.id]: price(15000) }), "ana");
    expect(kkb.sections[0].pricedCentavos).toBe(12000 + 30000);
  });

  it("the person a dish is for pays, not the person who typed it; same names stay distinct", () => {
    const people2 = [...people, { id: "ana2", displayName: "Ana", role: "GUEST" as const, cohost: false }];
    const forAna = e("Katsu", 1, me("ana"), { submittedBy: "h" });
    const forAna2 = e("Ramen", 1, me("ana2"), { submittedBy: "ana2" });
    const kkb = buildKkb(withPrices(input([forAna, forAna2], { participants: people2 }), { [forAna.id]: price(100), [forAna2.id]: price(200) }), "h");
    const anas = kkb.sections.filter((s) => s.title === "Ana");
    expect(anas.map((s) => [s.participantId, s.pricedCentavos])).toEqual([
      ["ana", 100],
      ["ana2", 200],
    ]);
  });

  it("puts the viewer first, then people, typed names, groups, whole table, unassigned", () => {
    const kkb = buildKkb(
      input([
        e("A", 1, me("ana")),
        e("B", 1, me("jd")),
        e("C", 1, named("Lola")),
        e("D", 1, group("Barkada")),
        e("E", 1, TABLE),
        e("F", 1, { type: "UNASSIGNED", label: null, participantId: null }),
      ]),
      "jd",
    );
    expect(kkb.sections.map((s) => s.title)).toEqual(["JD", "Ana", "Lola", "Barkada", "Whole table", "Not assigned"]);
  });

  it("lists draft entries separately; they never count", () => {
    const confirmed = e("Katsu", 1, me("ana"));
    const draft = e("Halo-halo", 1, me("ana"), { roundId: "r2" });
    const kkb = buildKkb(withPrices(input([confirmed, draft]), { [confirmed.id]: price(100), [draft.id]: price(900) }), "ana");
    expect(kkb.sections[0]).toMatchObject({ pricedCentavos: 100, status: "complete" });
    expect(kkb.sections[0].drafts.map((l) => [l.label, l.unitCentavos])).toEqual([["Halo-halo", 900]]);
  });

  it("applies confirmed cancellations, flags pending ones, and prices replacements separately", () => {
    const katsu = e("Katsu", 3, me("ana"));
    const sisig = e("Sisig", 2, me("jd"));
    const confirmedCancel = correction({ sourceEntryId: katsu.id, type: "QUANTITY", quantityDelta: -1, targetRoundId: "r1b" });
    const pendingCancel = correction({ sourceEntryId: katsu.id, type: "QUANTITY", quantityDelta: -1 });
    const swap = correction({ sourceEntryId: sisig.id, type: "REPLACE", replacement: "Bangus Sisig", targetRoundId: "r1b" });
    const base = input([katsu, sisig], {
      rounds: [
        { id: "r1", number: 1, status: "CONFIRMED", confirmedAt: "x" },
        { id: "r1b", number: 2, status: "CONFIRMED", confirmedAt: "y" },
        { id: "r2", number: 3, status: "DRAFT", confirmedAt: null },
      ],
      corrections: [confirmedCancel, pendingCancel, swap],
    });
    const priced = withPrices(base, { [katsu.id]: price(10000), [sisig.id]: price(20000) });
    const kkb = buildKkb(priced, "h");
    const ana = kkb.sections.find((s) => s.title === "Ana")!;
    expect(ana.lines[0]).toMatchObject({ quantity: 2, subtotalCentavos: 20000, pendingChange: true });
    expect(ana.status).toBe("partial");
    const jd = kkb.sections.find((s) => s.title === "JD")!;
    expect(jd.lines[0]).toMatchObject({ label: "Sisig → Bangus Sisig", quantity: 2, unitCentavos: null, correctionId: swap.id });
    expect(jd.unpricedUnits).toBe(2);

    const swapPriced = { ...priced, settlement: { ...priced.settlement, corrections: { [swap.id]: { unitCentavos: 22000, revision: 1 } } } };
    expect(buildKkb(swapPriced, "h").sections.find((s) => s.title === "JD")).toMatchObject({ status: "complete", pricedCentavos: 44000 });
  });
});

describe("buildKkb service charge", () => {
  it("allocates in proportion to food: ₱600 of ₱3,000 with ₱300 → ₱60, ₱660 total", () => {
    const a = e("Set A", 1, me("ana"));
    const b = e("Set B", 1, me("jd"));
    const kkb = buildKkb(withPrices(input([a, b]), { [a.id]: price(60000), [b.id]: price(240000) }, 30000), "ana");
    expect(kkb.charge).toMatchObject({ state: "allocated", centavos: 30000 });
    expect(kkb.sections[0]).toMatchObject({ pricedCentavos: 60000, serviceCentavos: 6000, totalCentavos: 66000 });
    expect(kkb.foodCentavos).toBe(300000);
  });

  it("an explicit ₱0.00 means no charge to allocate", () => {
    const a = e("Set A", 1, me("ana"));
    const kkb = buildKkb(withPrices(input([a]), { [a.id]: price(100) }, 0), "ana");
    expect(kkb.charge).toEqual({ state: "none" });
    expect(kkb.sections[0].serviceCentavos).toBeNull();
  });

  it("stays unallocated while anything is unpriced, shared without a payer, or pending, and says why", () => {
    const a = e("Katsu", 1, me("ana"));
    const tea = e("Tea", 1, me("ana"));
    const platter = e("Platter", 1, TABLE);
    const kkb = buildKkb(
      withPrices(input([a, tea, platter], { corrections: [correction({ sourceEntryId: a.id, quantityDelta: -1 })] }), { [a.id]: price(100), [platter.id]: price(500) }, 1000),
      "ana",
    );
    expect(kkb.charge.state).toBe("blocked");
    if (kkb.charge.state !== "blocked") return;
    expect(kkb.charge.blockers).toEqual([
      { kind: "unpriced", units: 1, where: ["Ana"] },
      { kind: "unbilled", dishes: ["Platter"] },
      { kind: "pending", count: 1 },
    ]);
    expect(kkb.sections[0].serviceCentavos).toBeNull();
  });

  it("a host's Bill to moves a shared dish to one payer and unblocks the charge", () => {
    const a = e("Katsu", 1, me("ana"));
    const platter = e("Platter", 1, TABLE);
    const kkb = buildKkb(withPrices(input([a, platter]), { [a.id]: price(10000), [platter.id]: price(30000, { participantId: "jd", label: null }) }, 4000), "jd");
    expect(kkb.charge.state).toBe("allocated");
    const jd = kkb.sections[0];
    expect(jd).toMatchObject({ title: "JD", pricedCentavos: 30000, serviceCentavos: 3000 });
    expect(jd.lines[0]).toMatchObject({ label: "Platter", billedFrom: "Whole table" });
    const table = kkb.sections.find((s) => s.kind === "table")!;
    expect(table).toMatchObject({ pricedCentavos: 0 });
    expect(table.lines[0]).toMatchObject({ billedTo: "JD" });
  });

  it("a positive charge with no eligible food stays unallocated", () => {
    const a = e("Water", 1, me("ana"));
    const kkb = buildKkb(withPrices(input([a]), { [a.id]: price(0) }, 500), "ana");
    expect(kkb.charge).toMatchObject({ state: "blocked", blockers: [{ kind: "zeroFood" }] });
  });
});

describe("allocate (largest remainder)", () => {
  it("sums exactly to the charge and breaks ties by payer key", () => {
    expect(allocate(100, [["b", 1], ["a", 1], ["c", 1]])).toEqual(new Map([["a", 34], ["b", 33], ["c", 33]]));
    const shares = allocate(1001, [["x", 333], ["y", 333], ["z", 334]]);
    expect([...shares.values()].reduce((s, v) => s + v, 0)).toBe(1001);
  });

  it("handles big totals without float error", () => {
    const shares = allocate(99_999_999, [["a", 9_999_999 * 99 * 150], ["b", 9_999_999 * 99 * 150 + 1]]);
    expect([...shares.values()].reduce((s, v) => s + v, 0)).toBe(99_999_999);
  });
});

describe("price completeness", () => {
  it("counts distinct dish lines; a line is priced only when every entry resolves, table prices included", () => {
    const a = e("Katsu", 1, me("ana"));
    const b = e("Katsu", 2, me("jd"));
    const tea = e("Tea", 1, me("ana"));
    const sisig = e("Sisig", 1, TABLE);
    const base = withPrices(input([a, b, tea, sisig]), { [a.id]: price(10000) });
    expect(priceCompleteness(buildKkb(base, "ana"))).toMatchObject({ total: 3, priced: 0 });
    const withTable = { ...base, settlement: { ...base.settlement, defaults: { [`${a.dishId}|`]: { unitCentavos: 9000, revision: 1 }, [`${tea.dishId}|`]: { unitCentavos: 500, revision: 1 } } } };
    const done = priceCompleteness(buildKkb(withTable, "ana"));
    expect(done).toMatchObject({ total: 3, priced: 2 });
    expect(done.first?.line.label).toBe("Sisig");
  });

  it("a line's own price overrides the table price and still counts as priced", () => {
    const a = e("Katsu", 1, me("ana"));
    const base = withPrices(input([a]), { [a.id]: price(10000) });
    const kkb = buildKkb({ ...base, settlement: { ...base.settlement, defaults: { [`${a.dishId}|`]: { unitCentavos: 9000, revision: 1 } } } }, "ana");
    expect(priceCompleteness(kkb)).toMatchObject({ total: 1, priced: 1, first: null });
  });

  it("ignores unconfirmed dishes", () => {
    const draft = e("Tea", 1, me("ana"), { roundId: "r2" });
    expect(priceCompleteness(buildKkb(input([draft]), "ana"))).toMatchObject({ total: 0, priced: 0 });
  });
});

describe("reconcile and kkbText", () => {
  const ana = e("Katsu", 1, me("ana"));
  const jd = e("Ramen", 1, me("jd"));
  const priced = (charge: number | null) => buildKkb(withPrices(input([ana, jd]), { [ana.id]: price(30000), [jd.id]: price(70000) }, charge), "ana");

  it("matches, more and less on the receipt, from food plus the charge", () => {
    expect(reconcile(priced(10000), 110000)).toEqual({ state: "matches" });
    expect(reconcile(priced(10000), 113600)).toEqual({ state: "more", differenceCentavos: 3600 });
    expect(reconcile(priced(10000), 108000)).toEqual({ state: "less", differenceCentavos: 2000 });
  });

  it("with no service charge entered, Salo's total is the food alone", () => {
    expect(reconcile(priced(null), 100000)).toEqual({ state: "matches" });
  });

  it("is incomplete, never a match, while a dish has no price", () => {
    const kkb = buildKkb(withPrices(input([ana, jd]), { [ana.id]: price(30000) }, 1000), "ana");
    expect(reconcile(kkb, 31000)).toEqual({ state: "incomplete", unpriced: 1 });
  });

  it("kkbText shows each person's food, service and total, then the grand total", () => {
    expect(kkbText(priced(10000), "Kovie's table", "Thu, Nov 19")).toBe(
      ["Kovie's table · Thu, Nov 19", "", "Ana  ₱300.00 + ₱30.00 service = ₱330.00", "JD  ₱700.00 + ₱70.00 service = ₱770.00", "", "Total ₱1,100.00", "Made with Salo"].join("\n"),
    );
  });

  it("kkbText is honest when the charge is missing or dishes have no price", () => {
    const unset = kkbText(priced(null), "T", "D");
    expect(unset).toContain("Ana  ₱300.00\n");
    expect(unset).toContain("Service charge not entered yet, so these are food only.");
    expect(unset).toContain("Total not final: service charge not entered");
    const platter = e("Gyoza", 3, TABLE);
    const open = kkbText(buildKkb(withPrices(input([ana, platter]), { [ana.id]: price(30000) }, 1000), "ana"), "T", "D");
    expect(open).toContain("Not yet settled:\n  Gyoza ×3 (Whole table), no price");
    expect(open).toContain("Total not final: 1 dish no price");
  });

  it.each([0, 1000])("a pending change blocks a final total and a verdict (service charge %i)", (charge) => {
    const kkb = buildKkb(withPrices(input([ana, jd], { corrections: [correction({ sourceEntryId: ana.id, quantityDelta: -1 })] }), { [ana.id]: price(30000), [jd.id]: price(70000) }, charge), "ana");
    expect(hasPending(kkb)).toBe(true);
    expect(reconcile(kkb, 100000 + charge)).toEqual({ state: "pending" });
    const text = kkbText(kkb, "T", "D");
    expect(text).toContain("Total not final: a change is pending with the waiter");
    expect(text).toContain("Ana  ");
    expect(text).not.toMatch(/^Total ₱/m);
  });

  it("kkbText lists every reason the total is not final", () => {
    const tea = e("Tea", 1, me("ana"));
    const platter = e("Gyoza", 3, TABLE);
    const kkb = buildKkb(withPrices(input([ana, tea, platter], { corrections: [correction({ sourceEntryId: ana.id, quantityDelta: -1 })] }), { [ana.id]: price(30000) }, 0), "ana");
    expect(kkbText(kkb, "T", "D")).toContain("Total not final: 2 dishes no price, 1 shared dish has no payer, a change is pending with the waiter");
  });
});

describe("short My share label", () => {
  it("drops 'My share' and the dot before the amount, and keeps 'so far'", () => {
    expect(shortShareLabel("My share · ₱1,240")).toBe("Share ₱1,240");
    expect(shortShareLabel("My share so far · ₱240")).toBe("Share so far ₱240");
    expect(shortShareLabel("My share · no prices yet")).toBe("Share · no prices yet");
  });
});

describe("My share label", () => {
  const label = (entries: SnapshotEntry[], prices: Record<string, EntrySettlement>, charge: number | null = null) => myShareLabel(buildKkb(withPrices(input(entries), prices, charge), "ana"));

  it("says no prices yet when nothing is priced", () => {
    expect(label([e("Katsu", 1, me("ana"))], {})).toBe("My share · no prices yet");
  });

  it("shows whole pesos when everything is priced, and 'so far' when something is missing", () => {
    const a = e("Katsu", 2, me("ana"));
    const b = e("Gyoza", 1, me("ana"));
    expect(label([a], { [a.id]: price(24000) })).toBe("My share · ₱480");
    expect(label([a, b], { [a.id]: price(24000) })).toBe("My share so far · ₱480");
  });

  it("uses the total with service charge once allocated", () => {
    const a = e("Katsu", 1, me("ana"));
    const b = e("Gyoza", 1, me("jd"));
    expect(label([a, b], { [a.id]: price(10000), [b.id]: price(10000) }, 2000)).toBe("My share · ₱110");
  });

  it("has no button without confirmed entries (none, or only drafts)", () => {
    expect(label([e("Katsu", 1, me("jd"))], {})).toBeNull();
    expect(label([e("Katsu", 1, me("ana"), { roundId: "r2" })], {})).toBeNull();
  });
});

describe("priceRows (the Prices sheet)", () => {
  const tableKey = (dish: string, size = "") => `d-${dish}|${size}`;
  const rowsOf = (entries: SnapshotEntry[], over: Partial<KkbInput> = {}) => priceRows(input(entries, over));

  it("one row per dish + size with the total quantity; unpriced first, then first appearance", () => {
    const rice = e("Rice", 2, me("ana"));
    const katsuL = e("Katsu", 1, me("ana"), { variant: "Large" });
    const katsuS = e("Katsu", 1, me("jd"), { variant: "Small" });
    const katsuL2 = e("Katsu", 3, me("jd"), { variant: "large" });
    const settlement = { ...EMPTY_SETTLEMENT, defaults: { [tableKey("Rice")]: { unitCentavos: 4500, revision: 2 } } };
    const rows = rowsOf([rice, katsuL, katsuS, katsuL2], { settlement });
    expect(rows.map((r) => [r.label, r.quantity, r.needsPrice])).toEqual([
      ["Katsu (Large)", 4, true],
      ["Katsu (Small)", 1, true],
      ["Rice", 2, false],
    ]);
    expect(rows[2]).toMatchObject({ unitCentavos: 4500, revision: 2 });
    expect(pricesLeft(rows)).toBe(2);
  });

  it("orders by round before ticket order, and ignores draft rounds", () => {
    const later = e("Tea", 1, me("ana"), { roundId: "r2" });
    const first = e("Sisig", 1, me("ana"));
    const rows = priceRows(input([later, first], { rounds: [{ id: "r1", number: 1, status: "CONFIRMED", confirmedAt: "x" }, { id: "r2", number: 2, status: "CONFIRMED", confirmedAt: "x" }] }));
    expect(rows.map((r) => r.label)).toEqual(["Sisig", "Tea"]);
    expect(rowsOf([later])).toEqual([]);
  });

  it("counts lines with their own price; a row of only own prices needs nothing", () => {
    const a = e("Sinigang", 1, me("ana"));
    const b = e("Sinigang", 1, me("jd"));
    const c = e("Pancit", 1, me("ana"));
    const entries = { [a.id]: price(30000), [c.id]: price(9000) };
    const rows = priceRows(withPrices(input([a, b, c]), entries));
    expect(rows.find((r) => r.label === "Sinigang")).toMatchObject({ lines: 2, own: 1, needsPrice: true });
    expect(rows.find((r) => r.label === "Pancit")).toMatchObject({ lines: 1, own: 1, needsPrice: false });
    expect(pricesLeft(rows)).toBe(1);
  });

  it("counts own-priced portions against the row's quantity (2 of 3), not lines", () => {
    const a = e("Iced Tea", 2, me("rafa"));
    const b = e("Iced Tea", 1, me("ana"));
    const rows = priceRows(withPrices(input([a, b]), { [a.id]: price(6000) }));
    expect(rows[0]).toMatchObject({ quantity: 3, ownQuantity: 2, own: 1, lines: 2, needsPrice: true });
  });

  it("a table price settles the row even when one line keeps its own price", () => {
    const a = e("Rice", 1, me("ana"));
    const b = e("Rice", 1, me("jd"));
    const settlement = { ...EMPTY_SETTLEMENT, entries: { [a.id]: price(5000) }, defaults: { [tableKey("Rice")]: { unitCentavos: 4500, revision: 1 } } };
    expect(rowsOf([a, b], { settlement })[0]).toMatchObject({ needsPrice: false, own: 1, lines: 2 });
  });

  it("a cleared table price (row kept, price null) needs a price again and keeps its revision", () => {
    const a = e("Rice", 1, me("ana"));
    const settlement = { ...EMPTY_SETTLEMENT, defaults: { [tableKey("Rice")]: { unitCentavos: null, revision: 3 } } };
    expect(rowsOf([a], { settlement })[0]).toMatchObject({ needsPrice: true, revision: 3, unitCentavos: null });
  });

  it("confirmed cancellations lower the quantity; a replacement gets its own row", () => {
    const beef = e("Beef", 2, me("ana"));
    const rice = e("Rice", 3, me("ana"));
    const swap = correction({ sourceEntryId: beef.id, type: "REPLACE", replacement: "Pork", targetRoundId: "r1" });
    const less = correction({ sourceEntryId: rice.id, type: "QUANTITY", quantityDelta: -1, targetRoundId: "r1" });
    const rows = rowsOf([beef, rice], { corrections: [swap, less] });
    expect(rows.map((r) => [r.label, r.quantity, r.correctionId])).toEqual([
      ["Pork (replaces Beef)", 2, swap.id],
      ["Rice", 2, null],
    ]);
    const priced = rowsOf([beef, rice], { corrections: [swap, less], settlement: { ...EMPTY_SETTLEMENT, corrections: { [swap.id]: { unitCentavos: 25000, revision: 1 } } } });
    expect(priced.find((r) => r.correctionId)).toMatchObject({ needsPrice: false, unitCentavos: 25000, revision: 1 });
    expect(pricesLeft(priced)).toBe(1);
  });
});
