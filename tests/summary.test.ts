import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions";
import { buildSummary, summaryText } from "@/lib/summary";
import { runMutation } from "@/server/mutations";
import { removeParticipant, setGroupMembers } from "@/server/orders/people";
import { confirmRound, openRound, recordCorrection } from "@/server/orders/rounds";
import { getSnapshot } from "@/server/sessions/snapshot";
import { renameSession } from "@/server/sessions/rename";
import { resetDb, testDb } from "./helpers/db";
import { add, addGuest, key, newSession } from "./helpers/session";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const run = <T>(actor: Actor, apply: Parameters<typeof runMutation<T>>[3]) => runMutation(db, actor, { idempotencyKey: key(), type: "t" }, apply);
async function confirm(host: Actor) {
  const snap = await getSnapshot(db, host);
  await run(host, (tx, s) => confirmRound(tx, s, host, snap.activeRoundId, snap.session.revision));
}

describe("who ordered what (summary for settling up)", () => {
  it("counts confirmed rounds per person with corrections, then groups, the table and the rest", async () => {
    const { host, sessionId } = await newSession(db);
    await run(host, (tx, s) => renameSession(tx, s, host, "Mang Inasal"));
    const jd = await addGuest(db, sessionId, "JD");
    const rafa = await addGuest(db, sessionId, "Rafa");
    await add(db, host, { dishName: "Chicken Inasal Paa", quantity: 2, attribution: { type: "INDIVIDUAL" } });
    const katsu = await add(db, jd, { dishName: "Halo-halo", quantity: 2, instructions: "Less ice", attribution: { type: "INDIVIDUAL" } });
    await add(db, rafa, { dishName: "Sisig", quantity: 1, attribution: { type: "INDIVIDUAL" } });
    await add(db, host, { dishName: "Pancit", quantity: 1, attribution: { type: "GROUP", label: "Barkada" } });
    await add(db, host, { dishName: "Crispy Pata", quantity: 1, attribution: { type: "TABLE" } });
    await run(host, (tx, s) => setGroupMembers(tx, s, host, "Barkada", [jd.participantId, rafa.participantId]));
    await confirm(host);

    // Round 2: a cancellation and a swap against round 1, plus something never confirmed.
    await run(host, (tx, s) => openRound(tx, s, host));
    await run(host, (tx, s) => recordCorrection(tx, s, host, { sourceEntryId: katsu.result.entryId, type: "QUANTITY", quantity: 1 }));
    const sisig = (await getSnapshot(db, host)).entries.find((e) => e.dishName === "Sisig")!;
    await run(host, (tx, s) => recordCorrection(tx, s, host, { sourceEntryId: sisig.id, type: "REPLACE", replacement: "Bangus Sisig" }));
    await add(db, host, { dishName: "Java Rice", quantity: 3, attribution: { type: "INDIVIDUAL" } });
    // Rafa leaves; what was confirmed for them still counts, under "(left)".
    await run(host, (tx, s) => removeParticipant(tx, s, host, rafa.participantId, null));

    const summary = buildSummary(await getSnapshot(db, host));
    expect(summary.rounds).toEqual([1]);
    expect(summary.unconfirmedRound).toBe(2);
    expect(summary.total).toBe(6);
    expect(summaryText(summary, "Sat, Nov 7")).toBe(
      [
        "Mang Inasal · Sat, Nov 7",
        "Who ordered what (round 1)",
        "",
        "Host: 2 items", // a host who never set a name is just "Host", not "Host (host)"
        "  Chicken Inasal Paa ×2",
        "",
        "JD: 1 item",
        "  Halo-halo (Less ice) ×1",
        "",
        "Rafa (left): 1 item",
        "  Sisig → Bangus Sisig ×1",
        "",
        "Barkada (shared by JD): 1 item", // removing Rafa also took them out of the group
        "  Pancit ×1",
        "",
        "Whole table (shared by the table): 1 item",
        "  Crispy Pata ×1",
        "",
        "Round 2 was never confirmed with the waiter (not included).",
        "",
        "Total: 6 items · no prices included",
        "Made with Salo",
      ].join("\n"),
    );
  });
});
