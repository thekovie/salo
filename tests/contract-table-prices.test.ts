/**
 * Contract tests for PUT /api/sessions/:id/prices (KKB table price). Golden contract: docs/contracts/table-prices.md.
 * Drives the real route handler against the real test database (salo_test); only the cookie jar is faked.
 * Run: pnpm vitest run tests/contract-table-prices.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { PUT } from "@/app/api/sessions/[id]/prices/route";
import { GET as SYNC } from "@/app/api/sessions/[id]/sync/route";
import { PUT as SERVICE_CHARGE } from "@/app/api/sessions/[id]/service-charge/route";
import { buildKkb } from "@/lib/kkb";
import type { Actor } from "@/lib/permissions";
import { proxy } from "@/proxy";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { confirmedRoundSnapshots, sessionEvents, sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { removeParticipant, setReady } from "@/server/orders/people";
import { closeSession, confirmRound, openRound, recordCorrection } from "@/server/orders/rounds";
import { setEntrySettlement } from "@/server/orders/settlement";
import { entrySettlementSchema } from "@/server/orders/validation";
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

// ---------- harness ----------
const DEADLINE_MS = 15_000;
function within<T>(p: Promise<T>, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`deadline: ${what}`)), DEADLINE_MS)));
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

interface Who {
  token: string | null;
}
interface Res {
  status: number;
  body: { data?: { result: unknown; revision: number; replayed: boolean }; error?: { code: string; message: string } };
}
async function put(sessionId: string, who: Who | null, body: unknown, opts: { idem?: string | null; raw?: string } = {}): Promise<Res> {
  jar.cookies = who?.token ? { [credentialCookieName(sessionId)]: who.token } : {};
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost:3000" };
  if (opts.idem !== null) headers["idempotency-key"] = opts.idem ?? key();
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/prices`, { method: "PUT", headers, body: opts.raw ?? JSON.stringify(body) });
  const res = await within(PUT(req, { params: Promise.resolve({ id: sessionId }) }), "PUT prices");
  return { status: res.status, body: await res.json() };
}
async function sync(sessionId: string, who: Who) {
  jar.cookies = { [credentialCookieName(sessionId)]: who.token! };
  const res = await within(SYNC(new Request("http://localhost:3000/x"), { params: Promise.resolve({ id: sessionId }) }), "GET sync");
  return (await res.json()).data as Awaited<ReturnType<typeof getSnapshot>>;
}

async function guestOf(sessionId: string, name = "Ana") {
  const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, sessionId));
  const joined = await joinSession(db, code, name, sessionId);
  const actor = (await resolveActor(db, sessionId, joined.token)) as Actor;
  return { actor, token: joined.token };
}

const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3], type = "t") => runMutation(db, actor, { idempotencyKey: key(), type }, apply);
const tableKey = (dishId: string, size = "") => `${dishId}|${size}`;

async function setup() {
  const { host, sessionId, token } = await newSession(db);
  return { host, sessionId, hostWho: { token } as Who };
}
/** An entry in the draft round plus its dish id. */
async function dish(host: Actor, dishName: string, variant: string | null = null, extra: Record<string, unknown> = {}) {
  const e = await add(db, host, { dishName, quantity: 1, variant, attribution: { type: "TABLE" }, ...extra });
  const snap = await getSnapshot(db, host);
  const entry = snap.entries.find((x) => x.id === e.result.entryId)!;
  return { entryId: entry.id, dishId: entry.dishId };
}
const defaultsOf = async (host: Actor) => (await getSnapshot(db, host)).settlement.defaults;
const revOf = async (host: Actor, k: string) => (await defaultsOf(host))[k]?.revision ?? 0;
const sessionRev = async (sessionId: string) => (await db.select({ r: sessions.revision }).from(sessions).where(eq(sessions.id, sessionId)))[0].r;
const eventTypes = async (sessionId: string) => (await db.select({ t: sessionEvents.eventType, r: sessionEvents.revision }).from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId)).orderBy(sessionEvents.revision)).map((x) => x.t);
// docs/data-model.md says clearing deletes the row; the revision rule ("always increases, even across a clear") needs a tombstone.
// So rowCount counts rows that still hold a price, and totalRows counts every row (tombstones included).
const rowCount = async (sessionId: string) => ((await db.execute(sql`SELECT count(*)::int AS n FROM shared_prices WHERE session_id = ${sessionId} AND unit_centavos IS NOT NULL`)) as unknown as { n: number }[])[0].n;
const totalRows = async (sessionId: string) => ((await db.execute(sql`SELECT count(*)::int AS n FROM shared_prices WHERE session_id = ${sessionId}`)) as unknown as { n: number }[])[0].n;
const entryPrice = async (host: Actor, entryId: string) => (await getSnapshot(db, host)).settlement.entries[entryId];
const ownPrice = (host: Actor, entryId: string, unit: number | null, expectedRevision = 0) => run(host, (tx, s) => setEntrySettlement(tx, s, host, entryId, entrySettlementSchema.parse({ expectedRevision, unitPriceCentavos: unit })), `entry.settle:${entryId}`);
const body = (dishId: string, variant: string | null, unitCentavos: number | null, expectedRevision: number, more: Record<string, unknown> = {}) => ({ dishId, variant, unitCentavos, expectedRevision, ...more });
const allLines = (snap: Awaited<ReturnType<typeof getSnapshot>>, meId: string) => buildKkb(snap, meId).sections.flatMap((s) => [...s.lines, ...s.drafts]);

