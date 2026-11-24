/**
 * Independent golden-contract suite for v1.4 slice 4 (extra receipts F05, equal shared-dish splits F06), derived from
 * docs/plans/salo-v1-4.md "Slice 4" and docs/plans/salo-v1-4-brief.md F05/F06, not from the implementation.
 * Tables: docs/contracts/slice4-golden.md. Real route handlers, real Postgres (salo_test), per-request cookie jar.
 * Run: perl -e 'alarm shift; exec @ARGV' 420 pnpm vitest run tests/contract-slice4-golden.test.ts   (exit 142 = FAIL)
 * Every scenario has a 15 s deadline; every refusal also asserts a before/after fingerprint of the rows it must not touch.
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

import { PUT as ADJUSTMENT } from "@/app/api/sessions/[id]/adjustments/[adjustmentId]/route";
import { POST as APPROVE } from "@/app/api/sessions/[id]/claims/[claimId]/approve/route";
import { POST as CLAIM } from "@/app/api/sessions/[id]/claims/route";
import { PUT as CORRECTION_PRICE } from "@/app/api/sessions/[id]/corrections/[correctionId]/price/route";
import { PUT as SETTLE } from "@/app/api/sessions/[id]/entries/[entryId]/settlement/route";
import { PUT as RECEIPT_TOTAL } from "@/app/api/sessions/[id]/receipt-total/route";
import { DELETE, PUT } from "@/app/api/sessions/[id]/receipts/[receiptId]/route";
import { PUT as SERVICE_CHARGE } from "@/app/api/sessions/[id]/service-charge/route";
import { GET as SYNC } from "@/app/api/sessions/[id]/sync/route";
import { buildKkb, kkbText, priceCompleteness, type Kkb, type KkbInput } from "@/lib/kkb";
import { reconcileReceipts } from "@/lib/receipts";
import type { Actor } from "@/lib/permissions";
import { credentialCookieName, hashToken, newToken } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { orderEntries, participantCredentials, participants } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { removeParticipant } from "@/server/orders/people";
import { closeSession, confirmRound, openRound, recordCorrection } from "@/server/orders/rounds";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, key, newSession } from "./helpers/session";

vi.setConfig({ testTimeout: 15_000 });
const db = testDb();
beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.$client.end();
  await getDb().$client.end();
});

type Who = { actor: Actor; token: string };
/** Parsed JSON bodies are untyped on purpose: the contract is what the wire carries. */
type Json = ReturnType<typeof JSON.parse>;
type Res = { status: number; code?: string; data: Json; json: Json };
type Route = (r: Request, c: { params: Promise<Json> }) => Promise<Response>;

async function call(route: unknown, method: string, sid: string, params: Record<string, string>, who: Who | null, body?: unknown, o: { idem?: string | null; raw?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost:3000" };
  const idem = o.idem === undefined ? key() : o.idem;
  if (idem !== null) headers["idempotency-key"] = idem;
  const req = new Request("http://localhost:3000/api/x", { method, headers, body: method === "GET" ? undefined : (o.raw ?? JSON.stringify(body)) });
  const jar = who ? { [credentialCookieName(sid)]: who.token } : {};
  const res = await als.store.run(jar, () => (route as Route)(req, { params: Promise.resolve({ id: sid, ...params }) }));
  const json = await res.json();
  return { status: res.status, code: json.error?.code, data: json.data, json };
}

async function guest(sid: string, name: string): Promise<Who> {
  const token = newToken();
  const [row] = await db.insert(participants).values({ sessionId: sid, displayName: name, role: "GUEST" }).returning();
  await db.insert(participantCredentials).values({ sessionId: sid, participantId: row.id, credentialType: "GUEST", credentialHash: hashToken(token) });
  return { actor: { participantId: row.id, sessionId: sid, role: "GUEST", displayName: name }, token };
}
const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3]) => runMutation(db, actor, { idempotencyKey: key(), type: "t" }, apply);

