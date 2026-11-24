ALTER TABLE "truck_ledger_entries" ADD COLUMN IF NOT EXISTS "sort_key" double precision;
--> statement-breakpoint
ALTER TABLE "truck_ledger_entries" ADD COLUMN IF NOT EXISTS "merged_from" text;
