/**
 * One-time catch-up: posts a balanced GL journal entry for every existing
 * `expenses` / `vehicle_maintenance` row that doesn't have one yet.
 *
 * Why this was needed: every route that posts to the GL (finance.ts
 * expenses, maintenance.ts, fuel.ts, hr.ts payroll, finance_engine.ts
 * invoices/payments/bills) looks up its account codes in the `accounts`
 * table and SILENTLY skips posting if the code isn't found — no error
 * anywhere. A factory reset (server/system_reset.ts) TRUNCATEs `accounts`
 * along with everything else, so after a reset every one of those routes
 * quietly stopped posting to the GL — including the ~5,000 expense/
 * maintenance rows auto-filed by the truck-khata bulk import in this same
 * session. `scripts/seed-chart-of-accounts.ts` restores the accounts;
 * THIS script re-posts the journal entries that should have been created
 * the first time. `src/lib/dataio/truck-workbook-import.ts` now posts GL
 * entries live going forward, so this script should only ever be needed
 * once, right after `seed-chart-of-accounts.ts`.
 *
 * Idempotent: entryNumber is `JE-EXP-{expenseId}` / `JE-MNT-{maintenanceId}`
 * — a row that already has one is skipped, so re-running this is harmless.
 *
 *   npx tsx scripts/backfill-gl-postings.ts
 */
import "../src/config/env.ts";
import { db, schema, pool } from "../src/db/index.ts";
import { eq, and, inArray } from "drizzle-orm";
import { createBalancedJournalEntry } from "../server/finance_engine.ts";

const EXPENSE_GL_CODE: Record<string, string> = {
  Fuel: "5001", Salary: "5002", Maintenance: "5003", Insurance: "5004",
  Toll: "5005", Repairs: "5003", Depreciation: "5006", Miscellaneous: "5099",
};

