CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"participant_id" uuid,
	"label" text,
	"payee_participant_id" uuid,
	"payee_label" text,
	"amount_centavos" integer NOT NULL,
	"method" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "payments_one_payer_ck" CHECK (num_nonnulls(participant_id, label) = 1),
	CONSTRAINT "payments_label_ck" CHECK (char_length(label) BETWEEN 1 AND 40),
	CONSTRAINT "payments_one_payee_ck" CHECK (num_nonnulls(payee_participant_id, payee_label) <= 1),
	CONSTRAINT "payments_payee_label_ck" CHECK (char_length(payee_label) BETWEEN 1 AND 40),
	CONSTRAINT "payments_amount_ck" CHECK (amount_centavos BETWEEN 1 AND 99999999),
	CONSTRAINT "payments_method_ck" CHECK (method IN ('cash', 'gcash', 'maya', 'bank', 'other')),
	CONSTRAINT "payments_note_ck" CHECK (char_length(note) BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payee_participant_id_participants_id_fk" FOREIGN KEY ("payee_participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_participants_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_session_idx" ON "payments" USING btree ("session_id");
--> statement-breakpoint
-- A payment stays inside one session: its payer, payee and recorder must belong to the row's session.
CREATE FUNCTION salo_payment_same_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.participant_id IS NOT NULL AND (SELECT session_id FROM participants WHERE id = NEW.participant_id) IS DISTINCT FROM NEW.session_id)
     OR (NEW.payee_participant_id IS NOT NULL AND (SELECT session_id FROM participants WHERE id = NEW.payee_participant_id) IS DISTINCT FROM NEW.session_id)
     OR (NEW.created_by IS NOT NULL AND (SELECT session_id FROM participants WHERE id = NEW.created_by) IS DISTINCT FROM NEW.session_id) THEN
    RAISE EXCEPTION 'a payment must stay inside its session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payments_same_session BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION salo_payment_same_session();
