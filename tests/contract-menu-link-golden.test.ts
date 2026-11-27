/** Golden contract for PUT /api/sessions/:id/menu and snapshot session.menu (docs/contracts/menu-link.md, from plan Slice 8a + brief F16). */
// Run: perl -e 'alarm 300; exec @ARGV' npx vitest run tests/contract-menu-link-golden.test.ts  (exit 142 = hung)
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { PUT as HOST } from "@/app/api/sessions/[id]/host/route";
import { PUT } from "@/app/api/sessions/[id]/menu/route";
import { GET } from "@/app/api/sessions/[id]/route";
import type { Actor } from "@/lib/permissions";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { sessionEvents, sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { NON_TICKET_EVENTS } from "@/server/orders/settlement";
import { closeSession, confirmRound } from "@/server/orders/rounds";
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

const DEADLINE_MS = 15_000;
function within<T>(p: Promise<T>, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`deadline: ${what}`)), DEADLINE_MS)));
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

type Body = { data?: { result: { changed: boolean }; revision: number; replayed: boolean }; error?: { code: string; message: string } };
type Res = { status: number; body: Body };

/** `token: null` = no cookie; `idem: null` = no header; `raw` = send the payload string as is. */
async function send(sessionId: string, token: string | null, payload: unknown, opts: { idem?: string | null; raw?: boolean; cookieSession?: string } = {}): Promise<Res> {
  jar.cookies = token ? { [credentialCookieName(opts.cookieSession ?? sessionId)]: token } : {};
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost:3000" };
  const idem = opts.idem === undefined ? key() : opts.idem;
  if (idem !== null) headers["idempotency-key"] = idem;
  const req = new Request(`http://localhost:3000/api/sessions/${sessionId}/menu`, { method: "PUT", headers, body: opts.raw ? (payload as string) : JSON.stringify(payload) });
  const res = await within(PUT(req, { params: Promise.resolve({ id: sessionId }) }), `PUT menu ${String(JSON.stringify(payload)).slice(0, 60)}`);
  return { status: res.status, body: (await res.json()) as Body };
}
const put = (sessionId: string, token: string, payload: unknown, idem?: string) => send(sessionId, token, payload, { idem });

async function table() {
  const { host, sessionId, token } = await newSession(db);
  const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, sessionId));
  const joined = await joinSession(db, code, "Jun", sessionId);
  const jun = (await resolveActor(db, sessionId, joined.token)) as Actor;
  return { host, sessionId, hostToken: token, jun, junToken: joined.token, code };
}
type T = Awaited<ReturnType<typeof table>>;

async function stored(sessionId: string) {
  const [r] = await db.select({ url: sessions.menuUrl, label: sessions.menuLabel, revision: sessions.revision }).from(sessions).where(eq(sessions.id, sessionId));
  return r;
}
const menuOf = async (who: Actor) => (await getSnapshot(db, who)).session.menu;
const menuEvents = async (sessionId: string) => (await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId)).orderBy(sessionEvents.revision)).filter((e) => e.eventType === "session.menuSet");
const URL1 = "https://ramennagi.com.ph/menu";

const R = {
  unparseable: "That doesn't look like a web address.",
  scheme: "Use a web link that starts with https://.",
  http: "Use the https:// address of the menu.",
  credentials: "Remove the name and password from the link.",
  ip: "Use the restaurant's web address, not an IP number.",
  local: "Use the restaurant's public web address.",
  port: "Use the menu's normal web address (no port number).",
  tooLong: "That link is too long. Try a shorter one.",
  label: "Keep it under 40 characters.",
};