async function main() {
  const glRows = await db.select().from(schema.accounts).where(eq(schema.accounts.isDeleted, false));
  const glByCode = new Map(glRows.map((a) => [a.code, a]));
  const cash = glByCode.get("1001");
  const bank = glByCode.get("1002");
  if (!cash || !bank) {
    console.error("Chart of Accounts is missing 1001 (Cash) and/or 1002 (Bank) — run scripts/seed-chart-of-accounts.ts first.");
    process.exit(1);
  }

  // ---- which entryNumbers already exist? (one query, not one per row) ----
  const allJE = await db.select({ entryNumber: schema.journalEntries.entryNumber }).from(schema.journalEntries);
  const already = new Set(allJE.map((j) => j.entryNumber));

  // ---- Expenses ----------------------------------------------------------
  const expenses = await db.select().from(schema.expenses).where(eq(schema.expenses.isDeleted, false));
  let expPosted = 0, expSkippedExisting = 0, expSkippedInvalid = 0;
  for (const exp of expenses) {
    const entryNumber = `JE-EXP-${exp.id}`;
    if (already.has(entryNumber)) { expSkippedExisting++; continue; }
    if (!exp.amount || exp.amount <= 0) { expSkippedInvalid++; continue; }
    const debitGL = glByCode.get(EXPENSE_GL_CODE[exp.expenseType] || "5099") || glByCode.get("5099");
    const creditGL = exp.bankAccountId ? bank : cash;
    if (!debitGL) { expSkippedInvalid++; continue; }
    try {
      await createBalancedJournalEntry(
        entryNumber,
        `Operational expense: ${exp.expenseType} (${exp.notes || "no notes"})`,
        "Expense",
        exp.id,
        [
          { accountId: debitGL.id, debit: exp.amount, credit: 0, description: `Debit Operational Expense: ${exp.expenseType}` },
          { accountId: creditGL.id, debit: 0, credit: exp.amount, description: `Credit ${creditGL.name} for expense payment` },
        ]
      );
      expPosted++;
      if (expPosted % 250 === 0) console.log(`  ...${expPosted} expense journal entries posted so far`);
    } catch (err: any) {
      console.error(`  expense #${exp.id} FAILED: ${err.message}`);
      expSkippedInvalid++;
    }
  }
  console.log(`Expenses: posted ${expPosted}, already had a JE ${expSkippedExisting}, skipped (invalid) ${expSkippedInvalid}`);

  // ---- Vehicle Maintenance ------------------------------------------------
  const maint = await db.select().from(schema.vehicleMaintenance).where(eq(schema.vehicleMaintenance.isDeleted, false));
  const maintGL = glByCode.get("5003");
  let mntPosted = 0, mntSkippedExisting = 0, mntSkippedInvalid = 0;
  for (const m of maint) {
    const entryNumber = `JE-MNT-${m.id}`;
    if (already.has(entryNumber)) { mntSkippedExisting++; continue; }
    if (!m.actualCost || m.actualCost <= 0 || !maintGL) { mntSkippedInvalid++; continue; }
    try {
      await createBalancedJournalEntry(
        entryNumber,
        `Maintenance expense (${m.vehicleRegistration || "vehicle #" + m.vehicleId}): ${m.remarks || m.maintenanceType}`,
        "Expense",
        m.id,
        [
          { accountId: maintGL.id, debit: m.actualCost, credit: 0 },
          { accountId: bank.id, debit: 0, credit: m.actualCost },
        ]
      );
      mntPosted++;
    } catch (err: any) {
      console.error(`  maintenance #${m.id} FAILED: ${err.message}`);
      mntSkippedInvalid++;
    }
  }
  console.log(`Maintenance: posted ${mntPosted}, already had a JE ${mntSkippedExisting}, skipped (invalid) ${mntSkippedInvalid}`);

  // ---- Freight revenue (truck_ledger_entries, category=Freight, received>0) ----
  // No module table for this side (a bare khata row names no client/contractor
  // to build a real Invoice from) — it only ever posts a GL entry, so re-check
  // `already` after the expense/maintenance passes above may have added more.
  const allJE2 = await db.select({ entryNumber: schema.journalEntries.entryNumber }).from(schema.journalEntries);
  const already2 = new Set(allJE2.map((j) => j.entryNumber));
  const revenueGL = glByCode.get("4000");
  let revPosted = 0, revSkippedExisting = 0, revSkippedInvalid = 0;
  if (revenueGL) {
    const freightEntries = await db
      .select({
        id: schema.truckLedgerEntries.id,
        received: schema.truckLedgerEntries.received,
        description: schema.truckLedgerEntries.description,
        rawDate: schema.truckLedgerEntries.rawDate,
        ledgerId: schema.truckLedgerEntries.ledgerId,
      })
      .from(schema.truckLedgerEntries)
      .where(and(eq(schema.truckLedgerEntries.category, "Freight"), eq(schema.truckLedgerEntries.isDeleted, false)));
    // registration per ledgerId, for a readable description (one query, not one per row)
    const ledgerRows = await db.select({ id: schema.truckLedgers.id, registration: schema.truckLedgers.registration }).from(schema.truckLedgers);
    const regByLedger = new Map(ledgerRows.map((l) => [l.id, l.registration]));
    for (const fe of freightEntries) {
      const entryNumber = `JE-REV-${fe.id}`;
      if (already2.has(entryNumber)) { revSkippedExisting++; continue; }
      if (!fe.received || fe.received <= 0) { revSkippedInvalid++; continue; }
      try {
        await createBalancedJournalEntry(
          entryNumber,
          `Freight revenue (${regByLedger.get(fe.ledgerId) || "vehicle"})${fe.rawDate ? ` · ${fe.rawDate}` : ""}: ${fe.description || ""}`,
          "Payment",
          fe.id,
          [
            { accountId: cash.id, debit: fe.received, credit: 0 },
            { accountId: revenueGL.id, debit: 0, credit: fe.received },
          ]
        );
        revPosted++;
        if (revPosted % 500 === 0) console.log(`  ...${revPosted} revenue journal entries posted so far`);
      } catch (err: any) {
        console.error(`  freight entry #${fe.id} FAILED: ${err.message}`);
        revSkippedInvalid++;
      }
    }
  }
  console.log(`Freight revenue: posted ${revPosted}, already had a JE ${revSkippedExisting}, skipped (invalid) ${revSkippedInvalid}`);
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("FATAL:", e);
    await pool.end().catch(() => {});
    process.exit(1);
  });
