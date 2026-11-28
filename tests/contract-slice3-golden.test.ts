/**
 * Golden-contract suite for v1.4 slice 3 (co-hosts and safe serving), derived from docs/plans/salo-v1-4.md "Slice 3"
 * and brief F04/F12 rather than the implementation. Tables: docs/contracts/slice3-golden.md.
 * Run: perl -e 'alarm shift; exec @ARGV' 300 pnpm vitest run tests/contract-slice3-golden.test.ts (exit 142 = FAIL)
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const als = vi.hoisted(() => ({ store: undefined as unknown as import("node:async_hooks").AsyncLocalStorage<Record<string, string>> }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    const jar = als.store.getStore() ?? {};
    return { get: (name: string) => (jar[name] ? { name, value: jar[name] } : undefined) };
  },
}));
als.store = new AsyncLocalStorage<Record<string, string>>();

import { POST as CLOSE } from "@/app/api/sessions/[id]/close/route";
import { PUT as COHOST } from "@/app/api/sessions/[id]/participants/[pid]/cohost/route";
import { POST as REMOVE } from "@/app/api/sessions/[id]/participants/[pid]/remove/route";
import { POST as RESTORE } from "@/app/api/sessions/[id]/participants/[pid]/restore/route";
import { PUT as READY } from "@/app/api/sessions/[id]/readiness/route";
import { POST as ROUNDS } from "@/app/api/sessions/[id]/rounds/route";
import { POST as CONFIRM } from "@/app/api/sessions/[id]/rounds/[roundId]/confirm/route";
import { POST as SERVING } from "@/app/api/sessions/[id]/serving/route";
import { PUT as SERVICE_CHARGE } from "@/app/api/sessions/[id]/service-charge/route";
import { preparationKey } from "@/lib/consolidate";
import { notificationText } from "@/lib/notifications";
import type { Actor } from "@/lib/permissions";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { sessionEvents, sessions } from "@/server/db/schema";
import { loadNotifications } from "@/server/notifications";
import { runMutation } from "@/server/mutations";
import { confirmRound } from "@/server/orders/rounds";
import { joinSession } from "@/server/sessions/join";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, key, newSession } from "./helpers/session";

const db = testDb();
beforeEach(async () => {
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

interface Result {
  served: number;
  applied: boolean;
  revision: number;
  cohost: boolean;
}
interface Res {
  status: number;
  body: { data: { result: Result; replayed: boolean; revision: number }; error?: { code: string; message: string } };
}
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Who = { token: string | null };

async function call(what: string, h: unknown, method: string, sessionId: string, who: Who | null, params: Record<string, string>, payload?: unknown, idem: string | null = key()): Promise<Res> {
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost:3000" };
  if (idem !== null) headers["idempotency-key"] = idem;
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/x`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const jar = who?.token ? { [credentialCookieName(sessionId)]: who.token } : {};
  const res = await within(als.store.run(jar, () => (h as Handler)(req, { params: Promise.resolve({ id: sessionId, ...params }) })), what);
  return { status: res.status, body: await res.json() };
}
const codeOf = (r: Res) => [r.status, r.body.error?.code] as const;

const serve = (sid: string, who: Who | null, roundId: string, lineKey: string, delta: number, expectedServed: number, idem: string | null = key()) =>
  call("POST serving", SERVING, "POST", sid, who, {}, { roundId, lineKey, delta, expectedServed }, idem);
const cohost = (sid: string, who: Who | null, pid: string, value: unknown, idem: string | null = key()) => call("PUT cohost", COHOST, "PUT", sid, who, { pid }, { cohost: value }, idem);

/** Host + Jun, Liza, Mia. Round 1 confirmed: Katsu 2 + 3 (expected 5), Gyoza 1. */
async function table() {
  const { host, sessionId, token } = await newSession(db);
  const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, sessionId));
  const guest = async (name: string) => {
    const joined = await joinSession(db, code, name, sessionId);
    const actor = (await resolveActor(db, sessionId, joined.token)) as Actor;
    return { actor, id: actor.participantId, who: { token: joined.token } as Who };
  };
  const jun = await guest("Jun");
  const liza = await guest("Liza");
  const mia = await guest("Mia");
  const h = await add(db, host, { dishName: "Chicken Katsu", quantity: 2, attribution: { type: "INDIVIDUAL" } });
  await add(db, jun.actor, { dishName: "Chicken Katsu", quantity: 3, attribution: { type: "INDIVIDUAL" } });
  const g = await add(db, host, { dishName: "Gyoza", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  const before = await getSnapshot(db, host);
  await runMutation(db, host, { idempotencyKey: key(), type: "t" }, (tx, s) => confirmRound(tx, s, host, before.activeRoundId, before.session.revision));
  const snap = await getSnapshot(db, host);
  const dishOf = (id: string) => snap.entries.find((e) => e.id === id)!.dishId;
  return {
    host,
    hostWho: { token } as Who,
    sessionId,
    jun,
    liza,
    mia,
    roundId: snap.rounds[0].id,
    katsu: preparationKey({ dishId: dishOf(h.result.entryId), variant: null, instructions: null }),
    gyoza: preparationKey({ dishId: dishOf(g.result.entryId), variant: null, instructions: null }),
  };
}
type T = Awaited<ReturnType<typeof table>>;

const makeCohost = async (t: T, g: T["jun"], on = true) => expect((await cohost(t.sessionId, t.hostWho, g.id, on)).status).toBe(200);
const removeGuest = (t: T, g: T["jun"], who: Who = t.hostWho) => call("remove", REMOVE, "POST", t.sessionId, who, { pid: g.id }, {});

type ServedRow = { line_key: string; served: number; revision: number; updated_by: string };
const rows = async (sid: string) => (await db.execute(sql`SELECT line_key, served, revision, updated_by FROM served_counts WHERE session_id = ${sid} ORDER BY line_key`)) as unknown as ServedRow[];
const stored = async (t: T, lineKey: string) => (await rows(t.sessionId)).find((r) => r.line_key === lineKey)?.served ?? 0;
const rev = async (sid: string) => (await db.select({ r: sessions.revision }).from(sessions).where(eq(sessions.id, sid)))[0].r;
const events = async (sid: string) => await db.select({ t: sessionEvents.eventType, p: sessionEvents.payload }).from(sessionEvents).where(eq(sessionEvents.sessionId, sid)).orderBy(sessionEvents.revision);
const mark = async (pid: string) => ((await db.execute(sql`SELECT cohost_at FROM participants WHERE id = ${pid}`)) as unknown as { cohost_at: Date | null }[])[0].cohost_at;
const cohostNotices = async (who: Actor) => (await loadNotifications(db, who)).items.filter((n) => n.type.startsWith("participant.cohost"));
const servedNotices = async (sid: string) => ((await db.execute(sql`SELECT count(*)::int AS n FROM notifications WHERE session_id = ${sid} AND type = 'food.served'`)) as unknown as { n: number }[])[0].n;
const fingerprint = async (t: T) => JSON.stringify([await rev(t.sessionId), (await events(t.sessionId)).length, await rows(t.sessionId), await servedNotices(t.sessionId)]);

/**
 * "Lands between auth and the lock": a holder transaction takes the session lock, `fire()` passes requireActor and
 * queues behind it, `during` changes state inside the holder, then it commits and the queued call runs.
 */
async function betweenAuthAndLock<R>(sessionId: string, during: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>, fire: () => Promise<R>): Promise<R> {
  let pending!: Promise<R>;
  await db.transaction(async (tx) => {
    await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
    pending = fire();
    pending.catch(() => undefined);
    const stop = Date.now() + 10_000;
    for (;;) {
      const waiting = ((await tx.execute(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)) as unknown as { n: number }[])[0].n;
      if (waiting > 0) break;
      if (Date.now() > stop) throw new Error("deadline: the request never queued behind the session lock");
      await new Promise((r) => setTimeout(r, 25));
    }
    await during(tx);
  });
  return within(pending, "request released from the lock");
}

// ================= POST /serving =================
describe("POST /serving: who may serve", () => {
  it("S01 a co-host serves: 200 applied, served_counts.updated_by and the event name them", async () => {
    const t = await table();
    await makeCohost(t, t.liza);
    const r = await serve(t.sessionId, t.liza.who, t.roundId, t.katsu, 2, 0);
    expect(r.status).toBe(200);
    expect(r.body.data.result).toMatchObject({ served: 2, applied: true });
    expect((await rows(t.sessionId))[0]).toMatchObject({ served: 2, updated_by: t.liza.id });
    expect((await events(t.sessionId)).slice(-1)[0]).toEqual({ t: "serving.updated", p: { roundId: t.roundId, actorId: t.liza.id } });
  });

  it("S02 a guest is refused 403 FORBIDDEN, even with a stale count; nothing changes", async () => {
    const t = await table();
    await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 1, 0);
    const before = await fingerprint(t);
    for (const seen of [1, 0]) expect(codeOf(await serve(t.sessionId, t.liza.who, t.roundId, t.katsu, 1, seen))).toEqual([403, "FORBIDDEN"]);
    expect(await fingerprint(t)).toBe(before);
  });

  it("S03 a revoked co-host is refused 403 FORBIDDEN; nothing changes", async () => {
    const t = await table();
    await makeCohost(t, t.liza);
    await makeCohost(t, t.liza, false);
    const before = await fingerprint(t);
    expect(codeOf(await serve(t.sessionId, t.liza.who, t.roundId, t.katsu, 1, 0))).toEqual([403, "FORBIDDEN"]);
    expect(await fingerprint(t)).toBe(before);
  });

  it("S04 revoke lands between auth and the lock: the queued write is refused 403, nothing changes", async () => {
    const t = await table();
    await makeCohost(t, t.liza);
    const before = await fingerprint(t);
    const r = await betweenAuthAndLock(
      t.sessionId,
      async (tx) => void (await tx.execute(sql`UPDATE participants SET cohost_at = NULL WHERE id = ${t.liza.id}`)),
      () => serve(t.sessionId, t.liza.who, t.roundId, t.katsu, 1, 0),
    );
    expect(codeOf(r)).toEqual([403, "FORBIDDEN"]);
    expect(await fingerprint(t)).toBe(before);
  });

  it("S05 a guest promoted between auth and the lock is served by the fresh role (D20)", async () => {
    const t = await table();
    const r = await betweenAuthAndLock(
      t.sessionId,
      async (tx) => void (await tx.execute(sql`UPDATE participants SET cohost_at = now() WHERE id = ${t.liza.id}`)),
      () => serve(t.sessionId, t.liza.who, t.roundId, t.katsu, 1, 0),
    );
    expect(r.status).toBe(200);
    expect(await stored(t, t.katsu)).toBe(1);
  });

  it("S06 a removed co-host is refused (403 REMOVED); after Undo they are a plain guest (403 FORBIDDEN)", async () => {
    const t = await table();
    await makeCohost(t, t.liza);
    expect((await removeGuest(t, t.liza)).status).toBe(200);
    expect(codeOf(await serve(t.sessionId, t.liza.who, t.roundId, t.katsu, 1, 0))).toEqual([403, "REMOVED"]);
    expect((await call("restore", RESTORE, "POST", t.sessionId, t.hostWho, { pid: t.liza.id }, {})).status).toBe(200);
    expect(await mark(t.liza.id)).toBeNull();
    expect(codeOf(await serve(t.sessionId, t.liza.who, t.roundId, t.katsu, 1, 0))).toEqual([403, "FORBIDDEN"]);
  });

  it("S07 a co-host holds no other host power: close, new round, service charge, remove, assign, confirm are all 403", async () => {
    const t = await table();
    await makeCohost(t, t.liza);
    const before = await fingerprint(t);
    const snap = await getSnapshot(db, t.host);
    const lz = t.liza.who;
    const refusals = [
      await call("close", CLOSE, "POST", t.sessionId, lz, {}),
      await call("rounds", ROUNDS, "POST", t.sessionId, lz, {}, {}),
      await call("service-charge", SERVICE_CHARGE, "PUT", t.sessionId, lz, {}, { expectedRevision: 0, centavos: 100 }),
      await removeGuest(t, t.mia, lz),
      await cohost(t.sessionId, lz, t.mia.id, true),
      await cohost(t.sessionId, lz, t.liza.id, false),
      await call("confirm", CONFIRM, "POST", t.sessionId, lz, { roundId: snap.activeRoundId ?? t.roundId }, { expectedRevision: snap.session.revision }),
    ];
    expect(refusals.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403]);
    expect(await fingerprint(t)).toBe(before);
    expect(await mark(t.liza.id)).not.toBeNull();
    expect(await mark(t.mia.id)).toBeNull();
  });

  it("S08 another order's people see 404 on serving and assign; nothing changes", async () => {
    const a = await table();
    const b = await table();
    await makeCohost(a, a.liza);
    expect((await serve(b.sessionId, b.hostWho, a.roundId, a.katsu, 1, 0)).status).toBeOneOf([404, 422]);
    expect((await serve(b.sessionId, a.liza.who, b.roundId, b.katsu, 1, 0)).status).toBe(404);
    expect((await serve(a.sessionId, b.hostWho, a.roundId, a.katsu, 1, 0)).status).toBe(404);
    expect((await serve(a.sessionId, b.liza.who, a.roundId, a.katsu, 1, 0)).status).toBe(404);
    expect((await cohost(a.sessionId, b.hostWho, a.mia.id, true)).status).toBe(404);
    expect(await mark(a.mia.id)).toBeNull();
    expect(await rows(a.sessionId)).toEqual([]);
    expect(await rows(b.sessionId)).toEqual([]);
  });
});

