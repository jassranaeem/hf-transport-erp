-- The opening balance of a Personal & Household ledger, written by the user: one row per ledger
-- (kind = category | person | pot, name = the ledger). It counts as money from before the first entry.
CREATE TABLE IF NOT EXISTS "personal_openings" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "personal_openings_kind_name_unique" UNIQUE("kind","name")
);
