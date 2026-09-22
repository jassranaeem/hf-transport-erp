CREATE TABLE "partner_agreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_number" text NOT NULL,
	"partner_id" integer NOT NULL,
	"vehicle_id" integer NOT NULL,
	"agreed_price" integer NOT NULL,
	"advance_paid" integer DEFAULT 0 NOT NULL,
	"opening_balance" integer NOT NULL,
	"current_balance" integer NOT NULL,
	"company_share_percent" integer DEFAULT 100 NOT NULL,
	"expense_ratio_benchmark" integer DEFAULT 55 NOT NULL,
	"start_date" timestamp DEFAULT now() NOT NULL,
	"close_date" timestamp,
	"status" text DEFAULT 'Active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "partner_agreements_agreement_number_unique" UNIQUE("agreement_number")
);
--> statement-breakpoint
CREATE TABLE "partner_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_number" text NOT NULL,
	"agreement_id" integer NOT NULL,
	"trip_id" integer,
	"period_from" timestamp,
	"period_to" timestamp,
	"gross_revenue" integer NOT NULL,
	"declared_expenses" jsonb,
	"total_expenses" integer DEFAULT 0 NOT NULL,
	"net_earnings" integer NOT NULL,
	"amount_to_company" integer NOT NULL,
	"partner_retained" integer DEFAULT 0 NOT NULL,
	"balance_before" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"gps_expected_revenue" integer,
	"fuel_implied_revenue" integer,
	"revenue_variance_percent" integer,
	"expense_ratio_percent" integer,
	"flags" jsonb,
	"status" text DEFAULT 'Confirmed' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "partner_settlements_settlement_number_unique" UNIQUE("settlement_number")
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cnic" text,
	"phone" text,
	"email" text,
	"address" text,
	"status" text DEFAULT 'Active' NOT NULL,
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
ALTER TABLE "partner_agreements" ADD CONSTRAINT "partner_agreements_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD CONSTRAINT "partner_agreements_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_agreement_id_partner_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."partner_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settlements" ADD CONSTRAINT "partner_settlements_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;