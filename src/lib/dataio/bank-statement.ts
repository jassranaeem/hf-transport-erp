/**
 * Read a bank statement (Excel .xlsx or .csv) from any Pakistani bank's internet banking.
 * Formats differ, so the header row is found by its words — a date column plus
 * debit / withdrawal and credit / deposit columns (or one amount column with Dr / Cr),
 * description, cheque / reference and balance when present. Dates are read day-first.
 */
import ExcelJS from "exceljs";

export interface StatementRow {
  date: string; // YYYY-MM-DD
  description: string;
  ref: string;
  withdrawal: number;
  deposit: number;
  balance: number | null;
  line: number; // row number in the file
}
export interface ParsedStatement {
  rows: StatementRow[];
  columns: Record<string, string>; // what each detected column was called in the file
  headerRow: number;
  skipped: number;
  warnings: string[];
}

const norm = (s: any) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

const FIND: Record<string, RegExp> = {
  date: /^(txn\.?\s*date|transaction\s*date|tran(s)?\.?\s*date|posting\s*date|book(ing)?\s*date|date|value\s*date)$/,
  description: /(description|narration|particulars|details|remarks|transaction\s*details|memo)/,
  ref: /(cheque|chq|instrument|ref(erence)?(\s*no)?|tran(s)?\s*id|transaction\s*id)/,
  withdrawal: /^(debit|debits|withdrawal|withdrawals|dr|debit\s*amount|withdrawal\s*amount|paid\s*out|money\s*out)$/,
  deposit: /^(credit|credits|deposit|deposits|cr|credit\s*amount|deposit\s*amount|paid\s*in|money\s*in)$/,
  amount: /^(amount|transaction\s*amount|amt)$/,
  drcr: /^(dr\s*\/\s*cr|cr\s*\/\s*dr|type|txn\s*type|debit\s*\/\s*credit)$/,
  balance: /(balance|running\s*balance|closing\s*balance|available\s*balance)/,
};

export function parseAmount(v: any): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Math.round(Math.abs(v));
  if (typeof v === "object" && "result" in v) return parseAmount((v as any).result);
  const s = String(v).trim();
  if (!s || s === "-") return 0;
  const n = Number(s.replace(/[(),\sA-Za-z]/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(Math.abs(n)) : 0;
}
function signedBalance(v: any): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Math.round(v);
  if (typeof v === "object" && "result" in v) return signedBalance((v as any).result);
  const s = String(v).trim();
  if (!s) return null;
  const neg = /\(.*\)|-|\bdr\b/i.test(s) && !/\bcr\b/i.test(s);
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && s.match(/\d/) ? Math.round(neg ? -n : n) : null;
}

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
export function parseDate(v: any): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    // exceljs gives dates at UTC midnight
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000)); // Excel serial
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "object" && "result" in v) return parseDate((v as any).result);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return fmt(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{2,4})/);
  if (m) return fmt(yr(+m[3]), +m[2], +m[1]); // day first
  m = s.match(/^(\d{1,2})[-/.\s]([A-Za-z]{3,4})[A-Za-z]*[-/.,\s]+(\d{2,4})/);
  if (m && MON[m[2].toLowerCase()]) return fmt(yr(+m[3]), MON[m[2].toLowerCase()], +m[1]);
  m = s.match(/^([A-Za-z]{3,4})[A-Za-z]*[\s-](\d{1,2}),?[\s-](\d{2,4})/);
  if (m && MON[m[1].toLowerCase()]) return fmt(yr(+m[3]), MON[m[1].toLowerCase()], +m[2]);
  return null;
}
const yr = (y: number) => (y < 100 ? 2000 + y : y);
function fmt(y: number, mo: number, d: number) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function csvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === ";" || ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

