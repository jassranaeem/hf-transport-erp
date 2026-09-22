# HF Transport ERP — demo data seed

- Generated: 2026-09-08T17:19:41.780Z
- Target: http://localhost:5173
- Steps: **164 ok**, **3 failed**

## Records created this run

| Entity | Created |
|---|---|
| vehicles | 6 |
| routes | 8 |
| drivers | 6 |
| contractors | 5 |
| trips | 6 |
| fuelVendors | 3 |
| fuelStations | 5 |
| fuelCards | 4 |
| fuelTransactions | 10 |
| workshops | 3 |
| mechanics | 5 |
| maintenance | 4 |
| tyres | 6 |
| jobCards | 4 |
| banks | 0 |
| bills | 5 |
| expenses | 8 |
| departments | 5 |
| designations | 5 |
| shifts | 3 |
| employees | 8 |
| attendance | 15 |
| trackerDevices | 4 |

## Totals now in the database (via API)

| Module list | Rows |
|---|---|
| vehicles | 7 |
| drivers | 7 |
| routes | 9 |
| contractors | 6 |
| trips | 7 |
| fuelTransactions | 10 |
| fuelVendors | 6 |
| fuelStations | 5 |
| maintenance | 4 |
| workshops | 3 |
| tyres | 6 |
| invoices | 2 |
| banks | 3 |
| expenses | 8 |
| accounts | 16 |
| employees | 8 |
| liveTracking | ? |

## Failed steps

- bank Habib Bank Ltd: POST /api/finance/banks -> 500 Failed query: insert into "bank_accounts" ("id", "bank_name", "branch_name", "account_number", "iban", "currency", "opening_balance", "current_balance", "status", "created_at", "updated_at", "deleted_at", "created_by", "updated_by", "deleted_by", "is_deleted") values (default, $1, $2, $3, $4, default, $5, $6, $7, default, default, default, $8, default, default, default) returning "id", "bank_name", "branch_name", "account_number", "iban", "currency", "opening_balance", "current_balance", "status", "created_at", "updated_at", "deleted_at", "created_by", "updated_by", "deleted_by", "is_deleted"
params: Habib Bank Ltd,Main Boulevard Gulberg,1000-09081719,PK36HABB0000001234567800,5000000,5000000,Active,1
- bank Meezan Bank: POST /api/finance/banks -> 500 Failed query: insert into "bank_accounts" ("id", "bank_name", "branch_name", "account_number", "iban", "currency", "opening_balance", "current_balance", "status", "created_at", "updated_at", "deleted_at", "created_by", "updated_by", "deleted_by", "is_deleted") values (default, $1, $2, $3, $4, default, $5, $6, $7, default, default, default, $8, default, default, default) returning "id", "bank_name", "branch_name", "account_number", "iban", "currency", "opening_balance", "current_balance", "status", "created_at", "updated_at", "deleted_at", "created_by", "updated_by", "deleted_by", "is_deleted"
params: Meezan Bank,I.I. Chundrigar Road,1001-09081719,PK24MEZN0000009876543201,7500000,7500000,Active,1
- bank Bank Alfalah: POST /api/finance/banks -> 500 Failed query: insert into "bank_accounts" ("id", "bank_name", "branch_name", "account_number", "iban", "currency", "opening_balance", "current_balance", "status", "created_at", "updated_at", "deleted_at", "created_by", "updated_by", "deleted_by", "is_deleted") values (default, $1, $2, $3, $4, default, $5, $6, $7, default, default, default, $8, default, default, default) returning "id", "bank_name", "branch_name", "account_number", "iban", "currency", "opening_balance", "current_balance", "status", "created_at", "updated_at", "deleted_at", "created_by", "updated_by", "deleted_by", "is_deleted"
params: Bank Alfalah,Blue Area,1002-09081719,PK11ALFH0000005555444402,10000000,10000000,Active,1

## Notes

- 2 trips were driven to **Completed** — each auto-generated a customer **invoice**.
- 10 fuel transactions each posted a **balanced journal entry** (GL accounts auto-created).
- 2 maintenance jobs were **Completed** — each booked a maintenance expense entry.
- Tracker device #1 is intentionally left "dark" (~22 min) so the **signal-loss estimate** shows on the live map.
- Full structured dump: `demo-data-export.json`.