describe("POST /serving: the count precondition", () => {
  it("P01 two co-hosts tap the same plate (both saw 0): exactly one applies; the other gets applied:false with the current count; the stale one changes no row", async () => {
    const t = await table();
    await makeCohost(t, t.jun);
    await makeCohost(t, t.liza);
    const [a, b] = await Promise.all([serve(t.sessionId, t.jun.who, t.roundId, t.katsu, 1, 0), serve(t.sessionId, t.liza.who, t.roundId, t.katsu, 1, 0)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const stale = [a, b].filter((r) => !r.body.data.result.applied);
    expect([a, b].filter((r) => r.body.data.result.applied)).toHaveLength(1);
    expect(stale).toHaveLength(1);
    expect(stale[0].body.data.result).toMatchObject({ served: 1, applied: false });
    const winner = a.body.data.result.applied ? t.jun.id : t.liza.id;
    expect((await rows(t.sessionId))[0]).toMatchObject({ served: 1, revision: 1, updated_by: winner });
  });

  it("P02 five racing taps by three servers that all saw 0 land exactly once", async () => {
    const t = await table();
    await makeCohost(t, t.jun);
    await makeCohost(t, t.liza);
    const rs = await Promise.all([t.hostWho, t.jun.who, t.liza.who, t.jun.who, t.liza.who].map((w) => serve(t.sessionId, w, t.roundId, t.katsu, 1, 0)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => r.body.data.result.applied)).toHaveLength(1);
    expect(rs.every((r) => r.body.data.result.served === 1)).toBe(true);
    expect((await rows(t.sessionId))[0]).toMatchObject({ served: 1, revision: 1 });
  });

  it("P03 a stale tap leaves the row alone but still bumps the session revision and appends one event (pinned)", async () => {
    const t = await table();
    await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 2, 0);
    const rowsBefore = await rows(t.sessionId);
    const [r0, e0] = [await rev(t.sessionId), (await events(t.sessionId)).length];
    const r = await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 1, 0);
    expect(r.body.data.result).toMatchObject({ served: 2, applied: false, revision: rowsBefore[0].revision });
    expect(await rows(t.sessionId)).toEqual(rowsBefore);
    expect([await rev(t.sessionId), (await events(t.sessionId)).length]).toEqual([r0 + 1, e0 + 1]);
  });

  it("P04 a stale tap sends no notification even when its delta would have completed the line", async () => {
    const t = await table();
    await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 4, 0);
    const n0 = await servedNotices(t.sessionId);
    const r = await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 1, 3);
    expect(r.body.data.result).toMatchObject({ served: 4, applied: false });
    expect(await servedNotices(t.sessionId)).toBe(n0);
    expect((await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 1, 4)).body.data.result).toMatchObject({ served: 5, applied: true });
    expect(await servedNotices(t.sessionId)).toBe(n0 + 1);
  });

  it("P05 idempotent replay returns the stored result even after the count moved, and applies nothing", async () => {
    const t = await table();
    const idem = key();
    const first = await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 1, 0, idem);
    await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 2, 1);
    const again = await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 1, 0, idem);
    expect(again.body.data).toMatchObject({ replayed: true, result: first.body.data.result, revision: first.body.data.revision });
    expect(await stored(t, t.katsu)).toBe(3);
  });

  it("P06 a retried stale batch applies nothing, even after the count has come to match what it saw", async () => {
    const t = await table();
    await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 2, 0);
    const idem = key();
    const first = await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 1, 0, idem);
    expect(first.body.data.result).toMatchObject({ served: 2, applied: false });
    await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, -2, 2);
    const again = await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 1, 0, idem);
    expect(again.body.data).toMatchObject({ replayed: true, result: { served: 2, applied: false } });
    expect(await stored(t, t.katsu)).toBe(0);
  });

  it("P07 the same key with the same body three times at once applies once", async () => {
    const t = await table();
    const idem = key();
    const rs = await Promise.all([1, 2, 3].map(() => serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 1, 0, idem)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(rs.filter((r) => r.body.data.replayed)).toHaveLength(2);
    expect(await stored(t, t.katsu)).toBe(1);
  });

  it("P08 clamping: +99 stops at expected, -99 stops at 0, a clamped no-op still reports applied:true", async () => {
    const t = await table();
    expect((await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 99, 0)).body.data.result).toMatchObject({ served: 5, applied: true });
    expect((await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 1, 5)).body.data.result).toMatchObject({ served: 5, applied: true });
    expect((await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, -99, 5)).body.data.result).toMatchObject({ served: 0, applied: true });
    expect((await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, -1, 0)).body.data.result).toMatchObject({ served: 0, applied: true });
    expect(await stored(t, t.katsu)).toBe(0);
  });

  it("P09 expectedServed above expected is a mismatch (applied:false), not a clamp", async () => {
    const t = await table();
    const r = await serve(t.sessionId, t.hostWho, t.roundId, t.gyoza, 1, 99);
    expect(r.body.data.result).toMatchObject({ served: 0, applied: false });
    expect(await stored(t, t.gyoza)).toBe(0);
  });

  it("P10 expectedServed is required: missing, negative, fractional, string, null -> 422 INVALID, nothing changes", async () => {
    const t = await table();
    const before = await fingerprint(t);
    const bodies: Record<string, unknown>[] = [{}, { expectedServed: -1 }, { expectedServed: 0.5 }, { expectedServed: "0" }, { expectedServed: null }, { expectedServed: [0] }];
    for (const extra of bodies) {
      const r = await call("serving 422", SERVING, "POST", t.sessionId, t.hostWho, {}, { roundId: t.roundId, lineKey: t.katsu, delta: 1, ...extra });
      expect(codeOf(r)).toEqual([422, "INVALID"]);
    }
    expect(await fingerprint(t)).toBe(before);
  });

  it("P11 a closed order refuses serving: 409 SESSION_CLOSED, nothing changes", async () => {
    const t = await table();
    await makeCohost(t, t.liza);
    await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 1, 0);
    expect((await call("close", CLOSE, "POST", t.sessionId, t.hostWho, {})).status).toBe(200);
    const before = await fingerprint(t);
    for (const who of [t.hostWho, t.liza.who]) expect(codeOf(await serve(t.sessionId, who, t.roundId, t.katsu, 1, 1))).toEqual([409, "SESSION_CLOSED"]);
    expect(await fingerprint(t)).toBe(before);
  });

  it("P12 serving and co-host events do not make the host's pending Confirm stale", async () => {
    const t = await table();
    expect((await call("rounds", ROUNDS, "POST", t.sessionId, t.hostWho, {}, {})).status).toBe(201);
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "TABLE" } });
    const looked = await getSnapshot(db, t.host);
    await makeCohost(t, t.liza);
    await serve(t.sessionId, t.liza.who, t.roundId, t.katsu, 1, 0);
    await serve(t.sessionId, t.hostWho, t.roundId, t.katsu, 1, 0);
    await makeCohost(t, t.liza, false);
    const r = await call("confirm", CONFIRM, "POST", t.sessionId, t.hostWho, { roundId: looked.activeRoundId }, { expectedRevision: looked.session.revision });
    expect(r.status).toBe(200);
  });
});

