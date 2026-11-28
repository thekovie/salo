CREATE TABLE "adjustment_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adjustment_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"participant_id" uuid,
	"bill_to_label" text,
	"amount_centavos" integer,
	CONSTRAINT "adjustment_shares_one_who_ck" CHECK (num_nonnulls(participant_id, bill_to_label) = 1),
	CONSTRAINT "adjustment_shares_label_ck" CHECK (char_length(bill_to_label) BETWEEN 1 AND 40),
	CONSTRAINT "adjustment_shares_amount_ck" CHECK (amount_centavos BETWEEN 0 AND 99999999)
);
--> statement-breakpoint
CREATE TABLE "adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"category" text NOT NULL,
	"note" text,
	"amount_centavos" integer,
	"percent_bps" integer,
	"method" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjustments_direction_ck" CHECK (direction IN ('discount', 'charge')),
	CONSTRAINT "adjustments_category_ck" CHECK (category IN ('senior', 'pwd', 'privilege', 'promo', 'other')),
	CONSTRAINT "adjustments_method_ck" CHECK (method IN ('proportional', 'equal', 'individual', 'manual', 'unallocated')),
	CONSTRAINT "adjustments_note_ck" CHECK (char_length(note) BETWEEN 1 AND 40),
	CONSTRAINT "adjustments_one_amount_ck" CHECK (num_nonnulls(amount_centavos, percent_bps) = 1),
	CONSTRAINT "adjustments_amount_ck" CHECK (amount_centavos BETWEEN 1 AND 99999999),
	CONSTRAINT "adjustments_percent_ck" CHECK (percent_bps BETWEEN 1 AND 10000),
	CONSTRAINT "adjustments_percent_method_ck" CHECK (percent_bps IS NULL OR method IN ('proportional', 'equal', 'individual')),
	CONSTRAINT "adjustments_revision_ck" CHECK (revision >= 1)
);
--> statement-breakpoint
ALTER TABLE "adjustment_shares" ADD CONSTRAINT "adjustment_shares_adjustment_id_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."adjustments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_shares" ADD CONSTRAINT "adjustment_shares_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_shares" ADD CONSTRAINT "adjustment_shares_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_updated_by_participants_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjustment_shares_adjustment_idx" ON "adjustment_shares" USING btree ("adjustment_id");--> statement-breakpoint
CREATE INDEX "adjustment_shares_session_idx" ON "adjustment_shares" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "adjustments_session_idx" ON "adjustments" USING btree ("session_id");
--> statement-breakpoint
-- Adjustments stay inside one session: a share's adjustment and participant must belong to the share's session.
CREATE FUNCTION salo_adjustment_share_same_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT session_id FROM adjustments WHERE id = NEW.adjustment_id) IS DISTINCT FROM NEW.session_id
     OR (NEW.participant_id IS NOT NULL AND (SELECT session_id FROM participants WHERE id = NEW.participant_id) IS DISTINCT FROM NEW.session_id) THEN
    RAISE EXCEPTION 'an adjustment must stay inside its session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER adjustment_shares_same_session BEFORE INSERT OR UPDATE ON adjustment_shares
  FOR EACH ROW EXECUTE FUNCTION salo_adjustment_share_same_session();
--> statement-breakpoint
CREATE FUNCTION salo_adjustment_updated_by_same_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.updated_by IS NOT NULL AND (SELECT session_id FROM participants WHERE id = NEW.updated_by) IS DISTINCT FROM NEW.session_id THEN
    RAISE EXCEPTION 'an adjustment must stay inside its session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER adjustments_same_session BEFORE INSERT OR UPDATE ON adjustments
  FOR EACH ROW EXECUTE FUNCTION salo_adjustment_updated_by_same_session();
