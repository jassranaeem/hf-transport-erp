/**
 * Unified Alert Center — one feed for every "something is wrong" signal.
 *
 *   GET    /api/alerts                 -> normalised list + counts (acked hidden)
 *   GET    /api/alerts?includeAcked=1  -> include acknowledged / resolved
 *   POST   /api/alerts/ack             -> { alertKey, alertType, status, note }
 *   DELETE /api/alerts/ack/:key        -> un-acknowledge
 *
 * Sources: duplicate receipts (same file twice), fuel-theft alerts, ledger rows
 * flagged "needs review", overdue party dues, blocked parties we still owe, and
 * expiring vehicle / driver documents. Every alert carries a stable `key` so it
 * can be acknowledged, and `detail` / `links` so the UI can explain and jump.
 */
import { Router, Response } from "express";
import { and, eq, sql, desc, asc, inArray, isNotNull, ne } from "drizzle-orm";
import { requireAuth, requireApproved, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";

const router = Router();
router.use(requireAuth, requireApproved);

type Sev = "critical" | "high" | "medium" | "low";
interface Alert {
  key: string;
  type: string;
  severity: Sev;
  module: string;
  title: string;
  message: string;
  detail?: any;
  links?: { label: string; wb: string; sheet: string; focus?: { ledgerId?: number; partyId?: number } }[];
  count?: number;
  createdAt: string;
}

const SEV_RANK: Record<Sev, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const mapSev = (s: string): Sev => {
  const x = (s || "").toLowerCase();
  if (x === "critical") return "critical";
  if (x === "high") return "high";
  if (x === "low") return "low";
  return "medium";
};
const DAY = 86400_000;

// ---------------------------------------------------------------- collectors
async function duplicateReceiptAlerts(): Promise<Alert[]> {
  const groups = await db
    .select({
      sha: schema.attachments.sha256,
      n: sql<number>`count(*)::int`,
      ids: sql<number[]>`array_agg(${schema.attachments.id} order by ${schema.attachments.createdAt})`,
    })
    .from(schema.attachments)
    .where(and(isNotNull(schema.attachments.sha256), eq(schema.attachments.isDeleted, false)))
    .groupBy(schema.attachments.sha256)
    .having(sql`count(*) > 1`);

  if (!groups.length) return [];

  const allIds = groups.flatMap((g) => g.ids || []);
  const rows = await db
    .select()
    .from(schema.attachments)
    .where(inArray(schema.attachments.id, allIds));
  const byId = new Map(rows.map((r) => [r.id, r]));

  return groups.map((g) => {
    const items = (g.ids || []).map((id) => byId.get(id)).filter(Boolean) as (typeof rows)[number][];
    const first = items[0];
    return {
      key: `duplicate_receipt:${g.sha}`,
      type: "duplicate_receipt",
      severity: "high" as Sev,
      module: "Attachments",
      title: `Same receipt uploaded ${g.n} times`,
      message: `The exact same file "${first?.fileName || "file"}" is attached in ${g.n} places — possible double entry. · ایک ہی رسید ${g.n} جگہ لگی ہے — ڈبل انٹری کا شک۔`,
      count: g.n,
      createdAt: (items[items.length - 1]?.createdAt || new Date()).toString(),
      detail: {
        sha256: g.sha,
        copies: items.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          entityType: a.entityType,
          entityId: a.entityId,
          uploadedAt: a.createdAt,
          fileUrl: `/api/attachments/${a.id}/file`,
        })),
      },
      links: [{ label: "Open Attachments audit", wb: "insights", sheet: "alerts" }],
    };
  });
}

/**
 * Duplicate ENTRY detection — the "yeh banda double dey raha hai" check.
 * Same party / same truck, same amount, same date, same reference (bilty /
 * cheque / invoice no.) recorded more than once = someone submitting the same
 * slip twice. Fires even when the attached photo bytes differ.
 */
