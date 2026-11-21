import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { normalizeText } from "@/lib/dish-name";
import { audienceOf, NOTIFICATIONS_LIMIT, type NotificationsView, type NotificationType } from "@/lib/notifications";
import type { Actor } from "@/lib/permissions";
import type { Db, Tx } from "@/server/db/client";
import { cancelledBySource } from "@/server/orders/rounds";
import { dishes, notifications, orderBatches, orderEntries, orderGroupMembers, orderGroups, participants } from "@/server/db/schema";

type Subject = Record<string, string | number | boolean | null>;

interface NotifyInput {
  type: NotificationType;
  /** A function gives each recipient their own numbers. */
  subject: Subject | ((recipientId: string) => Subject);
  /** Participant ids, or "all" for everyone in the order. The actor is always left out. */
  recipients: readonly (string | null | undefined)[] | "all";
  /** One row per recipient and key; a repeat does nothing. */
  dedupKey: string;
  /** What created it, so undoing that change can delete it (see `undoRemovalNotices`). */
  source?: readonly string[];
  actorId: string;
}

/** Writes one notification per recipient; call inside the transaction of the change that caused it. */
export async function notify(tx: Tx, sessionId: string, input: NotifyInput): Promise<string[]> {
  const wanted = input.recipients === "all" ? null : new Set(input.recipients.filter((id): id is string => Boolean(id)));
  if (wanted?.size === 0) return [];
  const rows = await tx
    .select({ id: participants.id })
    .from(participants)
    .where(and(eq(participants.sessionId, sessionId), isNull(participants.removedAt), wanted ? inArray(participants.id, [...wanted]) : undefined));
  const ids = rows.map((r) => r.id).filter((id) => id !== input.actorId);
  if (ids.length === 0) return [];
  const subjectFor = typeof input.subject === "function" ? input.subject : () => input.subject as Subject;
  await tx
    .insert(notifications)
    .values(ids.map((recipientId) => ({ sessionId, recipientId, type: input.type, subject: subjectFor(recipientId), source: [...(input.source ?? [])], dedupKey: input.dedupKey })))
    .onConflictDoNothing();
  return ids;
}

const overlaps = (sources: readonly string[]) => sql`${notifications.source} && ARRAY[${sql.join(sources.map((s) => sql`${s}`), sql`, `)}]::text[]`;

/**
 * Undo of "Mark unavailable" for these draft entries. A notice that only said "removed" goes; one that also carries a told
 * cancel or swap (which Undo cannot take back) stays, minus the removal.
 */
export async function undoRemovalNotices(tx: Tx, sessionId: string, sources: readonly string[]): Promise<void> {
  const match = and(eq(notifications.sessionId, sessionId), overlaps(sources));
  const told = sql`coalesce((${notifications.subject}->>'cancelled')::int, 0) + coalesce((${notifications.subject}->>'replaced')::int, 0)`;
  await tx.delete(notifications).where(and(match, sql`${told} = 0`));
  await tx
    .update(notifications)
    .set({
      subject: sql`jsonb_set(${notifications.subject}, '{removed}', '0')`,
      source: sql`ARRAY(SELECT s FROM unnest(${notifications.source}) s WHERE s <> ALL(ARRAY[${sql.join(sources.map((s) => sql`${s}`), sql`, `)}]::text[]))`,
    })
    .where(match);
}

export interface AttributedEntry {
  id: string;
  quantity: number;
  attrType: string;
  forId: string | null;
  /** Members of the entry's group; empty for no group or a label-only one. */
  memberIds: string[];
}

/** Adds the members of each entry's named group (groups are matched to orders by label), so a group dish is for them and not for everyone. */
export async function withMembers<T extends { label: string | null }>(tx: Tx, sessionId: string, entries: readonly T[]): Promise<(T & { memberIds: string[] })[]> {
  const labels = [...new Set(entries.flatMap((e) => (e.label ? [normalizeText(e.label)] : [])))];
  const members = labels.length
    ? await tx
        .select({ label: orderGroups.normalizedLabel, participantId: orderGroupMembers.participantId })
        .from(orderGroupMembers)
        .innerJoin(orderGroups, eq(orderGroups.id, orderGroupMembers.groupId))
        .where(and(eq(orderGroups.sessionId, sessionId), inArray(orderGroups.normalizedLabel, labels)))
    : [];
  return entries.map((e) => ({ ...e, memberIds: members.filter((m) => e.label && m.label === normalizeText(e.label)).map((m) => m.participantId) }));
}

