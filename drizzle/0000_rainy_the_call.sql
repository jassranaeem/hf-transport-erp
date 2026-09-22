CREATE TABLE "accounting_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year_id" integer NOT NULL,
	"name" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "accounts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"permissions_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_prefix_unique" UNIQUE("prefix")
);
--> statement-breakpoint
CREATE TABLE "api_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status_code" integer NOT NULL,
	"execution_time_ms" integer NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"date" timestamp DEFAULT now() NOT NULL,
	"clock_in" timestamp,
	"clock_out" timestamp,
	"latitude_in" text,
	"longitude_in" text,
	"latitude_out" text,
	"longitude_out" text,
	"status" text DEFAULT 'Present' NOT NULL,
	"early_leaving" boolean DEFAULT false NOT NULL,
	"late_arrival" boolean DEFAULT false NOT NULL,
	"break_time_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"night_shift" boolean DEFAULT false NOT NULL,
	"correction_requested" boolean DEFAULT false NOT NULL,
	"correction_notes" text,
	"corrections_approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"table_name" text,
	"record_id" integer,
	"old_values" jsonb,
	"new_values" jsonb,
	"performed_by" integer,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer,
	"status" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_name" text NOT NULL,
	"branch_name" text,
	"account_number" text NOT NULL,
	"iban" text NOT NULL,
	"currency" text DEFAULT 'PKR' NOT NULL,
	"opening_balance" integer DEFAULT 0 NOT NULL,
	"current_balance" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "bank_accounts_iban_unique" UNIQUE("iban")
);
--> statement-breakpoint
CREATE TABLE "battery_management" (
	"id" serial PRIMARY KEY NOT NULL,
	"battery_number" text NOT NULL,
	"brand" text,
	"serial_number" text,
	"voltage" numeric,
	"cca" integer,
	"installation_date" timestamp,
	"warranty_expiry" timestamp,
	"replacement_date" timestamp,
	"charging_history" jsonb,
	"health_percent" integer DEFAULT 100,
	"current_voltage" numeric,
	"status" text DEFAULT 'Active' NOT NULL,
	"vehicle_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "battery_management_battery_number_unique" UNIQUE("battery_number")
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_number" text NOT NULL,
	"vendor_type" text NOT NULL,
	"vendor_id" integer,
	"vendor_name" text NOT NULL,
	"bill_date" timestamp DEFAULT now() NOT NULL,
	"due_date" timestamp NOT NULL,
	"amount" integer NOT NULL,
	"paid_amount" integer DEFAULT 0 NOT NULL,
	"outstanding_balance" integer NOT NULL,
	"status" text DEFAULT 'Unpaid' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "bills_bill_number_unique" UNIQUE("bill_number")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text,
	"phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "breakdown_management" (
	"id" serial PRIMARY KEY NOT NULL,
	"breakdown_number" text NOT NULL,
	"vehicle_id" integer NOT NULL,
	"driver_id" integer,
	"trip_id" integer,
	"gps_location" text,
	"reason" text NOT NULL,
	"images" jsonb,
	"videos" jsonb,
	"mechanic_id" integer,
	"recovery_vehicle" text,
	"repair_cost" integer DEFAULT 0,
	"resolution_time_minutes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "breakdown_management_breakdown_number_unique" UNIQUE("breakdown_number")
);
--> statement-breakpoint
CREATE TABLE "cash_closings" (
	"id" serial PRIMARY KEY NOT NULL,
	"closing_date" timestamp DEFAULT now() NOT NULL,
	"opening_balance" integer DEFAULT 0 NOT NULL,
	"cash_in" integer DEFAULT 0 NOT NULL,
	"cash_out" integer DEFAULT 0 NOT NULL,
	"closing_balance" integer DEFAULT 0 NOT NULL,
	"declared_balance" integer DEFAULT 0 NOT NULL,
	"discrepancy" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"approved_by" integer,
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
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"message" text,
	"file_id" integer,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_room_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text,
	"type" text DEFAULT 'group' NOT NULL,
	"module" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" serial PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"contact_person" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"ntn" text NOT NULL,
	"strn" text,
	"address" text,
	"credit_limit" integer DEFAULT 0 NOT NULL,
	"outstanding_balance" integer DEFAULT 0 NOT NULL,
	"payment_terms" text DEFAULT 'Net 30' NOT NULL,
	"contract_start" timestamp,
	"contract_end" timestamp,
	"active_routes" jsonb,
	"notes" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "contractors_company_unique" UNIQUE("company"),
	CONSTRAINT "contractors_email_unique" UNIQUE("email"),
	CONSTRAINT "contractors_ntn_unique" UNIQUE("ntn"),
	CONSTRAINT "contractors_strn_unique" UNIQUE("strn")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"manager_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "designations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"grade" text DEFAULT 'Junior' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_performances" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"period" text NOT NULL,
	"fuel_efficiency" text DEFAULT '0.0' NOT NULL,
	"on_time_delivery_count" integer DEFAULT 0 NOT NULL,
	"total_deliveries" integer DEFAULT 0 NOT NULL,
	"overspeed_events" integer DEFAULT 0 NOT NULL,
	"accidents_count" integer DEFAULT 0 NOT NULL,
	"route_compliance_rate" text DEFAULT '100' NOT NULL,
	"customer_rating" text DEFAULT '5.0' NOT NULL,
	"monthly_ranking" integer,
	"annual_rating" text DEFAULT 'A' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_name" text NOT NULL,
	"photo_url" text,
	"cnic" text NOT NULL,
	"license_number" text NOT NULL,
	"license_expiry" timestamp NOT NULL,
	"mobile" text NOT NULL,
	"emergency_contact" text,
	"address" text,
	"blood_group" text,
	"joining_date" timestamp DEFAULT now() NOT NULL,
	"salary" integer NOT NULL,
	"allowance" integer DEFAULT 0 NOT NULL,
	"experience_years" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Available' NOT NULL,
	"assigned_vehicle_id" integer,
	"assigned_route_id" integer,
	"performance_rating" text DEFAULT '5.0',
	"violation_count" integer DEFAULT 0 NOT NULL,
	"medical_expiry" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "drivers_cnic_unique" UNIQUE("cnic"),
	CONSTRAINT "drivers_license_number_unique" UNIQUE("license_number")
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"doc_type" text NOT NULL,
	"doc_number" text,
	"expiry_date" timestamp,
	"file_url" text NOT NULL,
	"ocr_data" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_trainings" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"training_id" integer NOT NULL,
	"certificate_url" text,
	"expiry_date" timestamp,
	"completion_date" timestamp,
	"status" text DEFAULT 'Enrolled' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_code" text NOT NULL,
	"photo" text,
	"full_name" text NOT NULL,
	"father_name" text NOT NULL,
	"cnic" text NOT NULL,
	"passport" text,
	"nationality" text DEFAULT 'Pakistani' NOT NULL,
	"gender" text NOT NULL,
	"dob" timestamp NOT NULL,
	"marital_status" text DEFAULT 'Single' NOT NULL,
	"blood_group" text,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"province" text NOT NULL,
	"country" text DEFAULT 'Pakistan' NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"emergency_contact" text NOT NULL,
	"qualification" text NOT NULL,
	"experience" text,
	"department_id" integer,
	"designation_id" integer,
	"branch_id" integer,
	"joining_date" timestamp DEFAULT now() NOT NULL,
	"employment_type" text DEFAULT 'Full-time' NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"manager_id" integer,
	"basic_salary" integer DEFAULT 0 NOT NULL,
	"fuel_allowance" integer DEFAULT 0 NOT NULL,
	"other_allowances" integer DEFAULT 0 NOT NULL,
	"bank_name" text,
	"bank_account" text,
	"tax_number" text,
	"qr_code" text,
	"barcode" text,
	"documents_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "employees_employee_code_unique" UNIQUE("employee_code")
);
--> statement-breakpoint
CREATE TABLE "error_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"error_message" text NOT NULL,
	"stack_trace" text,
	"severity" text DEFAULT 'low' NOT NULL,
	"request_path" text,
	"request_method" text,
	"request_body" jsonb,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_number" text NOT NULL,
	"trip_id" integer,
	"vehicle_id" integer,
	"driver_id" integer,
	"contractor_id" integer,
	"department" text,
	"cost_center" text,
	"expense_type" text NOT NULL,
	"amount" integer NOT NULL,
	"expense_date" timestamp DEFAULT now() NOT NULL,
	"payment_method" text DEFAULT 'Cash' NOT NULL,
	"bank_account_id" integer,
	"receipt_url" text,
	"status" text DEFAULT 'Pending Approval' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "expenses_expense_number_unique" UNIQUE("expense_number")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mime_type" text,
	"size" integer,
	"path" text NOT NULL,
	"category" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_years" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_type" text NOT NULL,
	"vehicle_id" integer,
	"driver_id" integer,
	"trip_id" integer,
	"transaction_id" integer,
	"severity" text DEFAULT 'Medium' NOT NULL,
	"description" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"expected_fuel" numeric NOT NULL,
	"expected_cost" integer NOT NULL,
	"fuel_allowance" integer NOT NULL,
	"trip_budget" integer NOT NULL,
	"budget_variance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_number" text NOT NULL,
	"pin" text NOT NULL,
	"vehicle_id" integer,
	"driver_id" integer,
	"vendor_id" integer,
	"daily_limit" integer DEFAULT 0 NOT NULL,
	"monthly_limit" integer DEFAULT 0 NOT NULL,
	"current_balance" integer DEFAULT 0 NOT NULL,
	"expiry_date" timestamp,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "fuel_cards_card_number_unique" UNIQUE("card_number")
);
--> statement-breakpoint
CREATE TABLE "fuel_forecasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer,
	"next_refill_date" timestamp,
	"predicted_requirement_litres" numeric NOT NULL,
	"monthly_consumption_litres" numeric NOT NULL,
	"accuracy_score" numeric DEFAULT '1.0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_issue_slips" (
	"id" serial PRIMARY KEY NOT NULL,
	"slip_number" text NOT NULL,
	"vehicle_id" integer,
	"driver_id" integer,
	"trip_id" integer,
	"fuel_tank_id" integer,
	"issued_by" integer,
	"approved_by" integer,
	"litres" numeric NOT NULL,
	"issue_date" timestamp DEFAULT now() NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "fuel_issue_slips_slip_number_unique" UNIQUE("slip_number")
);
--> statement-breakpoint
CREATE TABLE "fuel_stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_name" text NOT NULL,
	"company" text NOT NULL,
	"branch_id" integer,
	"gps_location" text,
	"city" text NOT NULL,
	"province" text NOT NULL,
	"contact_person" text,
	"phone" text,
	"diesel" boolean DEFAULT true NOT NULL,
	"petrol" boolean DEFAULT false NOT NULL,
	"adblue" boolean DEFAULT false NOT NULL,
	"lng" boolean DEFAULT false NOT NULL,
	"cng" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_tanks" (
	"id" serial PRIMARY KEY NOT NULL,
	"tank_name" text NOT NULL,
	"capacity" integer NOT NULL,
	"opening_balance" integer DEFAULT 0 NOT NULL,
	"current_stock" integer DEFAULT 0 NOT NULL,
	"refill_history_json" jsonb,
	"tank_level_percent" integer DEFAULT 0 NOT NULL,
	"leak_status" text DEFAULT 'No Leak' NOT NULL,
	"calibration_json" jsonb,
	"branch_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_number" text NOT NULL,
	"vehicle_id" integer,
	"driver_id" integer,
	"trip_id" integer,
	"vendor_id" integer,
	"fuel_station_id" integer,
	"fuel_card_id" integer,
	"transaction_date" timestamp DEFAULT now() NOT NULL,
	"invoice_number" text,
	"litres" numeric NOT NULL,
	"rate" numeric NOT NULL,
	"subtotal" integer NOT NULL,
	"gst" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"odometer" integer NOT NULL,
	"remaining_fuel_percent" integer DEFAULT 0 NOT NULL,
	"payment_type" text NOT NULL,
	"bank_account_id" integer,
	"receipt_url" text,
	"geo_coordinates" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "fuel_transactions_transaction_number_unique" UNIQUE("transaction_number")
);
--> statement-breakpoint
CREATE TABLE "fuel_vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_name" text NOT NULL,
	"company" text NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"contracts_json" jsonb,
	"fuel_rates_json" jsonb,
	"discounts_json" jsonb,
	"credit_limit" integer DEFAULT 0 NOT NULL,
	"payment_terms" text DEFAULT 'Net 30' NOT NULL,
	"vendor_rating" numeric DEFAULT '5.0' NOT NULL,
	"outstanding_balance" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"trip_id" integer NOT NULL,
	"contractor_id" integer NOT NULL,
	"invoice_date" timestamp DEFAULT now() NOT NULL,
	"due_date" timestamp NOT NULL,
	"subtotal" integer NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"paid_amount" integer DEFAULT 0 NOT NULL,
	"outstanding_balance" integer NOT NULL,
	"status" text DEFAULT 'Unpaid' NOT NULL,
	"pdf_url" text,
	"payment_terms" text DEFAULT 'Net 30' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "job_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_card_number" text NOT NULL,
	"vehicle_id" integer NOT NULL,
	"mechanic_id" integer,
	"complaint" text NOT NULL,
	"diagnosis" text,
	"repair_notes" text,
	"labour_hours" numeric DEFAULT '0.0',
	"parts_used" jsonb,
	"status" text DEFAULT 'Open' NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"approval_status" text DEFAULT 'Pending' NOT NULL,
	"completion_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "job_cards_job_card_number_unique" UNIQUE("job_card_number")
);
--> statement-breakpoint
CREATE TABLE "job_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"queue_name" text NOT NULL,
	"job_id" text NOT NULL,
	"job_name" text NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer,
	"attempts" integer,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_number" text NOT NULL,
	"entry_date" timestamp DEFAULT now() NOT NULL,
	"description" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" integer,
	"fiscal_year_id" integer,
	"accounting_period_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "journal_entries_entry_number_unique" UNIQUE("entry_number")
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"journal_entry_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"description" text,
	"debit" integer DEFAULT 0 NOT NULL,
	"credit" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaves" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"approved_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"reminder_type" text NOT NULL,
	"due_date" timestamp,
	"due_km" integer,
	"status" text DEFAULT 'Pending' NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mechanics" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer,
	"mechanic_code" text NOT NULL,
	"specialization" text,
	"certification" text,
	"experience_years" integer,
	"availability" text DEFAULT 'Available' NOT NULL,
	"performance_rating" numeric DEFAULT '5.0',
	"current_jobs_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "mechanics_mechanic_code_unique" UNIQUE("mechanic_code")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"channel" text DEFAULT 'all' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_number" text NOT NULL,
	"contractor_id" integer,
	"bank_account_id" integer,
	"payment_date" timestamp DEFAULT now() NOT NULL,
	"payment_method" text NOT NULL,
	"amount" integer NOT NULL,
	"reference_number" text,
	"notes" text,
	"status" text DEFAULT 'Posted' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "payments_payment_number_unique" UNIQUE("payment_number")
);
--> statement-breakpoint
CREATE TABLE "payrolls" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"payroll_period" text NOT NULL,
	"basic_salary" integer DEFAULT 0 NOT NULL,
	"allowances" integer DEFAULT 0 NOT NULL,
	"fuel_allowance" integer DEFAULT 0 NOT NULL,
	"trip_allowance" integer DEFAULT 0 NOT NULL,
	"bonus" integer DEFAULT 0 NOT NULL,
	"commission" integer DEFAULT 0 NOT NULL,
	"overtime" integer DEFAULT 0 NOT NULL,
	"deductions" integer DEFAULT 0 NOT NULL,
	"loans" integer DEFAULT 0 NOT NULL,
	"tax" integer DEFAULT 0 NOT NULL,
	"eobi" integer DEFAULT 0 NOT NULL,
	"social_security" integer DEFAULT 0 NOT NULL,
	"net_salary" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"payment_date" timestamp,
	"bank_transfer_ref" text,
	"journal_entry_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictive_maintenance" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"predicted_failure_type" text NOT NULL,
	"remaining_useful_life_km" integer,
	"failure_probability_percent" integer,
	"recommended_action" text,
	"estimated_cost" integer DEFAULT 0,
	"run_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_applicants" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"cv_url" text,
	"status" text DEFAULT 'Applied' NOT NULL,
	"interview_date" timestamp,
	"interview_notes" text,
	"offer_letter_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"department_id" integer,
	"status" text DEFAULT 'Open' NOT NULL,
	"description" text,
	"requirements" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"resource" text NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"distance" integer NOT NULL,
	"expected_hours" integer NOT NULL,
	"benchmark_fuel" integer NOT NULL,
	"expected_toll" integer NOT NULL,
	"revenue" integer NOT NULL,
	"average_speed" integer DEFAULT 60 NOT NULL,
	"allowed_speed" integer DEFAULT 80 NOT NULL,
	"risk_level" text DEFAULT 'Low' NOT NULL,
	"geofence_origin" jsonb,
	"geofence_destination" jsonb,
	"map_polyline" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"format" text NOT NULL,
	"query_config_json" jsonb NOT NULL,
	"scheduled_cron" text,
	"email_recipients_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cron_expression" text NOT NULL,
	"job_type" text NOT NULL,
	"payload_json" jsonb,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"status" text DEFAULT 'Idle' NOT NULL,
	"execution_logs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_jobs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "security_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"description" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"service_type" text NOT NULL,
	"current_odometer" integer,
	"next_due_km" integer,
	"last_service_date" timestamp,
	"next_service_date" timestamp,
	"reminder_days" integer,
	"reminder_km" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'Regular' NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"weekend_rules" text DEFAULT 'Sunday Only' NOT NULL,
	"ramadan_timing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spare_parts_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" integer NOT NULL,
	"warehouse" text,
	"supplier" text,
	"batch_number" text,
	"vehicle_id" integer,
	"job_card_id" integer,
	"mechanic_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_performances" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"period" text NOT NULL,
	"attendance_rate" text DEFAULT '100' NOT NULL,
	"task_completion_rate" text DEFAULT '100' NOT NULL,
	"reviews_json" jsonb,
	"goals_json" jsonb,
	"rating" text DEFAULT 'Meets Expectations' NOT NULL,
	"monthly_ranking" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"department_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracker_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"imei" text NOT NULL,
	"label" text,
	"vehicle_id" integer,
	"provider" text DEFAULT 'generic' NOT NULL,
	"ingest_token" text NOT NULL,
	"sim_enabled" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_lat" numeric,
	"last_lng" numeric,
	"last_speed" integer DEFAULT 0 NOT NULL,
	"last_heading" integer DEFAULT 0 NOT NULL,
	"last_address" text,
	"battery_percent" integer,
	"status" text DEFAULT 'Unknown' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "tracker_devices_imei_unique" UNIQUE("imei")
);
--> statement-breakpoint
CREATE TABLE "trainings" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trainer" text NOT NULL,
	"session_date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_number" text NOT NULL,
	"vehicle_id" integer NOT NULL,
	"driver_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"contractor_id" integer NOT NULL,
	"departure_time" timestamp NOT NULL,
	"actual_departure_time" timestamp,
	"actual_arrival_time" timestamp,
	"revenue" integer NOT NULL,
	"distance" integer NOT NULL,
	"eta_hours" integer NOT NULL,
	"fuel_benchmark" integer NOT NULL,
	"expected_profit" integer NOT NULL,
	"expected_arrival" timestamp NOT NULL,
	"expected_fuel" integer NOT NULL,
	"status" text DEFAULT 'Scheduled' NOT NULL,
	"current_lat" text,
	"current_lng" text,
	"current_speed" integer DEFAULT 0 NOT NULL,
	"delay_hours" integer DEFAULT 0 NOT NULL,
	"current_address" text,
	"remaining_distance" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "trips_trip_number_unique" UNIQUE("trip_number")
);
--> statement-breakpoint
CREATE TABLE "tyre_management" (
	"id" serial PRIMARY KEY NOT NULL,
	"tyre_number" text NOT NULL,
	"tyre_brand" text,
	"tyre_size" text,
	"tyre_type" text,
	"serial_number" text,
	"purchase_date" timestamp,
	"purchase_cost" integer DEFAULT 0,
	"warranty_months" integer,
	"position" text,
	"current_tread_depth" numeric,
	"current_psi" numeric,
	"rotation_history" jsonb,
	"repair_history" jsonb,
	"retread_count" integer DEFAULT 0 NOT NULL,
	"expected_life_km" integer,
	"current_mileage" integer DEFAULT 0,
	"scrap_status" text DEFAULT 'Active' NOT NULL,
	"vehicle_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "tyre_management_tyre_number_unique" UNIQUE("tyre_number")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"auth_provider" text DEFAULT 'password' NOT NULL,
	"name" text,
	"role" text DEFAULT 'Pending' NOT NULL,
	"phone" text,
	"department" text,
	"status" text DEFAULT 'Pending Approval' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"last_login_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "users_uid_unique" UNIQUE("uid"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicle_maintenance" (
	"id" serial PRIMARY KEY NOT NULL,
	"maintenance_number" text NOT NULL,
	"vehicle_id" integer NOT NULL,
	"vehicle_registration" text,
	"odometer" integer,
	"current_km" integer,
	"maintenance_type" text NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"status" text DEFAULT 'Scheduled' NOT NULL,
	"workshop_id" integer,
	"mechanic_id" integer,
	"branch_id" integer,
	"scheduled_date" timestamp,
	"due_date" timestamp,
	"completion_date" timestamp,
	"estimated_cost" integer DEFAULT 0 NOT NULL,
	"actual_cost" integer DEFAULT 0 NOT NULL,
	"downtime_hours" numeric DEFAULT '0.0',
	"remarks" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "vehicle_maintenance_maintenance_number_unique" UNIQUE("maintenance_number")
);
--> statement-breakpoint
CREATE TABLE "vehicle_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" integer,
	"vehicle_id" integer,
	"trip_id" integer,
	"lat" numeric NOT NULL,
	"lng" numeric NOT NULL,
	"speed" integer DEFAULT 0 NOT NULL,
	"heading" integer DEFAULT 0 NOT NULL,
	"altitude" integer,
	"accuracy" integer,
	"satellites" integer,
	"ignition" boolean,
	"source" text DEFAULT 'live' NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_number" text NOT NULL,
	"registration_number" text NOT NULL,
	"engine_number" text NOT NULL,
	"chassis_number" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"truck_brand" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"container_type" text NOT NULL,
	"payload_capacity" integer NOT NULL,
	"fuel_type" text DEFAULT 'Diesel' NOT NULL,
	"current_odometer" integer NOT NULL,
	"gps_device_imei" text,
	"insurance_number" text,
	"insurance_expiry" timestamp,
	"fitness_certificate" text,
	"fitness_expiry" timestamp,
	"ownership_status" text DEFAULT 'Owned' NOT NULL,
	"purchase_date" timestamp,
	"purchase_cost" integer,
	"current_asset_value" integer,
	"depreciation_percent" integer,
	"current_branch_id" integer,
	"current_status" text DEFAULT 'Available' NOT NULL,
	"photo_url" text,
	"qr_code" text,
	"barcode" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "vehicles_vehicle_number_unique" UNIQUE("vehicle_number"),
	CONSTRAINT "vehicles_gps_device_imei_unique" UNIQUE("gps_device_imei")
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"webhook_id" integer,
	"event_name" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"response_status" integer,
	"response_body" text,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer,
	"target_type" text NOT NULL,
	"target_id" integer NOT NULL,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"history_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"steps_json" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "workshops" (
	"id" serial PRIMARY KEY NOT NULL,
	"workshop_name" text NOT NULL,
	"location" text,
	"branch_id" integer,
	"manager" text,
	"contact" text,
	"working_hours" text,
	"capacity" integer DEFAULT 5 NOT NULL,
	"available_bays" integer DEFAULT 5 NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"updated_by" integer,
	"deleted_by" integer,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battery_management" ADD CONSTRAINT "battery_management_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakdown_management" ADD CONSTRAINT "breakdown_management_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakdown_management" ADD CONSTRAINT "breakdown_management_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakdown_management" ADD CONSTRAINT "breakdown_management_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakdown_management" ADD CONSTRAINT "breakdown_management_mechanic_id_mechanics_id_fk" FOREIGN KEY ("mechanic_id") REFERENCES "public"."mechanics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_room_participants" ADD CONSTRAINT "chat_room_participants_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_room_participants" ADD CONSTRAINT "chat_room_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_performances" ADD CONSTRAINT "driver_performances_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_assigned_vehicle_id_vehicles_id_fk" FOREIGN KEY ("assigned_vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_assigned_route_id_routes_id_fk" FOREIGN KEY ("assigned_route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_trainings" ADD CONSTRAINT "employee_trainings_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_trainings" ADD CONSTRAINT "employee_trainings_training_id_trainings_id_fk" FOREIGN KEY ("training_id") REFERENCES "public"."trainings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_designation_id_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."designations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_alerts" ADD CONSTRAINT "fuel_alerts_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_alerts" ADD CONSTRAINT "fuel_alerts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_alerts" ADD CONSTRAINT "fuel_alerts_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_alerts" ADD CONSTRAINT "fuel_alerts_transaction_id_fuel_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."fuel_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_alerts" ADD CONSTRAINT "fuel_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_budgets" ADD CONSTRAINT "fuel_budgets_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_cards" ADD CONSTRAINT "fuel_cards_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_cards" ADD CONSTRAINT "fuel_cards_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_cards" ADD CONSTRAINT "fuel_cards_vendor_id_fuel_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."fuel_vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_issue_slips" ADD CONSTRAINT "fuel_issue_slips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_issue_slips" ADD CONSTRAINT "fuel_issue_slips_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_issue_slips" ADD CONSTRAINT "fuel_issue_slips_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_issue_slips" ADD CONSTRAINT "fuel_issue_slips_fuel_tank_id_fuel_tanks_id_fk" FOREIGN KEY ("fuel_tank_id") REFERENCES "public"."fuel_tanks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_issue_slips" ADD CONSTRAINT "fuel_issue_slips_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_issue_slips" ADD CONSTRAINT "fuel_issue_slips_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_stations" ADD CONSTRAINT "fuel_stations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_tanks" ADD CONSTRAINT "fuel_tanks_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_vendor_id_fuel_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."fuel_vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_fuel_station_id_fuel_stations_id_fk" FOREIGN KEY ("fuel_station_id") REFERENCES "public"."fuel_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_fuel_card_id_fuel_cards_id_fk" FOREIGN KEY ("fuel_card_id") REFERENCES "public"."fuel_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_mechanic_id_mechanics_id_fk" FOREIGN KEY ("mechanic_id") REFERENCES "public"."mechanics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_accounting_period_id_accounting_periods_id_fk" FOREIGN KEY ("accounting_period_id") REFERENCES "public"."accounting_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_reminders" ADD CONSTRAINT "maintenance_reminders_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mechanics" ADD CONSTRAINT "mechanics_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictive_maintenance" ADD CONSTRAINT "predictive_maintenance_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_applicants" ADD CONSTRAINT "recruitment_applicants_job_id_recruitment_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."recruitment_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_jobs" ADD CONSTRAINT "recruitment_jobs_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schedules" ADD CONSTRAINT "service_schedules_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_parts_usage" ADD CONSTRAINT "spare_parts_usage_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_parts_usage" ADD CONSTRAINT "spare_parts_usage_job_card_id_job_cards_id_fk" FOREIGN KEY ("job_card_id") REFERENCES "public"."job_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spare_parts_usage" ADD CONSTRAINT "spare_parts_usage_mechanic_id_mechanics_id_fk" FOREIGN KEY ("mechanic_id") REFERENCES "public"."mechanics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_performances" ADD CONSTRAINT "staff_performances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_devices" ADD CONSTRAINT "tracker_devices_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tyre_management" ADD CONSTRAINT "tyre_management_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_maintenance" ADD CONSTRAINT "vehicle_maintenance_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_maintenance" ADD CONSTRAINT "vehicle_maintenance_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_maintenance" ADD CONSTRAINT "vehicle_maintenance_mechanic_id_mechanics_id_fk" FOREIGN KEY ("mechanic_id") REFERENCES "public"."mechanics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_maintenance" ADD CONSTRAINT "vehicle_maintenance_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_positions" ADD CONSTRAINT "vehicle_positions_device_id_tracker_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."tracker_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_positions" ADD CONSTRAINT "vehicle_positions_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_positions" ADD CONSTRAINT "vehicle_positions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_current_branch_id_branches_id_fk" FOREIGN KEY ("current_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_approvals" ADD CONSTRAINT "workflow_approvals_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_log_path_idx" ON "api_logs" USING btree ("path");--> statement-breakpoint
CREATE INDEX "audit_performed_by_idx" ON "audit_logs" USING btree ("performed_by");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_table_name_idx" ON "audit_logs" USING btree ("table_name");--> statement-breakpoint
CREATE INDEX "chat_msg_room_id_idx" ON "chat_messages" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "chat_room_user_idx" ON "chat_room_participants" USING btree ("room_id","user_id");--> statement-breakpoint
CREATE INDEX "contractor_company_idx" ON "contractors" USING btree ("company");--> statement-breakpoint
CREATE INDEX "contractor_ntn_idx" ON "contractors" USING btree ("ntn");--> statement-breakpoint
CREATE INDEX "driver_cnic_idx" ON "drivers" USING btree ("cnic");--> statement-breakpoint
CREATE INDEX "driver_license_idx" ON "drivers" USING btree ("license_number");--> statement-breakpoint
CREATE INDEX "notif_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notif_is_read_idx" ON "notifications" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "route_origin_dest_idx" ON "routes" USING btree ("origin","destination");--> statement-breakpoint
CREATE INDEX "tracker_imei_idx" ON "tracker_devices" USING btree ("imei");--> statement-breakpoint
CREATE INDEX "tracker_vehicle_idx" ON "tracker_devices" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "trip_number_idx" ON "trips" USING btree ("trip_number");--> statement-breakpoint
CREATE INDEX "trip_status_idx" ON "trips" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vp_vehicle_time_idx" ON "vehicle_positions" USING btree ("vehicle_id","recorded_at");--> statement-breakpoint
CREATE INDEX "vp_device_time_idx" ON "vehicle_positions" USING btree ("device_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vp_device_recorded_uniq" ON "vehicle_positions" USING btree ("device_id","recorded_at");--> statement-breakpoint
CREATE INDEX "vehicle_number_idx" ON "vehicles" USING btree ("vehicle_number");--> statement-breakpoint
CREATE INDEX "vehicle_gps_imei_idx" ON "vehicles" USING btree ("gps_device_imei");