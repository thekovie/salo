import { describe, expect, it } from "vitest";
import { coalesceTarget, fromStored, nextToSend, revisionToSend, toStored, type QueueItem, type QueueStatus } from "@/lib/queue";

type Op = { kind: "add" } | { kind: "update"; entry: string; quantity: number } | { kind: "remove"; entry: string } | { kind: "restore"; entry: string };
const item = (key: string, op: Op, status: QueueStatus = "queued") => ({ key, op, status, createdAt: "2026-11-07T00:00:00.000Z", attempts: 0 });
const entryOf = (op: Op) => ("entry" in op ? op.entry : null);

describe("change queue rules", () => {
  it("sends strictly in order: a change waiting for the network holds back the rest (finding 2)", () => {
    const list: QueueItem<Op>[] = [item("remove", { kind: "remove", entry: "e1" }, "waiting"), item("undo", { kind: "restore", entry: "e1" })];
    expect(nextToSend(list)).toBeNull();
    expect(nextToSend([{ ...list[0], status: "committed" }, list[1]])?.key).toBe("undo");
    // Something in flight also holds the line.
    expect(nextToSend([{ ...list[0], status: "sending" }, list[1]])).toBeNull();
  });

  it("lets later changes go past a refused one (it waits for Retry or Discard)", () => {
    expect(nextToSend([item("a", { kind: "add" }, "failed"), item("b", { kind: "add" })])?.key).toBe("b");
  });

  it("folds repeated taps into the latest unsent update, waiting or queued, but never across another change", () => {
    const waiting = [item("u1", { kind: "update", entry: "e1", quantity: 3 }, "waiting")];
    expect(coalesceTarget(waiting, "e1", entryOf)?.key).toBe("u1");
    expect(coalesceTarget([...waiting, item("r", { kind: "remove", entry: "e1" })], "e1", entryOf)).toBeNull();
    expect(coalesceTarget([item("u1", { kind: "update", entry: "e1", quantity: 3 }, "sending")], "e1", entryOf)).toBeNull();
    expect(coalesceTarget(waiting, "other", entryOf)).toBeNull();
  });

  it("only moves the expected revision forward over this device's own changes (finding 5)", () => {
    expect(revisionToSend(4, 4, undefined)).toBe(4);
    expect(revisionToSend(4, undefined, undefined)).toBe(4);
    expect(revisionToSend(4, 6, new Set([5, 6]))).toBe(6); // our own two taps went through first
    expect(revisionToSend(4, 6, new Set([5]))).toBe(4); // revision 6 came from someone else: let the server say so
    expect(revisionToSend(4, 5, undefined)).toBe(4);
  });

  it("keeps unsent and refused changes (with keys) across a reload, drops applied ones (finding 3)", () => {
    const stored = toStored([
      item("sent", { kind: "add" }, "committed"),
      { ...item("flight", { kind: "add" }, "sending") },
      { ...item("refused", { kind: "add" }, "failed"), error: "No", code: "ROUND_CLOSED" },
      item("later", { kind: "remove", entry: "e1" }, "waiting"),
    ]);
    expect(stored.map((s) => [s.key, s.status])).toEqual([
      ["flight", "queued"],
      ["refused", "failed"],
      ["later", "waiting"],
    ]);
    const isOp = (v: unknown): v is Op => typeof v === "object" && v !== null && "kind" in v;
    expect(fromStored(JSON.stringify(stored), isOp)).toEqual(stored);
    expect(fromStored("not json", isOp)).toEqual([]);
    expect(fromStored(JSON.stringify([{ key: 1 }, { key: "x", status: "committed", op: { kind: "add" } }]), isOp)).toEqual([]);
  });
});
