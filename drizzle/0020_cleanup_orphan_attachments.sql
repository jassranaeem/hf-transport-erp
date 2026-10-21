UPDATE "attachments" SET "is_deleted" = true, "deleted_at" = now()
WHERE "is_deleted" = false AND (
  ("entity_type" = 'trip' AND "entity_id" IN (SELECT "id" FROM "trips" WHERE "is_deleted" = true))
  OR ("entity_type" = 'truck_ledger_entry' AND "entity_id" IN (SELECT "id" FROM "truck_ledger_entries" WHERE "is_deleted" = true))
  OR ("entity_type" = 'truck_ledger' AND "entity_id" IN (SELECT "id" FROM "truck_ledgers" WHERE "is_deleted" = true))
);
--> statement-breakpoint
DELETE FROM "attachment_blobs" WHERE "attachment_id" IN (SELECT "id" FROM "attachments" WHERE "is_deleted" = true);
