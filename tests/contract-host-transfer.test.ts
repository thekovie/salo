/**
 * Contract tests for PUT /api/sessions/:id/host (hand the order to another guest). Golden contract: docs/contracts/host-transfer.md.
 * Drives the real route handler against the real test database; only the cookie jar is faked.
 * Run: pnpm vitest run tests/contract-host-transfer.test.ts
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { PUT as COHOST } from "@/app/api/sessions/[id]/participants/[pid]/cohost/route";
import { PUT } from "@/app/api/sessions/[id]/host/route";
import { notificationText } from "@/lib/notifications";
import type { Actor } from "@/lib/permissions";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { entryClaims, orderBatches, participants, sessionEvents, sessions } from "@/server/db/schema";
import { loadNotifications } from "@/server/notifications";
import { NON_TICKET_EVENTS } from "@/server/orders/settlement";
import { removeParticipant, requestClaim } from "@/server/orders/people";
import { closeSession } from "@/server/orders/rounds";
import { runMutation } from "@/server/mutations";
import { joinSession } from "@/server/sessions/join";
import { getSnapshot } from "@/server/sessions/snapshot";
import { randomUUID } from "node:crypto";
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

const DEADLINE_MS = 15_000;
function within<T>(p: Promise<T>, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`deadline: ${what}`)), DEADLINE_MS)));
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

type Body = { data?: { result: { hostId: string }; revision: number; replayed: boolean }; error?: { code: string } };
async function put(sessionId: string, token: string | null, payload: unknown, idem: string = key()) {
  jar.cookies = token ? { [credentialCookieName(sessionId)]: token } : {};
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/host`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", "idempotency-key": idem },
    body: JSON.stringify(payload),
  });
  const res = await within(PUT(req, { params: Promise.resolve({ id: sessionId }) }), "PUT host");
  return { status: res.status, body: (await res.json()) as Body };
}
async function cohost(sessionId: string, token: string, pid: string) {
  jar.cookies = { [credentialCookieName(sessionId)]: token };
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/participants/${pid}/cohost`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", "idempotency-key": key() },
    body: JSON.stringify({ cohost: true }),
  });
  const res = await within(COHOST(req, { params: Promise.resolve({ id: sessionId, pid }) }), "PUT cohost");
  return { status: res.status, code: ((await res.json()) as Body).error?.code };
}

/** As slice 3's R01: the request is authenticated, queues behind the session lock, and `during` changes state before it runs. */
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

async function table() {
  const { host, sessionId, token } = await newSession(db);
  const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, sessionId));
  const guest = async (name: string) => {
    const joined = await joinSession(db, code, name, sessionId);
    return { actor: (await resolveActor(db, sessionId, joined.token)) as Actor, token: joined.token };
  };
  return { host, sessionId, hostToken: token, jun: await guest("Jun"), liza: await guest("Liza") };
}
type T = Awaited<ReturnType<typeof table>>;
const row = async (pid: string) => (await db.select({ role: participants.role, cohostAt: participants.cohostAt, name: participants.displayName }).from(participants).where(eq(participants.id, pid)))[0];
const hosts = async (sessionId: string) => (await db.select({ id: participants.id }).from(participants).where(sql`${participants.sessionId} = ${sessionId} AND ${participants.role} = 'HOST'`)).map((r) => r.id);
const events = async (sessionId: string) => await db.select({ t: sessionEvents.eventType, p: sessionEvents.payload }).from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId)).orderBy(sessionEvents.revision);
const notices = async (who: Actor) => (await loadNotifications(db, who)).items.filter((n) => n.type === "host.transferred");
const pid = (g: T["jun"]) => g.actor.participantId;
const code = (r: { status: number; body: Body }) => [r.status, r.body.error?.code];

