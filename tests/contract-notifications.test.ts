/** Contract tests for notifications (recipients, undo, privacy, POST /notifications/read). Golden contract: docs/contracts/notifications.md.
 * Real route handlers against salo_test, fake cookie jar. Run: pnpm vitest run tests/contract-notifications.test.ts */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { POST as CLOSE } from "@/app/api/sessions/[id]/close/route";
import { DELETE as CORRECTION_DELETE } from "@/app/api/sessions/[id]/corrections/[correctionId]/route";
import { POST as CORRECTION } from "@/app/api/sessions/[id]/corrections/route";
import { POST as UNAVAILABLE } from "@/app/api/sessions/[id]/dishes/[dishId]/unavailable/route";
import { POST as ENTRY_RESTORE } from "@/app/api/sessions/[id]/entries/[entryId]/restore/route";
import { DELETE as ENTRY_DELETE } from "@/app/api/sessions/[id]/entries/[entryId]/route";
import { POST as READ } from "@/app/api/sessions/[id]/notifications/read/route";
import { POST as REMOVE } from "@/app/api/sessions/[id]/participants/[pid]/remove/route";
import { PUT as PRICE } from "@/app/api/sessions/[id]/prices/route";
import { PUT as READY } from "@/app/api/sessions/[id]/readiness/route";
import { POST as CONFIRM } from "@/app/api/sessions/[id]/rounds/[roundId]/confirm/route";
import { POST as OPEN_ROUND } from "@/app/api/sessions/[id]/rounds/route";
import { POST as SERVING } from "@/app/api/sessions/[id]/serving/route";
import { GET as SYNC } from "@/app/api/sessions/[id]/sync/route";
import { preparationKey } from "@/lib/consolidate";
import { notificationText, type NotificationType } from "@/lib/notifications";
import type { Actor } from "@/lib/permissions";
import { proxy } from "@/proxy";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { sessions } from "@/server/db/schema";
import { findInvite, joinSession } from "@/server/sessions/join";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, TEST_DATABASE_URL, testDb } from "./helpers/db";
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
  body: { data?: Record<string, unknown>; error?: { code: string; message: string } };
}
type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
interface Opts {
  method?: string;
  path?: string;
  params?: Record<string, string>;
  body?: unknown;
  raw?: string;
  idem?: string | null;
  origin?: string | null;
}
async function call(handler: unknown, sid: string, who: Who | null, o: Opts = {}): Promise<Res> {
  jar.cookies = who?.token ? { [credentialCookieName(sid)]: who.token } : {};
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (o.origin !== null) headers.origin = o.origin ?? "http://localhost:3000";
  const method = o.method ?? "POST";
  if (method !== "GET" && o.idem !== null) headers["idempotency-key"] = o.idem ?? key();
  const init: RequestInit = { method, headers };
  if (method !== "GET") init.body = o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
  const req = new Request(`http://localhost:3000/api/sessions/${sid}${o.path ?? ""}`, init);
  const res = await within((handler as Handler)(req, { params: Promise.resolve({ id: sid, ...(o.params ?? {}) } as never) }), `${method} ${o.path ?? ""}`);
  return { status: res.status, body: await res.json() };
}

interface NView {
  id: string;
  type: NotificationType;
  subject: Record<string, string | number | boolean | null>;
  createdAt: string;
  readAt: string | null;
}
interface NBox {
  items: NView[];
  unread: number;
}
type Snap = Awaited<ReturnType<typeof getSnapshot>>;
async function syncOf(sid: string, who: Who): Promise<Snap & { notifications: NBox }> {
  const r = await call(SYNC, sid, who, { method: "GET", path: "/sync" });
  expect(r.status).toBe(200);
  return r.body.data as unknown as Snap & { notifications: NBox };
}
const box = async (sid: string, who: Who) => (await syncOf(sid, who)).notifications;
const typesOf = async (sid: string, who: Who) => (await box(sid, who)).items.map((i) => i.type);
const countOf = async (sid: string, who: Who, type: NotificationType) => (await typesOf(sid, who)).filter((t) => t === type).length;

type Row = { id: string; session_id: string; recipient_id: string; type: string; subject: Record<string, unknown>; source: string[]; dedup_key: string; read_at: string | null };
const rowsOf = async (sid: string, recipient?: string) =>
  (await db.execute(sql`SELECT * FROM notifications WHERE session_id = ${sid} ${recipient ? sql`AND recipient_id = ${recipient}` : sql``} ORDER BY created_at, id`)) as unknown as Row[];
const dbTypes = async (sid: string, recipient: string) => (await rowsOf(sid, recipient)).map((r) => r.type);
const sessionRev = async (sid: string) => (await db.select({ r: sessions.revision }).from(sessions).where(eq(sessions.id, sid)))[0].r;
const eventCount = async (sid: string) => ((await db.execute(sql`SELECT count(*)::int AS n FROM session_events WHERE session_id = ${sid}`)) as unknown as { n: number }[])[0].n;
async function fingerprint(sid: string) {
  const s = (await db.execute(sql`SELECT * FROM sessions WHERE id = ${sid}`)) as unknown as Record<string, unknown>[];
  const m = (await db.execute(sql`SELECT count(*)::int AS n FROM mutation_records WHERE session_id = ${sid}`)) as unknown as { n: number }[];
  return JSON.stringify({ s, ev: await eventCount(sid), m: m[0].n, n: await rowsOf(sid) });
}

interface Person {
  id: string;
  who: Who;
  actor: Actor;
}
async function guestOf(sid: string, name: string): Promise<Person> {
  const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, sid));
  const joined = await joinSession(db, code, name, sid);
  const actor = (await resolveActor(db, sid, joined.token)) as Actor;
  return { id: actor.participantId, who: { token: joined.token }, actor };
}
/** A host and three guests; round 1 is the open draft. */
async function room() {
  const { host, sessionId: sid, token } = await newSession(db);
  const hostP: Person = { id: host.participantId, who: { token }, actor: host };
  const ana = await guestOf(sid, "Ana");
  const bea = await guestOf(sid, "Bea");
  const cy = await guestOf(sid, "Cy");
  return { sid, host: hostP, ana, bea, cy };
}
type Room = Awaited<ReturnType<typeof room>>;
const ind = (p: Person) => ({ type: "INDIVIDUAL" as const, participantId: p.id });
const addFor = (p: Person, dishName: string, quantity: number, attribution: Record<string, unknown>, variant?: string) =>
  add(db, p.actor, { dishName, quantity, attribution, ...(variant ? { variant } : {}) });

