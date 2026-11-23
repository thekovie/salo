import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies[name] ? { name, value: jar.cookies[name] } : undefined) }),
}));

import { POST as MARK_READ } from "@/app/api/sessions/[id]/notifications/read/route";
import { correctionAudience } from "@/lib/corrections";
import { markReadLocal, notificationText } from "@/lib/notifications";
import type { Actor } from "@/lib/permissions";
import { trackerLines } from "@/lib/serving";
import { proxy } from "@/proxy";
import { resolveActor } from "@/server/auth/actor";
import { credentialCookieName } from "@/server/auth/credentials";
import { getDb } from "@/server/db/client";
import { notifications, participants, sessionEvents, sessions } from "@/server/db/schema";
import { runMutation } from "@/server/mutations";
import { notify } from "@/server/notifications";
import { setEntryRemoved } from "@/server/orders/entries";
import { setGroupMembers, setReady } from "@/server/orders/people";
import { closeSession, confirmRound, openRound, recordCorrections, removeCorrection } from "@/server/orders/rounds";
import { updateServed } from "@/server/orders/serving";
import { setEntrySettlement, setSharedPrice } from "@/server/orders/settlement";
import { markDishUnavailable } from "@/server/orders/unavailable";
import { correctionBatchSchema, entrySettlementSchema, servingSchema, sharedPriceSchema, unavailableSchema } from "@/server/orders/validation";
import { joinSession } from "@/server/sessions/join";
import { getSnapshot } from "@/server/sessions/snapshot";
import { resetDb, testDb } from "./helpers/db";
import { add, addGuest, key, newSession, storedServed } from "./helpers/session";

const db = testDb();
beforeEach(async () => {
  jar.cookies = {};
  await resetDb(db);
});
afterAll(async () => {
  await db.$client.end();
  await getDb().$client.end();
});

const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3], type = "t") => runMutation(db, actor, { idempotencyKey: key(), type }, apply);
const confirm = async (a: Actor) => {
  const snap = await getSnapshot(db, a);
  return run(a, (tx, s) => confirmRound(tx, s, a, snap.activeRoundId, snap.session.revision));
};
const open = (a: Actor) => run(a, (tx, s) => openRound(tx, s, a));
const mine = async (a: Actor) => (await getSnapshot(db, a)).notifications;
const types = async (a: Actor) => (await mine(a)).items.map((n) => n.type).sort();
const forPerson = (a: Actor) => ({ type: "INDIVIDUAL", participantId: a.participantId });

async function table() {
  const { host, sessionId, token } = await newSession(db);
  const ana = await addGuest(db, sessionId, "Ana");
  const ben = await addGuest(db, sessionId, "Ben");
  return { host, ana, ben, sessionId, hostToken: token };
}
const dishId = async (a: Actor, name: string) => (await getSnapshot(db, a)).entries.find((e) => e.dishName === name)!.dishId;

