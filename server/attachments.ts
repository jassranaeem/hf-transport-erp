/**
 * Universal attachments — real file uploads linked to any record in any
 * module (receipts, proofs, scanned bilties, POD, etc.).
 *
 * Mounted at /api/attachments. Files are written to disk under ./uploads and
 * streamed back through an authenticated route (never served statically).
 *
 *   POST   /api/attachments            multipart: file + entityType + entityId [+ caption, category]
 *   GET    /api/attachments?entityType=&entityId=
 *   GET    /api/attachments/:id/file   -> streams the bytes
 *   PATCH  /api/attachments/:id        { caption, category }
 *   DELETE /api/attachments/:id        soft delete + unlink
 */
import { Router, Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { requireAuth, requireApproved, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { and, eq, desc, sql } from "drizzle-orm";
import { logAudit } from "../src/db/audit.ts";
import { getEntity } from "../src/lib/dataio/registry.ts";

export const UPLOADS_DIR = path.resolve(process.cwd(), process.env.UPLOADS_DIR || "uploads");

const ALLOWED_ENTITY_TYPES = new Set([
  "trip", "invoice", "expense", "fuel_transaction", "fuel_issue_slip", "vehicle_maintenance",
  "maintenance_job", "job_card", "tyre", "battery", "route", "vehicle", "driver", "contractor",
  "partner", "partner_settlement", "partner_agreement", "truck_ledger", "truck_ledger_entry",
  "party", "party_ledger_entry", "company_profile", "bank_account", "document",
]);

const ALLOWED_MIME = /^(image\/(png|jpe?g|gif|webp|heic|heif)|application\/pdf|text\/plain|application\/vnd\.openxmlformats-officedocument\..+|application\/msword|application\/vnd\.ms-excel)$/i;

function destFor(entityType: string): string {
  const dir = path.join(UPLOADS_DIR, entityType.replace(/[^a-z_]/gi, ""));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      cb(null, destFor(String((req.body && req.body.entityType) || "document")));
    } catch (e: any) {
      cb(e, "");
    }
  },
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").slice(0, 12).replace(/[^.\w]/g, "");
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.test(file.mimetype || "")),
});

const router = Router();
router.use(requireAuth, requireApproved);

// ---- upload ----------------------------------------------------------
router.post("/", upload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file (or unsupported type). Allowed: images, PDF, Office docs." });
    const entityType = String(req.body.entityType || "").trim();
    const entityId = parseInt(req.body.entityId, 10);
    if ((!ALLOWED_ENTITY_TYPES.has(entityType) && !getEntity(entityType)) || !Number.isFinite(entityId)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Valid entityType and entityId are required" });
    }
    const relPath = path.relative(UPLOADS_DIR, req.file.path).replace(/\\/g, "/");

    // content hash — lets the alert engine spot the SAME receipt uploaded twice
    let sha256: string | null = null;
    try {
      sha256 = crypto.createHash("sha256").update(fs.readFileSync(req.file.path)).digest("hex");
    } catch {
      /* hashing is best-effort */
    }

    // duplicate warning: same bytes already attached anywhere (not blocked, just reported)
    let duplicateOf: any[] = [];
    if (sha256) {
      duplicateOf = await db
        .select({
          id: schema.attachments.id,
          entityType: schema.attachments.entityType,
          entityId: schema.attachments.entityId,
          fileName: schema.attachments.fileName,
          createdAt: schema.attachments.createdAt,
        })
        .from(schema.attachments)
        .where(and(eq(schema.attachments.sha256, sha256), eq(schema.attachments.isDeleted, false)));
    }
    // softer signal: same file name + same size but different bytes (a re-scan / re-photo of the same slip)
    let sameSlip: any[] = [];
    if (req.file.originalname && req.file.size) {
      sameSlip = await db
        .select({
          id: schema.attachments.id,
          entityType: schema.attachments.entityType,
          entityId: schema.attachments.entityId,
          fileName: schema.attachments.fileName,
          createdAt: schema.attachments.createdAt,
        })
        .from(schema.attachments)
        .where(
          and(
            eq(schema.attachments.fileName, req.file.originalname),
            eq(schema.attachments.size, req.file.size),
            eq(schema.attachments.isDeleted, false),
            sha256 ? sql`(${schema.attachments.sha256} is null or ${schema.attachments.sha256} <> ${sha256})` : sql`1=1`,
          ),
        );
    }

    const [created] = await db
      .insert(schema.attachments)
      .values({
        entityType,
        entityId,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        diskPath: relPath,
        sha256,
        caption: req.body.caption || null,
        category: req.body.category || "Receipt",
        createdBy: req.user?.id,
      })
      .returning();
    await logAudit({
      action: "CREATE",
      tableName: "attachments",
      recordId: created.id,
      newValues: { entityType, entityId, fileName: created.fileName, size: created.size },
      performedBy: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    }).catch(() => {});
    res.status(201).json({
      ...created,
      duplicate: duplicateOf.length > 0,
      duplicateOf, // other places this EXACT file is already attached
      sameSlipCount: sameSlip.length,
      sameSlip, // same name + size but different bytes (a re-scan of the same slip)
    });
  } catch (e: any) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: e.message });
  }
});

