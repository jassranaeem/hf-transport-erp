/**
 * Third recognizer for real HFK Excel files: the daily "dual cash book"
 * shape used in files like "Daliy work.xlsx". One row holds TWO independent
 * transactions side by side — an income/credit entry on the left half
 * (Date | Truck | Jama/source | Description | Credit) and an expense/debit
 * entry on the right half (Date | Truck | Banam/payee | Description |
 * Debit) — usually for two DIFFERENT trucks. Treating a row as one entry
 * (as the trip-log recognizer would) silently drops half the real
 * transactions, so this reads each side independently and emits up to two
 * ParsedEntry rows per source row, grouped per vehicle exactly like
 * freight-log-workbook.ts, then hands off to the same, already-tested
 * `importParsedWorkbook()` write path.
 *
 * Headers in the real files are inconsistent English typos ("Turck",
 * "Cerdit", "Descrtiption") mixed with Urdu labels the client typed for
 * herself (تفصیل آمدن / تفصیل خرچ) — normHeader() strips everything but
 * A-Z, so the Urdu-only cells simply produce "" and are ignored, while the
 * English (mis-spelled) ones still match.
 */
import ExcelJS from "exceljs";
import { repairXlsxBuffer } from "./xlsx-repair.ts";
import { cellText, toAmount, parseDate, detectDateOrder, looksLikeHeader } from "./truck-workbook.ts";
import type { ParsedLedger, ParsedEntry, WorkbookReport, ParseResult, LedgerCategory } from "./truck-workbook.ts";

const PLATE_RE = /^[A-Z]{1,4}[\s-]?\d{2,4}$/i;
function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

function normHeader(c: string): string {
  return c.toUpperCase().replace(/[^A-Z]/g, "");
}

interface Side {
  date?: number;
  vehicle?: number;
  desc?: number;
  party?: number; // "Jama" (income source) or "Banam" (expense payee)
  amount?: number;
}

export function mapCashbookColumns(cells: string[]): { left: Side; right: Side } | null {
  let creditIdx: number | undefined;
  let debitIdx: number | undefined;
  cells.forEach((raw, i) => {
    const u = normHeader(raw);
    if (!u) return;
    if (creditIdx == null && (u.includes("CERDIT") || u.includes("CREDIT"))) creditIdx = i;
    else if (u.includes("DEBIT")) debitIdx = i;
  });
  // Require both an income-amount and an expense-amount column, expense after income —
  // this is the real structural signature of the dual cash-book shape (and is exactly
  // what distinguishes it from every other recognizer: khata sheets have one Balance
  // column, trip logs have neither Credit nor Debit column names at all).
  if (creditIdx == null || debitIdx == null || debitIdx <= creditIdx) return null;

  const left: Side = { amount: creditIdx };
  const right: Side = { amount: debitIdx };
  cells.forEach((raw, i) => {
    const u = normHeader(raw);
    if (!u) return;
    const side = i <= creditIdx! ? left : right;
    if (u === "DATE") side.date ??= i;
    else if (u.includes("TRUCK") || u.includes("TURCK") || u.includes("TRACK")) side.vehicle ??= i;
    else if (u.includes("DESCR")) side.desc ??= i;
    else if (u.includes("JAMA") || u.includes("BANAM") || u.includes("PARTY") || u.includes("OWNER")) side.party ??= i;
  });
  if (left.vehicle == null && right.vehicle == null) return null; // no vehicle column at all — not this shape
  return { left, right };
}

