/**
 * Contract tests for POST /api/sessions/:id/serving (food tracker served counts). Golden contract: docs/contracts/serving.md.
 * Drives the real route handler against the real test database (salo_test); only the cookie jar is faked.
 * Run: pnpm vitest run tests/contract-serving.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { POST as UNAVAILABLE } from "@/app/api/sessions/[id]/dishes/[dishId]/unavailable/route";
import { POST } from "@/app/api/sessions/[id]/serving/route";
import { GET as SYNC } from "@/app/api/sessions/[id]/sync/route";
import { PUT as SERVICE_CHARGE } from "@/app/api/sessions/[id]/service-charge/route";
import { preparationKey } from "@/lib/consolidate";
import { normalizeText } from "@/lib/dish-name";
import { buildKkb } from "@/lib/kkb";
import type { Actor } from "@/lib/permissions";
import { buildSummary } from "@/lib/summary";
import { proxy } from "@/proxy";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { confirmedRoundSnapshots, sessionEvents, sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { removeParticipant, setReady } from "@/server/orders/people";
import { closeSession, confirmRound, openRound, recordCorrections } from "@/server/orders/rounds";
import { correctionBatchSchema } from "@/server/orders/validation";
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
  body: { data?: { result: { served: number; revision: number }; revision: number; replayed: boolean }; error?: { code: string; message: string } };
}
async function post(sessionId: string, who: Who | null, payload: unknown, opts: { idem?: string | null; raw?: string } = {}): Promise<Res> {
  jar.cookies = who?.token ? { [credentialCookieName(sessionId)]: who.token } : {};
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost:3000" };
  if (opts.idem !== null) headers["idempotency-key"] = opts.idem ?? key();
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/serving`, { method: "POST", headers, body: opts.raw ?? JSON.stringify(payload) });
  const res = await within(POST(req, { params: Promise.resolve({ id: sessionId }) }), "POST serving");
  return { status: res.status, body: await res.json() };
}
async function sync(sessionId: string, who: Who) {
  jar.cookies = { [credentialCookieName(sessionId)]: who.token! };
  const res = await within(SYNC(new Request("http://localhost:3000/x"), { params: Promise.resolve({ id: sessionId }) }), "GET sync");
  return (await res.json()).data as Awaited<ReturnType<typeof getSnapshot>>;
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
const eventTypes = async (sessionId: string) => (await db.select({ t: sessionEvents.eventType }).from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId)).orderBy(sessionEvents.revision)).map((x) => x.t);
type ServedRow = { round_id: string; line_key: string; served: number; revision: number };
const servedRows = async (sessionId: string) => (await db.execute(sql`SELECT round_id, line_key, served, revision FROM served_counts WHERE session_id = ${sessionId} ORDER BY round_id, line_key`)) as unknown as ServedRow[];
const rawOf = async (sessionId: string, roundId: string, lineKey: string) => (await servedRows(sessionId)).find((r) => r.round_id === roundId && r.line_key === lineKey)?.served ?? 0;

/** The documented line keys: a preparation (dish id + normalized size + normalized notes) or `to:<normalized replacement>`. */
const lk = (dishId: string, variant: string | null = null, notes: string | null = null) => preparationKey({ dishId, variant, instructions: notes });
const toKey = (text: string) => `to:${normalizeText(text)}`;

async function confirm(host: Actor) {
  const snap = await getSnapshot(db, host);
  return run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, snap.session.revision));
}
const open = (host: Actor) => run(host, (tx, s) => openRound(tx, s, host));
const correct = (host: Actor, input: Record<string, unknown>) => run(host, (tx, s) => recordCorrections(tx, s, host, correctionBatchSchema.parse(input)));

