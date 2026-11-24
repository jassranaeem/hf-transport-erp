/**
 * Party Statement of Account · کھاتے کا گوشوارہ as a proper printed / PDF document: letterhead, the party's
 * details, opening → debit → credit → closing (amount due), every entry in full with its running balance,
 * and signature lines (including the party's confirmation of the balance).
 */
import { PCol, dmy, openPrint, tableDocHtml } from "./printDoc.ts";

const money = (n: number) => Math.round(Math.abs(n || 0)).toLocaleString("en-US");
const drcr = (n: number) => (n > 0 ? "Dr" : n < 0 ? "Cr" : "");
const bal = (n: number) => `${money(n)} ${drcr(n)}`.trim();

export function partyStatementHtml(st: any, period: string): string {
  const c = st.company || {};
  const company = {
    tradeName: c.trade_name,
    legalName: c.legal_name,
    addressLines: c.address_lines,
    city: c.city,
    country: c.country,
    phones: c.phones,
    email: c.email,
    ntn: c.ntn,
    logoDataUrl: c.logo_data_url,
  };
  const p = st.party || {};
  const closing = Number(st.closing) || 0;
  const cols: PCol[] = [
    { key: "date", label: "Date · تاریخ", width: "72px", nowrap: true },
    { key: "details", label: "Details · تفصیل" },
    { key: "debit", label: "Debit · ڈیبٹ", align: "right", width: "92px", tone: "out" },
    { key: "credit", label: "Credit · کریڈٹ", align: "right", width: "92px", tone: "in" },
    { key: "balance", label: "Balance · بقایا", align: "right", width: "104px", tone: "bal" },
  ];
  const rows = (st.lines || []).map((l: any) => ({
    date: l.day ? dmy(l.day) : l.raw_date || "—",
    details: { html: `${escHtml(l.description || "—")}${l.ref_no ? `<div style="font-size:8.8px;color:#6B7280">Ref: ${escHtml(l.ref_no)}</div>` : ""}` },
    debit: l.debit ? money(l.debit) : "",
    credit: l.credit ? money(l.credit) : "",
    balance: bal(Number(l.balance) || 0),
  }));
  return tableDocHtml({
    title: "STATEMENT OF ACCOUNT",
    titleUrdu: "کھاتے کا گوشوارہ",
    fileTitle: `${p.name || "Party"} — Statement of Account`,
    period,
    ref: `SOA-${String(p.party_code || p.id || "").replace(/[^A-Za-z0-9]/g, "")}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
    company,
    orientation: "portrait",
    info: {
      kicker: "ACCOUNT OF · کھاتہ",
      big: p.name || "",
      lines: ([["Code", p.party_code], ["Address", [p.address, p.city].filter(Boolean).join(", ")], ["Phone", p.phone], ["NTN", p.ntn]].filter(([, v]) => v) as Array<[string, string]>),
    },
    cards: [
      { label: "Opening", urdu: "ابتدائی", value: bal(Number(st.opening) || 0) },
      { label: "Total debit", urdu: "ڈیبٹ", value: money(Number(st.debit) || 0) },
      { label: "Total credit", urdu: "کریڈٹ", value: money(Number(st.credit) || 0), tone: "pos" },
      { label: closing > 0 ? "Amount due from you" : closing < 0 ? "Payable to you" : "Account clear", urdu: "اختتامی", value: money(closing), tone: "hi" },
    ],
    tables: [
      {
        heading: "Entries · اندراجات",
        columns: cols,
        rows,
        labelKey: "details",
        opening: { label: "Opening balance · ابتدائی بقایا", values: { balance: bal(Number(st.opening) || 0) } },
        totals: { label: `TOTAL · کل  (${rows.length} entries)`, values: { debit: money(Number(st.debit) || 0), credit: money(Number(st.credit) || 0), balance: bal(closing) } },
        footnote: "Dr = the party owes us · Cr = we owe the party. Balance = opening + debit − credit. If anything differs from your records, please tell us. · کوئی فرق ہو تو ہمیں بتائیں۔",
      },
    ],
    signatures: ["Prepared by · تیار کردہ", "Authorised signatory · مجاز دستخط", "Balance confirmed by party (sign, stamp, date) · پارٹی کی تصدیق"],
  });
}

const escHtml = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

export function printPartyStatement(st: any, period: string, onError: (m: string) => void) {
  return openPrint(async () => partyStatementHtml(st, period), onError);
}
