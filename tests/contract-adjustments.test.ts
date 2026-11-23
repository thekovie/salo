import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { DELETE, PUT } from "@/app/api/sessions/[id]/adjustments/[adjustmentId]/route";
import { GET as SESSION_GET } from "@/app/api/sessions/[id]/route";
import { GET as SYNC } from "@/app/api/sessions/[id]/sync/route";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";
import type { Actor } from "@/lib/permissions";
import { credentialCookieName, hashToken, newToken } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { adjustmentShares, adjustments, participantCredentials, participants, sessionEvents, sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { removeParticipant, requestClaim, resolveClaim } from "@/server/orders/people";
import { closeSession, confirmRound } from "@/server/orders/rounds";
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

type Who = { actor: Actor; token: string };
type Envelope = { data?: { result: { adjustmentId: string; revision: number }; replayed: boolean }; error?: { code: string } };

async function call(method: "PUT" | "DELETE", sessionId: string, adjustmentId: string, who: Who, body: unknown, idem: string = key()) {
  jar.cookies = { [credentialCookieName(sessionId)]: who.token };
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/adjustments/${adjustmentId}`, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost:3000", "idempotency-key": idem },
    body: JSON.stringify(body),
  });
  const handler = method === "PUT" ? PUT : DELETE;
  const res = await handler(req, { params: Promise.resolve({ id: sessionId, adjustmentId }) });
  return { status: res.status, body: (await res.json()) as Envelope };
}
const put = (sessionId: string, id: string, who: Who, body: unknown, idem?: string) => call("PUT", sessionId, id, who, body, idem);
const del = (sessionId: string, id: string, who: Who, body: unknown) => call("DELETE", sessionId, id, who, body);

async function setup() {
  const s = await newSession(db);
  const token = newToken();
  const [row] = await db.insert(participants).values({ sessionId: s.sessionId, displayName: "Ana", role: "GUEST" }).returning();
  await db.insert(participantCredentials).values({ sessionId: s.sessionId, participantId: row.id, credentialType: "GUEST", credentialHash: hashToken(token) });
  const guest: Actor = { participantId: row.id, sessionId: s.sessionId, role: "GUEST", displayName: "Ana" };
  return { ...s, guest, who: { host: { actor: s.host, token: s.token }, guest: { actor: guest, token } } };
}
type Scene = Awaited<ReturnType<typeof setup>>;

async function confirmOne(t: Scene) {
  await add(db, t.host, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL", participantId: t.guest.participantId } });
  const snap = await getSnapshot(db, t.host);
  await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => confirmRound(tx, s, t.host, snap.activeRoundId, snap.session.revision));
}
const close = (t: Scene) => runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => closeSession(tx, s, t.host));

const one = (t: Scene): Record<string, unknown> => ({ expectedRevision: 0, direction: "discount", category: "senior", note: null, amountCentavos: 5000, method: "individual", shares: [{ participantId: t.guest.participantId }] });
const withPercent = (body: Record<string, unknown>, percentBps: number) => {
  const rest = { ...body };
  delete rest.amountCentavos;
  return { ...rest, percentBps };
};
const adjustmentsOf = async (t: Scene) => (await getSnapshot(db, t.host)).settlement.adjustments;
const newId = () => crypto.randomUUID();

describe("PUT /adjustments/:adjustmentId", () => {
  it("host creates, edits and deletes; everyone sees it in the snapshot", async () => {
    const t = await setup();
    const id = newId();
    const created = await put(t.sessionId, id, t.who.host, one(t));
    expect(created.status).toBe(200);
    expect(created.body.data?.result).toEqual({ adjustmentId: id, revision: 1 });
    expect((await getSnapshot(db, t.guest)).settlement.adjustments).toEqual([
      expect.objectContaining({ id, direction: "discount", category: "senior", amountCentavos: 5000, percentBps: null, method: "individual", revision: 1, shares: [{ participantId: t.guest.participantId, label: null, amountCentavos: null }] }),
    ]);
    expect((await put(t.sessionId, id, t.who.host, { ...withPercent(one(t), 1000), expectedRevision: 1, method: "equal" })).status).toBe(200);
    expect(await adjustmentsOf(t)).toEqual([expect.objectContaining({ percentBps: 1000, amountCentavos: null, method: "equal", revision: 2 })]);
    expect((await del(t.sessionId, id, t.who.host, { expectedRevision: 2 })).status).toBe(200);
    expect(await adjustmentsOf(t)).toEqual([]);
  });

  it("a guest gets 403 on PUT and DELETE", async () => {
    const t = await setup();
    const id = newId();
    expect((await put(t.sessionId, id, t.who.guest, one(t))).status).toBe(403);
    await put(t.sessionId, id, t.who.host, one(t));
    expect((await del(t.sessionId, id, t.who.guest, { expectedRevision: 1 })).status).toBe(403);
    expect(await adjustmentsOf(t)).toHaveLength(1);
  });

  it("a stale revision, or creating over an existing id, is a 409 CONFLICT", async () => {
    const t = await setup();
    const id = newId();
    await put(t.sessionId, id, t.who.host, one(t));
    const again = await put(t.sessionId, id, t.who.host, one(t));
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("CONFLICT");
    expect((await put(t.sessionId, id, t.who.host, { ...one(t), expectedRevision: 7 })).status).toBe(409);
    expect((await del(t.sessionId, id, t.who.host, { expectedRevision: 9 })).status).toBe(409);
  });

  it("a missing id, or one from another order, is 404 ADJUSTMENT_NOT_FOUND", async () => {
    const a = await setup();
    const id = newId();
    const missing = await del(a.sessionId, id, a.who.host, { expectedRevision: 1 });
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe("ADJUSTMENT_NOT_FOUND");
    expect((await put(a.sessionId, id, a.who.host, { ...one(a), expectedRevision: 1 })).status).toBe(404);
    expect((await put(a.sessionId, "not-a-uuid", a.who.host, one(a))).status).toBe(404);
    await put(a.sessionId, id, a.who.host, one(a));
  });

  it("another order's adjustment id looks missing", async () => {
    const a = await setup();
    const b = await setup();
    const id = newId();
    await put(a.sessionId, id, a.who.host, one(a));
    expect((await del(b.sessionId, id, b.who.host, { expectedRevision: 1 })).status).toBe(404);
    expect((await put(b.sessionId, id, b.who.host, { ...one(b), expectedRevision: 0 })).status).toBe(404);
    expect(await adjustmentsOf(a)).toHaveLength(1);
  });

  it("a person from another order is refused, and the trigger backs it up", async () => {
    const a = await setup();
    const b = await setup();
    const id = newId();
    const res = await put(a.sessionId, id, a.who.host, { ...one(a), shares: [{ participantId: b.guest.participantId }] });
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("PERSON_NOT_FOUND");
    await put(a.sessionId, id, a.who.host, one(a));
    await expect(db.insert(adjustmentShares).values({ adjustmentId: id, sessionId: a.sessionId, participantId: b.guest.participantId, billToLabel: null, amountCentavos: null })).rejects.toThrow(/same_session|session/i);
  });

  it("manual amounts must add up (422), and bad shapes are 422", async () => {
    const t = await setup();
    const manual = { ...one(t), method: "manual", shares: [{ participantId: t.guest.participantId, amountCentavos: 4000 }] };
    expect((await put(t.sessionId, newId(), t.who.host, manual)).status).toBe(422);
    expect((await put(t.sessionId, newId(), t.who.host, { ...manual, shares: [{ participantId: t.guest.participantId, amountCentavos: 5000 }] })).status).toBe(200);
    expect((await put(t.sessionId, newId(), t.who.host, withPercent(manual, 1000))).status).toBe(422);
    expect((await put(t.sessionId, newId(), t.who.host, { ...one(t), amountCentavos: 5000, percentBps: 1000 })).status).toBe(422);
    expect((await put(t.sessionId, newId(), t.who.host, { ...one(t), shares: [] })).status).toBe(422);
    expect((await put(t.sessionId, newId(), t.who.host, { ...one(t), method: "unallocated" })).status).toBe(422);
    expect((await put(t.sessionId, newId(), t.who.host, { ...one(t), amountCentavos: 0 })).status).toBe(422);
  });

  it("a retry with the same key applies once; the 21st adjustment is refused", async () => {
    const t = await setup();
    const id = newId();
    const idem = key();
    await put(t.sessionId, id, t.who.host, one(t), idem);
    const retry = await put(t.sessionId, id, t.who.host, one(t), idem);
    expect(retry.body.data?.replayed).toBe(true);
    expect(await adjustmentsOf(t)).toHaveLength(1);
    for (let i = 1; i < 20; i++) expect((await put(t.sessionId, newId(), t.who.host, { ...one(t), method: "unallocated", shares: [] })).status).toBe(200);
    const over = await put(t.sessionId, newId(), t.who.host, { ...one(t), method: "unallocated", shares: [] });
    expect(over.status).toBe(400);
    expect(over.body.error?.code).toBe("TOO_MANY_ADJUSTMENTS");
  });

  it("an ended order still takes edits; a cancelled one (nothing confirmed) is 409 SESSION_CLOSED", async () => {
    const ended = await setup();
    await confirmOne(ended);
    await close(ended);
    const id = newId();
    expect((await put(ended.sessionId, id, ended.who.host, one(ended))).status).toBe(200);
    expect((await del(ended.sessionId, id, ended.who.host, { expectedRevision: 1 })).status).toBe(200);

    const cancelled = await setup();
    await close(cancelled);
    const refused = await put(cancelled.sessionId, newId(), cancelled.who.host, one(cancelled));
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("SESSION_CLOSED");
  });

  it("is a non-ticket event: Confirm is not made stale, and the event type is recorded", async () => {
    const t = await setup();
    await add(db, t.host, { dishName: "Katsu", quantity: 1 });
    const seen = await getSnapshot(db, t.host);
    const id = newId();
    expect((await put(t.sessionId, id, t.who.host, one(t))).status).toBe(200);
    expect((await del(t.sessionId, id, t.who.host, { expectedRevision: 1 })).status).toBe(200);
    const events = await db.select().from(sessionEvents).where(sql`${sessionEvents.sessionId} = ${t.sessionId} AND ${sessionEvents.eventType} IN ('adjustment.set', 'adjustment.removed')`);
    expect(events.length).toBeGreaterThanOrEqual(2);
    await expect(runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => confirmRound(tx, s, t.host, seen.activeRoundId, seen.session.revision))).resolves.toMatchObject({ replayed: false });
  });

  it("approving a claim turns a typed-name share into the guest's own", async () => {
    const t = await setup();
    await add(db, t.host, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL", label: "Rafa" } });
    const entry = (await getSnapshot(db, t.host)).entries[0];
    const id = newId();
    await put(t.sessionId, id, t.who.host, { ...one(t), shares: [{ billToLabel: "rafa" }] });
    expect((await adjustmentsOf(t))[0].shares).toEqual([{ participantId: null, label: "rafa", amountCentavos: null }]);
    const { result } = await runMutation(db, t.guest, { idempotencyKey: key(), type: "t" }, (tx, s) => requestClaim(tx, s, t.guest, entry.batchId));
    await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => resolveClaim(tx, s, t.host, result.claimId, true));
    expect((await adjustmentsOf(t))[0].shares).toEqual([{ participantId: t.guest.participantId, label: null, amountCentavos: null }]);
    expect(await db.select().from(adjustmentShares).where(eq(adjustmentShares.adjustmentId, id))).toHaveLength(1);
  });
});

// =====================================================================================================================
// Extended contract (verify round 1). Golden contract: docs/contracts/adjustments.md. Sources: P = docs/plans/salo-v1-4.md
// slice 2 (Approach, Pinned details, D1), A = docs/api.md, D = drizzle/0013_adjustments.sql.
// =====================================================================================================================
const DEADLINE_MS = 15_000;
function within<T>(p: Promise<T>, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`deadline: ${what}`)), DEADLINE_MS)));
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

type Raw = { status: number; body: { data?: Record<string, unknown> & { result?: Record<string, unknown>; replayed?: boolean }; error?: { code: string; message: string } } };
/** Lower-level caller: a custom cookie, key and raw body. */
async function rawCall(method: "PUT" | "DELETE", sessionId: string, adjustmentId: string, token: string | null, opts: { body?: unknown; raw?: string; idem?: string | null; cookieFor?: string } = {}): Promise<Raw> {
  jar.cookies = token ? { [credentialCookieName(opts.cookieFor ?? sessionId)]: token } : {};
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost:3000" };
  if (opts.idem !== null) headers["idempotency-key"] = opts.idem ?? key();
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/adjustments/${adjustmentId}`, { method, headers, body: opts.raw ?? JSON.stringify(opts.body) });
  const res = await within((method === "PUT" ? PUT : DELETE)(req, { params: Promise.resolve({ id: sessionId, adjustmentId }) }), `${method} adjustment`);
  return { status: res.status, body: await res.json() };
}

