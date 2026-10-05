/**
 * Truck Ledgers — the digital "khata": one running cash ledger per truck,
 * imported from the customer's legacy Excel workbook and edited going forward.
 *
 * Mounted at /api/ledgers.
 */
import { Router, Response } from "express";
import multer from "multer";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { rowIssues } from "./books_check.ts";
import { and, eq, desc, asc, sql, inArray } from "drizzle-orm";
import { logAudit } from "../src/db/audit.ts";
import { parseTruckWorkbook, sourceLabelFromFilename } from "../src/lib/dataio/truck-workbook.ts";
import { parseFreightLogWorkbook } from "../src/lib/dataio/freight-log-workbook.ts";
import { parseCashbookWorkbook } from "../src/lib/dataio/cashbook-workbook.ts";
import { importParsedWorkbook, retireSyncedRecords } from "../src/lib/dataio/truck-workbook-import.ts";
import { khataCandidates, planMerge } from "../src/lib/dataio/khata-merge.ts";
import { notifyDriverOfLedgerEntry } from "./sms.ts";
import { parseAndValidate, commitBatch, listWorkbookSheets } from "../src/lib/dataio/engine.ts";
import { getEntity } from "../src/lib/dataio/registry.ts";
import { matchSheetToEntity } from "./dataio.ts";
import { tripSpansForTruck, spanOf } from "./trip_close.ts";
import type { ParseResult } from "../src/lib/dataio/truck-workbook.ts";

const router = Router();
router.use(requireAuth, requireApproved);

