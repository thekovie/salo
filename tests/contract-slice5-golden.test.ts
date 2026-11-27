/** Independent golden contract for slice 5 (payment tracking): expectations from docs/plans/salo-v1-4.md and the F07 brief, not the code.
 * Table: docs/contracts/payments-golden.md. Run: gtimeout 600 pnpm vitest run tests/contract-slice5-golden.test.ts */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));
vi.setConfig({ testTimeout: 60_000 });

import { DELETE, PATCH, PUT } from "@/app/api/sessions/[id]/payments/[paymentId]/route";
import { GET as SYNC } from "@/app/api/sessions/[id]/sync/route";
import { notificationText, notificationTarget } from "@/lib/notifications";
import type { Actor } from "@/lib/permissions";
import { credentialCookieName, hashToken, newToken } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { notifications, participantCredentials, participants, payments, sessionEvents, sessions } from "@/server/db/schema";
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

const DEADLINE_MS = 15_000;
function within<T>(p: Promise<T>, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`deadline (${DEADLINE_MS} ms): ${what}`)), DEADLINE_MS)));
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

type Who = { actor: Actor; token: string };
type Envelope = { data?: { result: Record<string, unknown>; replayed: boolean }; error?: { code: string; message?: string } };
type Ctx = { params: Promise<Record<string, string>> };
type Res = { status: number; body: Envelope };

async function send(route: unknown, method: string, sessionId: string, paymentId: string, who: Who | null, body: unknown, idem: string | null = key(), raw?: string): Promise<Res> {
  jar.cookies = who ? { [credentialCookieName(sessionId)]: who.token } : {};
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost:3000" };
  if (idem !== null) headers["idempotency-key"] = idem;
  const req = new Request("http://localhost:3000/api/x", { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const res = await within((route as (r: Request, c: Ctx) => Promise<Response>)(req, { params: Promise.resolve({ id: sessionId, paymentId }) }), `${method} payment ${paymentId.slice(0, 8)} in ${sessionId.slice(0, 8)}`);
  return { status: res.status, body: (await res.json()) as Envelope };
}
const put = (t: Scene, pid: string, who: Who | null, body: unknown, idem?: string | null) => send(PUT, "PUT", t.sessionId, pid, who, body, idem);
const patch = (t: Scene, pid: string, who: Who | null, b: unknown, idem?: string | null) => send(PATCH, "PATCH", t.sessionId, pid, who, b, idem);
const del = (t: Scene, pid: string, who: Who | null, idem?: string | null) => send(DELETE, "DELETE", t.sessionId, pid, who, undefined, idem);
const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3]) => runMutation(db, actor, { idempotencyKey: key(), type: "t" }, apply);

async function syncAs(t: Scene, who: Who) {
  jar.cookies = { [credentialCookieName(t.sessionId)]: who.token };
  const res = await within(SYNC(new Request(`http://localhost:3000/api/sessions/${t.sessionId}/sync`), { params: Promise.resolve({ id: t.sessionId }) } as never), "GET /sync");
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { settlement: { payments: unknown[] }; notifications: { items: { type: string }[] } } }).data;
}

async function guest(sessionId: string, name: string): Promise<Who> {
  const token = newToken();
  const [row] = await db.insert(participants).values({ sessionId, displayName: name, role: "GUEST" }).returning();
  await db.insert(participantCredentials).values({ sessionId, participantId: row.id, credentialType: "GUEST", credentialHash: hashToken(token) });
  return { actor: { participantId: row.id, sessionId, role: "GUEST", displayName: name }, token };
}

