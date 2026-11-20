CREATE TABLE "served_counts" (
	"session_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"line_key" text NOT NULL,
	"served" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "served_counts_session_id_round_id_line_key_pk" PRIMARY KEY("session_id","round_id","line_key"),
	CONSTRAINT "served_counts_served_ck" CHECK (served >= 0),
	CONSTRAINT "served_counts_revision_ck" CHECK (revision >= 1)
);
--> statement-breakpoint
ALTER TABLE "served_counts" ADD CONSTRAINT "served_counts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "served_counts" ADD CONSTRAINT "served_counts_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "served_counts" ADD CONSTRAINT "served_counts_updated_by_participants_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- A served count stays inside its session: the round must belong to the row's session.
CREATE FUNCTION salo_served_count_same_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT session_id FROM rounds WHERE id = NEW.round_id) IS DISTINCT FROM NEW.session_id THEN
    RAISE EXCEPTION 'a served count must stay inside its session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER served_counts_same_session BEFORE INSERT OR UPDATE ON served_counts
  FOR EACH ROW EXECUTE FUNCTION salo_served_count_same_session();
