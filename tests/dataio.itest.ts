/**
 * Integration test for the import/export engine - needs a running Postgres
 * (config from .env.local). Run: npm run test:itest
 * TRUNCATEs branches/routes/vehicles/drivers/contractors/trips - dev DB only.
 */
import "../src/config/env.ts";
import { getEntity } from "../src/lib/dataio/registry.ts";
import { parseAndValidate, commitBatch, fetchAllForExport, buildExportWorkbook } from "../src/lib/dataio/engine.ts";
import { db } from "../src/db/index.ts";
import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";

let fail = 0;
const chk = (n: string, c: boolean, x?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${n}`); if (!c) { fail++; if (x !== undefined) console.log("     →", x); } };

function csv(headers: string[], rows: string[][]): Buffer {
  return Buffer.from([headers.join(","), ...rows.map(r => r.map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(","))].join("\n"), "utf8");
}

async function run() {
  const uid = 1;
  await db.execute(sql`TRUNCATE trips, vehicles, drivers, contractors, routes, branches RESTART IDENTITY CASCADE`);

  console.log("\n[branches] insert / conflict / upsert");
  {
    const H = ["Name", "Code", "Address", "Phone"];
    const buf = csv(H, [
      ["Lahore HQ", "LHR", "Ferozepur Rd", "042-111"],
      ["Karachi Depot", "KHI", "Korangi", "021-222"],
      ["Multan Yard", "MUL", "Bosan Rd", "061-333"],
    ]);
    const v1 = await parseAndValidate("branches", buf, "b.csv", "insert");
    chk("3 rows valid, 0 errors", v1.summary.valid === 3 && v1.errors.length === 0, v1.summary);
    chk("all toInsert", v1.summary.toInsert === 3 && v1.summary.toUpdate === 0);
    const c1 = await commitBatch(v1.batchToken, uid);
    chk("inserted 3", c1.inserted === 3 && c1.errors.length === 0, c1);

    const v2 = await parseAndValidate("branches", buf, "b.csv", "insert");
    chk("re-insert flags 3 conflicts", v2.errors.length === 3, v2.errors);

    const buf2 = csv(H, [["Lahore Head Office", "LHR", "New Address", "042-999"]]);
    const v3 = await parseAndValidate("branches", buf2, "b.csv", "upsert");
    chk("upsert sees 1 existing", v3.summary.toUpdate === 1 && v3.summary.toInsert === 0, v3.summary);
    const c3 = await commitBatch(v3.batchToken, uid);
    chk("updated 1", c3.updated === 1, c3);

    const rows = await fetchAllForExport(getEntity("branches")!);
    const lhr = rows.find((r: any) => r.code === "LHR");
    chk("update applied (name changed)", lhr?.name === "Lahore Head Office", lhr?.name);
    chk("export returns 3 rows", rows.length === 3);
  }

  console.log("\n[routes] composite natural key (origin|destination)");
  {
    const H = ["Origin", "Destination", "Distance (km)", "Expected Hours", "Benchmark Fuel (L)", "Expected Toll", "Revenue", "Risk Level"];
    const buf = csv(H, [
      ["Karachi", "Lahore", "1200", "22", "380", "6500", "240000", "Medium"],
      ["Karachi", "Islamabad", "1400", "26", "440", "7200", "280000", "High"],
      ["Karachi", "Lahore", "1200", "22", "380", "6500", "240000", "Low"],   // dup in file
    ]);
    const v = await parseAndValidate("routes", buf, "r.csv", "insert");
    chk("dup row in file detected", v.errors.some(e => /Duplicate/.test(e.message)), v.errors);
    chk("2 unique valid", v.summary.valid === 2, v.summary);
    const c = await commitBatch(v.batchToken, uid);
    chk("inserted 2 routes", c.inserted === 2, c);

    const bad = csv(H, [["Karachi", "Lahore", "x", "22", "380", "6500", "240000", "Nope"]]);
    const vb = await parseAndValidate("routes", bad, "r.csv", "upsert");
    chk("bad number + bad enum reported", vb.errors.filter(e => e.column === "Distance (km)" || e.column === "Risk Level").length === 2, vb.errors);
  }

  console.log("\n[vehicles + drivers + trips] FK resolution by natural key");
  {
    await commitBatch((await parseAndValidate("vehicles",
      csv(["Vehicle Number", "Registration Number", "Engine Number", "Chassis Number", "Vehicle Type", "Truck Brand", "Model", "Year", "Container Type", "Payload Capacity (kg)", "Current Odometer"],
        [["LES-1234", "R-1", "E-1", "C-1", "Flatbed", "Hino", "500", "2021", "40ft", "25000", "150000"]]),
      "v.csv", "insert")).batchToken, uid);

    await commitBatch((await parseAndValidate("drivers",
      csv(["Driver Name", "CNIC", "License Number", "License Expiry", "Mobile", "Salary"],
        [["Asif Khan", "35202-1111111-1", "LIC-1", "2027-05-01", "+923001234567", "80000"]]),
      "d.csv", "insert")).batchToken, uid);

    await commitBatch((await parseAndValidate("contractors",
      csv(["Company", "Contact Person", "Phone", "Email", "NTN"],
        [["ABC Logistics", "Sara", "0300", "sara@abc.com", "NTN-1"]]),
      "c.csv", "insert")).batchToken, uid);

    const tripH = ["Trip Number", "Vehicle Number", "Driver CNIC", "Route (Origin | Destination)", "Contractor Company", "Departure Time", "Revenue", "Distance", "ETA Hours", "Fuel Benchmark", "Expected Profit", "Expected Arrival", "Expected Fuel"];
    const good = csv(tripH, [["TRIP-1", "LES-1234", "35202-1111111-1", "Karachi | Lahore", "ABC Logistics", "2026-02-01 08:00", "240000", "1200", "22", "380", "60000", "2026-02-02 06:00", "400"]]);
    const vg = await parseAndValidate("trips", good, "t.csv", "insert");
    chk("trip FK refs all resolve", vg.errors.length === 0 && vg.summary.valid === 1, vg.errors);
    const cg = await commitBatch(vg.batchToken, uid);
    chk("trip inserted", cg.inserted === 1, cg);

    const bad = csv(tripH, [["TRIP-2", "NOPE-9999", "35202-1111111-1", "Karachi | Peshawar", "ABC Logistics", "2026-02-01 08:00", "1", "1", "1", "1", "1", "2026-02-02 06:00", "1"]]);
    const vb = await parseAndValidate("trips", bad, "t.csv", "insert");
    chk("unknown vehicle + unknown route reported", vb.errors.length === 2, vb.errors);

    // export trips -> vehicle id shown as vehicleNumber
    const wb = await buildExportWorkbook(getEntity("trips")!, await fetchAllForExport(getEntity("trips")!));
    const ws = wb.worksheets[0];
    const hdr: string[] = []; ws.getRow(1).eachCell(c => hdr.push(String(c.value)));
    const vi = hdr.indexOf("Vehicle Number");
    chk("export shows Vehicle Number column", vi >= 0);
    chk("export resolved FK id -> 'LES-1234'", ws.getRow(2).getCell(vi + 1).value === "LES-1234", ws.getRow(2).getCell(vi + 1).value);
  }

  console.log(fail === 0 ? "\nALL PASSED" : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(e => { console.error(e); process.exit(1); });
