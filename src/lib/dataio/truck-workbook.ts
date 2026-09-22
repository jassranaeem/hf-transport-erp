/**
 * Parser for the customer's legacy "PERSONL TRUCK.xlsx" — ~48 per-truck
 * running cash ledgers (khata). Turns each truck sheet into a normalised
 * ledger + rows the ERP can store, and a reconciliation report.
 *
 * The workbook is messy on purpose-defeating ways: 9- and 10-column layouts,
 * several restarting sections per sheet, mixed / garbage dates, `[object Object]`
 * formula cells, RTL Urdu + Roman-Urdu free text, text-typed amounts. The
 * parser is deliberately forgiving: it imports every data row, and flags the
 * uncertain ones (`needsReview`) instead of dropping them.
 */

import ExcelJS from "exceljs";
import { repairXlsxBuffer } from "./xlsx-repair.ts";

export type LedgerCategory =
  | "Freight" | "Diesel" | "TripCash" | "Tyre" | "Visa" | "Carnet" | "TomanFX"
  | "PartsBill" | "Garage" | "Salary" | "Battery" | "Insurance" | "MobilOil"
  | "Permit" | "OnlineTransfer" | "Capital" | "SafiBachat" | "Other";

export interface ParsedEntry {
  srNo: number | null;
  entryDate: Date | null;
  rawDate: string;
  method: string | null;
  partyFrom: string | null;
  partyTo: string | null;
  description: string;
  received: number;
  paid: number;
  runningBalance: number;
  sheetBalance: number | null;
  category: LedgerCategory;
  direction: "In" | "Out" | null;
  sectionLabel: string;
  isSafiBachat: boolean;
  isReset: boolean;
  routeFrom: string | null;
  routeTo: string | null;
  cargo: string | null;
  sourceRow: number;
  needsReview: boolean;
  reviewReason: string | null;
}

export interface ParsedPartnership {
  agreedPrice: number | null;
  advancePaid: number | null;
  outstanding: number | null;
  rawLines: string[];
}

export interface ParsedLedger {
  sourceSheet: string;
  registration: string;
  ownerName: string | null;
  title: string;
  isPartnership: boolean;
  partnership: ParsedPartnership | null;
  openingBalance: number;
  closingBalance: number; // computed
  sheetClosing: number | null; // last BALANCE cell seen
  entries: ParsedEntry[];
  // Whether `registration` is a genuine vehicle-plate match (e.g. "TLB 100")
  // rather than a fallback to the sheet's own title/name. The same SR# |
  // Description | Balance shape is used for BOTH per-truck khatas and
  // per-person/company khatas in this real data (e.g. a sheet titled "Ahmed
  // Shah Uzbak" or "Zubair Enterprises" is a customer's account, not a
  // truck's) — callers use this to route each ledger to Truck Ledgers vs
  // Party Ledgers instead of importing every recognised sheet as a truck.
  looksLikeVehicle: boolean;
}

export interface WorkbookReport {
  generatedAt: string;
  ledgers: Array<{
    sheet: string;
    registration: string;
    owner: string | null;
    isPartnership: boolean;
    rowsTotal: number;
    rowsImported: number;
    rowsNeedReview: number;
    computedClosing: number;
    sheetClosing: number | null;
    closingMatches: boolean;
    partnership: ParsedPartnership | null;
  }>;
  totals: { ledgers: number; entries: number; needReview: number; freightRows: number };
  skippedSheets: string[];
  skippedReasons: Array<{ sheet: string; reason: string }>;
}

export interface ParseResult {
  ledgers: ParsedLedger[];
  report: WorkbookReport;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
// "SHEET1".."SHEET5" used to be in this set on the assumption that an
// unrenamed default Excel tab name means "leftover blank tab, skip it" —
// wrong for a real file: a whole real party ledger (a genuine multi-row
// khata with real transactions) found in production data was sitting on a
// sheet literally still named "Sheet1" because the person who typed it in
// never bothered to rename the tab. The row-count and header checks further
// down already correctly filter out an ACTUALLY blank Sheet1/Sheet2 — this
// name-based blanket exclusion only ever adds a false negative, never a true
// positive, so it's gone. Only sheet names that are never real data in this
// workbook format (the original file's own index/summary tabs) stay listed.
const META_SHEETS = new Set(["MEIN PAGE", "-", "TOTAL SAFI"]);

export function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (o.richText && Array.isArray(o.richText)) return (o.richText as Array<{ text: string }>).map((r) => r.text).join("");
    if (o.result != null) return String(o.result);
    if (o.formula != null) return ""; // unresolved formula
    return "";
  }
  return String(v).replace(/ /g, " ").trim();
}

