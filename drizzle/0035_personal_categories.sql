CREATE TABLE IF NOT EXISTS "personal_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ur" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "personal_categories_name_idx" ON "personal_categories" USING btree (lower("name"));
