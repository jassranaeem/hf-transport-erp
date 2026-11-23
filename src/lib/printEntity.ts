/**
 * Print / PDF of any data sheet (Vehicles, Parties, Drivers, Invoices, Cash Book …): every column and every row
 * of the sheet, ids shown as names, text wrapped in full, on the company letterhead — instead of the browser
 * printing whatever part of the screen happens to be visible.
 */
import { enterpriseFetch } from "../../client/api.ts";
import { PCol, dmy, fetchCompany, openPrint, tableDocHtml } from "./printDoc.ts";

const MONEY = /amount|price|balance|salary|cost|revenue|paid|received|debit|credit|total|fare|rate|charge|freight|opening|closing|budget|limit|fee|value|payable|receivable|advance|allowance|bonus|deduction|tax|wht|discount|net|gross|profit|expense|income/i;


function formatCell(v: any, type: string, key: string, header: string): string {
  if (v == null || v === "") return "";
  if (type === "boolean") return v === true || v === "true" || v === 1 ? "Yes" : "No";
  if (type === "date") return dmy(v) || String(v);
  if (type === "datetime") {
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${dmy(s)} ${s.slice(11, 16)}`.trim() : s;
  }
  if (type === "int" || type === "number" || type === "decimal") {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return MONEY.test(key) || MONEY.test(header) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(n);
  }
  return String(v);
}

/** The printable page of a data sheet (HTML). */
export async function entitySheetHtml(entityKey: string, label?: string): Promise<string> {
  {
    const [t, company] = await Promise.all([enterpriseFetch(`/api/data/${entityKey}/print`), fetchCompany()]);
    // the cell texts first; a column with nothing in it on any row is left out (it only steals room)
    const all = t.rows.map((r: any) => {
      const o: Record<string, string> = {};
      for (const c of t.columns) o[c.key] = formatCell(r[c.key], c.type, c.key, c.header);
      return o;
    });
    const used = t.columns.filter((c: any) => all.some((r: any) => r[c.key] !== ""));
    const dropped = t.columns.length - used.length;
    const longestWord = (h: string) => Math.max(...String(h).split(/\s+/).map((w) => w.length), 3);
    const p90 = (key: string) => {
      const lens = all.map((r: any) => (r[key] || "").length).filter((x: number) => x > 0).sort((x: number, y: number) => x - y);
      return lens.length ? lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.9))] : 0;
    };
    // width follows what is really in the column (and its heading's longest word), not just its type
    const weights = used.map((c: any) => Math.max(longestWord(c.header), Math.min(p90(c.key), 38), 4) + 2.5);
    const sum = weights.reduce((x: number, y: number) => x + y, 0) || 1;
    const cols: PCol[] = used.map((c: any, i: number) => ({
      key: c.key,
      label: c.header,
      align: ["int", "number", "decimal"].includes(c.type) ? "right" : c.type === "boolean" ? "center" : "left",
      nowrap: ["date", "datetime", "boolean"].includes(c.type),
      width: `${((weights[i] / sum) * 96).toFixed(2)}%`,
    }));
    const rows = all;
    const name = label || t.label || entityKey;
    return tableDocHtml({
      title: String(name).toUpperCase(),
      fileTitle: `${name} — ${dmy(new Date().toISOString())}`,
      company,
      orientation: cols.length > 6 ? "landscape" : "portrait",
      cards: [{ label: "Records", urdu: "اندراجات", value: rows.length.toLocaleString("en-US"), tone: "hi" }],
      tables: [{ columns: cols, rows, index: true, footnote: dropped ? `${dropped} column${dropped === 1 ? "" : "s"} with no data in any row ${dropped === 1 ? "is" : "are"} left out. · جن کالموں میں کوئی ڈیٹا نہیں وہ شامل نہیں۔` : undefined }],
      ref: `${entityKey.toUpperCase()}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
    });
  }
}

/** Opens the printable copy of a data sheet in its own window. */
export function printEntitySheet(entityKey: string, label: string | undefined, onError: (m: string) => void) {
  return openPrint(() => entitySheetHtml(entityKey, label), onError);
}
