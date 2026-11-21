ALTER TABLE "sessions" ADD COLUMN "receipt_total_centavos" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "receipt_total_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_receipt_total_ck" CHECK (receipt_total_centavos BETWEEN 0 AND 99999999);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_receipt_total_revision_ck" CHECK (receipt_total_revision >= 0);