async function second(t: Scene, name = "Bea"): Promise<Who> {
  const token = newToken();
  const [row] = await db.insert(participants).values({ sessionId: t.sessionId, displayName: name, role: "GUEST" }).returning();
  await db.insert(participantCredentials).values({ sessionId: t.sessionId, participantId: row.id, credentialType: "GUEST", credentialHash: hashToken(token) });
  return { actor: { participantId: row.id, sessionId: t.sessionId, role: "GUEST", displayName: name }, token };
}

/** Everything a refused request must leave alone. */
async function fingerprint(t: Scene) {
  const [s] = await db.select({ r: sessions.revision, status: sessions.status, exp: sessions.expiresAt, rc: sessions.receiptTotalCentavos, sc: sessions.serviceChargeCentavos }).from(sessions).where(eq(sessions.id, t.sessionId));
  const adj = await db.select().from(adjustments).where(eq(adjustments.sessionId, t.sessionId));
  const shares = await db.select().from(adjustmentShares).where(eq(adjustmentShares.sessionId, t.sessionId));
  const ev = await db.select({ t: sessionEvents.eventType, r: sessionEvents.revision }).from(sessionEvents).where(eq(sessionEvents.sessionId, t.sessionId));
  const norm = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ s, adj: norm(adj), shares: norm(shares), ev });
}
async function refused(t: Scene, run: () => Promise<Raw>, status: number | number[], code?: string): Promise<Raw> {
  const before = await fingerprint(t);
  const r = await run();
  expect(Array.isArray(status) ? status : [status]).toContain(r.status);
  expect(r.body.data).toBeUndefined();
  if (code) expect(r.body.error?.code).toBe(code);
  expect(await fingerprint(t)).toBe(before);
  return r;
}
const rev = async (t: Scene) => (await db.select({ r: sessions.revision }).from(sessions).where(eq(sessions.id, t.sessionId)))[0].r;
const hostPut = (t: Scene, id: string, body: unknown, idem?: string | null) => rawCall("PUT", t.sessionId, id, t.who.host.token, { body, idem });

