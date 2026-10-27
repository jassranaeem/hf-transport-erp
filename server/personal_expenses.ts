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
 *   GET    /api/personal-expenses/categories           the categories (ledgers) with their entry counts
 *   POST   /api/personal-expenses/categories           { name, nameUr }   make a new ledger
 *   PUT    /api/personal-expenses/categories/:id       { name, nameUr }   rename (every entry follows) / Urdu name
 *   DELETE /api/personal-expenses/categories/:id[?moveTo=Name]   remove an empty one (or move its entries first)
 *   GET    /api/personal-expenses/ledgers?from=&to=      one ledger per category, per person, and the house pot
 *   GET    /api/personal-expenses/ledger?kind=category|person|pot&name=&from=&to=   one ledger with running balance
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

const CAT_UR_STD: Record<string, string> = {
  Household: "گھر کا خرچہ", PocketMoney: "جیب خرچ", Personal: "ذاتی", Groceries: "راشن", Utilities: "بجلی/گیس/پانی", Rent: "کرایہ", Medical: "علاج",
  Education: "تعلیم", Travel: "سفر", Gift: "تحفہ", Charity: "خیرات", "Domestic Staff": "ملازمین", "Vehicle (personal)": "ذاتی گاڑی",
  Entertainment: "تفریح", "Funds In": "رقم جمع", Other: "دیگر",
};
// the rest of the system leans on these names (default category, the pocket-money card, funds in, the fallback)
const PROTECTED = new Set(["Household", "PocketMoney", "Funds In", "Other"]);

const T = schema.personalExpenses;
const C = schema.personalCategories;

/** The categories, seeded with the standard ones and with any name already used on an entry (first use / imports). */
async function ensureCategories() {
  const have = await db.select().from(C);
  const known = new Set(have.map((c) => c.name.toLowerCase()));
  const used = await db.selectDistinct({ category: T.category }).from(T).where(eq(T.isDeleted, false));
  const add: Array<{ name: string; nameUr: string | null }> = [];
  for (const n of PERSONAL_CATEGORIES) if (!known.has(n.toLowerCase())) add.push({ name: n, nameUr: CAT_UR_STD[n] || null });
  for (const u of used) {
    const n = (u.category || "").trim();
    if (n && !known.has(n.toLowerCase()) && !add.find((a) => a.name.toLowerCase() === n.toLowerCase())) add.push({ name: n, nameUr: CAT_UR_STD[n] || null });
  }
  if (add.length) await db.insert(C).values(add).onConflictDoNothing();
  const rows = await db.select().from(C).where(eq(C.isDeleted, false)).orderBy(C.id);
  // a deleted category whose name is on a live entry again comes back (e.g. an import brought it)
  return rows;
}

/** How many files are attached to each entry (receipts, slips, photos) — one query for a whole page. */
async function attachmentCounts(ids: number[]): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const A = schema.attachments;
  const r = await db
    .select({ id: A.entityId, n: sql<number>`count(*)::int` })
    .from(A)
    .where(and(eq(A.entityType, "personal_expenses"), eq(A.isDeleted, false), sql`${A.entityId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`))
    .groupBy(A.entityId);
  return new Map(r.map((x) => [x.id, x.n]));
}

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
/** Categories with how many entries each holds. */
async function categoryDetails() {
  const cats = await ensureCategories();
  const counts = await db.select({ name: T.category, n: sql<number>`count(*)::int` }).from(T).where(eq(T.isDeleted, false)).groupBy(T.category);
  const byName = new Map(counts.map((c) => [c.name, c.n]));
  return cats.map((c) => ({ id: c.id, name: c.name, nameUr: c.nameUr, count: byName.get(c.name) || 0, protected: PROTECTED.has(c.name) }));
}

