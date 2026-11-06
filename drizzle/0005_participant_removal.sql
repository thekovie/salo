ALTER TABLE "participants" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "removed_reason" text;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_removed_ck" CHECK ((removed_at IS NULL OR role = 'GUEST') AND (removed_reason IS NULL OR (removed_at IS NOT NULL AND char_length(removed_reason) <= 140)));