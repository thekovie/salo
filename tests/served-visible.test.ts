import { describe, expect, it } from "vitest";
import { visibleServed, WAITING_CAP, type ServedRow } from "@/lib/serving";

const row = (label: string, n: number): ServedRow => ({
  roundId: "r",
  number: 1,
  line: {
    key: `${label}${n}`,
    label,
    people: "",
    expected: 2,
    served: 0,
    shown: 0,
    cancelledSince: 0,
  },
});
const waiting = Array.from({ length: 15 }, (_, i) =>
  row(i === 12 ? "Sisig" : `Dish ${i}`, i),
);
const done = [row("Sisig", 90), row("Halo-halo", 91)];
const none = () => false;

describe("visibleServed", () => {
  it("shows every row of a small list", () => {
    const small = { waiting: waiting.slice(0, WAITING_CAP), done };
    expect(visibleServed(small, "", false, none)).toMatchObject({
      waiting: small.waiting,
      capped: false,
    });
  });

  it("caps Waiting to the first 10 and counts it as capped", () => {
    const out = visibleServed({ waiting, done }, "", false, none);
    expect(out.waiting).toEqual(waiting.slice(0, 10));
    expect(out.capped).toBe(true);
  });

  it("keeps pinned rows past the cap, in order", () => {
    const out = visibleServed(
      { waiting, done },
      "",
      false,
      (r) => r === waiting[13],
    );
    expect(out.waiting).toEqual([...waiting.slice(0, 10), waiting[13]]);
  });

  it("shows everything with showAll", () => {
    expect(
      visibleServed({ waiting, done }, "", true, none).waiting,
    ).toHaveLength(15);
  });

  it("a failed row stays visible during a query that misses it, without counting as a match", () => {
    const out = visibleServed({ waiting, done }, "sisig", false, none, (r) => r === waiting[3]);
    expect(out.waiting).toEqual([waiting[3], waiting[12]]);
    expect(out.matches).toBe(2);
  });

  it("a query matches both groups uncapped, ignoring case and spacing", () => {
    const out = visibleServed({ waiting, done }, "  SISIG ", false, none);
    expect(out.waiting).toEqual([waiting[12]]);
    expect(out.done).toEqual([done[0]]);
    expect(out.matches).toBe(2);
  });

  it("no match gives zero", () => {
    expect(
      visibleServed({ waiting, done }, "pizza", false, none),
    ).toMatchObject({ waiting: [], done: [], matches: 0 });
  });
});