describe("G1 host set / edit / remove", () => {
  it("G01 set with scheme added, edit label, change url, remove: responses, stored values, snapshot, events", async () => {
    const t = await table();
    const r0 = (await stored(t.sessionId)).revision;
    const a = await put(t.sessionId, t.hostToken, { url: "ramennagi.com.ph/menu", label: "  Drinks   menu " });
    expect([a.status, a.body.data?.result, a.body.data?.replayed, a.body.data?.revision]).toEqual([200, { changed: true }, false, r0 + 1]);
    expect(await stored(t.sessionId)).toMatchObject({ url: URL1, label: "Drinks menu" });
    expect(await menuOf(t.jun)).toEqual({ url: URL1, label: "Drinks menu", domain: "ramennagi.com.ph" });
    expect(await menuOf(t.host)).toEqual({ url: URL1, label: "Drinks menu", domain: "ramennagi.com.ph" });

    const b = await put(t.sessionId, t.hostToken, { url: URL1, label: "Lunch" });
    expect([b.status, b.body.data?.result.changed, b.body.data?.revision]).toEqual([200, true, r0 + 2]);
    expect((await menuOf(t.jun))?.label).toBe("Lunch");

    const c = await put(t.sessionId, t.hostToken, { url: "https://example.com/other?x=1#f" });
    expect([c.status, c.body.data?.result.changed]).toEqual([200, true]);
    expect(await menuOf(t.jun)).toEqual({ url: "https://example.com/other?x=1#f", label: null, domain: "example.com" });

    const d = await put(t.sessionId, t.hostToken, { url: null });
    expect([d.status, d.body.data?.result.changed, d.body.data?.revision]).toEqual([200, true, r0 + 4]);
    expect(await menuOf(t.jun)).toBeNull();
    expect(await stored(t.sessionId)).toMatchObject({ url: null, label: null });
    const ev = await menuEvents(t.sessionId);
    expect(ev.map((e) => e.revision)).toEqual([r0 + 1, r0 + 2, r0 + 3, r0 + 4]);
    expect(ev.every((e) => JSON.stringify(e.payload) === "{}")).toBe(true);
  });

  it("G02 omitted label, null label, empty and blank label all mean no label", async () => {
    const t = await table();
    for (const body of [{ url: URL1 }, { url: URL1, label: null }, { url: URL1, label: "" }, { url: URL1, label: "   " }]) {
      await put(t.sessionId, t.hostToken, { url: URL1, label: "X" });
      const r = await put(t.sessionId, t.hostToken, body);
      expect([r.status, r.body.data?.result.changed]).toEqual([200, true]);
      expect((await menuOf(t.jun))?.label).toBeNull();
      expect((await stored(t.sessionId)).label).toBeNull();
    }
  });

  it("G03 editing the url without a label replaces both fields (label becomes null)", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, { url: URL1, label: "Drinks" });
    await put(t.sessionId, t.hostToken, { url: "https://example.com/m" });
    expect(await menuOf(t.jun)).toEqual({ url: "https://example.com/m", label: null, domain: "example.com" });
  });

  it("G04 url null clears the label too; a label sent with a null url is ignored (200, stored null)", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, { url: URL1, label: "Drinks" });
    const r = await put(t.sessionId, t.hostToken, { url: null, label: "Ignored" });
    expect(r.status).toBe(200);
    expect(await stored(t.sessionId)).toMatchObject({ url: null, label: null });
    const again = await put(t.sessionId, t.hostToken, { url: null, label: "Still ignored" });
    expect([again.status, again.body.data?.result.changed]).toEqual([200, false]);
    expect((await stored(t.sessionId)).label).toBeNull();
  });

  it("G05 a label with HTML is stored as plain text, verbatim (escaped at render)", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, { url: URL1, label: "<b>Menu</b>&" });
    expect((await menuOf(t.jun))?.label).toBe("<b>Menu</b>&");
  });

  it("G06 GET /api/sessions/:id carries menu: null before, the object after, for host and guest", async () => {
    const t = await table();
    const get = async (token: string) => {
      jar.cookies = { [credentialCookieName(t.sessionId)]: token };
      const res = await within(GET(new Request(`http://localhost:3000/api/sessions/${t.sessionId}`), { params: Promise.resolve({ id: t.sessionId }) }), "GET snapshot");
      return (await res.json()) as { data: { session: { menu: unknown } } };
    };
    expect((await get(t.junToken)).data.session.menu).toBeNull();
    await put(t.sessionId, t.hostToken, { url: URL1, label: "A" });
    for (const tok of [t.junToken, t.hostToken]) expect((await get(tok)).data.session.menu).toEqual({ url: URL1, label: "A", domain: "ramennagi.com.ph" });
  });
});

