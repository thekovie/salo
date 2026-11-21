/** Contract tests for PUT /api/sessions/:id/receipt-total and its reconciliation. Golden contract: docs/contracts/receipt-total.md. */
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { POST as UNAVAILABLE } from "@/app/api/sessions/[id]/dishes/[dishId]/unavailable/route";
import { GET as SESSION_GET } from "@/app/api/sessions/[id]/route";
import { PUT } from "@/app/api/sessions/[id]/receipt-total/route";
import { PUT as SERVICE_CHARGE } from "@/app/api/sessions/[id]/service-charge/route";
import { GET as SYNC } from "@/app/api/sessions/[id]/sync/route";
import { buildKkb, kkbText, priceCompleteness, reconcile, saloTotal } from "@/lib/kkb";
import { formatPeso } from "@/lib/money";
import type { Actor } from "@/lib/permissions";
import { buildSummary, summaryText } from "@/lib/summary";
import { snapshotText } from "@/lib/ticket";
import { proxy } from "@/proxy";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { confirmedRoundSnapshots, sessionEvents, sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { removeParticipant, setReady } from "@/server/orders/people";
import { closeSession, confirmRound, openRound, recordCorrections } from "@/server/orders/rounds";
import { setCorrectionPrice, setEntrySettlement, setServiceCharge, setSharedPrice } from "@/server/orders/settlement";
import { correctionBatchSchema, correctionPriceSchema, entrySettlementSchema, serviceChargeSchema, sharedPriceSchema } from "@/server/orders/validation";
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
const MAX = 99_999_999;
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
  body: { data?: { result: { revision: number }; revision: number; replayed: boolean }; error?: { code: string; message: string } };
}
type Snap = Awaited<ReturnType<typeof getSnapshot>>;
type Opts = { idem?: string | null; raw?: string };
async function call(handler: typeof PUT, path: string, sessionId: string, who: Who | null, payload: unknown, opts: Opts = {}): Promise<Res> {
  jar.cookies = who?.token ? { [credentialCookieName(sessionId)]: who.token } : {};
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost:3000" };
  if (opts.idem !== null) headers["idempotency-key"] = opts.idem ?? key();
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/${path}`, { method: "PUT", headers, body: opts.raw ?? JSON.stringify(payload) });
  const res = await within(handler(req, { params: Promise.resolve({ id: sessionId }) }), `PUT ${path}`);
  return { status: res.status, body: await res.json() };
}
const put = (sessionId: string, who: Who | null, payload: unknown, opts: Opts = {}) => call(PUT, "receipt-total", sessionId, who, payload, opts);
const putCharge = (sessionId: string, who: Who | null, payload: unknown, opts: Opts = {}) => call(SERVICE_CHARGE, "service-charge", sessionId, who, payload, opts);
async function sync(sessionId: string, who: Who) {
  jar.cookies = { [credentialCookieName(sessionId)]: who.token! };
  const res = await within(SYNC(new Request("http://localhost:3000/x"), { params: Promise.resolve({ id: sessionId }) }), "GET sync");
  return (await res.json()).data as Snap;
}
async function unavailable(sessionId: string, who: Who, dishId: string, payload: Record<string, unknown>) {
  jar.cookies = { [credentialCookieName(sessionId)]: who.token! };
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/dishes/${dishId}/unavailable`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", "idempotency-key": key() },
    body: JSON.stringify(payload),
  });
  const res = await within(UNAVAILABLE(req, { params: Promise.resolve({ id: sessionId, dishId }) }), "POST unavailable");
  return { status: res.status, body: await res.json() };
}

async function guestOf(sessionId: string, name = "Ana") {
  const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, sessionId));
  const joined = await joinSession(db, code, name, sessionId);
  const actor = (await resolveActor(db, sessionId, joined.token)) as Actor;
  return { actor, token: joined.token };
}
const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3], type = "t") => runMutation(db, actor, { idempotencyKey: key(), type }, apply);

const sessionRev = async (sessionId: string) => (await db.select({ r: sessions.revision }).from(sessions).where(eq(sessions.id, sessionId)))[0].r;
const receiptRow = async (sessionId: string) => (await db.select({ c: sessions.receiptTotalCentavos, r: sessions.receiptTotalRevision }).from(sessions).where(eq(sessions.id, sessionId)))[0];
const eventRows = (sessionId: string) => db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId)).orderBy(sessionEvents.revision);
const eventTypes = async (sessionId: string) => (await eventRows(sessionId)).map((x) => x.eventType);
const receiptEvents = async (sessionId: string) => (await eventTypes(sessionId)).filter((e) => e === "session.receiptTotal").length;

async function confirm(host: Actor) {
  const snap = await getSnapshot(db, host);
  return run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, snap.session.revision));
}
const open = (host: Actor) => run(host, (tx, s) => openRound(tx, s, host));
const correct = (host: Actor, input: Record<string, unknown>) => run(host, (tx, s) => recordCorrections(tx, s, host, correctionBatchSchema.parse(input)));
const priceEntry = (host: Actor, entryId: string, unit: number | null, expectedRevision = 0) =>
  run(host, (tx, s) => setEntrySettlement(tx, s, host, entryId, entrySettlementSchema.parse({ expectedRevision, unitPriceCentavos: unit })), `entry.settle:${entryId}`);
const setCharge = (host: Actor, centavos: number | null, expectedRevision = 0) => run(host, (tx, s) => setServiceCharge(tx, s, host, serviceChargeSchema.parse({ expectedRevision, centavos })), "session.serviceCharge");
const tablePrice = (host: Actor, dishId: string, variant: string | null, unitCentavos: number | null, expectedRevision = 0) =>
  run(host, (tx, s) => setSharedPrice(tx, s, host, sharedPriceSchema.parse({ dishId, variant, unitCentavos, expectedRevision })), `price.default:${dishId}`);

interface LineSpec {
  who?: "host" | "ana";
  name: string;
  qty: number;
  unit?: number | null;
  variant?: string | null;
  notes?: string | null;
  attr?: "INDIVIDUAL" | "TABLE";
}
/** Round 1 confirmed with the given lines (INDIVIDUAL unless `attr`), each priced when `unit` is a number. */
async function scene(lines: LineSpec[], charge: number | null | undefined = undefined) {
  const { host, sessionId, token } = await newSession(db);
  const ana = await guestOf(sessionId, "Ana");
  const ids: string[] = [];
  for (const l of lines) {
    const e = await add(db, l.who === "ana" ? ana.actor : host, { dishName: l.name, quantity: l.qty, variant: l.variant ?? null, instructions: l.notes ?? null, attribution: { type: l.attr ?? "INDIVIDUAL" } });
    ids.push(e.result.entryId);
  }
  await confirm(host);
  for (let i = 0; i < lines.length; i++) if (typeof lines[i].unit === "number") await priceEntry(host, ids[i], lines[i].unit!);
  if (charge !== undefined) await setCharge(host, charge);
  const snap = await getSnapshot(db, host);
  return { host, sessionId, hostWho: { token } as Who, ana, anaWho: { token: ana.token } as Who, ids, roundId: snap.rounds[0].id, dishIds: ids.map((id) => snap.entries.find((e) => e.id === id)!.dishId) };
}
type Scene = Awaited<ReturnType<typeof scene>>;
const kkbOf = async (t: Pick<Scene, "host">) => buildKkb(await getSnapshot(db, t.host), t.host.participantId);

/** The receipt check as the view computes it: set the receipt through the route, read the snapshot, run buildKkb + reconcile. */
async function check(t: Pick<Scene, "host" | "sessionId" | "hostWho">, receipt: number) {
  const r = await put(t.sessionId, t.hostWho, { expectedRevision: (await receiptRow(t.sessionId)).r, centavos: receipt });
  expect(r.status).toBe(200);
  const snap = await sync(t.sessionId, t.hostWho);
  const kkb = buildKkb(snap, t.host.participantId);
  return { snap, kkb, comp: priceCompleteness(kkb), salo: saloTotal(kkb), rec: reconcile(kkb, snap.settlement.receiptTotal.centavos!) };
}

