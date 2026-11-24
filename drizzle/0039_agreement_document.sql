-- The lease-to-own agreement as a signed document: its extra details (father's name, witnesses,
-- guarantor, place, terms) and who authorised it for the company.
ALTER TABLE "partner_agreements" ADD COLUMN IF NOT EXISTS "doc" jsonb DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD COLUMN IF NOT EXISTS "authorized_by_name" text;
--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD COLUMN IF NOT EXISTS "authorized_by_title" text;
--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD COLUMN IF NOT EXISTS "authorized_at" timestamp;
--> statement-breakpoint
ALTER TABLE "partner_agreements" ADD COLUMN IF NOT EXISTS "authorized_by_user" integer;