const ok = (r: Res) => {
  expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
  return r;
};
async function confirm(t: Room) {
  const snap = await syncOf(t.sid, t.host.who);
  return ok(await call(CONFIRM, t.sid, t.host.who, { path: `/rounds/${snap.activeRoundId}/confirm`, params: { roundId: snap.activeRoundId as string }, body: { expectedRevision: snap.session.revision } }));
}
const openRound = async (t: Room) => ok(await call(OPEN_ROUND, t.sid, t.host.who, { path: "/rounds" }));
const unavailable = (t: Room, dishId: string, body: Record<string, unknown> = {}, o: Opts = {}) => call(UNAVAILABLE, t.sid, t.host.who, { path: `/dishes/${dishId}/unavailable`, params: { dishId }, body, ...o });
const ready = (t: Room, p: Person, v: boolean) => call(READY, t.sid, p.who, { method: "PUT", path: "/readiness", body: { ready: v } });
const removeGuest = async (t: Room, p: Person) => ok(await call(REMOVE, t.sid, t.host.who, { path: `/participants/${p.id}/remove`, params: { pid: p.id }, body: {} }));
const closeOrder = (t: Room, who = t.host.who) => call(CLOSE, t.sid, who, { path: "/close" });
const serve = (t: Room, roundId: string, lineKey: string, delta: number) => call(SERVING, t.sid, t.host.who, { path: "/serving", body: { roundId, lineKey, delta } });
const correct = (t: Room, body: Record<string, unknown>) => call(CORRECTION, t.sid, t.host.who, { path: "/corrections", body });
const setPrice = (t: Room, dishId: string, variant: string | null, unitCentavos: number | null, expectedRevision: number) =>
  call(PRICE, t.sid, t.host.who, { method: "PUT", path: "/prices", body: { dishId, variant, unitCentavos, expectedRevision } });
const readNow = (t: Room, p: Person | null, body: unknown, o: Opts = {}) => call(READ, t.sid, p?.who ?? null, { path: "/notifications/read", body, idem: null, ...o });
const restore = async (t: Room, entryId: string) => ok(await call(ENTRY_RESTORE, t.sid, t.host.who, { path: `/entries/${entryId}/restore`, params: { entryId } }));
const dishIdOf = async (t: Room, entryId: string) => (await syncOf(t.sid, t.host.who)).entries.find((e) => e.id === entryId)!.dishId;
const lk = (dishId: string, variant: string | null = null) => preparationKey({ dishId, variant, instructions: null });
const uuid = () => randomUUID();
const unreadOf = async (sid: string, recipient: string) => (await rowsOf(sid, recipient)).filter((r) => !r.read_at).length;

