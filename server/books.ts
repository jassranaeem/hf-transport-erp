/**
 * The books · کتاب — one double-entry book built from every module, by itself.
 *
 * Rule: every rupee is posted ONCE, from where it really moved. The engine re-builds its own
 * journal entries (is_auto) from the source rows each time — set-based SQL in one transaction,
 * so a correction anywhere (an edited date, a deleted row, a re-categorised khata line) is in the
 * books after the next rebuild, and nothing can be left behind or counted twice.
 *
 *   Daily Cash Book       Cash on hand ↔ what it is linked to (truck account, party, partner,
 *                         director for household / zakat; not linked → "cash book — not linked")
 *   Truck khata row       income / expense by its category (posting_rules) ↔ the truck's account
 *                         (1060 — money with the truck / office for it). Kiraya tied to a trip
 *                         that has an invoice clears the customer (1100) instead of revenue.
 *                         Not posted: side-box figures, carried-forward lines, صافی بچت markers.
 *   Party ledger row      the party (1150) / partner (2200) ↔ how it was paid (cash outside the
 *                         cash book 1095, bank 1009, no method 1096). Rows the cash book made are
 *                         posted by the cash book, not again here.
 *   Partner P&L events    partner's profit share ↔ "partners' share of truck profit" (5900);
 *                         withdrawals / payouts / qarz ↔ how paid. HFK's own side is the company.
 *   Household / Zakat     director's current account (3100) ↔ how paid (not via cash book).
 *   Opening (books start) cash, party and partner balances brought in on 01.07.2025, the rest
 *                         to "opening balance equity" (3900) for the accountant to split.
 *
 * Invoices, bills and their payments keep their own entries (finance_engine), re-dated to the
 * document's date. Payments made by "Close trip" (TRIP-…) are not posted again: the khata row
 * that recorded the kiraya clears the customer.
 *
 *   GET  /api/books/status            settings, last rebuild, stale?
 *   POST /api/books/rebuild           rebuild now
 *   GET  /api/books/rules             posting rules + accounts
 *   PUT  /api/books/rules             [{source, category, side, accountCode}]
 *   GET  /api/books/trial-balance     ?from=&to=  opening / movement / closing per account
 *   GET  /api/books/lines             ?code=&from=&to=  an account's entries
 */
import { Router, Response } from "express";
import { sql, SQL } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];

const rows = async (q: SQL, runner: { execute: (q: SQL) => Promise<any> } = db) => ((await runner.execute(q)) as any).rows as any[];

// ---------------------------------------------------------------- chart of accounts the engine needs
export const BOOK_ACCOUNTS: Array<{ code: string; name: string; type: string; category: string; review?: boolean }> = [
  { code: "1001", name: "Cash on Hand", type: "Asset", category: "Cash" },
  { code: "1009", name: "Bank — to match with bank statements", type: "Asset", category: "Bank", review: true },
  { code: "1060", name: "Truck accounts (money with trucks / for them)", type: "Asset", category: "Miscellaneous" },
  { code: "1070", name: "Toman / foreign currency account", type: "Asset", category: "Miscellaneous", review: true },
  { code: "1095", name: "Cash paid / received outside the cash book (trace)", type: "Asset", category: "Cash", review: true },
  { code: "1096", name: "Ledger entries with no payment method (review)", type: "Asset", category: "Miscellaneous", review: true },
  { code: "1097", name: "Cash book entries not linked (review)", type: "Asset", category: "Miscellaneous", review: true },
  { code: "1098", name: "Bank lines not yet explained (review)", type: "Asset", category: "Bank", review: true },
  { code: "1099", name: "Transfers between our own banks (should be zero)", type: "Asset", category: "Bank", review: true },
  { code: "1100", name: "Accounts Receivable", type: "Asset", category: "Accounts Receivable" },
  { code: "1102", name: "Advance Income Tax (WHT) Receivable", type: "Asset", category: "Miscellaneous" },
  { code: "1150", name: "Parties — naam / jama", type: "Asset", category: "Accounts Receivable" },
  { code: "1500", name: "Trucks & capital items (review)", type: "Asset", category: "Miscellaneous", review: true },
  { code: "2000", name: "Accounts Payable", type: "Liability", category: "Accounts Payable" },
  { code: "2200", name: "Partners' accounts", type: "Liability", category: "Miscellaneous" },
  { code: "3100", name: "Director's current account (household, zakat)", type: "Equity", category: "Equity" },
  { code: "3900", name: "Opening balance equity (accountant to split)", type: "Equity", category: "Equity", review: true },
  { code: "4000", name: "Freight Revenue", type: "Income", category: "Revenue" },
  { code: "4001", name: "Other Operating Revenue", type: "Income", category: "Revenue" },
  { code: "4002", name: "Bank profit", type: "Income", category: "Revenue" },
  { code: "4098", name: "Truck income — not classified", type: "Income", category: "Revenue", review: true },
  { code: "5001", name: "Fuel Expense", type: "Expense", category: "Fuel" },
  { code: "5002", name: "Salary Expense", type: "Expense", category: "Salary" },
  { code: "5003", name: "Maintenance Expense", type: "Expense", category: "Maintenance" },
  { code: "5004", name: "Insurance Expense", type: "Expense", category: "Insurance" },
  { code: "5005", name: "Toll Expense", type: "Expense", category: "Toll" },
  { code: "5007", name: "Tyres", type: "Expense", category: "Maintenance" },
  { code: "5008", name: "Border, permits, carnet & visas", type: "Expense", category: "Miscellaneous" },
  { code: "5010", name: "Trip expenses (driver trip cash)", type: "Expense", category: "Miscellaneous" },
  { code: "5095", name: "Cash shortage / excess (cash count)", type: "Expense", category: "Miscellaneous" },
  { code: "5096", name: "Bank charges", type: "Expense", category: "Miscellaneous" },
  { code: "5098", name: "Truck expenses — not classified", type: "Expense", category: "Miscellaneous", review: true },
  { code: "5100", name: "Hired transport / freight paid", type: "Expense", category: "Miscellaneous" },
  { code: "5900", name: "Partners' share of truck profit", type: "Expense", category: "Miscellaneous" },
];
export const REVIEW_CODES = BOOK_ACCOUNTS.filter((a) => a.review).map((a) => a.code);

