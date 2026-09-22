/**
 * Second recognizer for real HFK Excel files that AREN'T shaped like the
 * standard per-truck khata (SR# | DATE | DESCRIPTION | RECEIVED | PAID |
 * BALANCE, one sheet = one vehicle's running account). The client also
 * produces sheets shaped as a per-TRIP LOG: one row per trip, many
 * vehicles mixed together in one sheet, no running balance column at all.
 * Two real variants of that shape exist in production data:
 *
 *  - a plain LOADING LOG: Sr# | Date | [Company] | From | To | Truck No —
 *    no money at all, just "this truck left with this cargo on this date".
 *  - a FREIGHT / PROFIT sheet: Sr# | Date | Vehicle | [Driver] | From | To |
 *    Party | an invoice/rate amount | ... | Profit/Share — real freight
 *    revenue per trip, per vehicle.
 *
 * Both get turned into the SAME `ParsedLedger[]` shape parseTruckWorkbook
 * produces (one synthetic ledger per vehicle actually seen, GROUPING that
 * sheet's rows by its Truck/Vehicle column), so the result can be handed
 * straight to the already-tested `importParsedWorkbook()` — same vehicle
 * matching, same non-destructive re-import reconciliation, same Expense/
 * Maintenance sync, same collision-safe sourceSheet. No new write path.
 */
import ExcelJS from "exceljs";
import { repairXlsxBuffer } from "./xlsx-repair.ts";
import { cellText, toAmount, parseDate, normRoute, looksLikeHeader } from "./truck-workbook.ts";
import { mapCashbookColumns } from "./cashbook-workbook.ts";
import type { ParsedLedger, ParsedEntry, WorkbookReport, ParseResult, LedgerCategory } from "./truck-workbook.ts";

// A vehicle registration cell in these sheets is usually the WHOLE cell
// value (e.g. "TLB-100", "TLB 100", "C 1827"), not embedded in a longer
// title string — so this only needs to recognise the cell, not search
// within a sentence the way truck-workbook.ts's REG_RE does for titles.
const PLATE_RE = /^[A-Z]{1,4}[\s-]?\d{2,4}$/i;
function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

interface ColMap {
  sr?: number;
  date?: number;
  vehicle?: number;
  driver?: number;
  from?: number;
  to?: number;
  party?: number; // company / party / destination-ish label column
  amount?: number; // first invoice/rate/freight/amount-looking column
  cost?: number; // an "actual" cost/rate column, if a distinct one exists
  ref?: number; // bill/load reference
}

function normHeader(c: string): string {
  return c.toUpperCase().replace(/[^A-Z]/g, "");
}

function mapLogColumns(cells: string[]): ColMap {
  const idx: ColMap = {};
  cells.forEach((raw, i) => {
    const u = normHeader(raw);
    if (!u) return;
    if (u.startsWith("SR") || u === "SNO") idx.sr ??= i;
    else if (u === "DATE" || u.includes("LOADINGDATE")) idx.date ??= i;
    // "TURCK"/"TRACK" are real recurring typos for "TRUCK" in the client's own files
    // (e.g. "Turck No" in Daliy Loading.xlsx, Bank Kharcha.xlsx, Daliy work.xlsx).
    else if (u.includes("TRUCK") || u.includes("TURCK") || u.includes("TRACK") || u.includes("VEHICLE")) idx.vehicle ??= i;
    else if (u.includes("DRIVER")) idx.driver ??= i;
    else if (u === "FROM" || u === "FORM") idx.from ??= i;
    else if (u === "TO" || u.includes("DESTINATION") || u.includes("LOCATION")) idx.to ??= i;
    else if (u.includes("COMPANY") || u.includes("PARTY")) idx.party ??= i;
    else if (u.includes("BILL") || u.includes("LOAD")) idx.ref ??= i;
    else if (u.includes("INVOICE") || u.includes("FACTORYRATE") || u.includes("FREIGHT") && !u.includes("ACTUAL")) idx.amount ??= i;
    else if (u.includes("VEHICLERATE") || (u.includes("ACTUAL") && u.includes("FREIGHT"))) idx.cost ??= i;
  });
  return idx;
}

