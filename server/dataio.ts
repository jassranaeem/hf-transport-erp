/**
 * Generic Import / Export API.
 *
 *   GET  /api/data/entities                 - list importable/exportable tables
 *   GET  /api/data/:entity/template         - download a blank .xlsx template
 *   GET  /api/data/:entity/export?format=   - download all rows (xlsx | csv)
 *   POST /api/data/:entity/validate?mode=   - upload a file, dry-run validate
 *   POST /api/data/commit                   - apply a previously validated batch
 *
 * Replaces the old "run raw SQL to load history" workflow with a safe,
 * validated, file-based flow for every registered table.
 */
import { Router, Response } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { getEntity, listEntities, ENTITIES } from "../src/lib/dataio/registry.ts";
import {
  buildTemplateWorkbook,
  buildExportWorkbook,
  parseAndValidate,
  commitBatch,
  fetchAllForExport,
  listWorkbookSheets,
} from "../src/lib/dataio/engine.ts";
import { logAudit } from "../src/db/audit.ts";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

const router = Router();

// everything here needs an approved account
router.use(requireAuth, requireApproved);

// who can mutate data through bulk import
const canImport = requireRole(["Super Admin", "Admin", "Operations Manager"]);

function slugFilename(label: string, ext: string) {
  return `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${new Date()
    .toISOString()
    .slice(0, 10)}.${ext}`;
}

router.get("/entities", (_req, res: Response) => {
  res.json({ entities: listEntities() });
});

// ---- WHOLE-WORKBOOK import (registered before /:entity/* so it isn't shadowed) ----
router.post(
  "/workbook/validate",
  canImport,
  upload.single("file"),
  async (req: AuthRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded (field name: 'file')" });
    const mode = (req.query.mode as string) === "insert" ? "insert" : "upsert";
    const fname = req.file.originalname || "workbook.xlsx";
    try {
      const sheetNames = await listWorkbookSheets(req.file.buffer, fname);
      if (!sheetNames.length) {
        return res.status(400).json({ error: "That doesn't look like a multi-sheet .xlsx workbook." });
      }
      const sheets: any[] = [];
      const unmatched: string[] = [];
      for (const name of sheetNames) {
        const entityKey = matchSheetToEntity(name);
        if (!entityKey || !getEntity(entityKey)) {
          unmatched.push(name);
          continue;
        }
        try {
          const result = await parseAndValidate(entityKey, req.file.buffer, fname, mode, name);
          sheets.push({
            sheetName: name,
            entityKey,
            label: getEntity(entityKey)!.label,
            summary: result.summary,
            errors: result.errors.slice(0, 30),
            batchToken: result.batchToken,
          });
        } catch (err: any) {
          sheets.push({ sheetName: name, entityKey, label: getEntity(entityKey)?.label, error: err.message });
        }
      }
      res.json({ file: fname, mode, sheets, unmatched });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Could not read the workbook" });
    }
  },
);

router.post("/workbook/commit", canImport, async (req: AuthRequest, res: Response) => {
  const tokens: string[] = Array.isArray(req.body?.batchTokens) ? req.body.batchTokens : [];
  if (!tokens.length) return res.status(400).json({ error: "batchTokens[] is required" });
  const results: any[] = [];
  let inserted = 0;
  let updated = 0;
  for (const t of tokens) {
    try {
      const r = await commitBatch(t, req.user!.id);
      inserted += r.inserted;
      updated += r.updated;
      results.push(r);
    } catch (err: any) {
      results.push({ error: err.message });
    }
  }
  await logAudit({
    action: "CREATE",
    tableName: "data_import:workbook",
    recordId: inserted + updated,
    newValues: { inserted, updated, batches: tokens.length },
    performedBy: req.user!.id,
    ipAddress: req.ip || undefined,
    userAgent: req.headers["user-agent"] || undefined,
  }).catch(() => {});
  res.json({ inserted, updated, results });
});