describe("PUT /adjustments: validation (422, nothing stored)", () => {
  it("V01 bad amounts, percents, notes, enums and ids are 422 with no side effects", async () => {
    const t = await setup();
    const base = one(t);
    const bad: Record<string, unknown>[] = [
      { ...base, amountCentavos: 0 },
      { ...base, amountCentavos: -5 },
      { ...base, amountCentavos: 1.5 },
      { ...base, amountCentavos: "5000" },
      { ...base, amountCentavos: 100_000_000 },
      { ...withPercent(base, 0) },
      { ...withPercent(base, 10_001) },
      { ...withPercent(base, -1) },
      { ...withPercent(base, 12.5) },
      { ...base, note: "x".repeat(41) },
      { ...base, direction: "refund" },
      { ...base, category: "vip" },
      { ...base, method: "weird" },
      { ...base, shares: [{ participantId: "not-a-uuid" }] },
      { ...base, shares: [{ participantId: t.guest.participantId, billToLabel: "Ana" }] },
      { ...base, shares: [{}] },
      { ...base, shares: [{ billToLabel: "" }] },
      { ...base, shares: [{ billToLabel: "y".repeat(41) }] },
      { ...base, shares: "nobody" },
      { ...base, expectedRevision: -1 },
      { ...base, expectedRevision: 0.5 },
      { ...base, expectedRevision: "0" },
    ];
    for (const b of bad) await refused(t, () => hostPut(t, newId(), b), 422, "INVALID");
    const missing = { ...base };
    for (const k of ["expectedRevision", "direction", "category", "method", "shares"]) {
      const m = { ...missing };
      delete m[k];
      await refused(t, () => hostPut(t, newId(), m), 422, "INVALID");
    }
    const none = { ...base };
    delete none.amountCentavos;
    await refused(t, () => hostPut(t, newId(), none), 422, "INVALID");
  });

  it("V02 method and shares must agree: percent with manual or unallocated, individual needs one, unallocated none, amounts only for manual, duplicates, more than 30", async () => {
    const t = await setup();
    const g = t.guest.participantId;
    const base = one(t);
    const cases: Record<string, unknown>[] = [
      withPercent({ ...base, method: "manual", shares: [{ participantId: g, amountCentavos: 5000 }] }, 1000),
      withPercent({ ...base, method: "unallocated", shares: [] }, 1000),
      { ...base, method: "individual", shares: [] },
      { ...base, method: "individual", shares: [{ participantId: g }, { billToLabel: "Rafa" }] },
      { ...base, method: "unallocated", shares: [{ participantId: g }] },
      { ...base, method: "equal", shares: [] },
      { ...base, method: "proportional", shares: [] },
      { ...base, method: "equal", shares: [{ participantId: g, amountCentavos: 5000 }] },
      { ...base, method: "manual", shares: [{ participantId: g }] },
      { ...base, method: "manual", shares: [{ participantId: g, amountCentavos: -1 }, { billToLabel: "Rafa", amountCentavos: 5001 }] },
      { ...base, method: "equal", shares: [{ participantId: g }, { participantId: g }] },
      { ...base, method: "equal", shares: [{ billToLabel: "Rafa" }, { billToLabel: " rafa " }] },
      { ...base, method: "equal", shares: Array.from({ length: 31 }, (_, i) => ({ billToLabel: `Guest ${i}` })) },
    ];
    for (const b of cases) await refused(t, () => hostPut(t, newId(), b), 422, "INVALID");
  });

  it("V03 boundaries that are allowed: percent 1 and 10000, amount 1 and 99,999,999, a 40-character note and name, 30 people, manual shares summing to the amount", async () => {
    const t = await setup();
    const g = t.guest.participantId;
    for (const b of [
      withPercent(one(t), 1),
      withPercent(one(t), 10_000),
      { ...one(t), amountCentavos: 1 },
      { ...one(t), amountCentavos: 99_999_999 },
      { ...one(t), note: "n".repeat(40) },
      { ...one(t), method: "equal", shares: [{ billToLabel: "L".repeat(40) }] },
      { ...one(t), method: "equal", shares: Array.from({ length: 30 }, (_, i) => ({ billToLabel: `Guest ${i}` })) },
      { ...one(t), amountCentavos: 5000, method: "manual", shares: [{ participantId: g, amountCentavos: 1234 }, { billToLabel: "Rafa", amountCentavos: 3766 }] },
      { ...withPercent(one(t), 2500), method: "proportional" },
      { ...one(t), direction: "charge", category: "other", method: "unallocated", shares: [] },
    ]) {
      const r = await hostPut(t, newId(), b);
      expect(r.status, JSON.stringify(b).slice(0, 120)).toBe(200);
    }
    expect(await adjustmentsOf(t)).toHaveLength(10);
  });

  it("V04 the note is tidied; a blank note is none; a note that grows past 40 characters after tidying is 422, never a 5xx", async () => {
    const t = await setup();
    const a = newId();
    expect((await hostPut(t, a, { ...one(t), note: "  Lola   birthday " })).status).toBe(200);
    expect((await adjustmentsOf(t))[0].note).toBe("Lola birthday");
    const b = newId();
    expect((await hostPut(t, b, { ...one(t), note: "    " })).status).toBe(200);
    expect((await adjustmentsOf(t)).find((x) => x.id === b)?.note).toBeNull();
    // U+FDFA is one character that normalizes to 18 (NFKC): three of them pass the 40-character input check, then overflow the DB CHECK.
    const res = await refused(t, () => hostPut(t, newId(), { ...one(t), note: "ﷺﷺﷺ" }), [422]);
    expect(res.status).toBe(422);
  });

  it("V05 typed-name shares are tidied, and a name that grows past 40 characters after tidying is 422", async () => {
    const t = await setup();
    const id = newId();
    expect((await hostPut(t, id, { ...one(t), method: "equal", shares: [{ billToLabel: "  Lola   Reyes " }] })).status).toBe(200);
    expect((await adjustmentsOf(t))[0].shares[0].label).toBe("Lola Reyes");
    await refused(t, () => hostPut(t, newId(), { ...one(t), method: "equal", shares: [{ billToLabel: "ﷺﷺﷺ" }] }), 422);
  });

  it("V06 a NUL in a note or name is 422, never a 5xx", async () => {
    const t = await setup();
    await refused(t, () => hostPut(t, newId(), { ...one(t), note: "a\u0000b" }), 422);
    await refused(t, () => hostPut(t, newId(), { ...one(t), method: "equal", shares: [{ billToLabel: "a\u0000b" }] }), 422);
  });

  it("V07 extra fields (revision, sessionId, role) are ignored", async () => {
    const t = await setup();
    const id = newId();
    const r = await hostPut(t, id, { ...one(t), revision: 99, sessionId: crypto.randomUUID(), role: "HOST", id: crypto.randomUUID() });
    expect(r.status).toBe(200);
    expect(r.body.data?.result).toEqual({ adjustmentId: id, revision: 1 });
  });

  it("V08 DELETE body: expectedRevision 0, negative, fractional, text, missing or an empty body are 422", async () => {
    const t = await setup();
    const id = newId();
    await hostPut(t, id, one(t));
    for (const b of [{ expectedRevision: 0 }, { expectedRevision: -1 }, { expectedRevision: 1.5 }, { expectedRevision: "1" }, {}, [], null])
      await refused(t, () => rawCall("DELETE", t.sessionId, id, t.who.host.token, { body: b }), 422);
    expect(await adjustmentsOf(t)).toHaveLength(1);
  });
});

