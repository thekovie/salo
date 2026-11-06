import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions";
import { hashToken, newToken } from "@/server/auth/credentials";
import { removedFrom, resolveActor } from "@/server/auth/actor";
import { participantCredentials, participants, sessionEvents } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { requestClaim, removeParticipant, restoreParticipant } from "@/server/orders/people";
import { confirmRound, openRound } from "@/server/orders/rounds";
import { getSnapshot } from "@/server/sessions/snapshot";
import { joinSession } from "@/server/sessions/join";
import { resetDb, testDb } from "./helpers/db";
import { add, addGuest, key, newSession } from "./helpers/session";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3]) => runMutation(db, actor, { idempotencyKey: key(), type: "t" }, apply);
const errorOf = (promise: Promise<unknown>) => promise.then(() => null, (e: { code?: string; status?: number }) => e);

async function guestWithToken(sessionId: string, name: string) {
  const token = newToken();
  const guest = await addGuest(db, sessionId, name);
  // addGuest made its own credential; add one we know the token of.
  await db.insert(participantCredentials).values({ sessionId, participantId: guest.participantId, credentialType: "GUEST", credentialHash: hashToken(token) });
  return { guest, token };
}

describe("removing a guest (host only)", () => {
  it("takes their open-round dishes off, keeps confirmed ones, and tells only them why", async () => {
    const { host, sessionId } = await newSession(db);
    const { guest: jd, token } = await guestWithToken(sessionId, "JD");
    await add(db, jd, { dishName: "Gyoza", quantity: 2, attribution: { type: "INDIVIDUAL" } });
    let snap = await getSnapshot(db, host);
    await run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, snap.session.revision));
    await run(host, (tx, s) => openRound(tx, s, host));
    await add(db, jd, { dishName: "Rice", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await add(db, host, { dishName: "Halo-halo", quantity: 1, attribution: { type: "INDIVIDUAL", participantId: jd.participantId } });

    expect(await errorOf(run(jd, (tx, s) => removeParticipant(tx, s, jd, host.participantId, null)))).toMatchObject({ status: 403 });
    expect(await errorOf(run(host, (tx, s) => removeParticipant(tx, s, host, host.participantId, null)))).toMatchObject({ code: "CANNOT_REMOVE_HOST" });

    const { result } = await run(host, (tx, s) => removeParticipant(tx, s, host, jd.participantId, "  Wrong   table, sorry! "));
    expect(result.removedEntries).toBe(1);
    snap = await getSnapshot(db, host);
    const names = snap.entries.map((e) => e.dishName).sort();
    // Rice (their own, open round) is gone; Gyoza (confirmed) and the host's Halo-halo for them stay.
    expect(names).toEqual(["Gyoza", "Halo-halo"]);
    expect(snap.participants.map((p) => p.displayName)).not.toContain("JD");
    expect(snap.removedPeople).toEqual([{ id: jd.participantId, displayName: "JD" }]);

    // They are nobody here now; only their own page learns the reason. The event never carries it.
    expect(await resolveActor(db, sessionId, token)).toBeNull();
    expect(await removedFrom(db, sessionId, token)).toEqual({ reason: "Wrong table, sorry!" });
    const events = await db.select().from(sessionEvents).where(eq(sessionEvents.eventType, "participant.removed"));
    expect(JSON.stringify(events.map((e) => e.payload))).not.toContain("Wrong");
    expect(await errorOf(run(host, (tx, s) => removeParticipant(tx, s, host, jd.participantId, null)))).toMatchObject({ code: "ALREADY_REMOVED" });
  });

  it("clears their pending claims, and Undo brings them and their dishes back", async () => {
    const { host, sessionId } = await newSession(db);
    const { guest: jd, token } = await guestWithToken(sessionId, "JD");
    const hostDish = await add(db, host, { dishName: "Sisig", quantity: 1 });
    await add(db, jd, { dishName: "Rice", quantity: 2, attribution: { type: "INDIVIDUAL" } });
    const before = await getSnapshot(db, host);
    const batchId = before.entries.find((e) => e.id === hostDish.result.entryId)!.batchId;
    await run(jd, (tx, s) => requestClaim(tx, s, jd, batchId));

    await run(host, (tx, s) => removeParticipant(tx, s, host, jd.participantId, null));
    expect((await getSnapshot(db, host)).claims).toHaveLength(0);
    expect(await removedFrom(db, sessionId, token)).toEqual({ reason: null });

    const { result } = await run(host, (tx, s) => restoreParticipant(tx, s, host, jd.participantId));
    expect(result.restoredEntries).toBe(1);
    const after = await getSnapshot(db, host);
    expect(after.entries.map((e) => e.dishName).sort()).toEqual(["Rice", "Sisig"]);
    expect(await resolveActor(db, sessionId, token)).not.toBeNull();
  });

  it("lets them join again as a new guest, and frees their seat", async () => {
    const { host, sessionId } = await newSession(db);
    const { guest: jd } = await guestWithToken(sessionId, "JD");
    await run(host, (tx, s) => removeParticipant(tx, s, host, jd.participantId, null));
    const snap = await getSnapshot(db, host);
    const joined = await joinSession(db, snap.session.joinCode, "JD", sessionId);
    const again = await resolveActor(db, sessionId, joined.token);
    expect(again?.participantId).not.toBe(jd.participantId);
    expect(await db.select().from(participants).where(eq(participants.sessionId, sessionId))).toHaveLength(3);
  });
});

describe("after a removal", () => {
  it("refuses a change from the removed guest that was already past the cookie check", async () => {
    const { host, sessionId } = await newSession(db);
    const { guest: jd } = await guestWithToken(sessionId, "JD");
    await run(host, (tx, s) => removeParticipant(tx, s, host, jd.participantId, null));
    // `jd` is the Actor resolved before the removal: runMutation must still say no.
    expect(await errorOf(add(db, jd, { dishName: "Rice", quantity: 1 }))).toMatchObject({ status: 403, code: "REMOVED" });
  });

  it("does not let anyone mark a dish for the removed guest", async () => {
    const { host, sessionId } = await newSession(db);
    const { guest: jd } = await guestWithToken(sessionId, "JD");
    await run(host, (tx, s) => removeParticipant(tx, s, host, jd.participantId, null));
    expect(await errorOf(add(db, host, { dishName: "Rice", quantity: 1, attribution: { type: "INDIVIDUAL", participantId: jd.participantId } }))).toMatchObject({ code: "UNKNOWN_PERSON" });
  });
});
