-- Track where an imported cash-book row came from, so re-importing the same
-- file updates existing rows instead of duplicating them.
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "source_sheet" text;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "source_row" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ct_source_idx" ON "cash_transactions" ("source_sheet", "source_row");
