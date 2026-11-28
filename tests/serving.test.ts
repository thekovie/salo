import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions";
import { trackerLines } from "@/lib/serving";
import { rounds, servedCounts, sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { confirmRound, openRound, recordCorrections } from "@/server/orders/rounds";
import { updateServed } from "@/server/orders/serving";
import { NON_TICKET_EVENTS } from "@/server/orders/settlement";
import { correctionBatchSchema, servingSchema } from "@/server/orders/validation";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, addGuest, key, newSession, storedServed } from "./helpers/session";

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
const batch = (a: Actor, body: Record<string, unknown>) => run(a, (tx, s) => recordCorrections(tx, s, a, correctionBatchSchema.parse(body)));
const serve = async (a: Actor, roundId: string, lineKey: string, delta: number, idem = key(), seen?: number) => {
  const expectedServed = seen ?? (await storedServed(db, a.sessionId, roundId, lineKey));
  return run(a, (tx, s) => updateServed(tx, s, a, servingSchema.parse({ roundId, lineKey, delta, expectedServed })), idem, "serving.update");
};

async function table() {
  const { host, sessionId } = await newSession(db);
  const guest = await addGuest(db, sessionId, "Miguel");
  await add(db, host, { dishName: "Chicken Katsu", quantity: 2, attribution: { type: "INDIVIDUAL" } });
  await add(db, guest, { dishName: "Chicken Katsu", quantity: 3, attribution: { type: "INDIVIDUAL" } });
  await add(db, host, { dishName: "Gyoza", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  await confirm(host);
  const snap = await getSnapshot(db, host);
  return { host, guest, sessionId, roundId: snap.rounds[0].id, snap };
}
const lines = async (a: Actor) => trackerLines(await getSnapshot(db, a)).rounds.flatMap((r) => r.lines);
const katsu = async (a: Actor) => (await lines(a)).find((l) => l.label === "Chicken Katsu")!;

describe("food tracker", () => {
  it("expected = confirmed quantity per line, with who it is for; hidden before a confirm", async () => {
    const { host, sessionId } = await newSession(db);
    await add(db, host, { dishName: "Gyoza", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    expect(await lines(host)).toEqual([]);
    expect((await getSnapshot(db, host)).servedCounts).toEqual([]);
    const t = await table();
    const k = await katsu(t.host);
    expect(k).toMatchObject({ expected: 5, served: 0, shown: 0 });
    expect(k.people).toContain("Miguel ×3");
    expect(sessionId).toBeTruthy();
  });

  it("clamps at 0 and at expected, and shows min(served, expected)", async () => {
    const { host, roundId } = await table();
    const { key: line } = await katsu(host);
    expect((await serve(host, roundId, line, -3)).result.served).toBe(0);
    expect((await serve(host, roundId, line, 3)).result.served).toBe(3);
    expect((await serve(host, roundId, line, 99)).result.served).toBe(5);
    expect(await katsu(host)).toMatchObject({ served: 5, shown: 5 });
    expect((await serve(host, roundId, line, -2)).result.served).toBe(3);
  });

  it("racing taps that all saw the same count land once, never past expected", async () => {
    const { host, roundId } = await table();
    const { key: line } = await katsu(host);
    await Promise.all([serve(host, roundId, line, 2, key(), 0), serve(host, roundId, line, 2, key(), 0), serve(host, roundId, line, 2, key(), 0)]);
    expect((await katsu(host)).served).toBe(2);
  });

  it("an idempotent retry counts once", async () => {
    const { host, roundId } = await table();
    const { key: line } = await katsu(host);
    const idem = key();
    await serve(host, roundId, line, 2, idem);
    const again = await serve(host, roundId, line, 2, idem);
    expect(again.replayed).toBe(true);
    expect((await katsu(host)).served).toBe(2);
  });

  it("only the host may serve; draft rounds and unknown lines are refused", async () => {
    const { host, guest, roundId } = await table();
    const { key: line } = await katsu(host);
    expect(await errorOf(serve(guest, roundId, line, 1))).toMatchObject({ status: 403 });
    expect(await errorOf(serve(host, roundId, "nope", 1))).toMatchObject({ code: "LINE_NOT_FOUND" });
    await open(host);
    const draft = (await getSnapshot(db, host)).activeRoundId;
    expect(await errorOf(serve(host, draft, line, 1))).toMatchObject({ code: "ROUND_NOT_CONFIRMED" });
  });

  it("a serving update never stales the host's confirm", async () => {
    const { host, roundId } = await table();
    const { key: line } = await katsu(host);
    await open(host);
    await add(db, host, { dishName: "Halo-halo", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    const seen = (await getSnapshot(db, host)).session.revision;
    await serve(host, roundId, line, 1);
    expect(NON_TICKET_EVENTS).toEqual(expect.arrayContaining(["serving.updated", "receipt.set", "receipt.removed"]));
    const snap = await getSnapshot(db, host);
    await expect(run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, seen))).resolves.toBeTruthy();
  });

  it("pending cancels are ignored; a told cancel lowers expected and keeps the raw count with a notice", async () => {
    const { host, roundId, snap } = await table();
    const { key: line } = await katsu(host);
    await serve(host, roundId, line, 5);
    await open(host);
    const mine = snap.entries.find((e) => e.dishName === "Chicken Katsu" && e.quantity === 3)!;
    await batch(host, { entries: [{ sourceEntryId: mine.id, quantity: 2 }], type: "QUANTITY" });
    expect(await katsu(host)).toMatchObject({ expected: 5, shown: 5, cancelledSince: 0 });
    await confirm(host);
    expect(await katsu(host)).toMatchObject({ expected: 3, served: 5, shown: 3, cancelledSince: 2 });
    expect((await serve(host, roundId, line, -1, key(), 3)).result.served).toBe(2);
  });

  it("a told replacement is its own line starting at 0", async () => {
    const { host, roundId, snap } = await table();
    const gyoza = snap.entries.find((e) => e.dishName === "Gyoza")!;
    await open(host);
    await batch(host, { entries: [{ sourceEntryId: gyoza.id }], type: "REPLACE", replacement: "Dumplings" });
    await confirm(host);
    const all = await lines(host);
    expect(all.find((l) => l.label === "Gyoza")).toBeUndefined();
    const swap = all.find((l) => l.label === "Dumplings")!;
    expect(swap).toMatchObject({ expected: 1, shown: 0 });
    expect((await serve(host, roundId, swap.key, 1)).result.served).toBe(1);
  });

  it("D21: a dish replaced after some was served keeps a read-only history row and the replacement only waits for the rest", async () => {
    const { host, roundId, snap } = await table();
    const { key: line } = await katsu(host);
    await serve(host, roundId, line, 2);
    await open(host);
    const ids = snap.entries.filter((e) => e.dishName === "Chicken Katsu").map((e) => ({ sourceEntryId: e.id }));
    await batch(host, { entries: ids, type: "REPLACE", replacement: "Pork Katsu" });
    await confirm(host);
    const all = await lines(host);
    expect(all.find((l) => l.key === line)).toMatchObject({ label: "Chicken Katsu", history: true, served: 2, shown: 2, expected: 2 });
    const swap = all.find((l) => l.label === "Pork Katsu")!;
    expect(swap).toMatchObject({ expected: 3, shown: 0 });
    expect((await serve(host, roundId, swap.key, 99)).result.served).toBe(3);
    expect(await errorOf(serve(host, roundId, line, 1))).toMatchObject({ code: "LINE_NOT_FOUND" });
    const t = trackerLines(await getSnapshot(db, host));
    expect(t.expected - t.served).toBe(1);
  });

  it("deleting the session removes its counts; the DB refuses a round from another session", async () => {
    const { host, roundId, sessionId } = await table();
    const { key: line } = await katsu(host);
    await serve(host, roundId, line, 1);
    const other = await newSession(db);
    await expect(db.insert(servedCounts).values({ sessionId: other.sessionId, roundId, lineKey: "x", served: 1 })).rejects.toThrow();
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    expect(await db.select().from(servedCounts)).toHaveLength(0);
    expect(await db.select().from(rounds).where(eq(rounds.id, roundId))).toHaveLength(0);
    expect(other.host).toBeTruthy();
  });
});
