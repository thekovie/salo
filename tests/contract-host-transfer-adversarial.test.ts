/** Adversarial contract tests: PUT /host (F09) and the D38 readiness notice (F08). Expectations come from docs/plans/salo-v1-4.md Slice 6, docs/api.md, docs/security.md.
 * Golden: docs/contracts/host-transfer.md. Run: pnpm vitest run tests/contract-host-transfer-adversarial.test.ts */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { DELETE as ENTRY_DELETE } from "@/app/api/sessions/[id]/entries/[entryId]/route";
import { PUT as HOST } from "@/app/api/sessions/[id]/host/route";
import { PATCH as ME } from "@/app/api/sessions/[id]/me/route";
import { PUT as GROUPS } from "@/app/api/sessions/[id]/groups/route";
import { POST as CLOSE } from "@/app/api/sessions/[id]/close/route";
import { PUT as PRICE } from "@/app/api/sessions/[id]/prices/route";
import { PUT as READY } from "@/app/api/sessions/[id]/readiness/route";
import { POST as CONFIRM } from "@/app/api/sessions/[id]/rounds/[roundId]/confirm/route";
import { POST as OPEN_ROUND } from "@/app/api/sessions/[id]/rounds/route";
import { PATCH as TITLE } from "@/app/api/sessions/[id]/route";
import { GET as SYNC } from "@/app/api/sessions/[id]/sync/route";
import { notificationTarget, notificationText } from "@/lib/notifications";
import type { Actor } from "@/lib/permissions";
import { proxy } from "@/proxy";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { loadNotifications } from "@/server/notifications";
import { NON_TICKET_EVENTS } from "@/server/orders/settlement";
import { removeParticipant, requestClaim } from "@/server/orders/people";
import { joinSession } from "@/server/sessions/join";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, key, newSession } from "./helpers/session";

vi.setConfig({ testTimeout: 40_000 });
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

interface Res {
  status: number;
  body: { data?: Record<string, unknown> & { result?: Record<string, unknown>; replayed?: boolean; revision?: number }; error?: { code: string; message: string } };
}
type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
interface Opts {
  method?: string;
  path?: string;
  params?: Record<string, string>;
  body?: unknown;
  raw?: string;
  idem?: string | null;
}
async function call(what: string, handler: unknown, sid: string, token: string | null, o: Opts = {}): Promise<Res> {
  jar.cookies = token ? { [credentialCookieName(sid)]: token } : {};
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost:3000" };
  const method = o.method ?? "POST";
  if (method !== "GET" && o.idem !== null) headers["idempotency-key"] = o.idem ?? key();
  const init: RequestInit = { method, headers };
  if (method !== "GET") init.body = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
  const req = new Request(`http://localhost:3000/api/sessions/${sid}${o.path ?? ""}`, init);
  const res = await within((handler as Handler)(req, { params: Promise.resolve({ id: sid, ...(o.params ?? {}) } as never) }), what);
  const text = await res.text();
  let body: Res["body"] = {};
  try {
    body = JSON.parse(text);
  } catch {
    // a non-JSON reply leaves body empty and fails the status/code assertions
  }
  return { status: res.status, body };
}
const codeOf = (r: Res) => [r.status, r.body.error?.code];

interface Person {
  id: string;
  token: string;
  actor: Actor;
  name: string;
}
async function guestOf(sid: string, name: string): Promise<Person> {
  const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, sid));
  const joined = await joinSession(db, code, name, sid);
  const actor = (await resolveActor(db, sid, joined.token)) as Actor;
  return { id: actor.participantId, token: joined.token, actor, name };
}
/** A host named "Kovie" (so a rename is visible) and guests Jun, Liza, Ana. */
async function room() {
  const { host, sessionId: sid, token } = await newSession(db);
  await db.execute(sql`UPDATE participants SET display_name = 'Kovie' WHERE id = ${host.participantId}`);
  const hostActor = (await resolveActor(db, sid, token)) as Actor;
  const h: Person = { id: host.participantId, token, actor: hostActor, name: "Kovie" };
  return { sid, host: h, jun: await guestOf(sid, "Jun"), liza: await guestOf(sid, "Liza"), ana: await guestOf(sid, "Ana") };
}
type Room = Awaited<ReturnType<typeof room>>;

const transfer = (t: Room, who: { token: string | null } | null, body: unknown, o: Opts = {}) =>
  call("PUT /host", HOST, t.sid, who?.token ?? null, { method: "PUT", path: "/host", body, ...o });
const toJun = (t: Room, extra: Record<string, unknown> = {}, o: Opts = {}) => transfer(t, t.host, { participantId: t.jun.id, ...extra }, o);
const ready = (t: Room, p: Person, v: unknown) => call("PUT /readiness", READY, t.sid, p.token, { method: "PUT", path: "/readiness", body: { ready: v } });
const sync = async (t: Room, p: Person) => (await call("GET /sync", SYNC, t.sid, p.token, { method: "GET", path: "/sync" })).body.data as unknown as Awaited<ReturnType<typeof getSnapshot>>;
const fresh = async (t: Room, p: Person) => (await resolveActor(db, t.sid, p.token)) as Actor;
const openRound = async (t: Room) => {
  const r = await call("POST /rounds", OPEN_ROUND, t.sid, t.host.token, { path: "/rounds" });
  expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
};
const confirmWith = (t: Room, who: Person, roundId: string, expectedRevision: number) =>
  call("POST confirm", CONFIRM, t.sid, who.token, { path: `/rounds/${roundId}/confirm`, params: { roundId }, body: { expectedRevision } });

