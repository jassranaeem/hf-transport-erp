#!/usr/bin/env node
/**
 * Local vs live: compares two inventory.json files written by scripts/audit-accounting.mjs
 * (row counts per table only — no records are read).
 *   node scripts/audit-compare.mjs audit-local/inventory.json audit-live/inventory.json [out.md]
 */
import { readFileSync, writeFileSync } from "fs";

const [a, b, out = "audit-live/local-vs-live.md"] = process.argv.slice(2);
if (!a || !b) {
  console.error("usage: node scripts/audit-compare.mjs <local inventory.json> <live inventory.json> [out.md]");
  process.exit(1);
}
const L = JSON.parse(readFileSync(a, "utf8"));
const P = JSON.parse(readFileSync(b, "utf8"));
const names = [...new Set([...Object.keys(L.tables), ...Object.keys(P.tables)])].sort();
const rows = names
  .map((t) => ({ t, l: L.tables[t]?.rows ?? null, p: P.tables[t]?.rows ?? null, li: L.tables[t]?.imported ?? null, pi: P.tables[t]?.imported ?? null }))
  .filter((r) => (r.l || 0) !== (r.p || 0) || r.l === null || r.p === null);
const md = [`# Local vs live — rows per table`, ``, `- Local: \`${L.host}\` (${L.at}) · Live: \`${P.host}\` (${P.at})`, ``,
  `| table | local rows | live rows | local imported | live imported | note |`, `| --- | --- | --- | --- | --- | --- |`];
for (const r of rows.sort((x, y) => Math.abs((y.l || 0) - (y.p || 0)) - Math.abs((x.l || 0) - (x.p || 0)))) {
  const note = r.l === null ? "only on live" : r.p === null ? "only on local (schema differs)" : !r.p ? "empty on live" : !r.l ? "empty on local" : "";
  md.push(`| ${r.t} | ${r.l ?? "—"} | ${r.p ?? "—"} | ${r.li ?? ""} | ${r.pi ?? ""} | ${note} |`);
}
md.push(``, `${names.length} tables; ${rows.length} differ; ${names.length - rows.length} have the same number of rows.`);
writeFileSync(out, md.join("\n"));
console.log(`${rows.length} of ${names.length} tables differ. Wrote ${out}`);