// ---------------------------------------------------------------- default posting rules (editable)
const DEFAULT_RULES: Array<{ source: string; category: string; side: "in" | "out" | "any"; code: string; note?: string }> = [
  { source: "truck", category: "Freight", side: "in", code: "4000" },
  { source: "truck", category: "Freight", side: "out", code: "5100", note: "freight / hire paid to others" },
  { source: "truck", category: "Diesel", side: "any", code: "5001" },
  { source: "truck", category: "TripCash", side: "any", code: "5010" },
  { source: "truck", category: "Salary", side: "any", code: "5002" },
  { source: "truck", category: "PartsBill", side: "any", code: "5003" },
  { source: "truck", category: "Garage", side: "any", code: "5003" },
  { source: "truck", category: "MobilOil", side: "any", code: "5003" },
  { source: "truck", category: "Battery", side: "any", code: "5003" },
  { source: "truck", category: "Tyre", side: "any", code: "5007" },
  { source: "truck", category: "Insurance", side: "any", code: "5004" },
  { source: "truck", category: "Toll", side: "any", code: "5005" },
  { source: "truck", category: "Permit", side: "any", code: "5008" },
  { source: "truck", category: "Carnet", side: "any", code: "5008" },
  { source: "truck", category: "Visa", side: "any", code: "5008" },
  { source: "truck", category: "TomanFX", side: "any", code: "1070" },
  { source: "truck", category: "Capital", side: "any", code: "1500" },
  { source: "truck", category: "OnlineTransfer", side: "out", code: "5098", note: "paid online — purpose not written" },
  { source: "truck", category: "Other", side: "in", code: "4098" },
  { source: "truck", category: "Other", side: "out", code: "5098" },
];

const CARRY = "قرضدار|qarz\\s*d[ae]r|qarzder|بچت|bach?at|bacht"; // carried-forward lines (partnership.ts CARRY_RE)
const BANKISH = sql`('Bank', 'Online', 'Cheque', 'Card', 'Bank Transfer', 'Online Transfer')`;
const methodCode = (col: SQL) => sql`case when ${col} = 'Cash' then '1095' when ${col} in ${BANKISH} then '1009' else '1096' end`;

let ensured = false;
async function ensureSetup() {
  if (ensured) return;
  for (const a of BOOK_ACCOUNTS) {
    await db.execute(sql`insert into accounts (code, name, type, category, is_active) values (${a.code}, ${a.name}, ${a.type}, ${a.category}, true) on conflict (code) do nothing`);
  }
  for (const r of DEFAULT_RULES) {
    await db.execute(sql`insert into posting_rules (source, category, side, account_code, note) values (${r.source}, ${r.category}, ${r.side}, ${r.code}, ${r.note ?? null}) on conflict (source, category, side) do nothing`);
  }
  await db.execute(sql`insert into books_settings (id) values (1) on conflict do nothing`);
  await ensureFiscalYears();
  ensured = true;
}

