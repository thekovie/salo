/**
 * Contract tests for D1 (docs/plans/salo-v1-4.md, slice 2): billing stays editable by the host after End (`allowClosed`),
 * a cancelled order (closed, nothing confirmed) refuses it, ordering and serving stay refused on closed orders.
 * Golden contract: docs/contracts/adjustments.md, section "Billing after End". Real route handlers, real Postgres, faked cookie jar.
 * Run: pnpm vitest run tests/contract-billing-after-end.test.ts
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { PUT as CORRECTION_PRICE } from "@/app/api/sessions/[id]/corrections/[correctionId]/price/route";
import { POST as ENTRIES_POST } from "@/app/api/sessions/[id]/entries/route";
import { PUT as ENTRY_SETTLEMENT } from "@/app/api/sessions/[id]/entries/[entryId]/settlement/route";
import { PUT as PRICES } from "@/app/api/sessions/[id]/prices/route";
import { PUT as READINESS } from "@/app/api/sessions/[id]/readiness/route";
import { PUT as RECEIPT } from "@/app/api/sessions/[id]/receipt-total/route";
import { POST as ROUNDS_POST } from "@/app/api/sessions/[id]/rounds/route";
import { PUT as SERVICE_CHARGE } from "@/app/api/sessions/[id]/service-charge/route";
import { POST as SERVING } from "@/app/api/sessions/[id]/serving/route";
import type { Actor } from "@/lib/permissions";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { correctionSettlements, entrySettlements, notifications, sessionEvents, sessions, sharedPrices } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { closeSession, confirmRound, openRound, recordCorrection } from "@/server/orders/rounds";
import { findInvite, joinSession } from "@/server/sessions/join";
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
  const timeout = new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`deadline: ${what}`)), DEADLINE_MS)));
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

type Who = { actor: Actor; token: string };
type Res = { status: number; body: { data?: { result: Record<string, unknown>; revision: number; replayed: boolean }; error?: { code: string; message: string } } };
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(handler: unknown, method: string, who: Who | null, sessionId: string, extra: Record<string, string>, body: unknown, idem: string = key()): Promise<Res> {
  jar.cookies = who ? { [credentialCookieName(sessionId)]: who.token } : {};
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/x`, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost:3000", "idempotency-key": idem },
    body: JSON.stringify(body),
  });
  const res = await within((handler as Handler)(req, { params: Promise.resolve({ id: sessionId, ...extra }) }), `${method} ${Object.keys(extra).join("/") || "route"}`);
  return { status: res.status, body: await res.json() };
}

async function guestOf(sessionId: string, name = "Ana"): Promise<Who> {
  const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, sessionId));
  const joined = await joinSession(db, code, name, sessionId);
  void findInvite;
  return { actor: (await resolveActor(db, sessionId, joined.token)) as Actor, token: joined.token };
}
const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3]) => runMutation(db, actor, { idempotencyKey: key(), type: "t" }, apply);

/** An ended order: Ana's Katsu (hers), a shared Sisig, a replacement correction, one round confirmed, then End. */
async function ended() {
  const s = await newSession(db);
  const host: Who = { actor: s.host, token: s.token };
  const ana = await guestOf(s.sessionId);
  const own = await add(db, ana.actor, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  const shared = await add(db, s.host, { dishName: "Sisig", quantity: 1, attribution: { type: "TABLE" } });
  const snap = await getSnapshot(db, s.host);
  await run(s.host, (tx, st) => confirmRound(tx, st, s.host, snap.activeRoundId, snap.session.revision));
  await run(s.host, (tx, st) => openRound(tx, st, s.host));
  const corr = await run(s.host, (tx, st) => recordCorrection(tx, st, s.host, { sourceEntryId: own.result.entryId, type: "REPLACE", replacement: "Pork Katsu" }));
  const after = await getSnapshot(db, s.host);
  await run(s.host, (tx, st) => confirmRound(tx, st, s.host, after.activeRoundId, after.session.revision));
  await run(s.host, (tx, st) => closeSession(tx, st, s.host));
  const dishId = (await getSnapshot(db, s.host)).entries.find((e) => e.id === shared.result.entryId)!.dishId;
  return { ...s, host, ana, ownEntry: own.result.entryId, sharedEntry: shared.result.entryId, correctionId: corr.result.correctionId, dishId, snap: after };
}
type Ended = Awaited<ReturnType<typeof ended>>;

/** Closed with nothing ever confirmed. */
async function cancelled() {
  const s = await newSession(db);
  const host: Who = { actor: s.host, token: s.token };
  const ana = await guestOf(s.sessionId);
  const e = await add(db, s.host, { dishName: "Rice", quantity: 1, attribution: { type: "TABLE" } });
  await run(s.host, (tx, st) => closeSession(tx, st, s.host));
  const dishId = (await getSnapshot(db, s.host)).entries[0].dishId;
  return { ...s, host, ana, entryId: e.result.entryId, dishId };
}
type Cancelled = Awaited<ReturnType<typeof cancelled>>;

async function state(sessionId: string) {
  const [s] = await db.select({ r: sessions.revision, status: sessions.status, exp: sessions.expiresAt, sc: sessions.serviceChargeCentavos, scr: sessions.serviceChargeRevision, rc: sessions.receiptTotalCentavos, rcr: sessions.receiptTotalRevision }).from(sessions).where(eq(sessions.id, sessionId));
  const ev = await db.select({ t: sessionEvents.eventType, r: sessionEvents.revision }).from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId));
  const es = await db.select().from(entrySettlements).where(eq(entrySettlements.sessionId, sessionId));
  const cs = await db.select().from(correctionSettlements).where(eq(correctionSettlements.sessionId, sessionId));
  const sp = await db.select().from(sharedPrices).where(eq(sharedPrices.sessionId, sessionId));
  return JSON.stringify({ s, ev, es, cs, sp });
}

