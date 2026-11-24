-- A Daily Cash Book voucher: several In / Out lines saved together from one form share a key,
-- so the day's list can show them as one group.
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "voucher_key" text;
