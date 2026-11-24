import { and, eq, inArray, isNull } from "drizzle-orm";
import { personKey } from "@/lib/adjustments";
import type { Tx } from "@/server/db/client";
import { participants } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { tidyName } from "./settlement";

export type PersonRow = { participantId: string | null; billToLabel: string | null };
type PersonInput = { participantId: string } | { label: string };

/**
 * People for a split or a receipt: typed names tidied, each person once (by `personKey`, so Ana and ana collide), and newly
 * added participants must be active. People already stored (`stored` keys) may stay even after they left.
 */
export async function resolvePeople(tx: Tx, sessionId: string, input: readonly PersonInput[], stored: ReadonlySet<string>): Promise<PersonRow[]> {
  const rows = input.map((p): PersonRow => ("participantId" in p ? { participantId: p.participantId, billToLabel: null } : { participantId: null, billToLabel: tidyName(p.label, "Keep the name under 40 characters.") }));
  const keys = rows.map(keyOfRow);
  if (new Set(keys).size !== keys.length) throw new AppError(422, "INVALID", "Pick each person once.");
  const added = rows.flatMap((r, i) => (r.participantId && !stored.has(keys[i]) ? [r.participantId] : []));
  if (added.length) {
    const found = await tx.select({ id: participants.id }).from(participants).where(and(inArray(participants.id, added), eq(participants.sessionId, sessionId), isNull(participants.removedAt)));
    if (found.length !== added.length) throw new AppError(404, "PERSON_NOT_FOUND", "That person isn’t in this order.");
  }
  return rows;
}

export const keyOfRow = (r: PersonRow) => personKey({ participantId: r.participantId, label: r.billToLabel });