describe("recipients, the actor and dedup", () => {
  it("round confirmed and a new round go to every guest, never to the host who did it", async () => {
    const { host, ana, ben } = await table();
    await add(db, host, { dishName: "Gyoza", quantity: 1 });
    await confirm(host);
    await open(host);
    expect(await types(ana)).toEqual(["round.confirmed", "round.opened"]);
    expect(await types(ben)).toEqual(["round.confirmed", "round.opened"]);
    expect((await mine(host)).items).toEqual([]);
  });

  it("a repeat of the same key does nothing; a late joiner starts empty", async () => {
    const { host, ana, sessionId } = await table();
    const send = () => db.transaction((tx) => notify(tx, sessionId, { type: "round.opened", subject: { roundNumber: 2 }, recipients: [ana.participantId, host.participantId], dedupKey: "k", actorId: host.participantId }));
    expect(await send()).toEqual([ana.participantId]);
    await send();
    expect((await mine(ana)).items).toHaveLength(1);
    const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, sessionId));
    const late = await joinSession(db, code, "Late", sessionId);
    expect((await mine((await resolveActor(db, sessionId, late.token)) as Actor)).items).toEqual([]);
  });

  it("dish unavailable goes to the people its entries are for, and everyone for a whole-table entry", async () => {
    const { host, ana, ben } = await table();
    await add(db, host, { dishName: "Sisig", quantity: 2, attribution: forPerson(ana) });
    await add(db, host, { dishName: "Gyoza", quantity: 1, attribution: forPerson(ben) });
    const sisig = await dishId(host, "Sisig");
    await run(host, (tx, s) => markDishUnavailable(tx, s, host, sisig, unavailableSchema.parse({})));
    expect((await mine(ana)).items.map((n) => notificationText(n))).toEqual(["Sisig is unavailable · 2 removed from your order"]);
    expect((await mine(ben)).items).toEqual([]);
    expect((await mine(host)).items).toEqual([]);

    await add(db, host, { dishName: "Adobo", quantity: 1, attribution: { type: "TABLE" } });
    const adobo = await dishId(host, "Adobo");
    await run(host, (tx, s) => markDishUnavailable(tx, s, host, adobo, unavailableSchema.parse({})));
    expect(await types(ben)).toEqual(["dish.unavailable"]);
  });

  it("Undo of Mark unavailable deletes its update so a later one is not swallowed", async () => {
    const { host, ana } = await table();
    const e = await add(db, host, { dishName: "Sisig", quantity: 1, attribution: forPerson(ana) });
    const sisig = await dishId(host, "Sisig");
    await run(host, (tx, s) => markDishUnavailable(tx, s, host, sisig, unavailableSchema.parse({})));
    expect((await mine(ana)).items).toHaveLength(1);
    await run(host, (tx, s) => setEntryRemoved(tx, s, host, e.result.entryId, false));
    expect((await mine(ana)).items).toEqual([]);
    await run(host, (tx, s) => markDishUnavailable(tx, s, host, sisig, unavailableSchema.parse({})));
    expect((await mine(ana)).items).toHaveLength(1);
  });

  it("a correction notifies nobody when recorded; confirming the round tells the people it is for, once per batch", async () => {
    const { host, ana, ben } = await table();
    await add(db, host, { dishName: "Katsu", quantity: 2, attribution: forPerson(ana) });
    await add(db, host, { dishName: "Katsu", quantity: 2, attribution: forPerson(ben) });
    await confirm(host);
    await open(host);
    const snap = await getSnapshot(db, host);
    const batch = correctionBatchSchema.parse({ type: "QUANTITY", entries: snap.entries.map((e) => ({ sourceEntryId: e.id, quantity: 1 })) });
    await run(host, (tx, s) => recordCorrections(tx, s, host, batch));
    expect(await types(ana)).toEqual(["round.confirmed", "round.opened"]);
    await confirm(host);
    for (const g of [ana, ben]) {
      const items = (await mine(g)).items.filter((n) => n.type === "order.correctionTold");
      expect(items.map((n) => notificationText(n))).toEqual(["Order corrected: 1 Katsu cancelled"]);
    }
  });

  it("removing a pending correction leaves no update, before or after the round is confirmed", async () => {
    const { host, ana } = await table();
    await add(db, host, { dishName: "Katsu", quantity: 2, attribution: forPerson(ana) });
    await confirm(host);
    await open(host);
    const snap = await getSnapshot(db, host);
    const made = await run(host, (tx, s) => recordCorrections(tx, s, host, correctionBatchSchema.parse({ type: "QUANTITY", entries: [{ sourceEntryId: snap.entries[0].id, quantity: 1 }] })));
    await run(host, (tx, s) => removeCorrection(tx, s, host, made.result.correctionIds[0]));
    await add(db, host, { dishName: "Rice", quantity: 1 });
    await confirm(host);
    expect(await types(ana)).toEqual(["round.confirmed", "round.confirmed", "round.opened"]);
  });

  it("repro A: Undo removal keeps the told cancel of someone whose dish was cancelled, and deletes draft-only notices", async () => {
    const { host, ana, ben } = await table();
    const cy = await addGuest(db, host.sessionId, "Cy");
    await add(db, host, { dishName: "Sisig", quantity: 1, attribution: forPerson(ana) });
    await add(db, host, { dishName: "Sisig", quantity: 1, attribution: forPerson(ben) });
    await confirm(host);
    await open(host);
    const e2 = await add(db, host, { dishName: "Sisig", quantity: 1, attribution: forPerson(ana) });
    const e3 = await add(db, host, { dishName: "Sisig", quantity: 1, attribution: forPerson(cy) });
    const sisig = await dishId(host, "Sisig");
    await run(host, (tx, s) => markDishUnavailable(tx, s, host, sisig, unavailableSchema.parse({})));
    for (const e of [e2, e3]) await run(host, (tx, s) => setEntryRemoved(tx, s, host, e.result.entryId, false));
    const gone = async (a: Actor) => (await mine(a)).items.filter((n) => n.type === "dish.unavailable").map((n) => notificationText(n));
    expect(await gone(ben)).toEqual(["Sisig is unavailable · 1 cancelled from your order"]);
    expect(await gone(ana)).toEqual(["Sisig is unavailable · 1 cancelled from your order"]);
    expect((await types(cy)).includes("dish.unavailable")).toBe(false);
  });

  it("repro B: a swap after a told cancel reports what was left", async () => {
    const { host, ana } = await table();
    await add(db, host, { dishName: "Katsu", quantity: 3, attribution: forPerson(ana) });
    await confirm(host);
    await open(host);
    const src = (await getSnapshot(db, host)).entries[0].id;
    await run(host, (tx, s) => recordCorrections(tx, s, host, correctionBatchSchema.parse({ type: "QUANTITY", entries: [{ sourceEntryId: src, quantity: 1 }] })));
    await add(db, host, { dishName: "Rice", quantity: 1 });
    await confirm(host);
    await open(host);
    await run(host, (tx, s) => recordCorrections(tx, s, host, correctionBatchSchema.parse({ type: "REPLACE", replacement: "Tonkatsu", entries: [{ sourceEntryId: src }] })));
    await add(db, host, { dishName: "Rice", quantity: 1 });
    await confirm(host);
    const texts = (await mine(ana)).items.filter((n) => n.type === "order.correctionTold").map((n) => notificationText(n));
    expect(texts.sort()).toEqual(["Order corrected: 1 Katsu cancelled", "Order corrected: 2 Katsu changed to Tonkatsu"]);
  });

  it("a table price change skips lines that have their own price", async () => {
    const { host, ana, ben } = await table();
    const a = await add(db, host, { dishName: "Katsu", quantity: 1, attribution: forPerson(ana) });
    await add(db, host, { dishName: "Katsu", quantity: 1, attribution: forPerson(ben) });
    const katsu = await dishId(host, "Katsu");
    await run(host, (tx, s) => setEntrySettlement(tx, s, host, a.result.entryId, entrySettlementSchema.parse({ unitPriceCentavos: 9000, expectedRevision: 0 })));
    await run(host, (tx, s) => setSharedPrice(tx, s, host, sharedPriceSchema.parse({ dishId: katsu, variant: null, unitCentavos: 12000, expectedRevision: 0 })));
    expect(await types(ana)).toEqual([]);
    expect(await types(ben)).toEqual(["price.defaultSet"]);
  });

  it("a group dish notifies the group's members, not everyone; a label-only group still notifies everyone", async () => {
    const { host, ana, ben } = await table();
    await run(host, (tx, s) => setGroupMembers(tx, s, host, "the boys", [ana.participantId]));
    await add(db, host, { dishName: "Soup", quantity: 1, attribution: { type: "GROUP", label: "the boys" } });
    await add(db, host, { dishName: "Pie", quantity: 1, attribution: { type: "GROUP", label: "the girls" } });
    for (const name of ["Soup", "Pie"]) {
      const id = await dishId(host, name);
      await run(host, (tx, s) => markDishUnavailable(tx, s, host, id, unavailableSchema.parse({})));
    }
    expect((await mine(ana)).items.map((n) => n.subject.dishName).sort()).toEqual(["Pie", "Soup"]);
    expect((await mine(ben)).items.map((n) => n.subject.dishName)).toEqual(["Pie"]);
  });

  it("a changed table price notifies people with that dish and size, once per change", async () => {
    const { host, ana, ben } = await table();
    await add(db, host, { dishName: "Katsu", quantity: 1, variant: "Large", attribution: forPerson(ana) });
    await add(db, host, { dishName: "Katsu", quantity: 1, variant: "Small", attribution: forPerson(ben) });
    const katsu = await dishId(host, "Katsu");
    const set = (centavos: number | null, expectedRevision: number) => run(host, (tx, s) => setSharedPrice(tx, s, host, sharedPriceSchema.parse({ dishId: katsu, variant: "Large", unitCentavos: centavos, expectedRevision })));
    await set(12000, 0);
    await set(12000, 1);
    expect((await mine(ana)).items.map((n) => notificationText(n))).toEqual([expect.stringMatching(/^Table price for Katsu \(Large\) is now .*120/)]);
    expect((await mine(ben)).items).toEqual([]);
    await set(13000, 2);
    expect((await mine(ana)).items).toHaveLength(2);
  });

  it("served: a line becoming fully served notifies its people once, even going full, not full, full again", async () => {
    const { host, ana, ben } = await table();
    await add(db, host, { dishName: "Katsu", quantity: 2, attribution: forPerson(ana) });
    await add(db, host, { dishName: "Gyoza", quantity: 1, attribution: forPerson(ben) });
    await confirm(host);
    const snap = await getSnapshot(db, host);
    const line = trackerLines(snap).rounds[0].lines.find((l) => l.label === "Katsu")!;
    const serve = async (delta: number) => {
      const expectedServed = await storedServed(db, host.sessionId, snap.rounds[0].id, line.key);
      return run(host, (tx, s) => updateServed(tx, s, host, servingSchema.parse({ roundId: snap.rounds[0].id, lineKey: line.key, delta, expectedServed })), "serving.update");
    };
    await serve(1);
    expect(await types(ana)).toEqual(["round.confirmed"]);
    await serve(1);
    await serve(-1);
    await serve(1);
    const served = (await mine(ana)).items.filter((n) => n.type === "food.served");
    expect(served.map((n) => notificationText(n))).toEqual(["Katsu is all served"]);
    expect(await types(ben)).toEqual(["round.confirmed"]);
  });

  it("the host hears when every guest is ready, once per round; the order ending reaches everyone but the host", async () => {
    const { host, ana, ben } = await table();
    await add(db, host, { dishName: "Gyoza", quantity: 1 });
    const ready = (a: Actor, r: boolean) => run(a, (tx, s) => setReady(tx, s, a, r));
    await ready(ana, true);
    expect((await mine(host)).items).toEqual([]);
    await ready(ben, true);
    await ready(ben, false);
    await ready(ben, true);
    expect(await types(host)).toEqual(["guests.ready"]);
    await confirm(host);
    await run(host, (tx, s) => closeSession(tx, s, host));
    expect(await types(ana)).toEqual(["order.ended", "round.confirmed"]);
    expect(await types(host)).toEqual(["guests.ready"]);
  });
});