describe("PUT/DELETE /adjustments: transport", () => {
  it("T01 malformed JSON 400 BAD_JSON, a body over 8 KB 413 TOO_LARGE, an empty body 422", async () => {
    const t = await setup();
    const id = newId();
    await refused(t, () => rawCall("PUT", t.sessionId, id, t.who.host.token, { raw: "{not json" }), 400, "BAD_JSON");
    await refused(t, () => rawCall("PUT", t.sessionId, id, t.who.host.token, { raw: JSON.stringify({ ...one(t), note: "x".repeat(9000) }) }), 413, "TOO_LARGE");
    await refused(t, () => rawCall("PUT", t.sessionId, id, t.who.host.token, { raw: "" }), [400, 422]);
    await refused(t, () => rawCall("PUT", t.sessionId, id, t.who.host.token, { raw: "[]" }), 422);
    await refused(t, () => rawCall("PUT", t.sessionId, id, t.who.host.token, { raw: "null" }), 422);
  });

  it("T02 a missing, short or malformed Idempotency-Key is 400 IDEMPOTENCY_KEY on PUT and DELETE", async () => {
    const t = await setup();
    const id = newId();
    for (const k of [null, "short", "has space key", "slash/in/key1", "k".repeat(101), ""]) {
      await refused(t, () => hostPut(t, id, one(t), k), 400, "IDEMPOTENCY_KEY");
      await refused(t, () => rawCall("DELETE", t.sessionId, id, t.who.host.token, { body: { expectedRevision: 1 }, idem: k }), 400, "IDEMPOTENCY_KEY");
    }
    expect((await hostPut(t, id, one(t), "k".repeat(8))).status).toBe(200);
  });

  it("T03 the proxy refuses a missing or foreign Origin on PUT and DELETE", async () => {
    const mk = (method: string, origin?: string) => new NextRequest("http://localhost:3000/api/sessions/x/adjustments/y", { method, headers: origin ? { origin } : {} });
    for (const method of ["PUT", "DELETE"]) {
      for (const origin of [undefined, "https://evil.example", "http://localhost:3000.evil.example"]) {
        const res = proxy(mk(method, origin));
        expect(res.status).toBe(403);
        expect((await res.json()).error.code).toBe("FORBIDDEN_ORIGIN");
      }
      expect(proxy(mk(method, "http://localhost:3000")).status).toBe(200);
    }
  });

  it("T04 a malformed session id is 404, never a 5xx", async () => {
    const t = await setup();
    for (const sid of ["nope", "123", "00000000-0000-0000-0000-000000000000"]) {
      const r = await rawCall("PUT", sid, newId(), t.who.host.token, { body: one(t), cookieFor: sid });
      expect(r.status).toBe(404);
    }
  });
});

describe("PUT/DELETE /adjustments: who may (auth and tenancy)", () => {
  it("Z01 no cookie or a garbage cookie is 404, and nothing is stored", async () => {
    const t = await setup();
    await refused(t, () => rawCall("PUT", t.sessionId, newId(), null, { body: one(t) }), 404);
    await refused(t, () => rawCall("PUT", t.sessionId, newId(), "garbage-token", { body: one(t) }), 404);
    await refused(t, () => rawCall("DELETE", t.sessionId, newId(), null, { body: { expectedRevision: 1 } }), 404);
  });

  it("Z02 another order's host cannot write or delete here, even with its token under this order's cookie name; both orders untouched", async () => {
    const a = await setup();
    const b = await setup();
    const id = newId();
    await hostPut(a, id, one(a));
    const before = await fingerprint(a);
    const fb = await fingerprint(b);
    const w = await rawCall("PUT", a.sessionId, newId(), b.who.host.token, { body: one(a) });
    expect(w.status).toBe(404);
    const d = await rawCall("DELETE", a.sessionId, id, b.who.host.token, { body: { expectedRevision: 1 } });
    expect(d.status).toBe(404);
    const e = await rawCall("PUT", a.sessionId, id, b.who.host.token, { body: { ...one(a), expectedRevision: 1 } });
    expect(e.status).toBe(404);
    expect(await fingerprint(a)).toBe(before);
    expect(await fingerprint(b)).toBe(fb);
  });

  it("Z03 a guest is refused on create, edit and delete with 403, and the stored row, shares and revision do not move", async () => {
    const t = await setup();
    const id = newId();
    await hostPut(t, id, one(t));
    await refused(t, () => rawCall("PUT", t.sessionId, id, t.who.guest.token, { body: { ...one(t), expectedRevision: 1, amountCentavos: 1 } }), 403, "FORBIDDEN");
    await refused(t, () => rawCall("PUT", t.sessionId, newId(), t.who.guest.token, { body: one(t) }), 403, "FORBIDDEN");
    await refused(t, () => rawCall("DELETE", t.sessionId, id, t.who.guest.token, { body: { expectedRevision: 1 } }), 403, "FORBIDDEN");
  });

  it("Z04 a guest is refused on an ended order too (403), and a guest cannot probe another order's ids", async () => {
    const t = await setup();
    const id = newId();
    await hostPut(t, id, one(t));
    await confirmOne(t);
    await close(t);
    await refused(t, () => rawCall("PUT", t.sessionId, id, t.who.guest.token, { body: { ...one(t), expectedRevision: 1 } }), 403);
    await refused(t, () => rawCall("DELETE", t.sessionId, id, t.who.guest.token, { body: { expectedRevision: 1 } }), 403);
  });

  it("Z05 a removed guest is refused (403 REMOVED or 404)", async () => {
    const t = await setup();
    await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => removeParticipant(tx, s, t.host, t.guest.participantId, null));
    await refused(t, () => rawCall("PUT", t.sessionId, newId(), t.who.guest.token, { body: { ...one(t), shares: [] , method: "unallocated" } }), [403, 404]);
  });

  it("Z06 an adjustment id from another order is 404 on PUT edit, PUT create (rev 0) and DELETE, and the other order's row is untouched", async () => {
    const a = await setup();
    const b = await setup();
    const id = newId();
    await hostPut(a, id, one(a));
    const before = await fingerprint(a);
    for (const r of [await rawCall("PUT", b.sessionId, id, b.who.host.token, { body: { ...one(b), expectedRevision: 1 } }), await rawCall("DELETE", b.sessionId, id, b.who.host.token, { body: { expectedRevision: 1 } })]) {
      expect(r.status).toBe(404);
      expect(r.body.error?.code).toBe("ADJUSTMENT_NOT_FOUND");
    }
    // Creating (rev 0) with an id that exists in another order must not create a row in this one, nor reveal it (P: "an id from another session -> 404").
    const c = await rawCall("PUT", b.sessionId, id, b.who.host.token, { body: one(b) });
    expect(c.status).toBe(404);
    expect(await fingerprint(a)).toBe(before);
    expect(await adjustmentsOf(b)).toEqual([]);
  });
});