describe("G2 no-op, retries, idempotency", () => {
  it("G10 same normalised url+label again: 200 changed:false, no event, no revision bump", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, { url: URL1, label: "A" });
    const before = await stored(t.sessionId);
    for (const url of [URL1, "ramennagi.com.ph/menu", "  HTTPS://RamenNagi.com.ph/menu  ", "https://ramennagi.com.ph.:443/menu"]) {
      const r = await put(t.sessionId, t.hostToken, { url, label: " A " });
      expect([r.status, r.body.data?.result.changed, r.body.data?.replayed, r.body.data?.revision]).toEqual([200, false, false, before.revision]);
    }
    expect((await stored(t.sessionId)).revision).toBe(before.revision);
    expect(await menuEvents(t.sessionId)).toHaveLength(1);
  });

  it("G11 removing when there is no link: 200 changed:false, no event, no revision bump", async () => {
    const t = await table();
    const before = await stored(t.sessionId);
    const r = await put(t.sessionId, t.hostToken, { url: null });
    expect([r.status, r.body.data?.result.changed]).toEqual([200, false]);
    expect((await stored(t.sessionId)).revision).toBe(before.revision);
    expect(await menuEvents(t.sessionId)).toHaveLength(0);
  });

  it("G12 same url, different label is a real change (event + revision)", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, { url: URL1, label: "A" });
    const r = await put(t.sessionId, t.hostToken, { url: URL1, label: "B" });
    expect(r.body.data?.result.changed).toBe(true);
    expect(await menuEvents(t.sessionId)).toHaveLength(2);
  });

  it("G13 a retried key replays the first result: replayed:true, same revision, one event, state untouched even if the retry body differs", async () => {
    const t = await table();
    const k = key();
    const first = await put(t.sessionId, t.hostToken, { url: URL1 }, k);
    const second = await put(t.sessionId, t.hostToken, { url: URL1 }, k);
    const third = await put(t.sessionId, t.hostToken, { url: "https://other.example.com" }, k);
    expect(second.body.data).toEqual({ ...first.body.data, replayed: true });
    expect(third.status).toBe(200);
    expect(third.body.data?.replayed).toBe(true);
    expect((await menuOf(t.jun))?.url).toBe(URL1);
    expect(await menuEvents(t.sessionId)).toHaveLength(1);
  });

  it("G14 a replayed no-op key is changed:false replayed:true; a key used for another mutation type is 422 IDEMPOTENCY_KEY_REUSED", async () => {
    const t = await table();
    const k = key();
    await put(t.sessionId, t.hostToken, { url: null }, k);
    const again = await put(t.sessionId, t.hostToken, { url: null }, k);
    expect([again.status, again.body.data?.result.changed, again.body.data?.replayed]).toEqual([200, false, true]);
    const other = key();
    await add(db, t.host, { dishName: "Gyoza", quantity: 1 }, other);
    const reused = await put(t.sessionId, t.hostToken, { url: URL1 }, other);
    expect([reused.status, reused.body.error?.code]).toEqual([422, "IDEMPOTENCY_KEY_REUSED"]);
    expect(await menuOf(t.jun)).toBeNull();
  });

  it("G15 missing or malformed Idempotency-Key -> 400 IDEMPOTENCY_KEY, nothing stored", async () => {
    const t = await table();
    for (const idem of [null, "", "short", "has spaces in it!!"]) {
      const r = await send(t.sessionId, t.hostToken, { url: URL1 }, { idem });
      expect([r.status, r.body.error?.code]).toEqual([400, "IDEMPOTENCY_KEY"]);
    }
    expect((await stored(t.sessionId)).url).toBeNull();
  });
});

describe("G3 authentication and authorization", () => {
  it("G20 guest -> 403 FORBIDDEN for set and remove; nothing stored, no event, no revision bump", async () => {
    const t = await table();
    const before = await stored(t.sessionId);
    const r = await put(t.sessionId, t.junToken, { url: URL1 });
    expect([r.status, r.body.error?.code]).toEqual([403, "FORBIDDEN"]);
    expect((await put(t.sessionId, t.junToken, { url: null })).status).toBe(403);
    expect(await stored(t.sessionId)).toEqual(before);
    expect(await menuEvents(t.sessionId)).toHaveLength(0);
  });

  it("G21 a guest cannot remove or edit an existing link either", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, { url: URL1, label: "A" });
    for (const body of [{ url: null }, { url: "https://evil.example.com" }, { url: URL1, label: "B" }]) expect((await put(t.sessionId, t.junToken, body)).status).toBe(403);
    expect(await menuOf(t.host)).toEqual({ url: URL1, label: "A", domain: "ramennagi.com.ph" });
  });

  it("G22 no cookie -> 404 (a stranger gets no hint the order exists)", async () => {
    const t = await table();
    const r = await send(t.sessionId, null, { url: URL1 });
    expect(r.status).toBe(404);
    expect((await stored(t.sessionId)).url).toBeNull();
  });

  it("G23 another order's host token (tenant isolation) -> 404; neither order changes; snapshot of the other order is 404", async () => {
    const a = await table();
    const b = await table();
    expect((await send(b.sessionId, a.hostToken, { url: URL1 })).status).toBe(404);
    expect((await send(b.sessionId, a.hostToken, { url: URL1 }, { cookieSession: a.sessionId })).status).toBe(404);
    expect((await stored(b.sessionId)).url).toBeNull();
    expect((await stored(a.sessionId)).url).toBeNull();
    await put(b.sessionId, b.hostToken, { url: URL1 });
    jar.cookies = { [credentialCookieName(b.sessionId)]: a.hostToken };
    const res = await GET(new Request(`http://localhost:3000/api/sessions/${b.sessionId}`), { params: Promise.resolve({ id: b.sessionId }) });
    expect(res.status).toBe(404);
  });

  it("G24 a removed guest -> 403", async () => {
    const t = await table();
    await db.execute(sql`UPDATE participants SET removed_at = now() WHERE id = ${t.jun.participantId}`);
    expect((await put(t.sessionId, t.junToken, { url: URL1 })).status).toBe(403);
  });

  it("G25 a co-host is not the host: 403 FORBIDDEN", async () => {
    const t = await table();
    await db.execute(sql`UPDATE participants SET cohost_at = now() WHERE id = ${t.jun.participantId}`);
    const r = await put(t.sessionId, t.junToken, { url: URL1 });
    expect([r.status, r.body.error?.code]).toEqual([403, "FORBIDDEN"]);
  });

  it("G26 after the host hands over, the new host can set it and the old host cannot", async () => {
    const t = await table();
    jar.cookies = { [credentialCookieName(t.sessionId)]: t.hostToken };
    const h = await within(
      HOST(new Request(`http://localhost:3000/api/sessions/${t.sessionId}/host`, { method: "PUT", headers: { "content-type": "application/json", origin: "http://localhost:3000", "idempotency-key": key() }, body: JSON.stringify({ participantId: t.jun.participantId }) }), { params: Promise.resolve({ id: t.sessionId }) }),
      "PUT host",
    );
    expect(h.status).toBe(200);
    expect((await put(t.sessionId, t.hostToken, { url: URL1 })).status).toBe(403);
    expect((await put(t.sessionId, t.junToken, { url: URL1 })).status).toBe(200);
  });
});

