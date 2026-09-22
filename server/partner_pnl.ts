/**
 * Partner P&L split — for a half-half (or any %) co-owned truck.
 *
 * Flow: pick the partnership truck + a period → the system pulls every rupee in
 * and out of that truck's khata (freight in; fuel / maintenance / tyre / oil /
 * salary / tolls … out), computes the net profit or loss, and splits it by the
 * agreed share. Then "post the partner's share" writes one entry into that
 * partner's running account (Party Ledger / khata) so you always know how much
 * you owe the partner (or he owes you), and how much you have already paid him.
 *
 *   GET  /api/partner-pnl/vehicles                 - partnership trucks + their partner + share
 *   GET  /api/partner-pnl/statement?ledgerId&from&to&partnerPercent
 *   POST /api/partner-pnl/post-share  { ledgerId, partyId, from, to, partnerPercent, note }
 *   POST /api/partner-pnl/partner-party { name }   - make a Party (khata) row for a partner
 */
import { Router, Response } from "express";
import { and, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { sendSms, ledgerSmsText, ledgerSmsTokens } from "./sms.ts";
import { recompute as recomputeParty } from "./parties.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Operations Manager", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];

// categories that are NOT operating income / cost
const REVENUE_EXCLUDE = new Set(["Capital", "SafiBachat"]);
const COST_EXCLUDE = new Set(["Capital", "SafiBachat", "OnlineTransfer"]);

router.get("/vehicles", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  // partnership trucks from agreements + any khata flagged isPartnership
  const agr = await db
    .select({
      agreementId: schema.partnerAgreements.id,
      agreementNumber: schema.partnerAgreements.agreementNumber,
      companySharePercent: schema.partnerAgreements.companySharePercent,
      partnerId: schema.partners.id,
      partnerName: schema.partners.name,
      partnerPhone: schema.partners.phone,
      vehicleId: schema.vehicles.id,
      vehicleNumber: schema.vehicles.vehicleNumber,
    })
    .from(schema.partnerAgreements)
    .leftJoin(schema.partners, eq(schema.partnerAgreements.partnerId, schema.partners.id))
    .leftJoin(schema.vehicles, eq(schema.partnerAgreements.vehicleId, schema.vehicles.id))
    .where(eq(schema.partnerAgreements.isDeleted, false));

  const ledgers = await db
    .select({ id: schema.truckLedgers.id, vehicleId: schema.truckLedgers.vehicleId, registration: schema.truckLedgers.registration, title: schema.truckLedgers.title, isPartnership: schema.truckLedgers.isPartnership, ownerName: schema.truckLedgers.ownerName })
    .from(schema.truckLedgers)
    .where(eq(schema.truckLedgers.isDeleted, false));
  const ledgerByVehicle = new Map(ledgers.filter((l) => l.vehicleId).map((l) => [l.vehicleId as number, l]));

  const rows = agr.map((a) => {
    const led = a.vehicleId ? ledgerByVehicle.get(a.vehicleId) : undefined;
    const companyPct = a.companySharePercent ?? 100;
    return {
      agreementId: a.agreementId,
      agreementNumber: a.agreementNumber,
      partnerId: a.partnerId,
      partnerName: a.partnerName,
      partnerPhone: a.partnerPhone,
      vehicleId: a.vehicleId,
      vehicleNumber: a.vehicleNumber || led?.registration,
      ledgerId: led?.id ?? null,
      ledgerTitle: led?.title,
      companySharePercent: companyPct,
      partnerSharePercent: 100 - companyPct,
    };
  });

  // index the agreement rows by ledger (prefer one with a real partner share)
  const agrByLedger = new Map<number, any>();
  for (const r of rows) {
    if (!r.ledgerId) continue;
    const cur = agrByLedger.get(r.ledgerId);
    if (!cur || r.partnerSharePercent > cur.partnerSharePercent) agrByLedger.set(r.ledgerId, r);
  }

  // return EVERY truck khata so the user can pick any truck — partnership ones
  // are marked and carry the partner + share; the rest can be run ad-hoc.
  const deduped = ledgers
    .map((l) => {
      const a = agrByLedger.get(l.id);
      const isP = !!l.isPartnership || !!a;
      return {
        agreementId: a?.agreementId ?? null,
        agreementNumber: a?.agreementNumber ?? null,
        partnerId: a?.partnerId ?? null,
        partnerName: a?.partnerName || (l.isPartnership ? l.ownerName || null : null),
        partnerPhone: a?.partnerPhone ?? null,
        vehicleId: l.vehicleId,
        vehicleNumber: a?.vehicleNumber || l.registration,
        ledgerId: l.id,
        ledgerTitle: l.title,
        ownerName: l.ownerName,
        isPartnership: isP,
        companySharePercent: a ? a.companySharePercent : isP ? 50 : 100,
        partnerSharePercent: a ? a.partnerSharePercent : isP ? 50 : 0,
      };
    })
    .sort((x, y) => {
      // partnership trucks first, then by registration
      if (x.isPartnership !== y.isPartnership) return x.isPartnership ? -1 : 1;
      return (x.vehicleNumber || "").localeCompare(y.vehicleNumber || "");
    });

  // partner-type parties available for the khata link
  const parties = await db
    .select({ id: schema.parties.id, name: schema.parties.name, type: schema.parties.type, balance: schema.parties.closingBalance })
    .from(schema.parties)
    .where(and(eq(schema.parties.isDeleted, false), inArray(schema.parties.type, ["Broker", "Transporter", "Agent", "Other", "Lender", "Borrower"])));

  res.json({ vehicles: deduped, parties });
});

