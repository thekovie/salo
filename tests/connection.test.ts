import { describe, expect, it } from "vitest";
import { connectionMessage, connectionState } from "@/lib/connection";

describe("connection pill", () => {
  it("says offline first, reconnecting only after a sustained drop", () => {
    expect(connectionState(false, false)).toBe("offline");
    expect(connectionState(false, true)).toBe("offline");
    expect(connectionState(true, true)).toBe("reconnecting");
    expect(connectionState(true, false)).toBe("ok");
  });

  it("tells people their changes are safe and how many are waiting", () => {
    expect(connectionMessage("offline", 2)).toBe("You’re offline. Changes are kept on this phone and sent when you’re back. 2 changes waiting.");
    expect(connectionMessage("reconnecting", 0)).toBe("Reconnecting… live updates are paused.");
    expect(connectionMessage("back", 1)).toBe("Back online · sending 1…");
    expect(connectionMessage("back", 0)).toBe("Back online · all changes sent");
  });
});