/** Round 1 confirmed: host Katsu x2 + Ana Katsu x3 (one preparation, expected 5), host Gyoza x1. */
async function table() {
  const { host, sessionId, token } = await newSession(db);
  const ana = await guestOf(sessionId, "Ana");
  const h = await add(db, host, { dishName: "Chicken Katsu", quantity: 2, attribution: { type: "INDIVIDUAL" } });
  const a = await add(db, ana.actor, { dishName: "Chicken Katsu", quantity: 3, attribution: { type: "INDIVIDUAL" } });
  const g = await add(db, host, { dishName: "Gyoza", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  await confirm(host);
  const snap = await getSnapshot(db, host);
  const dishOf = (entryId: string) => snap.entries.find((e) => e.id === entryId)!.dishId;
  return {
    host,
    sessionId,
    hostWho: { token } as Who,
    ana,
    anaWho: { token: ana.token } as Who,
    roundId: snap.rounds[0].id,
    katsuId: dishOf(h.result.entryId),
    gyozaId: dishOf(g.result.entryId),
    hostKatsu: h.result.entryId,
    anaKatsu: a.result.entryId,
  };
}
type T = Awaited<ReturnType<typeof table>>;
const katsuKey = (t: T) => lk(t.katsuId);
const body = (roundId: string, lineKey: string, delta: unknown) => ({ roundId, lineKey, delta });

/** State that must not move when a request is refused. */
async function fingerprint(host: Actor, sessionId: string) {
  const snap = await getSnapshot(db, host);
  return JSON.stringify({ rev: await sessionRev(sessionId), served: await servedRows(sessionId), events: await eventTypes(sessionId), counts: snap.servedCounts });
}
async function expectRefused(t: Pick<T, "host" | "sessionId">, who: Who | null, payload: unknown, status: number | number[], code?: string | string[], opts: { idem?: string | null; raw?: string } = {}) {
  const before = await fingerprint(t.host, t.sessionId);
  const r = await post(t.sessionId, who, payload, opts);
  expect(Array.isArray(status) ? status : [status]).toContain(r.status);
  expect(r.body.data).toBeUndefined();
  expect(typeof r.body.error?.message).toBe("string");
  if (code) expect(Array.isArray(code) ? code : [code]).toContain(r.body.error?.code);
  expect(await fingerprint(t.host, t.sessionId)).toBe(before);
  return r;
}

// ---------- happy path and clamping ----------
describe("POST /serving: happy path and clamping", () => {
  it("V01 host serves one: 200 envelope, one revision bump, one serving.updated event, raw count in the snapshot", async () => {
    const t = await table();
    const before = await sessionRev(t.sessionId);
    const r = await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 1));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ result: { served: 1, revision: 1 }, revision: before + 1, replayed: false });
    expect(await sessionRev(t.sessionId)).toBe(before + 1);
    expect((await eventTypes(t.sessionId)).slice(-1)).toEqual(["serving.updated"]);
    expect((await getSnapshot(db, t.host)).servedCounts).toEqual([{ roundId: t.roundId, lineKey: katsuKey(t), served: 1 }]);
  });

  it("V02 expected is the sum of the line's entries (2 + 3): clamps at the top, repeatedly", async () => {
    const t = await table();
    const k = katsuKey(t);
    expect((await post(t.sessionId, t.hostWho, body(t.roundId, k, 3))).body.data?.result.served).toBe(3);
    expect((await post(t.sessionId, t.hostWho, body(t.roundId, k, 99))).body.data?.result.served).toBe(5);
    const again = await post(t.sessionId, t.hostWho, body(t.roundId, k, 1));
    expect(again.status).toBe(200);
    expect(again.body.data?.result.served).toBe(5);
    expect(await rawOf(t.sessionId, t.roundId, k)).toBe(5);
    expect((await post(t.sessionId, t.hostWho, body(t.roundId, lk(t.gyozaId), 7))).body.data?.result.served).toBe(1);
  });

  it("V03 clamps at the bottom: -1 at 0 stays 0; a big negative from 3 gives 0; never negative", async () => {
    const t = await table();
    const k = katsuKey(t);
    const first = await post(t.sessionId, t.hostWho, body(t.roundId, k, -1));
    expect(first.status).toBe(200);
    expect(first.body.data?.result.served).toBe(0);
    expect((await post(t.sessionId, t.hostWho, body(t.roundId, k, 3))).body.data?.result.served).toBe(3);
    expect((await post(t.sessionId, t.hostWho, body(t.roundId, k, -999))).body.data?.result.served).toBe(0);
    expect(await rawOf(t.sessionId, t.roundId, k)).toBe(0);
    for (const row of await servedRows(t.sessionId)) expect(row.served).toBeGreaterThanOrEqual(0);
  });

  it("V04 deltas add up; each real change raises the row's own revision", async () => {
    const t = await table();
    const k = katsuKey(t);
    const a = await post(t.sessionId, t.hostWho, body(t.roundId, k, 2));
    const b = await post(t.sessionId, t.hostWho, body(t.roundId, k, 1));
    const c = await post(t.sessionId, t.hostWho, body(t.roundId, k, -1));
    expect([a, b, c].map((r) => r.body.data?.result.served)).toEqual([2, 3, 2]);
    const revs = [a, b, c].map((r) => r.body.data!.result.revision);
    expect(revs[1]).toBeGreaterThan(revs[0]);
    expect(revs[2]).toBeGreaterThan(revs[1]);
  });

  it("V05 lines: size and notes spell-insensitive, different notes are different lines, rounds are separate lines", async () => {
    const { host, sessionId, token } = await newSession(db);
    const hostWho = { token } as Who;
    const a = await add(db, host, { dishName: "Ramen", quantity: 1, variant: "Large", attribution: { type: "TABLE" } });
    await add(db, host, { dishName: "Ramen", quantity: 2, variant: "  large ", attribution: { type: "TABLE" } });
    await add(db, host, { dishName: "Ramen", quantity: 4, variant: "Large", instructions: "No Egg", attribution: { type: "TABLE" } });
    await add(db, host, { dishName: "Ramen", quantity: 8, variant: "Small", attribution: { type: "TABLE" } });
    await confirm(host);
    await open(host);
    await add(db, host, { dishName: "Ramen", quantity: 16, variant: "Large", attribution: { type: "TABLE" } });
    await confirm(host);
    const snap = await getSnapshot(db, host);
    const [r1, r2] = snap.rounds;
    const ramen = snap.entries.find((e) => e.id === a.result.entryId)!.dishId;
    const serveAll = (roundId: string, k: string) => post(sessionId, hostWho, body(roundId, k, 99)).then((r) => r.body.data?.result.served);
    expect(await serveAll(r1.id, lk(ramen, "Large"))).toBe(3);
    expect(await serveAll(r1.id, lk(ramen, "large", "no egg"))).toBe(4);
    expect(await serveAll(r1.id, lk(ramen, "Small"))).toBe(8);
    expect(await serveAll(r2.id, lk(ramen, "Large"))).toBe(16);
    expect(await rawOf(sessionId, r1.id, lk(ramen, "Large"))).toBe(3);
  });

  it("V06 a pending correction (cancel or swap in the open round) does not change expected", async () => {
    const t = await table();
    await open(t.host);
    await correct(t.host, { entries: [{ sourceEntryId: t.anaKatsu, quantity: 3 }], type: "QUANTITY" });
    await correct(t.host, { entries: [{ sourceEntryId: t.hostKatsu }], type: "REPLACE", replacement: "Pork Katsu" });
    expect((await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 99))).body.data?.result.served).toBe(5);
    await expectRefused(t, t.hostWho, body(t.roundId, toKey("Pork Katsu"), 1), 404, "LINE_NOT_FOUND");
  });

  it("V07 a told cancellation below served: snapshot keeps raw and expected; the next write clamps from min(served, expected)", async () => {
    const t = await table();
    const k = katsuKey(t);
    await post(t.sessionId, t.hostWho, body(t.roundId, k, 99));
    await open(t.host);
    await correct(t.host, { entries: [{ sourceEntryId: t.anaKatsu, quantity: 3 }], type: "QUANTITY" });
    await confirm(t.host);
    const snap = await getSnapshot(db, t.host);
    expect(snap.servedCounts.find((c) => c.lineKey === k)?.served).toBe(5);
    const katsuItems = buildSummary(snap).sections.flatMap((s) => s.lines).filter((l) => /katsu/i.test(l.label));
    expect(katsuItems.reduce((n, l) => n + l.quantity, 0)).toBe(2);
    const down = await post(t.sessionId, t.hostWho, body(t.roundId, k, -1));
    expect(down.body.data?.result.served).toBe(1);
    expect(await rawOf(t.sessionId, t.roundId, k)).toBe(1);
    await post(t.sessionId, t.hostWho, body(t.roundId, k, 5));
    expect(await rawOf(t.sessionId, t.roundId, k)).toBe(2);
  });

  it("V08 a told cancellation below served, then +1: stored value is clamp(min(5,2)+1)=2, not 5", async () => {
    const t = await table();
    const k = katsuKey(t);
    await post(t.sessionId, t.hostWho, body(t.roundId, k, 99));
    await open(t.host);
    await correct(t.host, { entries: [{ sourceEntryId: t.anaKatsu, quantity: 3 }], type: "QUANTITY" });
    await confirm(t.host);
    const r = await post(t.sessionId, t.hostWho, body(t.roundId, k, 1));
    expect(r.status).toBe(200);
    expect(r.body.data?.result.served).toBe(2);
    expect(await rawOf(t.sessionId, t.roundId, k)).toBe(2);
  });

  it("V09 told replacement (Mark unavailable with a replacement) after 2 were served (D21): its own line, expected = the replaced quantity minus the 2 already served, starts at 0; the original is no longer servable", async () => {
    const t = await table();
    const k = katsuKey(t);
    await post(t.sessionId, t.hostWho, body(t.roundId, k, 2));
    const u = await unavailable(t.sessionId, t.hostWho, t.katsuId, { replacement: "Pork  KATSU" });
    expect(u.status).toBe(200);
    const snap = await getSnapshot(db, t.host);
    const swapKey = toKey("pork katsu");
    expect(snap.servedCounts.find((c) => c.lineKey === swapKey)?.served ?? 0).toBe(0);
    expect((await post(t.sessionId, t.hostWho, body(t.roundId, swapKey, 99))).body.data?.result.served).toBe(3);
    const orig = await post(t.sessionId, t.hostWho, body(t.roundId, k, 1));
    if (orig.status === 200) expect(orig.body.data?.result.served).toBe(0);
    else expect([orig.status, orig.body.error?.code]).toEqual([404, "LINE_NOT_FOUND"]);
  });

  it("V10 two swaps to the same replacement text (any spelling) share one line; its expected is the sum", async () => {
    const t = await table();
    await open(t.host);
    await correct(t.host, { entries: [{ sourceEntryId: t.hostKatsu }, { sourceEntryId: t.anaKatsu }], type: "REPLACE", replacement: "Pork Katsu" });
    await confirm(t.host);
    expect((await post(t.sessionId, t.hostWho, body(t.roundId, toKey("  pork   KATSU "), 99))).body.data?.result.served).toBe(5);
    expect((await getSnapshot(db, t.host)).servedCounts.length).toBe(1);
  });

  it("V11 a replacement told in round 2 for a round 1 dish lives in round 1 (the source round)", async () => {
    const t = await table();
    await open(t.host);
    await correct(t.host, { entries: [{ sourceEntryId: t.hostKatsu }], type: "REPLACE", replacement: "Pork Katsu" });
    await confirm(t.host);
    const snap = await getSnapshot(db, t.host);
    const r2 = snap.rounds[1].id;
    expect((await post(t.sessionId, t.hostWho, body(t.roundId, toKey("Pork Katsu"), 99))).body.data?.result.served).toBe(2);
    await expectRefused(t, t.hostWho, body(r2, toKey("Pork Katsu"), 1), 404, "LINE_NOT_FOUND");
    expect((await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 99))).body.data?.result.served).toBe(3);
  });

  it("V12 guests see the raw counts in /sync (read-only for them)", async () => {
    const t = await table();
    await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 2));
    const snap = await sync(t.sessionId, t.anaWho);
    expect(snap.servedCounts).toEqual([{ roundId: t.roundId, lineKey: katsuKey(t), served: 2 }]);
  });

  it("V13 a clamped no-op (already at 5, +1) answers 200 with the same count and leaves the stored value alone", async () => {
    const t = await table();
    const k = katsuKey(t);
    await post(t.sessionId, t.hostWho, body(t.roundId, k, 5));
    const r = await post(t.sessionId, t.hostWho, body(t.roundId, k, 1));
    expect(r.status).toBe(200);
    expect(r.body.data?.result.served).toBe(5);
    expect(await rawOf(t.sessionId, t.roundId, k)).toBe(5);
  });
});