async function computeStatement(ledgerId: number, from: Date | null, to: Date | null, partnerPercent: number) {
  // `to` is treated as inclusive of the whole day
  const toEnd = to ? new Date(to.getTime() + 24 * 3600_000 - 1) : null;

  const cond = [eq(schema.truckLedgerEntries.ledgerId, ledgerId), eq(schema.truckLedgerEntries.isDeleted, false)];
  if (from) cond.push(gte(schema.truckLedgerEntries.entryDate, from));
  if (toEnd) cond.push(lte(schema.truckLedgerEntries.entryDate, toEnd));

  const cats = await db
    .select({
      category: schema.truckLedgerEntries.category,
      received: sql<number>`coalesce(sum(${schema.truckLedgerEntries.received}),0)::bigint`,
      paid: sql<number>`coalesce(sum(${schema.truckLedgerEntries.paid}),0)::bigint`,
      entries: sql<number>`count(*)::int`,
    })
    .from(schema.truckLedgerEntries)
    .where(and(...cond))
    .groupBy(schema.truckLedgerEntries.category);

  let revenue = 0;
  let cost = 0;
  const lines = cats.map((c) => {
    const rec = Number(c.received);
    const pd = Number(c.paid);
    const inRevenue = !REVENUE_EXCLUDE.has(c.category);
    const inCost = !COST_EXCLUDE.has(c.category);
    if (inRevenue) revenue += rec;
    if (inCost) cost += pd;
    return { category: c.category, received: rec, paid: pd, entries: c.entries, countedRevenue: inRevenue, countedCost: inCost };
  });
  lines.sort((a, b) => b.paid - a.paid || b.received - a.received);

  // full date coverage of this ledger + count of entries with no date at all
  const [cover] = await db
    .select({
      minDate: sql<string>`min(${schema.truckLedgerEntries.entryDate})`,
      maxDate: sql<string>`max(${schema.truckLedgerEntries.entryDate})`,
      total: sql<number>`count(*)::int`,
      dated: sql<number>`count(${schema.truckLedgerEntries.entryDate})::int`,
    })
    .from(schema.truckLedgerEntries)
    .where(and(eq(schema.truckLedgerEntries.ledgerId, ledgerId), eq(schema.truckLedgerEntries.isDeleted, false)));

  const entriesInPeriod = lines.reduce((s, l) => s + l.entries, 0);
  const net = revenue - cost;
  const pct = Math.max(0, Math.min(100, partnerPercent));
  const partnerShare = Math.round((net * pct) / 100);
  const companyShare = net - partnerShare;

  return {
    period: { from: from?.toISOString() || null, to: to?.toISOString() || null },
    partnerPercent: pct,
    lines,
    entriesInPeriod,
    coverage: {
      minDate: cover?.minDate || null,
      maxDate: cover?.maxDate || null,
      totalEntries: cover?.total || 0,
      undatedEntries: (cover?.total || 0) - (cover?.dated || 0),
    },
    totals: { revenue, cost, net, result: net >= 0 ? "profit" : "loss", partnerShare, companyShare },
  };
}

