# Data Import / Export

Replaces "run a raw SQL script to load old data" with a safe, validated,
file-based flow. Screen: **Governance & Settings → Data Import / Export**
(Super Admin / Admin / Operations Manager).

## Using it

1. Pick a table (Vehicles, Drivers, Routes, Trips, Fuel Transactions, …).
2. **Download template** — an `.xlsx` with:
   - a `Data` sheet: exact column headers, dropdowns for enum columns;
   - an `Instructions` sheet: which columns are required, allowed values,
     and how lookups work.
3. Fill it in (or paste your old data, matching the headers).
4. Choose a mode:
   - **Insert new only** — fails rows whose key already exists.
   - **Update existing** — matches on the ★ natural-key column(s) and overwrites.
5. **Validate** — a dry run. You get a per-row error list (row number + column +
   reason) and a preview. **Nothing is written yet.**
6. **Confirm import** — applies the batch. Audit-logged.

Export is the same screen: **Export .xlsx** / **Export .csv** dumps every
current row (foreign keys shown as their human key, e.g. `Vehicle Number`
instead of a numeric id).

## Foreign keys / lookups

Columns marked `lookup` take the **natural key of the referenced table**, not an
id. Example: on the Trips sheet, `Vehicle Number` = `LES-1234`,
`Driver CNIC` = `35202-1234567-1`, `Route (Origin | Destination)` =
`Karachi | Lahore`. The importer resolves these to ids; an unmatched value is a
row error, not a silent null.

## Dates

Accepts `YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, `DD/MM/YYYY`, native Excel date cells,
and ISO timestamps.

## Adding a new table

Everything domain-specific is in [`src/lib/dataio/registry.ts`](../src/lib/dataio/registry.ts).
Add one `EntitySpec`:

```ts
{
  key: "fuel_stations",
  label: "Fuel Stations",
  table: schema.fuelStations,
  softDelete: true,
  fields: [
    { column: "Name", field: "name", type: "string", required: true, naturalKey: true },
    { column: "City", field: "city", type: "string" },
    { column: "Vendor", field: "vendorId", type: "string", ref: { entity: "fuel_vendors" } },
    // ...
  ],
}
```

- `naturalKey: true` — the unique business key (composite keys: mark each part).
- `ref: { entity }` — foreign key; the cell carries the target's natural key.
- `type`: `string | int | number | decimal | boolean | date | datetime | json | enum`
- `enumValues` — renders an Excel dropdown and validates on import.

Templates, validation, export and upsert then work with no other changes.

## API reference

| method | path | purpose |
|--------|------|---------|
| `GET`  | `/api/data/entities` | list tables + column metadata |
| `GET`  | `/api/data/:entity/template` | blank `.xlsx` template |
| `GET`  | `/api/data/:entity/export?format=xlsx\|csv` | all rows |
| `POST` | `/api/data/:entity/validate?mode=insert\|upsert` | multipart `file=`, dry run |
| `POST` | `/api/data/commit` | `{ batchToken }` from validate ⇒ apply |

Batches from `validate` are held in memory for 30 minutes.