async function duplicateEntryAlerts(): Promise<Alert[]> {
  const out: Alert[] = [];

  // ---- party ledger ----
  const pAmt = sql`case when ${schema.partyLedgerEntries.debit} > 0 then ${schema.partyLedgerEntries.debit} else ${schema.partyLedgerEntries.credit} end`;
  const pGroups = await db
    .select({
      partyId: schema.partyLedgerEntries.partyId,
      amt: sql<number>`(${pAmt})::bigint`,
      day: sql<string>`to_char(${schema.partyLedgerEntries.entryDate}, 'YYYY-MM-DD')`,
      ref: sql<string>`lower(coalesce(nullif(trim(${schema.partyLedgerEntries.refNo}), ''), nullif(trim(${schema.partyLedgerEntries.description}), ''), ''))`,
      n: sql<number>`count(*)::int`,
      ids: sql<number[]>`array_agg(${schema.partyLedgerEntries.id} order by ${schema.partyLedgerEntries.id})`,
    })
    .from(schema.partyLedgerEntries)
    .where(and(eq(schema.partyLedgerEntries.isDeleted, false), isNotNull(schema.partyLedgerEntries.entryDate), sql`(${pAmt}) > 0`))
    .groupBy(schema.partyLedgerEntries.partyId, sql`(${pAmt})`, sql`to_char(${schema.partyLedgerEntries.entryDate}, 'YYYY-MM-DD')`, sql`lower(coalesce(nullif(trim(${schema.partyLedgerEntries.refNo}), ''), nullif(trim(${schema.partyLedgerEntries.description}), ''), ''))`)
    .having(sql`count(*) > 1`);

  if (pGroups.length) {
    const pids = [...new Set(pGroups.map((g) => g.partyId))];
    const parties = await db
      .select({ id: schema.parties.id, name: schema.parties.name })
      .from(schema.parties)
      .where(inArray(schema.parties.id, pids));
    const pName = new Map(parties.map((p) => [p.id, p.name]));
    for (const g of pGroups) {
      out.push({
        key: `duplicate_entry:party:${g.partyId}:${g.amt}:${g.day}:${g.ref}`,
        type: "duplicate_entry",
        severity: "high",
        module: "Khata",
        title: `Same slip entered ${g.n}× — ${pName.get(g.partyId) || "party"}`,
        message: `PKR ${Number(g.amt).toLocaleString()} on ${g.day}${g.ref ? ` (ref "${g.ref}")` : ""} recorded ${g.n} times for the same party — possible double claim. · ایک ہی رقم، تاریخ اور حوالہ ${g.n} بار — ڈبل کا شک۔`,
        count: g.n,
        createdAt: new Date().toString(),
        detail: { scope: "party", partyId: g.partyId, party: pName.get(g.partyId), amount: Number(g.amt), date: g.day, ref: g.ref, entryIds: g.ids },
        links: [{ label: `Open ${pName.get(g.partyId) || "party"}'s khata`, wb: "khata", sheet: "parties", focus: { partyId: g.partyId } }],
      });
    }
  }

  // ---- truck ledger ----
  const tAmt = sql`case when ${schema.truckLedgerEntries.received} > 0 then ${schema.truckLedgerEntries.received} else ${schema.truckLedgerEntries.paid} end`;
  const tGroups = await db
    .select({
      ledgerId: schema.truckLedgerEntries.ledgerId,
      amt: sql<number>`(${tAmt})::bigint`,
      day: sql<string>`to_char(${schema.truckLedgerEntries.entryDate}, 'YYYY-MM-DD')`,
      ref: sql<string>`lower(coalesce(nullif(trim(${schema.truckLedgerEntries.description}), ''), ''))`,
      n: sql<number>`count(*)::int`,
      ids: sql<number[]>`array_agg(${schema.truckLedgerEntries.id} order by ${schema.truckLedgerEntries.id})`,
    })
    .from(schema.truckLedgerEntries)
    .where(and(eq(schema.truckLedgerEntries.isDeleted, false), isNotNull(schema.truckLedgerEntries.entryDate), sql`(${tAmt}) > 0`))
    .groupBy(schema.truckLedgerEntries.ledgerId, sql`(${tAmt})`, sql`to_char(${schema.truckLedgerEntries.entryDate}, 'YYYY-MM-DD')`, sql`lower(coalesce(nullif(trim(${schema.truckLedgerEntries.description}), ''), ''))`)
    .having(sql`count(*) > 1`);

  if (tGroups.length) {
    const lids = [...new Set(tGroups.map((g) => g.ledgerId))];
    const ledgers = await db
      .select({ id: schema.truckLedgers.id, reg: schema.truckLedgers.registration })
      .from(schema.truckLedgers)
      .where(inArray(schema.truckLedgers.id, lids));
    const lName = new Map(ledgers.map((l) => [l.id, l.reg]));
    for (const g of tGroups) {
      if (!g.ref) continue; // no description → too weak a signal on truck khatas
      out.push({
        key: `duplicate_entry:truck:${g.ledgerId}:${g.amt}:${g.day}:${g.ref}`,
        type: "duplicate_entry",
        severity: "high",
        module: "Khata",
        title: `Same slip entered ${g.n}× — Truck ${lName.get(g.ledgerId) || ""}`,
        message: `PKR ${Number(g.amt).toLocaleString()} on ${g.day} "${g.ref}" recorded ${g.n} times on the same truck — possible double. · ایک ہی اندراج ${g.n} بار۔`,
        count: g.n,
        createdAt: new Date().toString(),
        detail: { scope: "truck", ledgerId: g.ledgerId, truck: lName.get(g.ledgerId), amount: Number(g.amt), date: g.day, ref: g.ref, entryIds: g.ids },
        links: [{ label: `Open Truck ${lName.get(g.ledgerId) || ""} khata`, wb: "khata", sheet: "truck_ledgers", focus: { ledgerId: g.ledgerId } }],
      });
    }
  }

  return out;
}

