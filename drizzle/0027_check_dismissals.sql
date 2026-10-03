CREATE TABLE IF NOT EXISTS "check_dismissals" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"item_key" text NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "check_dismissals_code_key_idx" ON "check_dismissals" USING btree ("code","item_key");
