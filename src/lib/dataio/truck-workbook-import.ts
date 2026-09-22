/**
 * Persists a parsed truck workbook into the ERP. Shared by:
 *   - the CLI:  scripts/import-truck-workbook.ts
 *   - the API:  POST /api/ledgers/import-workbook  (self-service upload)
 *
 * NON-DESTRUCTIVE & FAULT-TOLERANT:
 *   - works per sheet — a sheet not present in the upload is left untouched;
 *   - within a sheet, entries are matched on (ledgerId, sourceRow) and
 *     UPDATE-or-INSERTed, so entry ids (and any attachments on them) survive a
 *     re-import; import-origin rows that vanished from the sheet are soft-deleted;
 *     manually-added entries (sourceRow = null) are always kept;
 *   - each sheet is wrapped in try/catch — one bad sheet is recorded in
 *     `failedSheets` and the rest still import. The whole import never aborts.
 */
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { createBalancedJournalEntry } from "../../../server/finance_engine.ts";
import type { ParsedLedger, WorkbookReport } from "./truck-workbook.ts";

const PLATE = /^[A-Z]{2,4} ?\d{2,4}$/;

// Same account codes finance.ts's own "new expense" route uses — kept in
// sync manually since this is the bulk-import path into the very same
// expenses/maintenance tables, and must post the very same GL entries a
// hand-entered expense would (see EXPENSE_TYPE_BY_CATEGORY below for how a
// khata category maps to one of these).
const EXPENSE_GL_CODE: Record<string, string> = {
  Fuel: "5001", Salary: "5002", Maintenance: "5003", Insurance: "5004",
  Toll: "5005", Repairs: "5003", Depreciation: "5006", Miscellaneous: "5099",
};

/**
 * Post (or, on re-import, cleanly repost) a balanced journal entry for one
 * auto-filed expense/maintenance row. Swallows its own errors — a missing
 * Chart of Accounts or any other GL hiccup must never fail the underlying
 * khata import; `scripts/backfill-gl-postings.ts` exists precisely to catch
 * up any entries that couldn't post here.
 */
async function postJournalEntry(
  entryNumber: string,
  description: string,
  sourceType: "Expense" | "Payment",
  sourceId: number,
  debitAccountId: number,
  creditAccountId: number,
  amount: number,
  ctx: { userId?: number }
) {
  try {
    const [existingJE] = await db
      .select({ id: schema.journalEntries.id })
      .from(schema.journalEntries)
      .where(eq(schema.journalEntries.entryNumber, entryNumber))
      .limit(1);
    if (existingJE) {
      // re-import of the same source row (amount may have changed) — replace, don't duplicate
      await db.delete(schema.journalLines).where(eq(schema.journalLines.journalEntryId, existingJE.id));
      await db.delete(schema.journalEntries).where(eq(schema.journalEntries.id, existingJE.id));
    }
    await createBalancedJournalEntry(
      entryNumber,
      description,
      sourceType,
      sourceId,
      [
        { accountId: debitAccountId, debit: amount, credit: 0 },
        { accountId: creditAccountId, debit: 0, credit: amount },
      ],
      ctx
    );
  } catch (err: any) {
    console.error(`[truck-workbook-import] GL posting failed for ${entryNumber}:`, err?.message || err);
  }
}

export interface ImportResult {
  vehiclesCreated: number;
  vehiclesLinked: number;
  partnersCreated: number;
  partnershipAgreements: number;
  ledgers: number;
  ledgersInserted: number;
  ledgersUpdated: number;
  entriesInserted: number;
  entriesUpdated: number;
  entriesRemoved: number;
  expensesCreated: number;
  expensesUpdated: number;
  maintenanceCreated: number;
  maintenanceUpdated: number;
  failedSheets: Array<{ sheet: string; error: string }>;
  reconciliation: { matched: number; total: number };
  report: WorkbookReport;
}

// ---------------------------------------------------------------------------
// Push each real cash-out entry into the module its category already names —
// "Diesel" belongs in the Expenses ledger, "Tyre"/"Battery"/"Garage"/
// "PartsBill"/"MobilOil" belong in Vehicle Maintenance — instead of leaving it
// stranded only inside the truck khata. "Freight" (money in) has no matching
// module table (a bare khata row names no client/contractor to build a real
// Invoice from) so it posts straight to the GL instead — see the `received`
// branch in syncEntryToModules(). Capital (owner injections) and SafiBachat
// (a savings marker, not a transaction) are deliberately never posted anywhere.
// ---------------------------------------------------------------------------
const EXPENSE_TYPE_BY_CATEGORY: Record<string, string> = {
  Diesel: "Fuel",
  Salary: "Salary",
  TripCash: "Miscellaneous",
  OnlineTransfer: "Miscellaneous",
  Carnet: "Toll",
  Visa: "Miscellaneous",
  TomanFX: "Miscellaneous",
  Permit: "Miscellaneous",
  Insurance: "Insurance",
  Other: "Miscellaneous",
};
const MAINTENANCE_CATEGORIES = new Set(["Tyre", "Battery", "PartsBill", "Garage", "MobilOil"]);

