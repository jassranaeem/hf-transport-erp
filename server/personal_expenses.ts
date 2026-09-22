/**
 * Personal / Household expenses — the owner's personal book, deliberately kept
 * OUT of the business (truck) P&L.
 *
 *   GET    /api/personal-expenses            list (filters: from,to,category,person,direction,q,limit,offset)
 *   POST   /api/personal-expenses            create
 *   PUT    /api/personal-expenses/:id        edit
 *   DELETE /api/personal-expenses/:id        soft-delete
 *   GET    /api/personal-expenses/summary?month=YYYY-MM   one-month roll-up
 *   GET    /api/personal-expenses/summary/range?from=YYYY-MM&to=YYYY-MM  per-month trend
 *   GET    /api/personal-expenses/meta       category / method / person option lists
 *
 * Mounted at /api/personal-expenses.
 */
import { Router, Response } from "express";
import { and, desc, eq, gte, ilike, lt, lte, or, sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";

const router = Router();
router.use(requireAuth, requireApproved);

const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];

export const PERSONAL_CATEGORIES = [
  "Household",
  "PocketMoney",
  "Personal",
  "Groceries",
  "Utilities",
  "Rent",
  "Medical",
  "Education",
  "Travel",
  "Gift",
  "Charity",
  "Domestic Staff",
  "Vehicle (personal)",
  "Entertainment",
  "Funds In",
  "Other",
];
const METHODS = ["Cash", "Bank", "Card", "Online", "Cheque"];

const T = schema.personalExpenses;

const audit = (req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", id: number, oldV: unknown, newV: unknown) =>
  logAudit({
    action,
    tableName: "personal_expenses",
    recordId: id,
    oldValues: oldV,
    newValues: newV,
    performedBy: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  }).catch(() => {});

function monthBounds(month: string): { start: Date; end: Date; label: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month || "");
  const now = new Date();
  const y = m ? Number(m[1]) : now.getFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getMonth();
  return {
    start: new Date(y, mo, 1),
    end: new Date(y, mo + 1, 1),
    label: `${y}-${String(mo + 1).padStart(2, "0")}`,
  };
}

/** normalize a create/update body into a column patch */
function coerce(b: any): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (b.entryDate !== undefined) patch.entryDate = b.entryDate ? new Date(b.entryDate) : new Date();
  if (b.category !== undefined) patch.category = String(b.category || "Other");
  if (b.direction !== undefined) patch.direction = b.direction === "income" ? "income" : "expense";
  if (b.person !== undefined) patch.person = b.person ? String(b.person).trim() : null;
  if (b.description !== undefined) patch.description = b.description ? String(b.description) : null;
  if (b.payee !== undefined) patch.payee = b.payee ? String(b.payee) : null;
  if (b.amount !== undefined) patch.amount = Math.max(0, Math.round(Number(b.amount) || 0));
  if (b.method !== undefined) patch.method = METHODS.includes(b.method) ? b.method : "Cash";
  if (b.bankAccountId !== undefined) patch.bankAccountId = b.bankAccountId ? Number(b.bankAccountId) : null;
  if (b.refNo !== undefined) patch.refNo = b.refNo ? String(b.refNo) : null;
  if (b.paidBy !== undefined) patch.paidBy = b.paidBy ? String(b.paidBy) : null;
  if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes) : null;
  return patch;
}

// ---- option lists -------------------------------------------------------
router.get("/meta", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  const people = await db
    .selectDistinct({ person: T.person })
    .from(T)
    .where(and(eq(T.isDeleted, false), sql`${T.person} is not null and ${T.person} <> ''`));
  res.json({
    categories: PERSONAL_CATEGORIES,
    methods: METHODS,
    people: people.map((r) => r.person).filter(Boolean).sort(),
  });
});