/** State that must not move when a request is refused. */
async function fingerprint(host: Actor, sessionId: string) {
  const snap = await getSnapshot(db, host);
  return JSON.stringify({ rev: await sessionRev(sessionId), defaults: snap.settlement.defaults, entries: snap.settlement.entries, events: await eventTypes(sessionId), rows: await totalRows(sessionId) });
}
async function expectRefused(sessionId: string, host: Actor, who: Who | null, payload: unknown, status: number | number[], code?: string, opts: { idem?: string | null; raw?: string } = {}) {
  const before = await fingerprint(host, sessionId);
  const r = await put(sessionId, who, payload, opts);
  expect(Array.isArray(status) ? status : [status]).toContain(r.status);
  expect(r.body.data).toBeUndefined();
  expect(typeof r.body.error?.message).toBe("string");
  if (code) expect(r.body.error?.code).toBe(code);
  expect(await fingerprint(host, sessionId)).toBe(before);
  return r;
}

// ---------- happy path and key ----------
describe("PUT /prices: happy path, key, revision", () => {
  it("T01 host sets a price: 200 envelope, one revision bump, one price.defaultSet event, snapshot shows it", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu", "Large");
    const before = await sessionRev(sessionId);
    const r = await put(sessionId, hostWho, body(d.dishId, "Large", 12000, 0));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ revision: before + 1, replayed: false });
    expect(await sessionRev(sessionId)).toBe(before + 1);
    expect((await eventTypes(sessionId)).slice(-1)).toEqual(["price.defaultSet"]);
    expect((await defaultsOf(host))[tableKey(d.dishId, "large")]).toEqual({ unitCentavos: 12000, revision: 1 });
    expect(await rowCount(sessionId)).toBe(1);
  });

  it("T02 size key ignores case and spacing; empty size is its own key; other dish unaffected", async () => {
    const { host, sessionId, hostWho } = await setup();
    const large = await dish(host, "Katsu", "Extra Large");
    const none = await dish(host, "Katsu"); // same dish, empty size
    const other = await dish(host, "Ramen", "Extra Large");
    expect(none.dishId).toBe(large.dishId);
    expect((await put(sessionId, hostWho, body(large.dishId, "Extra Large", 100, 0))).status).toBe(200);
    expect((await put(sessionId, hostWho, body(large.dishId, "  extra   LARGE ", 200, 1))).status).toBe(200);
    expect((await put(sessionId, hostWho, body(large.dishId, "extra large", 300, 1))).status).toBe(409);
    const d = await defaultsOf(host);
    expect(Object.keys(d)).toHaveLength(1);
    expect(d[tableKey(large.dishId, "extra large")]).toEqual({ unitCentavos: 200, revision: 2 });
    // empty size: "", null and whitespace are one key, and not the "extra large" key
    expect((await put(sessionId, hostWho, body(large.dishId, null, 50, 0))).status).toBe(200);
    expect((await put(sessionId, hostWho, body(large.dishId, "", 60, 1))).status).toBe(200);
    expect((await put(sessionId, hostWho, body(large.dishId, "   ", 70, 2))).status).toBe(200);
    const d2 = await defaultsOf(host);
    expect(d2[tableKey(large.dishId, "")]).toEqual({ unitCentavos: 70, revision: 3 });
    expect(d2[tableKey(large.dishId, "extra large")].unitCentavos).toBe(200);
    expect(d2[tableKey(other.dishId, "extra large")]).toBeUndefined();
  });

  it("T03 boundaries 0 and 9,999,999 are accepted (0 is a real price)", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Tea");
    expect((await put(sessionId, hostWho, body(d.dishId, null, 0, 0))).status).toBe(200);
    expect((await defaultsOf(host))[tableKey(d.dishId)].unitCentavos).toBe(0);
    expect((await put(sessionId, hostWho, body(d.dishId, null, 9_999_999, 1))).status).toBe(200);
    expect((await defaultsOf(host))[tableKey(d.dishId)]).toEqual({ unitCentavos: 9_999_999, revision: 2 });
  });

  it("T04 null clears: the price is gone, revision still increases, event emitted, key reusable", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu", "Large");
    const k = tableKey(d.dishId, "large");
    await put(sessionId, hostWho, body(d.dishId, "Large", 100, 0));
    await put(sessionId, hostWho, body(d.dishId, "Large", 200, 1));
    const before = await sessionRev(sessionId);
    const r = await put(sessionId, hostWho, body(d.dishId, "Large", null, 2));
    expect(r.status).toBe(200);
    expect(await sessionRev(sessionId)).toBe(before + 1);
    expect((await eventTypes(sessionId)).slice(-1)).toEqual(["price.defaultSet"]);
    expect((await defaultsOf(host))[k]?.unitCentavos ?? null).toBeNull();
    expect(await rowCount(sessionId)).toBe(0);
    // "The revision always increases, even across a clear": set again with whatever the snapshot shows now;
    // the resulting revision must be higher than anything shown before the clear (2).
    const seen = await revOf(host, k);
    const again = await put(sessionId, hostWho, body(d.dishId, "Large", 300, seen));
    expect(again.status).toBe(200);
    expect((await defaultsOf(host))[k].revision).toBeGreaterThan(2);
  });

  it("T05 clearing something that has no price is not an error and still leaves no price", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    const r = await put(sessionId, hostWho, body(d.dishId, null, null, 0));
    expect(r.status).toBe(200);
    expect((await defaultsOf(host))[tableKey(d.dishId)]?.unitCentavos ?? null).toBeNull();
    expect(await rowCount(sessionId)).toBe(0);
  });
});