// PKR amounts are stored as int4. A single ledger line above this is noise
// (a phone number, an id, two cells run together) — clamp + flag, never store.
const MAX_AMOUNT = 500_000_000; // 50 crore
const clampBal = (n: number) => Math.max(-2_000_000_000, Math.min(2_000_000_000, Math.round(n)));

export function toAmount(v: unknown): { value: number; bad: boolean } {
  if (v == null || v === "") return { value: 0, bad: false };
  if (typeof v === "number") {
    const n = Math.round(Math.abs(v));
    return n > MAX_AMOUNT ? { value: 0, bad: true } : { value: n, bad: false };
  }
  const t = cellText(v);
  if (!t) return { value: 0, bad: false };
  const cleaned = t.replace(/[,\s]/g, "").replace(/[^\d.\-]/g, "");
  let n: number;
  if (!cleaned || cleaned === "-" || cleaned === ".") {
    const m = t.replace(/[,\s]/g, "").match(/\d{2,}/); // text like "خوماہ500000"
    if (!m) return { value: 0, bad: true };
    n = parseInt(m[0], 10);
  } else {
    n = Math.round(Math.abs(parseFloat(cleaned)));
  }
  if (!Number.isFinite(n)) return { value: 0, bad: true };
  if (n > MAX_AMOUNT) return { value: 0, bad: true };
  return { value: n, bad: false };
}

function toSignedAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const n = Math.round(v);
    return Math.abs(n) > 2_000_000_000 ? null : n;
  }
  const t = cellText(v);
  if (!t) return null;
  const cleaned = t.replace(/[,\s]/g, "").replace(/[^\d.\-]/g, "");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || Math.abs(n) > 2_000_000_000) return null;
  return Math.round(n);
}

/** tolerant date parser; returns null for blank / unparseable / out-of-range */
export function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return inRange(v);
  const raw = cellText(v).trim();
  if (!raw) return null;
  let m: RegExpMatchArray | null;
  // yyyy-mm-dd or yyyy/mm/dd
  if ((m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) {
    return inRange(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  }
  // dd.mm.yyyy | dd/mm/yyyy | dd-mm-yyyy  (also 2-digit year)
  if ((m = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/))) {
    let [, d, mo, y] = m;
    let year = +y;
    if (year < 100) year += 2000;
    return inRange(new Date(Date.UTC(year, +mo - 1, +d)));
  }
  // Excel serial number as text
  if (/^\d{4,6}$/.test(raw)) {
    const serial = +raw;
    if (serial > 40000 && serial < 60000) {
      return inRange(new Date(Date.UTC(1899, 11, 30) + serial * 86400000));
    }
  }
  return null;
}
function inRange(d: Date): Date | null {
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 2020 || y > 2027) return null;
  return d;
}