/** Host, Ana and Bo with a dish each, Cara with none, and a shared Crispy Pata. */
async function setup() {
  const s = await newSession(db);
  const ana = await guest(s.sessionId, "Ana");
  const bo = await guest(s.sessionId, "Bo");
  const cara = await guest(s.sessionId, "Cara");
  await add(db, ana.actor, { dishName: "Rice", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  await add(db, bo.actor, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  await add(db, s.host, { dishName: "Crispy Pata", quantity: 1, attribution: { type: "TABLE" } });
  return { ...s, host: { actor: s.host, token: s.token } as Who, ana, bo, cara };
}
type Scene = Awaited<ReturnType<typeof setup>>;
const id = () => crypto.randomUUID();
const ref = (w: Who) => ({ participantId: w.actor.participantId });
const body = (payer: unknown, over: Record<string, unknown> = {}) => ({ payer, payee: null, amountCentavos: 50000, method: "gcash", note: "for drinks", ...over });
const paymentsOf = async (t: Scene, who: Who = t.host) => (await getSnapshot(db, who.actor)).settlement.payments;
const rows = async (t: Scene) => db.select().from(payments).where(eq(payments.sessionId, t.sessionId));
const notices = async (t: Scene, recipient?: Who, type = "payment.recorded") =>
  (await db.select().from(notifications).where(and(eq(notifications.sessionId, t.sessionId), eq(notifications.type, type)))).filter((n) => !recipient || n.recipientId === recipient.actor.participantId);
const events = async (t: Scene, type?: string) => (await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, t.sessionId))).filter((e) => !type || e.eventType === type);

/** Everything a refused request must leave alone. */
async function fingerprint(t: Scene) {
  const [s] = await db.select({ r: sessions.revision }).from(sessions).where(eq(sessions.id, t.sessionId));
  const all = await db.select().from(notifications).where(eq(notifications.sessionId, t.sessionId));
  return JSON.stringify({ rev: s.r, ev: (await events(t)).length, pay: (await rows(t)).map((r) => r.id).sort(), n: all.map((n) => n.id).sort() });
}
async function refused(t: Scene, who: Who | null, pid: string, b: unknown, status: number, code?: string) {
  const before = await fingerprint(t);
  const r = await put(t, pid, who, b);
  expect([r.status, ...(code ? [r.body.error?.code] : [])], JSON.stringify(b)).toEqual([status, ...(code ? [code] : [])]);
  expect(await fingerprint(t), `side effects of refused ${JSON.stringify(b)}`).toBe(before);
}

async function confirm(t: Scene) {
  const snap = await getSnapshot(db, t.host.actor);
  await run(t.host.actor, (tx, s) => confirmRound(tx, s, t.host.actor, snap.activeRoundId, snap.session.revision));
}

describe("PUT /payments/:paymentId: record", () => {
  it("G01 host records; every member's snapshot and /sync show it (D28)", async () => {
    const t = await setup();
    const pid = id();
    const r = await put(t, pid, t.host, body(ref(t.ana)));
    expect([r.status, r.body.data?.replayed]).toEqual([200, false]);
    const want = [{ id: pid, payer: { participantId: t.ana.actor.participantId, label: null }, payee: null, amountCentavos: 50000, method: "gcash", note: "for drinks", createdAt: expect.any(String), needsReview: false }];
    expect(await paymentsOf(t, t.bo)).toEqual(want);
    expect(await paymentsOf(t, t.ana)).toEqual(want);
    expect((await syncAs(t, t.bo)).settlement.payments).toEqual(want);
  });

  it("G02 payee kinds: participant, typed name (tidied), restaurant; method and note optional", async () => {
    const t = await setup();
    const a = id(), b = id(), c = id();
    expect((await put(t, a, t.host, body(ref(t.ana), { payee: ref(t.host) }))).status).toBe(200);
    expect((await put(t, b, t.host, body({ label: "  Lola  " }, { payee: { label: "Tita Baby" }, method: null, note: undefined }))).status).toBe(200);
    expect((await put(t, c, t.host, body(ref(t.cara), { method: null }))).status).toBe(200); // no card check on the server (plan, Validation)
    const ps = await paymentsOf(t);
    expect(ps.map((p) => p.id)).toEqual([a, b, c]);
    expect(ps[0].payee).toEqual({ participantId: t.host.actor.participantId, label: null });
    expect(ps[1]).toMatchObject({ payer: { participantId: null, label: "Lola" }, payee: { participantId: null, label: "Tita Baby" }, method: null, note: null });
    expect(ps[2]).toMatchObject({ payee: null, method: null, note: "for drinks" });
  });

  it("G03 all five methods accepted; amount 1 and 99,999,999 accepted", async () => {
    const t = await setup();
    for (const m of ["cash", "gcash", "maya", "bank", "other"]) expect((await put(t, id(), t.host, body(ref(t.ana), { method: m }))).status, m).toBe(200);
    expect((await put(t, id(), t.host, body(ref(t.ana), { amountCentavos: 1 }))).status).toBe(200);
    expect((await put(t, id(), t.host, body(ref(t.ana), { amountCentavos: 99_999_999 }))).status).toBe(200);
    expect(await rows(t)).toHaveLength(7);
  });

  it("G04 note and typed labels of exactly 40 chars are accepted", async () => {
    const t = await setup();
    const forty = "x".repeat(40);
    expect((await put(t, id(), t.host, body({ label: forty }, { payee: { label: "y".repeat(40) }, note: forty }))).status).toBe(200);
  });
});

describe("PUT /payments/:paymentId: validation (422 INVALID, nothing changes)", () => {
  it("G05 amount 0, negative, > 99,999,999, fractional, string, null, missing", async () => {
    const t = await setup();
    for (const amountCentavos of [0, -1, 100_000_000, 1.5, "500", null, Number.MAX_SAFE_INTEGER]) await refused(t, t.host, id(), body(ref(t.ana), { amountCentavos }), 422, "INVALID");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { amountCentavos: _omit, ...noAmount } = body(ref(t.ana));
    await refused(t, t.host, id(), noAmount, 422, "INVALID");
  });

  it("G06 unknown method, wrong-type method, note 41 chars, typed labels 41 chars, blank labels", async () => {
    const t = await setup();
    await refused(t, t.host, id(), body(ref(t.ana), { method: "venmo" }), 422, "INVALID");
    await refused(t, t.host, id(), body(ref(t.ana), { method: 5 }), 422, "INVALID");
    await refused(t, t.host, id(), body(ref(t.ana), { note: "n".repeat(41) }), 422, "INVALID");
    await refused(t, t.host, id(), body({ label: "L".repeat(41) }), 422, "INVALID");
    await refused(t, t.host, id(), body(ref(t.ana), { payee: { label: "L".repeat(41) } }), 422, "INVALID");
    await refused(t, t.host, id(), body({ label: "   " }), 422, "INVALID");
    await refused(t, t.host, id(), body({ label: "" }), 422, "INVALID");
  });

  it("G07 payer missing, empty object, non-uuid participantId, array, string; payee of the wrong shape", async () => {
    const t = await setup();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { payer: _p, ...noPayer } = body(ref(t.ana));
    await refused(t, t.host, id(), noPayer, 422);
    for (const payer of [{}, { participantId: "not-a-uuid" }, [], "Ana", null]) await refused(t, t.host, id(), body(payer), 422);
    for (const payee of [{}, "Restaurant", { participantId: "nope" }]) await refused(t, t.host, id(), body(ref(t.ana), { payee }), 422);
  });

  it("G08 payee == payer is 422 for ids and for typed names that normalise equal; the host paying the restaurant is fine", async () => {
    const t = await setup();
    await refused(t, t.host, id(), body(ref(t.ana), { payee: ref(t.ana) }), 422);
    await refused(t, t.host, id(), body({ label: "Lola" }, { payee: { label: " lola " } }), 422);
    await refused(t, t.host, id(), body(ref(t.host), { payee: ref(t.host) }), 422);
    expect((await put(t, id(), t.host, body(ref(t.host), { payee: null }))).status).toBe(200);
  });

  it("G09 broken JSON is 400; a missing Idempotency-Key is 400; a non-object body is 422", async () => {
    const t = await setup();
    const before = await fingerprint(t);
    expect((await send(PUT, "PUT", t.sessionId, id(), t.host, undefined, key(), "{nope")).status).toBe(400);
    expect((await put(t, id(), t.host, body(ref(t.ana)), null)).status).toBe(400);
    expect((await put(t, id(), t.host, "just text")).status).toBe(422);
    expect(await fingerprint(t)).toBe(before);
  });
});

describe("people rules", () => {
  it("G10 a payer or payee not in this order (random id or another order's participant) is 404, nothing changes", async () => {
    const a = await setup();
    const b = await setup();
    await refused(a, a.host, id(), body({ participantId: id() }), 404);
    await refused(a, a.host, id(), body(ref(b.ana)), 404);
    await refused(a, a.host, id(), body(ref(a.ana), { payee: ref(b.ana) }), 404);
    await refused(a, a.host, id(), body(ref(a.ana), { payee: ref(b.host) }), 404);
    expect(await rows(b)).toHaveLength(0);
  });

  it("G11 a removed payer is accepted without a notice; a newly added removed payee is 404; earlier payments stay", async () => {
    const t = await setup();
    expect((await put(t, id(), t.host, body(ref(t.ana), { payee: ref(t.bo) }))).status).toBe(200);
    await run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.bo.actor.participantId, null));
    await run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.ana.actor.participantId, null));
    expect(await paymentsOf(t)).toHaveLength(1);
    const noticesBefore = (await notices(t)).length;
    expect((await put(t, id(), t.host, body(ref(t.ana)))).status).toBe(200);
    expect((await notices(t)).length).toBe(noticesBefore);
    await refused(t, t.host, id(), body(ref(t.cara), { payee: ref(t.bo) }), 404, "PERSON_NOT_FOUND");
    expect(await paymentsOf(t)).toHaveLength(2);
  });
});

