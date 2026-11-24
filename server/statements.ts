/**
 * Statements · حسابات — the year-end accounts, read from the books (server/books.ts) by date.
 *
 *   GET /api/statements/pnl?from=&to=            profit & loss by account
 *   GET /api/statements/pnl-trucks?from=&to=     profit & loss for each truck (and office / not per truck)
 *   GET /api/statements/pnl-months?from=&to=     profit & loss account × month
 *   GET /api/statements/balance-sheet?asOf=      assets, liabilities, equity — earlier years' and this year's profit
 *   GET /api/statements/cash-flow?from=&to=      where cash & bank money came from and went
 *   GET /api/statements/partners?from=&to=       each partner's account: opening, share, taken, closing
 */
import { Router, Response } from "express";
import { sql, SQL } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db } from "../src/db/index.ts";
import { rebuildIfStale } from "./books.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor"];
const rows = async (q: SQL) => ((await db.execute(q)) as any).rows as any[];
const n = (v: any) => Math.round(Number(v || 0));
const err = (e: any) => e?.cause?.message || e?.message || String(e);

const ok = (s: any) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
function period(q: any) {
  const now = new Date();
  const fy = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const from = ok(q.from) || `${fy}-07-01`;
  const to = ok(q.to) || `${fy + 1}-06-30`;
  return { from, to, F: sql`${from}::timestamp`, T: sql`(${to}::date + 1)::timestamp` };
}
const fyStartOf = (day: string) => {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return `${m >= 7 ? y : y - 1}-07-01`;
};

// a line, with its account and the books' own truck / party dimensions
const LINES = sql`journal_lines l join journal_entries j on j.id = l.journal_entry_id and not j.is_deleted join accounts a on a.id = l.account_id`;

router.use(async (_req, _res, next) => {
  await rebuildIfStale("statements opened");
  next();
});

router.get("/pnl", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, F, T } = period(req.query);
    const list = await rows(sql`select a.code, a.name, a.type, sum(case when a.type = 'Income' then l.credit - l.debit else l.debit - l.credit end)::bigint amount
      from ${LINES} where not l.is_deleted and a.type in ('Income', 'Expense') and j.entry_date >= ${F} and j.entry_date < ${T}
      group by a.code, a.name, a.type having sum(l.debit) <> 0 or sum(l.credit) <> 0 order by a.type desc, a.code`);
    const income = list.filter((r) => r.type === "Income").map((r) => ({ code: r.code, name: r.name, amount: n(r.amount) }));
    const expenses = list.filter((r) => r.type === "Expense").map((r) => ({ code: r.code, name: r.name, amount: n(r.amount) }));
    const ti = income.reduce((s, r) => s + r.amount, 0);
    const te = expenses.reduce((s, r) => s + r.amount, 0);
    res.json({ from, to, income, expenses, totalIncome: ti, totalExpenses: te, profit: ti - te });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

/** The truck a line belongs to: its own dimension, else the invoice's truck for invoice entries. */
const TRUCK = sql`coalesce(
    (select upper(regexp_replace(v.vehicle_number, '[^A-Za-z0-9]', '', 'g')) from vehicles v where v.id = l.vehicle_id),
    (select upper(regexp_replace(t.registration, '[^A-Za-z0-9]', '', 'g')) from truck_ledgers t where t.id = l.truck_ledger_id),
    (select upper(regexp_replace(v.vehicle_number, '[^A-Za-z0-9]', '', 'g')) from invoices i join vehicles v on v.id = i.vehicle_id where j.entry_number like 'JE-INV-%' and i.id = j.source_id))`;

