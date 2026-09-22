import { assertCoreEnv } from "./config/env.ts";
assertCoreEnv();
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(`
  select tle.id, tle.ledger_id, tl.registration, tl.source_sheet, tle.entry_date, tle.raw_date, tle.description, tle.received, tle.paid, tle.method, tle.party_to
  from truck_ledger_entries tle join truck_ledgers tl on tl.id = tle.ledger_id
  where tle.description ilike '%uzbak%' and tle.is_deleted = false
`);
console.log(JSON.stringify(rows, null, 2));
await pool.end();