type PRow = { id: string; role: string; cohost_at: Date | null; display_name: string; removed_at: Date | null };
const roleRows = async (sid: string) => (await db.execute(sql`SELECT id, role, cohost_at, display_name, removed_at FROM participants WHERE session_id = ${sid} ORDER BY created_at, id`)) as unknown as PRow[];
const row = async (sid: string, pid: string) => (await roleRows(sid)).find((r) => r.id === pid)!;
const hostIds = async (sid: string) => (await roleRows(sid)).filter((r) => r.role === "HOST").map((r) => r.id);
const events = async (sid: string) => (await db.execute(sql`SELECT event_type AS t, payload AS p FROM session_events WHERE session_id = ${sid} ORDER BY revision`)) as unknown as { t: string; p: Record<string, unknown> }[];
const transferEvents = async (sid: string) => (await events(sid)).filter((e) => e.t === "host.transferred");
const rev = async (sid: string) => (await db.select({ r: sessions.revision }).from(sessions).where(eq(sessions.id, sid)))[0].r;
type NRow = { id: string; recipient_id: string; type: string; subject: Record<string, unknown>; dedup_key: string };
const nrows = async (sid: string, type?: string) =>
  ((await db.execute(sql`SELECT id, recipient_id, type, subject, dedup_key FROM notifications WHERE session_id = ${sid} ORDER BY created_at, id`)) as unknown as NRow[]).filter((r) => !type || r.type === type);
const noticesFor = async (who: Actor, type: string) => (await loadNotifications(db, who)).items.filter((n) => n.type === type);
/** Everything a failed request must leave alone. */
async function fingerprint(sid: string) {
  const s = (await db.execute(sql`SELECT * FROM sessions WHERE id = ${sid}`)) as unknown as unknown[];
  const m = (await db.execute(sql`SELECT count(*)::int AS n FROM mutation_records WHERE session_id = ${sid}`)) as unknown as { n: number }[];
  const c = (await db.execute(sql`SELECT id, status FROM entry_claims WHERE session_id = ${sid} ORDER BY id`)) as unknown as unknown[];
  return JSON.stringify({ s, ev: await events(sid), m: m[0].n, n: await nrows(sid), p: await roleRows(sid), c });
}

/** Hold the session lock, fire requests one by one (each must queue before the next is sent, so lock order = array order), run `during` inside the holder, release. */
async function holdLock<R>(sid: string, fires: Array<() => Promise<R>>, during?: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>): Promise<R[]> {
  const pending: Promise<R>[] = [];
  await db.transaction(async (tx) => {
    await tx.select().from(sessions).where(eq(sessions.id, sid)).for("update");
    for (const [i, fire] of fires.entries()) {
      const p = fire();
      let early: unknown;
      p.then((v) => (early = v), (e) => (early = e));
      pending.push(p);
      const stop = Date.now() + 10_000;
      for (;;) {
        await tx.execute(sql`SELECT pg_stat_clear_snapshot()`);
        const waiting = ((await tx.execute(sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)) as unknown as { n: number }[])[0].n;
        if (waiting > i) break;
        if (early !== undefined) throw new Error(`request ${i} finished without queuing behind the session lock: ${JSON.stringify(early)}`);
        if (Date.now() > stop) throw new Error(`deadline: request ${i} never queued behind the session lock`);
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    if (during) await during(tx);
  });
  return Promise.all(pending.map((p, i) => within(p, `request ${i} released from the lock`)));
}

const ind = (p: Person) => ({ type: "INDIVIDUAL" as const, participantId: p.id });
const addFor = (who: Actor, dishName: string, attribution: Record<string, unknown>) => add(db, who, { dishName, quantity: 1, attribution });

// ================= PUT /host =================
describe("PUT /host: happy path and shape", () => {
  it("A01 host hands to a guest: 200 {hostId}, roles swapped, exactly one HOST, both co-host marks null, one event with ids only, revision +1, every viewer sees it", async () => {
    const t = await room();
    const before = await rev(t.sid);
    const r = await toJun(t);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ result: { hostId: t.jun.id }, replayed: false });
    expect(await hostIds(t.sid)).toEqual([t.jun.id]);
    expect((await row(t.sid, t.host.id)).role).toBe("GUEST");
    expect((await row(t.sid, t.host.id)).cohost_at).toBeNull();
    expect((await row(t.sid, t.jun.id)).cohost_at).toBeNull();
    expect(await rev(t.sid)).toBe(before + 1);
    expect(await transferEvents(t.sid)).toEqual([{ t: "host.transferred", p: { fromId: t.host.id, toId: t.jun.id } }]);
    expect((await getSnapshot(db, await fresh(t, t.jun))).me.role).toBe("HOST");
    expect((await getSnapshot(db, await fresh(t, t.host))).me.role).toBe("GUEST");
    expect((await getSnapshot(db, await fresh(t, t.liza))).me.role).toBe("GUEST");
  });

  it("A02 a co-host as target: becomes HOST with the co-host mark cleared (CHECK cohost implies GUEST), snapshot shows no co-host", async () => {
    const t = await room();
    await db.execute(sql`UPDATE participants SET cohost_at = now() WHERE id = ${t.jun.id}`);
    const r = await toJun(t);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await hostIds(t.sid)).toEqual([t.jun.id]);
    expect((await row(t.sid, t.jun.id)).cohost_at).toBeNull();
    const snap = await getSnapshot(db, await fresh(t, t.jun));
    expect(snap.participants.filter((p) => p.cohost)).toEqual([]);
    expect(snap.me.cohost).toBeFalsy();
  });

  it("A03 hand back and forth: always exactly one HOST, each hand-over tells the new host once", async () => {
    const t = await room();
    expect((await toJun(t)).status).toBe(200);
    const back = await transfer(t, t.jun, { participantId: t.host.id });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(await hostIds(t.sid)).toEqual([t.host.id]);
    const again = await toJun(t);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(await hostIds(t.sid)).toEqual([t.jun.id]);
    expect((await nrows(t.sid, "host.transferred")).map((n) => n.recipient_id)).toEqual([t.jun.id, t.host.id, t.jun.id]);
    expect(await transferEvents(t.sid)).toHaveLength(3);
  });
});

