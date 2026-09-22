/**
 * Quotations ("qaraya nama") — a rate quote sent to a company before there is a
 * job: "we'll carry your goods from A to B at this rate." Same letterhead/logo
 * as an invoice, but it is NOT an accounting document — no ledger, no GL, no
 * AR. It carries a validity window (default 3 days): "is rate ke hum sirf N
 * din ke paband hain."
 *
 *   GET    /api/quotations            list
 *   GET    /api/quotations/:id        one (for the printable document)
 *   POST   /api/quotations            create
 *   PUT    /api/quotations/:id        edit
 *   DELETE /api/quotations/:id        soft delete
 *   POST   /api/quotations/:id/convert-to-invoice   turn an accepted quote into a real invoice
 */
import { Router, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAuth, requireApproved, requirePermission, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { loadCompanyProfile, buildSellerSnapshot, createDetailedInvoice } from "./finance_engine.ts";

const router = Router();
router.use(requireAuth, requireApproved);

const T = schema.quotations;

async function nextQuotationNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const like = `QUO-${year}-%`;
  const [{ mx }] = await db
    .select({ mx: sql<number>`coalesce(max((regexp_replace(${T.quotationNumber}, '^.*-', ''))::int), 0)` })
    .from(T)
    .where(sql`${T.quotationNumber} like ${like}`);
  return `QUO-${year}-${String(Number(mx || 0) + 1).padStart(4, "0")}`;
}

function normLines(input: any[]): { description: string; qty: number; unit: string; rate: number; amount: number }[] {
  const good = (input || []).filter((l) => l && l.description);
  if (!good.length) throw new Error("At least one line (description + rate) is required.");
  return good.map((l) => {
    const qty = Number(l.qty ?? 1) || 1;
    const rate = Math.round(Number(l.rate) || 0);
    const amount = l.amount != null ? Math.round(Number(l.amount)) : Math.round(qty * rate);
    return { description: String(l.description), qty, unit: l.unit || "trip", rate, amount };
  });
}

