-- backups: add real snapshot payload + kind, so "Backups" stops being simulated
ALTER TABLE "backups" ADD COLUMN IF NOT EXISTS "data_json" jsonb;
ALTER TABLE "backups" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'manual' NOT NULL;