describe("authorization", () => {
  it("G12 guest and co-host get 403 on PUT and DELETE; nothing changes", async () => {
    const t = await setup();
    const existing = id();
    await put(t, existing, t.host, body(ref(t.ana)));
    await db.update(participants).set({ cohostAt: new Date() }).where(eq(participants.id, t.bo.actor.participantId));
    for (const who of [t.ana, t.bo, t.cara]) {
      await refused(t, who, id(), body(ref(who)), 403);
      const before = await fingerprint(t);
      expect((await del(t, existing, who)).status).toBe(403);
      expect(await fingerprint(t)).toBe(before);
    }
    expect(await paymentsOf(t)).toHaveLength(1);
  });

  it("G13 a guest cannot mark themselves paid: 403 for their own ref and for a typed name", async () => {
    const t = await setup();
    await refused(t, t.ana, id(), body(ref(t.ana), { payee: ref(t.host) }), 403);
    await refused(t, t.ana, id(), body({ label: "Ana" }), 403);
  });

  it("G14 no cookie, another order's host cookie and a removed guest's cookie never reach the order", async () => {
    const a = await setup();
    const b = await setup();
    const pid = id();
    await put(a, pid, a.host, body(ref(a.ana)));
    await run(a.host.actor, (tx, s) => removeParticipant(tx, s, a.host.actor, a.bo.actor.participantId, null));
    const before = await fingerprint(a);
    expect((await put(a, id(), null, body(ref(a.ana)))).status).toBe(404);
    expect((await del(a, pid, null)).status).toBe(404);
    expect((await put(a, id(), b.host, body(ref(a.ana)))).status).toBe(404);
    expect((await del(a, pid, b.host)).status).toBe(404);
    expect((await put(a, id(), a.bo, body(ref(a.ana)))).status).toBe(403);
    expect(await fingerprint(a)).toBe(before);
    expect(await rows(b)).toHaveLength(0);
  });
});

