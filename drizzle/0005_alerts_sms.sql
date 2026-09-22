-- duplicate-receipt detection + SMS notifications + alert acknowledgements
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "sha256" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "att_sha256_idx" ON "attachments" ("sha256");
--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "sms_alerts" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "sms_alerts" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "to_phone" text NOT NULL,
  "body" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "provider" text,
  "provider_ref" text,
  "error" text,
  "related_type" text,
  "related_id" integer,
  "driver_id" integer,
  "party_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "sent_at" timestamp,
  "created_by" integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_log_related_idx" ON "sms_logs" ("related_type","related_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_log_status_idx" ON "sms_logs" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alert_acks" (
  "id" serial PRIMARY KEY NOT NULL,
  "alert_key" text NOT NULL,
  "alert_type" text NOT NULL,
  "status" text DEFAULT 'ack' NOT NULL,
  "note" text,
  "acted_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "alert_acks_alert_key_unique" UNIQUE("alert_key")
);