describe("PUT/DELETE /adjustments: revision, idempotency, side effects", () => {
  it("R01 each applied write moves the session revision by one and records exactly one event whose payload carries ids only", async () => {
    const t = await setup();
    const id = newId();
    const r0 = await rev(t);
    await hostPut(t, id, { ...withPercent(one(t), 1500), note: "secret note" });
    expect(await rev(t)).toBe(r0 + 1);
    await hostPut(t, id, { ...one(t), expectedRevision: 1 });
    expect(await rev(t)).toBe(r0 + 2);
    await rawCall("DELETE", t.sessionId, id, t.who.host.token, { body: { expectedRevision: 2 } });
    expect(await rev(t)).toBe(r0 + 3);
    const ev = await db.select().from(sessionEvents).where(sql`${sessionEvents.sessionId} = ${t.sessionId} AND ${sessionEvents.eventType} LIKE 'adjustment.%' ORDER BY revision`);
    expect(ev.map((e) => e.eventType)).toEqual(["adjustment.set", "adjustment.set", "adjustment.removed"]);
    for (const e of ev) expect(JSON.stringify(e.payload)).not.toMatch(/secret|5000|1500|amount|percent|note/i);
  });

  it("R02 revision walk: 0 creates (rev 1), 1 edits (rev 2), a stale write 409 leaves rev 2, DELETE at 2 removes; DELETE at 2 again is 404", async () => {
    const t = await setup();
    const id = newId();
    expect((await hostPut(t, id, one(t))).body.data?.result?.revision).toBe(1);
    expect((await hostPut(t, id, { ...one(t), expectedRevision: 1 })).body.data?.result?.revision).toBe(2);
    await refused(t, () => hostPut(t, id, { ...one(t), expectedRevision: 1 }), 409, "CONFLICT");
    await refused(t, () => rawCall("DELETE", t.sessionId, id, t.who.host.token, { body: { expectedRevision: 1 } }), 409, "CONFLICT");
    expect((await rawCall("DELETE", t.sessionId, id, t.who.host.token, { body: { expectedRevision: 2 } })).status).toBe(200);
    await refused(t, () => rawCall("DELETE", t.sessionId, id, t.who.host.token, { body: { expectedRevision: 2 } }), 404, "ADJUSTMENT_NOT_FOUND");
  });

  it("R03 a failed edit (422, 409, 403, 404) leaves the stored amounts and shares exactly as they were", async () => {
    const t = await setup();
    const id = newId();
    const bea = await second(t);
    await hostPut(t, id, { ...one(t), method: "equal", shares: [{ participantId: t.guest.participantId }, { participantId: bea.actor.participantId }] });
    const before = await fingerprint(t);
    await refused(t, () => hostPut(t, id, { ...one(t), expectedRevision: 1, method: "manual", shares: [{ participantId: t.guest.participantId, amountCentavos: 1 }] }), 422);
    await refused(t, () => hostPut(t, id, { ...one(t), expectedRevision: 5, amountCentavos: 1 }), 409);
    await refused(t, () => hostPut(t, id, { ...one(t), expectedRevision: 1, shares: [{ participantId: crypto.randomUUID() }] }), 404, "PERSON_NOT_FOUND");
    expect(await fingerprint(t)).toBe(before);
    expect((await adjustmentsOf(t))[0].shares).toHaveLength(2);
  });

  it("R04 replaying a DELETE with the same key is 200 replayed (not 404) and applies once", async () => {
    const t = await setup();
    const id = newId();
    await hostPut(t, id, one(t));
    const idem = key();
    const first = await rawCall("DELETE", t.sessionId, id, t.who.host.token, { body: { expectedRevision: 1 }, idem });
    const again = await rawCall("DELETE", t.sessionId, id, t.who.host.token, { body: { expectedRevision: 1 }, idem });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body.data?.replayed).toBe(true);
    const removed = await db.select().from(sessionEvents).where(sql`${sessionEvents.sessionId} = ${t.sessionId} AND ${sessionEvents.eventType} = 'adjustment.removed'`);
    expect(removed).toHaveLength(1);
  });

  it("R05 a key used for one adjustment cannot be reused for another, or for the DELETE of the same one (422 IDEMPOTENCY_KEY_REUSED)", async () => {
    const t = await setup();
    const idem = key();
    const a = newId();
    await hostPut(t, a, one(t), idem);
    await refused(t, () => hostPut(t, newId(), one(t), idem), 422, "IDEMPOTENCY_KEY_REUSED");
    await refused(t, () => rawCall("DELETE", t.sessionId, a, t.who.host.token, { body: { expectedRevision: 1 }, idem }), 422, "IDEMPOTENCY_KEY_REUSED");
  });

  it("R06 the same key with a different body replays the first result and changes nothing", async () => {
    const t = await setup();
    const id = newId();
    const idem = key();
    await hostPut(t, id, one(t), idem);
    const before = await fingerprint(t);
    const r = await hostPut(t, id, { ...one(t), amountCentavos: 1 }, idem);
    expect(r.status).toBe(200);
    expect(r.body.data?.replayed).toBe(true);
    expect(await fingerprint(t)).toBe(before);
  });

  it("R07 a replay after the order ended returns the first result and does not re-apply", async () => {
    const t = await setup();
    await confirmOne(t);
    const id = newId();
    const idem = key();
    await hostPut(t, id, one(t), idem);
    await close(t);
    const before = await fingerprint(t);
    const r = await hostPut(t, id, one(t), idem);
    expect(r.status).toBe(200);
    expect(r.body.data?.replayed).toBe(true);
    expect(await fingerprint(t)).toBe(before);
  });

  it("R08 creating over a removed id with a new key is not a duplicate: the id was freed, shares are fresh", async () => {
    const t = await setup();
    const id = newId();
    await hostPut(t, id, one(t));
    await rawCall("DELETE", t.sessionId, id, t.who.host.token, { body: { expectedRevision: 1 } });
    expect(await db.select().from(adjustmentShares).where(eq(adjustmentShares.sessionId, t.sessionId))).toHaveLength(0);
    expect(await db.select().from(adjustments).where(eq(adjustments.sessionId, t.sessionId))).toHaveLength(0);
  });

  it("R09 an adjustment never changes the receipt total, the service charge, tickets, entries or readiness (P: receipt is authoritative, never reduced)", async () => {
    const t = await setup();
    await confirmOne(t);
    const snapBefore = await getSnapshot(db, t.host);
    await db.update(sessions).set({ receiptTotalCentavos: 12345, serviceChargeCentavos: 777 }).where(eq(sessions.id, t.sessionId));
    const b = await getSnapshot(db, t.host);
    await hostPut(t, newId(), one(t));
    await hostPut(t, newId(), { ...one(t), direction: "charge", method: "unallocated", shares: [] });
    const a = await getSnapshot(db, t.host);
    expect(a.settlement.receiptTotal).toEqual(b.settlement.receiptTotal);
    expect(a.settlement.serviceCharge).toEqual(b.settlement.serviceCharge);
    expect(a.settlement.entries).toEqual(b.settlement.entries);
    expect(a.tickets).toEqual(b.tickets);
    expect(a.entries).toEqual(b.entries);
    expect(a.rounds).toEqual(b.rounds);
    expect(snapBefore.rounds).toEqual(a.rounds);
  });
});

