import type { AttributionType, SourceEntry } from "./consolidate";
import type { NotificationsView } from "./notifications";
import type { CorrectionView, TicketSnapshot } from "./ticket";

/** Everything a client needs to draw a session, at one revision. Sent by GET /sync and the initial page render. */
export interface SessionSnapshot {
  session: {
    id: string;
    title: string | null;
    status: "OPEN" | "CLOSED";
    revision: number;
    joinCode: string;
    closedAt: string | null;
    expiresAt: string;
  };
  me: { participantId: string; role: "HOST" | "GUEST"; displayName: string };
  rounds: { id: string; number: number; status: "DRAFT" | "CONFIRMED"; confirmedAt: string | null }[];
  /** The draft round, or the latest round when none is open. */
  activeRoundId: string;
  /** People in the order now. */
  participants: { id: string; displayName: string; role: "HOST" | "GUEST" }[];
  /** Guests the host removed: only so their names still show on dishes and tickets they appear in. */
  removedPeople: { id: string; displayName: string }[];
  /** Active (not removed) entries of every round. */
  entries: SnapshotEntry[];
  /** Dish names typed in this session, for suggestions. */
  dishNames: string[];
  /** Pending "that's mine" requests (brief 5.10). */
  claims: { id: string; batchId: string; requestedBy: string; createdAt: string }[];
  /** "I'm ready" for the active round, by participant (brief 5.11). */
  readiness: { participantId: string; ready: boolean }[];
  /** Collective groups with optional members (brief 5.9). Groups also exist implicitly through order labels. */
  groups: { id: string; label: string; createdBy: string | null; memberIds: string[] }[];
  /** Corrections to confirmed rounds, each carried by a later round (brief 5.15). */
  corrections: CorrectionView[];
  /** The immutable ticket of each confirmed round, by round id (brief 5.14). */
  tickets: Record<string, TicketSnapshot>;
  /**
   * Prices and the receipt's service charge (KKB). Kept apart from entries on purpose: nothing here may reach the
   * waiter ticket, its snapshot or the invite preview, and entries flow into all of those.
   */
  settlement: SettlementView;
  /** Food tracker: raw served counts per round line (see `trackerLines`). Independent from KKB. */
  servedCounts: { roundId: string; lineKey: string; served: number }[];
  /** The viewer's own updates only: private, never another participant's. */
  notifications: NotificationsView;
}

export interface EntrySettlement {
  /** Price each in centavos; null = unknown. */
  unitCentavos: number | null;
  /** Host's settlement-only payer for a shared or unassigned dish. */
  billTo: { participantId: string | null; label: string | null } | null;
  /** 0 when nothing was ever set. */
  revision: number;
}

export interface SettlementView {
  entries: Record<string, EntrySettlement>;
  /** Price each for a replacement ("Change it to …"), by correction id. */
  corrections: Record<string, { unitCentavos: number | null; revision: number }>;
  /** Table prices (host-set) by `sharedPriceKey(dishId, variantKey)`. */
  defaults: Record<string, { unitCentavos: number | null; revision: number }>;
  /** null = not entered; 0 = the receipt has none. */
  serviceCharge: { centavos: number | null; revision: number };
  /** The receipt's printed total, for comparison only. null = not entered. */
  receiptTotal: { centavos: number | null; revision: number };
  /** Discounts and extra charges, oldest first. Only what the host typed; shares are computed (`lib/adjustments.ts`). */
  adjustments: SnapshotAdjustment[];
}

export const ADJUSTMENT_CATEGORIES = ["senior", "pwd", "privilege", "promo", "other"] as const;
export const ADJUSTMENT_METHODS = ["proportional", "equal", "individual", "manual", "unallocated"] as const;
export type AdjustmentCategory = (typeof ADJUSTMENT_CATEGORIES)[number];
export type AdjustmentMethod = (typeof ADJUSTMENT_METHODS)[number];

export interface SnapshotAdjustment {
  id: string;
  direction: "discount" | "charge";
  category: AdjustmentCategory;
  note: string | null;
  /** Exactly one of amount and percent (basis points) is set. */
  amountCentavos: number | null;
  percentBps: number | null;
  method: AdjustmentMethod;
  /** The people it applies to: a participant or a typed name. Amount only for "manual". */
  shares: { participantId: string | null; label: string | null; amountCentavos: number | null }[];
  revision: number;
}

export const EMPTY_SETTLEMENT: SettlementView = { entries: {}, corrections: {}, defaults: {}, serviceCharge: { centavos: null, revision: 0 }, receiptTotal: { centavos: null, revision: 0 }, adjustments: [] };

/** Any price anywhere: a line's, a replacement's or a table price. */
export const anyPrice = (s: Pick<SessionSnapshot, "settlement">) =>
  [...Object.values(s.settlement.entries), ...Object.values(s.settlement.corrections), ...Object.values(s.settlement.defaults)].some((p) => p.unitCentavos != null);

/** Stable key of a table price: the dish and its normalized size ('' for none). */
export const sharedPriceKey = (dishId: string, variantKey: string) => `${dishId}|${variantKey}`;

export interface SnapshotEntry extends SourceEntry {
  roundId: string;
  batchId: string;
  revision: number;
}

export type { AttributionType };

/** Who an entry is for, in words. */
export function attributionLabel(entry: Pick<SourceEntry, "attribution">, people: SessionSnapshot["participants"]): string | null {
  const { type, label, participantId } = entry.attribution;
  if (type === "TABLE") return "Whole table";
  if (type === "UNASSIGNED") return null;
  if (participantId) return people.find((p) => p.id === participantId)?.displayName ?? label ?? "Someone";
  return label;
}

/** Everyone a name might be needed for: current people, then removed guests (marked as such in the name). */
export function everyone(snapshot: Pick<SessionSnapshot, "participants" | "removedPeople">): SessionSnapshot["participants"] {
  return [...snapshot.participants, ...snapshot.removedPeople.map((p) => ({ id: p.id, displayName: `${p.displayName} (left)`, role: "GUEST" as const }))];
}
