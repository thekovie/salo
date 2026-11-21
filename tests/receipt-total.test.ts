import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { PUT } from "@/app/api/sessions/[id]/receipt-total/route";
import type { Actor } from "@/lib/permissions";
import { credentialCookieName, hashToken, newToken } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { participantCredentials, participants, sessionEvents, sessions } from "@/server/db/schema";
import { closeSession, confirmRound } from "@/server/orders/rounds";
import { runMutation } from "@/server/mutations";
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
async function put(sessionId: string, who: Who, body: unknown, idem: string = key()) {
  jar.cookies = { [credentialCookieName(sessionId)]: who.token };
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/receipt-total`, { method: "PUT", headers: { "content-type": "application/json", origin: "http://localhost:3000", "idempotency-key": idem }, body: JSON.stringify(body) });
  const res = await PUT(req, { params: Promise.resolve({ id: sessionId }) });
  return { status: res.status, body: (await res.json()) as { data?: { result: { revision: number }; replayed: boolean }; error?: { code: string } } };
}

async function setup() {
  const s = await newSession(db);
  const token = newToken();
  const [row] = await db.insert(participants).values({ sessionId: s.sessionId, displayName: "Ana", role: "GUEST" }).returning();
  await db.insert(participantCredentials).values({ sessionId: s.sessionId, participantId: row.id, credentialType: "GUEST", credentialHash: hashToken(token) });
  const guest: Actor = { participantId: row.id, sessionId: s.sessionId, role: "GUEST", displayName: "Ana" };
  return { ...s, guest, who: { host: { actor: s.host, token: s.token }, guest: { actor: guest, token } } };
}

describe("PUT /receipt-total", () => {
  it("host only; guests get 403 and the snapshot shows it to everyone", async () => {
    const t = await setup();
    expect((await put(t.sessionId, t.who.guest, { expectedRevision: 0, centavos: 100 })).status).toBe(403);
    expect((await put(t.sessionId, t.who.host, { expectedRevision: 0, centavos: 140000 })).status).toBe(200);
    expect((await getSnapshot(db, t.guest)).settlement.receiptTotal).toEqual({ centavos: 140000, revision: 1 });
    expect((await put(t.sessionId, t.who.host, { expectedRevision: 1, centavos: null })).status).toBe(200);
    expect((await getSnapshot(db, t.host)).settlement.receiptTotal).toEqual({ centavos: null, revision: 2 });
  });

  it("a stale revision is a 409 conflict", async () => {
    const t = await setup();
    await put(t.sessionId, t.who.host, { expectedRevision: 0, centavos: 100 });
    const stale = await put(t.sessionId, t.who.host, { expectedRevision: 0, centavos: 200 });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("CONFLICT");
  });

  it("a retry with the same key applies once", async () => {
    const t = await setup();
    const idem = key();
    const first = await put(t.sessionId, t.who.host, { expectedRevision: 0, centavos: 500 }, idem);
    const again = await put(t.sessionId, t.who.host, { expectedRevision: 0, centavos: 500 }, idem);
    expect(again.status).toBe(200);
    expect(again.body.data?.replayed).toBe(true);
    expect(again.body.data?.result.revision).toBe(first.body.data?.result.revision);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, t.sessionId));
    expect(row.receiptTotalRevision).toBe(1);
  });

  it("an ended order is refused, and out-of-range amounts are 422", async () => {
    const t = await setup();
    expect((await put(t.sessionId, t.who.host, { expectedRevision: 0, centavos: -1 })).status).toBe(422);
    expect((await put(t.sessionId, t.who.host, { expectedRevision: 0, centavos: 100_000_000 })).status).toBe(422);
    await add(db, t.host, { dishName: "Katsu", quantity: 1 });
    const snap = await getSnapshot(db, t.host);
    await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => confirmRound(tx, s, t.host, snap.activeRoundId, snap.session.revision));
    await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => closeSession(tx, s, t.host));
    const res = await put(t.sessionId, t.who.host, { expectedRevision: 0, centavos: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("SESSION_CLOSED");
  });

  it("is a non-ticket event: the host's confirm is not made stale, and the event type is recorded", async () => {
    const t = await setup();
    await add(db, t.host, { dishName: "Katsu", quantity: 1 });
    const seen = await getSnapshot(db, t.host);
    const out = await put(t.sessionId, t.who.host, { expectedRevision: 0, centavos: 100 });
    const [event] = await db.select().from(sessionEvents).where(sql`${sessionEvents.sessionId} = ${t.sessionId} AND ${sessionEvents.eventType} = 'session.receiptTotal'`);
    expect(out.status).toBe(200);
    expect(event).toBeTruthy();
    await expect(runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => confirmRound(tx, s, t.host, seen.activeRoundId, seen.session.revision))).resolves.toMatchObject({ replayed: false });
  });
});
