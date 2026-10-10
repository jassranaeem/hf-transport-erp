#!/usr/bin/env node
/**
 * READ-ONLY accounting audit for HFK ERP.
 *
 * Opens the database in a READ ONLY transaction (the database itself refuses any write), works out
 * every figure a second, independent way, and compares it with what the books engine posted.
 * Nothing is changed. Writes:
 *   <out>/accounting-audit.md          the findings
 *   <out>/other-classification.csv     truck-khata rows in category "Other" with a PROPOSED category
 *                                      and confidence (a proposal only — nothing is applied)
 *
 * Run (the DATABASE_URL decides which database is audited — local or live):
 *   DATABASE_URL="postgres://…" node scripts/audit-accounting.mjs [outDir]
 * Live: keep the read-only login in .env.audit (made by scripts/make-audit-role.mjs) and run
 *   node --env-file=.env.audit scripts/audit-accounting.mjs audit-live
 * The connection string is never printed. On any non-local database the script refuses to run with a
 * login that can write, and leaves names / descriptions out of the report (ids and totals only).
 */
import pg from "pg";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { readFileSync } from "fs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL first (the database to audit).");
  process.exit(1);
}
const OUT = process.argv[2] || "audit-out";
mkdirSync(OUT, { recursive: true });

const db = new pg.Client({ connectionString: url, ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined });
await db.connect();
await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"); // one consistent snapshot, no writes possible
await db.query("SET LOCAL statement_timeout = '120s'");
const q = async (s, a = []) => (await db.query(s, a)).rows;
const one = async (s, a = []) => (await q(s, a))[0] || {};
const n = (v) => Math.round(Number(v || 0));
const pkr = (v) => (n(v) < 0 ? "−" : "") + Math.abs(n(v)).toLocaleString("en-US");

const md = [];
const results = []; // { area, status: PASS|FAIL|WARN|INFO, finding, impact }
const say = (s = "") => md.push(s);
const rec = (area, status, finding, impact = "") => {
  results.push({ area, status, finding, impact });
  say(`- **${status}** — ${finding}${impact ? ` _(impact: ${impact})_` : ""}`);
};
const PII = new Set(["party", "partner", "description", "cash_desc", "v"]); // names / free text — left out of a live report
const table = (rows, cols) => {
  if (REDACT) cols = cols.filter((c) => !PII.has(c));
  if (!rows.length) return say("_(none)_");
  say(`| ${cols.join(" | ")} |`);
  say(`| ${cols.map(() => "---").join(" | ")} |`);
  for (const r of rows) say(`| ${cols.map((c) => String(r[c] ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 90)).join(" | ")} |`);
};

const host = (() => { try { return new URL(url).host; } catch { return "?"; } })();
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
var REDACT = !LOCAL || process.env.AUDIT_REDACT === "1";

// ---- who are we connected as, and can this login write? (live: must be the read-only role)
const who = await one(`select current_user u, current_database() d, current_setting('server_version') v, current_setting('transaction_read_only') ro,
  (select setting from pg_settings where name = 'default_transaction_read_only') dro, inet_server_port() port`);
const writable = await one(`select count(*)::int c from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r' and has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')`);
if (!LOCAL && writable.c > 0 && process.env.AUDIT_ALLOW_WRITER !== "1") {
  console.error(`Refusing to audit ${host}: the login "${who.u}" can write to ${writable.c} table(s). Use the read-only role made by scripts/make-audit-role.mjs.`);
  await db.query("ROLLBACK");
  await db.end();
  process.exit(2);
}
const st = await one(`select to_char(books_start,'YYYY-MM-DD') start, to_char(locked_through,'YYYY-MM-DD') locked, last_rebuild_at, last_rebuild ->> 'signature' sig from books_settings where id = 1`).catch(() => ({}));
const START = st.start || "2025-07-01";

say(`# HFK ERP — read-only accounting audit`);
say(``);
say(`- Database: \`${host}\` (read-only snapshot)  `);
say(`- Run at: ${new Date().toISOString()}  `);
say(`- Books start: ${START} · closed through: ${st.locked || "—"} · books last built: ${st.last_rebuild_at ? new Date(st.last_rebuild_at).toISOString() : "never"}`);
say(`- Login: \`${who.u}\` on database \`${who.d}\` (Postgres ${who.v}); this session read-only: ${who.ro}; login's default read-only: ${who.dro}; tables this login can write: ${writable.c}`);
say(`- Names and descriptions: ${REDACT ? "left out (ids and totals only)" : "shown (local database)"}`);
say(``);

