// One-off: enter the 25 Sep 2026 Quetta -> Hyderabad trip of truck TLD 918 with
// its diesel purchase and the two receipts. Safe to re-run (it stops if the trip
// already exists). Usage (cmd.exe):
//   set "DATABASE_URL=<your Neon connection string>"
//   node scripts\enter-tld918-trip.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL first."); process.exit(1); }
const ssl = /sslmode=require|neon\.tech/i.test(url) || process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
const pool = new pg.Pool({ connectionString: url.replace(/[?&]sslmode=[^&]*/i, ""), ssl });

const RECEIPT_DIR = process.env.RECEIPT_DIR || "D:\\erp\\tld918-receipts";
const RECEIPTS = [
  { file: "hbl-raast-receipt.jpg", caption: "HBL Raast transfer PKR 361,420 — Zubair Enterprises to SHER *5315, 25 Sep 2026 12:45:43 PM, Txn 1035572510" },
  { file: "pso-slip-1486.jpg", caption: "Pak Rohani Petroleum Service & Autoz slip 1486 — TLD 918, 1063 L x 340 = 361,420, 25-9-26" },
];

const PLATE = "TLD918";
const DEPARTURE = new Date("2026-09-25T12:45:43+05:00");
const LITRES = 1063, RATE = 340, AMOUNT = 361420;
const DRIVER = { name: "Bhagwan", phone: "0315 0807709" };
const ROUTE = { from: "Quetta", to: "Hyderabad" };
const CUSTOMER = "Customer to be confirmed";
const REF = "Slip 1486 / Txn 1035572510";
const PUMP = "Pak Rohani Petroleum Service & Autoz";