describe("PUT /prices: optimistic locking", () => {
  it("T06 stale expectedRevision -> 409 CONFLICT, nothing changes; fresh one succeeds", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    await put(sessionId, hostWho, body(d.dishId, null, 100, 0));
    await expectRefused(sessionId, host, hostWho, body(d.dishId, null, 200, 0), 409, "CONFLICT");
    await expectRefused(sessionId, host, hostWho, body(d.dishId, null, 200, 5), 409, "CONFLICT"); // from the future
    expect((await put(sessionId, hostWho, body(d.dishId, null, 200, 1))).status).toBe(200);
  });

  it("T07 set -> clear -> set: no revision is reused, and a writer who saw an old revision cannot slip in (ABA)", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    const k = tableKey(d.dishId);
    await put(sessionId, hostWho, body(d.dishId, null, 100, 0));
    const first = await revOf(host, k); // 1
    await put(sessionId, hostWho, body(d.dishId, null, null, first));
    const afterClear = await revOf(host, k);
    await put(sessionId, hostWho, body(d.dishId, null, 300, afterClear));
    expect(await revOf(host, k)).toBeGreaterThan(first);
    // the client that looked at revision 1 (before the clear) must be refused now
    await expectRefused(sessionId, host, hostWho, body(d.dishId, null, 999, first), 409, "CONFLICT");
    expect((await defaultsOf(host))[k].unitCentavos).toBe(300);
  });
});

describe("PUT /prices: idempotency", () => {
  it("T08 a retried key is applied once and returns the first result with replayed: true", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    const idem = key();
    const first = await put(sessionId, hostWho, body(d.dishId, null, 100, 0), { idem });
    const events = (await eventTypes(sessionId)).length;
    const rev = await sessionRev(sessionId);
    const second = await put(sessionId, hostWho, body(d.dishId, null, 100, 0), { idem });
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({ replayed: true, revision: first.body.data?.revision });
    expect(await sessionRev(sessionId)).toBe(rev);
    expect((await eventTypes(sessionId)).length).toBe(events);
    expect((await defaultsOf(host))[tableKey(d.dishId)].revision).toBe(1);
  });

  it("T09 a replay after the price moved on returns the old result and does not roll back", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    const idem = key();
    await put(sessionId, hostWho, body(d.dishId, null, 100, 0), { idem });
    await put(sessionId, hostWho, body(d.dishId, null, 250, 1));
    const replay = await put(sessionId, hostWho, body(d.dishId, null, 100, 0), { idem });
    expect(replay.status).toBe(200);
    expect(replay.body.data?.replayed).toBe(true);
    expect((await defaultsOf(host))[tableKey(d.dishId)]).toEqual({ unitCentavos: 250, revision: 2 });
  });

  it("T10 the same key on a different kind of change -> 422 IDEMPOTENCY_KEY_REUSED, nothing applied", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    const idem = key();
    jar.cookies = { [credentialCookieName(sessionId)]: hostWho.token! };
    const sc = await SERVICE_CHARGE(
      new Request("http://localhost:3000/x", { method: "PUT", headers: { "content-type": "application/json", "idempotency-key": idem }, body: JSON.stringify({ expectedRevision: 0, centavos: 500 }) }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(sc.status).toBe(200);
    await expectRefused(sessionId, host, hostWho, body(d.dishId, null, 100, 0), 422, "IDEMPOTENCY_KEY_REUSED", { idem });
  });

  it("T11 the same key aimed at another dish is not applied silently (bound to kind and target)", async () => {
    const { host, sessionId, hostWho } = await setup();
    const a = await dish(host, "Katsu");
    const b = await dish(host, "Ramen");
    const idem = key();
    await put(sessionId, hostWho, body(a.dishId, null, 100, 0), { idem });
    const r = await put(sessionId, hostWho, body(b.dishId, null, 200, 0), { idem });
    // docs/api.md: idempotency is "bound to the change's kind and target". Reuse for another target must not apply a second change.
    expect((await defaultsOf(host))[tableKey(b.dishId)]?.unitCentavos ?? null).toBeNull();
    expect(r.status).toBe(422);
  });

  it("T12 missing or malformed Idempotency-Key -> 400 IDEMPOTENCY_KEY", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    await expectRefused(sessionId, host, hostWho, body(d.dishId, null, 100, 0), 400, "IDEMPOTENCY_KEY", { idem: null });
    await expectRefused(sessionId, host, hostWho, body(d.dishId, null, 100, 0), 400, "IDEMPOTENCY_KEY", { idem: "short" });
    await expectRefused(sessionId, host, hostWho, body(d.dishId, null, 100, 0), 400, "IDEMPOTENCY_KEY", { idem: "has spaces and !! chars" });
    await expectRefused(sessionId, host, hostWho, body(d.dishId, null, 100, 0), 400, "IDEMPOTENCY_KEY", { idem: "a".repeat(101) });
  });
});

