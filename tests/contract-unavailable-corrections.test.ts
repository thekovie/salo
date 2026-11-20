/**
 * Contract tests: POST /dishes/:dishId/unavailable and the batch body of POST /corrections (docs/contracts/unavailable-corrections.md).
 * Real route handlers, real test database (salo_test), faked cookie jar. Run: pnpm vitest run tests/contract-unavailable-corrections.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { DELETE as CORRECTION_DELETE } from "@/app/api/sessions/[id]/corrections/[correctionId]/route";
import { POST as CORRECTIONS } from "@/app/api/sessions/[id]/corrections/route";
import { POST as UNAVAILABLE } from "@/app/api/sessions/[id]/dishes/[dishId]/unavailable/route";
import { PATCH as ENTRY_PATCH } from "@/app/api/sessions/[id]/entries/[entryId]/route";
import { POST as ENTRY_RESTORE } from "@/app/api/sessions/[id]/entries/[entryId]/restore/route";
import { POST as CONFIRM } from "@/app/api/sessions/[id]/rounds/[roundId]/confirm/route";
import { consolidate } from "@/lib/consolidate";
import { correctionRows, dishRemaining, preparationsOfRound } from "@/lib/corrections";
import { confirmedIds } from "@/lib/effective-order";
import { buildKkb } from "@/lib/kkb";
import type { Actor } from "@/lib/permissions";
import { buildSummary } from "@/lib/summary";
import { liveTicket, snapshotText } from "@/lib/ticket";
import { proxy } from "@/proxy";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { orderCorrections, sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { setEntryRemoved } from "@/server/orders/entries";
import { removeParticipant } from "@/server/orders/people";
import { closeSession, confirmRound, openRound } from "@/server/orders/rounds";
import { joinSession } from "@/server/sessions/join";
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
/** Loosely typed on purpose: refusals have `error` and no `data`, successes the reverse; assertions check which. */
interface ApiBody {
  data: { result: { removedEntryIds: string[]; removed: number; cancelled: number; replaced: number; correctionIds: string[]; groupId: string | null; correctionId: string }; revision: number; replayed: boolean };
  error: { code: string; message: string };
}
interface Res {
  status: number;
  body: ApiBody;
}
type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
interface Opts {
  idem?: string | null;
  raw?: string;
}

async function call(fn: unknown, path: string, method: string, params: Record<string, string>, who: Who | null, body: unknown, opts: Opts = {}): Promise<Res> {
  jar.cookies = who?.token ? { [credentialCookieName(params.id)]: who.token } : {};
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost:3000" };
  if (opts.idem !== null) headers["idempotency-key"] = opts.idem ?? key();
  const init: RequestInit = { method, headers };
  if (method !== "DELETE") init.body = opts.raw ?? JSON.stringify(body);
  const res = await within((fn as Handler)(new Request(`http://localhost:3000${path}`, init), { params: Promise.resolve(params) }), `${method} ${path}`);
  return { status: res.status, body: await res.json() };
}
const unav = (sid: string, dishId: string, who: Who | null, body: unknown = {}, opts: Opts = {}) =>
  call(UNAVAILABLE, `/api/sessions/${sid}/dishes/${dishId}/unavailable`, "POST", { id: sid, dishId }, who, body, opts);
const corr = (sid: string, who: Who | null, body: unknown, opts: Opts = {}) => call(CORRECTIONS, `/api/sessions/${sid}/corrections`, "POST", { id: sid }, who, body, opts);
const delCorr = (sid: string, cid: string, who: Who | null, opts: Opts = {}) =>
  call(CORRECTION_DELETE, `/api/sessions/${sid}/corrections/${cid}`, "DELETE", { id: sid, correctionId: cid }, who, null, opts);
const patchEntry = (sid: string, entryId: string, who: Who, body: unknown) => call(ENTRY_PATCH, `/api/sessions/${sid}/entries/${entryId}`, "PATCH", { id: sid, entryId }, who, body);
const restoreEntry = (sid: string, entryId: string, who: Who) => call(ENTRY_RESTORE, `/api/sessions/${sid}/entries/${entryId}/restore`, "POST", { id: sid, entryId }, who, {});
const confirmHttp = (sid: string, roundId: string, who: Who, expectedRevision: number) =>
  call(CONFIRM, `/api/sessions/${sid}/rounds/${roundId}/confirm`, "POST", { id: sid, roundId }, who, { expectedRevision });

const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3], type = "t") => runMutation(db, actor, { idempotencyKey: key(), type }, apply);
const snapOf = (a: Actor) => getSnapshot(db, a);
async function confirm(a: Actor) {
  const s = await snapOf(a);
  return run(a, (tx, sess) => confirmRound(tx, sess, a, s.activeRoundId, s.session.revision), "round.confirm");
}
const open = (a: Actor) => run(a, (tx, s) => openRound(tx, s, a), "round.open");
const removeDraft = (a: Actor, entryId: string) => run(a, (tx, s) => setEntryRemoved(tx, s, a, entryId, true));

async function guestOf(sessionId: string, name = "Ana") {
  const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, sessionId));
  const joined = await joinSession(db, code, name, sessionId);
  const actor = (await resolveActor(db, sessionId, joined.token)) as Actor;
  return { actor, who: { token: joined.token } as Who };
}

const rev = async (sid: string) => (await db.select({ r: sessions.revision }).from(sessions).where(eq(sessions.id, sid)))[0].r;
const eventTypes = async (sid: string) => ((await db.execute(sql`SELECT event_type AS t FROM session_events WHERE session_id = ${sid} ORDER BY revision`)) as unknown as { t: string }[]).map((x) => x.t);
const rowsOf = (sid: string) => db.select().from(orderCorrections).where(eq(orderCorrections.sessionId, sid));
type Rows = Awaited<ReturnType<typeof rowsOf>>;
const snapshotTexts = async (sid: string) =>
  ((await db.execute(sql`SELECT s.snapshot_data::text AS t FROM confirmed_round_snapshots s JOIN rounds r ON r.id = s.round_id WHERE r.session_id = ${sid} ORDER BY r.round_number`)) as unknown as { t: string }[]).map((x) => x.t);

/** Everything that must not move when a request is refused. */
async function fingerprint(sid: string) {
  const rows = (await db.execute(sql`SELECT
    (SELECT revision FROM sessions WHERE id = ${sid}) AS rev,
    (SELECT coalesce(json_agg(json_build_object('t', event_type, 'r', revision) ORDER BY revision), '[]'::json) FROM session_events WHERE session_id = ${sid}) AS ev,
    (SELECT coalesce(json_agg(c ORDER BY c.id), '[]'::json) FROM order_corrections c WHERE c.session_id = ${sid}) AS cor,
    (SELECT coalesce(json_agg(json_build_object('id', e.id, 'd', e.deleted_at, 'q', e.quantity, 'rv', e.revision) ORDER BY e.id), '[]'::json)
       FROM order_entries e JOIN order_batches b ON b.id = e.batch_id WHERE b.session_id = ${sid}) AS ent,
    (SELECT coalesce(json_agg(s.snapshot_data ORDER BY s.round_id), '[]'::json) FROM confirmed_round_snapshots s JOIN rounds r ON r.id = s.round_id WHERE r.session_id = ${sid}) AS snaps`)) as unknown as Record<string, unknown>[];
  return JSON.stringify(rows[0]);
}

async function expectRefused(sid: string, fn: () => Promise<Res>, status: number | number[], code?: string) {
  const before = await fingerprint(sid);
  const r = await fn();
  expect(Array.isArray(status) ? status : [status], JSON.stringify(r.body)).toContain(r.status);
  expect(r.body.data).toBeUndefined();
  expect(typeof r.body.error?.message).toBe("string");
  if (code) expect(r.body.error?.code, JSON.stringify(r.body)).toBe(code);
  expect(await fingerprint(sid), "refused request changed state").toBe(before);
  return r;
}

