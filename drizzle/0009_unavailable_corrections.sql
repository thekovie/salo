ALTER TABLE "order_corrections" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "order_corrections" ADD COLUMN "group_id" uuid;--> statement-breakpoint
CREATE INDEX "corrections_group_idx" ON "order_corrections" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "order_corrections" ADD CONSTRAINT "corrections_reason_ck" CHECK (reason IS NULL OR reason IN ('UNAVAILABLE'));