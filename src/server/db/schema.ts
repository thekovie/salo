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
  },
  (t) => [
    uniqueIndex("sessions_join_code_uq").on(t.joinCode),
    index("sessions_expires_at_idx").on(t.expiresAt),
    check("sessions_status_ck", inList("status", SESSION_STATUSES)),
    check("sessions_revision_ck", sql`revision >= 0`),
    check("sessions_closed_ck", sql`(status = 'CLOSED') = (closed_at IS NOT NULL)`),
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
  },
  (t) => [
    index("participants_session_idx").on(t.sessionId),
    check("participants_role_ck", inList("role", ROLES)),
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
  (t) => [primaryKey({ columns: [t.participantId, t.roundId] })],
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
    createdBy: uuid("created_by").references(() => participants.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("order_groups_session_idx").on(t.sessionId)],
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
    createdBy: uuid("created_by").references(() => participants.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    communicatedAt: timestamp("communicated_at", { withTimezone: true }),
  },
  (t) => [index("corrections_target_round_idx").on(t.targetRoundId), check("corrections_type_ck", inList("correction_type", CORRECTION_TYPES))],
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
