ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "source_key" text;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "is_auto" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_source_key_idx" ON "journal_entries" USING btree ("source_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_entries_date_idx" ON "journal_entries" USING btree ("entry_date");
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "vehicle_id" integer;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "truck_ledger_id" integer;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "party_id" integer;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "contractor_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_lines_entry_idx" ON "journal_lines" USING btree ("journal_entry_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_lines_account_idx" ON "journal_lines" USING btree ("account_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posting_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"category" text NOT NULL,
	"side" text DEFAULT 'any' NOT NULL,
	"account_code" text NOT NULL,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "posting_rules_key_idx" ON "posting_rules" USING btree ("source","category","side");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "books_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"books_start" timestamp DEFAULT '2025-07-01 00:00:00' NOT NULL,
	"last_rebuild_at" timestamp,
	"last_rebuild" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "books_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
