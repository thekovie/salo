CREATE TABLE "correction_settlements" (
	"correction_id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"unit_price_centavos" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "correction_settlements_price_ck" CHECK (unit_price_centavos BETWEEN 0 AND 9999999),
	CONSTRAINT "correction_settlements_revision_ck" CHECK (revision >= 1)
);
--> statement-breakpoint
CREATE TABLE "entry_settlements" (
	"entry_id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"unit_price_centavos" integer,
	"bill_to_participant_id" uuid,
	"bill_to_label" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_settlements_price_ck" CHECK (unit_price_centavos BETWEEN 0 AND 9999999),
	CONSTRAINT "entry_settlements_label_ck" CHECK (char_length(bill_to_label) BETWEEN 1 AND 40),
	CONSTRAINT "entry_settlements_one_payer_ck" CHECK (num_nonnulls(bill_to_participant_id, bill_to_label) <= 1),
	CONSTRAINT "entry_settlements_revision_ck" CHECK (revision >= 1)
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "service_charge_centavos" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "service_charge_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "correction_settlements" ADD CONSTRAINT "correction_settlements_correction_id_order_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "public"."order_corrections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_settlements" ADD CONSTRAINT "correction_settlements_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_settlements" ADD CONSTRAINT "correction_settlements_updated_by_participants_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_settlements" ADD CONSTRAINT "entry_settlements_entry_id_order_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."order_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_settlements" ADD CONSTRAINT "entry_settlements_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_settlements" ADD CONSTRAINT "entry_settlements_bill_to_participant_id_participants_id_fk" FOREIGN KEY ("bill_to_participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_settlements" ADD CONSTRAINT "entry_settlements_updated_by_participants_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "correction_settlements_session_idx" ON "correction_settlements" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "entry_settlements_session_idx" ON "entry_settlements" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_service_charge_ck" CHECK (service_charge_centavos BETWEEN 0 AND 99999999);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_service_charge_revision_ck" CHECK (service_charge_revision >= 0);--> statement-breakpoint
-- KKB settlement rows stay inside one session: the entry (through its batch), the correction and the bill-to person
-- must all belong to the row's session. Order tables and their freeze triggers are untouched: prices live here so
-- they can change after a round is confirmed without touching what the waiter was told.
CREATE FUNCTION salo_entry_settlement_same_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT b.session_id FROM order_entries e JOIN order_batches b ON b.id = e.batch_id WHERE e.id = NEW.entry_id) IS DISTINCT FROM NEW.session_id
     OR (NEW.bill_to_participant_id IS NOT NULL AND (SELECT session_id FROM participants WHERE id = NEW.bill_to_participant_id) IS DISTINCT FROM NEW.session_id) THEN
    RAISE EXCEPTION 'a settlement must stay inside its session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER entry_settlements_same_session BEFORE INSERT OR UPDATE ON entry_settlements
  FOR EACH ROW EXECUTE FUNCTION salo_entry_settlement_same_session();
--> statement-breakpoint
CREATE FUNCTION salo_correction_settlement_same_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT session_id FROM order_corrections WHERE id = NEW.correction_id) IS DISTINCT FROM NEW.session_id THEN
    RAISE EXCEPTION 'a settlement must stay inside its session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER correction_settlements_same_session BEFORE INSERT OR UPDATE ON correction_settlements
  FOR EACH ROW EXECUTE FUNCTION salo_correction_settlement_same_session();
