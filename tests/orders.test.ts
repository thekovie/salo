import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { consolidate } from "@/lib/consolidate";
import { resolveActor } from "@/server/auth/actor";
import { rounds, sessionEvents, sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { setEntryRemoved, updateEntry } from "@/server/orders/entries";
import { confirmRound, openRound } from "@/server/orders/rounds";
import { renameSession } from "@/server/sessions/rename";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, addGuest, key, newSession } from "./helpers/session";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

async function errorOf(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (e: { code?: string; status?: number }) => e,
  );
}

describe("session creation", () => {
  it("creates a session with a host, a working host credential and draft Round 1, no details required", async () => {
    const { host, sessionId, token } = await newSession(db);
    expect(host.role).toBe("HOST");
    const snapshot = await getSnapshot(db, host);
    expect(snapshot.session).toMatchObject({ id: sessionId, title: null, status: "OPEN", revision: 1 });
    expect(snapshot.session.joinCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(snapshot.rounds).toEqual([expect.objectContaining({ number: 1, status: "DRAFT" })]);
    expect(snapshot.activeRoundId).toBe(snapshot.rounds[0].id);
    // The raw token is never stored; a wrong token or another session's id resolves to nobody.
    expect(await resolveActor(db, sessionId, token + "x")).toBeNull();
    const other = await newSession(db);
    expect(await resolveActor(db, other.sessionId, token)).toBeNull();
  });
});

describe("entries", () => {
  it("adds unassigned dishes without any participants and consolidates by canonical dish (brief 5.7)", async () => {
    const { host } = await newSession(db);
    await add(db, host, { dishName: "Chicken Katsu", quantity: 2 });
    await add(db, host, { dishName: "  chicken   KATSU ", quantity: 1 });
    await add(db, host, { dishName: "Chicken Cutlet", quantity: 1 });
    const snapshot = await getSnapshot(db, host);
    const result = consolidate(snapshot.entries);
    expect(result.dishes.map((d) => [d.name, d.quantity])).toEqual([
      ["Chicken Katsu", 3],
      ["Chicken Cutlet", 1],
    ]);
    expect(snapshot.dishNames).toEqual(["Chicken Cutlet", "Chicken Katsu"]);
    expect(snapshot.session.revision).toBe(4);
  });

  it("records optional attribution: a typed name, the whole table, or a group label", async () => {
    const { host } = await newSession(db);
    await add(db, host, { dishName: "Gyoza", quantity: 1, attribution: { type: "INDIVIDUAL", label: "Miguel" } });
    await add(db, host, { dishName: "Rice", quantity: 3, attribution: { type: "TABLE" } });
    await add(db, host, { dishName: "Tea", quantity: 3, attribution: { type: "GROUP", label: "Miguel's group" } });
    const { entries } = await getSnapshot(db, host);
    expect(entries.map((e) => e.attribution)).toEqual([
      { type: "INDIVIDUAL", label: "Miguel", participantId: null },
      { type: "TABLE", label: null, participantId: null },
      { type: "GROUP", label: "Miguel's group", participantId: null },
    ]);
  });

  it("applies a retried mutation once (same idempotency key)", async () => {
    const { host } = await newSession(db);
    const k = key();
    const first = await add(db, host, { dishName: "Gyoza", quantity: 3 }, k);
    const retry = await add(db, host, { dishName: "Gyoza", quantity: 3 }, k);
    expect(retry).toEqual({ ...first, replayed: true });
    const { entries, session } = await getSnapshot(db, host);
    expect(entries).toHaveLength(1);
    expect(session.revision).toBe(2);
  });

  it("keeps exact totals under concurrent adds, with one event per committed revision", async () => {
    const { host, sessionId } = await newSession(db);
    await Promise.all(Array.from({ length: 12 }, () => add(db, host, { dishName: "Iced Tea", quantity: 2 })));
    const { entries, session } = await getSnapshot(db, host);
    expect(consolidate(entries).totalItems).toBe(24);
    expect(session.revision).toBe(13);
    const events = await db.select({ revision: sessionEvents.revision }).from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId));
    expect(events.map((e) => e.revision).sort((a, b) => a - b)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
  });

  it("keeps exact totals with 20 people adding at the same moment (brief 14)", async () => {
    const { host, sessionId } = await newSession(db);
    const guests = await Promise.all(Array.from({ length: 19 }, (_, i) => addGuest(db, sessionId, `Guest ${i + 1}`)));
    await Promise.all([host, ...guests].map((actor) => add(db, actor, { dishName: "Chicken Katsu", quantity: 2, attribution: { type: "INDIVIDUAL" } })));
    const { entries, session } = await getSnapshot(db, host);
    expect(consolidate(entries).totalItems).toBe(40);
    expect(session.revision).toBe(21);
  });

  it("updates with optimistic locking and refuses a stale revision", async () => {
    const { host } = await newSession(db);
    const { result } = await add(db, host, { dishName: "Gyoza", quantity: 1 });
    const update = (expectedRevision: number, quantity: number) =>
      runMutation(db, host, { idempotencyKey: key(), type: "entry.update" }, (tx, s) => updateEntry(tx, s, host, result.entryId, { expectedRevision, quantity }));
    expect((await update(1, 4)).result.revision).toBe(2);
    expect(await errorOf(update(1, 5))).toMatchObject({ status: 409, code: "CONFLICT" });
    const { entries } = await getSnapshot(db, host);
    expect(entries[0].quantity).toBe(4);
  });

  it("removes reversibly: a removed entry leaves the totals and Undo brings it back", async () => {
    const { host } = await newSession(db);
    const { result } = await add(db, host, { dishName: "Gyoza", quantity: 2 });
    const toggle = (removed: boolean) => runMutation(db, host, { idempotencyKey: key(), type: "x" }, (tx, s) => setEntryRemoved(tx, s, host, result.entryId, removed));
    await toggle(true);
    expect((await getSnapshot(db, host)).entries).toHaveLength(0);
    await toggle(false);
    expect((await getSnapshot(db, host)).entries.map((e) => e.quantity)).toEqual([2]);
  });

  it("lets guests change only their own entries, and only the host rename the order", async () => {
    const { host, sessionId } = await newSession(db);
    const guest = await addGuest(db, sessionId, "Rafa");
    const hostEntry = await add(db, host, { dishName: "Gyoza", quantity: 1 });
    const guestEntry = await add(db, guest, { dishName: "Ramen", quantity: 1 });
    const edit = (actor: typeof host, entryId: string) =>
      runMutation(db, actor, { idempotencyKey: key(), type: "x" }, (tx, s) => updateEntry(tx, s, actor, entryId, { expectedRevision: 1, quantity: 2 }));
    expect(await errorOf(edit(guest, hostEntry.result.entryId))).toMatchObject({ status: 403 });
    await expect(edit(guest, guestEntry.result.entryId)).resolves.toBeDefined();
    await expect(edit(host, hostEntry.result.entryId)).resolves.toBeDefined();
    expect(await errorOf(runMutation(db, guest, { idempotencyKey: key(), type: "x" }, (tx, s) => renameSession(tx, s, guest, "Mine")))).toMatchObject({ status: 403 });
    // A guest's own INDIVIDUAL entry defaults to themselves.
    await add(db, guest, { dishName: "Tea", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    const { entries } = await getSnapshot(db, host);
    expect(entries.at(-1)?.attribution).toEqual({ type: "INDIVIDUAL", label: null, participantId: guest.participantId });
  });

  it("refuses entries from another session's id and changes to a confirmed round", async () => {
    const a = await newSession(db);
    const b = await newSession(db);
    const { result } = await add(db, a.host, { dishName: "Gyoza", quantity: 1 });
    const crossSession = runMutation(db, b.host, { idempotencyKey: key(), type: "x" }, (tx, s) => setEntryRemoved(tx, s, b.host, result.entryId, true));
    expect(await errorOf(crossSession)).toMatchObject({ status: 404 });

    await db.update(rounds).set({ status: "CONFIRMED", confirmedAt: new Date() }).where(eq(rounds.sessionId, a.sessionId));
    const confirmed = runMutation(db, a.host, { idempotencyKey: key(), type: "x" }, (tx, s) => setEntryRemoved(tx, s, a.host, result.entryId, true));
    expect(await errorOf(confirmed)).toMatchObject({ status: 409, code: "ROUND_CONFIRMED" });
    expect(await errorOf(add(db, a.host, { dishName: "Rice", quantity: 1 }))).toMatchObject({ code: "NO_OPEN_ROUND" });
  });

  it("refuses every change once the session is closed", async () => {
    const { host, sessionId } = await newSession(db);
    await db.update(sessions).set({ status: "CLOSED", closedAt: new Date() }).where(eq(sessions.id, sessionId));
    expect(await errorOf(add(db, host, { dishName: "Rice", quantity: 1 }))).toMatchObject({ status: 409, code: "SESSION_CLOSED" });
  });

  it("treats removing a removed entry (or restoring an active one) as a no-op that keeps its revision", async () => {
    const { host } = await newSession(db);
    const { result } = await add(db, host, { dishName: "Gyoza", quantity: 1 });
    const toggle = (removed: boolean) => runMutation(db, host, { idempotencyKey: key(), type: "x" }, (tx, s) => setEntryRemoved(tx, s, host, result.entryId, removed));
    expect((await toggle(false)).result.revision).toBe(1);
    expect((await toggle(true)).result.revision).toBe(2);
    expect((await toggle(true)).result.revision).toBe(2);
  });

  it("refuses an idempotency key reused for a different kind of change", async () => {
    const { host } = await newSession(db);
    const k = key();
    const { result } = await add(db, host, { dishName: "Gyoza", quantity: 1 }, k);
    const reuse = runMutation(db, host, { idempotencyKey: k, type: "entry.remove" }, (tx, s) => setEntryRemoved(tx, s, host, result.entryId, true));
    expect(await errorOf(reuse)).toMatchObject({ status: 422, code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("validates input at the boundary", async () => {
    const { host } = await newSession(db);
    for (const bad of [{ dishName: "", quantity: 1 }, { dishName: "x", quantity: 0 }, { dishName: "x", quantity: 100 }, { dishName: "x".repeat(61), quantity: 1 }, { dishName: "Gyo\u0000za", quantity: 1 }]) {
      expect(() => add(db, host, bad)).toThrow();
    }
  });
});

describe("adds carry their round (finding 1)", () => {
  it("refuses an add aimed at a round that was confirmed meanwhile, and accepts the current round", async () => {
    const { host } = await newSession(db);
    const first = await getSnapshot(db, host);
    await add(db, host, { dishName: "Gyoza", quantity: 1, roundId: first.activeRoundId });
    await runMutation(db, host, { idempotencyKey: key(), type: "t" }, (tx, s) => confirmRound(tx, s, host, first.activeRoundId, s.revision));
    await runMutation(db, host, { idempotencyKey: key(), type: "t" }, (tx, s) => openRound(tx, s, host));
    const stale = await add(db, host, { dishName: "Rice", quantity: 1, roundId: first.activeRoundId }).then(
      () => null,
      (e: { code?: string; status?: number }) => e,
    );
    expect(stale).toMatchObject({ status: 409, code: "ROUND_CLOSED" });
    const second = await getSnapshot(db, host);
    await add(db, host, { dishName: "Rice", quantity: 1, roundId: second.activeRoundId });
    expect((await getSnapshot(db, host)).entries.filter((e) => e.roundId === second.activeRoundId).map((e) => e.dishName)).toEqual(["Rice"]);
  });
});

describe("editing a draft dish (finding 6)", () => {
  it("changes who it's for, size and notes; resets readiness; refused once confirmed", async () => {
    const { host, sessionId } = await newSession(db);
    const jd = await addGuest(db, sessionId, "JD");
    const { result } = await add(db, host, { dishName: "Halo-halo", quantity: 1 });
    const edit = (input: Record<string, unknown>) =>
      runMutation(db, host, { idempotencyKey: key(), type: "t" }, async (tx, s) => {
        const [e] = (await getSnapshot(db, host)).entries.filter((x) => x.id === result.entryId);
        return updateEntry(tx, s, host, result.entryId, { expectedRevision: e.revision, ...input } as Parameters<typeof updateEntry>[4]);
      });
    await edit({ variant: "Large", instructions: "Less ice", attribution: { type: "INDIVIDUAL", participantId: jd.participantId } });
    let [entry] = (await getSnapshot(db, host)).entries;
    expect(entry).toMatchObject({ variant: "Large", instructions: "Less ice", attribution: { type: "INDIVIDUAL", participantId: jd.participantId } });
    expect(entry.submittedBy).toBe(host.participantId); // edit rights stay with whoever added it
    await edit({ attribution: { type: "TABLE" } });
    [entry] = (await getSnapshot(db, host)).entries;
    expect(entry.attribution).toMatchObject({ type: "TABLE", participantId: null });

    const snap = await getSnapshot(db, host);
    await runMutation(db, host, { idempotencyKey: key(), type: "t" }, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, s.revision));
    const refused = await edit({ attribution: { type: "UNASSIGNED" } }).then(
      () => null,
      (e: { code?: string }) => e,
    );
    expect(refused).toMatchObject({ code: "ROUND_CONFIRMED" });
  });
});