/** Host (Sisig), Ana (Rice), Bo (Katsu), Cy (nothing) and a shared Crispy Pata, all still in round 1. */
async function scene() {
  const s = await newSession(db);
  const host: Who = { actor: s.host, token: s.token };
  const ana = await guest(s.sessionId, "Ana");
  const bo = await guest(s.sessionId, "Bo");
  const cy = await guest(s.sessionId, "Cy");
  const sisig = await add(db, host.actor, { dishName: "Sisig", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  const rice = await add(db, ana.actor, { dishName: "Rice", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  const katsu = await add(db, bo.actor, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL" } });
  const pata = await add(db, host.actor, { dishName: "Crispy Pata", quantity: 1, attribution: { type: "TABLE" } });
  return { sid: s.sessionId, host, ana, bo, cy, sisig: sisig.result.entryId as string, rice: rice.result.entryId as string, katsu: katsu.result.entryId as string, pata: pata.result.entryId as string };
}
type T = Awaited<ReturnType<typeof scene>>;
type Mini = { sid: string; host: Who; ana: Who; bo: Who; cy?: Who };

const confirm = async (t: Mini) => {
  const snap = await getSnapshot(db, t.host.actor);
  await run(t.host.actor, (tx, s) => confirmRound(tx, s, t.host.actor, snap.activeRoundId, snap.session.revision));
};
const end = (t: Mini) => run(t.host.actor, (tx, s) => closeSession(tx, s, t.host.actor));
const sync = async (t: Mini, who: Who = t.host): Promise<Json> => (await call(SYNC, "GET", t.sid, {}, who)).data;
const id = () => randomUUID();
const ref = (w: Who) => ({ participantId: w.actor.participantId });
const lbl = (label: string) => ({ label });
const count = async (q: ReturnType<typeof sql>) => Number(((await db.execute(q)) as unknown as { n: string }[])[0].n);

const rcpt = (t: Mini, rid: string, who: Who | null, body: unknown, o?: { idem?: string | null; raw?: string }) => call(PUT, "PUT", t.sid, { receiptId: rid }, who, body, o);
const rdel = (t: Mini, rid: string, who: Who | null, body: unknown, o?: { idem?: string | null }) => call(DELETE, "DELETE", t.sid, { receiptId: rid }, who, body, o);
const settle = (t: Mini, entryId: string, who: Who | null, body: unknown, o?: { idem?: string | null }) => call(SETTLE, "PUT", t.sid, { entryId }, who, body, o);
const rbody = (people: unknown[], over: Record<string, unknown> = {}) => ({ expectedRevision: 0, label: "Senior citizen receipt", totalCentavos: 51300, people, ...over });
const stored = async (t: Mini, entryId: string): Promise<number> => (await sync(t)).settlement.entries[entryId]?.revision ?? 0;
const split = async (t: Mini, entryId: string, people: unknown[], over: Record<string, unknown> = {}) => settle(t, entryId, t.host, { expectedRevision: await stored(t, entryId), splitAmong: people, ...over });
const price = async (t: Mini, entryId: string, centavos: number | null) => settle(t, entryId, t.host, { expectedRevision: await stored(t, entryId), unitPriceCentavos: centavos });
const serviceCharge = (t: Mini, centavos: number) => call(SERVICE_CHARGE, "PUT", t.sid, {}, t.host, { expectedRevision: 0, centavos });
const adjust = (t: Mini, body: Record<string, unknown>) => call(ADJUSTMENT, "PUT", t.sid, { adjustmentId: id() }, t.host, { expectedRevision: 0, note: null, ...body });

/** Everything a refused call must leave alone: revision, events, mutation records, receipts, people, payers, settlements. */
async function fp(t: Mini) {
  const rows = (await db.execute(sql`SELECT
    (SELECT revision FROM sessions WHERE id = ${t.sid}) AS rev,
    (SELECT count(*) FROM session_events WHERE session_id = ${t.sid}) AS ev,
    (SELECT count(*) FROM mutation_records WHERE session_id = ${t.sid}) AS mr,
    (SELECT coalesce(json_agg(r ORDER BY r.id), '[]'::json) FROM receipts r WHERE r.session_id = ${t.sid}) AS r,
    (SELECT coalesce(json_agg(p ORDER BY p.id), '[]'::json) FROM receipt_people p WHERE p.session_id = ${t.sid}) AS rp,
    (SELECT coalesce(json_agg(e ORDER BY e.id), '[]'::json) FROM entry_payers e WHERE e.session_id = ${t.sid}) AS ep,
    (SELECT coalesce(json_agg(s ORDER BY s.entry_id), '[]'::json) FROM entry_settlements s WHERE s.session_id = ${t.sid}) AS es`)) as unknown as Record<string, unknown>[];
  return JSON.stringify(rows[0]);
}
async function refused(t: Mini, status: number, code: string | undefined, fn: () => Promise<Res>) {
  const before = await fp(t);
  const res = await fn();
  expect([res.status, code ? res.code : undefined]).toEqual([status, code]);
  expect(await fp(t)).toBe(before);
  return res;
}

const kkbOf = (snap: Json, meId: string): Kkb => buildKkb(snap as unknown as KkbInput, meId);
const card = (k: Kkb, key: string) => k.sections.find((s) => s.key === key);
const pk = (w: Who) => `p:${w.actor.participantId}`;
const shareOn = (k: Kkb, cardKey: string, entryId: string) => card(k, cardKey)?.lines.find((l) => l.entryId === entryId && !l.billedTo);
const centsOf = (k: Kkb, entryId: string) => k.sections.flatMap((s) => s.lines).filter((l) => l.entryId === entryId && !l.billedTo).map((l) => l.subtotalCentavos);
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
const blockersOf = (k: Kkb) => (k.charge.state === "blocked" ? k.charge.blockers : []);

// ---------------------------------------------------------------------------------------------------------------------
describe("PUT /receipts/:receiptId (create / replace)", () => {
  it("RC01 host creates: 200 {receiptId, revision 1}; snapshot, row, event, session revision", async () => {
    const t = await scene();
    const before = await fp(t);
    const rid = id();
    const res = await rcpt(t, rid, t.host, rbody([ref(t.ana), lbl("Lola")]));
    expect([res.status, res.data.result, res.data.replayed]).toEqual([200, { receiptId: rid, revision: 1 }, false]);
    expect(await fp(t)).not.toBe(before);
    const snap = await sync(t, t.bo);
    expect(snap.settlement.receipts).toEqual([{ id: rid, label: "Senior citizen receipt", totalCentavos: 51300, people: expect.any(Array), revision: 1 }]);
    expect(snap.settlement.receipts[0].people).toHaveLength(2);
    expect(snap.settlement.receipts[0].people).toEqual(expect.arrayContaining([{ participantId: t.ana.actor.participantId, label: null }, { participantId: null, label: "Lola" }]));
    const ev = (await db.execute(sql`SELECT event_type, payload FROM session_events WHERE session_id = ${t.sid} ORDER BY id DESC LIMIT 1`)) as unknown as { event_type: string; payload: Json }[];
    expect(ev[0].event_type).toBe("receipt.set");
    expect(ev[0].payload.receiptId).toBe(rid);
  });

  it("RC02 optional label and nullable total; total bounds 0 .. 99999999", async () => {
    const t = await scene();
    expect((await rcpt(t, id(), t.host, { expectedRevision: 0, totalCentavos: null, people: [ref(t.ana)] })).status).toBe(200);
    expect((await sync(t)).settlement.receipts[0]).toMatchObject({ label: null, totalCentavos: null });
    expect((await rcpt(t, id(), t.host, { expectedRevision: 0, label: null, totalCentavos: 0, people: [lbl("Z")] })).status).toBe(200);
    expect((await rcpt(t, id(), t.host, { expectedRevision: 0, totalCentavos: 99999999, people: [lbl("Y")] })).status).toBe(200);
    await refused(t, 422, "INVALID", () => rcpt(t, id(), t.host, { expectedRevision: 0, totalCentavos: 100000000, people: [lbl("X")] }));
  });

  it("RC03 label is tidied, at most 40 characters, blank means none", async () => {
    const t = await scene();
    await rcpt(t, id(), t.host, rbody([ref(t.ana)], { label: "  Senior   citizen  " }));
    expect((await sync(t)).settlement.receipts[0].label).toBe("Senior citizen");
    expect((await rcpt(t, id(), t.host, rbody([ref(t.bo)], { label: "x".repeat(40) }))).status).toBe(200);
    await refused(t, 422, "INVALID", () => rcpt(t, id(), t.host, rbody([ref(t.cy!)], { label: "x".repeat(41) })));
    expect((await rcpt(t, id(), t.host, rbody([lbl("Lola")], { label: "   " }))).status).toBe(200);
    expect((await sync(t)).settlement.receipts.at(-1).label).toBeNull();
  });

  it("RC04 malformed input is 422 / 400 and changes nothing", async () => {
    const t = await scene();
    const ok = { expectedRevision: 0, label: "L", totalCentavos: 100, people: [ref(t.ana)] };
    const bad: [string, unknown][] = [
      ["no people", { ...ok, people: [] }],
      ["people missing", { expectedRevision: 0, totalCentavos: 1 }],
      ["people not an array", { ...ok, people: "Ana" }],
      ["negative total", { ...ok, totalCentavos: -1 }],
      ["fractional total", { ...ok, totalCentavos: 1.5 }],
      ["string total", { ...ok, totalCentavos: "100" }],
      ["total missing", { expectedRevision: 0, people: [ref(t.ana)] }],
      ["negative revision", { ...ok, expectedRevision: -1 }],
      ["revision missing", { totalCentavos: 1, people: [ref(t.ana)] }],
      ["string revision", { ...ok, expectedRevision: "0" }],
      ["numeric label", { ...ok, label: 5 }],
      ["empty person", { ...ok, people: [{}] }],
      ["non-uuid participant", { ...ok, people: [{ participantId: "nope" }] }],
      ["empty typed name", { ...ok, people: [{ label: "" }] }],
      ["a group is not a person", { ...ok, people: [{ groupId: id() }] }],
      ["whole table is not a person", { ...ok, people: [{ table: true }] }],
      ["31 people", { ...ok, people: Array.from({ length: 31 }, (_, i) => lbl(`P${i}`)) }],
      ["array body", [ok]],
    ];
    for (const [name, body] of bad) {
      const res = await refused(t, 422, "INVALID", () => rcpt(t, id(), t.host, body));
      expect(res.json.error.message, name).toBeTruthy();
    }
    await refused(t, 400, "BAD_JSON", () => rcpt(t, id(), t.host, null, { raw: "{not json" }));
  });

  it("RC05 auth: no cookie 404, guest 403, co-host 403, removed guest 403, other order's host 404, bad key 400", async () => {
    const t = await scene();
    const other = await scene();
    await db.execute(sql`UPDATE participants SET cohost_at = now() WHERE id = ${t.cy!.actor.participantId}`);
    const b = rbody([ref(t.ana)]);
    await refused(t, 404, undefined, () => rcpt(t, id(), null, b));
    await refused(t, 403, "FORBIDDEN", () => rcpt(t, id(), t.ana, b));
    await refused(t, 403, "FORBIDDEN", () => rcpt(t, id(), t.cy!, b));
    await refused(t, 404, undefined, () => rcpt(t, id(), other.host, b));
    await refused(t, 400, "IDEMPOTENCY_KEY", () => rcpt(t, id(), t.host, b, { idem: null }));
    await refused(t, 400, "IDEMPOTENCY_KEY", () => rcpt(t, id(), t.host, b, { idem: "x" }));
    await run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.bo.actor.participantId, null));
    await refused(t, 403, "REMOVED", () => rcpt(t, id(), t.bo, b));
  });

  it("RC06 revisions: >0 on missing 404 RECEIPT_NOT_FOUND, 0 on existing 409, replace bumps by one, stale replace 409", async () => {
    const t = await scene();
    const rid = id();
    await refused(t, 404, "RECEIPT_NOT_FOUND", () => rcpt(t, id(), t.host, rbody([ref(t.ana)], { expectedRevision: 1 })));
    expect((await rcpt(t, rid, t.host, rbody([ref(t.ana)]))).status).toBe(200);
    await refused(t, 409, undefined, () => rcpt(t, rid, t.host, rbody([ref(t.ana)])));
    const up = await rcpt(t, rid, t.host, rbody([ref(t.ana), ref(t.bo)], { expectedRevision: 1, totalCentavos: 9900, label: null }));
    expect([up.status, up.data.result]).toEqual([200, { receiptId: rid, revision: 2 }]);
    expect((await sync(t)).settlement.receipts[0]).toMatchObject({ revision: 2, label: null, totalCentavos: 9900 });
    expect((await sync(t)).settlement.receipts[0].people).toHaveLength(2);
    await refused(t, 409, undefined, () => rcpt(t, rid, t.host, rbody([ref(t.cy!)], { expectedRevision: 1 })));
  });

  it("RC07 a person is on one extra receipt: 409 ALREADY_ON_RECEIPT (id and typed name, create and edit), nothing half-applied", async () => {
    const t = await scene();
    const r1 = id();
    await rcpt(t, r1, t.host, rbody([ref(t.ana), lbl("Lola")]));
    await refused(t, 409, "ALREADY_ON_RECEIPT", () => rcpt(t, id(), t.host, rbody([ref(t.bo), ref(t.ana)])));
    await refused(t, 409, "ALREADY_ON_RECEIPT", () => rcpt(t, id(), t.host, rbody([lbl("  LOLA ")])));
    const r2 = id();
    await rcpt(t, r2, t.host, rbody([ref(t.bo)]));
    await refused(t, 409, "ALREADY_ON_RECEIPT", () => rcpt(t, r2, t.host, rbody([ref(t.bo), ref(t.ana)], { expectedRevision: 1 })));
    expect((await rcpt(t, r1, t.host, rbody([ref(t.ana), lbl("Lola")], { expectedRevision: 1, totalCentavos: 1 }))).status).toBe(200);
    expect((await sync(t)).settlement.receipts).toHaveLength(2);
  });

  it("RC08 the same person twice in one receipt is 422 (id, typed name case, NFKC / spacing)", async () => {
    const t = await scene();
    await refused(t, 422, "INVALID", () => rcpt(t, id(), t.host, rbody([ref(t.ana), ref(t.ana)])));
    await refused(t, 422, "INVALID", () => rcpt(t, id(), t.host, rbody([lbl("Lola"), lbl("lola")])));
    await refused(t, 422, "INVALID", () => rcpt(t, id(), t.host, rbody([lbl("Ana  B"), lbl(" ana b")])));
    await refused(t, 422, "INVALID", () => rcpt(t, id(), t.host, rbody([lbl("Ana"), lbl("Ａna")])));
  });

  it("RC09 newly added left / unknown / foreign person is 404 PERSON_NOT_FOUND; a stored left person may stay", async () => {
    const t = await scene();
    const other = await scene();
    await run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.cy!.actor.participantId, null));
    await refused(t, 404, "PERSON_NOT_FOUND", () => rcpt(t, id(), t.host, rbody([ref(t.cy!)])));
    await refused(t, 404, "PERSON_NOT_FOUND", () => rcpt(t, id(), t.host, rbody([{ participantId: id() }])));
    await refused(t, 404, "PERSON_NOT_FOUND", () => rcpt(t, id(), t.host, rbody([ref(other.ana)])));
    const rid = id();
    await rcpt(t, rid, t.host, rbody([ref(t.bo), ref(t.ana)]));
    await run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.bo.actor.participantId, null));
    const edit = await rcpt(t, rid, t.host, rbody([ref(t.bo), ref(t.ana)], { expectedRevision: 1, totalCentavos: 5 }));
    expect(edit.status).toBe(200);
    expect((await sync(t)).settlement.receipts[0].people.map((p: Json) => p.participantId).sort()).toEqual([t.ana.actor.participantId, t.bo.actor.participantId].sort());
  });

  it("RC10 limit 10: ten ok, eleventh 400 TOO_MANY_RECEIPTS; editing at the limit ok; a delete frees a slot; other orders unaffected", async () => {
    const t = await scene();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(id());
      expect((await rcpt(t, ids[i], t.host, rbody([lbl(`Guest ${i}`)]))).status).toBe(200);
    }
    await refused(t, 400, "TOO_MANY_RECEIPTS", () => rcpt(t, id(), t.host, rbody([lbl("Extra")])));
    expect((await rcpt(t, ids[0], t.host, rbody([lbl("Guest 0")], { expectedRevision: 1, totalCentavos: 7 }))).status).toBe(200);
    expect((await rdel(t, ids[1], t.host, { expectedRevision: 1 })).status).toBe(200);
    expect((await rcpt(t, id(), t.host, rbody([lbl("Extra")]))).status).toBe(200);
    const o = await scene();
    expect((await rcpt(o, id(), o.host, rbody([lbl("Q")]))).status).toBe(200);
  });

  it("RC11 replay: same key and body applies once; same key for another receipt is 422 IDEMPOTENCY_KEY_REUSED", async () => {
    const t = await scene();
    const rid = id();
    const idem = key();
    const first = await rcpt(t, rid, t.host, rbody([ref(t.ana)]), { idem });
    const again = await rcpt(t, rid, t.host, rbody([ref(t.ana)]), { idem });
    expect([first.data.replayed, again.data.replayed, again.data.result]).toEqual([false, true, { receiptId: rid, revision: 1 }]);
    expect(await count(sql`SELECT count(*) AS n FROM receipts WHERE session_id = ${t.sid}`)).toBe(1);
    expect(await count(sql`SELECT count(*) AS n FROM session_events WHERE session_id = ${t.sid} AND event_type = 'receipt.set'`)).toBe(1);
    await refused(t, 422, "IDEMPOTENCY_KEY_REUSED", () => rcpt(t, id(), t.host, rbody([ref(t.bo)]), { idem }));
  });

  it("RC12 ended order accepts create / edit / delete; a cancelled order (nothing ever confirmed) is 409 SESSION_CLOSED", async () => {
    const t = await scene();
    const rid = id();
    await rcpt(t, rid, t.host, rbody([ref(t.ana)]));
    await confirm(t);
    await end(t);
    expect((await rcpt(t, id(), t.host, rbody([ref(t.bo)]))).status).toBe(200);
    expect((await rcpt(t, rid, t.host, rbody([ref(t.ana)], { expectedRevision: 1, totalCentavos: 2 }))).status).toBe(200);
    expect((await rdel(t, rid, t.host, { expectedRevision: 2 })).status).toBe(200);
    await refused(t, 403, "FORBIDDEN", () => rcpt(t, id(), t.ana, rbody([ref(t.cy!)])));
    const c = await scene();
    const cid = id();
    await rcpt(c, cid, c.host, rbody([ref(c.ana)]));
    await end(c);
    await refused(c, 409, "SESSION_CLOSED", () => rcpt(c, id(), c.host, rbody([ref(c.bo)])));
    await refused(c, 409, "SESSION_CLOSED", () => rcpt(c, cid, c.host, rbody([ref(c.ana)], { expectedRevision: 1 })));
    await refused(c, 409, "SESSION_CLOSED", () => rdel(c, cid, c.host, { expectedRevision: 1 }));
  });

  it("RC13 events keep Confirm fresh and snapshot order follows creation", async () => {
    const t = await scene();
    const seen = (await sync(t)).session.revision;
    const ids = [id(), id(), id()];
    for (const [i, rid] of ids.entries()) await rcpt(t, rid, t.host, rbody([lbl(`N${i}`)], { label: `R${i}` }));
    const snap = await sync(t);
    expect(snap.settlement.receipts.map((r: Json) => r.id)).toEqual(ids);
    await expect(run(t.host.actor, (tx, s) => confirmRound(tx, s, t.host.actor, snap.activeRoundId, seen))).resolves.toBeTruthy();
  });
});

