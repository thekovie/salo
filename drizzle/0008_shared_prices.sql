CREATE TABLE "shared_prices" (
	"session_id" uuid NOT NULL,
	"dish_id" uuid NOT NULL,
	"variant_key" text NOT NULL,
	"unit_centavos" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_prices_session_id_dish_id_variant_key_pk" PRIMARY KEY("session_id","dish_id","variant_key"),
	CONSTRAINT "shared_prices_price_ck" CHECK (unit_centavos BETWEEN 0 AND 9999999),
	CONSTRAINT "shared_prices_revision_ck" CHECK (revision >= 1)
);
--> statement-breakpoint
ALTER TABLE "shared_prices" ADD CONSTRAINT "shared_prices_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_prices" ADD CONSTRAINT "shared_prices_dish_id_dishes_id_fk" FOREIGN KEY ("dish_id") REFERENCES "public"."dishes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_prices" ADD CONSTRAINT "shared_prices_updated_by_participants_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- A table price stays inside its session: the dish must belong to the row's session.
CREATE FUNCTION salo_shared_price_same_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT session_id FROM dishes WHERE id = NEW.dish_id) IS DISTINCT FROM NEW.session_id THEN
    RAISE EXCEPTION 'a shared price must stay inside its session';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER shared_prices_same_session BEFORE INSERT OR UPDATE ON shared_prices
  FOR EACH ROW EXECUTE FUNCTION salo_shared_price_same_session();