/** State that must not move when a request is refused. */
async function fingerprint(host: Actor, sessionId: string) {
  const snap = await getSnapshot(db, host);
  return JSON.stringify({ rev: await sessionRev(sessionId), receipt: await receiptRow(sessionId), settlement: snap.settlement, events: await eventTypes(sessionId) });
}
async function expectRefused(t: Pick<Scene, "host" | "sessionId">, who: Who | null, payload: unknown, status: number | number[], code?: string | string[], opts: Opts = {}) {
  const before = await fingerprint(t.host, t.sessionId);
  const r = await put(t.sessionId, who, payload, opts);
  expect(Array.isArray(status) ? status : [status]).toContain(r.status);
  expect(r.body.data).toBeUndefined();
  expect(typeof r.body.error?.message).toBe("string");
  if (code) expect(Array.isArray(code) ? code : [code]).toContain(r.body.error?.code);
  expect(await fingerprint(t.host, t.sessionId)).toBe(before);
  return r;
}
/** Host Katsu x2 and Ana Katsu x1 (one line) at 500.00, Gyoza x1 at 100.00. */
const basic = () =>
  scene([
    { name: "Katsu", qty: 2, unit: 50000 },
    { who: "ana", name: "Katsu", qty: 1, unit: 50000 },
    { name: "Gyoza", qty: 1, unit: 10000 },
  ]);
const body = (centavos: unknown, expectedRevision: unknown = 0) => ({ centavos, expectedRevision });

// ---------- happy path, revision ----------
describe("PUT /receipt-total: happy path and revision", () => {
  it("R01 host sets a total: 200 envelope, session revision +1, one session.receiptTotal event, row and snapshot agree", async () => {
    const t = await basic();
    const before = await sessionRev(t.sessionId);
    const r = await put(t.sessionId, t.hostWho, body(160000, 0));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ result: { revision: 1 }, revision: before + 1, replayed: false });
    expect(await sessionRev(t.sessionId)).toBe(before + 1);
    expect((await eventTypes(t.sessionId)).slice(-1)).toEqual(["session.receiptTotal"]);
    expect(await receiptRow(t.sessionId)).toEqual({ c: 160000, r: 1 });
    expect((await getSnapshot(db, t.host)).settlement.receiptTotal).toEqual({ centavos: 160000, revision: 1 });
  });

  it("R02 works on a brand new order with no dishes", async () => {
    const { host, sessionId, token } = await newSession(db);
    expect((await put(sessionId, { token }, body(12345, 0))).status).toBe(200);
    expect((await getSnapshot(db, host)).settlement.receiptTotal).toEqual({ centavos: 12345, revision: 1 });
  });

  it("R03 revision walks 0 -> 1 -> 2 -> 3 (a clear counts); a stale 0 then conflicts, 3 works", async () => {
    const t = await basic();
    const a = await put(t.sessionId, t.hostWho, body(100, 0));
    const b = await put(t.sessionId, t.hostWho, body(200, 1));
    const c = await put(t.sessionId, t.hostWho, body(null, 2));
    expect([a, b, c].map((r) => r.body.data?.result.revision)).toEqual([1, 2, 3]);
    expect(await receiptRow(t.sessionId)).toEqual({ c: null, r: 3 });
    await expectRefused(t, t.hostWho, body(300, 0), 409, "CONFLICT");
    const d = await put(t.sessionId, t.hostWho, body(300, 3));
    expect(d.status).toBe(200);
    expect(d.body.data?.result.revision).toBe(4);
  });

  it("R04 null means not entered: clearing stores null (not 0)", async () => {
    const t = await basic();
    await put(t.sessionId, t.hostWho, body(5000, 0));
    expect((await put(t.sessionId, t.hostWho, body(null, 1))).status).toBe(200);
    expect((await getSnapshot(db, t.host)).settlement.receiptTotal.centavos).toBeNull();
    expect((await receiptRow(t.sessionId)).c).toBeNull();
  });

  it("R05 a fresh order reports receiptTotal { centavos: null, revision: 0 }", async () => {
    const t = await basic();
    expect((await sync(t.sessionId, t.hostWho)).settlement.receiptTotal).toEqual({ centavos: null, revision: 0 });
  });

  it("R06 a PHP 0 receipt is a value, not 'not entered': accepted and stored as 0", async () => {
    const t = await basic();
    expect((await put(t.sessionId, t.hostWho, body(0, 0))).status).toBe(200);
    expect(await receiptRow(t.sessionId)).toEqual({ c: 0, r: 1 });
    expect((await sync(t.sessionId, t.hostWho)).settlement.receiptTotal.centavos).toBe(0);
  });

  it("R07 the boundaries 0 and 99,999,999 are accepted", async () => {
    const t = await basic();
    expect((await put(t.sessionId, t.hostWho, body(MAX, 0))).status).toBe(200);
    expect((await receiptRow(t.sessionId)).c).toBe(MAX);
    expect((await put(t.sessionId, t.hostWho, body(0, 1))).status).toBe(200);
    expect((await receiptRow(t.sessionId)).c).toBe(0);
  });

  it("R08 the event payload carries ids only, never the amount", async () => {
    const t = await basic();
    await put(t.sessionId, t.hostWho, body(4567891, 0));
    const ev = (await eventRows(t.sessionId)).filter((e) => e.eventType === "session.receiptTotal");
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0].payload)).not.toMatch(/4567891|45678\.91|45,678/);
  });

  it("R09 a committed change rings the realtime bell (pg_notify on salo_events) within 15 s", async () => {
    const t = await basic();
    let got: (v: string) => void = () => undefined;
    const heard = new Promise<string>((res) => (got = res));
    const sub = await db.$client.listen("salo_events", (payload) => {
      if (payload.includes(t.sessionId)) got(payload);
    });
    try {
      const [msg] = await within(Promise.all([heard, put(t.sessionId, t.hostWho, body(1000, 0))]), "notify after PUT");
      expect(msg).toContain(t.sessionId);
    } finally {
      await sub.unlisten();
    }
  });

  it("R10 setting it does not reset readiness or touch entries, rounds and prices", async () => {
    const t = await basic();
    await open(t.host);
    await add(db, t.ana.actor, { dishName: "Udon", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await run(t.ana.actor, (tx, s) => setReady(tx, s, t.ana.actor, true));
    const view = async () => {
      const snap = await getSnapshot(db, t.host);
      return JSON.stringify({ ...snap, session: null, settlement: { ...snap.settlement, receiptTotal: null } });
    };
    const before = await view();
    await put(t.sessionId, t.hostWho, body(99900, 0));
    expect(await view()).toBe(before);
    expect((await getSnapshot(db, t.host)).readiness.find((r) => r.participantId === t.ana.actor.participantId)?.ready).toBe(true);
  });
});

