CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text,
	"size" integer,
	"disk_path" text NOT NULL,
	"caption" text,
	"category" text DEFAULT 'Receipt' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"legal_name" text,
	"trade_name" text DEFAULT 'HF Transport' NOT NULL,
	"tagline" text,
	"address_lines" text,
	"city" text,
	"country" text DEFAULT 'Pakistan',
	"phones" jsonb,
	"email" text,
	"website" text,
	"ntn" text,
	"strn" text,
	"logo_file_id" integer,
	"invoice_prefix" text DEFAULT 'INV' NOT NULL,
	"invoice_footer_note" text,
	"default_sales_tax_percent" numeric DEFAULT '13' NOT NULL,
	"default_wht_percent" numeric DEFAULT '0' NOT NULL,
	"bank_accounts_json" jsonb,
	"default_payment_terms" text DEFAULT 'Net 30' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"qty" numeric DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'trip',
	"rate" integer DEFAULT 0 NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "truck_ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"ledger_id" integer NOT NULL,
	"sr_no" integer,
	"entry_date" timestamp,
	"raw_date" text,
	"method" text,
	"party_from" text,
	"party_to" text,
	"description" text,
	"received" integer DEFAULT 0 NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"running_balance" integer DEFAULT 0 NOT NULL,
	"sheet_balance" integer,
	"category" text DEFAULT 'Other' NOT NULL,
	"direction" text,
	"section_label" text,
	"is_safi_bachat" boolean DEFAULT false NOT NULL,
	"is_reset" boolean DEFAULT false NOT NULL,
	"route_from" text,
	"route_to" text,
	"cargo" text,
	"source_row" integer,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_reason" text,
	"derived_trip_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "truck_ledgers" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer,
	"registration" text NOT NULL,
	"title" text NOT NULL,
	"owner_name" text,
	"is_partnership" boolean DEFAULT false NOT NULL,
	"partner_agreement_id" integer,
	"opening_balance" integer DEFAULT 0 NOT NULL,
	"closing_balance" integer DEFAULT 0 NOT NULL,
	"source_sheet" text,
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
ALTER TABLE "invoices" ALTER COLUMN "trip_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "seller_snapshot_json" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "bill_to_snapshot_json" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "vehicle_id" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "driver_id" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "container_no" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "bilty_number" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "route_from" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "route_to" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "border_crossing" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cargo_description" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cargo_weight_kg" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "rate_basis" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "advance_received" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "bank_account_ref" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sales_tax_percent" numeric DEFAULT '0';--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "wht_percent" numeric DEFAULT '0';--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "wht_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_ledger_entries" ADD CONSTRAINT "truck_ledger_entries_ledger_id_truck_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."truck_ledgers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_ledger_entries" ADD CONSTRAINT "truck_ledger_entries_derived_trip_id_trips_id_fk" FOREIGN KEY ("derived_trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_ledgers" ADD CONSTRAINT "truck_ledgers_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_ledgers" ADD CONSTRAINT "truck_ledgers_partner_agreement_id_partner_agreements_id_fk" FOREIGN KEY ("partner_agreement_id") REFERENCES "public"."partner_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "att_entity_idx" ON "attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "inv_line_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "tle_ledger_idx" ON "truck_ledger_entries" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "tle_category_idx" ON "truck_ledger_entries" USING btree ("category");--> statement-breakpoint
CREATE INDEX "truck_ledger_reg_idx" ON "truck_ledgers" USING btree ("registration");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;