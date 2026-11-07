-- Daily cash-in-hand log (itemized in/out transactions, grouped by calendar day)
CREATE TABLE IF NOT EXISTS "cash_transactions" (
  "id" serial PRIMARY KEY NOT NULL,
  "entry_date" timestamp DEFAULT now() NOT NULL,
  "direction" text NOT NULL,
  "amount" integer DEFAULT 0 NOT NULL,
  "person" text,
  "description" text,
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
CREATE INDEX IF NOT EXISTS "ct_date_idx" ON "cash_transactions" ("entry_date");