// ---------- idempotency ----------
describe("POST /serving: idempotency", () => {
  it("I01 a retried key is applied once and returns the first result with replayed: true", async () => {
    const t = await table();
    const k = katsuKey(t);
    const idem = key();
    const before = await sessionRev(t.sessionId);
    const a = await post(t.sessionId, t.hostWho, body(t.roundId, k, 2), { idem });
    const b = await post(t.sessionId, t.hostWho, body(t.roundId, k, 2), { idem });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.data?.replayed).toBe(false);
    expect(b.body.data?.replayed).toBe(true);
    expect(b.body.data?.result).toEqual(a.body.data?.result);
    expect(b.body.data?.revision).toBe(a.body.data?.revision);
    expect(await sessionRev(t.sessionId)).toBe(before + 1);
    expect(await rawOf(t.sessionId, t.roundId, k)).toBe(2);
    expect((await eventTypes(t.sessionId)).filter((x) => x === "serving.updated")).toHaveLength(1);
  });

  it("I02 a replay after the count moved on returns the old result and does not roll back or re-apply", async () => {
    const t = await table();
    const k = katsuKey(t);
    const idem = key();
    await post(t.sessionId, t.hostWho, body(t.roundId, k, 1), { idem });
    await post(t.sessionId, t.hostWho, body(t.roundId, k, 2));
    const again = await post(t.sessionId, t.hostWho, body(t.roundId, k, 1), { idem });
    expect(again.body.data?.replayed).toBe(true);
    expect(again.body.data?.result.served).toBe(1);
    expect(await rawOf(t.sessionId, t.roundId, k)).toBe(3);
  });

  it("I03 the same key sent twice at once is applied once", async () => {
    const t = await table();
    const k = katsuKey(t);
    const idem = key();
    const rs = await Promise.all([post(t.sessionId, t.hostWho, body(t.roundId, k, 2), { idem }), post(t.sessionId, t.hostWho, body(t.roundId, k, 2), { idem })]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(rs.filter((r) => r.body.data?.replayed).length).toBe(1);
    expect(await rawOf(t.sessionId, t.roundId, k)).toBe(2);
  });

  it("I04 the key is bound to round + line: the same key on another line -> 422 IDEMPOTENCY_KEY_REUSED, nothing applied", async () => {
    const t = await table();
    const idem = key();
    await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 1), { idem });
    await expectRefused(t, t.hostWho, body(t.roundId, lk(t.gyozaId), 1), 422, "IDEMPOTENCY_KEY_REUSED", { idem });
  });

  it("I05 the same key used for another kind of change (service charge) -> 422 IDEMPOTENCY_KEY_REUSED", async () => {
    const t = await table();
    const idem = key();
    jar.cookies = { [credentialCookieName(t.sessionId)]: t.hostWho.token! };
    const sc = await SERVICE_CHARGE(
      new Request(`http://localhost:3000/api/sessions/${t.sessionId}/service-charge`, { method: "PUT", headers: { "content-type": "application/json", origin: "http://localhost:3000", "idempotency-key": idem }, body: JSON.stringify({ expectedRevision: 0, centavos: 100 }) }),
      { params: Promise.resolve({ id: t.sessionId }) },
    );
    expect(sc.status).toBe(200);
    await expectRefused(t, t.hostWho, body(t.roundId, katsuKey(t), 1), 422, "IDEMPOTENCY_KEY_REUSED", { idem });
  });

  it("I06 missing, short, odd-character or 101-character Idempotency-Key -> 400 IDEMPOTENCY_KEY", async () => {
    const t = await table();
    const b = body(t.roundId, katsuKey(t), 1);
    await expectRefused(t, t.hostWho, b, 400, "IDEMPOTENCY_KEY", { idem: null });
    for (const idem of ["short", "has space in it", "x".repeat(101), "bad/char/here"]) await expectRefused(t, t.hostWho, b, 400, "IDEMPOTENCY_KEY", { idem });
  });
});

