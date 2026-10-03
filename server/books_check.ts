/**
 * Books check · حساب صحت — the system looks for mistakes in the books by itself.
 *
 * Every check is a live question asked of the data each time the page opens, so an item stays
 * on the list (red / amber) until the data is actually corrected — nothing to tick off by hand.
 * Something that looks wrong but is right (a genuine repeat payment, say) can be marked
 * "this is correct" and then stays off the list (check_dismissals).
 *
 *   red    a definite mistake — wrong date in the future, both sides on one row, money the books
 *          count twice or not at all, a bill whose figures don't add up, cash below zero…
 *   amber  look at it once — money with no date, the paper's balance differs, a possible repeat…
 *   info   what is not done yet (khata money not yet in the double-entry books)
 *
 *   GET    /api/books-check                   every check, with up to 300 items each
 *   POST   /api/books-check/fix/:code         the safe automatic fixes (fixable checks only)
 *   POST   /api/books-check/dismiss           { code, key, note }  "this is correct"
 *   DELETE /api/books-check/dismiss           { code, key }        put it back on the list
 *   GET    /api/books-check/dismissed         what was marked correct, by whom
 */
import { Router, Response } from "express";
import { and, eq, sql, SQL } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { rebuildIfStale, REVIEW_CODES } from "./books.ts";

const router = Router();
router.use(requireAuth, requireApproved);

const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];
const LIMIT = 300;

type Level = "red" | "amber" | "info";
type Link = { wb: string; sheet: string; focus?: { ledgerId?: number; partyId?: number; entryId?: number; date?: string } };
type Item = { key: string; date: string | null; title: string; detail: string; amount: number | null; link: Link | null };
interface Check {
  code: string;
  level: Level;
  area: string; // which module
  title: string;
  urdu: string;
  why: string; // why it matters, in plain words
  fix: string; // what to do
  fixable?: string; // label of the automatic fix, when there is one
  run: () => Promise<{ total: number; items: Item[] }>;
}

const rows = async (q: SQL) => ((await db.execute(q)) as any).rows as any[];
const day = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const num = (n: any) => Math.round(Number(n || 0));
/** "and this item was not marked correct" */
const notDismissed = (code: string, keyExpr: SQL) => sql`not exists (select 1 from check_dismissals cd_ where cd_.code = ${code} and cd_.item_key = ${keyExpr})`;
const out = (list: any[], map: (r: any) => Item) => ({ total: list.length ? num(list[0].total) : 0, items: list.map(map) });

const truckLink = (r: any): Link => ({ wb: "khata", sheet: "truck_ledgers", focus: { ledgerId: r.ledger_id, entryId: r.id } });
const partyLink = (r: any): Link => ({ wb: "khata", sheet: "parties", focus: { partyId: r.party_id, entryId: r.id } });
const cashLink = (d: string | null): Link => ({ wb: "finance", sheet: "cash_book", focus: d ? { date: d } : undefined });
const money = (r: any) => (num(r.received) ? `in ${num(r.received).toLocaleString()}` : "") + (num(r.received) && num(r.paid) ? " · " : "") + (num(r.paid) ? `out ${num(r.paid).toLocaleString()}` : "");

// a khata row that is only a side-box figure on the paper page (not counted in the balance)
const NOT_BOX = sql`not (e.sr_no is null and e.source_row is not null and e.sheet_balance is null)`;