export async function parseCashbookWorkbook(buffer: Buffer, sourceLabel?: string): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await repairXlsxBuffer(buffer)) as unknown as ArrayBuffer);

  const skipped: string[] = [];
  const skippedReasons: Array<{ sheet: string; reason: string }> = [];
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

    // Mutual exclusivity with the primary khata parser — see the identical
    // guard in freight-log-workbook.ts for why: a sheet the khata parser
    // already recognises must not also be imported here, or every rupee in
    // it gets counted twice.
    if (rows.some((r) => looksLikeHeader(r))) {
      skipped.push(sheetName);
      skippedReasons.push({ sheet: sheetName, reason: "Looks like a running-balance khata sheet — left to the primary khata parser to avoid double-counting." });
      continue;
    }

    const headerIdx = rows.findIndex((r) => mapCashbookColumns(r));
    if (headerIdx === -1) {
      skipped.push(sheetName);
      skippedReasons.push({
        sheet: sheetName,
        reason:
          'No dual cash-book header found (needs an income-amount column AND a later expense-amount column, e.g. "Cerdit"/"Credit" then "Debit") — ' +
          "this recognizer is for the daily side-by-side income|expense cash book shape.",
      });
      continue;
    }
    const cols = mapCashbookColumns(rows[headerIdx])!;
    let anyRow = false;

    const dateOrder = detectDateOrder(rows);
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (mapCashbookColumns(r)) continue; // a repeated header mid-sheet
      const nonEmpty = r.filter((c) => c && c.trim()).length;
      if (nonEmpty === 0) continue;

      for (const [side, direction] of [
        [cols.left, "In"],
        [cols.right, "Out"],
      ] as const) {
        const vehicleRaw = side.vehicle != null ? (r[side.vehicle] || "").trim() : "";
        if (!vehicleRaw || !PLATE_RE.test(vehicleRaw)) continue; // no real vehicle plate on this side of this row
        const amt = side.amount != null ? toAmount(r[side.amount]).value : 0;
        if (amt <= 0) continue; // no real transaction on this side of this row

        anyRow = true;
        const registration = normalizePlate(vehicleRaw);
        const dateRaw = side.date != null ? (r[side.date] || "").trim() : "";
        const entryDate = parseDate(dateRaw, dateOrder);
        const partyName = side.party != null ? (r[side.party] || "").trim() : "";
        const desc = side.desc != null ? (r[side.desc] || "").trim() : "";
        const description = [partyName, desc].filter(Boolean).join(" • ") || (direction === "In" ? "Cash book income" : "Cash book expense");

        const key = `${sheetName}::${registration}`;
        if (!perVehicle.has(key)) perVehicle.set(key, { sheetName, registration, entries: [] });
        const bucket = perVehicle.get(key)!;
        const category: LedgerCategory = direction === "In" ? "Freight" : "Other";

        bucket.entries.push({
          srNo: null,
          entryDate,
          rawDate: dateRaw,
          method: null,
          partyFrom: null,
          partyTo: null,
          description,
          received: direction === "In" ? amt : 0,
          paid: direction === "Out" ? amt : 0,
          runningBalance: 0,
          sheetBalance: null,
          category,
          direction: direction === "In" ? "In" : null,
          sectionLabel: sheetName,
          isSafiBachat: false,
          isReset: false,
          routeFrom: null,
          routeTo: null,
          cargo: null,
          sourceRow: i + 1,
          needsReview: false,
          reviewReason: null,
        });
      }
    }

    if (!anyRow) {
      skipped.push(sheetName);
      skippedReasons.push({ sheet: sheetName, reason: "Dual cash-book header recognised, but no row had a real vehicle-plate value with a positive amount on either side" });
    }
  }

  const ledgers: ParsedLedger[] = [];
  for (const { sheetName, registration, entries } of perVehicle.values()) {
    // sort chronologically before computing the running balance — left/right
    // entries for the same vehicle were pushed in row order, but row order
    // interleaves both sides across many rows, so an explicit date sort
    // keeps the running balance meaningful.
    entries.sort((a, b) => (a.entryDate?.getTime() ?? 0) - (b.entryDate?.getTime() ?? 0) || a.sourceRow - b.sourceRow);
    let running = 0;
    for (const e of entries) {
      running += e.received - e.paid;
      e.runningBalance = running;
    }
    ledgers.push({
      sourceSheet: sourceLabel ? `${sourceLabel} :: ${sheetName} :: ${registration}` : `${sheetName} :: ${registration}`,
      registration,
      ownerName: null,
      title: `${registration} (cash book from "${sheetName}")`,
      isPartnership: false,
      partnership: null,
      openingBalance: 0,
      closingBalance: running,
      sheetClosing: null,
      entries,
      looksLikeVehicle: true,
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
