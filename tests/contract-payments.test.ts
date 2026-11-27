/**
 * Contract tests for slice 5 (docs/plans/salo-v1-4.md): payment tracking.
 * Golden contract: docs/contracts/payments.md. Real route handlers, real Postgres, faked cookie jar.
 * Run: pnpm vitest run tests/contract-payments.test.ts
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { DELETE, PUT } from "@/app/api/sessions/[id]/payments/[paymentId]/route";
import type { Actor } from "@/lib/permissions";
import { credentialCookieName, hashToken, newToken } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { notifications, participantCredentials, participants, payments, sessionEvents } from "@/server/db/schema";
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
const put = (t: Scene, id: string, who: Who, body: unknown, idem?: string) => send(PUT, "PUT", t.sessionId, { paymentId: id }, who, body, idem);
const del = (t: Scene, id: string, who: Who) => send(DELETE, "DELETE", t.sessionId, { paymentId: id }, who, undefined);
const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3]) => runMutation(db, actor, { idempotencyKey: key(), type: "t" }, apply);

async function guest(sessionId: string, name: string): Promise<Who> {
  const token = newToken();
  const [row] = await db.insert(participants).values({ sessionId, displayName: name, role: "GUEST" }).returning();
  await db.insert(participantCredentials).values({ sessionId, participantId: row.id, credentialType: "GUEST", credentialHash: hashToken(token) });
  return { actor: { participantId: row.id, sessionId, role: "GUEST", displayName: name }, token };
}

/** Host, Ana and Bo (a guest each with a dish). */
async function setup() {
  const s = await newSession(db);
  const ana = await guest(s.sessionId, "Ana");
  const bo = await guest(s.sessionId, "Bo");
  await add(db, ana.actor, { dishName: "Rice", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  await add(db, bo.actor, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  return { ...s, host: { actor: s.host, token: s.token } as Who, ana, bo };
}
type Scene = Awaited<ReturnType<typeof setup>>;
const id = () => crypto.randomUUID();
const ref = (w: Who) => ({ participantId: w.actor.participantId });
const body = (payer: unknown, over: Record<string, unknown> = {}) => ({ payer, payee: null, amountCentavos: 50000, method: "gcash", note: null, ...over });
const paymentsOf = async (t: Scene) => (await getSnapshot(db, t.host.actor)).settlement.payments;
const noticesOf = async (t: Scene) => db.select().from(notifications).where(eq(notifications.sessionId, t.sessionId));

describe("PUT/DELETE /payments/:paymentId", () => {
  it("host records and deletes; everyone sees it", async () => {
    const t = await setup();
    const pid = id();
    const res = await put(t, pid, t.host, body(ref(t.ana), { payee: ref(t.host), note: "dinner" }));
    expect(res.status).toBe(200);
    expect(res.body.data?.result).toMatchObject({ paymentId: pid });
    expect((await getSnapshot(db, t.bo.actor)).settlement.payments).toEqual([
      expect.objectContaining({ id: pid, payer: { participantId: t.ana.actor.participantId, label: null }, payee: { participantId: t.host.actor.participantId, label: null }, amountCentavos: 50000, method: "gcash", note: "dinner" }),
    ]);
    expect((await del(t, pid, t.host)).status).toBe(200);
    expect(await paymentsOf(t)).toEqual([]);
    const gone = await del(t, pid, t.host);
    expect([gone.status, gone.body.error?.code]).toEqual([404, "PAYMENT_NOT_FOUND"]);
  });

  it("same id and body is a 200 no-op, a different body is 409, another order's id is 404", async () => {
    const t = await setup();
    const other = await setup();
    const pid = id();
    expect((await put(t, pid, t.host, body(ref(t.ana)))).status).toBe(200);
    expect((await put(t, pid, t.host, body(ref(t.ana)))).status).toBe(200);
    expect(await paymentsOf(t)).toHaveLength(1);
    expect((await put(t, pid, t.host, body(ref(t.ana), { amountCentavos: 1 }))).status).toBe(409);
    const stolen = await put(other, pid, other.host, body({ label: "Lola" }));
    expect([stolen.status, stolen.body.error?.code]).toEqual([404, "PAYMENT_NOT_FOUND"]);
    expect((await del(other, pid, other.host)).status).toBe(404);
    expect(await paymentsOf(t)).toHaveLength(1);
  });

  it("guests and co-hosts get 403 and nothing is written", async () => {
    const t = await setup();
    expect((await put(t, id(), t.ana, body(ref(t.ana)))).status).toBe(403);
    await db.update(participants).set({ cohostAt: new Date() }).where(eq(participants.id, t.ana.actor.participantId));
    const co = { ...t.ana, actor: { ...t.ana.actor, cohost: true } };
    expect((await put(t, id(), co, body(ref(t.ana)))).status).toBe(403);
    expect(await paymentsOf(t)).toEqual([]);
  });

  it("validation: amount, method, note, payee equal to payer", async () => {
    const t = await setup();
    for (const over of [{ amountCentavos: 0 }, { amountCentavos: 100000000 }, { amountCentavos: 1.5 }, { method: "paypal" }, { note: "x".repeat(41) }]) {
      expect((await put(t, id(), t.host, body(ref(t.ana), over))).status, JSON.stringify(over)).toBe(422);
    }
    expect((await put(t, id(), t.host, body(ref(t.ana), { payee: ref(t.ana) }))).status).toBe(422);
    expect((await put(t, id(), t.host, body({ label: "Lola" }, { payee: { label: "lola" } }))).status).toBe(422);
    expect(await paymentsOf(t)).toEqual([]);
  });

  it("a removed payer is fine; a removed payee is 404; an unknown payer is 404", async () => {
    const t = await setup();
    await run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.bo.actor.participantId, null));
    expect((await put(t, id(), t.host, body(ref(t.bo)))).status).toBe(200);
    expect((await put(t, id(), t.host, body(ref(t.ana), { payee: ref(t.bo) }))).status).toBe(404);
    expect((await put(t, id(), t.host, body({ participantId: id() }))).status).toBe(404);
  });

  it("the 201st payment is 400", async () => {
    const t = await setup();
    await db.execute(sql`INSERT INTO payments (id, session_id, label, amount_centavos) SELECT gen_random_uuid(), ${t.sessionId}, 'G' || g, 100 FROM generate_series(1, 200) g`);
    const over = await put(t, id(), t.host, body({ label: "Extra" }));
    expect([over.status, over.body.error?.code]).toEqual([400, "TOO_MANY_PAYMENTS"]);
  });

  it("works after End; a cancelled order refuses it", async () => {
    const t = await setup();
    const snap = await getSnapshot(db, t.host.actor);
    await run(t.host.actor, (tx, s) => confirmRound(tx, s, t.host.actor, snap.activeRoundId, snap.session.revision));
    await run(t.host.actor, (tx, s) => closeSession(tx, s, t.host.actor));
    const pid = id();
    expect((await put(t, pid, t.host, body(ref(t.ana)))).status).toBe(200);
    expect((await del(t, pid, t.host)).status).toBe(200);
    const c = await setup();
    await run(c.host.actor, (tx, s) => closeSession(tx, s, c.host.actor));
    const res = await put(c, id(), c.host, body(ref(c.ana)));
    expect([res.status, res.body.error?.code]).toEqual([409, "SESSION_CLOSED"]);
  });

  it("the database refuses a payer from another order", async () => {
    const t = await setup();
    const other = await setup();
    await expect(db.execute(sql`INSERT INTO payments (id, session_id, participant_id, amount_centavos) VALUES (gen_random_uuid(), ${t.sessionId}, ${other.ana.actor.participantId}, 100)`)).rejects.toThrow();
  });

  it("payment events never make a confirmed order stale", () => {
    expect(NON_TICKET_EVENTS).toEqual(expect.arrayContaining(["payment.recorded", "payment.deleted"]));
  });

  it("a claim re-keys a typed payer and payee to the claimant", async () => {
    const t = await setup();
    await put(t, id(), t.host, body({ label: "Rafa" }, { payee: { label: "Rafa Jr" } }));
    await put(t, id(), t.host, body(ref(t.bo), { payee: { label: "Rafa" } }));
    await add(db, t.host.actor, { dishName: "Soup", quantity: 1, attribution: { type: "INDIVIDUAL", label: "Rafa" } });
    const batchId = (await getSnapshot(db, t.host.actor)).entries.at(-1)!.batchId;
    const { result } = await run(t.ana.actor, (tx, s) => requestClaim(tx, s, t.ana.actor, batchId));
    await run(t.host.actor, (tx, s) => resolveClaim(tx, s, t.host.actor, result.claimId, true));
    const list = await paymentsOf(t);
    expect(list.map((p) => p.payer.participantId)).toContain(t.ana.actor.participantId);
    expect(list.map((p) => p.payee?.participantId)).toContain(t.ana.actor.participantId);
    expect(list.some((p) => p.payer.label === "Rafa" || p.payee?.label === "Rafa")).toBe(false);
  });

  it("notices: a participant payer gets one, a typed payer or the host's own card none; delete removes it", async () => {
    const t = await setup();
    const a = id();
    await put(t, a, t.host, body(ref(t.ana)));
    await put(t, id(), t.host, body({ label: "Pedro" }));
    await put(t, id(), t.host, body(ref(t.host)));
    const rows = await noticesOf(t);
    expect(rows.filter((r) => r.type === "payment.recorded").map((r) => r.recipientId)).toEqual([t.ana.actor.participantId]);
    await del(t, a, t.host);
    expect((await noticesOf(t)).filter((r) => r.type === "payment.recorded")).toEqual([]);
    expect((await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, t.sessionId))).map((e) => e.eventType)).toContain("payment.deleted");
    void payments;
  });
});
