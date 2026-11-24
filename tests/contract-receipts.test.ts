/**
 * Contract tests for slice 4 (docs/plans/salo-v1-4.md): extra receipts and shared-dish splits.
 * Golden contract: docs/contracts/receipts.md. Real route handlers, real Postgres, faked cookie jar.
 * Run: pnpm vitest run tests/contract-receipts.test.ts
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { PUT as ENTRY_SETTLEMENT } from "@/app/api/sessions/[id]/entries/[entryId]/settlement/route";
import { DELETE, PUT } from "@/app/api/sessions/[id]/receipts/[receiptId]/route";
import type { Actor } from "@/lib/permissions";
import { credentialCookieName, hashToken, newToken } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { entryPayers, participantCredentials, participants, receiptPeople, sessionEvents } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { removeParticipant, requestClaim, resolveClaim } from "@/server/orders/people";
import { closeSession, confirmRound } from "@/server/orders/rounds";
import { NON_TICKET_EVENTS } from "@/server/orders/settlement";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, key, newSession } from "./helpers/session";

const db = testDb();
beforeEach(async () => {
  jar.cookies = {};
  await resetDb(db);
});
afterAll(async () => {
  await db.$client.end();
  await getDb().$client.end();
});

type Who = { actor: Actor; token: string };
type Envelope = { data?: { result: Record<string, unknown>; replayed: boolean }; error?: { code: string } };
type Ctx = { params: Promise<Record<string, string>> };

async function send(route: unknown, method: string, sessionId: string, params: Record<string, string>, who: Who, body: unknown, idem: string = key()) {
  jar.cookies = { [credentialCookieName(sessionId)]: who.token };
  const req = new Request("http://localhost:3000/api/x", { method, headers: { "content-type": "application/json", origin: "http://localhost:3000", "idempotency-key": idem }, body: JSON.stringify(body) });
  const res = await (route as (r: Request, c: Ctx) => Promise<Response>)(req, { params: Promise.resolve({ id: sessionId, ...params }) });
  return { status: res.status, body: (await res.json()) as Envelope };
}
const put = (t: Scene, id: string, who: Who, body: unknown, idem?: string) => send(PUT, "PUT", t.sessionId, { receiptId: id }, who, body, idem);
const del = (t: Scene, id: string, who: Who, body: unknown) => send(DELETE, "DELETE", t.sessionId, { receiptId: id }, who, body);
const split = (t: Scene, entryId: string, who: Who, body: unknown) => send(ENTRY_SETTLEMENT, "PUT", t.sessionId, { entryId }, who, body);
const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3]) => runMutation(db, actor, { idempotencyKey: key(), type: "t" }, apply);

async function guest(sessionId: string, name: string): Promise<Who> {
  const token = newToken();
  const [row] = await db.insert(participants).values({ sessionId, displayName: name, role: "GUEST" }).returning();
  await db.insert(participantCredentials).values({ sessionId, participantId: row.id, credentialType: "GUEST", credentialHash: hashToken(token) });
  return { actor: { participantId: row.id, sessionId, role: "GUEST", displayName: name }, token };
}

/** Host, Ana and Bo (a guest each with a dish) and a shared Crispy Pata. */
async function setup() {
  const s = await newSession(db);
  const ana = await guest(s.sessionId, "Ana");
  const bo = await guest(s.sessionId, "Bo");
  await add(db, ana.actor, { dishName: "Rice", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  await add(db, bo.actor, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  const pata = await add(db, s.host, { dishName: "Crispy Pata", quantity: 1, attribution: { type: "TABLE" } });
  return { ...s, host: { actor: s.host, token: s.token } as Who, ana, bo, pata: pata.result.entryId as string };
}
type Scene = Awaited<ReturnType<typeof setup>>;
const id = () => crypto.randomUUID();
const ref = (w: Who) => ({ participantId: w.actor.participantId });
const receiptBody = (people: unknown[], over: Record<string, unknown> = {}) => ({ expectedRevision: 0, label: "Senior citizen receipt", totalCentavos: 51300, people, ...over });
const receiptsOf = async (t: Scene) => (await getSnapshot(db, t.host.actor)).settlement.receipts;

async function confirm(t: Scene) {
  const snap = await getSnapshot(db, t.host.actor);
  await run(t.host.actor, (tx, s) => confirmRound(tx, s, t.host.actor, snap.activeRoundId, snap.session.revision));
}

describe("PUT/DELETE /receipts/:receiptId", () => {
  it("host creates, edits and deletes; the snapshot shows it to everyone", async () => {
    const t = await setup();
    const rid = id();
    const created = await put(t, rid, t.host, receiptBody([ref(t.ana)]));
    expect(created.status).toBe(200);
    expect(created.body.data?.result).toEqual({ receiptId: rid, revision: 1 });
    expect((await getSnapshot(db, t.bo.actor)).settlement.receipts).toEqual([{ id: rid, label: "Senior citizen receipt", totalCentavos: 51300, people: [{ participantId: t.ana.actor.participantId, label: null }], revision: 1 }]);
    expect((await put(t, rid, t.host, receiptBody([ref(t.ana), ref(t.bo)], { expectedRevision: 1, label: null, totalCentavos: null }))).status).toBe(200);
    expect(await receiptsOf(t)).toEqual([expect.objectContaining({ label: null, totalCentavos: null, revision: 2 })]);
    expect((await del(t, rid, t.host, { expectedRevision: 2 })).status).toBe(200);
    expect(await receiptsOf(t)).toEqual([]);
    expect((await del(t, rid, t.host, { expectedRevision: 2 })).status).toBe(404);
  });

  it("a guest gets 403; a stale revision gets 409; replaying a key applies once", async () => {
    const t = await setup();
    const rid = id();
    expect((await put(t, rid, t.ana, receiptBody([ref(t.ana)]))).status).toBe(403);
    const idem = key();
    expect((await put(t, rid, t.host, receiptBody([ref(t.ana)]), idem)).body.data?.replayed).toBe(false);
    expect((await put(t, rid, t.host, receiptBody([ref(t.ana)]), idem)).body.data?.replayed).toBe(true);
    expect((await put(t, rid, t.host, receiptBody([ref(t.ana)], { expectedRevision: 0 }))).status).toBe(409);
    expect((await del(t, rid, t.host, { expectedRevision: 5 })).status).toBe(409);
    expect((await receiptsOf(t))[0].revision).toBe(1);
  });

  it("a person is on one receipt only (409), a duplicate pick is 422, a removed person can't be added (404)", async () => {
    const t = await setup();
    expect((await put(t, id(), t.host, receiptBody([ref(t.ana)]))).status).toBe(200);
    const clash = await put(t, id(), t.host, receiptBody([ref(t.ana), ref(t.bo)]));
    expect([clash.status, clash.body.error?.code]).toEqual([409, "ALREADY_ON_RECEIPT"]);
    expect((await put(t, id(), t.host, receiptBody([{ label: "Lola" }, { label: "lola" }]))).status).toBe(422);
    await run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.bo.actor.participantId, null));
    expect((await put(t, id(), t.host, receiptBody([ref(t.bo)]))).status).toBe(404);
  });

  it("an eleventh receipt is 400 and a made-up id is 404", async () => {
    const t = await setup();
    for (let i = 0; i < 10; i++) expect((await put(t, id(), t.host, receiptBody([{ label: `Guest ${i}` }]))).status).toBe(200);
    const over = await put(t, id(), t.host, receiptBody([{ label: "Extra" }]));
    expect([over.status, over.body.error?.code]).toEqual([400, "TOO_MANY_RECEIPTS"]);
    expect((await send(DELETE, "DELETE", t.sessionId, { receiptId: "nope" }, t.host, { expectedRevision: 1 })).status).toBe(404);
  });

  it("works after End, and a cancelled order refuses it", async () => {
    const t = await setup();
    await confirm(t);
    await run(t.host.actor, (tx, s) => closeSession(tx, s, t.host.actor));
    expect((await put(t, id(), t.host, receiptBody([ref(t.ana)]))).status).toBe(200);
    const c = await setup();
    await run(c.host.actor, (tx, s) => closeSession(tx, s, c.host.actor));
    expect((await put(c, id(), c.host, receiptBody([ref(c.ana)]))).status).toBe(409);
  });

  it("the events keep Confirm fresh", async () => {
    expect(NON_TICKET_EVENTS).toEqual(expect.arrayContaining(["receipt.set", "receipt.removed"]));
    const t = await setup();
    const seen = (await getSnapshot(db, t.host.actor)).session.revision;
    await put(t, id(), t.host, receiptBody([ref(t.ana)]));
    const snap = await getSnapshot(db, t.host.actor);
    await expect(run(t.host.actor, (tx, s) => confirmRound(tx, s, t.host.actor, snap.activeRoundId, seen))).resolves.toBeTruthy();
    const types = (await db.select({ t: sessionEvents.eventType }).from(sessionEvents).where(eq(sessionEvents.sessionId, t.sessionId))).map((r) => r.t);
    expect(types).toContain("receipt.set");
  });

  it("another order's receipt id is 404 and the DB rejects a person from another order", async () => {
    const a = await setup();
    const b = await setup();
    const rid = id();
    await put(a, rid, a.host, receiptBody([ref(a.ana)]));
    expect((await put(b, rid, b.host, receiptBody([ref(b.ana)]))).status).toBe(404);
    await expect(db.insert(receiptPeople).values({ receiptId: rid, sessionId: a.sessionId, participantId: b.ana.actor.participantId })).rejects.toThrow();
  });

  it("approving a claim whose claimant is already on another receipt does not fail", async () => {
    const t = await setup();
    await put(t, id(), t.host, receiptBody([ref(t.ana)]));
    await put(t, id(), t.host, receiptBody([{ label: "Rafa" }]));
    await add(db, t.host.actor, { dishName: "Soup", quantity: 1, attribution: { type: "INDIVIDUAL", label: "Rafa" } });
    const batchId = (await getSnapshot(db, t.host.actor)).entries.at(-1)!.batchId;
    const { result } = await run(t.ana.actor, (tx, s) => requestClaim(tx, s, t.ana.actor, batchId));
    await run(t.host.actor, (tx, s) => resolveClaim(tx, s, t.host.actor, result.claimId, true));
    expect((await receiptsOf(t)).flatMap((r) => r.people.map((p) => p.label ?? p.participantId))).toEqual([t.ana.actor.participantId]);
  });
});

describe("PUT /entries/:entryId/settlement with splitAmong", () => {
  const two = (t: Scene) => [ref(t.ana), ref(t.bo)];

  it("a host splits a shared dish between 2 or more; the snapshot lists the people", async () => {
    const t = await setup();
    expect((await split(t, t.pata, t.host, { expectedRevision: 0, unitPriceCentavos: 78000, splitAmong: two(t) })).status).toBe(200);
    const row = (await getSnapshot(db, t.host.actor)).settlement.entries[t.pata];
    expect(row.splitAmong?.map((p) => p.participantId)).toEqual(expect.arrayContaining(two(t).map((p) => p.participantId)));
    expect(row.billTo).toBeNull();
  });

  it("one person, billTo together with a split, and a duplicate are refused; a guest gets 403", async () => {
    const t = await setup();
    expect((await split(t, t.pata, t.host, { expectedRevision: 0, splitAmong: [ref(t.ana)] })).status).toBe(422);
    expect((await split(t, t.pata, t.host, { expectedRevision: 0, billTo: ref(t.ana), splitAmong: two(t) })).status).toBe(422);
    expect((await split(t, t.pata, t.host, { expectedRevision: 0, splitAmong: [{ label: "Ana" }, { label: "ana" }] })).status).toBe(422);
    expect((await split(t, t.pata, t.ana, { expectedRevision: 0, splitAmong: two(t) })).status).toBe(403);
  });

  it("a personal line can't be split (422)", async () => {
    const t = await setup();
    const own = (await getSnapshot(db, t.host.actor)).entries.find((e) => e.dishName === "Rice")!;
    expect((await split(t, own.id, t.host, { expectedRevision: 0, splitAmong: two(t) })).status).toBe(422);
  });

  it("switching to Bill to replaces the split on one revision; a person who left stays, a new removed one is 404", async () => {
    const t = await setup();
    await split(t, t.pata, t.host, { expectedRevision: 0, splitAmong: two(t) });
    await run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.bo.actor.participantId, null));
    expect((await split(t, t.pata, t.host, { expectedRevision: 1, unitPriceCentavos: 90000, splitAmong: two(t) })).status).toBe(200);
    const gone = await split(t, t.pata, t.host, { expectedRevision: 2, splitAmong: [ref(t.ana), { participantId: crypto.randomUUID() }] });
    expect(gone.status).toBe(404);
    expect((await split(t, t.pata, t.host, { expectedRevision: 2, billTo: ref(t.ana) })).status).toBe(200);
    expect(await db.select().from(entryPayers).where(eq(entryPayers.entryId, t.pata))).toHaveLength(0);
    expect((await getSnapshot(db, t.host.actor)).settlement.entries[t.pata]).toMatchObject({ revision: 3, billTo: expect.anything() });
  });
});
