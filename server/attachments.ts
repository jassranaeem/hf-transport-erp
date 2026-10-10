/**
 * Universal attachments — real file uploads linked to any record in any
 * module (receipts, proofs, scanned bilties, POD, etc.).
 *
 * Mounted at /api/attachments. Files are written to disk under ./uploads and
 * streamed back through an authenticated route (never served statically).
 *
 *   POST   /api/attachments            multipart: file + entityType + entityId [+ caption, category]
 *   GET    /api/attachments?entityType=&entityId=[&linked=1]   (linked: also the receipts of the same money's other records)
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
  "party", "party_ledger_entry", "company_profile", "bank_account", "document", "cash_transaction", "personal_expenses",
]);

// ---------------------------------------------------------------------------------------------
// One payment is often written in more than one place: a Cash Book entry writes the truck's khata
// row (or the party's, or the household's); money given on a trip is a khata row of that trip. A
// receipt attached to any of them belongs to all of them — so it is shown on each, and attaching
// the same file again inside that family is not a "duplicate slip".
// ---------------------------------------------------------------------------------------------
type Rec = { entityType: string; entityId: number; label: string };
const rawRows = async (q: any) => ((await db.execute(q)) as any).rows as any[];
const day = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "");

async function tripLegs(tripId: number): Promise<any[]> {
  return rawRows(sql`with r as (select coalesce(parent_trip_id, id) root from trips where id = ${tripId})
    select t.id, t.trip_number, t.leg_no from trips t, r where not t.is_deleted and (t.id = r.root or t.parent_trip_id = r.root) order by t.leg_no nulls first, t.id`);
}

export async function linkedRecords(entityType: string, entityId: number): Promise<Rec[]> {
  const out: Rec[] = [];
  const add = (r: Rec) => {
    if (!(r.entityType === entityType && r.entityId === entityId) && !out.some((x) => x.entityType === r.entityType && x.entityId === r.entityId)) out.push(r);
  };
  const addTrip = async (tripId: number) => {
    for (const l of await tripLegs(tripId)) add({ entityType: "trip", entityId: l.id, label: `Trip ${l.trip_number}${l.leg_no > 1 ? ` (stop ${l.leg_no})` : ""}` });
  };
  if (entityType === "truck_ledger_entry") {
    const [e] = await rawRows(sql`select derived_trip_id, paid_from_entry_id from truck_ledger_entries where id = ${entityId}`);
    for (const c of await rawRows(sql`select id, entry_date from cash_transactions where derived_entry_id = ${entityId} and link_type = 'truck' and not is_deleted`))
      add({ entityType: "cash_transaction", entityId: c.id, label: `Cash Book ${day(c.entry_date)}` });
    if (e?.derived_trip_id) await addTrip(e.derived_trip_id);
  } else if (entityType === "party_ledger_entry") {
    for (const c of await rawRows(sql`select id, entry_date from cash_transactions where derived_entry_id = ${entityId} and link_type = 'party' and not is_deleted`))
      add({ entityType: "cash_transaction", entityId: c.id, label: `Cash Book ${day(c.entry_date)}` });
  } else if (entityType === "personal_expenses") {
    for (const c of await rawRows(sql`select id, entry_date from cash_transactions where derived_entry_id = ${entityId} and link_type = 'personal' and not is_deleted`))
      add({ entityType: "cash_transaction", entityId: c.id, label: `Cash Book ${day(c.entry_date)}` });
  } else if (entityType === "cash_transaction") {
    const [c] = await rawRows(sql`select link_type, derived_entry_id from cash_transactions where id = ${entityId}`);
    if (c?.derived_entry_id) {
      if (c.link_type === "truck") {
        const [t] = await rawRows(sql`select e.id, e.derived_trip_id, l.registration from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id where e.id = ${c.derived_entry_id}`);
        if (t) {
          add({ entityType: "truck_ledger_entry", entityId: t.id, label: `Truck khata ${t.registration}` });
          if (t.derived_trip_id) await addTrip(t.derived_trip_id);
        }
      } else if (c.link_type === "party") {
        const [p] = await rawRows(sql`select e.id, p.name from party_ledger_entries e join parties p on p.id = e.party_id where e.id = ${c.derived_entry_id}`);
        if (p) add({ entityType: "party_ledger_entry", entityId: p.id, label: `Party ledger ${p.name}` });
      } else if (c.link_type === "personal") add({ entityType: "personal_expenses", entityId: c.derived_entry_id, label: "Personal & Household" });
    }
  } else if (entityType === "trip") {
    const legs = await tripLegs(entityId);
    await addTrip(entityId);
    if (legs.length) {
      const ids = legs.map((l) => l.id);
      for (const e of await rawRows(sql`select e.id, e.category, e.paid, e.received, e.description from truck_ledger_entries e
          where not e.is_deleted and e.derived_trip_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)) {
        add({ entityType: "truck_ledger_entry", entityId: e.id, label: `${e.category === "TripCash" ? "Cash to driver" : e.category} PKR ${Number(e.paid || e.received).toLocaleString()}${e.description ? ` · ${String(e.description).slice(0, 40)}` : ""}` });
        for (const c of await rawRows(sql`select id, entry_date from cash_transactions where derived_entry_id = ${e.id} and link_type = 'truck' and not is_deleted`))
          add({ entityType: "cash_transaction", entityId: c.id, label: `Cash Book ${day(c.entry_date)}` });
      }
    }
  }
  return out;
}

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

    // the same file already on this record or on the same money's other records: nothing new is
    // stored — it already shows here (not a duplicate slip)
    if (sha256) {
      const family = [{ entityType, entityId }, ...(await linkedRecords(entityType, entityId).catch(() => []))];
      const here = await db
        .select({ id: schema.attachments.id, entityType: schema.attachments.entityType, entityId: schema.attachments.entityId, fileName: schema.attachments.fileName })
        .from(schema.attachments)
        .where(
          and(
            eq(schema.attachments.sha256, sha256),
            eq(schema.attachments.isDeleted, false),
            sql`(${sql.join(family.map((f) => sql`(${schema.attachments.entityType} = ${f.entityType} and ${schema.attachments.entityId} = ${f.entityId})`), sql` or `)})`,
          ),
        )
        .limit(1);
      if (here.length) {
        fs.unlink(req.file.path, () => {});
        return res.status(200).json({ alreadyThere: true, existing: here[0] });
      }
    }

    // duplicate warning: same bytes already attached anywhere else (not blocked, just reported)
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
    // keep the bytes in Postgres so they survive redeploys, then drop the temp disk copy
    await db.insert(schema.attachmentBlobs).values({ attachmentId: created.id, data: fs.readFileSync(req.file.path) });
    fs.unlink(req.file.path, () => {});
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
    const own = rows.map((r) => ({ ...r, fileUrl: `/api/attachments/${r.id}/file` }));
    if (req.query.linked !== "1") return res.json(own);
    // the receipts of the same money's other records (Cash Book ↔ khata ↔ trip)
    const family = await linkedRecords(entityType, entityId).catch(() => []);
    const seen = new Set(own.map((r) => r.sha256).filter(Boolean));
    const linked: any[] = [];
    if (family.length) {
      const more = await db
        .select()
        .from(schema.attachments)
        .where(
          and(
            eq(schema.attachments.isDeleted, false),
            sql`(${sql.join(family.map((f) => sql`(${schema.attachments.entityType} = ${f.entityType} and ${schema.attachments.entityId} = ${f.entityId})`), sql` or `)})`,
          ),
        )
        .orderBy(desc(schema.attachments.createdAt));
      for (const r of more) {
        if (r.sha256 && seen.has(r.sha256)) continue;
        if (r.sha256) seen.add(r.sha256);
        const f = family.find((x) => x.entityType === r.entityType && x.entityId === r.entityId);
        linked.push({ ...r, fileUrl: `/api/attachments/${r.id}/file`, linkedFrom: f?.label || r.entityType });
      }
    }
    res.json([...own, ...linked]);
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
    const [blob] = await db.select().from(schema.attachmentBlobs).where(eq(schema.attachmentBlobs.attachmentId, id)).limit(1);
    const abs = path.join(UPLOADS_DIR, row.diskPath);
    if (!blob && (!abs.startsWith(UPLOADS_DIR) || !fs.existsSync(abs))) {
      return res.status(404).json({ error: "File is missing (it was uploaded before files were stored in the database)" });
    }
    if (row.mimeType) res.type(row.mimeType);
    const disp = /^image\//.test(row.mimeType || "") || row.mimeType === "application/pdf" ? "inline" : "attachment";
    res.setHeader("Content-Disposition", `${disp}; filename="${encodeURIComponent(row.fileName)}"`);
    if (blob) return void res.end(blob.data);
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
    await db.delete(schema.attachmentBlobs).where(eq(schema.attachmentBlobs.attachmentId, id));
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