// ---------- validation ----------
describe("POST /serving: validation (422 INVALID unless noted)", () => {
  it("N01 delta: 0, fractional, string, null, boolean, array, missing, huge -> refused, nothing changes", async () => {
    const t = await table();
    const k = katsuKey(t);
    for (const delta of [0, 1.5, -0.5, "1", null, true, [1], {}, 1_000_000, -1_000_000, 2 ** 53, 1e21, -1e21, Number.MAX_SAFE_INTEGER]) {
      await expectRefused(t, t.hostWho, body(t.roundId, k, delta), 422, "INVALID");
    }
    await expectRefused(t, t.hostWho, { roundId: t.roundId, lineKey: k }, 422, "INVALID");
    await expectRefused(t, t.hostWho, { roundId: t.roundId, lineKey: k, delta: Infinity }, 422, "INVALID");
  });

  it("N02 roundId must be a uuid; lineKey a non-empty string of a sane length", async () => {
    const t = await table();
    for (const roundId of ["", "not-a-uuid", null, 5, undefined, {}]) await expectRefused(t, t.hostWho, body(roundId as string, katsuKey(t), 1), 422, "INVALID");
    for (const lineKey of ["", null, 5, undefined, {}, []]) await expectRefused(t, t.hostWho, body(t.roundId, lineKey as string, 1), 422, "INVALID");
    await expectRefused(t, t.hostWho, body(t.roundId, "x".repeat(601), 1), [404, 422]);
  });

  it("N03 a NUL character in lineKey is refused cleanly (never a 500)", async () => {
    const t = await table();
    const r = await post(t.sessionId, t.hostWho, body(t.roundId, "abc\u0000def", 1));
    expect([404, 422]).toContain(r.status);
    expect(await servedRows(t.sessionId)).toHaveLength(0);
  });

  it("N04 body: not JSON -> 400 BAD_JSON; array, string, empty object -> 422; over 8 KB -> 413 TOO_LARGE", async () => {
    const t = await table();
    await expectRefused(t, t.hostWho, null, 400, "BAD_JSON", { raw: "{not json" });
    await expectRefused(t, t.hostWho, [], 422, "INVALID");
    await expectRefused(t, t.hostWho, "text", 422, "INVALID");
    await expectRefused(t, t.hostWho, {}, 422, "INVALID");
    await expectRefused(t, t.hostWho, { roundId: t.roundId, lineKey: "x".repeat(9000), delta: 1 }, 413, "TOO_LARGE");
  });

  it("N05 deltas of +/-10 are accepted and clamped", async () => {
    const t = await table();
    expect((await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 10))).body.data?.result.served).toBe(5);
    expect((await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), -10))).body.data?.result.served).toBe(0);
  });
});

