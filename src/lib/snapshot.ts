import type { AttributionType, SourceEntry } from "./consolidate";
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
  /** null = not entered; 0 = the receipt has none. */
  serviceCharge: { centavos: number | null; revision: number };
}

export const EMPTY_SETTLEMENT: SettlementView = { entries: {}, corrections: {}, serviceCharge: { centavos: null, revision: 0 } };

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
