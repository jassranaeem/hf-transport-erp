/**
 * Flat reader for the same dual cash-book shape as cashbook-workbook.ts
 * (Date | Truck | Jama | Description | Credit  ‖  Date | Truck | Banam |
 * Description | Debit), but for the Daily Cash Book instead of per-truck
 * Truck Ledgers: every row on every sheet becomes one "In" entry (left/
 * credit side) and one "Out" entry (right/debit side), regardless of
 * whether the Truck cell holds a real vehicle plate - the Daily Cash Book
 * tracks overall cash movement, not per-vehicle balances, so nothing here
 * is grouped or skipped by vehicle. The truck number (when present) is
 * folded into the entry's description for context.
 */
import ExcelJS from "exceljs";
import { repairXlsxBuffer } from "./xlsx-repair.ts";
import { cellText, toAmount, parseDate, looksLikeHeader } from "./truck-workbook.ts";
import { mapCashbookColumns } from "./cashbook-workbook.ts";

export interface FlatCashRow {
  entryDate: Date | null;
  rawDate: string;
  direction: "In" | "Out";
  amount: number;
  person: string | null;
  description: string | null;
  sourceSheet: string;
  sourceRow: number;
}

export interface FlatCashReport {
  rows: FlatCashRow[];
  totalIn: number;
  totalOut: number;
  skippedSheets: string[];
}

export async function parseCashbookFlat(buffer: Buffer, sourceLabel?: string): Promise<FlatCashReport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await repairXlsxBuffer(buffer)) as unknown as ArrayBuffer);

  const rows: FlatCashRow[] = [];
  const skippedSheets: string[] = [];

  for (const ws of wb.worksheets) {
    const sheetName = ws.name.trim();
    if (ws.actualRowCount <= 2) {
      skippedSheets.push(sheetName);
      continue;
    }
    const rawRows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => rawRows.push((row.values as unknown[]).slice(1).map(cellText)));

    let cols: ReturnType<typeof mapCashbookColumns> = null;
    let anyRow = false;

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const maybeHeader = mapCashbookColumns(r);
      if (maybeHeader) {
        cols = maybeHeader; // re-detect at each repeated header block (weekly "Close It" sections)
        continue;
      }
      if (!cols) continue;
      if (looksLikeHeader(r)) continue; // a running-balance khata header slipped into the same file
      const nonEmpty = r.filter((c) => c && c.trim()).length;
      if (nonEmpty === 0) continue;

      for (const [side, direction] of [
        [cols.left, "In"],
        [cols.right, "Out"],
      ] as const) {
        const amt = side.amount != null ? toAmount(r[side.amount]).value : 0;
        if (amt <= 0) continue;
        anyRow = true;
        const dateRaw = side.date != null ? (r[side.date] || "").trim() : "";
        const vehicleRaw = side.vehicle != null ? (r[side.vehicle] || "").trim() : "";
        const partyName = side.party != null ? (r[side.party] || "").trim() : "";
        const desc = side.desc != null ? (r[side.desc] || "").trim() : "";
        const description = [vehicleRaw, desc].filter(Boolean).join(" • ") || null;

        rows.push({
          entryDate: parseDate(dateRaw),
          rawDate: dateRaw,
          direction: direction === "In" ? "In" : "Out",
          amount: amt,
          person: partyName || null,
          description,
          sourceSheet: sourceLabel ? `${sourceLabel} :: ${sheetName}` : sheetName,
          sourceRow: i + 1,
        });
      }
    }
    if (!anyRow) skippedSheets.push(sheetName);
  }

  return {
    rows,
    totalIn: rows.filter((r) => r.direction === "In").reduce((s, r) => s + r.amount, 0),
    totalOut: rows.filter((r) => r.direction === "Out").reduce((s, r) => s + r.amount, 0),
    skippedSheets,
  };
}