describe("snapshot and storage", () => {
  it("a snapshot holds only your own updates, the latest 50, with the full unread count", async () => {
    const { host, ana, ben, sessionId } = await table();
    const rows = Array.from({ length: 55 }, (_, i) => ({ sessionId, recipientId: ana.participantId, type: "round.opened", subject: { roundNumber: i }, dedupKey: `k${i}` }));
    await db.insert(notifications).values([...rows, { sessionId, recipientId: ben.participantId, type: "round.opened", subject: {}, dedupKey: "ben" }]);
    const view = await mine(ana);
    expect(view.items).toHaveLength(50);
    expect(view.unread).toBe(55);
    expect(view.items.every((n) => n.type === "round.opened")).toBe(true);
    expect((await mine(ben)).items).toHaveLength(1);
    expect((await mine(host)).items).toEqual([]);
  });

  it("deleting a participant or the session deletes their updates", async () => {
    const { ana, ben, sessionId } = await table();
    await db.insert(notifications).values([ana, ben].map((a, i) => ({ sessionId, recipientId: a.participantId, type: "round.opened", subject: {}, dedupKey: `k${i}` })));
    await db.delete(participants).where(eq(participants.id, ana.participantId));
    expect(await db.select().from(notifications)).toHaveLength(1);
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("refuses a recipient from another session", async () => {
    const a = await table();
    const b = await table();
    await expect(db.insert(notifications).values({ sessionId: a.sessionId, recipientId: b.ana.participantId, type: "round.opened", subject: {}, dedupKey: "x" })).rejects.toThrow();
  });

  it("marking read changes the local view the same way the server does", () => {
    const n = (id: string, readAt: string | null) => ({ id, type: "round.opened" as const, subject: {}, createdAt: "t", readAt });
    const view = { items: [n("a", null), n("b", "x")], unread: 3 };
    expect(markReadLocal(view, { ids: ["a", "b"] }, "now")).toMatchObject({ unread: 2 });
    expect(markReadLocal(view, { all: true }, "now")).toMatchObject({ unread: 0 });
  });
});

describe("POST /notifications/read", () => {
  async function post(sessionId: string, token: string | null, body: unknown, origin = "http://localhost:3000") {
    jar.cookies = token ? { [credentialCookieName(sessionId)]: token } : {};
    const req = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/notifications/read`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
    const blocked = proxy(req);
    if (blocked.status !== 200) return { status: blocked.status, body: await blocked.json() };
    const res = await MARK_READ(req, { params: Promise.resolve({ id: sessionId }) });
    return { status: res.status, body: await res.json() };
  }
  const readAt = async (sessionId: string, dedupKey: string) => (await db.select({ r: notifications.readAt }).from(notifications).where(and(eq(notifications.sessionId, sessionId), eq(notifications.dedupKey, dedupKey))))[0].r;

  async function seeded() {
    const t = await table();
    const [{ code }] = await db.select({ code: sessions.joinCode }).from(sessions).where(eq(sessions.id, t.sessionId));
    const joined = await joinSession(db, code, "Cy", t.sessionId);
    const cy = (await resolveActor(db, t.sessionId, joined.token)) as Actor;
    await db.insert(notifications).values([t.host, cy, t.ana].flatMap((a) => ["a", "b"].map((k) => ({ sessionId: t.sessionId, recipientId: a.participantId, type: "round.opened", subject: {}, dedupKey: `${a.displayName}-${k}` }))));
    const ids = (await db.select({ id: notifications.id, k: notifications.dedupKey }).from(notifications)).reduce<Record<string, string>>((m, r) => ({ ...m, [r.k]: r.id }), {});
    return { ...t, cy, cyToken: joined.token, ids };
  }

  it("is actor-scoped: you cannot mark someone else's, with ids or all", async () => {
    const t = await seeded();
    expect((await post(t.sessionId, t.cyToken, { ids: [t.ids["Ana-a"], t.ids["Cy-a"]] })).body.data.marked).toBe(1);
    expect(await readAt(t.sessionId, "Ana-a")).toBeNull();
    expect(await readAt(t.sessionId, "Cy-a")).not.toBeNull();
    expect((await post(t.sessionId, t.cyToken, { all: true })).body.data.marked).toBe(1);
    expect(await readAt(t.sessionId, "Ana-b")).toBeNull();
    expect(await readAt(t.sessionId, `${t.host.displayName}-a`)).toBeNull();
  });

  it("is idempotent and neither bumps the revision nor emits an event", async () => {
    const t = await seeded();
    const before = (await db.select({ r: sessions.revision }).from(sessions).where(eq(sessions.id, t.sessionId)))[0].r;
    const events = (await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, t.sessionId))).length;
    expect((await post(t.sessionId, t.cyToken, { all: true })).body.data.marked).toBe(2);
    expect((await post(t.sessionId, t.cyToken, { all: true })).body.data.marked).toBe(0);
    expect((await db.select({ r: sessions.revision }).from(sessions).where(eq(sessions.id, t.sessionId)))[0].r).toBe(before);
    expect((await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, t.sessionId))).length).toBe(events);
  });

  it("works on a closed order", async () => {
    const t = await seeded();
    await add(db, t.host, { dishName: "Gyoza", quantity: 1 });
    await confirm(t.host);
    await run(t.host, (tx, s) => closeSession(tx, s, t.host));
    expect((await post(t.sessionId, t.cyToken, { all: true })).status).toBe(200);
  });

  it("guest and host pass; a stranger gets 404; a foreign or missing Origin gets 403; bad bodies get 422", async () => {
    const t = await seeded();
    expect((await post(t.sessionId, t.hostToken, { all: true })).status).toBe(200);
    expect((await post(t.sessionId, t.cyToken, { all: true })).status).toBe(200);
    expect((await post(t.sessionId, null, { all: true })).status).toBe(404);
    expect((await post(t.sessionId, "not-a-token", { all: true })).status).toBe(404);
    expect((await post(t.sessionId, t.cyToken, { all: true }, "https://evil.example")).status).toBe(403);
    expect((await post(t.sessionId, t.cyToken, { all: true }, "")).status).toBe(403);
    expect((await post(t.sessionId, t.cyToken, { ids: [] })).status).toBe(422);
    expect((await post(t.sessionId, t.cyToken, { ids: ["nope"] })).status).toBe(422);
    expect((await post(t.sessionId, t.cyToken, {})).status).toBe(422);
  });
});

describe("correctionAudience (what the correction sheet names)", () => {
  const entry = (id: string, roundId: string, attribution: Record<string, unknown>, quantity = 2) => ({ id, dishId: "d", dishName: "Katsu", quantity, variant: null, instructions: null, createdAt: "", submittedBy: "h", roundId, batchId: id, revision: 1, attribution: { label: null, participantId: null, ...attribution } }) as never;
  const fix = (sourceEntryId: string, type: "QUANTITY" | "REPLACE", extra: Record<string, unknown> = {}) => ({ id: `${sourceEntryId}${type}`, sourceEntryId, targetRoundId: "r1", type, quantityDelta: type === "QUANTITY" ? -2 : null, replacement: type === "REPLACE" ? "Tonkatsu" : null, createdAt: "1", ...extra }) as never;
  const rounds = [{ id: "r1", number: 1, status: "CONFIRMED" as const, confirmedAt: "" }, { id: "r2", number: 2, status: "DRAFT" as const, confirmedAt: null }];
  const entries = [entry("a", "r1", { type: "INDIVIDUAL", participantId: "ana" }), entry("b", "r1", { type: "INDIVIDUAL", participantId: "ben" }), entry("c", "r1", { type: "INDIVIDUAL", participantId: "cy" }), entry("d", "r2", { type: "INDIVIDUAL", participantId: "dee" })];

  it("leaves out fully cancelled and swapped lines, keeps open-round lines (Mark unavailable removes and notifies them)", () => {
    const corrections = [fix("a", "QUANTITY"), fix("b", "REPLACE")];
    expect(correctionAudience("d", entries, { rounds, corrections, groups: [] })).toEqual(["cy", "dee"]);
  });

  it("a group with members is for them; a label-only group is for everyone", () => {
    const group = entry("g", "r1", { type: "GROUP", label: "The Boys" });
    const groups = [{ id: "g1", label: "the boys", createdBy: null, memberIds: ["ana", "ben"] }];
    expect(correctionAudience("d", [group], { rounds, corrections: [], groups })).toEqual(["ana", "ben"]);
    expect(correctionAudience("d", [group], { rounds, corrections: [], groups: [] })).toBe("all");
  });
});