// ---------- authorization ----------
describe("POST /serving: who may call", () => {
  it("A01 a guest -> 403 FORBIDDEN; nothing changes (even a guest with entries on that line)", async () => {
    const t = await table();
    await expectRefused(t, t.anaWho, body(t.roundId, katsuKey(t), 1), 403, "FORBIDDEN");
    await expectRefused(t, t.anaWho, body(t.roundId, katsuKey(t), -1), 403, "FORBIDDEN");
  });

  it("A02 no cookie, garbage cookie -> 404 NOT_FOUND (no hint the order exists)", async () => {
    const t = await table();
    await expectRefused(t, null, body(t.roundId, katsuKey(t), 1), 404, "NOT_FOUND");
    await expectRefused(t, { token: "garbage-token" }, body(t.roundId, katsuKey(t), 1), 404, "NOT_FOUND");
  });

  it("A03 another order's host (tenant): its token, even planted under this order's cookie name -> 404; both orders untouched", async () => {
    const a = await table();
    const b = await table();
    await expectRefused(a, b.hostWho, body(a.roundId, katsuKey(a), 1), 404, "NOT_FOUND");
    await expectRefused(b, a.hostWho, body(b.roundId, katsuKey(b), 1), 404, "NOT_FOUND");
    expect(await servedRows(a.sessionId)).toHaveLength(0);
    expect(await servedRows(b.sessionId)).toHaveLength(0);
  });

  it("A04 a removed guest is refused", async () => {
    const t = await table();
    await run(t.host, (tx, s) => removeParticipant(tx, s, t.host, t.ana.actor.participantId, null));
    const r = await post(t.sessionId, t.anaWho, body(t.roundId, katsuKey(t), 1));
    expect([403, 404]).toContain(r.status);
    expect(await servedRows(t.sessionId)).toHaveLength(0);
  });

  it("A05 Origin: a non-GET /api request without or with a foreign Origin is refused 403 FORBIDDEN_ORIGIN by the proxy; own origin passes", async () => {
    const mk = (origin?: string) => new NextRequest("http://localhost:3000/api/sessions/x/serving", { method: "POST", headers: origin ? { origin } : {} });
    for (const origin of [undefined, "https://evil.example", "http://localhost:3001"]) {
      const res = proxy(mk(origin));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN_ORIGIN");
    }
    expect(proxy(mk("http://localhost:3000")).status).toBe(200);
  });
});

