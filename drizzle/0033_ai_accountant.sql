CREATE TABLE IF NOT EXISTS "ai_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch" text NOT NULL,
	"source" text NOT NULL,
	"source_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"target" text,
	"entry_date" text,
	"direction" text,
	"amount" bigint DEFAULT 0 NOT NULL,
	"method" text,
	"vehicle_id" integer,
	"trip_id" integer,
	"party_id" integer,
	"kind" text,
	"category" text,
	"person" text,
	"description" text,
	"source_text" text,
	"confidence" text,
	"notes" jsonb,
	"duplicate" jsonb,
	"posted" jsonb,
	"error" text,
	"read_by" text,
	"created_by" integer,
	"decided_by" integer,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_drafts_status_idx" ON "ai_drafts" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_drafts_batch_idx" ON "ai_drafts" USING btree ("batch");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_reclass" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"from_category" text,
	"proposed" text NOT NULL,
	"confidence" text NOT NULL,
	"reason" text,
	"by_ai" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_reclass_pending_idx" ON "ai_reclass" USING btree ("entry_id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_reclass_status_idx" ON "ai_reclass" USING btree ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"feature" text NOT NULL,
	"provider" text,
	"model" text,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"input_chars" integer,
	"output_chars" integer,
	"ms" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"title" text,
	"data" jsonb,
	"narrative" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
