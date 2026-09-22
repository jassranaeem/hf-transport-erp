-- Link truck-khata entries to auto-created Expense / Vehicle Maintenance
-- records so a re-import updates them instead of duplicating.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "source_entry_id" integer REFERENCES "truck_ledger_entries"("id");
ALTER TABLE "vehicle_maintenance" ADD COLUMN IF NOT EXISTS "source_entry_id" integer REFERENCES "truck_ledger_entries"("id");
CREATE INDEX IF NOT EXISTS "expenses_source_entry_idx" ON "expenses" ("source_entry_id");
CREATE INDEX IF NOT EXISTS "vehicle_maintenance_source_entry_idx" ON "vehicle_maintenance" ("source_entry_id");