const BENCHMARK_KMPL = 3.5; // loaded cross-border truck — mirrors /api/fuel/integrity-audit default

const FUEL_CODE_LABEL: Record<string, string> = {
  FUEL_OVER_BENCHMARK: "More fuel than the distance justifies · زیادہ فیول، کم سفر",
  "Abnormal Consumption": "Very large single fill · ایک فِل میں بہت زیادہ لیٹر",
  "Repeated Refills": "Refuelled again within a short gap · تھوڑی دیر میں دوبارہ فِل",
  RAPID_REFILL: "Refuelled again within a short gap · تھوڑی دیر میں دوبارہ فِل",
  "Night Refills": "Refuelled at night · رات کو فِل",
  NIGHT_REFILL: "Refuelled at night · رات کو فِل",
  IMPLAUSIBLE_LOW_KMPL: "Impossible low mileage — siphoning likely · ناممکن کم ایوریج",
  IMPLAUSIBLE_HIGH_KMPL: "Impossible high mileage — wrong truck? · ناممکن زیادہ ایوریج",
  ODOMETER_ROLLBACK: "Odometer went backwards · اوڈومیٹر پیچھے چلا گیا",
  ODOMETER_JUMP: "Odometer jumped too far · اوڈومیٹر ایک دم بہت آگے",
  TANK_OVER_CAPACITY: "Fill exceeds tank capacity · فِل ٹینک کی گنجائش سے زیادہ",
  FUEL_WITHOUT_TRIP: "Fuel drawn with no trip · فیول لیا مگر کوئی ٹرپ نہیں",
};

