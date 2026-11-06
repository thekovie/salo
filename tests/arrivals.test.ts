import { describe, expect, it } from "vitest";
import { arrivalsBetween, arrivalText } from "@/lib/arrivals";
import type { SnapshotEntry } from "@/lib/snapshot";

const entry = (id: string, submittedBy: string, dishName: string, quantity = 1) => ({ id, submittedBy, dishName, dishId: `d-${dishName}`, quantity }) as unknown as SnapshotEntry;
const names: Record<string, string> = { me: "Kovie", jd: "JD", ana: "Ana" };
const nameOf = (id: string) => names[id];

describe("arrivalsBetween (live 'added' pills)", () => {
  it("reports other people's new dishes, never mine, grouped per person", () => {
    const prev = [entry("1", "jd", "Rice")];
    const next = [...prev, entry("2", "jd", "Gyoza", 2), entry("3", "me", "Sisig"), entry("4", "ana", "Halo-halo"), entry("5", "ana", "Iced Tea", 3)];
    const got = arrivalsBetween(prev, next, "me", nameOf);
    expect(got.map(arrivalText)).toEqual(["JD added Gyoza ×2", "Ana added 2 dishes"]);
    expect(got[0].dishId).toBe("d-Gyoza");
  });

  it("stays quiet on first load and on a big resync jump", () => {
    const many = Array.from({ length: 9 }, (_, i) => entry(String(i), "jd", `Dish ${i}`));
    expect(arrivalsBetween([], many, "me", nameOf)).toEqual([]);
    expect(arrivalsBetween(many, many, "me", nameOf)).toEqual([]);
  });
});
