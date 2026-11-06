DROP INDEX "order_groups_session_idx";--> statement-breakpoint
ALTER TABLE "order_groups" ADD COLUMN "normalized_label" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "order_groups_label_uq" ON "order_groups" USING btree ("session_id","normalized_label");