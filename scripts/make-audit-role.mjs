#!/usr/bin/env node
/**
 * Sets up a READ-ONLY login for auditing the live database — without the password ever being shown
 * on screen, typed in chat, or saved in git.
 *
 * Run it yourself in a terminal, in the project folder:
 *   node scripts/make-audit-role.mjs                (asks for the host and database name)
 *   node scripts/make-audit-role.mjs <host> [dbname]
 *
 * It asks for the live database's HOST and DATABASE NAME (not secret — they are in Render →
 * Environment → DATABASE_URL, after the "@"), then:
 *   1. makes a long random password,
 *   2. writes .env.audit (git ignores .env*) with the read-only connection string,
 *   3. copies to the clipboard the SQL that creates the read-only role — paste it into
 *      Neon → SQL Editor (production branch, same database) and press Run.
 *
 * The role can only read: SELECT on the tables, every session read-only by default, no write grants.
 * To remove it later, run in the Neon SQL Editor:
 *   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hfk_audit_ro; REVOKE ALL ON SCHEMA public FROM hfk_audit_ro;
 *   REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM hfk_audit_ro; REVOKE ALL ON SCHEMA drizzle FROM hfk_audit_ro;
 *   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM hfk_audit_ro;
 *   DROP ROLE hfk_audit_ro;
 * and delete .env.audit.
 */
import { randomBytes } from "crypto";
import { existsSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { createInterface } from "readline/promises";

const ROLE = "hfk_audit_ro";
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log("Read-only audit login for the live database.\n");
console.log("From Render -> your service -> Environment -> DATABASE_URL, copy only the part AFTER the '@'");
console.log("and BEFORE the '/' (looks like ep-xxxx-xxxx-123456-pooler.ap-southeast-1.aws.neon.tech).\n");
let host = (process.argv[2] || (await rl.question("Host: "))).trim().replace(/^.*@/, "").replace(/[/?].*$/, "").replace(/:\d+$/, "");
const dbName = ((process.argv[2] ? process.argv[3] || "" : await rl.question("Database name (the part after the '/', before '?') [neondb]: ")).trim() || "neondb").replace(/[?].*$/, "");
if (!/^[a-z0-9.-]+$/i.test(host)) {
  console.error("That does not look like a host name. Nothing was written.");
  process.exit(1);
}
if (existsSync(".env.audit")) {
  const ok = (await rl.question(".env.audit already exists. Replace it? (y/N): ")).trim().toLowerCase();
  if (ok !== "y") {
    rl.close();
    process.exit(0);
  }
}
rl.close();
host = host.replace("-pooler.", "."); // the direct endpoint: the role's read-only default applies to every session

const password = randomBytes(24).toString("base64url"); // ~190 bits; letters, digits, - and _
const sql = `-- HFK ERP: read-only audit role. Run in Neon -> SQL Editor on the PRODUCTION branch, database ${dbName}.
CREATE ROLE ${ROLE} WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
ALTER ROLE ${ROLE} SET default_transaction_read_only = on;
ALTER ROLE ${ROLE} SET statement_timeout = '120s';
GRANT CONNECT ON DATABASE ${dbName} TO ${ROLE};
GRANT USAGE ON SCHEMA public TO ${ROLE};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLE};
GRANT USAGE ON SCHEMA drizzle TO ${ROLE};
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO ${ROLE};
SELECT current_database() AS database, '${ROLE} ready' AS status;
`;
writeFileSync(".env.audit", `# read-only audit login for the live database — never commit or share this file\nDATABASE_URL=postgresql://${ROLE}:${password}@${host}/${dbName}?sslmode=require\n`);

let copied = false;
try {
  execSync("clip", { input: sql }); // Windows clipboard
  copied = true;
} catch {}
if (!copied) {
  writeFileSync(".env.audit-role.sql", sql);
  console.log("\nCould not use the clipboard. The SQL is in .env.audit-role.sql — open it, copy all, then DELETE that file.");
} else {
  console.log("\nThe SQL is now on your clipboard (the password is inside it — it is not shown here).");
}
console.log("Next: Neon -> SQL Editor (production project, branch main, database " + dbName + ") -> paste -> Run.");
console.log("Then copy something else (any word) so the password leaves the clipboard.");
console.log("Saved the read-only connection in .env.audit (git ignores it).");