describe("every other write: the ROLE_CHANGED guard (D20)", () => {
  const openRound = async (t: T) => expect((await call("rounds", ROUNDS, "POST", t.sessionId, t.hostWho, {}, {})).status).toBe(201);

  it("R01 a role that moved between auth and the lock -> 403 ROLE_CHANGED; the write does not land", async () => {
    const t = await table();
    await openRound(t);
    const r = await betweenAuthAndLock(
      t.sessionId,
      async (tx) => {
        await tx.execute(sql`UPDATE participants SET role = 'GUEST' WHERE id = ${t.host.participantId}`);
        await tx.execute(sql`UPDATE participants SET role = 'HOST' WHERE id = ${t.mia.id}`);
      },
      () => call("ready", READY, "PUT", t.sessionId, t.mia.who, {}, { ready: true }),
    );
    expect(codeOf(r)).toEqual([403, "ROLE_CHANGED"]);
    expect(((await db.execute(sql`SELECT count(*)::int AS n FROM mutation_records WHERE actor_id = ${t.mia.id}`)) as unknown as { n: number }[])[0].n).toBe(0);
  });

  it("R02 a co-host losing the mark is not a role change: their other guest writes still succeed", async () => {
    const t = await table();
    await openRound(t);
    await makeCohost(t, t.liza);
    const r = await betweenAuthAndLock(
      t.sessionId,
      async (tx) => void (await tx.execute(sql`UPDATE participants SET cohost_at = NULL WHERE id = ${t.liza.id}`)),
      () => call("ready", READY, "PUT", t.sessionId, t.liza.who, {}, { ready: true }),
    );
    expect(r.status).toBe(200);
  });

  it("R03 a replay of an earlier legitimate write is answered before the role check", async () => {
    const t = await table();
    await openRound(t);
    const idem = key();
    expect((await call("ready", READY, "PUT", t.sessionId, t.mia.who, {}, { ready: true }, idem)).status).toBe(200);
    const again = await betweenAuthAndLock(
      t.sessionId,
      async (tx) => {
        await tx.execute(sql`UPDATE participants SET role = 'GUEST' WHERE id = ${t.host.participantId}`);
        await tx.execute(sql`UPDATE participants SET role = 'HOST' WHERE id = ${t.mia.id}`);
      },
      () => call("ready", READY, "PUT", t.sessionId, t.mia.who, {}, { ready: true }, idem),
    );
    expect(again.status).toBe(200);
    expect(again.body.data.replayed).toBe(true);
  });
});

