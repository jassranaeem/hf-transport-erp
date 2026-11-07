ALTER TABLE "cash_closings" ADD COLUMN IF NOT EXISTS "day" text;
--> statement-breakpoint
ALTER TABLE "cash_closings" ADD COLUMN IF NOT EXISTS "denominations" jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cash_closings_day_idx" ON "cash_closings" USING btree ("day") WHERE "is_deleted" = false AND "day" IS NOT NULL;
