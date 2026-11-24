ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "parent_trip_id" integer;
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "leg_no" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "cargo" text;
