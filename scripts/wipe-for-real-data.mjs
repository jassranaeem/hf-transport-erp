/**
 * Clears the seeded DEMO data so the customer's real Excel workbook can be
 * imported into a clean system — while KEEPING:
 *   - the fraud-detection demo (siphoning driver + partnership skimming) so
 *     `/api/fuel/integrity-audit` and `/api/partnerships/*` still demonstrate,
 *   - all finance infrastructure (chart of accounts, bank accounts, journal
 *     entries/lines), users, roles, branches, settings.
 *
 * WIPES: demo employees / HR org, maintenance, tyres, job cards, bills,
 * expenses, cash closings, the 2 auto-generated demo invoices (+ their GL
 * entries), and any previously-imported truck ledgers / attachments.
 *
 * Usage:  node scripts/wipe-for-real-data.mjs
 */
import { execFileSync } from "node:child_process";

const PSQL = process.env.PSQL_BIN || "C:/Users/HP/hfpg/bin/psql.exe";
const args = ["-h", "127.0.0.1", "-p", "5432", "-U", "postgres", "-d", "hf_transport_erp", "-v", "ON_ERROR_STOP=1"];
const env = { ...process.env, PGPASSWORD: process.env.PGPASSWORD || "hf_secure_pass_2026" };
const run = (sql) => execFileSync(PSQL, [...args, "-c", sql], { encoding: "utf8", env });

console.log("Wiping demo data (keeping the fraud-detection scenario + finance infra)...\n");

// 1. HR / people demo
run(`TRUNCATE TABLE
  employees, attendance, leaves, payrolls,
  departments, designations, teams, shifts,
  driver_performances, staff_performances,
  recruitment_jobs, recruitment_applicants,
  trainings, employee_trainings, employee_documents
  RESTART IDENTITY CASCADE;`);
console.log("  cleared HR / org demo tables");

// 2. Maintenance demo
run(`TRUNCATE TABLE
  vehicle_maintenance, workshops, mechanics, service_schedules,
  tyre_management, battery_management, job_cards, spare_parts_usage,
  maintenance_reminders, breakdown_management, predictive_maintenance
  RESTART IDENTITY CASCADE;`);
console.log("  cleared maintenance demo tables");

// 3. AP / misc finance demo (NOT accounts / banks / journals)
run(`TRUNCATE TABLE bills, expenses, cash_closings RESTART IDENTITY CASCADE;`);
console.log("  cleared bills / expenses / cash closings");

// 4. The 2 demo auto-invoices + their GL postings (keep fuel-txn journals)
run(`DELETE FROM journal_lines WHERE journal_entry_id IN
      (SELECT id FROM journal_entries WHERE source_type IN ('Invoice','Bill','Expense'));`);
run(`DELETE FROM journal_entries WHERE source_type IN ('Invoice','Bill','Expense');`);
run(`TRUNCATE TABLE invoice_payments, invoice_lines, invoices, payments RESTART IDENTITY CASCADE;`);
console.log("  cleared demo invoices / payments + their journal entries");

// 5. Any earlier import artifacts
run(`TRUNCATE TABLE truck_ledger_entries, truck_ledgers, attachments RESTART IDENTITY CASCADE;`);
console.log("  cleared truck ledgers / attachments");

// 6. Seed the company profile (single row) from the sample invoice letterhead
run(`INSERT INTO company_profile
  (id, legal_name, trade_name, tagline, address_lines, city, country, phones, email, website,
   invoice_prefix, default_sales_tax_percent, default_wht_percent, default_payment_terms)
  VALUES
  (1,
   'Haji Fateh Khan Enterprises Pvt Ltd',
   'Haji Fateh Khan Enterprises',
   'Transportation & Logistics Services',
   E'Head Office: Office Suite 713, 7th Floor, Falak Corporate City Tower, near Memon Masjid, M.A. Jinnah Road, Karachi, Pakistan\\nBranch: Jamal U Din Afghani Road, Furqan Center, Room No 1, First Floor, Quetta, Pakistan',
   'Karachi', 'Pakistan',
   '["03138375172","03138485377","03003856462"]'::jsonb,
   NULL,
   'https://hfkenterprisespvtltd.com/',
   'INV', '13', '0', 'Net 30')
  ON CONFLICT (id) DO NOTHING;`);
console.log("  seeded company_profile (Haji Fateh Khan Enterprises)");

const counts = run(`SELECT
  (SELECT count(*) FROM vehicles) vehicles,
  (SELECT count(*) FROM drivers) drivers,
  (SELECT count(*) FROM trips) trips,
  (SELECT count(*) FROM fuel_transactions WHERE is_deleted=false) fuel_txns,
  (SELECT count(*) FROM partner_agreements) partner_agreements,
  (SELECT count(*) FROM fuel_alerts) fuel_alerts,
  (SELECT count(*) FROM employees) employees,
  (SELECT count(*) FROM vehicle_maintenance) maintenance,
  (SELECT count(*) FROM invoices) invoices,
  (SELECT count(*) FROM accounts) accounts;`);
console.log("\nRemaining (fraud demo + infra should stand, demo clutter gone):");
console.log(counts);