describe("G4 malformed and wrong-typed input", () => {
  it("G30 bad JSON -> 400 BAD_JSON", async () => {
    const t = await table();
    const r = await send(t.sessionId, t.hostToken, "{not json", { raw: true });
    expect([r.status, r.body.error?.code]).toEqual([400, "BAD_JSON"]);
  });

  it("G31 oversized body (> 8 KB) -> 413 TOO_LARGE", async () => {
    const t = await table();
    const r = await put(t.sessionId, t.hostToken, { url: URL1, label: "x".repeat(9000) });
    expect([r.status, r.body.error?.code]).toEqual([413, "TOO_LARGE"]);
  });

  it.each([
    ["missing url", {}],
    ["label only", { label: "A" }],
    ["url number", { url: 123 }],
    ["url boolean", { url: true }],
    ["url array", { url: [URL1] }],
    ["url object", { url: { href: URL1 } }],
    ["label number", { url: URL1, label: 5 }],
    ["label object", { url: URL1, label: {} }],
    ["body array", []],
    ["body null", null],
    ["body string", "https://example.com"],
  ])("G32 %s -> 422 INVALID, nothing stored", async (_n, body) => {
    const t = await table();
    const r = await put(t.sessionId, t.hostToken, body);
    expect([r.status, r.body.error?.code]).toEqual([422, "INVALID"]);
    expect((await stored(t.sessionId)).url).toBeNull();
    expect(await menuEvents(t.sessionId)).toHaveLength(0);
  });

  it("G33 an empty or blank url is 422 (only null removes) and does not remove an existing link", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, { url: URL1 });
    for (const url of ["", "   "]) {
      const r = await put(t.sessionId, t.hostToken, { url });
      expect([r.status, r.body.error?.message]).toEqual([422, R.unparseable]);
    }
    expect((await menuOf(t.host))?.url).toBe(URL1);
  });

  it("G34 a NUL byte in the label is 422, not a 500", async () => {
    const t = await table();
    const r = await put(t.sessionId, t.hostToken, { url: URL1, label: "a\u0000b" });
    expect(r.status).toBe(422);
  });
});