// ---------- conflicts, idempotency ----------
describe("PUT /receipt-total: conflicts and idempotency", () => {
  it("C01 stale expectedRevision (behind or ahead) -> 409 CONFLICT; value and revision unchanged", async () => {
    const t = await basic();
    await put(t.sessionId, t.hostWho, body(100, 0));
    await expectRefused(t, t.hostWho, body(200, 0), 409, "CONFLICT");
    await expectRefused(t, t.hostWho, body(200, 5), 409, "CONFLICT");
    await expectRefused(t, t.hostWho, body(null, 0), 409, "CONFLICT");
    expect(await receiptRow(t.sessionId)).toEqual({ c: 100, r: 1 });
  });

  it("C02 a service-charge change does not move the receipt total's own revision", async () => {
    const t = await basic();
    expect((await putCharge(t.sessionId, t.hostWho, { centavos: 1000, expectedRevision: 0 })).status).toBe(200);
    const r = await put(t.sessionId, t.hostWho, body(100, 0));
    expect(r.status).toBe(200);
    expect(r.body.data?.result.revision).toBe(1);
  });

  it("I01 same key, same body twice: both 200, second replayed:true with the same result; applied once, one event", async () => {
    const t = await basic();
    const k = key();
    const a = await put(t.sessionId, t.hostWho, body(7777, 0), { idem: k });
    const b = await put(t.sessionId, t.hostWho, body(7777, 0), { idem: k });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.data?.replayed).toBe(false);
    expect(b.body.data?.replayed).toBe(true);
    expect(b.body.data?.result).toEqual(a.body.data?.result);
    expect(b.body.data?.revision).toBe(a.body.data?.revision);
    expect(await receiptRow(t.sessionId)).toEqual({ c: 7777, r: 1 });
    expect(await receiptEvents(t.sessionId)).toBe(1);
  });

  it("I02 replay after the value moved on returns the first result; no re-apply, no rollback", async () => {
    const t = await basic();
    const k = key();
    const a = await put(t.sessionId, t.hostWho, body(100, 0), { idem: k });
    await put(t.sessionId, t.hostWho, body(200, 1));
    const before = await fingerprint(t.host, t.sessionId);
    const again = await put(t.sessionId, t.hostWho, body(100, 0), { idem: k });
    expect(again.status).toBe(200);
    expect(again.body.data?.replayed).toBe(true);
    expect(again.body.data?.result).toEqual(a.body.data?.result);
    expect(await fingerprint(t.host, t.sessionId)).toBe(before);
    expect((await receiptRow(t.sessionId)).c).toBe(200);
  });

  it("I03 the same key sent twice at once: both 200, exactly one replayed, applied once", async () => {
    const t = await basic();
    const k = key();
    const [a, b] = await Promise.all([put(t.sessionId, t.hostWho, body(4242, 0), { idem: k }), put(t.sessionId, t.hostWho, body(4242, 0), { idem: k })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a, b].filter((r) => r.body.data?.replayed).length).toBe(1);
    expect(await receiptRow(t.sessionId)).toEqual({ c: 4242, r: 1 });
    expect(await receiptEvents(t.sessionId)).toBe(1);
  });

  it("I04 a key already used by service-charge is refused here: 422 IDEMPOTENCY_KEY_REUSED, nothing applied", async () => {
    const t = await basic();
    const k = key();
    expect((await putCharge(t.sessionId, t.hostWho, { centavos: 500, expectedRevision: 0 }, { idem: k })).status).toBe(200);
    await expectRefused(t, t.hostWho, body(100, 0), 422, "IDEMPOTENCY_KEY_REUSED", { idem: k });
  });

  it("I05 and the other way: a receipt-total key reused on service-charge -> 422 IDEMPOTENCY_KEY_REUSED, charge unchanged", async () => {
    const t = await basic();
    const k = key();
    expect((await put(t.sessionId, t.hostWho, body(100, 0), { idem: k })).status).toBe(200);
    const before = await fingerprint(t.host, t.sessionId);
    const r = await putCharge(t.sessionId, t.hostWho, { centavos: 500, expectedRevision: 0 }, { idem: k });
    expect(r.status).toBe(422);
    expect(r.body.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await fingerprint(t.host, t.sessionId)).toBe(before);
  });

  it("I06 the same key with a different body on this route returns the first result and changes nothing", async () => {
    const t = await basic();
    const k = key();
    const a = await put(t.sessionId, t.hostWho, body(100, 0), { idem: k });
    const before = await fingerprint(t.host, t.sessionId);
    const b = await put(t.sessionId, t.hostWho, body(999, 0), { idem: k });
    expect(b.status).toBe(200);
    expect(b.body.data?.replayed).toBe(true);
    expect(b.body.data?.result).toEqual(a.body.data?.result);
    expect(await fingerprint(t.host, t.sessionId)).toBe(before);
    expect((await receiptRow(t.sessionId)).c).toBe(100);
  });

  it("I07 missing / short / space / slash / 101-char / empty Idempotency-Key -> 400 IDEMPOTENCY_KEY, nothing applied", async () => {
    const t = await basic();
    for (const idem of [null, "short", "has space in it", "has/slash/in/it", "a".repeat(101), ""]) {
      await expectRefused(t, t.hostWho, body(100, 0), 400, "IDEMPOTENCY_KEY", { idem });
    }
    expect((await receiptRow(t.sessionId)).r).toBe(0);
  });

  it("I08 8 and 100 character keys are valid", async () => {
    const t = await basic();
    expect((await put(t.sessionId, t.hostWho, body(1, 0), { idem: "abcdefgh" })).status).toBe(200);
    expect((await put(t.sessionId, t.hostWho, body(2, 1), { idem: "A".repeat(100) })).status).toBe(200);
  });
});

// ---------- validation ----------
describe("PUT /receipt-total: validation (422 INVALID unless noted)", () => {
  it.each([
    ["negative", -1],
    ["large negative", -99_999_999],
    ["fractional", 100.5],
    ["tiny fraction", 0.1],
    ["over the cap by one", MAX + 1],
    ["over int32", 2 ** 31],
    ["2^53", 2 ** 53],
    ["string", "100"],
    ["string with peso sign", "₱100.00"],
    ["empty string", ""],
    ["boolean", true],
    ["array", [100]],
    ["object", { v: 1 }],
  ])("N01 centavos %s is refused and nothing changes", async (_name, centavos) => {
    const t = await basic();
    await expectRefused(t, t.hostWho, body(centavos, 0), 422, "INVALID");
  });

  it("N02 centavos missing is refused, not treated as a clear", async () => {
    const t = await basic();
    await put(t.sessionId, t.hostWho, body(500, 0));
    await expectRefused(t, t.hostWho, { expectedRevision: 1 }, 422, "INVALID");
    expect((await receiptRow(t.sessionId)).c).toBe(500);
  });

  it.each([
    ["missing", undefined],
    ["negative", -1],
    ["fractional", 0.5],
    ["string", "0"],
    ["null", null],
    ["boolean", false],
    ["2^53", 2 ** 53],
  ])("N03 expectedRevision %s is refused (422 INVALID) and nothing changes", async (_name, expectedRevision) => {
    const t = await basic();
    const payload = expectedRevision === undefined ? { centavos: 100 } : { centavos: 100, expectedRevision };
    await expectRefused(t, t.hostWho, payload, 422, "INVALID");
  });

  it("N04 body shapes: bad JSON 400 BAD_JSON; empty body, array, string, null, number, empty object 422; over 8 KB 413 TOO_LARGE", async () => {
    const t = await basic();
    await expectRefused(t, t.hostWho, null, 400, "BAD_JSON", { raw: "{not json" });
    for (const raw of ["", "[]", '"text"', "null", "{}", "42"]) await expectRefused(t, t.hostWho, null, 422, "INVALID", { raw });
    await expectRefused(t, t.hostWho, null, 413, "TOO_LARGE", { raw: JSON.stringify({ centavos: 1, expectedRevision: 0, pad: "x".repeat(9000) }) });
  });

  it("N05 1e400 in raw JSON (parses to Infinity) is 422; an exponent form of an integer never causes a 5xx", async () => {
    const t = await basic();
    await expectRefused(t, t.hostWho, null, 422, "INVALID", { raw: '{"centavos":1e400,"expectedRevision":0}' });
    const r = await put(t.sessionId, t.hostWho, null, { raw: '{"centavos":1e2,"expectedRevision":0}' });
    expect([200, 422]).toContain(r.status);
  });

  it("N06 unknown extra fields never alter behaviour (no mass assignment of the revision, role or session)", async () => {
    const t = await basic();
    const r = await put(t.sessionId, t.hostWho, { centavos: 100, expectedRevision: 0, revision: 99, receiptTotalRevision: 99, sessionId: "x", role: "GUEST" });
    expect(r.status).toBe(200);
    expect(await receiptRow(t.sessionId)).toEqual({ c: 100, r: 1 });
  });

  it("N07 the database CHECKs: 0..99,999,999 for the amount, revision >= 0", async () => {
    const t = await basic();
    const upd = (set: ReturnType<typeof sql>) => db.execute(sql`UPDATE sessions SET ${set} WHERE id = ${t.sessionId}`);
    await expect(upd(sql`receipt_total_centavos = -1`)).rejects.toThrow();
    await expect(upd(sql`receipt_total_centavos = 100000000`)).rejects.toThrow();
    await expect(upd(sql`receipt_total_revision = -1`)).rejects.toThrow();
    await upd(sql`receipt_total_centavos = 99999999`);
    await upd(sql`receipt_total_centavos = 0`);
  });
});