router.get("/statement", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const ledgerId = Number(req.query.ledgerId);
    if (!ledgerId) return res.status(400).json({ error: "ledgerId is required" });
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const partnerPercent = Number(req.query.partnerPercent ?? 50);
    const [led] = await db.select().from(schema.truckLedgers).where(eq(schema.truckLedgers.id, ledgerId)).limit(1);
    if (!led) return res.status(404).json({ error: "Truck ledger not found" });
    const stmt = await computeStatement(ledgerId, from, to, partnerPercent);
    res.json({ ledger: { id: led.id, registration: led.registration, title: led.title }, ...stmt });
  } catch (e: any) {
    console.error("[partner-pnl] statement failed:", e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/partner-party", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.parties);
    const [created] = await db
      .insert(schema.parties)
      .values({
        partyCode: `PTY-${String((n || 0) + 1).padStart(4, "0")}`,
        name,
        type: "Other",
        notes: "Partnership co-owner",
        status: "Active",
        createdBy: req.user?.id,
      })
      .returning();
    res.status(201).json(created);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/post-share", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const { ledgerId, partyId, from, to, partnerPercent, note } = req.body || {};
    if (!ledgerId || !partyId) return res.status(400).json({ error: "ledgerId and partyId are required" });
    const [led] = await db.select().from(schema.truckLedgers).where(eq(schema.truckLedgers.id, Number(ledgerId))).limit(1);
    const [party] = await db.select().from(schema.parties).where(eq(schema.parties.id, Number(partyId))).limit(1);
    if (!led || !party) return res.status(404).json({ error: "Ledger or party not found" });

    const fromD = from ? new Date(from) : null;
    const toD = to ? new Date(to) : null;
    const stmt = await computeStatement(Number(ledgerId), fromD, toD, Number(partnerPercent ?? 50));
    const share = stmt.totals.partnerShare;
    if (share === 0) return res.status(400).json({ error: "Partner share is zero for this period — nothing to post." });

    const periodLabel =
      (fromD ? fromD.toISOString().slice(0, 10) : "start") + " to " + (toD ? toD.toISOString().slice(0, 10) : "now");
    const desc =
      `Profit share ${periodLabel} — Truck ${led.registration}: ` +
      `revenue ${stmt.totals.revenue.toLocaleString()} - cost ${stmt.totals.cost.toLocaleString()} = ` +
      `net ${stmt.totals.net.toLocaleString()} x ${stmt.partnerPercent}% = ${share.toLocaleString()}` +
      (note ? ` (${note})` : "");

    // net profit  -> we owe the partner his share  -> CREDIT (jama)  -> balance goes -ve = "party ko dena"
    // net loss    -> partner owes us his share     -> DEBIT (naam)   -> balance goes +ve = "party se lena"
    const isProfit = stmt.totals.net >= 0;
    const [entry] = await db
      .insert(schema.partyLedgerEntries)
      .values({
        partyId: Number(partyId),
        entryDate: toD || new Date(),
        rawDate: (toD || new Date()).toISOString().slice(0, 10),
        description: desc,
        method: "Adjustment",
        debit: isProfit ? 0 : Math.abs(share),
        credit: isProfit ? Math.abs(share) : 0,
        category: "Partnership",
        sectionLabel: "Profit share",
        createdBy: req.user?.id,
      })
      .returning();
    const newBalance = await recomputeParty(Number(partyId));

    await logAudit({
      action: "CREATE",
      tableName: "party_ledger_entries",
      recordId: entry.id,
      newValues: { partnershipShare: share, ledgerId, net: stmt.totals.net },
      performedBy: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    }).catch(() => {});

    // SMS the partner (if they opted in) — this postings bypasses the normal
    // party-entry route, so it needs its own notification, same as any other
    // credit/debit on their khata.
    if (party.smsAlerts && party.phone) {
      const ledgerParams = {
        who: party.name,
        debit: entry.debit || 0,
        credit: entry.credit || 0,
        balance: newBalance,
        ref: led.registration,
        date: entry.rawDate,
      };
      sendSms({
        to: party.phone,
        body: ledgerSmsText(ledgerParams),
        tokens: ledgerSmsTokens(ledgerParams),
        relatedType: "party_ledger_entry",
        relatedId: entry.id,
        partyId: Number(partyId),
        createdBy: req.user?.id,
      }).catch(() => {});
    }

    res.status(201).json({
      entry,
      statement: stmt,
      partyId: Number(partyId),
      newBalance,
      balanceLabel:
        newBalance > 0
          ? `Partner se lena: PKR ${Math.abs(newBalance).toLocaleString()}`
          : newBalance < 0
          ? `Partner ko dena: PKR ${Math.abs(newBalance).toLocaleString()}`
          : "Clear",
    });
  } catch (e: any) {
    console.error("[partner-pnl] post-share failed:", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