const audit = (req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", id: number, oldV: unknown, newV: unknown) =>
  logAudit({
    action,
    tableName: "quotations",
    recordId: id,
    oldValues: oldV,
    newValues: newV,
    performedBy: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  }).catch(() => {});

// ---- list -------------------------------------------------------------
router.get("/", requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db
      .select({
        id: T.id,
        quotationNumber: T.quotationNumber,
        quotationDate: T.quotationDate,
        validUntil: T.validUntil,
        status: T.status,
        clientCompany: T.clientCompany,
        routeFrom: T.routeFrom,
        routeTo: T.routeTo,
        totalAmount: T.totalAmount,
        convertedInvoiceId: T.convertedInvoiceId,
        contractorId: T.contractorId,
      })
      .from(T)
      .where(eq(T.isDeleted, false))
      .orderBy(desc(T.quotationDate), desc(T.id));
    const now = Date.now();
    res.json(rows.map((r) => ({ ...r, isExpired: new Date(r.validUntil).getTime() < now && !r.convertedInvoiceId })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- one (printable) ---------------------------------------------------
router.get("/:id(\\d+)", requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(T).where(and(eq(T.id, id), eq(T.isDeleted, false))).limit(1);
    if (!row) return res.status(404).json({ error: "Quotation not found" });
    res.json({ ...row, isExpired: new Date(row.validUntil).getTime() < Date.now() && !row.convertedInvoiceId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- create -------------------------------------------------------------
router.post("/", requirePermission("finance", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.clientCompany && !b.contractorId) return res.status(400).json({ error: "Client company name (or an existing client) is required." });
    const lines = normLines(b.lines);
    const subtotal = lines.reduce((s, l) => s + l.amount, 0);

    let client = {
      clientCompany: b.clientCompany || null,
      clientContactPerson: b.clientContactPerson || null,
      clientPhone: b.clientPhone || null,
      clientEmail: b.clientEmail || null,
      clientAddress: b.clientAddress || null,
    };
    if (b.contractorId) {
      const [c] = await db.select().from(schema.contractors).where(eq(schema.contractors.id, Number(b.contractorId))).limit(1);
      if (c) {
        client = {
          clientCompany: b.clientCompany || c.company,
          clientContactPerson: b.clientContactPerson || c.contactPerson,
          clientPhone: b.clientPhone || c.phone,
          clientEmail: b.clientEmail || c.email,
          clientAddress: b.clientAddress || c.address,
        };
      }
    }

    const quotationDate = b.quotationDate ? new Date(b.quotationDate) : new Date();
    const validityDays = Math.max(1, Number(b.validityDays) || 10);
    const validUntil = new Date(quotationDate.getTime() + validityDays * 86400000);
    const profile = await loadCompanyProfile();

    const [row] = await db
      .insert(T)
      .values({
        quotationNumber: await nextQuotationNumber(),
        quotationDate,
        validityDays,
        validUntil,
        status: "Draft",
        contractorId: b.contractorId ? Number(b.contractorId) : null,
        ...client,
        routeFrom: b.routeFrom || null,
        routeTo: b.routeTo || null,
        cargoDescription: b.cargoDescription || null,
        cargoWeightKg: b.cargoWeightKg ? Math.round(Number(b.cargoWeightKg)) : null,
        vehicleType: b.vehicleType || null,
        rateBasis: b.rateBasis || null,
        linesJson: lines,
        subtotal,
        totalAmount: subtotal,
        notes: b.notes || null,
        sellerSnapshotJson: buildSellerSnapshot(profile),
        createdBy: req.user?.id,
      })
      .returning();
    await audit(req, "CREATE", row.id, null, row);
    res.status(201).json(row);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ---- edit -----------------------------------------------------------
router.put("/:id(\\d+)", requirePermission("finance", "update"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(T).where(and(eq(T.id, id), eq(T.isDeleted, false))).limit(1);
    if (!existing) return res.status(404).json({ error: "Quotation not found" });
    const b = req.body || {};

    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user?.id };
    for (const k of [
      "clientCompany", "clientContactPerson", "clientPhone", "clientEmail", "clientAddress",
      "routeFrom", "routeTo", "cargoDescription", "vehicleType", "rateBasis", "notes", "status",
    ]) {
      if (b[k] !== undefined) patch[k] = b[k] || null;
    }
    if (b.contractorId !== undefined) patch.contractorId = b.contractorId ? Number(b.contractorId) : null;
    if (b.cargoWeightKg !== undefined) patch.cargoWeightKg = b.cargoWeightKg ? Math.round(Number(b.cargoWeightKg)) : null;
    if (b.quotationDate !== undefined) patch.quotationDate = b.quotationDate ? new Date(b.quotationDate) : existing.quotationDate;

    const validityDays = b.validityDays !== undefined ? Math.max(1, Number(b.validityDays) || 10) : existing.validityDays;
    const qDate = (patch.quotationDate as Date) || existing.quotationDate;
    if (b.validityDays !== undefined || b.quotationDate !== undefined) {
      patch.validityDays = validityDays;
      patch.validUntil = new Date(qDate.getTime() + validityDays * 86400000);
    }

    if (Array.isArray(b.lines) && b.lines.length) {
      const lines = normLines(b.lines);
      const subtotal = lines.reduce((s, l) => s + l.amount, 0);
      patch.linesJson = lines;
      patch.subtotal = subtotal;
      patch.totalAmount = subtotal;
    }

    const [updated] = await db.update(T).set(patch).where(eq(T.id, id)).returning();
    await audit(req, "UPDATE", id, existing, updated);
    res.json(updated);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ---- delete (soft) --------------------------------------------------
router.delete("/:id(\\d+)", requirePermission("finance", "update"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await db.select().from(T).where(eq(T.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Quotation not found" });
    await db.update(T).set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(T.id, id));
    await audit(req, "DELETE", id, existing, null);
    res.json({ message: "Deleted" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- convert an accepted quote into a real invoice ----------------------
router.post("/:id(\\d+)/convert-to-invoice", requirePermission("finance", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [q] = await db.select().from(T).where(and(eq(T.id, id), eq(T.isDeleted, false))).limit(1);
    if (!q) return res.status(404).json({ error: "Quotation not found" });
    if (q.convertedInvoiceId) return res.status(400).json({ error: "Already converted to an invoice." });
    if (!q.contractorId) {
      return res.status(400).json({ error: "Link this quotation to a registered client first (contractor), then convert." });
    }
    const lines = (q.linesJson as any[]) || [];
    const inv = await createDetailedInvoice(
      {
        contractorId: q.contractorId,
        lines: lines.map((l) => ({ description: l.description, qty: l.qty, unit: l.unit, rate: l.rate })),
        routeFrom: q.routeFrom || undefined,
        routeTo: q.routeTo || undefined,
        cargoDescription: q.cargoDescription || undefined,
        cargoWeightKg: q.cargoWeightKg || undefined,
        rateBasis: q.rateBasis || undefined,
        notes: `Converted from quotation ${q.quotationNumber}.`,
      },
      { userId: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] },
    );
    const [updated] = await db
      .update(T)
      .set({ convertedInvoiceId: inv.id, status: "Accepted", updatedAt: new Date(), updatedBy: req.user?.id })
      .where(eq(T.id, id))
      .returning();
    await audit(req, "UPDATE", id, q, updated);
    res.status(201).json({ quotation: updated, invoice: inv });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