describe("idempotency and ids", () => {
  it("G15 same id, same body, new key: 200 no-op, one row, one notice", async () => {
    const t = await setup();
    const pid = id();
    expect((await put(t, pid, t.host, body(ref(t.ana)))).status).toBe(200);
    expect((await put(t, pid, t.host, body(ref(t.ana)))).status).toBe(200);
    expect(await rows(t)).toHaveLength(1);
    expect(await notices(t, t.ana)).toHaveLength(1);
  });

  it("G16 same id, any different field: 409 CONFLICT, row unchanged", async () => {
    const t = await setup();
    const pid = id();
    await put(t, pid, t.host, body(ref(t.ana)));
    const before = await fingerprint(t);
    const variants = [{ amountCentavos: 50001 }, { method: "cash" }, { method: null }, { note: "other" }, { note: undefined }, { payee: ref(t.host) }];
    for (const v of variants) {
      const r = await put(t, pid, t.host, body(ref(t.ana), v));
      expect([r.status, r.body.error?.code], JSON.stringify(v)).toEqual([409, "CONFLICT"]);
    }
    expect((await put(t, pid, t.host, body(ref(t.bo)))).status).toBe(409);
    expect(await fingerprint(t)).toBe(before);
    expect((await rows(t))[0]).toMatchObject({ amountCentavos: 50000, method: "gcash", note: "for drinks" });
  });

  it("G17 same Idempotency-Key replay: replayed true, applied once, one notice, one event", async () => {
    const t = await setup();
    const pid = id(), k = key();
    expect((await put(t, pid, t.host, body(ref(t.ana)), k)).body.data?.replayed).toBe(false);
    expect((await put(t, pid, t.host, body(ref(t.ana)), k)).body.data?.replayed).toBe(true);
    expect(await rows(t)).toHaveLength(1);
    expect(await notices(t, t.ana)).toHaveLength(1);
    expect(await events(t, "payment.recorded")).toHaveLength(1);
  });

  it("G18 replaying the record key after the payment was deleted does not bring it back", async () => {
    const t = await setup();
    const pid = id(), k = key();
    await put(t, pid, t.host, body(ref(t.ana)), k);
    expect((await del(t, pid, t.host)).status).toBe(200);
    const again = await put(t, pid, t.host, body(ref(t.ana)), k);
    expect([again.status, again.body.data?.replayed]).toEqual([200, true]);
    expect(await paymentsOf(t)).toEqual([]);
    expect(await notices(t, t.ana)).toHaveLength(0);
  });

  it("G19 another order's payment id: PUT 404 PAYMENT_NOT_FOUND (even the same body), DELETE 404; the original is untouched", async () => {
    const a = await setup();
    const b = await setup();
    const pid = id();
    await put(a, pid, a.host, body(ref(a.ana)));
    const before = await fingerprint(a);
    const r = await put(b, pid, b.host, body(ref(b.ana)));
    expect([r.status, r.body.error?.code]).toEqual([404, "PAYMENT_NOT_FOUND"]);
    expect((await del(b, pid, b.host)).status).toBe(404);
    expect(await fingerprint(a)).toBe(before);
    expect(await rows(b)).toHaveLength(0);
    expect(await rows(a)).toHaveLength(1);
  });

  it("G20 non-uuid ids are 404 on PUT and DELETE", async () => {
    const t = await setup();
    expect((await put(t, "nope", t.host, body(ref(t.ana)))).status).toBe(404);
    expect((await del(t, "nope", t.host)).status).toBe(404);
    expect((await del(t, "../../x", t.host)).status).toBe(404);
  });

  it("G21 race: the same id and body twice at once records once, both 200", async () => {
    const t = await setup();
    const pid = id();
    const rs = await Promise.all([put(t, pid, t.host, body(ref(t.ana))), put(t, pid, t.host, body(ref(t.ana)))]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(await rows(t)).toHaveLength(1);
    expect(await notices(t, t.ana)).toHaveLength(1);
  });

  it("G22 race: the same id with two different bodies at once gives exactly one 200 and one 409", async () => {
    const t = await setup();
    const pid = id();
    const rs = await Promise.all([put(t, pid, t.host, body(ref(t.ana), { amountCentavos: 100 })), put(t, pid, t.host, body(ref(t.ana), { amountCentavos: 200 }))]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await rows(t)).toHaveLength(1);
  });

  it("G23 race: a delete and a re-record of the same id at once never 5xx", async () => {
    const t = await setup();
    const pid = id();
    await put(t, pid, t.host, body(ref(t.ana)));
    const rs = await Promise.all([del(t, pid, t.host), put(t, pid, t.host, body(ref(t.ana)))]);
    for (const r of rs) expect(r.status).toBeLessThan(500);
  });
});

describe("DELETE /payments/:paymentId", () => {
  it("G24 host deletes: 200, gone for everyone; second delete 404; same key replays; one event", async () => {
    const t = await setup();
    const pid = id(), k = key();
    await put(t, pid, t.host, body(ref(t.ana)));
    const r = await del(t, pid, t.host, k);
    expect([r.status, r.body.data?.replayed]).toEqual([200, false]);
    expect(await paymentsOf(t, t.bo)).toEqual([]);
    expect((await del(t, pid, t.host)).status).toBe(404);
    expect((await del(t, pid, t.host, k)).body.data?.replayed).toBe(true);
    expect(await events(t, "payment.deleted")).toHaveLength(1);
  });

  it("G25 an unknown (valid uuid) id is 404 PAYMENT_NOT_FOUND and changes nothing", async () => {
    const t = await setup();
    await put(t, id(), t.host, body(ref(t.ana)));
    const before = await fingerprint(t);
    const r = await del(t, id(), t.host);
    expect([r.status, r.body.error?.code]).toEqual([404, "PAYMENT_NOT_FOUND"]);
    expect(await fingerprint(t)).toBe(before);
  });

  it("G26 delete removes only that payment; recording again works", async () => {
    const t = await setup();
    const a = id(), b = id();
    await put(t, a, t.host, body(ref(t.ana), { amountCentavos: 100 }));
    await put(t, b, t.host, body(ref(t.ana), { amountCentavos: 200 }));
    await del(t, a, t.host);
    expect((await paymentsOf(t)).map((p) => p.id)).toEqual([b]);
    expect((await put(t, id(), t.host, body(ref(t.ana), { amountCentavos: 300 }))).status).toBe(200);
  });
});

describe("order state and limit", () => {
  it("G27 record and delete are allowed after End", async () => {
    const t = await setup();
    const pid = id();
    await put(t, pid, t.host, body(ref(t.ana)));
    await confirm(t);
    await run(t.host.actor, (tx, s) => closeSession(tx, s, t.host.actor));
    expect((await put(t, id(), t.host, body(ref(t.bo)))).status).toBe(200);
    expect((await del(t, pid, t.host)).status).toBe(200);
    expect(await rows(t)).toHaveLength(1);
  });

  it("G28 a cancelled order (ended with nothing confirmed) refuses record with 409 and writes nothing", async () => {
    const t = await setup();
    await run(t.host.actor, (tx, s) => closeSession(tx, s, t.host.actor));
    await refused(t, t.host, id(), body(ref(t.ana)), 409);
  });

  it("G29 [spec silent] DELETE on a cancelled order must not 5xx", async () => {
    const t = await setup();
    const pid = id();
    await put(t, pid, t.host, body(ref(t.ana)));
    await run(t.host.actor, (tx, s) => closeSession(tx, s, t.host.actor));
    const r = await del(t, pid, t.host);
    expect(r.status, `DELETE on cancelled order answered ${r.status}`).toBeLessThan(500);
  });

  it("G30 limit 200: the 200th is accepted, the 201st is 400 TOO_MANY_PAYMENTS, a delete frees a slot", async () => {
    const t = await setup();
    await db.insert(payments).values(Array.from({ length: 199 }, () => ({ id: id(), sessionId: t.sessionId, participantId: t.ana.actor.participantId, amountCentavos: 100, createdBy: t.host.actor.participantId })));
    const last = id();
    expect((await put(t, last, t.host, body(ref(t.ana)))).status).toBe(200);
    const r = await put(t, id(), t.host, body(ref(t.ana)));
    expect([r.status, r.body.error?.code]).toEqual([400, "TOO_MANY_PAYMENTS"]);
    expect(await rows(t)).toHaveLength(200);
    expect((await del(t, last, t.host)).status).toBe(200);
    expect((await put(t, id(), t.host, body(ref(t.ana)))).status).toBe(200);
  });

  it("G31 the limit is per order", async () => {
    const a = await setup();
    const b = await setup();
    await db.insert(payments).values(Array.from({ length: 200 }, () => ({ id: id(), sessionId: a.sessionId, participantId: a.ana.actor.participantId, amountCentavos: 100 })));
    expect((await put(b, id(), b.host, body(ref(b.ana)))).status).toBe(200);
  });

  it("G32 race at the limit: two records at 199 never exceed 200", async () => {
    const t = await setup();
    await db.insert(payments).values(Array.from({ length: 199 }, () => ({ id: id(), sessionId: t.sessionId, participantId: t.ana.actor.participantId, amountCentavos: 100 })));
    const rs = await Promise.all([put(t, id(), t.host, body(ref(t.ana))), put(t, id(), t.host, body(ref(t.ana)))]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await rows(t)).toHaveLength(200);
  });
});

describe("events keep the host's Confirm fresh", () => {
  it("G33 payment.recorded and payment.deleted are non-ticket events and carry ids only", async () => {
    expect(NON_TICKET_EVENTS).toEqual(expect.arrayContaining(["payment.recorded", "payment.deleted"]));
    const t = await setup();
    const pid = id();
    await put(t, pid, t.host, body(ref(t.ana), { note: "secret-note" }));
    await del(t, pid, t.host);
    const evs = [...(await events(t, "payment.recorded")), ...(await events(t, "payment.deleted"))];
    expect(evs.map((e) => e.eventType).sort()).toEqual(["payment.deleted", "payment.recorded"]);
    for (const e of evs) expect(JSON.stringify(e.payload)).not.toMatch(/secret-note|gcash|50000/);
  });

  it("G34 Confirm still passes after a payment is recorded and deleted since the host looked", async () => {
    const t = await setup();
    const seen = (await getSnapshot(db, t.host.actor)).session.revision;
    const pid = id();
    await put(t, pid, t.host, body(ref(t.ana)));
    await del(t, pid, t.host);
    const snap = await getSnapshot(db, t.host.actor);
    await expect(run(t.host.actor, (tx, s) => confirmRound(tx, s, t.host.actor, snap.activeRoundId, seen))).resolves.toBeTruthy();
  });
});

describe("notifications (D30 / D31)", () => {
  it("G35 an active participant payer gets exactly one notice and nobody else does; it opens KKB and names the amount", async () => {
    const t = await setup();
    await put(t, id(), t.host, body(ref(t.ana), { payee: ref(t.bo) }));
    const mine = await notices(t, t.ana);
    expect(mine).toHaveLength(1);
    expect(await notices(t)).toHaveLength(1);
    expect(mine[0].subject).toMatchObject({ centavos: 50000 });
    expect(notificationTarget("payment.recorded")).toBe("kkb");
    expect(notificationText({ type: "payment.recorded", subject: { ...(mine[0].subject as object), host: "Host" } as never })).toContain("500");
  });

  it("G36 none for a typed payer, for the host paying for themself, or for a removed payer", async () => {
    const t = await setup();
    await put(t, id(), t.host, body({ label: "Lola" }));
    await put(t, id(), t.host, body(ref(t.host), { payee: ref(t.ana) }));
    await run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.bo.actor.participantId, null));
    await put(t, id(), t.host, body(ref(t.bo)));
    expect(await notices(t)).toHaveLength(0);
  });

  it("G37 deleting a payment deletes its notice and only its notice, also in the payer's /sync", async () => {
    const t = await setup();
    const a = id(), b = id();
    await put(t, a, t.host, body(ref(t.ana)));
    await put(t, b, t.host, body(ref(t.ana), { amountCentavos: 100 }));
    expect(await notices(t, t.ana)).toHaveLength(2);
    await del(t, a, t.host);
    const left = await notices(t, t.ana);
    expect(left).toHaveLength(1);
    expect(left[0].subject).toMatchObject({ centavos: 100 });
    expect((await syncAs(t, t.ana)).notifications.items.filter((i) => i.type === "payment.recorded")).toHaveLength(1);
  });

  it("G38 a notice the payer already read is also retracted on delete", async () => {
    const t = await setup();
    const pid = id();
    await put(t, pid, t.host, body(ref(t.ana)));
    await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.sessionId, t.sessionId));
    await del(t, pid, t.host);
    expect(await notices(t)).toHaveLength(0);
  });

  it("G39 two real payments of the same amount to the same payer give two notices", async () => {
    const t = await setup();
    await put(t, id(), t.host, body(ref(t.ana)));
    await put(t, id(), t.host, body(ref(t.ana)));
    expect(await notices(t, t.ana)).toHaveLength(2);
  });
});