const CHECKS: Check[] = [
  // ---------------------------------------------------------------- dates
  {
    code: "KHATA_FUTURE_DATE",
    level: "red",
    area: "Truck Ledgers",
    title: "Truck khata: date in the future",
    urdu: "ٹرک کھاتہ: آنے والی تاریخ",
    why: "A date that has not come yet (often a typing slip: 2027 for 2026, 2206) puts the entry in the wrong month and year, and on top of every list.",
    fix: "Open the entry and correct the year.",
    run: async () =>
      out(
        await rows(sql`select e.id, e.ledger_id, l.registration, e.entry_date, e.description, e.received, e.paid, count(*) over() total
          from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
          where not e.is_deleted and not l.is_deleted and e.entry_date > now() + interval '1 day' and (e.received > 0 or e.paid > 0)
            and ${notDismissed("KHATA_FUTURE_DATE", sql`'tle:' || e.id`)}
          order by e.entry_date desc limit ${LIMIT}`),
        (r) => ({ key: `tle:${r.id}`, date: day(r.entry_date), title: r.registration, detail: `${r.description || "—"} · ${money(r)}`, amount: num(r.received) || num(r.paid), link: truckLink(r) }),
      ),
  },
  {
    code: "PARTY_FUTURE_DATE",
    level: "red",
    area: "Party Ledgers",
    title: "Party ledger: date in the future",
    urdu: "پارٹی کھاتہ: آنے والی تاریخ",
    why: "Same as above — the entry sits in the wrong month.",
    fix: "Open the entry and correct the date.",
    run: async () =>
      out(
        await rows(sql`select e.id, e.party_id, p.name, e.entry_date, e.description, e.debit, e.credit, count(*) over() total
          from party_ledger_entries e join parties p on p.id = e.party_id
          where not e.is_deleted and e.entry_date > now() + interval '1 day' and (e.debit > 0 or e.credit > 0)
            and ${notDismissed("PARTY_FUTURE_DATE", sql`'ple:' || e.id`)}
          order by e.entry_date desc limit ${LIMIT}`),
        (r) => ({ key: `ple:${r.id}`, date: day(r.entry_date), title: r.name, detail: r.description || "—", amount: num(r.debit) || num(r.credit), link: partyLink(r) }),
      ),
  },
  {
    code: "CASH_FUTURE_DATE",
    level: "red",
    area: "Daily Cash Book",
    title: "Cash book: date in the future",
    urdu: "کیش بک: آنے والی تاریخ",
    why: "Cash that has not moved yet changes today's and every later day's cash in hand.",
    fix: "Open that day and correct the date.",
    run: async () =>
      out(
        await rows(sql`select id, entry_date, direction, amount, person, description, count(*) over() total from cash_transactions
          where not is_deleted and entry_date > now() + interval '1 day' and ${notDismissed("CASH_FUTURE_DATE", sql`'ct:' || id`)}
          order by entry_date desc limit ${LIMIT}`),
        (r) => ({ key: `ct:${r.id}`, date: day(r.entry_date), title: `${r.direction} · ${r.person || ""}`, detail: r.description || "—", amount: num(r.amount), link: cashLink(day(r.entry_date)) }),
      ),
  },
  {
    code: "KHATA_NO_DATE",
    level: "amber",
    area: "Truck Ledgers",
    title: "Truck khata: money with no date",
    urdu: "ٹرک کھاتہ: رقم ہے مگر تاریخ نہیں",
    why: "Without a date the money cannot go into a month, a trip or the year's accounts.",
    fix: "Open the entry and give it the date from the paper (the rows around it show roughly when).",
    run: async () =>
      out(
        await rows(sql`select e.id, e.ledger_id, l.registration, e.raw_date, e.description, e.received, e.paid, count(*) over() total
          from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
          where not e.is_deleted and not l.is_deleted and (e.entry_date is null or e.entry_date < '2000-01-01') and (e.received > 0 or e.paid > 0) and ${NOT_BOX}
            and ${notDismissed("KHATA_NO_DATE", sql`'tle:' || e.id`)}
          order by l.registration, e.id limit ${LIMIT}`),
        (r) => ({ key: `tle:${r.id}`, date: null, title: r.registration, detail: `${r.raw_date ? `paper says "${r.raw_date}" · ` : ""}${r.description || "—"} · ${money(r)}`, amount: num(r.received) || num(r.paid), link: truckLink(r) }),
      ),
  },

  // ---------------------------------------------------------------- one row, both sides
  {
    code: "KHATA_BOTH_SIDES",
    level: "red",
    area: "Truck Ledgers",
    title: "Truck khata: one row has money both in and out",
    urdu: "ٹرک کھاتہ: ایک لائن میں وصول اور ادائیگی دونوں",
    why: "A row is either money received or money paid. Both on one row usually means the import misread the paper.",
    fix: "Open it and keep the right side (or split it into two entries).",
    run: async () =>
      out(
        await rows(sql`select e.id, e.ledger_id, l.registration, e.entry_date, e.description, e.received, e.paid, count(*) over() total
          from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
          where not e.is_deleted and not l.is_deleted and e.received > 0 and e.paid > 0 and ${notDismissed("KHATA_BOTH_SIDES", sql`'tle:' || e.id`)}
          order by e.entry_date desc nulls last limit ${LIMIT}`),
        (r) => ({ key: `tle:${r.id}`, date: day(r.entry_date), title: r.registration, detail: `${r.description || "—"} · ${money(r)}`, amount: num(r.received), link: truckLink(r) }),
      ),
  },
  {
    code: "PARTY_BOTH_SIDES",
    level: "red",
    area: "Party Ledgers",
    title: "Party ledger: one row is both naam and jama",
    urdu: "پارٹی کھاتہ: ایک لائن میں نام اور جمع دونوں",
    why: "A row is either given to the party or got from the party, not both.",
    fix: "Open it and keep the right side.",
    run: async () =>
      out(
        await rows(sql`select e.id, e.party_id, p.name, e.entry_date, e.description, e.debit, e.credit, count(*) over() total
          from party_ledger_entries e join parties p on p.id = e.party_id
          where not e.is_deleted and e.debit > 0 and e.credit > 0 and ${notDismissed("PARTY_BOTH_SIDES", sql`'ple:' || e.id`)}
          order by e.entry_date desc nulls last limit ${LIMIT}`),
        (r) => ({ key: `ple:${r.id}`, date: day(r.entry_date), title: r.name, detail: `${r.description || "—"} · naam ${num(r.debit).toLocaleString()} · jama ${num(r.credit).toLocaleString()}`, amount: num(r.debit), link: partyLink(r) }),
      ),
  },

  // ---------------------------------------------------------------- paper vs computed
  {
    code: "KHATA_PAPER_BALANCE",
    level: "amber",
    area: "Truck Ledgers",
    title: "Truck khata: the paper's balance differs from the sum",
    urdu: "ٹرک کھاتہ: کاغذ کا بقایا جمع سے مختلف",
    why: "When the paper's balance and the added-up balance differ, either the paper was miscounted or a row is missing / misread.",
    fix: "Open it and compare with the paper page; fix the row that is wrong, or mark correct if the paper was miscounted.",
    run: async () =>
      out(
        await rows(sql`with x as (
            select e.id, e.ledger_id, l.registration, e.entry_date, e.description, e.received, e.paid, e.running_balance, e.sheet_balance, e.section_label,
              coalesce(e.sort_key, e.id) k,
              least(abs(e.running_balance - e.sheet_balance), abs(e.running_balance + e.sheet_balance)) gap
            from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
            where not e.is_deleted and not l.is_deleted and e.sheet_balance is not null and ${NOT_BOX}),
          y as (select *, lag(gap) over (partition by ledger_id, section_label order by k) prev from x)
          select *, count(*) over() total from y
          where gap > 1 and (prev is null or prev <> gap) and ${notDismissed("KHATA_PAPER_BALANCE", sql`'tle:' || y.id`)}
          order by registration, k limit ${LIMIT}`),
        (r) => ({ key: `tle:${r.id}`, date: day(r.entry_date), title: r.registration, detail: `${r.section_label ? r.section_label + " · " : ""}paper ${num(r.sheet_balance).toLocaleString()} · sum ${num(r.running_balance).toLocaleString()} · ${r.description || "—"}`, amount: num(r.gap), link: truckLink(r) }),
      ),
  },
  {
    code: "KHATA_OLD_FLAGS",
    level: "amber",
    area: "Truck Ledgers",
    title: "Old import warnings that are no longer true",
    urdu: "امپورٹ کی پرانی تنبیہیں جو اب درست نہیں",
    why: "At import these rows were marked 'balance differs from the paper'; the balance has since been worked out again and now matches, but the yellow mark stayed.",
    fix: "Use “Clear them” — only the stale balance warning is removed; any other warning on the row stays.",
    fixable: "Clear them",
    run: async () => {
      const [r] = await rows(sql`select count(*)::int n from truck_ledger_entries e
        where not e.is_deleted and e.needs_review and e.review_reason like 'running balance%'
          and (e.sheet_balance is null or least(abs(e.running_balance - e.sheet_balance), abs(e.running_balance + e.sheet_balance)) <= 1)`);
      return { total: num(r?.n), items: [] };
    },
  },
  {
    code: "KHATA_DUPLICATE",
    level: "amber",
    area: "Truck Ledgers",
    title: "Truck khata: the same entry twice?",
    urdu: "ٹرک کھاتہ: ایک ہی انٹری دو بار؟",
    why: "Same truck, same day, same amount, same words — usually the same slip entered twice, so the expense is counted double.",
    fix: "Delete the extra one, or mark correct if it really happened twice.",
    run: async () =>
      out(
        await rows(sql`select min(e.id) id, e.ledger_id, l.registration, e.entry_date::date d, max(e.description) description, e.received, e.paid, count(*)::int n, count(*) over() total
          from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
          where not e.is_deleted and not l.is_deleted and e.entry_date is not null and (e.received > 0 or e.paid > 0) and ${NOT_BOX}
          group by e.ledger_id, l.registration, e.entry_date::date, e.received, e.paid, lower(trim(coalesce(e.description, '')))
          having count(*) > 1 and ${notDismissed("KHATA_DUPLICATE", sql`'tle:' || min(e.id)`)}
          order by d desc limit ${LIMIT}`),
        (r) => ({ key: `tle:${r.id}`, date: day(r.d), title: r.registration, detail: `${r.n}× ${r.description || "—"} · ${money(r)}`, amount: num(r.received) || num(r.paid), link: truckLink(r) }),
      ),
  },
  {
    code: "CASH_DUPLICATE",
    level: "amber",
    area: "Daily Cash Book",
    title: "Cash book: the same entry twice?",
    urdu: "کیش بک: ایک ہی انٹری دو بار؟",
    why: "Same day, same person, same amount, same side — cash in hand would be wrong by that amount.",
    fix: "Delete the extra one, or mark correct.",
    run: async () =>
      out(
        await rows(sql`select min(t.id) id, t.entry_date::date d, t.direction, t.amount, max(t.person) person, count(*)::int n, count(*) over() total
          from cash_transactions t where not t.is_deleted
          group by t.entry_date::date, t.direction, t.amount, lower(trim(coalesce(t.person, ''))), lower(trim(coalesce(t.description, '')))
          having count(*) > 1 and ${notDismissed("CASH_DUPLICATE", sql`'ct:' || min(t.id)`)}
          order by d desc limit ${LIMIT}`),
        (r) => ({ key: `ct:${r.id}`, date: day(r.d), title: `${r.direction} · ${r.person || ""}`, detail: `${r.n}× the same entry`, amount: num(r.amount), link: cashLink(day(r.d)) }),
      ),
  },

  // ---------------------------------------------------------------- cash
  {
    code: "CASH_BELOW_ZERO",
    level: "red",
    area: "Daily Cash Book",
    title: "Cash book: cash in hand goes below zero",
    urdu: "کیش بک: نقد صفر سے کم",
    why: "You cannot pay out more cash than you have. A minus means money that came in was not written, or the opening cash was never entered.",
    fix: "Open that day and add the missing 'In' entry (or the opening cash on the first day).",
    run: async () =>
      out(
        await rows(sql`with d as (
            select entry_date::date d, sum(case when direction = 'In' then amount else -amount end) net
            from cash_transactions where not is_deleted group by 1),
          r as (select d, net, sum(net) over (order by d) bal from d),
          s as (select d, bal, lag(bal) over (order by d) prev from r)
          select d, bal, count(*) over() total from s
          where bal < 0 and (prev is null or prev >= 0) and ${notDismissed("CASH_BELOW_ZERO", sql`'day:' || d`)}
          order by d desc limit ${LIMIT}`),
        (r) => ({ key: `day:${day(r.d)}`, date: day(r.d), title: "Cash went below zero from this day", detail: `cash in hand ${num(r.bal).toLocaleString()}`, amount: num(r.bal), link: cashLink(day(r.d)) }),
      ),
  },

  {
    code: "CASH_COUNT_DIFF",
    level: "red",
    area: "Daily Cash Book",
    title: "Cash counted is not what the cash book says",
    urdu: "گنا ہوا نقد کیش بک سے مختلف",
    why: "When the cash in the drawer and the cash book differ, an entry is missing or wrong — or money is short.",
    fix: "Open that day: add the missing entry, or press 'Record the difference' to write the shortage / excess into the cash book.",
    run: async () => {
      const counts = await rows(sql`select id, day, declared_balance from cash_closings where not is_deleted and day is not null
          and ${notDismissed("CASH_COUNT_DIFF", sql`'count:' || day`)} order by day desc limit 400`);
      const { bookPosition } = await import("./cash_book.ts"); // loaded here: cash_book → ledgers → this file
      const items: Item[] = [];
      for (const c of counts) {
        const book = await bookPosition(c.day);
        const diff = num(c.declared_balance) - book.closing;
        if (diff !== 0)
          items.push({ key: `count:${c.day}`, date: c.day, title: diff < 0 ? "Cash short · کم" : "Cash extra · زیادہ", detail: `counted ${num(c.declared_balance).toLocaleString()} · book ${book.closing.toLocaleString()}`, amount: diff, link: cashLink(c.day) });
      }
      return { total: items.length, items };
    },
  },
  {
    code: "CASH_NOT_COUNTED",
    level: "amber",
    area: "Daily Cash Book",
    title: "Days with cash entries but no cash count",
    urdu: "جن دنوں انٹریاں ہیں مگر نقد نہیں گنا",
    why: "Counting the cash every evening is how a missing entry or a shortage is caught the same day, not months later.",
    fix: "Open the day in the Daily Cash Book and count the cash (notes of 5000, 1000, 500…).",
    run: async () => {
      const [first] = await rows(sql`select min(day) d from cash_closings where not is_deleted and day is not null`);
      if (!first?.d) {
        const [any] = await rows(sql`select count(*)::int n from cash_transactions where not is_deleted`);
        return num(any?.n)
          ? { total: 1, items: [{ key: "count:never", date: null, title: "The cash has never been counted", detail: "start counting the cash every evening · روز شام نقد گنیں", amount: null, link: cashLink(null) }] }
          : { total: 0, items: [] };
      }
      // days (as text, like the cash book shows them) from the first count on, with entries but no count
      const list = await rows(sql`select distinct to_char(entry_date, 'YYYY-MM-DD') d from cash_transactions
          where not is_deleted and entry_date >= ${first.d}::timestamp and entry_date < now() - interval '1 day'
          except select day from cash_closings where not is_deleted and day is not null
          order by 1 desc limit 300`);
      const left = list;
      const out: Item[] = [];
      for (const r of left) {
        const [dm] = await rows(sql`select 1 from check_dismissals where code = 'CASH_NOT_COUNTED' and item_key = ${"count:" + r.d}`);
        if (!dm) out.push({ key: `count:${r.d}`, date: r.d, title: "Not counted · نہیں گنا", detail: "", amount: null, link: cashLink(r.d) });
      }
      return { total: out.length, items: out };
    },
  },

  {
    code: "LOCKED_CHANGED",
    level: "red",
    area: "Books",
    title: "An entry in a closed month was changed",
    urdu: "بند مہینے کی انٹری بدلی گئی",
    why: "The books are closed through a date, so those months no longer change — but a ledger entry dated in them was added, edited or deleted afterwards. The closed books and the ledgers now disagree.",
    fix: "If the change is right, open the books again (Statements → books closed through) so it goes in, then close again; otherwise undo the change in the ledger.",
    run: async () => {
      const [r] = await rows(sql`select last_rebuild -> 'lockedChanges' k from books_settings where id = 1`);
      const keys: string[] = Array.isArray(r?.k) ? r.k : [];
      const items: Item[] = [];
      for (const k of keys.slice(0, LIMIT)) {
        const [kind, idText] = k.split(":");
        const id = Number(idText);
        let link: Link | null = null;
        let title = k;
        if (kind === "tle" && id) {
          const [e] = await rows(sql`select e.ledger_id, l.registration from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id where e.id = ${id}`);
          if (e) { link = { wb: "khata", sheet: "truck_ledgers", focus: { ledgerId: e.ledger_id, entryId: id } }; title = `Truck khata · ${e.registration}`; }
        } else if ((kind === "ple" || kind === "pship") && id) {
          const [e] = await rows(sql`select e.party_id, p.name from party_ledger_entries e join parties p on p.id = e.party_id where e.id = ${id}`);
          if (e) { link = { wb: "khata", sheet: "parties", focus: { partyId: e.party_id, entryId: id } }; title = `Party ledger · ${e.name}`; }
        } else if (kind === "ct" && id) {
          const [e] = await rows(sql`select to_char(entry_date, 'YYYY-MM-DD') d from cash_transactions where id = ${id}`);
          if (e) { link = cashLink(e.d); title = "Cash book"; }
        }
        items.push({ key: `locked:${k}`, date: null, title, detail: k, amount: null, link });
      }
      return { total: keys.length, items };
    },
  },

  // ---------------------------------------------------------------- banks
  {
    code: "BANK_BALANCE",
    level: "red",
    area: "Banks",
    title: "Bank: statement balance differs from the books",
    urdu: "بینک: اسٹیٹمنٹ کا بیلنس کتاب سے مختلف",
    why: "The books start from the bank's opening balance and add every statement line. If the statement's own balance is different, a statement (or part of one) is missing, or the opening balance is wrong.",
    fix: "Open Banks: enter the balance on the books' first day, and upload the missing statement months.",
    run: async () => {
      const list = await rows(sql`with st as (select to_char(books_start, 'YYYY-MM-DD') d from books_settings where id = 1),
        b as (select b.id, b.bank_name, b.account_number,
            (select s.balance from bank_statement_lines s where s.bank_account_id = b.id and not s.is_deleted order by s.txn_date desc, s.id desc limit 1) stmt,
            (select max(s.txn_date) from bank_statement_lines s where s.bank_account_id = b.id and not s.is_deleted) last,
            b.opening_balance + coalesce((select sum(deposit - withdrawal) from bank_statement_lines s, st where s.bank_account_id = b.id and not s.is_deleted and s.txn_date >= st.d::timestamp), 0) books
          from bank_accounts b where not b.is_deleted)
        select * from b where stmt is not null and stmt <> books and ${notDismissed("BANK_BALANCE", sql`'bank:' || b.id`)}`);
      return {
        total: list.length,
        items: list.map((r) => ({ key: `bank:${r.id}`, date: day(r.last), title: `${r.bank_name} ${r.account_number}`, detail: `statement ${num(r.stmt).toLocaleString()} · books ${num(r.books).toLocaleString()}`, amount: num(r.stmt) - num(r.books), link: { wb: "accounting", sheet: "banks" } })),
      };
    },
  },
  {
    code: "BANK_UNEXPLAINED",
    level: "amber",
    area: "Banks",
    title: "Bank statement lines not yet explained",
    urdu: "بینک اسٹیٹمنٹ کی لائنیں جن کی وضاحت نہیں",
    why: "Every line on the statement is either a ledger entry (a payment / receipt by bank) or something else (charges, a transfer between our banks, profit, tax). Until it is one of these, the books cannot say what the money was.",
    fix: "Open Banks → the line: match it to its ledger entry, or say what it is.",
    run: async () =>
      out(
        await rows(sql`select s.id, s.txn_date, s.description, s.withdrawal, s.deposit, b.bank_name, count(*) over() total
          from bank_statement_lines s join bank_accounts b on b.id = s.bank_account_id
          where not s.is_deleted and s.matched_key is null and s.kind is null and ${notDismissed("BANK_UNEXPLAINED", sql`'bs:' || s.id`)}
          order by s.txn_date desc limit ${LIMIT}`),
        (r) => ({ key: `bs:${r.id}`, date: day(r.txn_date), title: r.bank_name, detail: r.description || "—", amount: num(r.deposit) || -num(r.withdrawal), link: { wb: "accounting", sheet: "banks" } }),
      ),
  },
  {
    code: "BANK_NOT_ON_STATEMENT",
    level: "amber",
    area: "Banks",
    title: "Paid / received by bank, but not on any statement",
    urdu: "بینک سے ادائیگی / وصولی جو کسی اسٹیٹمنٹ میں نہیں",
    why: "A ledger entry says the money went through the bank, but no imported statement line is matched to it — either the statement for that date is missing, or the entry is wrong.",
    fix: "Upload that bank's statement for the date, or correct the entry's payment method.",
    run: async () => {
      const [r] = await rows(sql`select min(txn_date) a, max(txn_date) b from bank_statement_lines where not is_deleted`);
      if (!r?.a) return { total: 0, items: [] };
      return out(
        await rows(sql`select e.id, e.party_id, p.name, e.entry_date, e.debit, e.credit, e.method, e.description, e.ref_no, count(*) over() total
          from party_ledger_entries e join parties p on p.id = e.party_id
          where not e.is_deleted and e.method in ('Bank', 'Online', 'Cheque', 'Card', 'Bank Transfer', 'Online Transfer')
            and e.entry_date between ${new Date(r.a).toISOString()}::timestamp and ${new Date(r.b).toISOString()}::timestamp
            and e.entry_date < now() - interval '7 days'
            and not exists (select 1 from bank_statement_lines s where not s.is_deleted and s.matched_key = (case when e.ref_no like 'PSHIP-%' then 'pship:' else 'ple:' end) || e.id)
            and not exists (select 1 from cash_transactions t where t.link_type = 'party' and t.derived_entry_id = e.id and not t.is_deleted)
            and ${notDismissed("BANK_NOT_ON_STATEMENT", sql`'ple:' || e.id`)}
          order by e.entry_date desc limit ${LIMIT}`),
        (x) => ({ key: `ple:${x.id}`, date: day(x.entry_date), title: x.name, detail: `${x.method} · ${x.description || "—"}`, amount: num(x.debit) || num(x.credit), link: partyLink(x) }),
      );
    },
  },

  // ---------------------------------------------------------------- tax
  {
    code: "TAX_NOT_DEPOSITED",
    level: "red",
    area: "Tax",
    title: "Tax we deducted but have not paid to FBR",
    urdu: "کاٹا ہوا ٹیکس جو ایف بی آر کو جمع نہیں ہوا",
    why: "Tax kept from a payment belongs to the government; paying it late brings default surcharge and penalty.",
    fix: "Pay it to FBR and enter the deposit (with CPR / challan no) under Tax → We deducted & paid, for that month.",
    run: async () => {
      const list = await rows(sql`with d as (select to_char(entry_date, 'YYYY-MM') m, sum(tax_amount) w from tax_entries where not is_deleted and kind = 'we_deducted' group by 1),
          p as (select for_month m, sum(tax_amount) p from tax_entries where not is_deleted and kind = 'deposited' group by 1)
        select d.m, d.w, coalesce(p.p, 0) p from d left join p on p.m = d.m
        where d.w > coalesce(p.p, 0) and d.m < to_char(now(), 'YYYY-MM') and ${notDismissed("TAX_NOT_DEPOSITED", sql`'month:' || d.m`)} order by d.m desc`);
      return { total: list.length, items: list.map((r) => ({ key: `month:${r.m}`, date: `${r.m}-01`, title: `Month ${r.m}`, detail: `deducted ${num(r.w).toLocaleString()} · paid to FBR ${num(r.p).toLocaleString()}`, amount: num(r.w) - num(r.p), link: { wb: "accounting", sheet: "tax" } })) };
    },
  },
  {
    code: "TAX_NO_CERTIFICATE",
    level: "amber",
    area: "Tax",
    title: "Tax deducted from us without a certificate number",
    urdu: "ہم سے کٹا ٹیکس جس کا سرٹیفیکیٹ نمبر نہیں",
    why: "Tax a customer kept counts as the company's advance tax only with its withholding certificate.",
    fix: "Ask the customer for the withholding certificate and enter its number.",
    run: async () =>
      out(
        await rows(sql`select t.id, t.entry_date, coalesce(t.party_name, c.company, p.name, '') nm, t.tax_amount, count(*) over() total
          from tax_entries t left join contractors c on c.id = t.contractor_id left join parties p on p.id = t.party_id
          where not t.is_deleted and t.kind = 'deducted_from_us' and coalesce(t.certificate_no, '') = '' and t.entry_date < now() - interval '30 days'
            and ${notDismissed("TAX_NO_CERTIFICATE", sql`'tax:' || t.id`)} order by t.entry_date desc limit ${LIMIT}`),
        (r) => ({ key: `tax:${r.id}`, date: day(r.entry_date), title: r.nm || "—", detail: "no certificate no.", amount: num(r.tax_amount), link: { wb: "accounting", sheet: "tax" } }),
      ),
  },
  {
    code: "TAX_RATES_MISSING",
    level: "amber",
    area: "Tax",
    title: "Tax rates not entered yet",
    urdu: "ٹیکس کی شرحیں ابھی درج نہیں",
    why: "The system does not assume any tax rate. Until the consultant enters them, tax is typed as amounts and the year's estimate cannot be worked out.",
    fix: "Ask the tax consultant to fill Tax → Rates (rate and section for each line).",
    run: async () => {
      const list = await rows(sql`select code, label from tax_rates where rate is null and ${notDismissed("TAX_RATES_MISSING", sql`'rate:' || code`)} order by id`).catch(() => [] as any[]);
      return { total: list.length, items: list.map((r) => ({ key: `rate:${r.code}`, date: null, title: String(r.label).split(" · ")[0], detail: "rate not set", amount: null, link: { wb: "accounting", sheet: "tax" } })) };
    },
  },

  // ---------------------------------------------------------------- bills and invoices
  {
    code: "INVOICE_FIGURES",
    level: "red",
    area: "Invoices",
    title: "Invoice: paid / balance / status don't add up",
    urdu: "انوائس: ادا، بقایا اور حالت آپس میں نہیں ملتے",
    why: "Balance must be total − paid, and 'Paid' only when nothing is left. Otherwise the customer's dues and the reports are wrong.",
    fix: "Use “Put right” — it sets the balance and status from what has been paid.",
    fixable: "Put right",
    run: async () =>
      out(
        await rows(sql`select i.id, i.invoice_number, c.company, i.invoice_date, i.total_amount, i.paid_amount, i.outstanding_balance, i.status, count(*) over() total
          from invoices i left join contractors c on c.id = i.contractor_id
          where not i.is_deleted and (
            i.outstanding_balance <> greatest(0, i.total_amount - i.paid_amount)
            or (i.status = 'Paid' and i.paid_amount < i.total_amount)
            or (i.status in ('Unpaid', 'Overdue') and i.paid_amount > 0)
            or (i.status = 'Partially Paid' and (i.paid_amount = 0 or i.paid_amount >= i.total_amount)))
            and ${notDismissed("INVOICE_FIGURES", sql`'inv:' || i.id`)}
          order by i.invoice_date desc limit ${LIMIT}`),
        (r) => ({ key: `inv:${r.id}`, date: day(r.invoice_date), title: `${r.invoice_number} · ${r.company || ""}`, detail: `total ${num(r.total_amount).toLocaleString()} · paid ${num(r.paid_amount).toLocaleString()} · balance ${num(r.outstanding_balance).toLocaleString()} · ${r.status}`, amount: num(r.total_amount), link: { wb: "finance", sheet: "invoices" } }),
      ),
  },
  {
    code: "INVOICE_PAYMENTS",
    level: "red",
    area: "Invoices",
    title: "Invoice: 'paid' differs from the payments recorded",
    urdu: "انوائس: لکھا ہوا ادا اور درج ادائیگیاں مختلف",
    why: "The invoice says one amount was paid, but its payment list adds up to another — one of them is wrong.",
    fix: "Open Invoices → Payments: add the missing payment or undo the wrong one.",
    run: async () =>
      out(
        await rows(sql`select i.id, i.invoice_number, c.company, i.invoice_date, i.paid_amount, coalesce(p.s, 0) recorded, count(*) over() total
          from invoices i left join contractors c on c.id = i.contractor_id
          left join (select invoice_id, sum(amount)::bigint s from invoice_payments group by 1) p on p.invoice_id = i.id
          where not i.is_deleted and i.paid_amount <> coalesce(p.s, 0) and ${notDismissed("INVOICE_PAYMENTS", sql`'inv:' || i.id`)}
          order by i.invoice_date desc limit ${LIMIT}`),
        (r) => ({ key: `inv:${r.id}`, date: day(r.invoice_date), title: `${r.invoice_number} · ${r.company || ""}`, detail: `invoice says paid ${num(r.paid_amount).toLocaleString()} · payments recorded ${num(r.recorded).toLocaleString()}`, amount: num(r.paid_amount) - num(r.recorded), link: { wb: "finance", sheet: "invoices" } }),
      ),
  },
  {
    code: "BILL_FIGURES",
    level: "red",
    area: "Bills",
    title: "Vendor bill: paid / balance / status don't add up",
    urdu: "بل: ادا، بقایا اور حالت آپس میں نہیں ملتے",
    why: "Balance must be amount − paid; otherwise what you owe vendors is wrong.",
    fix: "Use “Put right” — it sets the balance and status from what has been paid.",
    fixable: "Put right",
    run: async () =>
      out(
        await rows(sql`select id, bill_number, vendor_name, bill_date, amount, paid_amount, outstanding_balance, status, count(*) over() total from bills
          where not is_deleted and (
            outstanding_balance <> greatest(0, amount - paid_amount)
            or (status = 'Paid' and paid_amount < amount)
            or (status in ('Unpaid', 'Overdue') and paid_amount > 0)
            or (status = 'Partially Paid' and (paid_amount = 0 or paid_amount >= amount)))
            and ${notDismissed("BILL_FIGURES", sql`'bill:' || id`)}
          order by bill_date desc limit ${LIMIT}`),
        (r) => ({ key: `bill:${r.id}`, date: day(r.bill_date), title: `${r.bill_number} · ${r.vendor_name}`, detail: `amount ${num(r.amount).toLocaleString()} · paid ${num(r.paid_amount).toLocaleString()} · balance ${num(r.outstanding_balance).toLocaleString()} · ${r.status}`, amount: num(r.amount), link: { wb: "finance", sheet: "bills_payments_expenses" } }),
      ),
  },
  {
    code: "CUSTOMER_BALANCE",
    level: "amber",
    area: "Invoices",
    title: "Customer's balance differs from their unpaid invoices",
    urdu: "کسٹمر کا بقایا اس کی انوائسوں سے مختلف",
    why: "What a customer owes should equal what is left on their invoices. A difference can be an old opening balance — or a payment that never reached an invoice.",
    fix: "If the customer has no old opening balance, use “Put right” to set it from the invoices.",
    fixable: "Put right",
    run: async () =>
      out(
        await rows(sql`select c.id, c.company, c.outstanding_balance, coalesce(i.s, 0) from_invoices, count(*) over() total
          from contractors c left join (select contractor_id, sum(outstanding_balance)::bigint s from invoices where not is_deleted group by 1) i on i.contractor_id = c.id
          where not c.is_deleted and c.outstanding_balance <> coalesce(i.s, 0) and ${notDismissed("CUSTOMER_BALANCE", sql`'con:' || c.id`)}
          order by abs(c.outstanding_balance - coalesce(i.s, 0)) desc limit ${LIMIT}`),
        (r) => ({ key: `con:${r.id}`, date: null, title: r.company, detail: `balance ${num(r.outstanding_balance).toLocaleString()} · unpaid invoices ${num(r.from_invoices).toLocaleString()}`, amount: num(r.outstanding_balance) - num(r.from_invoices), link: { wb: "finance", sheet: "invoices" } }),
      ),
  },

  // ---------------------------------------------------------------- trips
  {
    code: "TRIP_NO_INVOICE",
    level: "red",
    area: "Fleet Desk",
    title: "Completed trip with freight but no invoice",
    urdu: "مکمل ٹرپ جس کا کرایہ ہے مگر انوائس نہیں",
    why: "The customer was never billed, so the freight is missing from what customers owe.",
    fix: "Open the trip in Fleet Desk and set it to Completed again (it makes the invoice), or make the invoice by hand.",
    run: async () =>
      out(
        await rows(sql`select t.id, t.trip_number, v.vehicle_number, t.departure_time, t.revenue, c.company, count(*) over() total
          from trips t left join vehicles v on v.id = t.vehicle_id left join contractors c on c.id = t.contractor_id
          where not t.is_deleted and t.status = 'Completed' and t.revenue > 0
            and not exists (select 1 from invoices i where i.trip_id = t.id and not i.is_deleted)
            and ${notDismissed("TRIP_NO_INVOICE", sql`'trip:' || t.id`)}
          order by t.departure_time desc limit ${LIMIT}`),
        (r) => ({ key: `trip:${r.id}`, date: day(r.departure_time), title: `${r.vehicle_number || ""} · ${r.trip_number}`, detail: `${r.company || "no customer"} · freight ${num(r.revenue).toLocaleString()}`, amount: num(r.revenue), link: { wb: "fleet", sheet: "fleet_desk" } }),
      ),
  },
  {
    code: "TRIP_STUCK",
    level: "amber",
    area: "Fleet Desk",
    title: "Trip still 'on the road' after 30 days",
    urdu: "30 دن سے زیادہ پرانی ٹرپ ابھی تک چل رہی ہے",
    why: "Probably finished but never marked Completed — its customers are not billed and its money is not settled.",
    fix: "Open it in Fleet Desk and mark it Completed (or delete it if it never happened).",
    run: async () =>
      out(
        await rows(sql`select t.id, t.trip_number, v.vehicle_number, t.departure_time, t.status, count(*) over() total
          from trips t left join vehicles v on v.id = t.vehicle_id
          where not t.is_deleted and t.parent_trip_id is null and t.status in ('Scheduled', 'Started', 'In Transit', 'Arrived')
            and t.departure_time < now() - interval '30 days'
            and not exists (select 1 from trips n where n.parent_trip_id = t.id and not n.is_deleted and n.status = 'Completed')
            and ${notDismissed("TRIP_STUCK", sql`'trip:' || t.id`)}
          order by t.departure_time limit ${LIMIT}`),
        (r) => ({ key: `trip:${r.id}`, date: day(r.departure_time), title: `${r.vehicle_number || ""} · ${r.trip_number}`, detail: r.status, amount: null, link: { wb: "fleet", sheet: "fleet_desk" } }),
      ),
  },

  // ---------------------------------------------------------------- the double-entry books
  {
    code: "JOURNAL_UNBALANCED",
    level: "red",
    area: "Accounts",
    title: "Journal entry: debit and credit not equal",
    urdu: "جرنل انٹری: ڈیبٹ اور کریڈٹ برابر نہیں",
    why: "In double-entry books every entry must balance, or the trial balance and balance sheet will not.",
    fix: "Open Journal Entries and correct the lines.",
    run: async () =>
      out(
        await rows(sql`select j.id, j.entry_number, j.entry_date, j.description, x.d, x.c, count(*) over() total
          from journal_entries j join (select journal_entry_id, sum(debit)::bigint d, sum(credit)::bigint c from journal_lines group by 1) x on x.journal_entry_id = j.id
          where not j.is_deleted and x.d <> x.c and ${notDismissed("JOURNAL_UNBALANCED", sql`'je:' || j.id`)}
          order by j.entry_date desc limit ${LIMIT}`),
        (r) => ({ key: `je:${r.id}`, date: day(r.entry_date), title: r.entry_number, detail: `debit ${num(r.d).toLocaleString()} · credit ${num(r.c).toLocaleString()} · ${r.description || ""}`, amount: num(r.d) - num(r.c), link: { wb: "accounting", sheet: "journal_entries" } }),
      ),
  },
  {
    code: "JOURNAL_ORPHAN",
    level: "red",
    area: "Accounts",
    title: "Journal entry left behind by a deleted entry",
    urdu: "حذف شدہ انٹری کی بچی ہوئی جرنل انٹری",
    why: "The khata row / expense it came from was deleted, but the books still count the money.",
    fix: "Use “Remove them” — it takes these entries out of the books.",
    fixable: "Remove them",
    run: async () =>
      out(
        await rows(sql`select j.id, j.entry_number, j.entry_date, j.description, count(*) over() total from journal_entries j
          where not j.is_deleted and (
            (j.entry_number like 'JE-REV-%' and not exists (select 1 from truck_ledger_entries e where e.id = j.source_id and not e.is_deleted))
            or (j.entry_number like 'JE-EXP-%' and not exists (select 1 from expenses e where e.id = j.source_id and not e.is_deleted))
            or (j.entry_number like 'JE-MNT-%' and not exists (select 1 from vehicle_maintenance m where m.id = j.source_id and not m.is_deleted)))
            and ${notDismissed("JOURNAL_ORPHAN", sql`'je:' || j.id`)}
          order by j.entry_date desc limit ${LIMIT}`),
        (r) => ({ key: `je:${r.id}`, date: day(r.entry_date), title: r.entry_number, detail: r.description || "—", amount: null, link: { wb: "accounting", sheet: "journal_entries" } }),
      ),
  },
  {
    code: "BOOKS_REVIEW",
    level: "amber",
    area: "Books",
    title: "Money in the books' review accounts",
    urdu: "کتاب کے جانچ والے کھاتوں میں رقم",
    why: "These accounts hold money the system could not place with certainty — truck expenses with no category, ledger entries with no payment method, cash book entries not linked, truck capital items, Toman, bank not yet matched, opening equity. The Balance Sheet is only final once they are cleared.",
    fix: "Open Books · کتاب and click the account to see its entries; give the khata rows a category / the entries a method or link (or set the account for a category in 'Which account'). The accountant splits opening equity.",
    run: async () => {
      const list = await rows(sql`select a.code, a.name, coalesce(sum(l.debit - l.credit), 0)::bigint bal, count(l.id)::int n
        from accounts a join journal_lines l on l.account_id = a.id and not l.is_deleted
        join journal_entries j on j.id = l.journal_entry_id and not j.is_deleted
        where a.code = any(${`{${REVIEW_CODES.join(",")}}`}::text[])
        group by a.code, a.name having coalesce(sum(l.debit - l.credit), 0) <> 0 order by a.code`);
      return {
        total: list.length,
        items: list.map((r) => ({ key: `acc:${r.code}`, date: null, title: `${r.code} · ${r.name}`, detail: `${r.n.toLocaleString()} lines`, amount: num(r.bal), link: { wb: "accounting", sheet: "books" } })),
      };
    },
  },
];

