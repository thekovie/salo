import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildKkb } from "@/lib/kkb";
import type { Actor } from "@/lib/permissions";
import { sharedPriceKey } from "@/lib/snapshot";
import { sessions, sharedPrices } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { confirmRound } from "@/server/orders/rounds";
import { setEntrySettlement, setSharedPrice } from "@/server/orders/settlement";
import { entrySettlementSchema, sharedPriceSchema } from "@/server/orders/validation";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, addGuest, key, newSession } from "./helpers/session";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3], idempotencyKey: string = key(), type = "t") => runMutation(db, actor, { idempotencyKey, type }, apply);
const table = (actor: Actor, body: Record<string, unknown>, idem?: string) => run(actor, (tx, s) => setSharedPrice(tx, s, actor, sharedPriceSchema.parse(body)), idem, "price.default");
const own = (actor: Actor, entryId: string, body: Record<string, unknown>) => run(actor, (tx, s) => setEntrySettlement(tx, s, actor, entryId, entrySettlementSchema.parse(body)));
const kkb = async (actor: Actor) => buildKkb(await getSnapshot(db, actor), actor.participantId);
const lines = async (actor: Actor) => (await kkb(actor)).sections.flatMap((s) => [...s.lines, ...s.drafts]);

async function katsu(variant: string | null = "Large", instructions: string | null = null) {
  const { host, sessionId } = await newSession(db);
  const first = await add(db, host, { dishName: "Chicken Katsu", quantity: 1, variant, instructions, attribution: { type: "INDIVIDUAL" } });
  const snap = await getSnapshot(db, host);
  return { host, sessionId, entryId: first.result.entryId, dishId: snap.entries[0].dishId };
}