router.get("/pnl-trucks", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, F, T } = period(req.query);
    const list = await rows(sql`with x as (
        select ${TRUCK} truck, a.code, a.name, a.type, case when a.type = 'Income' then l.credit - l.debit else l.debit - l.credit end amt
        from ${LINES} where not l.is_deleted and a.type in ('Income', 'Expense') and j.entry_date >= ${F} and j.entry_date < ${T})
      select coalesce(truck, '') truck, code, name, type, sum(amt)::bigint amount from x group by 1, 2, 3, 4 having sum(amt) <> 0`);
    const byTruck = new Map<string, { truck: string; income: number; expenses: number; lines: Array<{ code: string; name: string; type: string; amount: number }> }>();
    for (const r of list) {
      const k = r.truck || "";
      const t = byTruck.get(k) || { truck: k, income: 0, expenses: 0, lines: [] };
      const amt = n(r.amount);
      if (r.type === "Income") t.income += amt;
      else t.expenses += amt;
      t.lines.push({ code: r.code, name: r.name, type: r.type, amount: amt });
      byTruck.set(k, t);
    }
    // pretty plate: "TLE730" → the way it is written on a khata
    const names = new Map(
      (await rows(sql`select distinct on (upper(regexp_replace(registration, '[^A-Za-z0-9]', '', 'g'))) upper(regexp_replace(registration, '[^A-Za-z0-9]', '', 'g')) k, registration from truck_ledgers where not is_deleted order by 1, id`)).map((r) => [r.k, r.registration]),
    );
    const trucks = [...byTruck.values()]
      .map((t) => ({ ...t, label: t.truck ? names.get(t.truck) || t.truck : "Office / not per truck · دفتر", profit: t.income - t.expenses, lines: t.lines.sort((a, b) => a.code.localeCompare(b.code)) }))
      .sort((a, b) => (a.truck ? 0 : 1) - (b.truck ? 0 : 1) || b.profit - a.profit);
    res.json({ from, to, trucks, totalIncome: trucks.reduce((s, t) => s + t.income, 0), totalExpenses: trucks.reduce((s, t) => s + t.expenses, 0) });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.get("/pnl-months", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, F, T } = period(req.query);
    const list = await rows(sql`select a.code, a.name, a.type, to_char(j.entry_date, 'YYYY-MM') m,
        sum(case when a.type = 'Income' then l.credit - l.debit else l.debit - l.credit end)::bigint amount
      from ${LINES} where not l.is_deleted and a.type in ('Income', 'Expense') and j.entry_date >= ${F} and j.entry_date < ${T}
      group by 1, 2, 3, 4 having sum(l.debit) <> 0 or sum(l.credit) <> 0`);
    const months: string[] = [];
    for (let d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
    const acc = new Map<string, { code: string; name: string; type: string; byMonth: Record<string, number>; total: number }>();
    for (const r of list) {
      const a = acc.get(r.code) || { code: r.code, name: r.name, type: r.type, byMonth: {}, total: 0 };
      a.byMonth[r.m] = n(r.amount);
      a.total += n(r.amount);
      acc.set(r.code, a);
    }
    const accounts = [...acc.values()].sort((a, b) => (a.type === b.type ? a.code.localeCompare(b.code) : a.type === "Income" ? -1 : 1));
    const profitByMonth = Object.fromEntries(months.map((m) => [m, accounts.reduce((s, a) => s + (a.type === "Income" ? 1 : -1) * (a.byMonth[m] || 0), 0)]));
    res.json({ from, to, months, accounts, profitByMonth });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.get("/balance-sheet", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const asOf = ok(req.query.asOf) || new Date().toISOString().slice(0, 10);
    const fyStart = fyStartOf(asOf);
    const END = sql`(${asOf}::date + 1)::timestamp`;
    const list = await rows(sql`select a.code, a.name, a.type, sum(l.debit - l.credit)::bigint bal
      from ${LINES} where not l.is_deleted and a.type in ('Asset', 'Liability', 'Equity') and j.entry_date < ${END}
      group by 1, 2, 3 having sum(l.debit - l.credit) <> 0 order by a.code`);
    const [pl] = await rows(sql`select
        coalesce(sum(case when j.entry_date < ${fyStart}::timestamp then l.credit - l.debit end), 0)::bigint before,
        coalesce(sum(case when j.entry_date >= ${fyStart}::timestamp then l.credit - l.debit end), 0)::bigint this_year
      from ${LINES} where not l.is_deleted and a.type in ('Income', 'Expense') and j.entry_date < ${END}`);
    const assets = list.filter((r) => r.type === "Asset").map((r) => ({ code: r.code, name: r.name, amount: n(r.bal) }));
    const liabilities = list.filter((r) => r.type === "Liability").map((r) => ({ code: r.code, name: r.name, amount: -n(r.bal) }));
    const equity = list.filter((r) => r.type === "Equity").map((r) => ({ code: r.code, name: r.name, amount: -n(r.bal) }));
    const retained = n(pl?.before);
    const profit = n(pl?.this_year);
    const ta = assets.reduce((s, r) => s + r.amount, 0);
    const tl = liabilities.reduce((s, r) => s + r.amount, 0);
    const te = equity.reduce((s, r) => s + r.amount, 0) + retained + profit;
    res.json({ asOf, fyStart, assets, liabilities, equity, retainedEarlier: retained, profitThisYear: profit, totalAssets: ta, totalLiabilities: tl, totalEquity: te, difference: ta - tl - te });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

/** Cash & bank: cash on hand, the bank GL and each bank's own account. */
const CASHLIKE = sql`(a.code = '1001' or a.code = '1002' or a.code like '12__')`;
const SECTION = (code: SQL, type: SQL) => sql`case
    when ${type} in ('Income', 'Expense') or ${code} in ('1060', '1070', '1100', '1102', '1150', '2000', '1095', '1096', '1097', '1098', '1009') then 'Operating · کاروبار'
    when ${code} in ('1500') then 'Trucks & assets · ٹرک اور اثاثے'
    when ${code} in ('2200', '3100', '3900', '1099') or ${type} = 'Equity' then 'Owners, partners & transfers · مالک اور شریک'
    else 'Other · دیگر' end`;

router.get("/cash-flow", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, F, T } = period(req.query);
    const [open] = await rows(sql`select coalesce(sum(l.debit - l.credit), 0)::bigint b from ${LINES} where not l.is_deleted and ${CASHLIKE} and j.entry_date < ${F}`);
    // for each entry that moved cash, spread the cash over its other lines (usually one)
    const list = await rows(sql`with e as (
        select j.id, sum(case when ${CASHLIKE} then l.debit - l.credit else 0 end) cash
        from ${LINES} where not l.is_deleted and j.entry_date >= ${F} and j.entry_date < ${T}
        group by j.id having sum(case when ${CASHLIKE} then l.debit - l.credit else 0 end) <> 0),
      o as (
        select e.id, e.cash, a.code, a.name, a.type, (l.credit - l.debit) amt,
               sum(abs(l.credit - l.debit)) over (partition by e.id) tot
        from e join journal_lines l on l.journal_entry_id = e.id and not l.is_deleted join accounts a on a.id = l.account_id
        where not ${CASHLIKE})
      select ${SECTION(sql`o.code`, sql`o.type`)} section, o.code, o.name,
             round(sum(case when o.tot = 0 then 0 else o.cash * abs(o.amt) / o.tot end))::bigint amount
      from o group by 1, 2, 3 having round(sum(case when o.tot = 0 then 0 else o.cash * abs(o.amt) / o.tot end)) <> 0
      order by 1, 2`);
    const sections = new Map<string, { section: string; total: number; lines: any[] }>();
    for (const r of list) {
      const s = sections.get(r.section) || { section: r.section, total: 0, lines: [] };
      s.total += n(r.amount);
      s.lines.push({ code: r.code, name: r.name, amount: n(r.amount) });
      sections.set(r.section, s);
    }
    const opening = n(open?.b);
    const change = [...sections.values()].reduce((s, x) => s + x.total, 0);
    const [close] = await rows(sql`select coalesce(sum(l.debit - l.credit), 0)::bigint b from ${LINES} where not l.is_deleted and ${CASHLIKE} and j.entry_date < ${T}`);
    res.json({ from, to, opening, sections: [...sections.values()], change, closing: n(close?.b), difference: opening + change - n(close?.b) });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.get("/partners", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, F, T } = period(req.query);
    const list = await rows(sql`select p.id, p.name,
        coalesce(sum(case when j.entry_date < ${F} then l.credit - l.debit end), 0)::bigint opening,
        coalesce(sum(case when j.entry_date >= ${F} and j.entry_date < ${T} then l.credit end), 0)::bigint added,
        coalesce(sum(case when j.entry_date >= ${F} and j.entry_date < ${T} then l.debit end), 0)::bigint taken,
        coalesce(sum(case when j.entry_date < ${T} then l.credit - l.debit end), 0)::bigint closing
      from ${LINES} join parties p on p.id = l.party_id
      where not l.is_deleted and a.code = '2200'
      group by p.id, p.name order by p.name`);
    res.json({ from, to, partners: list.map((r) => ({ id: r.id, name: r.name, opening: n(r.opening), added: n(r.added), taken: n(r.taken), closing: n(r.closing) })) });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

export default router;
