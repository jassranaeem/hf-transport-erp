-- quotations ("qaraya nama") — rate quote with a validity window, no ledger/GL impact
CREATE TABLE IF NOT EXISTS "quotations" (
  "id" serial PRIMARY KEY NOT NULL,
  "quotation_number" text NOT NULL UNIQUE,
  "quotation_date" timestamp DEFAULT now() NOT NULL,
  "validity_days" integer DEFAULT 3 NOT NULL,
  "valid_until" timestamp NOT NULL,
  "status" text DEFAULT 'Draft' NOT NULL,
  "contractor_id" integer,
  "client_company" text NOT NULL,
  "client_contact_person" text,
  "client_phone" text,
  "client_email" text,
  "client_address" text,
  "route_from" text,
  "route_to" text,
  "cargo_description" text,
  "cargo_weight_kg" integer,
  "vehicle_type" text,
  "rate_basis" text,
  "lines_json" jsonb NOT NULL,
  "subtotal" integer DEFAULT 0 NOT NULL,
  "total_amount" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "seller_snapshot_json" jsonb,
  "converted_invoice_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp,
  "created_by" integer,
  "updated_by" integer,
  "deleted_by" integer,
  "is_deleted" boolean DEFAULT false NOT NULL,
  CONSTRAINT "quotations_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id"),
  CONSTRAINT "quotations_converted_invoice_id_invoices_id_fk" FOREIGN KEY ("converted_invoice_id") REFERENCES "invoices"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_number_idx" ON "quotations" ("quotation_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_valid_until_idx" ON "quotations" ("valid_until");