// Each row: how to call one billing endpoint for a given order.
interface Route {
  name: string;
  call: (t: { sessionId: string; dishId: string; ownEntry?: string; sharedEntry?: string; correctionId?: string }, who: Who | null, idem?: string) => Promise<Res>;
  hostOnly403: boolean;
}
const routes: Route[] = [
  { name: "PUT /prices", hostOnly403: true, call: (t, w, i) => call(PRICES, "PUT", w, t.sessionId, {}, { dishId: t.dishId, variant: null, unitCentavos: 15000, expectedRevision: 0 }, i) },
  { name: "PUT /service-charge", hostOnly403: true, call: (t, w, i) => call(SERVICE_CHARGE, "PUT", w, t.sessionId, {}, { expectedRevision: 0, centavos: 1000 }, i) },
  { name: "PUT /receipt-total", hostOnly403: true, call: (t, w, i) => call(RECEIPT, "PUT", w, t.sessionId, {}, { expectedRevision: 0, centavos: 160000 }, i) },
];

describe("D1: an ended order (a round was confirmed) still takes the host's billing writes", () => {
  for (const r of routes) {
    it(`E01 ${r.name}: host 200 after End, applied once, closing date and status unchanged; guest 403 with nothing written`, async () => {
      const t = await ended();
      const guestBefore = await state(t.sessionId);
      const forbidden = await r.call(t, t.ana);
      expect(forbidden.status).toBe(403);
      expect(await state(t.sessionId)).toBe(guestBefore);
      const [pre] = await db.select({ exp: sessions.expiresAt, st: sessions.status }).from(sessions).where(eq(sessions.id, t.sessionId));
      const res = await r.call(t, t.host);
      expect(res.status).toBe(200);
      expect(res.body.data?.replayed).toBe(false);
      const [post] = await db.select({ exp: sessions.expiresAt, st: sessions.status, rev: sessions.revision }).from(sessions).where(eq(sessions.id, t.sessionId));
      expect(post.exp).toEqual(pre.exp);
      expect(post.st).toBe("CLOSED");
      expect(post.rev).toBe(res.body.data!.revision);
    });

    it(`E02 ${r.name}: a retry of the same key after End replays and applies once`, async () => {
      const t = await ended();
      const idem = key();
      expect((await r.call(t, t.host, idem)).status).toBe(200);
      const before = await state(t.sessionId);
      const again = await r.call(t, t.host, idem);
      expect(again.status).toBe(200);
      expect(again.body.data?.replayed).toBe(true);
      expect(await state(t.sessionId)).toBe(before);
    });

    it(`E03 ${r.name}: a cancelled order (nothing confirmed) is 409 SESSION_CLOSED and nothing is written`, async () => {
      const t = await cancelled();
      const before = await state(t.sessionId);
      const res = await r.call(t, t.host);
      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("SESSION_CLOSED");
      expect(await state(t.sessionId)).toBe(before);
    });

    it(`E04 ${r.name}: past its deletion date the ended order is 404, never revived`, async () => {
      const t = await ended();
      await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, t.sessionId));
      const before = await state(t.sessionId);
      expect((await r.call(t, t.host)).status).toBe(404);
      expect(await state(t.sessionId)).toBe(before);
    });

    it(`E05 ${r.name}: another order's host is 404 and neither order moves`, async () => {
      const a = await ended();
      const b = await ended();
      const fa = await state(a.sessionId);
      const fb = await state(b.sessionId);
      jar.cookies = {};
      expect((await r.call(a, { actor: b.host.actor, token: b.host.token })).status).toBe(404);
      expect(await state(a.sessionId)).toBe(fa);
      expect(await state(b.sessionId)).toBe(fb);
    });
  }

  it("E06 PUT /service-charge and /receipt-total after End walk the revision and clear with null", async () => {
    const t = await ended();
    expect((await call(SERVICE_CHARGE, "PUT", t.host, t.sessionId, {}, { expectedRevision: 0, centavos: 500 })).body.data?.result).toEqual({ revision: 1 });
    expect((await call(SERVICE_CHARGE, "PUT", t.host, t.sessionId, {}, { expectedRevision: 0, centavos: 600 })).status).toBe(409);
    expect((await call(SERVICE_CHARGE, "PUT", t.host, t.sessionId, {}, { expectedRevision: 1, centavos: null })).status).toBe(200);
    expect((await call(RECEIPT, "PUT", t.host, t.sessionId, {}, { expectedRevision: 0, centavos: 0 })).status).toBe(200);
    expect((await call(RECEIPT, "PUT", t.host, t.sessionId, {}, { expectedRevision: 1, centavos: null })).status).toBe(200);
    const snap = await getSnapshot(db, t.ana.actor);
    expect(snap.settlement.serviceCharge).toEqual({ centavos: null, revision: 2 });
    expect(snap.settlement.receiptTotal).toEqual({ centavos: null, revision: 2 });
  });
});