// ---------- authentication and authorization ----------
describe("PUT /receipt-total: who may set it", () => {
  it("A01 a guest (also one with entries) -> 403 FORBIDDEN, nothing changes", async () => {
    const t = await basic();
    await expectRefused(t, t.anaWho, body(100, 0), 403, "FORBIDDEN");
    await expectRefused(t, t.anaWho, body(null, 0), 403, "FORBIDDEN");
  });

  it("A02 no cookie, garbage cookie -> 404 NOT_FOUND", async () => {
    const t = await basic();
    await expectRefused(t, null, body(100, 0), 404, "NOT_FOUND");
    await expectRefused(t, { token: "garbage-token" }, body(100, 0), 404, "NOT_FOUND");
  });

  it("A03 another order's host (tenant), also with its token planted under this order's cookie name -> 404; both orders untouched", async () => {
    const a = await basic();
    const b = await basic();
    await expectRefused(a, b.hostWho, body(100, 0), 404, "NOT_FOUND");
    await expectRefused(b, a.hostWho, body(100, 0), 404, "NOT_FOUND");
    expect((await receiptRow(a.sessionId)).r + (await receiptRow(b.sessionId)).r).toBe(0);
  });

  it("A04 a removed guest is refused (403 REMOVED or 404)", async () => {
    const t = await basic();
    await run(t.host, (tx, s) => removeParticipant(tx, s, t.host, t.ana.actor.participantId, null));
    const r = await put(t.sessionId, t.anaWho, body(100, 0));
    expect([403, 404]).toContain(r.status);
    expect(r.body.data).toBeUndefined();
    expect((await receiptRow(t.sessionId)).r).toBe(0);
  });

  it("A05 Origin: a non-GET /api request without or with a foreign Origin is refused 403 FORBIDDEN_ORIGIN by the proxy; own origin passes", async () => {
    const mk = (origin?: string) => new NextRequest("http://localhost:3000/api/sessions/x/receipt-total", { method: "PUT", headers: origin ? { origin } : {} });
    for (const origin of [undefined, "https://evil.example", "http://localhost:3001", "http://localhost:3000.evil.example"]) {
      const res = proxy(mk(origin));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN_ORIGIN");
    }
    expect(proxy(mk("http://localhost:3000")).status).toBe(200);
  });

  it("A06 an unknown or malformed session id is 404 (never a 5xx)", async () => {
    const t = await basic();
    for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid", "x".repeat(200)]) {
      expect((await put(id, t.hostWho, body(100, 0))).status).toBe(404);
    }
  });
});

// ---------- order state ----------
describe("PUT /receipt-total: order state", () => {
  it("C03 a closed order refuses it (409 SESSION_CLOSED), set or clear; the value stays", async () => {
    const t = await basic();
    await put(t.sessionId, t.hostWho, body(2000, 0));
    await run(t.host, (tx, s) => closeSession(tx, s, t.host));
    await expectRefused(t, t.hostWho, body(3000, 1), 409, "SESSION_CLOSED");
    await expectRefused(t, t.hostWho, body(null, 1), 409, "SESSION_CLOSED");
    expect(await receiptRow(t.sessionId)).toEqual({ c: 2000, r: 1 });
  });

  it("C04 a closed order still shows the last value to host and guest", async () => {
    const t = await basic();
    await put(t.sessionId, t.hostWho, body(2000, 0));
    await run(t.host, (tx, s) => closeSession(tx, s, t.host));
    expect((await sync(t.sessionId, t.hostWho)).settlement.receiptTotal.centavos).toBe(2000);
    expect((await sync(t.sessionId, t.anaWho)).settlement.receiptTotal.centavos).toBe(2000);
  });

  it("C05 replaying an applied key after the order closed changes nothing", async () => {
    const t = await basic();
    const k = key();
    await put(t.sessionId, t.hostWho, body(2000, 0), { idem: k });
    await run(t.host, (tx, s) => closeSession(tx, s, t.host));
    const before = await fingerprint(t.host, t.sessionId);
    const r = await put(t.sessionId, t.hostWho, body(2000, 0), { idem: k });
    expect([200, 409]).toContain(r.status);
    expect(await fingerprint(t.host, t.sessionId)).toBe(before);
  });
});

// ---------- races ----------
describe("PUT /receipt-total: races", () => {
  it("K01 two different keys at the same expectedRevision: exactly one 200, one 409 CONFLICT, one event, revision 1", async () => {
    const t = await basic();
    const [a, b] = await Promise.all([put(t.sessionId, t.hostWho, body(111, 0)), put(t.sessionId, t.hostWho, body(222, 0))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((a.status === 409 ? a : b).body.error?.code).toBe("CONFLICT");
    expect(await receiptRow(t.sessionId)).toEqual({ c: a.status === 200 ? 111 : 222, r: 1 });
    expect(await receiptEvents(t.sessionId)).toBe(1);
  });

  it("K02 eight parallel writers at expectedRevision 0: one wins, seven 409, never a 5xx", async () => {
    const t = await basic();
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => put(t.sessionId, t.hostWho, body(1000 + i, 0))));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(7);
    expect((await receiptRow(t.sessionId)).r).toBe(1);
  });

  it("K03 a write racing a service-charge write: both succeed (separate revisions), both values stored", async () => {
    const t = await basic();
    const [a, b] = await Promise.all([put(t.sessionId, t.hostWho, body(5555, 0)), putCharge(t.sessionId, t.hostWho, { centavos: 700, expectedRevision: 0 })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const snap = await getSnapshot(db, t.host);
    expect(snap.settlement.receiptTotal).toEqual({ centavos: 5555, revision: 1 });
    expect(snap.settlement.serviceCharge.centavos).toBe(700);
  });

  it("K04 a write racing the confirm of the open round: both succeed", async () => {
    const t = await basic();
    await open(t.host);
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "TABLE" } });
    const looked = await getSnapshot(db, t.host);
    const [w, c] = await Promise.allSettled([put(t.sessionId, t.hostWho, body(5555, 0)), run(t.host, (tx, s) => confirmRound(tx, s, t.host, looked.activeRoundId, looked.session.revision))]);
    expect(w.status).toBe("fulfilled");
    expect(c.status).toBe("fulfilled");
  });
});

