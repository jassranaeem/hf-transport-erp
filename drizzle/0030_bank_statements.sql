CREATE TABLE IF NOT EXISTS "bank_statement_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_account_id" integer NOT NULL,
	"txn_date" timestamp NOT NULL,
	"description" text,
	"ref" text,
	"withdrawal" bigint DEFAULT 0 NOT NULL,
	"deposit" bigint DEFAULT 0 NOT NULL,
	"balance" bigint,
	"row_hash" text NOT NULL,
	"source_file" text,
	"batch" text,
	"matched_key" text,
	"match_kind" text,
	"kind" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"deleted_at" timestamp,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bsl_bank_hash_idx" ON "bank_statement_lines" USING btree ("bank_account_id","row_hash") WHERE "is_deleted" = false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bsl_bank_date_idx" ON "bank_statement_lines" USING btree ("bank_account_id","txn_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bsl_matched_idx" ON "bank_statement_lines" USING btree ("matched_key");
