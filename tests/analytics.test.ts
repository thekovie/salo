import { afterEach, describe, expect, it, vi } from "vitest";
import { setAnalyticsClient, setAnalyticsContext, track, type AnalyticsClient } from "@/lib/analytics";

function fakeClient() {
  const capture = vi.fn<AnalyticsClient["capture"]>();
  const register = vi.fn<AnalyticsClient["register"]>();
  const client: AnalyticsClient = { capture, register, opt_out_capturing: vi.fn(), opt_in_capturing: vi.fn(), has_opted_out_capturing: () => false };
  return Object.assign(client, { capture, register });
}

afterEach(() => setAnalyticsClient(null));

describe("analytics", () => {
  it("does nothing while PostHog isn't running", () => {
    expect(() => track({ name: "order_started" })).not.toThrow();
  });

  it("sends events with their properties, and context set earlier once the client arrives", () => {
    setAnalyticsContext({ page_kind: "workspace", role: "host" });
    const client = fakeClient();
    setAnalyticsClient(client);
    expect(client.register).toHaveBeenCalledWith({ page_kind: "workspace", role: "host" });
    track({ name: "dish_added", props: { recipient: "me", quantity: 2, has_notes: false } });
    expect(client.capture).toHaveBeenCalledWith("dish_added", { recipient: "me", quantity: 2, has_notes: false });
  });

  it("never lets an analytics failure reach the app", () => {
    const client = fakeClient();
    client.capture.mockImplementation(() => {
      throw new Error("blocked");
    });
    setAnalyticsClient(client);
    expect(() => track({ name: "summary_copied" })).not.toThrow();
  });
});