const byCode = new Map(CHECKS.map((c) => [c.code, c]));

// ---------------------------------------------------------------------------------------------
router.get("/", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    await rebuildIfStale("books check opened"); // the books checks read the books as they are now
    const results = await Promise.all(
      CHECKS.map(async (c) => {
        try {
          const r = await c.run();
          return { code: c.code, level: c.level, area: c.area, title: c.title, urdu: c.urdu, why: c.why, fix: c.fix, fixable: c.fixable || null, total: r.total, items: r.items };
        } catch (e: any) {
          return { code: c.code, level: c.level, area: c.area, title: c.title, urdu: c.urdu, why: c.why, fix: c.fix, fixable: null, total: 0, items: [], error: e.message };
        }
      }),
    );
    const count = (l: Level) => results.filter((r) => r.level === l).reduce((s, r) => s + r.total, 0);
    res.json({ checkedAt: new Date().toISOString(), red: count("red"), amber: count("amber"), checks: results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Just the counts (for a badge). */
router.get("/summary", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    const results = await Promise.all(CHECKS.filter((c) => c.level !== "info").map(async (c) => ({ level: c.level, total: (await c.run().catch(() => ({ total: 0 }))).total })));
    res.json({ red: results.filter((r) => r.level === "red").reduce((s, r) => s + r.total, 0), amber: results.filter((r) => r.level === "amber").reduce((s, r) => s + r.total, 0) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------- safe automatic fixes
const FIXES: Record<string, () => Promise<number>> = {
  // the import's "balance differs" mark on rows whose balance now matches the paper
  KHATA_OLD_FLAGS: async () =>
    (
      await rows(sql`update truck_ledger_entries e set
          review_reason = nullif(regexp_replace(e.review_reason, '^running balance [^;]*(; )?', ''), ''),
          needs_review = coalesce(regexp_replace(e.review_reason, '^running balance [^;]*(; )?', ''), '') <> ''
        where not e.is_deleted and e.needs_review and e.review_reason like 'running balance%'
          and (e.sheet_balance is null or least(abs(e.running_balance - e.sheet_balance), abs(e.running_balance + e.sheet_balance)) <= 1)
        returning e.id`)
    ).length,
  // balance and status from what has been paid
  INVOICE_FIGURES: async () =>
    (
      await rows(sql`update invoices set
          outstanding_balance = greatest(0, total_amount - paid_amount),
          status = case when paid_amount >= total_amount then 'Paid' when paid_amount > 0 then 'Partially Paid'
                        when status = 'Overdue' then 'Overdue' else 'Unpaid' end,
          updated_at = now()
        where not is_deleted and (
          outstanding_balance <> greatest(0, total_amount - paid_amount)
          or (status = 'Paid' and paid_amount < total_amount)
          or (status in ('Unpaid', 'Overdue') and paid_amount > 0)
          or (status = 'Partially Paid' and (paid_amount = 0 or paid_amount >= total_amount)))
          and ${notDismissed("INVOICE_FIGURES", sql`'inv:' || id`)}
        returning id`)
    ).length,
  BILL_FIGURES: async () =>
    (
      await rows(sql`update bills set
          outstanding_balance = greatest(0, amount - paid_amount),
          status = case when paid_amount >= amount then 'Paid' when paid_amount > 0 then 'Partially Paid'
                        when status = 'Overdue' then 'Overdue' else 'Unpaid' end,
          updated_at = now()
        where not is_deleted and (
          outstanding_balance <> greatest(0, amount - paid_amount)
          or (status = 'Paid' and paid_amount < amount)
          or (status in ('Unpaid', 'Overdue') and paid_amount > 0)
          or (status = 'Partially Paid' and (paid_amount = 0 or paid_amount >= amount)))
          and ${notDismissed("BILL_FIGURES", sql`'bill:' || id`)}
        returning id`)
    ).length,
  CUSTOMER_BALANCE: async () =>
    (
      await rows(sql`update contractors c set outstanding_balance = coalesce((select sum(outstanding_balance) from invoices i where i.contractor_id = c.id and not i.is_deleted), 0)
        where not c.is_deleted and c.outstanding_balance <> coalesce((select sum(outstanding_balance) from invoices i where i.contractor_id = c.id and not i.is_deleted), 0)
          and ${notDismissed("CUSTOMER_BALANCE", sql`'con:' || c.id`)}
        returning c.id`)
    ).length,
  JOURNAL_ORPHAN: async () => {
    const gone = await rows(sql`select j.id from journal_entries j
      where not j.is_deleted and (
        (j.entry_number like 'JE-REV-%' and not exists (select 1 from truck_ledger_entries e where e.id = j.source_id and not e.is_deleted))
        or (j.entry_number like 'JE-EXP-%' and not exists (select 1 from expenses e where e.id = j.source_id and not e.is_deleted))
        or (j.entry_number like 'JE-MNT-%' and not exists (select 1 from vehicle_maintenance m where m.id = j.source_id and not m.is_deleted)))
        and ${notDismissed("JOURNAL_ORPHAN", sql`'je:' || j.id`)}`);
    const ids = gone.map((g) => Number(g.id));
    if (!ids.length) return 0;
    await db.execute(sql`delete from journal_lines where journal_entry_id = any(${`{${ids.join(",")}}`}::int[])`);
    await db.execute(sql`delete from journal_entries where id = any(${`{${ids.join(",")}}`}::int[])`);
    return ids.length;
  },
};

router.post("/fix/:code", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const code = req.params.code;
    const fix = FIXES[code];
    if (!fix || !byCode.get(code)?.fixable) return res.status(400).json({ error: "This one cannot be fixed automatically — open each item and correct it" });
    const n = await fix();
    await logAudit({ action: "UPDATE", tableName: "books_check", recordId: 0, oldValues: { code }, newValues: { fixed: n }, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.json({ ok: true, fixed: n });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------- "this is correct"
router.post("/dismiss", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const { code, key, note } = req.body || {};
    if (!byCode.has(code) || !key) return res.status(400).json({ error: "Which check and which item?" });
    if (byCode.get(code)!.level === "info") return res.status(400).json({ error: "Nothing to mark here" });
    await db
      .insert(schema.checkDismissals)
      .values({ code, itemKey: String(key), note: note ? String(note).slice(0, 500) : null, createdBy: req.user?.id })
      .onConflictDoNothing();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/dismiss", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const { code, key } = req.body || {};
    await db.delete(schema.checkDismissals).where(and(eq(schema.checkDismissals.code, String(code)), eq(schema.checkDismissals.itemKey, String(key))));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/dismissed", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    res.json(
      await rows(sql`select d.id, d.code, d.item_key, d.note, d.created_at, u.name as by_name from check_dismissals d left join users u on u.id = d.created_by order by d.created_at desc limit 500`).catch(async () =>
        rows(sql`select id, code, item_key, note, created_at from check_dismissals order by created_at desc limit 500`),
      ),
    );
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Row flags for one truck khata / party ledger, so its rows show red right there. */
export async function rowIssues(kind: "tle" | "ple", ids: number[]): Promise<Map<number, string>> {
  const m = new Map<number, string>();
  if (!ids.length) return m;
  const arr = `{${ids.join(",")}}`;
  const list =
    kind === "tle"
      ? await rows(sql`select e.id,
            case when e.entry_date > now() + interval '1 day' and (e.received > 0 or e.paid > 0) then 'KHATA_FUTURE_DATE'
                 when e.received > 0 and e.paid > 0 then 'KHATA_BOTH_SIDES' end as code
          from truck_ledger_entries e where e.id = any(${arr}::int[]) and not e.is_deleted`)
      : await rows(sql`select e.id,
            case when e.entry_date > now() + interval '1 day' and (e.debit > 0 or e.credit > 0) then 'PARTY_FUTURE_DATE'
                 when e.debit > 0 and e.credit > 0 then 'PARTY_BOTH_SIDES' end as code
          from party_ledger_entries e where e.id = any(${arr}::int[]) and not e.is_deleted`);
  const flagged = list.filter((r) => r.code);
  if (!flagged.length) return m;
  const dismissed = new Set(
    (await rows(sql`select code || '|' || item_key k from check_dismissals where item_key = any(${`{${flagged.map((r) => `"${kind}:${r.id}"`).join(",")}}`}::text[])`)).map((r) => r.k),
  );
  const TEXT: Record<string, string> = {
    KHATA_FUTURE_DATE: "Date in the future — correct the year · غلط تاریخ",
    PARTY_FUTURE_DATE: "Date in the future — correct the year · غلط تاریخ",
    KHATA_BOTH_SIDES: "Money both in and out on one row · ایک لائن میں دونوں طرف",
    PARTY_BOTH_SIDES: "Both naam and jama on one row · ایک لائن میں دونوں طرف",
  };
  for (const r of flagged) if (!dismissed.has(`${r.code}|${kind}:${r.id}`)) m.set(Number(r.id), TEXT[r.code]);
  return m;
}

export default router;
