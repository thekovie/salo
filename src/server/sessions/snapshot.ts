import { and, asc, eq, isNull } from "drizzle-orm";
import { personKey } from "@/lib/adjustments";
import { parseMenuUrl } from "@/lib/menu-url";
import { sharedPriceKey, type PaymentMethod, type SessionSnapshot } from "@/lib/snapshot";
import type { Db } from "@/server/db/client";
import { adjustmentShares, adjustments, confirmedRoundSnapshots, correctionSettlements, dishes, entryClaims, entryPayers, entrySettlements, orderBatches, orderEntries, orderGroupMembers, orderGroups, participantRoundReadiness, participants, payments, receiptPeople, receipts, rounds, servedCounts, sessions, sharedPrices } from "@/server/db/schema";
import { notFound } from "@/server/errors";
import { loadNotifications } from "@/server/notifications";
import { loadCorrections } from "@/server/orders/rounds";
import { LIMITS } from "@/server/orders/validation";
import type { TicketSnapshot } from "@/lib/ticket";
import type { Actor } from "@/lib/permissions";

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** The menu link as clients see it: hidden once the order is closed (D50); the columns stay for retention. */
function menuOf(session: typeof sessions.$inferSelect): SessionSnapshot["session"]["menu"] {
  const parsed = session.status === "OPEN" && session.menuUrl ? parseMenuUrl(session.menuUrl) : null;
  return parsed?.ok ? { url: parsed.url, label: session.menuLabel, domain: parsed.domain } : null;
}

/**
 * The authoritative state of a session at one revision. Read in a REPEATABLE READ transaction so the revision and the
 * rows it describes always match, even while other mutations commit.
 */