/** Everyone a set of entries is for. */
export const audienceOfEntries = (entries: readonly AttributedEntry[]) => audienceOf(entries.map((e) => ({ type: e.attrType, participantId: e.forId, memberIds: e.memberIds })));

/** Attribution and dish of entries, by id. */
export async function loadAttributed(tx: Tx, sessionId: string, entryIds: readonly string[]) {
  if (entryIds.length === 0) return [];
  const rows = await tx
    .select({ id: orderEntries.id, quantity: orderEntries.quantity, attrType: orderBatches.attributionType, forId: orderBatches.attributedParticipantId, label: orderBatches.collectiveLabel, dishName: dishes.canonicalName })
    .from(orderEntries)
    .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
    .innerJoin(dishes, eq(dishes.id, orderEntries.dishId))
    .where(and(inArray(orderEntries.id, [...entryIds]), eq(orderBatches.sessionId, sessionId)));
  return withMembers(tx, sessionId, rows);
}

/** The entries that are for this recipient: their own, their group's, and table-wide ones. */
export function forRecipient<T extends AttributedEntry>(entries: readonly T[], recipientId: string): T[] {
  return entries.filter((e) => (e.attrType === "INDIVIDUAL" ? e.forId === recipientId : e.attrType !== "GROUP" || e.memberIds.length === 0 || e.memberIds.includes(recipientId)));
}

interface CorrectionRow {
  sourceEntryId: string | null;
  type: "QUANTITY" | "REPLACE";
  quantityDelta: number | null;
  replacement: string | null;
}

/** One notification per correction batch (not per row), sent when the round carrying it is confirmed and the waiter is told. */
export async function notifyCorrection(tx: Tx, sessionId: string, actorId: string, groupKey: string, rows: readonly CorrectionRow[]) {
  const attributed = await loadAttributed(tx, sessionId, rows.flatMap((r) => (r.sourceEntryId ? [r.sourceEntryId] : [])));
  const byId = new Map(attributed.map((e) => [e.id, e]));
  const items = rows.flatMap((r) => (r.sourceEntryId && byId.has(r.sourceEntryId) ? [{ row: r, entry: byId.get(r.sourceEntryId)! }] : []));
  if (items.length === 0) return;
  const replacement = items[0].row.type === "REPLACE" ? items[0].row.replacement : null;
  const told = replacement ? await cancelledBySource(tx, items.map((i) => i.entry.id), true) : new Map<string, number>();
  await notify(tx, sessionId, {
    type: "order.correctionTold",
    recipients: audienceOfEntries(items.map((i) => i.entry)),
    subject: (recipientId) => ({
      dishName: items[0].entry.dishName,
      quantity: items.filter((i) => forRecipient([i.entry], recipientId).length > 0).reduce((sum, i) => sum + (i.row.type === "REPLACE" ? i.entry.quantity - (told.get(i.entry.id) ?? 0) : -(i.row.quantityDelta ?? 0)), 0),
      replacement,
    }),
    dedupKey: `correction.told:${groupKey}`,
    actorId,
  });
}

/** The actor's latest notifications and how many are unread. Only ever their own rows. */
export async function loadNotifications(tx: Pick<Tx, "select">, actor: Actor): Promise<NotificationsView> {
  const mine = and(eq(notifications.sessionId, actor.sessionId), eq(notifications.recipientId, actor.participantId));
  const [rows, [unread]] = await Promise.all([
    tx.select().from(notifications).where(mine).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(NOTIFICATIONS_LIMIT),
    tx.select({ n: count() }).from(notifications).where(and(mine, isNull(notifications.readAt))),
  ]);
  return {
    items: rows.map((r) => ({ id: r.id, type: r.type as NotificationType, subject: r.subject as NotificationsView["items"][number]["subject"], createdAt: r.createdAt.toISOString(), readAt: r.readAt ? r.readAt.toISOString() : null })),
    unread: unread.n,
  };
}

/** Private state: no revision bump, no event. Only the actor's own rows; repeats change nothing. */
export async function markNotificationsRead(db: Db, actor: Actor, input: { ids: string[] } | { all: true }): Promise<{ marked: number }> {
  const rows = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.sessionId, actor.sessionId), eq(notifications.recipientId, actor.participantId), isNull(notifications.readAt), "all" in input ? undefined : inArray(notifications.id, input.ids)))
    .returning({ id: notifications.id });
  return { marked: rows.length };
}