const READ = ["Super Admin", "Admin", "Operations Manager", "Fleet Manager", "Finance Manager", "Accountant", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Operations Manager", "Finance Manager"];

const workbookUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

const audit = (req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", id: number, oldV: unknown, newV: unknown) =>
  logAudit({
    action,
    tableName: "truck_ledger_entries",
    recordId: id,
    oldValues: oldV,
    newValues: newV,
    performedBy: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  }).catch(() => {});

// ---- dry-run preview (no writes) — lets Fleet Setup Import show what this
// file's truck-ledger sheets look like before anything is committed, so one
// upload there can offer "these look like modules, these look like ledgers"
// in a single screen instead of two separate import tools. ----------------
router.post("/import-workbook/preview", requireRole(WRITE), workbookUpload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload an .xlsx workbook in the 'file' field." });
    const { ledgers, report } = await parseTruckWorkbook(req.file.buffer, sourceLabelFromFilename(req.file.originalname));
    // for the "add into which khata?" choice: each truck's khatas, the one it would join by
    // default, and how many of the sheet's rows that khata already has
    const firstSheetOfPlate = new Map<string, string>();
    const trucks = [];
    for (const l of ledgers) {
      const plate = l.registration.toUpperCase().replace(/[^A-Z0-9]/g, "");
      // a khata the user deleted is not "imported before" — it must not come back
      const [own] = await db
        .select({ id: schema.truckLedgers.id, title: schema.truckLedgers.title })
        .from(schema.truckLedgers)
        .where(and(eq(schema.truckLedgers.sourceSheet, l.sourceSheet), eq(schema.truckLedgers.isDeleted, false)))
        .limit(1);
      const candidates = l.looksLikeVehicle ? await khataCandidates(l.registration) : [];
      const main = candidates.find((k) => !k.derived || k.partnership) ?? null;
      let plan: { already: number; add: number; unclear: number; unclearSample: string[] } | null = null;
      if (!own && main) {
        const p = await planMerge(main.id, l);
        plan = { already: p.already, add: p.add.length, unclear: p.unclear.length, unclearSample: p.unclear.slice(0, 3).map((e) => `${e.rawDate || ""} ${String(e.description || "").replace(/\s+/g, " ").slice(0, 60)}`) };
      }
      const joinsSheet = !own && !main ? firstSheetOfPlate.get(plate) ?? null : null;
      if (!firstSheetOfPlate.has(plate)) firstSheetOfPlate.set(plate, l.sourceSheet);
      trucks.push({
        sheet: l.sourceSheet,
        registration: l.registration,
        entries: l.entries.length,
        looksLikeVehicle: l.looksLikeVehicle,
        ownKhataId: own?.id ?? null, // this very sheet was imported before: it just updates
        ownKhataTitle: own?.title ?? null,
        candidates: candidates.map((k) => ({ id: k.id, title: k.title, entries: k.entries, partnership: k.partnership, derived: k.derived })),
        defaultTarget: own ? own.id : main ? main.id : "new",
        joinsSheet, // no khata yet, but an earlier sheet of this file starts one: joins it
        plan,
      });
    }
    res.json({
      ledgerCount: ledgers.length,
      trucks,
      totals: report.totals,
      skippedSheets: report.skippedSheets,
      skippedReasons: report.skippedReasons,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Could not read this workbook" });
  }
});

// ---- self-service Excel import --------------------------------------
// Upload the legacy "PERSONL TRUCK.xlsx" workbook straight from the app — the
// system parses every truck sheet, categorises the rows and rebuilds the
// ledgers. No developer / script needed.
router.post("/import-workbook", requireRole(WRITE), workbookUpload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload an .xlsx workbook in the 'file' field." });
    const name = (req.file.originalname || "").toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xlsm")) {
      return res.status(400).json({ error: "File must be an Excel .xlsx workbook." });
    }
    const { ledgers, report } = await parseTruckWorkbook(req.file.buffer, sourceLabelFromFilename(req.file.originalname));
    if (ledgers.length === 0) {
      return res.status(400).json({
        error: "No truck-ledger sheets recognised in this workbook.",
        skippedSheets: report.skippedSheets,
        skippedReasons: report.skippedReasons,
      });
    }
    // which khata each sheet goes into (from the preview's choice); by default a sheet joins the
    // khata its truck already has instead of making a new one per sheet / per table
    let targets: Record<string, number | "new" | "auto"> | undefined;
    try {
      targets = req.body?.targets ? JSON.parse(String(req.body.targets)) : undefined;
    } catch {
      targets = undefined;
    }
    const result = await importParsedWorkbook(ledgers, report, { userId: req.user?.id }, { targets, merge: true });
    for (const id of result.touchedLedgerIds) await recompute(id);
    await logAudit({
      action: "CREATE",
      tableName: "truck_ledgers",
      recordId: result.ledgers,
      newValues: {
        file: req.file.originalname,
        ledgers: result.ledgers,
        entries: result.entriesInserted,
        vehiclesCreated: result.vehiclesCreated,
        reconciliation: result.reconciliation,
      },
      performedBy: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    }).catch(() => {});
    const mergedMsg = result.merged.length
      ? ` Added into existing khatas: ${result.merged.map((m) => `${m.added} new rows (${m.already} already there${m.unclear ? `, ${m.unclear} unclear rows not added` : ""})`).join("; ")}.`
      : "";
    const msg =
      `Imported ${result.ledgersInserted + result.ledgersUpdated} truck ledgers ` +
      `(${result.ledgersInserted} new, ${result.ledgersUpdated} updated) — ` +
      `${result.entriesInserted} new entries, ${result.entriesUpdated} updated, ${result.entriesRemoved} removed. ` +
      `Also filed ${result.expensesCreated + result.expensesUpdated} expenses ` +
      `(${result.expensesCreated} new) and ${result.maintenanceCreated + result.maintenanceUpdated} maintenance records ` +
      `(${result.maintenanceCreated} new) in Finance/Workshop.` +
      (result.failedSheets.length ? ` ${result.failedSheets.length} sheet(s) failed (rest imported fine).` : "") +
      mergedMsg;
    res.json({
      message: msg,
      ...result,
      // keep the payload light — the full per-sheet list is on GET /:id
      report: {
        totals: report.totals,
        skippedSheets: report.skippedSheets,
        skippedReasons: report.skippedReasons,
        ledgers: report.ledgers,
        failedSheets: result.failedSheets,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Import failed" });
  }
});

// ---- second recognizer: per-trip log sheets (loading logs, freight/profit
// sheets — one row per trip, many vehicles per sheet, no running-balance
// column) — see freight-log-workbook.ts for the real files this covers.
// Reuses importParsedWorkbook, so a vehicle discovered here shares the exact
// same create/match/reconcile/expense-sync logic as a normal khata import.
router.post("/import-freight-log/preview", requireRole(WRITE), workbookUpload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload an .xlsx workbook in the 'file' field." });
    const { ledgers, report } = await parseFreightLogWorkbook(req.file.buffer, sourceLabelFromFilename(req.file.originalname));
    res.json({
      ledgerCount: ledgers.length,
      vehicles: ledgers.map((l) => ({ sheet: l.sourceSheet, registration: l.registration, entries: l.entries.length })),
      totals: report.totals,
      skippedSheets: report.skippedSheets,
      skippedReasons: report.skippedReasons,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Could not read this workbook" });
  }
});

router.post("/import-freight-log", requireRole(WRITE), workbookUpload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload an .xlsx workbook in the 'file' field." });
    const { ledgers, report } = await parseFreightLogWorkbook(req.file.buffer, sourceLabelFromFilename(req.file.originalname));
    if (ledgers.length === 0) {
      return res.status(400).json({
        error: "No trip-log sheets recognised in this workbook.",
        skippedSheets: report.skippedSheets,
        skippedReasons: report.skippedReasons,
      });
    }
    const result = await importParsedWorkbook(ledgers, report, { userId: req.user?.id });
    await logAudit({
      action: "CREATE",
      tableName: "truck_ledgers",
      recordId: result.ledgers,
      newValues: { file: req.file.originalname, source: "freight-log", ledgers: result.ledgers, entries: result.entriesInserted },
      performedBy: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    }).catch(() => {});
    const msg =
      `Imported ${result.ledgersInserted + result.ledgersUpdated} vehicle trip-logs ` +
      `(${result.ledgersInserted} new, ${result.ledgersUpdated} updated) — ` +
      `${result.entriesInserted} new entries, ${result.entriesUpdated} updated. ` +
      `Also filed ${result.expensesCreated + result.expensesUpdated} expenses in Finance.`;
    res.json({ message: msg, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Import failed" });
  }
});

// ---- third recognizer: the daily dual cash-book shape (e.g. "Daliy
// work.xlsx") — income and expense side by side in the same row, usually
// for two different vehicles. See cashbook-workbook.ts. Also reuses
// importParsedWorkbook.
router.post("/import-cashbook/preview", requireRole(WRITE), workbookUpload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload an .xlsx workbook in the 'file' field." });
    const { ledgers, report } = await parseCashbookWorkbook(req.file.buffer, sourceLabelFromFilename(req.file.originalname));
    res.json({
      ledgerCount: ledgers.length,
      vehicles: ledgers.map((l) => ({ sheet: l.sourceSheet, registration: l.registration, entries: l.entries.length })),
      totals: report.totals,
      skippedSheets: report.skippedSheets,
      skippedReasons: report.skippedReasons,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Could not read this workbook" });
  }
});

router.post("/import-cashbook", requireRole(WRITE), workbookUpload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload an .xlsx workbook in the 'file' field." });
    const { ledgers, report } = await parseCashbookWorkbook(req.file.buffer, sourceLabelFromFilename(req.file.originalname));
    if (ledgers.length === 0) {
      return res.status(400).json({
        error: "No dual cash-book sheets recognised in this workbook.",
        skippedSheets: report.skippedSheets,
        skippedReasons: report.skippedReasons,
      });
    }
    const result = await importParsedWorkbook(ledgers, report, { userId: req.user?.id });
    await logAudit({
      action: "CREATE",
      tableName: "truck_ledgers",
      recordId: result.ledgers,
      newValues: { file: req.file.originalname, source: "cashbook", ledgers: result.ledgers, entries: result.entriesInserted },
      performedBy: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    }).catch(() => {});
    const msg =
      `Imported ${result.ledgersInserted + result.ledgersUpdated} vehicle cash-book ledgers ` +
      `(${result.ledgersInserted} new, ${result.ledgersUpdated} updated) — ` +
      `${result.entriesInserted} new entries, ${result.entriesUpdated} updated. ` +
      `Also filed ${result.expensesCreated + result.expensesUpdated} expenses in Finance.`;
    res.json({ message: msg, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Import failed" });
  }
});

// ---------------------------------------------------------------------------
// MULTI-FILE "drop the whole folder" import — the client's real workflow
// isn't one file at a time, it's "here are all my Excel files, put them all
// in". Runs every recognizer (module-sheet matcher, khata, freight-log,
// cashbook) against EVERY uploaded file, exactly like a person driving each
// single-file screen once per file would — just automated across the whole
// batch in one request. The three ledger-shape parsers are mutually
// exclusive per sheet (see the "Looks like a ... sheet — left to ..."
// skip-reasons in freight-log-workbook.ts / cashbook-workbook.ts), so
// running all of them per file never double-counts the same sheet.
// ---------------------------------------------------------------------------
const PARSERS: Array<{ key: "khata" | "freightLog" | "cashbook"; label: string; fn: (buf: Buffer, sourceLabel?: string) => Promise<ParseResult> }> = [
  { key: "khata", label: "Truck Ledgers", fn: parseTruckWorkbook },
  { key: "freightLog", label: "Trip logs", fn: parseFreightLogWorkbook },
  { key: "cashbook", label: "Dual cash-book", fn: parseCashbookWorkbook },
];

router.post("/import-batch/preview", requireRole(WRITE), workbookUpload.array("files", 100), async (req: AuthRequest, res: Response) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ error: "Upload one or more .xlsx workbooks in the 'files' field." });

    const results: any[] = [];
    for (const f of files) {
      const label = sourceLabelFromFilename(f.originalname);
      const out: any = { fileName: f.originalname };

      let sheetNames: string[] = [];
      try {
        sheetNames = await listWorkbookSheets(f.buffer, f.originalname);
      } catch (e: any) {
        out.error = e.message || "Could not read this workbook";
        results.push(out);
        continue;
      }

      const moduleUnmatched: string[] = [];
      const moduleSheets: any[] = [];
      for (const name of sheetNames) {
        const entityKey = matchSheetToEntity(name);
        if (!entityKey || !getEntity(entityKey)) {
          moduleUnmatched.push(name);
          continue;
        }
        try {
          const v = await parseAndValidate(entityKey, f.buffer, f.originalname, "upsert", name);
          moduleSheets.push({ sheetName: name, entityKey, label: getEntity(entityKey)!.label, summary: v.summary });
        } catch (err: any) {
          moduleSheets.push({ sheetName: name, entityKey, error: err.message });
        }
      }
      out.module = { sheets: moduleSheets, unmatched: moduleUnmatched };

      const claimedSheets = new Set<string>(sheetNames.filter((n) => !moduleUnmatched.includes(n)));
      for (const p of PARSERS) {
        try {
          const { ledgers, report } = await p.fn(f.buffer, label);
          out[p.key] = { ledgerCount: ledgers.length, entries: report.totals.entries, skippedSheets: report.skippedSheets, skippedReasons: report.skippedReasons };
          for (const n of sheetNames) if (!report.skippedSheets.includes(n)) claimedSheets.add(n);
        } catch (e: any) {
          out[p.key] = { error: e.message };
        }
      }
      out.trulyUnmatched = sheetNames.filter((n) => !claimedSheets.has(n));
      results.push(out);
    }
    res.json({ files: results });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Could not preview these workbooks" });
  }
});

