-- company letterhead logo, stored inline as a data URL (small PNG/JPG/SVG)
ALTER TABLE "company_profile" ADD COLUMN IF NOT EXISTS "logo_data_url" text;