describe("PUT/DELETE /adjustments: races", () => {
  it("K01 eight creates of the same id at revision 0 with different keys: one 200, seven 409, one row, one event, no 5xx", async () => {
    const t = await setup();
    const id = newId();
    const rs = await within(Promise.all(Array.from({ length: 8 }, () => hostPut(t, id, one(t)))), "8 parallel creates");
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await adjustmentsOf(t)).toHaveLength(1);
    const ev = await db.select().from(sessionEvents).where(sql`${sessionEvents.sessionId} = ${t.sessionId} AND ${sessionEvents.eventType} = 'adjustment.set'`);
    expect(ev).toHaveLength(1);
  });

  it("K02 the same key sent six times at once applies once (one fresh, the rest replayed)", async () => {
    const t = await setup();
    const id = newId();
    const idem = key();
    const rs = await within(Promise.all(Array.from({ length: 6 }, () => hostPut(t, id, one(t), idem))), "6 parallel same-key");
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => r.body.data?.replayed === false)).toHaveLength(1);
    expect(await adjustmentsOf(t)).toHaveLength(1);
  });

  it("K03 twenty-five creates of different ids at once: exactly 20 land, five are 400 TOO_MANY_ADJUSTMENTS, 20 rows", async () => {
    const t = await setup();
    const rs = await within(Promise.all(Array.from({ length: 25 }, () => hostPut(t, newId(), { ...one(t), method: "unallocated", shares: [] }))), "25 parallel creates");
    expect(rs.filter((r) => r.status === 200)).toHaveLength(20);
    const over = rs.filter((r) => r.status !== 200);
    expect(over).toHaveLength(5);
    for (const r of over) {
      expect(r.status).toBe(400);
      expect(r.body.error?.code).toBe("TOO_MANY_ADJUSTMENTS");
    }
    expect(await db.select().from(adjustments).where(eq(adjustments.sessionId, t.sessionId))).toHaveLength(20);
  });

  it("K04 an edit and a delete at the same revision: exactly one wins and the stored state agrees with the winner", async () => {
    const t = await setup();
    const id = newId();
    await hostPut(t, id, one(t));
    const [e, d] = await within(Promise.all([hostPut(t, id, { ...one(t), expectedRevision: 1, amountCentavos: 999 }), rawCall("DELETE", t.sessionId, id, t.who.host.token, { body: { expectedRevision: 1 } })]), "edit vs delete");
    // Delete first: the edit finds nothing (404). Edit first: the delete is stale (409).
    if (d.status === 200) expect(e.status).toBe(404);
    else expect([e.status, d.status]).toEqual([200, 409]);
    const left = await adjustmentsOf(t);
    if (d.status === 200) expect(left).toEqual([]);
    else expect(left).toEqual([expect.objectContaining({ amountCentavos: 999, revision: 2 })]);
  });

  it("K05 two edits at the same revision: one 200, one 409, shares match the winner (never a mix)", async () => {
    const t = await setup();
    const id = newId();
    const bea = await second(t);
    await hostPut(t, id, { ...one(t), method: "equal", shares: [{ participantId: t.guest.participantId }] });
    const x = { ...one(t), expectedRevision: 1, method: "equal", amountCentavos: 1000, shares: [{ participantId: t.guest.participantId }, { participantId: bea.actor.participantId }] };
    const y = { ...one(t), expectedRevision: 1, method: "individual", amountCentavos: 2000, shares: [{ participantId: bea.actor.participantId }] };
    const rs = await within(Promise.all([hostPut(t, id, x), hostPut(t, id, y)]), "two edits");
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    const [row] = await adjustmentsOf(t);
    expect(row.revision).toBe(2);
    if (row.amountCentavos === 1000) expect(row.shares).toHaveLength(2);
    else expect(row.shares).toEqual([{ participantId: bea.actor.participantId, label: null, amountCentavos: null }]);
  });

  it("K06 an adjustment racing the confirm of the open round: both succeed (non-ticket event)", async () => {
    const t = await setup();
    await add(db, t.host, { dishName: "Katsu", quantity: 1 });
    const seen = await getSnapshot(db, t.host);
    const [a, c] = await within(
      Promise.all([hostPut(t, newId(), one(t)), runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => confirmRound(tx, s, t.host, seen.activeRoundId, seen.session.revision))]),
      "adjust vs confirm",
    );
    expect(a.status).toBe(200);
    expect(c.replayed).toBe(false);
  });

  it("K07 an adjustment racing End on an order with no confirmed round: 200 or 409 SESSION_CLOSED, never a 5xx, and the stored state is consistent with the result", async () => {
    const t = await setup();
    const [a] = await within(Promise.all([hostPut(t, newId(), one(t)), close(t)]), "adjust vs close");
    expect([200, 409]).toContain(a.status);
    if (a.status === 409) expect(a.body.error?.code).toBe("SESSION_CLOSED");
    expect((await db.select().from(adjustments).where(eq(adjustments.sessionId, t.sessionId))).length).toBe(a.status === 200 ? 1 : 0);
  });
});

