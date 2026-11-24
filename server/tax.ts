/**
 * Tax · ٹیکس — withholding tax registers and the year's tax summary.
 *
 * The system never assumes a tax rate: the rates (and their sections) are entered by the
 * company's tax consultant under "Rates", and only then is anything worked out from them.
 * Filing on FBR (IRIS) is done by the company / consultant; this keeps the figures ready.
 *
 *   deducted_from_us  a customer (or anyone paying us) kept tax from our freight — our advance tax
 *                     (books: Dr 1102 advance tax / Cr the customer or party). Keep the certificate no.
 *   we_deducted       we kept tax from a payment we made — owed to FBR (Dr the party / Cr 2300)
 *   deposited         paid to FBR with a CPR / challan (Dr 2300 / Cr bank to match 1009 — the bank
 *                     statement line then matches it)
 *
 *   GET/PUT /api/tax/rates
 *   GET     /api/tax/entries?kind=&from=&to=     POST /api/tax/entries     PUT/DELETE /api/tax/entries/:id
 *   GET     /api/tax/summary?from=&to=
 *   GET     /api/tax/export?kind=&from=&to=      CSV for the consultant
 */
import { Router, Response } from "express";
import { sql, SQL } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { rebuildIfStale } from "./books.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];
const rows = async (q: SQL) => ((await db.execute(q)) as any).rows as any[];
const n = (v: any) => Math.round(Number(v || 0));
const err = (e: any) => e?.cause?.message || e?.message || String(e);
const KINDS = ["deducted_from_us", "we_deducted", "deposited"];

/** What the consultant fills in. Labels only — no rate is assumed. */
const RATE_ROWS: Array<{ code: string; label: string }> = [
  { code: "freight_received", label: "Tax customers deduct from our freight / transport receipts · کرایے سے کٹنے والا ٹیکس" },
  { code: "services_paid", label: "Tax we deduct when paying for services (garage, broker, agent…) · خدمات کی ادائیگی پر" },
  { code: "goods_paid", label: "Tax we deduct when paying for goods (parts, tyres…) · سامان کی ادائیگی پر" },
  { code: "rent_paid", label: "Tax we deduct on rent we pay · کرایہ (رینٹ) پر" },
  { code: "salary", label: "Tax on salaries above the limit · تنخواہ پر" },
  { code: "vehicle_advance", label: "Advance tax on goods vehicles (with token tax) · گاڑیوں کا ایڈوانس ٹیکس" },
  { code: "bank_cash", label: "Tax banks deduct (e.g. on cash withdrawal), if any · بینک کا کاٹا ہوا ٹیکس" },
  { code: "sales_tax_services", label: "Provincial sales tax on transport services, if registered · سیلز ٹیکس (صوبائی)" },
  { code: "corporate", label: "Company income tax rate (Pvt Ltd) · کمپنی انکم ٹیکس" },
];

