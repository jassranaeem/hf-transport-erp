/**
 * Zakat register — a standalone book, deliberately separate from both the
 * business Parties/Khata and Personal & Household Expenses. You record here
 * what you actually gave, when, to whom. The Yearly Report's 2.5%-of-wealth
 * figure is only an ESTIMATE to check against — this table is the real record.
 *
 *   GET    /api/zakat                     list (filters: from,to,q,limit,offset)
 *   POST   /api/zakat                     create
 *   PUT    /api/zakat/:id                 edit
 *   DELETE /api/zakat/:id                 soft-delete
 *   GET    /api/zakat/summary?month=YYYY-MM        one-month total
 *   GET    /api/zakat/summary/year?year=YYYY       year total + month-by-month
 *
 * Mounted at /api/zakat.
 */
import { Router, Response } from "express";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";

const router = Router();
router.use(requireAuth, requireApproved);

const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];
const METHODS = ["Cash", "Bank", "Card", "Online", "Cheque"];

const T = schema.zakatPayments;

const audit = (req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", id: number, oldV: unknown, newV: unknown) =>
  logAudit({
    action,
    tableName: "zakat_payments",
    recordId: id,
    oldValues: oldV,
    newValues: newV,
    performedBy: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  }).catch(() => {});

function coerce(b: any): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (b.entryDate !== undefined) patch.entryDate = b.entryDate ? new Date(b.entryDate) : new Date();
  if (b.amount !== undefined) patch.amount = Math.max(0, Math.round(Number(b.amount) || 0));
  if (b.recipient !== undefined) patch.recipient = b.recipient ? String(b.recipient).trim() : null;
  if (b.description !== undefined) patch.description = b.description ? String(b.description) : null;
  if (b.method !== undefined) patch.method = METHODS.includes(b.method) ? b.method : "Cash";
  if (b.bankAccountId !== undefined) patch.bankAccountId = b.bankAccountId ? Number(b.bankAccountId) : null;
  if (b.refNo !== undefined) patch.refNo = b.refNo ? String(b.refNo) : null;
  if (b.paidBy !== undefined) patch.paidBy = b.paidBy ? String(b.paidBy) : null;
  if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes) : null;
  return patch;
}

router.get("/", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const limit = Math.min(500, parseInt(q.limit || "200"));
    const offset = Math.max(0, parseInt(q.offset || "0"));
    const cond = [eq(T.isDeleted, false)];
    if (q.from) cond.push(gte(T.entryDate, new Date(q.from)));
    if (q.to) cond.push(lte(T.entryDate, new Date(new Date(q.to).getTime() + 24 * 3600_000 - 1)));
    if (q.q?.trim()) {
      const s = `%${q.q.trim()}%`;
      cond.push(or(ilike(T.description, s), ilike(T.recipient, s), ilike(T.refNo, s))!);
    }
    const [rows, [tot]] = await Promise.all([
      db.select().from(T).where(and(...cond)).orderBy(desc(T.entryDate), desc(T.id)).limit(limit).offset(offset),
      db.select({ n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${T.amount}),0)::bigint` }).from(T).where(and(...cond)),
    ]);
    res.json({ rows, total: tot?.n || 0, totalAmount: Number(tot?.sum || 0) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/summary/year", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const year = /^\d{4}$/.test(String(req.query.year || "")) ? Number(req.query.year) : new Date().getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);
    const rows = await db
      .select({
        month: sql<string>`to_char(${T.entryDate}, 'YYYY-MM')`,
        total: sql<number>`coalesce(sum(${T.amount}),0)::bigint`,
        count: sql<number>`count(*)::int`,
      })
      .from(T)
      .where(and(eq(T.isDeleted, false), gte(T.entryDate, start), lte(T.entryDate, end)))
      .groupBy(sql`to_char(${T.entryDate}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${T.entryDate}, 'YYYY-MM')`);
    const total = rows.reduce((s, r) => s + Number(r.total), 0);
    const count = rows.reduce((s, r) => s + r.count, 0);
    res.json({ year, total, count, months: rows.map((r) => ({ month: r.month, total: Number(r.total), count: r.count })) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const patch = coerce(req.body || {});
    if (!patch.amount) return res.status(400).json({ error: "Amount is required" });
    if (patch.entryDate === undefined) patch.entryDate = new Date();
    const [row] = await db.insert(T).values({ ...(patch as any), createdBy: req.user?.id }).returning();
    await audit(req, "CREATE", row.id, null, row);
    res.status(201).json(row);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(T).where(eq(T.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Not found" });
    const patch = coerce(req.body || {});
    patch.updatedAt = new Date();
    patch.updatedBy = req.user?.id;
    const [row] = await db.update(T).set(patch).where(eq(T.id, id)).returning();
    await audit(req, "UPDATE", id, old, row);
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(T).where(eq(T.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Not found" });
    await db.update(T).set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(T.id, id));
    await audit(req, "DELETE", id, old, null);
    res.json({ message: "Deleted" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