// ---------- NON_TICKET and leaks ----------
describe("receipt total never touches the waiter ticket", () => {
  it("L01 setting it after the host looked does not make confirming the open round stale (NON_TICKET)", async () => {
    const t = await basic();
    await open(t.host);
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "TABLE" } });
    const looked = await getSnapshot(db, t.host);
    await put(t.sessionId, t.hostWho, body(1500, 0));
    await put(t.sessionId, t.hostWho, body(1600, 1));
    await put(t.sessionId, t.hostWho, body(null, 2));
    expect((await getSnapshot(db, t.host)).session.revision).toBeGreaterThan(looked.session.revision);
    const r = await run(t.host, (tx, s) => confirmRound(tx, s, t.host, looked.activeRoundId, looked.session.revision));
    expect(r.result.roundId).toBe(looked.activeRoundId);
  });

  it("L02 control: a ticket-changing edit after the host looked still makes confirm stale", async () => {
    const t = await basic();
    await open(t.host);
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "TABLE" } });
    const looked = await getSnapshot(db, t.host);
    await put(t.sessionId, t.hostWho, body(1500, 0));
    await add(db, t.host, { dishName: "Udon", quantity: 1, attribution: { type: "TABLE" } });
    await expect(run(t.host, (tx, s) => confirmRound(tx, s, t.host, looked.activeRoundId, looked.session.revision))).rejects.toMatchObject({ code: "STALE_REVISION" });
  });

  it("L03 stored ticket snapshots, live tickets, invite lookup, Items summary and ticket copy text never carry the receipt total", async () => {
    const t = await basic();
    await put(t.sessionId, t.hostWho, body(4567891, 0));
    await open(t.host);
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "TABLE" } });
    await confirm(t.host);
    await put(t.sessionId, t.hostWho, body(4567891, 1));
    const snap = await sync(t.sessionId, t.anaWho);
    const pattern = /4567891|45678\.91|45,678\.91|receipt/i;
    const stored = JSON.stringify((await db.select().from(confirmedRoundSnapshots)).map((r) => r.snapshotData));
    expect(stored).not.toMatch(pattern);
    for (const part of [snap.tickets, snap.rounds, snap.entries, snap.corrections]) expect(JSON.stringify(part)).not.toMatch(pattern);
    expect(JSON.stringify(await findInvite(db, snap.session.joinCode))).not.toMatch(pattern);
    const summary = buildSummary(snap);
    expect(JSON.stringify(summary)).not.toMatch(pattern);
    expect(summaryText(summary, "19 Nov")).not.toMatch(pattern);
    for (const ticket of Object.values(snap.tickets)) expect(snapshotText(ticket)).not.toMatch(pattern);
  });

  it("L04 setting or clearing it leaves tickets, rounds, entries, Items summary and stored snapshots byte-identical", async () => {
    const t = await basic();
    const view = async () => {
      const snap = await getSnapshot(db, t.host);
      const items = buildSummary(snap);
      return JSON.stringify({ tickets: snap.tickets, rounds: snap.rounds, entries: snap.entries, items, text: summaryText(items, "x"), stored: (await db.select().from(confirmedRoundSnapshots)).map((r) => r.snapshotData) });
    };
    const before = await view();
    await put(t.sessionId, t.hostWho, body(31337, 0));
    expect(await view()).toBe(before);
    await put(t.sessionId, t.hostWho, body(null, 1));
    expect(await view()).toBe(before);
  });

  it("L05 setting it never changes KKB numbers: sections, per-person totals and the service charge split stay identical (never distributed)", async () => {
    const t = await scene(
      [
        { name: "Katsu", qty: 2, unit: 33333 },
        { who: "ana", name: "Udon", qty: 1, unit: 25001 },
      ],
      777,
    );
    const before = JSON.stringify(await kkbOf(t));
    await put(t.sessionId, t.hostWho, body(1, 0));
    await put(t.sessionId, t.hostWho, body(MAX, 1));
    expect(JSON.stringify(await kkbOf(t))).toBe(before);
  });
});

describe("receipt total is visible to every participant and no one else", () => {
  it("V01 host and guest snapshots (sync and GET session) both carry settlement.receiptTotal", async () => {
    const t = await basic();
    await put(t.sessionId, t.hostWho, body(88800, 0));
    for (const who of [t.hostWho, t.anaWho]) {
      expect((await sync(t.sessionId, who)).settlement.receiptTotal).toEqual({ centavos: 88800, revision: 1 });
      jar.cookies = { [credentialCookieName(t.sessionId)]: who.token! };
      const res = await SESSION_GET(new Request("http://localhost:3000/x"), { params: Promise.resolve({ id: t.sessionId }) });
      expect((await res.json()).data.settlement.receiptTotal).toEqual({ centavos: 88800, revision: 1 });
    }
  });

  it("V02 a guest who joins later sees the current value at once; a cleared value is seen as null", async () => {
    const t = await basic();
    await put(t.sessionId, t.hostWho, body(88800, 0));
    const late = await guestOf(t.sessionId, "Late");
    expect((await sync(t.sessionId, { token: late.token })).settlement.receiptTotal.centavos).toBe(88800);
    await put(t.sessionId, t.hostWho, body(null, 1));
    expect((await sync(t.sessionId, { token: late.token })).settlement.receiptTotal.centavos).toBeNull();
  });

  it("V03 strangers and another order's host cannot read it (404); the invite lookup does not carry it", async () => {
    const a = await basic();
    const b = await basic();
    await put(a.sessionId, a.hostWho, body(88800, 0));
    jar.cookies = { [credentialCookieName(a.sessionId)]: b.hostWho.token! };
    expect((await SYNC(new Request("http://localhost:3000/x"), { params: Promise.resolve({ id: a.sessionId }) })).status).toBe(404);
    jar.cookies = {};
    expect((await SYNC(new Request("http://localhost:3000/x"), { params: Promise.resolve({ id: a.sessionId }) })).status).toBe(404);
    const code = (await getSnapshot(db, a.host)).session.joinCode;
    expect(JSON.stringify(await findInvite(db, code))).not.toMatch(/88800|888\.00|receipt/i);
  });

  it("V04 a removed guest's own snapshot request does not return it", async () => {
    const t = await basic();
    await put(t.sessionId, t.hostWho, body(88800, 0));
    await run(t.host, (tx, s) => removeParticipant(tx, s, t.host, t.ana.actor.participantId, null));
    jar.cookies = { [credentialCookieName(t.sessionId)]: t.anaWho.token! };
    const res = await SYNC(new Request("http://localhost:3000/x"), { params: Promise.resolve({ id: t.sessionId }) });
    expect([403, 404]).toContain(res.status);
    expect(JSON.stringify(await res.json())).not.toMatch(/88800/);
  });
});