/** Host + guest Ana. Round 1: host Sisig x2 Large, Ana Sisig x1, host Katsu x1 (confirmed unless asked). */
async function sisigTable(opts: { confirmed?: boolean } = {}) {
  const { host, sessionId, token } = await newSession(db);
  const ana = await guestOf(sessionId, "Ana");
  const hostSisig = (await add(db, host, { dishName: "Sisig", quantity: 2, variant: "Large", attribution: { type: "INDIVIDUAL" } })).result.entryId;
  const anaSisig = (await add(db, ana.actor, { dishName: "Sisig", quantity: 1, attribution: { type: "INDIVIDUAL" } })).result.entryId;
  const katsu = (await add(db, host, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL" } })).result.entryId;
  if (opts.confirmed !== false) await confirm(host);
  const snap = await snapOf(host);
  return {
    host, hostWho: { token } as Who, ana, anaWho: ana.who, sessionId, hostSisig, anaSisig, katsu,
    sisigId: snap.entries.find((e) => e.id === hostSisig)!.dishId,
    katsuId: snap.entries.find((e) => e.id === katsu)!.dishId,
  };
}
type Table = Awaited<ReturnType<typeof sisigTable>>;

const kkbQty = async (a: Actor, dish: string) =>
  buildKkb(await snapOf(a), a.participantId).sections.flatMap((s) => [...s.lines, ...s.drafts]).filter((l) => l.label.startsWith(dish)).reduce((n, l) => n + l.quantity, 0);
const roundIdOf = (snap: Awaited<ReturnType<typeof snapOf>>, n: number) => snap.rounds.find((r) => r.number === n)!.id;
const cancelledOf = (rows: Rows, entryId: string) => rows.filter((r) => r.sourceEntryId === entryId && r.correctionType === "QUANTITY").reduce((n, r) => n - (r.quantityDelta ?? 0), 0);
const told = (rows: Rows) => rows.filter((c) => c.reason === "UNAVAILABLE");

/** Many confirmed entries of one dish (Rice x2 each), spread over guests so nobody hits the 120/min limit. Round 2 is open. */
async function riceTable(n: number) {
  const { host, sessionId, token } = await newSession(db);
  const guests: Actor[] = [];
  for (let i = 0; i < Math.ceil(n / 40); i++) guests.push((await guestOf(sessionId, `G${i}`)).actor);
  const entryIds: string[] = [];
  for (let i = 0; i < n; i++) entryIds.push((await add(db, guests[i % guests.length], { dishName: "Rice", quantity: 2, attribution: { type: "INDIVIDUAL" } })).result.entryId);
  await confirm(host);
  await open(host);
  return { host, hostWho: { token } as Who, sessionId, entryIds, riceId: (await snapOf(host)).entries[0].dishId };
}

async function withOpenRound(t: Table) {
  await open(t.host);
  return roundIdOf(await snapOf(t.host), 2);
}

const two = (t: Table, quantity = 1) => ({ entries: [{ sourceEntryId: t.hostSisig, quantity }, { sourceEntryId: t.anaSisig, quantity: 1 }], type: "QUANTITY" });

// =====================================================================================================
// POST /dishes/:dishId/unavailable
// =====================================================================================================
describe("POST /dishes/:dishId/unavailable: happy path and effects", () => {
  it("U01 draft entries (every size) removed, each confirmed entry cancelled for its remainder, one group, one change", async () => {
    const t = await sisigTable();
    await open(t.host);
    const draftSmall = (await add(db, t.host, { dishName: "Sisig", quantity: 3, variant: "Small", attribution: { type: "INDIVIDUAL" } })).result.entryId;
    const draftAna = (await add(db, t.ana.actor, { dishName: "sisig", quantity: 1, attribution: { type: "INDIVIDUAL" } })).result.entryId;
    const draftKatsu = (await add(db, t.host, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL" } })).result.entryId;
    expect(await kkbQty(t.host, "Sisig")).toBe(7);
    const r0 = await rev(t.sessionId);
    const r = await unav(t.sessionId, t.sisigId, t.hostWho);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ replayed: false, revision: r0 + 1 });
    expect(r.body.data.result.removedEntryIds.slice().sort()).toEqual([draftSmall, draftAna].sort());
    expect(await rev(t.sessionId)).toBe(r0 + 1);
    const snap = await snapOf(t.host);
    const ids = snap.entries.map((e) => e.id);
    expect(ids).not.toContain(draftSmall);
    expect(ids).not.toContain(draftAna);
    expect(ids).toContain(draftKatsu);
    expect(ids).toContain(t.katsu);
    const rows = told(await rowsOf(t.sessionId));
    expect(rows).toHaveLength(2);
    const r1 = roundIdOf(snap, 1);
    expect(rows.every((c) => c.targetRoundId === r1 && c.sourceRoundId === r1 && c.correctionType === "QUANTITY")).toBe(true);
    expect(cancelledOf(rows, t.hostSisig)).toBe(2);
    expect(cancelledOf(rows, t.anaSisig)).toBe(1);
    expect(rows.every((c) => c.groupId && c.groupId === rows[0].groupId)).toBe(true);
    expect((await eventTypes(t.sessionId)).slice(-1)).toEqual(["dish.unavailable"]);
    expect(await kkbQty(t.host, "Sisig")).toBe(0);
    expect(await kkbQty(t.host, "Katsu")).toBe(2);
    expect(dishRemaining(t.sisigId, snap.entries, snap)).toBe(0);
    const prep = preparationsOfRound(snap.entries.filter((e) => e.roundId === r1), snap.corrections, snap.participants, confirmedIds(snap.rounds)).filter((p) => p.dishId === t.sisigId);
    expect(prep.every((p) => p.left === 0)).toBe(true);
  });

  it("U02 waiter ticket and snapshot of the confirmed round are byte-identical afterwards", async () => {
    const t = await sisigTable();
    const before = await snapOf(t.host);
    const r1 = roundIdOf(before, 1);
    const sqlBefore = await snapshotTexts(t.sessionId);
    const ticketBefore = JSON.stringify(before.tickets[r1]);
    const textBefore = snapshotText(before.tickets[r1]);
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    const after = await snapOf(t.host);
    expect(JSON.stringify(after.tickets[r1])).toBe(ticketBefore);
    expect(snapshotText(after.tickets[r1])).toBe(textBefore);
    expect(await snapshotTexts(t.sessionId)).toEqual(sqlBefore);
  });

  it("U03 told rows are told, never pending, and never on the next round's live ticket or confirmed snapshot", async () => {
    const t = await sisigTable();
    await open(t.host);
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    const snap = await snapOf(t.host);
    const rows = correctionRows(snap);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => x.told && x.unavailable && x.goesWithRound === null)).toBe(true);
    const draft = snap.rounds.find((r) => r.status === "DRAFT")!;
    expect(snap.corrections.filter((c) => c.targetRoundId === draft.id)).toEqual([]);
    const live = liveTicket({ roundNumber: draft.number, title: null, ticket: consolidate(snap.entries.filter((e) => e.roundId === draft.id)), corrections: snap.corrections, roundId: draft.id, confirmed: confirmedIds(snap.rounds) });
    expect(live.corrections).toEqual([]);
    expect(snapshotText(live)).not.toMatch(/sisig/i);
    const c = await confirm(t.host);
    expect(c.result.roundId).toBe(draft.id);
    const after = await snapOf(t.host);
    expect(after.tickets[draft.id].corrections).toEqual([]);
    expect(JSON.stringify(after.tickets[draft.id])).not.toMatch(/sisig/i);
    expect(JSON.stringify(after.tickets[roundIdOf(after, 1)])).toMatch(/Sisig/);
  });

  it("U04 told rows do not make a next round non-empty: an empty next round is still EMPTY_ROUND", async () => {
    const t = await sisigTable();
    await open(t.host);
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    const snap = await snapOf(t.host);
    const r = await confirmHttp(t.sessionId, snap.activeRoundId, t.hostWho, snap.session.revision);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("EMPTY_ROUND");
  });

  it("U05 no draft entry removed -> dish.unavailableTold, which does NOT make a pending confirm stale", async () => {
    const t = await sisigTable();
    await open(t.host);
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    const seen = await snapOf(t.host);
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    expect((await eventTypes(t.sessionId)).slice(-1)).toEqual(["dish.unavailableTold"]);
    const r = await confirmHttp(t.sessionId, seen.activeRoundId, t.hostWho, seen.session.revision);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it("U06 a draft entry was removed -> dish.unavailable, which DOES make a pending confirm stale", async () => {
    const t = await sisigTable();
    await open(t.host);
    await add(db, t.host, { dishName: "Sisig", quantity: 1, variant: "Small", attribution: { type: "INDIVIDUAL" } });
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    const seen = await snapOf(t.host);
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    expect((await eventTypes(t.sessionId)).slice(-1)).toEqual(["dish.unavailable"]);
    const r = await confirmHttp(t.sessionId, seen.activeRoundId, t.hostWho, seen.session.revision);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("STALE_REVISION");
  });

  it("U07 no open round at all: confirmed entries are still corrected (told event); the next round starts clean", async () => {
    const t = await sisigTable();
    const r = await unav(t.sessionId, t.sisigId, t.hostWho);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await eventTypes(t.sessionId)).slice(-1)).toEqual(["dish.unavailableTold"]);
    expect(await kkbQty(t.host, "Sisig")).toBe(0);
    await open(t.host);
    const snap = await snapOf(t.host);
    expect(snap.corrections.filter((c) => c.targetRoundId === snap.activeRoundId)).toEqual([]);
  });

  it("U08 draft-only dish (nothing confirmed): entries removed, no correction rows, dish.unavailable; Undo (restore) brings one back", async () => {
    const t = await sisigTable({ confirmed: false });
    const r = await unav(t.sessionId, t.sisigId, t.hostWho);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.result.removedEntryIds.slice().sort()).toEqual([t.hostSisig, t.anaSisig].sort());
    expect(await rowsOf(t.sessionId)).toEqual([]);
    expect((await eventTypes(t.sessionId)).slice(-1)).toEqual(["dish.unavailable"]);
    expect((await snapOf(t.host)).entries.map((e) => e.id)).toEqual([t.katsu]);
    const undo = await restoreEntry(t.sessionId, t.hostSisig, t.hostWho);
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect((await snapOf(t.host)).entries.map((e) => e.id)).toContain(t.hostSisig);
  });

  it("U09 with replacement: confirmed entries get REPLACE rows (not cancellations), drafts still removed, note stored", async () => {
    const t = await sisigTable();
    await open(t.host);
    const draft = (await add(db, t.host, { dishName: "Sisig", quantity: 1, variant: "Small", attribution: { type: "INDIVIDUAL" } })).result.entryId;
    const r = await unav(t.sessionId, t.sisigId, t.hostWho, { replacement: "Pork Belly", note: "waiter's suggestion" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.result.removedEntryIds).toEqual([draft]);
    const rows = told(await rowsOf(t.sessionId));
    expect(rows).toHaveLength(2);
    const r1 = roundIdOf(await snapOf(t.host), 1);
    expect(rows.every((c) => c.correctionType === "REPLACE" && c.targetRoundId === r1 && (c.replacementData as { text: string }).text === "Pork Belly" && c.quantityDelta === null)).toBe(true);
    expect(rows.every((c) => c.explanation === "waiter's suggestion")).toBe(true);
    expect(new Set(rows.map((c) => c.groupId)).size).toBe(1);
    expect(rows[0].groupId).toBeTruthy();
    const lines = buildKkb(await snapOf(t.host), t.host.participantId).sections.flatMap((s) => [...s.lines, ...s.drafts]).filter((l) => l.label.startsWith("Sisig"));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.label.endsWith("→ Pork Belly") && !l.pendingChange)).toBe(true);
    expect(lines.reduce((n, l) => n + l.quantity, 0)).toBe(3);
  });

  it("U10 a dish ordered in several rounds: each entry's correction targets its OWN confirmed round", async () => {
    const t = await sisigTable();
    await open(t.host);
    const e2 = (await add(db, t.host, { dishName: "Sisig", quantity: 4, attribution: { type: "INDIVIDUAL" } })).result.entryId;
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await confirm(t.host);
    await open(t.host);
    const e3 = (await add(db, t.host, { dishName: "Sisig", quantity: 5, attribution: { type: "INDIVIDUAL" } })).result.entryId;
    const before = await snapshotTexts(t.sessionId);
    const r = await unav(t.sessionId, t.sisigId, t.hostWho);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.result.removedEntryIds).toEqual([e3]);
    const snap = await snapOf(t.host);
    const rows = told(await rowsOf(t.sessionId));
    expect(rows).toHaveLength(3);
    for (const [entry, round] of [[t.hostSisig, 1], [t.anaSisig, 1], [e2, 2]] as const) {
      const row = rows.find((c) => c.sourceEntryId === entry)!;
      expect(row.targetRoundId).toBe(roundIdOf(snap, round));
      expect(row.sourceRoundId).toBe(roundIdOf(snap, round));
    }
    expect(cancelledOf(rows, e2)).toBe(4);
    expect(new Set(rows.map((c) => c.groupId)).size).toBe(1);
    expect(await snapshotTexts(t.sessionId)).toEqual(before);
    expect(await kkbQty(t.host, "Sisig")).toBe(0);
  });

  it("U11 entries already partly cancelled (told) lose only their remainder; total never exceeds the ordered quantity", async () => {
    const t = await sisigTable();
    await open(t.host);
    expect((await corr(t.sessionId, t.hostWho, { sourceEntryId: t.hostSisig, type: "QUANTITY", quantity: 1 })).status).toBe(201);
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await confirm(t.host);
    await open(t.host);
    expect(await kkbQty(t.host, "Sisig")).toBe(2);
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    const rows = await rowsOf(t.sessionId);
    const mine = told(rows);
    expect(mine.map((c) => c.sourceEntryId).sort()).toEqual([t.hostSisig, t.anaSisig].sort());
    expect(cancelledOf(mine, t.hostSisig)).toBe(1);
    expect(cancelledOf(rows, t.hostSisig)).toBe(2);
    expect(cancelledOf(rows, t.anaSisig)).toBe(1);
    expect(await kkbQty(t.host, "Sisig")).toBe(0);
  });

  it("U12 pending (unconfirmed) corrections on the dish's entries are dropped and never add up to more than ordered; other dishes keep theirs", async () => {
    const t = await sisigTable();
    await open(t.host);
    expect((await corr(t.sessionId, t.hostWho, two(t))).status).toBe(201);
    expect((await corr(t.sessionId, t.hostWho, { sourceEntryId: t.katsu, type: "QUANTITY", quantity: 1 })).status).toBe(201);
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    const rows = await rowsOf(t.sessionId);
    expect(cancelledOf(rows, t.hostSisig)).toBe(2);
    expect(cancelledOf(rows, t.anaSisig)).toBe(1);
    expect(rows.filter((c) => c.reason === null && [t.hostSisig, t.anaSisig].includes(c.sourceEntryId!))).toEqual([]);
    expect(rows.filter((c) => c.sourceEntryId === t.katsu)).toHaveLength(1);
  });

  it("U13 a pending REPLACE on one of the entries is dropped; the entry ends with a single told row", async () => {
    const t = await sisigTable();
    await open(t.host);
    expect((await corr(t.sessionId, t.hostWho, { sourceEntryId: t.hostSisig, type: "REPLACE", replacement: "Adobo" })).status).toBe(201);
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    const rows = (await rowsOf(t.sessionId)).filter((c) => c.sourceEntryId === t.hostSisig);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("UNAVAILABLE");
  });

  it("U14 a removed guest's confirmed entries still get corrected (the bill still counts them)", async () => {
    const t = await sisigTable();
    await run(t.host, (tx, s) => removeParticipant(tx, s, t.host, t.ana.actor.participantId, null));
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    expect(told(await rowsOf(t.sessionId)).map((c) => c.sourceEntryId).sort()).toEqual([t.hostSisig, t.anaSisig].sort());
  });

  it("U15 the per-person summary no longer lists the dish at once", async () => {
    const t = await sisigTable();
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    expect(JSON.stringify(buildSummary(await snapOf(t.host)))).not.toMatch(/Sisig/);
  });

  it("U16 every preparation (size and note) of the dish goes, not only the plain one", async () => {
    const t = await sisigTable({ confirmed: false });
    const noOnion = (await add(db, t.host, { dishName: "Sisig", quantity: 2, instructions: "no onions", attribution: { type: "INDIVIDUAL" } })).result.entryId;
    const small = (await add(db, t.host, { dishName: "Sisig", quantity: 1, variant: "Small", instructions: "extra spicy", attribution: { type: "TABLE" } })).result.entryId;
    await confirm(t.host);
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    const rows = told(await rowsOf(t.sessionId));
    expect(rows.map((c) => c.sourceEntryId).sort()).toEqual([t.hostSisig, t.anaSisig, noOnion, small].sort());
    expect(await kkbQty(t.host, "Sisig")).toBe(0);
  });
});

