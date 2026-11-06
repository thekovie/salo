import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as t from "@/server/db/schema";
import { resetDb, testDb } from "./helpers/db";

const db = testDb();
const later = () => new Date(Date.now() + 86_400_000);

async function seed() {
  const [session] = await db.insert(t.sessions).values({ joinCode: "ABC234", expiresAt: later() }).returning();
  const [host] = await db.insert(t.participants).values({ sessionId: session.id, displayName: "Host", role: "HOST" }).returning();
  const [round] = await db.insert(t.rounds).values({ sessionId: session.id, roundNumber: 1 }).returning();
  const [dish] = await db.insert(t.dishes).values({ sessionId: session.id, canonicalName: "Gyoza", normalizedName: "gyoza" }).returning();
  const [batch] = await db
    .insert(t.orderBatches)
    .values({ sessionId: session.id, roundId: round.id, submittedBy: host.id, attributionType: "UNASSIGNED" })
    .returning();
  return { session, host, round, dish, batch };
}

/** Postgres puts the reason on the driver error, which drizzle wraps as `cause`. */
async function rejects(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected the database to refuse").not.toBeNull();
  const err = error as { message?: string; cause?: { message?: string; constraint_name?: string } };
  expect(`${err.message} ${err.cause?.message ?? ""} ${err.cause?.constraint_name ?? ""}`).toMatch(pattern);
}

beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

describe("database integrity rules", () => {
  it("refuses zero, negative and oversized quantities", async () => {
    const s = await seed();
    const entry = { batchId: s.batch.id, roundId: s.round.id, dishId: s.dish.id };
    for (const quantity of [0, -1, 100]) {
      await rejects(db.insert(t.orderEntries).values({ ...entry, quantity }), /order_entries_quantity_ck/);
    }
    await expect(db.insert(t.orderEntries).values({ ...entry, quantity: 99 })).resolves.toBeDefined();
  });

  it("allows only one draft round and one host per session, and unique round numbers", async () => {
    const s = await seed();
    await rejects(db.insert(t.rounds).values({ sessionId: s.session.id, roundNumber: 2 }), /rounds_one_draft_uq/);
    await rejects(db.insert(t.participants).values({ sessionId: s.session.id, displayName: "Host 2", role: "HOST" }), /participants_one_host_uq/);
    await rejects(
      db.insert(t.rounds).values({ sessionId: s.session.id, roundNumber: 1, status: "CONFIRMED", confirmedAt: new Date() }),
      /rounds_number_uq/,
    );
  });

  it("lets two guests share a display name (identity is the id, not the name)", async () => {
    const s = await seed();
    const guests = await db
      .insert(t.participants)
      .values([
        { sessionId: s.session.id, displayName: "Miguel", role: "GUEST" },
        { sessionId: s.session.id, displayName: "Miguel", role: "GUEST" },
      ])
      .returning();
    expect(new Set(guests.map((g) => g.id)).size).toBe(2);
  });

  it("never lets the session revision go backwards", async () => {
    const s = await seed();
    await db.update(t.sessions).set({ revision: 5 }).where(eq(t.sessions.id, s.session.id));
    await rejects(db.update(t.sessions).set({ revision: 4 }).where(eq(t.sessions.id, s.session.id)), /cannot go backwards/);
  });

  it("freezes a confirmed round: its entries and its snapshot cannot change", async () => {
    const s = await seed();
    const [entry] = await db.insert(t.orderEntries).values({ batchId: s.batch.id, roundId: s.round.id, dishId: s.dish.id, quantity: 2 }).returning();
    await db.update(t.rounds).set({ status: "CONFIRMED", confirmedAt: new Date() }).where(eq(t.rounds.id, s.round.id));
    await rejects(db.update(t.orderEntries).set({ quantity: 3 }).where(eq(t.orderEntries.id, entry.id)), /confirmed round/);
    await rejects(db.insert(t.orderEntries).values({ batchId: s.batch.id, roundId: s.round.id, dishId: s.dish.id, quantity: 1 }), /confirmed round/);

    const [snapshot] = await db.insert(t.confirmedRoundSnapshots).values({ roundId: s.round.id, snapshotRevision: 1, snapshotData: { lines: [] } }).returning();
    await rejects(db.update(t.confirmedRoundSnapshots).set({ snapshotData: {} }).where(eq(t.confirmedRoundSnapshots.id, snapshot.id)), /immutable/);
  });

  it("deletes everything belonging to a session with the session (cleanup is one delete)", async () => {
    const s = await seed();
    await db.insert(t.orderEntries).values({ batchId: s.batch.id, roundId: s.round.id, dishId: s.dish.id, quantity: 1 });
    await db.delete(t.sessions).where(eq(t.sessions.id, s.session.id));
    expect(await db.select().from(t.orderEntries)).toHaveLength(0);
    expect(await db.select().from(t.participants)).toHaveLength(0);
  });
});