describe("PUT /host: who may call", () => {
  it("B01 guest and co-host callers -> 403 FORBIDDEN, nothing changes (even when naming themselves or the host)", async () => {
    const t = await room();
    await db.execute(sql`UPDATE participants SET cohost_at = now() WHERE id = ${t.jun.id}`);
    const fp = await fingerprint(t.sid);
    for (const who of [t.liza, t.jun]) for (const target of [t.liza, t.jun, t.host]) {
      expect(codeOf(await transfer(t, who, { participantId: target.id })), `${who.name}->${target.name}`).toEqual([403, "FORBIDDEN"]);
    }
    expect(await fingerprint(t.sid)).toBe(fp);
  });

  it("B02 no cookie, garbage cookie, another order's host or guest token -> 404 and nothing changes", async () => {
    const t = await room();
    const other = await room();
    const fp = await fingerprint(t.sid);
    for (const who of [null, { token: "garbage" }, { token: "x".repeat(64) }, other.host, other.jun]) {
      const r = await transfer(t, who, { participantId: t.jun.id });
      expect(r.status, JSON.stringify(who)).toBe(404);
    }
    expect(await fingerprint(t.sid)).toBe(fp);
    expect(await hostIds(other.sid)).toEqual([other.host.id]);
  });

  it("B03 a removed guest cannot transfer (403 or 404), and nothing changes", async () => {
    const t = await room();
    await runMutation(db, t.host.actor, { idempotencyKey: key(), type: "t" }, (tx, s) => removeParticipant(tx, s, t.host.actor, t.liza.id, null));
    const fp = await fingerprint(t.sid);
    const r = await transfer(t, t.liza, { participantId: t.liza.id });
    expect([403, 404]).toContain(r.status);
    expect(await fingerprint(t.sid)).toBe(fp);
  });

  it("B04 the proxy refuses a PUT /host with a missing or foreign Origin (403 FORBIDDEN_ORIGIN)", async () => {
    const mk = (origin?: string) => new NextRequest("http://localhost:3000/api/sessions/x/host", { method: "PUT", headers: origin ? { origin } : {} });
    for (const origin of [undefined, "https://evil.example"]) {
      const res = proxy(mk(origin));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN_ORIGIN");
    }
    expect(proxy(mk("http://localhost:3000")).status).not.toBe(403);
  });
});

describe("PUT /host: targets", () => {
  it("C01 yourself -> 422 ALREADY_HOST, checked before anything else (displayName not applied)", async () => {
    const t = await room();
    const fp = await fingerprint(t.sid);
    expect(codeOf(await transfer(t, t.host, { participantId: t.host.id }))).toEqual([422, "ALREADY_HOST"]);
    expect(codeOf(await transfer(t, t.host, { participantId: t.host.id, displayName: "Renamed" }))).toEqual([422, "ALREADY_HOST"]);
    expect(await fingerprint(t.sid)).toBe(fp);
  });

  it("C02 a removed guest -> 409 ALREADY_REMOVED (never a 500 from the CHECK); nothing changes", async () => {
    const t = await room();
    await runMutation(db, t.host.actor, { idempotencyKey: key(), type: "t" }, (tx, s) => removeParticipant(tx, s, t.host.actor, t.liza.id, null));
    const fp = await fingerprint(t.sid);
    expect(codeOf(await transfer(t, t.host, { participantId: t.liza.id }))).toEqual([409, "ALREADY_REMOVED"]);
    expect(await fingerprint(t.sid)).toBe(fp);
  });

  it("C03 unknown uuid, another order's participant, non-uuid string -> 404 PERSON_NOT_FOUND; nothing changes", async () => {
    const t = await room();
    const other = await room();
    const fp = await fingerprint(t.sid);
    for (const pid of [randomUUID(), other.jun.id, other.host.id, "nope", "' OR 1=1 --"]) {
      expect(codeOf(await transfer(t, t.host, { participantId: pid })), pid).toEqual([404, "PERSON_NOT_FOUND"]);
    }
    expect(await fingerprint(t.sid)).toBe(fp);
    expect(await hostIds(other.sid)).toEqual([other.host.id]);
  });

  it("C04 an ended order -> 409 SESSION_CLOSED; roles stay", async () => {
    const t = await room();
    const closed = await call("POST close", CLOSE, t.sid, t.host.token, { path: "/close" });
    expect(closed.status, JSON.stringify(closed.body)).toBeLessThan(300);
    const fp = await fingerprint(t.sid);
    expect(codeOf(await toJun(t))).toEqual([409, "SESSION_CLOSED"]);
    expect(await fingerprint(t.sid)).toBe(fp);
    expect(await hostIds(t.sid)).toEqual([t.host.id]);
  });
});

