-- The lease partner and the truck ledger: a cash payment is also a row of the truck's khata
-- (its id kept here so taking the payment back removes the row), and a trip's qist knows how much
-- was taken for home (شخصی برداشت) — that money did not pay for the truck.
ALTER TABLE "partner_installments" ADD COLUMN IF NOT EXISTS "khata_entry_id" integer;--> statement-breakpoint
ALTER TABLE "partner_settlements" ADD COLUMN IF NOT EXISTS "taken_for_home" integer DEFAULT 0 NOT NULL;