// ---------- validation ----------
describe("PUT /prices: malformed input -> 422 INVALID (400 BAD_JSON, 413 TOO_LARGE), never a change", () => {
  it("T13 unitCentavos out of range, fractional, wrong type or missing", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    for (const bad of [-1, 10_000_000, 1.5, "100", true, [], {}]) {
      await expectRefused(sessionId, host, hostWho, { dishId: d.dishId, variant: null, unitCentavos: bad, expectedRevision: 0 }, 422, "INVALID");
    }
    await expectRefused(sessionId, host, hostWho, { dishId: d.dishId, variant: null, expectedRevision: 0 }, 422, "INVALID"); // missing: null is how you clear
  });

  it("T14 expectedRevision negative, fractional, string, null or missing", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    for (const bad of [-1, 0.5, "0", null, true]) {
      await expectRefused(sessionId, host, hostWho, { dishId: d.dishId, variant: null, unitCentavos: 100, expectedRevision: bad }, 422, "INVALID");
    }
    await expectRefused(sessionId, host, hostWho, { dishId: d.dishId, variant: null, unitCentavos: 100 }, 422, "INVALID");
  });

  it("T15 dishId must be a UUID; variant must be a string or null, <= 40 chars, no NUL", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    for (const bad of ["x", "", null, 7, undefined]) {
      await expectRefused(sessionId, host, hostWho, { dishId: bad, variant: null, unitCentavos: 100, expectedRevision: 0 }, 422, "INVALID");
    }
    for (const bad of [5, true, {}, "a".repeat(41), "bad\u0000size"]) {
      await expectRefused(sessionId, host, hostWho, { dishId: d.dishId, variant: bad, unitCentavos: 100, expectedRevision: 0 }, 422, "INVALID");
    }
    expect((await put(sessionId, hostWho, body(d.dishId, "a".repeat(40), 100, 0))).status).toBe(200); // 40 is the limit
  });

  it("T16 clearEntryId must be a UUID when present", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    for (const bad of ["nope", 5, "", {}]) {
      await expectRefused(sessionId, host, hostWho, body(d.dishId, null, 100, 0, { clearEntryId: bad }), 422, "INVALID");
    }
  });

  it("T17 body: not JSON -> 400 BAD_JSON; array, string, empty -> 422; over 8 KB -> 413 TOO_LARGE", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    await expectRefused(sessionId, host, hostWho, null, 400, "BAD_JSON", { raw: "{not json" });
    await expectRefused(sessionId, host, hostWho, [], 422, "INVALID");
    await expectRefused(sessionId, host, hostWho, "text", 422, "INVALID");
    await expectRefused(sessionId, host, hostWho, null, 422, "INVALID", { raw: "" });
    await expectRefused(sessionId, host, hostWho, body(d.dishId, "x".repeat(9000), 1, 0), 413, "TOO_LARGE");
  });
});

