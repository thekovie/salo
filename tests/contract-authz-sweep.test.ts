/**
 * Authorization sweep: every mutating route handler under src/app/api, as a stranger (no cookie), a removed guest and a
 * plain guest. Drives the real handlers against the test database; only the cookie jar is faked.
 * A new POST/PUT/PATCH/DELETE handler that is missing from ROWS fails the guard test at the bottom.
 * Run: pnpm vitest run tests/contract-authz-sweep.test.ts
 */
import { eq } from "drizzle-orm";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string>, set: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined),
    set: (name: string, value: string) => {
      jar.set[name] = value;
    },
  }),
}));

import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { orderEntries, rounds, sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { setEntryRemoved } from "@/server/orders/entries";
import { removeParticipant, requestClaim } from "@/server/orders/people";
import { confirmRound, openRound, recordCorrection } from "@/server/orders/rounds";
import { joinSession } from "@/server/sessions/join";
import type { Actor } from "@/lib/permissions";
import { resetDb, testDb } from "./helpers/db";
import { add, key, newSession } from "./helpers/session";

const db = testDb();
beforeEach(async () => {
  jar.cookies = {};
  jar.set = {};
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

/** A table with a host, a plain guest, a second guest, a removed guest, and state every row can point at. */
async function world() {
  const { host, sessionId, token: hostToken } = await newSession(db);
  const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, sessionId));
  const join = async (name: string) => {
    const joined = await joinSession(db, code, name, sessionId);
    return { token: joined.token, actor: { participantId: joined.participantId, sessionId, role: "GUEST", displayName: name } as Actor };
  };
  const guest = await join("Jun");
  const other = await join("Liza");
  const gone = await join("Ria");
  const as = (actor: Actor) => <T,>(options: { type: string }, apply: Parameters<typeof runMutation<T>>[3]) => runMutation(db, actor, { idempotencyKey: key(), ...options }, apply);
  const revision = async () => (await db.select({ r: sessions.revision }).from(sessions).where(eq(sessions.id, sessionId)))[0].r;
  const batchOf = async (entryId: string) => (await db.select({ b: orderEntries.batchId, d: orderEntries.dishId }).from(orderEntries).where(eq(orderEntries.id, entryId)))[0];

  await as(host)({ type: "participant.remove" }, (tx, s) => removeParticipant(tx, s, host, gone.actor.participantId, null));
  const confirmed = (await add(db, host, { dishName: "Rice", quantity: 2, attribution: { type: "UNASSIGNED" } })).result.entryId;
  const [round1] = await db.select({ id: rounds.id }).from(rounds).where(eq(rounds.sessionId, sessionId));
  const reviewed = await revision();
  await as(host)({ type: "round.confirm" }, (tx, s) => confirmRound(tx, s, host, round1.id, reviewed));
  const round2 = (await as(host)({ type: "round.open" }, (tx, s) => openRound(tx, s, host))).result.roundId;

  const hostEntry = (await add(db, host, { dishName: "Soup", quantity: 1, attribution: { type: "UNASSIGNED" } })).result.entryId;
  const guestEntry = (await add(db, guest.actor, { dishName: "Fries", quantity: 1 })).result.entryId;
  const removedEntry = (await add(db, guest.actor, { dishName: "Pie", quantity: 1 })).result.entryId;
  await as(guest.actor)({ type: "entry.remove" }, (tx, s) => setEntryRemoved(tx, s, guest.actor, removedEntry, true));
  const correction = (await as(host)({ type: "correction.record" }, (tx, s) => recordCorrection(tx, s, host, { sourceEntryId: confirmed, type: "REPLACE", replacement: "Fried rice" }))).result.correctionId;
  const hostBatch = await batchOf(hostEntry);
  const claim = (await as(other.actor)({ type: "claim.request" }, (tx, s) => requestClaim(tx, s, other.actor, hostBatch.b))).result.claimId;

  return {
    sessionId,
    code,
    tokens: { host: hostToken, guest: guest.token, gone: gone.token },
    ids: { guestEntry, removedEntry, hostEntry, hostBatch: hostBatch.b, dish: hostBatch.d, round: round2, correction, claim, person: other.actor.participantId, adjustment: randomUUID(), receipt: randomUUID(), payment: randomUUID() },
  };
}
type World = Awaited<ReturnType<typeof world>>;

interface Row {
  /** Route file under src/app/api, then the HTTP method. */
  route: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path parameters beyond the session id, keyed by the [name] in the file path. */
  params?: (w: World) => Record<string, string>;
  body?: (w: World) => unknown;
  /** What a plain guest gets: 403 FORBIDDEN on host-only handlers, a 2xx where guests may act. */
  guest: "forbidden" | 200 | 201;
}

const money = { expectedRevision: 0, unitPriceCentavos: 1000 };
const person = (w: World) => ({ participantId: w.ids.person });
const ROWS: Row[] = [
  { route: "[id]/adjustments/[adjustmentId]/route.ts", method: "PUT", params: (w) => ({ adjustmentId: w.ids.adjustment }), body: (w) => ({ expectedRevision: 0, direction: "discount", category: "promo", amountCentavos: 1000, method: "individual", shares: [person(w)] }), guest: "forbidden" },
  { route: "[id]/adjustments/[adjustmentId]/route.ts", method: "DELETE", params: (w) => ({ adjustmentId: w.ids.adjustment }), body: () => ({ expectedRevision: 1 }), guest: "forbidden" },
  { route: "[id]/claims/[claimId]/approve/route.ts", method: "POST", params: (w) => ({ claimId: w.ids.claim }), guest: "forbidden" },
  { route: "[id]/claims/[claimId]/reject/route.ts", method: "POST", params: (w) => ({ claimId: w.ids.claim }), guest: "forbidden" },
  { route: "[id]/claims/route.ts", method: "POST", body: (w) => ({ batchId: w.ids.hostBatch }), guest: 201 },
  { route: "[id]/close/route.ts", method: "POST", guest: "forbidden" },
  { route: "[id]/corrections/[correctionId]/price/route.ts", method: "PUT", params: (w) => ({ correctionId: w.ids.correction }), body: () => money, guest: "forbidden" },
  { route: "[id]/corrections/[correctionId]/route.ts", method: "DELETE", params: (w) => ({ correctionId: w.ids.correction }), guest: "forbidden" },
  { route: "[id]/corrections/route.ts", method: "POST", body: (w) => ({ sourceEntryId: w.ids.hostEntry, type: "QUANTITY", quantity: 1 }), guest: "forbidden" },
  { route: "[id]/dishes/[dishId]/unavailable/route.ts", method: "POST", params: (w) => ({ dishId: w.ids.dish }), body: () => ({}), guest: "forbidden" },
  { route: "[id]/entries/[entryId]/restore/route.ts", method: "POST", params: (w) => ({ entryId: w.ids.removedEntry }), guest: 200 },
  { route: "[id]/entries/[entryId]/route.ts", method: "PATCH", params: (w) => ({ entryId: w.ids.guestEntry }), body: () => ({ expectedRevision: 1, quantity: 2 }), guest: 200 },
  { route: "[id]/entries/[entryId]/route.ts", method: "DELETE", params: (w) => ({ entryId: w.ids.guestEntry }), guest: 200 },
  { route: "[id]/entries/[entryId]/settlement/route.ts", method: "PUT", params: (w) => ({ entryId: w.ids.guestEntry }), body: () => money, guest: 200 },
  { route: "[id]/entries/route.ts", method: "POST", body: () => ({ dishName: "Tea", quantity: 1 }), guest: 201 },
  { route: "[id]/groups/route.ts", method: "PUT", body: () => ({ label: "Sweet tooth", memberIds: [] }), guest: 200 },
  { route: "[id]/host/route.ts", method: "PUT", body: (w) => person(w), guest: "forbidden" },
  { route: "[id]/me/route.ts", method: "PATCH", body: () => ({ displayName: "Boss" }), guest: "forbidden" },
  { route: "[id]/menu/route.ts", method: "PUT", body: () => ({ url: null }), guest: "forbidden" },
  { route: "[id]/notifications/read/route.ts", method: "POST", body: () => ({ all: true }), guest: 200 },
  { route: "[id]/participants/[pid]/cohost/route.ts", method: "PUT", params: (w) => ({ pid: w.ids.person }), body: () => ({ cohost: true }), guest: "forbidden" },
  { route: "[id]/participants/[pid]/remove/route.ts", method: "POST", params: (w) => ({ pid: w.ids.person }), body: () => ({}), guest: "forbidden" },
  { route: "[id]/participants/[pid]/restore/route.ts", method: "POST", params: (w) => ({ pid: w.ids.person }), guest: "forbidden" },
  { route: "[id]/payments/[paymentId]/route.ts", method: "PUT", params: (w) => ({ paymentId: w.ids.payment }), body: (w) => ({ payer: person(w), payee: null, amountCentavos: 1000, method: "cash" }), guest: "forbidden" },
  { route: "[id]/payments/[paymentId]/route.ts", method: "PATCH", params: (w) => ({ paymentId: w.ids.payment }), body: () => ({ payee: null }), guest: "forbidden" },
  { route: "[id]/payments/[paymentId]/route.ts", method: "DELETE", params: (w) => ({ paymentId: w.ids.payment }), guest: "forbidden" },
  { route: "[id]/prices/route.ts", method: "PUT", body: (w) => ({ dishId: w.ids.dish, variant: null, unitCentavos: 1000, expectedRevision: 0 }), guest: "forbidden" },
  { route: "[id]/readiness/route.ts", method: "PUT", body: () => ({ ready: true }), guest: 200 },
  { route: "[id]/receipt-total/route.ts", method: "PUT", body: () => ({ expectedRevision: 0, centavos: 1000 }), guest: "forbidden" },
  { route: "[id]/receipts/[receiptId]/route.ts", method: "PUT", params: (w) => ({ receiptId: w.ids.receipt }), body: (w) => ({ expectedRevision: 0, totalCentavos: null, people: [person(w)] }), guest: "forbidden" },
  { route: "[id]/receipts/[receiptId]/route.ts", method: "DELETE", params: (w) => ({ receiptId: w.ids.receipt }), body: () => ({ expectedRevision: 1 }), guest: "forbidden" },
  { route: "[id]/rounds/[roundId]/confirm/route.ts", method: "POST", params: (w) => ({ roundId: w.ids.round }), body: () => ({ expectedRevision: 0 }), guest: "forbidden" },
  { route: "[id]/rounds/route.ts", method: "POST", guest: "forbidden" },
  { route: "[id]/route.ts", method: "PATCH", body: () => ({ title: "New name" }), guest: "forbidden" },
  { route: "[id]/service-charge/route.ts", method: "PUT", body: () => ({ expectedRevision: 0, centavos: 1000 }), guest: "forbidden" },
  { route: "[id]/serving/route.ts", method: "POST", body: (w) => ({ roundId: w.ids.round, lineKey: "line", expectedServed: 0, delta: 1 }), guest: "forbidden" },
];

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const API = "src/app/api/";
const modules: Record<string, Record<string, Handler>> = Object.fromEntries(await Promise.all(globSync(`${API}**/route.ts`).map(async (file) => [file.slice(API.length), (await import(/* @vite-ignore */ resolve(file))) as Record<string, Handler>])));
const handlerOf = (route: string, method: string) => modules[`sessions/${route}`][method];

async function call(row: Row, w: World, token: string | null) {
  const params = { id: w.sessionId, ...row.params?.(w) };
  const path = row.route.replace("/route.ts", "").replace(/\[(\w+)\]/g, (_, name: string) => params[name as keyof typeof params]);
  jar.cookies = token ? { [credentialCookieName(w.sessionId)]: token } : {};
  const body = row.body?.(w);
  const req = new Request(`http://localhost:3000/api/sessions/${path}`, {
    method: row.method,
    headers: { "content-type": "application/json", origin: "http://localhost:3000", "idempotency-key": key() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const res = await within(handlerOf(row.route, row.method)(req, { params: Promise.resolve(params) }), `${row.method} ${path}`);
  const json = (await res.json()) as { error?: { code: string } };
  return { status: res.status, code: json.error?.code };
}

describe("every mutating handler, by who is asking", () => {
  it.each(ROWS.map((r) => [`${r.method} ${r.route}`, r] as const))("%s", async (_name, row) => {
    const w = await world();
    expect(await call(row, w, null)).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(await call(row, w, w.tokens.gone)).toEqual({ status: 403, code: "REMOVED" });
    const guest = await call(row, w, w.tokens.guest);
    if (row.guest === "forbidden") expect(guest).toEqual({ status: 403, code: "FORBIDDEN" });
    else expect(guest).toEqual({ status: row.guest, code: undefined });
  });

  it("a guest cannot price the host's dish or bill a dish to someone", async () => {
    const w = await world();
    const settle = { route: "[id]/entries/[entryId]/settlement/route.ts", method: "PUT", params: (x: World) => ({ entryId: x.ids.hostEntry }) } as const;
    const forbidden = { status: 403, code: "FORBIDDEN" };
    expect(await call({ ...settle, body: () => money, guest: "forbidden" }, w, w.tokens.guest)).toEqual(forbidden);
    expect(await call({ ...settle, body: (x) => ({ expectedRevision: 0, billTo: person(x) }), guest: "forbidden" }, w, w.tokens.guest)).toEqual(forbidden);
  });
});

describe("handlers without a session cookie", () => {
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`http://localhost:3000${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...headers }, body: JSON.stringify(body) });
  const read = async (res: Response) => ({ status: res.status, code: ((await res.json()) as { error?: { code: string } }).error?.code });

  it("POST /api/sessions starts an order and sets the host cookie; a bad body is refused", async () => {
    const { POST } = await import("@/app/api/sessions/route");
    const res = await within(POST(post("/api/sessions", { title: "Friday" })), "create");
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { id: string } };
    expect(Object.keys(jar.set)).toEqual([credentialCookieName(data.id)]);
    expect(await read(await within(POST(post("/api/sessions", { title: "x".repeat(200) })), "create long"))).toMatchObject({ status: 422 });
  });

  it("POST /join makes a guest, never a host; a wrong code or name is refused", async () => {
    const w = await world();
    const { POST } = await import("@/app/api/sessions/[id]/join/route");
    const ctx = { params: Promise.resolve({ id: w.sessionId }) };
    const res = await within(POST(post(`/api/sessions/${w.sessionId}/join`, { code: w.code, displayName: "Newbie" }), ctx), "join");
    expect(res.status).toBe(201);
    expect(jar.set[credentialCookieName(w.sessionId)]).toBeTruthy();
    expect(await read(await within(POST(post(`/api/sessions/${w.sessionId}/join`, { code: "ZZZZZZ", displayName: "Newbie" }), ctx), "join bad code"))).toEqual({ status: 404, code: "INVITE_NOT_FOUND" });
    expect(await read(await within(POST(post(`/api/sessions/${w.sessionId}/join`, { code: w.code, displayName: "" }), ctx), "join no name"))).toMatchObject({ status: 422 });
  });
});

describe("guard", () => {
  const WRITES = ["POST", "PUT", "PATCH", "DELETE"];
  const tabled = new Set(ROWS.map((r) => `sessions/${r.route}:${r.method}`));
  const exported = Object.entries(modules).flatMap(([path, mod]) => WRITES.filter((m) => typeof mod[m] === "function").map((m) => `${path}:${m}`));

  it("every POST/PUT/PATCH/DELETE under src/app/api has a row (create and join have their own cases)", () => {
    const own = new Set(["sessions/[id]/join/route.ts:POST", "sessions/route.ts:POST"]);
    const missing = exported.filter((e) => !tabled.has(e) && !own.has(e));
    expect(missing).toEqual([]);
  });

  it("every row names a handler that exists", () => {
    expect([...tabled, "sessions/[id]/join/route.ts:POST", "sessions/route.ts:POST"].filter((t) => !exported.includes(t))).toEqual([]);
  });
});