describe("POST /dishes/:dishId/unavailable: nothing left, idempotency, scoping", () => {
  it("U17 a second call (new key) after everything is cancelled -> 409 NOTHING_LEFT, no new rows", async () => {
    const t = await sisigTable();
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    await expectRefused(t.sessionId, () => unav(t.sessionId, t.sisigId, t.hostWho), 409, "NOTHING_LEFT");
  });

  it("U18 [follow-up] after a REPLACE the entries already left the order: a second unavailable writes no second row for them", async () => {
    const t = await sisigTable();
    expect((await unav(t.sessionId, t.sisigId, t.hostWho, { replacement: "Adobo" })).status).toBe(200);
    const before = (await rowsOf(t.sessionId)).length;
    const r = await unav(t.sessionId, t.sisigId, t.hostWho);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect((await rowsOf(t.sessionId)).length).toBe(before);
  });

  it("U19 same key replayed: applied once, replayed: true, same result, no more rows or events", async () => {
    const t = await sisigTable();
    await open(t.host);
    await add(db, t.host, { dishName: "Sisig", quantity: 1, variant: "Small", attribution: { type: "INDIVIDUAL" } });
    const idem = key();
    const a = await unav(t.sessionId, t.sisigId, t.hostWho, {}, { idem });
    const fp = await fingerprint(t.sessionId);
    const b = await unav(t.sessionId, t.sisigId, t.hostWho, {}, { idem });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.data.replayed).toBe(true);
    expect(b.body.data.result).toEqual(a.body.data.result);
    expect(b.body.data.revision).toBe(a.body.data.revision);
    expect(await fingerprint(t.sessionId)).toBe(fp);
  });

  it("U20 key is bound to the dish: the same key on another dish -> 422 IDEMPOTENCY_KEY_REUSED, other dish untouched", async () => {
    const t = await sisigTable();
    const idem = key();
    expect((await unav(t.sessionId, t.sisigId, t.hostWho, {}, { idem })).status).toBe(200);
    await expectRefused(t.sessionId, () => unav(t.sessionId, t.katsuId, t.hostWho, {}, { idem }), 422, "IDEMPOTENCY_KEY_REUSED");
    expect(await kkbQty(t.host, "Katsu")).toBe(1);
  });

  it("U21 a key already used for another kind of change (correction) -> 422 IDEMPOTENCY_KEY_REUSED", async () => {
    const t = await sisigTable();
    await open(t.host);
    const idem = key();
    expect((await corr(t.sessionId, t.hostWho, { sourceEntryId: t.katsu, type: "QUANTITY", quantity: 1 }, { idem })).status).toBe(201);
    await expectRefused(t.sessionId, () => unav(t.sessionId, t.sisigId, t.hostWho, {}, { idem }), 422, "IDEMPOTENCY_KEY_REUSED");
  });

  it("U22 missing / short / odd-char / 101-char Idempotency-Key -> 400 IDEMPOTENCY_KEY", async () => {
    const t = await sisigTable();
    for (const idem of [null, "short", "has spaces!!", "a".repeat(101)]) await expectRefused(t.sessionId, () => unav(t.sessionId, t.sisigId, t.hostWho, {}, { idem }), 400, "IDEMPOTENCY_KEY");
  });

  it("U23 unknown dish uuid, non-uuid, and another order's dish -> 404 DISH_NOT_FOUND; the other order is untouched", async () => {
    const a = await sisigTable();
    const b = await sisigTable();
    await expectRefused(a.sessionId, () => unav(a.sessionId, randomUUID(), a.hostWho), 404, "DISH_NOT_FOUND");
    await expectRefused(a.sessionId, () => unav(a.sessionId, "not-a-uuid", a.hostWho), 404, "DISH_NOT_FOUND");
    await expectRefused(a.sessionId, () => unav(a.sessionId, b.sisigId, a.hostWho), 404, "DISH_NOT_FOUND");
    expect(await kkbQty(b.host, "Sisig")).toBe(3);
    expect(await rowsOf(b.sessionId)).toEqual([]);
  });

  it("U24 a dish whose entries were all removed drafts -> 404 or 409, never 200", async () => {
    const t = await sisigTable({ confirmed: false });
    await removeDraft(t.host, t.hostSisig);
    await removeDraft(t.host, t.anaSisig);
    await expectRefused(t.sessionId, () => unav(t.sessionId, t.sisigId, t.hostWho), [404, 409]);
  });
});