// ---------- authorization ----------
describe("PUT /prices: who may call", () => {
  it("T18 guest -> 403 FORBIDDEN; nothing changes (even for a guest who submitted that dish)", async () => {
    const { host, sessionId } = await setup();
    const { actor: ana, token } = await guestOf(sessionId);
    const e = await add(db, ana, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    const dishId = (await getSnapshot(db, host)).entries.find((x) => x.id === e.result.entryId)!.dishId;
    await expectRefused(sessionId, host, { token }, body(dishId, null, 100, 0), 403, "FORBIDDEN");
    await expectRefused(sessionId, host, { token }, body(dishId, null, null, 0), 403, "FORBIDDEN");
  });

  it("T19 no cookie, garbage cookie -> 404 NOT_FOUND (no hint the order exists)", async () => {
    const { host, sessionId } = await setup();
    const d = await dish(host, "Katsu");
    await expectRefused(sessionId, host, null, body(d.dishId, null, 100, 0), 404, "NOT_FOUND");
    await expectRefused(sessionId, host, { token: "garbage-token" }, body(d.dishId, null, 100, 0), 404, "NOT_FOUND");
  });

  it("T20 another order's host (tenant): its token, even planted under this order's cookie name -> 404; this order untouched", async () => {
    const a = await setup();
    const b = await setup();
    const da = await dish(a.host, "Katsu");
    await expectRefused(a.sessionId, a.host, b.hostWho, body(da.dishId, null, 100, 0), 404, "NOT_FOUND");
    await expectRefused(b.sessionId, b.host, a.hostWho, body(da.dishId, null, 100, 0), 404, "NOT_FOUND");
    expect(await rowCount(a.sessionId)).toBe(0);
    expect(await rowCount(b.sessionId)).toBe(0);
  });

  it("T21 a removed guest is refused too", async () => {
    const { host, sessionId } = await setup();
    const d = await dish(host, "Katsu");
    const { actor, token } = await guestOf(sessionId);
    await run(host, (tx, s) => removeParticipant(tx, s, host, actor.participantId, null));
    const r = await put(sessionId, { token }, body(d.dishId, null, 100, 0));
    expect([403, 404]).toContain(r.status);
    expect(await rowCount(sessionId)).toBe(0);
  });

  it("T22 Origin: a non-GET /api request without or with a foreign Origin is refused 403 FORBIDDEN_ORIGIN by the proxy (CSRF)", async () => {
    const mk = (origin?: string) => new NextRequest("http://localhost:3000/api/sessions/x/prices", { method: "PUT", headers: origin ? { origin } : {} });
    for (const origin of [undefined, "https://evil.example", "http://localhost:3001"]) {
      const res = proxy(mk(origin));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN_ORIGIN");
    }
    expect(proxy(mk("http://localhost:3000")).status).toBe(200);
  });
});

// ---------- scoping ----------
describe("PUT /prices: dish, entry and session scoping", () => {
  it("T23 a dish from another session, or one that does not exist, is refused; no row in either order", async () => {
    const a = await setup();
    const b = await setup();
    const dB = await dish(b.host, "Katsu");
    await dish(a.host, "Ramen");
    await expectRefused(a.sessionId, a.host, a.hostWho, body(dB.dishId, null, 100, 0), [404, 422]);
    await expectRefused(a.sessionId, a.host, a.hostWho, body(randomUUID(), null, 100, 0), [404, 422]);
    // clearing someone else's dish is refused too, and does not touch their price
    await put(b.sessionId, b.hostWho, body(dB.dishId, null, 700, 0));
    await expectRefused(a.sessionId, a.host, a.hostWho, body(dB.dishId, null, null, 1), [404, 422]);
    expect((await defaultsOf(b.host))[tableKey(dB.dishId)]).toEqual({ unitCentavos: 700, revision: 1 });
    expect(await rowCount(a.sessionId)).toBe(0);
  });

  it("T24 a closed order is refused SESSION_CLOSED; the price stays as it was", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    await put(sessionId, hostWho, body(d.dishId, null, 100, 0));
    await run(host, (tx, s) => closeSession(tx, s, host));
    await expectRefused(sessionId, host, hostWho, body(d.dishId, null, 200, 1), 409, "SESSION_CLOSED");
    await expectRefused(sessionId, host, hostWho, body(d.dishId, null, null, 1), 409, "SESSION_CLOSED");
    expect((await defaultsOf(host))[tableKey(d.dishId)].unitCentavos).toBe(100);
  });

  it("T25 DB guard: a shared_prices row cannot point at a dish of another session, nor hold an out-of-range price or negative revision", async () => {
    const a = await setup();
    const b = await setup();
    const dB = await dish(b.host, "Katsu");
    const ins = (sid: string, dishId: string, unit: number, rev: number) =>
      db.execute(sql`INSERT INTO shared_prices (session_id, dish_id, variant_key, unit_centavos, revision, updated_by) VALUES (${sid}, ${dishId}, '', ${unit}, ${rev}, ${a.host.participantId})`);
    await expect(ins(a.sessionId, dB.dishId, 100, 1)).rejects.toThrow();
    const dA = await dish(a.host, "Ramen");
    await expect(ins(a.sessionId, dA.dishId, 10_000_000, 1)).rejects.toThrow();
    await expect(ins(a.sessionId, dA.dishId, -1, 1)).rejects.toThrow();
    await expect(ins(a.sessionId, dA.dishId, 1, -1)).rejects.toThrow();
  });

  it("T26 retention: deleting the order deletes its table prices", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    await put(sessionId, hostWho, body(d.dishId, null, 100, 0));
    expect(await rowCount(sessionId)).toBe(1);
    await db.execute(sql`DELETE FROM sessions WHERE id = ${sessionId}`);
    expect(await totalRows(sessionId)).toBe(0);
  });
});