let ensured = false;
async function ensureRates() {
  if (ensured) return;
  for (const r of RATE_ROWS) await db.execute(sql`insert into tax_rates (code, label) values (${r.code}, ${r.label}) on conflict (code) do nothing`);
  ensured = true;
}
const audit = (req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", table: string, id: number, oldV: unknown, newV: unknown) =>
  logAudit({ action, tableName: table, recordId: id, oldValues: oldV, newValues: newV, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});

function fy(q: any) {
  const ok = (s: any) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const now = new Date();
  const y = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return { from: ok(q.from) || `${y}-07-01`, to: ok(q.to) || `${y + 1}-06-30` };
}

router.get("/rates", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    await ensureRates();
    res.json(await rows(sql`select id, code, label, section, rate, notes, updated_at from tax_rates order by id`));
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.put("/rates", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    await ensureRates();
    const list = Array.isArray(req.body) ? req.body : [];
    for (const r of list) {
      const rate = r.rate === "" || r.rate == null ? null : Number(r.rate);
      if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) return res.status(400).json({ error: `Rate for ${r.code} must be a percent between 0 and 100` });
      await db.execute(sql`update tax_rates set rate = ${rate}, section = ${r.section ? String(r.section).slice(0, 60) : null}, notes = ${r.notes ? String(r.notes).slice(0, 300) : null}, updated_at = now(), updated_by = ${req.user?.id ?? null} where code = ${String(r.code)}`);
    }
    await audit(req, "UPDATE", "tax_rates", 0, null, list);
    res.json(await rows(sql`select id, code, label, section, rate, notes, updated_at from tax_rates order by id`));
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.get("/entries", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = fy(req.query);
    const kind = KINDS.includes(String(req.query.kind)) ? String(req.query.kind) : null;
    res.json(
      await rows(sql`select t.*, p.name party, c.company customer, i.invoice_number
        from tax_entries t left join parties p on p.id = t.party_id left join contractors c on c.id = t.contractor_id left join invoices i on i.id = t.invoice_id
        where not t.is_deleted ${kind ? sql`and t.kind = ${kind}` : sql``}
          and t.entry_date >= ${from}::timestamp and t.entry_date < (${to}::date + 1)::timestamp
        order by t.entry_date desc, t.id desc limit 2000`),
    );
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

async function clean(b: any) {
  const kind = String(b.kind || "");
  if (!KINDS.includes(kind)) throw new Error("Which register? · کون سا رجسٹر؟");
  const date = typeof b.entryDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(b.entryDate) ? b.entryDate.slice(0, 10) : null;
  if (!date) throw new Error("Enter the date · تاریخ لکھیں");
  const gross = Math.max(0, Math.round(Number(b.grossAmount) || 0));
  let tax = Math.max(0, Math.round(Number(b.taxAmount) || 0));
  const rateCode = b.rateCode ? String(b.rateCode) : null;
  if (!tax && gross && rateCode) {
    // only from a rate the consultant has set
    const [r] = await rows(sql`select rate from tax_rates where code = ${rateCode}`);
    if (r?.rate != null) tax = Math.round((gross * Number(r.rate)) / 100);
  }
  if (!tax) throw new Error("Enter the tax amount (or set the rate under Rates first) · ٹیکس کی رقم لکھیں");
  return {
    kind,
    date,
    forMonth: kind === "deposited" ? (typeof b.forMonth === "string" && /^\d{4}-\d{2}$/.test(b.forMonth) ? b.forMonth : date.slice(0, 7)) : null,
    rateCode,
    partyName: b.partyName ? String(b.partyName).slice(0, 200) : null,
    partyId: b.partyId ? Number(b.partyId) : null,
    contractorId: b.contractorId ? Number(b.contractorId) : null,
    invoiceId: b.invoiceId ? Number(b.invoiceId) : null,
    ntnCnic: b.ntnCnic ? String(b.ntnCnic).slice(0, 40) : null,
    gross,
    tax,
    certificateNo: b.certificateNo ? String(b.certificateNo).slice(0, 80) : null,
    cprNo: b.cprNo ? String(b.cprNo).slice(0, 80) : null,
    method: b.method ? String(b.method).slice(0, 40) : null,
    notes: b.notes ? String(b.notes).slice(0, 500) : null,
  };
}

router.post("/entries", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const v = await clean(req.body || {});
    const [row] = await rows(sql`insert into tax_entries (kind, entry_date, for_month, rate_code, party_name, party_id, contractor_id, invoice_id, ntn_cnic, gross_amount, tax_amount, certificate_no, cpr_no, method, notes, created_by)
      values (${v.kind}, ${v.date}::timestamp, ${v.forMonth}, ${v.rateCode}, ${v.partyName}, ${v.partyId}, ${v.contractorId}, ${v.invoiceId}, ${v.ntnCnic}, ${v.gross}, ${v.tax}, ${v.certificateNo}, ${v.cprNo}, ${v.method}, ${v.notes}, ${req.user?.id ?? null}) returning *`);
    await audit(req, "CREATE", "tax_entries", row.id, null, row);
    res.json(row);
  } catch (e: any) {
    res.status(400).json({ error: err(e) });
  }
});

router.put("/entries/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await rows(sql`select * from tax_entries where id = ${id} and not is_deleted`);
    if (!old) return res.status(404).json({ error: "Not found" });
    const v = await clean({ ...req.body, kind: req.body?.kind || old.kind });
    const [row] = await rows(sql`update tax_entries set kind = ${v.kind}, entry_date = ${v.date}::timestamp, for_month = ${v.forMonth}, rate_code = ${v.rateCode}, party_name = ${v.partyName}, party_id = ${v.partyId},
        contractor_id = ${v.contractorId}, invoice_id = ${v.invoiceId}, ntn_cnic = ${v.ntnCnic}, gross_amount = ${v.gross}, tax_amount = ${v.tax}, certificate_no = ${v.certificateNo}, cpr_no = ${v.cprNo},
        method = ${v.method}, notes = ${v.notes}, updated_at = now(), updated_by = ${req.user?.id ?? null} where id = ${id} returning *`);
    await audit(req, "UPDATE", "tax_entries", id, old, row);
    res.json(row);
  } catch (e: any) {
    res.status(400).json({ error: err(e) });
  }
});

