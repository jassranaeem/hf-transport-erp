/**
 * Daily Cash Book — itemized cash in/out log, grouped by calendar day
 * (midnight to midnight). A day's opening balance is just the running total
 * of every transaction before that day started, so nothing needs to be
 * manually carried forward each morning — log what came in and what went
 * out, to whom, and the running balance (and each day's close) fall out of
 * that automatically.
 *
 *   GET    /api/cash-book/day?date=YYYY-MM-DD   one day's opening/entries/closing
 *   POST   /api/cash-book                       add an in/out entry
 *   PUT    /api/cash-book/:id                   edit an entry
 *   DELETE /api/cash-book/:id                   soft-delete an entry
 *
 * Mounted at /api/cash-book.
 */
import { Router, Response } from "express";
import { and, asc, eq, lt, gte, lte, sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";

const router = Router();
router.use(requireAuth, requireApproved);

const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];
const DIRECTIONS = ["In", "Out"];

const T = schema.cashTransactions;

const audit = (req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", id: number, oldV: unknown, newV: unknown) =>
  logAudit({
    action,
    tableName: "cash_transactions",
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
  if (b.direction !== undefined) patch.direction = DIRECTIONS.includes(b.direction) ? b.direction : "Out";
  if (b.amount !== undefined) patch.amount = Math.max(0, Math.round(Number(b.amount) || 0));
  if (b.person !== undefined) patch.person = b.person ? String(b.person).trim() : null;
  if (b.description !== undefined) patch.description = b.description ? String(b.description) : null;
  if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes) : null;
  return patch;
}

function dayBounds(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 3600_000);
  return { start, end };
}

router.get("/day", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ""))
      ? String(req.query.date)
      : new Date().toISOString().slice(0, 10);
    const { start, end } = dayBounds(dateStr);

    const [openingRow] = await db
      .select({
        in: sql<number>`coalesce(sum(case when ${T.direction}='In' then ${T.amount} else 0 end),0)::bigint`,
        out: sql<number>`coalesce(sum(case when ${T.direction}='Out' then ${T.amount} else 0 end),0)::bigint`,
      })
      .from(T)
      .where(and(eq(T.isDeleted, false), lt(T.entryDate, start)));
    const openingBalance = Number(openingRow?.in || 0) - Number(openingRow?.out || 0);

    const entries = await db
      .select()
      .from(T)
      .where(and(eq(T.isDeleted, false), gte(T.entryDate, start), lte(T.entryDate, end)))
      .orderBy(asc(T.entryDate), asc(T.id));

    const totalIn = entries.filter((e) => e.direction === "In").reduce((s, e) => s + e.amount, 0);
    const totalOut = entries.filter((e) => e.direction === "Out").reduce((s, e) => s + e.amount, 0);

    res.json({
      date: dateStr,
      openingBalance,
      entries,
      totalIn,
      totalOut,
      closingBalance: openingBalance + totalIn - totalOut,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const patch = coerce(req.body || {});
    if (!patch.amount) return res.status(400).json({ error: "Amount is required" });
    if (patch.direction === undefined) patch.direction = "Out";
    if (patch.entryDate === undefined) patch.entryDate = new Date();
    const [row] = await db.insert(T).values({ ...patch, createdBy: req.user?.id } as any).returning();
    await audit(req, "CREATE", row.id, null, row);
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(T).where(eq(T.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Entry not found" });
    const patch = coerce(req.body || {});
    const [row] = await db
      .update(T)
      .set({ ...patch, updatedAt: new Date(), updatedBy: req.user?.id })
      .where(eq(T.id, id))
      .returning();
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
    if (!old) return res.status(404).json({ error: "Entry not found" });
    await db
      .update(T)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id })
      .where(eq(T.id, id));
    await audit(req, "DELETE", id, old, null);
    res.json({ message: "Entry deleted" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export const cashBookRouter = router;