// ---------- clearEntryId ----------
describe("PUT /prices: clearEntryId ('Every ... here')", () => {
  it("T27 sets the table price and clears that line's own price in one change (one revision, one event); line now follows the table", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu", "Large");
    await ownPrice(host, d.entryId, 5000);
    const before = await sessionRev(sessionId);
    const events = (await eventTypes(sessionId)).length;
    const r = await put(sessionId, hostWho, body(d.dishId, " large", 12000, 0, { clearEntryId: d.entryId, expectedEntryRevision: 1 }));
    expect(r.status).toBe(200);
    expect(await sessionRev(sessionId)).toBe(before + 1);
    expect((await eventTypes(sessionId)).length).toBe(events + 1);
    expect((await entryPrice(host, d.entryId))?.unitCentavos ?? null).toBeNull();
    expect((await defaultsOf(host))[tableKey(d.dishId, "large")].unitCentavos).toBe(12000);
    const line = allLines(await getSnapshot(db, host), host.participantId).find((l) => l.entryId === d.entryId)!;
    expect(line).toMatchObject({ unitCentavos: 12000, priceSource: "table" });
  });

  it("T28 an entry that is a different dish, a different size, in another session, or unknown -> refused, and neither price changes (atomic)", async () => {
    const a = await setup();
    const b = await setup();
    const large = await dish(a.host, "Katsu", "Large");
    const small = await dish(a.host, "Katsu", "Small");
    const ramen = await dish(a.host, "Ramen", "Large");
    const foreign = await dish(b.host, "Katsu", "Large");
    await ownPrice(a.host, small.entryId, 111);
    await ownPrice(a.host, ramen.entryId, 222);
    await ownPrice(b.host, foreign.entryId, 333);
    for (const clearEntryId of [small.entryId, ramen.entryId, foreign.entryId, randomUUID()]) {
      await expectRefused(a.sessionId, a.host, a.hostWho, body(large.dishId, "Large", 12000, 0, { clearEntryId, expectedEntryRevision: 1 }), [404, 409, 422]);
    }
    expect((await entryPrice(a.host, small.entryId)).unitCentavos).toBe(111);
    expect((await entryPrice(a.host, ramen.entryId)).unitCentavos).toBe(222);
    expect((await entryPrice(b.host, foreign.entryId)).unitCentavos).toBe(333);
    expect(await rowCount(a.sessionId)).toBe(0);
  });

  it("T29 a stale expectedRevision with clearEntryId -> 409 and the line keeps its own price", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    await put(sessionId, hostWho, body(d.dishId, null, 100, 0));
    await ownPrice(host, d.entryId, 5000);
    await expectRefused(sessionId, host, hostWho, body(d.dishId, null, 200, 0, { clearEntryId: d.entryId, expectedEntryRevision: 1 }), 409, "CONFLICT");
    expect((await entryPrice(host, d.entryId)).unitCentavos).toBe(5000);
  });

  it("T30 clearEntryId on a line with no own price is fine, and a replayed key does not clear a price set afterwards", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    const idem = key();
    expect((await put(sessionId, hostWho, body(d.dishId, null, 100, 0, { clearEntryId: d.entryId, expectedEntryRevision: 0 }), { idem })).status).toBe(200);
    await ownPrice(host, d.entryId, 777, (await entryPrice(host, d.entryId))?.revision ?? 0);
    const replay = await put(sessionId, hostWho, body(d.dishId, null, 100, 0, { clearEntryId: d.entryId, expectedEntryRevision: 0 }), { idem });
    expect(replay.body.data?.replayed).toBe(true);
    expect((await entryPrice(host, d.entryId)).unitCentavos).toBe(777);
  });

  it("T31 a guest cannot use clearEntryId to wipe a line's price (refused as a host-only action)", async () => {
    const { host, sessionId } = await setup();
    const { actor: ana, token } = await guestOf(sessionId);
    const e = await add(db, ana, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    const dishId = (await getSnapshot(db, host)).entries.find((x) => x.id === e.result.entryId)!.dishId;
    await ownPrice(ana, e.result.entryId, 4200);
    await expectRefused(sessionId, host, { token }, body(dishId, null, 100, 0, { clearEntryId: e.result.entryId, expectedEntryRevision: 1 }), 403, "FORBIDDEN");
    expect((await entryPrice(host, e.result.entryId)).unitCentavos).toBe(4200);
  });
});

describe("PUT /prices: clearEntryId lost update (coordinator code-review claim)", () => {
  it("T46 a line price a guest set after the host looked is not wiped unseen by 'Every ... here' (docs/security.md: every KKB write checks the row's own revision)", async () => {
    const { host, sessionId, hostWho } = await setup();
    const { actor: ana } = await guestOf(sessionId);
    const e = await add(db, ana, { dishName: "Katsu", quantity: 1, variant: "Large", attribution: { type: "INDIVIDUAL" } });
    const dishId = (await getSnapshot(db, host)).entries.find((x) => x.id === e.result.entryId)!.dishId;
    // The host's screen shows the line with no price of its own (line revision 0)...
    // ...then Ana prices her own line (revision 1). The host's request cannot say what it saw of the line.
    await ownPrice(ana, e.result.entryId, 4200, 0);
    const r = await put(sessionId, hostWho, body(dishId, "Large", 12000, 0, { clearEntryId: e.result.entryId, expectedEntryRevision: 0 }));
    // Expected: refused 409 CONFLICT (stale line) or at least Ana's 4200 survives. Actual today: 200 and the price is erased.
    const survived = (await entryPrice(host, e.result.entryId))?.unitCentavos === 4200;
    expect(r.status === 409 || survived).toBe(true);
  });
});

