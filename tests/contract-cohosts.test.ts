/**
 * Contract tests for PUT /api/sessions/:id/participants/:pid/cohost (make or stop a co-host). Golden contract: docs/contracts/cohosts.md.
 * Drives the real route handler against the real test database; only the cookie jar is faked.
 * Run: pnpm vitest run tests/contract-cohosts.test.ts
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { PUT } from "@/app/api/sessions/[id]/participants/[pid]/cohost/route";
import { notificationText, notificationTarget } from "@/lib/notifications";
import type { Actor } from "@/lib/permissions";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { participants, sessionEvents, sessions } from "@/server/db/schema";
import { loadNotifications } from "@/server/notifications";
import { NON_TICKET_EVENTS } from "@/server/orders/settlement";
import { removeParticipant, restoreParticipant } from "@/server/orders/people";
import { closeSession, confirmRound } from "@/server/orders/rounds";
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

async function put(sessionId: string, token: string | null, pid: string, payload: unknown, idem: string = key()) {
  jar.cookies = token ? { [credentialCookieName(sessionId)]: token } : {};
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/participants/${pid}/cohost`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", "idempotency-key": idem },
    body: JSON.stringify(payload),
  });
  const res = await within(PUT(req, { params: Promise.resolve({ id: sessionId, pid }) }), "PUT cohost");
  return { status: res.status, body: (await res.json()) as { data?: { result: { cohost: boolean }; revision: number; replayed: boolean }; error?: { code: string } } };
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
const cohostAt = async (pid: string) => (await db.select({ c: participants.cohostAt }).from(participants).where(eq(participants.id, pid)))[0].c;
const events = async (sessionId: string) => (await db.select({ t: sessionEvents.eventType, p: sessionEvents.payload }).from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId)).orderBy(sessionEvents.revision));
const notices = async (t: T, who: Actor) => (await loadNotifications(db, who)).items.filter((n) => n.type.startsWith("participant.cohost"));

describe("PUT /participants/:pid/cohost", () => {
  it("C01 the host makes a guest a co-host: 200, mark set, snapshot shows it to everyone, event carries only ids", async () => {
    const t = await table();
    const r = await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: true });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ result: { cohost: true }, replayed: false });
    expect(await cohostAt(t.jun.actor.participantId)).not.toBeNull();
    for (const viewer of [t.host, t.jun.actor, t.liza.actor]) {
      const snap = await getSnapshot(db, viewer);
      expect(snap.participants.filter((p) => p.cohost).map((p) => p.id)).toEqual([t.jun.actor.participantId]);
    }
    expect((await getSnapshot(db, t.jun.actor)).me.cohost).toBe(true);
    expect((await events(t.sessionId)).slice(-1)).toEqual([{ t: "participant.cohostSet", p: { participantId: t.jun.actor.participantId } }]);
  });

  it("C02 revoke clears the mark and emits participant.cohostRevoked", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: true });
    const r = await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: false });
    expect(r.status).toBe(200);
    expect(await cohostAt(t.jun.actor.participantId)).toBeNull();
    expect((await events(t.sessionId)).slice(-1)[0].t).toBe("participant.cohostRevoked");
  });

  it("C03 the same value again is a 200 no-op: same event type, no second notification, the mark keeps its time", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: true });
    const marked = await cohostAt(t.jun.actor.participantId);
    const again = await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: true });
    expect(again.status).toBe(200);
    expect((await events(t.sessionId)).slice(-1)[0].t).toBe("participant.cohostSet");
    expect(await cohostAt(t.jun.actor.participantId)).toEqual(marked);
    expect(await notices(t, t.jun.actor)).toHaveLength(1);
  });

  it("C04 a guest or a co-host cannot assign: 403 FORBIDDEN, nothing changes", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: true });
    for (const who of [t.liza, t.jun]) {
      const r = await put(t.sessionId, who.token, t.liza.actor.participantId, { cohost: true });
      expect([r.status, r.body.error?.code]).toEqual([403, "FORBIDDEN"]);
    }
    expect(await cohostAt(t.liza.actor.participantId)).toBeNull();
  });

  it("C05 the host as target -> 409 NOT_A_GUEST", async () => {
    const t = await table();
    const r = await put(t.sessionId, t.hostToken, t.host.participantId, { cohost: true });
    expect([r.status, r.body.error?.code]).toEqual([409, "NOT_A_GUEST"]);
  });

  it("C06 a removed guest -> 409 ALREADY_REMOVED (never a 500 from the CHECK)", async () => {
    const t = await table();
    await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => removeParticipant(tx, s, t.host, t.liza.actor.participantId, null));
    const r = await put(t.sessionId, t.hostToken, t.liza.actor.participantId, { cohost: true });
    expect([r.status, r.body.error?.code]).toEqual([409, "ALREADY_REMOVED"]);
  });

  it("C07 unknown or foreign person, bad uuid -> 404 PERSON_NOT_FOUND", async () => {
    const t = await table();
    const other = await table();
    for (const pid of [randomUUID(), other.jun.actor.participantId, "nope"]) {
      const r = await put(t.sessionId, t.hostToken, pid, { cohost: true });
      expect([r.status, r.body.error?.code]).toEqual([404, "PERSON_NOT_FOUND"]);
    }
  });

  it("C08 body must be { cohost: boolean }; no cookie -> 404", async () => {
    const t = await table();
    for (const payload of [{}, { cohost: "yes" }, { cohost: null }, []]) expect((await put(t.sessionId, t.hostToken, t.jun.actor.participantId, payload)).status).toBe(422);
    expect((await put(t.sessionId, null, t.jun.actor.participantId, { cohost: true })).status).toBe(404);
  });

  it("C09 a closed order -> 409 SESSION_CLOSED; the mark stays", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: true });
    await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => closeSession(tx, s, t.host));
    const r = await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: false });
    expect([r.status, r.body.error?.code]).toEqual([409, "SESSION_CLOSED"]);
    expect(await cohostAt(t.jun.actor.participantId)).not.toBeNull();
  });

  it("C10 a retried key is applied once and replays", async () => {
    const t = await table();
    const idem = key();
    const a = await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: true }, idem);
    const b = await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: true }, idem);
    expect([a.body.data?.replayed, b.body.data?.replayed]).toEqual([false, true]);
    expect((await events(t.sessionId)).filter((e) => e.t === "participant.cohostSet")).toHaveLength(1);
  });

  it("C11 removing a co-host clears the mark; Undo brings back a plain guest", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: true });
    await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => removeParticipant(tx, s, t.host, t.jun.actor.participantId, null));
    expect(await cohostAt(t.jun.actor.participantId)).toBeNull();
    await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => restoreParticipant(tx, s, t.host, t.jun.actor.participantId));
    expect(await cohostAt(t.jun.actor.participantId)).toBeNull();
  });

  it("C12 the database refuses a co-host who is the host or removed", async () => {
    const t = await table();
    await expect(db.execute(sql`UPDATE participants SET cohost_at = now() WHERE id = ${t.host.participantId}`)).rejects.toThrow();
    await db.execute(sql`UPDATE participants SET removed_at = now() WHERE id = ${t.liza.actor.participantId}`);
    await expect(db.execute(sql`UPDATE participants SET cohost_at = now() WHERE id = ${t.liza.actor.participantId}`)).rejects.toThrow();
  });

  it("C13 co-host events do not make the host's pending Confirm stale", async () => {
    const t = await table();
    await add(db, t.host, { dishName: "Sisig", quantity: 1, attribution: { type: "TABLE" } });
    const looked = await getSnapshot(db, t.host);
    await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: true });
    await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: false });
    expect(NON_TICKET_EVENTS).toContain("participant.cohostSet");
    expect(NON_TICKET_EVENTS).toContain("participant.cohostRevoked");
    const r = await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => confirmRound(tx, s, t.host, looked.activeRoundId, looked.session.revision));
    expect(r.result.roundId).toBe(looked.activeRoundId);
  });
});

describe("co-host notifications (D18)", () => {
  it("N01 only that person is told, with the host's name; re-assign after a revoke tells again", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: true });
    await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: false });
    await put(t.sessionId, t.hostToken, t.jun.actor.participantId, { cohost: true });
    const items = await notices(t, t.jun.actor);
    expect(items.map((n) => n.type).sort()).toEqual(["participant.cohostRevoked", "participant.cohostSet", "participant.cohostSet"]);
    expect(await notices(t, t.liza.actor)).toHaveLength(0);
    expect(await notices(t, t.host)).toHaveLength(0);
    const set = items.find((n) => n.type === "participant.cohostSet")!;
    expect(notificationText(set)).toBe(`${t.host.displayName} made you a co-host. You can mark food as served.`);
    expect(notificationText(items.find((n) => n.type === "participant.cohostRevoked")!)).toBe(`${t.host.displayName} stopped your co-host role.`);
    expect([notificationTarget("participant.cohostSet"), notificationTarget("participant.cohostRevoked")]).toEqual(["served", "order"]);
  });
});
