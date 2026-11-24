-- How a Daily Cash Book entry was paid / received: Cash, Online, Bank Transfer or Other.
-- Every entry made until now was typed as cash, so they stay "Cash".
ALTER TABLE "cash_transactions" ADD COLUMN IF NOT EXISTS "method" text DEFAULT 'Cash' NOT NULL;
