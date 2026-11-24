-- A spending ledger (category / person) of Personal & Household can have an opening written for each
-- period: period = the day the period starts ('' = no dates chosen, the whole time). The house pot keeps '' only.
ALTER TABLE "personal_openings" ADD COLUMN IF NOT EXISTS "period" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "personal_openings" DROP CONSTRAINT IF EXISTS "personal_openings_kind_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "personal_openings_kind_name_period_unique" ON "personal_openings" ("kind","name","period");
