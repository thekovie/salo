import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions";
import { runMutation } from "@/server/mutations";
import { setEntryRemoved } from "@/server/orders/entries";
import { requestClaim, resolveClaim, setGroupMembers, setReady } from "@/server/orders/people";
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

describe("readiness", () => {
  it("is per round and resets when the person changes their order afterwards", async () => {
    const { host, sessionId } = await newSession(db);
    const rafa = await addGuest(db, sessionId, "Rafa");
    const { result } = await add(db, rafa, { dishName: "Gyoza", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await run(rafa, (tx, s) => setReady(tx, s, rafa, true));
    expect((await getSnapshot(db, host)).readiness).toEqual([{ participantId: rafa.participantId, ready: true }]);
    // Someone else's change does not touch Rafa's readiness; Rafa's own change does.
    await add(db, host, { dishName: "Rice", quantity: 1 });
    expect((await getSnapshot(db, host)).readiness[0].ready).toBe(true);
    await run(rafa, (tx, s) => setEntryRemoved(tx, s, rafa, result.entryId, true));
    expect((await getSnapshot(db, host)).readiness[0].ready).toBe(false);
  });

  it("also resets when the host changes or adds a dish for that person", async () => {
    const { host, sessionId } = await newSession(db);
    const rafa = await addGuest(db, sessionId, "Rafa");
    await run(rafa, (tx, s) => setReady(tx, s, rafa, true));
    await add(db, host, { dishName: "Gyoza", quantity: 1, attribution: { type: "INDIVIDUAL", participantId: rafa.participantId } });
    expect((await getSnapshot(db, host)).readiness[0].ready).toBe(false);
  });
});

describe("claims", () => {
  it("lets a guest claim a dish the host recorded for them by name, and the host approve it", async () => {
    const { host, sessionId } = await newSession(db);
    const rafa = await addGuest(db, sessionId, "Rafa");
    await add(db, host, { dishName: "Chicken Katsu", quantity: 1, attribution: { type: "INDIVIDUAL", label: "Rafa" } });
    const entry = (await getSnapshot(db, host)).entries[0];
    const { result } = await run(rafa, (tx, s) => requestClaim(tx, s, rafa, entry.batchId));
    expect((await getSnapshot(db, host)).claims).toEqual([expect.objectContaining({ id: result.claimId, requestedBy: rafa.participantId })]);
    // Nothing changes until the host answers.
    expect((await getSnapshot(db, host)).entries[0].submittedBy).toBe(host.participantId);
    expect(await errorOf(run(rafa, (tx, s) => resolveClaim(tx, s, rafa, result.claimId, true)))).toMatchObject({ status: 403 });

    await run(host, (tx, s) => resolveClaim(tx, s, host, result.claimId, true));
    const after = await getSnapshot(db, host);
    expect(after.claims).toEqual([]);
    expect(after.entries[0]).toMatchObject({ submittedBy: rafa.participantId, attribution: { type: "INDIVIDUAL", label: null, participantId: rafa.participantId } });
    expect(await errorOf(run(host, (tx, s) => resolveClaim(tx, s, host, result.claimId, false)))).toMatchObject({ code: "CLAIM_RESOLVED" });
  });

  it("declining leaves the dish with the host; duplicates and other guests' dishes cannot be claimed", async () => {
    const { host, sessionId } = await newSession(db);
    const rafa = await addGuest(db, sessionId, "Rafa");
    const jd = await addGuest(db, sessionId, "JD");
    await add(db, host, { dishName: "Gyoza", quantity: 1 });
    await add(db, jd, { dishName: "Ramen", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await add(db, host, { dishName: "Tea", quantity: 1, attribution: { type: "INDIVIDUAL", participantId: jd.participantId } });
    const [gyoza, ramen, tea] = (await getSnapshot(db, host)).entries;

    const { result } = await run(rafa, (tx, s) => requestClaim(tx, s, rafa, gyoza.batchId));
    expect(await errorOf(run(rafa, (tx, s) => requestClaim(tx, s, rafa, gyoza.batchId)))).toMatchObject({ code: "CLAIM_PENDING" });
    await run(host, (tx, s) => resolveClaim(tx, s, host, result.claimId, false));
    expect((await getSnapshot(db, host)).entries[0].submittedBy).toBe(host.participantId);

    expect(await errorOf(run(rafa, (tx, s) => requestClaim(tx, s, rafa, ramen.batchId)))).toMatchObject({ status: 403 });
    expect(await errorOf(run(rafa, (tx, s) => requestClaim(tx, s, rafa, tea.batchId)))).toMatchObject({ status: 403 });
    expect(await errorOf(run(host, (tx, s) => requestClaim(tx, s, host, gyoza.batchId)))).toMatchObject({ status: 403 });
  });
});

describe("claim edge cases", () => {
  it("refuses to approve a claim on a removed dish or one now marked for someone else", async () => {
    const { host, sessionId } = await newSession(db);
    const rafa = await addGuest(db, sessionId, "Rafa");
    const jd = await addGuest(db, sessionId, "JD");
    await add(db, host, { dishName: "Gyoza", quantity: 1 });
    await add(db, host, { dishName: "Rice", quantity: 1 });
    const [gyoza, rice] = (await getSnapshot(db, host)).entries;
    const c1 = await run(rafa, (tx, s) => requestClaim(tx, s, rafa, gyoza.batchId));
    const c2 = await run(rafa, (tx, s) => requestClaim(tx, s, rafa, rice.batchId));
    await run(host, (tx, s) => setEntryRemoved(tx, s, host, gyoza.id, true));
    expect(await errorOf(run(host, (tx, s) => resolveClaim(tx, s, host, c1.result.claimId, true)))).toMatchObject({ code: "ENTRY_REMOVED" });
    await db.execute(sql`UPDATE order_batches SET attribution_type = 'INDIVIDUAL', attributed_participant_id = ${jd.participantId} WHERE id = ${rice.batchId}`);
    expect(await errorOf(run(host, (tx, s) => resolveClaim(tx, s, host, c2.result.claimId, true)))).toMatchObject({ code: "CLAIM_STALE" });
  });
});

describe("groups", () => {
  it("records a label with optional members and replaces the member list on update", async () => {
    const { host, sessionId } = await newSession(db);
    const rafa = await addGuest(db, sessionId, "Rafa");
    const jd = await addGuest(db, sessionId, "JD");
    await run(host, (tx, s) => setGroupMembers(tx, s, host, "Miguel's group", [rafa.participantId, jd.participantId]));
    await run(host, (tx, s) => setGroupMembers(tx, s, host, "miguel's  GROUP", [jd.participantId]));
    expect((await getSnapshot(db, host)).groups).toEqual([expect.objectContaining({ label: "Miguel's group", memberIds: [jd.participantId] })]);
    // A guest cannot overwrite members the host set; the cap stops label spam.
    expect(await errorOf(run(rafa, (tx, s) => setGroupMembers(tx, s, rafa, "Miguel's group", [])))).toMatchObject({ status: 403 });
    await expect(run(rafa, (tx, s) => setGroupMembers(tx, s, rafa, "Rafa's group", [rafa.participantId]))).resolves.toBeDefined();
    const other = await newSession(db);
    expect(await errorOf(run(host, (tx, s) => setGroupMembers(tx, s, host, "X", [other.host.participantId])))).toMatchObject({ code: "UNKNOWN_PERSON" });
  });
});
