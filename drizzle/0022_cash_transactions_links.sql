ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "link_type" text;
--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "link_target_id" integer;
--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "derived_entry_id" integer;