/** Rebuild the "litres drawn vs km driven" maths for a set of fuel transactions. */
async function fuelLegCalcs(txnIds: number[]): Promise<Map<number, any>> {
  const out = new Map<number, any>();
  if (!txnIds.length) return out;

  // which vehicles do these txns belong to
  const targets = await db
    .select({
      id: schema.fuelTransactions.id,
      vehicleId: schema.fuelTransactions.vehicleId,
    })
    .from(schema.fuelTransactions)
    .where(inArray(schema.fuelTransactions.id, txnIds));
  const vehIds = [...new Set(targets.map((t) => t.vehicleId).filter((v): v is number => v != null))];
  if (!vehIds.length) return out;

  const fills = await db
    .select({
      id: schema.fuelTransactions.id,
      vehicleId: schema.fuelTransactions.vehicleId,
      litres: schema.fuelTransactions.litres,
      rate: schema.fuelTransactions.rate,
      total: schema.fuelTransactions.total,
      odometer: schema.fuelTransactions.odometer,
      date: schema.fuelTransactions.transactionDate,
    })
    .from(schema.fuelTransactions)
    .where(and(inArray(schema.fuelTransactions.vehicleId, vehIds), eq(schema.fuelTransactions.isDeleted, false)))
    .orderBy(asc(schema.fuelTransactions.transactionDate));

  const byVeh = new Map<number, typeof fills>();
  for (const f of fills) {
    if (f.vehicleId == null) continue;
    if (!byVeh.has(f.vehicleId)) byVeh.set(f.vehicleId, []);
    byVeh.get(f.vehicleId)!.push(f);
  }
  const N = (v: any) => (v == null ? 0 : parseFloat(String(v)) || 0);

  for (const [, list] of byVeh) {
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (!txnIds.includes(f.id)) continue;
      const litres = N(f.litres);
      const rate = N(f.rate) || (f.total && litres ? f.total / litres : 0);
      const valuePKR = f.total || Math.round(litres * rate);
      const next = list[i + 1];
      const legKm = next && next.odometer != null && f.odometer != null ? next.odometer - f.odometer : null;
      let expectedLitres: number | null = null;
      let overdrawLitres: number | null = null;
      let overdrawPct: number | null = null;
      let impliedKmpl: number | null = null;
      if (legKm != null && legKm >= 0 && litres > 0) {
        expectedLitres = +(legKm / BENCHMARK_KMPL).toFixed(1);
        overdrawLitres = +(litres - expectedLitres).toFixed(1);
        overdrawPct = expectedLitres > 0 ? Math.round((overdrawLitres / expectedLitres) * 100) : null;
        impliedKmpl = +(legKm / litres).toFixed(2);
      }
      out.set(f.id, {
        litres,
        ratePerL: Math.round(rate),
        valuePKR,
        odometerAtFill: f.odometer,
        nextOdometer: next?.odometer ?? null,
        legKm,
        benchmarkKmpl: BENCHMARK_KMPL,
        expectedLitres,
        overdrawLitres,
        overdrawPct,
        impliedKmpl,
        suspectValuePKR: overdrawLitres && overdrawLitres > 0 ? Math.round(overdrawLitres * rate) : 0,
        fillDate: f.date,
      });
    }
  }
  return out;
}

