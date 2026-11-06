import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolveActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { participants, sessionEvents, sessions } from "@/server/db/schema";
import { eventsAfter, parseCursor, REPLAY_LIMIT } from "@/server/realtime/events";
import { openEventStream } from "@/server/realtime/stream";
import { findInvite, joinSession } from "@/server/sessions/join";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, newSession } from "./helpers/session";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(async () => {
  await db.$client.end();
  await getDb().$client.end();
});

async function codeOf(sessionId: string) {
  const [row] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, sessionId));
  return row.code;
}

async function errorOf(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (e: { code?: string; status?: number }) => e,
  );
}

describe("joining", () => {
  it("joins with the code (forgiving input) as a guest with a working credential, never as host", async () => {
    const { host, sessionId } = await newSession(db);
    const code = await codeOf(sessionId);
    const joined = await joinSession(db, code.toLowerCase().replace(/(...)/, "$1 "), "  Rafa ");
    const guest = await resolveActor(db, sessionId, joined.token);
    expect(guest).toMatchObject({ role: "GUEST", displayName: "Rafa", sessionId });
    const snapshot = await getSnapshot(db, host);
    expect(snapshot.participants.map((p) => [p.displayName, p.role])).toEqual([
      ["Host", "HOST"],
      ["Rafa", "GUEST"],
    ]);
    expect(snapshot.session.revision).toBe(2);
  });

  it("lets two people use the same name and keeps them distinct", async () => {
    const { sessionId } = await newSession(db);
    const code = await codeOf(sessionId);
    const a = await joinSession(db, code, "Miguel");
    const b = await joinSession(db, code, "Miguel");
    expect(a.participantId).not.toBe(b.participantId);
  });

  it("refuses unknown codes, a code for a different session id, blank names and closed orders", async () => {
    const { sessionId } = await newSession(db);
    const other = await newSession(db);
    const code = await codeOf(sessionId);
    expect(await errorOf(joinSession(db, "ZZZZZZ", "Rafa"))).toMatchObject({ status: 404 });
    expect(await errorOf(joinSession(db, code, "Rafa", other.sessionId))).toMatchObject({ status: 404 });
    expect(await errorOf(joinSession(db, code, "   "))).toMatchObject({ status: 422 });
    await db.update(sessions).set({ status: "CLOSED", closedAt: new Date() }).where(eq(sessions.id, sessionId));
    expect(await errorOf(joinSession(db, code, "Rafa"))).toMatchObject({ code: "SESSION_CLOSED" });
  });

  it("caps the table at 30 people", async () => {
    const { sessionId } = await newSession(db);
    await db.insert(participants).values(Array.from({ length: 29 }, (_, i) => ({ sessionId, displayName: `G${i}`, role: "GUEST" as const })));
    expect(await errorOf(joinSession(db, await codeOf(sessionId), "One too many"))).toMatchObject({ code: "TABLE_FULL" });
  });

  it("previews an invite with only its name, status and round", async () => {
    const { sessionId } = await newSession(db);
    const invite = await findInvite(db, await codeOf(sessionId));
    expect(invite).toEqual({ sessionId, title: null, status: "OPEN", roundNumber: 1 });
    expect(await findInvite(db, "not-a-code")).toBeNull();
  });
});

describe("event log replay", () => {
  it("replays events after a cursor in revision order", async () => {
    const { host, sessionId } = await newSession(db);
    await add(db, host, { dishName: "Gyoza", quantity: 1 });
    await add(db, host, { dishName: "Rice", quantity: 1 });
    const replay = await eventsAfter(db, sessionId, 1);
    expect(replay.kind === "events" && replay.events.map((e) => [e.id, e.type])).toEqual([
      [2, "entry.added"],
      [3, "entry.added"],
    ]);
    expect(await eventsAfter(db, sessionId, 3)).toEqual({ kind: "events", events: [] });
  });

  it("asks for a resync when history has a gap or is too long", async () => {
    const { host, sessionId } = await newSession(db);
    await add(db, host, { dishName: "Gyoza", quantity: 1 });
    await add(db, host, { dishName: "Rice", quantity: 1 });
    await db.delete(sessionEvents).where(eq(sessionEvents.revision, 2));
    expect(await eventsAfter(db, sessionId, 1)).toEqual({ kind: "resync" });
    await db.insert(sessionEvents).values(Array.from({ length: REPLAY_LIMIT + 1 }, (_, i) => ({ sessionId, revision: 100 + i, eventType: "x" })));
    expect(await eventsAfter(db, sessionId, 99)).toEqual({ kind: "resync" });
  });

  it("parses only numeric cursors", () => {
    expect(parseCursor("12")).toBe(12);
    expect(parseCursor("-1")).toBeNull();
    expect(parseCursor("1e9")).toBeNull();
    expect(parseCursor(null)).toBeNull();
  });
});

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, predicate: (text: string) => boolean, timeoutMs = 5000) {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (!predicate(text)) {
    if (Date.now() > deadline) throw new Error(`timed out; got: ${text}`);
    const { value, done } = await Promise.race([reader.read(), new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), 500))]);
    if (value) text += decoder.decode(value);
    else if (done && Date.now() > deadline) break;
  }
  return text;
}

describe("event stream", () => {
  it("replays missed events, then delivers new commits to every open stream", async () => {
    const { host, sessionId } = await newSession(db);
    const guestJoin = await joinSession(db, await codeOf(sessionId), "Rafa");
    const guest = (await resolveActor(db, sessionId, guestJoin.token))!;
    await add(db, host, { dishName: "Gyoza", quantity: 1 }); // revision 3

    const a = new AbortController();
    const b = new AbortController();
    const hostStream = (await openEventStream(db, host, "test", 1, a.signal))!.getReader();
    const guestStream = (await openEventStream(db, guest, "test", 3, b.signal))!.getReader();
    const replayed = await readUntil(hostStream, (t) => t.includes("id: 3"));
    expect(replayed).toContain("retry: 3000");
    expect(replayed).toMatch(/id: 2\nevent: change\ndata: .*participant\.joined/);

    await add(db, guest, { dishName: "Ramen", quantity: 2 }); // revision 4, committed elsewhere
    expect(await readUntil(hostStream, (t) => t.includes("id: 4"))).toContain("entry.added");
    expect(await readUntil(guestStream, (t) => t.includes("id: 4"))).toContain(`"sessionId":"${sessionId}"`);
    a.abort();
    b.abort();
  });

  it("sends a resync when the cursor cannot be replayed", async () => {
    const { host, sessionId } = await newSession(db);
    await add(db, host, { dishName: "Gyoza", quantity: 1 });
    await db.delete(sessionEvents).where(eq(sessionEvents.sessionId, sessionId));
    const abort = new AbortController();
    const reader = (await openEventStream(db, host, "test", 0, abort.signal))!.getReader();
    expect(await readUntil(reader, (t) => t.includes("event: resync"))).toContain("id: 2\nevent: resync");
    abort.abort();
  });
});