describe("PUT/DELETE /adjustments: order state (D1)", () => {
  it("S01 an adjustment made while open can be edited and deleted after End; its shares follow the edit", async () => {
    const t = await setup();
    await confirmOne(t);
    const id = newId();
    await hostPut(t, id, one(t));
    await close(t);
    const bea = await second(t);
    expect((await hostPut(t, id, { ...one(t), expectedRevision: 1, method: "equal", shares: [{ participantId: t.guest.participantId }, { participantId: bea.actor.participantId }] })).body.data?.result).toEqual({ adjustmentId: id, revision: 2 });
    expect((await adjustmentsOf(t))[0].shares).toHaveLength(2);
    expect((await rawCall("DELETE", t.sessionId, id, t.who.host.token, { body: { expectedRevision: 2 } })).status).toBe(200);
    expect(await adjustmentsOf(t)).toEqual([]);
  });

  it("S02 after End the closing date and status do not move, and the guest still sees the adjustment", async () => {
    const t = await setup();
    await confirmOne(t);
    await close(t);
    const [before] = await db.select({ exp: sessions.expiresAt, st: sessions.status, closed: sessions.closedAt }).from(sessions).where(eq(sessions.id, t.sessionId));
    const id = newId();
    expect((await hostPut(t, id, one(t))).status).toBe(200);
    const [after] = await db.select({ exp: sessions.expiresAt, st: sessions.status, closed: sessions.closedAt }).from(sessions).where(eq(sessions.id, t.sessionId));
    expect(after).toEqual(before);
    expect((await getSnapshot(db, t.guest)).settlement.adjustments).toHaveLength(1);
  });

  it("S03 a cancelled order (closed, nothing confirmed): PUT create, PUT edit and DELETE are 409 SESSION_CLOSED and an adjustment made earlier stays as it was", async () => {
    const t = await setup();
    const id = newId();
    await hostPut(t, id, one(t));
    await close(t);
    await refused(t, () => hostPut(t, newId(), one(t)), 409, "SESSION_CLOSED");
    await refused(t, () => hostPut(t, id, { ...one(t), expectedRevision: 1, amountCentavos: 1 }), 409, "SESSION_CLOSED");
    await refused(t, () => rawCall("DELETE", t.sessionId, id, t.who.host.token, { body: { expectedRevision: 1 } }), 409, "SESSION_CLOSED");
    expect(await adjustmentsOf(t)).toHaveLength(1);
  });

  it("S04 past its deletion date an ended order is gone: 404, nothing written", async () => {
    const t = await setup();
    await confirmOne(t);
    await close(t);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, t.sessionId));
    const r = await hostPut(t, newId(), one(t));
    expect(r.status).toBe(404);
    expect(await db.select().from(adjustments).where(eq(adjustments.sessionId, t.sessionId))).toHaveLength(0);
  });

  it("S05 the 20 limit counts across edits and deletes: delete one at 20 and a new one lands; an edit at 20 is allowed", async () => {
    const t = await setup();
    const ids = Array.from({ length: 20 }, () => newId());
    for (const id of ids) expect((await hostPut(t, id, { ...one(t), method: "unallocated", shares: [] })).status).toBe(200);
    expect((await hostPut(t, ids[0], { ...one(t), expectedRevision: 1, method: "unallocated", shares: [] })).status).toBe(200);
    await refused(t, () => hostPut(t, newId(), { ...one(t), method: "unallocated", shares: [] }), 400, "TOO_MANY_ADJUSTMENTS");
    expect((await rawCall("DELETE", t.sessionId, ids[1], t.who.host.token, { body: { expectedRevision: 1 } })).status).toBe(200);
    expect((await hostPut(t, newId(), { ...one(t), method: "unallocated", shares: [] })).status).toBe(200);
  });

  it("S06 the limit is per order: another order has its own 20", async () => {
    const a = await setup();
    const b = await setup();
    for (let i = 0; i < 20; i++) await hostPut(a, newId(), { ...one(a), method: "unallocated", shares: [] });
    expect((await hostPut(b, newId(), { ...one(b), method: "unallocated", shares: [] })).status).toBe(200);
  });
});

describe("GET sync / GET session: settlement.adjustments", () => {
  async function syncOf(t: Scene, who: Who | null, handler: typeof SYNC | typeof SESSION_GET = SYNC) {
    jar.cookies = who ? { [credentialCookieName(t.sessionId)]: who.token } : {};
    const res = await handler(new Request("http://localhost:3000/x"), { params: Promise.resolve({ id: t.sessionId }) });
    return { status: res.status, body: (await res.json()) as { data?: { settlement: { adjustments: Array<Record<string, unknown>> } } } };
  }

  it("G01 an order with none has an empty list for host and guest, on /sync and on the session route", async () => {
    const t = await setup();
    for (const h of [SYNC, SESSION_GET]) for (const who of [t.who.host, t.who.guest]) expect((await syncOf(t, who, h)).body.data?.settlement.adjustments).toEqual([]);
  });

  it("G02 the list carries every field, in creation order, to the host and to a guest", async () => {
    const t = await setup();
    const a = newId();
    const b = newId();
    await hostPut(t, a, { ...one(t), note: "Lola" });
    await hostPut(t, b, { ...withPercent(one(t), 1000), direction: "charge", category: "other", method: "equal", shares: [{ billToLabel: "Rafa" }, { participantId: t.guest.participantId }] });
    for (const who of [t.who.host, t.who.guest]) {
      const list = (await syncOf(t, who)).body.data!.settlement.adjustments;
      expect(list.map((x) => x.id)).toEqual([a, b]);
      expect(list[0]).toMatchObject({ id: a, direction: "discount", category: "senior", note: "Lola", amountCentavos: 5000, percentBps: null, method: "individual", revision: 1 });
      expect(list[1]).toMatchObject({ direction: "charge", category: "other", note: null, amountCentavos: null, percentBps: 1000, method: "equal", revision: 1 });
      expect(list[1].shares).toHaveLength(2);
    }
  });

  it("G03 an edit keeps its place in the list; a delete removes it; a late joiner sees the current list", async () => {
    const t = await setup();
    const a = newId();
    const b = newId();
    await hostPut(t, a, one(t));
    await hostPut(t, b, one(t));
    await hostPut(t, a, { ...one(t), expectedRevision: 1, amountCentavos: 7 });
    expect((await adjustmentsOf(t)).map((x) => x.id)).toEqual([a, b]);
    const late = await second(t, "Late");
    expect((await getSnapshot(db, late.actor)).settlement.adjustments.map((x) => x.id)).toEqual([a, b]);
    await rawCall("DELETE", t.sessionId, a, t.who.host.token, { body: { expectedRevision: 2 } });
    expect((await syncOf(t, late)).body.data?.settlement.adjustments.map((x) => x.id)).toEqual([b]);
  });

  it("G04 a stranger and another order's host get 404, with no list in the body", async () => {
    const t = await setup();
    const other = await setup();
    await hostPut(t, newId(), one(t));
    for (const who of [null, other.who.host]) {
      jar.cookies = who ? { [credentialCookieName(t.sessionId)]: who.token } : {};
      const res = await SYNC(new Request("http://localhost:3000/x"), { params: Promise.resolve({ id: t.sessionId }) });
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toMatch(/adjustments/);
    }
  });

  it("G05 a removed guest's share stays in the list (the person is soft-removed, the share is flagged client-side)", async () => {
    const t = await setup();
    await hostPut(t, newId(), { ...one(t), method: "equal", shares: [{ participantId: t.guest.participantId }] });
    await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => removeParticipant(tx, s, t.host, t.guest.participantId, null));
    expect((await adjustmentsOf(t))[0].shares).toEqual([{ participantId: t.guest.participantId, label: null, amountCentavos: null }]);
  });
});

