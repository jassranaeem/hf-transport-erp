-- Upgrade to a unique index so bulk imports can upsert in one statement
-- (ON CONFLICT) instead of one row at a time. Clear any rows from a prior
-- (slow, one-row-at-a-time) import attempt first, in case it was interrupted
-- mid-way and left duplicate or partial source_sheet/source_row pairs that
-- would violate the new unique constraint - hand-entered rows (source_sheet
-- IS NULL) are untouched.
DELETE FROM "cash_transactions" WHERE "source_sheet" IS NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "ct_source_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ct_source_idx" ON "cash_transactions" ("source_sheet", "source_row", "direction");