describe("PUT /host", () => {
  it("H01 the host hands over: roles swap, one HOST, the new host's co-host mark and the old host's are cleared, event carries ids only", async () => {
    const t = await table();
    expect((await cohost(t.sessionId, t.hostToken, pid(t.jun))).status).toBe(200);
    const r = await put(t.sessionId, t.hostToken, { participantId: pid(t.jun) });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ result: { hostId: pid(t.jun) }, replayed: false });
    expect(await hosts(t.sessionId)).toEqual([pid(t.jun)]);
    expect(await row(pid(t.jun))).toMatchObject({ role: "HOST", cohostAt: null });
    expect(await row(t.host.participantId)).toMatchObject({ role: "GUEST", cohostAt: null });
    expect((await getSnapshot(db, (await resolveActor(db, t.sessionId, t.hostToken)) as Actor)).me.role).toBe("GUEST");
    expect((await events(t.sessionId)).slice(-1)).toEqual([{ t: "host.transferred", p: { fromId: t.host.participantId, toId: pid(t.jun) } }]);
    expect(NON_TICKET_EVENTS).toContain("host.transferred");
  });

  it("H02 a guest or co-host hands over -> 403 FORBIDDEN; nothing changes", async () => {
    const t = await table();
    await cohost(t.sessionId, t.hostToken, pid(t.jun));
    for (const who of [t.liza, t.jun]) expect(code(await put(t.sessionId, who.token, { participantId: pid(t.liza) }))).toEqual([403, "FORBIDDEN"]);
    expect(await hosts(t.sessionId)).toEqual([t.host.participantId]);
  });

  it("H03 to yourself -> 422 ALREADY_HOST", async () => {
    const t = await table();
    expect(code(await put(t.sessionId, t.hostToken, { participantId: t.host.participantId }))).toEqual([422, "ALREADY_HOST"]);
  });

  it("H04 a removed guest -> 409 ALREADY_REMOVED, never a CHECK error", async () => {
    const t = await table();
    await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => removeParticipant(tx, s, t.host, pid(t.liza), null));
    expect(code(await put(t.sessionId, t.hostToken, { participantId: pid(t.liza) }))).toEqual([409, "ALREADY_REMOVED"]);
    expect(await hosts(t.sessionId)).toEqual([t.host.participantId]);
  });

  it("H05 unknown, foreign or typed person -> 404 PERSON_NOT_FOUND", async () => {
    const t = await table();
    const other = await table();
    for (const p of [randomUUID(), pid(other.jun), "Jun"]) expect(code(await put(t.sessionId, t.hostToken, { participantId: p }))).toEqual([404, "PERSON_NOT_FOUND"]);
  });

  it("H06 bad body -> 422; no cookie -> 404", async () => {
    const t = await table();
    expect((await put(t.sessionId, t.hostToken, {})).status).toBe(422);
    expect((await put(t.sessionId, null, { participantId: pid(t.jun) })).status).toBe(404);
  });

  it("H07 an ended order -> 409 SESSION_CLOSED", async () => {
    const t = await table();
    await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => closeSession(tx, s, t.host));
    expect(code(await put(t.sessionId, t.hostToken, { participantId: pid(t.jun) }))).toEqual([409, "SESSION_CLOSED"]);
  });

  it("H08 a retried key replays the same result and tells the new host once", async () => {
    const t = await table();
    const idem = key();
    const one = await put(t.sessionId, t.hostToken, { participantId: pid(t.jun) }, idem);
    const two = await put(t.sessionId, t.hostToken, { participantId: pid(t.jun) }, idem);
    expect([one.body.data?.replayed, two.body.data?.replayed, two.body.data?.revision]).toEqual([false, true, one.body.data?.revision]);
    expect(await notices(t.jun.actor)).toHaveLength(1);
  });

  it("H09 the old host's later write is refused: 403 FORBIDDEN", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, { participantId: pid(t.jun) });
    expect(await cohost(t.sessionId, t.hostToken, pid(t.liza))).toEqual({ status: 403, code: "FORBIDDEN" });
  });

  it("H10 a write already in flight from the old host -> 403 ROLE_CHANGED; the new host's write lands", async () => {
    const t = await table();
    const r = await betweenAuthAndLock(
      t.sessionId,
      async (tx) => {
        await tx.execute(sql`UPDATE participants SET role = 'GUEST' WHERE id = ${t.host.participantId}`);
        await tx.execute(sql`UPDATE participants SET role = 'HOST' WHERE id = ${pid(t.jun)}`);
      },
      () => put(t.sessionId, t.hostToken, { participantId: pid(t.liza) }),
    );
    expect(code(r)).toEqual([403, "ROLE_CHANGED"]);
    expect(await hosts(t.sessionId)).toEqual([pid(t.jun)]);
    expect((await put(t.sessionId, t.jun.token, { participantId: t.host.participantId })).status).toBe(200);
  });

  it("H11 two transfers at once: exactly one HOST, the other is refused", async () => {
    const t = await table();
    const [a, b] = await Promise.all([put(t.sessionId, t.hostToken, { participantId: pid(t.jun) }), put(t.sessionId, t.hostToken, { participantId: pid(t.liza) })]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
    // Unsynchronised: the loser is ROLE_CHANGED if it authenticated before the commit, FORBIDDEN after (the adversarial suite pins each).
    expect(["ROLE_CHANGED", "FORBIDDEN"]).toContain([a, b].find((r) => r.status === 403)?.body.error?.code);
    expect(await hosts(t.sessionId)).toHaveLength(1);
  });

  it("H12 a name given renames the old host first; the notice uses that name", async () => {
    const t = await table();
    expect((await put(t.sessionId, t.hostToken, { participantId: pid(t.jun), displayName: "  Kovie " })).status).toBe(200);
    expect((await row(t.host.participantId)).name).toBe("Kovie");
    const [n] = await notices(t.jun.actor);
    expect(notificationText(n)).toBe("Kovie made you the host.");
    expect(code(await put(t.sessionId, t.jun.token, { participantId: t.host.participantId, displayName: "x".repeat(41) }))).toEqual([422, "INVALID"]);
  });

  it("H13 the new host's pending claims close", async () => {
    const t = await table();
    const dish = await add(db, t.host, { dishName: "Katsu", quantity: 1, attribution: { type: "UNASSIGNED" } });
    const [batch] = await db.select({ id: orderBatches.id }).from(orderBatches).where(eq(orderBatches.sessionId, t.sessionId));
    await runMutation(db, t.jun.actor, { idempotencyKey: key(), type: "t" }, (tx, s) => requestClaim(tx, s, t.jun.actor, batch.id));
    expect(dish).toBeTruthy();
    await put(t.sessionId, t.hostToken, { participantId: pid(t.jun) });
    expect((await db.select({ s: entryClaims.status }).from(entryClaims).where(eq(entryClaims.requestedBy, pid(t.jun))))[0].s).toBe("REJECTED");
  });

  it("N01 only the new host is told", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, { participantId: pid(t.jun) });
    expect([(await notices(t.jun.actor)).length, (await notices(t.liza.actor)).length, (await notices(t.host)).length]).toEqual([1, 0, 0]);
    expect(notificationText((await notices(t.jun.actor))[0])).toBe("Host made you the host.");
  });
});