describe("G5 URL validator through the endpoint", () => {
  const rejects: [string, string, string][] = [
    ["http", "http://example.com/menu", R.http],
    ["http upper", "HTTP://example.com", R.http],
    ["javascript", "javascript:alert(1)", R.scheme],
    ["data", "data:text/html,<script>alert(1)</script>", R.scheme],
    ["file", "file:///etc/passwd", R.scheme],
    ["ftp", "ftp://example.com/m", R.scheme],
    ["intent", "intent://example.com#Intent;scheme=https;end", R.scheme],
    ["custom scheme", "myapp://menu", R.scheme],
    ["mailto", "mailto:a@example.com", R.scheme],
    ["user:pw", "https://user:pw@example.com", R.credentials],
    ["user only", "https://user@example.com", R.credentials],
    ["pw only", "https://:pw@example.com", R.credentials],
    ["localhost", "https://localhost", R.local],
    ["localhost.", "https://localhost./menu", R.local],
    ["LOCALHOST", "https://LOCALHOST", R.local],
    ["foo.localhost", "https://app.localhost", R.local],
    [".local", "https://printer.local", R.local],
    [".local.", "https://printer.local./", R.local],
    [".internal", "https://svc.internal", R.local],
    [".internal.", "https://x.internal./", R.local],
    [".home.arpa", "https://nas.home.arpa", R.local],
    ["single label", "https://intranet", R.local],
    ["single label bare", "intranet/menu", R.local],
    ["a..b", "https://a..b", R.local],
    ["-a.com", "https://-a.com", R.local],
    ["a-.com", "https://a-.com", R.local],
    ["exa_mple.com", "https://exa_mple.com", R.local],
    [".com", "https://.com", R.local],
        ["IPv4", "https://127.0.0.1/x", R.ip],
    ["IPv4 decimal", "https://2130706433/", R.ip],
    ["IPv4 hex short", "https://0x7f.1/", R.ip],
    ["IPv4 octal", "https://0177.0.0.1/", R.ip],
    ["IPv4 127.1", "https://127.1/", R.ip],
    ["IPv4 fullwidth", "https://１２７．０．０．１/", R.ip],
    ["IPv4 10.x", "https://10.0.0.5/", R.ip],
    ["IPv4 172.16", "https://172.16.0.1/", R.ip],
    ["IPv4 192.168", "https://192.168.1.1/", R.ip],
    ["IPv4 link-local metadata", "https://169.254.169.254/latest", R.ip],
    ["IPv4 public", "https://8.8.8.8/", R.ip],
    ["IPv4 0.0.0.0", "https://0.0.0.0/", R.ip],
    ["IPv4 missing scheme", "127.0.0.1/menu", R.ip],
    ["IPv6 loopback", "https://[::1]/", R.ip],
    ["IPv6 mapped", "https://[::ffff:127.0.0.1]/", R.ip],
    ["IPv6 public", "https://[2001:db8::1]/", R.ip],
    ["IPv6 link-local", "https://[fe80::1]/", R.ip],
    ["port 8443", "https://example.com:8443/menu", R.port],
    ["port no scheme", "example.com:8080/x", R.port],
    ["no host", "https://", R.unparseable],
    ["spaces", "not a url", R.unparseable],
    ["expands past 500", "https://example.com/" + "ü".repeat(200), R.tooLong],
    ["href 501", "https://example.com/" + "a".repeat(501 - "https://example.com/".length), R.tooLong],
    ["raw 2048 valid prefix", "https://example.com/" + "a".repeat(2048 - 20), R.tooLong],
    ["raw 2049", "https://example.com/" + "a".repeat(2049 - 20), R.tooLong],
    ["raw 5000", "x".repeat(5000), R.tooLong],
  ];
  it.each(rejects)("G50 reject %s", async (_n, url, message) => {
    const t = await table();
    const r = await put(t.sessionId, t.hostToken, { url });
    expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([422, "INVALID", message]);
    expect(await stored(t.sessionId)).toMatchObject({ url: null, label: null });
    expect(await menuEvents(t.sessionId)).toHaveLength(0);
  });

  it("G50b an all-digit last label is refused (unparseable or local reason)", async () => {
    const t = await table();
    const r = await put(t.sessionId, t.hostToken, { url: "https://example.123" });
    expect(r.status).toBe(422);
    expect([R.local, R.unparseable]).toContain(r.body.error?.message);
  });

  it.each(["https://./", "https://..", "https://example.com:0/", "https://exa mple.com", "https://[::1", "https://example.com%00", "https://ex%2Fample.com", "https://xn--.com", "https://1.2.3", "https://1.2.3.4.5", "https://0x7f.0x0.0x0.0x1", "https://0.0.0.0.0", "https://localhost:443", "https://[::]", "https://[0:0:0:0:0:ffff:7f00:1]", "https://LOCALHOST.", "https://a.localhost."])("G55 exotic host %s is refused with 422", async (url) => {
    const t = await table();
    const r = await put(t.sessionId, t.hostToken, { url });
    expect([r.status, r.body.error?.code]).toEqual([422, "INVALID"]);
    expect((await stored(t.sessionId)).url).toBeNull();
  });

  it("G51 localhost with a port is refused (port or local reason)", async () => {
    const t = await table();
    for (const url of ["localhost:3000", "localhost:3000/x", "https://localhost:3000"]) {
      const r = await put(t.sessionId, t.hostToken, { url });
      expect(r.status).toBe(422);
      expect([R.port, R.local]).toContain(r.body.error?.message);
    }
  });

  const accepts: [string, string, string, string][] = [
    ["plain https", "https://ramennagi.com.ph/menu", "https://ramennagi.com.ph/menu", "ramennagi.com.ph"],
    ["missing scheme prepended", "ramennagi.com.ph/menu", "https://ramennagi.com.ph/menu", "ramennagi.com.ph"],
    ["bare host gets a slash", "ramennagi.com.ph", "https://ramennagi.com.ph/", "ramennagi.com.ph"],
    ["case + whitespace", "  HTTPS://RamenNagi.COM.ph/Menu  ", "https://ramennagi.com.ph/Menu", "ramennagi.com.ph"],
    ["www is kept", "https://www.example.com/a", "https://www.example.com/a", "www.example.com"],
    ["query and fragment kept", "https://example.com/m?a=1&b=2#top", "https://example.com/m?a=1&b=2#top", "example.com"],
    ["trailing dot stored dotless", "https://example.com./menu", "https://example.com/menu", "example.com"],
    ["trailing dot bare", "example.com.", "https://example.com/", "example.com"],
    [":443 normalised away", "https://example.com:443/x", "https://example.com/x", "example.com"],
    ["IDN to punycode", "https://münchen.de/menü", "https://xn--mnchen-3ya.de/men%C3%BC", "xn--mnchen-3ya.de"],
    ["already punycode", "https://xn--mnchen-3ya.de/", "https://xn--mnchen-3ya.de/", "xn--mnchen-3ya.de"],
    ["https:example.com normalises", "https:example.com", "https://example.com/", "example.com"],
    ["https:/\\evil.com normalises", "https:/\\evil.com", "https://evil.com/", "evil.com"],
    ["backslash-@ lands on example.com", "https://example.com\\@evil.com", "https://example.com/@evil.com", "example.com"],
    ["@ in path ok", "https://example.com/a@b", "https://example.com/a@b", "example.com"],
    ["@ in fragment ok", "https://example.com/#u:p@x", "https://example.com/#u:p@x", "example.com"],
    ["embedded tab/newline stripped", "https://exam\tple.com/\nmenu", "https://example.com/menu", "example.com"],
    ["two-label host", "https://a.co/x", "https://a.co/x", "a.co"],
  ];
  it.each(accepts)("G52 accept %s", async (_n, url, href, domain) => {
    const t = await table();
    const r = await put(t.sessionId, t.hostToken, { url });
    expect([r.status, r.body.data?.result.changed]).toEqual([200, true]);
    expect((await stored(t.sessionId)).url).toBe(href);
    expect(await menuOf(t.jun)).toEqual({ url: href, label: null, domain });
  });

  it("G53 length boundary: stored href of exactly 500 chars is accepted, 501 refused", async () => {
    const t = await table();
    const base = "https://example.com/";
    const ok500 = base + "a".repeat(500 - base.length);
    const r = await put(t.sessionId, t.hostToken, { url: ok500 });
    expect([r.status, ok500.length]).toEqual([200, 500]);
    expect((await stored(t.sessionId)).url).toHaveLength(500);
    const r2 = await put(t.sessionId, t.hostToken, { url: ok500 + "a" });
    expect([r2.status, r2.body.error?.message]).toEqual([422, R.tooLong]);
    expect((await stored(t.sessionId)).url).toBe(ok500);
  });

  it("G54 the raw input is never stored: the stored value is the normalised href", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, { url: " Example.COM:443 " });
    expect((await stored(t.sessionId)).url).toBe("https://example.com/");
  });
});