async function fuelTheftAlerts(): Promise<Alert[]> {
  const rows = await db
    .select({
      a: schema.fuelAlerts,
      vehicleNumber: schema.vehicles.vehicleNumber,
      driverName: schema.drivers.driverName,
    })
    .from(schema.fuelAlerts)
    .leftJoin(schema.vehicles, eq(schema.fuelAlerts.vehicleId, schema.vehicles.id))
    .leftJoin(schema.drivers, eq(schema.fuelAlerts.driverId, schema.drivers.id))
    .where(and(eq(schema.fuelAlerts.resolved, false), eq(schema.fuelAlerts.isDeleted, false)))
    .orderBy(desc(schema.fuelAlerts.createdAt))
    .limit(200);

  const calcs = await fuelLegCalcs(
    rows.map((r) => r.a.transactionId).filter((v): v is number => v != null),
  );

  return rows.map(({ a, vehicleNumber, driverName }) => {
    const readable = FUEL_CODE_LABEL[a.alertType] || a.alertType;
    const calc = a.transactionId ? calcs.get(a.transactionId) || null : null;
    return {
      key: `fuel_theft:${a.id}`,
      type: "fuel_theft",
      severity: mapSev(a.severity),
      module: "Fuel",
      title: `Fuel check — ${readable}${vehicleNumber ? ` · Truck ${vehicleNumber}` : ""}`,
      message:
        (calc && calc.overdrawLitres > 0
          ? `Drew ${calc.litres} L but ${calc.legKm} km only justifies ~${calc.expectedLitres} L — ${calc.overdrawLitres} L (${calc.overdrawPct}%) over. Suspect value ~PKR ${calc.suspectValuePKR.toLocaleString()}. · ${calc.litres} لیٹر ڈلوایا مگر ${calc.legKm} کلومیٹر سفر ~${calc.expectedLitres} لیٹر بنتا ہے۔`
          : a.description) + (driverName ? ` · Driver ${driverName}` : ""),
      createdAt: (a.createdAt || new Date()).toString(),
      detail: {
        alertId: a.id,
        alertCode: a.alertType,
        alertLabel: readable,
        vehicle: vehicleNumber,
        driver: driverName,
        transactionId: a.transactionId,
        tripId: a.tripId,
        rawDescription: a.description,
        calc, // step-by-step litres-vs-km maths (may be null if odometers missing)
        resolveUrl: `/api/fuel/theft-detection/resolve/${a.id}`,
      },
      links: [{ label: "Open Fuel Theft Audit", wb: "fuel", sheet: "theft" }],
    };
  });
}

async function ledgerReviewAlerts(): Promise<Alert[]> {
  const [pl] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.partyLedgerEntries)
    .where(and(eq(schema.partyLedgerEntries.needsReview, true), eq(schema.partyLedgerEntries.isDeleted, false)));
  const [tl] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.truckLedgerEntries)
    .where(and(eq(schema.truckLedgerEntries.needsReview, true), eq(schema.truckLedgerEntries.isDeleted, false)));

  const out: Alert[] = [];
  if (pl?.n) {
    const sample = await db
      .select({ id: schema.partyLedgerEntries.id, partyId: schema.partyLedgerEntries.partyId, description: schema.partyLedgerEntries.description, reason: schema.partyLedgerEntries.reviewReason })
      .from(schema.partyLedgerEntries)
      .where(and(eq(schema.partyLedgerEntries.needsReview, true), eq(schema.partyLedgerEntries.isDeleted, false)))
      .limit(20);
    out.push({
      key: "ledger_review:party",
      type: "ledger_review",
      severity: "medium",
      module: "Khata",
      title: `${pl.n} party ledger entries flagged for review · نظرثانی درکار`,
      message:
        "Rows the Excel import found doubtful (unreadable date, or amount/running-balance mismatch). Open each and fix or confirm. · امپورٹ کے دوران مشکوک سطریں — درست کریں۔",
      count: pl.n,
      createdAt: new Date().toString(),
      detail: { sample },
      links: [{ label: "Open Party Ledger Entries", wb: "khata", sheet: "party_entries" }],
    });
  }
  if (tl?.n) {
    out.push({
      key: "ledger_review:truck",
      type: "ledger_review",
      severity: "medium",
      module: "Khata",
      title: `${tl.n} truck ledger entries flagged for review · نظرثانی درکار`,
      message: "Truck-khata rows the import found doubtful — verify each one. · ٹرک کھاتہ کی مشکوک سطریں — تصدیق کریں۔",
      count: tl.n,
      createdAt: new Date().toString(),
      links: [{ label: "Open Truck Ledger Entries", wb: "khata", sheet: "truck_entries" }],
    });
  }
  return out;
}

