-- quotations: bump the default rate-validity window from 3 to 10 days
ALTER TABLE "quotations" ALTER COLUMN "validity_days" SET DEFAULT 10;