function looksLikeLogHeader(cells: string[]): ColMap | null {
  const map = mapLogColumns(cells);
  const hasRowId = map.sr != null || map.date != null;
  const hasVehicle = map.vehicle != null;
  // A From+To pair is common but NOT universal in the real files: some sheets
  // only record a single "Location" (Stain Out.xlsx), some only a destination
  // with an implied Quetta origin (Zubair Enterprises Ledger.xlsx), and some
  // record neither, just cargo/"Load" (loacd tickter.xlsx). Requiring a route
  // silently dropped all of those real per-trip logs, so a Truck/Vehicle
  // column plus a row identifier (SR# or Date) is the real distinguishing
  // signal for this shape — a route is recorded when the sheet has one.
  if (!hasRowId || !hasVehicle) return null;
  return map;
}

export async function parseFreightLogWorkbook(buffer: Buffer, sourceLabel?: string): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await repairXlsxBuffer(buffer)) as unknown as ArrayBuffer);

  const skipped: string[] = [];
  const skippedReasons: Array<{ sheet: string; reason: string }> = [];
  // vehicle registration -> its accumulated entries, per sheet (kept
  // per-sheet so two different sheets never merge into one synthetic ledger)
  const perVehicle = new Map<string, { sheetName: string; registration: string; entries: ParsedEntry[] }>();

  for (const ws of wb.worksheets) {
    const sheetName = ws.name.trim();
    if (ws.actualRowCount <= 2) {
      skipped.push(sheetName);
      skippedReasons.push({ sheet: sheetName, reason: `Only ${ws.actualRowCount} row(s) — nothing to read` });
      continue;
    }
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => rows.push((row.values as unknown[]).slice(1).map(cellText)));

    // Mutual exclusivity with the primary khata parser: a real running-balance
    // khata sheet (SR#/DATE | DESCRIPTION | ... | BALANCE) sometimes ALSO has
    // a column whose header happens to contain "Truck"/"Vehicle" (e.g. a
    // reference column), which used to make this looser trip-log matcher
    // claim the very same sheet the khata parser already handles correctly —
    // importing it through BOTH routes double-counts every rupee in it. If
    // truck-workbook.ts's own header check recognises this sheet, leave it
    // to that parser entirely (success or its own honest "skipped" reason).
    if (rows.some((r) => looksLikeHeader(r))) {
      skipped.push(sheetName);
      skippedReasons.push({ sheet: sheetName, reason: "Looks like a running-balance khata sheet — left to the primary khata parser to avoid double-counting." });
      continue;
    }
    // Same reasoning against the dual cash-book recognizer: it needs a more
    // specific structural signal (a credit-amount column AND a later debit-
    // amount column) than this trip-log matcher does, so when both would
    // claim a sheet, the cash-book reading is the more likely correct one —
    // this loosest matcher yields to it rather than double-counting.
    if (rows.some((r) => mapCashbookColumns(r))) {
      skipped.push(sheetName);
      skippedReasons.push({ sheet: sheetName, reason: "Looks like a dual income|expense cash-book sheet — left to that parser to avoid double-counting." });
      continue;
    }

    const headerIdx = rows.findIndex((r) => looksLikeLogHeader(r));
    if (headerIdx === -1) {
      skipped.push(sheetName);
      skippedReasons.push({
        sheet: sheetName,
        reason:
          'No trip-log header found (needs a Truck/Vehicle column, a From AND To column, and either "SR#" or "Date") — ' +
          "this recognizer is for per-trip logs (one row per trip, many vehicles per sheet), not the running-balance khata shape.",
      });
      continue;
    }
    const cols = mapLogColumns(rows[headerIdx]);
    let anyRow = false;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (looksLikeLogHeader(r)) continue; // a repeated header mid-sheet
      const nonEmpty = r.filter((c) => c && c.trim()).length;
      if (nonEmpty === 0) continue;

      const g = (k: keyof ColMap) => (cols[k] != null ? (r[cols[k]!] ?? "").trim() : "");
      const vehicleRaw = g("vehicle");
      if (!vehicleRaw) continue; // no vehicle on this row — nothing to attribute it to
      const registration = normalizePlate(vehicleRaw);
      const looksVehicle = PLATE_RE.test(vehicleRaw.trim());
      if (!looksVehicle) continue; // this column had a non-plate value on this row — skip rather than guess

      anyRow = true;
      const dateRaw = g("date");
      const entryDate = parseDate(dateRaw);
      const from = normRoute(g("from"));
      const to = normRoute(g("to"));
      const partyOrCompany = g("party");
      const ref = g("ref");
      const amt = cols.amount != null ? toAmount(r[cols.amount]).value : 0;
      const costAmt = cols.cost != null ? toAmount(r[cols.cost]).value : 0;

      const descParts = [
        partyOrCompany,
        [from, to].filter(Boolean).join(" → "),
        ref ? `Ref ${ref}` : "",
        g("driver") ? `Driver ${g("driver")}` : "",
      ].filter(Boolean);
      const description = descParts.join(" • ") || "Trip log entry";

      const key = `${sheetName}::${registration}`;
      if (!perVehicle.has(key)) perVehicle.set(key, { sheetName, registration, entries: [] });
      const bucket = perVehicle.get(key)!;
      const category: LedgerCategory = amt > 0 ? "Freight" : "Other";

      bucket.entries.push({
        srNo: null,
        entryDate,
        rawDate: dateRaw,
        method: null,
        partyFrom: from,
        partyTo: to,
        description,
        received: amt,
        paid: costAmt,
        runningBalance: 0, // filled in below, in row order, once the whole bucket is known
        sheetBalance: null,
        category,
        direction: amt > 0 ? "In" : null,
        sectionLabel: sheetName,
        isSafiBachat: false,
        isReset: false,
        routeFrom: from,
        routeTo: to,
        cargo: null,
        sourceRow: i + 1,
        needsReview: false,
        reviewReason: null,
      });
    }

    if (!anyRow) {
      skipped.push(sheetName);
      skippedReasons.push({ sheet: sheetName, reason: "Trip-log header recognised, but no row had a real vehicle-plate value under it" });
    }
  }

  const ledgers: ParsedLedger[] = [];
  for (const { sheetName, registration, entries } of perVehicle.values()) {
    let running = 0;
    for (const e of entries) {
      running += e.received - e.paid;
      e.runningBalance = running;
    }
    ledgers.push({
      sourceSheet: sourceLabel ? `${sourceLabel} :: ${sheetName} :: ${registration}` : `${sheetName} :: ${registration}`,
      registration,
      ownerName: null,
      title: `${registration} (trip log from "${sheetName}")`,
      isPartnership: false,
      partnership: null,
      openingBalance: 0,
      closingBalance: running,
      sheetClosing: null,
      entries,
      looksLikeVehicle: true, // every ledger here was only created because its row's vehicle cell matched PLATE_RE
    });
  }

  const report: WorkbookReport = {
    generatedAt: new Date().toISOString(),
    ledgers: ledgers.map((l) => ({
      sheet: l.sourceSheet,
      registration: l.registration,
      owner: null,
      isPartnership: false,
      rowsTotal: l.entries.length,
      rowsImported: l.entries.length,
      rowsNeedReview: 0,
      computedClosing: l.closingBalance,
      sheetClosing: null,
      closingMatches: true,
      partnership: null,
    })),
    totals: {
      ledgers: ledgers.length,
      entries: ledgers.reduce((s, l) => s + l.entries.length, 0),
      needReview: 0,
      freightRows: ledgers.reduce((s, l) => s + l.entries.filter((e) => e.category === "Freight").length, 0),
    },
    skippedSheets: skipped,
    skippedReasons,
  };

  return { ledgers, report };
}
