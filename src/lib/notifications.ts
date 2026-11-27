import { formatPeso } from "./money";

export type NotificationType = "round.confirmed" | "round.opened" | "dish.unavailable" | "order.correctionTold" | "price.defaultSet" | "food.served" | "guests.ready" | "order.ended" | "participant.cohostSet" | "participant.cohostRevoked" | "payment.recorded" | "payment.needsReview";

type Subject = Record<string, string | number | boolean | null | undefined>;

/** One of the actor's own updates. Never contains anyone else's. */
export interface NotificationView {
  id: string;
  type: NotificationType;
  subject: Subject;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsView {
  /** The latest 50, newest first. */
  items: NotificationView[];
  /** Unread across all of them, not just the 50. */
  unread: number;
}

export const NOTIFICATIONS_LIMIT = 50;

export type NotificationTarget = "order" | "served" | "rounds" | "kkb";

export function notificationTarget(type: NotificationType): NotificationTarget {
  switch (type) {
    case "food.served":
    case "participant.cohostSet":
      return "served";
    case "dish.unavailable":
    case "order.correctionTold":
    case "order.ended":
      return "rounds";
    case "price.defaultSet":
    case "payment.recorded":
    case "payment.needsReview":
      return "kkb";
    default:
      return "order";
  }
}

const num = (v: unknown) => (typeof v === "number" ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function notificationText({ type, subject: s }: Pick<NotificationView, "type" | "subject">): string {
  switch (type) {
    case "round.confirmed":
      return `Round ${num(s.roundNumber)} confirmed with the waiter`;
    case "round.opened":
      return `Round ${num(s.roundNumber)} is open`;
    case "dish.unavailable": {
      const gone = [num(s.removed) && `${num(s.removed)} removed`, num(s.cancelled) && `${num(s.cancelled)} cancelled`].filter(Boolean).join(", ");
      const parts = [gone && `${gone} from your order`, num(s.replaced) && `${num(s.replaced)} replaced with ${str(s.replacement)}`].filter(Boolean);
      return `${str(s.dishName)} is unavailable${parts.length ? ` · ${parts.join(", ")}` : ""}`;
    }
    case "order.correctionTold": {
      const what = s.replacement ? `${num(s.quantity)} ${str(s.dishName)} changed to ${str(s.replacement)}` : `${num(s.quantity)} ${str(s.dishName)} cancelled`;
      return `Order corrected: ${what}`;
    }
    case "price.defaultSet":
      return s.centavos == null ? `Table price for ${str(s.label)} was removed` : `Table price for ${str(s.label)} is now ${formatPeso(num(s.centavos))}`;
    case "food.served":
      return `${str(s.label)} is all served`;
    case "guests.ready":
      return `Everyone is ready for round ${num(s.roundNumber)}`;
    case "order.ended":
      return s.cancelled ? "The host cancelled the order" : "The host ended the order";
    case "participant.cohostSet":
      return `${str(s.host)} made you a co-host. You can mark food as served.`;
    case "participant.cohostRevoked":
      return `${str(s.host)} stopped your co-host role.`;
    case "payment.recorded":
      return `${str(s.host)} recorded ${formatPeso(num(s.centavos))} from you`;
    case "payment.needsReview":
      return `${str(s.name)}’s claim left a ${formatPeso(num(s.centavos))} payment paid to themself. Fix it on KKB.`;
  }
}

/** Who an entry is for, for notification purposes: one person, a group's members, or (table, unassigned, label-only group) everyone. */
export function audienceOf(attributions: readonly { type: string; participantId: string | null; memberIds?: readonly string[] }[]): string[] | "all" {
  const people = new Set<string>();
  for (const a of attributions) {
    if (a.type === "GROUP" && a.memberIds?.length) a.memberIds.forEach((id) => people.add(id));
    else if (a.type !== "INDIVIDUAL") return "all";
    else if (a.participantId) people.add(a.participantId);
  }
  return [...people];
}

/** Local effect of marking read, so the badge drops at once. */
export function markReadLocal(view: NotificationsView, input: { ids: readonly string[] } | { all: true }, now: string): NotificationsView {
  const hit = (n: NotificationView) => !n.readAt && ("all" in input || input.ids.includes(n.id));
  const items = view.items.map((n) => (hit(n) ? { ...n, readAt: now } : n));
  const marked = view.items.filter(hit).length;
  return { items, unread: "all" in input ? 0 : Math.max(0, view.unread - marked) };
}
