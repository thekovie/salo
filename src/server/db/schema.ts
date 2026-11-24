import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import { ADJUSTMENT_CATEGORIES, ADJUSTMENT_METHODS } from "../../lib/snapshot";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const id = () => uuid("id").primaryKey().defaultRandom();
const sessionRef = () =>
  uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" });

export const SESSION_STATUSES = ["OPEN", "CLOSED"] as const;
export const ROUND_STATUSES = ["DRAFT", "CONFIRMED"] as const;
export const ROLES = ["HOST", "GUEST"] as const;
export const ATTRIBUTION_TYPES = ["INDIVIDUAL", "GROUP", "TABLE", "UNASSIGNED"] as const;
export const CLAIM_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export const CORRECTION_TYPES = ["QUANTITY", "REPLACE", "CANCEL"] as const;
export const CORRECTION_REASONS = ["UNAVAILABLE"] as const;
export const ADJUSTMENT_DIRECTIONS = ["discount", "charge"] as const;

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

/** One table's ordering session. `revision` goes up by one with every committed change (brief 7.4). */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    title: text("title"),
    status: text("status", { enum: SESSION_STATUSES }).notNull().default("OPEN"),
    /** Short code people can type instead of scanning (Crockford base32, no look-alike letters). */
    joinCode: text("join_code").notNull(),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** When cleanup deletes it: closed + 7 days, or last activity + 30 days. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** The receipt's service charge in centavos (KKB): null = not entered, 0 = the receipt has none. */
    serviceChargeCentavos: integer("service_charge_centavos"),
    serviceChargeRevision: integer("service_charge_revision").notNull().default(0),
    /** The receipt's printed total in centavos (KKB check): null = not entered. Never split; only compared. */
    receiptTotalCentavos: integer("receipt_total_centavos"),
    receiptTotalRevision: integer("receipt_total_revision").notNull().default(0),
  },
  (t) => [
    uniqueIndex("sessions_join_code_uq").on(t.joinCode),
    index("sessions_expires_at_idx").on(t.expiresAt),
    check("sessions_status_ck", inList("status", SESSION_STATUSES)),
    check("sessions_revision_ck", sql`revision >= 0`),
    check("sessions_closed_ck", sql`(status = 'CLOSED') = (closed_at IS NOT NULL)`),
    check("sessions_service_charge_ck", sql`service_charge_centavos BETWEEN 0 AND 99999999`),
    check("sessions_service_charge_revision_ck", sql`service_charge_revision >= 0`),
    check("sessions_receipt_total_ck", sql`receipt_total_centavos BETWEEN 0 AND 99999999`),
    check("sessions_receipt_total_revision_ck", sql`receipt_total_revision >= 0`),
  ],
);