interface SyncCounters {
  expensesCreated: number;
  expensesUpdated: number;
  maintenanceCreated: number;
  maintenanceUpdated: number;
}

/** One entry -> at most one linked Expense OR Maintenance row, upserted by sourceEntryId so a re-import never duplicates it. Also posts GL revenue for Freight money-in rows (no separate module table for that side — see below). */
async function syncEntryToModules(
  entryId: number,
  vehicleId: number | null,
  registration: string,
  e: ParsedLedger["entries"][number],
  ctx: { userId?: number },
  counters: SyncCounters,
  glByCode: Map<string, { id: number; name: string }>
) {
  if (!vehicleId) return; // can't file anything against no vehicle
  if (e.isSafiBachat || e.isReset) return; // savings marker / reset row, not a transaction
  if (!e.entryDate) return; // no reliable date to file it under - don't fabricate one

  const cash = glByCode.get("1001");
  const bank = glByCode.get("1002");

  // ---- money IN: a real freight collection has nowhere else to land — there's
  // no "khata entry -> Invoice" mapping (no client/contractor is identified in a
  // bare khata row), so unlike the expense/maintenance side this posts straight
  // to the GL (Debit Cash, Credit Freight Revenue) instead of also creating a
  // module record. Without this, every Income Statement kept showing PKR 0
  // revenue no matter how much real freight income the khata held. ------------
  if (e.received > 0 && e.category === "Freight") {
    const revenueGL = glByCode.get("4000");
    if (revenueGL && cash) {
      await postJournalEntry(
        `JE-REV-${entryId}`,
        `Freight revenue (${registration})${e.rawDate ? ` · ${e.rawDate}` : ""}: ${e.description || ""}`,
        "Payment",
        entryId,
        cash.id,
        revenueGL.id,
        e.received,
        ctx
      );
    }
  }

  if (!e.paid || e.paid <= 0) return; // rest of this function only handles cash-out entries
  if (e.category === "Capital") return; // owner injection, not an expense

  const noteHead = `Imported from truck khata (${registration})${e.rawDate ? ` · ${e.rawDate}` : ""}: `;
  const notes = (noteHead + (e.description || "")).slice(0, 500);

  if (MAINTENANCE_CATEGORIES.has(e.category)) {
    const [existing] = await db
      .select({ id: schema.vehicleMaintenance.id })
      .from(schema.vehicleMaintenance)
      .where(eq(schema.vehicleMaintenance.sourceEntryId, entryId))
      .limit(1);
    const values = {
      vehicleId,
      vehicleRegistration: registration,
      maintenanceType: "Corrective",
      status: "Completed",
      scheduledDate: e.entryDate,
      completionDate: e.entryDate,
      actualCost: e.paid,
      remarks: notes,
      sourceEntryId: entryId,
      updatedAt: new Date(),
      updatedBy: ctx.userId,
    };
    let maintId: number;
    if (existing) {
      await db.update(schema.vehicleMaintenance).set(values).where(eq(schema.vehicleMaintenance.id, existing.id));
      maintId = existing.id;
      counters.maintenanceUpdated++;
    } else {
      const [created] = await db
        .insert(schema.vehicleMaintenance)
        .values({ ...values, maintenanceNumber: `MNT-IMP-${entryId}`, createdBy: ctx.userId })
        .returning({ id: schema.vehicleMaintenance.id });
      maintId = created.id;
      counters.maintenanceCreated++;
    }
    const maintGL = glByCode.get("5003"); // Maintenance Expense
    if (maintGL && bank) {
      await postJournalEntry(`JE-MNT-${maintId}`, `Maintenance expense (${registration}): ${e.description || e.category}`, "Expense", maintId, maintGL.id, bank.id, e.paid, ctx);
    }
    return;
  }

  const expenseType = EXPENSE_TYPE_BY_CATEGORY[e.category];
  if (!expenseType) return; // Freight or anything else not mapped to an expense type

  const [existing] = await db
    .select({ id: schema.expenses.id })
    .from(schema.expenses)
    .where(eq(schema.expenses.sourceEntryId, entryId))
    .limit(1);
  const values = {
    vehicleId,
    expenseType,
    amount: e.paid,
    expenseDate: e.entryDate,
    paymentMethod: "Cash",
    status: "Approved", // this already happened - it isn't waiting on anyone's approval
    notes,
    sourceEntryId: entryId,
    updatedAt: new Date(),
    updatedBy: ctx.userId,
  };
  let expId: number;
  if (existing) {
    await db.update(schema.expenses).set(values).where(eq(schema.expenses.id, existing.id));
    expId = existing.id;
    counters.expensesUpdated++;
  } else {
    const [created] = await db
      .insert(schema.expenses)
      .values({ ...values, expenseNumber: `EXP-IMP-${entryId}`, createdBy: ctx.userId })
      .returning({ id: schema.expenses.id });
    expId = created.id;
    counters.expensesCreated++;
  }
  const expGL = glByCode.get(EXPENSE_GL_CODE[expenseType] || "5099");
  if (expGL && cash) {
    await postJournalEntry(`JE-EXP-${expId}`, `Operational expense: ${expenseType} (${notes})`, "Expense", expId, expGL.id, cash.id, e.paid, ctx);
  }
}