describe("claim approval re-keys typed names", () => {
  async function claimScene() {
    const t = await setup();
    await add(db, t.host.actor, { dishName: "Soup", quantity: 1, attribution: { type: "INDIVIDUAL", label: "Rafa" } });
    const batchId = (await getSnapshot(db, t.host.actor)).entries.at(-1)!.batchId;
    const approve = async () => {
      const { result } = await run(t.ana.actor, (tx, s) => requestClaim(tx, s, t.ana.actor, batchId));
      await run(t.host.actor, (tx, s) => resolveClaim(tx, s, t.host.actor, result.claimId, true));
    };
    return { t, approve };
  }

  it("G40 a typed payer and a typed payee become the claimant (case-insensitive); other typed names stay", async () => {
    const { t, approve } = await claimScene();
    const p1 = id(), p2 = id(), p3 = id();
    await put(t, p1, t.host, body({ label: "Rafa" }, { payee: ref(t.host) }));
    await put(t, p2, t.host, body(ref(t.bo), { payee: { label: "RAFA" } }));
    await put(t, p3, t.host, body({ label: "Lola" }, { payee: { label: "Tita" } }));
    await approve();
    const ps = Object.fromEntries((await paymentsOf(t)).map((p) => [p.id, p]));
    const anaRef = { participantId: t.ana.actor.participantId, label: null };
    expect(ps[p1].payer).toEqual(anaRef);
    expect(ps[p2].payee).toEqual(anaRef);
    expect(ps[p3].payer).toEqual({ participantId: null, label: "Lola" });
    expect(ps[p3].payee).toEqual({ participantId: null, label: "Tita" });
  });

  it("G41 a claim that turns the payee into the payer keeps the payment, flags it, and leaves it out of the totals", async () => {
    const { t, approve } = await claimScene();
    const pid = id();
    await put(t, pid, t.host, body(ref(t.ana), { payee: { label: "Rafa" } }));
    const [before] = await rows(t);
    await approve();
    const [after] = await rows(t);
    expect({ ...after, payeeParticipantId: null, payeeLabel: before.payeeLabel }).toEqual(before);
    expect(after.payeeParticipantId).toBe(t.ana.actor.participantId);
    expect(after.payeeLabel).toBeNull();
    const p = (await paymentsOf(t)).find((x) => x.id === pid)!;
    expect(p).toMatchObject({ needsReview: true, amountCentavos: 50000, method: "gcash", note: "for drinks", payee: { participantId: t.ana.actor.participantId } });
    expect((await paymentsOf(t, t.ana)).find((x) => x.id === pid)!.needsReview).toBe(true);
  });

  it("G45 the host gets exactly one payment.needsReview notice; replaying the approval adds none; the claimant gets none", async () => {
    const { t } = await claimScene();
    await put(t, id(), t.host, body(ref(t.ana), { payee: { label: "Rafa" } }));
    const batchId = (await getSnapshot(db, t.host.actor)).entries.at(-1)!.batchId;
    const { result } = await run(t.ana.actor, (tx, s) => requestClaim(tx, s, t.ana.actor, batchId));
    const idem = key();
    const approveWith = () => runMutation(db, t.host.actor, { idempotencyKey: idem, type: "claim.resolve" }, (tx, s) => resolveClaim(tx, s, t.host.actor, result.claimId, true));
    await approveWith();
    expect((await approveWith()).replayed).toBe(true);
    const mine = await notices(t, t.host, "payment.needsReview");
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toEqual({ name: "Ana", centavos: 50000 });
    expect(notificationTarget("payment.needsReview")).toBe("kkb");
    expect(notificationText({ type: "payment.needsReview", subject: mine[0].subject as never })).toBe("Ana’s claim left a ₱500.00 payment paid to themself. Fix it on KKB.");
    expect(await notices(t, t.ana, "payment.needsReview")).toHaveLength(0);
    expect(await notices(t, undefined, "payment.needsReview")).toHaveLength(1);
  });

  it("G46 a claim while the typed name still has food leaves the payment unflagged", async () => {
    const { t, approve } = await claimScene();
    await add(db, t.host.actor, { dishName: "Rice", quantity: 1, attribution: { type: "INDIVIDUAL", label: "Rafa" } });
    const pid = id();
    await put(t, pid, t.host, body(ref(t.ana), { payee: { label: "Rafa" } }));
    await approve();
    expect((await paymentsOf(t)).find((x) => x.id === pid)).toMatchObject({ needsReview: false, payee: { participantId: null, label: "Rafa" } });
    expect(await notices(t, undefined, "payment.needsReview")).toHaveLength(0);
  });

  it("G47 the payer side flags too: a typed payer pays Ana, then Ana claims the name", async () => {
    const { t, approve } = await claimScene();
    const pid = id();
    await put(t, pid, t.host, body({ label: "Rafa" }, { payee: ref(t.ana) }));
    await approve();
    expect((await paymentsOf(t)).find((x) => x.id === pid)).toMatchObject({ needsReview: true, payer: { participantId: t.ana.actor.participantId } });
    expect(await notices(t, t.host, "payment.needsReview")).toHaveLength(1);
  });

  it("G48 PATCH payee clears the flag, retracts the notice, emits payment.updated, and replays by key", async () => {
    const { t, approve } = await claimScene();
    const pid = id();
    await put(t, pid, t.host, body(ref(t.ana), { payee: { label: "Rafa" } }));
    await approve();
    const idem = key();
    const r = await patch(t, pid, t.host, { payee: null }, idem);
    expect([r.status, r.body.data?.replayed]).toEqual([200, false]);
    expect((await paymentsOf(t)).find((x) => x.id === pid)).toMatchObject({ needsReview: false, payee: null, amountCentavos: 50000 });
    expect(await notices(t, undefined, "payment.needsReview")).toHaveLength(0);
    expect(await notices(t, t.ana)).toHaveLength(1); // the payer's "recorded" notice was true and stays
    expect(await events(t, "payment.updated")).toHaveLength(1);
    expect((NON_TICKET_EVENTS as readonly string[]).includes("payment.updated")).toBe(true);
    expect((await patch(t, pid, t.host, { payee: null }, idem)).body.data?.replayed).toBe(true);
  });

  it("G49 PATCH refusals: unflagged 409, payee == payer 422, guest and co-host 403, no cookie 404, extra field 422, unknown id 404; nothing changes", async () => {
    const { t, approve } = await claimScene();
    const plain = id(), flagged = id();
    await put(t, plain, t.host, body(ref(t.bo)));
    await put(t, flagged, t.host, body(ref(t.ana), { payee: { label: "Rafa" } }));
    await approve();
    await db.update(participants).set({ cohostAt: new Date() }).where(eq(participants.id, t.bo.actor.participantId));
    const before = await fingerprint(t);
    const got = [
      (await patch(t, plain, t.host, { payee: null })).body.error?.code,
      (await patch(t, flagged, t.host, { payee: ref(t.ana) })).status,
      (await patch(t, flagged, t.ana, { payee: null })).status,
      (await patch(t, flagged, t.bo, { payee: null })).status,
      (await patch(t, flagged, null, { payee: null })).status,
      (await patch(t, flagged, t.host, { payee: null, amountCentavos: 1 })).status,
      (await patch(t, id(), t.host, { payee: null })).status,
    ];
    expect(got).toEqual(["NOT_NEEDS_REVIEW", 422, 403, 403, 404, 422, 404]);
    expect(await fingerprint(t)).toBe(before);
  });

  it("G50 a flagged payment whose payer was removed can still be fixed and deleted", async () => {
    const { t, approve } = await claimScene();
    const a = id(), b = id();
    await put(t, a, t.host, body(ref(t.ana), { payee: { label: "Rafa" } }));
    await put(t, b, t.host, body(ref(t.ana), { payee: { label: "Rafa" } }));
    await approve();
    await run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.ana.actor.participantId, null));
    expect((await patch(t, a, t.host, { payee: ref(t.host) })).status).toBe(200);
    expect((await del(t, b, t.host)).status).toBe(200);
    expect(await notices(t, undefined, "payment.needsReview")).toHaveLength(0);
  });

  it("G51 deleting a flagged payment removes both of its notices; fixing works after the order has ended", async () => {
    const { t, approve } = await claimScene();
    const a = id(), b = id();
    await put(t, a, t.host, body(ref(t.ana), { payee: { label: "Rafa" } }));
    await put(t, b, t.host, body(ref(t.ana), { payee: { label: "Rafa" } }));
    await approve();
    expect(await notices(t, t.ana)).toHaveLength(2);
    await del(t, a, t.host);
    expect(await notices(t, t.ana)).toHaveLength(1);
    expect(await notices(t, t.host, "payment.needsReview")).toHaveLength(1);
    await confirm(t);
    await run(t.host.actor, (tx, s) => closeSession(tx, s, t.host.actor));
    expect((await patch(t, b, t.host, { payee: ref(t.host) })).status).toBe(200);
    expect(await notices(t, undefined, "payment.needsReview")).toHaveLength(0);
  });

  it("G42 re-keying a typed payer does not notify the claimant", async () => {
    const { t, approve } = await claimScene();
    await put(t, id(), t.host, body({ label: "Rafa" }));
    await approve();
    expect(await notices(t, t.ana)).toHaveLength(0);
  });
});