// ---- list -------------------------------------------------------------
router.get("/", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const limit = Math.min(500, parseInt(q.limit || "200"));
    const offset = Math.max(0, parseInt(q.offset || "0"));
    const cond = [eq(T.isDeleted, false)];
    if (q.from) cond.push(gte(T.entryDate, new Date(q.from)));
    if (q.to) cond.push(lte(T.entryDate, new Date(new Date(q.to).getTime() + 24 * 3600_000 - 1)));
    if (q.category) cond.push(eq(T.category, q.category));
    if (q.person) cond.push(eq(T.person, q.person));
    if (q.direction) cond.push(eq(T.direction, q.direction === "income" ? "income" : "expense"));
    if (q.q?.trim()) {
      const s = `%${q.q.trim()}%`;
      cond.push(or(ilike(T.description, s), ilike(T.payee, s), ilike(T.person, s), ilike(T.refNo, s))!);
    }

    const [rows, [tot]] = await Promise.all([
      db.select().from(T).where(and(...cond)).orderBy(desc(T.entryDate), desc(T.id)).limit(limit).offset(offset),
      db.select({ n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(case when ${T.direction}='expense' then ${T.amount} else -${T.amount} end),0)::bigint` }).from(T).where(and(...cond)),
    ]);
    res.json({ rows, total: tot?.n || 0, netSpend: Number(tot?.sum || 0) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- one-month roll-up ---------------------------------------------------
async function summary(month: string) {
  const { start, end, label } = monthBounds(month);
  const win = and(eq(T.isDeleted, false), gte(T.entryDate, start), lt(T.entryDate, end));

  const byCat = await db
    .select({
      category: T.category,
      expense: sql<number>`coalesce(sum(case when ${T.direction}='expense' then ${T.amount} else 0 end),0)::bigint`,
      income: sql<number>`coalesce(sum(case when ${T.direction}='income' then ${T.amount} else 0 end),0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(T)
    .where(win)
    .groupBy(T.category)
    .orderBy(sql`sum(case when ${T.direction}='expense' then ${T.amount} else 0 end) desc`);

  const byPerson = await db
    .select({
      person: T.person,
      spend: sql<number>`coalesce(sum(case when ${T.direction}='expense' then ${T.amount} else 0 end),0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(T)
    .where(and(win, sql`${T.person} is not null and ${T.person} <> ''`))
    .groupBy(T.person)
    .orderBy(sql`sum(case when ${T.direction}='expense' then ${T.amount} else 0 end) desc`);

  const byMethod = await db
    .select({
      method: T.method,
      spend: sql<number>`coalesce(sum(case when ${T.direction}='expense' then ${T.amount} else 0 end),0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(T)
    .where(win)
    .groupBy(T.method)
    .orderBy(sql`sum(case when ${T.direction}='expense' then ${T.amount} else 0 end) desc`);

  const totalExpense = byCat.reduce((s, c) => s + Number(c.expense), 0);
  const totalIncome = byCat.reduce((s, c) => s + Number(c.income), 0);
  const entries = byCat.reduce((s, c) => s + c.count, 0);
  const pocketMoney = Number(byCat.find((c) => c.category === "PocketMoney")?.expense || 0);

  return {
    month: label,
    totals: {
      expense: totalExpense,
      income: totalIncome,
      net: totalExpense - totalIncome, // net cash spent from the personal pot
      pocketMoney,
      entries,
    },
    byCategory: byCat.map((c) => ({
      category: c.category,
      expense: Number(c.expense),
      income: Number(c.income),
      net: Number(c.expense) - Number(c.income),
      count: c.count,
    })),
    byPerson: byPerson.map((p) => ({ person: p.person, spend: Number(p.spend), count: p.count })),
    byMethod: byMethod.map((m) => ({ method: m.method, spend: Number(m.spend), count: m.count })),
    note:
      "Personal book — this is NOT part of any truck / business profit & loss. · یہ ذاتی کھاتہ ہے، کاروباری منافع و نقصان سے الگ۔",
  };
}

router.get("/summary", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    res.json(await summary(String(req.query.month || "")));
  } catch (e: any) {
    console.error("[personal-expenses] summary failed:", e);
    res.status(500).json({ error: e.message });
  }
});

router.get("/summary/range", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const from = monthBounds(String(req.query.from || ""));
    const to = monthBounds(String(req.query.to || ""));
    const out = [];
    const cur = new Date(from.start);
    let guard = 0;
    while (cur <= to.start && guard++ < 36) {
      const m = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
      const r = await summary(m);
      out.push({ month: r.month, ...r.totals });
      cur.setMonth(cur.getMonth() + 1);
    }
    res.json({ months: out });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- create -----------------------------------------------------------
router.post("/", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const patch = coerce(req.body || {});
    if (patch.amount === undefined || !patch.amount) return res.status(400).json({ error: "Amount is required" });
    if (patch.entryDate === undefined) patch.entryDate = new Date();
    const [row] = await db
      .insert(T)
      .values({ ...(patch as any), createdBy: req.user?.id })
      .returning();
    await audit(req, "CREATE", row.id, null, row);
    res.status(201).json(row);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- edit -----------------------------------------------------------
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

// ---- delete (soft) --------------------------------------------------
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
