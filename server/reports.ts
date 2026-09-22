/**
 * One-click reports.
 *
 *   GET /api/reports/monthly?month=YYYY-MM
 *       -> per-truck income / expense / profit(loss) for that month, from the
 *          truck khatas (truck_ledger_entries). Plus grand totals and a
 *          category breakdown. "Is month ka trucks ka hisab" in a single call.
 *
 *   GET /api/reports/monthly/range?from=YYYY-MM&to=YYYY-MM
 *       -> the same totals for each month in the range (for a trend).
 */
import { Router, Response } from "express";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { requireAuth, requireApproved, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { ramadanStartInGregorianYear, gregorianToIslamic } from "../src/lib/hijri.ts";

const router = Router();
router.use(requireAuth, requireApproved);

function monthBounds(month: string): { start: Date; end: Date; label: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month || "");
  const now = new Date();
  const y = m ? Number(m[1]) : now.getFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getMonth();
  const start = new Date(y, mo, 1);
  const end = new Date(y, mo + 1, 1);
  return { start, end, label: `${y}-${String(mo + 1).padStart(2, "0")}` };
}

async function monthlyTruckPnl(month: string) {
  const { start, end, label } = monthBounds(month);

  const rows = await db
    .select({
      ledgerId: schema.truckLedgerEntries.ledgerId,
      registration: schema.truckLedgers.registration,
      title: schema.truckLedgers.title,
      isPartnership: schema.truckLedgers.isPartnership,
      income: sql<number>`coalesce(sum(${schema.truckLedgerEntries.received}),0)::bigint`,
      expense: sql<number>`coalesce(sum(${schema.truckLedgerEntries.paid}),0)::bigint`,
      entries: sql<number>`count(*)::int`,
    })
    .from(schema.truckLedgerEntries)
    .innerJoin(schema.truckLedgers, eq(schema.truckLedgerEntries.ledgerId, schema.truckLedgers.id))
    .where(
      and(
        eq(schema.truckLedgerEntries.isDeleted, false),
        eq(schema.truckLedgers.isDeleted, false),
        gte(schema.truckLedgerEntries.entryDate, start),
        lt(schema.truckLedgerEntries.entryDate, end),
      ),
    )
    .groupBy(
      schema.truckLedgerEntries.ledgerId,
      schema.truckLedgers.registration,
      schema.truckLedgers.title,
      schema.truckLedgers.isPartnership,
    )
    .orderBy(sql`sum(${schema.truckLedgerEntries.received}) - sum(${schema.truckLedgerEntries.paid}) desc`);

  const trucks = rows.map((r) => {
    const income = Number(r.income);
    const expense = Number(r.expense);
    return {
      ledgerId: r.ledgerId,
      truck: r.registration || r.title,
      partnership: r.isPartnership,
      income,
      expense,
      profit: income - expense,
      entries: r.entries,
      result: income - expense >= 0 ? "profit" : "loss",
    };
  });

  // by category (freight / diesel / tolls / …)
  const cats = await db
    .select({
      category: schema.truckLedgerEntries.category,
      income: sql<number>`coalesce(sum(${schema.truckLedgerEntries.received}),0)::bigint`,
      expense: sql<number>`coalesce(sum(${schema.truckLedgerEntries.paid}),0)::bigint`,
    })
    .from(schema.truckLedgerEntries)
    .where(
      and(
        eq(schema.truckLedgerEntries.isDeleted, false),
        gte(schema.truckLedgerEntries.entryDate, start),
        lt(schema.truckLedgerEntries.entryDate, end),
      ),
    )
    .groupBy(schema.truckLedgerEntries.category)
    .orderBy(sql`sum(${schema.truckLedgerEntries.paid}) desc`);

  const [undated] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.truckLedgerEntries)
    .where(and(eq(schema.truckLedgerEntries.isDeleted, false), sql`${schema.truckLedgerEntries.entryDate} is null`));

  const totalIncome = trucks.reduce((s, t) => s + t.income, 0);
  const totalExpense = trucks.reduce((s, t) => s + t.expense, 0);
  const net = totalIncome - totalExpense;
  // Split, not just netted: how much profit the profitable trucks made, and how
  // much loss the loss-making trucks ran up. "Kitna profit, kitna loss hua."
  const grossProfit = trucks.filter((t) => t.profit > 0).reduce((s, t) => s + t.profit, 0);
  const grossLoss = trucks.filter((t) => t.profit < 0).reduce((s, t) => s + t.profit, 0); // <= 0

  return {
    month: label,
    totals: {
      income: totalIncome,
      expense: totalExpense,
      net,
      grossProfit, // + total from trucks that earned
      grossLoss, // − total from trucks that lost (negative number)
      result: net >= 0 ? "profit" : "loss",
      trucksInProfit: trucks.filter((t) => t.profit >= 0).length,
      trucksInLoss: trucks.filter((t) => t.profit < 0).length,
      trucksReported: trucks.length,
    },
    trucks,
    categories: cats.map((c) => ({
      category: c.category,
      income: Number(c.income),
      expense: Number(c.expense),
      net: Number(c.income) - Number(c.expense),
    })),
    note:
      (undated?.n || 0) > 0
        ? `${undated.n} ledger entries have no date, so they are not counted in any month. Fix their dates. · ${undated.n} اندراجات کی تاریخ خالی ہے — وہ کسی مہینے میں شمار نہیں ہوتیں۔`
        : null,
  };
}

