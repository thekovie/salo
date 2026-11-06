import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions";
import { confirmedRoundSnapshots, sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { setEntryRemoved, updateEntry } from "@/server/orders/entries";
import { requestClaim } from "@/server/orders/people";
import { CANCELLED_RETENTION_DAYS, closeSession, confirmRound, openRound, recordCorrection, removeCorrection } from "@/server/orders/rounds";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, addGuest, key, newSession } from "./helpers/session";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3]) => runMutation(db, actor, { idempotencyKey: key(), type: "t" }, apply);
async function errorOf(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (e: { code?: string; status?: number }) => e,
  );
}

async function confirm(actor: Actor) {
  const snap = await getSnapshot(db, actor);
  return run(actor, (tx, s) => confirmRound(tx, s, actor, snap.activeRoundId, snap.session.revision));
}

describe("confirmation", () => {
  it("is host-only, needs the latest revision, and stores an immutable ticket (brief 5.14)", async () => {
    const { host, sessionId } = await newSession(db);
    const guest = await addGuest(db, sessionId, "Rafa");
    await add(db, host, { dishName: "Chicken Katsu", quantity: 2 });
    await add(db, guest, { dishName: "Chicken Katsu", quantity: 1, instructions: "No sauce" });
    const before = await getSnapshot(db, host);

    expect(await errorOf(run(guest, (tx, s) => confirmRound(tx, s, guest, before.activeRoundId, before.session.revision)))).toMatchObject({ status: 403 });
    // A change committed after the host looked: confirmation is refused, so nothing is left out.
    await add(db, guest, { dishName: "Iced Tea", quantity: 1 });
    expect(await errorOf(run(host, (tx, s) => confirmRound(tx, s, host, before.activeRoundId, before.session.revision)))).toMatchObject({ code: "STALE_REVISION" });

    await confirm(host);
    const after = await getSnapshot(db, host);
    expect(after.rounds[0].status).toBe("CONFIRMED");
    const ticket = after.tickets[after.rounds[0].id];
    expect(ticket).toMatchObject({ roundNumber: 1, totalItems: 4, dishes: [{ name: "Chicken Katsu", quantity: 3, lines: [{ label: "Regular", quantity: 2 }, { label: "No sauce", quantity: 1 }] }, { name: "Iced Tea", quantity: 1, lines: [] }] });
    // Confirmed entries cannot be edited, removed, claimed or added to.
    const katsu = after.entries[0];
    expect(await errorOf(run(host, (tx, s) => updateEntry(tx, s, host, katsu.id, { expectedRevision: katsu.revision, quantity: 5 })))).toMatchObject({ code: "ROUND_CONFIRMED" });
    expect(await errorOf(run(host, (tx, s) => setEntryRemoved(tx, s, host, katsu.id, true)))).toMatchObject({ code: "ROUND_CONFIRMED" });
    expect(await errorOf(run(guest, (tx, s) => requestClaim(tx, s, guest, katsu.batchId)))).toMatchObject({ code: "ROUND_CONFIRMED" });
    expect(await errorOf(add(db, guest, { dishName: "Rice", quantity: 1 }))).toMatchObject({ code: "NO_OPEN_ROUND" });
    // The stored snapshot itself is frozen.
    await expect(db.update(confirmedRoundSnapshots).set({ snapshotData: {} })).rejects.toThrow();
  });

  it("refuses an empty round and a second confirmation", async () => {
    const { host } = await newSession(db);
    expect(await errorOf(confirm(host))).toMatchObject({ code: "EMPTY_ROUND" });
    await add(db, host, { dishName: "Gyoza", quantity: 1 });
    const snap = await getSnapshot(db, host);
    await run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, snap.session.revision));
    expect(await errorOf(run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, snap.session.revision + 1)))).toMatchObject({ code: "ROUND_NOT_OPEN" });
  });
});