router.delete("/entries/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await rows(sql`select * from tax_entries where id = ${id}`);
    await db.execute(sql`update tax_entries set is_deleted = true, deleted_at = now(), deleted_by = ${req.user?.id ?? null}, updated_at = now() where id = ${id}`);
    await audit(req, "DELETE", "tax_entries", id, old, null);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.get("/summary", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    await ensureRates();
    await rebuildIfStale("tax summary opened");
    const { from, to } = fy(req.query);
    const F = sql`${from}::timestamp`;
    const T = sql`(${to}::date + 1)::timestamp`;
    const [pl] = await rows(sql`select
        coalesce(sum(case when a.type = 'Income' and a.code in ('4000', '4001', '4098') then l.credit - l.debit end), 0)::bigint turnover,
        coalesce(sum(case when a.type = 'Income' then l.credit - l.debit when a.type = 'Expense' then l.credit - l.debit end), 0)::bigint profit,
        coalesce(sum(case when a.code = '2100' then l.credit - l.debit end), 0)::bigint sales_tax,
        coalesce(sum(case when a.code = '1102' then l.debit - l.credit end), 0)::bigint advance_tax
      from journal_lines l join journal_entries j on j.id = l.journal_entry_id and not j.is_deleted join accounts a on a.id = l.account_id
      where not l.is_deleted and j.entry_date >= ${F} and j.entry_date < ${T}`);
    const [t] = await rows(sql`select
        coalesce(sum(tax_amount) filter (where kind = 'deducted_from_us'), 0)::bigint from_us,
        count(*) filter (where kind = 'deducted_from_us' and coalesce(certificate_no, '') = '')::int from_us_no_cert,
        coalesce(sum(tax_amount) filter (where kind = 'we_deducted'), 0)::bigint we_deducted,
        coalesce(sum(tax_amount) filter (where kind = 'deposited'), 0)::bigint deposited
      from tax_entries where not is_deleted and entry_date >= ${F} and entry_date < ${T}`);
    const [bank] = await rows(sql`select coalesce(sum(withdrawal), 0)::bigint b from bank_statement_lines where not is_deleted and kind = 'tax' and txn_date >= ${F} and txn_date < ${T}`).catch(() => [{ b: 0 }]);
    const months = await rows(sql`with d as (select to_char(entry_date, 'YYYY-MM') m, sum(tax_amount) w from tax_entries where not is_deleted and kind = 'we_deducted' and entry_date >= ${F} and entry_date < ${T} group by 1),
        p as (select for_month m, sum(tax_amount) p from tax_entries where not is_deleted and kind = 'deposited' and for_month between ${from.slice(0, 7)} and ${to.slice(0, 7)} group by 1)
      select coalesce(d.m, p.m) m, coalesce(d.w, 0)::bigint withheld, coalesce(p.p, 0)::bigint deposited from d full join p on p.m = d.m order by 1`);
    const rates = await rows(sql`select code, label, section, rate from tax_rates order by id`);
    const corp = rates.find((r) => r.code === "corporate");
    const profit = n(pl?.profit);
    const estimate = corp?.rate != null && profit > 0 ? Math.round((profit * Number(corp.rate)) / 100) : null;
    res.json({
      from,
      to,
      turnover: n(pl?.turnover),
      profit,
      salesTaxCharged: n(pl?.sales_tax),
      advanceTaxInBooks: n(pl?.advance_tax),
      deductedFromUs: n(t?.from_us),
      deductedFromUsNoCertificate: n(t?.from_us_no_cert),
      deductedByBank: n(bank?.b),
      weDeducted: n(t?.we_deducted),
      deposited: n(t?.deposited),
      notDeposited: n(t?.we_deducted) - n(t?.deposited),
      months: months.map((m) => ({ month: m.m, withheld: n(m.withheld), deposited: n(m.deposited), pending: n(m.withheld) - n(m.deposited) })),
      corporateRate: corp?.rate != null ? Number(corp.rate) : null,
      estimatedTax: estimate,
      estimatedAfterAdvance: estimate == null ? null : estimate - n(pl?.advance_tax),
      ratesMissing: rates.filter((r) => r.rate == null).length,
    });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.get("/export", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = fy(req.query);
    const kind = KINDS.includes(String(req.query.kind)) ? String(req.query.kind) : "deducted_from_us";
    const list = await rows(sql`select to_char(t.entry_date, 'DD.MM.YYYY') date, coalesce(t.party_name, p.name, c.company, '') name, coalesce(t.ntn_cnic, '') ntn_cnic, coalesce(r.label, '') type, coalesce(r.section, '') section,
        t.gross_amount, t.tax_amount, coalesce(t.certificate_no, '') certificate, coalesce(t.cpr_no, '') cpr, coalesce(t.for_month, '') for_month, coalesce(i.invoice_number, '') invoice, coalesce(t.notes, '') notes
      from tax_entries t left join parties p on p.id = t.party_id left join contractors c on c.id = t.contractor_id left join invoices i on i.id = t.invoice_id left join tax_rates r on r.code = t.rate_code
      where not t.is_deleted and t.kind = ${kind} and t.entry_date >= ${from}::timestamp and t.entry_date < (${to}::date + 1)::timestamp order by t.entry_date, t.id`);
    const cols = ["date", "name", "ntn_cnic", "type", "section", "gross_amount", "tax_amount", "certificate", "cpr", "for_month", "invoice", "notes"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...list.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tax-${kind}-${from}-${to}.csv"`);
    res.send("﻿" + csv);
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

export default router;
