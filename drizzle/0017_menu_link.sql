ALTER TABLE "sessions" ADD COLUMN "menu_url" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "menu_label" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_menu_url_ck" CHECK (char_length(menu_url) <= 500);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_menu_label_ck" CHECK (char_length(menu_label) <= 40);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_menu_label_url_ck" CHECK (menu_label IS NULL OR menu_url IS NOT NULL);