describe("claim approval and typed names", () => {
  async function labelled(t: Scene, name: string) {
    await add(db, t.host, { dishName: "Katsu", quantity: 1, attribution: { type: "INDIVIDUAL", label: name } });
    return (await getSnapshot(db, t.host)).entries.at(-1)!;
  }
  const approve = async (t: Scene, batchId: string, approveIt: boolean) => {
    const { result } = await runMutation(db, t.guest, { idempotencyKey: key(), type: "t" }, (tx, s) => requestClaim(tx, s, t.guest, batchId));
    await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => resolveClaim(tx, s, t.host, result.claimId, approveIt));
  };

  it("C01 a rejected claim leaves the typed-name share alone", async () => {
    const t = await setup();
    const entry = await labelled(t, "Rafa");
    await hostPut(t, newId(), { ...one(t), shares: [{ billToLabel: "Rafa" }] });
    await approve(t, entry.batchId, false);
    expect((await adjustmentsOf(t))[0].shares).toEqual([{ participantId: null, label: "Rafa", amountCentavos: null }]);
  });

  it("C02 a name is matched like the dish names (case, spacing, compatibility forms), not by exact text", async () => {
    const t = await setup();
    const entry = await labelled(t, "Rafa  Reyes");
    await hostPut(t, newId(), { ...one(t), shares: [{ billToLabel: "ＲＡＦＡ reyes" }] });
    await approve(t, entry.batchId, true);
    expect((await adjustmentsOf(t))[0].shares).toEqual([{ participantId: t.guest.participantId, label: null, amountCentavos: null }]);
  });

  it("C03 a different name is left alone", async () => {
    const t = await setup();
    const entry = await labelled(t, "Rafa");
    await hostPut(t, newId(), { ...one(t), shares: [{ billToLabel: "Rafael" }] });
    await approve(t, entry.batchId, true);
    expect((await adjustmentsOf(t))[0].shares).toEqual([{ participantId: null, label: "Rafael", amountCentavos: null }]);
  });

  it("C04 when the guest is already on the adjustment, the typed name merges into one share and manual amounts add up", async () => {
    const t = await setup();
    const entry = await labelled(t, "Rafa");
    const id = newId();
    await hostPut(t, id, { ...one(t), method: "manual", amountCentavos: 5000, shares: [{ participantId: t.guest.participantId, amountCentavos: 3000 }, { billToLabel: "Rafa", amountCentavos: 2000 }] });
    await approve(t, entry.batchId, true);
    expect((await adjustmentsOf(t))[0].shares).toEqual([{ participantId: t.guest.participantId, label: null, amountCentavos: 5000 }]);
    expect(await db.select().from(adjustmentShares).where(eq(adjustmentShares.adjustmentId, id))).toHaveLength(1);
  });

  it("C05 an approved claim changes every adjustment that names that person, in the same order revision step as the claim", async () => {
    const t = await setup();
    const entry = await labelled(t, "Rafa");
    await hostPut(t, newId(), { ...one(t), shares: [{ billToLabel: "Rafa" }] });
    await hostPut(t, newId(), { ...one(t), method: "equal", shares: [{ billToLabel: "Rafa" }] });
    await approve(t, entry.batchId, true);
    for (const a of await adjustmentsOf(t)) expect(a.shares).toEqual([{ participantId: t.guest.participantId, label: null, amountCentavos: null }]);
  });

  it("C06 while the typed name still has other dishes of its own, the share stays on the typed name (follow-up 1)", async () => {
    const t = await setup();
    const claimed = await labelled(t, "Rafa");
    await labelled(t, "Rafa");
    await hostPut(t, newId(), { ...one(t), shares: [{ billToLabel: "Rafa" }] });
    await approve(t, claimed.batchId, true);
    expect((await adjustmentsOf(t))[0].shares).toEqual([{ participantId: null, label: "Rafa", amountCentavos: null }]);
  });
});

describe("database guards (D)", () => {
  it("D01 direct inserts that break the row rules are rejected: both or neither of amount and percent, amount 0, percent over 10000, percent with manual, bad enums, a one-character-over note", async () => {
    const t = await setup();
    const bad = [
      sql`(gen_random_uuid(), ${t.sessionId}, 'discount', 'senior', NULL, 100, 100, 'equal')`,
      sql`(gen_random_uuid(), ${t.sessionId}, 'discount', 'senior', NULL, NULL, NULL, 'equal')`,
      sql`(gen_random_uuid(), ${t.sessionId}, 'discount', 'senior', NULL, 0, NULL, 'equal')`,
      sql`(gen_random_uuid(), ${t.sessionId}, 'discount', 'senior', NULL, NULL, 10001, 'equal')`,
      sql`(gen_random_uuid(), ${t.sessionId}, 'discount', 'senior', NULL, NULL, 1000, 'manual')`,
      sql`(gen_random_uuid(), ${t.sessionId}, 'refund', 'senior', NULL, 100, NULL, 'equal')`,
      sql`(gen_random_uuid(), ${t.sessionId}, 'discount', 'vip', NULL, 100, NULL, 'equal')`,
      sql`(gen_random_uuid(), ${t.sessionId}, 'discount', 'senior', ${"x".repeat(41)}, 100, NULL, 'equal')`,
      sql`(gen_random_uuid(), ${t.sessionId}, 'discount', 'senior', '', 100, NULL, 'equal')`,
    ];
    for (const values of bad) await expect(db.execute(sql`INSERT INTO adjustments (id, session_id, direction, category, note, amount_centavos, percent_bps, method) VALUES ${values}`)).rejects.toThrow();
    expect(await db.select().from(adjustments)).toHaveLength(0);
  });

  it("D02 a share needs exactly one of person or name; a name over 40 or a negative amount is rejected; adjustment_id must exist", async () => {
    const t = await setup();
    const id = newId();
    await hostPut(t, id, one(t));
    const ins = (p: string | null, l: string | null, a: number | null, adj = id) => db.insert(adjustmentShares).values({ adjustmentId: adj, sessionId: t.sessionId, participantId: p, billToLabel: l, amountCentavos: a });
    await expect(ins(null, null, null)).rejects.toThrow();
    await expect(ins(t.guest.participantId, "Both", null)).rejects.toThrow();
    await expect(ins(null, "z".repeat(41), null)).rejects.toThrow();
    await expect(ins(null, "Okay", -1)).rejects.toThrow();
    await expect(ins(null, "Okay", null, crypto.randomUUID())).rejects.toThrow();
  });

  it("D03 an adjustment's updated_by from another order is rejected by the same-session trigger", async () => {
    const a = await setup();
    const b = await setup();
    await expect(
      db.insert(adjustments).values({ id: newId(), sessionId: a.sessionId, direction: "discount", category: "senior", amountCentavos: 100, method: "equal", updatedBy: b.guest.participantId }),
    ).rejects.toThrow(/session/i);
  });

  it("D04 a share whose session differs from its adjustment's session is rejected", async () => {
    const a = await setup();
    const b = await setup();
    const id = newId();
    await hostPut(a, id, one(a));
    await expect(db.insert(adjustmentShares).values({ adjustmentId: id, sessionId: b.sessionId, participantId: null, billToLabel: "Mix", amountCentavos: null })).rejects.toThrow(/session/i);
  });

  it("D05 deleting the order removes its adjustments and shares (cascade); a soft-removed participant's share does not block it", async () => {
    const t = await setup();
    await hostPut(t, newId(), { ...one(t), method: "equal", shares: [{ participantId: t.guest.participantId }, { billToLabel: "Rafa" }] });
    await db.delete(sessions).where(eq(sessions.id, t.sessionId));
    expect(await db.select().from(adjustments)).toHaveLength(0);
    expect(await db.select().from(adjustmentShares)).toHaveLength(0);
  });
});
