/**
 * Contract tests for PUT /api/sessions/:id/menu (restaurant menu link). Golden contract: docs/contracts/menu-link.md.
 * Run: pnpm vitest run tests/contract-menu-link.test.ts
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { waitText } from "@/server/limits";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { PUT } from "@/app/api/sessions/[id]/menu/route";
import type { Actor } from "@/lib/permissions";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { sessionEvents, sessions } from "@/server/db/schema";
import { NON_TICKET_EVENTS } from "@/server/orders/settlement";
import { closeSession } from "@/server/orders/rounds";
import { runMutation } from "@/server/mutations";
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

type Body = { data?: { result: { changed: boolean }; revision: number; replayed: boolean }; error?: { code: string; message: string } };
async function put(sessionId: string, token: string, payload: unknown, idem: string = key()) {
  jar.cookies = { [credentialCookieName(sessionId)]: token };
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/menu`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", "idempotency-key": idem },
    body: JSON.stringify(payload),
  });
  const res = await PUT(req, { params: Promise.resolve({ id: sessionId }) });
  return { status: res.status, body: (await res.json()) as Body };
}

async function table() {
  const { host, sessionId, token } = await newSession(db);
  const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, sessionId));
  const joined = await joinSession(db, code, "Jun", sessionId);
  const jun = (await resolveActor(db, sessionId, joined.token)) as Actor;
  return { host, sessionId, hostToken: token, jun, junToken: joined.token };
}
const menuOf = async (sessionId: string, who: Actor) => (await getSnapshot(db, who)).session.menu;
const events = async (sessionId: string) => (await db.select({ t: sessionEvents.eventType }).from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId)).orderBy(sessionEvents.revision)).map((e) => e.t);
const URL1 = "https://ramennagi.com.ph/menu";

describe("PUT /menu", () => {
  it("host sets, edits and removes; guests see it in the snapshot; the event is non-ticket", async () => {
    const t = await table();
    expect((await put(t.sessionId, t.hostToken, { url: "ramennagi.com.ph/menu", label: "  Drinks   menu " })).status).toBe(200);
    expect(await menuOf(t.sessionId, t.jun)).toEqual({ url: URL1, label: "Drinks menu", domain: "ramennagi.com.ph" });
    expect((await put(t.sessionId, t.hostToken, { url: URL1 })).status).toBe(200);
    expect((await menuOf(t.sessionId, t.jun))?.label).toBeNull();
    expect((await put(t.sessionId, t.hostToken, { url: URL1, label: "Lunch" })).status).toBe(200);
    expect((await put(t.sessionId, t.hostToken, { url: null, label: "ignored" })).status).toBe(200);
    expect(await menuOf(t.sessionId, t.jun)).toBeNull();
    expect((await events(t.sessionId)).filter((e) => e === "session.menuSet")).toHaveLength(4);
    expect(NON_TICKET_EVENTS).toContain("session.menuSet");
  });

  it("a guest -> 403 and nothing changes", async () => {
    const t = await table();
    const r = await put(t.sessionId, t.junToken, { url: URL1 });
    expect([r.status, r.body.error?.code]).toEqual([403, "FORBIDDEN"]);
    expect(await menuOf(t.sessionId, t.jun)).toBeNull();
  });

  it.each([
    [{ url: "http://example.com" }, "Use the https:// address of the menu."],
    [{ url: "javascript:alert(1)" }, "Use a web link that starts with https://."],
    [{ url: "https://127.0.0.1/x" }, "Use the restaurant's web address, not an IP number."],
    [{ url: "https://u:p@example.com" }, "Remove the name and password from the link."],
    [{ url: "x".repeat(2049) }, "That link is too long. Try a shorter one."],
    [{ url: URL1, label: "x".repeat(41) }, "Keep it under 40 characters."],
    [{ url: "" }, "That doesn't look like a web address."],
    [{}, undefined],
  ])("invalid body %j -> 422", async (payload, message) => {
    const t = await table();
    const r = await put(t.sessionId, t.hostToken, payload);
    expect(r.status).toBe(422);
    if (message) expect(r.body.error?.message).toContain(message);
    expect(await menuOf(t.sessionId, t.host)).toBeNull();
  });

  it("a label that grows past 40 once tidied -> 422", async () => {
    const t = await table();
    const r = await put(t.sessionId, t.hostToken, { url: URL1, label: "㍿".repeat(15) });
    expect(r.status).toBe(422);
  });

  it("same value or removing nothing -> 200, no event, no revision bump", async () => {
    const t = await table();
    const before = (await getSnapshot(db, t.host)).session.revision;
    expect((await put(t.sessionId, t.hostToken, { url: null })).body.data?.result.changed).toBe(false);
    await put(t.sessionId, t.hostToken, { url: URL1, label: "A" });
    const after = (await getSnapshot(db, t.host)).session.revision;
    expect(after).toBe(before + 1);
    const again = await put(t.sessionId, t.hostToken, { url: "ramennagi.com.ph/menu", label: "A" });
    expect([again.status, again.body.data?.result.changed]).toEqual([200, false]);
    expect((await getSnapshot(db, t.host)).session.revision).toBe(after);
    expect((await events(t.sessionId)).filter((e) => e === "session.menuSet")).toHaveLength(1);
  });

  it("a closed order refuses changes and the snapshot hides the link", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, { url: URL1 });
    await add(db, t.host, { dishName: "Gyoza", quantity: 1 });
    await runMutation(db, t.host, { idempotencyKey: key(), type: "session.close" }, (tx, s) => closeSession(tx, s, t.host));
    expect(await menuOf(t.sessionId, t.jun)).toBeNull();
    const r = await put(t.sessionId, t.hostToken, { url: "https://example.com" });
    expect([r.status, r.body.error?.code]).toEqual([409, "SESSION_CLOSED"]);
  });

  it("the 11th change in 10 minutes -> 429; a guest 403 and a replay do not count", async () => {
    const t = await table();
    for (let i = 0; i < 4; i++) await put(t.sessionId, t.junToken, { url: URL1 });
    const replayKey = key();
    await put(t.sessionId, t.hostToken, { url: "https://a.example.com" }, replayKey);
    for (let i = 0; i < 5; i++) expect((await put(t.sessionId, t.hostToken, { url: "https://a.example.com" }, replayKey)).body.data?.replayed).toBe(true);
    for (let i = 1; i < 10; i++) expect((await put(t.sessionId, t.hostToken, { url: `https://a${i}.example.com` })).status).toBe(200);
    const r = await put(t.sessionId, t.hostToken, { url: "https://last.example.com" });
    expect([r.status, r.body.error?.code]).toEqual([429, "RATE_LIMITED"]);
    expect(r.body.error?.message).toMatch(/^Too many changes\. Wait (\d+ seconds|about \d+ minutes)\.$/);
  });
});

describe("waitText", () => {
  it("counts seconds up to 90, then rounds up to minutes", () => {
    expect(waitText(45_000)).toBe("45 seconds");
    expect(waitText(90_000)).toBe("90 seconds");
    expect(waitText(90_001)).toBe("about 2 minutes");
    expect(waitText(597_000)).toBe("about 10 minutes");
  });
});