describe("POST /dishes/:dishId/unavailable: validation", () => {
  it("U25 bad bodies -> 422 INVALID / 400 BAD_JSON / 413 TOO_LARGE, never a change", async () => {
    const t = await sisigTable();
    const bad: unknown[] = [{ replacement: 5 }, { replacement: true }, { replacement: {} }, { replacement: ["a"] }, { note: 5 }, { note: [] }, { replacement: "x".repeat(61) }, { note: "x".repeat(141) }, { replacement: "bad\u0000name" }, { note: "bad\u0000" }, [], "text", 5, null];
    for (const body of bad) await expectRefused(t.sessionId, () => unav(t.sessionId, t.sisigId, t.hostWho, body), 422, "INVALID");
    await expectRefused(t.sessionId, () => unav(t.sessionId, t.sisigId, t.hostWho, null, { raw: "{not json" }), 400, "BAD_JSON");
    await expectRefused(t.sessionId, () => unav(t.sessionId, t.sisigId, t.hostWho, { note: "x".repeat(9000) }), 413, "TOO_LARGE");
  });

  it("U26 boundaries: replacement 60 chars and note 140 chars accepted; a blank replacement never produces a REPLACE row", async () => {
    const t = await sisigTable();
    const t2 = await sisigTable();
    const ok = await unav(t.sessionId, t.sisigId, t.hostWho, { replacement: "r".repeat(60), note: "n".repeat(140) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const blank = await unav(t2.sessionId, t2.sisigId, t2.hostWho, { replacement: "   " });
    expect([200, 422]).toContain(blank.status);
    if (blank.status === 200) expect((await rowsOf(t2.sessionId)).every((c) => c.correctionType === "QUANTITY")).toBe(true);
  });

  it("U27 an empty body (no JSON) is the same as {}", async () => {
    const t = await sisigTable();
    const r = await unav(t.sessionId, t.sisigId, t.hostWho, null, { raw: "" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});

describe("POST /dishes/:dishId/unavailable: who may call", () => {
  it("U28 guest (even one who ordered the dish) -> 403 FORBIDDEN, nothing changes", async () => {
    const t = await sisigTable();
    await expectRefused(t.sessionId, () => unav(t.sessionId, t.sisigId, t.anaWho), 403, "FORBIDDEN");
  });

  it("U29 no cookie / garbage cookie -> 404 NOT_FOUND", async () => {
    const t = await sisigTable();
    await expectRefused(t.sessionId, () => unav(t.sessionId, t.sisigId, null), 404, "NOT_FOUND");
    await expectRefused(t.sessionId, () => unav(t.sessionId, t.sisigId, { token: "garbage-token" }), 404, "NOT_FOUND");
  });

  it("U30 another order's host (tenant): its token under this order's cookie name -> 404; its own order cannot reach this dish", async () => {
    const a = await sisigTable();
    const b = await sisigTable();
    await expectRefused(a.sessionId, () => unav(a.sessionId, a.sisigId, b.hostWho), 404, "NOT_FOUND");
    await expectRefused(b.sessionId, () => unav(b.sessionId, a.sisigId, a.hostWho), 404, "NOT_FOUND");
    await expectRefused(b.sessionId, () => unav(b.sessionId, a.sisigId, b.hostWho), 404, "DISH_NOT_FOUND");
  });

  it("U31 a removed guest is refused (403 REMOVED or 404)", async () => {
    const t = await sisigTable();
    await run(t.host, (tx, s) => removeParticipant(tx, s, t.host, t.ana.actor.participantId, null));
    await expectRefused(t.sessionId, () => unav(t.sessionId, t.sisigId, t.anaWho), [403, 404]);
  });

  it("U32 Origin: a missing or foreign Origin is refused 403 FORBIDDEN_ORIGIN by the proxy; the same origin passes", async () => {
    const mk = (origin?: string) => new NextRequest("http://localhost:3000/api/sessions/x/dishes/y/unavailable", { method: "POST", headers: origin ? { origin } : {} });
    for (const origin of [undefined, "https://evil.example", "http://localhost:3001"]) {
      const res = proxy(mk(origin));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN_ORIGIN");
    }
    expect(proxy(mk("http://localhost:3000")).status).toBe(200);
  });

  it("U33 a closed order -> 409 SESSION_CLOSED, nothing changes", async () => {
    const t = await sisigTable();
    await run(t.host, (tx, s) => closeSession(tx, s, t.host));
    await expectRefused(t.sessionId, () => unav(t.sessionId, t.sisigId, t.hostWho), 409, "SESSION_CLOSED");
  });
});

describe("POST /dishes/:dishId/unavailable: permanence, retention, bell, limit", () => {
  it("U34 told unavailable rows can never be removed: API 409 ROUND_CONFIRMED, direct SQL UPDATE and DELETE refused", async () => {
    const t = await sisigTable();
    await unav(t.sessionId, t.sisigId, t.hostWho);
    const rows = await rowsOf(t.sessionId);
    for (const row of rows) await expectRefused(t.sessionId, () => delCorr(t.sessionId, row.id, t.hostWho), 409, "ROUND_CONFIRMED");
    await expect(db.execute(sql`DELETE FROM order_corrections WHERE session_id = ${t.sessionId}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE order_corrections SET explanation = 'x' WHERE session_id = ${t.sessionId}`)).rejects.toThrow();
    expect((await rowsOf(t.sessionId)).length).toBe(rows.length);
  });

  it("U35 DB: reason is NULL or UNAVAILABLE only", async () => {
    const t = await sisigTable();
    await open(t.host);
    await corr(t.sessionId, t.hostWho, { sourceEntryId: t.katsu, type: "QUANTITY", quantity: 1 });
    await expect(db.execute(sql`UPDATE order_corrections SET reason = 'BOGUS' WHERE session_id = ${t.sessionId}`)).rejects.toThrow();
  });

  it("U36 retention: deleting the order deletes its told unavailable rows too (cascade passes the freeze trigger)", async () => {
    const t = await sisigTable();
    await unav(t.sessionId, t.sisigId, t.hostWho);
    expect((await rowsOf(t.sessionId)).length).toBe(2);
    await db.execute(sql`DELETE FROM sessions WHERE id = ${t.sessionId}`);
    expect((await rowsOf(t.sessionId)).length).toBe(0);
  });

  it("U37 the change rings the realtime bell (pg_notify salo_events) within 15 s", async () => {
    const t = await sisigTable();
    let got: (v: string) => void = () => undefined;
    const heard = new Promise<string>((res) => (got = res));
    const sub = await db.$client.listen("salo_events", (payload) => {
      if (payload.includes(t.sessionId)) got(payload);
    });
    try {
      const [msg] = await within(Promise.all([heard, unav(t.sessionId, t.sisigId, t.hostWho)]), "notify after unavailable");
      expect(msg).toContain(t.sessionId);
    } finally {
      await sub.unlisten();
    }
  });

  it("U38 more than 120 changes a minute by one participant -> 429 RATE_LIMITED", async () => {
    const t = await sisigTable();
    let limited: Res | null = null;
    for (let i = 0; i < 130 && !limited; i++) {
      const r = await unav(t.sessionId, randomUUID(), t.hostWho);
      if (r.status === 429) limited = r;
      else expect(r.status).toBe(404);
    }
    expect(limited?.status).toBe(429);
    expect(limited?.body.error?.code).toBe("RATE_LIMITED");
  });
});

describe("POST /dishes/:dishId/unavailable: races", () => {
  it("U39 racing a draft entry edit: no 5xx, the entry ends removed (an edit never resurrects it)", async () => {
    for (let i = 0; i < 4; i++) {
      const t = await sisigTable();
      await open(t.host);
      const draft = (await add(db, t.host, { dishName: "Sisig", quantity: 3, variant: "Small", attribution: { type: "INDIVIDUAL" } })).result.entryId;
      const entry = (await snapOf(t.host)).entries.find((e) => e.id === draft)!;
      const [u, p] = await Promise.all([unav(t.sessionId, t.sisigId, t.hostWho), patchEntry(t.sessionId, draft, t.hostWho, { expectedRevision: entry.revision, quantity: 5 })]);
      expect(u.status, JSON.stringify(u.body)).toBe(200);
      expect(p.status, JSON.stringify(p.body)).toBeLessThan(500);
      if (p.status !== 200) expect([404, 409, 422]).toContain(p.status);
      expect((await snapOf(t.host)).entries.some((e) => e.id === draft), "edited entry survived unavailable").toBe(false);
      expect(await kkbQty(t.host, "Sisig")).toBe(0);
    }
  });

  it("U40 racing a batch correction on the same entries: totals never exceed ordered, no pending rows for the dish survive", async () => {
    for (let i = 0; i < 4; i++) {
      const t = await sisigTable();
      await open(t.host);
      const [u, c] = await Promise.all([unav(t.sessionId, t.sisigId, t.hostWho), corr(t.sessionId, t.hostWho, two(t, 2))]);
      expect(u.status, JSON.stringify(u.body)).toBe(200);
      expect(c.status, JSON.stringify(c.body)).toBeLessThan(500);
      if (c.status !== 201) expect([409, 422]).toContain(c.status);
      const rows = await rowsOf(t.sessionId);
      expect(cancelledOf(rows, t.hostSisig)).toBe(2);
      expect(cancelledOf(rows, t.anaSisig)).toBe(1);
      expect(rows.filter((x) => x.reason === null)).toEqual([]);
      expect(await kkbQty(t.host, "Sisig")).toBe(0);
    }
  });

  it("U41 two unavailable calls at once (different keys): one applies, the other NOTHING_LEFT; one row per entry", async () => {
    const t = await sisigTable();
    const rs = await Promise.all([unav(t.sessionId, t.sisigId, t.hostWho), unav(t.sessionId, t.sisigId, t.hostWho)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(rs.find((r) => r.status === 409)!.body.error.code).toBe("NOTHING_LEFT");
    expect(told(await rowsOf(t.sessionId))).toHaveLength(2);
  });

  it("U42 the same key twice at once: applied once (one fresh, one replay), one revision bump", async () => {
    const t = await sisigTable();
    const idem = key();
    const r0 = await rev(t.sessionId);
    const rs = await Promise.all([unav(t.sessionId, t.sisigId, t.hostWho, {}, { idem }), unav(t.sessionId, t.sisigId, t.hostWho, {}, { idem })]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(rs.filter((r) => r.body.data.replayed)).toHaveLength(1);
    expect(await rev(t.sessionId)).toBe(r0 + 1);
    expect((await rowsOf(t.sessionId)).length).toBe(2);
  });
});

// =====================================================================================================
// POST /corrections (batch body)
// =====================================================================================================
describe("POST /corrections batch: happy path", () => {
  it("C01 one change across several people's entries: 201, one row per entry, shared group, pending until the round is confirmed", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    const r0 = await rev(t.sessionId);
    const r = await corr(t.sessionId, t.hostWho, { ...two(t, 2), explanation: "out of stock" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ replayed: false, revision: r0 + 1 });
    const { correctionIds, groupId } = r.body.data.result;
    expect(correctionIds).toHaveLength(2);
    expect(groupId).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await rowsOf(t.sessionId);
    expect(rows).toHaveLength(2);
    const snap = await snapOf(t.host);
    expect(rows.every((c) => c.groupId === groupId && c.targetRoundId === snap.activeRoundId && c.reason === null && c.correctionType === "QUANTITY" && c.explanation === "out of stock")).toBe(true);
    expect(cancelledOf(rows, t.hostSisig)).toBe(2);
    expect(cancelledOf(rows, t.anaSisig)).toBe(1);
    expect((await eventTypes(t.sessionId)).slice(-1)).toEqual(["correction.recorded"]);
    expect(correctionRows(snap)).toHaveLength(1);
    expect(correctionRows(snap)[0].told).toBe(false);
    expect(await kkbQty(t.host, "Sisig")).toBe(3);
  });

  it("C02 the old single-entry body still works (QUANTITY and REPLACE) with the old result shape", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    const q = await corr(t.sessionId, t.hostWho, { sourceEntryId: t.hostSisig, type: "QUANTITY", quantity: 1 });
    expect(q.status, JSON.stringify(q.body)).toBe(201);
    expect(q.body.data.result.correctionId).toMatch(/^[0-9a-f-]{36}$/);
    const rep = await corr(t.sessionId, t.hostWho, { sourceEntryId: t.katsu, type: "REPLACE", replacement: "Tonkatsu", explanation: "x" });
    expect(rep.status, JSON.stringify(rep.body)).toBe(201);
    const rows = await rowsOf(t.sessionId);
    expect(rows).toHaveLength(2);
    const repRow = rows.find((c) => c.id === rep.body.data.result.correctionId)!;
    expect(repRow).toMatchObject({ correctionType: "REPLACE", quantityDelta: null });
    expect((repRow.replacementData as { text: string }).text).toBe("Tonkatsu");
    expect(rows.find((c) => c.id === q.body.data.result.correctionId)).toMatchObject({ correctionType: "QUANTITY", quantityDelta: -1 });
  });

  it("C03 REPLACE batch: every row carries the replacement; a missing or blank replacement is refused", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    const entries = [{ sourceEntryId: t.hostSisig }, { sourceEntryId: t.anaSisig }];
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { entries, type: "REPLACE" }), 422, "INVALID");
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { entries, type: "REPLACE", replacement: "  " }), 422, "INVALID");
    const r = await corr(t.sessionId, t.hostWho, { entries, type: "REPLACE", replacement: "Adobo" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const rows = await rowsOf(t.sessionId);
    expect(rows.every((c) => c.correctionType === "REPLACE" && (c.replacementData as { text: string }).text === "Adobo" && c.groupId === r.body.data.result.groupId)).toBe(true);
  });

  it("C04 a batch with one entry behaves like the single form (one row)", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    const r = await corr(t.sessionId, t.hostWho, { entries: [{ sourceEntryId: t.hostSisig, quantity: 1 }], type: "QUANTITY" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.result.correctionIds).toHaveLength(1);
    expect(await rowsOf(t.sessionId)).toHaveLength(1);
  });

  it("C05 confirming the round tells them: lines on that ticket, rows frozen (told), billing applies them", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    const r = await corr(t.sessionId, t.hostWho, two(t));
    await add(db, t.host, { dishName: "Ramen", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await confirm(t.host);
    const snap = await snapOf(t.host);
    expect(snap.tickets[roundIdOf(snap, 2)].corrections.join("|")).toMatch(/Cancel \d × Sisig/);
    expect(correctionRows(snap)[0].told).toBe(true);
    expect(await kkbQty(t.host, "Sisig")).toBe(1);
    await expectRefused(t.sessionId, () => delCorr(t.sessionId, r.body.data.result.correctionIds[0], t.hostWho), 409, "ROUND_CONFIRMED");
  });

  it("C06 entries from two confirmed rounds in one batch keep their own sourceRoundId (or are refused cleanly)", async () => {
    const t = await sisigTable();
    await open(t.host);
    const e2 = (await add(db, t.host, { dishName: "Sisig", quantity: 2, attribution: { type: "INDIVIDUAL" } })).result.entryId;
    await confirm(t.host);
    await open(t.host);
    const snap = await snapOf(t.host);
    const r = await corr(t.sessionId, t.hostWho, { entries: [{ sourceEntryId: t.hostSisig, quantity: 1 }, { sourceEntryId: e2, quantity: 1 }], type: "QUANTITY" });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
    if (r.status === 201) {
      const rows = await rowsOf(t.sessionId);
      expect(rows.find((c) => c.sourceEntryId === t.hostSisig)!.sourceRoundId).toBe(roundIdOf(snap, 1));
      expect(rows.find((c) => c.sourceEntryId === e2)!.sourceRoundId).toBe(roundIdOf(snap, 2));
    } else expect(await rowsOf(t.sessionId)).toEqual([]);
  });
});

describe("POST /corrections batch: state, caps, validation", () => {
  it("C07 requires an open round -> 409 NO_OPEN_ROUND, nothing written (batch and single)", async () => {
    const t = await sisigTable();
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, two(t)), 409, "NO_OPEN_ROUND");
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { sourceEntryId: t.hostSisig, type: "QUANTITY", quantity: 1 }), 409, "NO_OPEN_ROUND");
  });

  it("C08 each entry is capped at its remaining quantity (pending counts); one bad entry refuses the whole batch", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { entries: [{ sourceEntryId: t.anaSisig, quantity: 1 }, { sourceEntryId: t.hostSisig, quantity: 3 }], type: "QUANTITY" }), 422, "INVALID");
    expect((await corr(t.sessionId, t.hostWho, two(t))).status).toBe(201);
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { entries: [{ sourceEntryId: t.hostSisig, quantity: 2 }, { sourceEntryId: t.katsu, quantity: 1 }], type: "QUANTITY" }), 422, "INVALID");
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { entries: [{ sourceEntryId: t.katsu, quantity: 1 }, { sourceEntryId: t.anaSisig, quantity: 1 }], type: "QUANTITY" }), 409, "ALREADY_CANCELLED");
    expect(cancelledOf(await rowsOf(t.sessionId), t.hostSisig)).toBe(1);
  });

  it("C09 quantity omitted / 0 / negative / fractional / string / null / 100 / bool for QUANTITY -> 422 INVALID", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    for (const quantity of [undefined, 0, -1, 1.5, "1", null, 100, true]) {
      await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { entries: [{ sourceEntryId: t.hostSisig, ...(quantity === undefined ? {} : { quantity }) }], type: "QUANTITY" }), 422, "INVALID");
    }
  });

  it("C10 malformed entries / type / text fields -> 422 INVALID, 400 BAD_JSON, 413 TOO_LARGE", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    const one = { sourceEntryId: t.hostSisig, quantity: 1 };
    const bad: unknown[] = [
      { entries: [], type: "QUANTITY" },
      { entries: [one, one], type: "QUANTITY" },
      { entries: [{ sourceEntryId: "nope", quantity: 1 }], type: "QUANTITY" },
      { entries: "x", type: "QUANTITY" },
      { entries: {}, type: "QUANTITY" },
      { entries: [null], type: "QUANTITY" },
      { entries: Array.from({ length: 101 }, () => ({ sourceEntryId: randomUUID(), quantity: 1 })), type: "QUANTITY" },
      { entries: [one], type: "CANCEL" },
      { entries: [one] },
      { entries: [one], type: "QUANTITY", explanation: "x".repeat(141) },
      { entries: [{ sourceEntryId: t.hostSisig }], type: "REPLACE", replacement: "x".repeat(61) },
      { entries: [one], type: "QUANTITY", explanation: 5 },
      { entries: [one], type: "QUANTITY", explanation: "bad\u0000" },
      [],
      "text",
    ];
    for (const body of bad) await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, body), 422, "INVALID");
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, null, { raw: "{no" }), 400, "BAD_JSON");
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { entries: [one], type: "QUANTITY", explanation: "x".repeat(9000) }), 413, "TOO_LARGE");
  });

  it("C11 unknown, foreign-order, draft-round and removed entries are refused, and a good entry beside them is not applied", async () => {
    const t = await sisigTable();
    const other = await sisigTable();
    await open(t.host);
    const draft = (await add(db, t.host, { dishName: "Pancit", quantity: 2, attribution: { type: "INDIVIDUAL" } })).result.entryId;
    const gone = (await add(db, t.host, { dishName: "Lumpia", quantity: 2, attribution: { type: "INDIVIDUAL" } })).result.entryId;
    await removeDraft(t.host, gone);
    const good = { sourceEntryId: t.hostSisig, quantity: 1 };
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { entries: [good, { sourceEntryId: randomUUID(), quantity: 1 }], type: "QUANTITY" }), 404, "ENTRY_NOT_FOUND");
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { entries: [good, { sourceEntryId: other.hostSisig, quantity: 1 }], type: "QUANTITY" }), 404, "ENTRY_NOT_FOUND");
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { entries: [good, { sourceEntryId: draft, quantity: 1 }], type: "QUANTITY" }), 409, "NOT_CONFIRMED");
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { entries: [good, { sourceEntryId: gone, quantity: 1 }], type: "QUANTITY" }), [404, 409]);
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { sourceEntryId: other.hostSisig, type: "QUANTITY", quantity: 1 }), 404, "ENTRY_NOT_FOUND");
    expect(await rowsOf(other.sessionId)).toEqual([]);
  });

  it("C12 the 100-correction cap is all-or-nothing: 99 + a batch of 2 writes none; the 100th fits; the 101st is refused", async () => {
    const t = await riceTable(102);
    const all = t.entryIds.map((id) => ({ sourceEntryId: id, quantity: 1 }));
    expect((await corr(t.sessionId, t.hostWho, { entries: all.slice(0, 99), type: "QUANTITY" })).status).toBe(201);
    expect((await rowsOf(t.sessionId)).length).toBe(99);
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { entries: all.slice(99, 101), type: "QUANTITY" }), 422, "TOO_MANY_CORRECTIONS");
    expect((await corr(t.sessionId, t.hostWho, { entries: all.slice(99, 100), type: "QUANTITY" })).status).toBe(201);
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { sourceEntryId: t.entryIds[100], type: "QUANTITY", quantity: 1 }), 422, "TOO_MANY_CORRECTIONS");
    expect((await rowsOf(t.sessionId)).length).toBe(100);
  }, 60_000);

  it("C13 two 60-row batches racing for the cap: exactly one lands, never more than 100 rows", async () => {
    const t = await riceTable(120);
    const all = t.entryIds.map((id) => ({ sourceEntryId: id, quantity: 1 }));
    const rs = await Promise.all([corr(t.sessionId, t.hostWho, { entries: all.slice(0, 60), type: "QUANTITY" }), corr(t.sessionId, t.hostWho, { entries: all.slice(60, 120), type: "QUANTITY" })]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(rs.find((r) => r.status === 422)!.body.error.code).toBe("TOO_MANY_CORRECTIONS");
    expect((await rowsOf(t.sessionId)).length).toBe(60);
  }, 60_000);

  it("C14 at the cap, 'Mark unavailable' never writes past 100 rows and never a partial group (docs/security.md: 100 corrections per order)", async () => {
    const t = await riceTable(110);
    const all = t.entryIds.map((id) => ({ sourceEntryId: id, quantity: 1 }));
    expect((await corr(t.sessionId, t.hostWho, { entries: all.slice(0, 100), type: "QUANTITY" })).status).toBe(201);
    const before = await fingerprint(t.sessionId);
    const r = await unav(t.sessionId, t.riceId, t.hostWho);
        expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
    if (r.status === 200) expect((await rowsOf(t.sessionId)).length, "more than 100 corrections in one order").toBeLessThanOrEqual(100);
    else expect(await fingerprint(t.sessionId)).toBe(before);
  }, 60_000);
});

