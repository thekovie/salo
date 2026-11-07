/** The bits of PostHog Salo uses (kept narrow so the rest of the app never depends on the SDK). */
export interface AnalyticsClient {
  capture(name: string, props?: Record<string, unknown>): unknown;
  register(props: Record<string, unknown>): void;
  opt_out_capturing(): void;
  opt_in_capturing(): void;
  has_opted_out_capturing(): boolean;
}

/**
 * Product events (owner request: pinpoint UI/UX problems). Properties are counts, kinds and codes only: never names,
 * dishes, order titles, join codes or order ids (a room id can open the invite).
 */
export type AnalyticsEvent =
  | { name: "order_started" }
  | { name: "turnstile_shown" }
  | { name: "turnstile_passed" }
  | { name: "turnstile_failed" }
  | { name: "guest_joined" }
  | { name: "dish_added"; props: { recipient: string; quantity: number; has_notes: boolean } }
  | { name: "add_failed"; props: { code: string } }
  | { name: "recipient_panel_opened" }
  | { name: "invite_opened" }
  | { name: "invite_shared"; props: { method: "share" | "copy" } }
  | { name: "review_opened" }
  | { name: "waiter_view_opened" }
  | { name: "round_confirmed"; props: { round: number } }
  | { name: "confirm_refused"; props: { code: string } }
  | { name: "order_ended"; props: { cancelled: boolean } }
  | { name: "guest_removed"; props: { with_reason: boolean } }
  | { name: "guest_restored" }
  | { name: "summary_opened"; props: { source: "auto" | "button" } }
  | { name: "summary_copied" }
  | { name: "summary_image_saved"; props: { method: "share" | "download" } }
  | { name: "tour_offer_shown" }
  | { name: "tour_started"; props: { source: "offer" | "replay" } }
  | { name: "tour_dismissed" }
  | { name: "tour_step"; props: { index: number; total: number } }
  | { name: "tour_completed" }
  | { name: "sync_state"; props: { state: string } };

let client: AnalyticsClient | null = null;
let context: Record<string, unknown> = {};

/** Set by the provider once PostHog is running; stays null when analytics is off. */
export function setAnalyticsClient(next: AnalyticsClient | null): void {
  client = next;
  if (client) setAnalyticsContext({});
}

/** Records an event when analytics is on; does nothing otherwise (dev, CI, e2e, opted out). */
export function track(event: AnalyticsEvent): void {
  if (!client) return;
  try {
    client.capture(event.name, "props" in event ? event.props : undefined);
  } catch {
    // Analytics must never break ordering.
  }
}

/** Facts about the current screen sent with every event: who is looking (host or guest) and where. */
export function setAnalyticsContext(next: { role?: "host" | "guest" | null; page_kind?: string }): void {
  context = { ...context, ...next };
  if (!client) return;
  try {
    client.register(context);
  } catch {
    // ignore
  }
}

export function analyticsClient(): AnalyticsClient | null {
  return client;
}