// ---------- KKB resolution ----------
describe("table price in KKB (via snapshot)", () => {
  it("T32 own price, then table price, then null (never 0); setting a table price never overwrites a line's own price; clearing the line's price returns it to the table", async () => {
    const { host, sessionId, hostWho } = await setup();
    const a = await dish(host, "Katsu", "Large");
    const b = await dish(host, "Katsu", "Large");
    const c = await dish(host, "Katsu", "Small");
    await ownPrice(host, b.entryId, 5000);
    let ls = allLines(await getSnapshot(db, host), host.participantId);
    expect(ls.find((l) => l.entryId === a.entryId)).toMatchObject({ unitCentavos: null, priceSource: null, subtotalCentavos: null });

    await put(sessionId, hostWho, body(a.dishId, "large", 12000, 0));
    ls = allLines(await getSnapshot(db, host), host.participantId);
    expect(ls.find((l) => l.entryId === a.entryId)).toMatchObject({ unitCentavos: 12000, priceSource: "table", subtotalCentavos: 12000 });
    expect(ls.find((l) => l.entryId === b.entryId)).toMatchObject({ unitCentavos: 5000, priceSource: "line" });
    expect(ls.find((l) => l.entryId === c.entryId)).toMatchObject({ unitCentavos: null, priceSource: null }); // other size
    expect((await entryPrice(host, b.entryId)).unitCentavos).toBe(5000); // untouched in the DB too

    await ownPrice(host, b.entryId, null, (await entryPrice(host, b.entryId)).revision);
    ls = allLines(await getSnapshot(db, host), host.participantId);
    expect(ls.find((l) => l.entryId === b.entryId)).toMatchObject({ unitCentavos: 12000, priceSource: "table" });

    // clearing the table price makes the line unknown again, not zero
    await put(sessionId, hostWho, body(a.dishId, "large", null, await revOf(host, tableKey(a.dishId, "large"))));
    ls = allLines(await getSnapshot(db, host), host.participantId);
    expect(ls.find((l) => l.entryId === a.entryId)).toMatchObject({ unitCentavos: null, priceSource: null });
  });

  it("T33 notes are ignored: dishes with different notes share the size's table price; a table price of 0 is a real price", async () => {
    const { host, sessionId, hostWho } = await setup();
    const a = await dish(host, "Katsu", "Large", { instructions: "no sauce" });
    const b = await dish(host, "Katsu", "LARGE", { instructions: "extra spicy" });
    await put(sessionId, hostWho, body(a.dishId, "large", 0, 0));
    const ls = allLines(await getSnapshot(db, host), host.participantId);
    for (const id of [a.entryId, b.entryId]) expect(ls.find((l) => l.entryId === id)).toMatchObject({ unitCentavos: 0, priceSource: "table" });
  });

  it("T34 replacement lines never inherit the table price", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu", "Large");
    await put(sessionId, hostWho, body(d.dishId, "large", 12000, 0));
    const snap0 = await getSnapshot(db, host);
    await run(host, (tx, s) => confirmRound(tx, s, host, snap0.activeRoundId, snap0.session.revision));
    await run(host, (tx, s) => openRound(tx, s, host));
    await run(host, (tx, s) => recordCorrection(tx, s, host, { sourceEntryId: d.entryId, type: "REPLACE", replacement: "Katsu" }));
    const snap1 = await getSnapshot(db, host);
    await run(host, (tx, s) => confirmRound(tx, s, host, snap1.activeRoundId, snap1.session.revision));
    const replacement = allLines(await getSnapshot(db, host), host.participantId).find((l) => l.correctionId != null);
    expect(replacement).toBeTruthy();
    expect(replacement).toMatchObject({ unitCentavos: null, priceSource: null });
  });

  it("T35 every participant's snapshot carries the table prices (read-only for guests): /sync as a guest shows defaults", async () => {
    const { host, sessionId, hostWho } = await setup();
    const { token } = await guestOf(sessionId);
    const d = await dish(host, "Katsu", "Large");
    await put(sessionId, hostWho, body(d.dishId, "Large", 12000, 0));
    const snap = await sync(sessionId, { token });
    expect(snap.settlement.defaults[tableKey(d.dishId, "large")]).toEqual({ unitCentavos: 12000, revision: 1 });
  });
});

// ---------- must not leak / must not stale ----------
describe("table price never reaches the waiter's ticket; never makes confirm stale", () => {
  const PRICE = 7_777_701; // distinctive: 77,777.01

  it("T36 ticket snapshots (stored and in /sync) and the invite lookup contain no price; events carry ids only", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu", "Large");
    await put(sessionId, hostWho, body(d.dishId, "Large", PRICE, 0));
    const snap = await getSnapshot(db, host);
    await run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, snap.session.revision));
    await put(sessionId, hostWho, body(d.dishId, "Large", PRICE + 1, 1));
    const stored = JSON.stringify((await db.select().from(confirmedRoundSnapshots)).map((r) => r.snapshotData));
    const after = await getSnapshot(db, host);
    for (const text of [stored, JSON.stringify(after.tickets)]) {
      expect(text).not.toContain("77777");
      expect(text).not.toMatch(/centavos|unitPrice|defaults/i);
    }
    const ev = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId));
    expect(JSON.stringify(ev.filter((e) => e.eventType === "price.defaultSet").map((e) => e.payload))).not.toContain("77777");
    expect(JSON.stringify(await findInvite(db, after.session.joinCode))).not.toMatch(/77777|centavos|price/i);
  });

  it("T37 setting, changing, clearing a table price (and clearEntryId) after the host looked does not make confirm stale", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu", "Large");
    const e2 = await dish(host, "Katsu", "Large");
    await ownPrice(host, e2.entryId, 100);
    const looked = (await getSnapshot(db, host)).session.revision;
    await put(sessionId, hostWho, body(d.dishId, "Large", 12000, 0));
    await put(sessionId, hostWho, body(d.dishId, "Large", 13000, 1, { clearEntryId: e2.entryId, expectedEntryRevision: 1 }));
    await put(sessionId, hostWho, body(d.dishId, "Large", null, 2));
    await put(sessionId, hostWho, body(d.dishId, "Large", 500, await revOf(host, tableKey(d.dishId, "large"))));
    const snap = await getSnapshot(db, host);
    expect(snap.session.revision).toBeGreaterThan(looked);
    const r = await run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, looked)); // the old revision
    expect(r.result.roundId).toBe(snap.activeRoundId);
  });

  it("T38 control: a ticket-changing edit after the host looked still makes confirm stale (the harness can see staleness)", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu", "Large");
    const looked = (await getSnapshot(db, host)).session.revision;
    await put(sessionId, hostWho, body(d.dishId, "Large", 100, 0));
    await dish(host, "Ramen");
    const snap = await getSnapshot(db, host);
    await expect(run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, looked))).rejects.toMatchObject({ code: "STALE_REVISION" });
  });

  it("T39 a table price does not reset anyone's readiness", async () => {
    const { host, sessionId, hostWho } = await setup();
    const { actor: ana } = await guestOf(sessionId);
    const e = await add(db, ana, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await run(ana, (tx, s) => setReady(tx, s, ana, true));
    const dishId = (await getSnapshot(db, host)).entries.find((x) => x.id === e.result.entryId)!.dishId;
    await put(sessionId, hostWho, body(dishId, null, 100, 0));
    await put(sessionId, hostWho, body(dishId, null, null, 1));
    expect((await getSnapshot(db, host)).readiness.find((r) => r.participantId === ana.participantId)?.ready).toBe(true);
  });
});