// ------------------------------------------------------------------------------------------------
say(`## P. Which database is this, and what is in it?`);
const journal = (() => { try { return JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")).entries; } catch { return []; } })();
const mig = await one(`select count(*)::int c, max(created_at)::bigint last from drizzle.__drizzle_migrations`).catch((e) => ({ c: null, err: e.message }));
const lastTag = journal.length ? journal[journal.length - 1] : null;
if (mig.c == null) rec("Schema version", "WARN", `Could not read the migrations table (${mig.err}).`);
else if (lastTag && mig.c === journal.length && Number(mig.last) === Number(lastTag.when)) rec("Schema version", "PASS", `All ${mig.c} migrations of this code are applied (latest: ${lastTag.tag}) — the deployed app has started against this database since the last schema change.`);
else rec("Schema version", "WARN", `${mig.c} migration(s) applied; this code has ${journal.length} (latest ${lastTag?.tag}).`, "the database and the code are on different versions");
const act = await one(`select (select max(created_at) from audit_logs) audit, (select max(last_login_at) from users) login,
  (select count(*) from users)::int users, (select min(created_at) from users) first_user,
  (select max(updated_at) from truck_ledger_entries) tle, (select max(updated_at) from cash_transactions) ct, (select max(updated_at) from party_ledger_entries) ple`);
const iso = (d) => (d ? new Date(d).toISOString().replace(".000Z", "Z") : "—");
say(`Latest activity written by the app: audit log ${iso(act.audit)} · last login ${iso(act.login)} · last truck-khata change ${iso(act.tle)} · cash book ${iso(act.ct)} · party ledger ${iso(act.ple)} · books built ${iso(st.last_rebuild_at)}. ${act.users} user(s); first user created ${iso(act.first_user)}.`);
say(`If these times match when you last used the live app, the live app is writing to this database.`);
say(``);

// every table: rows, soft-deleted, imported from Excel, first / last created
const tabs = await q(`select c.relname t,
    bool_or(a.attname = 'created_at') hc, bool_or(a.attname = 'is_deleted') hd, bool_or(a.attname = 'source_row') hsr, bool_or(a.attname = 'source_sheet') hss
  from pg_class c join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where s.nspname = 'public' and c.relkind = 'r' group by 1 order by 1`);
const inventory = {};
for (const t of tabs) {
  const imp = [t.hsr && "source_row is not null", t.hss && "source_sheet is not null"].filter(Boolean).join(" or ");
  const r = await one(`select count(*)::int n${t.hd ? ", count(*) filter (where is_deleted)::int del" : ""}${imp ? `, count(*) filter (where ${imp})::int imported` : ""}${t.hc ? ", min(created_at) first, max(created_at) last" : ""} from "${t.t}"`).catch((e) => ({ n: null, err: e.message }));
  inventory[t.t] = { rows: r.n, deleted: r.del ?? null, imported: r.imported ?? null, first: r.first ? iso(r.first) : null, last: r.last ? iso(r.last) : null, error: r.err };
}
const nonEmpty = Object.entries(inventory).filter(([, v]) => v.rows);
say(`${tabs.length} tables; ${nonEmpty.length} have records. Full list in \`inventory.json\`.`);
table(nonEmpty.sort((a, b) => b[1].rows - a[1].rows).map(([t, v]) => ({ table: t, rows: v.rows, deleted: v.deleted ?? "", imported: v.imported ?? "", first: (v.first || "").slice(0, 10), last: (v.last || "").slice(0, 10) })), ["table", "rows", "deleted", "imported", "first", "last"]);
say(``);
say(`Days on which the most ledger / cash / party records were created (a big spike is usually a file import):`);
const spikes = await q(`select d::date created_on, sum(c)::int records, string_agg(t || ' ' || c, ', ' order by c desc) tables from (
    select 'truck-khata' t, created_at::date d, count(*) c from truck_ledger_entries group by 2
    union all select 'party-ledger', created_at::date, count(*) from party_ledger_entries group by 2
    union all select 'cash-book', created_at::date, count(*) from cash_transactions group by 2
    union all select 'parties', created_at::date, count(*) from parties group by 2
    union all select 'khatas', created_at::date, count(*) from truck_ledgers group by 2) x group by 1 order by 2 desc limit 12`);
table(spikes, ["created_on", "records", "tables"]);
const hist = await one(`select (select count(*) from truck_ledger_entries where not is_deleted and (entry_date < $1::timestamp or entry_date is null))::int tle_old,
  (select count(*) from party_ledger_entries where not is_deleted and (entry_date < $1::timestamp or entry_date is null))::int ple_old,
  (select count(*) from truck_ledger_entries where not is_deleted and source_row is not null)::int tle_imp,
  (select count(*) from party_ledger_entries where not is_deleted and source_row is not null)::int ple_imp`, [START]);
const fresh = !hist.tle_old && !hist.ple_old && !hist.tle_imp && !hist.ple_imp;
rec("Fresh start", fresh ? "PASS" : "INFO", fresh
  ? `No khata or party rows from before ${START} and none imported from Excel — the database started fresh.`
  : `Khata rows dated before ${START} or undated: ${hist.tle_old}; party-ledger rows before ${START} or undated: ${hist.ple_old}; rows imported from Excel: truck ${hist.tle_imp}, party ${hist.ple_imp}. These are history brought in (by import or by hand), not a fresh start.`);
say(``);

// ------------------------------------------------------------------------------------------------
say(`## 0. Are the books current?`);
// same fingerprint as server/books.ts booksSignature()
const part = (t, m) => `(select count(*) || '/' || coalesce(max(id), 0) || '/' || coalesce(sum(${m}), 0) || '/' || coalesce(sum(extract(epoch from updated_at))::bigint, 0) || '/' || count(*) filter (where is_deleted) from ${t})`;
const sig = await one(`select md5(concat_ws('|',
  ${part("truck_ledger_entries", "received + paid")}, ${part("party_ledger_entries", "debit + credit")}, ${part("cash_transactions", "amount")},
  ${part("personal_expenses", "amount")}, ${part("zakat_payments", "amount")}, ${part("truck_ledgers", "0")}, ${part("partnership_accounts", "0")}, ${part("parties", "opening_balance")},
  ${part("bank_statement_lines", "deposit + withdrawal + coalesce(length(matched_key), 0) + coalesce(length(kind), 0)")}, ${part("bank_accounts", "opening_balance")},
  ${part("tax_entries", "tax_amount + gross_amount")},
  (select count(*) || '/' || coalesce(sum(extract(epoch from updated_at))::bigint, 0) from posting_rules),
  (select count(*) || '/' || coalesce(max(id), 0) from journal_entries where not is_auto),
  (select to_char(books_start, 'YYYY-MM-DD') || '/' || coalesce(to_char(locked_through, 'YYYY-MM-DD'), '') from books_settings where id = 1))) s`).catch((e) => ({ s: "error: " + e.message }));
if (!st.sig) rec("Books current", "FAIL", "The books have never been built on this database.", "every accounting figure below would be empty");
else if (sig.s === st.sig) rec("Books current", "PASS", "The books were built from exactly the records now in the database (fingerprint matches).");
else rec("Books current", "WARN", "Records changed since the books were last built — figures below compare the CURRENT records with the LAST built books; open Books or press Rebuild, then re-run.", "differences may be timing, not errors");

// ------------------------------------------------------------------------------------------------
say(``);
say(`## 1. Real records, not demo / hardcoded values`);
const demo = await q(`
  select 'contractors' t, id, company v from contractors where not is_deleted and (company ilike '%demo%' or company ilike '%test%' or company like 'ZZ%' or company in ('Rehman Cargo Services','Lucky Cement','Fauji Fertilizer','PSO Fuel Corp','Nestle Pakistan'))
  union all select 'parties', id, name from parties where not is_deleted and (name ilike '%demo%' or name like 'ZZ%' or name ilike 'test %')
  union all select 'vehicles', id, vehicle_number from vehicles where not is_deleted and (vehicle_number like 'ZZ%' or vehicle_number ilike '%demo%' or vehicle_number ilike '%test%')
  union all select 'truck_ledgers', id, title from truck_ledgers where not is_deleted and (title like 'ZZ%' or title ilike '%demo%' or title ilike '%test%')
  union all select 'cash_transactions', id, description from cash_transactions where not is_deleted and (description like 'ZZ%' or description ilike '%demo%')
  union all select 'truck_ledger_entries', id, description from truck_ledger_entries where not is_deleted and (description like 'ZZ%' or description ilike '%seeded demo%')
  union all select 'vehicle_maintenance', id, remarks from vehicle_maintenance where not is_deleted and remarks ilike '%seeded demo%'
  limit 40`).catch(() => []);
if (demo.length) {
  rec("Demo data", "WARN", `${demo.length} record(s) look like demo / test data (names with Demo, Test, ZZ, or the demo seeder's sample companies).`, "they are counted in the books like real records");
  table(demo, ["t", "id", "v"]);
} else rec("Demo data", "PASS", "No records with demo / test markers were found in customers, parties, trucks, khatas, cash book or maintenance.");
const counts = await one(`select (select count(*) from truck_ledger_entries where not is_deleted)::int tle, (select count(*) from party_ledger_entries where not is_deleted)::int ple,
  (select count(*) from cash_transactions where not is_deleted)::int ct, (select count(*) from journal_entries)::int je, (select count(*) from journal_entries where is_auto)::int je_auto,
  (select count(*) from invoices where not is_deleted)::int inv, (select count(*) from bank_statement_lines where not is_deleted)::int bsl, (select count(*) from tax_entries where not is_deleted)::int tax`);
say(``);
say(`Records in this database: truck-khata rows ${counts.tle}, party-ledger rows ${counts.ple}, cash-book entries ${counts.ct}, invoices ${counts.inv}, bank statement lines ${counts.bsl}, tax entries ${counts.tax}; journal entries ${counts.je} (${counts.je_auto} built by the books engine).`);

// ------------------------------------------------------------------------------------------------
say(``);
say(`## 2. Double entry, opening balances, cash, partners, trucks, statements`);
say(`### 2a. Double entry`);
const tb = await one(`select coalesce(sum(debit),0)::bigint d, coalesce(sum(credit),0)::bigint c from journal_lines where not is_deleted`);
tb.d === tb.c ? rec("Trial balance", "PASS", `Whole book: debit ${pkr(tb.d)} = credit ${pkr(tb.c)}.`) : rec("Trial balance", "FAIL", `Whole book does not balance: debit ${pkr(tb.d)} vs credit ${pkr(tb.c)}.`, pkr(n(tb.d) - n(tb.c)));
const unbal = await q(`select j.id, j.entry_number, j.entry_date::date d, sum(l.debit)::bigint dr, sum(l.credit)::bigint cr from journal_entries j join journal_lines l on l.journal_entry_id = j.id and not l.is_deleted where not j.is_deleted group by j.id having sum(l.debit) <> sum(l.credit) limit 20`);
unbal.length ? (rec("Entries balance", "FAIL", `${unbal.length} journal entr(ies) have debit ≠ credit.`), table(unbal, ["id", "entry_number", "d", "dr", "cr"])) : rec("Entries balance", "PASS", "Every journal entry balances on its own.");
const empty = await one(`select count(*)::int c from journal_entries j where not j.is_deleted and not exists (select 1 from journal_lines l where l.journal_entry_id = j.id and not l.is_deleted)`);
empty.c ? rec("Entries without lines", "WARN", `${empty.c} journal entr(ies) have no lines.`) : rec("Entries without lines", "PASS", "No empty journal entries.");
const legacy = await q(`select left(entry_number, 8) k, count(*)::int c from journal_entries j where
    j.entry_number like 'JE-REV-%'
    or (j.entry_number like 'JE-EXP-%' and exists (select 1 from expenses x where x.id = j.source_id and x.source_entry_id is not null))
    or (j.entry_number like 'JE-MNT-%' and exists (select 1 from vehicle_maintenance m where m.id = j.source_id and m.source_entry_id is not null))
    or (j.entry_number like 'JE-PAY-%' and exists (select 1 from payments p where p.id = j.source_id and p.reference_number like 'TRIP-%'))
  group by 1`);
legacy.length ? rec("Double counting (old postings)", "FAIL", `Older automatic postings that the books engine replaces are still present: ${legacy.map((l) => `${l.k}… ×${l.c}`).join(", ")}.`, "the same khata money counted twice until the books are rebuilt") : rec("Double counting (old postings)", "PASS", "No older per-import postings (JE-REV / synced JE-EXP / JE-MNT / Close-trip JE-PAY) remain beside the engine's postings.");
const deadSrc = await q(`select j.source_key from journal_entries j where j.is_auto and (
    ((j.source_key like 'tle:%' or j.source_key like 'tlo:%') and not exists (select 1 from truck_ledger_entries e where e.id = split_part(j.source_key, ':', 2)::int and not e.is_deleted))
    or (j.source_key like 'ple:%' and not exists (select 1 from party_ledger_entries e where e.id = split_part(j.source_key, ':', 2)::int and not e.is_deleted))
    or (j.source_key like 'pship:%' and not exists (select 1 from party_ledger_entries e where e.id = split_part(j.source_key, ':', 2)::int and not e.is_deleted))
    or (j.source_key like 'ct:%' and not exists (select 1 from cash_transactions e where e.id = split_part(j.source_key, ':', 2)::int and not e.is_deleted))
    or (j.source_key like 'bs:%' and not exists (select 1 from bank_statement_lines e where e.id = split_part(j.source_key, ':', 2)::int and not e.is_deleted))
    or (j.source_key like 'tax:%' and not exists (select 1 from tax_entries e where e.id = split_part(j.source_key, ':', 2)::int and not e.is_deleted)))
  limit 20`);
deadSrc.length ? rec("Deleted records in the books", "FAIL", `${deadSrc.length}+ book entries point at records that are deleted or gone (e.g. ${deadSrc.slice(0, 5).map((r) => r.source_key).join(", ")}).`, "money of deleted entries still counted until rebuild") : rec("Deleted records in the books", "PASS", "No book entry comes from a deleted or missing record.");

say(``);
say(`### 2b. What the books leave out on purpose (and what that means)`);
const skipped = await q(`select 'Truck khata: money on BOTH sides of one row (not posted)' what, count(*)::int c, sum(received + paid)::bigint amt from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
    where not e.is_deleted and not l.is_deleted and e.entry_date >= $1::timestamp and e.received > 0 and e.paid > 0
  union all select 'Truck khata: money with NO date (not posted)', count(*)::int, sum(received + paid)::bigint from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
    where not e.is_deleted and not l.is_deleted and e.entry_date is null and (e.received > 0 or e.paid > 0) and not (e.sr_no is null and e.source_row is not null and e.sheet_balance is null)
  union all select 'Party ledger: both naam and jama on one row (not posted)', count(*)::int, sum(debit + credit)::bigint from party_ledger_entries where not is_deleted and entry_date >= $1::timestamp and debit > 0 and credit > 0
  union all select 'Party ledger: money with NO date (not posted)', count(*)::int, sum(debit + credit)::bigint from party_ledger_entries where not is_deleted and entry_date is null and (debit > 0 or credit > 0)
  union all select 'Truck khata: side-box figures (paper notes, by design)', count(*)::int, sum(received + paid)::bigint from truck_ledger_entries e where not e.is_deleted and e.entry_date >= $1::timestamp and e.sr_no is null and e.source_row is not null and e.sheet_balance is null and (e.received > 0 or e.paid > 0)
  union all select 'Truck khata: صافی بچت / carried-forward markers (by design)', count(*)::int, sum(received + paid)::bigint from truck_ledger_entries e where not e.is_deleted and e.entry_date >= $1::timestamp and (e.received > 0 or e.paid > 0) and (coalesce(e.category,'') = 'SafiBachat' or coalesce(e.description,'') ~* 'قرضدار|qarz\\s*d[ae]r|qarzder|بچت|bach?at|bacht')`, [START]);
table(skipped.map((s) => ({ ...s, amt: pkr(s.amt) })), ["what", "c", "amt"]);
const notPosted = skipped.slice(0, 4).reduce((s, r) => s + n(r.amt), 0);
notPosted ? rec("Rows the books cannot post", "WARN", `${pkr(notPosted)} of ledger money sits in rows the books cannot place (both sides on one row, or no date). Some of it is from before the books start and would not be in the books anyway; see 2e-2 for what it does to party balances.`, `up to ${pkr(notPosted)}, depending on which period the undated rows belong to`) : rec("Rows the books cannot post", "PASS", "No ambiguous rows left out of the books.");

say(``);
say(`### 2c. Opening balances on ${START}`);
const opening = await q(`select a.code, l.party_id, sum(l.debit - l.credit)::bigint b from journal_entries j join journal_lines l on l.journal_entry_id = j.id join accounts a on a.id = l.account_id where j.source_key = 'opening' group by 1, 2`);
const openDate = await one(`select entry_date::text d from journal_entries where source_key = 'opening'`);
const expCash = await one(`select coalesce(sum(case when direction='In' then amount else -amount end),0)::bigint b from cash_transactions where not is_deleted and entry_date < $1::timestamp`, [START]);
const roles = await q(`select partner_party_id p, 'partner' r from partnership_accounts where not is_deleted union select hfk_party_id, 'hfk' from partnership_accounts where not is_deleted`);
const roleOf = new Map(roles.map((r) => [n(r.p), r.r]));
// a party's opening balance (the figure on the party itself) counts as owed on the first day
const expParty = await q(`select party_id, sum(b)::bigint b from (select party_id, debit - credit b from party_ledger_entries where not is_deleted and entry_date < $1::timestamp
    union all select id, opening_balance from parties where not is_deleted and opening_balance <> 0) x group by 1 having sum(b) <> 0`, [START]);
const expBank = await q(`select '12' || lpad(id::text, 2, '0') code, opening_balance::bigint b from bank_accounts where not is_deleted and opening_balance <> 0`);
const want = new Map();
const add = (k, v) => want.set(k, (want.get(k) || 0) + n(v));
if (n(expCash.b)) add("1001|", expCash.b);
for (const p of expParty) { const r = roleOf.get(n(p.party_id)); if (r !== "hfk") add(`${r === "partner" ? "2200" : "1150"}|${p.party_id}`, p.b); }
for (const b of expBank) add(`${b.code}|`, b.b);
const have = new Map(opening.filter((o) => o.code !== "3900").map((o) => [`${o.code}|${o.party_id ?? ""}`, n(o.b)]));
const keys = new Set([...want.keys(), ...have.keys()]);
const odiff = [...keys].map((k) => ({ k, want: want.get(k) || 0, have: have.get(k) || 0 })).filter((x) => x.want !== x.have);
say(`Opening entry dated: ${openDate.d || "— (none)"}. Recomputed independently from the ledgers: cash before ${START} ${pkr(expCash.b)}, ${expParty.length} party balances, ${expBank.length} bank opening balance(s).`);
if (!opening.length && !want.size) rec("Opening balances", "INFO", "Nothing to bring in before the books start (no earlier cash, party or bank balances).");
else if (odiff.length) { rec("Opening balances", "FAIL", `${odiff.length} opening line(s) differ from the ledgers' balances before ${START}.`, pkr(odiff.reduce((s, x) => s + x.want - x.have, 0))); table(odiff.slice(0, 20), ["k", "want", "have"]); }
else rec("Opening balances", "PASS", `Every opening line equals the ledgers' own balance before ${START} (cash, ${expParty.length} parties / partners, banks); the rest is in opening balance equity (3900) for the accountant.`);
const bankOpen = await one(`select count(*)::int total, count(*) filter (where opening_balance <> 0)::int entered from bank_accounts where not is_deleted`);
if (bankOpen.total && !bankOpen.entered) rec("Bank opening balances", "WARN", `None of the ${bankOpen.total} bank accounts has its 30.06.2025 balance entered — banks start at zero in the books.`, "Balance Sheet bank figures understated until entered");
// time-zone edge: entries typed for 1 July at local midnight are stored a few hours earlier (UTC)
const edge = await q(`select 'cash book' src, count(*)::int c, sum(amount)::bigint amt from cash_transactions where not is_deleted and entry_date >= $1::timestamp - interval '6 hours' and entry_date < $1::timestamp
  union all select 'truck khata', count(*)::int, sum(received + paid)::bigint from truck_ledger_entries where not is_deleted and entry_date >= $1::timestamp - interval '6 hours' and entry_date < $1::timestamp
  union all select 'party ledger', count(*)::int, sum(debit + credit)::bigint from party_ledger_entries where not is_deleted and entry_date >= $1::timestamp - interval '6 hours' and entry_date < $1::timestamp`, [START]);
const edgeN = edge.reduce((s, e) => s + n(e.c), 0);
edgeN ? (rec("1 July boundary", "WARN", `${edgeN} entr(ies) are stored in the 6 hours before ${START} 00:00 — Pakistan-time dates saved as UTC can land on 30 June and be treated as opening instead of July.`, pkr(edge.reduce((s, e) => s + n(e.amt), 0))), table(edge, ["src", "c", "amt"])) : rec("1 July boundary", "PASS", `No entries sit in the hours just before ${START} (no time-zone spill between June and July).`);

say(``);
say(`### 2d. Cash on hand: books vs Daily Cash Book`);
const cashBook = await one(`select coalesce(sum(case when direction='In' then amount else -amount end),0)::bigint b from cash_transactions where not is_deleted`);
const gl1001 = await q(`select case when j.is_auto and j.source_key like 'ct:%' then 'cash book' when j.source_key = 'opening' then 'opening' when j.entry_number like 'JE-PAY-%' then 'invoice payments in cash' when j.entry_number like 'JE-EXP-%' then 'Finance expenses' when j.entry_number like 'JE-BILLPAY-%' then 'bill payments' else coalesce(j.source_type, '?') || ' (' || left(j.entry_number, 7) || ')' end src,
    sum(l.debit - l.credit)::bigint b, count(*)::int c
  from journal_lines l join journal_entries j on j.id = l.journal_entry_id join accounts a on a.id = l.account_id where a.code = '1001' and not l.is_deleted and not j.is_deleted group by 1 order by 1`);
const glCash = gl1001.reduce((s, r) => s + n(r.b), 0);
const fromCB = gl1001.filter((r) => r.src === "cash book" || r.src === "opening").reduce((s, r) => s + n(r.b), 0);
say(`Daily Cash Book balance (all entries): **${pkr(cashBook.b)}** · Cash on hand in the books (1001): **${pkr(glCash)}**`);
table(gl1001.map((r) => ({ ...r, b: pkr(r.b) })), ["src", "c", "b"]);
if (fromCB === n(cashBook.b) && glCash === n(cashBook.b)) rec("Cash book = books", "PASS", `Cash in the books equals the Daily Cash Book (${pkr(glCash)}).`);
else if (fromCB === n(cashBook.b)) rec("Cash book = books", "WARN", `The cash-book part of the books equals the Daily Cash Book (${pkr(fromCB)}), but other modules also move cash on hand without a cash-book entry: ${gl1001.filter((r) => r.src !== "cash book" && r.src !== "opening").map((r) => `${r.src} ${pkr(r.b)}`).join("; ")}.`, `${pkr(glCash - fromCB)} of cash movement not in the Daily Cash Book`);
else rec("Cash book = books", "FAIL", `Cash-book postings in the books (${pkr(fromCB)}) differ from the Daily Cash Book (${pkr(cashBook.b)}).`, pkr(fromCB - n(cashBook.b)));

say(``);
say(`### 2e. Partners: books vs Partner P&L`);
const pacc = await q(`select pa.id, pa.partner_party_id p, (select name from parties where id = pa.partner_party_id) name, tl.registration from partnership_accounts pa join truck_ledgers tl on tl.id = pa.truck_ledger_id where not pa.is_deleted`);
const KIND = { opening: "Opening joint pool", safi: "Safi bachat", loss: "Loss split", shakhsi: "Shakhsi bardasht", debt: "Old qarz", repayment: "Qarz returned", payout: "Share paid out" };
const kindOf = (lbl) => Object.entries(KIND).find(([, v]) => String(lbl || "").startsWith(v))?.[0];
const prow = [];
for (const a of pacc) {
  const rows = await q(`select section_label, method, debit, credit from party_ledger_entries where not is_deleted and ref_no = $1 and party_id = $2`, [`PSHIP-${a.id}`, a.p]);
  const s = { share: 0, withdrawn: 0, paidOut: 0, debt: 0, memo: 0 };
  for (const r of rows) {
    const k = kindOf(r.section_label);
    const d = n(r.debit), c = n(r.credit);
    if (k === "opening" || k === "safi" || k === "loss") s.share += c - d;
    else if (k === "shakhsi") { s.withdrawn += d - c; if (r.method === "Adjustment") s.memo += d - c; }
    else if (k === "payout") s.paidOut += d - c;
    else if (k === "debt" || k === "repayment") s.debt += d - c;
  }
  const pnlNet = s.share - s.withdrawn - s.paidOut - s.debt;
  const gl = await one(`select coalesce(sum(l.credit - l.debit),0)::bigint b from journal_lines l join journal_entries j on j.id = l.journal_entry_id join accounts a on a.id = l.account_id where a.code = '2200' and l.party_id = $1 and not l.is_deleted and not j.is_deleted`, [a.p]);
  prow.push({ partner: a.name, truck: a.registration, partner_pnl: pnlNet, books_2200: n(gl.b), difference: n(gl.b) - pnlNet, memo_shakhsi: s.memo });
}
if (!prow.length) rec("Partners", "INFO", "No partnership accounts.");
else {
  table(prow.map((r) => ({ ...r, partner_pnl: pkr(r.partner_pnl), books_2200: pkr(r.books_2200), difference: pkr(r.difference), memo_shakhsi: pkr(r.memo_shakhsi) })), ["partner", "truck", "partner_pnl", "books_2200", "difference", "memo_shakhsi"]);
  const bad = prow.filter((r) => r.difference !== 0);
  const explained = bad.filter((r) => r.difference === r.memo_shakhsi);
  if (!bad.length) rec("Partners", "PASS", `Each partner's account in the books equals Partner P&L's "with us" figure (${prow.length} partner(s)).`);
  else if (explained.length === bad.length) rec("Partners", "WARN", `${bad.length} partner(s) differ by exactly the "matched" شخصی lines (written for the partner when HFK took money, method Adjustment): Partner P&L counts them, the books treat them as a memo.`, `${pkr(bad.reduce((s, r) => s + r.difference, 0))} — needs the accountant's decision`);
  else rec("Partners", "FAIL", `${bad.length} partner(s): books and Partner P&L differ by more than the matched شخصی lines (partner entries made outside Partner P&L, e.g. cash book linked to the partner, or opening).`, pkr(bad.reduce((s, r) => s + r.difference - r.memo_shakhsi, 0)));
}

say(``);
say(`### 2e-2. Party balances: books vs Party Ledgers`);
const partyRec = await q(`with led0 as (select party_id, sum(debit - credit)::bigint led, sum(case when entry_date is null then debit - credit else 0 end)::bigint undated,
      sum(case when entry_date >= '${START}'::timestamp and debit > 0 and credit > 0 then debit - credit else 0 end)::bigint bothsides from party_ledger_entries where not is_deleted group by 1),
    led as (select coalesce(led0.party_id, p.id) party_id, coalesce(led0.led, 0) + coalesce(p.opening_balance, 0) led, coalesce(led0.undated, 0) undated, coalesce(led0.bothsides, 0) bothsides
      from led0 full join (select id, opening_balance from parties where not is_deleted and opening_balance <> 0) p on p.id = led0.party_id),
    bk as (select l.party_id, sum(l.debit - l.credit)::bigint bk from journal_lines l join journal_entries j on j.id = l.journal_entry_id join accounts a on a.id = l.account_id
           where a.code in ('1150','2200','3100') and l.party_id is not null and not l.is_deleted and not j.is_deleted group by 1),
    hfk as (select hfk_party_id p from partnership_accounts where not is_deleted)
  select coalesce(led.party_id, bk.party_id) party_id, (select name from parties where id = coalesce(led.party_id, bk.party_id)) party,
    coalesce(led.led, 0) ledger, coalesce(bk.bk, 0) books, coalesce(led.led, 0) - coalesce(bk.bk, 0) diff, coalesce(led.undated, 0) undated, coalesce(led.bothsides, 0) bothsides,
    coalesce(led.party_id, bk.party_id) in (select p from hfk) hfk
  from led full join bk on bk.party_id = led.party_id`);
const pd = partyRec.filter((r) => n(r.diff) !== 0 && !r.hfk);
const pdExplained = pd.filter((r) => n(r.diff) === n(r.undated) + n(r.bothsides));
say(`${partyRec.length} parties; ${pd.length} differ between Party Ledgers and the books (HFK's own partnership side excluded by design).`);
if (!pd.length) rec("Party balances", "PASS", "Every party's balance in the books equals its Party Ledger.");
else {
  rec("Party balances", pdExplained.length === pd.length ? "WARN" : "FAIL",
    `${pd.length} parties' book balance differs from their Party Ledger; for ${pdExplained.length} of them the difference is exactly their rows with NO date (or both sides on one row), which the books cannot place in time.`,
    `gross ${pkr(pd.reduce((s, r) => s + Math.abs(n(r.diff)), 0))}: opening and party balances in the Balance Sheet are off by this until those rows get dates`);
  table(pd.sort((a, b) => Math.abs(n(b.diff)) - Math.abs(n(a.diff))).slice(0, 25).map((r) => ({ ...r, ledger: pkr(r.ledger), books: pkr(r.books), diff: pkr(r.diff), undated: pkr(r.undated) })), ["party_id", "party", "ledger", "books", "diff", "undated"]);
  rec("Books Check coverage", "FAIL", "Books Check flags truck-khata rows with no date, but has no check for PARTY-ledger rows with no date, so the cause of the difference above is not shown there.", "the user is not told about these rows");
}
const tUndated = await one(`select count(*)::int c, count(*) filter (where exists (select 1 from truck_ledger_entries x where x.ledger_id = e.ledger_id and not x.is_deleted and x.entry_date >= $1::timestamp))::int active,
    coalesce(sum(received + paid) filter (where exists (select 1 from truck_ledger_entries x where x.ledger_id = e.ledger_id and not x.is_deleted and x.entry_date >= $1::timestamp)),0)::bigint active_amt
  from truck_ledger_entries e where not e.is_deleted and e.entry_date is null and (e.received > 0 or e.paid > 0) and not (e.sr_no is null and e.source_row is not null and e.sheet_balance is null)`, [START]);
say(`Truck-khata rows with no date: ${tUndated.c}; ${tUndated.active} of them (${pkr(tUndated.active_amt)}) are in khatas that also have rows from ${START} on (these may belong in the books); the rest are only in old khatas from before the books start.`);

say(``);
say(`### 2f. Truck khata vs the books, truck by truck`);
const truckRec = await q(`with e as (
    select e.id, e.ledger_id, case when e.received > 0 then e.received else -e.paid end amt
    from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
    where not e.is_deleted and not l.is_deleted and e.entry_date >= $1::timestamp and (e.received > 0 or e.paid > 0) and not (e.received > 0 and e.paid > 0)
      and not (e.sr_no is null and e.source_row is not null and e.sheet_balance is null) and coalesce(e.category, '') <> 'SafiBachat'
      and not (coalesce(e.description, '') ~* 'قرضدار|qarz\\s*d[ae]r|qarzder|بچت|bach?at|bacht')),
  k as (select ledger_id, count(*)::int rows, sum(amt)::bigint khata from e group by 1),
  g as (select l.truck_ledger_id ledger_id, count(distinct j.id)::int entries, sum(l.debit - l.credit)::bigint books from journal_lines l join journal_entries j on j.id = l.journal_entry_id join accounts a on a.id = l.account_id
        where (j.source_key like 'tle:%' or j.source_key like 'tlo:%') and a.code = '1060' and not l.is_deleted group by 1)
  select coalesce(k.ledger_id, g.ledger_id) ledger_id, (select registration from truck_ledgers where id = coalesce(k.ledger_id, g.ledger_id)) truck, coalesce(k.rows, 0) rows, coalesce(g.entries, 0) entries, coalesce(k.khata, 0) khata, coalesce(g.books, 0) books
  from k full join g on g.ledger_id = k.ledger_id`, [START]);
const tBad = truckRec.filter((r) => n(r.khata) !== n(r.books) || n(r.rows) !== n(r.entries));
tBad.length ? (rec("Truck khata = books", "FAIL", `${tBad.length} of ${truckRec.length} truck khata(s) differ from their books postings.`, pkr(tBad.reduce((s, r) => s + n(r.khata) - n(r.books), 0))), table(tBad.slice(0, 25), ["ledger_id", "truck", "rows", "entries", "khata", "books"])) : rec("Truck khata = books", "PASS", `All ${truckRec.length} truck khatas: every postable row is in the books exactly once, and in = out amounts match (${truckRec.reduce((s, r) => s + n(r.rows), 0).toLocaleString()} rows).`);

say(``);
say(`### 2g. Truck-wise P&L, Balance Sheet, Cash Flow`);
const fys = [];
for (let y = Number(START.slice(0, 4)); ; y++) { const from = `${y}-07-01`; if (from > new Date().toISOString().slice(0, 10)) break; fys.push({ from, to: `${y + 1}-06-30` }); }
for (const f of fys) {
  const tot = await one(`select coalesce(sum(case when a.type = 'Income' then l.credit - l.debit else -(l.debit - l.credit) end),0)::bigint p from journal_lines l join journal_entries j on j.id = l.journal_entry_id join accounts a on a.id = l.account_id
    where not l.is_deleted and not j.is_deleted and a.type in ('Income','Expense') and j.entry_date >= $1::timestamp and j.entry_date < ($2::date + 1)::timestamp`, [f.from, f.to]);
  const byTruck = await one(`with x as (select coalesce((select upper(regexp_replace(v.vehicle_number, '[^A-Za-z0-9]', '', 'g')) from vehicles v where v.id = l.vehicle_id), (select upper(regexp_replace(t.registration, '[^A-Za-z0-9]', '', 'g')) from truck_ledgers t where t.id = l.truck_ledger_id), (select upper(regexp_replace(v.vehicle_number, '[^A-Za-z0-9]', '', 'g')) from invoices i join vehicles v on v.id = i.vehicle_id where j.entry_number like 'JE-INV-%' and i.id = j.source_id), '') truck,
        case when a.type = 'Income' then l.credit - l.debit else -(l.debit - l.credit) end amt
      from journal_lines l join journal_entries j on j.id = l.journal_entry_id join accounts a on a.id = l.account_id
      where not l.is_deleted and not j.is_deleted and a.type in ('Income','Expense') and j.entry_date >= $1::timestamp and j.entry_date < ($2::date + 1)::timestamp)
    select coalesce(sum(amt),0)::bigint p, coalesce(sum(amt) filter (where truck = ''),0)::bigint office, count(distinct truck) filter (where truck <> '')::int trucks from x`, [f.from, f.to]);
  n(tot.p) === n(byTruck.p) ? rec(`P&L ${f.from.slice(0, 4)}-${f.to.slice(2, 4)}`, "PASS", `Profit ${pkr(tot.p)}; the per-truck statement adds up to the same (${byTruck.trucks} trucks + office/not-per-truck ${pkr(byTruck.office)}).`) : rec(`P&L ${f.from.slice(0, 4)}-${f.to.slice(2, 4)}`, "FAIL", `Per-truck total ${pkr(byTruck.p)} ≠ P&L ${pkr(tot.p)}.`, pkr(n(tot.p) - n(byTruck.p)));
  const bs = await one(`select coalesce(sum(l.debit - l.credit),0)::bigint d from journal_lines l join journal_entries j on j.id = l.journal_entry_id where not l.is_deleted and not j.is_deleted and j.entry_date < ($1::date + 1)::timestamp`, [f.to]);
  n(bs.d) === 0 ? rec(`Balance Sheet ${f.to}`, "PASS", `Assets = liabilities + equity + profit on ${f.to} (all lines up to that day net to zero).`) : rec(`Balance Sheet ${f.to}`, "FAIL", `Does not balance on ${f.to}.`, pkr(bs.d));
  const cf = await q(`with e as (select j.id, sum(case when (a.code = '1001' or a.code = '1002' or a.code like '12__') then l.debit - l.credit else 0 end) cash from journal_lines l join journal_entries j on j.id = l.journal_entry_id join accounts a on a.id = l.account_id
      where not l.is_deleted and not j.is_deleted and j.entry_date >= $1::timestamp and j.entry_date < ($2::date + 1)::timestamp group by j.id having sum(case when (a.code = '1001' or a.code = '1002' or a.code like '12__') then l.debit - l.credit else 0 end) <> 0),
    o as (select e.id, e.cash, abs(l.credit - l.debit) w, sum(abs(l.credit - l.debit)) over (partition by e.id) tot from e join journal_lines l on l.journal_entry_id = e.id and not l.is_deleted join accounts a on a.id = l.account_id where not (a.code = '1001' or a.code = '1002' or a.code like '12__'))
    select coalesce(sum(cash),0)::bigint moved, (select coalesce(round(sum(case when tot = 0 then 0 else cash * w / tot end)),0)::bigint from o) explained, (select count(*)::int from e where not exists (select 1 from o where o.id = e.id)) cash_only from e`, [f.from, f.to]);
  const c0 = cf[0] || {};
  Math.abs(n(c0.moved) - n(c0.explained)) <= 2 && !n(c0.cash_only) ? rec(`Cash Flow ${f.from.slice(0, 4)}-${f.to.slice(2, 4)}`, "PASS", `Cash & bank moved ${pkr(c0.moved)}, all of it explained by its other side.`) : rec(`Cash Flow ${f.from.slice(0, 4)}-${f.to.slice(2, 4)}`, "WARN", `Cash & bank moved ${pkr(c0.moved)}; explained ${pkr(c0.explained)}; entries that only move between cash and bank: ${n(c0.cash_only)}.`, pkr(n(c0.moved) - n(c0.explained)));
}

// ------------------------------------------------------------------------------------------------
say(``);
say(`## 3. Completed trips: income and expenses exactly once`);
const trips = await one(`select count(*) filter (where status = 'Completed')::int done, count(*) filter (where status = 'Completed' and revenue > 0)::int done_freight,
  count(*) filter (where status = 'Completed' and revenue > 0 and departure_time < $1::timestamp)::int before_books from trips where not is_deleted`, [START]);
say(`Completed trip stops: ${trips.done} (${trips.done_freight} with freight; ${trips.before_books} of them before ${START}, outside the books).`);
const noInv = await q(`select t.id, t.trip_number, v.vehicle_number, t.departure_time::date d, t.revenue from trips t left join vehicles v on v.id = t.vehicle_id where not t.is_deleted and t.status = 'Completed' and t.revenue > 0 and t.departure_time >= $1::timestamp and not exists (select 1 from invoices i where i.trip_id = t.id and not i.is_deleted)`, [START]);
noInv.length ? (rec("Trip income billed", "FAIL", `${noInv.length} completed stop(s) with freight have no invoice — their freight is NOT in the books' income.`, pkr(noInv.reduce((s, r) => s + n(r.revenue), 0))), table(noInv.slice(0, 20), ["id", "trip_number", "vehicle_number", "d", "revenue"])) : rec("Trip income billed", "PASS", "Every completed stop with freight (since the books start) has an invoice.");
const invNoJe = await q(`select i.id, i.invoice_number, i.total_amount from invoices i where not i.is_deleted and not exists (select 1 from journal_entries j where j.entry_number = 'JE-INV-' || lpad(i.id::text, 4, '0') and not j.is_deleted)`);
invNoJe.length ? rec("Invoices in the books", "FAIL", `${invNoJe.length} invoice(s) have no journal entry.`, pkr(invNoJe.reduce((s, r) => s + n(r.total_amount), 0))) : rec("Invoices in the books", "PASS", "Every invoice has exactly one billing entry (JE-INV).");
const invTwice = await q(`select source_id, count(*)::int c from journal_entries where entry_number like 'JE-INV-%' and not is_deleted group by 1 having count(*) > 1`);
invTwice.length ? rec("Invoice billed twice", "FAIL", `${invTwice.length} invoice(s) billed more than once.`) : rec("Invoice billed twice", "PASS", "No invoice is billed twice.");
const dblRev = await q(`select e.id, e.received, e.derived_trip_id from truck_ledger_entries e join journal_entries j on j.source_key = 'tle:' || e.id join journal_lines l on l.journal_entry_id = j.id join accounts a on a.id = l.account_id
  where not e.is_deleted and e.received > 0 and e.derived_trip_id is not null and a.code = '4000' and exists (select 1 from invoices i where i.trip_id = e.derived_trip_id and not i.is_deleted)`);
dblRev.length ? rec("Kiraya counted twice", "FAIL", `${dblRev.length} kiraya receipt(s) tied to an invoiced trip were booked as income again.`, pkr(dblRev.reduce((s, r) => s + n(r.received), 0))) : rec("Kiraya counted twice", "PASS", "Kiraya received for an invoiced trip clears the customer; it is not counted as income a second time.");
const tripExp = await one(`with r as (select e.id, e.paid, (select sum(l.debit) from journal_entries j join journal_lines l on l.journal_entry_id = j.id join accounts a on a.id = l.account_id where j.source_key = 'tle:' || e.id and a.code <> '1060') posted
    from truck_ledger_entries e join truck_ledgers tl on tl.id = e.ledger_id where not e.is_deleted and not tl.is_deleted and e.derived_trip_id is not null and e.paid > 0 and e.received = 0 and e.entry_date >= $1::timestamp)
  select count(*)::int c, coalesce(sum(paid),0)::bigint amt, count(*) filter (where posted is null)::int missing, count(*) filter (where posted is not null and posted <> paid)::int wrong from r`, [START]);
tripExp.missing || tripExp.wrong ? rec("Trip expenses", "FAIL", `${tripExp.missing} trip expense row(s) not in the books, ${tripExp.wrong} with a different amount.`) : rec("Trip expenses", "PASS", `All ${tripExp.c} trip expense rows (${pkr(tripExp.amt)}) are in the books once, at the right amount.`);
const orphanTrip = await one(`select count(*)::int c, coalesce(sum(e.paid + e.received),0)::bigint amt from truck_ledger_entries e join trips t on t.id = e.derived_trip_id where not e.is_deleted and t.is_deleted`);
orphanTrip.c ? rec("Rows of deleted trips", "FAIL", `${orphanTrip.c} khata row(s) still belong to deleted trips and are still counted.`, pkr(orphanTrip.amt)) : rec("Rows of deleted trips", "PASS", "No khata row is left behind by a deleted trip.");

// ------------------------------------------------------------------------------------------------
say(``);
say(`## 4. Money Given on trips`);
const mgAcc = await q(`select e.category, a.code, count(*)::int c, sum(e.paid)::bigint amt from truck_ledger_entries e join journal_entries j on j.source_key = 'tle:' || e.id join journal_lines l on l.journal_entry_id = j.id join accounts a on a.id = l.account_id
  where not e.is_deleted and e.derived_trip_id is not null and e.paid > 0 and a.code <> '1060' group by 1, 2 order by 1`);
table(mgAcc.map((r) => ({ ...r, amt: pkr(r.amt) })), ["category", "code", "c", "amt"]);
const rulesOk = await q(`select e.category, a.code from truck_ledger_entries e join journal_entries j on j.source_key = 'tle:' || e.id join journal_lines l on l.journal_entry_id = j.id join accounts a on a.id = l.account_id
  left join posting_rules r1 on r1.source = 'truck' and r1.category = coalesce(nullif(e.category,''),'Other') and r1.side = 'out' left join posting_rules r2 on r2.source = 'truck' and r2.category = coalesce(nullif(e.category,''),'Other') and r2.side = 'any'
  where not e.is_deleted and e.derived_trip_id is not null and e.paid > 0 and a.code <> '1060' and a.code <> coalesce(r1.account_code, r2.account_code, '5098') group by 1, 2`);
rulesOk.length ? rec("Money Given accounts", "FAIL", `Some trip money went to a different account than its category's rule: ${rulesOk.map((r) => `${r.category}→${r.code}`).join(", ")}.`) : rec("Money Given accounts", "PASS", "Every trip Money Given row is booked to its category's account (Diesel → Fuel, Toll → Toll, Repair → Maintenance, Khurak/Labour/Trip cash → Trip expenses…), against the truck's account 1060.");
const dupMG = await q(`select a.id trip_row, b.id cash_row, l.registration truck, a.entry_date::date d, a.paid amount, a.description, b.description cash_desc
  from truck_ledger_entries a join truck_ledgers l on l.id = a.ledger_id
  join truck_ledger_entries b on b.paid = a.paid and b.id <> a.id and not b.is_deleted and abs(extract(epoch from (b.entry_date - a.entry_date))) <= 86400 * 1.5
  join truck_ledgers lb on lb.id = b.ledger_id and (lb.vehicle_id = l.vehicle_id or upper(regexp_replace(lb.registration,'[^A-Za-z0-9]','','g')) = upper(regexp_replace(l.registration,'[^A-Za-z0-9]','','g')))
  where not a.is_deleted and a.derived_trip_id is not null and a.paid > 0 and b.derived_trip_id is null
    and exists (select 1 from cash_transactions t where t.link_type = 'truck' and t.derived_entry_id = b.id and not t.is_deleted)
  limit 30`);
dupMG.length ? (rec("Money Given also in Cash Book", "WARN", `${dupMG.length} trip Money Given row(s) have a same-amount, same-truck, ±1-day Cash Book entry linked to the truck — the same money may be recorded twice as an expense.`, pkr(dupMG.reduce((s, r) => s + n(r.amount), 0)) + " possible double expense"), table(dupMG, ["trip_row", "cash_row", "truck", "d", "amount", "description", "cash_desc"])) : rec("Money Given also in Cash Book", "PASS", "No trip Money Given row has a matching Cash Book entry for the same truck, amount and day (no sign of double entry).");

// ------------------------------------------------------------------------------------------------
say(``);
say(`## 5. Bank reconciliation`);
const bsl = await one(`select count(*)::int total, count(*) filter (where matched_key is not null)::int matched, count(*) filter (where kind is not null)::int explained,
  count(*) filter (where matched_key is null and kind is null)::int unexplained, count(*) filter (where txn_date < $1::timestamp)::int before_books from bank_statement_lines where not is_deleted`, [START]);
if (!bsl.total) rec("Bank statements", "INFO", "No bank statement has been uploaded on this database — reconciliation cannot be tested here.");
else {
  say(`Statement lines: ${bsl.total} — matched ${bsl.matched}, explained ${bsl.explained}, still to explain ${bsl.unexplained}; ${bsl.before_books} before the books start (not posted).`);
  const dangling = await q(`select s.id, s.matched_key from bank_statement_lines s where not s.is_deleted and s.matched_key is not null and not (
      (s.matched_key like 'ple:%' and exists (select 1 from party_ledger_entries e where e.id = split_part(s.matched_key,':',2)::int and not e.is_deleted))
      or (s.matched_key like 'pship:%' and exists (select 1 from party_ledger_entries e where e.id = split_part(s.matched_key,':',2)::int and not e.is_deleted))
      or (s.matched_key like 'tle:%' and exists (select 1 from truck_ledger_entries e where e.id = split_part(s.matched_key,':',2)::int and not e.is_deleted))
      or (s.matched_key like 'ct:%' and exists (select 1 from cash_transactions e where e.id = split_part(s.matched_key,':',2)::int and not e.is_deleted))
      or (s.matched_key like 'pe:%' and exists (select 1 from personal_expenses e where e.id = split_part(s.matched_key,':',2)::int and not e.is_deleted))
      or (s.matched_key like 'zk:%' and exists (select 1 from zakat_payments e where e.id = split_part(s.matched_key,':',2)::int and not e.is_deleted))
      or (s.matched_key like 'tax:%' and exists (select 1 from tax_entries e where e.id = split_part(s.matched_key,':',2)::int and not e.is_deleted))
      or (s.matched_key like 'pay:%' and exists (select 1 from payments e where e.id = split_part(s.matched_key,':',2)::int and not e.is_deleted)))`);
  dangling.length ? rec("Bank matches", "FAIL", `${dangling.length} statement line(s) are matched to a ledger entry that was later deleted.`) : rec("Bank matches", "PASS", "Every matched statement line points at a ledger entry that still exists.");
  const twice = await q(`select matched_key, count(*)::int c from bank_statement_lines where not is_deleted and matched_key is not null group by 1 having count(*) > 1`);
  twice.length ? rec("One entry, two bank lines", "FAIL", `${twice.length} ledger entr(ies) are matched to more than one statement line.`) : rec("One entry, two bank lines", "PASS", "No ledger entry is matched to two statement lines.");
  const dupLines = await q(`select bank_account_id, txn_date::date d, withdrawal, deposit, left(coalesce(description,''),40) description, count(*)::int c from bank_statement_lines where not is_deleted group by 1,2,3,4,5 having count(*) > 1 limit 20`);
  dupLines.length ? (rec("Duplicate statement lines", "WARN", `${dupLines.length} group(s) of identical statement lines (same bank, day, amount, description) — can be genuine repeats or the same line imported from two different files.`), table(dupLines, ["bank_account_id", "d", "withdrawal", "deposit", "description", "c"])) : rec("Duplicate statement lines", "PASS", "No identical statement lines.");
  const bankBal = await q(`select b.bank_name, (select s.balance from bank_statement_lines s where s.bank_account_id = b.id and not s.is_deleted order by s.txn_date desc, s.id desc limit 1) stmt,
      b.opening_balance + coalesce((select sum(deposit - withdrawal) from bank_statement_lines s where s.bank_account_id = b.id and not s.is_deleted and s.txn_date >= $1::timestamp), 0) books from bank_accounts b where not b.is_deleted`, [START]);
  const bb = bankBal.filter((r) => r.stmt != null && n(r.stmt) !== n(r.books));
  bb.length ? (rec("Statement balance = books", "FAIL", `${bb.length} bank(s): the statement's last balance ≠ opening + statement lines.`), table(bb, ["bank_name", "stmt", "books"])) : rec("Statement balance = books", "PASS", "Each bank's statement balance equals its books balance (where the statement shows a balance).");
}

// ------------------------------------------------------------------------------------------------
say(``);
say(`## 6–7. Books Check coverage and the July 2025 start`);
say(`Books Check itself runs on the server (open it in the app). Gaps found by this audit are listed under 2e-2. The July 2025 start and the 30 June 2025 opening balances are checked under 2c.`);
say(``);
say(`## 8. Undo / edit / delete / audit history`);
const invChk = await q(`select i.id, i.invoice_number, i.paid_amount, coalesce((select sum(amount) from invoice_payments p where p.invoice_id = i.id),0)::bigint recorded, i.outstanding_balance, i.total_amount, i.status from invoices i
  where not i.is_deleted and (i.paid_amount <> coalesce((select sum(amount) from invoice_payments p where p.invoice_id = i.id),0) or i.outstanding_balance <> greatest(0, i.total_amount - i.paid_amount)) limit 20`);
invChk.length ? (rec("Invoices after undo", "FAIL", `${invChk.length} invoice(s): paid / balance do not match their payment list.`), table(invChk, ["id", "invoice_number", "paid_amount", "recorded", "outstanding_balance", "total_amount", "status"])) : rec("Invoices after undo", "PASS", "Every invoice's paid amount equals its payments, and balance = total − paid.");
const payOrphan = await one(`select count(*)::int c from payments p where not p.is_deleted and not exists (select 1 from invoice_payments ip where ip.payment_id = p.id)`);
payOrphan.c ? rec("Payments without an invoice", "WARN", `${payOrphan.c} payment(s) are not linked to any invoice.`) : rec("Payments without an invoice", "PASS", "Every payment belongs to an invoice.");
const billChk = await q(`select b.id, b.bill_number, b.paid_amount, coalesce((select sum(l.debit) from journal_entries j join journal_lines l on l.journal_entry_id = j.id where j.entry_number like 'JE-BILLPAY-%' and j.source_id = b.id and not j.is_deleted),0)::bigint posted from bills b
  where not b.is_deleted and b.paid_amount <> coalesce((select sum(l.debit) from journal_entries j join journal_lines l on l.journal_entry_id = j.id where j.entry_number like 'JE-BILLPAY-%' and j.source_id = b.id and not j.is_deleted),0) limit 20`);
billChk.length ? rec("Bills after undo", "FAIL", `${billChk.length} bill(s): paid amount ≠ their payment entries.`) : rec("Bills after undo", "PASS", "Every bill's paid amount equals its payment entries.");
const auditCov = await q(`select table_name, action, count(*)::int c from audit_logs where created_at > now() - interval '120 days' and table_name in ('truck_ledger_entries','party_ledger_entries','cash_transactions','invoices','payments','bills','journal_entries','partner_settlements','tax_entries','bank_statement_lines','cash_closings','books','books_settings','check_dismissals')
  group by 1, 2 order by 1, 2`).catch(() => []);
say(`Audit history (last 120 days) for money tables:`);
table(auditCov, ["table_name", "action", "c"]);
auditCov.length ? rec("Audit history", "PASS", `Changes to money records are written to the audit log (${auditCov.reduce((s, r) => s + n(r.c), 0)} entries in 120 days), with old and new values.`) : rec("Audit history", "WARN", "No audit entries found for money tables in the last 120 days.");
const softDel = await one(`select (select count(*) from truck_ledger_entries where is_deleted)::int tle, (select count(*) from party_ledger_entries where is_deleted)::int ple, (select count(*) from cash_transactions where is_deleted)::int ct, (select count(*) from invoices where is_deleted)::int inv`);
say(`Soft-deleted (kept, hidden, not counted): truck rows ${softDel.tle}, party rows ${softDel.ple}, cash entries ${softDel.ct}, invoices ${softDel.inv}.`);

// ------------------------------------------------------------------------------------------------
say(``);
say(`## Review accounts (money the system could not place for sure)`);
const review = await q(`select a.code, a.name, sum(l.debit - l.credit)::bigint bal, count(*)::int lines from journal_lines l join journal_entries j on j.id = l.journal_entry_id join accounts a on a.id = l.account_id
  where not l.is_deleted and not j.is_deleted and a.code in ('1009','1070','1095','1096','1097','1098','1099','1500','3900','4098','5098') group by 1, 2 having sum(l.debit - l.credit) <> 0 order by 1`);
table(review.map((r) => ({ ...r, bal: pkr(r.bal) })), ["code", "name", "lines", "bal"]);

// ------------------------------------------------------------------------------------------------
// "Other" truck-khata rows: PROPOSED category only
const RULES = [
  ["Diesel", "high", /\b(diesel|disel|deisel|dsl|hsd)\b|ڈیزل|ڈیز ل|تیل/i],
  ["Toll", "high", /\b(toll|tol|m-?\d+ toll|motorway)\b|ٹول/i],
  ["Tyre", "high", /\b(tyre|tyres|tire|tires|puncture)\b|ٹائر|پنکچر/i],
  ["Battery", "high", /\b(battery|batteries)\b|بیٹری/i],
  ["MobilOil", "high", /\b(mobil|mobile oil|engine oil|oil change|filter)\b|موبل|موبائل آئل/i],
  ["Salary", "high", /\b(salary|tankhwah|tankhwa|tankha|wages)\b|تنخواہ|تنخواہ/i],
  ["Permit", "medium", /\b(permit|route permit|token tax|fitness)\b|پرمٹ|ٹوکن/i],
  ["Carnet", "high", /\bcarnet\b/i],
  ["Visa", "high", /\b(visa|passport)\b|ویزا/i],
  ["Insurance", "high", /\b(insurance|insurence)\b|بیمہ|انشورنس/i],
  ["Garage", "medium", /\b(garage|workshop|repair|mistri|mechanic|welding|denting|paint)\b|مستری|مرمت|ورکشاپ|ویلڈنگ/i],
  ["PartsBill", "medium", /\b(parts|spare|purza|kaman|bearing|clutch|brake|pump)\b|پرزے|پرزہ/i],
  ["Khurak", "medium", /\b(khurak|khana|food|hotel|roti|chai)\b|خوراک|کھانا|ہوٹل/i],
  ["Labour", "medium", /\b(mazdoori|mazdori|labour|labor|loading|unloading|palledari)\b|مزدوری|لوڈنگ/i],
  ["TomanFX", "medium", /\b(toman|tuman|riyal|exchange|currency)\b|تومان|ریال/i],
  ["TripCash", "low", /\b(kharcha|kharch|driver cash|advance|pocket)\b|خرچہ|خرچ|ایڈوانس/i],
  ["OnlineTransfer", "low", /\b(online|onlian|onlin|ibft|transfer|easypaisa|jazzcash|jazz cash|bank|meezan|hbl|mcb|ubl|soneri|alfalah|askari|faysal|islami|allied|abl)\b|آن لائن|ٹرانسفر|بینک/i],
  ["Freight", "medium", /\b(kiraya|kirya|kiraa|karaya|kiraiya|freight|bilty)\b|کرایہ|کرایا|بلٹی/i],
];
const others = await q(`select e.id, l.registration truck, to_char(e.entry_date,'YYYY-MM-DD') date, e.raw_date, e.description, e.received, e.paid
  from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
  where not e.is_deleted and not l.is_deleted and coalesce(nullif(e.category,''),'Other') = 'Other' and (e.received > 0 or e.paid > 0) order by e.entry_date nulls last, e.id`);
const csv = [["transaction_id", "truck", "date", "description", "money_in", "money_out", "amount", "proposed_category", "confidence", "matched_on", "in_books_from"].join(",")];
const summary = new Map();
const esc = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
for (const r of others) {
  const d = String(r.description || "");
  const hits = RULES.filter(([cat, , re]) => re.test(d)).filter(([cat]) => (n(r.received) > 0 ? ["Freight", "TomanFX", "OnlineTransfer"].includes(cat) : cat !== "Freight"));
  let cat = "", conf = "none", on = "";
  if (hits.length === 1) [cat, conf] = hits[0], on = (d.match(hits[0][2]) || [""])[0];
  else if (hits.length > 1) { cat = hits[0][0]; conf = "low"; on = hits.map((h) => h[0]).join("/"); }
  const k = cat || "(no proposal)";
  const s = summary.get(k) || { rows: 0, amount: 0 };
  s.rows++; s.amount += n(r.received) || n(r.paid); summary.set(k, s);
  csv.push([r.id, esc(r.truck), r.date || esc(r.raw_date || ""), esc(d), n(r.received), n(r.paid), n(r.received) || n(r.paid), cat, conf, esc(on), r.date && r.date >= START ? "yes" : "no (before books start or no date)"].join(","));
}
writeFileSync(join(OUT, "other-classification.csv"), "﻿" + csv.join("\r\n"));
say(``);
say(`## "Other" truck-khata rows — proposed categories (NOT applied)`);
say(`${others.length.toLocaleString()} rows with money are in category "Other". Proposals by keyword in the description (English / Roman Urdu / Urdu); confidence: high = one clear keyword, medium = a weaker keyword, low = several categories matched or a vague word, none = no keyword. Full list: \`other-classification.csv\`.`);
table([...summary.entries()].sort((a, b) => b[1].amount - a[1].amount).map(([k, v]) => ({ proposed: k, rows: v.rows.toLocaleString(), amount: pkr(v.amount) })), ["proposed", "rows", "amount"]);

// ------------------------------------------------------------------------------------------------
say(``);
say(`## Summary`);
const by = (s) => results.filter((r) => r.status === s);
say(`PASS ${by("PASS").length} · FAIL ${by("FAIL").length} · WARN ${by("WARN").length} · INFO ${by("INFO").length}`);
for (const s of ["FAIL", "WARN"]) for (const r of by(s)) say(`- ${s}: ${r.area} — ${r.finding}`);

await db.query("ROLLBACK");
await db.end();
writeFileSync(join(OUT, "accounting-audit.md"), md.join("\n"));
writeFileSync(join(OUT, "accounting-audit.json"), JSON.stringify({ host, at: new Date().toISOString(), results }, null, 2));
writeFileSync(join(OUT, "inventory.json"), JSON.stringify({ host, database: who.d, at: new Date().toISOString(), tables: inventory }, null, 2));
console.log(`Audit of ${host}: PASS ${by("PASS").length}, FAIL ${by("FAIL").length}, WARN ${by("WARN").length}, INFO ${by("INFO").length}`);
console.log(`Wrote ${join(OUT, "accounting-audit.md")}, ${join(OUT, "inventory.json")}, ${join(OUT, "other-classification.csv")}`);
