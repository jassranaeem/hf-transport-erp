/**
 * Partnerships — company-owned trucks run by outside partners on a
 * lease-to-own basis.
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

const router = Router();
router.use(requireAuth, requireApproved);

const READ_ROLES = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Operations Manager", "Auditor"];
const WRITE_ROLES = ["Super Admin", "Admin", "Finance Manager", "Operations Manager"];

const EXPECTED_KMPL = 3.5; // loaded long-haul truck
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
    res.json(
      list.map((r) => ({
        ...r.agreement,
        partnerName: r.partnerName,
        vehicleNumber: r.vehicleNumber,
        recoveredAmount: r.agreement.openingBalance - r.agreement.currentBalance,
        recoveryPercent:
          r.agreement.openingBalance > 0
            ? Math.round(((r.agreement.openingBalance - r.agreement.currentBalance) / r.agreement.openingBalance) * 100)
            : 100,
      }))
    );
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
      totals: {
        settlements: settlements.length,
        totalDeclaredRevenue,
        totalExpenses,
        totalNet,
        totalRecovered,
        totalPartnerRetained,
        outstanding: ag.agreement.currentBalance,
        recoveryPercent:
          ag.agreement.openingBalance > 0
            ? Math.round((totalRecovered / ag.agreement.openingBalance) * 100)
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