async function grid(buf: Buffer, filename: string): Promise<any[][]> {
  if (/\.csv$/i.test(filename) || /\.txt$/i.test(filename)) return csvRows(buf.toString("utf8").replace(/^﻿/, ""));
  if (/\.xls$/i.test(filename)) throw new Error("This is an old .xls file — open it in Excel and “Save As” .xlsx (or .csv), then upload that · پرانی xls فائل کو xlsx میں محفوظ کریں");
  if (/\.pdf$/i.test(filename)) throw new Error("PDF statements cannot be read reliably — download the statement as Excel or CSV from internet banking · ایکسل یا CSV میں ڈاؤن لوڈ کریں");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  // the sheet with the most rows
  const ws = [...wb.worksheets].sort((a, b) => b.actualRowCount - a.actualRowCount)[0];
  if (!ws) throw new Error("The file has no sheet");
  const out: any[][] = [];
  ws.eachRow({ includeEmpty: true }, (r, n) => {
    const vals = (r.values as any[]).slice(1).map((v) => (v && typeof v === "object" && "text" in v ? (v as any).text : v && typeof v === "object" && "richText" in v ? (v as any).richText.map((t: any) => t.text).join("") : v));
    out[n - 1] = vals;
  });
  return out.map((r) => r || []);
}

export async function parseBankStatement(buf: Buffer, filename: string): Promise<ParsedStatement> {
  const g = await grid(buf, filename);
  const warnings: string[] = [];
  let header = -1;
  let col: Record<string, number> = {};
  for (let i = 0; i < Math.min(g.length, 60) && header < 0; i++) {
    const cells = (g[i] || []).map(norm);
    const found: Record<string, number> = {};
    cells.forEach((c, j) => {
      if (!c) return;
      for (const [k, re] of Object.entries(FIND)) {
        if (found[k] === undefined && re.test(c)) {
          // "value date" only if there is no transaction date
          if (k === "date" && /value/.test(c) && cells.some((x) => /^(txn|transaction|tran|posting|book)/.test(x) && /date/.test(x))) continue;
          found[k] = j;
          break;
        }
      }
    });
    if (found.date !== undefined && (found.withdrawal !== undefined || found.deposit !== undefined || found.amount !== undefined)) {
      header = i;
      col = found;
    }
  }
  if (header < 0) throw new Error("Could not find the statement's heading row (Date, Debit/Withdrawal, Credit/Deposit, Balance). Is this the transactions sheet? · ہیڈنگ نہیں ملی");

  const names: Record<string, string> = {};
  for (const [k, j] of Object.entries(col)) names[k] = String(g[header][j] ?? "");

  const rows: StatementRow[] = [];
  let skipped = 0;
  let blanks = 0;
  for (let i = header + 1; i < g.length; i++) {
    const r = g[i] || [];
    const date = parseDate(r[col.date]);
    if (!date) {
      if (r.every((c) => c == null || String(c).trim() === "")) {
        if (++blanks > 5 && rows.length) break;
      } else skipped++; // opening / closing / total lines and the like
      continue;
    }
    blanks = 0;
    let wd = col.withdrawal !== undefined ? parseAmount(r[col.withdrawal]) : 0;
    let dp = col.deposit !== undefined ? parseAmount(r[col.deposit]) : 0;
    if (col.withdrawal === undefined && col.deposit === undefined && col.amount !== undefined) {
      const raw = r[col.amount];
      const a = parseAmount(raw);
      const t = norm(col.drcr !== undefined ? r[col.drcr] : "");
      const isDr = /^d|debit|dr/.test(t) || (!t && (typeof raw === "number" ? raw < 0 : /-|\(|dr/i.test(String(raw))));
      if (isDr) wd = a;
      else dp = a;
    }
    if (!wd && !dp) {
      skipped++;
      continue;
    }
    rows.push({
      date,
      description: String(col.description !== undefined ? r[col.description] ?? "" : "").replace(/\s+/g, " ").trim().slice(0, 500),
      ref: String(col.ref !== undefined ? r[col.ref] ?? "" : "").trim().slice(0, 100),
      withdrawal: wd,
      deposit: dp,
      balance: col.balance !== undefined ? signedBalance(r[col.balance]) : null,
      line: i + 1,
    });
  }
  if (!rows.length) throw new Error("No transactions found under the heading row · کوئی لین دین نہیں ملا");
  if (col.balance === undefined) warnings.push("No balance column — the statement's own balance cannot be checked against the books.");
  // some banks list newest first; keep the file order but note it
  if (rows.length > 1 && rows[0].date > rows[rows.length - 1].date) warnings.push("Newest first in the file — read in date order.");
  return { rows, columns: names, headerRow: header + 1, skipped, warnings };
}
