CREATE TABLE IF NOT EXISTS "partnership_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_ledger_id" integer NOT NULL REFERENCES "truck_ledgers"("id"),
	"partner_party_id" integer NOT NULL REFERENCES "parties"("id"),
	"hfk_party_id" integer NOT NULL REFERENCES "parties"("id"),
	"partner_percent" integer DEFAULT 50 NOT NULL,
	"last_entry_id" integer DEFAULT 0 NOT NULL,
	"cycle_no" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ple_ref_no_idx" ON "party_ledger_entries" ("ref_no");