router.get("/categories", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ categories: await categoryDetails() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

const catName = (v: any) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

router.post("/categories", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const name = catName(req.body?.name);
    const nameUr = String(req.body?.nameUr || "").trim().slice(0, 60) || null;
    if (!name) return res.status(400).json({ error: "Write the name of the ledger · کھاتے کا نام لکھیں" });
    await ensureCategories();
    const [same] = await db.select().from(C).where(sql`lower(${C.name}) = ${name.toLowerCase()}`).limit(1);
    if (same && !same.isDeleted) return res.status(400).json({ error: `There is already a ledger called "${same.name}" · اس نام کا کھاتہ پہلے سے ہے` });
    const [row] = same
      ? await db.update(C).set({ isDeleted: false, name, nameUr, updatedAt: new Date() }).where(eq(C.id, same.id)).returning()
      : await db.insert(C).values({ name, nameUr, createdBy: req.user?.id }).returning();
    await logAudit({ action: "CREATE", tableName: "personal_categories", recordId: row.id, newValues: row, performedBy: req.user?.id, ipAddress: req.ip }).catch(() => {});
    res.status(201).json(row);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/categories/:id(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(C).where(and(eq(C.id, id), eq(C.isDeleted, false))).limit(1);
    if (!old) return res.status(404).json({ error: "Ledger not found" });
    const name = req.body?.name !== undefined ? catName(req.body.name) : old.name;
    const nameUr = req.body?.nameUr !== undefined ? String(req.body.nameUr || "").trim().slice(0, 60) || null : old.nameUr;
    if (!name) return res.status(400).json({ error: "Write the name of the ledger · کھاتے کا نام لکھیں" });
    let moved = 0;
    if (name !== old.name) {
      if (PROTECTED.has(old.name)) return res.status(400).json({ error: `"${old.name}" is used by the rest of the system — its name cannot change (you can still change its Urdu name) · اس کا نام نہیں بدل سکتا` });
      const [clash] = await db.select().from(C).where(and(sql`lower(${C.name}) = ${name.toLowerCase()}`, sql`${C.id} <> ${id}`)).limit(1);
      if (clash) return res.status(400).json({ error: `There is already a ledger called "${clash.name}"${clash.isDeleted ? " (removed earlier — make it again from New ledger)" : ""} · اس نام کا کھاتہ پہلے سے ہے` });
    }
    const row = await db.transaction(async (tx) => {
      if (name !== old.name) {
        // every entry of the ledger (deleted ones too, so a restored entry is not orphaned) follows the new name
        const r = await tx.update(T).set({ category: name }).where(eq(T.category, old.name)).returning({ id: T.id });
        moved = r.length;
      }
      const [u] = await tx.update(C).set({ name, nameUr, updatedAt: new Date() }).where(eq(C.id, id)).returning();
      return u;
    });
    await logAudit({ action: "UPDATE", tableName: "personal_categories", recordId: id, oldValues: old, newValues: { ...row, entriesRenamed: moved }, performedBy: req.user?.id, ipAddress: req.ip }).catch(() => {});
    res.json({ ...row, entriesRenamed: moved });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/categories/:id(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(C).where(and(eq(C.id, id), eq(C.isDeleted, false))).limit(1);
    if (!old) return res.status(404).json({ error: "Ledger not found" });
    if (PROTECTED.has(old.name)) return res.status(400).json({ error: `"${old.name}" is used by the rest of the system and cannot be removed · یہ کھاتہ ہٹایا نہیں جا سکتا` });
    const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(T).where(and(eq(T.category, old.name), eq(T.isDeleted, false)));
    const moveTo = catName(req.query.moveTo);
    if (cnt.n > 0 && !moveTo) return res.status(400).json({ error: `It holds ${cnt.n} entr${cnt.n === 1 ? "y" : "ies"} — choose where to move ${cnt.n === 1 ? "it" : "them"} first · اس میں ${cnt.n} اندراج ہیں، پہلے انہیں کسی اور کھاتے میں منتقل کریں` });
    let moved = 0;
    await db.transaction(async (tx) => {
      if (cnt.n > 0) {
        const [target] = await tx.select().from(C).where(and(sql`lower(${C.name}) = ${moveTo.toLowerCase()}`, eq(C.isDeleted, false), sql`${C.id} <> ${id}`)).limit(1);
        if (!target) throw new Error(`There is no ledger "${moveTo}" to move them to`);
        const r = await tx.update(T).set({ category: target.name }).where(eq(T.category, old.name)).returning({ id: T.id });
        moved = r.length;
      }
      await tx.update(C).set({ isDeleted: true, updatedAt: new Date() }).where(eq(C.id, id));
    });
    await logAudit({ action: "DELETE", tableName: "personal_categories", recordId: id, oldValues: { ...old, entriesMovedTo: moveTo || null, moved }, performedBy: req.user?.id, ipAddress: req.ip }).catch(() => {});
    res.json({ deleted: 1, moved });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/meta", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  const people = await db
    .selectDistinct({ person: T.person })
    .from(T)
    .where(and(eq(T.isDeleted, false), sql`${T.person} is not null and ${T.person} <> ''`));
  const details = await categoryDetails();
  res.json({
    categories: details.map((c) => c.name),
    categoryDetails: details,
    methods: METHODS,
    people: people.map((r) => r.person).filter(Boolean).sort(),
  });
});

// ---- ledgers: every category (and every person) is a ledger made from the entries ----------
// Nothing is stored twice: an entry typed once appears in its category's ledger, in its person's
// ledger (when a person is named) and in the house pot, because the ledgers are read from the entries.
const net = sql`case when ${T.direction} = 'expense' then ${T.amount} else -${T.amount} end`;
const day = (s: any, fallback: string | null = null) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback);

router.get("/ledgers", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const from = day(req.query.from);
    const to = day(req.query.to);
    const before = from ? sql`${T.entryDate} < ${from}::timestamp` : sql`false`; // a day string, not a JS Date: the entries hold their day at 00:00
    const cols = {
      opening: sql<number>`coalesce(sum(case when ${before} then ${net} else 0 end), 0)::bigint`,
      spent: sql<number>`coalesce(sum(case when ${before} then 0 when ${T.direction} = 'expense' then ${T.amount} else 0 end), 0)::bigint`,
      funds: sql<number>`coalesce(sum(case when ${before} then 0 when ${T.direction} = 'income' then ${T.amount} else 0 end), 0)::bigint`,
      count: sql<number>`count(*) filter (where not (${before}))::int`,
      last: sql<string>`to_char(max(${T.entryDate}), 'YYYY-MM-DD')`,
    };
    const live = and(eq(T.isDeleted, false), to ? lte(T.entryDate, new Date(new Date(to).getTime() + 24 * 3600_000 - 1)) : undefined);
    const [cats, people, [pot]] = await Promise.all([
      db.select({ name: T.category, ...cols }).from(T).where(live).groupBy(T.category),
      db.select({ name: T.person, ...cols }).from(T).where(and(live, sql`${T.person} is not null and ${T.person} <> ''`)).groupBy(T.person),
      db.select({ ...cols }).from(T).where(live),
    ]);
    const shape = (r: any) => ({ name: r.name, opening: Number(r.opening), spent: Number(r.spent), funds: Number(r.funds), closing: Number(r.opening) + Number(r.spent) - Number(r.funds), count: r.count, last: r.last });
    const made = await ensureCategories();
    const order = new Map(made.map((c, i) => [c.name, i]));
    // only the ledgers that exist (a removed one is gone); each shows even before its first entry
    const catRows = cats.map(shape).filter((r) => order.has(r.name));
    for (const c of made) if (!catRows.find((r) => r.name === c.name)) catRows.push({ name: c.name, opening: 0, spent: 0, funds: 0, closing: 0, count: 0, last: null as any });
    catRows.sort((a, b) => (order.get(a.name) ?? 999) - (order.get(b.name) ?? 999));
    const p = shape({ name: "House pot", ...pot });
    res.json({
      categories: catRows,
      people: people.map(shape).sort((a, b) => b.spent - a.spent),
      // the house pot: money put in less money spent — what is left in the household's hands
      pot: { ...p, opening: -p.opening, closing: -p.closing },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/ledger", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const kind = ["category", "person", "pot"].includes(String(req.query.kind)) ? String(req.query.kind) : "category";
    const name = String(req.query.name || "");
    const from = day(req.query.from);
    const to = day(req.query.to);
    const who = kind === "category" ? eq(T.category, name) : kind === "person" ? eq(T.person, name) : undefined;
    if (kind !== "pot" && !name) return res.status(400).json({ error: "Which ledger? · کونسا کھاتہ؟" });
    const sign = kind === "pot" ? -1 : 1; // pot: funds in raise it, spending lowers it
    const base = and(eq(T.isDeleted, false), who);
    const [openRow] = from
      ? await db.select({ v: sql<number>`coalesce(sum(${net}), 0)::bigint` }).from(T).where(and(base, lt(T.entryDate, new Date(from))))
      : [{ v: 0 }];
    const list = await db
      .select()
      .from(T)
      .where(and(base, from ? gte(T.entryDate, new Date(from)) : undefined, to ? lte(T.entryDate, new Date(new Date(to).getTime() + 24 * 3600_000 - 1)) : undefined))
      .orderBy(T.entryDate, T.id)
      .limit(5000);
    const counts = await attachmentCounts(list.map((r) => r.id));
    const opening = sign * Number(openRow?.v || 0);
    let running = opening;
    let spent = 0;
    let funds = 0;
    const rows = list.map((r) => {
      const isIn = r.direction === "income";
      if (isIn) funds += r.amount;
      else spent += r.amount;
      running += sign * (isIn ? -r.amount : r.amount);
      return { ...r, attachments: counts.get(r.id) || 0, running };
    });
    res.json({
      kind,
      name: kind === "pot" ? "House pot" : name,
      balanceLabel: kind === "pot" ? "Left in the pot · پاٹ میں باقی" : "Spent, net of funds in · خرچ (رقم جمع نکال کر)",
      opening,
      spent,
      funds,
      closing: running,
      count: rows.length,
      truncated: list.length >= 5000,
      rows,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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
    const counts = await attachmentCounts(rows.map((r) => r.id));
    res.json({ rows: rows.map((r) => ({ ...r, attachments: counts.get(r.id) || 0 })), total: tot?.n || 0, netSpend: Number(tot?.sum || 0) });
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
    if (patch.amount === undefined || !patch.amount) return res.status(400).json({ error: "Amount is required · رقم درج کریں" });
    if (!String(patch.description || "").trim()) return res.status(400).json({ error: "Write what it was for (description) · تفصیل لکھیں کہ کس لیے" });
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
    if (patch.description !== undefined && !String(patch.description || "").trim()) return res.status(400).json({ error: "Description cannot be empty · تفصیل خالی نہیں ہو سکتی" });
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