// ---- classification -------------------------------------------------------
const KW: Array<[LedgerCategory, RegExp]> = [
  ["SafiBachat", /صافی|safi\s*bach|safi\b|نیل|nill|\bnil\b|old khata|khata nill/i],
  ["Freight", /کرایہ|کرائ|kiraya|kariya|kraya|freight|گوشت|ghost|meat|کجھور|kajoor|kjoor|سیب|saab\b|apple|آلو|\balo\b|potato|milk|چاول|rice|خالی|khali|ترپال|onion|لایس|lays|dara kariya|machine kar|satin kir/i],
  ["Diesel", /ڈیزل|ڈیزل|diesel|dieseil|disel|پمپ|pump|آغاجان|aghajan|قاسم.*ڈیزل|تیمور|timur|teemo|تیمو|شعیب|shoaib|آخترآباد|akhter\s*abad|akhterabad|نعمت.*(diesel|disel|ڈیزل|liter|litre)|agha pump/i],
  ["MobilOil", /موبلن|mobline|mob\s*lin|mobil|mablain|آئل\b|\boil\b|40 پیٹر|later mab/i],
  ["Tyre", /ٹائر|ٹایر|ٹایئر|tyre|tyer|\btier\b|\btire\b|جوڑہ|جورہ|marcha|مارچ.*جور/i],
  ["Battery", /بیٹری|بیڑی|battery|bettery/i],
  ["Visa", /ویزا|\bvisa\b|\bvise\b|ماہ ویزا|month vis/i],
  ["Carnet", /کارنٹ|کارن\b|carnet|carnet|cernat|carnet|\bcarnet\b|\bcarnat\b|\bkarnat\b|\bcarnit\b|\btir\b/i],
  ["Permit", /پرمٹ|permit|parmt|ٹیگس|\btags\b|\btoken\b|گاڈی ٹیگس|میزیر ٹیگس|gadi tax|\btax\b/i],
  ["Insurance", /بیمہ|\bbima\b|insurance|نیکہ بل|بیمہ/i],
  ["Salary", /تنخوہ|تنخواہ|tankhwa|tankhwo|salary|درائیور تخواہ|driver tankh|کلینر|kalinder|kalinar|cleaner|کلینٹر|بتہ|\bbta\b|allowance|برست/i],
  ["Garage", /گیراج|garage|giraj|مرمت|marmat|repair|murmat|انجن|engine|کمانی|kamani|مستری|mistri|workshop|گاڈی مرمت|گاڈی ینا/i],
  ["PartsBill", /بل سامان|bill sam|اکرام بل|akram\s*bill|akrm bl|اکرم بل|ایک بل|\bbill\b|\bbl\b|سامان|billti|\bbilti\b|3 بل/i],
  ["TomanFX", /تمن|\btoman\b|\btuman\b|میلون|میلیون|million|milion|دالر|dollar|dollor/i],
  ["Capital", /جمع|\bjama\b|cash\s*sa|cash dawood sa|وصول|\bwasol\b|قرضدار|qarzdar|مشترکہ|mushtarka|shreki|juma raqm|hbl chak|میزان چیک|meezan che|alfalah che|soneri chak|soneir bank|js bank/i],
  ["OnlineTransfer", /آئلاین|آیلاین|oنلائن|\bonline\b|\boline\b|بر اکونٹ|ba account|بر اکونت|\bcheque\b|\bchak\b|\bcheck\b|چیک|چک|بھیجا|send kiye|jama online/i],
  ["TripCash", /گاڈی خرچہ|gadi\s*kharcha|gaadi\s*kharcha|\bkharcha\b|kharacha|نقد خرچہ|naqd|نقد|cash kharcha|برای گاڈی|بنام گاڈی|dawood cash|estapni/i],
];

function classify(desc: string, method: string, direction: "In" | "Out" | null): LedgerCategory {
  const hay = `${desc} ${method}`.toLowerCase();
  if (direction === "In") {
    if (/صافی|safi\s*bach|safi\b|نیل|nill/i.test(hay)) return "SafiBachat";
    if (KW.find(([c]) => c === "Freight")![1].test(hay)) return "Freight";
    if (KW.find(([c]) => c === "Capital")![1].test(hay)) return "Capital";
    if (KW.find(([c]) => c === "TomanFX")![1].test(hay)) return "TomanFX";
    return "Freight"; // an unlabelled money-in on a truck sheet is almost always freight
  }
  for (const [cat, re] of KW) {
    if (re.test(hay)) return cat;
  }
  return "Other";
}

