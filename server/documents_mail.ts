/**
 * Email an invoice or a party's statement of account · ای میل — a clean, self-contained HTML
 * copy (works in every mail app), sent from Console → Email.
 *
 *   POST /api/doc-mail/invoice/:id        { to? }  default: the customer's email
 *   POST /api/doc-mail/statement/:partyId { to?, from?, to_date? }  default: the party's email
 */
import { Router, Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { sendMail } from "./mail.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const SEND = ["Super Admin", "Admin", "Finance Manager", "Accountant"];
const rows = async (q: any) => ((await db.execute(q)) as any).rows as any[];
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: any) => "Rs " + Math.round(Number(n) || 0).toLocaleString("en-PK");
const d = (v: any) => (v ? new Date(v).toLocaleDateString("en-GB") : "");
const isDay = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function company() {
  const [p] = await rows(sql`select * from company_profile where id = 1`).catch(() => [null]);
  return p || {};
}

function letterhead(p: any, title: string) {
  const phones = Array.isArray(p.phones) ? p.phones.join(" / ") : p.phones || "";
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:2px solid #13294B;padding-bottom:10px;margin-bottom:14px"><tr>
    <td style="vertical-align:top"><div style="font-size:20px;font-weight:bold;color:#13294B">${esc(p.trade_name || p.legal_name || "HFK Enterprises")}</div>
      <div style="font-size:12px;color:#6B7280">${esc([p.address_lines, p.city, p.country].filter(Boolean).join(", "))}</div>
      <div style="font-size:12px;color:#6B7280">${esc([phones, p.email].filter(Boolean).join(" · "))}${p.ntn ? ` · NTN ${esc(p.ntn)}` : ""}</div></td>
    <td style="text-align:right;vertical-align:top;font-size:18px;font-weight:bold;color:#111827">${esc(title)}</td></tr></table>`;
}
const wrap = (inner: string) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111827;max-width:720px;margin:0 auto">${inner}</div>`;
const th = (t: string, right = false) => `<th style="text-align:${right ? "right" : "left"};padding:6px 8px;background:#F1F4F9;border-bottom:1px solid #CBD5E1;font-size:12px">${t}</th>`;
const td = (t: string, right = false, extra = "") => `<td style="text-align:${right ? "right" : "left"};padding:6px 8px;border-bottom:1px solid #EEF1F5;${extra}">${t}</td>`;

router.post("/invoice/:id(\\d+)", requireRole(SEND), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [inv] = await rows(sql`select i.*, c.company, c.email c_email from invoices i left join contractors c on c.id = i.contractor_id where i.id = ${id} and not i.is_deleted`);
    if (!inv) return res.status(404).json({ error: "Invoice not found" });
    const to = String(req.body?.to || inv.c_email || "").trim();
    if (!to) return res.status(400).json({ error: "The customer has no email — type one · ای میل لکھیں" });
    const lines = await rows(sql`select * from invoice_lines where invoice_id = ${id} order by id`).catch(() => []);
    const notes = await rows(sql`select note_number, kind, amount from credit_notes where invoice_id = ${id} and not is_deleted`);
    const p = await company();
    const body = wrap(`${letterhead(p, "INVOICE")}
      <table width="100%" style="font-size:13px;margin-bottom:12px"><tr>
        <td><b>Bill to</b><br>${esc(inv.company)}</td>
        <td style="text-align:right">Invoice # <b>${esc(inv.invoice_number)}</b><br>Date ${d(inv.invoice_date)}<br>Due ${d(inv.due_date)}</td></tr></table>
      ${inv.route_from || inv.route_to ? `<p>Route: ${esc(inv.route_from)} → ${esc(inv.route_to)}${inv.bilty_number ? ` · Bilty ${esc(inv.bilty_number)}` : ""}</p>` : ""}
      <table width="100%" cellspacing="0" style="border-collapse:collapse">
        <tr>${th("Description")}${th("Qty", true)}${th("Rate", true)}${th("Amount", true)}</tr>
        ${lines.map((l) => `<tr>${td(esc(l.description))}${td(esc(l.qty), true)}${td(money(l.rate), true)}${td(money(l.amount), true)}</tr>`).join("")}
        <tr>${td("<b>Total</b>", false, "border-top:2px solid #13294B")}${td("", true, "border-top:2px solid #13294B")}${td("", true, "border-top:2px solid #13294B")}${td(`<b>${money(inv.total_amount)}</b>`, true, "border-top:2px solid #13294B")}</tr>
        ${inv.paid_amount ? `<tr>${td("Received")}${td("")}${td("")}${td("− " + money(inv.paid_amount), true)}</tr>` : ""}
        ${notes.map((n) => `<tr>${td(`Credit note ${esc(n.note_number)} (${esc(n.kind)})`)}${td("")}${td("")}${td("− " + money(n.amount), true)}</tr>`).join("")}
        <tr>${td("<b>Balance due</b>")}${td("")}${td("")}${td(`<b style="color:#B91C1C">${money(inv.outstanding_balance)}</b>`, true)}</tr>
      </table>
      ${p.invoice_footer_note ? `<p style="color:#6B7280;font-size:12px">${esc(p.invoice_footer_note)}</p>` : ""}`);
    const r = await sendMail({ to, subject: `Invoice ${inv.invoice_number} — ${p.trade_name || "HFK Enterprises"}`, html: body });
    await logAudit({ action: "CREATE", tableName: "email", recordId: id, oldValues: null, newValues: { kind: "invoice", to, ok: r.ok, error: r.error }, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.status(r.ok ? 200 : 400).json({ ...r, to });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** A party's statement for dates: opening, every row with its running balance, closing. */
export async function partyStatement(partyId: number, from: string | null, to: string | null) {
  const [party] = await rows(sql`select * from parties where id = ${partyId} and not is_deleted`);
  if (!party) return null;
  const [b] = await rows(sql`select coalesce(sum(debit - credit) filter (where ${from ? sql`entry_date < ${from}::timestamp` : sql`false`}), 0)::bigint before from party_ledger_entries where party_id = ${partyId} and not is_deleted`);
  const entries = await rows(sql`select id, to_char(entry_date, 'YYYY-MM-DD') as day, raw_date, description, ref_no, method, debit, credit
    from party_ledger_entries where party_id = ${partyId} and not is_deleted
      ${from ? sql`and entry_date >= ${from}::timestamp` : sql``} ${to ? sql`and entry_date < (${to}::date + 1)::timestamp` : sql``}
    order by entry_date nulls last, section_label, sr_no, id`);
  const opening = Number(party.opening_balance || 0) + Number(b?.before || 0);
  let run = opening;
  const lines = entries.map((e) => {
    run += Number(e.debit || 0) - Number(e.credit || 0);
    return { ...e, balance: run };
  });
  const debit = entries.reduce((s, e) => s + Number(e.debit || 0), 0);
  const credit = entries.reduce((s, e) => s + Number(e.credit || 0), 0);
  return { party, from, to, opening, debit, credit, closing: opening + debit - credit, lines };
}

router.post("/statement/:partyId(\\d+)", requireRole(SEND), async (req: AuthRequest, res: Response) => {
  try {
    const st = await partyStatement(parseInt(req.params.partyId), isDay(req.body?.from) ? req.body.from : null, isDay(req.body?.toDate) ? req.body.toDate : null);
    if (!st) return res.status(404).json({ error: "Party not found" });
    const to = String(req.body?.to || st.party.email || "").trim();
    if (!to) return res.status(400).json({ error: "The party has no email — add it in Details, or type one · ای میل لکھیں" });
    const p = await company();
    const sign = (n: number) => `${money(Math.abs(n))} ${n > 0 ? "Dr" : n < 0 ? "Cr" : ""}`;
    const period = st.from || st.to ? `${st.from ? d(st.from) : "start"} – ${st.to ? d(st.to) : d(new Date())}` : `up to ${d(new Date())}`;
    const body = wrap(`${letterhead(p, "STATEMENT OF ACCOUNT")}
      <table width="100%" style="margin-bottom:12px"><tr><td><b>${esc(st.party.name)}</b><br>${esc([st.party.address, st.party.city].filter(Boolean).join(", "))}</td>
        <td style="text-align:right">${esc(st.party.party_code)}<br>Period: ${esc(period)}</td></tr></table>
      <table width="100%" cellspacing="0" style="border-collapse:collapse">
        <tr>${th("Date")}${th("Details")}${th("Debit", true)}${th("Credit", true)}${th("Balance", true)}</tr>
        <tr>${td("")}${td("<b>Opening balance</b>")}${td("")}${td("")}${td(sign(st.opening), true)}</tr>
        ${st.lines.map((l) => `<tr>${td(l.day ? d(l.day) : esc(l.raw_date || ""))}${td(esc([l.description, l.ref_no].filter(Boolean).join(" · ")))}${td(l.debit ? money(l.debit) : "", true)}${td(l.credit ? money(l.credit) : "", true)}${td(sign(l.balance), true)}</tr>`).join("")}
        <tr>${td("", false, "border-top:2px solid #13294B")}${td("<b>Closing balance</b>", false, "border-top:2px solid #13294B")}${td(money(st.debit), true, "border-top:2px solid #13294B")}${td(money(st.credit), true, "border-top:2px solid #13294B")}${td(`<b>${sign(st.closing)}</b>`, true, "border-top:2px solid #13294B")}</tr>
      </table>
      <p style="font-size:14px;margin-top:14px"><b>${st.closing > 0 ? `Amount due from you: ${money(st.closing)}` : st.closing < 0 ? `Amount payable to you: ${money(-st.closing)}` : "Your account is clear."}</b></p>
      <p style="color:#6B7280;font-size:12px">Dr = owed to ${esc(p.trade_name || "HFK Enterprises")}, Cr = owed to you. Please tell us within 7 days if anything does not match your records.</p>`);
    const r = await sendMail({ to, subject: `Statement of account — ${st.party.name} — ${p.trade_name || "HFK Enterprises"}`, html: body });
    await logAudit({ action: "CREATE", tableName: "email", recordId: st.party.id, oldValues: null, newValues: { kind: "statement", to, ok: r.ok, error: r.error }, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.status(r.ok ? 200 : 400).json({ ...r, to });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/statement/:partyId(\\d+)", requireRole(SEND.concat(["Auditor", "Operations Manager"])), async (req: AuthRequest, res: Response) => {
  try {
    const st = await partyStatement(parseInt(req.params.partyId), isDay(req.query.from) ? (req.query.from as string) : null, isDay(req.query.to) ? (req.query.to as string) : null);
    if (!st) return res.status(404).json({ error: "Party not found" });
    res.json({ ...st, company: await company() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
