/**
 * Partnerships — company-owned trucks run by outside partners on a
 * lease-to-own basis.
 *
 * How HFK does it: a driver takes a truck at an agreed price (an advance if he pays one, else 0).
 * The truck stays 100% the company's. He runs it on the routes; after each trip the earnings
 * less the trip's expenses go to pay off the price — each such payment is one "qist". When the
 * price is fully paid he becomes a 50% partner in the truck (Partner P&L takes over from there).
 *
 *   agreedPrice        the full price the partner will pay for the truck
 *   advancePaid        upfront down-payment
 *   openingBalance     agreedPrice - advancePaid
 *   currentBalance     what is still owed; each settlement pays it down
 *
 * Each trip: the partner declares gross revenue and his expenses. Net
 * earnings (gross - expenses) flow to the company against the balance
 * (companySharePercent, default 100 = all net to the company) until the
 * balance reaches zero, then the agreement auto-settles.
 *
 * Instalments (qist): the agreement can carry a plan — an amount, on a day of each month, from a
 * date. The balance comes down two ways: an instalment the partner pays (cash / bank), and a
 * settlement of the truck's earnings. Both count against the plan, oldest instalment first, so
 * the schedule shows which instalments are paid, part-paid, overdue or still to come.
 *
 * The settlement engine also cross-checks the partner's declared revenue
 * against (a) GPS trip history × route rates and (b) fuel drawn × expected
 * economy, and flags under-reported revenue / inflated expenses.
 */

import { Router, Response } from "express";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { and, eq, gte, lte, desc, asc, sql, ne, inArray } from "drizzle-orm";
import { logAudit } from "../src/db/audit.ts";
import { SocketServer } from "../src/sockets/socket.ts";
import { selfApi } from "./self_api.ts";

const router = Router();
router.use(requireAuth, requireApproved);

const READ_ROLES = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Operations Manager", "Auditor"];
const WRITE_ROLES = ["Super Admin", "Admin", "Finance Manager", "Operations Manager"];

const EXPECTED_KMPL = 3.5; // loaded long-haul truck
const rowsOf = async (q: any) => ((await db.execute(q)) as any).rows as any[];
const isDay = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const pkToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

export interface ScheduleRow { no: number; due: string; amount: number; paid: number; status: "paid" | "part" | "overdue" | "upcoming" }

/**
 * The instalment plan as a schedule. What has been recovered so far (instalments paid + truck
 * earnings settled) fills the instalments oldest first.
 */
export function installmentSchedule(a: { opening: number; recovered: number; amount: number | null; day: number | null; start: string | null }, today: string) {
  if (!a.amount || a.amount <= 0 || !a.start || a.opening <= 0) return null;
  const [sy, sm, sd] = a.start.split("-").map(Number);
  const day = a.day && a.day >= 1 && a.day <= 31 ? a.day : sd;
  const dueOf = (i: number) => {
    // the first due date is the plan's day on or after the start date
    const m0 = sm - 1 + (day < sd ? 1 : 0) + i;
    const last = new Date(Date.UTC(sy, m0 + 1, 0)).getUTCDate();
    return new Date(Date.UTC(sy, m0, Math.min(day, last))).toISOString().slice(0, 10);
  };
  const n = Math.min(600, Math.ceil(a.opening / a.amount));
  let left = Math.max(0, a.recovered);
  const rows: ScheduleRow[] = [];
  for (let i = 0; i < n; i++) {
    const amount = Math.min(a.amount, a.opening - i * a.amount);
    const paid = Math.min(amount, left);
    left -= paid;
    const due = dueOf(i);
    rows.push({ no: i + 1, due, amount, paid, status: paid >= amount ? "paid" : due <= today ? (paid > 0 ? "part" : "overdue") : paid > 0 ? "part" : "upcoming" });
  }
  const dueByToday = rows.filter((r) => r.due <= today).reduce((t, r) => t + r.amount, 0);
  const next = rows.find((r) => r.paid < r.amount) || null;
  return {
    rows,
    count: n,
    paidCount: rows.filter((r) => r.status === "paid").length,
    overdueCount: rows.filter((r) => r.due <= today && r.paid < r.amount).length,
    dueByToday,
    overdue: Math.max(0, dueByToday - a.recovered), // behind the plan by this much
    ahead: Math.max(0, a.recovered - dueByToday), // ahead of the plan by this much
    next: next ? { no: next.no, due: next.due, amount: next.amount - next.paid } : null,
    lastDue: rows.length ? rows[rows.length - 1].due : null,
  };
}

/** Balance = opening − truck earnings settled − instalments paid. Also opens / closes the agreement. */
async function recalcBalance(id: number, userId?: number) {
  const [ag] = await db.select().from(schema.partnerAgreements).where(eq(schema.partnerAgreements.id, id)).limit(1);
  if (!ag) return null;
  const [t] = await rowsOf(sql`select
      (select coalesce(sum(amount_to_company), 0) from partner_settlements where agreement_id = ${id} and not is_deleted)::int settled,
      (select coalesce(sum(amount), 0) from partner_installments where agreement_id = ${id} and not is_deleted)::int paid`);
  const currentBalance = Math.max(0, ag.openingBalance - Number(t.settled) - Number(t.paid));
  await db
    .update(schema.partnerAgreements)
    .set({
      currentBalance,
      status: currentBalance <= 0 ? "Settled" : ag.status === "Settled" ? "Active" : ag.status,
      closeDate: currentBalance <= 0 ? ag.closeDate || new Date() : null,
      updatedAt: new Date(),
      updatedBy: userId,
    })
    .where(eq(schema.partnerAgreements.id, id));
  return { currentBalance, settled: Number(t.settled), paid: Number(t.paid) };
}
const num = (v: any) => (v == null ? 0 : parseFloat(String(v)) || 0);

