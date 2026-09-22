-- personal / household expenses register (owner's personal book, kept out of the business P&L)
CREATE TABLE IF NOT EXISTS "personal_expenses" (
  "id" serial PRIMARY KEY NOT NULL,
  "entry_date" timestamp DEFAULT now() NOT NULL,
  "category" text DEFAULT 'Household' NOT NULL,
  "direction" text DEFAULT 'expense' NOT NULL,
  "person" text,
  "description" text,
  "payee" text,
  "amount" integer DEFAULT 0 NOT NULL,
  "method" text DEFAULT 'Cash' NOT NULL,
  "bank_account_id" integer,
  "ref_no" text,
  "paid_by" text,
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
CREATE INDEX IF NOT EXISTS "pe_date_idx" ON "personal_expenses" ("entry_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pe_category_idx" ON "personal_expenses" ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pe_person_idx" ON "personal_expenses" ("person");