const ROUTE_TOKENS = [
  "LAHORE", "KARACHI", "ZAHEDAN", "ZAHIDAN", "ZAHIDEN", "TEHRAN", "TAIRAN", "TEHIRAN", "TAERAN",
  "TAFTAN", "TATFAN", "ISLAMABAD", "PINDI", "RAWALPINDI", "PANDI", "FAISALABAD", "FASALABAD",
  "MULTAN", "QUETTA", "QEUTTE", "QUETTE", "PESHAWAR", "PASHAWAR", "PANJGUR", "HYDERABAD",
  "250 BORDER", "250 BORFER", "250 BORDR", "AKHTARABAD", "AKHTER ABAD", "SIALKOT", "GUJRANWALA",
];
export function normRoute(s: string): string | null {
  const up = s.toUpperCase().trim();
  if (!up) return null;
  for (const t of ROUTE_TOKENS) if (up.includes(t)) return t.replace(/^250 .*/, "250 Border");
  // fall back to the raw token if it looks like a place (letters, <= 20 chars, no digits-only)
  if (/^[A-Za-z ]{3,20}$/.test(s.trim())) return s.trim();
  return null;
}

const CARGO_KW: Array<[string, RegExp]> = [
  ["Meat", /گوشت|ghost|\bmeat\b/i],
  ["Dates", /کجھور|kajoor|kjoor|\bdates\b/i],
  ["Apple", /سیب|\bsaab\b|\bseb\b|\bapple\b/i],
  ["Potato", /آلو|\balo\b|\baloo\b|potato/i],
  ["Milk", /\bmilk\b|دودھ/i],
  ["Rice", /چاول|\brice\b/i],
  ["Onion", /پیاز|\bonion\b|لایس/i],
  ["Empty", /خالی|khali|\bempty\b/i],
  ["Machinery", /ترپال|machine|مشین|موٹرر مشین/i],
];
function detectCargo(desc: string): string | null {
  for (const [c, re] of CARGO_KW) if (re.test(desc)) return c;
  return null;
}

export function looksLikeHeader(cells: string[]): boolean {
  const joined = cells.join(" ").toUpperCase();
  // A real header row needs SOME row identifier (a serial number OR a date
  // — real files exist with a Date column and no SR# at all), a description
  // column, and a balance column. "DESCR" (5 letters) as the description
  // check missed real spelling variants that only share the first 4 letters
  // — "DESCERPTION" (a real header in production data, R and E swapped)
  // isn't matched by a 5-letter "DESCR" prefix but is by "DESC".
  const hasRowId = joined.includes("SR") || joined.includes("S.NO") || joined.includes("S NO") || joined.includes("DATE");
  // A route-only khata (FROM + TO, no literal "Description" column at all —
  // real files exist like this) still gives every entry something
  // meaningful to describe itself with once parsed, so FROM+TO stands in.
  const hasDesc = joined.includes("DESC") || (joined.includes("FROM") && joined.includes(" TO "));
  const hasBalance = joined.includes("BALANCE");
  return hasRowId && hasDesc && hasBalance;
}

/** map a raw header row to column indexes (0-based within row.values.slice(1)) */
function mapColumns(cells: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  cells.forEach((c, i) => {
    const u = c.toUpperCase().replace(/[^A-Z]/g, "");
    if (!u) return;
    if (u.startsWith("SR") || u === "SNO" || u === "SNO") idx.sr = i;
    else if (u === "DATE") idx.date = i;
    else if (u.startsWith("PAGE") || u === "CASHONLINE" || u === "PAGENO") idx.method ??= i;
    else if (u === "FROM" || u === "FORM") idx.from = i;
    else if (u === "TO") idx.to = i;
    else if (u === "TRUCK" || u === "TURCKNO" || u === "TRUCKNO") idx.truck = i;
    else if (u.startsWith("DESC")) idx.desc = i; // 4, not 5 letters — see looksLikeHeader's note on "DESCERPTION"
    else if (u === "DABIT" || u === "DEBIT") idx.paid ??= i; // DABIT+ column = money out
    else if (u === "RACEVID" || u === "RECEIVED" || u === "JAMA" || u === "CREDIT" || u === "CERDIT") idx.recv ??= i;
    else if (u === "PAYMANT" || u === "PAYMENT" || u === "BANAM") idx.paid ??= i;
    else if (u === "BALANCE") idx.bal = i;
  });
  return idx;
}

