-- truck_ledgers: plain editable driver fields — the source khata workbook
-- has no clean "driver" column, so this is filled in by hand, not extracted.
ALTER TABLE "truck_ledgers" ADD COLUMN IF NOT EXISTS "driver_name" text;
ALTER TABLE "truck_ledgers" ADD COLUMN IF NOT EXISTS "driver_phone" text;
