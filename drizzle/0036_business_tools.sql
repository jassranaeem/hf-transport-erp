-- Business tools (the Zoho-style round): credit notes, recurring entries, approvals, comments,
-- stock + purchase orders, currency rates, custom fields, reminders, depreciation.
-- Every table is new; existing tables only gain invoices.credited_amount and parties.email.

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "credited_amount" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "email" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"note_number" text NOT NULL,
	"invoice_id" integer NOT NULL REFERENCES "invoices"("id"),
	"contractor_id" integer,
	"note_date" timestamp NOT NULL,
	"amount" integer NOT NULL,
	"kind" text DEFAULT 'Shortage' NOT NULL,
	"reason" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_notes_number_idx" ON "credit_notes" ("note_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_invoice_idx" ON "credit_notes" ("invoice_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"target" text NOT NULL,
	"template" jsonb NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"day_of_month" integer,
	"next_date" date NOT NULL,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"runs" integer DEFAULT 0 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" integer,
	"decided_by" integer,
	"decided_at" timestamp,
	"decision_note" text,
	"result_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_status_idx" ON "approval_requests" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "record_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"body" text NOT NULL,
	"mentions" integer[] DEFAULT '{}' NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_comments_entity_idx" ON "record_comments" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"category" text,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"last_cost" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_items_code_idx" ON "stock_items" (lower("code"));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_moves" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL REFERENCES "stock_items"("id"),
	"move_date" timestamp DEFAULT now() NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"vehicle_id" integer,
	"po_id" integer,
	"notes" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_moves_item_idx" ON "stock_moves" ("item_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_number" text NOT NULL,
	"vendor_name" text NOT NULL,
	"party_id" integer,
	"order_date" timestamp NOT NULL,
	"expected_date" timestamp,
	"status" text DEFAULT 'Open' NOT NULL,
	"lines" jsonb DEFAULT '[]' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"bill_id" integer,
	"notes" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_number_idx" ON "purchase_orders" ("po_number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "currency_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"rate_date" date NOT NULL,
	"rate" numeric(14, 4) NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "currency_rates_code_date_idx" ON "currency_rates" ("code", "rate_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"options" jsonb DEFAULT '[]' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_fields_entity_key_idx" ON "custom_fields" ("entity", "key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_field_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"record_id" integer NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_values_idx" ON "custom_field_values" ("entity", "record_id", "key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminder_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"party_id" integer,
	"invoice_id" integer,
	"channel" text NOT NULL,
	"to_address" text,
	"body" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"error" text,
	"auto" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminder_log_party_idx" ON "reminder_log" ("party_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_depreciation" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"method" text DEFAULT 'reducing' NOT NULL,
	"rate_percent" numeric(6, 2),
	"useful_life_years" integer,
	"salvage_value" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"cost" integer,
	"notes" text,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_depreciation_vehicle_idx" ON "asset_depreciation" ("vehicle_id");