// ---------- scoping and state ----------
describe("POST /serving: round, line and order state", () => {
  it("C01 closed order -> 409 SESSION_CLOSED; counts stay as they were", async () => {
    const t = await table();
    await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 2));
    await run(t.host, (tx, s) => closeSession(tx, s, t.host));
    await expectRefused(t, t.hostWho, body(t.roundId, katsuKey(t), 1), 409, "SESSION_CLOSED");
    await expectRefused(t, t.hostWho, body(t.roundId, katsuKey(t), -1), 409, "SESSION_CLOSED");
    expect(await rawOf(t.sessionId, t.roundId, katsuKey(t))).toBe(2);
  });

  it("C02 a DRAFT round (the open one, with dishes in it) -> 409 ROUND_NOT_CONFIRMED", async () => {
    const t = await table();
    await open(t.host);
    const e = await add(db, t.host, { dishName: "Ramen", quantity: 2, attribution: { type: "TABLE" } });
    const snap = await getSnapshot(db, t.host);
    const draft = snap.rounds.find((r) => r.id === snap.activeRoundId)!;
    const ramen = snap.entries.find((x) => x.id === e.result.entryId)!.dishId;
    await expectRefused(t, t.hostWho, body(draft.id, lk(ramen), 1), 409, "ROUND_NOT_CONFIRMED");
    await expectRefused(t, t.hostWho, body(draft.id, katsuKey(t), 1), [404, 409], ["ROUND_NOT_CONFIRMED", "LINE_NOT_FOUND"]);
  });

  it("C03 the very first (never confirmed) round is refused too", async () => {
    const s = await newSession(db);
    await add(db, s.host, { dishName: "Ramen", quantity: 1, attribution: { type: "TABLE" } });
    const snap = await getSnapshot(db, s.host);
    await expectRefused({ host: s.host, sessionId: s.sessionId }, { token: s.token }, body(snap.activeRoundId, lk(snap.entries[0].dishId), 1), 409, "ROUND_NOT_CONFIRMED");
  });

  it("C04 an unknown line -> 404 LINE_NOT_FOUND: random text, another dish's key, other notes or size, another round's line", async () => {
    const t = await table();
    await expectRefused(t, t.hostWho, body(t.roundId, "nope", 1), 404, "LINE_NOT_FOUND");
    await expectRefused(t, t.hostWho, body(t.roundId, lk(randomUUID()), 1), 404, "LINE_NOT_FOUND");
    await expectRefused(t, t.hostWho, body(t.roundId, lk(t.katsuId, null, "extra rice"), 1), 404, "LINE_NOT_FOUND");
    await expectRefused(t, t.hostWho, body(t.roundId, lk(t.katsuId, "Large"), 1), 404, "LINE_NOT_FOUND");
    await expectRefused(t, t.hostWho, body(t.roundId, toKey("Nothing"), 1), 404, "LINE_NOT_FOUND");
    await open(t.host);
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "TABLE" } });
    await confirm(t.host);
    const snap = await getSnapshot(db, t.host);
    await expectRefused(t, t.hostWho, body(snap.rounds[1].id, katsuKey(t), 1), 404, "LINE_NOT_FOUND");
  });

  it("C05 a round that does not exist, or belongs to another order, is refused; the other order's counts are untouched", async () => {
    const a = await table();
    const b = await table();
    await post(b.sessionId, b.hostWho, body(b.roundId, katsuKey(b), 2));
    await expectRefused(a, a.hostWho, body(randomUUID(), katsuKey(a), 1), [404, 422]);
    await expectRefused(a, a.hostWho, body(b.roundId, katsuKey(b), 1), [404, 422]);
    await expectRefused(a, a.hostWho, body(b.roundId, katsuKey(a), 1), [404, 422]);
    expect(await rawOf(b.sessionId, b.roundId, katsuKey(b))).toBe(2);
    expect(await servedRows(a.sessionId)).toHaveLength(0);
  });

  it("C06 a line whose dish was marked unavailable (cancelled to 0) can't be pushed above 0", async () => {
    const t = await table();
    await unavailable(t.sessionId, t.hostWho, t.gyozaId, {});
    const r = await post(t.sessionId, t.hostWho, body(t.roundId, lk(t.gyozaId), 3));
    if (r.status === 200) expect(r.body.data?.result.served).toBe(0);
    else expect([r.status, r.body.error?.code]).toEqual([404, "LINE_NOT_FOUND"]);
    expect(await rawOf(t.sessionId, t.roundId, lk(t.gyozaId))).toBe(0);
  });
});

