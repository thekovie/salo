import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions";
import { confirmedRoundSnapshots, orderEntries, sessionEvents } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { setReady } from "@/server/orders/people";
import { closeSession, confirmRound, openRound, recordCorrection } from "@/server/orders/rounds";
import { renameMe, setCorrectionPrice, setEntrySettlement, setServiceCharge } from "@/server/orders/settlement";
import { updateEntry } from "@/server/orders/entries";
import { correctionPriceSchema, entrySettlementSchema, renameMeSchema, serviceChargeSchema } from "@/server/orders/validation";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, addGuest, key, newSession } from "./helpers/session";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3], idempotencyKey: string = key(), type = "t") => runMutation(db, actor, { idempotencyKey, type }, apply);
const price = (actor: Actor, entryId: string, body: Record<string, unknown>, idem?: string) =>
  run(actor, (tx, s) => setEntrySettlement(tx, s, actor, entryId, entrySettlementSchema.parse(body)), idem, `entry.settle:${entryId}`);
const charge = (actor: Actor, body: Record<string, unknown>) => run(actor, (tx, s) => setServiceCharge(tx, s, actor, serviceChargeSchema.parse(body)));
async function confirm(host: Actor, expected?: number) {
  const snap = await getSnapshot(db, host);
  return run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, expected ?? snap.session.revision));
}

