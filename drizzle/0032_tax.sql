CREATE TABLE IF NOT EXISTS "tax_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"section" text,
	"rate" numeric(7, 3),
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tax_rates_code_idx" ON "tax_rates" USING btree ("code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"entry_date" timestamp NOT NULL,
	"for_month" text,
	"rate_code" text,
	"party_name" text,
	"party_id" integer,
	"contractor_id" integer,
	"invoice_id" integer,
	"ntn_cnic" text,
	"gross_amount" bigint DEFAULT 0 NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"certificate_no" text,
	"cpr_no" text,
	"method" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"deleted_at" timestamp,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tax_entries_kind_date_idx" ON "tax_entries" USING btree ("kind","entry_date");
