import { describe, expect, it } from "vitest";
import { relativeLabel } from "@/lib/time";

describe("relativeLabel (resume list, device time zone)", () => {
  const now = new Date(2026, 10, 6, 21, 0); // local time of whoever runs the test
  it("says Today, Yesterday, a weekday, then a date", () => {
    expect(relativeLabel(new Date(2026, 10, 6, 19, 42), now, "en-US")).toBe("Today 7:42 PM");
    expect(relativeLabel(new Date(2026, 10, 5, 23, 59), now, "en-US")).toBe("Yesterday 11:59 PM");
    expect(relativeLabel(new Date(2026, 10, 3, 12, 5), now, "en-US")).toBe("Tue 12:05 PM");
    expect(relativeLabel(new Date(2026, 9, 20, 12, 0), now, "en-US")).toBe("Oct 20");
  });
});