// ---------------------------------------------------------------------------
/**
 * @param sourceLabel identifies the WORKBOOK this buffer came from (e.g. its
 * filename, without extension) — folded into every ledger's `sourceSheet` so
 * it stays globally unique across a multi-file import. Sheet tab names are
 * only unique WITHIN one file; "Sheet1" (an unrenamed default Excel tab) is
 * extremely common — real production data had dozens of *different* real
 * people/companies each sitting on their own file's own never-renamed
 * "Sheet1". Every importer matches/updates an existing ledger or party by
 * `sourceSheet` alone, so without this prefix, uploading a second file whose
 * tab also happened to be "Sheet1" found and overwrote the FIRST file's
 * party — repeated across a large batch import, this silently merged many
 * distinct real customers into one, each import renaming the same row and
 * discarding the previous one's entries as "no longer present in this
 * sheet". Omit sourceLabel only for truly single-file, one-off calls (the
 * CLI script) where this can't happen.
 */
/** Original filename -> a stable label for parseTruckWorkbook's sourceLabel (strip the extension, trim). */
export function sourceLabelFromFilename(originalname: string | undefined | null): string {
  return (originalname || "workbook").replace(/\.(xlsx|xlsm|xls)$/i, "").trim();
}

export async function parseTruckWorkbook(buffer: Buffer, sourceLabel?: string): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await repairXlsxBuffer(buffer)) as unknown as ArrayBuffer);

  const ledgers: ParsedLedger[] = [];
  const skipped: string[] = [];
  // WHY each sheet was skipped — a bare name list left a "0 sheets
  // recognised" result with no way to tell "your sheet name doesn't look
  // like a vehicle registration" apart from "this sheet is real but only
  // has 2 rows in it, below the minimum a khata needs" apart from "this is
  // Instructions/Sample and was deliberately excluded". A quick manual test
  // sheet (a header row plus one data row) hits the row-count floor below,
  // which reads identically to a genuinely-unrecognised sheet without this.
  const skippedReasons: Array<{ sheet: string; reason: string }> = [];

  for (const ws of wb.worksheets) {
    const sheetName = ws.name.trim();
    if (META_SHEETS.has(sheetName.toUpperCase())) {
      skipped.push(sheetName);
      skippedReasons.push({ sheet: sheetName, reason: "Instructions/sample sheet — excluded on purpose" });
      continue;
    }
    if (ws.actualRowCount <= 3) {
      skipped.push(sheetName);
      skippedReasons.push({
        sheet: sheetName,
        reason: `Only ${ws.actualRowCount} row(s) in this sheet — a truck khata needs a title/header row plus at least a couple of real transaction rows to be recognised`,
      });
      continue;
    }

    // ---- read all rows as string matrices -----------------------------
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map(cellText);
      rows.push(vals);
    });
    if (rows.length < 3) {
      skipped.push(sheetName);
      skippedReasons.push({ sheet: sheetName, reason: `Only ${rows.length} row(s) read from this sheet — same reason as above` });
      continue;
    }

    // ---- title + owner ----------------------------------------------
    const row1 = (rows[0]?.find((c) => c && c.trim()) || "").trim();
    const REG_RE = /\b([A-Z]{2,4}[ -]?\d{2,4})\b/i;
    // prefer whichever of {row-1 title, sheet name} actually contains a plate
    const titleRaw = REG_RE.test(row1) ? row1 : REG_RE.test(sheetName) ? sheetName : row1 || sheetName;
    const regMatch = titleRaw.match(REG_RE) || sheetName.match(REG_RE);
    const registration = (regMatch ? regMatch[1] : sheetName).toUpperCase().replace(/\s+/g, " ").replace(/-/g, " ").trim();
    let ownerName: string | null = null;
    if (regMatch) {
      const after = titleRaw.slice(titleRaw.indexOf(regMatch[1]) + regMatch[1].length).replace(/[()]/g, " ").trim();
      const before = titleRaw.slice(0, titleRaw.indexOf(regMatch[1])).replace(/[()]/g, " ").trim();
      ownerName = (after || before || null) && (after || before).replace(/\s+/g, " ").trim();
      if (ownerName && ownerName.length < 2) ownerName = null;
    }

    // ---- find the first header row ---------------------------------
    let firstHeader = rows.findIndex((r) => looksLikeHeader(r));
    if (firstHeader === -1) {
      skipped.push(sheetName);
      skippedReasons.push({
        sheet: sheetName,
        reason:
          'No header row found with a "SR#/S.NO" column, a "Description" column, AND a "Balance" column all together — ' +
          "this parser is tuned to the legacy khata layout (SR# | DATE | DESCRIPTION | RECEIVED | PAID | BALANCE), " +
          "not just a vehicle-registration sheet name. A sheet named correctly but with different column headers " +
          "(e.g. no literal \"Balance\" column) is skipped even though the name matches.",
      });
      continue;
    }

    // ---- partnership block (rows above the first header) -----------
    let partnership: ParsedPartnership | null = null;
    const preLines = rows.slice(1, firstHeader).map((r) => r.join(" ").replace(/\s+/g, " ").trim()).filter(Boolean);
    const pBlob = preLines.join(" | ");
    if (/قرضداری|qarzdar|مشترکہ|mushtarka|shreki|kimat|قمت|قیمت|total gadi|jama .*dawood|kilala|kochi/i.test(pBlob)) {
      const nums = (pBlob.match(/\d[\d,]{4,}/g)?.map((n) => parseInt(n.replace(/,/g, ""), 10)) || []).filter(
        (n) => Number.isFinite(n) && n <= 100_000_000
      );
      const agreedPrice = nums.length ? Math.max(...nums) : null;
      let outstanding: number | null = null;
      let advancePaid: number | null = null;
      for (const l of preLines) {
        const n = l.match(/\d[\d,]{4,}/)?.[0];
        if (!n) continue;
        const val = parseInt(n.replace(/,/g, ""), 10);
        if (!Number.isFinite(val) || val > 100_000_000) continue;
        if (/قرضداری|qarzdar|مشترکہ|mushtarka|shreki|بقایا|baqaya/i.test(l)) outstanding = val;
        else if (/jama|جمع|deposit|online jama|diye/i.test(l)) advancePaid = (advancePaid || 0) + val;
      }
      if (agreedPrice && advancePaid == null && outstanding != null) advancePaid = agreedPrice - outstanding;
      partnership = { agreedPrice, advancePaid, outstanding, rawLines: preLines };
    }

    // ---- walk sections -------------------------------------------
    const entries: ParsedEntry[] = [];
    let section = 0;
    let cols = mapColumns(rows[firstHeader]);
    let running = 0;
    let lastRealBalance = 0; // running balance of the last row that moved money
    let sheetClosing: number | null = null;
    let rowsTotal = 0;

    for (let i = firstHeader + 1; i < rows.length; i++) {
      const r = rows[i];
      if (looksLikeHeader(r)) {
        // each section is its own "page" whose BALANCE column restarts from 0
        section++;
        cols = mapColumns(r);
        running = 0;
        continue;
      }
      const nonEmpty = r.filter((c) => c && c.trim()).length;
      if (nonEmpty === 0) continue;

      const g = (k: string) => (cols[k] != null ? (r[cols[k]] ?? "").trim() : "");
      const srRaw = g("sr");
      const desc = g("desc");
      const dateRaw = g("date");
      // a row with just an SR# and nothing else is a spacer
      if (!desc && !g("recv") && !g("paid") && !g("bal") && !dateRaw && !g("from") && !g("to")) continue;

      rowsTotal++;
      const recvRaw = cols.recv != null ? (r[cols.recv] as unknown) : "";
      const paidRaw = cols.paid != null ? (r[cols.paid] as unknown) : "";
      const recv = toAmount(recvRaw);
      const paid = toAmount(paidRaw);
      const balCell = cols.bal != null ? toSignedAmount(r[cols.bal]) : null;
      if (balCell != null) sheetClosing = balCell;

      const entryDate = parseDate(dateRaw || (dateRaw === "" ? undefined : dateRaw));
      const direction: "In" | "Out" | null =
        recv.value > 0 ? "In" : paid.value > 0 ? "Out" : null;

      running = clampBal(running + recv.value - paid.value);

      const method = g("method") || null;
      const cat = classify(desc, method || "", direction);
      const isSafi = cat === "SafiBachat" || /صافی|safi\s*bach|\bsafi\b/i.test(desc);
      const isReset = /نیل|nill|\bnil\b|old khata|khata nill/i.test(desc);

      let routeFrom: string | null = null;
      let routeTo: string | null = null;
      let cargo: string | null = null;
      if (direction === "In") {
        routeFrom = normRoute(g("from"));
        routeTo = normRoute(g("to"));
        cargo = detectCargo(desc);
      }

      const reviewReasons: string[] = [];
      if (!entryDate && dateRaw) reviewReasons.push("unparseable date");
      if (recv.bad || paid.bad) reviewReasons.push("amount stored as text");
      if (balCell != null && Math.abs(balCell - running) > 1) {
        // trust the sheet's own BALANCE column and realign; only flag when the
        // gap is material and this row actually moved money
        if (Math.abs(balCell - running) > 50 && (recv.value || paid.value)) {
          reviewReasons.push(`running balance ${running} != sheet ${balCell}`);
        }
        running = balCell;
      }
      if (!desc && (recv.value || paid.value)) reviewReasons.push("no description");
      // a "Nill / old khata" line zeroes the page going forward
      if (isReset) running = 0;
      if (recv.value || paid.value || balCell != null) lastRealBalance = running;

      entries.push({
        srNo: /^\d+$/.test(srRaw) ? parseInt(srRaw, 10) : null,
        entryDate,
        rawDate: dateRaw,
        method,
        partyFrom: direction === "Out" ? g("from") || null : null,
        partyTo: g("to") || null,
        description: desc,
        received: recv.value,
        paid: paid.value,
        runningBalance: running,
        sheetBalance: balCell,
        category: cat,
        direction,
        sectionLabel: `Page ${section + 1}`,
        isSafiBachat: isSafi,
        isReset,
        routeFrom,
        routeTo,
        cargo,
        sourceRow: i + 1,
        needsReview: reviewReasons.length > 0,
        reviewReason: reviewReasons.join("; ") || null,
      });
    }

    // A sheet with zero transaction rows is still worth keeping when it
    // carries a real partnership/ownership block (agreed price, advance,
    // outstanding) — e.g. a truck bought in partnership whose ledger hasn't
    // seen a single trip yet. Dropping it would silently lose a real
    // financial arrangement the user can plainly see in the sheet.
    if (entries.length === 0 && !partnership) {
      skipped.push(sheetName);
      skippedReasons.push({
        sheet: sheetName,
        reason: "Header row recognised, but no transaction rows (and no partnership/ownership block) were found under it",
      });
      continue;
    }

    ledgers.push({
      sourceSheet: sourceLabel ? `${sourceLabel} :: ${sheetName}` : sheetName,
      registration,
      ownerName,
      title: titleRaw,
      isPartnership: !!partnership,
      partnership,
      openingBalance: partnership?.outstanding ? -Math.abs(partnership.outstanding) : 0,
      closingBalance: lastRealBalance,
      sheetClosing,
      entries,
      looksLikeVehicle: !!regMatch,
    });
  }

  const report: WorkbookReport = {
    generatedAt: new Date().toISOString(),
    ledgers: ledgers.map((l) => {
      const need = l.entries.filter((e) => e.needsReview).length;
      return {
        sheet: l.sourceSheet,
        registration: l.registration,
        owner: l.ownerName,
        isPartnership: l.isPartnership,
        rowsTotal: l.entries.length,
        rowsImported: l.entries.length,
        rowsNeedReview: need,
        computedClosing: l.closingBalance,
        sheetClosing: l.sheetClosing,
        closingMatches: l.sheetClosing == null ? true : Math.abs(l.sheetClosing - l.closingBalance) <= 2,
        partnership: l.partnership,
      };
    }),
    totals: {
      ledgers: ledgers.length,
      entries: ledgers.reduce((s, l) => s + l.entries.length, 0),
      needReview: ledgers.reduce((s, l) => s + l.entries.filter((e) => e.needsReview).length, 0),
      freightRows: ledgers.reduce((s, l) => s + l.entries.filter((e) => e.category === "Freight").length, 0),
    },
    skippedSheets: skipped,
    skippedReasons,
  };

  return { ledgers, report };
}