// ---------- concurrency ----------
describe("POST /serving: races", () => {
  it("K01 many parallel +1 on a fresh line (no row yet): all 200, none lost, final = clamped sum, answers are the serial counts", async () => {
    const t = await table();
    const k = katsuKey(t);
    const rs = await Promise.all(Array.from({ length: 8 }, () => post(t.sessionId, t.hostWho, body(t.roundId, k, 1))));
    expect(rs.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(rs.map((r) => r.body.data!.result.served).sort()).toEqual([1, 2, 3, 4, 5, 5, 5, 5]);
    expect(await rawOf(t.sessionId, t.roundId, k)).toBe(5);
    expect(await servedRows(t.sessionId)).toHaveLength(1);
  });

  it("K02 many parallel +1 below the cap: final = the exact sum", async () => {
    const t = await table();
    const k = katsuKey(t);
    const rs = await Promise.all(Array.from({ length: 4 }, () => post(t.sessionId, t.hostWho, body(t.roundId, k, 1))));
    expect(rs.map((r) => r.body.data!.result.served).sort()).toEqual([1, 2, 3, 4]);
    expect(await rawOf(t.sessionId, t.roundId, k)).toBe(4);
  });

  it("K03 many parallel -1 from 5: final 0, never below, answers are the serial counts", async () => {
    const t = await table();
    const k = katsuKey(t);
    await post(t.sessionId, t.hostWho, body(t.roundId, k, 5));
    const rs = await Promise.all(Array.from({ length: 8 }, () => post(t.sessionId, t.hostWho, body(t.roundId, k, -1))));
    expect(rs.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(rs.map((r) => r.body.data!.result.served).sort()).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
    expect(await rawOf(t.sessionId, t.roundId, k)).toBe(0);
  });

  it("K04 mixed parallel deltas stay inside 0..expected and the snapshot matches the database", async () => {
    const t = await table();
    const k = katsuKey(t);
    const deltas = [2, -1, 3, -2, 4, -1, 1, -3, 2, 5];
    const rs = await Promise.all(deltas.map((d) => post(t.sessionId, t.hostWho, body(t.roundId, k, d))));
    expect(rs.map((r) => r.status)).toEqual(Array(deltas.length).fill(200));
    for (const r of rs) {
      expect(r.body.data!.result.served).toBeGreaterThanOrEqual(0);
      expect(r.body.data!.result.served).toBeLessThanOrEqual(5);
    }
    const raw = await rawOf(t.sessionId, t.roundId, k);
    expect(raw).toBeGreaterThanOrEqual(0);
    expect(raw).toBeLessThanOrEqual(5);
    expect((await getSnapshot(db, t.host)).servedCounts.find((c) => c.lineKey === k)?.served ?? 0).toBe(raw);
  });

  it("K05 parallel writes on different lines of one round all land (no conflict, no deadlock)", async () => {
    const t = await table();
    const rs = await Promise.all([post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 2)), post(t.sessionId, t.hostWho, body(t.roundId, lk(t.gyozaId), 1))]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(await servedRows(t.sessionId)).toHaveLength(2);
  });

  it("K06 a write racing a told cancellation (confirm of round 2): both succeed and the next write clamps", async () => {
    const t = await table();
    const k = katsuKey(t);
    await open(t.host);
    await correct(t.host, { entries: [{ sourceEntryId: t.anaKatsu, quantity: 3 }], type: "QUANTITY" });
    const snap = await getSnapshot(db, t.host);
    const [w, c] = await Promise.allSettled([post(t.sessionId, t.hostWho, body(t.roundId, k, 99)), run(t.host, (tx, s) => confirmRound(tx, s, t.host, snap.activeRoundId, snap.session.revision))]);
    expect(w.status).toBe("fulfilled");
    expect(c.status).toBe("fulfilled");
    const raw = await rawOf(t.sessionId, t.roundId, k);
    expect([2, 5]).toContain(raw);
    const next = await post(t.sessionId, t.hostWho, body(t.roundId, k, -1));
    expect(next.body.data?.result.served).toBe(1);
  });

  it("K07 a committed change rings the realtime bell (pg_notify on salo_events) within 15 s", async () => {
    const t = await table();
    let got: (v: string) => void = () => undefined;
    const heard = new Promise<string>((res) => (got = res));
    const sub = await db.$client.listen("salo_events", (payload) => {
      if (payload.includes(t.sessionId)) got(payload);
    });
    try {
      const [msg] = await within(Promise.all([heard, post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 1))]), "notify after POST");
      expect(msg).toContain(t.sessionId);
    } finally {
      await sub.unlisten();
    }
  });
});