router.get("/monthly", async (req: AuthRequest, res: Response) => {
  try {
    res.json(await monthlyTruckPnl(String(req.query.month || "")));
  } catch (e: any) {
    console.error("[reports] monthly failed:", e);
    res.status(500).json({ error: e.message || "report failed" });
  }
});

router.get("/monthly/range", async (req: AuthRequest, res: Response) => {
  try {
    const from = monthBounds(String(req.query.from || ""));
    const to = monthBounds(String(req.query.to || ""));
    const months: string[] = [];
    const cur = new Date(from.start);
    let guard = 0;
    while (cur <= to.start && guard++ < 36) {
      months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
      cur.setMonth(cur.getMonth() + 1);
    }
    const out = [];
    for (const m of months) {
      const r = await monthlyTruckPnl(m);
      out.push({ month: r.month, ...r.totals });
    }
    res.json({ months: out });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "report failed" });
  }
});

/**
 * GET /api/reports/yearly?year=YYYY
 *   -> saal ka hisab: the 12 monthly truck P&Ls added up into one yearly
 *      profit/loss, plus a Zakat estimate calculated the way it's actually
 *      done here: on 1 Ramadan of the Hijri year that falls inside this
 *      Gregorian year, take 2.5% of the WHOLE YEAR's business profit (not
 *      loss — and not a snapshot of bank/receivable/payable wealth). If the
 *      year net is a loss, Zakat is 0.
 *
 *      The Ramadan date is a tabular calculation, not a moon-sighting
 *      confirmation — it can land a day off from the real Ruet-e-Hilal
 *      announcement. This is a starting figure, not a fatwa: confirm both
 *      the date and the Nisab threshold with your religious advisor.
 */
const ZAKAT_RATE = 0.025;

router.get("/yearly", async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const year = /^\d{4}$/.test(String(req.query.year || "")) ? Number(req.query.year) : now.getFullYear();

    const months = [];
    for (let mo = 1; mo <= 12; mo++) {
      const r = await monthlyTruckPnl(`${year}-${String(mo).padStart(2, "0")}`);
      months.push({ month: r.month, ...r.totals });
    }

    const yearTotals = months.reduce(
      (acc, m) => ({
        income: acc.income + m.income,
        expense: acc.expense + m.expense,
        net: acc.net + m.net,
        grossProfit: acc.grossProfit + (m.grossProfit || 0),
        grossLoss: acc.grossLoss + (m.grossLoss || 0),
      }),
      { income: 0, expense: 0, net: 0, grossProfit: 0, grossLoss: 0 },
    );

    const ramadanStart = ramadanStartInGregorianYear(year);
    const ramadanHijri = gregorianToIslamic(ramadanStart.getUTCFullYear(), ramadanStart.getUTCMonth() + 1, ramadanStart.getUTCDate());
    const zakatableProfit = yearTotals.net > 0 ? yearTotals.net : 0;
    const zakatDue = Math.round(zakatableProfit * ZAKAT_RATE);

    // Installment tracking: every real Zakat payment logged (Finance → Zakat)
    // from 1 Ramadan onward counts against this year's due amount — "kabhi
    // 50k kabhi 10k" given through the year, subtracted from the total as it
    // comes in, with a month-by-month record so nothing gets forgotten.
    const paidWindowEnd = now < new Date(year + 1, 0, 1) ? now : new Date(year + 1, 0, 1);
    const paidRows = await db
      .select({
        month: sql<string>`to_char(${schema.zakatPayments.entryDate}, 'YYYY-MM')`,
        total: sql<number>`coalesce(sum(${schema.zakatPayments.amount}),0)::bigint`,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.zakatPayments)
      .where(
        and(
          eq(schema.zakatPayments.isDeleted, false),
          gte(schema.zakatPayments.entryDate, ramadanStart),
          sql`${schema.zakatPayments.entryDate} <= ${paidWindowEnd}`,
        ),
      )
      .groupBy(sql`to_char(${schema.zakatPayments.entryDate}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${schema.zakatPayments.entryDate}, 'YYYY-MM')`);

    const zakatGivenSinceRamadan = paidRows.reduce((s, r) => s + Number(r.total), 0);
    const zakatRemaining = zakatDue - zakatGivenSinceRamadan;

    res.json({
      year,
      months,
      yearTotals: { ...yearTotals, result: yearTotals.net >= 0 ? "profit" : "loss" },
      zakat: {
        method: "profit",
        ramadanStart: ramadanStart.toISOString().slice(0, 10),
        ramadanHijriYear: ramadanHijri.year,
        yearProfit: yearTotals.net,
        zakatableProfit,
        rate: ZAKAT_RATE,
        zakatDue,
        givenSinceRamadan: zakatGivenSinceRamadan,
        remaining: zakatRemaining,
        givenByMonth: paidRows.map((r) => ({ month: r.month, total: Number(r.total), count: r.count })),
        note:
          `Calculated as 2.5% of this year's whole business profit, as of 1 Ramadan ${ramadanHijri.year} AH (calculated ≈ ${ramadanStart.toISOString().slice(0, 10)}, not a moon-sighting confirmation). If the year is a loss, Zakat is 0. Excludes all personal/household funds. Confirm the exact date and Nisab threshold with your religious advisor. · یہ سال کے مکمل کاروباری منافع کا 2.5% ہے، یکم رمضان کے حساب سے — تاریخ کی تصدیق خود کر لیں۔`,
      },
    });
  } catch (e: any) {
    console.error("[reports] yearly failed:", e);
    res.status(500).json({ error: e.message || "report failed" });
  }
});

export default router;
