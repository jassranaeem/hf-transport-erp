-- Lease-to-own: an instalment plan on the agreement, and each instalment received.
ALTER TABLE "partner_agreements" ADD COLUMN IF NOT EXISTS "installment_amount" integer;
--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD COLUMN IF NOT EXISTS "installment_day" integer;
--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD COLUMN IF NOT EXISTS "installment_start" date;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_installments" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_id" integer NOT NULL REFERENCES "partner_agreements"("id"),
	"pay_date" timestamp NOT NULL,
	"amount" integer NOT NULL,
	"method" text DEFAULT 'Cash' NOT NULL,
	"reference" text,
	"notes" text,
	"cash_transaction_id" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_installments_agreement_idx" ON "partner_installments" ("agreement_id");