describe("D1: PUT /entries/:entryId/settlement after End (line price and Bill to)", () => {
  const settle = (t: Ended | Cancelled, who: Who | null, entryId: string, body: unknown, idem?: string) => call(ENTRY_SETTLEMENT, "PUT", who, t.sessionId, { entryId }, body, idem);

  it("L01 the host prices a guest's line after End; the guest sees it", async () => {
    const t = await ended();
    const r = await settle(t, t.host, t.ownEntry, { expectedRevision: 0, unitPriceCentavos: 25000 });
    expect(r.status).toBe(200);
    expect((await getSnapshot(db, t.ana.actor)).settlement.entries[t.ownEntry]).toMatchObject({ unitCentavos: 25000, revision: 1 });
  });

  it("L02 a non-host price after End is 403 FORBIDDEN, even on the guest's own line; nothing written", async () => {
    const t = await ended();
    const before = await state(t.sessionId);
    const r = await settle(t, t.ana, t.ownEntry, { expectedRevision: 0, unitPriceCentavos: 1 });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe("FORBIDDEN");
    expect(await state(t.sessionId)).toBe(before);
  });

  it("L03 a guest clearing their own price (null) or sending price and Bill to together after End is 403 too", async () => {
    const t = await ended();
    await settle(t, t.host, t.ownEntry, { expectedRevision: 0, unitPriceCentavos: 100 });
    const before = await state(t.sessionId);
    expect((await settle(t, t.ana, t.ownEntry, { expectedRevision: 1, unitPriceCentavos: null })).status).toBe(403);
    expect((await settle(t, t.ana, t.ownEntry, { expectedRevision: 1, unitPriceCentavos: 5, billTo: null })).status).toBe(403);
    expect(await state(t.sessionId)).toBe(before);
  });

  it("L04 a guest's Bill to after End is 403; the host's Bill to for a shared dish is 200", async () => {
    const t = await ended();
    expect((await settle(t, t.ana, t.sharedEntry, { expectedRevision: 0, billTo: { participantId: t.ana.actor.participantId } })).status).toBe(403);
    const ok = await settle(t, t.host, t.sharedEntry, { expectedRevision: 0, billTo: { participantId: t.ana.actor.participantId } });
    expect(ok.status).toBe(200);
    expect((await getSnapshot(db, t.ana.actor)).settlement.entries[t.sharedEntry].billTo).toMatchObject({ participantId: t.ana.actor.participantId });
    const named = await settle(t, t.host, t.sharedEntry, { expectedRevision: 1, billTo: { label: "Rafa" } });
    expect(named.status).toBe(200);
  });

  it("L05 a stale revision after End is 409 CONFLICT; an unknown or non-uuid entry is 404 ENTRY_NOT_FOUND", async () => {
    const t = await ended();
    await settle(t, t.host, t.ownEntry, { expectedRevision: 0, unitPriceCentavos: 100 });
    const stale = await settle(t, t.host, t.ownEntry, { expectedRevision: 0, unitPriceCentavos: 200 });
    expect([stale.status, stale.body.error?.code]).toEqual([409, "CONFLICT"]);
    for (const id of [crypto.randomUUID(), "nope"]) {
      const r = await settle(t, t.host, id, { expectedRevision: 0, unitPriceCentavos: 1 });
      expect([r.status, r.body.error?.code]).toEqual([404, "ENTRY_NOT_FOUND"]);
    }
  });

  it("L06 another order's entry id is 404 from this order's host", async () => {
    const a = await ended();
    const b = await ended();
    const before = await state(b.sessionId);
    expect((await settle(a, a.host, b.ownEntry, { expectedRevision: 0, unitPriceCentavos: 1 })).status).toBe(404);
    expect(await state(b.sessionId)).toBe(before);
  });

  it("L07 a cancelled order is 409 SESSION_CLOSED for the host on price and Bill to, and nothing is written", async () => {
    const t = await cancelled();
    const before = await state(t.sessionId);
    for (const body of [{ expectedRevision: 0, unitPriceCentavos: 100 }, { expectedRevision: 0, billTo: { label: "Rafa" } }]) {
      const r = await settle(t, t.host, t.entryId, body);
      expect([r.status, r.body.error?.code]).toEqual([409, "SESSION_CLOSED"]);
    }
    expect(await state(t.sessionId)).toBe(before);
  });

  it("L08 prices written after End bounds: 0 and the maximum are accepted, over the maximum and negatives are 422", async () => {
    const t = await ended();
    expect((await settle(t, t.host, t.ownEntry, { expectedRevision: 0, unitPriceCentavos: 0 })).status).toBe(200);
    expect((await settle(t, t.host, t.ownEntry, { expectedRevision: 1, unitPriceCentavos: 9_999_999 })).status).toBe(200);
    for (const v of [10_000_000, -1, 1.5, "100"]) expect((await settle(t, t.host, t.ownEntry, { expectedRevision: 2, unitPriceCentavos: v })).status).toBe(422);
  });

  it("L09 a price written after End does not change what was ordered: entries, rounds and tickets are identical", async () => {
    const t = await ended();
    const b = await getSnapshot(db, t.host.actor);
    await settle(t, t.host, t.ownEntry, { expectedRevision: 0, unitPriceCentavos: 25000 });
    const a = await getSnapshot(db, t.host.actor);
    expect(a.entries).toEqual(b.entries);
    expect(a.rounds).toEqual(b.rounds);
    expect(a.tickets).toEqual(b.tickets);
  });
});