// ---------- isolation from the ticket, KKB, Items ----------
describe("served state never reaches the waiter ticket, KKB or Items; never makes a confirm stale", () => {
  it("L01 stored ticket snapshots, live /sync tickets and the invite lookup carry no served data; events carry no counts", async () => {
    const t = await table();
    await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 4));
    await open(t.host);
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "TABLE" } });
    await confirm(t.host);
    await post(t.sessionId, t.hostWho, body(t.roundId, lk(t.gyozaId), 1));
    const stored = JSON.stringify((await db.select().from(confirmedRoundSnapshots)).map((r) => r.snapshotData));
    const snap = await sync(t.sessionId, t.anaWho);
    for (const text of [stored, JSON.stringify(snap.tickets)]) expect(text).not.toMatch(/served|lineKey|serving/i);
    expect(JSON.stringify(await findInvite(db, snap.session.joinCode))).not.toMatch(/served|lineKey|serving/i);
    const ev = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, t.sessionId));
    const payloads = ev.filter((e) => e.eventType === "serving.updated").map((e) => e.payload as Record<string, unknown>);
    expect(payloads.length).toBe(2);
    for (const p of payloads) {
      expect(Object.keys(p)).not.toContain("served");
      expect(Object.keys(p)).not.toContain("delta");
    }
  });

  it("L02 serving does not change KKB, Items, tickets, entries, corrections, settlement or readiness", async () => {
    const t = await table();
    await open(t.host);
    await add(db, t.ana.actor, { dishName: "Udon", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await run(t.ana.actor, (tx, s) => setReady(tx, s, t.ana.actor, true));
    const view = async () => {
      const snap = await getSnapshot(db, t.host);
      const { servedCounts: _s, session: _sess, ...rest } = snap;
      return JSON.stringify({ rest, kkb: buildKkb(snap, t.host.participantId), items: buildSummary(snap), stored: (await db.select().from(confirmedRoundSnapshots)).map((r) => r.snapshotData) });
    };
    const before = await view();
    await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 3));
    await post(t.sessionId, t.hostWho, body(t.roundId, lk(t.gyozaId), 1));
    await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), -2));
    expect(await view()).toBe(before);
  });

  it("L03 serving after the host looked does not make a pending round confirm stale", async () => {
    const t = await table();
    await open(t.host);
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "TABLE" } });
    const looked = await getSnapshot(db, t.host);
    await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 2));
    await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), -1));
    await post(t.sessionId, t.hostWho, body(t.roundId, lk(t.gyozaId), 1));
    expect((await getSnapshot(db, t.host)).session.revision).toBeGreaterThan(looked.session.revision);
    const r = await run(t.host, (tx, s) => confirmRound(tx, s, t.host, looked.activeRoundId, looked.session.revision));
    expect(r.result.roundId).toBe(looked.activeRoundId);
  });

  it("L04 control: a ticket-changing edit after the host looked still makes confirm stale", async () => {
    const t = await table();
    await open(t.host);
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "TABLE" } });
    const looked = await getSnapshot(db, t.host);
    await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 2));
    await add(db, t.host, { dishName: "Udon", quantity: 1, attribution: { type: "TABLE" } });
    await expect(run(t.host, (tx, s) => confirmRound(tx, s, t.host, looked.activeRoundId, looked.session.revision))).rejects.toMatchObject({ code: "STALE_REVISION" });
  });

  it("L05 serving does not reset anyone's readiness", async () => {
    const t = await table();
    await open(t.host);
    await add(db, t.ana.actor, { dishName: "Udon", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await run(t.ana.actor, (tx, s) => setReady(tx, s, t.ana.actor, true));
    await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 2));
    expect((await getSnapshot(db, t.host)).readiness.find((r) => r.participantId === t.ana.actor.participantId)?.ready).toBe(true);
  });
});

// ---------- DB guards, retention ----------
describe("served_counts: database guards and retention", () => {
  const ins = (sid: string, roundId: string, lineKey: string, served: number, revision: number, by: string) =>
    db.execute(sql`INSERT INTO served_counts (session_id, round_id, line_key, served, revision, updated_by) VALUES (${sid}, ${roundId}, ${lineKey}, ${served}, ${revision}, ${by})`);

  it("G01 a row cannot point at a round of another session (trigger), nor hold served < 0 or revision < 1; duplicate keys are refused", async () => {
    const a = await table();
    const b = await table();
    await expect(ins(a.sessionId, b.roundId, "k", 1, 1, a.host.participantId)).rejects.toThrow();
    await expect(ins(a.sessionId, a.roundId, "k", -1, 1, a.host.participantId)).rejects.toThrow();
    await expect(ins(a.sessionId, a.roundId, "k", 1, 0, a.host.participantId)).rejects.toThrow();
    await ins(a.sessionId, a.roundId, "k", 1, 1, a.host.participantId);
    await expect(ins(a.sessionId, a.roundId, "k", 2, 1, a.host.participantId)).rejects.toThrow();
    expect((await servedRows(b.sessionId)).length).toBe(0);
  });

  it("G02 the trigger also guards UPDATE: moving a row to another session's round is refused", async () => {
    const a = await table();
    const b = await table();
    await ins(a.sessionId, a.roundId, "k", 1, 1, a.host.participantId);
    await expect(db.execute(sql`UPDATE served_counts SET round_id = ${b.roundId} WHERE session_id = ${a.sessionId}`)).rejects.toThrow();
  });

  it("G03 deleting the order deletes its served counts (and only its own)", async () => {
    const a = await table();
    const b = await table();
    await post(a.sessionId, a.hostWho, body(a.roundId, katsuKey(a), 2));
    await post(b.sessionId, b.hostWho, body(b.roundId, katsuKey(b), 2));
    await db.execute(sql`DELETE FROM sessions WHERE id = ${a.sessionId}`);
    expect(await servedRows(a.sessionId)).toHaveLength(0);
    expect(await servedRows(b.sessionId)).toHaveLength(1);
  });

  it("G04 deleting a round deletes its served counts (cascade from round)", async () => {
    const t = await table();
    await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), 2));
    await db.execute(sql`DELETE FROM rounds WHERE id = ${t.roundId}`);
    expect(await servedRows(t.sessionId)).toHaveLength(0);
  });
});

// ---------- limits (last: the limiter is in process memory) ----------
describe("POST /serving: limits", () => {
  it("M01 more than 120 changes a minute by one participant -> 429 RATE_LIMITED", async () => {
    const t = await table();
    let limited: Res | null = null;
    let ok = 0;
    for (let i = 0; i < 130 && !limited; i++) {
      const r = await post(t.sessionId, t.hostWho, body(t.roundId, katsuKey(t), i % 2 === 0 ? 1 : -1));
      if (r.status === 200) ok++;
      else limited = r;
    }
    expect(limited?.status).toBe(429);
    expect(limited?.body.error?.code).toBe("RATE_LIMITED");
    expect(ok).toBeGreaterThanOrEqual(100);
    expect(ok).toBeLessThanOrEqual(120);
  });
});
