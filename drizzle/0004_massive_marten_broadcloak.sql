CREATE TABLE "parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"party_code" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'Other' NOT NULL,
	"phone" text,
	"address" text,
	"city" text,
	"ntn" text,
	"strn" text,
	"bank_name" text,
	"bank_account_title" text,
	"bank_account_no" text,
	"iban" text,
	"opening_balance" integer DEFAULT 0 NOT NULL,
	"closing_balance" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"source_sheet" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "parties_party_code_unique" UNIQUE("party_code")
);
--> statement-breakpoint
CREATE TABLE "party_ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"party_id" integer NOT NULL,
	"sr_no" integer,
	"entry_date" timestamp,
	"raw_date" text,
	"description" text,
	"ref_no" text,
	"method" text,
	"debit" integer DEFAULT 0 NOT NULL,
	"credit" integer DEFAULT 0 NOT NULL,
	"running_balance" integer DEFAULT 0 NOT NULL,
	"sheet_balance" integer,
	"category" text DEFAULT 'Other' NOT NULL,
	"section_label" text,
	"is_reset" boolean DEFAULT false NOT NULL,
	"source_row" integer,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "party_ledger_entries" ADD CONSTRAINT "party_ledger_entries_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "party_name_idx" ON "parties" USING btree ("name");--> statement-breakpoint
CREATE INDEX "party_type_idx" ON "parties" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ple_party_idx" ON "party_ledger_entries" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "ple_date_idx" ON "party_ledger_entries" USING btree ("entry_date");