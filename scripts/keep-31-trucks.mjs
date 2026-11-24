// Keeps only the trucks on the "M Turck Rate.pdf" list (31 rows, 30 different plates:
// TLH-539 appears twice) and soft-deletes every other truck (reversible - nothing is erased).
//
//   node scripts\keep-31-trucks.mjs                    dry run: shows what WOULD happen, changes nothing
//   node scripts\keep-31-trucks.mjs --apply            removes the extra trucks that have no ledger / trip data
//   node scripts\keep-31-trucks.mjs --apply --include-with-data   also removes extra trucks that DO have ledgers or trips
//   node scripts\keep-31-trucks.mjs --add-missing --apply         also adds listed trucks that are not in the system yet
//   node scripts\keep-31-trucks.mjs --restore removed-trucks-XXXX.json   brings a removed batch back
//
// Needs DATABASE_URL (cmd.exe:  set "DATABASE_URL=<your Neon connection string>").
import fs from "node:fs";
import pg from "pg";

const KEEP = [
  "TLM-916", "TLE-730", "TLX-746", "TLH-307", "TLF-233", "TB-165", "TLC-034", "TLD-918", "TLE-988", "TLJ-174",
  "TLH-951", "TLF-583", "LES-1384", "TLE-438", "TLH-539", "SPN-016", "TLH-569", "TLE-819", "TLG-704", "TLG-551",
  "TLF-653", "TLH-580", "TMC-792", "TMK-964", "TLH-626", "TLD-846", "TLG-610", "TLE-936", "TLD-700", "TAD-171",
];
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const keepSet = new Set(KEEP.map(norm));

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const WITH_DATA = args.includes("--include-with-data");
const ADD_MISSING = args.includes("--add-missing");
const restoreFile = args.includes("--restore") ? args[args.indexOf("--restore") + 1] : null;

const url = process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL first."); process.exit(1); }
if (/YAHAN|NEON_CONNECTION|your/i.test(url)) { console.error("DATABASE_URL still has the placeholder text - paste the real connection string."); process.exit(1); }
const ssl = /sslmode=require|neon\.tech/i.test(url) || process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
const pool = new pg.Pool({ connectionString: url.replace(/[?&]sslmode=[^&]*/i, ""), ssl });
const c = await pool.connect();
const rows = async (sql, p = []) => (await c.query(sql, p)).rows;

try {
  if (restoreFile) {
    const ids = JSON.parse(fs.readFileSync(restoreFile, "utf8")).ids;
    const r = await c.query(`update vehicles set is_deleted=false, deleted_at=null where id = any($1::int[])`, [ids]);
    console.log(`Restored ${r.rowCount} truck(s) from ${restoreFile}.`);
  } else {
    const all = await rows(`
      select v.id, v.vehicle_number,
        (select count(*) from truck_ledgers l where l.vehicle_id=v.id and not l.is_deleted)::int as ledgers,
        (select count(*) from truck_ledger_entries e join truck_ledgers l on l.id=e.ledger_id where l.vehicle_id=v.id and not e.is_deleted)::int as entries,
        (select count(*) from trips t where t.vehicle_id=v.id and not t.is_deleted)::int as trips,
        (select count(*) from tracker_devices d where d.vehicle_id=v.id and not d.is_deleted)::int as trackers
      from vehicles v where not v.is_deleted order by v.vehicle_number`);

    const keep = all.filter((v) => keepSet.has(norm(v.vehicle_number)));
    const extra = all.filter((v) => !keepSet.has(norm(v.vehicle_number)));
    const withData = extra.filter((v) => v.ledgers || v.entries || v.trips);
    const noData = extra.filter((v) => !(v.ledgers || v.entries || v.trips));
    const found = new Set(keep.map((v) => norm(v.vehicle_number)));
    const missing = KEEP.filter((k) => !found.has(norm(k)));

    console.log(`\nTrucks in the system now: ${all.length}`);
    console.log(`KEEP (on the list): ${keep.length} rows for ${new Set(keep.map((v) => norm(v.vehicle_number))).size} plates`);
    const dupKeep = keep.filter((v, i) => keep.findIndex((x) => norm(x.vehicle_number) === norm(v.vehicle_number)) !== i);
    if (dupKeep.length) console.log(`  note: the same plate exists more than once: ${dupKeep.map((v) => `${v.vehicle_number} (#${v.id})`).join(", ")}`);
    console.log(`\nEXTRA, no ledgers/trips (safe to remove): ${noData.length}`);
    for (const v of noData) console.log(`  #${v.id}  ${v.vehicle_number}${v.trackers ? "  [has GPS tracker]" : ""}`);
    console.log(`\nEXTRA, but they have ledgers or trips: ${withData.length}`);
    for (const v of withData) console.log(`  #${v.id}  ${v.vehicle_number}   ledgers ${v.ledgers}, entries ${v.entries}, trips ${v.trips}${v.trackers ? ", GPS tracker" : ""}`);
    console.log(`\nOn the PDF but NOT in the system: ${missing.length}${missing.length ? " -> " + missing.join(", ") : ""}`);

    if (!APPLY) {
      console.log("\nDRY RUN - nothing was changed. Re-run with --apply to remove the safe ones" + (withData.length ? " (add --include-with-data to remove the others too)" : "") + ".");
    } else {
      await c.query("BEGIN");
      const victims = WITH_DATA ? extra : noData;
      if (victims.length) {
        const file = `removed-trucks-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
        fs.writeFileSync(file, JSON.stringify({ removedAt: new Date().toISOString(), ids: victims.map((v) => v.id), trucks: victims.map((v) => v.vehicle_number) }, null, 2));
        await c.query(`update vehicles set is_deleted=true, deleted_at=now() where id = any($1::int[])`, [victims.map((v) => v.id)]);
        await c.query(`update drivers set assigned_vehicle_id=null where assigned_vehicle_id = any($1::int[])`, [victims.map((v) => v.id)]);
        console.log(`\nRemoved ${victims.length} truck(s). To undo: node scripts\\keep-31-trucks.mjs --restore ${file}`);
      } else console.log("\nNothing to remove.");
      if (!WITH_DATA && withData.length) console.log(`${withData.length} extra truck(s) with ledgers/trips were left alone (use --include-with-data to remove them).`);
      if (ADD_MISSING && missing.length) {
        for (const k of missing) {
          await c.query(`insert into vehicles (vehicle_number, registration_number, engine_number, chassis_number, vehicle_type, truck_brand, model, year, container_type, payload_capacity, current_odometer)
            values ($1,$1,'','','Truck','','',0,'',0,0)`, [k.replace("-", " ")]);
        }
        console.log(`Added ${missing.length} missing truck(s): ${missing.join(", ")}`);
      }
      await c.query("COMMIT");
      const left = await rows(`select count(*)::int n from vehicles where not is_deleted`);
      console.log(`Trucks now in the system: ${left[0].n}`);
    }
  }
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("\nNothing was changed:", e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