// ---------- reconciliation ----------
describe("reconciliation: Salo total = food + service charge; matches / more / less / incomplete", () => {
  /** Food 160000 + service charge 16000 = Salo total 176000. */
  const priced = () =>
    scene(
      [
        { name: "Katsu", qty: 2, unit: 50000 },
        { who: "ana", name: "Katsu", qty: 1, unit: 50000 },
        { name: "Gyoza", qty: 1, unit: 10000 },
      ],
      16000,
    );

  it("Q01 Salo total is food + service charge (160000 + 16000 = 176000)", async () => {
    const t = await priced();
    const v = await check(t, 176000);
    expect(v.kkb.foodCentavos).toBe(160000);
    expect(v.salo).toBe(176000);
  });

  it("Q02 receipt equal to Salo total -> matches", async () => {
    const t = await priced();
    expect((await check(t, 176000)).rec).toEqual({ state: "matches" });
  });

  it("Q03 receipt above -> more, by exactly the difference", async () => {
    const t = await priced();
    expect((await check(t, 179600)).rec).toEqual({ state: "more", differenceCentavos: 3600 });
  });

  it("Q04 receipt below -> less, by exactly the difference", async () => {
    const t = await priced();
    expect((await check(t, 170000)).rec).toEqual({ state: "less", differenceCentavos: 6000 });
  });

  it("Q05 one centavo either way is reported, not rounded away", async () => {
    const t = await priced();
    expect((await check(t, 176001)).rec).toEqual({ state: "more", differenceCentavos: 1 });
    expect((await check(t, 175999)).rec).toEqual({ state: "less", differenceCentavos: 1 });
    expect((await check(t, 176000)).rec).toEqual({ state: "matches" });
  });

  it("Q06 a PHP 0 receipt against priced food is 'less' by the whole Salo total (an entered 0, not 'not entered')", async () => {
    const t = await priced();
    const v = await check(t, 0);
    expect(v.snap.settlement.receiptTotal.centavos).toBe(0);
    expect(v.rec).toEqual({ state: "less", differenceCentavos: 176000 });
  });

  it("Q07 a PHP 0 receipt matches a PHP 0 order: free dish priced 0, service charge 0", async () => {
    const t = await scene([{ name: "Water", qty: 1, unit: 0 }], 0);
    const v = await check(t, 0);
    expect(v.comp).toMatchObject({ total: 1, priced: 1 });
    expect(v.rec).toEqual({ state: "matches" });
  });

  it("Q08 service charge unset: Salo total is food only; receipt = food matches, +1 is more", async () => {
    const t = await scene([{ name: "Katsu", qty: 2, unit: 50000 }]);
    const v = await check(t, 100000);
    expect(v.kkb.charge.state).toBe("unset");
    expect(v.salo).toBe(100000);
    expect(v.rec).toEqual({ state: "matches" });
    expect((await check(t, 100001)).rec).toEqual({ state: "more", differenceCentavos: 1 });
  });

  it("Q09 service charge 0 ('none on the receipt') behaves like food only", async () => {
    const t = await scene([{ name: "Katsu", qty: 2, unit: 50000 }], 0);
    const v = await check(t, 100000);
    expect(v.kkb.charge.state).toBe("none");
    expect(v.rec).toEqual({ state: "matches" });
  });

  it("Q10 changing the service charge moves Salo total and the verdict (receipt entered first)", async () => {
    const t = await scene([{ name: "Katsu", qty: 2, unit: 50000 }], 0);
    expect((await check(t, 110000)).rec).toEqual({ state: "more", differenceCentavos: 10000 });
    await setCharge(t.host, 10000, 1);
    const snap = await sync(t.sessionId, t.hostWho);
    const kkb = buildKkb(snap, t.host.participantId);
    expect(saloTotal(kkb)).toBe(110000);
    expect(reconcile(kkb, snap.settlement.receiptTotal.centavos!)).toEqual({ state: "matches" });
  });

  it("Q11 any unpriced dish: incomplete, never matches, whatever the receipt (even equal to the priced food)", async () => {
    const t = await scene([
      { name: "Katsu", qty: 2, unit: 50000 },
      { name: "Gyoza", qty: 1, unit: null },
    ]);
    for (const receipt of [0, 100000, 100001, 150000, MAX]) expect((await check(t, receipt)).rec).toEqual({ state: "incomplete", unpriced: 1 });
  });

  it("Q12 incomplete counts the unpriced dishes (2 of 3 unpriced)", async () => {
    const t = await scene([
      { name: "Katsu", qty: 2, unit: 50000 },
      { name: "Gyoza", qty: 1 },
      { name: "Udon", qty: 3 },
    ]);
    const v = await check(t, 100000);
    expect(v.rec).toEqual({ state: "incomplete", unpriced: 2 });
    expect(v.comp).toMatchObject({ total: 3, priced: 1 });
  });

  it("Q13 an unpriced dish with the service charge entered and equal totals is still incomplete", async () => {
    const t = await scene([{ name: "Katsu", qty: 1, unit: null }], 0);
    expect((await check(t, 0)).rec).toEqual({ state: "incomplete", unpriced: 1 });
  });

  it("Q14 pricing the dish turns incomplete into a real verdict", async () => {
    const t = await scene([{ name: "Katsu", qty: 1 }], 0);
    expect((await check(t, 12000)).rec).toEqual({ state: "incomplete", unpriced: 1 });
    await priceEntry(t.host, t.ids[0], 12000);
    const snap = await sync(t.sessionId, t.hostWho);
    expect(reconcile(buildKkb(snap, t.host.participantId), 12000)).toEqual({ state: "matches" });
  });

  it("Q15 centavo edges: 3 x 33.33 + 0.01 service charge = 100.00; 100.00 matches, 100.01 more by 1, 99.99 less by 1", async () => {
    const t = await scene([{ name: "Soup", qty: 3, unit: 3333 }], 1);
    const v = await check(t, 10000);
    expect(v.kkb.foodCentavos).toBe(9999);
    expect(v.salo).toBe(10000);
    expect(v.rec).toEqual({ state: "matches" });
    expect((await check(t, 10001)).rec).toEqual({ state: "more", differenceCentavos: 1 });
    expect((await check(t, 9999)).rec).toEqual({ state: "less", differenceCentavos: 1 });
  });

  it("Q16 a service charge that splits unevenly across people: per-person totals add up to Salo total exactly", async () => {
    const t = await scene(
      [
        { name: "A", qty: 1, unit: 3333 },
        { who: "ana", name: "B", qty: 1, unit: 3333 },
      ],
      101,
    );
    const v = await check(t, 3333 + 3333 + 101);
    expect(v.kkb.charge).toEqual({ state: "allocated", centavos: 101 });
    expect(v.kkb.sections.filter((s) => !s.shared).reduce((n, s) => n + (s.totalCentavos ?? 0), 0)).toBe(v.salo);
    expect(v.rec).toEqual({ state: "matches" });
  });

  it("Q17 big numbers: 99 x 99,999.99 of food against a max receipt is exact (no float or overflow drift)", async () => {
    const t = await scene([{ name: "Gold", qty: 99, unit: 9_999_999 }], MAX);
    const food = 99 * 9_999_999;
    const v = await check(t, MAX);
    expect(v.kkb.foodCentavos).toBe(food);
    expect(v.salo).toBe(food + MAX);
    expect(v.rec).toEqual({ state: "less", differenceCentavos: food });
  });

  it("Q18 a service charge that cannot be split yet (a change pending with the waiter) is still part of Salo total", async () => {
    const t = await scene(
      [
        { name: "Katsu", qty: 2, unit: 50000 },
        { who: "ana", name: "Udon", qty: 1, unit: 20000 },
      ],
      12000,
    );
    await open(t.host);
    await correct(t.host, { entries: [{ sourceEntryId: t.ids[0], quantity: 1 }], type: "QUANTITY" });
    const v = await check(t, 132000);
    expect(v.kkb.charge.state).toBe("blocked");
    expect(v.salo).toBe(132000);
  });

  it("Q23 a cancellation still pending with the waiter: the check never says 'matches' (service charge 0 and entered)", async () => {
    for (const charge of [0, 12000]) {
      const t = await scene(
        [
          { name: "Katsu", qty: 2, unit: 50000 },
          { who: "ana", name: "Udon", qty: 1, unit: 20000 },
        ],
        charge,
      );
      await open(t.host);
      await correct(t.host, { entries: [{ sourceEntryId: t.ids[0], quantity: 1 }], type: "QUANTITY" });
      const kkb = await kkbOf(t);
      expect(kkb.sections.flatMap((s) => s.lines).some((l) => l.pendingChange)).toBe(true);
      const v = await check(t, saloTotal(kkb));
      expect.soft(v.rec.state, `service charge ${charge}`).not.toBe("matches");
    }
  });

  it("Q19 a priced but unbilled shared dish ('Whole table') is in food and keeps the verdict real", async () => {
    const t = await scene(
      [
        { name: "Katsu", qty: 1, unit: 50000 },
        { name: "Nachos", qty: 1, unit: 30000, attr: "TABLE" },
      ],
      0,
    );
    const v = await check(t, 80000);
    expect(v.kkb.foodCentavos).toBe(80000);
    expect(v.comp).toMatchObject({ total: 2, priced: 2 });
    expect(v.rec).toEqual({ state: "matches" });
  });

  it("Q20 an unpriced shared dish is incomplete", async () => {
    const t = await scene(
      [
        { name: "Katsu", qty: 1, unit: 50000 },
        { name: "Nachos", qty: 1, attr: "TABLE" },
      ],
      0,
    );
    expect((await check(t, 50000)).rec).toEqual({ state: "incomplete", unpriced: 1 });
  });

  it("Q21 draft (unconfirmed) dishes are not part of the check: an unpriced draft dish adds neither to the count nor to food", async () => {
    const t = await scene([{ name: "Katsu", qty: 1, unit: 50000 }], 0);
    await open(t.host);
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    const v = await check(t, 50000);
    expect(v.kkb.foodCentavos).toBe(50000);
    expect(v.rec).toEqual({ state: "matches" });
  });

  it("Q22 a removed guest's confirmed dishes still count toward the verdict (the waiter still bills them)", async () => {
    const t = await scene(
      [
        { name: "Katsu", qty: 1, unit: 50000 },
        { who: "ana", name: "Udon", qty: 1, unit: 20000 },
      ],
      0,
    );
    await run(t.host, (tx, s) => removeParticipant(tx, s, t.host, t.ana.actor.participantId, null));
    const v = await check(t, 70000);
    expect(v.kkb.foodCentavos).toBe(70000);
    expect(v.rec).toEqual({ state: "matches" });
  });
});