async function listen() {
  const sqlc = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  const msgs: string[] = [];
  await sqlc.listen("salo_events", (m) => msgs.push(m));
  return { msgs, stop: () => sqlc.end({ timeout: 2 }) };
}
async function until(cond: () => boolean, what: string) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > DEADLINE_MS) throw new Error(`deadline: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ---------- recipients: the event matrix ----------
describe("notifications: who is told about what", () => {
  it("E01 round confirmed -> every guest (not the host who did it, not a removed guest)", async () => {
    const t = await room();
    await addFor(t.ana, "Katsu", 1, ind(t.ana));
    await removeGuest(t, t.cy);
    await confirm(t);
    for (const g of [t.ana, t.bea]) expect(await typesOf(t.sid, g.who)).toEqual(["round.confirmed"]);
    expect(await typesOf(t.sid, t.host.who)).toEqual([]);
    expect(await dbTypes(t.sid, t.cy.id)).toEqual([]);
    expect((await box(t.sid, t.ana.who)).items[0].subject).toMatchObject({ roundNumber: 1 });
  });

  it("E02 new round opened -> every guest, not the host; newest first", async () => {
    const t = await room();
    await addFor(t.ana, "Katsu", 1, ind(t.ana));
    await confirm(t);
    await openRound(t);
    for (const g of [t.ana, t.bea, t.cy]) expect(await typesOf(t.sid, g.who)).toEqual(["round.opened", "round.confirmed"]);
    expect(await typesOf(t.sid, t.host.who)).toEqual([]);
  });

  it("E03 dish unavailable (draft round, individual dishes) -> only the people the dish is for, never the host; per-person numbers", async () => {
    const t = await room();
    const a = await addFor(t.ana, "Katsu", 2, ind(t.ana));
    await addFor(t.bea, "Katsu", 1, ind(t.bea));
    await addFor(t.cy, "Gyoza", 1, ind(t.cy));
    await addFor(t.host, "Katsu", 4, ind(t.host));
    const dishId = await dishIdOf(t, a.result.entryId);
    ok(await unavailable(t, dishId));
    expect(await typesOf(t.sid, t.ana.who)).toEqual(["dish.unavailable"]);
    expect(await typesOf(t.sid, t.bea.who)).toEqual(["dish.unavailable"]);
    expect(await typesOf(t.sid, t.cy.who)).toEqual([]);
    expect(await typesOf(t.sid, t.host.who)).toEqual([]);
    expect((await box(t.sid, t.ana.who)).items[0].subject).toMatchObject({ dishId, removed: 2 });
    expect((await box(t.sid, t.bea.who)).items[0].subject).toMatchObject({ dishId, removed: 1 });
  });

  it("E04 dish unavailable (confirmed) -> individual: the owner only; table, unassigned and group dishes: every guest", async () => {
    const t = await room();
    const k = await addFor(t.ana, "Katsu", 2, ind(t.ana));
    const g = await addFor(t.bea, "Gyoza", 1, { type: "TABLE" });
    const r = await addFor(t.bea, "Ramen", 1, { type: "UNASSIGNED" });
    const s = await addFor(t.cy, "Soup", 1, { type: "GROUP", label: "the boys" });
    await confirm(t);
    const ids = { k: await dishIdOf(t, k.result.entryId), g: await dishIdOf(t, g.result.entryId), r: await dishIdOf(t, r.result.entryId), s: await dishIdOf(t, s.result.entryId) };
    const got = async (who: Who, dishId: string) => (await box(t.sid, who)).items.filter((i) => i.type === "dish.unavailable" && i.subject.dishId === dishId).length;
    ok(await unavailable(t, ids.k));
    expect([await got(t.ana.who, ids.k), await got(t.bea.who, ids.k), await got(t.cy.who, ids.k)]).toEqual([1, 0, 0]);
    for (const dishId of [ids.g, ids.r, ids.s]) {
      ok(await unavailable(t, dishId));
      expect([await got(t.ana.who, dishId), await got(t.bea.who, dishId), await got(t.cy.who, dishId)]).toEqual([1, 1, 1]);
      expect(await got(t.host.who, dishId)).toBe(0);
    }
    expect(await got(t.host.who, ids.k)).toBe(0);
  });

  it("E05 order corrected (told when the round carrying it is confirmed) -> the owner of an individual dish only; table, unassigned, group dishes: every guest; a batch: each owner", async () => {
    const t = await room();
    const k = await addFor(t.ana, "Katsu", 3, ind(t.ana));
    const k2 = await addFor(t.bea, "Katsu", 3, ind(t.bea));
    const g = await addFor(t.bea, "Gyoza", 2, { type: "TABLE" });
    const r = await addFor(t.cy, "Ramen", 2, { type: "UNASSIGNED" });
    const s = await addFor(t.cy, "Soup", 2, { type: "GROUP", label: "the boys" });
    await confirm(t);
    await openRound(t);
    const corrected = async (p: Person) => countOf(t.sid, p.who, "order.correctionTold");
    ok(await correct(t, { sourceEntryId: k.result.entryId, type: "QUANTITY", quantity: 1 }));
    for (const e of [g, r, s]) ok(await correct(t, { sourceEntryId: e.result.entryId, type: "QUANTITY", quantity: 1 }));
    ok(await correct(t, { entries: [{ sourceEntryId: k.result.entryId, quantity: 1 }, { sourceEntryId: k2.result.entryId, quantity: 1 }], type: "QUANTITY" }));
    expect([await corrected(t.ana), await corrected(t.bea), await corrected(t.cy)]).toEqual([0, 0, 0]);
    await confirm(t);
    expect([await corrected(t.ana), await corrected(t.bea), await corrected(t.cy)]).toEqual([5, 4, 3]);
    expect(await corrected(t.host)).toBe(0);
  });

  it("E05b recording a correction notifies nobody; telling the waiter (confirming the round) never reaches someone the correction was not about", async () => {
    const t = await room();
    const k = await addFor(t.ana, "Katsu", 3, ind(t.ana));
    await confirm(t);
    await openRound(t);
    ok(await correct(t, { sourceEntryId: k.result.entryId, type: "QUANTITY", quantity: 1 }));
    const isCorrection = (type: string) => type.startsWith("order.correct");
    for (const p of [t.ana, t.bea, t.cy, t.host]) expect((await dbTypes(t.sid, p.id)).filter(isCorrection)).toEqual([]);
    await confirm(t);
    expect((await dbTypes(t.sid, t.bea.id)).filter(isCorrection)).toEqual([]);
    expect((await dbTypes(t.sid, t.cy.id)).filter(isCorrection)).toEqual([]);
    expect((await dbTypes(t.sid, t.host.id)).filter(isCorrection)).toEqual([]);
    expect((await dbTypes(t.sid, t.ana.id)).filter(isCorrection)).toEqual(["order.correctionTold"]);
  });

  it("E06 table price changed -> people with that dish + size, one per change; not other sizes or dishes; same price again is no change", async () => {
    const t = await room();
    const l = await addFor(t.ana, "Katsu", 1, ind(t.ana), "large");
    await addFor(t.bea, "Katsu", 1, ind(t.bea), "small");
    await addFor(t.cy, "Gyoza", 1, ind(t.cy));
    const dishId = await dishIdOf(t, l.result.entryId);
    const got = async (p: Person) => countOf(t.sid, p.who, "price.defaultSet");
    ok(await setPrice(t, dishId, "Large", 15000, 0));
    expect([await got(t.ana), await got(t.bea), await got(t.cy)]).toEqual([1, 0, 0]);
    ok(await setPrice(t, dishId, "Large", 18000, 1));
    expect(await got(t.ana)).toBe(2);
    const items = (await box(t.sid, t.ana.who)).items.filter((i) => i.type === "price.defaultSet");
    expect(items.map((i) => i.subject.centavos).sort()).toEqual([15000, 18000]);
    ok(await setPrice(t, dishId, "Large", 18000, 2));
    expect(await got(t.ana)).toBe(2);
    expect(await typesOf(t.sid, t.host.who)).toEqual([]);
  });

  it("E06b (interpretation) a price change reaches every guest when a table-wide dish of that dish + size exists", async () => {
    const t = await room();
    const l = await addFor(t.ana, "Katsu", 1, { type: "TABLE" }, "large");
    ok(await setPrice(t, await dishIdOf(t, l.result.entryId), "large", 15000, 0));
    for (const g of [t.ana, t.bea, t.cy]) expect(await countOf(t.sid, g.who, "price.defaultSet")).toBe(1);
  });

  it("E07 food served -> everyone with an entry in the line, once, only when fully served; dedup survives full -> not full -> full", async () => {
    const t = await room();
    const a = await addFor(t.ana, "Katsu", 2, ind(t.ana));
    await addFor(t.bea, "Katsu", 1, ind(t.bea));
    const g = await addFor(t.bea, "Gyoza", 1, ind(t.bea));
    await addFor(t.cy, "Ramen", 1, ind(t.cy));
    await confirm(t);
    const roundId = (await syncOf(t.sid, t.host.who)).rounds[0].id;
    const katsu = lk(await dishIdOf(t, a.result.entryId));
    const served = async (p: Person) => countOf(t.sid, p.who, "food.served");
    ok(await serve(t, roundId, katsu, 1));
    ok(await serve(t, roundId, katsu, 1));
    expect([await served(t.ana), await served(t.bea), await served(t.cy)]).toEqual([0, 0, 0]);
    ok(await serve(t, roundId, katsu, 1));
    expect([await served(t.ana), await served(t.bea), await served(t.cy), await served(t.host)]).toEqual([1, 1, 0, 0]);
    ok(await serve(t, roundId, katsu, -1));
    ok(await serve(t, roundId, katsu, 1));
    ok(await serve(t, roundId, katsu, 5));
    expect([await served(t.ana), await served(t.bea)]).toEqual([1, 1]);
    ok(await serve(t, roundId, lk(await dishIdOf(t, g.result.entryId)), 1));
    expect([await served(t.ana), await served(t.bea), await served(t.cy)]).toEqual([1, 2, 0]);
  });

  it("E08 all guests ready -> the host, once per round; not before the last guest; guests are never told", async () => {
    const t = await room();
    await addFor(t.ana, "Katsu", 1, ind(t.ana));
    const host = () => countOf(t.sid, t.host.who, "guests.ready");
    ok(await ready(t, t.ana, true));
    ok(await ready(t, t.bea, true));
    expect(await host()).toBe(0);
    ok(await ready(t, t.cy, true));
    expect(await host()).toBe(1);
    ok(await ready(t, t.cy, false));
    ok(await ready(t, t.cy, true));
    expect(await host()).toBe(1);
    for (const g of [t.ana, t.bea, t.cy]) expect(await countOf(t.sid, g.who, "guests.ready")).toBe(0);
    await confirm(t);
    await openRound(t);
    await addFor(t.ana, "Gyoza", 1, ind(t.ana));
    for (const g of [t.ana, t.bea, t.cy]) ok(await ready(t, g, true));
    expect(await host()).toBe(2);
  });

  it("E08b a removed guest does not hold the host's 'everyone is ready' back", async () => {
    const t = await room();
    await removeGuest(t, t.cy);
    ok(await ready(t, t.ana, true));
    expect(await countOf(t.sid, t.host.who, "guests.ready")).toBe(0);
    ok(await ready(t, t.bea, true));
    expect(await countOf(t.sid, t.host.who, "guests.ready")).toBe(1);
  });

  it("E09 order ended -> everyone except the host who ended it and a removed guest; a guest cannot end it (no rows)", async () => {
    const t = await room();
    await addFor(t.ana, "Katsu", 1, ind(t.ana));
    await confirm(t);
    await removeGuest(t, t.cy);
    expect((await closeOrder(t, t.ana.who)).status).toBe(403);
    expect(await countOf(t.sid, t.bea.who, "order.ended")).toBe(0);
    ok(await closeOrder(t));
    for (const g of [t.ana, t.bea]) expect(await countOf(t.sid, g.who, "order.ended")).toBe(1);
    expect(await countOf(t.sid, t.host.who, "order.ended")).toBe(0);
    expect((await dbTypes(t.sid, t.cy.id)).includes("order.ended")).toBe(false);
  });

  it("E09b ending an order nobody confirmed (a cancel) still tells every guest", async () => {
    const t = await room();
    ok(await closeOrder(t));
    for (const g of [t.ana, t.bea, t.cy]) expect(await typesOf(t.sid, g.who)).toEqual(["order.ended"]);
  });

  it("E10 never: routine dish additions, edits, removals and a partial ready by anyone notify nobody", async () => {
    const t = await room();
    const kinds = [ind(t.ana), { type: "TABLE" }, { type: "UNASSIGNED" }, { type: "GROUP", label: "the boys" }];
    const entries: string[] = [];
    for (const [i, a] of kinds.entries()) {
      entries.push((await addFor(i % 2 ? t.host : t.ana, `Dish ${i}`, 1, a)).result.entryId);
      await addFor(t.bea, `Other ${i}`, 2, a.type === "INDIVIDUAL" ? ind(t.bea) : a);
    }
    ok(await call(ENTRY_DELETE, t.sid, t.host.who, { method: "DELETE", path: `/entries/${entries[0]}`, params: { entryId: entries[0] } }));
    await restore(t, entries[0]);
    ok(await ready(t, t.ana, true));
    expect(await rowsOf(t.sid)).toHaveLength(0);
  });

  it("E11 a late joiner starts empty; removing a guest tells nobody; a removed guest gets nothing afterwards", async () => {
    const t = await room();
    await addFor(t.ana, "Katsu", 1, ind(t.ana));
    await confirm(t);
    await openRound(t);
    const dee = await guestOf(t.sid, "Dee");
    expect(await box(t.sid, dee.who)).toEqual({ items: [], unread: 0 });
    const before = (await rowsOf(t.sid)).length;
    await removeGuest(t, t.cy);
    expect((await rowsOf(t.sid)).length).toBe(before);
    await addFor(t.ana, "Gyoza", 1, ind(t.ana));
    await confirm(t);
    await openRound(t);
    expect((await dbTypes(t.sid, t.cy.id)).sort()).toEqual(["round.confirmed", "round.opened"]);
    expect(await countOf(t.sid, dee.who, "round.confirmed")).toBe(1);
  });

  it("E12 a refused or rolled back change leaves no notification (stale confirm, guest marking unavailable, unknown dish)", async () => {
    const t = await room();
    const a = await addFor(t.ana, "Katsu", 1, ind(t.ana));
    const snap = await syncOf(t.sid, t.host.who);
    await addFor(t.bea, "Gyoza", 1, ind(t.bea));
    const stale = await call(CONFIRM, t.sid, t.host.who, { path: `/rounds/${snap.activeRoundId}/confirm`, params: { roundId: snap.activeRoundId as string }, body: { expectedRevision: snap.session.revision } });
    expect(stale.status).toBe(409);
    const dishId = await dishIdOf(t, a.result.entryId);
    const guestTry = await call(UNAVAILABLE, t.sid, t.ana.who, { path: `/dishes/${dishId}/unavailable`, params: { dishId }, body: {} });
    expect(guestTry.status).toBe(403);
    expect((await unavailable(t, uuid())).status).toBe(404);
    expect(await rowsOf(t.sid)).toHaveLength(0);
  });
});

// ---------- undo ----------
describe("notifications: undo deletes what the change created", () => {
  it("U01 Undo of 'mark unavailable' on draft dishes deletes the update (read or not); other updates stay; doing it again notifies again", async () => {
    const t = await room();
    await addFor(t.ana, "Katsu", 1, ind(t.ana));
    await addFor(t.bea, "Gyoza", 1, ind(t.bea));
    await confirm(t);
    await openRound(t);
    const b1 = await addFor(t.ana, "Ramen", 1, ind(t.ana));
    const b2 = await addFor(t.ana, "Ramen", 1, ind(t.ana), "big");
    const ramen = await dishIdOf(t, b1.result.entryId);
    ok(await unavailable(t, ramen));
    const gone = (await box(t.sid, t.ana.who)).items.find((i) => i.type === "dish.unavailable")!;
    ok(await readNow(t, t.ana, { ids: [gone.id] }));
    for (const e of [b1, b2]) await restore(t, e.result.entryId);
    expect((await typesOf(t.sid, t.ana.who)).includes("dish.unavailable")).toBe(false);
    expect(await countOf(t.sid, t.ana.who, "round.confirmed")).toBe(1);
    expect(await countOf(t.sid, t.bea.who, "round.opened")).toBe(1);
    ok(await unavailable(t, ramen));
    expect(await countOf(t.sid, t.ana.who, "dish.unavailable")).toBe(1);
  });

  it("U02 taking a pending correction back leaves no update (a batch as a whole), and the round confirmed later tells nobody about it", async () => {
    const t = await room();
    const k = await addFor(t.ana, "Katsu", 3, ind(t.ana));
    const k2 = await addFor(t.bea, "Katsu", 3, ind(t.bea));
    await confirm(t);
    await openRound(t);
    const one = ok(await correct(t, { sourceEntryId: k.result.entryId, type: "QUANTITY", quantity: 1 }));
    const id = (one.body.data!.result as { correctionId: string }).correctionId;
    ok(await call(CORRECTION_DELETE, t.sid, t.host.who, { method: "DELETE", path: `/corrections/${id}`, params: { correctionId: id } }));
    const batch = ok(await correct(t, { entries: [{ sourceEntryId: k.result.entryId, quantity: 1 }, { sourceEntryId: k2.result.entryId, quantity: 1 }], type: "QUANTITY" }));
    const ids = (batch.body.data!.result as { correctionIds: string[] }).correctionIds;
    ok(await call(CORRECTION_DELETE, t.sid, t.host.who, { method: "DELETE", path: `/corrections/${ids[0]}`, params: { correctionId: ids[0] } }));
    await addFor(t.cy, "Rice", 1, ind(t.cy));
    await confirm(t);
    expect([await countOf(t.sid, t.ana.who, "order.correctionTold"), await countOf(t.sid, t.bea.who, "order.correctionTold")]).toEqual([0, 0]);
  });

  it("U03 un-serving does not take back 'all served' and serving again does not repeat it", async () => {
    const t = await room();
    const a = await addFor(t.ana, "Katsu", 1, ind(t.ana));
    await confirm(t);
    const roundId = (await syncOf(t.sid, t.host.who)).rounds[0].id;
    const k = lk(await dishIdOf(t, a.result.entryId));
    ok(await serve(t, roundId, k, 1));
    ok(await serve(t, roundId, k, -1));
    expect(await countOf(t.sid, t.ana.who, "food.served")).toBe(1);
    ok(await serve(t, roundId, k, 1));
    expect(await countOf(t.sid, t.ana.who, "food.served")).toBe(1);
  });
});

// ---------- privacy ----------
describe("notifications: privacy", () => {
  async function busy() {
    const t = await room();
    const a = await addFor(t.ana, "Katsu", 2, ind(t.ana));
    await addFor(t.bea, "Gyoza", 1, ind(t.bea));
    await confirm(t);
    await openRound(t);
    ok(await unavailable(t, await dishIdOf(t, a.result.entryId), { replacement: "Zzqx Secret Dish" }));
    return t;
  }

  it("P01 each snapshot carries only the caller's own rows, with exactly the documented fields", async () => {
    const t = await busy();
    const seen = new Map<string, string>();
    for (const [name, p] of [["host", t.host], ["ana", t.ana], ["bea", t.bea], ["cy", t.cy]] as const) {
      const n = await box(t.sid, p.who);
      const mine = await rowsOf(t.sid, p.id);
      expect(n.items.map((i) => i.id).sort()).toEqual(mine.map((r) => r.id).sort());
      expect(n.unread).toBe(mine.filter((r) => !r.read_at).length);
      for (const i of n.items) {
        expect(Object.keys(i).sort()).toEqual(["createdAt", "id", "readAt", "subject", "type"]);
        expect(seen.has(i.id), `${name} shares ${i.id} with ${seen.get(i.id)}`).toBe(false);
        seen.set(i.id, name);
      }
    }
    expect(JSON.stringify(await box(t.sid, t.bea.who))).not.toContain("Zzqx");
    expect(JSON.stringify(await box(t.sid, t.cy.who))).not.toContain("Zzqx");
  });

  it("P02 foreign ids are ignored: nothing of someone else's is marked and it stays unread for its owner", async () => {
    const t = await busy();
    const bea = await box(t.sid, t.bea.who);
    const host = await box(t.sid, t.host.who);
    const anaOwn = (await box(t.sid, t.ana.who)).items;
    const foreign = [...bea.items.map((i) => i.id), ...host.items.map((i) => i.id)];
    const before = await unreadOf(t.sid, t.bea.id);
    expect(before).toBeGreaterThan(0);
    expect(ok(await readNow(t, t.ana, { ids: foreign })).body.data).toEqual({ marked: 0 });
    expect(await unreadOf(t.sid, t.bea.id)).toBe(before);
    expect(ok(await readNow(t, t.ana, { ids: [...foreign, anaOwn[0].id] })).body.data).toEqual({ marked: 1 });
    expect(await unreadOf(t.sid, t.bea.id)).toBe(before);
    ok(await readNow(t, t.cy, { all: true }));
    expect(await unreadOf(t.sid, t.bea.id)).toBe(before);
    expect(await unreadOf(t.sid, t.ana.id)).toBe(anaOwn.length - 1);
    ok(await readNow(t, t.host, { ids: anaOwn.map((i) => i.id) }));
    expect(await unreadOf(t.sid, t.ana.id)).toBe(anaOwn.length - 1);
  });

  it("P03 another order's ids and tokens: nothing crosses orders", async () => {
    const a = await busy();
    const b = await busy();
    const bIds = (await box(b.sid, b.ana.who)).items.map((i) => i.id);
    const bUnread = await unreadOf(b.sid, b.ana.id);
    expect(ok(await readNow(a, a.ana, { ids: bIds })).body.data).toEqual({ marked: 0 });
    expect(await unreadOf(b.sid, b.ana.id)).toBe(bUnread);
    const fp = await fingerprint(b.sid);
    for (const who of [a.host.who, a.ana.who]) {
      const r = await call(READ, b.sid, who, { path: "/notifications/read", body: { all: true }, idem: null });
      expect(r.status).toBe(404);
      expect((await call(SYNC, b.sid, who, { method: "GET", path: "/sync" })).status).toBe(404);
    }
    expect(await fingerprint(b.sid)).toBe(fp);
  });

  it("P04 a removed guest neither gets nor reads: refused, rows untouched, nothing new arrives", async () => {
    const t = await busy();
    const unread = await unreadOf(t.sid, t.ana.id);
    expect(unread).toBeGreaterThan(0);
    const firstId = (await rowsOf(t.sid, t.ana.id))[0].id;
    await removeGuest(t, t.ana);
    const fp = await fingerprint(t.sid);
    const sync = await call(SYNC, t.sid, t.ana.who, { method: "GET", path: "/sync" });
    expect([403, 404]).toContain(sync.status);
    expect(sync.body.data).toBeUndefined();
    for (const body of [{ all: true }, { ids: [firstId] }]) {
      const r = await readNow(t, t.ana, body);
      expect([403, 404]).toContain(r.status);
      expect(r.body.data).toBeUndefined();
    }
    expect(await fingerprint(t.sid)).toBe(fp);
    expect(await unreadOf(t.sid, t.ana.id)).toBe(unread);
    ok(await closeOrder(t));
    expect((await dbTypes(t.sid, t.ana.id)).includes("order.ended")).toBe(false);
  });

  it("P05 no notification text, id or subject leaks into event payloads, mutation results or the invite lookup", async () => {
    const t = await busy();
    await addFor(t.cy, "Soup", 1, ind(t.cy));
    const first = (await syncOf(t.sid, t.host.who)).entries[0].id;
    ok(await setPrice(t, await dishIdOf(t, first), null, 12300, 0));
    ok(await ready(t, t.cy, true));
    const all = await rowsOf(t.sid);
    expect(all.length).toBeGreaterThan(3);
    const events = JSON.stringify(await db.execute(sql`SELECT event_type, payload FROM session_events WHERE session_id = ${t.sid}`));
    const mutations = JSON.stringify(await db.execute(sql`SELECT result FROM mutation_records WHERE session_id = ${t.sid}`));
    for (const r of all) {
      expect(events).not.toContain(r.id);
      expect(mutations).not.toContain(r.id);
      expect(events).not.toContain(notificationText({ type: r.type as NotificationType, subject: r.subject as never }));
    }
    expect(events).not.toContain("Zzqx");
    expect(events).not.toMatch(/"subject"|notifications?"/i);
    const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, t.sid));
    expect(JSON.stringify(await findInvite(db, code))).not.toContain("notification");
  });
});

// ---------- caps, dedup ----------
describe("notifications: snapshot cap, unread count, dedup", () => {
  const seed = (sid: string, rid: string, n: number) =>
    db.execute(sql`INSERT INTO notifications (session_id, recipient_id, type, subject, dedup_key, created_at)
      SELECT ${sid}, ${rid}, 'round.opened', jsonb_build_object('roundNumber', g), 'seed:' || g, now() - (${n} - g) * interval '1 second' FROM generate_series(1, ${n}) g`);

  it("D01 the snapshot holds the newest 50, newest first; unread counts all; other people's rows do not count", async () => {
    const t = await room();
    await seed(t.sid, t.ana.id, 60);
    await seed(t.sid, t.bea.id, 3);
    const n = await box(t.sid, t.ana.who);
    expect(n.items).toHaveLength(50);
    expect(n.unread).toBe(60);
    expect(n.items.map((i) => i.subject.roundNumber)).toEqual(Array.from({ length: 50 }, (_, i) => 60 - i));
    const b = await box(t.sid, t.bea.who);
    expect([b.items.length, b.unread]).toEqual([3, 3]);
    const hidden = (await rowsOf(t.sid, t.ana.id)).slice(0, 10).map((r) => r.id);
    expect(ok(await readNow(t, t.ana, { ids: hidden })).body.data).toEqual({ marked: 10 });
    expect((await box(t.sid, t.ana.who)).unread).toBe(50);
    expect(ok(await readNow(t, t.ana, { all: true })).body.data).toEqual({ marked: 50 });
    expect((await box(t.sid, t.ana.who)).unread).toBe(0);
  });

  it("D02 a retried request (same Idempotency-Key) tells each person once", async () => {
    const t = await room();
    const a = await addFor(t.ana, "Katsu", 1, ind(t.ana));
    const dishId = await dishIdOf(t, a.result.entryId);
    const idem = key();
    const one = ok(await unavailable(t, dishId, {}, { idem }));
    const two = ok(await unavailable(t, dishId, {}, { idem }));
    expect([one.body.data!.replayed, two.body.data!.replayed]).toEqual([false, true]);
    expect(await countOf(t.sid, t.ana.who, "dish.unavailable")).toBe(1);
  });

  it("D03 the same event for the same round twice (ready toggled) gives one row", async () => {
    const t = await room();
    for (const g of [t.ana, t.bea, t.cy]) ok(await ready(t, g, true));
    for (let i = 0; i < 3; i++) {
      ok(await ready(t, t.cy, false));
      ok(await ready(t, t.cy, true));
    }
    expect(await countOf(t.sid, t.host.who, "guests.ready")).toBe(1);
  });
});

// ---------- the read route ----------
describe("POST /notifications/read", () => {
  async function withUnread() {
    const t = await room();
    const a = await addFor(t.ana, "Katsu", 1, ind(t.ana));
    await confirm(t);
    await openRound(t);
    ok(await unavailable(t, await dishIdOf(t, a.result.entryId)));
    return t;
  }

  it("M01 ids: marks the named unread rows, answers { marked }, the snapshot follows, the rest stay unread", async () => {
    const t = await withUnread();
    const items = (await box(t.sid, t.ana.who)).items;
    expect(items.length).toBe(3);
    const r = await readNow(t, t.ana, { ids: [items[0].id] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ data: { marked: 1 } });
    const after = await box(t.sid, t.ana.who);
    expect(after.unread).toBe(2);
    expect(after.items.find((i) => i.id === items[0].id)!.readAt).not.toBeNull();
    expect(after.items.filter((i) => i.id !== items[0].id).every((i) => i.readAt === null)).toBe(true);
  });

  it("M02 idempotent: repeating ids or all marks nothing more and never moves read_at; unknown uuids and 50 ids are fine", async () => {
    const t = await withUnread();
    const items = (await box(t.sid, t.ana.who)).items;
    expect(ok(await readNow(t, t.ana, { ids: [items[0].id] })).body.data).toEqual({ marked: 1 });
    const stamp = (await rowsOf(t.sid, t.ana.id)).find((r) => r.id === items[0].id)!.read_at;
    expect(ok(await readNow(t, t.ana, { ids: [items[0].id] })).body.data).toEqual({ marked: 0 });
    expect(ok(await readNow(t, t.ana, { ids: [uuid(), uuid()] })).body.data).toEqual({ marked: 0 });
    expect(ok(await readNow(t, t.ana, { ids: Array.from({ length: 50 }, uuid) })).body.data).toEqual({ marked: 0 });
    expect(ok(await readNow(t, t.ana, { all: true })).body.data).toEqual({ marked: 2 });
    expect(ok(await readNow(t, t.ana, { all: true })).body.data).toEqual({ marked: 0 });
    expect((await rowsOf(t.sid, t.ana.id)).find((r) => r.id === items[0].id)!.read_at).toBe(stamp);
    expect((await box(t.sid, t.ana.who)).unread).toBe(0);
    expect(ok(await readNow(t, t.host, { all: true })).body.data).toEqual({ marked: 0 });
  });

  it("M03 bad bodies are refused with no change: empty, non-uuid or too many ids, ids and all together, bad all, wrong shapes", async () => {
    const t = await withUnread();
    const one = (await box(t.sid, t.ana.who)).items[0].id;
    const cases: [string, unknown, number[]][] = [
      ["{}", {}, [422]],
      ["empty ids", { ids: [] }, [422]],
      ["non-uuid", { ids: ["x"] }, [422]],
      ["sql-ish", { ids: ["1' OR '1'='1"] }, [422]],
      ["number id", { ids: [1] }, [422]],
      ["null ids", { ids: null }, [422]],
      ["string ids", { ids: one }, [422]],
      ["valid + non-uuid", { ids: [one, "nope"] }, [422]],
      ["51 ids", { ids: Array.from({ length: 51 }, uuid) }, [422]],
      ["200 ids", { ids: Array.from({ length: 200 }, uuid) }, [422, 413]],
      ["1000 ids (> 8 KB)", { ids: Array.from({ length: 1000 }, uuid) }, [413, 422]],
      ["all false", { all: false }, [422]],
      ["all string", { all: "true" }, [422]],
      ["all number", { all: 1 }, [422]],
      ["all null", { all: null }, [422]],
      ["array body", [], [422]],
      ["string body", "text", [422]],
      ["null body", null, [422, 400]],
      ["number body", 42, [422]],
    ];
    const wrong: string[] = [];
    for (const [name, body, statuses] of cases) {
      const fp = await fingerprint(t.sid);
      const r = await readNow(t, t.ana, body);
      const refused = statuses.includes(r.status) && r.body.data === undefined && typeof r.body.error?.message === "string";
      if (!refused || (await fingerprint(t.sid)) !== fp) wrong.push(`${name}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    expect(wrong).toEqual([]);
    const bad = await readNow(t, t.ana, undefined, { raw: "{not json" });
    expect([bad.status, bad.body.error?.code]).toEqual([400, "BAD_JSON"]);
    expect((await readNow(t, t.ana, undefined, { raw: "" })).status).toBe(422);
    for (const body of [{ ids: [one, one] }, { all: true, extra: 1 }, { ids: [one], extra: 1 }, { ids: ["00000000-0000-0000-0000-000000000000"] }, { ids: [one.toUpperCase()] }]) {
      expect([200, 422], JSON.stringify(body)).toContain((await readNow(t, t.ana, body)).status);
    }
  });

  it("M03b ids and all together are refused (A: `{ ids } | { all: true }`), with no change", async () => {
    const t = await withUnread();
    const one = (await box(t.sid, t.ana.who)).items[0].id;
    const wrong: string[] = [];
    for (const body of [{ ids: [one], all: true }, { ids: [], all: true }]) {
      const fp = await fingerprint(t.sid);
      const r = await readNow(t, t.ana, body);
      if (r.status !== 422 || (await fingerprint(t.sid)) !== fp) wrong.push(`${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    expect(wrong).toEqual([]);
  });

  it("M04 identity: no cookie, a garbage cookie and a stranger's token are 404; nothing changes", async () => {
    const t = await withUnread();
    const stranger = await withUnread();
    const fp = await fingerprint(t.sid);
    for (const who of [null, { token: "garbage" }, { token: "x".repeat(64) }, stranger.ana.who, stranger.host.who]) {
      const r = await call(READ, t.sid, who, { path: "/notifications/read", body: { all: true }, idem: null });
      expect(r.status).toBe(404);
      expect(r.body.error?.code).toBe("NOT_FOUND");
    }
    expect(await fingerprint(t.sid)).toBe(fp);
  });

  it("M05 Origin: missing or foreign Origin is refused 403 FORBIDDEN_ORIGIN by the proxy; the own origin passes", async () => {
    const mk = (origin?: string) => new NextRequest("http://localhost:3000/api/sessions/x/notifications/read", { method: "POST", headers: origin ? { origin } : {} });
    for (const origin of [undefined, "https://evil.example", "http://localhost:3001"]) {
      const res = proxy(mk(origin));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN_ORIGIN");
    }
    expect(proxy(mk("http://localhost:3000")).status).toBe(200);
  });

  it("M06 works on a closed order, and the closing notice is readable there", async () => {
    const t = await withUnread();
    ok(await closeOrder(t));
    const n = await box(t.sid, t.ana.who);
    expect(n.items[0].type).toBe("order.ended");
    expect(n.unread).toBe(4);
    expect(ok(await readNow(t, t.ana, { ids: [n.items[0].id] })).body.data).toEqual({ marked: 1 });
    expect(ok(await readNow(t, t.ana, { all: true })).body.data).toEqual({ marked: 3 });
    expect((await box(t.sid, t.ana.who)).unread).toBe(0);
  });

  it("M07 no revision bump, no event row, no idempotency record, no session touch, and no pg_notify", async () => {
    const t = await withUnread();
    const l = await listen();
    try {
      const ids = (await box(t.sid, t.ana.who)).items.map((i) => i.id);
      const rev = await sessionRev(t.sid);
      const events = await eventCount(t.sid);
      const sessionRow = JSON.stringify(await db.execute(sql`SELECT * FROM sessions WHERE id = ${t.sid}`));
      const mutations = JSON.stringify(await db.execute(sql`SELECT * FROM mutation_records WHERE session_id = ${t.sid} ORDER BY created_at`));
      for (const body of [{ ids: [ids[0]] }, { ids: [ids[0]] }, { all: true }, { all: true }, { ids: [uuid()] }, {}]) await readNow(t, t.ana, body);
      await readNow(t, t.host, { all: true });
      await call(READ, t.sid, t.ana.who, { path: "/notifications/read", body: { all: true }, idem: key() });
      expect(await sessionRev(t.sid)).toBe(rev);
      expect(await eventCount(t.sid)).toBe(events);
      expect(JSON.stringify(await db.execute(sql`SELECT * FROM sessions WHERE id = ${t.sid}`))).toBe(sessionRow);
      expect(JSON.stringify(await db.execute(sql`SELECT * FROM mutation_records WHERE session_id = ${t.sid} ORDER BY created_at`))).toBe(mutations);
      expect((await syncOf(t.sid, t.host.who)).session.revision).toBe(rev);
      await addFor(t.bea, "Gyoza", 1, ind(t.bea));
      await until(() => l.msgs.includes(`${t.sid}:${rev + 1}`), "control NOTIFY");
      expect(l.msgs.filter((m) => m.startsWith(t.sid))).toEqual([`${t.sid}:${rev + 1}`]);
    } finally {
      await l.stop();
    }
  });

  it("M08 a pending confirm does not go stale because someone read their updates (control: a ticket change still does)", async () => {
    const t = await withUnread();
    await addFor(t.ana, "Gyoza", 1, ind(t.ana));
    const snap = await syncOf(t.sid, t.host.who);
    for (const p of [t.ana, t.bea, t.host]) await readNow(t, p, { all: true });
    const go = await call(CONFIRM, t.sid, t.host.who, { path: `/rounds/${snap.activeRoundId}/confirm`, params: { roundId: snap.activeRoundId as string }, body: { expectedRevision: snap.session.revision } });
    expect(go.status, JSON.stringify(go.body)).toBe(200);
    const t2 = await withUnread();
    await addFor(t2.ana, "Gyoza", 1, ind(t2.ana));
    const snap2 = await syncOf(t2.sid, t2.host.who);
    await addFor(t2.bea, "Ramen", 1, ind(t2.bea));
    const stale = await call(CONFIRM, t2.sid, t2.host.who, { path: `/rounds/${snap2.activeRoundId}/confirm`, params: { roundId: snap2.activeRoundId as string }, body: { expectedRevision: snap2.session.revision } });
    expect(stale.status).toBe(409);
  });

  it("M09 the snapshot's revision is unchanged by a read; only the unread count moves", async () => {
    const t = await withUnread();
    const before = await syncOf(t.sid, t.ana.who);
    await readNow(t, t.ana, { all: true });
    const after = await syncOf(t.sid, t.ana.who);
    expect(after.session.revision).toBe(before.session.revision);
    expect([before.notifications.unread, after.notifications.unread]).toEqual([3, 0]);
  });
});

// ---------- database guards and retention ----------
describe("notifications table: database guards and retention", () => {
  const ins = (sid: string, rid: string, dedup: string) =>
    db.execute(sql`INSERT INTO notifications (session_id, recipient_id, type, dedup_key) VALUES (${sid}, ${rid}, 'round.opened', ${dedup})`);

  it("G01 unique (session, recipient, dedup_key): a repeat is refused; another recipient or key is fine", async () => {
    const t = await room();
    await ins(t.sid, t.ana.id, "k");
    await expect(ins(t.sid, t.ana.id, "k")).rejects.toThrow();
    await ins(t.sid, t.bea.id, "k");
    await ins(t.sid, t.ana.id, "k2");
    expect(await rowsOf(t.sid)).toHaveLength(3);
  });

  it("G02 same-session trigger: a recipient of another order is refused on insert and on update", async () => {
    const a = await room();
    const b = await room();
    await expect(ins(a.sid, b.ana.id, "x")).rejects.toThrow();
    await ins(a.sid, a.ana.id, "x");
    await expect(db.execute(sql`UPDATE notifications SET recipient_id = ${b.ana.id} WHERE session_id = ${a.sid}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE notifications SET session_id = ${b.sid} WHERE session_id = ${a.sid}`)).rejects.toThrow();
    expect(await rowsOf(b.sid)).toHaveLength(0);
    expect(await rowsOf(a.sid)).toHaveLength(1);
  });

  it("G03 deleting the order deletes its notifications (and only its own)", async () => {
    const a = await room();
    const b = await room();
    await ins(a.sid, a.ana.id, "k");
    await ins(b.sid, b.ana.id, "k");
    await db.execute(sql`DELETE FROM sessions WHERE id = ${a.sid}`);
    expect(await rowsOf(a.sid)).toHaveLength(0);
    expect(await rowsOf(b.sid)).toHaveLength(1);
  });

  it("G04 deleting a participant deletes their notifications and nobody else's", async () => {
    const t = await room();
    await ins(t.sid, t.ana.id, "k");
    await ins(t.sid, t.bea.id, "k");
    await db.execute(sql`DELETE FROM participants WHERE id = ${t.ana.id}`);
    expect((await rowsOf(t.sid)).map((r) => r.recipient_id)).toEqual([t.bea.id]);
  });
});

// ---------- limits (last: the limiter is in process memory) ----------
describe("POST /notifications/read: limits", () => {
  it("M10 more than 120 reads a minute by one participant -> 429 RATE_LIMITED; a limited call changes nothing", async () => {
    const t = await room();
    await db.execute(sql`INSERT INTO notifications (session_id, recipient_id, type, dedup_key) VALUES (${t.sid}, ${t.ana.id}, 'round.opened', 'k')`);
    let limited: Res | null = null;
    let okCount = 0;
    for (let i = 0; i < 130 && !limited; i++) {
      const r = await readNow(t, t.ana, { ids: [uuid()] });
      if (r.status === 200) okCount++;
      else limited = r;
    }
    expect(limited?.status).toBe(429);
    expect(limited?.body.error?.code).toBe("RATE_LIMITED");
    expect(okCount).toBeGreaterThanOrEqual(100);
    expect(okCount).toBeLessThanOrEqual(120);
    expect((await readNow(t, t.ana, { all: true })).status).toBe(429);
    expect(await unreadOf(t.sid, t.ana.id)).toBe(1);
    expect((await readNow(t, t.bea, { all: true })).status).toBe(200);
  });
});
