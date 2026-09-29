/**
 * Partnership Account (شراکت کا حساب) — a truck co-owned with a partner, kept exactly
 * the way the paper book keeps it (see TLE 730 / Qudrat Ullah):
 *
 *  1. The truck's khata runs as usual (kiraya in, diesel / gadi kharcha / tyre / visa out).
 *  2. Everything written after the last closed cycle is the OPEN CYCLE — taken in the order
 *     rows were written (like the paper), not by date.
 *  3. Close the cycle:
 *       money left  -> صافی بچت: split by % → credited to the partner's party ledger and to
 *                      HFK's party ledger. Together those credits are the مشترکہ جمع (joint pool).
 *       money short -> قرضدار: carried into the next cycle (paper method) — or, if chosen,
 *                      the loss is split by % right away.
 *  4. شخصی برداشت (money a partner takes for home): debited to that partner; by default the
 *     same amount is written for the other partner too — the paper writes both, so the 50/50
 *     stays level.
 *  5. A partner's old قرضہ is debited to him; his profit share (credit) then cuts it down on
 *     its own, and anything he takes for home adds to it.
 *
 * Every rupee lives in the two party ledgers (tagged refNo "PSHIP-<id>"), so each side's money
 * is in its own ledger and shows up in Party Ledgers / Dues like any other entry.
 *
 *   GET    /api/partnership/options           trucks (khatas) + parties for the setup form
 *   GET    /api/partnership                   all partnership accounts with their balances
 *   POST   /api/partnership                   set one up
 *   GET    /api/partnership/report?ledgerId&from&to   any-dates report for one truck khata
 *   GET    /api/partnership/ledger/:id/pages   the khata's paper pages (one per paper cycle)
 *   GET    /api/partnership/ledger/:id/rows    rows of a page (?page=) or an id range (?after=&upto=)
 *   GET    /api/partnership/:id               open cycle + balances + history + closed cycles
 *   POST   /api/partnership/:id/close         close the open cycle
 *   POST   /api/partnership/:id/undo-close    reopen the last closed cycle
 *   POST   /api/partnership/:id/event         shakhsi | debt | repayment | payout
 *   DELETE /api/partnership/:id/event/:entryId
 */
import { Router, Response } from "express";
import { and, asc, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { recompute as recomputeParty } from "./parties.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Operations Manager", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];

// what each tagged party entry means — the label is also what Party Ledgers shows
export const KIND = {
  opening: "Opening joint pool · ابتدائی مشترکہ جمع",
  safi: "Safi bachat · صافی بچت",
  loss: "Loss split · نقصان تقسیم",
  shakhsi: "Shakhsi bardasht · شخصی برداشت",
  debt: "Old qarz · پرانا قرضہ",
  repayment: "Qarz returned · قرضہ واپسی",
  payout: "Share paid out · حصہ ادا",
} as const;
type Kind = keyof typeof KIND;
const kindOf = (label: string | null): Kind | null => (Object.entries(KIND).find(([, v]) => v === label)?.[0] as Kind) || null;

const tag = (id: number) => `PSHIP-${id}`;
const whole = (v: any) => Math.round(Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0);
const dayOf = (v: any) => {
  const d = v ? new Date(v) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
};

