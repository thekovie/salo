import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildKkb } from "@/lib/kkb";
import { buildSummary } from "@/lib/summary";
import type { Actor } from "@/lib/permissions";
import { orderCorrections, sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { setEntryRemoved } from "@/server/orders/entries";
import { confirmRound, openRound, recordCorrections, removeCorrection } from "@/server/orders/rounds";
import { markDishUnavailable } from "@/server/orders/unavailable";
import { correctionBatchSchema } from "@/server/orders/validation";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, addGuest, key, newSession } from "./helpers/session";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3], idempotencyKey = key(), type = "t") => runMutation(db, actor, { idempotencyKey, type }, apply);
const errorOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; status?: number }) => e);
const confirm = async (a: Actor) => {
  const snap = await getSnapshot(db, a);
  return run(a, (tx, s) => confirmRound(tx, s, a, snap.activeRoundId, snap.session.revision));
};
const open = (a: Actor) => run(a, (tx, s) => openRound(tx, s, a));
const unavailable = (a: Actor, dishId: string, body: { replacement?: string } = {}, idem = key()) => run(a, (tx, s) => markDishUnavailable(tx, s, a, dishId, body), idem, `dish.unavailable:${dishId}`);
const batch = (a: Actor, body: Record<string, unknown>) => run(a, (tx, s) => recordCorrections(tx, s, a, correctionBatchSchema.parse(body)));
const kkbQty = async (a: Actor, dish: string) => {
  const snap = await getSnapshot(db, a);
  return buildKkb(snap, a.participantId).sections.flatMap((s) => [...s.lines, ...s.drafts]).filter((l) => l.label.startsWith(dish)).reduce((n, l) => n + l.quantity, 0);
};