describe("entry prices", () => {
  it("the host prices anything; a guest only what they added; both show in the snapshot", async () => {
    const { host, sessionId } = await newSession(db);
    const ana = await addGuest(db, sessionId, "Ana");
    const jd = await addGuest(db, sessionId, "JD");
    const anaDish = await add(db, ana, { dishName: "Katsu", quantity: 2, attribution: { type: "INDIVIDUAL" } });
    const jdDish = await add(db, jd, { dishName: "Ramen", quantity: 1, attribution: { type: "INDIVIDUAL" } });

    await price(ana, anaDish.result.entryId, { expectedRevision: 0, unitPriceCentavos: 12000 });
    await expect(price(ana, jdDish.result.entryId, { expectedRevision: 0, unitPriceCentavos: 1 })).rejects.toMatchObject({ status: 403 });
    await price(host, jdDish.result.entryId, { expectedRevision: 0, unitPriceCentavos: 25000 });

    const snap = await getSnapshot(db, jd);
    expect(snap.settlement.entries[anaDish.result.entryId]).toEqual({ unitCentavos: 12000, billTo: null, revision: 1 });
    expect(snap.settlement.entries[jdDish.result.entryId]?.unitCentavos).toBe(25000);
  });

  it("takes a price when the dish is added", async () => {
    const { host } = await newSession(db);
    const dish = await add(db, host, { dishName: "Sisig", quantity: 1, unitPriceCentavos: 18000, attribution: { type: "INDIVIDUAL" } });
    expect((await getSnapshot(db, host)).settlement.entries[dish.result.entryId]?.unitCentavos).toBe(18000);
  });

  it("refuses stale writes, applies a retried key once, and clears with null", async () => {
    const { host } = await newSession(db);
    const dish = await add(db, host, { dishName: "Sisig", quantity: 1 });
    const id = dish.result.entryId;
    const idem = key();
    await price(host, id, { expectedRevision: 0, unitPriceCentavos: 100 }, idem);
    const replay = await price(host, id, { expectedRevision: 0, unitPriceCentavos: 100 }, idem);
    expect(replay.replayed).toBe(true);
    await expect(price(host, id, { expectedRevision: 0, unitPriceCentavos: 200 })).rejects.toMatchObject({ code: "CONFLICT" });
    await price(host, id, { expectedRevision: 1, unitPriceCentavos: null });
    expect((await getSnapshot(db, host)).settlement.entries[id]).toMatchObject({ unitCentavos: null, revision: 2 });
  });

  it("prices a confirmed entry without touching the frozen order or its ticket", async () => {
    const { host } = await newSession(db);
    const dish = await add(db, host, { dishName: "Katsu", quantity: 2, attribution: { type: "INDIVIDUAL" } });
    await confirm(host);
    const [entryBefore] = await db.select().from(orderEntries).where(eq(orderEntries.id, dish.result.entryId));
    const [ticketBefore] = await db.select().from(confirmedRoundSnapshots);

    await price(host, dish.result.entryId, { expectedRevision: 0, unitPriceCentavos: 12000 });

    expect((await db.select().from(orderEntries).where(eq(orderEntries.id, dish.result.entryId)))[0]).toEqual(entryBefore);
    expect((await db.select().from(confirmedRoundSnapshots))[0]).toEqual(ticketBefore);
    expect(JSON.stringify(ticketBefore.snapshotData)).not.toContain("12000");
  });

  it("Bill to: host only, shared dishes only, people in this order only", async () => {
    const { host, sessionId } = await newSession(db);
    const ana = await addGuest(db, sessionId, "Ana");
    const other = await newSession(db);
    const platter = await add(db, host, { dishName: "Platter", quantity: 1, attribution: { type: "TABLE" } });
    const mine = await add(db, host, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await confirm(host);

    await expect(price(ana, platter.result.entryId, { expectedRevision: 0, billTo: { participantId: ana.participantId } })).rejects.toMatchObject({ status: 403 });
    await expect(price(host, mine.result.entryId, { expectedRevision: 0, billTo: { participantId: ana.participantId } })).rejects.toMatchObject({ status: 422 });
    await expect(price(host, platter.result.entryId, { expectedRevision: 0, billTo: { participantId: other.host.participantId } })).rejects.toMatchObject({ code: "PERSON_NOT_FOUND" });
    await price(host, platter.result.entryId, { expectedRevision: 0, billTo: { participantId: ana.participantId } });
    expect((await getSnapshot(db, host)).settlement.entries[platter.result.entryId]?.billTo).toEqual({ participantId: ana.participantId, label: null });
  });

  it("never resets readiness, and refuses ids from another order", async () => {
    const { host, sessionId } = await newSession(db);
    const ana = await addGuest(db, sessionId, "Ana");
    const dish = await add(db, ana, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await run(ana, (tx, s) => setReady(tx, s, ana, true));
    await price(ana, dish.result.entryId, { expectedRevision: 0, unitPriceCentavos: 100 });
    expect((await getSnapshot(db, host)).readiness).toEqual([{ participantId: ana.participantId, ready: true }]);

    const other = await newSession(db);
    await expect(price(other.host, dish.result.entryId, { expectedRevision: 0, unitPriceCentavos: 1 })).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
  });

  it("the database refuses negative and over-limit amounts", async () => {
    const { host, sessionId } = await newSession(db);
    const dish = await add(db, host, { dishName: "Katsu", quantity: 1 });
    await expect(db.execute(sql`INSERT INTO entry_settlements (entry_id, session_id, unit_price_centavos) VALUES (${dish.result.entryId}, ${sessionId}, -1)`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE sessions SET service_charge_centavos = 100000000 WHERE id = ${sessionId}`)).rejects.toThrow();
  });
});

describe("replacement prices", () => {
  it("only the host prices a replacement, and only replacements", async () => {
    const { host, sessionId } = await newSession(db);
    const ana = await addGuest(db, sessionId, "Ana");
    const dish = await add(db, host, { dishName: "Sisig", quantity: 2, attribution: { type: "INDIVIDUAL" } });
    await confirm(host);
    await run(host, (tx, s) => openRound(tx, s, host));
    const swap = await run(host, (tx, s) => recordCorrection(tx, s, host, { sourceEntryId: dish.result.entryId, type: "REPLACE", replacement: "Bangus Sisig" }));
    const cancel = await run(host, (tx, s) => recordCorrection(tx, s, host, { sourceEntryId: dish.result.entryId, type: "QUANTITY", quantity: 1 }));
    const priceIt = (actor: Actor, id: string) => run(actor, (tx, s) => setCorrectionPrice(tx, s, actor, id, correctionPriceSchema.parse({ expectedRevision: 0, unitPriceCentavos: 22000 })));

    await expect(priceIt(ana, swap.result.correctionId)).rejects.toMatchObject({ status: 403 });
    await expect(priceIt(host, cancel.result.correctionId)).rejects.toMatchObject({ status: 422 });
    await priceIt(host, swap.result.correctionId);
    expect((await getSnapshot(db, host)).settlement.corrections[swap.result.correctionId]).toEqual({ unitCentavos: 22000, revision: 1 });
  });
});

describe("service charge", () => {
  it("host only; blank, zero and amounts are distinct; stale writes refused", async () => {
    const { host, sessionId } = await newSession(db);
    const ana = await addGuest(db, sessionId, "Ana");
    expect((await getSnapshot(db, host)).settlement.serviceCharge).toEqual({ centavos: null, revision: 0 });
    await expect(charge(ana, { expectedRevision: 0, centavos: 100 })).rejects.toMatchObject({ status: 403 });
    await charge(host, { expectedRevision: 0, centavos: 0 });
    expect((await getSnapshot(db, ana)).settlement.serviceCharge).toEqual({ centavos: 0, revision: 1 });
    await expect(charge(host, { expectedRevision: 0, centavos: 30000 })).rejects.toMatchObject({ code: "CONFLICT" });
    await charge(host, { expectedRevision: 1, centavos: 30000 });
    await charge(host, { expectedRevision: 2, centavos: null });
    expect((await getSnapshot(db, host)).settlement.serviceCharge).toEqual({ centavos: null, revision: 3 });
  });

  it("an ended order is read-only", async () => {
    const { host } = await newSession(db);
    const dish = await add(db, host, { dishName: "Katsu", quantity: 1 });
    await confirm(host);
    await run(host, (tx, s) => closeSession(tx, s, host));
    await expect(charge(host, { expectedRevision: 0, centavos: 100 })).rejects.toMatchObject({ code: "SESSION_CLOSED" });
    await expect(price(host, dish.result.entryId, { expectedRevision: 0, unitPriceCentavos: 1 })).rejects.toMatchObject({ code: "SESSION_CLOSED" });
  });

  it("writes an event for connected browsers", async () => {
    const { host, sessionId } = await newSession(db);
    const out = await charge(host, { expectedRevision: 0, centavos: 500 });
    const [event] = await db.select().from(sessionEvents).where(sql`${sessionEvents.sessionId} = ${sessionId} AND ${sessionEvents.revision} = ${out.revision}`);
    expect(event.eventType).toBe("session.serviceCharge");
  });
});

describe("confirming with the waiter", () => {
  it("still works after a price-only change, but not after a ticket change", async () => {
    const { host } = await newSession(db);
    const dish = await add(db, host, { dishName: "Katsu", quantity: 1 });
    const seen = (await getSnapshot(db, host)).session.revision;
    await price(host, dish.result.entryId, { expectedRevision: 0, unitPriceCentavos: 100 });
    await charge(host, { expectedRevision: 0, centavos: 10 });
    await run(host, (tx, s) => renameMe(tx, s, host, renameMeSchema.parse({ displayName: "Ana" })));
    await expect(confirm(host, seen)).resolves.toMatchObject({ replayed: false });

    await run(host, (tx, s) => openRound(tx, s, host));
    const next = await add(db, host, { dishName: "Tea", quantity: 1 });
    const seen2 = (await getSnapshot(db, host)).session.revision;
    await run(host, (tx, s) => updateEntry(tx, s, host, next.result.entryId, { expectedRevision: 1, quantity: 2 }));
    await expect(confirm(host, seen2)).rejects.toMatchObject({ code: "STALE_REVISION" });
  });
});

describe("host name", () => {
  it("the host can rename themselves; guests can't; blank or too long is refused", async () => {
    const { host, sessionId } = await newSession(db);
    const ana = await addGuest(db, sessionId, "Ana");
    await run(host, (tx, s) => renameMe(tx, s, host, renameMeSchema.parse({ displayName: "  Kovie  " })));
    expect((await getSnapshot(db, ana)).participants.find((p) => p.role === "HOST")?.displayName).toBe("Kovie");
    await expect(run(ana, (tx, s) => renameMe(tx, s, ana, { displayName: "Boss" }))).rejects.toMatchObject({ status: 403 });
    expect(renameMeSchema.safeParse({ displayName: "   " }).success).toBe(false);
    expect(renameMeSchema.safeParse({ displayName: "x".repeat(41) }).success).toBe(false);
  });
});

describe("review follow-ups", () => {
  it("a revision from the future is stale, and an over-long name after tidying is refused cleanly", async () => {
    const { host } = await newSession(db);
    await add(db, host, { dishName: "Katsu", quantity: 1 });
    await expect(confirm(host, 999_999)).rejects.toMatchObject({ code: "STALE_REVISION" });
    // 40 characters as typed, far more after NFKC.
    await expect(run(host, (tx, s) => renameMe(tx, s, host, renameMeSchema.parse({ displayName: "ﷺ".repeat(40) })))).rejects.toMatchObject({ status: 422 });
  });
});
