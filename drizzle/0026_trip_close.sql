ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "freight_written_off" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "closed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "split_at" timestamp;
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "split_amount" integer;
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "split_account_id" integer;
