CREATE TABLE "entry_payers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"participant_id" uuid,
	"bill_to_label" text,
	CONSTRAINT "entry_payers_one_who_ck" CHECK (num_nonnulls(participant_id, bill_to_label) = 1),
	CONSTRAINT "entry_payers_label_ck" CHECK (char_length(bill_to_label) BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE TABLE "receipt_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"participant_id" uuid,
	"bill_to_label" text,
	CONSTRAINT "receipt_people_one_who_ck" CHECK (num_nonnulls(participant_id, bill_to_label) = 1),
	CONSTRAINT "receipt_people_label_ck" CHECK (char_length(bill_to_label) BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"label" text,
	"total_centavos" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_label_ck" CHECK (char_length(label) BETWEEN 1 AND 40),
	CONSTRAINT "receipts_total_ck" CHECK (total_centavos BETWEEN 0 AND 99999999),
	CONSTRAINT "receipts_revision_ck" CHECK (revision >= 1)
);
--> statement-breakpoint
ALTER TABLE "entry_payers" ADD CONSTRAINT "entry_payers_entry_id_order_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."order_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_payers" ADD CONSTRAINT "entry_payers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_payers" ADD CONSTRAINT "entry_payers_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_people" ADD CONSTRAINT "receipt_people_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_people" ADD CONSTRAINT "receipt_people_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_people" ADD CONSTRAINT "receipt_people_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_updated_by_participants_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_payers_entry_idx" ON "entry_payers" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "entry_payers_session_idx" ON "entry_payers" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_payers_entry_person_uq" ON "entry_payers" USING btree ("entry_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_payers_entry_label_uq" ON "entry_payers" USING btree ("entry_id",lower("bill_to_label"));--> statement-breakpoint
CREATE INDEX "receipt_people_receipt_idx" ON "receipt_people" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_people_session_person_uq" ON "receipt_people" USING btree ("session_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_people_session_label_uq" ON "receipt_people" USING btree ("session_id",lower("bill_to_label"));--> statement-breakpoint
CREATE INDEX "receipts_session_idx" ON "receipts" USING btree ("session_id");
--> statement-breakpoint
-- Splits and receipts stay inside one session: the dish / receipt and the person must belong to the row's session.
CREATE FUNCTION salo_entry_payer_same_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT b.session_id FROM order_entries e JOIN order_batches b ON b.id = e.batch_id WHERE e.id = NEW.entry_id) IS DISTINCT FROM NEW.session_id
     OR (NEW.participant_id IS NOT NULL AND (SELECT session_id FROM participants WHERE id = NEW.participant_id) IS DISTINCT FROM NEW.session_id) THEN
    RAISE EXCEPTION 'a split must stay inside its session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER entry_payers_same_session BEFORE INSERT OR UPDATE ON entry_payers
  FOR EACH ROW EXECUTE FUNCTION salo_entry_payer_same_session();
--> statement-breakpoint
CREATE FUNCTION salo_receipt_person_same_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT session_id FROM receipts WHERE id = NEW.receipt_id) IS DISTINCT FROM NEW.session_id
     OR (NEW.participant_id IS NOT NULL AND (SELECT session_id FROM participants WHERE id = NEW.participant_id) IS DISTINCT FROM NEW.session_id) THEN
    RAISE EXCEPTION 'a receipt must stay inside its session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER receipt_people_same_session BEFORE INSERT OR UPDATE ON receipt_people
  FOR EACH ROW EXECUTE FUNCTION salo_receipt_person_same_session();
--> statement-breakpoint
CREATE FUNCTION salo_receipt_updated_by_same_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.updated_by IS NOT NULL AND (SELECT session_id FROM participants WHERE id = NEW.updated_by) IS DISTINCT FROM NEW.session_id THEN
    RAISE EXCEPTION 'a receipt must stay inside its session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER receipts_same_session BEFORE INSERT OR UPDATE ON receipts
  FOR EACH ROW EXECUTE FUNCTION salo_receipt_updated_by_same_session();