describe("rounds and corrections", () => {
  it("opens round 2 with only new entries, and carries corrections to round 1 on round 2's ticket (brief 5.15)", async () => {
    const { host, sessionId } = await newSession(db);
    const guest = await addGuest(db, sessionId, "Rafa");
    await add(db, host, { dishName: "Chicken Katsu", quantity: 3 });
    await add(db, host, { dishName: "Iced Tea", quantity: 2 });
    await confirm(host);
    expect(await errorOf(run(guest, (tx, s) => openRound(tx, s, guest)))).toMatchObject({ status: 403 });
    await run(host, (tx, s) => openRound(tx, s, host));
    expect(await errorOf(run(host, (tx, s) => openRound(tx, s, host)))).toMatchObject({ code: "ROUND_OPEN" });

    const snap = await getSnapshot(db, host);
    const [katsu, tea] = snap.entries;
    expect(snap.rounds.map((r) => [r.number, r.status])).toEqual([
      [1, "CONFIRMED"],
      [2, "DRAFT"],
    ]);
    await add(db, guest, { dishName: "Extra Rice", quantity: 3 });
    expect(await errorOf(run(host, (tx, s) => recordCorrection(tx, s, host, { sourceEntryId: katsu.id, type: "QUANTITY", quantity: 4 })))).toMatchObject({ status: 422 });
    expect(await errorOf(run(guest, (tx, s) => recordCorrection(tx, s, guest, { sourceEntryId: katsu.id, type: "QUANTITY", quantity: 1 })))).toMatchObject({ status: 403 });
    await run(host, (tx, s) => recordCorrection(tx, s, host, { sourceEntryId: katsu.id, type: "QUANTITY", quantity: 1 }));
    const replace = await run(host, (tx, s) => recordCorrection(tx, s, host, { sourceEntryId: tea.id, type: "REPLACE", replacement: "Large", explanation: "" }));

    const mid = await getSnapshot(db, host);
    expect(mid.corrections.map((c) => [c.dishName, c.type, c.quantityDelta, c.replacement, c.sourceRoundNumber])).toEqual([
      ["Chicken Katsu", "QUANTITY", -1, null, 1],
      ["Iced Tea", "REPLACE", null, "Large", 1],
    ]);
    // Cancellations add up per dish: 1 of 3 already cancelled, so at most 2 more.
    expect(await errorOf(run(host, (tx, s) => recordCorrection(tx, s, host, { sourceEntryId: katsu.id, type: "QUANTITY", quantity: 3 })))).toMatchObject({ status: 422 });
    await run(host, (tx, s) => removeCorrection(tx, s, host, replace.result.correctionId));
    await confirm(host);
    const done = await getSnapshot(db, host);
    const round2 = done.tickets[done.rounds[1].id];
    expect(round2).toMatchObject({ roundNumber: 2, totalItems: 3, dishes: [{ name: "Extra Rice", quantity: 3 }], corrections: ["Cancel 1 × Chicken Katsu from round 1"] });
    // Round 1's ticket is untouched.
    expect(done.tickets[done.rounds[0].id]).toMatchObject({ totalItems: 5, corrections: [] });
  });
});

describe("database guards", () => {
  it("refuses to reopen a confirmed round or delete its snapshot, but session deletion still cascades", async () => {
    const { host, sessionId } = await newSession(db);
    await add(db, host, { dishName: "Gyoza", quantity: 1 });
    await confirm(host);
    await expect(db.execute(sql`UPDATE rounds SET status = 'DRAFT', confirmed_at = NULL WHERE session_id = ${sessionId}`)).rejects.toThrow();
    await expect(db.delete(confirmedRoundSnapshots)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM order_entries`)).rejects.toThrow();
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    expect(await db.select().from(confirmedRoundSnapshots)).toHaveLength(0);
  });
});

describe("closing", () => {
  it("makes the session read-only; a cancelled order (nothing confirmed) is deleted after a day (brief 5.16)", async () => {
    const { host, sessionId } = await newSession(db);
    const guest = await addGuest(db, sessionId, "Rafa");
    await add(db, host, { dishName: "Gyoza", quantity: 1 });
    expect(await errorOf(run(guest, (tx, s) => closeSession(tx, s, guest)))).toMatchObject({ status: 403 });
    const { result } = await run(host, (tx, s) => closeSession(tx, s, host));
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row.status).toBe("CLOSED");
    expect(row.expiresAt.getTime() - row.closedAt!.getTime()).toBe(CANCELLED_RETENTION_DAYS * 86_400_000);
    expect(result.expiresAt).toBe(row.expiresAt.toISOString());
    expect(await errorOf(add(db, guest, { dishName: "Rice", quantity: 1 }))).toMatchObject({ code: "SESSION_CLOSED" });
    expect(await errorOf(run(host, (tx, s) => closeSession(tx, s, host)))).toMatchObject({ code: "SESSION_CLOSED" });
    // Still readable while it is kept.
    expect((await getSnapshot(db, guest)).session.status).toBe("CLOSED");
  });
});