async function sisigTable() {
  const { host, sessionId } = await newSession(db);
  const guest = await addGuest(db, sessionId, "Rafa");
  await add(db, host, { dishName: "Sisig", quantity: 2, variant: "Large", attribution: { type: "INDIVIDUAL" } });
  await add(db, guest, { dishName: "Sisig", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  await add(db, host, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  await confirm(host);
  const snap = await getSnapshot(db, host);
  return { host, guest, sessionId, dishId: snap.entries.find((e) => e.dishName === "Sisig")!.dishId, snap };
}

describe("mark dish unavailable", () => {
  it("one change: draft removed, confirmed cancelled and billed at once, old snapshot untouched", async () => {
    const { host, guest, dishId, snap } = await sisigTable();
    await open(host);
    await add(db, host, { dishName: "Sisig", quantity: 3, variant: "Small", attribution: { type: "INDIVIDUAL" } });
    const before = JSON.stringify(snap.tickets[snap.rounds[0].id]);
    expect(await kkbQty(host, "Sisig")).toBe(6);

    const out = await unavailable(host, dishId);
    expect(out.result).toMatchObject({ removed: 3, cancelled: 3, replaced: 0 });
    const after = await getSnapshot(db, host);
    expect(after.entries.filter((e) => e.dishName === "Sisig" && e.roundId === after.activeRoundId)).toHaveLength(0);
    const rows = after.corrections.filter((c) => c.reason === "UNAVAILABLE");
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((c) => c.groupId)).size).toBe(1);
    expect(rows.every((c) => c.targetRoundId === after.rounds[0].id)).toBe(true);
    expect(await kkbQty(host, "Sisig")).toBe(0);
    expect(await kkbQty(guest, "Sisig")).toBe(0);
    expect(JSON.stringify(buildSummary(after))).not.toContain("Sisig");
    expect(JSON.stringify(after.tickets[after.rounds[0].id])).toBe(before);
    // Round 2's ticket never carries the told rows.
    await add(db, host, { dishName: "Rice", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await confirm(host);
    const done = await getSnapshot(db, host);
    expect(done.tickets[done.rounds[1].id].corrections).toEqual([]);
  });

  it("only cancels what billing still counts; moot pending changes go", async () => {
    const { host, dishId, snap } = await sisigTable();
    await open(host);
    const large = snap.entries.find((e) => e.variant === "Large")!;
    await batch(host, { entries: [{ sourceEntryId: large.id, quantity: 1 }], type: "QUANTITY" });
    await unavailable(host, dishId);
    const rows = (await getSnapshot(db, host)).corrections;
    expect(rows.filter((c) => c.reason == null)).toHaveLength(0);
    expect(rows.filter((c) => c.sourceEntryId === large.id).map((c) => c.quantityDelta)).toEqual([-2]);
    expect(await kkbQty(host, "Sisig")).toBe(0);
  });

  it("an entry partly cancelled and told loses only its remainder; one already at 0 is skipped", async () => {
    const { host, dishId, snap } = await sisigTable();
    await open(host);
    const large = snap.entries.find((e) => e.variant === "Large")!;
    const plain = snap.entries.find((e) => !e.variant && e.dishName === "Sisig")!;
    await batch(host, { entries: [{ sourceEntryId: large.id, quantity: 1 }, { sourceEntryId: plain.id, quantity: 1 }], type: "QUANTITY" });
    await confirm(host);
    await unavailable(host, dishId);
    const rows = (await getSnapshot(db, host)).corrections.filter((c) => c.reason === "UNAVAILABLE");
    expect(rows.map((c) => [c.sourceEntryId, c.quantityDelta])).toEqual([[large.id, -1]]);
    expect(await kkbQty(host, "Sisig")).toBe(0);
    expect((await errorOf(unavailable(host, dishId)))).toMatchObject({ code: "NOTHING_LEFT" });
  });

  it("replacement writes told REPLACE rows; draft entries are only removed", async () => {
    const { host, dishId } = await sisigTable();
    const out = await unavailable(host, dishId, { replacement: "Pork Sisig" });
    expect(out.result).toMatchObject({ replaced: 3, cancelled: 0 });
    const rows = (await getSnapshot(db, host)).corrections;
    expect(rows.map((c) => [c.type, c.replacement, c.reason])).toEqual([["REPLACE", "Pork Sisig", "UNAVAILABLE"], ["REPLACE", "Pork Sisig", "UNAVAILABLE"]]);
  });

  it("host only, idempotent, unknown dish", async () => {
    const { host, guest, dishId } = await sisigTable();
    expect(await errorOf(unavailable(guest, dishId))).toMatchObject({ status: 403 });
    expect(await errorOf(unavailable(host, "00000000-0000-4000-8000-000000000000"))).toMatchObject({ code: "DISH_NOT_FOUND" });
    const idem = key();
    const first = await unavailable(host, dishId, {}, idem);
    const again = await unavailable(host, dishId, {}, idem);
    expect(again.replayed).toBe(true);
    expect(again.result).toEqual(first.result);
    expect(await db.$count(orderCorrections)).toBe(2);
  });

  it("told rows cannot be removed, by the app or the database", async () => {
    const { host, dishId } = await sisigTable();
    await unavailable(host, dishId);
    const [row] = await db.select().from(orderCorrections);
    expect(await errorOf(run(host, (tx, s) => removeCorrection(tx, s, host, row.id)))).toMatchObject({ code: "ROUND_CONFIRMED" });
    await expect(db.delete(orderCorrections).where(eq(orderCorrections.id, row.id))).rejects.toThrow();
    await expect(db.update(orderCorrections).set({ explanation: "x" }).where(eq(orderCorrections.id, row.id))).rejects.toThrow();
  });

  it("draft-only removals are a ticket event (confirm goes stale); told-only are not", async () => {
    const { host, dishId } = await sisigTable();
    await open(host);
    await add(db, host, { dishName: "Rice", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    const looked = await getSnapshot(db, host);
    await unavailable(host, dishId); // confirmed only: dish.unavailableTold
    await run(host, (tx, s) => confirmRound(tx, s, host, looked.activeRoundId, looked.session.revision));
  });

  it("a draft removal makes a confirm that looked earlier stale", async () => {
    const { host } = await newSession(db);
    await add(db, host, { dishName: "Sisig", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await add(db, host, { dishName: "Rice", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    const looked = await getSnapshot(db, host);
    await unavailable(host, looked.entries[0].dishId);
    expect(await errorOf(run(host, (tx, s) => confirmRound(tx, s, host, looked.activeRoundId, looked.session.revision)))).toMatchObject({ code: "STALE_REVISION" });
  });

  it("dropping a pending cancel from the open round is a ticket event: a confirm that looked earlier goes stale", async () => {
    const { host } = await newSession(db);
    await add(db, host, { dishName: "Sisig", quantity: 2, attribution: { type: "INDIVIDUAL" } });
    await confirm(host);
    await open(host);
    await add(db, host, { dishName: "Halo", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    const sisig = (await getSnapshot(db, host)).entries.find((e) => e.dishName === "Sisig")!;
    await batch(host, { entries: [{ sourceEntryId: sisig.id, quantity: 1 }], type: "QUANTITY" });
    const looked = await getSnapshot(db, host);
    await unavailable(host, sisig.dishId);
    expect(await errorOf(run(host, (tx, s) => confirmRound(tx, s, host, looked.activeRoundId, looked.session.revision)))).toMatchObject({ code: "STALE_REVISION" });
  });

  it("replacing covers what remains after pending cancels, which become told cancels", async () => {
    const { host, snap } = await sisigTable();
    await open(host);
    const large = snap.entries.find((e) => e.variant === "Large")!;
    const plain = snap.entries.find((e) => !e.variant && e.dishName === "Sisig")!;
    await batch(host, { entries: [{ sourceEntryId: large.id, quantity: 1 }, { sourceEntryId: plain.id, quantity: 1 }], type: "QUANTITY" });
    const out = await unavailable(host, large.dishId, { replacement: "Adobo" });
    expect(out.result).toMatchObject({ cancelled: 2, replaced: 1 });
    const rows = (await getSnapshot(db, host)).corrections;
    expect(rows.every((c) => c.reason === "UNAVAILABLE" && c.targetRoundId === snap.rounds[0].id)).toBe(true);
    const of = (id: string) => rows.filter((c) => c.sourceEntryId === id).map((c) => [c.type, c.quantityDelta]);
    expect(of(large.id)).toEqual([["QUANTITY", -1], ["REPLACE", null]]);
    expect(of(plain.id)).toEqual([["QUANTITY", -1]]);
    expect(new Set(rows.map((c) => c.groupId)).size).toBe(1);
  });

  it("Undo of the draft part: entries can be restored", async () => {
    const { host } = await newSession(db);
    await add(db, host, { dishName: "Sisig", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    const snap = await getSnapshot(db, host);
    const out = await unavailable(host, snap.entries[0].dishId);
    await run(host, (tx, s) => setEntryRemoved(tx, s, host, out.result.removedEntryIds[0], false));
    expect((await getSnapshot(db, host)).entries).toHaveLength(1);
  });
});

describe("batch corrections", () => {
  it("one row per entry, one group, per-entry caps, removed together", async () => {
    const { host, guest, snap } = await sisigTable();
    await open(host);
    const ids = snap.entries.filter((e) => e.dishName === "Sisig").map((e) => e.id);
    expect(await errorOf(batch(host, { entries: [{ sourceEntryId: ids[0], quantity: 1 }, { sourceEntryId: ids[1], quantity: 2 }], type: "QUANTITY" }))).toMatchObject({ code: "INVALID" });
    expect(await db.$count(orderCorrections)).toBe(0);
    expect(await errorOf(batch(guest, { entries: [{ sourceEntryId: ids[0], quantity: 1 }], type: "QUANTITY" }))).toMatchObject({ status: 403 });
    const out = await batch(host, { entries: [{ sourceEntryId: ids[0], quantity: 2 }, { sourceEntryId: ids[1], quantity: 1 }], type: "QUANTITY" });
    expect(out.result.correctionIds).toHaveLength(2);
    const rows = (await getSnapshot(db, host)).corrections;
    expect(new Set(rows.map((c) => c.groupId)).size).toBe(1);
    await run(host, (tx, s) => removeCorrection(tx, s, host, out.result.correctionIds[0]));
    expect(await db.$count(orderCorrections)).toBe(0);
  });

  it("the 100-row cap is all-or-nothing", async () => {
    const { host, snap } = await sisigTable();
    await open(host);
    const ids = snap.entries.map((e) => e.id).slice(0, 2);
    await db.execute(sql`INSERT INTO order_corrections (session_id, source_round_id, source_entry_id, target_round_id, correction_type, quantity_delta)
      SELECT ${snap.session.id}, ${snap.rounds[0].id}, ${ids[0]}, ${snap.activeRoundId}, 'REPLACE', NULL FROM generate_series(1, 99)`);
    expect(await errorOf(batch(host, { entries: ids.map((sourceEntryId) => ({ sourceEntryId })), type: "REPLACE", replacement: "x" }))).toMatchObject({ code: "TOO_MANY_CORRECTIONS" });
    expect(await db.$count(orderCorrections)).toBe(99);
  });
});

describe("database", () => {
  it("reason is limited to UNAVAILABLE and rows cascade with the session", async () => {
    const { host, sessionId, dishId } = await sisigTable();
    await unavailable(host, dishId);
    await expect(db.update(sessions).set({ title: "x" }).where(eq(sessions.id, sessionId))).resolves.toBeDefined();
    await expect(db.execute(sql`UPDATE order_corrections SET reason = 'OTHER' WHERE true`)).rejects.toThrow();
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    expect(await db.$count(orderCorrections)).toBe(0);
  });
});