// ================= PUT /participants/:pid/cohost =================
describe("PUT /cohost", () => {
  it("C01 assign: 200, mark set, snapshot shows it to everyone, event carries ids only", async () => {
    const t = await table();
    const r = await cohost(t.sessionId, t.hostWho, t.jun.id, true);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ result: { cohost: true }, replayed: false });
    expect(await mark(t.jun.id)).not.toBeNull();
    for (const viewer of [t.host, t.jun.actor, t.liza.actor]) expect((await getSnapshot(db, viewer)).participants.filter((p) => p.cohost).map((p) => p.id)).toEqual([t.jun.id]);
    expect((await getSnapshot(db, t.jun.actor)).me.cohost).toBe(true);
    expect((await getSnapshot(db, t.liza.actor)).me.cohost).toBe(false);
    expect((await events(t.sessionId)).slice(-1)[0]).toEqual({ t: "participant.cohostSet", p: { participantId: t.jun.id } });
  });

  it("C02 revoke clears the mark, emits participant.cohostRevoked, snapshot shows a plain guest", async () => {
    const t = await table();
    await makeCohost(t, t.jun);
    expect((await cohost(t.sessionId, t.hostWho, t.jun.id, false)).status).toBe(200);
    expect(await mark(t.jun.id)).toBeNull();
    expect((await events(t.sessionId)).slice(-1)[0].t).toBe("participant.cohostRevoked");
    expect((await getSnapshot(db, t.jun.actor)).me.cohost).toBe(false);
  });

  it("C03 same value again (new keys) is a 200 no-op: no second notification, the mark keeps its time; same for revoke", async () => {
    const t = await table();
    await makeCohost(t, t.jun);
    const marked = await mark(t.jun.id);
    expect((await cohost(t.sessionId, t.hostWho, t.jun.id, true)).status).toBe(200);
    expect(await mark(t.jun.id)).toEqual(marked);
    expect(await cohostNotices(t.jun.actor)).toHaveLength(1);
    await makeCohost(t, t.jun, false);
    expect((await cohost(t.sessionId, t.hostWho, t.jun.id, false)).status).toBe(200);
    expect((await cohostNotices(t.jun.actor)).map((n) => n.type).sort()).toEqual(["participant.cohostRevoked", "participant.cohostSet"]);
    expect((await cohost(t.sessionId, t.hostWho, t.liza.id, false)).status).toBe(200);
    expect(await cohostNotices(t.liza.actor)).toHaveLength(0);
  });

  it("C04 callers: a guest and a co-host get 403 FORBIDDEN; nothing changes", async () => {
    const t = await table();
    await makeCohost(t, t.jun);
    const before = await fingerprint(t);
    for (const who of [t.liza.who, t.jun.who]) expect(codeOf(await cohost(t.sessionId, who, t.mia.id, true))).toEqual([403, "FORBIDDEN"]);
    expect(await mark(t.mia.id)).toBeNull();
    expect(await fingerprint(t)).toBe(before);
  });

  it("C05 target: host -> 409 NOT_A_GUEST; removed -> 409 ALREADY_REMOVED; unknown, foreign, bad uuid -> 404 PERSON_NOT_FOUND", async () => {
    const t = await table();
    const other = await table();
    expect(codeOf(await cohost(t.sessionId, t.hostWho, t.host.participantId, true))).toEqual([409, "NOT_A_GUEST"]);
    expect(codeOf(await cohost(t.sessionId, t.hostWho, t.host.participantId, false))).toEqual([409, "NOT_A_GUEST"]);
    await makeCohost(t, t.jun);
    expect((await removeGuest(t, t.jun)).status).toBe(200);
    expect(codeOf(await cohost(t.sessionId, t.hostWho, t.jun.id, true))).toEqual([409, "ALREADY_REMOVED"]);
    for (const pid of [randomUUID(), other.jun.id, "nope"]) expect(codeOf(await cohost(t.sessionId, t.hostWho, pid, true))).toEqual([404, "PERSON_NOT_FOUND"]);
    expect(await mark(other.jun.id)).toBeNull();
  });

  it("C06 a closed order refuses assign and revoke: 409 SESSION_CLOSED, marks stay", async () => {
    const t = await table();
    await makeCohost(t, t.jun);
    expect((await call("close", CLOSE, "POST", t.sessionId, t.hostWho, {})).status).toBe(200);
    expect(codeOf(await cohost(t.sessionId, t.hostWho, t.jun.id, false))).toEqual([409, "SESSION_CLOSED"]);
    expect(codeOf(await cohost(t.sessionId, t.hostWho, t.liza.id, true))).toEqual([409, "SESSION_CLOSED"]);
    expect(await mark(t.jun.id)).not.toBeNull();
    expect(await mark(t.liza.id)).toBeNull();
    expect((await getSnapshot(db, t.liza.actor)).participants.find((p) => p.id === t.jun.id)?.cohost).toBe(true);
  });

  it("C07 body and identity: not {cohost:boolean} -> 422; no cookie -> 404; no idempotency key -> 400", async () => {
    const t = await table();
    const before = await fingerprint(t);
    for (const body of [{}, { cohost: "yes" }, { cohost: null }, { cohost: 1 }, [], "x"]) expect((await call("422", COHOST, "PUT", t.sessionId, t.hostWho, { pid: t.jun.id }, body)).status).toBe(422);
    expect((await cohost(t.sessionId, null, t.jun.id, true)).status).toBe(404);
    expect(codeOf(await cohost(t.sessionId, t.hostWho, t.jun.id, true, null))).toEqual([400, "IDEMPOTENCY_KEY"]);
    expect(await fingerprint(t)).toBe(before);
  });

  it("C08 removal clears the mark; Undo restores a plain guest; re-assign then works and notifies", async () => {
    const t = await table();
    await makeCohost(t, t.jun);
    expect((await removeGuest(t, t.jun)).status).toBe(200);
    expect(await mark(t.jun.id)).toBeNull();
    expect((await getSnapshot(db, t.host)).participants.find((p) => p.id === t.jun.id)?.cohost ?? false).toBe(false);
    expect((await call("restore", RESTORE, "POST", t.sessionId, t.hostWho, { pid: t.jun.id }, {})).status).toBe(200);
    expect(await mark(t.jun.id)).toBeNull();
    expect((await getSnapshot(db, t.jun.actor)).me.cohost).toBe(false);
    await makeCohost(t, t.jun);
    expect(await cohostNotices(t.jun.actor)).toHaveLength(2);
  });

  it("C09 re-assign after a revoke notifies again; text and recipient are exactly the D18 copy", async () => {
    const t = await table();
    await makeCohost(t, t.jun);
    await makeCohost(t, t.jun, false);
    await makeCohost(t, t.jun);
    const items = await cohostNotices(t.jun.actor);
    expect(items.map((n) => n.type).sort()).toEqual(["participant.cohostRevoked", "participant.cohostSet", "participant.cohostSet"]);
    expect(await cohostNotices(t.liza.actor)).toHaveLength(0);
    expect(await cohostNotices(t.host)).toHaveLength(0);
    expect(notificationText(items.find((n) => n.type === "participant.cohostSet")!)).toBe(`${t.host.displayName} made you a co-host. You can mark food as served.`);
    expect(notificationText(items.find((n) => n.type === "participant.cohostRevoked")!)).toBe(`${t.host.displayName} stopped your co-host role.`);
  });

  it("C10 a retried key applies once and replays (one event, one notification)", async () => {
    const t = await table();
    const idem = key();
    const a = await cohost(t.sessionId, t.hostWho, t.jun.id, true, idem);
    const b = await cohost(t.sessionId, t.hostWho, t.jun.id, true, idem);
    expect([a.body.data.replayed, b.body.data.replayed]).toEqual([false, true]);
    expect((await events(t.sessionId)).filter((e) => e.t === "participant.cohostSet")).toHaveLength(1);
    expect(await cohostNotices(t.jun.actor)).toHaveLength(1);
  });

  it("C11 racing assigns with different keys: one mark, one notification; assign racing revoke ends consistent with its last event", async () => {
    const t = await table();
    const rs = await Promise.all([1, 2, 3, 4].map(() => cohost(t.sessionId, t.hostWho, t.jun.id, true)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(await cohostNotices(t.jun.actor)).toHaveLength(1);
    const mixed = await Promise.all([true, false, true, false].map((v) => cohost(t.sessionId, t.hostWho, t.liza.id, v)));
    expect(mixed.every((r) => r.status === 200)).toBe(true);
    const evs = (await events(t.sessionId)).filter((e) => (e.p as { participantId?: string }).participantId === t.liza.id);
    expect((await mark(t.liza.id)) !== null).toBe(evs[evs.length - 1].t === "participant.cohostSet");
  });

  it("C12 assign racing the removal of the same guest never 500s and never leaves a removed co-host", async () => {
    const t = await table();
    const [a, b] = await Promise.all([cohost(t.sessionId, t.hostWho, t.jun.id, true), removeGuest(t, t.jun)]);
    expect(a.status).toBeOneOf([200, 409]);
    expect(b.status).toBe(200);
    expect(await mark(t.jun.id)).toBeNull();
  });

  it("C13 a co-host removed while a serving write is queued never gets that write in (403 REMOVED)", async () => {
    const t = await table();
    await makeCohost(t, t.jun);
    const r = await betweenAuthAndLock(
      t.sessionId,
      async (tx) => void (await tx.execute(sql`UPDATE participants SET cohost_at = NULL, removed_at = now() WHERE id = ${t.jun.id}`)),
      () => serve(t.sessionId, t.jun.who, t.roundId, t.katsu, 1, 0),
    );
    expect(codeOf(r)).toEqual([403, "REMOVED"]);
    expect(await rows(t.sessionId)).toEqual([]);
  });

  it("C14 revoke racing a co-host's serve: serve is 200 (before the revoke) or 403 (after), never a 5xx; afterwards serving is refused", async () => {
    const t = await table();
    await makeCohost(t, t.jun);
    const [s, r] = await Promise.all([serve(t.sessionId, t.jun.who, t.roundId, t.katsu, 1, 0), cohost(t.sessionId, t.hostWho, t.jun.id, false)]);
    expect(r.status).toBe(200);
    expect(s.status).toBeOneOf([200, 403]);
    expect(await stored(t, t.katsu)).toBe(s.status === 200 ? 1 : 0);
    expect(codeOf(await serve(t.sessionId, t.jun.who, t.roundId, t.katsu, 1, await stored(t, t.katsu)))).toEqual([403, "FORBIDDEN"]);
  });
});