describe("G6 label", () => {
  it("G60 label of exactly 40 is accepted, 41 -> 422 'Keep it under 40 characters.' and the old value stays", async () => {
    const t = await table();
    const l40 = "a".repeat(40);
    expect((await put(t.sessionId, t.hostToken, { url: URL1, label: l40 })).status).toBe(200);
    expect((await menuOf(t.jun))?.label).toBe(l40);
    const r = await put(t.sessionId, t.hostToken, { url: URL1, label: "a".repeat(41) });
    expect([r.status, r.body.error?.message]).toEqual([422, R.label]);
    expect((await menuOf(t.jun))?.label).toBe(l40);
  });

  it("G61 NFKC expansion past 40 -> 422 (not 500), nothing stored; exactly 40 after expansion is accepted", async () => {
    const t = await table();
    const r = await put(t.sessionId, t.hostToken, { url: URL1, label: "㍿".repeat(15) });
    expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([422, "INVALID", R.label]);
    expect((await stored(t.sessionId)).url).toBeNull();
    const ok = await put(t.sessionId, t.hostToken, { url: URL1, label: "㍿".repeat(10) });
    expect(ok.status).toBe(200);
    expect((await menuOf(t.jun))?.label).toBe("株式会社".repeat(10));
  });

  it("G62 NFKC expansion with a null url does not 500 (ignored label)", async () => {
    const t = await table();
    const r = await put(t.sessionId, t.hostToken, { url: null, label: "㍿".repeat(15) });
    expect(r.status).toBeLessThan(500);
  });

  it("G63 rejected requests (bad label, bad url) do not change the stored link", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, { url: URL1, label: "Keep" });
    await put(t.sessionId, t.hostToken, { url: URL1, label: "x".repeat(41) });
    await put(t.sessionId, t.hostToken, { url: "http://bad.example.com", label: "New" });
    expect(await menuOf(t.host)).toEqual({ url: URL1, label: "Keep", domain: "ramennagi.com.ph" });
  });

  it("G64 label whitespace is tidied (inner runs collapsed, ends trimmed)", async () => {
    const t = await table();
    await put(t.sessionId, t.hostToken, { url: URL1, label: "\t Main \n  menu  " });
    expect((await menuOf(t.jun))?.label).toBe("Main menu");
  });
});

describe("G7 closed order (D50)", () => {
  async function closed(t: T) {
    await put(t.sessionId, t.hostToken, { url: URL1, label: "A" });
    await add(db, t.host, { dishName: "Gyoza", quantity: 1 });
    await runMutation(db, t.host, { idempotencyKey: key(), type: "session.close" }, (tx, s) => closeSession(tx, s, t.host));
  }

  it("G70 after End the snapshot menu is null for host and guest, but the columns stay (retention)", async () => {
    const t = await table();
    await closed(t);
    expect(await menuOf(t.jun)).toBeNull();
    expect(await menuOf(t.host)).toBeNull();
    expect(await stored(t.sessionId)).toMatchObject({ url: URL1, label: "A" });
  });

  it("G71 PUT on a closed order -> 409 SESSION_CLOSED for edit, same value and remove; stored link unchanged", async () => {
    const t = await table();
    await closed(t);
    for (const body of [{ url: "https://example.com" }, { url: URL1, label: "A" }, { url: null }]) {
      const r = await put(t.sessionId, t.hostToken, body);
      expect([r.status, r.body.error?.code]).toEqual([409, "SESSION_CLOSED"]);
    }
    expect(await stored(t.sessionId)).toMatchObject({ url: URL1, label: "A" });
  });
});

