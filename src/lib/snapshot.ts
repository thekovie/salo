import type { AttributionType, SourceEntry } from "./consolidate";

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
  participants: { id: string; displayName: string; role: "HOST" | "GUEST" }[];
  /** Active (not removed) entries of every round. */
  entries: SnapshotEntry[];
  /** Dish names typed in this session, for suggestions. */
  dishNames: string[];
  /** Pending "that's mine" requests (brief 5.10). */
  claims: { id: string; batchId: string; requestedBy: string; createdAt: string }[];
  /** "I'm ready" for the active round, by participant (brief 5.11). */
  readiness: { participantId: string; ready: boolean }[];
  /** Collective groups with optional members (brief 5.9). Groups also exist implicitly through order labels. */
  groups: { id: string; label: string; memberIds: string[] }[];
}

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
