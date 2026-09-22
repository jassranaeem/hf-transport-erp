-- editable invoice "terms & conditions" block on the company profile
ALTER TABLE "company_profile" ADD COLUMN IF NOT EXISTS "invoice_terms" text;