/** A truck-khata entry disappeared on re-import - retire whatever it had synced into as well. */
async function retireSyncedRecords(entryId: number, userId: number | undefined) {
  await db
    .update(schema.expenses)
    .set({ isDeleted: true, deletedAt: new Date(), deletedBy: userId })
    .where(eq(schema.expenses.sourceEntryId, entryId));
  await db
    .update(schema.vehicleMaintenance)
    .set({ isDeleted: true, deletedAt: new Date(), deletedBy: userId })
    .where(eq(schema.vehicleMaintenance.sourceEntryId, entryId));
}

function entryValues(e: ParsedLedger["entries"][number], ledgerId: number, userId?: number) {
  return {
    ledgerId,
    srNo: e.srNo,
    entryDate: e.entryDate,
    rawDate: e.rawDate || null,
    method: e.method,
    partyFrom: e.partyFrom,
    partyTo: e.partyTo,
    description: e.description || null,
    received: e.received,
    paid: e.paid,
    runningBalance: e.runningBalance,
    sheetBalance: e.sheetBalance,
    category: e.category,
    direction: e.direction,
    sectionLabel: e.sectionLabel,
    isSafiBachat: e.isSafiBachat,
    isReset: e.isReset,
    routeFrom: e.routeFrom,
    routeTo: e.routeTo,
    cargo: e.cargo,
    sourceRow: e.sourceRow,
    needsReview: e.needsReview,
    reviewReason: e.reviewReason,
    createdBy: userId,
  };
}