describe("PUT /host: body", () => {
  it("D01 invalid bodies are 4xx (never 5xx) and change nothing; no Idempotency-Key -> 400", async () => {
    const t = await room();
    const fp = await fingerprint(t.sid);
    const bad: unknown[] = [{}, [], null, "x", 5, { participantId: 5 }, { participantId: null }, { participantId: "" }, { participantId: t.jun.id, displayName: 5 }, { participantId: t.jun.id, displayName: {} }, { participantId: [t.jun.id] }, { participantId: { id: t.jun.id } }];
    for (const body of bad) {
      const r = await transfer(t, t.host, body);
      expect(r.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
      expect(r.status, JSON.stringify(body)).toBeLessThan(500);
    }
    for (const raw of ["{", "not json", ""]) {
      const r = await transfer(t, t.host, undefined, { raw });
      expect(r.status, raw).toBeGreaterThanOrEqual(400);
      expect(r.status, raw).toBeLessThan(500);
    }
    expect((await toJun(t, {}, { idem: null })).status).toBe(400);
    expect(await fingerprint(t.sid)).toBe(fp);
  });

  it("D02 displayName: renames the old host (trimmed) before the demotion; the new host's notice uses the new name", async () => {
    const t = await room();
    const r = await toJun(t, { displayName: "  Kovie R.  " });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await row(t.sid, t.host.id)).display_name).toBe("Kovie R.");
    expect(await hostIds(t.sid)).toEqual([t.jun.id]);
    const n = await noticesFor(await fresh(t, t.jun), "host.transferred");
    expect(n.map(notificationText)).toEqual(["Kovie R. made you the host."]);
    const snap = await getSnapshot(db, await fresh(t, t.liza));
    expect(snap.participants.find((p) => p.id === t.host.id)?.displayName).toBe("Kovie R.");
  });

  it("D03 no displayName: both names are kept, the notice uses the old host's current name", async () => {
    const t = await room();
    expect((await toJun(t)).status).toBe(200);
    expect((await row(t.sid, t.host.id)).display_name).toBe("Kovie");
    expect((await row(t.sid, t.jun.id)).display_name).toBe("Jun");
    const n = await noticesFor(await fresh(t, t.jun), "host.transferred");
    expect(n.map(notificationText)).toEqual(["Kovie made you the host."]);
  });

  it("D04 invalid displayName (empty, blanks, 41 chars) -> 422 and the transfer does NOT happen; exactly 40 chars is accepted", async () => {
    const t = await room();
    const fp = await fingerprint(t.sid);
    for (const displayName of ["", "   ", "\t\n", "x".repeat(41), "  " + "y".repeat(41) + "  "]) {
      expect((await toJun(t, { displayName })).status, JSON.stringify(displayName)).toBe(422);
    }
    expect(await fingerprint(t.sid)).toBe(fp);
    const ok = await toJun(t, { displayName: "z".repeat(40) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await row(t.sid, t.host.id)).display_name).toBe("z".repeat(40));
  });

  it("D05 displayName: null is a 4xx or ignored, never a 5xx and never a blank name", async () => {
    const t = await room();
    const r = await toJun(t, { displayName: null });
    expect(r.status).toBeLessThan(500);
    expect((await row(t.sid, t.host.id)).display_name).toBe("Kovie");
  });

  it("D06 unknown extra fields do not smuggle in a second target or a role", async () => {
    const t = await room();
    const r = await toJun(t, { role: "HOST", hostId: t.liza.id, toId: t.liza.id });
    expect(r.status).toBeLessThan(500);
    if (r.status === 200) expect(await hostIds(t.sid)).toEqual([t.jun.id]);
  });
});

