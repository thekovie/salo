import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions";
import { confirmedRoundSnapshots, orderEntries, participants, sessionEvents, sessions } from "@/server/db/schema";
import { deleteExpiredSessions } from "@/server/maintenance/cleanup";
import { runMutation } from "@/server/mutations";
import { closeSession, confirmRound } from "@/server/orders/rounds";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, addGuest, key, newSession } from "./helpers/session";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const DAY = 86_400_000;
const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3]) => runMutation(db, actor, { idempotencyKey: key(), type: "t" }, apply);

describe("retention cleanup (brief 12, scenario 14)", () => {
  it("deletes a closed session and everything in it 7 days after closing, not before", async () => {
    const { host, sessionId } = await newSession(db);
    await addGuest(db, sessionId, "Rafa");
    await add(db, host, { dishName: "Gyoza", quantity: 2 });
    const snap = await getSnapshot(db, host);
    await run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, snap.session.revision));
    const { result } = await run(host, (tx, s) => closeSession(tx, s, host));
    const closedAt = new Date(result.closedAt);

    expect(await deleteExpiredSessions(db, new Date(closedAt.getTime() + 7 * DAY - 60_000))).toBe(0);
    expect(await deleteExpiredSessions(db, new Date(closedAt.getTime() + 7 * DAY + 1))).toBe(1);
    for (const table of [sessions, participants, orderEntries, sessionEvents, confirmedRoundSnapshots]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
  });

  it("deletes a never-closed session after 30 days without activity; activity moves the date", async () => {
    const { host, sessionId } = await newSession(db);
    const [before] = await db.select({ expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.id, sessionId));
    expect(before.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * DAY);
    // Pretend it went quiet 31 days ago.
    await db.execute(sql`UPDATE sessions SET last_activity_at = now() - interval '31 days', expires_at = now() - interval '1 day' WHERE id = ${sessionId}`);
    const other = await newSession(db);
    await add(db, other.host, { dishName: "Rice", quantity: 1 });
    expect(await deleteExpiredSessions(db)).toBe(1);
    const left = await db.select({ id: sessions.id }).from(sessions);
    expect(left.map((s) => s.id)).toEqual([other.sessionId]);
    void host;
  });
});
