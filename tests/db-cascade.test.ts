import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions";
import { orderEntries, servedCounts, sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { setAdjustment } from "@/server/orders/adjustments";
import { setGroupMembers, setReady, requestClaim } from "@/server/orders/people";
import { recordPayment } from "@/server/orders/payments";
import { setReceipt } from "@/server/orders/receipts";
import { confirmRound, openRound, recordCorrection } from "@/server/orders/rounds";
import { setCorrectionPrice, setEntrySettlement, setReceiptTotal, setServiceCharge, setSharedPrice } from "@/server/orders/settlement";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, addGuest, key, newSession } from "./helpers/session";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const rows = async <T extends object>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];
const publicTables = async () => (await rows<{ name: string }>(sql`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).map((r) => r.name);

describe("session cleanup reaches every table", () => {
  it("every public table except sessions has a chain of ON DELETE CASCADE foreign keys up to sessions", async () => {
    const edges = await rows<{ child: string; parent: string }>(sql`
      SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'f' AND c.confdeltype = 'c' AND n.nspname = 'public'`);
    const reaches = new Set(["sessions"]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const { child, parent } of edges) if (reaches.has(parent) && !reaches.has(child)) grew = reaches.add(child).size > 0;
    }
    const tables = await publicTables();
    expect(tables).toContain("sessions");
    expect(tables.filter((t) => !reaches.has(t))).toEqual([]);
  });

  it("deleting a session removes its rows from every table, money tables included", async () => {
    const { host, sessionId } = await newSession(db);
    const guest = await addGuest(db, sessionId, "Rafa");
    const claimer = await addGuest(db, sessionId, "Liza");
    const run = <T>(actor: Actor, type: string, apply: Parameters<typeof runMutation<T>>[3]) => runMutation(db, actor, { idempotencyKey: key(), type }, apply);
    const id = () => crypto.randomUUID();

    const shared = (await add(db, host, { dishName: "Platter", quantity: 2, attribution: { type: "UNASSIGNED" } })).result.entryId;
    const own = (await add(db, host, { dishName: "Rice", quantity: 1, attribution: { type: "INDIVIDUAL", participantId: guest.participantId } })).result.entryId;
    const [{ dishId }] = await db.select({ dishId: orderEntries.dishId }).from(orderEntries).where(eq(orderEntries.id, shared));
    await run(host, "g", (tx, s) => setGroupMembers(tx, s, host, "Barkada", [guest.participantId]));
    await run(guest, "r", (tx, s) => setReady(tx, s, guest, true));
    await run(host, "p", (tx, s) => setSharedPrice(tx, s, host, { dishId, variant: null, unitCentavos: 25000, expectedRevision: 0 }));
    await run(host, "e", (tx, s) => setEntrySettlement(tx, s, host, shared, { expectedRevision: 0, unitPriceCentavos: 30000, splitAmong: [{ participantId: host.participantId }, { participantId: guest.participantId }] }));
    await run(host, "e", (tx, s) => setEntrySettlement(tx, s, host, own, { expectedRevision: 0, unitPriceCentavos: 12000 }));
    const snap = await getSnapshot(db, host);
    await run(host, "c", (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, snap.session.revision));
    await run(host, "o", (tx, s) => openRound(tx, s, host));
    const claimable = (await add(db, host, { dishName: "Soup", quantity: 1, attribution: { type: "UNASSIGNED" } })).result.entryId;
    const [{ batchId }] = await db.select({ batchId: orderEntries.batchId }).from(orderEntries).where(eq(orderEntries.id, claimable));
    await run(claimer, "claim", (tx, s) => requestClaim(tx, s, claimer, batchId));
    const correction = (await run(host, "cr", (tx, s) => recordCorrection(tx, s, host, { sourceEntryId: shared, type: "REPLACE", replacement: "Big platter" }))).result.correctionId;
    await run(host, "cp", (tx, s) => setCorrectionPrice(tx, s, host, correction, { expectedRevision: 0, unitPriceCentavos: 20000 }));
    await run(host, "sc", (tx, s) => setServiceCharge(tx, s, host, { expectedRevision: 0, centavos: 5000 }));
    await run(host, "rt", (tx, s) => setReceiptTotal(tx, s, host, { expectedRevision: 0, centavos: 90000 }));
    await run(host, "a", (tx, s) => setAdjustment(tx, s, host, id(), { expectedRevision: 0, direction: "discount", category: "senior", amountCentavos: 1000, method: "individual", shares: [{ participantId: guest.participantId }] }));
    await run(host, "rc", (tx, s) => setReceipt(tx, s, host, id(), { expectedRevision: 0, totalCentavos: null, people: [{ participantId: guest.participantId }] }));
    await run(host, "pay", (tx, s) => recordPayment(tx, s, host, id(), { payer: { participantId: guest.participantId }, payee: null, amountCentavos: 5000, method: "cash" }));
    const confirmedRound = snap.activeRoundId;
    await db.insert(servedCounts).values({ sessionId, roundId: confirmedRound, lineKey: "line", served: 1 });

    const mustHave = ["adjustments", "adjustment_shares", "payments", "receipts", "receipt_people", "entry_settlements", "correction_settlements", "shared_prices", "entry_payers", "served_counts", "notifications", "entry_claims", "order_corrections", "order_groups", "order_group_members", "confirmed_round_snapshots", "mutation_records", "session_events", "participant_round_readiness"];
    const count = async (table: string) => Number((await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`))[0].n);
    for (const table of mustHave) expect(await count(table), `${table} should have rows before the delete`).toBeGreaterThan(0);

    await db.delete(sessions).where(eq(sessions.id, sessionId));
    const left: string[] = [];
    for (const table of await publicTables()) if ((await count(table)) > 0) left.push(table);
    expect(left).toEqual([]);
  });
});