// ---------- concurrency ----------
describe("PUT /prices: races", () => {
  it("T40 two writers with the same expectedRevision: exactly one wins, one gets 409, state matches the winner", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    const rs = await Promise.all([put(sessionId, hostWho, body(d.dishId, null, 111, 0)), put(sessionId, hostWho, body(d.dishId, null, 222, 0))]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = rs[0].status === 200 ? 111 : 222;
    expect((await defaultsOf(host))[tableKey(d.dishId)]).toEqual({ unitCentavos: winner, revision: 1 });
    expect(await rowCount(sessionId)).toBe(1);
  });

  it("T41 the same idempotency key sent twice at once is applied once", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    const idem = key();
    const before = await sessionRev(sessionId);
    const rs = await Promise.all([put(sessionId, hostWho, body(d.dishId, null, 111, 0), { idem }), put(sessionId, hostWho, body(d.dishId, null, 111, 0), { idem })]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(rs.filter((r) => r.body.data?.replayed).length).toBe(1);
    expect(await sessionRev(sessionId)).toBe(before + 1);
    expect((await defaultsOf(host))[tableKey(d.dishId)].revision).toBe(1);
  });

  it("T42 writers on different sizes/dishes do not conflict with each other (each key has its own revision)", async () => {
    const { host, sessionId, hostWho } = await setup();
    const a = await dish(host, "Katsu", "Large");
    const b = await dish(host, "Katsu", "Small");
    const c = await dish(host, "Ramen");
    const before = await sessionRev(sessionId);
    const rs = await Promise.all([put(sessionId, hostWho, body(a.dishId, "Large", 1, 0)), put(sessionId, hostWho, body(b.dishId, "Small", 2, 0)), put(sessionId, hostWho, body(c.dishId, null, 3, 0))]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await sessionRev(sessionId)).toBe(before + 3);
    expect(await rowCount(sessionId)).toBe(3);
  });

  it("T43 'Every ... here' racing the line's own edit leaves one coherent price for the line", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu", "Large");
    await ownPrice(host, d.entryId, 5000);
    const [r1, r2] = await Promise.all([
      put(sessionId, hostWho, body(d.dishId, "Large", 12000, 0, { clearEntryId: d.entryId, expectedEntryRevision: 1 })),
      ownPrice(host, d.entryId, 6000, 1).then(
        () => "ok",
        (e: { status?: number }) => `err${e.status}`,
      ),
    ]);
    // The line's own edit may land first; then "Every ... here" is refused as stale instead of wiping it.
    expect([200, 409]).toContain(r1.status);
    expect(["ok", "err409"]).toContain(r2);
    const line = allLines(await getSnapshot(db, host), host.participantId).find((l) => l.entryId === d.entryId)!;
    expect([12000, 6000]).toContain(line.unitCentavos);
    if (r1.status === 409) expect(line.unitCentavos).toBe(6000);
  });

  it("T44 a committed change rings the realtime bell (pg_notify on salo_events) within 15 s", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    let got: (v: string) => void = () => undefined;
    const heard = new Promise<string>((res) => (got = res));
    const sub = await db.$client.listen("salo_events", (payload) => {
      if (payload.includes(sessionId)) got(payload);
    });
    try {
      const [msg] = await within(Promise.all([heard, put(sessionId, hostWho, body(d.dishId, null, 100, 0))]), "notify after PUT");
      expect(msg).toContain(sessionId);
    } finally {
      await sub.unlisten();
    }
  });
});

describe("PUT /prices: limits", () => {
  it("T45 more than 120 changes a minute by one participant -> 429 RATE_LIMITED", async () => {
    const { host, sessionId, hostWho } = await setup();
    const d = await dish(host, "Katsu");
    let rev = 0;
    let limited: Res | null = null;
    for (let i = 0; i < 130 && !limited; i++) {
      const r = await put(sessionId, hostWho, body(d.dishId, null, 100 + i, rev));
      if (r.status === 200) rev = await revOf(host, tableKey(d.dishId));
      else limited = r;
    }
    expect(limited?.status).toBe(429);
    expect(limited?.body.error?.code).toBe("RATE_LIMITED");
  });
});
