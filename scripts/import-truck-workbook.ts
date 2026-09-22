/**
 * CLI: bulk-import the customer's legacy per-truck Excel workbook into the ERP.
 * (The same import also runs from the app: Truck Ledgers -> "Import from Excel".)
 *
 *   npx tsx scripts/import-truck-workbook.ts "C:/Users/HP/Downloads/PERSONL TRUCK.xlsx"
 *
 * Re-runnable: clears the previous import first, matches vehicles by number.
 */
import "../src/config/env.ts";
import fs from "node:fs";
import { db, pool } from "../src/db/index.ts";
import { parseTruckWorkbook, sourceLabelFromFilename } from "../src/lib/dataio/truck-workbook.ts";
import { importParsedWorkbook } from "../src/lib/dataio/truck-workbook-import.ts";

const file = process.argv[2] || "C:/Users/HP/Downloads/PERSONL TRUCK.xlsx";
if (!fs.existsSync(file)) {
  console.error(`file not found: ${file}`);
  process.exit(1);
}

async function main() {
  const buf = fs.readFileSync(file);
  console.log(`parsing ${file} (${(buf.length / 1024).toFixed(0)} KB) ...`);
  const { ledgers, report } = await parseTruckWorkbook(buf, sourceLabelFromFilename(file.split(/[/\\]/).pop()));
  console.log(
    `parsed ${report.totals.ledgers} ledgers, ${report.totals.entries} entries ` +
      `(${report.totals.needReview} need review, ${report.totals.freightRows} freight rows). ` +
      `skipped ${report.skippedSheets.length} sheets.`
  );

  const r = await importParsedWorkbook(ledgers, report);
  fs.writeFileSync("truck-import-report.json", JSON.stringify({ ...report, failedSheets: r.failedSheets }, null, 2));

  console.log("\n---------------------------------------------");
  console.log(`vehicles: ${r.vehiclesCreated} created, ${r.vehiclesLinked} matched existing`);
  console.log(`partners: ${r.partnersCreated} created; partnership agreements: ${r.partnershipAgreements}`);
  console.log(`ledgers: ${r.ledgersInserted} inserted, ${r.ledgersUpdated} updated`);
  console.log(`entries: ${r.entriesInserted} inserted, ${r.entriesUpdated} updated, ${r.entriesRemoved} removed`);
  console.log(`expenses filed: ${r.expensesCreated} new, ${r.expensesUpdated} updated`);
  console.log(`maintenance filed: ${r.maintenanceCreated} new, ${r.maintenanceUpdated} updated`);
  console.log(`closing-balance reconciliation: ${r.reconciliation.matched}/${r.reconciliation.total} match`);
  const bad = report.ledgers.filter((l) => !l.closingMatches);
  for (const b of bad.slice(0, 20)) {
    console.log(`   ${b.sheet.padEnd(24)} computed ${b.computedClosing}  sheet ${b.sheetClosing}`);
  }
  if (r.failedSheets.length) {
    console.log(`\nFAILED sheets (${r.failedSheets.length}) — rest imported fine:`);
    for (const f of r.failedSheets) console.log(`   ${f.sheet}: ${f.error}`);
  }
  console.log("wrote truck-import-report.json");
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("FATAL:", e);
    await pool.end().catch(() => {});
    process.exit(1);
  });