/** Fiscal years July–June with 12 monthly periods, from the books start to next year. */
async function ensureFiscalYears() {
  const [s] = await rows(sql`select to_char(books_start, 'YYYY-MM-DD') d from books_settings where id = 1`);
  const start = new Date(`${s?.d || "2025-07-01"}T00:00:00Z`);
  const firstFy = start.getUTCMonth() >= 6 ? start.getUTCFullYear() : start.getUTCFullYear() - 1;
  const now = new Date();
  const lastFy = (now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1) + 1;
  for (let y = firstFy; y <= lastFy; y++) {
    const name = `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    let [fy] = await rows(sql`select id from fiscal_years where name = ${name} and not is_deleted`);
    if (!fy) {
      [fy] = await rows(sql`insert into fiscal_years (name, start_date, end_date, status) values (${name}, ${`${y}-07-01`}::timestamp, ${`${y + 1}-06-30 23:59:59`}::timestamp, 'Open') returning id`);
      for (let m = 0; m < 12; m++) {
        const ms = new Date(Date.UTC(y, 6 + m, 1));
        const me = new Date(Date.UTC(y, 7 + m, 0, 23, 59, 59));
        const pname = ms.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
        await db.execute(sql`insert into accounting_periods (fiscal_year_id, name, start_date, end_date, status) values (${fy.id}, ${pname}, ${ms.toISOString()}::timestamp, ${me.toISOString()}::timestamp, 'Open')`);
      }
    }
  }
}

// ---------------------------------------------------------------- the rebuild
let running: Promise<any> | null = null;

export async function rebuildBooks(reason = "manual", userId?: number) {
  if (running) return running; // one at a time; a second call waits for the same run
  running = (async () => {
    await ensureSetup();
    const t0 = Date.now();
    const stats = await db.transaction(async (tx) => {
      const run = (q: SQL) => rows(q, tx as any);
      // the books' first day, read as text so no time zone can move it
      const [st] = await run(sql`select to_char(books_start, 'YYYY-MM-DD') d from books_settings where id = 1`);
      const START = sql`${st.d}::timestamp`;

      // 1. the engine's own entries go; they are rebuilt below from the source rows
      await run(sql`delete from journal_lines where journal_entry_id in (select id from journal_entries where is_auto)`);
      await run(sql`delete from journal_entries where is_auto`);

      // 2. older automatic postings the engine now owns (they would count the same money twice)
      const legacy = await run(sql`select id from journal_entries j where
          j.entry_number like 'JE-REV-%'
          or (j.entry_number like 'JE-EXP-%' and not exists (select 1 from expenses x where x.id = j.source_id and not x.is_deleted and x.source_entry_id is null))
          or (j.entry_number like 'JE-MNT-%' and not exists (select 1 from vehicle_maintenance m where m.id = j.source_id and not m.is_deleted and m.source_entry_id is null))
          or (j.entry_number like 'JE-PAY-%' and exists (select 1 from payments p where p.id = j.source_id and p.reference_number like 'TRIP-%'))`);
      if (legacy.length) {
        const arr = `{${legacy.map((l) => l.id).join(",")}}`;
        await run(sql`delete from journal_lines where journal_entry_id = any(${arr}::int[])`);
        await run(sql`delete from journal_entries where id = any(${arr}::int[])`);
      }

      // 3. invoices, bills and payments: dated on the document, not the day they were typed
      await run(sql`update journal_entries j set entry_date = i.invoice_date from invoices i where j.entry_number like 'JE-INV-%' and j.source_id = i.id and j.entry_date <> i.invoice_date`);
      await run(sql`update journal_entries j set entry_date = p.payment_date from payments p where j.entry_number like 'JE-PAY-%' and j.source_id = p.id and j.entry_date <> p.payment_date`);
      await run(sql`update journal_entries j set entry_date = b.bill_date from bills b where j.entry_number like 'JE-BILL-%' and j.source_id = b.id and j.entry_date <> b.bill_date`);

      // 4. every source row → two lines in a work table
      await run(sql`create temp table _p (
          source_key text, entry_date timestamp, descr text, code text, debit bigint, credit bigint,
          vehicle_id int, truck_ledger_id int, party_id int, contractor_id int) on commit drop`);
      await run(sql`create temp table _who on commit drop as
          select partner_party_id as party_id, 'partner' as role from partnership_accounts where not is_deleted
          union select hfk_party_id, 'hfk' from partnership_accounts where not is_deleted`);

      // 4a. truck khata
      await run(sql`insert into _p
        with t as (
          select e.id, e.entry_date, e.received, e.paid, coalesce(nullif(e.category, ''), 'Other') category, e.description, e.ledger_id, l.vehicle_id, l.registration,
                 e.received > 0 as is_in, greatest(e.received, e.paid)::bigint amt, e.derived_trip_id
          from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
          where not e.is_deleted and not l.is_deleted and e.entry_date >= ${START}
            and (e.received > 0 or e.paid > 0) and not (e.received > 0 and e.paid > 0)
            and not (e.sr_no is null and e.source_row is not null and e.sheet_balance is null)
            and coalesce(e.category, '') <> 'SafiBachat'
            and not (coalesce(e.description, '') ~* ${CARRY})),
        inv as (select distinct on (trip_id) trip_id, contractor_id from invoices where not is_deleted and trip_id is not null order by trip_id, id),
        r as (
          select t.*, inv.contractor_id inv_con,
            case when t.is_in and t.category = 'Freight' and inv.trip_id is not null then '1100'
                 else coalesce(r1.account_code, r2.account_code, case when t.is_in then '4098' else '5098' end) end code
          from t left join inv on inv.trip_id = t.derived_trip_id
          left join posting_rules r1 on r1.source = 'truck' and r1.category = t.category and r1.side = case when t.is_in then 'in' else 'out' end
          left join posting_rules r2 on r2.source = 'truck' and r2.category = t.category and r2.side = 'any')
        select 'tle:' || id, entry_date, left(registration || ': ' || coalesce(description, category), 300), '1060',
               case when is_in then amt else 0 end, case when is_in then 0 else amt end, vehicle_id, ledger_id, null::int, null::int from r
        union all
        select 'tle:' || id, entry_date, left(registration || ': ' || coalesce(description, category), 300), code,
               case when is_in then 0 else amt end, case when is_in then amt else 0 end, vehicle_id, ledger_id, null::int,
               case when code = '1100' then inv_con end from r`);

      // 4b. daily cash book
      await run(sql`insert into _p
        with c as (
          select t.id, t.entry_date, t.direction = 'In' as is_in, t.amount::bigint amt, t.link_type, t.link_target_id,
                 coalesce(t.description, t.person, 'Cash book') descr,
                 case when t.link_type = 'truck' then (select ledger_id from truck_ledger_entries where id = t.derived_entry_id) end tl,
                 case when t.link_type = 'party' then coalesce((select party_id from party_ledger_entries where id = t.derived_entry_id), t.link_target_id) end pid
          from cash_transactions t where not t.is_deleted and t.entry_date >= ${START} and t.amount > 0),
        k as (
          select c.*, case
              when link_type = 'truck' then '1060'
              when link_type = 'party' then case (select role from _who w where w.party_id = c.pid limit 1) when 'partner' then '2200' when 'hfk' then '3100' else '1150' end
              when link_type in ('personal', 'zakat') then '3100'
              when link_type = 'count' then '5095'
              else '1097' end code
          from c)
        select 'ct:' || id, entry_date, left(descr, 300), '1001', case when is_in then amt else 0 end, case when is_in then 0 else amt end,
               case when link_type = 'truck' then link_target_id end, tl, pid, null::int from k
        union all
        select 'ct:' || id, entry_date, left(descr, 300), code, case when is_in then 0 else amt end, case when is_in then amt else 0 end,
               case when link_type = 'truck' then link_target_id end, tl, pid, null::int from k`);

      // 4c. party ledgers (not made by the cash book, not partnership events)
      await run(sql`insert into _p
        with e as (
          select e.id, e.entry_date, e.party_id, e.debit::bigint d, e.credit::bigint c, coalesce(e.description, p.name) descr, e.method,
                 (select role from _who w where w.party_id = e.party_id limit 1) role
          from party_ledger_entries e join parties p on p.id = e.party_id
          where not e.is_deleted and e.entry_date >= ${START} and (e.debit > 0 or e.credit > 0) and not (e.debit > 0 and e.credit > 0)
            and coalesce(e.ref_no, '') not like 'PSHIP-%'
            and not exists (select 1 from cash_transactions t where t.link_type = 'party' and t.derived_entry_id = e.id and not t.is_deleted)),
        k as (select e.*, case role when 'partner' then '2200' when 'hfk' then '3100' else '1150' end acc, ${methodCode(sql`e.method`)} via from e)
        select 'ple:' || id, entry_date, left(descr, 300), acc, d, c, null::int, null::int, party_id, null::int from k
        union all
        select 'ple:' || id, entry_date, left(descr, 300), via, c, d, null::int, null::int, party_id, null::int from k`);

      // 4d. Partner P&L events (partner's side; HFK's side is the company itself, except money HFK took for home)
      await run(sql`insert into _p
        with e as (
          select e.id, e.entry_date, e.party_id, e.debit::bigint d, e.credit::bigint c, e.description descr, e.method, e.section_label lbl,
                 (select role from _who w where w.party_id = e.party_id limit 1) role
          from party_ledger_entries e
          where not e.is_deleted and e.entry_date >= ${START} and (e.debit > 0 or e.credit > 0) and e.ref_no like 'PSHIP-%'),
        k as (
          select e.*,
            case when role = 'partner' then '2200' else '3100' end acc,
            case
              when lbl like 'Opening joint pool%' then '3900'
              when lbl like 'Safi bachat%' or lbl like 'Loss split%' then '5900'
              when lbl like 'Old qarz%' and method = 'Adjustment' then '3900'
              else ${methodCode(sql`e.method`)} end via
          from e
          where (role = 'partner' and not (method = 'Adjustment' and lbl like 'Shakhsi%'))
             or (role = 'hfk' and lbl like 'Shakhsi%' and coalesce(method, '') <> 'Adjustment'))
        select 'pship:' || id, entry_date, left(descr, 300), acc, d, c, null::int, null::int, party_id, null::int from k
        union all
        select 'pship:' || id, entry_date, left(descr, 300), via, c, d, null::int, null::int, party_id, null::int from k`);

      // 4e. household and zakat not typed through the cash book
      await run(sql`insert into _p
        with e as (
          select x.id, x.entry_date, x.amount::bigint amt, x.direction = 'income' is_in, coalesce(x.description, x.payee, 'Household') descr, x.method
          from personal_expenses x where not x.is_deleted and x.entry_date >= ${START} and x.amount > 0
            and not exists (select 1 from cash_transactions t where t.link_type = 'personal' and t.derived_entry_id = x.id and not t.is_deleted))
        select 'pe:' || id, entry_date, left(descr, 300), '3100', case when is_in then 0 else amt end, case when is_in then amt else 0 end, null::int, null::int, null::int, null::int from e
        union all
        select 'pe:' || id, entry_date, left(descr, 300), ${methodCode(sql`e.method`)}, case when is_in then amt else 0 end, case when is_in then 0 else amt end, null::int, null::int, null::int, null::int from e`);
      await run(sql`insert into _p
        with e as (
          select z.id, z.entry_date, z.amount::bigint amt, coalesce(z.description, z.recipient, 'Zakat') descr, z.method
          from zakat_payments z where not z.is_deleted and z.entry_date >= ${START} and z.amount > 0
            and not exists (select 1 from cash_transactions t where t.link_type = 'zakat' and t.derived_entry_id = z.id and not t.is_deleted))
        select 'zk:' || id, entry_date, left('Zakat: ' || descr, 300), '3100', amt, 0, null::int, null::int, null::int, null::int from e
        union all
        select 'zk:' || id, entry_date, left('Zakat: ' || descr, 300), ${methodCode(sql`e.method`)}, 0, amt, null::int, null::int, null::int, null::int from e`);

      // 4f. each bank account has its own account in the books (12xx), named after it
      await run(sql`insert into accounts (code, name, type, category, is_active)
        select '12' || lpad(id::text, 2, '0'), left('Bank · ' || bank_name || ' ' || account_number, 120), 'Asset', 'Bank', true from bank_accounts where not is_deleted
        on conflict (code) do update set name = excluded.name`);

      // 4g. opening balances on the books' first day
      await run(sql`insert into _p
        with cash as (select coalesce(sum(case when direction = 'In' then amount else -amount end), 0)::bigint b from cash_transactions where not is_deleted and entry_date < ${START}),
        pb as (
          select e.party_id, sum(e.debit - e.credit)::bigint b, (select role from _who w where w.party_id = e.party_id limit 1) role
          from party_ledger_entries e where not e.is_deleted and e.entry_date < ${START} group by e.party_id),
        lines as (
          select '1001' code, b, null::int party_id from cash where b <> 0
          union all
          select case role when 'partner' then '2200' else '1150' end, b, party_id from pb where b <> 0 and coalesce(role, '') <> 'hfk'
          union all
          select '12' || lpad(id::text, 2, '0'), opening_balance::bigint, null::int from bank_accounts where not is_deleted and opening_balance <> 0)
        select 'opening', ${START}, 'Opening balances on the first day of the books', code, greatest(b, 0), greatest(-b, 0), null::int, null::int, party_id, null::int from lines
        union all
        select 'opening', ${START}, 'Opening balances on the first day of the books', '3900',
               greatest(-(select coalesce(sum(b), 0) from lines), 0), greatest((select coalesce(sum(b), 0) from lines), 0), null::int, null::int, null::int, null::int
        where exists (select 1 from lines)`);

      // 4h. bank statement lines: the bank's own account ↔ what the line was matched to (the account
      // that entry used for its money: bank to match 1009, the truck account 1060, the cash book's
      // other side, an invoice payment's cash/bank) or what it was explained as
      await run(sql`insert into _p
        with s as (
          select s.id, s.txn_date, s.withdrawal, s.deposit, s.matched_key, s.kind, '12' || lpad(s.bank_account_id::text, 2, '0') bank,
                 left(coalesce(s.description, s.ref, 'Bank statement'), 300) descr
          from bank_statement_lines s join bank_accounts b on b.id = s.bank_account_id and not b.is_deleted
          where not s.is_deleted and s.txn_date >= ${START} and (s.withdrawal > 0 or s.deposit > 0)),
        k as (
          select s.*, coalesce(
            case s.kind when 'charges' then '5096' when 'transfer' then '1099' when 'profit' then '4002' when 'tax' then '1102' when 'cash' then '1095' end,
            (select p.code from _p p where s.matched_key is not null and p.source_key = s.matched_key
               and case when s.matched_key like 'ct:%' then p.code <> '1001' else p.code in ('1009', '1060', '1095', '1096') end limit 1),
            (select a.code from journal_entries j join journal_lines l on l.journal_entry_id = j.id join accounts a on a.id = l.account_id
               where s.matched_key like 'pay:%' and j.entry_number = 'JE-PAY-' || lpad(split_part(s.matched_key, ':', 2), 4, '0') and l.debit > 0 limit 1),
            '1098') counter
          from s)
        select 'bs:' || id, txn_date, descr, bank, deposit, withdrawal, null::int, null::int, null::int, null::int from k
        union all
        select 'bs:' || id, txn_date, descr, counter, withdrawal, deposit, null::int, null::int, null::int, null::int from k`);

      // 5. write: one entry per source row, its lines under it
      const missing = await run(sql`select distinct code from _p where code not in (select code from accounts)`);
      if (missing.length) throw new Error(`Accounts missing in the chart: ${missing.map((m) => m.code).join(", ")}`);
      const bad = await run(sql`select source_key, sum(debit) d, sum(credit) c from _p group by 1 having sum(debit) <> sum(credit) limit 5`);
      if (bad.length) throw new Error(`Unbalanced posting for ${bad.map((b) => b.source_key).join(", ")}`);

      await run(sql`insert into journal_entries (entry_number, entry_date, description, source_type, source_id, source_key, is_auto, fiscal_year_id, accounting_period_id, created_by)
        select 'A-' || upper(p.source_key), p.entry_date, p.descr, 'Auto', case when p.source_key ~ ':[0-9]+$' then substring(p.source_key from ':([0-9]+)$')::int end, p.source_key, true,
               (select id from fiscal_years f where p.entry_date between f.start_date and f.end_date and not f.is_deleted limit 1),
               (select id from accounting_periods a where p.entry_date between a.start_date and a.end_date and not a.is_deleted limit 1),
               ${userId ?? null}
        from (select source_key, min(entry_date) entry_date, min(descr) descr from _p group by source_key) p`);
      await run(sql`insert into journal_lines (journal_entry_id, account_id, description, debit, credit, vehicle_id, truck_ledger_id, party_id, contractor_id)
        select j.id, a.id, p.descr, p.debit, p.credit, p.vehicle_id, p.truck_ledger_id, p.party_id, p.contractor_id
        from _p p join journal_entries j on j.source_key = p.source_key join accounts a on a.code = p.code
        where p.debit > 0 or p.credit > 0`);

      const bySource = await run(sql`select split_part(source_key, ':', 1) src, count(distinct source_key)::int entries from _p group by 1`);
      const [tb] = await run(sql`select coalesce(sum(debit), 0)::bigint d, coalesce(sum(credit), 0)::bigint c from journal_lines`);
      return {
        reason,
        legacyRemoved: legacy.length,
        bySource: Object.fromEntries(bySource.map((b) => [b.src, b.entries])),
        totalDebit: Number(tb.d),
        totalCredit: Number(tb.c),
      };
    });
    const out = { ...stats, ms: Date.now() - t0, at: new Date().toISOString(), signature: await booksSignature() };
    await db.execute(sql`update books_settings set last_rebuild_at = now(), last_rebuild = ${JSON.stringify(out)}::jsonb, updated_at = now() where id = 1`);
    return out;
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * A fingerprint of every source the books are built from: counts, totals and the sum of each
 * row's last-changed time. Any added, edited, deleted or re-dated row changes it. (Timestamps in
 * these tables are written partly in local time and partly in UTC, so "changed after the last
 * rebuild" cannot be trusted — a fingerprint can.)
 */
async function booksSignature(): Promise<string> {
  const part = (table: string, money: string) =>
    sql.raw(`(select count(*) || '/' || coalesce(max(id), 0) || '/' || coalesce(sum(${money}), 0) || '/' ||
      coalesce(sum(extract(epoch from updated_at))::bigint, 0) || '/' || count(*) filter (where is_deleted) from ${table})`);
  const [r] = await rows(sql`select md5(concat_ws('|',
      ${part("truck_ledger_entries", "received + paid")},
      ${part("party_ledger_entries", "debit + credit")},
      ${part("cash_transactions", "amount")},
      ${part("personal_expenses", "amount")},
      ${part("zakat_payments", "amount")},
      ${part("truck_ledgers", "0")},
      ${part("partnership_accounts", "0")},
      ${part("bank_statement_lines", "deposit + withdrawal + coalesce(length(matched_key), 0) + coalesce(length(kind), 0)")},
      ${part("bank_accounts", "opening_balance")},
      (select count(*) || '/' || coalesce(sum(extract(epoch from updated_at))::bigint, 0) from posting_rules),
      (select count(*) || '/' || coalesce(max(id), 0) from journal_entries where not is_auto),
      (select to_char(books_start, 'YYYY-MM-DD') from books_settings where id = 1))) sig`);
  return r.sig;
}

/** Has any source row changed since the last rebuild? */
export async function booksStale(): Promise<boolean> {
  await ensureSetup();
  const [r] = await rows(sql`select last_rebuild ->> 'signature' sig from books_settings where id = 1`);
  if (!r?.sig) return true;
  return r.sig !== (await booksSignature());
}

/** Rebuild if something changed (cheap check first). Never throws. */
export async function rebuildIfStale(reason: string) {
  try {
    if (await booksStale()) return await rebuildBooks(reason);
  } catch (e) {
    console.warn("[books] rebuild failed:", (e as any).cause?.message || (e as Error).message);
  }
  return null;
}

/** Keep the books current on their own: once at start, then every 10 minutes if anything changed. */
export function startBooksKeeper() {
  setTimeout(() => void rebuildIfStale("server start"), 20_000);
  setInterval(() => void rebuildIfStale("every 10 min"), 10 * 60_000).unref?.();
}

// ---------------------------------------------------------------- routes
router.get("/status", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    await ensureSetup();
    const [s] = await rows(sql`select to_char(books_start, 'YYYY-MM-DD') books_start, last_rebuild_at, last_rebuild from books_settings where id = 1`);
    const [c] = await rows(sql`select count(*)::int auto from journal_entries where is_auto`);
    res.json({ booksStart: s.books_start, lastRebuildAt: s.last_rebuild_at, lastRebuild: s.last_rebuild, autoEntries: c.auto, stale: await booksStale(), running: !!running });
  } catch (e: any) {
    res.status(500).json({ error: e.cause?.message || e.message });
  }
});

router.post("/rebuild", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const r = await rebuildBooks("manual", req.user?.id);
    await logAudit({ action: "UPDATE", tableName: "books", recordId: 1, oldValues: null, newValues: r, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e.cause?.message || e.message });
  }
});

router.get("/rules", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    await ensureSetup();
    const rules = await rows(sql`select r.id, r.source, r.category, r.side, r.account_code, r.note, a.name account_name from posting_rules r left join accounts a on a.code = r.account_code order by r.source, r.category, r.side`);
    const accounts = await rows(sql`select code, name, type from accounts where not is_deleted and is_active order by code`);
    // truck khata categories in use, so a new one can be given an account
    const cats = await rows(sql`select coalesce(nullif(category, ''), 'Other') category, count(*)::int n from truck_ledger_entries where not is_deleted group by 1 order by 2 desc`);
    res.json({ rules, accounts, truckCategories: cats, reviewCodes: REVIEW_CODES });
  } catch (e: any) {
    res.status(500).json({ error: e.cause?.message || e.message });
  }
});

router.put("/rules", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const list = Array.isArray(req.body) ? req.body : [];
    const codes = new Set((await rows(sql`select code from accounts where not is_deleted`)).map((a) => a.code));
    for (const r of list) {
      const source = String(r.source || "");
      const category = String(r.category || "");
      const side = ["in", "out", "any"].includes(r.side) ? r.side : "any";
      const code = String(r.accountCode || "");
      if (!source || !category || !codes.has(code)) return res.status(400).json({ error: `Account ${code || "?"} is not in the chart of accounts` });
      await db.execute(sql`insert into posting_rules (source, category, side, account_code, note, updated_at, updated_by)
        values (${source}, ${category}, ${side}, ${code}, ${r.note ?? null}, now(), ${req.user?.id ?? null})
        on conflict (source, category, side) do update set account_code = excluded.account_code, note = excluded.note, updated_at = now(), updated_by = excluded.updated_by`);
    }
    res.json(await rebuildBooks("rules changed", req.user?.id));
  } catch (e: any) {
    res.status(500).json({ error: e.cause?.message || e.message });
  }
});

const range = (q: any) => {
  const ok = (s: any) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const now = new Date();
  const fyStart = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return { from: ok(q.from) || `${fyStart}-07-01`, to: ok(q.to) || `${fyStart + 1}-06-30` };
};

router.get("/trial-balance", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    await rebuildIfStale("trial balance opened");
    const { from, to } = range(req.query);
    const list = await rows(sql`select a.code, a.name, a.type,
        coalesce(sum(case when j.entry_date < ${from}::timestamp then l.debit - l.credit end), 0)::bigint opening,
        coalesce(sum(case when j.entry_date >= ${from}::timestamp and j.entry_date < ${to}::timestamp + interval '1 day' then l.debit end), 0)::bigint debit,
        coalesce(sum(case when j.entry_date >= ${from}::timestamp and j.entry_date < ${to}::timestamp + interval '1 day' then l.credit end), 0)::bigint credit,
        coalesce(sum(case when j.entry_date < ${to}::timestamp + interval '1 day' then l.debit - l.credit end), 0)::bigint closing,
        count(l.id) filter (where j.entry_date >= ${from}::timestamp and j.entry_date < ${to}::timestamp + interval '1 day')::int lines
      from accounts a
      left join journal_lines l on l.account_id = a.id and not l.is_deleted
      left join journal_entries j on j.id = l.journal_entry_id and not j.is_deleted
      where not a.is_deleted
      group by a.code, a.name, a.type
      having count(l.id) > 0
      order by a.code`);
    const n = (r: any, k: string) => Number(r[k] || 0);
    res.json({
      from,
      to,
      reviewCodes: REVIEW_CODES,
      accounts: list.map((r) => ({ code: r.code, name: r.name, type: r.type, opening: n(r, "opening"), debit: n(r, "debit"), credit: n(r, "credit"), closing: n(r, "closing"), lines: r.lines })),
      totals: { debit: list.reduce((s, r) => s + n(r, "debit"), 0), credit: list.reduce((s, r) => s + n(r, "credit"), 0), closing: list.reduce((s, r) => s + n(r, "closing"), 0) },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.cause?.message || e.message });
  }
});

router.get("/lines", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = range(req.query);
    const code = String(req.query.code || "");
    const list = await rows(sql`select j.entry_date, j.entry_number, j.source_key, l.description, l.debit, l.credit,
        v.vehicle_number, p.name party, c.company customer, l.truck_ledger_id
      from journal_lines l join journal_entries j on j.id = l.journal_entry_id join accounts a on a.id = l.account_id
      left join vehicles v on v.id = l.vehicle_id left join parties p on p.id = l.party_id left join contractors c on c.id = l.contractor_id
      where a.code = ${code} and not l.is_deleted and not j.is_deleted
        and j.entry_date >= ${from}::timestamp and j.entry_date < ${to}::timestamp + interval '1 day'
      order by j.entry_date desc, j.id desc limit 1000`);
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.cause?.message || e.message });
  }
});

export default router;
