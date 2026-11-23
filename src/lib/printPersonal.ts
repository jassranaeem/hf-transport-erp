/** Personal & Household ledger as a proper printed / PDF document (every entry in full). */
import { PCol, dmy, num, openPrint, signed, tableDocHtml } from "./printDoc.ts";
import { fetchCompany } from "./printDoc.ts";

export async function personalLedgerHtml(ledger: any, period: string): Promise<string> {
  {
    const company = await fetchCompany();
    const isPot = ledger.kind === "pot";
    const cols: PCol[] = [
      { key: "date", label: "Date · تاریخ", width: "66px", nowrap: true },
      { key: "description", label: "Description · تفصیل" },
      { key: "category", label: "Category · مد", width: "92px" },
      { key: "who", label: "Payee / Person · کس کو", width: "110px" },
      { key: "method", label: "Method", width: "58px", nowrap: true },
      { key: "spent", label: isPot ? "Spent · خرچ" : "Spent · خرچ", align: "right", width: "84px", tone: "out" },
      { key: "funds", label: "Funds in · جمع", align: "right", width: "84px", tone: "in" },
      { key: "balance", label: isPot ? "Left · باقی" : "Balance · بقایا", align: "right", width: "92px", tone: "bal" },
    ];
    const rows = (ledger.rows || []).map((r: any) => ({
      date: dmy(r.entryDate) || "—",
      description: { html: `${esc(r.description || "—")}${[r.refNo ? `Ref: ${r.refNo}` : "", r.notes || ""].filter(Boolean).length ? `<div style="font-size:8.8px;color:#6B7280">${esc([r.refNo ? `Ref: ${r.refNo}` : "", r.notes || ""].filter(Boolean).join("  ·  "))}</div>` : ""}` },
      category: r.category || "",
      who: [r.payee, r.person].filter(Boolean).join(" / "),
      method: r.method || "",
      spent: r.direction === "expense" ? num(r.amount) : "",
      funds: r.direction === "income" ? num(r.amount) : "",
      balance: signed(r.running),
    }));
    const name = ledger.name || "Personal ledger";
    return tableDocHtml({
      title: "PERSONAL & HOUSEHOLD LEDGER",
      titleUrdu: "ذاتی و گھریلو کھاتہ",
      fileTitle: `${name} — Personal ledger`,
      period,
      ref: `PH-${String(name).replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase()}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
      company,
      orientation: "landscape",
      info: { kicker: isPot ? "THE HOUSE POT · گھر کا پاٹ" : ledger.kind === "person" ? "PERSON · شخص" : "LEDGER · مد", big: name, lines: [["Shows", ledger.balanceLabel || ""], ["Entries", String(rows.length)]] },
      cards: [
        { label: "Opening", urdu: "ابتدائی", value: signed(ledger.opening) },
        { label: "Spent", urdu: "خرچ", value: num(ledger.spent) },
        { label: "Funds in", urdu: "جمع", value: num(ledger.funds), tone: "pos" },
        { label: isPot ? "Left in the pot" : "Closing", urdu: "اختتامی", value: signed(ledger.closing), tone: "hi" },
      ],
      notes: ledger.beforeCount ? [{ tone: "amber", html: `${ledger.beforeCount} earlier entr${ledger.beforeCount === 1 ? "y" : "ies"} (up to ${dmy(ledger.beforeLast)}) are inside the opening balance and are not listed. · پہلے کے اندراجات ابتدائی بیلنس میں شامل ہیں۔` }] : [],
      tables: [
        {
          heading: "Entries · اندراجات",
          columns: cols,
          rows,
          labelKey: "description",
          opening: { label: "Opening balance · ابتدائی بقایا", values: { balance: signed(ledger.opening) } },
          totals: { label: `TOTAL · کل  (${rows.length} entries)`, values: { spent: num(ledger.spent), funds: num(ledger.funds), balance: signed(ledger.closing) } },
          footnote: ledger.truncated ? "Only the first 5,000 entries are listed — narrow the dates for the rest." : undefined,
        },
      ],
      signatures: ["Prepared by · تیار کردہ", "Checked by · تصدیق", "Owner · مالک"],
    });
  }
}

export function printPersonalLedger(ledger: any, period: string, onError: (m: string) => void) {
  return openPrint(() => personalLedgerHtml(ledger, period), onError);
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