describe("table prices", () => {
  it("resolve own price, then table price, then unknown; notes ignored, sizes distinct", async () => {
    const { host, entryId, dishId } = await katsu("Large");
    const noted = await add(db, host, { dishName: "Chicken Katsu", quantity: 2, variant: "large", instructions: "no sauce", attribution: { type: "INDIVIDUAL" } });
    const small = await add(db, host, { dishName: "Chicken Katsu", quantity: 1, variant: "Small", attribution: { type: "INDIVIDUAL" } });
    expect((await lines(host)).map((l) => l.unitCentavos)).toEqual([null, null, null]);

    await table(host, { dishId, variant: "LARGE", unitCentavos: 12000, expectedRevision: 0 });
    const byId = Object.fromEntries((await lines(host)).map((l) => [l.entryId, l]));
    expect(byId[entryId]).toMatchObject({ unitCentavos: 12000, priceSource: "table" });
    expect(byId[noted.result.entryId]).toMatchObject({ unitCentavos: 12000, priceSource: "table" });
    expect(byId[small.result.entryId]).toMatchObject({ unitCentavos: null, priceSource: null, subtotalCentavos: null });

    await own(host, entryId, { expectedRevision: 0, unitPriceCentavos: 10000 });
    await table(host, { dishId, variant: "Large", unitCentavos: 13000, expectedRevision: 1 });
    expect((await lines(host)).find((l) => l.entryId === entryId)).toMatchObject({ unitCentavos: 10000, priceSource: "line" });

    await own(host, entryId, { expectedRevision: 1, unitPriceCentavos: null });
    expect((await lines(host)).find((l) => l.entryId === entryId)).toMatchObject({ unitCentavos: 13000, priceSource: "table" });
  });

  it("an empty size is its own key, and the total is the sum of resolved prices", async () => {
    const { host, dishId } = await katsu("Large");
    await add(db, host, { dishName: "Chicken Katsu", quantity: 3, attribution: { type: "INDIVIDUAL" } });
    await table(host, { dishId, variant: null, unitCentavos: 5000, expectedRevision: 0 });
    const k = await kkb(host);
    expect((await lines(host)).map((l) => l.unitCentavos)).toEqual([null, 5000]);
    expect(k.sections[0].pricedCentavos).toBe(0);
    expect((await getSnapshot(db, host)).settlement.defaults[sharedPriceKey(dishId, "")]).toEqual({ unitCentavos: 5000, revision: 1 });
  });

  it("food total equals the sum of resolved confirmed prices", async () => {
    const { host, dishId, entryId } = await katsu("Large");
    await add(db, host, { dishName: "Chicken Katsu", quantity: 2, variant: "Large", attribution: { type: "INDIVIDUAL" } });
    await table(host, { dishId, variant: "Large", unitCentavos: 12000, expectedRevision: 0 });
    await own(host, entryId, { expectedRevision: 0, unitPriceCentavos: 10000 });
    const snap = await getSnapshot(db, host);
    await run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, s.revision));
    const k = await kkb(host);
    expect(k.foodCentavos).toBe(10000 + 2 * 12000);
  });

  it("replacements never inherit a table price", async () => {
    const { host, dishId, entryId } = await katsu("Large");
    const { openRound, recordCorrection } = await import("@/server/orders/rounds");
    const snap = await getSnapshot(db, host);
    await run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, s.revision));
    await run(host, (tx, s) => openRound(tx, s, host));
    await run(host, (tx, s) => recordCorrection(tx, s, host, { sourceEntryId: entryId, type: "REPLACE", replacement: "Pork Katsu" } as never));
    const after = await getSnapshot(db, host);
    await run(host, (tx, s) => confirmRound(tx, s, host, after.activeRoundId, s.revision));
    await table(host, { dishId, variant: "Large", unitCentavos: 12000, expectedRevision: 0 });
    const swapped = (await lines(host)).find((l) => l.correctionId);
    expect(swapped).toMatchObject({ unitCentavos: null, priceSource: null, subtotalCentavos: null });
  });

  it("host only; a guest is forbidden", async () => {
    const { host, sessionId, dishId } = await katsu();
    const ana = await addGuest(db, sessionId, "Ana");
    await expect(table(ana, { dishId, variant: "Large", unitCentavos: 100, expectedRevision: 0 })).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(sharedPrices)).toHaveLength(0);
    await expect(table(host, { dishId: crypto.randomUUID(), variant: null, unitCentavos: 100, expectedRevision: 0 })).rejects.toMatchObject({ status: 404 });
  });

  it("stale revision is a 409; a retried key applies once; blank removes it", async () => {
    const { host, dishId } = await katsu();
    const idem = key();
    await table(host, { dishId, variant: "Large", unitCentavos: 100, expectedRevision: 0 }, idem);
    expect((await table(host, { dishId, variant: "Large", unitCentavos: 100, expectedRevision: 0 }, idem)).replayed).toBe(true);
    await expect(table(host, { dishId, variant: "Large", unitCentavos: 200, expectedRevision: 0 })).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    const [row] = await db.select().from(sharedPrices);
    expect(row.revision).toBe(1);
    await table(host, { dishId, variant: "Large", unitCentavos: null, expectedRevision: 1 });
    const [cleared] = await db.select().from(sharedPrices);
    expect(cleared).toMatchObject({ unitCentavos: null, revision: 2 });
    expect((await lines(host))[0]).toMatchObject({ unitCentavos: null, priceSource: null });
    // An editor opened before the price existed (revision 0) must not silently re-create it.
    await expect(table(host, { dishId, variant: "Large", unitCentavos: 300, expectedRevision: 0 })).rejects.toMatchObject({ status: 409 });
  });

  it("clearEntryId clears the line's own price in the same change, or neither", async () => {
    const { host, dishId, entryId } = await katsu("Large");
    await own(host, entryId, { expectedRevision: 0, unitPriceCentavos: 10000 });
    await table(host, { dishId, variant: "Large", unitCentavos: 12000, expectedRevision: 0, clearEntryId: entryId, expectedEntryRevision: 1 });
    expect((await lines(host))[0]).toMatchObject({ unitCentavos: 12000, priceSource: "table" });

    await expect(table(host, { dishId, variant: "Large", unitCentavos: 1, expectedRevision: 0, clearEntryId: entryId, expectedEntryRevision: 2 })).rejects.toMatchObject({ status: 409 });
    const other = await add(db, host, { dishName: "Ramen", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await expect(table(host, { dishId, variant: "Large", unitCentavos: 1, expectedRevision: 1, clearEntryId: other.result.entryId, expectedEntryRevision: 0 })).rejects.toMatchObject({ status: 404 });
    expect((await getSnapshot(db, host)).settlement.defaults[sharedPriceKey(dishId, "large")].unitCentavos).toBe(12000);
  });

  it("clearEntryId needs the line's revision, and a line price set meanwhile survives", async () => {
    const { host, dishId, entryId } = await katsu("Large");
    await own(host, entryId, { expectedRevision: 0, unitPriceCentavos: 10000 });
    const base = { dishId, variant: "Large", unitCentavos: 12000, expectedRevision: 0, clearEntryId: entryId };
    expect(sharedPriceSchema.safeParse(base).success).toBe(false);
    await expect(table(host, { ...base, expectedEntryRevision: 0 })).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect((await lines(host))[0]).toMatchObject({ unitCentavos: 10000, priceSource: "line" });
  });

  it("never makes the host's confirm stale, and is removed with the session", async () => {
    const { host, dishId, sessionId } = await katsu();
    const seen = (await getSnapshot(db, host)).session.revision;
    await table(host, { dishId, variant: "Large", unitCentavos: 100, expectedRevision: 0 });
    const snap = await getSnapshot(db, host);
    await expect(run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, seen))).resolves.toMatchObject({ replayed: false });
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    expect(await db.select().from(sharedPrices)).toHaveLength(0);
  });

  it("the database refuses a dish from another session", async () => {
    const a = await katsu();
    const b = await katsu();
    await expect(db.insert(sharedPrices).values({ sessionId: b.sessionId, dishId: a.dishId, variantKey: "", unitCentavos: 1 })).rejects.toThrow();
  });
});