async function dueAlerts(): Promise<Alert[]> {
  const parties = await db
    .select({
      id: schema.parties.id,
      name: schema.parties.name,
      phone: schema.parties.phone,
      status: schema.parties.status,
      balance: schema.parties.closingBalance,
    })
    .from(schema.parties)
    .where(and(eq(schema.parties.isDeleted, false), ne(schema.parties.closingBalance, 0)))
    .limit(4000);

  if (!parties.length) return [];

  const last = await db
    .select({ partyId: schema.partyLedgerEntries.partyId, lastAt: sql<string>`max(${schema.partyLedgerEntries.entryDate})` })
    .from(schema.partyLedgerEntries)
    .where(eq(schema.partyLedgerEntries.isDeleted, false))
    .groupBy(schema.partyLedgerEntries.partyId);
  const lastBy = new Map(last.map((r) => [r.partyId, r.lastAt ? new Date(r.lastAt).getTime() : 0]));

  const out: Alert[] = [];
  const cutoff = Date.now() - 45 * DAY;

  const blockedOwed = parties.filter((p) => p.status === "Blocked" && p.balance < 0);
  if (blockedOwed.length) {
    out.push({
      key: "do_not_pay:list",
      type: "do_not_pay",
      severity: "high",
      module: "Khata",
      title: `${blockedOwed.length} blocked part${blockedOwed.length === 1 ? "y" : "ies"} — payment HOLD · ادائیگی روکیں`,
      message:
        "These parties are Blocked but we still owe them. Do NOT pay until reviewed. · یہ پارٹیاں بلاک ہیں مگر ہمیں دینا ہے — نظرثانی تک ادائیگی نہ کریں۔",
      count: blockedOwed.length,
      createdAt: new Date().toString(),
      detail: { parties: blockedOwed },
      links: [{ label: "Open Dues & Alerts", wb: "khata", sheet: "dues" }],
    });
  }

  const overdue = parties
    .filter((p) => p.status !== "Blocked")
    .map((p) => ({ ...p, last: lastBy.get(p.id) || 0 }))
    .filter((p) => !p.last || p.last < cutoff)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    .slice(0, 40);
  if (overdue.length) {
    out.push({
      key: "dues_overdue:list",
      type: "dues_overdue",
      severity: "medium",
      module: "Khata",
      title: `${overdue.length} party ledgers with no entry for 45+ days · 45+ دن سے خاموش`,
      message: "Balance is still open but there has been no activity for a long time — follow up. · بقایا موجود مگر عرصے سے کوئی لین دین نہیں۔",
      count: overdue.length,
      createdAt: new Date().toString(),
      detail: {
        parties: overdue.map((p) => ({
          id: p.id,
          name: p.name,
          phone: p.phone,
          balance: p.balance,
          daysSince: p.last ? Math.round((Date.now() - p.last) / DAY) : null,
        })),
      },
      links: [{ label: "Open Dues & Alerts", wb: "khata", sheet: "dues" }],
    });
  }
  return out;
}

async function docExpiryAlerts(): Promise<Alert[]> {
  const soon = new Date(Date.now() + 30 * DAY);
  const out: Alert[] = [];

  const veh = await db
    .select()
    .from(schema.vehicles)
    .where(eq(schema.vehicles.isDeleted, false));
  const vExp: any[] = [];
  for (const v of veh) {
    for (const [field, label] of [
      ["insuranceExpiry", "Insurance"],
      ["fitnessExpiry", "Fitness"],
    ] as const) {
      const d = (v as any)[field] ? new Date((v as any)[field]) : null;
      if (d && d < soon) vExp.push({ vehicle: v.vehicleNumber, doc: label, expiry: d, past: d < new Date() });
    }
  }
  if (vExp.length) {
    out.push({
      key: "doc_expiry:vehicles",
      type: "doc_expiry",
      severity: vExp.some((x) => x.past) ? "high" : "medium",
      module: "Fleet",
      title: `${vExp.length} vehicle document(s) expiring / expired`,
      message: "Renew insurance / fitness — an expired truck on the road is a risk. · انشورنس / فٹنس تجدید کروائیں۔",
      count: vExp.length,
      createdAt: new Date().toString(),
      detail: { items: vExp },
      links: [{ label: "Open Vehicles", wb: "fleet", sheet: "vehicles" }],
    });
  }

  const drv = await db.select().from(schema.drivers).where(eq(schema.drivers.isDeleted, false));
  const dExp: any[] = [];
  for (const dr of drv) {
    for (const [field, label] of [
      ["licenseExpiry", "License"],
      ["medicalExpiry", "Medical"],
    ] as const) {
      const d = (dr as any)[field] ? new Date((dr as any)[field]) : null;
      if (d && d < soon) dExp.push({ driver: dr.driverName, doc: label, expiry: d, past: d < new Date() });
    }
  }
  if (dExp.length) {
    out.push({
      key: "doc_expiry:drivers",
      type: "doc_expiry",
      severity: dExp.some((x) => x.past) ? "high" : "medium",
      module: "Fleet",
      title: `${dExp.length} driver document(s) expiring / expired`,
      message: "Renew driver licence / medical certificate. · ڈرائیور لائسنس / میڈیکل تجدید کروائیں۔",
      count: dExp.length,
      createdAt: new Date().toString(),
      detail: { items: dExp },
      links: [{ label: "Open Drivers", wb: "fleet", sheet: "drivers" }],
    });
  }
  return out;
}