router.post("/import-batch", requireRole(WRITE), workbookUpload.array("files", 100), async (req: AuthRequest, res: Response) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ error: "Upload one or more .xlsx workbooks in the 'files' field." });

    const totals = {
      moduleInserted: 0, moduleUpdated: 0,
      ledgersInserted: 0, ledgersUpdated: 0,
      entriesInserted: 0, entriesUpdated: 0, entriesRemoved: 0,
      expensesCreated: 0, maintenanceCreated: 0,
    };
    const perFile: any[] = [];

    for (const f of files) {
      const label = sourceLabelFromFilename(f.originalname);
      const fileResult: any = { fileName: f.originalname };

      // ---- module-named sheets: validate then commit immediately (same
      // request, so the in-memory batch token is still there — no round trip). ----
      try {
        const sheetNames = await listWorkbookSheets(f.buffer, f.originalname);
        let modInserted = 0, modUpdated = 0;
        const moduleErrors: Array<{ sheet: string; error: string }> = [];
        for (const name of sheetNames) {
          const entityKey = matchSheetToEntity(name);
          if (!entityKey || !getEntity(entityKey)) continue;
          try {
            const v = await parseAndValidate(entityKey, f.buffer, f.originalname, "upsert", name);
            if (v.summary.toInsert + v.summary.toUpdate > 0) {
              const c = await commitBatch(v.batchToken, req.user!.id);
              modInserted += c.inserted;
              modUpdated += c.updated;
            }
          } catch (err: any) {
            moduleErrors.push({ sheet: name, error: err.message });
          }
        }
        fileResult.module = { inserted: modInserted, updated: modUpdated, errors: moduleErrors };
        totals.moduleInserted += modInserted;
        totals.moduleUpdated += modUpdated;
      } catch (e: any) {
        fileResult.module = { error: e.message };
      }

      // ---- the three ledger-shape recognizers (mutually exclusive per sheet) ----
      for (const p of PARSERS) {
        try {
          const { ledgers, report } = await p.fn(f.buffer, label);
          if (ledgers.length === 0) {
            fileResult[p.key] = { ledgerCount: 0 };
            continue;
          }
          const r = await importParsedWorkbook(ledgers, report, { userId: req.user?.id });
          fileResult[p.key] = {
            ledgersInserted: r.ledgersInserted, ledgersUpdated: r.ledgersUpdated,
            entriesInserted: r.entriesInserted, entriesUpdated: r.entriesUpdated, entriesRemoved: r.entriesRemoved,
            expensesCreated: r.expensesCreated, maintenanceCreated: r.maintenanceCreated,
          };
          totals.ledgersInserted += r.ledgersInserted;
          totals.ledgersUpdated += r.ledgersUpdated;
          totals.entriesInserted += r.entriesInserted;
          totals.entriesUpdated += r.entriesUpdated;
          totals.entriesRemoved += r.entriesRemoved;
          totals.expensesCreated += r.expensesCreated;
          totals.maintenanceCreated += r.maintenanceCreated;
        } catch (e: any) {
          fileResult[p.key] = { error: e.message };
        }
      }
      perFile.push(fileResult);
    }

    await logAudit({
      action: "CREATE",
      tableName: "truck_ledgers",
      recordId: totals.ledgersInserted + totals.ledgersUpdated,
      newValues: { files: files.map((f) => f.originalname), totals },
      performedBy: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    }).catch(() => {});

    const msg =
      `Imported ${files.length} file(s): ${totals.moduleInserted + totals.moduleUpdated} module records ` +
      `(${totals.moduleInserted} new, ${totals.moduleUpdated} updated), ` +
      `${totals.ledgersInserted + totals.ledgersUpdated} truck ledgers ` +
      `(${totals.ledgersInserted} new, ${totals.ledgersUpdated} updated) — ` +
      `${totals.entriesInserted} new entries, ${totals.entriesUpdated} updated, ${totals.entriesRemoved} removed. ` +
      `Also filed ${totals.expensesCreated} expenses and ${totals.maintenanceCreated} maintenance records in Finance/Workshop.`;
    res.json({ message: msg, totals, files: perFile });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Batch import failed" });
  }
});