// ---------- completeness ----------
describe("completeness: 'N of M dishes priced' (A18)", () => {
  it("P01 M = distinct dish + size + notes lines; the same preparation from two people is one dish", async () => {
    const t = await scene([
      { name: "Katsu", qty: 2 },
      { who: "ana", name: "Katsu", qty: 3 },
      { name: "Gyoza", qty: 1 },
    ]);
    expect(priceCompleteness(await kkbOf(t))).toMatchObject({ total: 2, priced: 0 });
  });

  it("P02 a line is priced only when every entry in it resolves: pricing one of two people's Katsu does not price the dish", async () => {
    const t = await scene([
      { name: "Katsu", qty: 2, unit: 50000 },
      { who: "ana", name: "Katsu", qty: 3 },
      { name: "Gyoza", qty: 1, unit: 10000 },
    ]);
    expect(priceCompleteness(await kkbOf(t))).toMatchObject({ total: 2, priced: 1 });
    await priceEntry(t.host, t.ids[1], 50000);
    expect(priceCompleteness(await kkbOf(t))).toMatchObject({ total: 2, priced: 2 });
  });

  it("P03 a table price resolves every entry of its dish + size, so the dish counts as priced", async () => {
    const t = await scene([
      { name: "Katsu", qty: 2 },
      { who: "ana", name: "Katsu", qty: 3 },
    ]);
    await tablePrice(t.host, t.dishIds[0], null, 50000);
    const v = await check(t, 250000);
    expect(v.comp).toMatchObject({ total: 1, priced: 1 });
    expect(v.kkb.foodCentavos).toBe(250000);
  });

  it("P04 a table price for one size does not resolve another size or the plain dish", async () => {
    const t = await scene([
      { name: "Katsu", qty: 1, variant: "Large" },
      { name: "Katsu", qty: 1, variant: "Small" },
      { name: "Katsu", qty: 1 },
    ]);
    await tablePrice(t.host, t.dishIds[0], "Large", 50000);
    expect(priceCompleteness(await kkbOf(t))).toMatchObject({ total: 3, priced: 1 });
  });

  it("P05 a table price plus one entry's own price: the dish is priced; removing the table price leaves the other entry unresolved", async () => {
    const t = await scene([
      { name: "Katsu", qty: 1 },
      { who: "ana", name: "Katsu", qty: 1 },
    ]);
    await tablePrice(t.host, t.dishIds[0], null, 50000);
    await priceEntry(t.host, t.ids[0], 45000);
    const kkb = await kkbOf(t);
    expect(priceCompleteness(kkb)).toMatchObject({ total: 1, priced: 1 });
    expect(kkb.foodCentavos).toBe(95000);
    await tablePrice(t.host, t.dishIds[0], null, null, 1);
    expect(priceCompleteness(await kkbOf(t))).toMatchObject({ total: 1, priced: 0 });
  });

  it("P06 case and spacing variants of size and notes are one line; different notes are another line", async () => {
    const t = await scene([
      { name: "Katsu", qty: 1, variant: "Large", notes: "no sauce" },
      { who: "ana", name: "katsu", qty: 1, variant: " LARGE ", notes: "No  Sauce" },
      { name: "Katsu", qty: 1, variant: "Large", notes: "extra sauce" },
    ]);
    expect(priceCompleteness(await kkbOf(t)).total).toBe(2);
  });

  it("P07 a PHP 0 price counts as priced (a free dish is not 'unpriced')", async () => {
    const t = await scene([{ name: "Water", qty: 2, unit: 0 }]);
    expect(priceCompleteness(await kkbOf(t))).toMatchObject({ total: 1, priced: 1 });
  });

  it("P08 a shared dish billed to someone still counts once", async () => {
    const t = await scene([{ name: "Nachos", qty: 1, unit: 30000, attr: "TABLE" }]);
    expect(priceCompleteness(await kkbOf(t))).toMatchObject({ total: 1, priced: 1 });
    await run(t.host, (tx, s) => setEntrySettlement(tx, s, t.host, t.ids[0], entrySettlementSchema.parse({ expectedRevision: 1, billTo: { participantId: t.ana.actor.participantId } })), "entry.settle");
    expect(priceCompleteness(await kkbOf(t))).toMatchObject({ total: 1, priced: 1 });
  });

  it("P09 a told replacement is its own dish line and must be priced itself (replacements never inherit a table price)", async () => {
    const t = await scene([
      { name: "Katsu", qty: 2, unit: 50000 },
      { name: "Gyoza", qty: 1, unit: 10000 },
    ]);
    await tablePrice(t.host, t.dishIds[0], null, 50000);
    expect((await unavailable(t.sessionId, t.hostWho, t.dishIds[0], { replacement: "Pork Katsu" })).status).toBe(200);
    const snap = await getSnapshot(db, t.host);
    const kkb = buildKkb(snap, t.host.participantId);
    expect(priceCompleteness(kkb)).toMatchObject({ total: 2, priced: 1 });
    expect(reconcile(kkb, 999999)).toMatchObject({ state: "incomplete" });
    const replacement = snap.corrections.find((c) => c.type === "REPLACE")!;
    await run(t.host, (tx, s) => setCorrectionPrice(tx, s, t.host, replacement.id, correctionPriceSchema.parse({ expectedRevision: 0, unitPriceCentavos: 60000 })), "correction.price");
    const after = await kkbOf(t);
    expect(priceCompleteness(after)).toMatchObject({ total: 2, priced: 2 });
    expect(after.foodCentavos).toBe(2 * 60000 + 10000);
  });

  it("P10 a dish cancelled to nothing by the waiter is no longer a dish to price (does not block 'matches')", async () => {
    const t = await scene(
      [
        { name: "Katsu", qty: 2 },
        { name: "Gyoza", qty: 1, unit: 10000 },
      ],
      0,
    );
    expect((await unavailable(t.sessionId, t.hostWho, t.dishIds[0], {})).status).toBe(200);
    const v = await check(t, 10000);
    expect(v.comp).toMatchObject({ total: 1, priced: 1 });
    expect(v.rec).toEqual({ state: "matches" });
  });

  it("P11 no confirmed dishes: 0 of 0", async () => {
    const { host, sessionId, token } = await newSession(db);
    expect((await put(sessionId, { token }, body(500, 0))).status).toBe(200);
    const kkb = buildKkb(await getSnapshot(db, host), host.participantId);
    expect(priceCompleteness(kkb)).toMatchObject({ total: 0, priced: 0, first: null });
  });

  it("P12 `first` points at the first unpriced line (for the 'Show the N without a price' link)", async () => {
    const t = await scene([
      { name: "Katsu", qty: 1, unit: 50000 },
      { name: "Gyoza", qty: 1 },
    ]);
    expect(priceCompleteness(await kkbOf(t)).first?.line.label).toMatch(/Gyoza/i);
  });
});

