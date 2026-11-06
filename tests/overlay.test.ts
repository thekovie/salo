import { describe, expect, it } from "vitest";
import { overlay, type Pending } from "@/hooks/use-session";
import { consolidate } from "@/lib/consolidate";
import type { SessionSnapshot, SnapshotEntry } from "@/lib/snapshot";

const entry = (id: string, dishName: string, quantity: number, createdAt: string): SnapshotEntry => ({
  id,
  roundId: "r1",
  batchId: `b-${id}`,
  dishId: `d-${dishName}`,
  dishName,
  quantity,
  variant: null,
  instructions: null,
  createdAt,
  revision: 1,
  submittedBy: "h",
  attribution: { type: "UNASSIGNED", label: null, participantId: null },
});

const gyoza = entry("e1", "Gyoza", 2, "2026-11-06T12:00:00.000Z");
const snapshot = {
  session: { id: "s", title: null, status: "OPEN", revision: 5, joinCode: "ABC234", closedAt: null, expiresAt: "" },
  me: { participantId: "h", role: "HOST", displayName: "Host" },
  rounds: [{ id: "r1", number: 1, status: "DRAFT", confirmedAt: null }],
  activeRoundId: "r1",
  participants: [],
  entries: [gyoza],
  dishNames: ["Gyoza"],
  claims: [],
  readiness: [],
  groups: [],
  corrections: [],
  tickets: {},
} satisfies SessionSnapshot;

const item = (fields: Partial<Pending> & Pick<Pending, "op">): Pending => ({ key: Math.random().toString(36), status: "queued", createdAt: "", attempts: 0, ...fields });

describe("pending overlay", () => {
  it("draws a pending add on its existing dish, after every server entry", () => {
    const list = overlay(snapshot, [item({ op: { kind: "add", input: { dishName: "gyoza", quantity: 1, attribution: { type: "UNASSIGNED" } } } })]);
    expect(consolidate(list).dishes).toEqual([expect.objectContaining({ name: "Gyoza", quantity: 3 })]);
    expect(list[1].createdAt > gyoza.createdAt).toBe(true);
  });

  it("keeps a committed add visible until a snapshot that contains it arrives", () => {
    const list = overlay(snapshot, [item({ status: "committed", committedRevision: 6, op: { kind: "add", input: { dishName: "Rice", quantity: 2, attribution: { type: "TABLE" } } } })]);
    expect(consolidate(list).totalItems).toBe(4);
  });

  it("does not draw changes the server refused", () => {
    const list = overlay(snapshot, [item({ status: "failed", op: { kind: "update", entry: gyoza, quantity: 9 } }), item({ status: "failed", op: { kind: "remove", entry: gyoza } })]);
    expect(list).toEqual([gyoza]);
  });

  it("hides a removal immediately and shows an Undo (restore) immediately", () => {
    expect(overlay(snapshot, [item({ op: { kind: "remove", entry: gyoza } })])).toEqual([]);
    const restored = overlay({ ...snapshot, entries: [] }, [item({ op: { kind: "restore", entry: gyoza } })]);
    expect(restored.map((e) => [e.id, e.pending])).toEqual([["e1", true]]);
  });

  it("draws a waiting (offline) quantity change so the tap is not lost", () => {
    const list = overlay(snapshot, [item({ status: "waiting", op: { kind: "update", entry: gyoza, quantity: 5 } })]);
    expect(list[0].quantity).toBe(5);
  });
});