describe("POST /corrections batch: removing, idempotency, who may call", () => {
  it("C15 removing one row of a batch removes the whole group (one event); a single row removes just itself", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    const b = await corr(t.sessionId, t.hostWho, two(t));
    const single = await corr(t.sessionId, t.hostWho, { sourceEntryId: t.katsu, type: "QUANTITY", quantity: 1 });
    const r = await delCorr(t.sessionId, b.body.data.result.correctionIds[1], t.hostWho);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await rowsOf(t.sessionId)).map((c) => c.id)).toEqual([single.body.data.result.correctionId]);
    expect((await eventTypes(t.sessionId)).slice(-1)).toEqual(["correction.removed"]);
    expect((await delCorr(t.sessionId, single.body.data.result.correctionId, t.hostWho)).status).toBe(200);
    expect(await rowsOf(t.sessionId)).toEqual([]);
    expect(await kkbQty(t.host, "Sisig")).toBe(3);
  });

  it("C16 DELETE: unknown / non-uuid / another order's correction -> 404 CORRECTION_NOT_FOUND; guest 403; strangers 404", async () => {
    const t = await sisigTable();
    const o = await sisigTable();
    await withOpenRound(t);
    await open(o.host);
    const mine = await corr(t.sessionId, t.hostWho, { sourceEntryId: t.katsu, type: "QUANTITY", quantity: 1 });
    const theirs = await corr(o.sessionId, o.hostWho, { sourceEntryId: o.katsu, type: "QUANTITY", quantity: 1 });
    const myId = mine.body.data.result.correctionId;
    await expectRefused(t.sessionId, () => delCorr(t.sessionId, randomUUID(), t.hostWho), 404, "CORRECTION_NOT_FOUND");
    await expectRefused(t.sessionId, () => delCorr(t.sessionId, "zzz", t.hostWho), 404, "CORRECTION_NOT_FOUND");
    await expectRefused(t.sessionId, () => delCorr(t.sessionId, theirs.body.data.result.correctionId, t.hostWho), 404, "CORRECTION_NOT_FOUND");
    await expectRefused(t.sessionId, () => delCorr(t.sessionId, myId, t.anaWho), 403, "FORBIDDEN");
    await expectRefused(t.sessionId, () => delCorr(t.sessionId, myId, null), 404, "NOT_FOUND");
    await expectRefused(t.sessionId, () => delCorr(t.sessionId, myId, o.hostWho), 404, "NOT_FOUND");
    expect((await rowsOf(o.sessionId)).length).toBe(1);
  });

  it("C17 same key replayed: applied once, replayed: true, same ids", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    const idem = key();
    const a = await corr(t.sessionId, t.hostWho, two(t), { idem });
    const fp = await fingerprint(t.sessionId);
    const b = await corr(t.sessionId, t.hostWho, two(t), { idem });
    expect(b.status).toBe(201);
    expect(b.body.data.replayed).toBe(true);
    expect(b.body.data.result).toEqual(a.body.data.result);
    expect(await fingerprint(t.sessionId)).toBe(fp);
  });

  it("C18 the same key twice at once is applied once", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    const idem = key();
    const r0 = await rev(t.sessionId);
    const rs = await Promise.all([corr(t.sessionId, t.hostWho, two(t, 2), { idem }), corr(t.sessionId, t.hostWho, two(t, 2), { idem })]);
    expect(rs.map((r) => r.status)).toEqual([201, 201]);
    expect(rs.filter((r) => r.body.data.replayed)).toHaveLength(1);
    expect(await rev(t.sessionId)).toBe(r0 + 1);
    expect(await rowsOf(t.sessionId)).toHaveLength(2);
  });

  it("C19 two batches racing for the same quantity: only as much as was ordered is cancelled", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    const rs = await Promise.all([corr(t.sessionId, t.hostWho, two(t, 2)), corr(t.sessionId, t.hostWho, two(t, 2))]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    const rows = await rowsOf(t.sessionId);
    expect(cancelledOf(rows, t.hostSisig)).toBe(2);
    expect(cancelledOf(rows, t.anaSisig)).toBe(1);
  });

  it("C20 guest -> 403; no cookie / garbage / other order's host -> 404; removed guest refused; nothing changes", async () => {
    const t = await sisigTable();
    const o = await sisigTable();
    await withOpenRound(t);
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.anaWho, two(t)), 403, "FORBIDDEN");
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.anaWho, { sourceEntryId: t.anaSisig, type: "QUANTITY", quantity: 1 }), 403, "FORBIDDEN");
    await expectRefused(t.sessionId, () => corr(t.sessionId, null, two(t)), 404, "NOT_FOUND");
    await expectRefused(t.sessionId, () => corr(t.sessionId, { token: "garbage" }, two(t)), 404, "NOT_FOUND");
    await expectRefused(t.sessionId, () => corr(t.sessionId, o.hostWho, two(t)), 404, "NOT_FOUND");
    await run(t.host, (tx, s) => removeParticipant(tx, s, t.host, t.ana.actor.participantId, null));
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.anaWho, two(t)), [403, 404]);
  });

  it("C21 Origin: a POST to /corrections without or with a foreign Origin is refused 403 FORBIDDEN_ORIGIN", async () => {
    const mk = (origin?: string) => new NextRequest("http://localhost:3000/api/sessions/x/corrections", { method: "POST", headers: origin ? { origin } : {} });
    for (const origin of [undefined, "https://evil.example"]) {
      const res = proxy(mk(origin));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN_ORIGIN");
    }
  });

  it("C22 a closed order -> 409 SESSION_CLOSED, for POST and for DELETE of a pending correction", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    const c = await corr(t.sessionId, t.hostWho, { sourceEntryId: t.katsu, type: "QUANTITY", quantity: 1 });
    await run(t.host, (tx, s) => closeSession(tx, s, t.host));
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, two(t)), 409, "SESSION_CLOSED");
    await expectRefused(t.sessionId, () => delCorr(t.sessionId, c.body.data.result.correctionId, t.hostWho), 409, "SESSION_CLOSED");
  });

  it("C23 retention: deleting the order deletes batch rows", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    await corr(t.sessionId, t.hostWho, two(t));
    await db.execute(sql`DELETE FROM sessions WHERE id = ${t.sessionId}`);
    expect(await rowsOf(t.sessionId)).toEqual([]);
  });

  it("C24 a batch rings the realtime bell within 15 s", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    let got: (v: string) => void = () => undefined;
    const heard = new Promise<string>((res) => (got = res));
    const sub = await db.$client.listen("salo_events", (payload) => {
      if (payload.includes(t.sessionId)) got(payload);
    });
    try {
      const [msg] = await within(Promise.all([heard, corr(t.sessionId, t.hostWho, two(t))]), "notify after batch");
      expect(msg).toContain(t.sessionId);
    } finally {
      await sub.unlisten();
    }
  });

  it("C25 more than 120 changes a minute -> 429 RATE_LIMITED", async () => {
    const t = await sisigTable();
    let limited: Res | null = null;
    for (let i = 0; i < 130 && !limited; i++) {
      const r = await corr(t.sessionId, t.hostWho, { entries: [{ sourceEntryId: randomUUID(), quantity: 1 }], type: "QUANTITY" });
      if (r.status === 429) limited = r;
    }
    expect(limited?.status).toBe(429);
    expect(limited?.body.error?.code).toBe("RATE_LIMITED");
  });
});