describe("D1: PUT /corrections/:correctionId/price after End", () => {
  const price = (t: Ended, who: Who | null, id: string, body: unknown) => call(CORRECTION_PRICE, "PUT", who, t.sessionId, { correctionId: id }, body);

  it("P01 the host prices a replacement after End (200, revision 1, then 409 on a stale one); a guest is 403", async () => {
    const t = await ended();
    const before = await state(t.sessionId);
    expect((await price(t, t.ana, t.correctionId, { expectedRevision: 0, unitPriceCentavos: 100 })).status).toBe(403);
    expect(await state(t.sessionId)).toBe(before);
    const ok = await price(t, t.host, t.correctionId, { expectedRevision: 0, unitPriceCentavos: 31000 });
    expect([ok.status, ok.body.data?.result]).toEqual([200, { correctionId: t.correctionId, revision: 1 }]);
    expect((await price(t, t.host, t.correctionId, { expectedRevision: 0, unitPriceCentavos: 1 })).status).toBe(409);
    expect((await price(t, t.host, t.correctionId, { expectedRevision: 1, unitPriceCentavos: null })).status).toBe(200);
  });

  it("P02 unknown and non-uuid ids are 404 CORRECTION_NOT_FOUND; another order's correction is 404", async () => {
    const a = await ended();
    const b = await ended();
    for (const id of [crypto.randomUUID(), "nope", b.correctionId]) {
      const r = await price(a, a.host, id, { expectedRevision: 0, unitPriceCentavos: 1 });
      expect([r.status, r.body.error?.code]).toEqual([404, "CORRECTION_NOT_FOUND"]);
    }
  });

  it("P03 a quantity correction cannot take a price (422), after End as before", async () => {
    const s = await newSession(db);
    const host: Who = { actor: s.host, token: s.token };
    const e = await add(db, s.host, { dishName: "Katsu", quantity: 2, attribution: { type: "TABLE" } });
    const snap = await getSnapshot(db, s.host);
    await run(s.host, (tx, st) => confirmRound(tx, st, s.host, snap.activeRoundId, snap.session.revision));
    await run(s.host, (tx, st) => openRound(tx, st, s.host));
    const c = await run(s.host, (tx, st) => recordCorrection(tx, st, s.host, { sourceEntryId: e.result.entryId, type: "QUANTITY", quantity: 1 }));
    const after = await getSnapshot(db, s.host);
    await run(s.host, (tx, st) => confirmRound(tx, st, s.host, after.activeRoundId, after.session.revision));
    await run(s.host, (tx, st) => closeSession(tx, st, s.host));
    const r = await call(CORRECTION_PRICE, "PUT", host, s.sessionId, { correctionId: c.result.correctionId }, { expectedRevision: 0, unitPriceCentavos: 100 });
    expect(r.status).toBe(422);
  });
});