describe("PUT /host: retries, races, stale writes", () => {
  it("E01 same idempotency key again: replayed, same result, one event, one notice, roles unchanged", async () => {
    const t = await room();
    const idem = key();
    const a = await toJun(t, {}, { idem });
    const b = await toJun(t, {}, { idem });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.body.data?.replayed).toBe(true);
    expect(b.body.data?.result).toEqual(a.body.data?.result);
    expect(await transferEvents(t.sid)).toHaveLength(1);
    expect(await nrows(t.sid, "host.transferred")).toHaveLength(1);
    expect(await hostIds(t.sid)).toEqual([t.jun.id]);
  });

  it("E02 the same key reused for a different target never hands the order to the second person", async () => {
    const t = await room();
    const idem = key();
    expect((await toJun(t, {}, { idem })).status).toBe(200);
    await transfer(t, t.host, { participantId: t.liza.id }, { idem });
    expect(await hostIds(t.sid)).toEqual([t.jun.id]);
    expect(await transferEvents(t.sid)).toHaveLength(1);
  });

  it("E03 two transfers in flight together (different keys, both authed as HOST): the first wins, the second is 403 ROLE_CHANGED; one HOST, one event, one notice", async () => {
    const t = await room();
    const [a, b] = await holdLock(t.sid, [() => transfer(t, t.host, { participantId: t.jun.id }), () => transfer(t, t.host, { participantId: t.liza.id })]);
    expect([a.status, codeOf(b)]).toEqual([200, [403, "ROLE_CHANGED"]]);
    expect(await hostIds(t.sid)).toEqual([t.jun.id]);
    expect(await transferEvents(t.sid)).toHaveLength(1);
    expect(await nrows(t.sid, "host.transferred")).toHaveLength(1);
    expect((await row(t.sid, t.liza.id)).role).toBe("GUEST");
  });

  it("E04 two unsynchronised concurrent transfers (4 rounds): exactly one 200, the loser 403 ROLE_CHANGED or FORBIDDEN, one HOST, never a 5xx", async () => {
    for (let i = 0; i < 4; i++) {
      const t = await room();
      const [a, b] = await Promise.all([transfer(t, t.host, { participantId: t.jun.id }), transfer(t, t.host, { participantId: t.liza.id })]);
      expect([a.status, b.status].sort(), JSON.stringify([a.body, b.body])).toEqual([200, 403]);
      expect(["ROLE_CHANGED", "FORBIDDEN"]).toContain((a.status === 200 ? b : a).body.error?.code);
      expect(await hostIds(t.sid)).toHaveLength(1);
      expect(await transferEvents(t.sid)).toHaveLength(1);
    }
  });

  it("E05 a transfer racing a hand-back by the new host never leaves zero or two hosts, never a 5xx", async () => {
    const t = await room();
    expect((await toJun(t)).status).toBe(200);
    const [a, b] = await Promise.all([transfer(t, t.jun, { participantId: t.host.id }), transfer(t, t.host, { participantId: t.liza.id })]);
    expect([a.status, b.status].some((s) => s >= 500), JSON.stringify([a.body, b.body])).toBe(false);
    expect(await hostIds(t.sid)).toHaveLength(1);
  });

  it("E06 the old host's host-only writes after the commit -> 403 FORBIDDEN each, nothing lands", async () => {
    const t = await room();
    await addFor(t.host.actor, "Katsu", { type: "TABLE" });
    const snap0 = await getSnapshot(db, t.host.actor);
    expect((await toJun(t)).status).toBe(200);
    const fp = await fingerprint(t.sid);
    const writes: Array<[string, Promise<Res>]> = [
      ["rename", call("PATCH me", ME, t.sid, t.host.token, { method: "PATCH", path: "/me", body: { displayName: "Still Host" } })],
      ["title", call("PATCH session", TITLE, t.sid, t.host.token, { method: "PATCH", body: { title: "Mine" } })],
      ["confirm", confirmWith(t, t.host, snap0.activeRoundId as string, snap0.session.revision)],
      ["price", call("PUT prices", PRICE, t.sid, t.host.token, { method: "PUT", path: "/prices", body: { dishId: snap0.entries[0].dishId, variant: null, unitCentavos: 1000, expectedRevision: 0 } })],
      ["close", call("POST close", CLOSE, t.sid, t.host.token, { path: "/close" })],
      ["transfer", transfer(t, t.host, { participantId: t.liza.id })],
      ["transfer-back-to-self", transfer(t, t.host, { participantId: t.host.id })],
    ];
    for (const [name, p] of writes) expect(codeOf(await p), name).toEqual([403, "FORBIDDEN"]);
    expect(await fingerprint(t.sid)).toBe(fp);
    expect(await hostIds(t.sid)).toEqual([t.jun.id]);
  });

  it("E07 an old-host write already in flight while the transfer lands -> 403 ROLE_CHANGED and it does not land; the new host's write lands at once", async () => {
    const t = await room();
    const [tr, rename] = await holdLock(t.sid, [
      () => transfer(t, t.host, { participantId: t.jun.id }),
      () => call("PATCH me", ME, t.sid, t.host.token, { method: "PATCH", path: "/me", body: { displayName: "Late Rename" } }),
    ]);
    expect(tr.status, JSON.stringify(tr.body)).toBe(200);
    expect(codeOf(rename)).toEqual([403, "ROLE_CHANGED"]);
    expect((await row(t.sid, t.host.id)).display_name).toBe("Kovie");
    const mine = await call("PATCH me", ME, t.sid, t.jun.token, { method: "PATCH", path: "/me", body: { displayName: "Jun the Host" } });
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect((await row(t.sid, t.jun.id)).display_name).toBe("Jun the Host");
  });

  it("E08 the old host's in-flight CONFIRM while the transfer lands: 403 ROLE_CHANGED, the round stays open", async () => {
    const t = await room();
    await addFor(t.host.actor, "Katsu", { type: "TABLE" });
    const snap0 = await getSnapshot(db, t.host.actor);
    const [tr, conf] = await holdLock(t.sid, [() => transfer(t, t.host, { participantId: t.jun.id }), () => confirmWith(t, t.host, snap0.activeRoundId as string, snap0.session.revision)]);
    expect(tr.status).toBe(200);
    expect(codeOf(conf)).toEqual([403, "ROLE_CHANGED"]);
    expect((await sync(t, t.jun)).rounds.filter((r) => r.status === "CONFIRMED")).toHaveLength(0);
  });

  it("E09 a role swap committed between auth and lock (raw SQL, as R01) while a transfer is queued -> 403 ROLE_CHANGED, no event, still one HOST", async () => {
    const t = await room();
    const [a] = await holdLock(t.sid, [() => transfer(t, t.host, { participantId: t.jun.id })], async (tx) => {
      await tx.execute(sql`UPDATE participants SET role = 'GUEST' WHERE id = ${t.host.id}`);
      await tx.execute(sql`UPDATE participants SET role = 'HOST' WHERE id = ${t.liza.id}`);
    });
    expect(codeOf(a)).toEqual([403, "ROLE_CHANGED"]);
    expect(await hostIds(t.sid)).toEqual([t.liza.id]);
    expect(await transferEvents(t.sid)).toHaveLength(0);
  });

  it("E10 the demoted host can still read (sync 200) and sees themself as GUEST; the new host sees HOST", async () => {
    const t = await room();
    expect((await toJun(t)).status).toBe(200);
    expect((await sync(t, t.host)).me.role).toBe("GUEST");
    expect((await sync(t, t.jun)).me.role).toBe("HOST");
  });
});