describe("extra probes: groups, adds, replace after cancel", () => {
  it("X01 a pending batch that spans two dishes loses only the unavailable dish's row; the other row stays removable", async () => {
    const t = await sisigTable();
    await withOpenRound(t);
    const b = await corr(t.sessionId, t.hostWho, { entries: [{ sourceEntryId: t.hostSisig, quantity: 1 }, { sourceEntryId: t.katsu, quantity: 1 }], type: "QUANTITY" });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    const katsuRows = (await rowsOf(t.sessionId)).filter((c) => c.sourceEntryId === t.katsu);
    expect(katsuRows).toHaveLength(1);
    expect((await delCorr(t.sessionId, katsuRows[0].id, t.hostWho)).status).toBe(200);
    expect((await rowsOf(t.sessionId)).filter((c) => c.sourceEntryId === t.katsu)).toEqual([]);
    expect(told(await rowsOf(t.sessionId))).toHaveLength(2);
  });

  it("X02 a guest adding the dish while the host marks it unavailable: no 5xx, no entry exceeds what billing and the ticket show", async () => {
    const t = await sisigTable();
    await open(t.host);
    const [u, a] = await Promise.all([unav(t.sessionId, t.sisigId, t.hostWho), add(db, t.ana.actor, { dishName: "Sisig", quantity: 2, attribution: { type: "INDIVIDUAL" } }).then(() => "ok", (e: { status?: number }) => `err${e.status}`)]);
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    expect(["ok"].includes(a) || String(a).startsWith("err4")).toBe(true);
    const rows = await rowsOf(t.sessionId);
    expect(cancelledOf(rows, t.hostSisig)).toBe(2);
    expect(cancelledOf(rows, t.anaSisig)).toBe(1);
  });

  it("X03 a REPLACE batch aimed at an entry whose whole quantity was already told-cancelled is refused (nothing left to replace)", async () => {
    const t = await sisigTable();
    expect((await unav(t.sessionId, t.sisigId, t.hostWho)).status).toBe(200);
    await open(t.host);
    await expectRefused(t.sessionId, () => corr(t.sessionId, t.hostWho, { entries: [{ sourceEntryId: t.hostSisig }], type: "REPLACE", replacement: "Adobo" }), [409, 422]);
  });
});

