CREATE TABLE "confirmed_round_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"snapshot_revision" bigint NOT NULL,
	"snapshot_data" jsonb NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "claims_status_ck" CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "mutation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"mutation_type" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"attribution_type" text NOT NULL,
	"attributed_participant_id" uuid,
	"group_id" uuid,
	"collective_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_batches_attribution_ck" CHECK (attribution_type IN ('INDIVIDUAL', 'GROUP', 'TABLE', 'UNASSIGNED')),
	CONSTRAINT "order_batches_shape_ck" CHECK ((attribution_type <> 'INDIVIDUAL' OR attributed_participant_id IS NOT NULL OR collective_label IS NOT NULL)
        AND (attribution_type <> 'GROUP' OR collective_label IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "order_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"source_round_id" uuid NOT NULL,
	"source_entry_id" uuid,
	"target_round_id" uuid NOT NULL,
	"correction_type" text NOT NULL,
	"quantity_delta" integer,
	"replacement_data" jsonb,
	"explanation" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"communicated_at" timestamp with time zone,
	CONSTRAINT "corrections_type_ck" CHECK (correction_type IN ('QUANTITY', 'REPLACE', 'CANCEL'))
);
--> statement-breakpoint
CREATE TABLE "order_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"dish_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"variant" text,
	"special_instructions" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "order_entries_quantity_ck" CHECK (quantity BETWEEN 1 AND 99)
);
--> statement-breakpoint
CREATE TABLE "order_group_members" (
	"group_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	CONSTRAINT "order_group_members_group_id_participant_id_pk" PRIMARY KEY("group_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "order_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"label" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participant_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"credential_type" text NOT NULL,
	"credential_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "credentials_type_ck" CHECK (credential_type IN ('HOST', 'GUEST'))
);
--> statement-breakpoint
CREATE TABLE "participant_round_readiness" (
	"participant_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"ready" boolean NOT NULL,
	"acknowledged_revision" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_round_readiness_participant_id_round_id_pk" PRIMARY KEY("participant_id","round_id")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_role_ck" CHECK (role IN ('HOST', 'GUEST'))
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	CONSTRAINT "rounds_status_ck" CHECK (status IN ('DRAFT', 'CONFIRMED')),
	CONSTRAINT "rounds_number_ck" CHECK (round_number >= 1),
	CONSTRAINT "rounds_confirmed_ck" CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"join_code" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_status_ck" CHECK (status IN ('OPEN', 'CLOSED')),
	CONSTRAINT "sessions_revision_ck" CHECK (revision >= 0),
	CONSTRAINT "sessions_closed_ck" CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "confirmed_round_snapshots" ADD CONSTRAINT "confirmed_round_snapshots_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmed_round_snapshots" ADD CONSTRAINT "confirmed_round_snapshots_confirmed_by_participants_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dishes" ADD CONSTRAINT "dishes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_claims" ADD CONSTRAINT "entry_claims_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_claims" ADD CONSTRAINT "entry_claims_batch_id_order_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."order_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_claims" ADD CONSTRAINT "entry_claims_requested_by_participants_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_records" ADD CONSTRAINT "mutation_records_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_records" ADD CONSTRAINT "mutation_records_actor_id_participants_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_batches" ADD CONSTRAINT "order_batches_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_batches" ADD CONSTRAINT "order_batches_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_batches" ADD CONSTRAINT "order_batches_submitted_by_participants_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_batches" ADD CONSTRAINT "order_batches_attributed_participant_id_participants_id_fk" FOREIGN KEY ("attributed_participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_batches" ADD CONSTRAINT "order_batches_group_id_order_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."order_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_corrections" ADD CONSTRAINT "order_corrections_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_corrections" ADD CONSTRAINT "order_corrections_source_round_id_rounds_id_fk" FOREIGN KEY ("source_round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_corrections" ADD CONSTRAINT "order_corrections_source_entry_id_order_entries_id_fk" FOREIGN KEY ("source_entry_id") REFERENCES "public"."order_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_corrections" ADD CONSTRAINT "order_corrections_target_round_id_rounds_id_fk" FOREIGN KEY ("target_round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_corrections" ADD CONSTRAINT "order_corrections_created_by_participants_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_entries" ADD CONSTRAINT "order_entries_batch_id_order_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."order_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_entries" ADD CONSTRAINT "order_entries_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_entries" ADD CONSTRAINT "order_entries_dish_id_dishes_id_fk" FOREIGN KEY ("dish_id") REFERENCES "public"."dishes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_group_members" ADD CONSTRAINT "order_group_members_group_id_order_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."order_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_group_members" ADD CONSTRAINT "order_group_members_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_created_by_participants_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_credentials" ADD CONSTRAINT "participant_credentials_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_credentials" ADD CONSTRAINT "participant_credentials_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_round_readiness" ADD CONSTRAINT "participant_round_readiness_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_round_readiness" ADD CONSTRAINT "participant_round_readiness_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_confirmed_by_participants_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_round_uq" ON "confirmed_round_snapshots" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dishes_normalized_uq" ON "dishes" USING btree ("session_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_one_pending_uq" ON "entry_claims" USING btree ("batch_id","requested_by") WHERE status = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "mutations_key_uq" ON "mutation_records" USING btree ("session_id","actor_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "order_batches_round_idx" ON "order_batches" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "corrections_target_round_idx" ON "order_corrections" USING btree ("target_round_id");--> statement-breakpoint
CREATE INDEX "order_entries_round_idx" ON "order_entries" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "order_entries_batch_idx" ON "order_entries" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "order_groups_session_idx" ON "order_groups" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_hash_uq" ON "participant_credentials" USING btree ("credential_hash");--> statement-breakpoint
CREATE INDEX "participants_session_idx" ON "participants" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_one_host_uq" ON "participants" USING btree ("session_id") WHERE role = 'HOST';--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_number_uq" ON "rounds" USING btree ("session_id","round_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_one_draft_uq" ON "rounds" USING btree ("session_id") WHERE status = 'DRAFT';--> statement-breakpoint
CREATE UNIQUE INDEX "events_revision_uq" ON "session_events" USING btree ("session_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_join_code_uq" ON "sessions" USING btree ("join_code");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");