-- Zakat installment register — was only ever pushed directly to local dev,
-- never got a tracked migration, so it never reached production. This is
-- what makes it real: the Zakat page and the Monthly Report's Zakat card
-- both query this table.
CREATE TABLE IF NOT EXISTS "zakat_payments" (
  "id" serial PRIMARY KEY NOT NULL,
  "entry_date" timestamp DEFAULT now() NOT NULL,
  "amount" integer DEFAULT 0 NOT NULL,
  "recipient" text,
  "description" text,
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
  "is_deleted" boolean DEFAULT false NOT NULL,
  CONSTRAINT "zakat_payments_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zp_date_idx" ON "zakat_payments" ("entry_date");