describe("DELETE /receipts/:receiptId", () => {
  it("RD01 host deletes: 200, gone from snapshot, people freed, event receipt.removed", async () => {
    const t = await scene();
    const rid = id();
    await rcpt(t, rid, t.host, rbody([ref(t.ana)]));
    const res = await rdel(t, rid, t.host, { expectedRevision: 1 });
    expect([res.status, res.data.result]).toEqual([200, { receiptId: rid }]);
    expect((await sync(t)).settlement.receipts).toEqual([]);
    expect(await count(sql`SELECT count(*) AS n FROM receipt_people WHERE session_id = ${t.sid}`)).toBe(0);
    expect((await rcpt(t, id(), t.host, rbody([ref(t.ana)]))).status).toBe(200);
    expect(await count(sql`SELECT count(*) AS n FROM session_events WHERE session_id = ${t.sid} AND event_type = 'receipt.removed'`)).toBe(1);
  });

  it("RD02 refusals: stale 409, revision 0 / empty body 422, missing 404 RECEIPT_NOT_FOUND, non-uuid 404, guest 403, no cookie 404, foreign order 404, second delete 404", async () => {
    const t = await scene();
    const o = await scene();
    const rid = id();
    await rcpt(t, rid, t.host, rbody([ref(t.ana)]));
    await refused(t, 409, undefined, () => rdel(t, rid, t.host, { expectedRevision: 5 }));
    await refused(t, 422, "INVALID", () => rdel(t, rid, t.host, { expectedRevision: 0 }));
    await refused(t, 422, "INVALID", () => rdel(t, rid, t.host, {}));
    await refused(t, 404, "RECEIPT_NOT_FOUND", () => rdel(t, id(), t.host, { expectedRevision: 1 }));
    await refused(t, 404, "RECEIPT_NOT_FOUND", () => rdel(t, "nope", t.host, { expectedRevision: 1 }));
    await refused(t, 403, "FORBIDDEN", () => rdel(t, rid, t.ana, { expectedRevision: 1 }));
    await refused(t, 404, undefined, () => rdel(t, rid, null, { expectedRevision: 1 }));
    await refused(t, 404, "RECEIPT_NOT_FOUND", () => rdel(o, rid, o.host, { expectedRevision: 1 }));
    await refused(t, 404, "RECEIPT_NOT_FOUND", () => rcpt(o, rid, o.host, rbody([ref(o.ana)])));
    expect((await rdel(t, rid, t.host, { expectedRevision: 1 })).status).toBe(200);
    await refused(t, 404, "RECEIPT_NOT_FOUND", () => rdel(t, rid, t.host, { expectedRevision: 1 }));
  });

  it("RD03 replaying a delete key after it applied returns the stored answer", async () => {
    const t = await scene();
    const rid = id();
    await rcpt(t, rid, t.host, rbody([ref(t.ana)]));
    const idem = key();
    const a = await rdel(t, rid, t.host, { expectedRevision: 1 }, { idem });
    const b = await rdel(t, rid, t.host, { expectedRevision: 1 }, { idem });
    expect([a.status, a.data.replayed, b.status, b.data.replayed]).toEqual([200, false, 200, true]);
  });
});

