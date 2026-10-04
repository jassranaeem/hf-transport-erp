/**
 * READ-ONLY: runs every Books Check (server/books_check.ts) against the database in DATABASE_URL and
 * writes what it finds — exactly the list the Books Check screen would show, but without opening the
 * app and without rebuilding the books first (so nothing is written).
 *
 *   node --env-file=.env.audit --import tsx scripts/audit-books-check.ts audit-live
 *
 * On a non-local database it refuses a login that can write, and leaves names / free text out
 * (check, item key, date and amount only). Writes <out>/books-check.md and books-check.json.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL first (the database to check).");
  process.exit(1);
}
const OUT = process.argv[2] || "audit-out";
mkdirSync(OUT, { recursive: true });
const host = (() => { try { return new URL(url).host; } catch { return "?"; } })();
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
const REDACT = !LOCAL || process.env.AUDIT_REDACT === "1";

const { pool } = await import("../src/db/index.ts");
const w = (await pool.query(`select current_user u, (select count(*)::int from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r' and has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')) c`)).rows[0];
if (!LOCAL && w.c > 0 && process.env.AUDIT_ALLOW_WRITER !== "1") {
  console.error(`Refusing to run on ${host}: the login "${w.u}" can write to ${w.c} table(s). Use the read-only role made by scripts/make-audit-role.mjs.`);
  await pool.end();
  process.exit(2);
}

const { CHECKS } = await import("../server/books_check.ts");
const results: any[] = [];
for (const c of CHECKS) {
  try {
    const r = await c.run();
    results.push({ code: c.code, level: c.level, area: c.area, title: c.title, total: r.total,
      amount: r.items.reduce((s, i) => s + Math.abs(Number(i.amount || 0)), 0),
      items: r.items.map((i) => (REDACT ? { key: i.key, date: i.date, amount: i.amount } : { key: i.key, date: i.date, amount: i.amount, title: i.title, detail: i.detail })) });
  } catch (e: any) {
    results.push({ code: c.code, level: c.level, area: c.area, title: c.title, total: null, error: e.message, items: [] });
  }
}
await pool.end();

const pkr = (v: number) => Math.round(v).toLocaleString("en-US");
const md = [`# Books Check — read-only run`, ``, `- Database: \`${host}\` · run at ${new Date().toISOString()} · names ${REDACT ? "left out" : "shown"}`, ``,
  `| level | check | area | items | amount (items listed, max 300 each) |`, `| --- | --- | --- | --- | --- |`];
const order = { red: 0, amber: 1, info: 2 } as Record<string, number>;
for (const r of results.sort((a, b) => order[a.level] - order[b.level] || (b.total || 0) - (a.total || 0)))
  md.push(`| ${r.level} | ${r.code} — ${r.title} | ${r.area} | ${r.error ? "ERROR: " + r.error : r.total} | ${r.total ? pkr(r.amount) : ""} |`);
const sum = (l: string) => results.filter((r) => r.level === l).reduce((s, r) => s + (r.total || 0), 0);
md.push(``, `Red ${sum("red")} · amber ${sum("amber")} · info ${sum("info")} · checks that errored ${results.filter((r) => r.error).length}`);
writeFileSync(join(OUT, "books-check.md"), md.join("\n"));
writeFileSync(join(OUT, "books-check.json"), JSON.stringify({ host, at: new Date().toISOString(), results }, null, 2));
console.log(`Books Check on ${host}: red ${sum("red")}, amber ${sum("amber")}, info ${sum("info")}, errors ${results.filter((r) => r.error).length}. Wrote ${join(OUT, "books-check.md")}`);