export const participants = pgTable(
  "participants",
  {
    id: id(),
    sessionId: sessionRef(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when the host removed this guest. The row stays so names on tickets still resolve. */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    /** Optional, shown only to the removed guest. */
    removedReason: text("removed_reason"),
    /** Set while the host lets this guest help mark food served (F04). Cleared on removal. */
    cohostAt: timestamp("cohost_at", { withTimezone: true }),
  },
  (t) => [
    index("participants_session_idx").on(t.sessionId),
    check("participants_role_ck", inList("role", ROLES)),
    check("participants_removed_ck", sql`(removed_at IS NULL OR role = 'GUEST') AND (removed_reason IS NULL OR (removed_at IS NOT NULL AND char_length(removed_reason) <= 140))`),
    check("participants_cohost_ck", sql`cohost_at IS NULL OR (role = 'GUEST' AND removed_at IS NULL)`),
    // Exactly one host per session.
    uniqueIndex("participants_one_host_uq").on(t.sessionId).where(sql`role = 'HOST'`),
  ],
);

/** Only the SHA-256 of a credential is stored; the raw token lives in the participant's HttpOnly cookie. */
export const participantCredentials = pgTable(
  "participant_credentials",
  {
    id: id(),
    sessionId: sessionRef(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    credentialType: text("credential_type", { enum: ROLES }).notNull(),
    credentialHash: text("credential_hash").notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("credentials_hash_uq").on(t.credentialHash),
    check("credentials_type_ck", inList("credential_type", ROLES)),
  ],
);

export const rounds = pgTable(
  "rounds",
  {
    id: id(),
    sessionId: sessionRef(),
    roundNumber: integer("round_number").notNull(),
    status: text("status", { enum: ROUND_STATUSES }).notNull().default("DRAFT"),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: uuid("confirmed_by").references(() => participants.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("rounds_number_uq").on(t.sessionId, t.roundNumber),
    // At most one draft round per session (brief 8.4).
    uniqueIndex("rounds_one_draft_uq").on(t.sessionId).where(sql`status = 'DRAFT'`),
    check("rounds_status_ck", inList("status", ROUND_STATUSES)),
    check("rounds_number_ck", sql`round_number >= 1`),
    check("rounds_confirmed_ck", sql`(status = 'CONFIRMED') = (confirmed_at IS NOT NULL)`),
  ],
);

export const participantRoundReadiness = pgTable(
  "participant_round_readiness",
  {
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    ready: boolean("ready").notNull(),
    /** The session revision the participant saw when marking ready; a later change by them makes it stale. */
    acknowledgedRevision: bigint("acknowledged_revision", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.participantId, t.roundId] }), index("readiness_round_idx").on(t.roundId)],
);

export const dishes = pgTable(
  "dishes",
  {
    id: id(),
    sessionId: sessionRef(),
    canonicalName: text("canonical_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("dishes_normalized_uq").on(t.sessionId, t.normalizedName)],
);

export const orderGroups = pgTable(
  "order_groups",
  {
    id: id(),
    sessionId: sessionRef(),
    label: text("label").notNull(),
    /** Groups are matched to collective orders by label, conservatively (same rules as dish names). */
    normalizedLabel: text("normalized_label").notNull(),
    createdBy: uuid("created_by").references(() => participants.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("order_groups_label_uq").on(t.sessionId, t.normalizedLabel)],
);

export const orderGroupMembers = pgTable(
  "order_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => orderGroups.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.participantId] })],
);

/** Who an entry is for. `submittedBy` owns it (guests may edit only their own batches). */
export const orderBatches = pgTable(
  "order_batches",
  {
    id: id(),
    sessionId: sessionRef(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    attributionType: text("attribution_type", { enum: ATTRIBUTION_TYPES }).notNull(),
    attributedParticipantId: uuid("attributed_participant_id").references(() => participants.id, { onDelete: "set null" }),
    groupId: uuid("group_id").references(() => orderGroups.id, { onDelete: "set null" }),
    collectiveLabel: text("collective_label"),
    createdAt: createdAt(),
  },
  (t) => [
    index("order_batches_round_idx").on(t.roundId),
    check("order_batches_attribution_ck", inList("attribution_type", ATTRIBUTION_TYPES)),
    check(
      "order_batches_shape_ck",
      sql`(attribution_type <> 'INDIVIDUAL' OR attributed_participant_id IS NOT NULL OR collective_label IS NOT NULL)
        AND (attribution_type <> 'GROUP' OR collective_label IS NOT NULL)`,
    ),
  ],
);

export const orderEntries = pgTable(
  "order_entries",
  {
    id: id(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => orderBatches.id, { onDelete: "cascade" }),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    dishId: uuid("dish_id")
      .notNull()
      .references(() => dishes.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    /** Size or variant as typed ("Large"), or null. */
    variant: text("variant"),
    specialInstructions: text("special_instructions"),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete, so Undo can restore it. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("order_entries_round_idx").on(t.roundId),
    index("order_entries_batch_idx").on(t.batchId),
    check("order_entries_quantity_ck", sql`quantity BETWEEN 1 AND 99`),
  ],
);

export const confirmedRoundSnapshots = pgTable(
  "confirmed_round_snapshots",
  {
    id: id(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    snapshotRevision: bigint("snapshot_revision", { mode: "number" }).notNull(),
    snapshotData: jsonb("snapshot_data").notNull(),
    confirmedBy: uuid("confirmed_by").references(() => participants.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("snapshots_round_uq").on(t.roundId)],
);

export const orderCorrections = pgTable(
  "order_corrections",
  {
    id: id(),
    sessionId: sessionRef(),
    sourceRoundId: uuid("source_round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    sourceEntryId: uuid("source_entry_id").references(() => orderEntries.id, { onDelete: "set null" }),
    /** The draft round whose waiter ticket carries this correction. */
    targetRoundId: uuid("target_round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    correctionType: text("correction_type", { enum: CORRECTION_TYPES }).notNull(),
    quantityDelta: integer("quantity_delta"),
    replacementData: jsonb("replacement_data"),
    explanation: text("explanation"),
    /** Why, when it is more than a plain correction: "UNAVAILABLE" = the waiter said it's out (told at once). */
    reason: text("reason", { enum: CORRECTION_REASONS }),
    /** Rows written by one change (several people's entries, or a whole dish) share it and are shown as one. */
    groupId: uuid("group_id"),
    createdBy: uuid("created_by").references(() => participants.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    communicatedAt: timestamp("communicated_at", { withTimezone: true }),
  },
  (t) => [
    index("corrections_target_round_idx").on(t.targetRoundId),
    index("corrections_group_idx").on(t.groupId),
    check("corrections_type_ck", inList("correction_type", CORRECTION_TYPES)),
    check("corrections_reason_ck", sql`reason IS NULL OR ${inList("reason", CORRECTION_REASONS)}`),
  ],
);

/** A guest asking the host to hand over an entry the host recorded for them (brief 5.10). Not in brief section 8. */
export const entryClaims = pgTable(
  "entry_claims",
  {
    id: id(),
    sessionId: sessionRef(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => orderBatches.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    status: text("status", { enum: CLAIM_STATUSES }).notNull().default("PENDING"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    check("claims_status_ck", inList("status", CLAIM_STATUSES)),
    uniqueIndex("claims_one_pending_uq").on(t.batchId, t.requestedBy).where(sql`status = 'PENDING'`),
    index("claims_pending_session_idx").on(t.sessionId).where(sql`status = 'PENDING'`),
  ],
);

/** Idempotency: a retried mutation with the same key returns the stored result instead of applying twice. */
export const mutationRecords = pgTable(
  "mutation_records",
  {
    id: id(),
    sessionId: sessionRef(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    mutationType: text("mutation_type").notNull(),
    result: jsonb("result").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mutations_key_uq").on(t.sessionId, t.actorId, t.idempotencyKey)],
);

/** Durable, replayable event log; SSE reads from here, NOTIFY only rings the bell (brief 7.7). */
export const sessionEvents = pgTable(
  "session_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sessionId: sessionRef(),
    revision: bigint("revision", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("events_revision_uq").on(t.sessionId, t.revision)],
);

/**
 * Settlement data for one source entry (KKB): its price each and, for shared dishes, a host-chosen payer. Separate
 * from `order_entries` so it can change after the round is confirmed without touching the frozen order.
 */
export const entrySettlements = pgTable(
  "entry_settlements",
  {
    entryId: uuid("entry_id")
      .primaryKey()
      .references(() => orderEntries.id, { onDelete: "cascade" }),
    sessionId: sessionRef(),
    unitPriceCentavos: integer("unit_price_centavos"),
    billToParticipantId: uuid("bill_to_participant_id").references(() => participants.id, { onDelete: "cascade" }),
    billToLabel: text("bill_to_label"),
    revision: integer("revision").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => participants.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("entry_settlements_session_idx").on(t.sessionId),
    check("entry_settlements_price_ck", sql`unit_price_centavos BETWEEN 0 AND 9999999`),
    check("entry_settlements_label_ck", sql`char_length(bill_to_label) BETWEEN 1 AND 40`),
    check("entry_settlements_one_payer_ck", sql`num_nonnulls(bill_to_participant_id, bill_to_label) <= 1`),
    check("entry_settlements_revision_ck", sql`revision >= 1`),
  ],
);

/** Price each for a replacement correction ("Change it to …"), host only (KKB). */
export const correctionSettlements = pgTable(
  "correction_settlements",
  {
    correctionId: uuid("correction_id")
      .primaryKey()
      .references(() => orderCorrections.id, { onDelete: "cascade" }),
    sessionId: sessionRef(),
    unitPriceCentavos: integer("unit_price_centavos"),
    revision: integer("revision").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => participants.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("correction_settlements_session_idx").on(t.sessionId),
    check("correction_settlements_price_ck", sql`unit_price_centavos BETWEEN 0 AND 9999999`),
    check("correction_settlements_revision_ck", sql`revision >= 1`),
  ],
);

/**
 * A table price (KKB): price each for one dish + size within a session, set by the host. A line's own price
 * (`entry_settlements`) overrides it. `variant_key` is the normalized size, '' for none. Clearing sets `unit_centavos` to null and keeps the row, so its revision keeps counting up.
 */
export const sharedPrices = pgTable(
  "shared_prices",
  {
    sessionId: sessionRef(),
    dishId: uuid("dish_id")
      .notNull()
      .references(() => dishes.id, { onDelete: "cascade" }),
    variantKey: text("variant_key").notNull(),
    unitCentavos: integer("unit_centavos"),
    revision: integer("revision").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => participants.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.dishId, t.variantKey] }),
    check("shared_prices_price_ck", sql`unit_centavos BETWEEN 0 AND 9999999`),
    check("shared_prices_revision_ck", sql`revision >= 1`),
  ],
);

/**
 * Food tracker: how many of one line (a preparation or a told replacement) of a confirmed round the host has seen
 * served. Raw count; the display clamps it to what is still ordered. Independent from KKB.
 */
export const servedCounts = pgTable(
  "served_counts",
  {
    sessionId: sessionRef(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    lineKey: text("line_key").notNull(),
    served: integer("served").notNull(),
    revision: integer("revision").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => participants.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.roundId, t.lineKey] }),
    check("served_counts_served_ck", sql`served >= 0`),
    check("served_counts_revision_ck", sql`revision >= 1`),
  ],
);

/**
 * In-app notifications, one row per recipient, written in the same transaction as the change that caused them (so Undo
 * or removal can delete them via `source`, and dedup never swallows a later, legitimate one). Private to the recipient.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    sessionId: sessionRef(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    subject: jsonb("subject").notNull().default({}),
    /** What created it (`entry:<id>` of removed draft entries), so undoing that change deletes or trims it. */
    source: text("source").array().notNull().default(sql`'{}'::text[]`),
    dedupKey: text("dedup_key").notNull(),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("notifications_dedup_uq").on(t.sessionId, t.recipientId, t.dedupKey),
    index("notifications_recipient_idx").on(t.recipientId, t.createdAt),
  ],
);

/**
 * A receipt adjustment (KKB): a discount or extra charge, in centavos or basis points. Only what the host typed is
 * stored; each person's share is computed (`lib/adjustments.ts`). `id` is client-generated so create is idempotent.
 */
export const adjustments = pgTable(
  "adjustments",
  {
    id: uuid("id").primaryKey(),
    sessionId: sessionRef(),
    direction: text("direction", { enum: ADJUSTMENT_DIRECTIONS }).notNull(),
    category: text("category", { enum: ADJUSTMENT_CATEGORIES }).notNull(),
    note: text("note"),
    amountCentavos: integer("amount_centavos"),
    percentBps: integer("percent_bps"),
    method: text("method", { enum: ADJUSTMENT_METHODS }).notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAt(),
    updatedBy: uuid("updated_by").references(() => participants.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("adjustments_session_idx").on(t.sessionId),
    check("adjustments_direction_ck", inList("direction", ADJUSTMENT_DIRECTIONS)),
    check("adjustments_category_ck", inList("category", ADJUSTMENT_CATEGORIES)),
    check("adjustments_method_ck", inList("method", ADJUSTMENT_METHODS)),
    check("adjustments_note_ck", sql`char_length(note) BETWEEN 1 AND 40`),
    check("adjustments_one_amount_ck", sql`num_nonnulls(amount_centavos, percent_bps) = 1`),
    check("adjustments_amount_ck", sql`amount_centavos BETWEEN 1 AND 99999999`),
    check("adjustments_percent_ck", sql`percent_bps BETWEEN 1 AND 10000`),
    check("adjustments_percent_method_ck", sql`percent_bps IS NULL OR method IN ('proportional', 'equal', 'individual')`),
    check("adjustments_revision_ck", sql`revision >= 1`),
  ],
);

/** The people an adjustment is split between: a participant or a typed name (same keys as Bill to). Amount only for "manual". */
export const adjustmentShares = pgTable(
  "adjustment_shares",
  {
    id: id(),
    adjustmentId: uuid("adjustment_id")
      .notNull()
      .references(() => adjustments.id, { onDelete: "cascade" }),
    sessionId: sessionRef(),
    // No cascade: participants are soft-removed, so a removed person's share stays (and is flagged).
    participantId: uuid("participant_id").references(() => participants.id),
    billToLabel: text("bill_to_label"),
    amountCentavos: integer("amount_centavos"),
  },
  (t) => [
    index("adjustment_shares_adjustment_idx").on(t.adjustmentId),
    index("adjustment_shares_session_idx").on(t.sessionId),
    check("adjustment_shares_one_who_ck", sql`num_nonnulls(participant_id, bill_to_label) = 1`),
    check("adjustment_shares_label_ck", sql`char_length(bill_to_label) BETWEEN 1 AND 40`),
    check("adjustment_shares_amount_ck", sql`amount_centavos BETWEEN 0 AND 99999999`),
  ],
);

/** Who shares one shared dish equally (KKB split). Rows exist only for a split (2 or more people); shares are computed. */
export const entryPayers = pgTable(
  "entry_payers",
  {
    id: id(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => orderEntries.id, { onDelete: "cascade" }),
    sessionId: sessionRef(),
    // No cascade: participants are soft-removed, so a removed payer keeps their share.
    participantId: uuid("participant_id").references(() => participants.id),
    billToLabel: text("bill_to_label"),
  },
  (t) => [
    index("entry_payers_entry_idx").on(t.entryId),
    index("entry_payers_session_idx").on(t.sessionId),
    uniqueIndex("entry_payers_entry_person_uq").on(t.entryId, t.participantId),
    uniqueIndex("entry_payers_entry_label_uq").on(t.entryId, sql`lower(${t.billToLabel})`),
    check("entry_payers_one_who_ck", sql`num_nonnulls(participant_id, bill_to_label) = 1`),
    check("entry_payers_label_ck", sql`char_length(bill_to_label) BETWEEN 1 AND 40`),
  ],
);

/** An extra restaurant receipt (KKB): a label, its printed total and the people it covers. The main receipt stays on `sessions`. */
export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey(),
    sessionId: sessionRef(),
    label: text("label"),
    totalCentavos: integer("total_centavos"),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAt(),
    updatedBy: uuid("updated_by").references(() => participants.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("receipts_session_idx").on(t.sessionId),
    check("receipts_label_ck", sql`char_length(label) BETWEEN 1 AND 40`),
    check("receipts_total_ck", sql`total_centavos BETWEEN 0 AND 99999999`),
    check("receipts_revision_ck", sql`revision >= 1`),
  ],
);

/** The people an extra receipt covers. A person sits on one extra receipt at most; everyone else is on the main receipt. */
export const receiptPeople = pgTable(
  "receipt_people",
  {
    id: id(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    sessionId: sessionRef(),
    participantId: uuid("participant_id").references(() => participants.id),
    billToLabel: text("bill_to_label"),
  },
  (t) => [
    index("receipt_people_receipt_idx").on(t.receiptId),
    uniqueIndex("receipt_people_session_person_uq").on(t.sessionId, t.participantId),
    uniqueIndex("receipt_people_session_label_uq").on(t.sessionId, sql`lower(${t.billToLabel})`),
    check("receipt_people_one_who_ck", sql`num_nonnulls(participant_id, bill_to_label) = 1`),
    check("receipt_people_label_ck", sql`char_length(bill_to_label) BETWEEN 1 AND 40`),
  ],
);