// ---- list for a record --------------------------------------------
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const entityType = String(req.query.entityType || "").trim();
    const entityId = parseInt(req.query.entityId as string, 10);
    if (!entityType || !Number.isFinite(entityId)) {
      return res.status(400).json({ error: "entityType and entityId query params are required" });
    }
    const rows = await db
      .select()
      .from(schema.attachments)
      .where(
        and(
          eq(schema.attachments.entityType, entityType),
          eq(schema.attachments.entityId, entityId),
          eq(schema.attachments.isDeleted, false)
        )
      )
      .orderBy(desc(schema.attachments.createdAt));
    res.json(rows.map((r) => ({ ...r, fileUrl: `/api/attachments/${r.id}/file` })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- stream the bytes -------------------------------------------
router.get("/:id/file", async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db
      .select()
      .from(schema.attachments)
      .where(and(eq(schema.attachments.id, id), eq(schema.attachments.isDeleted, false)))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Attachment not found" });
    const abs = path.join(UPLOADS_DIR, row.diskPath);
    if (!abs.startsWith(UPLOADS_DIR) || !fs.existsSync(abs)) {
      return res.status(404).json({ error: "File missing on disk" });
    }
    if (row.mimeType) res.type(row.mimeType);
    const disp = /^image\//.test(row.mimeType || "") || row.mimeType === "application/pdf" ? "inline" : "attachment";
    res.setHeader("Content-Disposition", `${disp}; filename="${encodeURIComponent(row.fileName)}"`);
    fs.createReadStream(abs).pipe(res);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- edit caption / category ----------------------------------
router.patch("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user?.id };
    if (req.body.caption !== undefined) patch.caption = req.body.caption || null;
    if (req.body.category !== undefined) patch.category = req.body.category || "Receipt";
    const [updated] = await db.update(schema.attachments).set(patch).where(eq(schema.attachments.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Attachment not found" });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- delete --------------------------------------------------
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, id)).limit(1);
    if (!row) return res.status(404).json({ error: "Attachment not found" });
    await db
      .update(schema.attachments)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id })
      .where(eq(schema.attachments.id, id));
    const abs = path.join(UPLOADS_DIR, row.diskPath);
    if (abs.startsWith(UPLOADS_DIR)) fs.unlink(abs, () => {});
    await logAudit({
      action: "DELETE",
      tableName: "attachments",
      recordId: id,
      oldValues: { entityType: row.entityType, entityId: row.entityId, fileName: row.fileName },
      performedBy: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    }).catch(() => {});
    res.json({ message: "Attachment deleted" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