// =====================================================================================================
// Invariants under a seeded random sequence
// =====================================================================================================
describe("invariants: random sequences of unavailable / batch / single corrections / rounds", () => {
  it("F01 no over-cancelled quantity, at most two told UNAVAILABLE rows per entry (a cancel and a swap), confirmed snapshots never move (60 steps)", async () => {
    let seed = 12345;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    const t = await sisigTable();
    const names = ["Sisig", "Katsu", "Ramen", "Adobo"];
    const frozen = new Map<string, string>();
    const check = async () => {
      const rows = await rowsOf(t.sessionId);
      const snap = await snapOf(t.host);
      for (const e of snap.entries) expect(cancelledOf(rows, e.id), `entry ${e.id} over-cancelled`).toBeLessThanOrEqual(e.quantity);
      expect(rows.filter((r) => r.correctionType === "QUANTITY").every((r) => (r.quantityDelta ?? 0) < 0)).toBe(true);
      const perEntry = new Map<string, number>();
      for (const r of told(rows)) perEntry.set(r.sourceEntryId!, (perEntry.get(r.sourceEntryId!) ?? 0) + 1);
      expect([...perEntry.values()].every((n) => n <= 2), "an entry got more than a cancel and a swap").toBe(true);
      for (const s of buildKkb(snap, t.host.participantId).sections) for (const l of [...s.lines, ...s.drafts]) expect(l.quantity).toBeGreaterThanOrEqual(0);
      (await snapshotTexts(t.sessionId)).forEach((txt, i) => {
        if (frozen.has(String(i))) expect(txt, "a confirmed snapshot changed").toBe(frozen.get(String(i)));
        else frozen.set(String(i), txt);
      });
    };
    for (let step = 0; step < 60; step++) {
      const snap = await snapOf(t.host);
      const draft = snap.rounds.find((r) => r.status === "DRAFT");
      const confirmed = snap.entries.filter((e) => snap.rounds.find((r) => r.id === e.roundId)?.status === "CONFIRMED");
      const op = rnd(6);
      let res: Res | null = null;
      if (op === 0 && draft) await add(db, t.host, { dishName: names[rnd(4)], quantity: 1 + rnd(3), attribution: { type: "INDIVIDUAL" } });
      else if (op === 1 && draft && snap.entries.some((e) => e.roundId === draft.id)) await confirm(t.host);
      else if (op === 2 && !draft) await open(t.host);
      else if (op === 3 && snap.entries.length) res = await unav(t.sessionId, rnd(5) === 0 ? randomUUID() : snap.entries[rnd(snap.entries.length)].dishId, t.hostWho, rnd(3) === 0 ? { replacement: "Special" } : {});
      else if (op === 4 && confirmed.length) {
        const picked = [...new Set([0, 1, 2].map(() => confirmed[rnd(confirmed.length)].id))];
        res = await corr(t.sessionId, t.hostWho, { entries: picked.map((id) => ({ sourceEntryId: id, quantity: 1 + rnd(3) })), type: "QUANTITY" });
      } else if (op === 5 && confirmed.length) {
        res = await corr(t.sessionId, t.hostWho, { sourceEntryId: confirmed[rnd(confirmed.length)].id, type: rnd(2) ? "REPLACE" : "QUANTITY", quantity: 1 + rnd(2), replacement: "Other" });
      }
      if (res) expect(res.status, JSON.stringify(res.body)).toBeLessThan(500);
      await check();
    }
  }, 120_000);
});