// ---- WHOLE-WORKBOOK export: several tables as one .xlsx, one sheet each -------------
// Sheet names are chosen so /workbook/validate maps them straight back on re-import.
const WORKBOOK_SHEETS: Record<string, string> = {
  trips: "Trips", vehicles: "Trucks", drivers: "Drivers", routes: "Routes", contractors: "Customers",
};
router.get("/workbook/export", async (req: AuthRequest, res: Response) => {
  try {
    const keys = String(req.query.entities || "")
      .split(",")
      .map((k) => k.trim())
      .filter((k) => getEntity(k));
    if (!keys.length) return res.status(400).json({ error: "entities= is required" });
    const combined = new ExcelJS.Workbook();
    combined.creator = "HF Transport ERP";
    combined.created = new Date();
    for (const key of keys) {
      const entity = getEntity(key)!;
      const one = await buildExportWorkbook(entity, await fetchAllForExport(entity));
      const src = one.worksheets[0];
      const dst = combined.addWorksheet(WORKBOOK_SHEETS[key] || entity.label.replace(/[\\/*?:\[\]]/g, " ").slice(0, 28));
      dst.columns = (src.columns || []).map((c: any) => ({ header: c.header, key: c.key, width: c.width }));
      dst.getRow(1).font = { bold: true };
      dst.views = [{ state: "frozen", ySplit: 1 }];
      src.eachRow((row, i) => {
        if (i === 1) return;
        dst.addRow((row.values as any[]).slice(1));
      });
    }
    const buf = await combined.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${slugFilename("fleet-desk", "xlsx")}"`);
    res.send(Buffer.from(buf as ArrayBuffer));
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

router.get("/:entity/template", async (req: AuthRequest, res: Response) => {
  const entity = getEntity(req.params.entity);
  if (!entity) return res.status(404).json({ error: "Unknown entity" });
  try {
    const wb = buildTemplateWorkbook(entity);
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${slugFilename(entity.label + "-template", "xlsx")}"`
    );
    res.send(Buffer.from(buf));
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to build template" });
  }
});

router.get("/:entity/export", async (req: AuthRequest, res: Response) => {
  const entity = getEntity(req.params.entity);
  if (!entity) return res.status(404).json({ error: "Unknown entity" });
  const format = (req.query.format as string) === "csv" ? "csv" : "xlsx";
  try {
    const rows = await fetchAllForExport(entity);
    const wb = await buildExportWorkbook(entity, rows);
    const buf =
      format === "csv" ? await wb.csv.writeBuffer() : await wb.xlsx.writeBuffer();

    res.setHeader(
      "Content-Type",
      format === "csv"
        ? "text/csv"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${slugFilename(entity.label, format)}"`
    );
    res.send(Buffer.from(buf as ArrayBuffer));
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Export failed" });
  }
});

router.post(
  "/:entity/validate",
  canImport,
  upload.single("file"),
  async (req: AuthRequest, res: Response) => {
    const entity = getEntity(req.params.entity);
    if (!entity) return res.status(404).json({ error: "Unknown entity" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded (field name: 'file')" });

    const mode = (req.query.mode as string) === "upsert" ? "upsert" : "insert";
    try {
      const result = await parseAndValidate(
        entity.key,
        req.file.buffer,
        req.file.originalname || "upload.xlsx",
        mode
      );
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Could not read the file" });
    }
  }
);

// ---------------------------------------------------------------------------
// WHOLE-WORKBOOK import — drop ONE Excel file with many sheets (Vehicles,
// Drivers, Routes, …); each sheet is matched to an entity and validated. One
// confirm imports everything. "File import karo, baaki system khud karega."
// ---------------------------------------------------------------------------
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const SHEET_ALIASES: Record<string, string> = {
  trucks: "vehicles", fleet: "vehicles", vehicle: "vehicles",
  driver: "drivers", staffdrivers: "drivers",
  route: "routes", corridors: "routes", corridor: "routes",
  customers: "contractors", customer: "contractors", carriers: "contractors",
  carrier: "contractors", clients: "contractors", contractor: "contractors",
  trip: "trips", dispatch: "trips", dispatches: "trips",
  party: "parties", khata: "parties", accountsledger: "parties",
  employee: "employees", staff: "employees",
  chartofaccounts: "accounts", coa: "accounts", account: "accounts",
  invoice: "invoices", bill: "bills", expense: "expenses",
  fueltransactions: "fuel_transactions", fuel: "fuel_transactions",
};

// Real workbooks accumulate blank placeholder tabs over years of use — "NO",
// "NO,", "NO ,", "SHEET", "SHEET,," etc. (every punctuation variant collapses
// to the same normalized "no" / "sheet" after norm() strips punctuation).
// These aren't data sheets and must never match anything, however they're
// punctuated.
const JUNK_SHEET_NAMES = new Set(["no", "sheet", "na", "n"]);

export function matchSheetToEntity(sheetName: string): string | null {
  const n = norm(sheetName);
  if (!n || JUNK_SHEET_NAMES.has(n)) return null;
  if (SHEET_ALIASES[n]) return SHEET_ALIASES[n];
  // exact key or label
  for (const e of ENTITIES) {
    if (norm(e.key) === n || norm(e.label) === n) return e.key;
  }
  // "contains" fallback — only for names with enough characters to mean
  // something. A short/generic sheet name (a couple of letters, an
  // abbreviation like "HOUSE") is a near-certain substring of *some*
  // unrelated entity's longer key/label ("house" inside "householdexpenses",
  // "no" inside "notifications") — that's how a two-letter blank tab
  // silently imported itself into the Notifications module. Below this
  // length, only an exact match (above) counts.
  if (n.length < 6) return null;
  for (const e of ENTITIES) {
    if (n.includes(norm(e.key)) || norm(e.label).includes(n)) return e.key;
  }
  return null;
}

// (workbook/validate + workbook/commit routes are registered near the top so
//  they win over the /:entity/* routes — see below "entities" route)

router.post("/commit", canImport, async (req: AuthRequest, res: Response) => {
  const { batchToken } = req.body || {};
  if (!batchToken) return res.status(400).json({ error: "batchToken is required" });
  try {
    const result = await commitBatch(batchToken, req.user!.id);
    await logAudit({
      action: result.mode === "upsert" ? "UPDATE" : "CREATE",
      tableName: `data_import:${result.entity}`,
      recordId: result.inserted + result.updated,
      newValues: {
        inserted: result.inserted,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.length,
      },
      performedBy: req.user!.id,
      ipAddress: req.ip || undefined,
      userAgent: req.headers["user-agent"] || undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Import failed" });
  }
});

export default router;