export async function getSnapshot(db: Db, actor: Actor): Promise<SessionSnapshot> {
  return db.transaction(
    async (tx) => {
      const [session] = await tx.select().from(sessions).where(eq(sessions.id, actor.sessionId));
      if (!session) throw notFound();
      const [roundRows, people, entryRows, dishRows] = await Promise.all([
        tx.select().from(rounds).where(eq(rounds.sessionId, session.id)).orderBy(asc(rounds.roundNumber)),
        tx.select({ id: participants.id, displayName: participants.displayName, role: participants.role, removedAt: participants.removedAt, cohostAt: participants.cohostAt }).from(participants).where(eq(participants.sessionId, session.id)).orderBy(asc(participants.createdAt)),
        tx
          .select({ entry: orderEntries, batch: orderBatches, dishName: dishes.canonicalName })
          .from(orderEntries)
          .innerJoin(orderBatches, eq(orderBatches.id, orderEntries.batchId))
          .innerJoin(dishes, eq(dishes.id, orderEntries.dishId))
          .where(and(eq(orderBatches.sessionId, session.id), isNull(orderEntries.deletedAt)))
          .orderBy(asc(orderEntries.createdAt)),
        tx.select({ name: dishes.canonicalName }).from(dishes).where(eq(dishes.sessionId, session.id)).orderBy(asc(dishes.canonicalName))
          .limit(LIMITS.dishesPerSession),
      ]);
      const draft = roundRows.find((r) => r.status === "DRAFT") ?? roundRows[roundRows.length - 1];
      const [claimRows, readyRows, groupRows, memberRows, correctionRows, ticketRows, entryPriceRows, correctionPriceRows, sharedPriceRows, servedRows, adjustmentRows, adjustmentShareRows, payerRows, receiptRows, receiptPeopleRows, paymentRows, notificationsView] = await Promise.all([
        tx.select().from(entryClaims).where(and(eq(entryClaims.sessionId, session.id), eq(entryClaims.status, "PENDING"))).orderBy(asc(entryClaims.createdAt)),
        tx.select().from(participantRoundReadiness).where(eq(participantRoundReadiness.roundId, draft.id)),
        tx.select().from(orderGroups).where(eq(orderGroups.sessionId, session.id)).orderBy(asc(orderGroups.createdAt)),
        tx
          .select({ groupId: orderGroupMembers.groupId, participantId: orderGroupMembers.participantId })
          .from(orderGroupMembers)
          .innerJoin(orderGroups, eq(orderGroups.id, orderGroupMembers.groupId))
          .where(eq(orderGroups.sessionId, session.id)),
        loadCorrections(tx, session.id),
        tx
          .select({ roundId: confirmedRoundSnapshots.roundId, data: confirmedRoundSnapshots.snapshotData })
          .from(confirmedRoundSnapshots)
          .innerJoin(rounds, eq(rounds.id, confirmedRoundSnapshots.roundId))
          .where(eq(rounds.sessionId, session.id)),
        tx.select().from(entrySettlements).where(eq(entrySettlements.sessionId, session.id)),
        tx.select().from(correctionSettlements).where(eq(correctionSettlements.sessionId, session.id)),
        tx.select().from(sharedPrices).where(eq(sharedPrices.sessionId, session.id)),
        tx.select().from(servedCounts).where(eq(servedCounts.sessionId, session.id)),
        tx.select().from(adjustments).where(eq(adjustments.sessionId, session.id)).orderBy(asc(adjustments.createdAt), asc(adjustments.id)),
        tx.select().from(adjustmentShares).where(eq(adjustmentShares.sessionId, session.id)).orderBy(asc(adjustmentShares.id)),
        tx.select().from(entryPayers).where(eq(entryPayers.sessionId, session.id)).orderBy(asc(entryPayers.participantId), asc(entryPayers.billToLabel)),
        tx.select().from(receipts).where(eq(receipts.sessionId, session.id)).orderBy(asc(receipts.createdAt), asc(receipts.id)),
        tx.select().from(receiptPeople).where(eq(receiptPeople.sessionId, session.id)).orderBy(asc(receiptPeople.participantId), asc(receiptPeople.billToLabel)),
        tx.select().from(payments).where(eq(payments.sessionId, session.id)).orderBy(asc(payments.createdAt), asc(payments.id)),
        loadNotifications(tx, actor),
      ]);
      const payersOf = (entryId: string) => payerRows.filter((r) => r.entryId === entryId).map((r) => ({ participantId: r.participantId, label: r.billToLabel }));
      const membersByGroup = new Map<string, string[]>();
      for (const m of memberRows) membersByGroup.set(m.groupId, [...(membersByGroup.get(m.groupId) ?? []), m.participantId]);
      const me = people.find((p) => p.id === actor.participantId);
      return {
        session: {
          id: session.id,
          title: session.title,
          status: session.status,
          revision: session.revision,
          joinCode: session.joinCode,
          closedAt: iso(session.closedAt),
          expiresAt: session.expiresAt.toISOString(),
          menu: menuOf(session),
        },
        me: { participantId: actor.participantId, role: actor.role, cohost: me?.cohostAt != null, displayName: me?.displayName ?? actor.displayName },
        rounds: roundRows.map((r) => ({ id: r.id, number: r.roundNumber, status: r.status, confirmedAt: iso(r.confirmedAt) })),
        activeRoundId: draft.id,
        participants: people.filter((p) => !p.removedAt).map(({ id, displayName, role, cohostAt }) => ({ id, displayName, role, cohost: cohostAt !== null })),
        removedPeople: people.filter((p) => p.removedAt).map(({ id, displayName }) => ({ id, displayName })),
        entries: entryRows.map(({ entry, batch, dishName }) => ({
          id: entry.id,
          roundId: entry.roundId,
          dishId: entry.dishId,
          dishName,
          quantity: entry.quantity,
          variant: entry.variant,
          instructions: entry.specialInstructions,
          createdAt: entry.createdAt.toISOString(),
          revision: entry.revision,
          batchId: batch.id,
          submittedBy: batch.submittedBy,
          attribution: { type: batch.attributionType, label: batch.collectiveLabel, participantId: batch.attributedParticipantId },
        })),
        dishNames: dishRows.map((d) => d.name),
        claims: claimRows.map((c) => ({ id: c.id, batchId: c.batchId, requestedBy: c.requestedBy, createdAt: c.createdAt.toISOString() })),
        readiness: readyRows.map((r) => ({ participantId: r.participantId, ready: r.ready })),
        corrections: correctionRows,
        tickets: Object.fromEntries(ticketRows.map((t) => [t.roundId, t.data as TicketSnapshot])),
        groups: groupRows.map((g) => ({ id: g.id, label: g.label, createdBy: g.createdBy, memberIds: membersByGroup.get(g.id) ?? [] })),
        servedCounts: servedRows.map((r) => ({ roundId: r.roundId, lineKey: r.lineKey, served: r.served })),
        notifications: notificationsView,
        settlement: {
          entries: Object.fromEntries(
            entryPriceRows.map((p) => [
              p.entryId,
              {
                unitCentavos: p.unitPriceCentavos,
                billTo: p.billToParticipantId || p.billToLabel ? { participantId: p.billToParticipantId, label: p.billToLabel } : null,
                ...(payersOf(p.entryId).length ? { splitAmong: payersOf(p.entryId) } : {}),
                revision: p.revision,
              },
            ]),
          ),
          corrections: Object.fromEntries(correctionPriceRows.map((p) => [p.correctionId, { unitCentavos: p.unitPriceCentavos, revision: p.revision }])),
          defaults: Object.fromEntries(sharedPriceRows.map((p) => [sharedPriceKey(p.dishId, p.variantKey), { unitCentavos: p.unitCentavos, revision: p.revision }])),
          serviceCharge: { centavos: session.serviceChargeCentavos, revision: session.serviceChargeRevision },
          receiptTotal: { centavos: session.receiptTotalCentavos, revision: session.receiptTotalRevision },
          adjustments: adjustmentRows.map((a) => ({
            id: a.id,
            direction: a.direction,
            category: a.category,
            note: a.note,
            amountCentavos: a.amountCentavos,
            percentBps: a.percentBps,
            method: a.method,
            revision: a.revision,
            shares: adjustmentShareRows.filter((sh) => sh.adjustmentId === a.id).map((sh) => ({ participantId: sh.participantId, label: sh.billToLabel, amountCentavos: sh.amountCentavos })),
          })),
          receipts: receiptRows.map((r) => ({
            id: r.id,
            label: r.label,
            totalCentavos: r.totalCentavos,
            people: receiptPeopleRows.filter((p) => p.receiptId === r.id).map((p) => ({ participantId: p.participantId, label: p.billToLabel })),
            revision: r.revision,
          })),
          payments: paymentRows.map((p) => ({
            id: p.id,
            payer: { participantId: p.participantId, label: p.label },
            payee: p.payeeParticipantId || p.payeeLabel ? { participantId: p.payeeParticipantId, label: p.payeeLabel } : null,
            amountCentavos: p.amountCentavos,
            method: p.method as PaymentMethod | null,
            note: p.note,
            createdAt: p.createdAt.toISOString(),
            needsReview: Boolean(p.payeeParticipantId || p.payeeLabel) && personKey({ participantId: p.participantId, label: p.label }) === personKey({ participantId: p.payeeParticipantId, label: p.payeeLabel }),
          })),
        },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