describe("PUT /host: state that moves while the request is queued", () => {
  it("Q01 the target is removed between auth and lock -> 409 ALREADY_REMOVED (re-read under the lock), no HOST change, no event", async () => {
    const t = await room();
    const [r] = await holdLock(t.sid, [() => toJun(t)], async (tx) => void (await tx.execute(sql`UPDATE participants SET removed_at = now() WHERE id = ${t.jun.id}`)));
    expect(codeOf(r)).toEqual([409, "ALREADY_REMOVED"]);
    expect(await hostIds(t.sid)).toEqual([t.host.id]);
    expect(await transferEvents(t.sid)).toHaveLength(0);
  });

  it("Q02 the target is made a co-host between auth and lock -> 200 and the mark is cleared (no CHECK violation, no 5xx)", async () => {
    const t = await room();
    const [r] = await holdLock(t.sid, [() => toJun(t)], async (tx) => void (await tx.execute(sql`UPDATE participants SET cohost_at = now() WHERE id = ${t.jun.id}`)));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await hostIds(t.sid)).toEqual([t.jun.id]);
    expect((await row(t.sid, t.jun.id)).cohost_at).toBeNull();
  });

  it("Q03 the order ends between auth and lock -> 409 SESSION_CLOSED, roles unchanged", async () => {
    const t = await room();
    const [r] = await holdLock(t.sid, [() => toJun(t)], async (tx) => void (await tx.execute(sql`UPDATE sessions SET status = 'CLOSED', closed_at = now() WHERE id = ${t.sid}`)));
    expect(codeOf(r)).toEqual([409, "SESSION_CLOSED"]);
    expect(await hostIds(t.sid)).toEqual([t.host.id]);
  });
});

describe("PUT /host: claims, events, notices", () => {
  it("F01 the target's pending claims are rejected (with a resolved time); another guest's claim stays pending", async () => {
    const t = await room();
    await addFor(t.host.actor, "Katsu", { type: "UNASSIGNED" });
    const batch = (await getSnapshot(db, t.host.actor)).entries[0].batchId;
    await runMutation(db, t.jun.actor, { idempotencyKey: key(), type: "t" }, (tx, s) => requestClaim(tx, s, t.jun.actor, batch));
    await runMutation(db, t.liza.actor, { idempotencyKey: key(), type: "t" }, (tx, s) => requestClaim(tx, s, t.liza.actor, batch));
    expect((await toJun(t)).status).toBe(200);
    const claims = (await db.execute(sql`SELECT requested_by, status, resolved_at FROM entry_claims WHERE session_id = ${t.sid}`)) as unknown as { requested_by: string; status: string; resolved_at: Date | null }[];
    const by = (id: string) => claims.find((c) => c.requested_by === id)!;
    expect(by(t.jun.id).status).toBe("REJECTED");
    expect(by(t.jun.id).resolved_at).not.toBeNull();
    expect(by(t.liza.id).status).toBe("PENDING");
  });

  it("F02 host.transferred is a NON_TICKET event: the new host's confirm with a pre-transfer revision is not stale; a dish added in between is (control)", async () => {
    expect(NON_TICKET_EVENTS).toContain("host.transferred");
    const t = await room();
    await addFor(t.liza.actor, "Katsu", ind(t.liza));
    const looked = await getSnapshot(db, await fresh(t, t.jun));
    expect((await toJun(t)).status).toBe(200);
    const r = await confirmWith(t, t.jun, looked.activeRoundId as string, looked.session.revision);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const t2 = await room();
    await addFor(t2.liza.actor, "Katsu", ind(t2.liza));
    const looked2 = await getSnapshot(db, await fresh(t2, t2.jun));
    expect((await toJun(t2)).status).toBe(200);
    await addFor(t2.liza.actor, "Gyoza", ind(t2.liza));
    expect(codeOf(await confirmWith(t2, t2.jun, looked2.activeRoundId as string, looked2.session.revision))).toEqual([409, "STALE_REVISION"]);
  });

  it("F03 only the new host is notified: one host.transferred row for Jun, none for the others or the old host; text and target are the spec's", async () => {
    const t = await room();
    expect((await toJun(t)).status).toBe(200);
    const rows = await nrows(t.sid, "host.transferred");
    expect(rows.map((r) => r.recipient_id)).toEqual([t.jun.id]);
    expect(JSON.stringify(rows[0].subject)).not.toContain(t.liza.id);
    const n = await noticesFor(await fresh(t, t.jun), "host.transferred");
    expect(n.map(notificationText)).toEqual(["Kovie made you the host."]);
    expect(notificationTarget("host.transferred")).toBe("order");
    for (const p of [t.host, t.liza, t.ana]) expect(await noticesFor(await fresh(t, p), "host.transferred")).toHaveLength(0);
  });

  it("F04 failed transfers (403/404/422) emit no notice and no event", async () => {
    const t = await room();
    await transfer(t, t.liza, { participantId: t.jun.id });
    await transfer(t, t.host, { participantId: t.host.id });
    await transfer(t, t.host, { participantId: randomUUID() });
    await toJun(t, { displayName: "" });
    expect(await nrows(t.sid, "host.transferred")).toHaveLength(0);
    expect(await transferEvents(t.sid)).toHaveLength(0);
  });

  it("F05 the event carries ids only (no names, no free text)", async () => {
    const t = await room();
    expect((await toJun(t, { displayName: "Secret Name" })).status).toBe(200);
    const ev = (await transferEvents(t.sid))[0];
    expect(Object.keys(ev.p).sort()).toEqual(["fromId", "toId"]);
    expect(JSON.stringify(ev.p)).not.toContain("Secret");
  });
});

