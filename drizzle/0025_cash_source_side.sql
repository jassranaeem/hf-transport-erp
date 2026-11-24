ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "source_side" text;
--> statement-breakpoint
UPDATE "cash_transactions" SET "source_side" = "direction" WHERE "source_sheet" IS NOT NULL AND "source_side" IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "ct_source_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ct_source_idx" ON "cash_transactions" ("source_sheet", "source_row", "source_side");
