/**
 * Seeds the standard Chart of Accounts (COA) — real accounting reference
 * data every transport company needs, NOT demo/fake data. Every GL-posting
 * route (finance.ts expenses, invoices/payments/bills in finance_engine.ts,
 * fuel.ts, hr.ts payroll, maintenance.ts) looks up these exact account
 * codes before it can post a balanced journal entry — if the code isn't
 * found, that route silently skips posting (no error surfaced anywhere).
 *
 * A factory reset (server/system_reset.ts) TRUNCATEs the `accounts` table
 * along with everything else it wipes (only users/company_profile/
 * system_settings/role_permissions/backups survive), so after a reset this
 * MUST be re-run before any expense/invoice/payroll/fuel/maintenance
 * transaction can post to the General Ledger — otherwise every GL-based
 * report (Income Statement, Balance Sheet, "Total Operational Costs (GL)")
 * stays stuck at PKR 0 even though the underlying modules have real data.
 *
 * Idempotent: skips any code that already exists, so it's safe to re-run.
 *
 *   npx tsx scripts/seed-chart-of-accounts.ts
 */
import "../src/config/env.ts";
import { db, schema, pool } from "../src/db/index.ts";

const COA: Array<[string, string, string, string]> = [
  ["1001", "Cash on Hand", "Asset", "Cash"],
  ["1002", "Bank General Ledger", "Asset", "Bank"],
  ["1100", "Accounts Receivable", "Asset", "Accounts Receivable"],
  ["1301", "Fuel Inventory Asset", "Asset", "Fuel"],
  ["2000", "Accounts Payable", "Liability", "Accounts Payable"],
  ["2100", "Sales Tax Payable", "Liability", "Miscellaneous"],
  ["4000", "Freight Revenue", "Income", "Revenue"],
  ["4001", "Other Operating Revenue", "Income", "Revenue"],
  ["5001", "Fuel Expense", "Expense", "Fuel"],
  ["5002", "Salary Expense", "Expense", "Salary"],
  ["5003", "Maintenance Expense", "Expense", "Maintenance"],
  ["5004", "Insurance Expense", "Expense", "Insurance"],
  ["5005", "Toll Expense", "Expense", "Toll"],
  ["5006", "Depreciation Expense", "Expense", "Depreciation"],
  ["5099", "Miscellaneous Expense", "Expense", "Miscellaneous"],
];

async function main() {
  const existing = await db.select({ code: schema.accounts.code }).from(schema.accounts);
  const have = new Set(existing.map((a) => a.code));

  let created = 0;
  for (const [code, name, type, category] of COA) {
    if (have.has(code)) {
      console.log(`  = ${code} ${name} (already exists)`);
      continue;
    }
    await db.insert(schema.accounts).values({ code, name, type, category, description: "Standard chart of accounts" });
    console.log(`  + ${code} ${name}`);
    created++;
  }
  console.log(`\nDone: ${created} account(s) created, ${COA.length - created} already existed.`);
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("FATAL:", e);
    await pool.end().catch(() => {});
    process.exit(1);
  });