describe("G8 rate limit: 10 changes per 10 minutes", () => {
  const hit = (t: T, i: number, token = t.hostToken) => put(t.sessionId, token, { url: `https://a${i}.example.com` });

  it("G80 the 11th real change -> 429 RATE_LIMITED 'Too many changes. Wait N seconds.', state and events unchanged", async () => {
    const t = await table();
    for (let i = 1; i <= 10; i++) expect((await hit(t, i)).status).toBe(200);
    const r = await hit(t, 11);
    expect([r.status, r.body.error?.code]).toEqual([429, "RATE_LIMITED"]);
    expect(r.body.error?.message).toMatch(/^Too many changes\. Wait (\d+ seconds|about \d+ minutes)\.$/);
    const secs = Number(/(\d+)/.exec(r.body.error?.message ?? "")?.[1]);
    expect(secs).toBeGreaterThan(0);
    expect(secs).toBeLessThanOrEqual(600);
    expect((await menuOf(t.jun))?.domain).toBe("a10.example.com");
    expect(await menuEvents(t.sessionId)).toHaveLength(10);
  });

  it("G81 guest 403s, zod 422s, same-value no-ops and key replays do not consume the host's 10", async () => {
    const t = await table();
    for (let i = 0; i < 15; i++) expect((await put(t.sessionId, t.junToken, { url: URL1 })).status).toBe(403);
    for (let i = 0; i < 12; i++) expect((await put(t.sessionId, t.hostToken, { url: "http://nope.example.com" })).status).toBe(422);
    const k = key();
    await put(t.sessionId, t.hostToken, { url: "https://a1.example.com" }, k);
    for (let i = 0; i < 12; i++) expect((await put(t.sessionId, t.hostToken, { url: "https://a1.example.com" }, k)).body.data?.replayed).toBe(true);
    for (let i = 0; i < 12; i++) expect((await put(t.sessionId, t.hostToken, { url: "https://a1.example.com" })).body.data?.result.changed).toBe(false);
    for (let i = 2; i <= 10; i++) expect((await hit(t, i)).status).toBe(200);
    expect((await hit(t, 11)).status).toBe(429);
  });

  it("G82 at the limit a same-value PUT is still 200 changed:false and an earlier key still replays; a real remove is 429", async () => {
    const t = await table();
    const k = key();
    await put(t.sessionId, t.hostToken, { url: "https://a1.example.com" }, k);
    for (let i = 2; i <= 10; i++) await hit(t, i);
    expect((await hit(t, 10)).body.data?.result.changed).toBe(false);
    const replay = await put(t.sessionId, t.hostToken, { url: "https://a1.example.com" }, k);
    expect([replay.status, replay.body.data?.replayed]).toEqual([200, true]);
    expect((await put(t.sessionId, t.hostToken, { url: null })).status).toBe(429);
    expect((await menuOf(t.jun))?.domain).toBe("a10.example.com");
  });

  it("G83 a 429 is not recorded against its key: retrying the same key while limited is 429 again, not a replayed 200", async () => {
    const t = await table();
    for (let i = 1; i <= 10; i++) await hit(t, i);
    const k = key();
    const a = await put(t.sessionId, t.hostToken, { url: "https://late.example.com" }, k);
    const b = await put(t.sessionId, t.hostToken, { url: "https://late.example.com" }, k);
    expect([a.status, b.status]).toEqual([429, 429]);
    expect((await menuOf(t.jun))?.domain).toBe("a10.example.com");
  });

  it("G84 the limit is per host, not shared across orders", async () => {
    const a = await table();
    const b = await table();
    for (let i = 1; i <= 10; i++) await hit(a, i);
    expect((await hit(a, 11)).status).toBe(429);
    expect((await hit(b, 1)).status).toBe(200);
  });
});