describe("receipts: concurrency", () => {
  it("RX01 two creates for one person race: exactly one wins, the other is 409 ALREADY_ON_RECEIPT", async () => {
    const t = await scene();
    const rs = await Promise.all([rcpt(t, id(), t.host, rbody([ref(t.ana)])), rcpt(t, id(), t.host, rbody([ref(t.ana)]))]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(rs.find((r) => r.status === 409)?.code).toBe("ALREADY_ON_RECEIPT");
    expect((await sync(t)).settlement.receipts).toHaveLength(1);
  });

  it("RX02 same id, both expectedRevision 0, race: one 200, one 409; one row", async () => {
    const t = await scene();
    const rid = id();
    const rs = await Promise.all([rcpt(t, rid, t.host, rbody([ref(t.ana)])), rcpt(t, rid, t.host, rbody([ref(t.bo)]))]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await sync(t)).settlement.receipts).toHaveLength(1);
  });

  it("RX03 three creates at nine receipts: one 200, two 400 TOO_MANY_RECEIPTS", async () => {
    const t = await scene();
    for (let i = 0; i < 9; i++) await rcpt(t, id(), t.host, rbody([lbl(`G${i}`)]));
    const rs = await Promise.all([0, 1, 2].map((i) => rcpt(t, id(), t.host, rbody([lbl(`H${i}`)]))));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 400, 400]);
    expect((await sync(t)).settlement.receipts).toHaveLength(10);
  });

  it("RX04 edit races delete on one revision: one wins, no 5xx, no orphan people", async () => {
    const t = await scene();
    const rid = id();
    await rcpt(t, rid, t.host, rbody([ref(t.ana)]));
    const rs = await Promise.all([rcpt(t, rid, t.host, rbody([ref(t.bo)], { expectedRevision: 1 })), rdel(t, rid, t.host, { expectedRevision: 1 })]);
    expect(rs.every((r) => r.status < 500)).toBe(true);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await count(sql`SELECT count(*) AS n FROM receipt_people WHERE session_id = ${t.sid}`)).toBe(await count(sql`SELECT count(*) AS n FROM receipts WHERE session_id = ${t.sid}`));
  });

  it("RX05 adding a person while the host removes them is 200 or 404, never 5xx", async () => {
    const t = await scene();
    const [added] = await Promise.all([rcpt(t, id(), t.host, rbody([ref(t.bo)])), run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.bo.actor.participantId, null))]);
    expect([200, 404]).toContain(added.status);
  });
});