const c = await pool.connect();
const one = async (sql, p = []) => (await c.query(sql, p)).rows[0];
try {
  await c.query("BEGIN");
  const blobs = await one("select to_regclass('attachment_blobs') as t");
  if (!blobs.t) throw new Error("attachment_blobs table is missing — wait for the Render deploy to finish, then run again.");

  let veh = await one(`select * from vehicles where is_deleted=false and regexp_replace(upper(vehicle_number),'[^A-Z0-9]','','g')=$1`, [PLATE]);
  if (!veh) {
    veh = await one(`insert into vehicles (vehicle_number, registration_number, engine_number, chassis_number, vehicle_type, truck_brand, model, year, container_type, payload_capacity, current_odometer)
      values ('TLD 918','TLD 918','','','Truck','','',0,'',0,0) returning *`);
    console.log("created truck TLD 918");
  }

  const digits = DRIVER.phone.replace(/\D/g, "");
  let drv = await one(`select * from drivers where is_deleted=false and regexp_replace(mobile,'[^0-9]','','g')=$1`, [digits]);
  if (!drv) {
    const tag = crypto.randomBytes(4).toString("hex").toUpperCase();
    drv = await one(`insert into drivers (driver_name, cnic, license_number, license_expiry, mobile, salary) values ($1,$2,$3,$4,$5,0) returning *`,
      [DRIVER.name, `PENDING-${tag}`, `PENDING-${tag}`, new Date(0), DRIVER.phone]);
    console.log("created driver Bhagwan");
  }

  let route = await one(`select * from routes where is_deleted=false and lower(trim(origin))=lower($1) and lower(trim(destination))=lower($2)`, [ROUTE.from, ROUTE.to]);
  if (!route) {
    route = await one(`insert into routes (origin, destination, distance, expected_hours, benchmark_fuel, expected_toll, revenue) values ($1,$2,0,0,0,0,0) returning *`, [ROUTE.from, ROUTE.to]);
    console.log("created route Quetta -> Hyderabad");
  }

  let con = await one(`select * from contractors where is_deleted=false and lower(trim(company))=lower($1)`, [CUSTOMER]);
  if (!con) con = await one(`insert into contractors (company) values ($1) returning *`, [CUSTOMER]);

  const dup = await one(`select id from trips where is_deleted=false and vehicle_id=$1 and route_id=$2 and departure_time::date = $3::date`, [veh.id, route.id, DEPARTURE]);
  if (dup) throw new Error(`This trip already exists (trip id ${dup.id}). Nothing was changed.`);

  const tripNumber = `TRIP-${Date.now().toString().slice(-6)}${crypto.randomBytes(1).toString("hex").toUpperCase()}`;
  const trip = await one(`insert into trips (trip_number, vehicle_id, driver_id, route_id, contractor_id, departure_time, actual_departure_time, revenue, distance, eta_hours, fuel_benchmark, expected_profit, expected_arrival, expected_fuel, status, current_address, remaining_distance)
    values ($1,$2,$3,$4,$5,$6,$6,0,0,0,0,0,$6,0,'In Transit',$7,0) returning *`, [tripNumber, veh.id, drv.id, route.id, con.id, DEPARTURE, ROUTE.from]);
  await c.query(`update vehicles set current_status='Active' where id=$1`, [veh.id]);
  await c.query(`update drivers set status='On Trip', assigned_vehicle_id=$2 where id=$1`, [drv.id, veh.id]);

  // GPS: make sure TLD 918's tracker is tied to this truck so the live map shows the trip
  const linked = await one(`select * from tracker_devices where vehicle_id=$1 limit 1`, [veh.id]);
  if (linked) console.log(`GPS tracker already linked to TLD 918 (${linked.label || linked.imei}) - the trip will show on the live map.`);
  else {
    const cand = await one(`select * from tracker_devices where vehicle_id is null and regexp_replace(upper(coalesce(label,'')),'[^A-Z0-9]','','g') like $1 limit 1`, [`%${PLATE}%`]);
    if (cand) { await c.query(`update tracker_devices set vehicle_id=$2 where id=$1`, [cand.id, veh.id]); console.log(`Linked GPS tracker ${cand.label || cand.imei} to TLD 918.`); }
    else console.log("! No GPS tracker is linked to TLD 918 - link it under Fleet > GPS Tracking > Tracker Devices.");
  }

  let led = await one(`select * from truck_ledgers where is_deleted=false and source_sheet is null and regexp_replace(upper(registration),'[^A-Z0-9]','','g')=$1 order by id limit 1`, [PLATE]);
  if (!led) led = await one(`insert into truck_ledgers (vehicle_id, registration, title, driver_name, driver_phone) values ($1,'TLD 918','TLD 918',$2,$3) returning *`, [veh.id, DRIVER.name, DRIVER.phone]);
  else if (!led.vehicle_id) await c.query(`update truck_ledgers set vehicle_id=$2 where id=$1`, [led.id, veh.id]);

  await c.query(`insert into truck_ledger_entries (ledger_id, entry_date, raw_date, method, description, received, paid, category, direction, section_label, route_from, route_to, derived_trip_id)
    values ($1,$2,'2026-09-25','Online',$3,0,$4,'Diesel','Out','Manual',$5,$6,$7)`,
    [led.id, DEPARTURE, `Diesel ${LITRES} L · ${PUMP} · ${REF} · bank transfer`, AMOUNT, ROUTE.from, ROUTE.to, trip.id]);
  // running balance + closing balance for the ledger (same rule the app uses: received - paid, per section)
  const sums = await one(`select coalesce(sum(received - paid),0)::bigint as bal from truck_ledger_entries where ledger_id=$1 and is_deleted=false and coalesce(section_label,'')='Manual'`, [led.id]);
  await c.query(`update truck_ledger_entries set running_balance = sub.rb from (
      select id, sum(received - paid) over (order by coalesce(sr_no,0), id) as rb from truck_ledger_entries where ledger_id=$1 and is_deleted=false and coalesce(section_label,'')='Manual') sub
    where truck_ledger_entries.id = sub.id`, [led.id]);
  await c.query(`update truck_ledgers set closing_balance=$2, updated_at=now() where id=$1`, [led.id, Number(sums.bal)]);

  await c.query(`insert into fuel_transactions (transaction_number, vehicle_id, driver_id, trip_id, transaction_date, invoice_number, litres, rate, subtotal, gst, total, odometer, payment_type)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$9,0,'Bank')`, [`FT-${tripNumber}`, veh.id, drv.id, trip.id, DEPARTURE, "1486", String(LITRES), String(RATE), AMOUNT]);

  for (const r of RECEIPTS) {
    const p = path.join(RECEIPT_DIR, r.file);
    if (!fs.existsSync(p)) { console.warn(`! receipt file not found, skipped: ${p}`); continue; }
    const buf = fs.readFileSync(p);
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const att = await one(`insert into attachments (entity_type, entity_id, file_name, mime_type, size, disk_path, sha256, caption, category) values ('trip',$1,$2,'image/jpeg',$3,$4,$5,$6,'Receipt') returning id`,
      [trip.id, r.file, buf.length, `db/${r.file}`, sha, r.caption]);
    await c.query(`insert into attachment_blobs (attachment_id, data) values ($1,$2)`, [att.id, buf]);
    console.log(`attached ${r.file}`);
  }

  await c.query("COMMIT");
  console.log(`\nDone. Trip ${tripNumber} (TLD 918, Bhagwan, Quetta -> Hyderabad) with diesel PKR ${AMOUNT.toLocaleString()} entered.`);
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("\nNothing was saved:", e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