describe("G9 realtime and the host's confirmation", () => {
  it("G90 session.menuSet is non-ticket: set/edit/remove after the host looked do not make confirm stale", async () => {
    const t = await table();
    expect(NON_TICKET_EVENTS).toContain("session.menuSet");
    await add(db, t.host, { dishName: "Sisig", quantity: 1, attribution: { type: "TABLE" } });
    const looked = await getSnapshot(db, t.host);
    await put(t.sessionId, t.hostToken, { url: URL1, label: "A" });
    await put(t.sessionId, t.hostToken, { url: URL1, label: "B" });
    await put(t.sessionId, t.hostToken, { url: null });
    const r = await runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => confirmRound(tx, s, t.host, looked.activeRoundId, looked.session.revision));
    expect(r.result.roundId).toBe(looked.activeRoundId);
  });

  it("G91 control: a ticket event after looking still makes confirm stale (G90 is not vacuous)", async () => {
    const t = await table();
    await add(db, t.host, { dishName: "Sisig", quantity: 1, attribution: { type: "TABLE" } });
    const looked = await getSnapshot(db, t.host);
    await put(t.sessionId, t.hostToken, { url: URL1 });
    await add(db, t.host, { dishName: "Gyoza", quantity: 1, attribution: { type: "TABLE" } });
    await expect(runMutation(db, t.host, { idempotencyKey: key(), type: "t" }, (tx, s) => confirmRound(tx, s, t.host, looked.activeRoundId, looked.session.revision))).rejects.toMatchObject({ code: "STALE_REVISION" });
  });

  it("G92 a real change rings the salo_events bell with sessionId:revision within 15 s; a no-op does not", async () => {
    const t = await table();
    const heardAll: string[] = [];
    let got: (v: string) => void = () => undefined;
    const heard = new Promise<string>((res) => (got = res));
    const sub = await db.$client.listen("salo_events", (payload) => {
      if (payload.includes(t.sessionId)) {
        heardAll.push(payload);
        got(payload);
      }
    });
    try {
      const [msg, res] = await within(Promise.all([heard, put(t.sessionId, t.hostToken, { url: URL1 })]), "notify after PUT menu");
      expect(msg).toBe(`${t.sessionId}:${res.body.data?.revision}`);
      await put(t.sessionId, t.hostToken, { url: URL1 });
      await new Promise((r) => setTimeout(r, 400));
      expect(heardAll).toHaveLength(1);
    } finally {
      await sub.unlisten();
    }
  });

  it("G93 setting and removing the link leaves entries, readiness and rounds untouched (no effect on order history / KKB)", async () => {
    const t = await table();
    await add(db, t.host, { dishName: "Sisig", quantity: 2, attribution: { type: "TABLE" } });
    const view = async () => {
      const s = await getSnapshot(db, t.host);
      return JSON.stringify({ ...s, session: { ...s.session, menu: null, revision: 0, expiresAt: null } });
    };
    const before = await view();
    await put(t.sessionId, t.hostToken, { url: URL1, label: "A" });
    await put(t.sessionId, t.hostToken, { url: null });
    expect(await view()).toBe(before);
  });
});

describe("G10 database CHECKs", () => {
  it("G100 label without url, url over 500 and label over 40 are refused by the database", async () => {
    const t = await table();
    await expect(db.execute(sql`UPDATE sessions SET menu_label = 'x' WHERE id = ${t.sessionId}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE sessions SET menu_url = ${"https://e.com/" + "a".repeat(500)} WHERE id = ${t.sessionId}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE sessions SET menu_url = 'https://e.com/', menu_label = ${"a".repeat(41)} WHERE id = ${t.sessionId}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE sessions SET menu_url = 'https://e.com/', menu_label = ${"a".repeat(40)} WHERE id = ${t.sessionId}`)).resolves.toBeDefined();
  });
});

describe("G11 concurrency", () => {
  it("G110 two concurrent different PUTs both apply in order: two events, revision +2, final = one of them", async () => {
    const t = await table();
    const r0 = (await stored(t.sessionId)).revision;
    const [a, b] = await Promise.all([put(t.sessionId, t.hostToken, { url: "https://a.example.com" }), put(t.sessionId, t.hostToken, { url: "https://b.example.com" })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const s = await stored(t.sessionId);
    expect(s.revision).toBe(r0 + 2);
    expect(["https://a.example.com/", "https://b.example.com/"]).toContain(s.url);
    expect(await menuEvents(t.sessionId)).toHaveLength(2);
  });

  it("G111 five concurrent PUTs with the same key apply once: one replayed:false, four replayed:true, one event", async () => {
    const t = await table();
    const k = key();
    const rs = await Promise.all(Array.from({ length: 5 }, () => put(t.sessionId, t.hostToken, { url: URL1 }, k)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(rs.filter((r) => r.body.data?.replayed === false)).toHaveLength(1);
    expect(await menuEvents(t.sessionId)).toHaveLength(1);
  });

  it("G112 twelve concurrent distinct changes: exactly 10 succeed, 2 are 429, exactly 10 events", async () => {
    const t = await table();
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => put(t.sessionId, t.hostToken, { url: `https://c${i}.example.com` })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(10);
    expect(rs.filter((r) => r.status === 429)).toHaveLength(2);
    expect(await menuEvents(t.sessionId)).toHaveLength(10);
  });

  it("G113 PUT racing End: no 500; PUT is applied-before-close (200) or 409, and the snapshot menu is null afterwards", async () => {
    const t = await table();
    await add(db, t.host, { dishName: "Gyoza", quantity: 1 });
    const [r] = await Promise.all([
      put(t.sessionId, t.hostToken, { url: URL1 }),
      runMutation(db, t.host, { idempotencyKey: key(), type: "session.close" }, (tx, s) => closeSession(tx, s, t.host)),
    ]);
    expect([200, 409]).toContain(r.status);
    expect(await menuOf(t.jun)).toBeNull();
  });
});
