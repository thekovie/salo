import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolveActor } from "@/server/auth/actor";
import { createReplayStore } from "@/server/auth/replay";
import { sessions } from "@/server/db/schema";
import { readCapped } from "@/server/http";
import { runMutation } from "@/server/mutations";
import { findInvite, joinSession } from "@/server/sessions/join";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, key, newSession } from "./helpers/session";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());
const errorOf = (p: Promise<unknown>) => p.then(() => null, (e: { status?: number; code?: string }) => e);

function chunked(bytes: number): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let sent = 0; sent < bytes; sent += 1024) controller.enqueue(new TextEncoder().encode("x".repeat(Math.min(1024, bytes - sent))));
      controller.close();
    },
  });
  // No Content-Length: a chunked upload.
  return new Request("http://x/api", { method: "POST", body, duplex: "half" } as RequestInit);
}

describe("request bodies (finding 9)", () => {
  it("stops reading a chunked body as soon as it passes the limit", async () => {
    expect(await errorOf(readCapped(chunked(9 * 1024), 8 * 1024))).toMatchObject({ status: 413, code: "TOO_LARGE" });
    expect(await readCapped(chunked(2048), 8 * 1024)).toHaveLength(2048);
  });
});

describe("idempotency keys are tied to one change (finding 8)", () => {
  it("refuses the same key for a change to another target", async () => {
    const { host } = await newSession(db);
    const k = key();
    await runMutation(db, host, { idempotencyKey: k, type: "entry.update:aaa" }, async () => ({ result: {}, event: { type: "t", payload: {} } }));
    expect(await errorOf(runMutation(db, host, { idempotencyKey: k, type: "entry.update:bbb" }, async () => ({ result: {}, event: { type: "t", payload: {} } })))).toMatchObject({
      status: 422,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("remembers a create or join for a retry, and forgets after ten minutes", () => {
    const store = createReplayStore<{ sessionId: string }>(`test-${randomUUID()}`);
    store.set("k1", { sessionId: "s1" }, 0);
    expect(store.get("k1", 60_000)).toEqual({ sessionId: "s1" });
    expect(store.get("k1", 11 * 60_000)).toBeUndefined();
  });
});

describe("an order past its deletion date is gone before the hourly cleanup", () => {
  it("can't be read, joined or changed, and isn't revived", async () => {
    const { host, sessionId, token } = await newSession(db);
    const snap = await getSnapshot(db, host);
    await db.execute(sql`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = ${sessionId}`);
    expect(await resolveActor(db, sessionId, token)).toBeNull();
    expect(await findInvite(db, snap.session.joinCode)).toBeNull();
    expect(await errorOf(joinSession(db, snap.session.joinCode, "JD", sessionId))).toMatchObject({ status: 404 });
    expect(await errorOf(add(db, host, { dishName: "Rice", quantity: 1 }))).toMatchObject({ status: 404 });
    const [row] = await db.select({ expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.id, sessionId));
    expect(row.expiresAt.getTime()).toBeLessThan(Date.now());
  });
});