async function audit(req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", table: string, id: number, oldV: any, newV: any) {
  try {
    await logAudit({
      action,
      tableName: table,
      recordId: id,
      oldValues: oldV,
      newValues: newV,
      performedBy: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  } catch {
    /* audit must never break the request */
  }
}

// ---------------------------------------------------------------------------
// leakage / under-reporting engine — shared by settlements and the standalone
// GET /agreements/:id/leakage endpoint
// ---------------------------------------------------------------------------
async function analyseRevenue(opts: {
  vehicleId: number;
  from: Date;
  to: Date;
  declaredRevenue: number;
  totalExpenses: number;
  expenseRatioBenchmark: number;
}) {
  const { vehicleId, from, to, declaredRevenue, totalExpenses, expenseRatioBenchmark } = opts;

  // ---- (a) GPS / trip-history based expectation --------------------------
  const trips = await db
    .select({
      id: schema.trips.id,
      status: schema.trips.status,
      distance: schema.trips.distance,
      revenue: schema.trips.revenue,
      routeRevenue: schema.routes.revenue,
      routeDistance: schema.routes.distance,
      dep: schema.trips.departureTime,
    })
    .from(schema.trips)
    .leftJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
    .where(
      and(
        eq(schema.trips.isDeleted, false),
        eq(schema.trips.vehicleId, vehicleId),
        gte(schema.trips.departureTime, from),
        lte(schema.trips.departureTime, to)
      )
    );

  const realTrips = trips.filter((t) => t.status !== "Cancelled");
  const gpsExpectedRevenue = realTrips.reduce((s, t) => s + (t.routeRevenue ?? t.revenue ?? 0), 0);
  const tripCount = realTrips.length;

  // rupees of revenue per km actually run (route rate card), fleet fallback
  let revenuePerKm = 0;
  const withRate = realTrips.filter((t) => (t.routeDistance || t.distance) > 0);
  if (withRate.length) {
    revenuePerKm =
      withRate.reduce((s, t) => s + (t.routeRevenue ?? t.revenue ?? 0) / (t.routeDistance || t.distance), 0) / withRate.length;
  } else {
    const [avg] = await db
      .select({ r: sql<number>`coalesce(avg(${schema.routes.revenue}::float / nullif(${schema.routes.distance},0)),0)` })
      .from(schema.routes)
      .where(eq(schema.routes.isDeleted, false));
    revenuePerKm = num(avg?.r);
  }

  // odometer distance actually covered in the window (independent of trip records)
  const fills = await db
    .select({ odo: schema.fuelTransactions.odometer, litres: schema.fuelTransactions.litres, date: schema.fuelTransactions.transactionDate })
    .from(schema.fuelTransactions)
    .where(
      and(
        eq(schema.fuelTransactions.isDeleted, false),
        eq(schema.fuelTransactions.vehicleId, vehicleId),
        gte(schema.fuelTransactions.transactionDate, from),
        lte(schema.fuelTransactions.transactionDate, to)
      )
    )
    .orderBy(asc(schema.fuelTransactions.transactionDate));

  const totalLitres = fills.reduce((s, f) => s + num(f.litres), 0);
  let odoDistance = 0;
  for (let i = 1; i < fills.length; i++) {
    const d = (fills[i].odo ?? 0) - (fills[i - 1].odo ?? 0);
    if (d > 0 && d < 5000) odoDistance += d;
  }

  // ---- (b) fuel-implied expectation ------------------------------------
  const fuelImpliedKm = totalLitres * EXPECTED_KMPL;
  const distanceForEstimate = Math.max(fuelImpliedKm, odoDistance);
  const fuelImpliedRevenue = Math.round(distanceForEstimate * revenuePerKm);

  // ---- verdict --------------------------------------------------------
  const expectedRevenue = Math.max(gpsExpectedRevenue, fuelImpliedRevenue);
  const revenueVariancePercent =
    expectedRevenue > 0 ? Math.round(((expectedRevenue - declaredRevenue) / expectedRevenue) * 100) : 0;
  const expenseRatioPercent = declaredRevenue > 0 ? Math.round((totalExpenses / declaredRevenue) * 100) : 0;
  const healthyExpenses = Math.round(declaredRevenue * (expenseRatioBenchmark / 100));

  const flags: string[] = [];
  if (revenueVariancePercent > 35) flags.push("SEVERE_UNDER_REPORTING");
  else if (revenueVariancePercent > 15) flags.push("UNDER_REPORTED_REVENUE");
  if (expenseRatioPercent > expenseRatioBenchmark + 15) flags.push("EXPENSE_INFLATION");
  if (declaredRevenue - totalExpenses < 0) flags.push("NEGATIVE_NET");

  // how much better off the partner is than what the company was told
  const revenueSkim = Math.max(0, expectedRevenue - declaredRevenue);
  const expensePadding = Math.max(0, totalExpenses - healthyExpenses);
  const estimatedPartnerSkim = revenueSkim + expensePadding;

  return {
    window: { from: from.toISOString(), to: to.toISOString() },
    declaredRevenue,
    totalExpenses,
    tripCount,
    gps: { expectedRevenue: gpsExpectedRevenue, tripCount, revenuePerKm: +revenuePerKm.toFixed(2) },
    fuel: {
      litresDrawn: +totalLitres.toFixed(1),
      fuelImpliedKm: Math.round(fuelImpliedKm),
      odometerDistanceKm: Math.round(odoDistance),
      impliedRevenue: fuelImpliedRevenue,
    },
    expectedRevenue,
    revenueVariancePercent, // + => partner told us less than reality
    expenseRatioPercent,
    expenseRatioBenchmark,
    healthyExpenses,
    estimatedPartnerSkim,
    flags,
    verdict:
      flags.includes("SEVERE_UNDER_REPORTING")
        ? "Strong signs of under-reported revenue"
        : flags.length
        ? "Some discrepancy — review"
        : "Consistent with expectations",
  };
}

// ===========================================================================
// PARTNERS
// ===========================================================================
router.get("/partners", requireRole(READ_ROLES), async (_req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select()
      .from(schema.partners)
      .where(eq(schema.partners.isDeleted, false))
      .orderBy(desc(schema.partners.createdAt));
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/partners", requireRole(WRITE_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const { name, cnic, phone, email, address, notes } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    const [created] = await db
      .insert(schema.partners)
      .values({ name, cnic, phone, email, address, notes, createdBy: req.user?.id })
      .returning();
    await audit(req, "CREATE", "partners", created.id, null, created);
    res.status(201).json(created);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/partners/:id", requireRole(WRITE_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.partners).where(eq(schema.partners.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Partner not found" });
    const { name, cnic, phone, email, address, notes, status } = req.body;
    const [updated] = await db
      .update(schema.partners)
      .set({ name, cnic, phone, email, address, notes, status, updatedAt: new Date(), updatedBy: req.user?.id })
      .where(eq(schema.partners.id, id))
      .returning();
    await audit(req, "UPDATE", "partners", id, old, updated);
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// AGREEMENTS
// ===========================================================================
router.get("/agreements", requireRole(READ_ROLES), async (_req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        agreement: schema.partnerAgreements,
        partnerName: schema.partners.name,
        vehicleNumber: schema.vehicles.vehicleNumber,
      })
      .from(schema.partnerAgreements)
      .leftJoin(schema.partners, eq(schema.partnerAgreements.partnerId, schema.partners.id))
      .leftJoin(schema.vehicles, eq(schema.partnerAgreements.vehicleId, schema.vehicles.id))
      .where(eq(schema.partnerAgreements.isDeleted, false))
      .orderBy(desc(schema.partnerAgreements.createdAt));
    const today = pkToday();
    res.json(
      list.map((r) => {
        const sch = installmentSchedule(
          { opening: r.agreement.openingBalance, recovered: r.agreement.openingBalance - r.agreement.currentBalance, amount: r.agreement.installmentAmount, day: r.agreement.installmentDay, start: r.agreement.installmentStart },
          today,
        );
        return { ...row(r), plan: sch ? { count: sch.count, paidCount: sch.paidCount, overdueCount: sch.overdueCount, overdue: sch.overdue, ahead: sch.ahead, next: sch.next, lastDue: sch.lastDue } : null };
      }),
    );
    function row(r: (typeof list)[number]) {
      return {
        ...r.agreement,
        partnerName: r.partnerName,
        vehicleNumber: r.vehicleNumber,
        recoveredAmount: r.agreement.openingBalance - r.agreement.currentBalance,
        recoveryPercent:
          r.agreement.openingBalance > 0
            ? Math.round(((r.agreement.openingBalance - r.agreement.currentBalance) / r.agreement.openingBalance) * 100)
            : 100,
      };
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/agreements", requireRole(WRITE_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const { partnerId, vehicleId, agreedPrice, advancePaid, companySharePercent, expenseRatioBenchmark, startDate, notes } =
      req.body;
    if (!partnerId || !vehicleId || !agreedPrice) {
      return res.status(400).json({ error: "partnerId, vehicleId and agreedPrice are required" });
    }
    const price = Math.round(num(agreedPrice));
    const advance = Math.round(num(advancePaid));
    if (advance > price) return res.status(400).json({ error: "advancePaid cannot exceed agreedPrice" });
    const opening = price - advance;

    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.partnerAgreements);
    const agreementNumber = `PA-${new Date().getFullYear()}-${String(c + 1).padStart(4, "0")}`;

    const [created] = await db
      .insert(schema.partnerAgreements)
      .values({
        agreementNumber,
        partnerId: Number(partnerId),
        vehicleId: Number(vehicleId),
        agreedPrice: price,
        advancePaid: advance,
        openingBalance: opening,
        currentBalance: opening,
        companySharePercent: companySharePercent != null ? Math.round(num(companySharePercent)) : 100,
        expenseRatioBenchmark: expenseRatioBenchmark != null ? Math.round(num(expenseRatioBenchmark)) : 55,
        startDate: startDate ? new Date(startDate) : new Date(),
        installmentAmount: Math.round(num(req.body.installmentAmount)) || null,
        installmentDay: req.body.installmentDay ? Math.min(31, Math.max(1, Math.round(num(req.body.installmentDay)))) : null,
        installmentStart: isDay(req.body.installmentStart) ? req.body.installmentStart : null,
        status: opening <= 0 ? "Settled" : "Active",
        notes,
        createdBy: req.user?.id,
      })
      .returning();

    // mark the vehicle as partner-run
    await db
      .update(schema.vehicles)
      .set({ ownershipStatus: "Third-Party", updatedAt: new Date() })
      .where(eq(schema.vehicles.id, Number(vehicleId)));

    await audit(req, "CREATE", "partner_agreements", created.id, null, created);
    res.status(201).json(created);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// full statement + running balance for one agreement
router.get("/agreements/:id/ledger", requireRole(READ_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [ag] = await db
      .select({
        agreement: schema.partnerAgreements,
        partnerName: schema.partners.name,
        vehicleNumber: schema.vehicles.vehicleNumber,
      })
      .from(schema.partnerAgreements)
      .leftJoin(schema.partners, eq(schema.partnerAgreements.partnerId, schema.partners.id))
      .leftJoin(schema.vehicles, eq(schema.partnerAgreements.vehicleId, schema.vehicles.id))
      .where(eq(schema.partnerAgreements.id, id))
      .limit(1);
    if (!ag) return res.status(404).json({ error: "Agreement not found" });

    const settlements = await db
      .select()
      .from(schema.partnerSettlements)
      .where(and(eq(schema.partnerSettlements.agreementId, id), eq(schema.partnerSettlements.isDeleted, false)))
      .orderBy(asc(schema.partnerSettlements.createdAt));

    const installments = await rowsOf(sql`select i.id, to_char(i.pay_date, 'YYYY-MM-DD') pay_day, i.amount, i.method, i.reference, i.notes, i.cash_transaction_id, u.name by_name
      from partner_installments i left join users u on u.id = i.created_by where i.agreement_id = ${id} and not i.is_deleted order by i.pay_date, i.id`);
    const totalInstallments = installments.reduce((s, x) => s + Number(x.amount), 0);
    const schedule = installmentSchedule(
      { opening: ag.agreement.openingBalance, recovered: ag.agreement.openingBalance - ag.agreement.currentBalance, amount: ag.agreement.installmentAmount, day: ag.agreement.installmentDay, start: ag.agreement.installmentStart },
      pkToday(),
    );

    // every payment toward the truck's price, oldest first, with what is left after each (the qist list)
    const pay: Array<{ key: string; kind: "trip" | "cash"; date: string | null; label: string; detail: string; amount: number; settlementId?: number; installmentId?: number; flags?: string[] }> = [
      ...settlements.map((x) => ({
        key: `s${x.id}`,
        kind: "trip" as const,
        date: (x.periodTo || x.createdAt)?.toISOString?.().slice(0, 10) ?? null,
        label: `Trip earnings · ${x.settlementNumber}`,
        detail: `earned ${x.grossRevenue.toLocaleString()} − expenses ${x.totalExpenses.toLocaleString()} = ${x.netEarnings.toLocaleString()}${x.notes ? ` · ${x.notes}` : ""}`,
        amount: x.amountToCompany,
        settlementId: x.id,
        flags: (x.flags as string[]) || [],
      })),
      ...installments.map((x) => ({
        key: `i${x.id}`,
        kind: "cash" as const,
        date: x.pay_day as string,
        label: `Paid by him · ${x.method}`,
        detail: [x.reference, x.notes, x.cash_transaction_id ? "in Cash Book" : ""].filter(Boolean).join(" · "),
        amount: Number(x.amount),
        installmentId: x.id as number,
      })),
    ].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || a.key.localeCompare(b.key));
    let left = ag.agreement.openingBalance;
    const payments = pay.map((x, i) => {
      left = Math.max(0, left - x.amount);
      return { no: i + 1, ...x, balanceAfter: left };
    });

    // the truck's khata(s), and whether the 50/50 partnership has begun
    const khatas = await rowsOf(sql`select l.id, l.registration, l.partner_agreement_id, (select count(*) from truck_ledger_entries e where e.ledger_id = l.id and not e.is_deleted)::int n
      from truck_ledgers l where not l.is_deleted and (l.vehicle_id = ${ag.agreement.vehicleId} or l.partner_agreement_id = ${id})
      order by (l.partner_agreement_id = ${id}) desc nulls last, n desc`);
    const [pship] = khatas.length
      ? await rowsOf(sql`select pa.id, pa.truck_ledger_id, pa.partner_percent, p.name partner_name from partnership_accounts pa left join parties p on p.id = pa.partner_party_id
          where not pa.is_deleted and pa.truck_ledger_id = any(${`{${khatas.map((k) => k.id).join(",")}}`}::int[]) limit 1`)
      : [];

    const totalDeclaredRevenue = settlements.reduce((s, x) => s + x.grossRevenue, 0);
    const totalExpenses = settlements.reduce((s, x) => s + x.totalExpenses, 0);
    const totalNet = settlements.reduce((s, x) => s + x.netEarnings, 0);
    const totalRecovered = settlements.reduce((s, x) => s + x.amountToCompany, 0);
    const totalPartnerRetained = settlements.reduce((s, x) => s + x.partnerRetained, 0);
    const totalExpectedRevenue = settlements.reduce(
      (s, x) => s + Math.max(x.gpsExpectedRevenue || 0, x.fuelImpliedRevenue || 0),
      0
    );
    const totalSkim = settlements.reduce(
      (s, x) => s + Math.max(0, Math.max(x.gpsExpectedRevenue || 0, x.fuelImpliedRevenue || 0) - x.grossRevenue),
      0
    );

    res.json({
      agreement: {
        ...ag.agreement,
        partnerName: ag.partnerName,
        vehicleNumber: ag.vehicleNumber,
      },
      settlements,
      installments,
      schedule,
      payments,
      khataLedgerId: khatas[0]?.id ?? null,
      partnership: pship ? { id: pship.id, ledgerId: pship.truck_ledger_id, percent: pship.partner_percent, partnerName: pship.partner_name } : null,
      totals: {
        installments: installments.length,
        totalInstallments,
        settlements: settlements.length,
        totalDeclaredRevenue,
        totalExpenses,
        totalNet,
        totalRecovered,
        totalPartnerRetained,
        outstanding: ag.agreement.currentBalance,
        recoveryPercent:
          ag.agreement.openingBalance > 0
            ? Math.round(((ag.agreement.openingBalance - ag.agreement.currentBalance) / ag.agreement.openingBalance) * 100)
            : 100,
        totalExpectedRevenue,
        estimatedPartnerSkimToDate: totalSkim,
        revenueUnderReportPercent:
          totalExpectedRevenue > 0 ? Math.round(((totalExpectedRevenue - totalDeclaredRevenue) / totalExpectedRevenue) * 100) : 0,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * What the truck's khata says between two dates — kiraya received, and each kind of expense —
 * to fill in a trip's earnings. Default: from the day after the last settlement to today.
 */
router.get("/agreements/:id/khata-period", requireRole(READ_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [ag] = await db.select().from(schema.partnerAgreements).where(eq(schema.partnerAgreements.id, id)).limit(1);
    if (!ag) return res.status(404).json({ error: "Agreement not found" });
    const [last] = await rowsOf(sql`select to_char(max(period_to) + interval '1 day', 'YYYY-MM-DD') d from partner_settlements where agreement_id = ${id} and not is_deleted`);
    const from = isDay(req.query.from) ? (req.query.from as string) : last?.d || ag.startDate.toISOString().slice(0, 10);
    const to = isDay(req.query.to) ? (req.query.to as string) : pkToday();
    const lines = await rowsOf(sql`select coalesce(nullif(e.category, ''), 'Other') category, sum(e.received)::bigint received, sum(e.paid)::bigint paid, count(*)::int n
      from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
      where not e.is_deleted and not l.is_deleted and (l.vehicle_id = ${ag.vehicleId} or l.partner_agreement_id = ${id})
        and e.entry_date >= ${from}::timestamp and e.entry_date < (${to}::date + 1)::timestamp
        and coalesce(e.method, '') <> 'Opening' and coalesce(e.category, '') not in ('SafiBachat', 'Capital')
      group by 1 order by 1`);
    const revenue = lines.reduce((s, l) => s + Number(l.received), 0);
    const expenses = lines.filter((l) => Number(l.paid) > 0).map((l) => ({ type: l.category, amount: Number(l.paid) }));
    res.json({ from, to, revenue, expenses, totalExpenses: expenses.reduce((s, e) => s + e.amount, 0), entries: lines.reduce((s, l) => s + l.n, 0), byCategory: lines });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// standalone leakage check (does not write a settlement)
router.get("/agreements/:id/leakage", requireRole(READ_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [ag] = await db.select().from(schema.partnerAgreements).where(eq(schema.partnerAgreements.id, id)).limit(1);
    if (!ag) return res.status(404).json({ error: "Agreement not found" });

    const to = req.query.to ? new Date(req.query.to as string) : new Date();
    const from = req.query.from
      ? new Date(req.query.from as string)
      : new Date(to.getTime() - 30 * 864e5);

    // declared = settlements whose period overlaps the window (what the partner
    // has told us). Overlap on periodFrom/periodTo, falling back to createdAt.
    const declared = await db
      .select({
        g: schema.partnerSettlements.grossRevenue,
        e: schema.partnerSettlements.totalExpenses,
        pf: schema.partnerSettlements.periodFrom,
        pt: schema.partnerSettlements.periodTo,
        ca: schema.partnerSettlements.createdAt,
      })
      .from(schema.partnerSettlements)
      .where(and(eq(schema.partnerSettlements.agreementId, id), eq(schema.partnerSettlements.isDeleted, false)));
    const inWindow = declared.filter((x) => {
      const a = x.pf ? new Date(x.pf).getTime() : x.ca ? new Date(x.ca).getTime() : 0;
      const b = x.pt ? new Date(x.pt).getTime() : a;
      return b >= from.getTime() && a <= to.getTime();
    });
    const declaredRevenue = inWindow.reduce((s, x) => s + x.g, 0);
    const totalExpenses = inWindow.reduce((s, x) => s + x.e, 0);

    const analysis = await analyseRevenue({
      vehicleId: ag.vehicleId,
      from,
      to,
      declaredRevenue,
      totalExpenses,
      expenseRatioBenchmark: ag.expenseRatioBenchmark,
    });
    res.json({ agreementId: id, agreementNumber: ag.agreementNumber, ...analysis });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// SETTLEMENTS  — the core "he earns, deducts his cost, the rest comes to us"
// ===========================================================================
router.post("/agreements/:id/settlements", requireRole(WRITE_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [ag] = await db.select().from(schema.partnerAgreements).where(eq(schema.partnerAgreements.id, id)).limit(1);
    if (!ag) return res.status(404).json({ error: "Agreement not found" });
    if (ag.status === "Settled") return res.status(400).json({ error: "Agreement is already fully settled" });

    const { grossRevenue, expenses, tripId, periodFrom, periodTo, notes } = req.body;
    if (grossRevenue == null) return res.status(400).json({ error: "grossRevenue is required" });

    const gross = Math.round(num(grossRevenue));
    const expList: Array<{ type?: string; amount: number; note?: string }> = Array.isArray(expenses)
      ? expenses.map((e: any) => ({ type: e.type || "Misc", amount: Math.round(num(e.amount)), note: e.note || "" }))
      : [];
    const totalExpenses = expList.reduce((s, e) => s + e.amount, 0);
    const netEarnings = gross - totalExpenses;

    const share = ag.companySharePercent ?? 100;
    // all (or share%) of the POSITIVE net goes to the company, capped at the balance
    const shareOfNet = Math.max(0, Math.round((netEarnings * share) / 100));
    const amountToCompany = Math.min(shareOfNet, ag.currentBalance);
    const partnerRetained = netEarnings - amountToCompany;

    const balanceBefore = ag.currentBalance;
    const balanceAfter = Math.max(0, ag.currentBalance - amountToCompany);

    const to = periodTo ? new Date(periodTo) : new Date();
    const from = periodFrom ? new Date(periodFrom) : new Date(to.getTime() - 15 * 864e5);
    const analysis = await analyseRevenue({
      vehicleId: ag.vehicleId,
      from,
      to,
      declaredRevenue: gross,
      totalExpenses,
      expenseRatioBenchmark: ag.expenseRatioBenchmark,
    });

    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.partnerSettlements);
    const settlementNumber = `PS-${new Date().getFullYear()}-${String(c + 1).padStart(4, "0")}`;

    const [created] = await db
      .insert(schema.partnerSettlements)
      .values({
        settlementNumber,
        agreementId: id,
        tripId: tripId ? Number(tripId) : null,
        periodFrom: from,
        periodTo: to,
        grossRevenue: gross,
        declaredExpenses: expList,
        totalExpenses,
        netEarnings,
        amountToCompany,
        partnerRetained,
        balanceBefore,
        balanceAfter,
        gpsExpectedRevenue: analysis.gps.expectedRevenue,
        fuelImpliedRevenue: analysis.fuel.impliedRevenue,
        revenueVariancePercent: analysis.revenueVariancePercent,
        expenseRatioPercent: analysis.expenseRatioPercent,
        flags: analysis.flags,
        notes,
        createdBy: req.user?.id,
      })
      .returning();

    const newStatus = balanceAfter <= 0 ? "Settled" : ag.status;
    await db
      .update(schema.partnerAgreements)
      .set({
        currentBalance: balanceAfter,
        status: newStatus,
        closeDate: balanceAfter <= 0 ? new Date() : ag.closeDate,
        updatedAt: new Date(),
        updatedBy: req.user?.id,
      })
      .where(eq(schema.partnerAgreements.id, id));

    await audit(req, "CREATE", "partner_settlements", created.id, null, created);

    if (analysis.flags.length) {
      SocketServer.emit("notification", {
        type: "Partnership",
        title: `Settlement ${settlementNumber} flagged`,
        message: `${ag.agreementNumber}: ${analysis.flags.join(", ")} — est. partner skim PKR ${analysis.estimatedPartnerSkim.toLocaleString()}`,
      });
    }

    res.status(201).json({
      settlement: created,
      agreement: { id, balanceBefore, balanceAfter, status: newStatus },
      analysis,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// EDIT / DELETE — partners, agreements, and taking back a settlement
// ===========================================================================
router.delete("/partners/:id", requireRole(WRITE_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.partners).where(eq(schema.partners.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Partner not found" });
    const [agr] = await db
      .select({ id: schema.partnerAgreements.id })
      .from(schema.partnerAgreements)
      .where(and(eq(schema.partnerAgreements.partnerId, id), eq(schema.partnerAgreements.isDeleted, false)))
      .limit(1);
    if (agr) return res.status(400).json({ error: "This partner has an agreement — delete the agreement first · پہلے معاہدہ حذف کریں" });
    await db.update(schema.partners).set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(schema.partners.id, id));
    await audit(req, "DELETE", "partners", id, old, null);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Edit an agreement's terms; the outstanding balance is worked out again from its settlements. */
router.put("/agreements/:id", requireRole(WRITE_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.partnerAgreements).where(and(eq(schema.partnerAgreements.id, id), eq(schema.partnerAgreements.isDeleted, false))).limit(1);
    if (!old) return res.status(404).json({ error: "Agreement not found" });
    const b = req.body || {};
    const n = (v: any, d: number) => (v === undefined || v === "" ? d : Math.max(0, Math.round(Number(v) || 0)));
    const agreedPrice = n(b.agreedPrice, old.agreedPrice);
    const advancePaid = n(b.advancePaid, old.advancePaid);
    // the opening balance is re-worked only when the price or the advance is changed (an imported
    // agreement keeps the balance it came with when only its plan or notes are edited)
    const moneyChanged = agreedPrice !== old.agreedPrice || advancePaid !== old.advancePaid;
    const openingBalance = moneyChanged ? Math.max(0, agreedPrice - advancePaid) : old.openingBalance;
    const [rec] = await rowsOf(sql`select
        (select coalesce(sum(amount_to_company), 0) from partner_settlements where agreement_id = ${id} and not is_deleted)::int
      + (select coalesce(sum(amount), 0) from partner_installments where agreement_id = ${id} and not is_deleted)::int s`);
    const currentBalance = Math.max(0, openingBalance - Number(rec?.s || 0));
    const plan = {
      installmentAmount: b.installmentAmount === undefined ? old.installmentAmount : b.installmentAmount === "" || b.installmentAmount == null ? null : Math.max(0, Math.round(Number(b.installmentAmount) || 0)) || null,
      installmentDay: b.installmentDay === undefined ? old.installmentDay : b.installmentDay === "" || b.installmentDay == null ? null : Math.min(31, Math.max(1, Math.round(Number(b.installmentDay) || 1))),
      installmentStart: b.installmentStart === undefined ? old.installmentStart : isDay(b.installmentStart) ? b.installmentStart : null,
    };
    const [updated] = await db
      .update(schema.partnerAgreements)
      .set({
        partnerId: b.partnerId ? Number(b.partnerId) : old.partnerId,
        vehicleId: b.vehicleId ? Number(b.vehicleId) : old.vehicleId,
        agreedPrice,
        advancePaid,
        openingBalance,
        currentBalance,
        companySharePercent: Math.min(100, n(b.companySharePercent, old.companySharePercent)),
        expenseRatioBenchmark: Math.min(100, n(b.expenseRatioBenchmark, old.expenseRatioBenchmark)),
        startDate: b.startDate ? new Date(b.startDate) : old.startDate,
        ...plan,
        notes: b.notes !== undefined ? String(b.notes || "") || null : old.notes,
        status: currentBalance <= 0 ? "Settled" : old.status === "Settled" ? "Active" : old.status,
        closeDate: currentBalance <= 0 ? old.closeDate || new Date() : null,
        updatedAt: new Date(),
        updatedBy: req.user?.id,
      })
      .where(eq(schema.partnerAgreements.id, id))
      .returning();
    await audit(req, "UPDATE", "partner_agreements", id, old, updated);
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * An instalment received from the partner. Cash can also be written into the Daily Cash Book
 * (money In) in the same step, so the drawer's balance is right.
 */
router.post("/agreements/:id/installments", requireRole(WRITE_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [ag] = await db
      .select({ a: schema.partnerAgreements, partnerName: schema.partners.name, vehicleNumber: schema.vehicles.vehicleNumber })
      .from(schema.partnerAgreements)
      .leftJoin(schema.partners, eq(schema.partnerAgreements.partnerId, schema.partners.id))
      .leftJoin(schema.vehicles, eq(schema.partnerAgreements.vehicleId, schema.vehicles.id))
      .where(and(eq(schema.partnerAgreements.id, id), eq(schema.partnerAgreements.isDeleted, false)))
      .limit(1);
    if (!ag) return res.status(404).json({ error: "Agreement not found" });
    const b = req.body || {};
    const amount = Math.round(Number(b.amount) || 0);
    if (!(amount > 0)) return res.status(400).json({ error: "Enter the amount received · رقم درج کریں" });
    if (amount > ag.a.currentBalance)
      return res.status(400).json({ error: `Only PKR ${ag.a.currentBalance.toLocaleString()} is still owed on this truck · باقی رقم سے زیادہ نہیں ہو سکتا` });
    const day = isDay(b.date) ? b.date : pkToday();
    const method = ["Cash", "Online", "Cheque", "Bank Transfer"].includes(b.method) ? b.method : "Cash";
    let cashId: number | null = null;
    if (b.toCashBook && method === "Cash") {
      const c = await selfApi(req, "POST", "/api/cash-book", {
        entryDate: `${day}T12:00:00`,
        direction: "In",
        amount,
        person: ag.partnerName || "Partner",
        description: `Qist / instalment — ${ag.vehicleNumber || ""} (${ag.a.agreementNumber})${b.reference ? ` · ${b.reference}` : ""}`,
      });
      cashId = c?.id ?? null;
    }
    const [inst] = await rowsOf(sql`insert into partner_installments (agreement_id, pay_date, amount, method, reference, notes, cash_transaction_id, created_by)
      values (${id}, ${`${day}T12:00:00`}::timestamp, ${amount}, ${method}, ${b.reference || null}, ${b.notes || null}, ${cashId}, ${req.user?.id ?? null}) returning *`);
    const bal = await recalcBalance(id, req.user?.id);
    await audit(req, "CREATE", "partner_installments", inst.id, null, inst);
    res.status(201).json({ installment: inst, currentBalance: bal?.currentBalance, cashBookEntry: cashId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Take an instalment back (typed by mistake). Its Cash Book entry, if it made one, goes too. */
router.delete("/agreements/:id/installments/:iid", requireRole(WRITE_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [inst] = await rowsOf(sql`update partner_installments set is_deleted = true where id = ${parseInt(req.params.iid)} and agreement_id = ${id} and not is_deleted returning *`);
    if (!inst) return res.status(404).json({ error: "Instalment not found" });
    let cashNote: string | null = null;
    if (inst.cash_transaction_id) {
      await selfApi(req, "DELETE", `/api/cash-book/${inst.cash_transaction_id}`).catch((e: any) => {
        cashNote = `Its Cash Book entry could not be removed (${e.message}) — delete it there`;
      });
    }
    const bal = await recalcBalance(id, req.user?.id);
    await audit(req, "DELETE", "partner_installments", inst.id, inst, null);
    res.json({ ok: true, currentBalance: bal?.currentBalance, warning: cashNote });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Delete an agreement made by mistake, with its settlements. */
router.delete("/agreements/:id", requireRole(WRITE_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.partnerAgreements).where(and(eq(schema.partnerAgreements.id, id), eq(schema.partnerAgreements.isDeleted, false))).limit(1);
    if (!old) return res.status(404).json({ error: "Agreement not found" });
    const gone = await db
      .update(schema.partnerSettlements)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id })
      .where(and(eq(schema.partnerSettlements.agreementId, id), eq(schema.partnerSettlements.isDeleted, false)))
      .returning({ id: schema.partnerSettlements.id });
    await db.update(schema.partnerAgreements).set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(schema.partnerAgreements.id, id));
    // a khata pointing at this agreement no longer does
    await db.update(schema.truckLedgers).set({ partnerAgreementId: null }).where(eq(schema.truckLedgers.partnerAgreementId, id));
    await audit(req, "DELETE", "partner_agreements", id, { ...old, settlementsRemoved: gone.length }, null);
    res.json({ ok: true, settlementsRemoved: gone.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Take back the latest settlement of an agreement (balances run in order, so only the last). */
router.delete("/agreements/:id/settlements/:sid", requireRole(WRITE_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const sid = parseInt(req.params.sid);
    const [last] = await db
      .select()
      .from(schema.partnerSettlements)
      .where(and(eq(schema.partnerSettlements.agreementId, id), eq(schema.partnerSettlements.isDeleted, false)))
      .orderBy(desc(schema.partnerSettlements.id))
      .limit(1);
    if (!last) return res.status(404).json({ error: "No settlement to take back" });
    if (last.id !== sid) return res.status(400).json({ error: "Only the latest settlement can be taken back — take back the newer ones first · پہلے بعد والی واپس لیں" });
    await db.update(schema.partnerSettlements).set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(schema.partnerSettlements.id, sid));
    // worked out again from everything that is left (an instalment may have been paid since)
    const bal = await recalcBalance(id, req.user?.id);
    await audit(req, "DELETE", "partner_settlements", sid, last, null);
    res.json({ ok: true, currentBalance: bal?.currentBalance ?? last.balanceBefore });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// PORTFOLIO SUMMARY
// ===========================================================================
router.get("/summary", requireRole(READ_ROLES), async (_req: AuthRequest, res: Response) => {
  try {
    const agreements = await db
      .select({
        agreement: schema.partnerAgreements,
        partnerName: schema.partners.name,
        vehicleNumber: schema.vehicles.vehicleNumber,
      })
      .from(schema.partnerAgreements)
      .leftJoin(schema.partners, eq(schema.partnerAgreements.partnerId, schema.partners.id))
      .leftJoin(schema.vehicles, eq(schema.partnerAgreements.vehicleId, schema.vehicles.id))
      .where(eq(schema.partnerAgreements.isDeleted, false));

    const ids = agreements.map((a) => a.agreement.id);
    const settlements = ids.length
      ? await db
          .select()
          .from(schema.partnerSettlements)
          .where(and(inArray(schema.partnerSettlements.agreementId, ids), eq(schema.partnerSettlements.isDeleted, false)))
      : [];

    const byAgreement = new Map<number, typeof settlements>();
    for (const s of settlements) {
      if (!byAgreement.has(s.agreementId)) byAgreement.set(s.agreementId, []);
      byAgreement.get(s.agreementId)!.push(s);
    }

    const rows = agreements.map((a) => {
      const ss = byAgreement.get(a.agreement.id) || [];
      const recovered = a.agreement.openingBalance - a.agreement.currentBalance;
      const declared = ss.reduce((s, x) => s + x.grossRevenue, 0);
      const expected = ss.reduce(
        (s, x) => s + Math.max(x.gpsExpectedRevenue || 0, x.fuelImpliedRevenue || 0),
        0
      );
      const skim = Math.max(0, expected - declared);
      const flagged = ss.filter((x) => Array.isArray(x.flags) && (x.flags as string[]).length).length;
      return {
        agreementId: a.agreement.id,
        agreementNumber: a.agreement.agreementNumber,
        partnerName: a.partnerName,
        vehicleNumber: a.vehicleNumber,
        agreedPrice: a.agreement.agreedPrice,
        advancePaid: a.agreement.advancePaid,
        openingBalance: a.agreement.openingBalance,
        currentBalance: a.agreement.currentBalance,
        recoveredAmount: recovered,
        recoveryPercent: a.agreement.openingBalance > 0 ? Math.round((recovered / a.agreement.openingBalance) * 100) : 100,
        status: a.agreement.status,
        settlements: ss.length,
        declaredRevenue: declared,
        expectedRevenue: expected,
        estimatedPartnerSkim: skim,
        flaggedSettlements: flagged,
      };
    });

    res.json({
      portfolio: {
        agreements: rows.length,
        active: rows.filter((r) => r.status === "Active").length,
        settled: rows.filter((r) => r.status === "Settled").length,
        totalFinanced: rows.reduce((s, r) => s + r.openingBalance, 0),
        totalRecovered: rows.reduce((s, r) => s + r.recoveredAmount, 0),
        totalOutstanding: rows.reduce((s, r) => s + r.currentBalance, 0),
        totalEstimatedSkim: rows.reduce((s, r) => s + r.estimatedPartnerSkim, 0),
        agreementsWithFlags: rows.filter((r) => r.flaggedSettlements > 0).length,
      },
      agreements: rows.sort((a, b) => b.estimatedPartnerSkim - a.estimatedPartnerSkim),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