describe("D1: PUT /prices after End", () => {
  it("T01 a table price set after End still tells the people whose lines are unpriced (price.defaultSet keeps firing), once", async () => {
    const t = await ended();
    const sisigPrice = { dishId: t.dishId, variant: null, unitCentavos: 12000, expectedRevision: 0 };
    expect((await call(PRICES, "PUT", t.host, t.sessionId, {}, sisigPrice)).status).toBe(200);
    const rows = await db.select().from(notifications).where(sql`${notifications.sessionId} = ${t.sessionId} AND ${notifications.type} = 'price.defaultSet'`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const same = await call(PRICES, "PUT", t.host, t.sessionId, {}, { ...sisigPrice, expectedRevision: 1 });
    expect(same.status).toBe(200);
    expect(await db.select().from(notifications).where(sql`${notifications.sessionId} = ${t.sessionId} AND ${notifications.type} = 'price.defaultSet'`)).toHaveLength(rows.length);
  });

  it("T02 unknown dish, stale revision and a dish of another order behave as before End (404, 409, 404)", async () => {
    const a = await ended();
    const b = await ended();
    expect((await call(PRICES, "PUT", a.host, a.sessionId, {}, { dishId: crypto.randomUUID(), variant: null, unitCentavos: 1, expectedRevision: 0 })).status).toBe(404);
    expect((await call(PRICES, "PUT", a.host, a.sessionId, {}, { dishId: b.dishId, variant: null, unitCentavos: 1, expectedRevision: 0 })).status).toBe(404);
    await call(PRICES, "PUT", a.host, a.sessionId, {}, { dishId: a.dishId, variant: null, unitCentavos: 100, expectedRevision: 0 });
    expect((await call(PRICES, "PUT", a.host, a.sessionId, {}, { dishId: a.dishId, variant: null, unitCentavos: 200, expectedRevision: 0 })).status).toBe(409);
  });
});

describe("D1: ordering and serving stay refused on a closed order", () => {
  it("O01 add dish, open a round, mark ready, serve: all 409 SESSION_CLOSED for the host on an ended order, nothing written", async () => {
    const t = await ended();
    const before = await state(t.sessionId);
    const add = await call(ENTRIES_POST, "POST", t.host, t.sessionId, {}, { dishName: "Late dish", quantity: 1, attribution: { type: "TABLE" } });
    const round = await call(ROUNDS_POST, "POST", t.host, t.sessionId, {}, {});
    const ready = await call(READINESS, "PUT", t.host, t.sessionId, {}, { ready: true });
    const served = await call(SERVING, "POST", t.host, t.sessionId, {}, { roundId: t.snap.rounds[0].id, lineKey: "x", delta: 1 });
    for (const r of [add, round, ready, served]) expect([r.status, r.body.error?.code]).toEqual([409, "SESSION_CLOSED"]);
    expect(await state(t.sessionId)).toBe(before);
    expect((await getSnapshot(db, t.host.actor)).entries.map((e) => e.dishName)).not.toContain("Late dish");
  });

  it("O02 the same four are refused for a guest on an ended order (409 SESSION_CLOSED or 403), never applied", async () => {
    const t = await ended();
    const before = await state(t.sessionId);
    const add = await call(ENTRIES_POST, "POST", t.ana, t.sessionId, {}, { dishName: "Late dish", quantity: 1, attribution: { type: "TABLE" } });
    const ready = await call(READINESS, "PUT", t.ana, t.sessionId, {}, { ready: true });
    for (const r of [add, ready]) expect([403, 409]).toContain(r.status);
    expect(await state(t.sessionId)).toBe(before);
  });
});

describe("D1: ended-order snapshot", () => {
  it("N01 after End the guest's /sync shows the host's later price, service charge and receipt total", async () => {
    const t = await ended();
    await call(ENTRY_SETTLEMENT, "PUT", t.host, t.sessionId, { entryId: t.ownEntry }, { expectedRevision: 0, unitPriceCentavos: 25000 });
    await call(SERVICE_CHARGE, "PUT", t.host, t.sessionId, {}, { expectedRevision: 0, centavos: 2500 });
    await call(RECEIPT, "PUT", t.host, t.sessionId, {}, { expectedRevision: 0, centavos: 27500 });
    const s = await getSnapshot(db, t.ana.actor);
    expect(s.session.status).toBe("CLOSED");
    expect(s.settlement.entries[t.ownEntry].unitCentavos).toBe(25000);
    expect(s.settlement.serviceCharge.centavos).toBe(2500);
    expect(s.settlement.receiptTotal.centavos).toBe(27500);
  });

  it("N02 an ended order with a billing write is never marked as an extra confirmable change: no new round is created", async () => {
    const t = await ended();
    const rounds0 = (await getSnapshot(db, t.host.actor)).rounds.length;
    await call(SERVICE_CHARGE, "PUT", t.host, t.sessionId, {}, { expectedRevision: 0, centavos: 100 });
    expect((await getSnapshot(db, t.host.actor)).rounds).toHaveLength(rounds0);
  });
});