export async function importParsedWorkbook(
  ledgers: ParsedLedger[],
  report: WorkbookReport,
  ctx: { userId?: number } = {}
): Promise<ImportResult> {
  let vehiclesCreated = 0;
  let vehiclesLinked = 0;
  let partnersCreated = 0;
  let partnershipAgreements = 0;
  let ledgersInserted = 0;
  let ledgersUpdated = 0;
  let entriesInserted = 0;
  let entriesUpdated = 0;
  let entriesRemoved = 0;
  const counters: SyncCounters = { expensesCreated: 0, expensesUpdated: 0, maintenanceCreated: 0, maintenanceUpdated: 0 };
  const failedSheets: Array<{ sheet: string; error: string }> = [];
  // loaded once per import call (not once per entry — an import can touch
  // thousands of entries) so every auto-filed expense/maintenance row can
  // post its own balanced GL journal entry immediately, instead of relying
  // on a separate backfill step. If the Chart of Accounts is missing (e.g.
  // right after a factory reset — see scripts/seed-chart-of-accounts.ts),
  // this map is simply empty and GL posting is skipped for this run; the
  // khata/expense/maintenance data itself still imports normally.
  const glRows = await db.select().from(schema.accounts).where(eq(schema.accounts.isDeleted, false));
  const glByCode = new Map(glRows.map((a) => [a.code, { id: a.id, name: a.name }]));

  for (const L of ledgers) {
    try {
      const vnum = L.registration;
      const isPlate = PLATE.test(vnum);

      // ---- vehicle (match by number, create if new & plate-shaped) --------
      let vehicle: { id: number } | undefined;
      if (isPlate) {
        [vehicle] = await db
          .select({ id: schema.vehicles.id })
          .from(schema.vehicles)
          .where(eq(schema.vehicles.vehicleNumber, vnum))
          .limit(1);
        if (!vehicle) {
          [vehicle] = await db
            .insert(schema.vehicles)
            .values({
              vehicleNumber: vnum,
              registrationNumber: vnum,
              engineNumber: "TBD",
              chassisNumber: "TBD",
              vehicleType: "Containerized",
              truckBrand: "TBD",
              model: "TBD",
              year: 2015,
              containerType: "40ft",
              payloadCapacity: 25000,
              currentOdometer: 0,
              ownershipStatus: L.isPartnership ? "Third-Party" : "Owned",
              currentStatus: "Available",
              createdBy: ctx.userId,
            })
            .returning({ id: schema.vehicles.id });
          vehiclesCreated++;
        } else {
          vehiclesLinked++;
        }
      }
      const vehicleId = vehicle?.id ?? null;

      // ---- ledger header (match by sourceSheet, else registration+title —
      // but ONLY against a ledger that has no sourceSheet of its own, i.e. one
      // created by hand in the UI, never one that came from a *different*
      // imported sheet). Two different sheets for the same truck often share
      // the exact same in-sheet title text (many sheets just repeat the bare
      // registration, e.g. "TLB 100", in every title cell — the distinguishing
      // suffix like "Driver"/"Nill"/"Kilala" usually lives only in the
      // workbook TAB name, not the in-sheet title). Matching on registration+
      // title alone would silently merge those two sheets into one ledger,
      // with the second sheet's import overwriting/soft-deleting the first
      // sheet's entries — real data loss that looked like "description /
      // driver info stopped importing" for that truck. sourceSheet (the tab
      // name) is always unique per sheet, so it's the only safe primary key. --
      let [existingLedger] = await db
        .select()
        .from(schema.truckLedgers)
        .where(eq(schema.truckLedgers.sourceSheet, L.sourceSheet))
        .limit(1);
      if (!existingLedger) {
        [existingLedger] = await db
          .select()
          .from(schema.truckLedgers)
          .where(and(
            eq(schema.truckLedgers.registration, vnum),
            eq(schema.truckLedgers.title, L.title),
            isNull(schema.truckLedgers.sourceSheet),
          ))
          .limit(1);
      }

      // ---- partnership block -> partner + agreement (dedup per vehicle) ---
      let partnerAgreementId: number | null = existingLedger?.partnerAgreementId ?? null;
      if (L.isPartnership && L.partnership && vehicleId != null) {
        partnershipAgreements++;
        const partnerName = L.ownerName || `${vnum} partner`;
        let [partner] = await db
          .select({ id: schema.partners.id })
          .from(schema.partners)
          .where(eq(schema.partners.name, partnerName))
          .limit(1);
        if (!partner) {
          [partner] = await db
            .insert(schema.partners)
            .values({ name: partnerName, notes: `Imported from sheet "${L.sourceSheet}"`, createdBy: ctx.userId })
            .returning({ id: schema.partners.id });
          partnersCreated++;
        }
        const price = L.partnership.agreedPrice ?? L.partnership.outstanding ?? 0;
        const advance = L.partnership.advancePaid ?? 0;
        const opening = L.partnership.outstanding ?? Math.max(0, price - advance);
        // reuse the agreement already linked to this ledger, or the newest for this vehicle
        let [agr] = partnerAgreementId
          ? await db.select().from(schema.partnerAgreements).where(eq(schema.partnerAgreements.id, partnerAgreementId)).limit(1)
          : await db
              .select()
              .from(schema.partnerAgreements)
              .where(and(eq(schema.partnerAgreements.vehicleId, vehicleId), eq(schema.partnerAgreements.partnerId, partner.id)))
              .limit(1);
        if (agr) {
          await db
            .update(schema.partnerAgreements)
            .set({ agreedPrice: price, advancePaid: advance, openingBalance: opening, updatedAt: new Date() })
            .where(eq(schema.partnerAgreements.id, agr.id));
          partnerAgreementId = agr.id;
        } else {
          const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.partnerAgreements);
          const [created] = await db
            .insert(schema.partnerAgreements)
            .values({
              agreementNumber: `PA-IMP-${String(c + 1).padStart(4, "0")}`,
              partnerId: partner.id,
              vehicleId,
              agreedPrice: price,
              advancePaid: advance,
              openingBalance: opening,
              currentBalance: opening,
              companySharePercent: 100,
              status: opening <= 0 ? "Settled" : "Active",
              notes: `Imported from "${L.sourceSheet}": ${L.partnership.rawLines.join(" | ").slice(0, 400)}`,
              createdBy: ctx.userId,
            })
            .returning({ id: schema.partnerAgreements.id });
          partnerAgreementId = created.id;
        }
      }

      let ledgerId: number;
      if (existingLedger) {
        await db
          .update(schema.truckLedgers)
          .set({
            vehicleId,
            registration: vnum,
            title: L.title,
            ownerName: L.ownerName,
            isPartnership: L.isPartnership,
            partnerAgreementId,
            openingBalance: L.openingBalance,
            closingBalance: L.closingBalance,
            sourceSheet: L.sourceSheet,
            isDeleted: false,
            deletedAt: null,
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(eq(schema.truckLedgers.id, existingLedger.id));
        ledgerId = existingLedger.id;
        ledgersUpdated++;
      } else {
        const [created] = await db
          .insert(schema.truckLedgers)
          .values({
            vehicleId,
            registration: vnum,
            title: L.title,
            ownerName: L.ownerName,
            isPartnership: L.isPartnership,
            partnerAgreementId,
            openingBalance: L.openingBalance,
            closingBalance: L.closingBalance,
            sourceSheet: L.sourceSheet,
            createdBy: ctx.userId,
          })
          .returning({ id: schema.truckLedgers.id });
        ledgerId = created.id;
        ledgersInserted++;
      }

      // ---- entries: match on (ledgerId, sourceRow) -----------------------
      const existing = await db
        .select({ id: schema.truckLedgerEntries.id, sourceRow: schema.truckLedgerEntries.sourceRow })
        .from(schema.truckLedgerEntries)
        .where(and(eq(schema.truckLedgerEntries.ledgerId, ledgerId), isNotNull(schema.truckLedgerEntries.sourceRow)));
      const byRow = new Map<number, number>(); // sourceRow -> entry id
      for (const r of existing) if (r.sourceRow != null) byRow.set(r.sourceRow, r.id);
      const seenRows = new Set<number>();

      for (const e of L.entries) {
        let entryId: number;
        if (e.sourceRow != null && byRow.has(e.sourceRow)) {
          entryId = byRow.get(e.sourceRow)!;
          seenRows.add(e.sourceRow);
          await db
            .update(schema.truckLedgerEntries)
            .set({ ...entryValues(e, ledgerId, undefined), updatedAt: new Date(), updatedBy: ctx.userId, isDeleted: false, deletedAt: null })
            .where(eq(schema.truckLedgerEntries.id, entryId));
          entriesUpdated++;
        } else {
          const [inserted] = await db
            .insert(schema.truckLedgerEntries)
            .values(entryValues(e, ledgerId, ctx.userId))
            .returning({ id: schema.truckLedgerEntries.id });
          entryId = inserted.id;
          entriesInserted++;
        }
        // Push a real cash-out entry into Expenses / Vehicle Maintenance too —
        // "the module name already exists, it should land there" — never
        // fabricates a date/amount; simply skips what it can't safely place.
        await syncEntryToModules(entryId, vehicleId, vnum, e, ctx, counters, glByCode);
      }

      // import-origin rows that are no longer in the sheet -> soft-delete
      // (and retire whatever they'd synced into an Expense/Maintenance row)
      const toRemove = [...byRow.entries()].filter(([row]) => !seenRows.has(row)).map(([, id]) => id);
      for (const id of toRemove) {
        await db
          .update(schema.truckLedgerEntries)
          .set({ isDeleted: true, deletedAt: new Date(), deletedBy: ctx.userId })
          .where(eq(schema.truckLedgerEntries.id, id));
        await retireSyncedRecords(id, ctx.userId);
        entriesRemoved++;
      }
    } catch (err: any) {
      failedSheets.push({ sheet: L.sourceSheet, error: String(err?.message || err).slice(0, 300) });
    }
  }

  const matched = report.ledgers.filter((l) => l.closingMatches).length;
  return {
    vehiclesCreated,
    vehiclesLinked,
    partnersCreated,
    partnershipAgreements,
    ledgers: ledgersInserted + ledgersUpdated,
    ledgersInserted,
    ledgersUpdated,
    entriesInserted,
    entriesUpdated,
    entriesRemoved,
    expensesCreated: counters.expensesCreated,
    expensesUpdated: counters.expensesUpdated,
    maintenanceCreated: counters.maintenanceCreated,
    maintenanceUpdated: counters.maintenanceUpdated,
    failedSheets,
    reconciliation: { matched, total: report.ledgers.length },
    report,
  };
}
