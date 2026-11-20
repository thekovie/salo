CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" text NOT NULL,
	"subject" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text[] DEFAULT '{}'::text[] NOT NULL,
	"dedup_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_participants_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedup_uq" ON "notifications" USING btree ("session_id","recipient_id","dedup_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_id","created_at");
--> statement-breakpoint
-- A notification stays inside its session: the recipient must belong to the row's session.
CREATE FUNCTION salo_notification_same_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT session_id FROM participants WHERE id = NEW.recipient_id) IS DISTINCT FROM NEW.session_id THEN
    RAISE EXCEPTION 'a notification must stay inside its session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER notifications_same_session BEFORE INSERT OR UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION salo_notification_same_session();