// ---------- Copy summary text ----------
describe("kkbText: Copy summary uses exactly the KKB numbers (A19, D6)", () => {
  const amounts = (text: string) => [...text.matchAll(/₱[\d,]+\.\d{2}/g)].map((m) => m[0]);
  const textOf = async (t: Pick<Scene, "host">) => {
    const kkb = await kkbOf(t);
    return { text: kkbText(kkb, "Kovie's table", "19 Nov"), kkb };
  };
  const knownAmounts = (kkb: ReturnType<typeof buildKkb>) => {
    const set = new Set<string>([formatPeso(saloTotal(kkb)), formatPeso(kkb.foodCentavos)]);
    for (const s of kkb.sections) for (const n of [s.pricedCentavos, s.serviceCentavos, s.totalCentavos]) if (n != null) set.add(formatPeso(n));
    return set;
  };

  it("S01 all priced and the service charge split: food + service = total per person, 'Total' = Salo total, only KKB amounts appear", async () => {
    const t = await scene(
      [
        { name: "Katsu", qty: 2, unit: 24000 },
        { who: "ana", name: "Udon", qty: 1, unit: 30000 },
      ],
      7800,
    );
    const { text, kkb } = await textOf(t);
    expect(kkb.charge.state).toBe("allocated");
    expect(text).toContain(`Total ${formatPeso(78000 + 7800)}`);
    expect(text).not.toMatch(/Total not final/);
    for (const s of kkb.sections.filter((x) => !x.shared && x.status !== "empty")) {
      expect(text).toContain(s.title);
      expect(text).toContain(formatPeso(s.pricedCentavos));
      expect(text).toContain(formatPeso(s.totalCentavos!));
    }
    const known = knownAmounts(kkb);
    for (const a of amounts(text)) expect(known.has(a)).toBe(true);
    expect(text).toMatch(/Made with Salo/);
  });

  it("S02 the per-person totals in the text add up to the final total", async () => {
    const t = await scene(
      [
        { name: "A", qty: 1, unit: 3333 },
        { who: "ana", name: "B", qty: 1, unit: 3333 },
      ],
      101,
    );
    const { text, kkb } = await textOf(t);
    const sum = kkb.sections.filter((s) => !s.shared).reduce((n, s) => n + (s.totalCentavos ?? 0), 0);
    expect(text).toContain(`Total ${formatPeso(sum)}`);
  });

  it("S03 service charge not entered: no final total, says why", async () => {
    const t = await scene([{ name: "Katsu", qty: 2, unit: 24000 }]);
    const { text } = await textOf(t);
    expect(text).toMatch(/Total not final/);
    expect(text).not.toMatch(/^Total ₱/m);
    expect(text).toMatch(/not entered/i);
  });

  it("S04 service charge 0 ('none'): the total is final and equals the food", async () => {
    const t = await scene([{ name: "Katsu", qty: 2, unit: 24000 }], 0);
    const { text } = await textOf(t);
    expect(text).toContain(`Total ${formatPeso(48000)}`);
    expect(text).not.toMatch(/Total not final/);
  });

  it("S05 an unpriced dish: no final total, says how many dishes have no price, lists them under 'Not yet settled'", async () => {
    const t = await scene(
      [
        { name: "Katsu", qty: 2, unit: 24000 },
        { name: "Gyoza", qty: 3 },
      ],
      0,
    );
    const { text } = await textOf(t);
    expect(text).not.toMatch(/^Total ₱/m);
    expect(text).toMatch(/Total not final: 1 dish no price/);
    expect(text).toMatch(/Not yet settled:/);
    expect(text).toMatch(/Gyoza ×3/);
  });

  it("S06 a blocked service charge (change pending with the waiter): no final total", async () => {
    const t = await scene(
      [
        { name: "Katsu", qty: 2, unit: 24000 },
        { who: "ana", name: "Udon", qty: 1, unit: 30000 },
      ],
      7800,
    );
    await open(t.host);
    await correct(t.host, { entries: [{ sourceEntryId: t.ids[0], quantity: 1 }], type: "QUANTITY" });
    const { text, kkb } = await textOf(t);
    expect(kkb.charge.state).toBe("blocked");
    expect(text).toMatch(/Total not final/);
    expect(text).not.toMatch(/^Total ₱/m);
  });

  it("S11 service charge 0 and a cancellation still pending with the waiter: no final total", async () => {
    const t = await scene(
      [
        { name: "Katsu", qty: 2, unit: 24000 },
        { who: "ana", name: "Udon", qty: 1, unit: 30000 },
      ],
      0,
    );
    await open(t.host);
    await correct(t.host, { entries: [{ sourceEntryId: t.ids[0], quantity: 1 }], type: "QUANTITY" });
    const { text } = await textOf(t);
    expect(text).toMatch(/Total not final/);
    expect(text).not.toMatch(/^Total ₱/m);
  });

  it("S07 a priced shared dish nobody was billed for: listed as not settled, and the total is not final", async () => {
    const t = await scene(
      [
        { name: "Katsu", qty: 1, unit: 50000 },
        { name: "Nachos", qty: 1, unit: 30000, attr: "TABLE" },
      ],
      0,
    );
    const { text } = await textOf(t);
    expect(text).toMatch(/Not yet settled:/);
    expect(text).toMatch(/Nachos/);
    expect(text).not.toMatch(/^Total ₱/m);
  });

  it("S08 the copy never mentions the receipt total or the difference (that stays in the KKB view)", async () => {
    const t = await scene([{ name: "Katsu", qty: 2, unit: 24000 }], 0);
    await put(t.sessionId, t.hostWho, body(5555555, 0));
    const { text } = await textOf(t);
    expect(text).not.toMatch(/55,?555\.55|receipt/i);
  });

  it("S09 an order with nothing confirmed never prints a fabricated amount", async () => {
    const { host } = await newSession(db);
    const text = kkbText(buildKkb(await getSnapshot(db, host), host.participantId), "Empty", "19 Nov");
    for (const a of amounts(text)) expect(a).toBe("₱0.00");
  });

  it("S10 Items copy stays price-free (D6)", async () => {
    const t = await scene([{ name: "Katsu", qty: 2, unit: 24000 }], 0);
    const items = summaryText(buildSummary(await getSnapshot(db, t.host)), "19 Nov");
    expect(items).not.toMatch(/₱|240\.00|480\.00/);
  });
});

// ---------- limits (last: the limiter is in process memory) ----------
describe("PUT /receipt-total: limits", () => {
  it("M01 more than 120 changes a minute by one participant -> 429 RATE_LIMITED, nothing applied past the limit", async () => {
    const t = await basic();
    let limited: Res | null = null;
    let ok = 0;
    for (let i = 0; i < 130 && !limited; i++) {
      const r = await put(t.sessionId, t.hostWho, body(1000 + i, i));
      if (r.status === 200) ok++;
      else limited = r;
    }
    expect(limited?.status).toBe(429);
    expect(limited?.body.error?.code).toBe("RATE_LIMITED");
    expect(ok).toBeGreaterThanOrEqual(100);
    expect(ok).toBeLessThanOrEqual(120);
    expect((await receiptRow(t.sessionId)).r).toBe(ok);
  });
});
