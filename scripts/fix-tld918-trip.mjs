// Repairs the TLD 918 trip entered through the portal:
//  1. makes sure the trip belongs to the same truck row the GPS tracker is linked to
//  2. moves the trip's cash / diesel ledger entries into TLD 918's own manual ledger
//     (the one Truck Search lists), and restores the ledger they were wrongly added to.
// Safe to re-run. Usage (cmd.exe):
//   set "DATABASE_URL=<your Neon connection string>"
//   node scripts\fix-tld918-trip.mjs            (or: node scripts\fix-tld918-trip.mjs TRIP-889210F5)
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL first."); process.exit(1); }
const ssl = /sslmode=require|neon\.tech/i.test(url) || process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
const pool = new pg.Pool({ connectionString: url.replace(/[?&]sslmode=[^&]*/i, ""), ssl });
const PLATE = "TLD918";
const TRIP_NO = process.argv[2] || "TRIP-889210F5";

const c = await pool.connect();
const rows = async (sql, p = []) => (await c.query(sql, p)).rows;
const one = async (sql, p = []) => (await rows(sql, p))[0];

// same rule the app uses for running / closing balance
async function recompute(ledgerId) {
  const list = await rows(`select * from truck_ledger_entries where ledger_id=$1 and is_deleted=false order by section_label asc, sr_no asc, id asc`, [ledgerId]);
  let running = 0, section = "", lastReal = 0;
  for (const r of list) {
    if ((r.section_label || "") !== section) { section = r.section_label || ""; running = 0; }
    running += (r.received || 0) - (r.paid || 0);
    if (r.is_reset) running = 0;
    if (r.received || r.paid) lastReal = running;
    if (r.running_balance !== running) await c.query(`update truck_ledger_entries set running_balance=$1 where id=$2`, [running, r.id]);
  }
  await c.query(`update truck_ledgers set closing_balance=$1, updated_at=now() where id=$2`, [lastReal, ledgerId]);
  return lastReal;
}

try {
  await c.query("BEGIN");
  const trip = await one(`select * from trips where trip_number=$1 and is_deleted=false`, [TRIP_NO]);
  if (!trip) throw new Error(`Trip ${TRIP_NO} not found.`);

  const vehicles = await rows(`select id, vehicle_number from vehicles where is_deleted=false and regexp_replace(upper(vehicle_number),'[^A-Z0-9]','','g')=$1 order by id`, [PLATE]);
  console.log("Trucks named TLD 918:", vehicles.map((v) => `#${v.id} "${v.vehicle_number}"`).join(", ") || "(none)");
  const tracker = await one(`select * from tracker_devices where vehicle_id = any($1::int[]) limit 1`, [vehicles.map((v) => v.id)]);
  const canonical = tracker ? tracker.vehicle_id : trip.vehicle_id;
  console.log(tracker ? `GPS tracker "${tracker.label || tracker.imei}" is linked to truck #${canonical}.` : `No GPS tracker linked to those trucks - using the trip's own truck #${canonical}.`);
  if (trip.vehicle_id !== canonical) {
    await c.query(`update trips set vehicle_id=$1 where id=$2`, [canonical, trip.id]);
    console.log(`Trip moved from truck #${trip.vehicle_id} to truck #${canonical} so it shows on the GPS map.`);
  }
  const veh = await one(`select * from vehicles where id=$1`, [canonical]);

  let target = await one(`select * from truck_ledgers where is_deleted=false and source_sheet is null and vehicle_id=$1 order by id limit 1`, [canonical]);
  if (!target) {
    target = await one(`insert into truck_ledgers (vehicle_id, registration, title) values ($1,$2,$2) returning *`, [canonical, veh.vehicle_number]);
    console.log(`Created TLD 918's own ledger #${target.id}.`);
  }

  const entries = await rows(`select id, ledger_id, paid, received, description from truck_ledger_entries where derived_trip_id=$1 and is_deleted=false`, [trip.id]);
  const moving = entries.filter((e) => e.ledger_id !== target.id);
  const touched = new Set([target.id]);
  for (const e of moving) {
    const from = await one(`select id, source_sheet, vehicle_id from truck_ledgers where id=$1`, [e.ledger_id]);
    console.log(`Moving entry #${e.id} (PKR ${(e.paid || e.received).toLocaleString()}) out of ledger #${from.id} "${from.source_sheet || "manual"}" into ledger #${target.id}.`);
    await c.query(`update truck_ledger_entries set ledger_id=$1, section_label='Manual', updated_at=now() where id=$2`, [target.id, e.id]);
    touched.add(from.id);
  }
  for (const id of touched) console.log(`Ledger #${id} closing balance is now ${(await recompute(id)).toLocaleString()}`);
  console.log(`\nDone. ${entries.length} entr${entries.length === 1 ? "y" : "ies"} for ${TRIP_NO} now sit in ledger #${target.id}; ${moving.length} moved.`);
  await c.query("COMMIT");
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("\nNothing was changed:", e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