// ================= PUT /readiness: D38 =================
describe("PUT /readiness: the 'everyone who's ordering is ready' notice (D38)", () => {
  const hostNotices = async (t: Room) => (await nrows(t.sid, "guests.ready")).filter((n) => n.recipient_id === t.host.id);
  const ok = (r: Res) => {
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    return r;
  };

  it("G01 a passive guest does not hold the notice back: Ana and Liza order, Jun does not and never taps; the second ready fires it once with the round's number; guests are never told", async () => {
    const t = await room();
    await addFor(t.ana.actor, "Katsu", ind(t.ana));
    await addFor(t.liza.actor, "Gyoza", ind(t.liza));
    ok(await ready(t, t.ana, true));
    expect(await hostNotices(t)).toHaveLength(0);
    ok(await ready(t, t.liza, true));
    expect(await hostNotices(t)).toHaveLength(1);
    expect((await noticesFor(t.host.actor, "guests.ready")).map(notificationText)).toEqual(["Everyone who’s ordering is ready for round 1"]);
    for (const g of [t.ana, t.liza, t.jun]) expect(await noticesFor(await fresh(t, g), "guests.ready")).toHaveLength(0);
  });

  it("G02 nobody ordering: a lone ready guest with nothing in the round never fires; neither do all guests ready", async () => {
    const t = await room();
    ok(await ready(t, t.ana, true));
    expect(await hostNotices(t)).toHaveLength(0);
    for (const g of [t.jun, t.liza]) ok(await ready(t, g, true));
    expect(await hostNotices(t)).toHaveLength(0);
  });

  it("G03 a guest with nothing who taps Ready counts as ready: fires once whichever taps first; toggling the passive guest does not tell again", async () => {
    const t = await room();
    await addFor(t.ana.actor, "Katsu", ind(t.ana));
    ok(await ready(t, t.jun, true));
    expect(await hostNotices(t)).toHaveLength(0);
    ok(await ready(t, t.ana, true));
    expect(await hostNotices(t)).toHaveLength(1);
    ok(await ready(t, t.jun, false));
    ok(await ready(t, t.jun, true));
    expect(await hostNotices(t)).toHaveLength(1);
  });

  it("G04 whole-table and unassigned dishes (added by the host) make nobody 'ordering': no notice", async () => {
    const t = await room();
    await addFor(t.host.actor, "Crispy Pata", { type: "TABLE" });
    await addFor(t.host.actor, "Rice", { type: "UNASSIGNED" });
    ok(await ready(t, t.ana, true));
    ok(await ready(t, t.jun, true));
    expect(await hostNotices(t)).toHaveLength(0);
  });

  it("G05 a dish typed for a name equal (case/spacing) to a guest's display name makes that guest ordering; a different name does not", async () => {
    const t = await room();
    await addFor(t.host.actor, "Katsu", { type: "INDIVIDUAL", label: "  aNa " });
    await addFor(t.host.actor, "Sisig", { type: "INDIVIDUAL", label: "Zed" });
    ok(await ready(t, t.jun, true));
    expect(await hostNotices(t)).toHaveLength(0);
    ok(await ready(t, t.ana, true));
    expect(await hostNotices(t)).toHaveLength(1);
  });

  it("G06 a dish a guest adds for someone else makes both ordering (submittedBy and attribution): one ready is not enough", async () => {
    const t = await room();
    await addFor(t.ana.actor, "Katsu", ind(t.liza));
    ok(await ready(t, t.ana, true));
    expect(await hostNotices(t)).toHaveLength(0);
    ok(await ready(t, t.liza, true));
    expect(await hostNotices(t)).toHaveLength(1);
  });

  it("G07 a guest who only added a dish for a typed stranger still counts as ordering (submittedBy)", async () => {
    const t = await room();
    await addFor(t.ana.actor, "Katsu", { type: "INDIVIDUAL", label: "Zed" });
    await addFor(t.liza.actor, "Gyoza", ind(t.liza));
    ok(await ready(t, t.liza, true));
    expect(await hostNotices(t)).toHaveLength(0);
    ok(await ready(t, t.ana, true));
    expect(await hostNotices(t)).toHaveLength(1);
  });

  it("G08 group dish: members of the group are ordering, a non-member is not", async () => {
    const t = await room();
    ok(await call("PUT groups", GROUPS, t.sid, t.host.token, { method: "PUT", path: "/groups", body: { label: "Trio", memberIds: [t.ana.id, t.liza.id] } }));
    await addFor(t.host.actor, "Platter", { type: "GROUP", label: "trio" });
    ok(await ready(t, t.ana, true));
    expect(await hostNotices(t)).toHaveLength(0);
    ok(await ready(t, t.liza, true));
    expect(await hostNotices(t)).toHaveLength(1);
  });

  it("G09 once per round, the next round says round 2; a removed guest who had ordered does not hold it back", async () => {
    const t = await room();
    await addFor(t.ana.actor, "Katsu", ind(t.ana));
    ok(await ready(t, t.ana, true));
    expect(await hostNotices(t)).toHaveLength(1);
    const snap = await getSnapshot(db, t.host.actor);
    ok(await confirmWith(t, t.host, snap.activeRoundId as string, snap.session.revision));
    await openRound(t);
    await addFor(t.ana.actor, "Gyoza", ind(t.ana));
    await addFor(t.liza.actor, "Ramen", ind(t.liza));
    await runMutation(db, t.host.actor, { idempotencyKey: key(), type: "t" }, (tx, s) => removeParticipant(tx, s, t.host.actor, t.liza.id, null));
    ok(await ready(t, t.ana, true));
    const texts = (await noticesFor(t.host.actor, "guests.ready")).map(notificationText).sort();
    expect(texts).toEqual(["Everyone who’s ordering is ready for round 1", "Everyone who’s ordering is ready for round 2"]);
  });

  it("G10 a dish added for a passive guest makes them ordering: the notice waits for them", async () => {
    const t = await room();
    await addFor(t.ana.actor, "Katsu", ind(t.ana));
    await addFor(t.host.actor, "Rice", ind(t.jun));
    ok(await ready(t, t.ana, true));
    expect(await hostNotices(t)).toHaveLength(0);
    ok(await ready(t, t.jun, true));
    expect(await hostNotices(t)).toHaveLength(1);
  });

  it("G11 after a host transfer: the old host (now a guest) with a dish for themself is ordering and holds the notice until ready; the notice goes to the NEW host", async () => {
    const t = await room();
    await addFor(t.host.actor, "Katsu", { type: "TABLE" });
    await addFor(t.host.actor, "Sisig", ind(t.host));
    await addFor(t.ana.actor, "Gyoza", ind(t.ana));
    expect((await toJun(t)).status).toBe(200);
    ok(await ready(t, t.ana, true));
    expect(await nrows(t.sid, "guests.ready")).toHaveLength(0);
    ok(await ready(t, t.host, true));
    expect((await nrows(t.sid, "guests.ready")).map((r) => r.recipient_id)).toEqual([t.jun.id]);
  });

  it("G12 the host's own ready tap is never a 5xx and never counted", async () => {
    const t = await room();
    await addFor(t.ana.actor, "Katsu", ind(t.ana));
    expect((await ready(t, t.host, true)).status).toBeLessThan(500);
    expect(await hostNotices(t)).toHaveLength(0);
    ok(await ready(t, t.ana, true));
    expect(await hostNotices(t)).toHaveLength(1);
  });

  it("G14 a deleted dish no longer makes its guest 'ordering'; a confirmed round's dishes do not count in the next round", async () => {
    const t = await room();
    const a = await addFor(t.ana.actor, "Katsu", ind(t.ana));
    ok(await call("DELETE entry", ENTRY_DELETE, t.sid, t.ana.token, { method: "DELETE", path: `/entries/${a.result.entryId}`, params: { entryId: a.result.entryId } }));
    ok(await ready(t, t.liza, true));
    expect(await hostNotices(t)).toHaveLength(0);
    await addFor(t.ana.actor, "Gyoza", ind(t.ana));
    const snap = await getSnapshot(db, t.host.actor);
    ok(await confirmWith(t, t.host, snap.activeRoundId as string, snap.session.revision));
    await openRound(t);
    ok(await ready(t, t.ana, true));
    expect(await hostNotices(t)).toHaveLength(0);
  });

  it("G15 a guest who was ready and ordering before becoming host leaves the count: the old host is passive, so Ana's ready alone fires the notice to the new host", async () => {
    const t = await room();
    await addFor(t.jun.actor, "Ramen", ind(t.jun));
    await addFor(t.ana.actor, "Gyoza", ind(t.ana));
    ok(await ready(t, t.jun, true));
    expect((await toJun(t)).status).toBe(200);
    ok(await ready(t, t.ana, true));
    expect((await nrows(t.sid, "guests.ready")).map((r) => r.recipient_id)).toEqual([t.jun.id]);
  });

  it("G13 invalid readiness bodies stay 4xx and change nothing", async () => {
    const t = await room();
    await addFor(t.ana.actor, "Katsu", ind(t.ana));
    const fp = await fingerprint(t.sid);
    for (const body of [{}, { ready: "yes" }, { ready: null }, []]) {
      const r = await call("PUT /readiness", READY, t.sid, t.ana.token, { method: "PUT", path: "/readiness", body });
      expect(r.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
      expect(r.status, JSON.stringify(body)).toBeLessThan(500);
    }
    expect(await fingerprint(t.sid)).toBe(fp);
  });
});