async function audit(req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", tableName: string, recordId: number, oldValues: any, newValues: any) {
  await logAudit({ action, tableName, recordId, oldValues, newValues, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
}

async function ensureParty(id: any, name: any, notes: string, userId?: number): Promise<number> {
  if (id) return Number(id);
  const n = String(name || "").trim();
  if (!n) throw new Error("Pick or type a name for both sides · دونوں شریکوں کا نام دیں");
  const [found] = await db
    .select({ id: schema.parties.id })
    .from(schema.parties)
    .where(and(eq(schema.parties.isDeleted, false), sql`lower(regexp_replace(trim(${schema.parties.name}), '\\s+', ' ', 'g')) = ${n.toLowerCase().replace(/\s+/g, " ")}`))
    .orderBy(asc(schema.parties.id))
    .limit(1);
  if (found) return found.id;
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${schema.parties.id}),0)::int` }).from(schema.parties);
  const [created] = await db
    .insert(schema.parties)
    .values({ partyCode: `PTY-${String((max || 0) + 1).padStart(4, "0")}-${Date.now().toString(36).slice(-3).toUpperCase()}`, name: n, type: "Other", notes, status: "Active", createdBy: userId })
    .returning();
  return created.id;
}

async function post(opts: {
  accountId: number;
  partyId: number;
  kind: Kind;
  date: Date;
  description: string;
  debit?: number;
  credit?: number;
  method?: string;
  prevWatermark?: number;
  userId?: number;
}) {
  const [e] = await db
    .insert(schema.partyLedgerEntries)
    .values({
      partyId: opts.partyId,
      entryDate: opts.date,
      rawDate: opts.date.toISOString().slice(0, 10),
      description: opts.description,
      refNo: tag(opts.accountId),
      method: opts.method || "Adjustment",
      debit: Math.max(0, Math.round(opts.debit || 0)),
      credit: Math.max(0, Math.round(opts.credit || 0)),
      category: "Partnership",
      sectionLabel: KIND[opts.kind],
      sourceRow: opts.prevWatermark ?? null, // on a cycle close: where the cycle started, so it can be undone
      createdBy: opts.userId,
    })
    .returning();
  return e;
}

async function loadAccount(id: number) {
  const [a] = await db
    .select({
      acc: schema.partnershipAccounts,
      truck: schema.truckLedgers.registration,
      truckTitle: schema.truckLedgers.title,
      partnerName: sql<string>`(select name from parties where id = ${schema.partnershipAccounts.partnerPartyId})`,
      hfkName: sql<string>`(select name from parties where id = ${schema.partnershipAccounts.hfkPartyId})`,
    })
    .from(schema.partnershipAccounts)
    .innerJoin(schema.truckLedgers, eq(schema.partnershipAccounts.truckLedgerId, schema.truckLedgers.id))
    .where(and(eq(schema.partnershipAccounts.id, id), eq(schema.partnershipAccounts.isDeleted, false)))
    .limit(1);
  return a || null;
}

// A previous page's result written again at the top of the next page — a shortfall
// ("قرضدار 705,475", "fura qarzder") or a saving ("bacht 129,460", "صافی بچت 677,280"). Part
// of the paper's running balance, but not new money: a report that counted it would count
// that result twice.
const CARRY_RE = /قرضدار|qarz\s*d[ae]r|qarzder|بچت|bach?at|bacht/i;

/**
 * Truck khata rows in writing order, each flagged:
 *  box   — a figure from the settlement box drawn beside the paper table ("Des 350,000",
 *          "Total حساب ہوگئا ہے 405,000"): imported from the sheet, but it has no Sr# and no
 *          balance of its own. Never money of the truck.
 *  carry — a carried-forward line (see CARRY_RE)
 *  marker— a صافی بچت / "hisab nil" close line
 */
// NOTE: correlated sub-queries below name the outer table literally ("truck_ledger_entries"."id").
// On a single-table select drizzle renders ${col} as a bare "id", which inside the sub-query
// binds to the sub-query's own table — every count came out wrong.
async function khataRows(ledgerId: number, ...extra: any[]) {
  const rows = await db
    .select({
      id: schema.truckLedgerEntries.id,
      srNo: schema.truckLedgerEntries.srNo,
      entryDate: schema.truckLedgerEntries.entryDate,
      rawDate: schema.truckLedgerEntries.rawDate,
      description: schema.truckLedgerEntries.description,
      received: schema.truckLedgerEntries.received,
      paid: schema.truckLedgerEntries.paid,
      category: schema.truckLedgerEntries.category,
      method: schema.truckLedgerEntries.method,
      page: schema.truckLedgerEntries.sectionLabel,
      sheetBalance: schema.truckLedgerEntries.sheetBalance,
      sourceRow: schema.truckLedgerEntries.sourceRow,
      isReset: schema.truckLedgerEntries.isReset,
      files: sql<number>`(select count(*)::int from attachments a where a.entity_type = 'truck_ledger_entry' and a.entity_id = "truck_ledger_entries"."id" and not a.is_deleted)`,
    })
    .from(schema.truckLedgerEntries)
    .where(and(eq(schema.truckLedgerEntries.ledgerId, ledgerId), eq(schema.truckLedgerEntries.isDeleted, false), ...extra))
    .orderBy(asc(schema.truckLedgerEntries.id));
  return rows.map((r) => {
    const money = (r.received || 0) !== 0 || (r.paid || 0) !== 0;
    return {
      ...r,
      money,
      box: money && r.sourceRow != null && r.sheetBalance == null && r.srNo == null,
      carry: CARRY_RE.test(r.description || ""),
      marker: r.category === "SafiBachat" || !!r.isReset,
    };
  });
}
type KhataRow = Awaited<ReturnType<typeof khataRows>>[number];

/**
 * The paper settles a page by one unlabelled last line that brings its balance to exactly 0
 * (page 2: "677,280 → 0", page 8: "265,965 → 0") — a transfer to / from the joint pool, not
 * income or expense. Needs whole pages, so only used where all the khata's rows are loaded.
 */
function settleIds(rows: KhataRow[]): Set<number> {
  const out = new Set<number>();
  const byPage = new Map<string, KhataRow[]>();
  for (const r of rows) if (r.page) byPage.set(r.page, [...(byPage.get(r.page) || []), r]);
  for (const page of byPage.values()) {
    const lines = page.filter((r) => r.money && !r.box);
    if (lines.length < 2) continue;
    const last = lines[lines.length - 1];
    const before = lines.slice(0, -1).reduce((s, r) => s + (r.received || 0) - (r.paid || 0), 0);
    const after = before + (last.received || 0) - (last.paid || 0);
    if (before !== 0 && after === 0 && !(last.description || "").trim()) out.add(last.id);
  }
  return out;
}

/** Lines with a running balance from 0, the way a paper page reads (box figures left out). */
function withBalance(rows: KhataRow[]) {
  let bal = 0;
  return rows
    .filter((r) => r.money && !r.box)
    .map((r) => {
      bal += (r.received || 0) - (r.paid || 0);
      return { ...r, balance: bal };
    });
}

/** The open cycle: every khata row written after the watermark, in writing order. */
async function openCycle(ledgerId: number, afterId: number) {
  const rows = await khataRows(ledgerId, gt(schema.truckLedgerEntries.id, afterId));
  // a صافی بچت line is the paper's close marker, not money
  const lines = withBalance(rows.filter((r) => r.category !== "SafiBachat"));
  const received = lines.reduce((s, r) => s + (r.received || 0), 0);
  const paid = lines.reduce((s, r) => s + (r.paid || 0), 0);
  return { lines, received, paid, net: received - paid, lastId: rows.length ? rows[rows.length - 1].id : afterId };
}

/** Both sides' positions, from the tagged party entries. */
async function balances(accountId: number, partnerPartyId: number, hfkPartyId: number) {
  const rows = await db
    .select({ partyId: schema.partyLedgerEntries.partyId, label: schema.partyLedgerEntries.sectionLabel, debit: sql<number>`sum(${schema.partyLedgerEntries.debit})::bigint`, credit: sql<number>`sum(${schema.partyLedgerEntries.credit})::bigint` })
    .from(schema.partyLedgerEntries)
    .where(and(eq(schema.partyLedgerEntries.refNo, tag(accountId)), eq(schema.partyLedgerEntries.isDeleted, false)))
    .groupBy(schema.partyLedgerEntries.partyId, schema.partyLedgerEntries.sectionLabel);

  const side = (partyId: number) => {
    const s = { share: 0, withdrawn: 0, paidOut: 0, debt: 0 };
    for (const r of rows.filter((x) => x.partyId === partyId)) {
      const k = kindOf(r.label);
      const d = Number(r.debit || 0);
      const c = Number(r.credit || 0);
      if (k === "opening" || k === "safi" || k === "loss") s.share += c - d;
      else if (k === "shakhsi") s.withdrawn += d - c;
      else if (k === "payout") s.paidOut += d - c;
      else if (k === "debt" || k === "repayment") s.debt += d - c;
    }
    // what is left for this side in the joint pool, and after his old qarz is set against it
    const inPool = s.share - s.withdrawn - s.paidOut;
    return { ...s, inPool, net: inPool - s.debt };
  };
  const partner = side(partnerPartyId);
  const hfk = side(hfkPartyId);
  return { partner, hfk, pool: partner.inPool + hfk.inPool };
}

// ---------------------------------------------------------------------------

router.get("/options", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    const ledgers = await db
      .select({
        id: schema.truckLedgers.id,
        registration: schema.truckLedgers.registration,
        title: schema.truckLedgers.title,
        sourceSheet: schema.truckLedgers.sourceSheet,
        entries: sql<number>`(select count(*)::int from truck_ledger_entries e where e.ledger_id = "truck_ledgers"."id" and not e.is_deleted)`,
        // the paper's last close line: the newest صافی بچت / "hisab nil" row
        lastCloseId: sql<number>`(select max(e.id) from truck_ledger_entries e where e.ledger_id = "truck_ledgers"."id" and not e.is_deleted and (e.category = 'SafiBachat' or e.is_reset))`,
      })
      .from(schema.truckLedgers)
      .where(eq(schema.truckLedgers.isDeleted, false))
      .orderBy(asc(schema.truckLedgers.registration));
    const parties = await db
      .select({ id: schema.parties.id, name: schema.parties.name, type: schema.parties.type })
      .from(schema.parties)
      .where(eq(schema.parties.isDeleted, false))
      .orderBy(asc(schema.parties.name));
    const accs = await db
      .select({ id: schema.partnershipAccounts.id, ledgerId: schema.partnershipAccounts.truckLedgerId })
      .from(schema.partnershipAccounts)
      .where(eq(schema.partnershipAccounts.isDeleted, false));
    const accByLedger = new Map(accs.map((a) => [a.ledgerId, a.id]));
    res.json({
      ledgers: ledgers.filter((l) => l.entries > 0 || !l.sourceSheet).map((l) => ({ ...l, accountId: accByLedger.get(l.id) ?? null })),
      parties,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Any-dates report for one truck khata: money in − money out, by category, split by %.
 * Counts every real row (online payments and "kiraya jama" deposits included — they are the
 * truck's money), and leaves out only what isn't new money: صافی بچت lines, carried-forward
 * قرضدار lines and the settlement-box figures. Those are listed separately so nothing is hidden.
 */
router.get("/report", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const ledgerId = Number(req.query.ledgerId);
    if (!ledgerId) return res.status(400).json({ error: "ledgerId is required" });
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(new Date(String(req.query.to)).getTime() + 24 * 3600_000 - 1) : null;
    const [acc] = await db
      .select()
      .from(schema.partnershipAccounts)
      .where(and(eq(schema.partnershipAccounts.truckLedgerId, ledgerId), eq(schema.partnershipAccounts.isDeleted, false)))
      .limit(1);
    const pct = acc ? acc.partnerPercent : Math.max(0, Math.min(100, whole(req.query.pct ?? 50)));

    const all = await khataRows(ledgerId);
    const settled = settleIds(all);
    const inRange = all.filter((r) => {
      if (!from && !to) return true;
      if (!r.entryDate) return false;
      const t = new Date(r.entryDate).getTime();
      return (!from || t >= from.getTime()) && (!to || t <= to.getTime());
    });
    const money = inRange.filter((r) => r.money);
    const counted = money.filter((r) => !r.box && !r.carry && !settled.has(r.id) && r.category !== "SafiBachat");
    const leftOut = money
      .filter((r) => !counted.includes(r))
      .map((r) => ({ ...r, why: r.box ? "box" : r.carry ? "carry" : settled.has(r.id) ? "settle" : "safi" }));

    const byCat = new Map<string, { category: string; received: number; paid: number; entries: number }>();
    for (const r of counted) {
      const c = byCat.get(r.category) || { category: r.category, received: 0, paid: 0, entries: 0 };
      c.received += r.received || 0;
      c.paid += r.paid || 0;
      c.entries++;
      byCat.set(r.category, c);
    }
    const revenue = counted.reduce((s, r) => s + (r.received || 0), 0);
    const cost = counted.reduce((s, r) => s + (r.paid || 0), 0);
    const net = revenue - cost;
    const partnerShare = Math.round((net * pct) / 100);
    const dated = all.filter((r) => r.entryDate).map((r) => new Date(r.entryDate as any).getTime());
    res.json({
      pct,
      accountId: acc?.id ?? null,
      categories: [...byCat.values()].sort((a, b) => b.paid - a.paid || b.received - a.received),
      rows: counted,
      leftOut,
      undated: all.filter((r) => r.money && !r.entryDate).length,
      coverage: dated.length ? { from: new Date(Math.min(...dated)).toISOString(), to: new Date(Math.max(...dated)).toISOString() } : null,
      totals: { revenue, cost, net, partnerShare, hfkShare: net - partnerShare },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** The khata's paper pages — each SR# table on the paper is one cycle — newest first. */
router.get("/ledger/:ledgerId/pages", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const rows = await khataRows(Number(req.params.ledgerId));
    const groups: { page: string; rows: KhataRow[] }[] = [];
    for (const r of rows) {
      const page = r.page || "Entries";
      if (!groups.length || groups[groups.length - 1].page !== page) groups.push({ page, rows: [] });
      groups[groups.length - 1].rows.push(r);
    }
    const pages = groups.map((g) => {
      const lines = withBalance(g.rows);
      const real = g.rows.filter((r) => !r.box);
      // what the paper itself wrote as the page's last balance (before any "nil" zeroing line)
      // (numbered paper rows only — the settlement box beside the table has balances of its own)
      const written = [...real].reverse().find((r) => r.srNo != null && r.sheetBalance != null && r.sheetBalance !== 0)?.sheetBalance;
      const dates = lines.map((l) => l.rawDate).filter(Boolean);
      return {
        page: g.page,
        firstId: g.rows[0].id,
        lastId: g.rows[g.rows.length - 1].id,
        from: dates[0] || null,
        to: dates[dates.length - 1] || null,
        lines: lines.length,
        received: lines.reduce((s, l) => s + (l.received || 0), 0),
        paid: lines.reduce((s, l) => s + (l.paid || 0), 0),
        result: written ?? (lines.length ? lines[lines.length - 1].balance : 0),
        files: g.rows.reduce((s, r) => s + (r.files || 0), 0),
      };
    });
    res.json(pages.reverse());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Rows of one paper page, or of an id range (a cycle closed on this screen). */
router.get("/ledger/:ledgerId/rows", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const extra: any[] = [];
    if (req.query.page) extra.push(eq(schema.truckLedgerEntries.sectionLabel, String(req.query.page)));
    if (req.query.after) extra.push(gt(schema.truckLedgerEntries.id, Number(req.query.after)));
    if (req.query.upto) extra.push(sql`${schema.truckLedgerEntries.id} <= ${Number(req.query.upto)}`);
    const rows = await khataRows(Number(req.params.ledgerId), ...extra);
    res.json({ lines: withBalance(rows), box: rows.filter((r) => r.box) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    const accs = await db.select().from(schema.partnershipAccounts).where(eq(schema.partnershipAccounts.isDeleted, false)).orderBy(asc(schema.partnershipAccounts.id));
    const out = [];
    for (const a of accs) {
      const full = await loadAccount(a.id);
      if (!full) continue;
      const cyc = await openCycle(a.truckLedgerId, a.lastEntryId);
      const bal = await balances(a.id, a.partnerPartyId, a.hfkPartyId);
      out.push({ ...a, truck: full.truck, truckTitle: full.truckTitle, partnerName: full.partnerName, hfkName: full.hfkName, cycleNet: cyc.net, cycleLines: cyc.lines.length, ...bal });
    }
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const ledgerId = Number(b.truckLedgerId);
    if (!ledgerId) return res.status(400).json({ error: "Pick the truck's khata · ٹرک کا کھاتہ منتخب کریں" });
    const pct = Math.max(1, Math.min(99, whole(b.partnerPercent ?? 50)));
    const [led] = await db.select().from(schema.truckLedgers).where(eq(schema.truckLedgers.id, ledgerId)).limit(1);
    if (!led) return res.status(404).json({ error: "Khata not found" });
    const [dup] = await db
      .select({ id: schema.partnershipAccounts.id })
      .from(schema.partnershipAccounts)
      .where(and(eq(schema.partnershipAccounts.truckLedgerId, ledgerId), eq(schema.partnershipAccounts.isDeleted, false)))
      .limit(1);
    if (dup) return res.status(400).json({ error: "This khata already has a partnership account · اس کھاتے کا شراکتی حساب پہلے سے موجود ہے" });

    const partnerPartyId = await ensureParty(b.partnerPartyId, b.partnerName, `Partner in ${led.registration}`, req.user?.id);
    const hfkPartyId = await ensureParty(b.hfkPartyId, b.hfkName, `HFK share in ${led.registration}`, req.user?.id);
    if (partnerPartyId === hfkPartyId) return res.status(400).json({ error: "The partner and HFK must be two different ledgers · شریک اور HFK کے الگ کھاتے ہوں" });

    // where the open cycle starts: after the given row, else after the paper's last close line
    let lastEntryId = whole(b.startAfterEntryId);
    if (!lastEntryId) {
      const [lc] = await db
        .select({ id: sql<number>`max(${schema.truckLedgerEntries.id})` })
        .from(schema.truckLedgerEntries)
        .where(and(eq(schema.truckLedgerEntries.ledgerId, ledgerId), eq(schema.truckLedgerEntries.isDeleted, false), sql`(${schema.truckLedgerEntries.category} = 'SafiBachat' or ${schema.truckLedgerEntries.isReset})`));
      lastEntryId = Number(lc?.id || 0);
    }

    const [acc] = await db
      .insert(schema.partnershipAccounts)
      .values({ truckLedgerId: ledgerId, partnerPartyId, hfkPartyId, partnerPercent: pct, lastEntryId, notes: String(b.notes || "").trim() || null, createdBy: req.user?.id })
      .returning();
    await db.update(schema.truckLedgers).set({ isPartnership: true }).where(eq(schema.truckLedgers.id, ledgerId));

    // money already in the joint pool on the day this starts (paper: "بقایا مشترکہ جمع رقم")
    const pool = whole(b.openingPool);
    const poolDate = dayOf(b.openingDate);
    if (pool > 0) {
      const partnerPart = Math.round((pool * pct) / 100);
      const desc = `${led.registration}: joint pool brought forward ${pool.toLocaleString()} · مشترکہ جمع`;
      await post({ accountId: acc.id, partyId: partnerPartyId, kind: "opening", date: poolDate, description: `${desc} × ${pct}%`, credit: partnerPart, userId: req.user?.id });
      await post({ accountId: acc.id, partyId: hfkPartyId, kind: "opening", date: poolDate, description: `${desc} × ${100 - pct}%`, credit: pool - partnerPart, userId: req.user?.id });
    }
    const debt = whole(b.openingDebt);
    if (debt > 0) {
      await post({ accountId: acc.id, partyId: partnerPartyId, kind: "debt", date: dayOf(b.debtDate || b.openingDate), description: `${led.registration}: old qarz · پرانا قرضہ${b.debtNote ? ` — ${String(b.debtNote).trim()}` : ""}`, debit: debt, userId: req.user?.id });
    }
    await recomputeParty(partnerPartyId);
    await recomputeParty(hfkPartyId);
    await audit(req, "CREATE", "partnership_accounts", acc.id, null, acc);
    res.status(201).json(acc);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const full = await loadAccount(Number(req.params.id));
    if (!full) return res.status(404).json({ error: "Partnership account not found" });
    const a = full.acc;
    const cycle = await openCycle(a.truckLedgerId, a.lastEntryId);
    const bal = await balances(a.id, a.partnerPartyId, a.hfkPartyId);
    const history = await db
      .select({
        id: schema.partyLedgerEntries.id,
        partyId: schema.partyLedgerEntries.partyId,
        entryDate: schema.partyLedgerEntries.entryDate,
        description: schema.partyLedgerEntries.description,
        method: schema.partyLedgerEntries.method,
        debit: schema.partyLedgerEntries.debit,
        credit: schema.partyLedgerEntries.credit,
        label: schema.partyLedgerEntries.sectionLabel,
        sourceRow: schema.partyLedgerEntries.sourceRow,
        files: sql<number>`(select count(*)::int from attachments x where x.entity_type = 'party_ledger_entry' and x.entity_id = "party_ledger_entries"."id" and not x.is_deleted)`,
      })
      .from(schema.partyLedgerEntries)
      .where(and(eq(schema.partyLedgerEntries.refNo, tag(a.id)), eq(schema.partyLedgerEntries.isDeleted, false)))
      .orderBy(desc(schema.partyLedgerEntries.entryDate), desc(schema.partyLedgerEntries.id));
    const pct = a.partnerPercent;

    // cycles closed on this screen: each close wrote one line per side, carrying where that
    // cycle started (sourceRow); it ended where the next one started, or at the watermark
    const closeLines = history.filter((h) => (kindOf(h.label) === "safi" || kindOf(h.label) === "loss") && h.sourceRow != null);
    const starts = [...new Set(closeLines.map((h) => h.sourceRow as number))].sort((x, y) => x - y);
    const closed = starts.map((after, i) => {
      const lines = closeLines.filter((h) => h.sourceRow === after);
      return {
        no: i + 1,
        after,
        upto: starts[i + 1] ?? a.lastEntryId,
        date: lines[0]?.entryDate,
        net: lines.reduce((s, h) => s + (h.credit || 0) - (h.debit || 0), 0),
        partnerShare: lines.filter((h) => h.partyId === a.partnerPartyId).reduce((s, h) => s + (h.credit || 0) - (h.debit || 0), 0),
      };
    });
    res.json({
      account: a,
      truck: full.truck,
      truckTitle: full.truckTitle,
      partnerName: full.partnerName,
      hfkName: full.hfkName,
      cycle: {
        ...cycle,
        cycleNo: a.cycleNo + 1,
        partnerShare: Math.round((cycle.net * pct) / 100),
        hfkShare: cycle.net - Math.round((cycle.net * pct) / 100),
      },
      ...bal,
      history: history.map((h) => ({ ...h, kind: kindOf(h.label), side: h.partyId === a.partnerPartyId ? "partner" : "hfk" })),
      closed: closed.reverse(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/close", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const full = await loadAccount(Number(req.params.id));
    if (!full) return res.status(404).json({ error: "Partnership account not found" });
    const a = full.acc;
    const cycle = await openCycle(a.truckLedgerId, a.lastEntryId);
    if (!cycle.lines.length) return res.status(400).json({ error: "Nothing written in the khata since the last close · پچھلے حساب کے بعد کوئی انٹری نہیں" });
    const splitLoss = !!req.body?.splitLoss;
    if (cycle.net < 0 && !splitLoss) {
      return res.status(400).json({
        error: `This cycle is short by ${Math.abs(cycle.net).toLocaleString()} (قرضدار). Paper method: leave it open — it carries into the next trip. Or choose "split the loss now". · یہ حساب ${Math.abs(cycle.net).toLocaleString()} کم ہے — اگلے حساب میں شامل ہو گا`,
      });
    }
    const date = dayOf(req.body?.date);
    const no = a.cycleNo + 1;
    const partnerPart = Math.round((cycle.net * a.partnerPercent) / 100);
    const hfkPart = cycle.net - partnerPart;
    const kind: Kind = cycle.net >= 0 ? "safi" : "loss";
    const head = `${full.truck} cycle ${no}: in ${cycle.received.toLocaleString()} − out ${cycle.paid.toLocaleString()} = ${cycle.net.toLocaleString()}`;
    const e1 = await post({
      accountId: a.id, partyId: a.partnerPartyId, kind, date, prevWatermark: a.lastEntryId, userId: req.user?.id,
      description: `${head} × ${a.partnerPercent}%`,
      credit: partnerPart > 0 ? partnerPart : 0, debit: partnerPart < 0 ? -partnerPart : 0,
    });
    const e2 = await post({
      accountId: a.id, partyId: a.hfkPartyId, kind, date, prevWatermark: a.lastEntryId, userId: req.user?.id,
      description: `${head} × ${100 - a.partnerPercent}%`,
      credit: hfkPart > 0 ? hfkPart : 0, debit: hfkPart < 0 ? -hfkPart : 0,
    });
    await db.update(schema.partnershipAccounts).set({ lastEntryId: cycle.lastId, cycleNo: no, updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.partnershipAccounts.id, a.id));
    await recomputeParty(a.partnerPartyId);
    await recomputeParty(a.hfkPartyId);
    await audit(req, "UPDATE", "partnership_accounts", a.id, { lastEntryId: a.lastEntryId, cycleNo: a.cycleNo }, { lastEntryId: cycle.lastId, cycleNo: no, net: cycle.net, entries: [e1.id, e2.id] });
    res.json({ ok: true, net: cycle.net, partnerShare: partnerPart, hfkShare: hfkPart, cycleNo: no });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/undo-close", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const full = await loadAccount(Number(req.params.id));
    if (!full) return res.status(404).json({ error: "Partnership account not found" });
    const a = full.acc;
    const closes = await db
      .select()
      .from(schema.partyLedgerEntries)
      .where(and(eq(schema.partyLedgerEntries.refNo, tag(a.id)), eq(schema.partyLedgerEntries.isDeleted, false), inArray(schema.partyLedgerEntries.sectionLabel, [KIND.safi, KIND.loss])))
      .orderBy(desc(schema.partyLedgerEntries.id))
      .limit(2);
    if (!closes.length || closes[0].sourceRow == null) return res.status(400).json({ error: "No closed cycle to reopen" });
    const prev = closes[0].sourceRow;
    const pair = closes.filter((c) => c.sourceRow === prev);
    await db.update(schema.partyLedgerEntries).set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id }).where(inArray(schema.partyLedgerEntries.id, pair.map((p) => p.id)));
    await db.update(schema.partnershipAccounts).set({ lastEntryId: prev, cycleNo: Math.max(0, a.cycleNo - 1), updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.partnershipAccounts.id, a.id));
    await recomputeParty(a.partnerPartyId);
    await recomputeParty(a.hfkPartyId);
    await audit(req, "UPDATE", "partnership_accounts", a.id, { lastEntryId: a.lastEntryId }, { lastEntryId: prev, reopened: true });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/event", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const full = await loadAccount(Number(req.params.id));
    if (!full) return res.status(404).json({ error: "Partnership account not found" });
    const a = full.acc;
    const b = req.body || {};
    const kind = String(b.kind) as Kind;
    if (!["shakhsi", "debt", "repayment", "payout"].includes(kind)) return res.status(400).json({ error: "Unknown entry type" });
    const amount = whole(b.amount);
    if (amount <= 0) return res.status(400).json({ error: "Enter the amount · رقم لکھیں" });
    const who = b.who === "hfk" ? "hfk" : "partner";
    if ((kind === "debt" || kind === "repayment") && who !== "partner") return res.status(400).json({ error: "Qarz is kept on the partner's side" });
    const date = dayOf(b.date);
    const note = String(b.note || "").trim();
    const method = String(b.method || "Cash");
    const partyId = who === "partner" ? a.partnerPartyId : a.hfkPartyId;
    const name = who === "partner" ? full.partnerName : full.hfkName;
    const desc = `${full.truck}: ${KIND[kind].split(" · ")[0]} — ${name}${note ? ` — ${note}` : ""}`;

    const before = await balances(a.id, a.partnerPartyId, a.hfkPartyId);
    const e = await post({
      accountId: a.id, partyId, kind, date, method, userId: req.user?.id, description: desc,
      debit: kind === "repayment" ? 0 : amount,
      credit: kind === "repayment" ? amount : 0,
    });
    let matched = null;
    // paper method: when one partner takes money for home, the same amount is written for the other
    if (kind === "shakhsi" && b.matchOther !== false) {
      const otherId = who === "partner" ? a.hfkPartyId : a.partnerPartyId;
      const otherName = who === "partner" ? full.hfkName : full.partnerName;
      matched = await post({
        accountId: a.id, partyId: otherId, kind, date, method: "Adjustment", userId: req.user?.id,
        description: `${full.truck}: Shakhsi bardasht — ${otherName} — same as ${name} (50/50 kept level · برابر)`,
        debit: amount,
      });
    }
    await recomputeParty(a.partnerPartyId);
    await recomputeParty(a.hfkPartyId);
    const after = await balances(a.id, a.partnerPartyId, a.hfkPartyId);
    await audit(req, "CREATE", "party_ledger_entries", e.id, null, { partnership: a.id, kind, who, amount, matched: matched?.id });
    res.status(201).json({
      entry: e,
      matched,
      // tell the user straight away when a partner who already owes is taking more
      warning:
        who === "partner" && (kind === "shakhsi" || kind === "payout") && before.partner.net < 0
          ? `${full.partnerName} already owed ${Math.abs(before.partner.net).toLocaleString()}; now owes ${Math.abs(after.partner.net).toLocaleString()} · پہلے سے قرضدار ہے`
          : null,
      ...after,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id/event/:entryId", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const full = await loadAccount(Number(req.params.id));
    if (!full) return res.status(404).json({ error: "Partnership account not found" });
    const a = full.acc;
    const [e] = await db
      .select()
      .from(schema.partyLedgerEntries)
      .where(and(eq(schema.partyLedgerEntries.id, Number(req.params.entryId)), eq(schema.partyLedgerEntries.refNo, tag(a.id)), eq(schema.partyLedgerEntries.isDeleted, false)))
      .limit(1);
    if (!e) return res.status(404).json({ error: "Entry not found" });
    const k = kindOf(e.sectionLabel);
    if (k === "safi" || k === "loss") return res.status(400).json({ error: "A cycle close is removed with “Reopen last cycle” · حساب دوبارہ کھولیں" });
    await db.update(schema.partyLedgerEntries).set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(schema.partyLedgerEntries.id, e.id));
    await recomputeParty(e.partyId);
    await audit(req, "DELETE", "party_ledger_entries", e.id, e, null);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