describe("database guards", () => {
  it("G43 a participant from another order, a bad amount, method or note, or two payers are rejected by the DB", async () => {
    const a = await setup();
    const b = await setup();
    const base = { id: id(), sessionId: a.sessionId, participantId: a.ana.actor.participantId, amountCentavos: 100 };
    await expect(db.insert(payments).values({ ...base, participantId: b.ana.actor.participantId })).rejects.toThrow();
    await expect(db.insert(payments).values({ ...base, payeeParticipantId: b.ana.actor.participantId })).rejects.toThrow();
    await expect(db.insert(payments).values({ ...base, createdBy: b.host.actor.participantId })).rejects.toThrow();
    await expect(db.insert(payments).values({ ...base, amountCentavos: 0 })).rejects.toThrow();
    await expect(db.insert(payments).values({ ...base, amountCentavos: 100_000_000 })).rejects.toThrow();
    await expect(db.insert(payments).values({ ...base, method: "venmo" })).rejects.toThrow();
    await expect(db.insert(payments).values({ ...base, note: "n".repeat(41) })).rejects.toThrow();
    await expect(db.insert(payments).values({ ...base, label: "also a label" })).rejects.toThrow();
    await expect(db.insert(payments).values({ ...base, payeeParticipantId: a.bo.actor.participantId, payeeLabel: "both" })).rejects.toThrow();
    expect(await rows(a)).toHaveLength(0);
  });

  it("G44 deleting the order deletes its payments", async () => {
    const t = await setup();
    await put(t, id(), t.host, body(ref(t.ana)));
    await db.execute(sql`DELETE FROM sessions WHERE id = ${t.sessionId}`);
    expect((await db.select().from(payments)).length).toBe(0);
  });
});