describe("claim approval with receipts", () => {
  async function claimScene() {
    const t = await scene();
    await add(db, t.host.actor, { dishName: "Soup", quantity: 1, attribution: { type: "INDIVIDUAL", label: "Rafa" } });
    const batchId = (await sync(t)).entries.at(-1).batchId as string;
    const claim = await call(CLAIM, "POST", t.sid, {}, t.ana, { batchId });
    expect(claim.status).toBe(201);
    return { t, claimId: claim.data.result.claimId as string };
  }
  const approve = (t: T, claimId: string) => call(APPROVE, "POST", t.sid, { claimId }, t.host, {});
  const covered = async (t: T) => (await sync(t)).settlement.receipts.map((r: Json) => r.people.map((p: Json) => p.label ?? (p.participantId === t.ana.actor.participantId ? "ANA" : "?")));

  it("RA01 claimant already on another receipt: 200, the typed name's row goes, claimant stays", async () => {
    const { t, claimId } = await claimScene();
    await rcpt(t, id(), t.host, rbody([ref(t.ana)]));
    await rcpt(t, id(), t.host, rbody([lbl("Rafa")]));
    expect((await approve(t, claimId)).status).toBe(200);
    expect((await covered(t)).flat()).toEqual(["ANA"]);
  });

  it("RA02 claimant on the same receipt as the typed name: 200, one row for the claimant", async () => {
    const { t, claimId } = await claimScene();
    await rcpt(t, id(), t.host, rbody([ref(t.ana), lbl("Rafa")]));
    expect((await approve(t, claimId)).status).toBe(200);
    expect(await covered(t)).toEqual([["ANA"]]);
  });

  it("RA03 claimant on no receipt: the typed name's row becomes the claimant", async () => {
    const { t, claimId } = await claimScene();
    await rcpt(t, id(), t.host, rbody([lbl("Rafa"), ref(t.bo)]));
    expect((await approve(t, claimId)).status).toBe(200);
    const people = (await sync(t)).settlement.receipts[0].people.map((p: Json) => p.participantId ?? p.label);
    expect(people.sort()).toEqual([t.ana.actor.participantId, t.bo.actor.participantId].sort());
  });

  it("RA04 a typed name that is still a split payer is not adopted", async () => {
    const { t, claimId } = await claimScene();
    await rcpt(t, id(), t.host, rbody([lbl("Rafa")]));
    expect((await split(t, t.pata, [lbl("Rafa"), ref(t.bo)])).status).toBe(200);
    expect((await approve(t, claimId)).status).toBe(200);
    expect(await covered(t)).toEqual([["Rafa"]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("PUT /entries/:entryId/settlement with splitAmong", () => {
  it("SP01 host splits a shared dish between two: 200, snapshot for everyone, one event, ticket and source order untouched", async () => {
    const t = await scene();
    await confirm(t);
    const tickets = async () => JSON.stringify(await db.execute(sql`SELECT c.* FROM confirmed_round_snapshots c JOIN rounds r ON r.id = c.round_id WHERE r.session_id = ${t.sid} ORDER BY c.id`));
    const entries = async () => JSON.stringify(await db.select().from(orderEntries));
    const [tk, en] = [await tickets(), await entries()];
    const res = await settle(t, t.pata, t.host, { expectedRevision: 0, unitPriceCentavos: 78000, splitAmong: [ref(t.ana), ref(t.bo)] });
    expect([res.status, res.data.result]).toEqual([200, { entryId: t.pata, revision: 1 }]);
    for (const who of [t.host, t.ana, t.cy!]) {
      const row = (await sync(t, who)).settlement.entries[t.pata];
      expect(row.billTo).toBeNull();
      expect(row.splitAmong.map((p: Json) => p.participantId).sort()).toEqual([t.ana.actor.participantId, t.bo.actor.participantId].sort());
      expect(row.splitAmong.every((p: Json) => p.label === null)).toBe(true);
    }
    expect([await tickets(), await entries()]).toEqual([tk, en]);
    const ev = (await db.execute(sql`SELECT event_type FROM session_events WHERE session_id = ${t.sid} ORDER BY id DESC LIMIT 1`)) as unknown as { event_type: string }[];
    expect(ev[0].event_type).toBe("entry.settled");
  });

  it("SP02 typed names mix with people and are tidied; the key is absent without a split", async () => {
    const t = await scene();
    await price(t, t.rice, 10000);
    expect((await split(t, t.pata, [ref(t.ana), lbl("  Lola   Maria ")])).status).toBe(200);
    const s = (await sync(t)).settlement.entries;
    expect(s[t.pata].splitAmong).toHaveLength(2);
    expect(s[t.pata].splitAmong).toEqual(expect.arrayContaining([{ participantId: t.ana.actor.participantId, label: null }, { participantId: null, label: "Lola Maria" }]));
    expect("splitAmong" in s[t.rice]).toBe(false);
    await refused(t, 422, "INVALID", () => split(t, t.pata, [ref(t.ana), lbl("y".repeat(41))]));
  });

  it("SP03 refused inputs are 422 and change nothing; thirty typed names are fine", async () => {
    const t = await scene();
    const ok = { expectedRevision: 0 };
    const bad: [string, unknown][] = [
      ["one person", { ...ok, splitAmong: [ref(t.ana)] }],
      ["empty", { ...ok, splitAmong: [] }],
      ["null", { ...ok, splitAmong: null }],
      ["not an array", { ...ok, splitAmong: "Ana,Bo" }],
      ["billTo together", { ...ok, billTo: ref(t.ana), splitAmong: [ref(t.ana), ref(t.bo)] }],
      ["billTo null together", { ...ok, billTo: null, splitAmong: [ref(t.ana), ref(t.bo)] }],
      ["same id twice", { ...ok, splitAmong: [ref(t.ana), ref(t.ana)] }],
      ["Ana / ana", { ...ok, splitAmong: [lbl("Ana"), lbl("ana")] }],
      ["spacing and case", { ...ok, splitAmong: [lbl("Ana  B"), lbl(" ANA b ")] }],
      ["NFKC twin", { ...ok, splitAmong: [lbl("Ana"), lbl("Ａna")] }],
      ["empty name", { ...ok, splitAmong: [lbl(""), lbl("Bo")] }],
      ["a group", { ...ok, splitAmong: [{ groupId: id() }, ref(t.ana)] }],
      ["31 people", { ...ok, splitAmong: Array.from({ length: 31 }, (_, i) => lbl(`P${i}`)) }],
      ["no revision", { splitAmong: [ref(t.ana), ref(t.bo)] }],
      ["nothing to change", { ...ok }],
    ];
    for (const [name, body] of bad) {
      const res = await refused(t, 422, "INVALID", () => settle(t, t.pata, t.host, body));
      expect(res.json.error.message, name).toBeTruthy();
    }
    expect((await split(t, t.pata, Array.from({ length: 30 }, (_, i) => lbl(`P${i}`)))).status).toBe(200);
  });

  it("SP04 a personal line (a person's or a typed name's own dish) can't be split, 422", async () => {
    const t = await scene();
    await add(db, t.host.actor, { dishName: "Soup", quantity: 1, attribution: { type: "INDIVIDUAL", label: "Rafa" } });
    const typed = (await sync(t)).entries.at(-1).id as string;
    const two = [ref(t.ana), ref(t.bo)];
    await refused(t, 422, "INVALID", () => settle(t, t.rice, t.host, { expectedRevision: 0, splitAmong: two }));
    await refused(t, 422, "INVALID", () => settle(t, t.sisig, t.host, { expectedRevision: 0, splitAmong: two }));
    await refused(t, 422, "INVALID", () => settle(t, typed, t.host, { expectedRevision: 0, splitAmong: two }));
  });

  it("SP05 auth: guest 403, co-host 403, no cookie 404, other order 404, removed 403; the dish's own guest can't split either", async () => {
    const t = await scene();
    const o = await scene();
    await db.execute(sql`UPDATE participants SET cohost_at = now() WHERE id = ${t.cy!.actor.participantId}`);
    const b = { expectedRevision: 0, splitAmong: [ref(t.ana), ref(t.bo)] };
    await refused(t, 403, "FORBIDDEN", () => settle(t, t.pata, t.ana, b));
    await refused(t, 403, "FORBIDDEN", () => settle(t, t.pata, t.cy!, b));
    await refused(t, 403, "FORBIDDEN", () => settle(t, t.rice, t.ana, b));
    await refused(t, 404, undefined, () => settle(t, t.pata, null, b));
    await refused(t, 404, undefined, () => settle(t, t.pata, o.host, b));
    await run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.bo.actor.participantId, null));
    await refused(t, 403, "REMOVED", () => settle(t, t.pata, t.bo, b));
  });

  it("SP06 stale revision 409, unknown entry 404, other order's entry 404, removed dish 409", async () => {
    const t = await scene();
    const o = await scene();
    await split(t, t.pata, [ref(t.ana), ref(t.bo)]);
    const b = { expectedRevision: 0, splitAmong: [ref(t.ana), ref(t.cy!)] };
    await refused(t, 409, undefined, () => settle(t, t.pata, t.host, b));
    await refused(t, 404, "ENTRY_NOT_FOUND", () => settle(t, id(), t.host, b));
    await refused(t, 404, "ENTRY_NOT_FOUND", () => settle(t, "nope", t.host, b));
    await refused(t, 404, "ENTRY_NOT_FOUND", () => settle(t, o.pata, t.host, b));
    await db.update(orderEntries).set({ deletedAt: new Date() }).where(eq(orderEntries.id, t.pata));
    await refused(t, 409, "ENTRY_REMOVED", () => settle(t, t.pata, t.host, { ...b, expectedRevision: 1 }));
  });

  it("SP07 modes switch on the one revision and never coexist (rows, snapshot, cards)", async () => {
    const t = await scene();
    await confirm(t);
    await price(t, t.pata, 78000);
    const pata = async () => (await sync(t)).settlement.entries[t.pata];
    const payers = () => count(sql`SELECT count(*) AS n FROM entry_payers WHERE entry_id = ${t.pata}`);
    const events = () => count(sql`SELECT count(*) AS n FROM session_events WHERE session_id = ${t.sid} AND event_type = 'entry.settled'`);
    const me = t.host.actor.participantId;
    const e0 = await events();
    expect((await split(t, t.pata, [ref(t.ana), ref(t.bo)])).data.result.revision).toBe(2);
    expect([(await pata()).billTo, await payers()]).toEqual([null, 2]);
    let k = kkbOf(await sync(t), me);
    expect([shareOn(k, pk(t.ana), t.pata)?.subtotalCentavos, shareOn(k, pk(t.bo), t.pata)?.subtotalCentavos]).toEqual([39000, 39000]);
    expect((await settle(t, t.pata, t.host, { expectedRevision: 2, billTo: ref(t.ana) })).data.result.revision).toBe(3);
    const p1 = await pata();
    expect([p1.billTo.participantId, "splitAmong" in p1, await payers()]).toEqual([t.ana.actor.participantId, false, 0]);
    k = kkbOf(await sync(t), me);
    expect([shareOn(k, pk(t.ana), t.pata)?.subtotalCentavos, shareOn(k, pk(t.bo), t.pata)]).toEqual([78000, undefined]);
    expect(centsOf(k, t.pata)).toHaveLength(1);
    expect((await split(t, t.pata, [ref(t.bo), ref(t.cy!)])).data.result.revision).toBe(4);
    const p2 = await pata();
    expect([p2.billTo, p2.splitAmong.length, await payers()]).toEqual([null, 2, 2]);
    k = kkbOf(await sync(t), me);
    expect(centsOf(k, t.pata)).toEqual([39000, 39000]);
    expect(shareOn(k, pk(t.ana), t.pata)).toBeUndefined();
    expect((await settle(t, t.pata, t.host, { expectedRevision: 4, billTo: null })).data.result.revision).toBe(5);
    const p3 = await pata();
    expect([p3.billTo, "splitAmong" in p3, await payers()]).toEqual([null, false, 0]);
    expect((await events()) - e0).toBe(4);
  });

  it("SP08 replacing the set replaces the rows, no leftovers", async () => {
    const t = await scene();
    await split(t, t.pata, [ref(t.ana), ref(t.bo), lbl("Lola")]);
    await split(t, t.pata, [ref(t.bo), ref(t.cy!)]);
    expect((await sync(t)).settlement.entries[t.pata].splitAmong.map((p: Json) => p.participantId).sort()).toEqual([t.bo.actor.participantId, t.cy!.actor.participantId].sort());
  });

  it("SP09 a person who left stays in the split and keeps their share; adding a left, unknown or foreign person is 404", async () => {
    const t = await scene();
    const o = await scene();
    await confirm(t);
    await price(t, t.pata, 78000);
    await split(t, t.pata, [ref(t.ana), ref(t.bo)]);
    await run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.bo.actor.participantId, null));
    await run(t.host.actor, (tx, s) => removeParticipant(tx, s, t.host.actor, t.cy!.actor.participantId, null));
    expect((await split(t, t.pata, [ref(t.ana), ref(t.bo)], { unitPriceCentavos: 90000 })).status).toBe(200);
    const k = kkbOf(await sync(t), t.host.actor.participantId);
    expect([shareOn(k, pk(t.ana), t.pata)?.subtotalCentavos, shareOn(k, pk(t.bo), t.pata)?.subtotalCentavos]).toEqual([45000, 45000]);
    await refused(t, 404, "PERSON_NOT_FOUND", () => split(t, t.pata, [ref(t.ana), ref(t.cy!)]));
    await refused(t, 404, "PERSON_NOT_FOUND", () => split(t, t.pata, [ref(t.ana), { participantId: id() }]));
    await refused(t, 404, "PERSON_NOT_FOUND", () => split(t, t.pata, [ref(t.ana), ref(o.ana)]));
    await refused(t, 404, "PERSON_NOT_FOUND", () => settle(t, t.pata, t.host, { expectedRevision: 2, billTo: ref(o.ana) }));
  });

  it("SP10 ended order: host can split, guest 403; cancelled order 409", async () => {
    const t = await scene();
    await confirm(t);
    await end(t);
    expect((await split(t, t.pata, [ref(t.ana), ref(t.bo)])).status).toBe(200);
    await refused(t, 403, "FORBIDDEN", () => settle(t, t.pata, t.ana, { expectedRevision: 1, splitAmong: [ref(t.ana), ref(t.cy!)] }));
    const c = await scene();
    await end(c);
    await refused(c, 409, "SESSION_CLOSED", () => settle(c, c.pata, c.host, { expectedRevision: 0, splitAmong: [ref(c.ana), ref(c.bo)] }));
  });

  it("SP11 a price-only change keeps the split and recomputes shares", async () => {
    const t = await scene();
    await confirm(t);
    await split(t, t.pata, [ref(t.ana), ref(t.bo)]);
    for (const cents of [78000, 78001, 100003, null]) {
      expect((await price(t, t.pata, cents)).status).toBe(200);
      const snap = await sync(t);
      expect(snap.settlement.entries[t.pata].splitAmong).toHaveLength(2);
      const shares = centsOf(kkbOf(snap, t.host.actor.participantId), t.pata);
      expect(shares).toHaveLength(2);
      if (cents == null) expect(shares).toEqual([null, null]);
      else expect(sum(shares)).toBe(cents);
    }
  });

  it("SP12 replay of a split key applies once", async () => {
    const t = await scene();
    const idem = key();
    const b = { expectedRevision: 0, splitAmong: [ref(t.ana), ref(t.bo)] };
    const a1 = await settle(t, t.pata, t.host, b, { idem });
    const a2 = await settle(t, t.pata, t.host, b, { idem });
    expect([a1.data.replayed, a2.data.replayed, a2.data.result.revision]).toEqual([false, true, 1]);
    expect(await count(sql`SELECT count(*) AS n FROM entry_payers WHERE entry_id = ${t.pata}`)).toBe(2);
  });

  it("SP13 racing modes on one revision: one wins, the others 409, never both Bill to and a split", async () => {
    const t = await scene();
    for (let round = 0; round < 3; round++) {
      const rev = await stored(t, t.pata);
      const rs = await Promise.all([
        settle(t, t.pata, t.host, { expectedRevision: rev, splitAmong: [ref(t.ana), ref(t.bo)] }),
        settle(t, t.pata, t.host, { expectedRevision: rev, billTo: ref(t.cy!) }),
        settle(t, t.pata, t.host, { expectedRevision: rev, splitAmong: [ref(t.bo), ref(t.cy!)] }),
      ]);
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      const row = (await sync(t)).settlement.entries[t.pata];
      expect(Boolean(row.billTo) && Boolean(row.splitAmong)).toBe(false);
      expect(row.revision).toBe(rev + 1);
    }
  });
});

describe("snapshot (GET /sync)", () => {
  it("SN01 a fresh order has receipts [] and no splitAmong; a stranger gets 404", async () => {
    const t = await scene();
    const o = await scene();
    const snap = await sync(t);
    expect(snap.settlement.receipts).toEqual([]);
    expect(JSON.stringify(snap.settlement.entries)).not.toContain("splitAmong");
    expect((await call(SYNC, "GET", t.sid, {}, o.host)).status).toBe(404);
    expect((await call(SYNC, "GET", t.sid, {}, null)).status).toBe(404);
  });

  it("SN02 an ended order still shows its receipts and splits to a guest", async () => {
    const t = await scene();
    await confirm(t);
    await rcpt(t, id(), t.host, rbody([ref(t.ana)]));
    await split(t, t.pata, [ref(t.ana), ref(t.bo)]);
    await end(t);
    const snap = await sync(t, t.cy!);
    expect(snap.settlement.receipts).toHaveLength(1);
    expect(snap.settlement.entries[t.pata].splitAmong).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("split math (shares sum to the subtotal, deterministic, recomputed)", () => {
  it("MX01 two to seven people at odd centavos: shares add up, differ by at most 1, same whatever the pick order, odd centavos go by payer key", async () => {
    const t = await scene();
    await confirm(t);
    const me = t.host.actor.participantId;
    for (const unit of [10001, 3333, 78001]) {
      await price(t, t.pata, unit);
      for (let n = 2; n <= 7; n++) {
        const names = Array.from({ length: n }, (_, i) => `P${i + 1}`);
        const keys = names.map((nm) => `n:${nm.toLowerCase()}`);
        await split(t, t.pata, names.map(lbl));
        const k1 = kkbOf(await sync(t), me);
        const shares = keys.map((kk) => shareOn(k1, kk, t.pata)!.subtotalCentavos!);
        expect(sum(shares), `${n} ways of ${unit}`).toBe(unit);
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
        const base = Math.floor(unit / n);
        const extra = unit - base * n;
        const sorted = [...keys].sort();
        expect(sorted.map((kk) => shareOn(k1, kk, t.pata)!.subtotalCentavos), `${n} ways tie order`).toEqual(sorted.map((_, i) => base + (i < extra ? 1 : 0)));
        await split(t, t.pata, [...names].reverse().map(lbl));
        const k2 = kkbOf(await sync(t), me);
        expect(keys.map((kk) => shareOn(k2, kk, t.pata)!.subtotalCentavos)).toEqual(shares);
      }
    }
  });

  it("MX02 quantity multiplies before splitting: 3 x 100.01 among 3 is 300.03 in total", async () => {
    const s = await newSession(db);
    const host: Who = { actor: s.host, token: s.token };
    const t: Mini = { sid: s.sessionId, host, ana: await guest(s.sessionId, "Ana"), bo: await guest(s.sessionId, "Bo") };
    const q = (await add(db, host.actor, { dishName: "Pancit", quantity: 3, attribution: { type: "TABLE" } })).result.entryId as string;
    await confirm(t);
    await price(t, q, 10001);
    await split(t, q, [ref(t.ana), ref(t.bo), lbl("Lola")]);
    expect(sum(centsOf(kkbOf(await sync(t), host.actor.participantId), q))).toBe(30003);
  });

  it("MX03 an unpriced split counts once: blockers units = quantity, one 'Not yet settled' line, service charge waits, then allocates", async () => {
    const s = await newSession(db);
    const host: Who = { actor: s.host, token: s.token };
    const t: Mini = { sid: s.sessionId, host, ana: await guest(s.sessionId, "Ana"), bo: await guest(s.sessionId, "Bo"), cy: await guest(s.sessionId, "Cy") };
    const q = (await add(db, host.actor, { dishName: "Pancit", quantity: 2, attribution: { type: "TABLE" } })).result.entryId as string;
    await confirm(t);
    expect((await serviceCharge(t, 1000)).status).toBe(200);
    await split(t, q, [ref(t.ana), ref(t.bo), ref(t.cy!)]);
    const k = kkbOf(await sync(t), host.actor.participantId);
    expect(k.charge.state).toBe("blocked");
    const unpriced = blockersOf(k).filter((b) => b.kind === "unpriced");
    expect(unpriced).toHaveLength(1);
    expect(unpriced[0]).toMatchObject({ units: 2 });
    expect(blockersOf(k).some((b) => b.kind === "unbilled")).toBe(false);
    const text = kkbText(k, "Dinner", "today");
    expect(text.split("\n").filter((l) => l.includes("Pancit") && l.includes("no price"))).toHaveLength(1);
    expect(text.match(/Not yet settled/g)).toHaveLength(1);
    expect(priceCompleteness(k)).toMatchObject({ total: 1, priced: 0 });
    for (const w of [t.ana, t.bo, t.cy!]) expect(card(k, pk(w))!.unpricedUnits).toBeGreaterThan(0);
    const snapBlocked = await sync(t);
    const gate = reconcileReceipts(k, snapBlocked.settlement as never, snapBlocked as never);
    expect(gate).toBeNull();
    await rcpt(t, id(), host, rbody([ref(t.ana)]));
    const snapR = await sync(t);
    expect(reconcileReceipts(kkbOf(snapR, host.actor.participantId), snapR.settlement as never, snapR as never)!.cards.map((c) => c.state.state)).toEqual(["incomplete", "incomplete"]);
    await price(t, q, 5000);
    const k2 = kkbOf(await sync(t), host.actor.participantId);
    expect(priceCompleteness(k2)).toMatchObject({ total: 1, priced: 1 });
    expect(k2.charge.state).toBe("allocated");
    expect(sum(k2.sections.filter((x) => !x.shared).map((x) => x.totalCentavos))).toBe(10000 + 1000);
  });

  async function priced() {
    const t = await scene();
    await confirm(t);
    await price(t, t.sisig, 30000);
    await price(t, t.rice, 10000);
    await price(t, t.katsu, 20000);
    await price(t, t.pata, 78000);
    await split(t, t.pata, [ref(t.ana), ref(t.bo)]);
    expect((await serviceCharge(t, 13800)).status).toBe(200);
    return t;
  }

  it("MX04 split + service charge + senior discount (20% of the payer's food) + proportional discount: cards add up to the adjusted total", async () => {
    const t = await priced();
    const me = t.host.actor.participantId;
    let k = kkbOf(await sync(t), me);
    // food 300 / 490 / 590 pesos, service 138 by food: 30 / 49 / 59
    expect([card(k, pk(t.host))!.totalCentavos, card(k, pk(t.ana))!.totalCentavos, card(k, pk(t.bo))!.totalCentavos]).toEqual([33000, 53900, 64900]);
    expect(k.adjustedTotal).toBe(151800);
    expect((await adjust(t, { direction: "discount", category: "senior", percentBps: 2000, method: "individual", shares: [ref(t.bo)] })).status).toBe(200);
    k = kkbOf(await sync(t), me);
    expect([card(k, pk(t.bo))!.totalCentavos, k.adjustedTotal]).toEqual([64900 - 11800, 140000]);
    expect((await adjust(t, { direction: "discount", category: "promo", amountCentavos: 10000, method: "proportional", shares: [ref(t.ana), ref(t.bo)] })).status).toBe(200);
    k = kkbOf(await sync(t), me);
    expect(sum(k.sections.filter((x) => !x.shared).map((x) => x.totalCentavos))).toBe(k.adjustedTotal);
    expect(k.adjustedTotal).toBe(130000);
    expect(k.adjustments.every((a) => a.state === "applied")).toBe(true);
  });

  it("MX05 per-receipt reconciliation: Bo's receipt matches, Main = adjusted - extras; a flagged adjustment lands on Bo's receipt", async () => {
    const t = await priced();
    const me = t.host.actor.participantId;
    await adjust(t, { direction: "discount", category: "senior", percentBps: 2000, method: "individual", shares: [ref(t.bo)] });
    await rcpt(t, id(), t.host, rbody([ref(t.bo)], { totalCentavos: 53100 }));
    expect((await call(RECEIPT_TOTAL, "PUT", t.sid, {}, t.host, { expectedRevision: 0, centavos: 86900 })).status).toBe(200);
    const snap = await sync(t);
    const v = reconcileReceipts(kkbOf(snap, me), snap.settlement as never, snap as never)!;
    expect(v.cards.map((c) => [c.label, c.expectedCentavos, c.state.state])).toEqual([["Main receipt", 86900, "matches"], ["Senior citizen receipt", 53100, "matches"]]);
    expect(v.overall).toEqual({ receiptsCentavos: 140000, saloCentavos: 140000, matches: true });
    await adjust(t, { direction: "discount", category: "pwd", amountCentavos: 60000, method: "individual", shares: [ref(t.bo)] });
    const snap2 = await sync(t);
    const k2 = kkbOf(snap2, me);
    expect(k2.adjustments.map((a) => a.state)).toEqual(["applied", "flagged"]);
    const v2 = reconcileReceipts(k2, snap2.settlement as never, snap2 as never)!;
    expect(v2.cards[1].expectedCentavos).toBe(53100 - 60000);
    expect(v2.cards[0].expectedCentavos).toBe(k2.adjustedTotal - v2.cards[1].expectedCentavos);
    expect(v2.cards[0].expectedCentavos).toBe(86900);
  });

  it("MX06 a covered person with nothing on the bill is flagged; no extras means no receipts view; Bill to alone is unchanged", async () => {
    const t = await scene();
    await confirm(t);
    for (const [e, c] of [[t.rice, 10000], [t.sisig, 1000], [t.katsu, 1000], [t.pata, 3000]] as const) await price(t, e, c);
    await settle(t, t.pata, t.host, { expectedRevision: await stored(t, t.pata), billTo: ref(t.ana) });
    let snap = await sync(t);
    expect(reconcileReceipts(kkbOf(snap, t.host.actor.participantId), snap.settlement as never, snap as never)).toBeNull();
    let k = kkbOf(snap, t.host.actor.participantId);
    const line = shareOn(k, pk(t.ana), t.pata);
    expect([line?.subtotalCentavos, line?.billedFrom, line?.splitWays]).toEqual([3000, "Whole table", null]);
    await rcpt(t, id(), t.host, rbody([ref(t.cy!)], { totalCentavos: 0 }));
    snap = await sync(t);
    k = kkbOf(snap, t.host.actor.participantId);
    expect(reconcileReceipts(k, snap.settlement as never, snap as never)!.cards[1].flags).toEqual(["Cy has nothing on the bill"]);
  });

  it("MX07 a quantity correction: shares follow the effective quantity", async () => {
    const s = await newSession(db);
    const host: Who = { actor: s.host, token: s.token };
    const t: Mini = { sid: s.sessionId, host, ana: await guest(s.sessionId, "Ana"), bo: await guest(s.sessionId, "Bo") };
    const e = (await add(db, host.actor, { dishName: "Crispy Pata", quantity: 3, attribution: { type: "TABLE" } })).result.entryId as string;
    await confirm(t);
    await price(t, e, 10001);
    await split(t, e, [ref(t.ana), ref(t.bo)]);
    expect(sum(centsOf(kkbOf(await sync(t), host.actor.participantId), e))).toBe(30003);
    await run(host.actor, (tx, st) => openRound(tx, st, host.actor));
    await run(host.actor, (tx, st) => recordCorrection(tx, st, host.actor, { sourceEntryId: e, type: "QUANTITY", quantity: 1 }));
    await confirm(t);
    const k = kkbOf(await sync(t), host.actor.participantId);
    expect(shareOn(k, pk(t.ana), e)!.quantity).toBe(2);
    expect(sum(centsOf(k, e))).toBe(20002);
  });

  it("MX08 replacement dish: split via the entry route, price via the correction route; shares follow the replacement price", async () => {
    const s = await newSession(db);
    const host: Who = { actor: s.host, token: s.token };
    const t: Mini = { sid: s.sessionId, host, ana: await guest(s.sessionId, "Ana"), bo: await guest(s.sessionId, "Bo") };
    const e = (await add(db, host.actor, { dishName: "Crispy Pata", quantity: 1, attribution: { type: "TABLE" } })).result.entryId as string;
    await confirm(t);
    await run(host.actor, (tx, st) => openRound(tx, st, host.actor));
    const corr = await run(host.actor, (tx, st) => recordCorrection(tx, st, host.actor, { sourceEntryId: e, type: "REPLACE", replacement: "Pork Pata" }));
    await confirm(t);
    expect((await split(t, e, [ref(t.ana), ref(t.bo)])).status).toBe(200);
    expect((await call(CORRECTION_PRICE, "PUT", t.sid, { correctionId: corr.result.correctionId }, host, { expectedRevision: 0, unitPriceCentavos: 60001 })).status).toBe(200);
    const k = kkbOf(await sync(t), host.actor.participantId);
    const lines = [shareOn(k, pk(t.ana), e), shareOn(k, pk(t.bo), e)];
    expect(lines.map((l) => l?.label.endsWith("Pork Pata"))).toEqual([true, true]);
    expect(sum(lines.map((l) => l?.subtotalCentavos ?? 0))).toBe(60001);
    await settle(t, e, host, { expectedRevision: await stored(t, e), billTo: ref(t.bo) });
    const k2 = kkbOf(await sync(t), host.actor.participantId);
    expect([shareOn(k2, pk(t.bo), e)?.subtotalCentavos, shareOn(k2, pk(t.ana), e)]).toEqual([60001, undefined]);
  });

  it("MX10 a pending correction on a split dish counts once in the blockers", async () => {
    const s = await newSession(db);
    const host: Who = { actor: s.host, token: s.token };
    const t: Mini = { sid: s.sessionId, host, ana: await guest(s.sessionId, "Ana"), bo: await guest(s.sessionId, "Bo") };
    const e = (await add(db, host.actor, { dishName: "Crispy Pata", quantity: 3, attribution: { type: "TABLE" } })).result.entryId as string;
    await confirm(t);
    await price(t, e, 10000);
    await split(t, e, [ref(t.ana), ref(t.bo)]);
    await run(host.actor, (tx, st) => openRound(tx, st, host.actor));
    await run(host.actor, (tx, st) => recordCorrection(tx, st, host.actor, { sourceEntryId: e, type: "QUANTITY", quantity: 1 }));
    expect((await serviceCharge(t, 1000)).status).toBe(200);
    const k = kkbOf(await sync(t), host.actor.participantId);
    const pending = blockersOf(k).filter((b) => b.kind === "pending");
    expect(pending).toEqual([{ kind: "pending", count: 1 }]);
  });

  it("MX11 a group's dish can be split too; a participant and a typed twin of their name are two people (documented)", async () => {
    const t = await scene();
    const g = await add(db, t.host.actor, { dishName: "Fries", quantity: 1, attribution: { type: "GROUP", label: "Kids" } });
    expect((await split(t, g.result.entryId, [ref(t.ana), ref(t.bo)])).status).toBe(200);
    expect((await split(t, t.pata, [ref(t.ana), lbl("Ana")])).status).toBe(200);
  });

  it("MX09 the export has no split wording and the shared section keeps one listed line naming the payers", async () => {
    const t = await scene();
    await confirm(t);
    await price(t, t.pata, 78000);
    await split(t, t.pata, [ref(t.ana), ref(t.bo)]);
    const k = kkbOf(await sync(t), t.host.actor.participantId);
    expect(kkbText(k, "Dinner", "today")).not.toMatch(/split/i);
    const origin = k.sections.find((x) => x.key === "table")!;
    expect(origin.lines.filter((l) => l.entryId === t.pata)).toHaveLength(1);
    expect(origin.lines.find((l) => l.entryId === t.pata)?.billedTo).toBe("Ana, Bo");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("database backstops", () => {
  const bad = async (q: ReturnType<typeof sql>) => {
    await expect(db.execute(q)).rejects.toThrow();
  };

  it("DB01 entry_payers: one-who check, duplicate person, duplicate label by case, foreign person, foreign entry, label length", async () => {
    const t = await scene();
    const o = await scene();
    await bad(sql`INSERT INTO entry_payers (entry_id, session_id) VALUES (${t.pata}, ${t.sid})`);
    await bad(sql`INSERT INTO entry_payers (entry_id, session_id, participant_id, bill_to_label) VALUES (${t.pata}, ${t.sid}, ${t.ana.actor.participantId}, 'x')`);
    await db.execute(sql`INSERT INTO entry_payers (entry_id, session_id, participant_id) VALUES (${t.pata}, ${t.sid}, ${t.ana.actor.participantId})`);
    await bad(sql`INSERT INTO entry_payers (entry_id, session_id, participant_id) VALUES (${t.pata}, ${t.sid}, ${t.ana.actor.participantId})`);
    await db.execute(sql`INSERT INTO entry_payers (entry_id, session_id, bill_to_label) VALUES (${t.pata}, ${t.sid}, 'Lola')`);
    await bad(sql`INSERT INTO entry_payers (entry_id, session_id, bill_to_label) VALUES (${t.pata}, ${t.sid}, 'LOLA')`);
    await bad(sql`INSERT INTO entry_payers (entry_id, session_id, participant_id) VALUES (${t.pata}, ${t.sid}, ${o.ana.actor.participantId})`);
    await bad(sql`INSERT INTO entry_payers (entry_id, session_id, participant_id) VALUES (${o.pata}, ${t.sid}, ${t.bo.actor.participantId})`);
    await bad(sql`INSERT INTO entry_payers (entry_id, session_id, bill_to_label) VALUES (${t.pata}, ${t.sid}, ${"z".repeat(41)})`);
  });

  it("DB02 receipts: revision >= 1, total 0..99999999, label 1..40, a person on one receipt per order, cascades", async () => {
    const t = await scene();
    const r1 = id();
    const r2 = id();
    await bad(sql`INSERT INTO receipts (id, session_id, revision) VALUES (${id()}, ${t.sid}, 0)`);
    await bad(sql`INSERT INTO receipts (id, session_id, total_centavos) VALUES (${id()}, ${t.sid}, -1)`);
    await bad(sql`INSERT INTO receipts (id, session_id, total_centavos) VALUES (${id()}, ${t.sid}, 100000000)`);
    await bad(sql`INSERT INTO receipts (id, session_id, label) VALUES (${id()}, ${t.sid}, '')`);
    await db.execute(sql`INSERT INTO receipts (id, session_id) VALUES (${r1}, ${t.sid}), (${r2}, ${t.sid})`);
    await db.execute(sql`INSERT INTO receipt_people (receipt_id, session_id, participant_id) VALUES (${r1}, ${t.sid}, ${t.ana.actor.participantId})`);
    await bad(sql`INSERT INTO receipt_people (receipt_id, session_id, participant_id) VALUES (${r2}, ${t.sid}, ${t.ana.actor.participantId})`);
    await db.execute(sql`INSERT INTO receipt_people (receipt_id, session_id, bill_to_label) VALUES (${r1}, ${t.sid}, 'Lola')`);
    await bad(sql`INSERT INTO receipt_people (receipt_id, session_id, bill_to_label) VALUES (${r2}, ${t.sid}, 'lOLA')`);
    await db.execute(sql`DELETE FROM receipts WHERE id = ${r1}`);
    expect(await count(sql`SELECT count(*) AS n FROM receipt_people WHERE session_id = ${t.sid}`)).toBe(0);
    await split(t, t.pata, [ref(t.ana), ref(t.bo)]);
    await db.execute(sql`DELETE FROM sessions WHERE id = ${t.sid}`);
    expect(await count(sql`SELECT count(*) AS n FROM entry_payers WHERE session_id = ${t.sid}`)).toBe(0);
  });
});