// ---- create a ledger for a truck that has none -------------------------
router.post("/", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const vehicleId = b.vehicleId ? parseInt(b.vehicleId) : null;
    let registration = String(b.registration || "").trim().toUpperCase();
    if (vehicleId) {
      const [veh] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId)).limit(1);
      if (!veh) return res.status(404).json({ error: "Vehicle not found" });
      registration = veh.vehicleNumber;
    }
    if (!registration) return res.status(400).json({ error: "Pick a truck or type its registration number" });

    const dup = await db
      .select({ id: schema.truckLedgers.id })
      .from(schema.truckLedgers)
      .where(
        and(
          eq(schema.truckLedgers.isDeleted, false),
          vehicleId ? eq(schema.truckLedgers.vehicleId, vehicleId) : eq(schema.truckLedgers.registration, registration),
        ),
      )
      .limit(1);
    if (dup.length && !b.allowDuplicate) {
      return res.status(409).json({ error: `A ledger for ${registration} already exists · ${registration} کا کھاتہ پہلے سے موجود ہے`, existingId: dup[0].id });
    }

    const opening = Math.round(Number(b.openingBalance) || 0);
    const [created] = await db
      .insert(schema.truckLedgers)
      .values({
        vehicleId,
        registration,
        title: String(b.title || "").trim() || registration,
        ownerName: b.ownerName || null,
        driverName: b.driverName || null,
        driverPhone: b.driverPhone || null,
        isPartnership: !!b.isPartnership,
        openingBalance: opening,
        notes: b.notes || null,
        createdBy: req.user?.id,
      })
      .returning();
    if (opening !== 0) {
      await db.insert(schema.truckLedgerEntries).values({
        ledgerId: created.id,
        entryDate: b.openingDate ? new Date(b.openingDate) : new Date(),
        rawDate: b.openingDate ? String(b.openingDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
        method: "Opening",
        description: "Opening balance",
        received: opening > 0 ? opening : 0,
        paid: opening < 0 ? -opening : 0,
        category: "Other",
        direction: opening > 0 ? "In" : "Out",
        sectionLabel: "Manual",
        createdBy: req.user?.id,
      });
      await recompute(created.id);
    }
    await logAudit({
      action: "CREATE",
      tableName: "truck_ledgers",
      recordId: created.id,
      oldValues: null,
      newValues: created,
      performedBy: req.user?.id,
      ipAddress: req.ip,
    });
    res.json(created);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- list -------------------------------------------------------------
router.get("/", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db
      .select({
        ledger: schema.truckLedgers,
        vehicleNumber: schema.vehicles.vehicleNumber,
      })
      .from(schema.truckLedgers)
      .leftJoin(schema.vehicles, eq(schema.truckLedgers.vehicleId, schema.vehicles.id))
      .where(eq(schema.truckLedgers.isDeleted, false))
      .orderBy(asc(schema.truckLedgers.registration));

    const ids = rows.map((r) => r.ledger.id);
    const stats = ids.length
      ? await db
          .select({
            ledgerId: schema.truckLedgerEntries.ledgerId,
            entries: sql<number>`count(*)::int`,
            received: sql<number>`coalesce(sum(${schema.truckLedgerEntries.received}),0)::bigint`,
            paid: sql<number>`coalesce(sum(${schema.truckLedgerEntries.paid}),0)::bigint`,
            needReview: sql<number>`count(*) filter (where ${schema.truckLedgerEntries.needsReview})::int`,
          })
          .from(schema.truckLedgerEntries)
          .where(and(inArray(schema.truckLedgerEntries.ledgerId, ids), eq(schema.truckLedgerEntries.isDeleted, false)))
          .groupBy(schema.truckLedgerEntries.ledgerId)
      : [];
    const byId = new Map(stats.map((s) => [s.ledgerId, s]));

    res.json(
      rows.map((r) => {
        const s = byId.get(r.ledger.id);
        const received = Number(s?.received || 0);
        const paid = Number(s?.paid || 0);
        return {
          ...r.ledger,
          vehicleNumber: r.vehicleNumber,
          entryCount: s?.entries || 0,
          needsReviewCount: s?.needReview || 0,
          totalReceived: received,
          totalPaid: paid,
          netProfit: received - paid, // "safi bachat"
        };
      })
    );
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- portfolio summary ---------------------------------------------
router.get("/summary", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    const [tot] = await db
      .select({
        ledgers: sql<number>`count(distinct ${schema.truckLedgerEntries.ledgerId})::int`,
        entries: sql<number>`count(*)::int`,
        received: sql<number>`coalesce(sum(${schema.truckLedgerEntries.received}),0)::bigint`,
        paid: sql<number>`coalesce(sum(${schema.truckLedgerEntries.paid}),0)::bigint`,
        needReview: sql<number>`count(*) filter (where ${schema.truckLedgerEntries.needsReview})::int`,
      })
      .from(schema.truckLedgerEntries)
      .where(and(eq(schema.truckLedgerEntries.isDeleted, false), sql`coalesce(${schema.truckLedgerEntries.method}, '') <> 'Opening'`));
    const byCat = await db
      .select({
        category: schema.truckLedgerEntries.category,
        entries: sql<number>`count(*)::int`,
        received: sql<number>`coalesce(sum(${schema.truckLedgerEntries.received}),0)::bigint`,
        paid: sql<number>`coalesce(sum(${schema.truckLedgerEntries.paid}),0)::bigint`,
      })
      .from(schema.truckLedgerEntries)
      .where(and(eq(schema.truckLedgerEntries.isDeleted, false), sql`coalesce(${schema.truckLedgerEntries.method}, '') <> 'Opening'`))
      .groupBy(schema.truckLedgerEntries.category)
      .orderBy(desc(sql`count(*)`));
    res.json({
      totals: {
        ledgers: tot?.ledgers || 0,
        entries: tot?.entries || 0,
        totalReceived: Number(tot?.received || 0),
        totalPaid: Number(tot?.paid || 0),
        netProfit: Number(tot?.received || 0) - Number(tot?.paid || 0),
        needsReview: tot?.needReview || 0,
      },
      byCategory: byCat.map((c) => ({ ...c, received: Number(c.received), paid: Number(c.paid) })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- one ledger + entries ----------------------------------------
router.get("/:id", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    // balances are always shown as the current rules read the paper (a khata imported or merged
    // under older rules corrects itself the first time it is opened; unchanged rows aren't written)
    if (Number.isFinite(id)) await recompute(id).catch(() => {});
    const [row] = await db
      .select({ ledger: schema.truckLedgers, vehicleNumber: schema.vehicles.vehicleNumber })
      .from(schema.truckLedgers)
      .leftJoin(schema.vehicles, eq(schema.truckLedgers.vehicleId, schema.vehicles.id))
      .where(eq(schema.truckLedgers.id, id))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Ledger not found" });

    const limit = Math.min(5000, parseInt(req.query.limit as string) || 2000);
    const offset = parseInt(req.query.offset as string) || 0;
    const category = (req.query.category as string) || "";
    const needsReview = req.query.needsReview === "1";
    const cond = [eq(schema.truckLedgerEntries.ledgerId, id), eq(schema.truckLedgerEntries.isDeleted, false)];
    if (category) cond.push(eq(schema.truckLedgerEntries.category, category));
    if (needsReview) cond.push(eq(schema.truckLedgerEntries.needsReview, true));
    const day = (v: any) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const from = day(req.query.from);
    const to = day(req.query.to);
    if (from) cond.push(sql`${schema.truckLedgerEntries.entryDate} >= ${from}::timestamp`);
    if (to) cond.push(sql`${schema.truckLedgerEntries.entryDate} < (${to}::date + 1)::timestamp`);

    const entries = await db
      .select()
      .from(schema.truckLedgerEntries)
      .where(and(...cond))
      .orderBy(PAGE_ORDER, asc(ROW_ORDER))
      .limit(limit)
      .offset(offset);

    const byCat = await db
      .select({
        category: schema.truckLedgerEntries.category,
        received: sql<number>`coalesce(sum(${schema.truckLedgerEntries.received}),0)::bigint`,
        paid: sql<number>`coalesce(sum(${schema.truckLedgerEntries.paid}),0)::bigint`,
        entries: sql<number>`count(*)::int`,
      })
      .from(schema.truckLedgerEntries)
      .where(
        and(
          eq(schema.truckLedgerEntries.ledgerId, id),
          eq(schema.truckLedgerEntries.isDeleted, false),
          sql`coalesce(${schema.truckLedgerEntries.method}, '') <> 'Opening'`,
          from ? sql`${schema.truckLedgerEntries.entryDate} >= ${from}::timestamp` : sql`true`,
          to ? sql`${schema.truckLedgerEntries.entryDate} < (${to}::date + 1)::timestamp` : sql`true`,
        ),
      )
      .groupBy(schema.truckLedgerEntries.category);

    const totReceived = byCat.reduce((s, c) => s + Number(c.received), 0);
    const totPaid = byCat.reduce((s, c) => s + Number(c.paid), 0);

    // the balance flow: what the khata stood at before (its opening balance, plus everything before
    // the chosen start date), what came in and went out in the period, and where it stands after
    const [flow] = ((await db.execute(sql`select
        coalesce(sum(received - paid) filter (where method = 'Opening'), 0)::bigint opening_row,
        min(to_char(entry_date, 'YYYY-MM-DD')) filter (where method = 'Opening') opening_date,
        coalesce(sum(received - paid) filter (where coalesce(method, '') <> 'Opening' and ${from ? sql`entry_date < ${from}::timestamp` : sql`false`}), 0)::bigint before,
        coalesce(sum(received - paid) filter (where coalesce(method, '') <> 'Opening' and ${to ? sql`entry_date >= (${to}::date + 1)::timestamp` : sql`false`}), 0)::bigint after
      from truck_ledger_entries where ledger_id = ${id} and not is_deleted`)) as any).rows;
    const openingRow = Number(flow?.opening_row || 0);
    const opening = openingRow + Number(flow?.before || 0);

    let partnerAgreement = null;
    if (row.ledger.partnerAgreementId) {
      [partnerAgreement] = await db
        .select()
        .from(schema.partnerAgreements)
        .where(eq(schema.partnerAgreements.id, row.ledger.partnerAgreementId))
        .limit(1);
    }

    // which trip each row belongs to (typed through it, or dated inside its days)
    const spans = await tripSpansForTruck(row.ledger.vehicleId, row.vehicleNumber || row.ledger.registration).catch(() => []);
    const withTrip = spans.length
      ? entries.map((e) => {
          const s = spanOf(spans, e);
          return { ...e, trip: s ? { rootId: s.rootId, label: s.label, tagged: e.derivedTripId != null } : null };
        })
      : entries;
    // a row the books check says is wrong shows red right here, until it is corrected
    const issues = await rowIssues("tle", entries.map((e) => e.id)).catch(() => new Map<number, string>());

    // Cash handed to the driver, and what he paid out of it (diesel at the pump, toll…). Underneath, a
    // "paid from the cash" row is taken out of its cash row so every rupee is counted once by what it
    // was for. On the khata it reads the way it is written on paper: the cash in full (350,000), and the
    // diesel under it as "from the cash" — not a second Out. The balance column follows the same reading.
    const order = ((await db.execute(sql`select id, paid, paid_from_entry_id from truck_ledger_entries
        where ledger_id = ${id} and not is_deleted order by ${PAGE_ORDER}, ${ROW_ORDER}`)) as any).rows as Array<{ id: number; paid: number; paid_from_entry_id: number | null }>;
    const spentFrom = new Map<number, number>();
    for (const r of order) if (r.paid_from_entry_id) spentFrom.set(r.paid_from_entry_id, (spentFrom.get(r.paid_from_entry_id) || 0) + Number(r.paid || 0));
    const shift = new Map<number, number>(); // running-balance correction up to and including each row
    let cum = 0;
    for (const r of order) {
      cum += (spentFrom.get(r.id) || 0) - (r.paid_from_entry_id ? Number(r.paid || 0) : 0);
      shift.set(r.id, cum);
    }
    const flagged = (withTrip as any[]).map((e) => {
      const spent = spentFrom.get(e.id) || 0;
      const out = {
        ...e,
        spentFromIt: spent,
        shownPaid: e.paidFromEntryId ? 0 : e.paid + spent,
        fromCash: e.paidFromEntryId ? e.paid : 0,
        shownBalance: e.runningBalance - (shift.get(e.id) || 0),
      };
      return issues.has(e.id) ? { ...out, issue: issues.get(e.id) } : out;
    });
    // the driver's cash in these rows: handed over, spent out of it, still with him (not yet accounted for)
    const drv = entries.reduce(
      (a, e) => {
        if (e.category === "TripCash" && !e.paidFromEntryId) a.given += e.paid + (spentFrom.get(e.id) || 0);
        if (e.paidFromEntryId) a.spent += e.paid;
        return a;
      },
      { given: 0, spent: 0 },
    );

    res.json({
      ledger: { ...row.ledger, vehicleNumber: row.vehicleNumber },
      partnerAgreement,
      entries: flagged,
      balance: {
        from,
        to,
        openingBalance: openingRow, // the khata's own opening balance (editable)
        openingDate: flow?.opening_date || null,
        opening, // the balance at the start of the period
        received: totReceived,
        paid: totPaid,
        profit: totReceived - totPaid,
        closing: opening + totReceived - totPaid,
        runningClosing: row.ledger.closingBalance, // the last row's running balance (old paper pages each start from 0)
        driverCash: drv.given ? { given: drv.given, spent: drv.spent, withDriver: drv.given - drv.spent } : null,
      },
      pnl: {
        totalReceived: totReceived,
        totalPaid: totPaid,
        netProfit: totReceived - totPaid,
        byCategory: byCat
          .map((c) => ({ category: c.category, received: Number(c.received), paid: Number(c.paid), entries: c.entries }))
          .sort((a, b) => b.paid + b.received - (a.paid + a.received)),
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Pages in the order they were written. Sorting the page label as text put "Page 10" before
// "Page 2" and made "Page 9" the last page, so a 12-page khata's closing balance came from
// page 9. Within a page, rows keep the order they were written — the paper's own order (an
// unnumbered real row such as "Carnet Send kiye Taftan ko" stays in place). (Window
// functions are allowed in ORDER BY.)
// A row's place on the paper: its id, unless it was imported into this khata from another
// sheet and placed between existing rows (sort_key; see khata-merge.ts).
const ROW_ORDER = sql`coalesce(${schema.truckLedgerEntries.sortKey}, ${schema.truckLedgerEntries.id})`;
const PAGE_ORDER = sql`min(coalesce(${schema.truckLedgerEntries.sortKey}, ${schema.truckLedgerEntries.id})) over (partition by ${schema.truckLedgerEntries.sectionLabel})`;

// ---- recompute a ledger's running balances (after edits) ---------
export async function recompute(ledgerId: number) {
  const rows = await db
    .select()
    .from(schema.truckLedgerEntries)
    .where(and(eq(schema.truckLedgerEntries.ledgerId, ledgerId), eq(schema.truckLedgerEntries.isDeleted, false)))
    .orderBy(PAGE_ORDER, asc(ROW_ORDER));
  let running = 0;
  let section: string | null | undefined = undefined;
  let prevPageLastId = 0; // highest row id of the page just finished
  let pageLastId = 0;
  let lastReal = 0;
  for (const r of rows) {
    if (r.sectionLabel !== section) {
      prevPageLastId = pageLastId;
      pageLastId = 0;
      section = r.sectionLabel;
      // a new paper page starts from 0. Rows added in the app ("Manual") carry on from the page
      // before them — but only when that page was written BEFORE them (a new line under the last
      // page). An older paper page imported later and placed before them is history: it must
      // not add its balance into rows it was never part of.
      if (section !== "Manual" || prevPageLastId > r.id) running = 0;
    }
    pageLastId = Math.max(pageLastId, r.id);
    // a figure from the settlement box drawn beside the paper table (imported, but no Sr# and
    // no balance of its own) is not the truck's money — it must not move the balance
    const boxFigure = r.sourceRow != null && r.srNo == null && r.sheetBalance == null && !!(r.received || r.paid);
    if (!boxFigure) running += (r.received || 0) - (r.paid || 0);
    if (r.isReset) running = 0;
    if ((r.received || r.paid) && !boxFigure) lastReal = running;
    if (r.runningBalance !== running) {
      await db.update(schema.truckLedgerEntries).set({ runningBalance: running }).where(eq(schema.truckLedgerEntries.id, r.id));
    }
  }
  await db.update(schema.truckLedgers).set({ closingBalance: lastReal, updatedAt: new Date() }).where(eq(schema.truckLedgers.id, ledgerId));
  return lastReal;
}

// ---- the khata's opening balance: + money it held / − it owed when it started ----------------
router.put("/:id(\\d+)/opening", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const ledgerId = parseInt(req.params.id);
    const [led] = await db.select().from(schema.truckLedgers).where(eq(schema.truckLedgers.id, ledgerId)).limit(1);
    if (!led) return res.status(404).json({ error: "Ledger not found" });
    const amount = Math.round(Number(req.body?.amount) || 0);
    const date = typeof req.body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : null;
    const T = schema.truckLedgerEntries;
    const old = await db.select().from(T).where(and(eq(T.ledgerId, ledgerId), eq(T.isDeleted, false), eq(T.method, "Opening"))).orderBy(asc(T.id));
    const [keep, ...extra] = old;
    const values = {
      received: amount > 0 ? amount : 0,
      paid: amount < 0 ? -amount : 0,
      direction: amount > 0 ? "In" : amount < 0 ? "Out" : null,
      ...(date ? { entryDate: new Date(`${date}T12:00:00`), rawDate: date } : {}),
      updatedAt: new Date(),
      updatedBy: req.user?.id,
    };
    if (extra.length) await db.update(T).set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id }).where(inArray(T.id, extra.map((x) => x.id)));
    let row: any = null;
    if (amount === 0) {
      if (keep) await db.update(T).set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(T.id, keep.id));
    } else if (keep) {
      [row] = await db.update(T).set(values).where(eq(T.id, keep.id)).returning();
    } else {
      // a new opening row goes before the hand-entered rows (first line of the khata)
      const [m] = ((await db.execute(sql`select min(coalesce(sort_key, id)) k, min(to_char(entry_date, 'YYYY-MM-DD')) d from truck_ledger_entries
        where ledger_id = ${ledgerId} and not is_deleted and section_label = 'Manual'`)) as any).rows;
      const d = date || m?.d || new Date().toISOString().slice(0, 10);
      [row] = await db
        .insert(T)
        .values({
          ledgerId,
          ...values,
          entryDate: new Date(`${d}T12:00:00`),
          rawDate: d,
          method: "Opening",
          description: "Opening balance",
          category: "Other",
          sectionLabel: "Manual",
          sortKey: m?.k != null ? Number(m.k) - 1 : null,
          createdBy: req.user?.id,
        })
        .returning();
    }
    await db.update(schema.truckLedgers).set({ openingBalance: amount, updatedAt: new Date() }).where(eq(schema.truckLedgers.id, ledgerId));
    await recompute(ledgerId);
    await audit(req, "UPDATE", keep?.id || row?.id || 0, keep || null, { openingBalance: amount, date: date || null });
    res.json({ ok: true, openingBalance: amount });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- add an entry ----------------------------------------------
router.post("/:id/entries", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const ledgerId = parseInt(req.params.id);
    const [led] = await db.select().from(schema.truckLedgers).where(eq(schema.truckLedgers.id, ledgerId)).limit(1);
    if (!led) return res.status(404).json({ error: "Ledger not found" });
    const b = req.body || {};
    const received = Math.max(0, Math.round(Number(b.received) || 0));
    const paid = Math.max(0, Math.round(Number(b.paid) || 0));
    const amount = received > 0 ? received : paid;
    const refKey = String(b.description || "").trim().toLowerCase();

    // duplicate-slip guard: same truck, same amount, same date, same description
    let dupWarning: string | null = null;
    if (amount > 0 && b.entryDate && refKey) {
      const existing = await db
        .select({ id: schema.truckLedgerEntries.id })
        .from(schema.truckLedgerEntries)
        .where(
          and(
            eq(schema.truckLedgerEntries.ledgerId, ledgerId),
            eq(schema.truckLedgerEntries.isDeleted, false),
            sql`to_char(${schema.truckLedgerEntries.entryDate}, 'YYYY-MM-DD') = ${String(b.entryDate).slice(0, 10)}`,
            sql`(case when ${schema.truckLedgerEntries.received} > 0 then ${schema.truckLedgerEntries.received} else ${schema.truckLedgerEntries.paid} end) = ${amount}`,
            sql`lower(trim(coalesce(${schema.truckLedgerEntries.description}, ''))) = ${refKey}`,
          ),
        )
        .limit(1);
      if (existing.length) {
        dupWarning = `DUPLICATE: PKR ${amount.toLocaleString()} on ${String(b.entryDate).slice(0, 10)} "${b.description}" is already in this truck's ledger. · یہ اندراج پہلے سے موجود ہے۔`;
      }
    }

    const [created] = await db
      .insert(schema.truckLedgerEntries)
      .values({
        ledgerId,
        srNo: b.srNo != null ? Number(b.srNo) : null,
        entryDate: b.entryDate ? new Date(b.entryDate) : null,
        rawDate: b.rawDate || (b.entryDate ? String(b.entryDate).slice(0, 10) : null),
        method: b.method || null,
        partyFrom: b.partyFrom || null,
        partyTo: b.partyTo || null,
        description: b.description || null,
        received,
        paid,
        category: b.category || "Other",
        direction: received > 0 ? "In" : paid > 0 ? "Out" : null,
        sectionLabel: b.sectionLabel || led.sourceSheet || "Manual",
        routeFrom: b.routeFrom || null,
        routeTo: b.routeTo || null,
        cargo: b.cargo || null,
        needsReview: !!b.needsReview || !!dupWarning,
        reviewReason: dupWarning ? "Possible duplicate — same amount + date + description already recorded" : undefined,
        createdBy: req.user?.id,
      })
      .returning();
    const newBalance = await recompute(ledgerId);
    await audit(req, "CREATE", created.id, null, created);

    // auto-SMS the truck's assigned driver about this credit / debit
    notifyDriverOfLedgerEntry({
      vehicleId: led.vehicleId,
      registration: led.registration,
      received: created.received || 0,
      paid: created.paid || 0,
      balance: typeof newBalance === "number" ? newBalance : 0,
      ref: created.description,
      entryId: created.id,
      userId: req.user?.id,
    }).catch((err) => console.error("[ledgers] driver SMS failed:", err?.message));

    res.status(201).json({ ...created, duplicateWarning: dupWarning });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- edit an entry -------------------------------------------
router.put("/entries/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.truckLedgerEntries).where(eq(schema.truckLedgerEntries.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Entry not found" });
    const b = req.body || {};
    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user?.id };
    for (const k of ["method", "partyFrom", "partyTo", "description", "category", "sectionLabel", "routeFrom", "routeTo", "cargo", "reviewReason"]) {
      if (b[k] !== undefined) patch[k] = b[k] || null;
    }
    if (b.entryDate !== undefined) {
      patch.entryDate = b.entryDate ? new Date(b.entryDate) : null;
      patch.rawDate = b.entryDate ? String(b.entryDate).slice(0, 10) : old.rawDate;
    }
    if (b.received !== undefined) patch.received = Math.max(0, Math.round(Number(b.received) || 0));
    if (b.paid !== undefined) patch.paid = Math.max(0, Math.round(Number(b.paid) || 0));
    if (b.srNo !== undefined) patch.srNo = b.srNo != null ? Number(b.srNo) : null;
    if (b.needsReview !== undefined) patch.needsReview = !!b.needsReview;
    const recv = patch.received != null ? (patch.received as number) : old.received;
    const paid = patch.paid != null ? (patch.paid as number) : old.paid;
    patch.direction = recv > 0 ? "In" : paid > 0 ? "Out" : null;

    // a row paid out of the driver's cash: a new amount moves the difference in / out of that cash
    let cashRow: typeof schema.truckLedgerEntries.$inferSelect | undefined;
    if (old.paidFromEntryId && patch.paid != null && patch.paid !== old.paid) {
      [cashRow] = await db.select().from(schema.truckLedgerEntries).where(and(eq(schema.truckLedgerEntries.id, old.paidFromEntryId), eq(schema.truckLedgerEntries.isDeleted, false))).limit(1);
      if (cashRow && cashRow.paid - ((patch.paid as number) - old.paid) < 0)
        return res.status(400).json({ error: `Only PKR ${(cashRow.paid + old.paid).toLocaleString()} of the driver's cash is there for this · ڈرائیور کی نقد میں اتنی رقم نہیں` });
    }

    const [updated] = await db.update(schema.truckLedgerEntries).set(patch).where(eq(schema.truckLedgerEntries.id, id)).returning();
    if (cashRow) {
      const next = cashRow.paid - ((patch.paid as number) - old.paid);
      await db.update(schema.truckLedgerEntries).set({ paid: next, updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.truckLedgerEntries.id, cashRow.id));
      await audit(req, "UPDATE", cashRow.id, cashRow, { ...cashRow, paid: next, note: `entry ${id} changed from ${old.paid} to ${patch.paid}` });
      if (cashRow.ledgerId !== old.ledgerId) await recompute(cashRow.ledgerId);
    }
    await recompute(old.ledgerId);
    await audit(req, "UPDATE", id, old, updated);
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- delete an entry ---------------------------------------
router.delete("/entries/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.truckLedgerEntries).where(eq(schema.truckLedgerEntries.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Entry not found" });
    const [kids] = ((await db.execute(sql`select count(*)::int n, coalesce(sum(paid), 0)::int s from truck_ledger_entries where paid_from_entry_id = ${id} and not is_deleted`)) as any).rows;
    if (kids?.n) return res.status(400).json({ error: `PKR ${Number(kids.s).toLocaleString()} (diesel, toll…) was paid out of this cash — delete ${kids.n === 1 ? "that entry" : "those entries"} first · اس نقد میں سے ادا ہوئی انٹریاں پہلے ہٹائیں` });
    await db
      .update(schema.truckLedgerEntries)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id })
      .where(eq(schema.truckLedgerEntries.id, id));
    if (old.paidFromEntryId) {
      // it came out of the driver's cash: that cash gets it back
      const [cash] = await db.select().from(schema.truckLedgerEntries).where(and(eq(schema.truckLedgerEntries.id, old.paidFromEntryId), eq(schema.truckLedgerEntries.isDeleted, false))).limit(1);
      if (cash) {
        await db.update(schema.truckLedgerEntries).set({ paid: cash.paid + old.paid, updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.truckLedgerEntries.id, cash.id));
        if (cash.ledgerId !== old.ledgerId) await recompute(cash.ledgerId);
      }
    }
    await retireSyncedRecords(id, req.user?.id); // its auto-filed expense / maintenance + journal
    await recompute(old.ledgerId);
    await audit(req, "DELETE", id, old, null);
    res.json({ message: "Entry deleted" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- delete a whole ledger (the sheet itself, plus every entry in it) ----
router.delete("/:id(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [ledger] = await db.select().from(schema.truckLedgers).where(eq(schema.truckLedgers.id, id)).limit(1);
    if (!ledger) return res.status(404).json({ error: "Ledger not found" });

    const entries = await db
      .select({ id: schema.truckLedgerEntries.id })
      .from(schema.truckLedgerEntries)
      .where(and(eq(schema.truckLedgerEntries.ledgerId, id), eq(schema.truckLedgerEntries.isDeleted, false)));

    await db
      .update(schema.truckLedgerEntries)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id })
      .where(eq(schema.truckLedgerEntries.ledgerId, id));
    // and whatever its rows had filed into Expenses / Workshop / the journal (an imported khata
    // deleted as a mistake must not leave its money counted in Finance)
    for (const e of entries) await retireSyncedRecords(e.id, req.user?.id);
    await db
      .update(schema.truckLedgers)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id })
      .where(eq(schema.truckLedgers.id, id));

    await logAudit({
      action: "DELETE",
      tableName: "truck_ledgers",
      recordId: id,
      oldValues: { ...ledger, entriesDeleted: entries.length },
      newValues: null,
      performedBy: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    }).catch(() => {});

    res.json({ message: `Ledger "${ledger.title}" and ${entries.length} entries deleted` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
