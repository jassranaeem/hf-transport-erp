-- A Daily Cash Book entry paid / received by cheque carries the cheque number (and the bank, when known), so the
-- same cheque entered twice can be spotted.
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "cheque_no" text;
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "cheque_bank" text;
CREATE INDEX IF NOT EXISTS "cash_tx_cheque_idx" ON "cash_transactions" ("cheque_no") WHERE "cheque_no" IS NOT NULL;