// ------------------------------------------------------------------- routes
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const [dupes, dupEntries, theft, review, dues, docs] = await Promise.all([
      duplicateReceiptAlerts().catch((e) => (console.error("[alerts] dupes", e), [])),
      duplicateEntryAlerts().catch((e) => (console.error("[alerts] dupEntries", e), [])),
      fuelTheftAlerts().catch((e) => (console.error("[alerts] theft", e), [])),
      ledgerReviewAlerts().catch((e) => (console.error("[alerts] review", e), [])),
      dueAlerts().catch((e) => (console.error("[alerts] dues", e), [])),
      docExpiryAlerts().catch((e) => (console.error("[alerts] docs", e), [])),
    ]);
    let alerts: Alert[] = [...dupes, ...dupEntries, ...theft, ...review, ...dues, ...docs];

    const acks = await db.select().from(schema.alertAcks);
    const ackBy = new Map(acks.map((a) => [a.alertKey, a]));
    const includeAcked = req.query.includeAcked === "1";
    alerts = alerts
      .map((a) => ({ ...a, ack: ackBy.get(a.key) || null }))
      .filter((a) => includeAcked || !a.ack);

    alerts.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || (b.createdAt > a.createdAt ? 1 : -1));

    const counts = { total: alerts.length, critical: 0, high: 0, medium: 0, low: 0 };
    const byType: Record<string, number> = {};
    for (const a of alerts) {
      counts[a.severity]++;
      byType[a.type] = (byType[a.type] || 0) + 1;
    }
    res.json({ alerts, counts, byType, generatedAt: new Date().toISOString() });
  } catch (e: any) {
    console.error("[alerts] failed:", e);
    res.status(500).json({ error: e.message || "alerts failed" });
  }
});

router.post("/ack", async (req: AuthRequest, res: Response) => {
  try {
    const { alertKey, alertType, status, note } = req.body || {};
    if (!alertKey || !alertType) return res.status(400).json({ error: "alertKey and alertType required" });
    const st = status === "resolved" ? "resolved" : "ack";
    const [row] = await db
      .insert(schema.alertAcks)
      .values({ alertKey, alertType, status: st, note: note || null, actedBy: req.user?.id })
      .onConflictDoUpdate({
        target: schema.alertAcks.alertKey,
        set: { status: st, note: note || null, actedBy: req.user?.id, updatedAt: new Date() },
      })
      .returning();
    await logAudit({
      action: "UPDATE",
      tableName: "alert_acks",
      recordId: row.id,
      newValues: { alertKey, status: st },
      performedBy: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    }).catch(() => {});
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/ack/:key", async (req: AuthRequest, res: Response) => {
  try {
    await db.delete(schema.alertAcks).where(eq(schema.alertAcks.alertKey, req.params.key));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
