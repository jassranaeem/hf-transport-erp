/**
 * Trip Desk — one-form trip entry. Type the truck, driver, route, customer and
 * the money given; anything that doesn't exist yet (truck, driver, route,
 * customer, khata) is created on the spot, so nobody has to visit five
 * separate modules first.
 *
 *   GET    /api/trip-desk/options       names for the form's type-ahead lists
 *   GET    /api/trip-desk               trips with cash/diesel totals
 *   POST   /api/trip-desk               create a whole trip
 *   POST   /api/trip-desk/:id/money     add cash / diesel / other kharcha to a trip
 *   POST   /api/trip-desk/delete        soft-delete trips (and their khata entries)
 *
 * Fields the source data doesn't have (engine no., CNIC, ...) are stored as
 * blank / 0 and can be filled in later from Fleet → Vehicles / Drivers.
 *
 * Mounted at /api/trip-desk.
 */
import { Router, Response } from "express";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { recompute } from "./ledgers.ts";
import { applyLatestGpsToTrip, distanceToDestinationKm, matchPlate } from "./trip_progress.ts";
import { partnershipLedgerForPlate, partnershipPreviewForPlate, closePartnershipCycle, reopenLastCycle } from "./partnership.ts";
import { journeyMoney, journeyStops, rootOf, syncStopInvoice, resyncStopInvoice, deleteStopInvoice, spansFromTrips, tripSpansForTruck, inSpan, type TripSpan } from "./trip_close.ts";
import { createCashEntry } from "./cash_book.ts";
import { triggerAutoInvoicing } from "./finance_engine.ts";

const router = Router();
router.use(requireAuth, requireApproved);

const READ = ["Super Admin", "Admin", "Operations Manager", "Fleet Manager", "Dispatcher", "Finance Manager", "Accountant", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Operations Manager", "Dispatcher", "Finance Manager"];

const normPlate = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const clean = (v: any) => String(v ?? "").trim();
const whole = (v: any) => Math.max(0, Math.round(Number(v) || 0));

const audit = (req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", table: string, id: number, oldV: unknown, newV: unknown) =>
  logAudit({
    action,
    tableName: table,
    recordId: id,
    oldValues: oldV,
    newValues: newV,
    performedBy: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  }).catch(() => {});

// what money given on a trip was for — each goes to its own khata category (and so to the right
// account in the books)
const MONEY_KINDS: Record<string, { method: string; category: string; label: string }> = {
  cash: { method: "Cash", category: "TripCash", label: "Trip cash to driver" },
  diesel: { method: "Diesel", category: "Diesel", label: "Diesel" },
  toll: { method: "Cash", category: "Toll", label: "Toll" },
  khurak: { method: "Cash", category: "Khurak", label: "Khurak (food)" },
  labour: { method: "Cash", category: "Labour", label: "Loading / unloading" },
  repair: { method: "Cash", category: "Garage", label: "Repair on the road" },
  tyre: { method: "Cash", category: "Tyre", label: "Tyre" },
  permit: { method: "Cash", category: "Permit", label: "Permit / border" },
  other: { method: "Cash", category: "Other", label: "Other expense" },
};
const PAID_HOW = ["Cash", "Online", "Bank", "Cheque"];
/** A day typed as YYYY-MM-DD, at midday so no time zone moves it to another day. */
const dayAt = (v: any) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : v ? new Date(v) : new Date());

async function addMoneyEntry(opts: {
  ledgerId: number;
  tripId: number;
  kind: keyof typeof MONEY_KINDS;
  amount: number;
  date: Date;
  description: string;
  userId?: number;
  routeFrom?: string;
  routeTo?: string;
  method?: string;
  paidFromEntryId?: number;
}) {
  const k = MONEY_KINDS[opts.kind];
  const [row] = await db
    .insert(schema.truckLedgerEntries)
    .values({
      ledgerId: opts.ledgerId,
      entryDate: opts.date,
      rawDate: opts.date.toISOString().slice(0, 10),
      method: opts.method || k.method,
      description: opts.description,
      received: 0,
      paid: opts.amount,
      category: k.category,
      direction: "Out",
      sectionLabel: "Manual",
      routeFrom: opts.routeFrom || null,
      routeTo: opts.routeTo || null,
      derivedTripId: opts.tripId,
      paidFromEntryId: opts.paidFromEntryId ?? null,
      createdBy: opts.userId,
    })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------------------------
// Money the driver spent out of the trip cash already given (diesel at the pump, toll, khurak…).
// The company handed over ONE sum; counting the cash AND what it was spent on would count it
// twice. So an entry can be "paid from trip cash": its amount is taken out of that cash entry,
// the total given on the trip stays what was really handed over, and the link is kept so editing
// or deleting the entry puts the cash back.
// ---------------------------------------------------------------------------------------------
async function tripStopIds(tripId: number): Promise<number[]> {
  const root = await rootOf(tripId);
  if (!root) return [tripId];
  const stops = await db
    .select({ id: schema.trips.id })
    .from(schema.trips)
    .where(and(eq(schema.trips.isDeleted, false), sql`(${schema.trips.id} = ${root} or ${schema.trips.parentTripId} = ${root})`));
  return stops.map((x) => x.id);
}

/** The trip-cash entry of this trip to take `amount` out of — the one the user chose, or the only one with enough in it. */
async function tripCashFor(tripId: number, amount: number, exceptId?: number, chosenId?: number) {
  const ids = await tripStopIds(tripId);
  const cash = await db
    .select()
    .from(schema.truckLedgerEntries)
    .where(and(inArray(schema.truckLedgerEntries.derivedTripId, ids), eq(schema.truckLedgerEntries.isDeleted, false), eq(schema.truckLedgerEntries.category, MONEY_KINDS.cash.category)))
    .orderBy(desc(schema.truckLedgerEntries.entryDate), desc(schema.truckLedgerEntries.id));
  const usable = cash.filter((c) => c.id !== exceptId && c.paidFromEntryId == null);
  if (chosenId) {
    const pick = usable.find((c) => c.id === chosenId);
    if (!pick) throw new Error("That trip cash is not on this trip any more · یہ نقد اس ٹرپ پر نہیں");
    if (pick.paid < amount)
      throw new Error(`Only PKR ${pick.paid.toLocaleString()} is left of that cash (${pick.description || "trip cash"}) — not enough for PKR ${amount.toLocaleString()}. Choose another cash entry or raise it first · اس نقد میں اتنی رقم نہیں`);
    return pick;
  }
  const enough = usable.filter((c) => c.paid >= amount);
  if (enough.length === 1) return enough[0];
  if (enough.length > 1) throw new Error("There is more than one trip cash on this trip — choose which one it came out of · ایک سے زیادہ نقد ہیں، چنیں کس میں سے");
  const have = usable.reduce((s, c) => s + c.paid, 0);
  throw new Error(
    usable.length
      ? `The trip cash left is PKR ${have.toLocaleString()} — not enough for PKR ${amount.toLocaleString()}. Enter the cash given first, or untick “paid from trip cash” · ٹرپ نقد میں اتنی رقم نہیں`
      : `No trip cash has been given on this trip, so there is nothing to take it out of — untick “paid from trip cash”, or enter the cash given first · اس ٹرپ پر نقد دی ہی نہیں گئی`,
  );
}

router.get("/options", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    const [veh, drv, con, rts] = await Promise.all([
      db.select({ id: schema.vehicles.id, vehicleNumber: schema.vehicles.vehicleNumber }).from(schema.vehicles).where(eq(schema.vehicles.isDeleted, false)),
      db.select({ id: schema.drivers.id, driverName: schema.drivers.driverName, mobile: schema.drivers.mobile }).from(schema.drivers).where(eq(schema.drivers.isDeleted, false)),
      db.select({ id: schema.contractors.id, company: schema.contractors.company }).from(schema.contractors).where(eq(schema.contractors.isDeleted, false)),
      db.select({ id: schema.routes.id, origin: schema.routes.origin, destination: schema.routes.destination }).from(schema.routes).where(eq(schema.routes.isDeleted, false)),
    ]);
    res.json({ vehicles: veh, drivers: drv, contractors: con, routes: rts });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db
      .select({
        trip: schema.trips,
        vehicleNumber: schema.vehicles.vehicleNumber,
        driverName: schema.drivers.driverName,
        driverMobile: schema.drivers.mobile,
        origin: schema.routes.origin,
        destination: schema.routes.destination,
        company: schema.contractors.company,
      })
      .from(schema.trips)
      .leftJoin(schema.vehicles, eq(schema.trips.vehicleId, schema.vehicles.id))
      .leftJoin(schema.drivers, eq(schema.trips.driverId, schema.drivers.id))
      .leftJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
      .leftJoin(schema.contractors, eq(schema.trips.contractorId, schema.contractors.id))
      .where(eq(schema.trips.isDeleted, false))
      .orderBy(desc(schema.trips.departureTime))
      .limit(500);

    const ids = rows.map((r) => r.trip.id);
    const money = ids.length
      ? await db
          .select({
            tripId: schema.truckLedgerEntries.derivedTripId,
            category: schema.truckLedgerEntries.category,
            paid: sql<number>`coalesce(sum(${schema.truckLedgerEntries.paid}),0)::bigint`,
            received: sql<number>`coalesce(sum(${schema.truckLedgerEntries.received}),0)::bigint`,
          })
          .from(schema.truckLedgerEntries)
          .where(and(inArray(schema.truckLedgerEntries.derivedTripId, ids), eq(schema.truckLedgerEntries.isDeleted, false)))
          .groupBy(schema.truckLedgerEntries.derivedTripId, schema.truckLedgerEntries.category)
      : [];
    const byTrip = new Map<number, Record<string, number>>();
    const receivedBy = new Map<number, number>(); // kiraya received, tagged to the stop
    for (const m of money) {
      if (m.tripId == null) continue;
      const cur = byTrip.get(m.tripId) || {};
      cur[m.category] = Number(m.paid);
      byTrip.set(m.tripId, cur);
      receivedBy.set(m.tripId, (receivedBy.get(m.tripId) || 0) + Number(m.received || 0));
    }

    // each truck's journeys and their spans (a journey's days end when the truck's next trip left)
    const truckKey = (r: (typeof rows)[number]) => normPlate(r.vehicleNumber || "") || `v${r.trip.vehicleId}`;
    const byTruck = new Map<string, (typeof rows)[number][]>();
    for (const r of rows) byTruck.set(truckKey(r), [...(byTruck.get(truckKey(r)) || []), r]);
    const spanByRoot = new Map<number, TripSpan>();
    for (const list of byTruck.values()) {
      const spans = spansFromTrips(list.map((r) => ({ id: r.trip.id, parent: r.trip.parentTripId, legNo: r.trip.legNo, tripNumber: r.trip.tripNumber, departure: r.trip.departureTime, origin: r.origin, destination: r.destination })));
      for (const s of spans) spanByRoot.set(s.rootId, s);
    }

    // Money the truck's own ledger already holds for this journey (e.g. an imported Excel khata) but
    // that was not typed through a trip: everything paid out since the first leg left.
    const ledgerPaid = new Map<number, number>();
    const roots = rows.filter((r) => !r.trip.parentTripId).slice(0, 60);
    await Promise.all(
      roots.map(async (r) => {
        const plate = normPlate(r.vehicleNumber || "");
        const [x] = await db
          .select({ paid: sql<number>`coalesce(sum(${schema.truckLedgerEntries.paid}),0)::bigint` })
          .from(schema.truckLedgerEntries)
          .innerJoin(schema.truckLedgers, eq(schema.truckLedgerEntries.ledgerId, schema.truckLedgers.id))
          .where(
            and(
              eq(schema.truckLedgers.isDeleted, false),
              eq(schema.truckLedgerEntries.isDeleted, false),
              isNull(schema.truckLedgerEntries.derivedTripId),
              spanByRoot.has(r.trip.id) ? inSpan(spanByRoot.get(r.trip.id)!) : sql`${schema.truckLedgerEntries.entryDate} >= ${r.trip.departureTime}`,
              sql`(${schema.truckLedgers.vehicleId} = ${r.trip.vehicleId} or regexp_replace(upper(${schema.truckLedgers.registration}), '[^A-Z0-9]', '', 'g') = ${plate})`,
            ),
          );
        ledgerPaid.set(r.trip.id, Number(x?.paid || 0));
      }),
    );

    // live GPS per truck, matched by plate: a tracker may sit on a near-duplicate vehicle row, or
    // on no vehicle row at all (a provider tracker known only by its name, e.g. "TLD 918")
    const trackers = await db
      .select({
        vehicleNumber: schema.vehicles.vehicleNumber,
        label: schema.trackerDevices.label,
        lastSeenAt: schema.trackerDevices.lastSeenAt,
        lastLat: schema.trackerDevices.lastLat,
        lastLng: schema.trackerDevices.lastLng,
        lastSpeed: schema.trackerDevices.lastSpeed,
        status: schema.trackerDevices.status,
      })
      .from(schema.trackerDevices)
      .leftJoin(schema.vehicles, eq(schema.trackerDevices.vehicleId, schema.vehicles.id))
      .where(eq(schema.trackerDevices.isDeleted, false));
    const tripPlates = new Set(rows.map((r) => normPlate(r.vehicleNumber || "")).filter(Boolean));
    const trackerByPlate = new Map<string, (typeof trackers)[number]>();
    for (const t of trackers) {
      const k = matchPlate(normPlate(t.vehicleNumber || t.label || ""), tripPlates);
      if (!k) continue;
      const cur = trackerByPlate.get(k);
      if (!cur || (t.lastSeenAt && (!cur.lastSeenAt || t.lastSeenAt > cur.lastSeenAt))) trackerByPlate.set(k, t);
    }
    const gpsFor = (vehicleNumber: string | null, destination: string | null) => {
      const t = vehicleNumber ? trackerByPlate.get(normPlate(vehicleNumber)) : undefined;
      if (!t) return null;
      const lat = t.lastLat != null ? Number(t.lastLat) : null;
      const lng = t.lastLng != null ? Number(t.lastLng) : null;
      return {
        lastSeenAt: t.lastSeenAt,
        status: t.status,
        speed: t.lastSpeed,
        lat,
        lng,
        kmToDestination: lat != null && lng != null && destination ? distanceToDestinationKm(destination, lat, lng) : null,
      };
    };

    res.json(
      rows.map((r) => {
        const m = byTrip.get(r.trip.id) || {};
        const total = Object.values(m).reduce((s, n) => s + n, 0);
        return {
          gps: gpsFor(r.vehicleNumber, r.destination),
          id: r.trip.id,
          tripNumber: r.trip.tripNumber,
          status: r.trip.status,
          departureTime: r.trip.departureTime,
          revenue: r.trip.revenue,
          parentTripId: r.trip.parentTripId,
          legNo: r.trip.legNo,
          cargo: r.trip.cargo,
          vehicleNumber: r.vehicleNumber,
          driverName: r.driverName,
          driverMobile: r.driverMobile,
          origin: r.origin,
          destination: r.destination,
          company: r.company,
          cash: m.TripCash || 0,
          diesel: m.Diesel || 0,
          otherExpense: total - (m.TripCash || 0) - (m.Diesel || 0),
          totalGiven: total,
          ledgerPaid: ledgerPaid.get(r.trip.id) || 0,
          received: receivedBy.get(r.trip.id) || 0,
          // the days whose khata money counts for this journey (kept on the first stop)
          spanFrom: spanByRoot.get(r.trip.id)?.fromDay ?? null,
          spanUntil: spanByRoot.get(r.trip.id)?.untilDay ?? null,
          // "Close trip" state (kept on the first stop of the journey)
          closedAt: r.trip.closedAt,
          splitAt: r.trip.splitAt,
          splitAmount: r.trip.splitAmount,
          freightWrittenOff: r.trip.freightWrittenOff,
        };
      }),
    );
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const truckInput = clean(b.truck).toUpperCase();
    const driverName = clean(b.driverName);
    const from = clean(b.from);
    const to = clean(b.to);
    const company = clean(b.customer);
    if (!truckInput) return res.status(400).json({ error: "Enter the truck number · ٹرک نمبر لکھیں" });
    if (!driverName) return res.status(400).json({ error: "Enter the driver name · ڈرائیور کا نام لکھیں" });
    if (!from || !to) return res.status(400).json({ error: "Enter the route (from and to) · روٹ لکھیں (کہاں سے، کہاں تک)" });
    if (!company) return res.status(400).json({ error: "Enter the customer / carrier name · کسٹمر / کیریئر کا نام لکھیں" });

    const departure = b.departure ? new Date(b.departure) : new Date();
    if (isNaN(departure.getTime())) return res.status(400).json({ error: "The departure date is not valid · روانگی کی تاریخ درست نہیں" });
    const freight = whole(b.freight);
    const cash = whole(b.cash);
    const diesel = whole(b.dieselAmount);
    const litres = Number(b.dieselLitres) || 0;
    const created: string[] = [];
    const dieselFromCash = !!b.dieselFromCash && cash > 0 && diesel > 0;
    if (dieselFromCash && diesel > cash) return res.status(400).json({ error: `The diesel (PKR ${diesel.toLocaleString()}) is more than the cash given (PKR ${cash.toLocaleString()}) — it cannot be paid out of it · ڈیزل کی رقم نقد سے زیادہ ہے` });

    // --- truck
    const plate = normPlate(truckInput);
    let [veh] = await db
      .select()
      .from(schema.vehicles)
      .where(and(eq(schema.vehicles.isDeleted, false), sql`regexp_replace(upper(${schema.vehicles.vehicleNumber}), '[^A-Z0-9]', '', 'g') = ${plate}`))
      .orderBy(asc(schema.vehicles.id))
      .limit(1);
    if (!veh) {
      [veh] = await db
        .insert(schema.vehicles)
        .values({
          vehicleNumber: truckInput,
          registrationNumber: truckInput,
          engineNumber: "",
          chassisNumber: "",
          vehicleType: "Truck",
          truckBrand: "",
          model: "",
          year: 0,
          containerType: "",
          payloadCapacity: 0,
          currentOdometer: 0,
          createdBy: req.user?.id,
        })
        .returning();
      created.push(`truck ${veh.vehicleNumber}`);
      await audit(req, "CREATE", "vehicles", veh.id, null, veh);
    }

    // --- driver
    const phone = clean(b.driverPhone);
    const phoneDigits = phone.replace(/\D/g, "");
    let [drv] = await db
      .select()
      .from(schema.drivers)
      .where(
        and(
          eq(schema.drivers.isDeleted, false),
          phoneDigits
            ? sql`regexp_replace(${schema.drivers.mobile}, '[^0-9]', '', 'g') = ${phoneDigits}`
            : sql`lower(trim(${schema.drivers.driverName})) = ${driverName.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (!drv) {
      const tag = randomBytes(4).toString("hex").toUpperCase();
      [drv] = await db
        .insert(schema.drivers)
        .values({
          driverName,
          cnic: clean(b.driverCnic) || `PENDING-${tag}`,
          licenseNumber: clean(b.driverLicense) || `PENDING-${tag}`,
          licenseExpiry: new Date(0),
          mobile: phone,
          salary: 0,
          createdBy: req.user?.id,
        })
        .returning();
      created.push(`driver ${drv.driverName}`);
      await audit(req, "CREATE", "drivers", drv.id, null, drv);
    }

    // --- route
    let [route] = await db
      .select()
      .from(schema.routes)
      .where(
        and(
          eq(schema.routes.isDeleted, false),
          sql`lower(trim(${schema.routes.origin})) = ${from.toLowerCase()}`,
          sql`lower(trim(${schema.routes.destination})) = ${to.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (!route) {
      [route] = await db
        .insert(schema.routes)
        .values({
          origin: from,
          destination: to,
          distance: whole(b.distance),
          expectedHours: 0,
          benchmarkFuel: 0,
          expectedToll: 0,
          revenue: freight,
          createdBy: req.user?.id,
        })
        .returning();
      created.push(`route ${from} → ${to}`);
      await audit(req, "CREATE", "routes", route.id, null, route);
    }

    // --- customer / carrier
    let [con] = await db
      .select()
      .from(schema.contractors)
      .where(and(eq(schema.contractors.isDeleted, false), sql`lower(trim(${schema.contractors.company})) = ${company.toLowerCase()}`))
      .limit(1);
    if (!con) {
      [con] = await db.insert(schema.contractors).values({ company, createdBy: req.user?.id }).returning();
      created.push(`customer ${con.company}`);
      await audit(req, "CREATE", "contractors", con.id, null, con);
    }

    // --- trip
    const revenue = freight || route.revenue || 0;
    const etaHours = route.expectedHours || 0;
    const [trip] = await db
      .insert(schema.trips)
      .values({
        tripNumber: `TRIP-${Date.now().toString().slice(-6)}${randomBytes(1).toString("hex").toUpperCase()}`,
        vehicleId: veh.id,
        driverId: drv.id,
        routeId: route.id,
        contractorId: con.id,
        departureTime: departure,
        actualDepartureTime: departure.getTime() <= Date.now() ? departure : null,
        revenue,
        distance: route.distance || 0,
        etaHours,
        fuelBenchmark: route.benchmarkFuel || 0,
        expectedProfit: revenue,
        expectedArrival: new Date(departure.getTime() + etaHours * 3600_000),
        expectedFuel: route.benchmarkFuel || 0,
        status: departure.getTime() <= Date.now() ? "In Transit" : "Scheduled",
        currentAddress: route.origin,
        remainingDistance: route.distance || 0,
        cargo: clean(b.cargo) || null,
        createdBy: req.user?.id,
      })
      .returning();
    await audit(req, "CREATE", "trips", trip.id, null, trip);

    await db.update(schema.vehicles).set({ currentStatus: "Active" }).where(eq(schema.vehicles.id, veh.id));
    await db.update(schema.drivers).set({ status: "On Trip", assignedVehicleId: veh.id }).where(eq(schema.drivers.id, drv.id));

    // --- khata + money given
    // a truck shared with a partner keeps ONE khata — the one its partnership cycle reads
    const sharedId = await partnershipLedgerForPlate(veh.vehicleNumber);
    let [led] = sharedId
      ? await db.select().from(schema.truckLedgers).where(eq(schema.truckLedgers.id, sharedId)).limit(1)
      : await db
      .select()
      .from(schema.truckLedgers)
      .where(
        and(
          eq(schema.truckLedgers.isDeleted, false),
          isNull(schema.truckLedgers.sourceSheet), // never write into an Excel-imported sheet ledger
          eq(schema.truckLedgers.vehicleId, veh.id), // the ledger the Truck Search profile lists for THIS truck,
        ),
      )
      .limit(1);
    if (!led) {
      [led] = await db
        .insert(schema.truckLedgers)
        .values({ vehicleId: veh.id, registration: veh.vehicleNumber, title: veh.vehicleNumber, driverName: drv.driverName, driverPhone: drv.mobile || null, createdBy: req.user?.id })
        .returning();
      created.push(`ledger ${led.registration}`);
    } else if (!led.vehicleId) {
      await db.update(schema.truckLedgers).set({ vehicleId: veh.id }).where(eq(schema.truckLedgers.id, led.id));
    }

    const routeLabel = `${route.origin} → ${route.destination}`;
    // cash given, less any diesel paid out of it: the driver was handed `cash` in all
    let cashEntryId: number | undefined;
    const cashLeft = dieselFromCash ? cash - diesel : cash;
    if (cashLeft > 0) {
      const ce = await addMoneyEntry({
        ledgerId: led.id,
        tripId: trip.id,
        kind: "cash",
        amount: cashLeft,
        date: departure,
        description: dieselFromCash ? `Trip cash · ${routeLabel} (PKR ${cash.toLocaleString()} given; PKR ${diesel.toLocaleString()} of it went on diesel)` : `Trip cash · ${routeLabel}`,
        userId: req.user?.id,
        routeFrom: route.origin,
        routeTo: route.destination,
      });
      cashEntryId = ce.id;
    }
    if (diesel > 0) {
      const pump = clean(b.dieselPump);
      const ref = clean(b.dieselRef);
      const bank = clean(b.dieselPayment).toLowerCase() === "bank";
      await addMoneyEntry({
        ledgerId: led.id,
        tripId: trip.id,
        kind: "diesel",
        amount: diesel,
        date: departure,
        description: `Diesel${litres ? ` ${litres} L` : ""}${pump ? ` · ${pump}` : ""}${ref ? ` · ${ref}` : ""}${bank ? " · bank transfer" : ""}`,
        method: bank ? "Online" : undefined,
        userId: req.user?.id,
        routeFrom: route.origin,
        routeTo: route.destination,
        paidFromEntryId: dieselFromCash ? cashEntryId : undefined,
      });
      if (litres > 0) {
        await db.insert(schema.fuelTransactions).values({
          transactionNumber: `FT-${trip.tripNumber}`,
          vehicleId: veh.id,
          driverId: drv.id,
          tripId: trip.id,
          transactionDate: departure,
          litres: String(litres),
          rate: String(Math.round((diesel / litres) * 100) / 100),
          subtotal: diesel,
          gst: 0,
          total: diesel,
          odometer: veh.currentOdometer || 0,
          invoiceNumber: ref || null,
          paymentType: bank ? "Bank" : "Cash",
          createdBy: req.user?.id,
        });
      }
    }
    if (cash > 0 || diesel > 0) await recompute(led.id);

    // read the truck's GPS right now instead of waiting for its next ping
    const gps = await applyLatestGpsToTrip(trip.id).catch(() => null);

    res.json({ tripId: trip.id, tripNumber: trip.tripNumber, ledgerId: led.id, created, gps });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/next-leg", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const parent = (await db.select().from(schema.trips).where(and(eq(schema.trips.id, parseInt(req.params.id)), eq(schema.trips.isDeleted, false))).limit(1))[0];
    if (!parent) return res.status(404).json({ error: "Trip not found" });
    const b = req.body || {};
    const to = clean(b.to);
    if (!to) return res.status(400).json({ error: "Enter where this leg is going · یہ مرحلہ کہاں جا رہا ہے لکھیں" });

    const rootId = parent.parentTripId || parent.id;
    const legs = await db.select().from(schema.trips).where(and(eq(schema.trips.isDeleted, false), sql`(${schema.trips.id} = ${rootId} or ${schema.trips.parentTripId} = ${rootId})`)).orderBy(desc(schema.trips.legNo));
    const last = legs[0] || parent;
    const [lastRoute] = await db.select().from(schema.routes).where(eq(schema.routes.id, last.routeId)).limit(1);
    const from = clean(b.from) || lastRoute.destination;

    let [route] = await db.select().from(schema.routes).where(and(eq(schema.routes.isDeleted, false), sql`lower(trim(${schema.routes.origin})) = ${from.toLowerCase()}`, sql`lower(trim(${schema.routes.destination})) = ${to.toLowerCase()}`)).limit(1);
    if (!route) [route] = await db.insert(schema.routes).values({ origin: from, destination: to, distance: 0, expectedHours: 0, benchmarkFuel: 0, expectedToll: 0, revenue: whole(b.freight), createdBy: req.user?.id }).returning();

    const company = clean(b.customer);
    let contractorId = last.contractorId;
    if (company) {
      let [con] = await db.select().from(schema.contractors).where(and(eq(schema.contractors.isDeleted, false), sql`lower(trim(${schema.contractors.company})) = ${company.toLowerCase()}`)).limit(1);
      if (!con) [con] = await db.insert(schema.contractors).values({ company, createdBy: req.user?.id }).returning();
      contractorId = con.id;
    }

    const departure = b.departure ? new Date(b.departure) : new Date();
    if (isNaN(departure.getTime())) return res.status(400).json({ error: "The departure date is not valid · روانگی کی تاریخ درست نہیں" });
    const freight = whole(b.freight);
    const started = departure.getTime() <= Date.now();
    const [leg] = await db
      .insert(schema.trips)
      .values({
        tripNumber: `TRIP-${Date.now().toString().slice(-6)}${randomBytes(1).toString("hex").toUpperCase()}`,
        vehicleId: parent.vehicleId,
        driverId: parent.driverId,
        routeId: route.id,
        contractorId,
        departureTime: departure,
        actualDepartureTime: started ? departure : null,
        revenue: freight,
        distance: route.distance || 0,
        etaHours: route.expectedHours || 0,
        fuelBenchmark: route.benchmarkFuel || 0,
        expectedProfit: freight,
        expectedArrival: new Date(departure.getTime() + (route.expectedHours || 0) * 3600_000),
        expectedFuel: route.benchmarkFuel || 0,
        status: started ? "In Transit" : "Scheduled",
        currentAddress: route.origin,
        remainingDistance: route.distance || 0,
        parentTripId: rootId,
        legNo: (last.legNo || 1) + 1,
        cargo: clean(b.cargo) || null,
        createdBy: req.user?.id,
      })
      .returning();
    // the leg before this one has reached its stop — but never auto-"Complete" it (that would raise an invoice)
    if (["Scheduled", "Started", "In Transit"].includes(last.status)) {
      await db.update(schema.trips).set({ status: "Arrived" }).where(eq(schema.trips.id, last.id));
    }
    await db.update(schema.vehicles).set({ currentStatus: "Active" }).where(eq(schema.vehicles.id, parent.vehicleId));
    await db.update(schema.drivers).set({ status: "On Trip", assignedVehicleId: parent.vehicleId }).where(eq(schema.drivers.id, parent.driverId));
    await audit(req, "CREATE", "trips", leg.id, null, leg);
    const gps = await applyLatestGpsToTrip(leg.id).catch(() => null);
    res.json({ tripId: leg.id, tripNumber: leg.tripNumber, legNo: leg.legNo, gps });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/money", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const tripId = parseInt(req.params.id);
    const kind = clean(req.body?.kind) as keyof typeof MONEY_KINDS;
    const amount = whole(req.body?.amount);
    if (!MONEY_KINDS[kind]) return res.status(400).json({ error: "Pick what the money was for · کس لیے دیے" });
    if (amount <= 0) return res.status(400).json({ error: "Enter an amount · رقم لکھیں" });

    const [trip] = await db.select().from(schema.trips).where(and(eq(schema.trips.id, tripId), eq(schema.trips.isDeleted, false))).limit(1);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    const [veh] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, trip.vehicleId)).limit(1);
    const sharedId = veh ? await partnershipLedgerForPlate(veh.vehicleNumber) : null;
    let [led] = sharedId
      ? await db.select().from(schema.truckLedgers).where(eq(schema.truckLedgers.id, sharedId)).limit(1)
      : await db
      .select()
      .from(schema.truckLedgers)
      .where(and(eq(schema.truckLedgers.isDeleted, false), isNull(schema.truckLedgers.sourceSheet), eq(schema.truckLedgers.vehicleId, trip.vehicleId)))
      .limit(1);
    if (!led) {
      [led] = await db
        .insert(schema.truckLedgers)
        .values({ vehicleId: veh.id, registration: veh.vehicleNumber, title: veh.vehicleNumber, createdBy: req.user?.id })
        .returning();
    }
    const date = dayAt(req.body?.date);
    if (isNaN(date.getTime())) return res.status(400).json({ error: "The date is not valid · تاریخ درست نہیں" });
    const how = PAID_HOW.includes(String(req.body?.method)) ? String(req.body.method) : undefined;
    // spent out of the cash already given to the driver: take it out of that cash entry (same truck khata)
    const fromCash = !!req.body?.fromCash && kind !== "cash" ? await tripCashFor(tripId, amount, undefined, parseInt(req.body?.fromEntryId) || undefined) : null;
    const entry = await addMoneyEntry({
      ledgerId: led.id,
      tripId,
      kind,
      amount,
      date,
      description: clean(req.body?.note) || MONEY_KINDS[kind].label,
      userId: req.user?.id,
      method: how && kind !== "diesel" ? how : how === "Online" || how === "Bank" ? how : undefined,
      paidFromEntryId: fromCash?.id,
    });
    if (fromCash) {
      try {
        await db.update(schema.truckLedgerEntries).set({ paid: fromCash.paid - amount, updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.truckLedgerEntries.id, fromCash.id));
      } catch (e) {
        await db.delete(schema.truckLedgerEntries).where(eq(schema.truckLedgerEntries.id, entry.id));
        throw e;
      }
      await audit(req, "UPDATE", "truck_ledger_entries", fromCash.id, fromCash, { ...fromCash, paid: fromCash.paid - amount, note: `PKR ${amount} paid out of it (entry ${entry.id})` });
    }
    await recompute(led.id);
    if (fromCash && fromCash.ledgerId !== led.id) await recompute(fromCash.ledgerId);
    await audit(req, "CREATE", "truck_ledger_entries", entry.id, null, entry);
    res.json(entry);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- edit a trip and the money entries typed through it ------------------
router.get("/:id/entries", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    // a trip's money = every entry on any of its stops
    const rootId = parseInt(req.params.id);
    const stops = await db
      .select({ id: schema.trips.id })
      .from(schema.trips)
      .where(and(eq(schema.trips.isDeleted, false), sql`(${schema.trips.id} = ${rootId} or ${schema.trips.parentTripId} = ${rootId})`));
    const stopIds = stops.map((x) => x.id);
    if (!stopIds.length) return res.json([]);
    const rows = await db
      .select({
        id: schema.truckLedgerEntries.id,
        entryDate: schema.truckLedgerEntries.entryDate,
        category: schema.truckLedgerEntries.category,
        method: schema.truckLedgerEntries.method,
        paid: schema.truckLedgerEntries.paid,
        description: schema.truckLedgerEntries.description,
        paidFromEntryId: schema.truckLedgerEntries.paidFromEntryId,
      })
      .from(schema.truckLedgerEntries)
      .where(and(inArray(schema.truckLedgerEntries.derivedTripId, stopIds), eq(schema.truckLedgerEntries.isDeleted, false)))
      .orderBy(schema.truckLedgerEntries.entryDate, schema.truckLedgerEntries.id);
    // what was spent out of each trip-cash entry (diesel, toll… paid from it)
    const spent = new Map<number, number>();
    for (const r of rows) if (r.paidFromEntryId) spent.set(r.paidFromEntryId, (spent.get(r.paidFromEntryId) || 0) + r.paid);
    res.json(rows.map((r) => ({ ...r, spentFromIt: spent.get(r.id) || 0 })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** A journey's other khata rows: the truck's entries dated inside its span (not typed through the trip). */
router.get("/:id/khata-rows", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const rootId = (await rootOf(parseInt(req.params.id))) ?? 0;
    const legs = await journeyStops(rootId);
    if (!legs.length) return res.status(404).json({ error: "Trip not found" });
    const root = legs.find((l) => l.trip.id === rootId)?.trip ?? legs[0].trip;
    const vehicleNumber = legs[0].vehicleNumber || "";
    const spans = await tripSpansForTruck(root.vehicleId, vehicleNumber);
    const span = spans.find((s) => s.rootId === rootId);
    if (!span) return res.json({ span: null, rows: [] });
    const plate = normPlate(vehicleNumber);
    const rows = await db
      .select({
        id: schema.truckLedgerEntries.id,
        ledgerId: schema.truckLedgerEntries.ledgerId,
        ledgerTitle: schema.truckLedgers.title,
        entryDate: schema.truckLedgerEntries.entryDate,
        description: schema.truckLedgerEntries.description,
        category: schema.truckLedgerEntries.category,
        received: schema.truckLedgerEntries.received,
        paid: schema.truckLedgerEntries.paid,
      })
      .from(schema.truckLedgerEntries)
      .innerJoin(schema.truckLedgers, eq(schema.truckLedgerEntries.ledgerId, schema.truckLedgers.id))
      .where(
        and(
          eq(schema.truckLedgers.isDeleted, false),
          eq(schema.truckLedgerEntries.isDeleted, false),
          isNull(schema.truckLedgerEntries.derivedTripId),
          inSpan(span),
          sql`(${schema.truckLedgers.vehicleId} = ${root.vehicleId} or regexp_replace(upper(${schema.truckLedgers.registration}), '[^A-Z0-9]', '', 'g') = ${plate})`,
        ),
      )
      .orderBy(desc(schema.truckLedgerEntries.entryDate), desc(schema.truckLedgerEntries.id))
      .limit(300);
    const next = span.nextRootId ? spans.find((s) => s.rootId === span.nextRootId) : null;
    res.json({ span: { fromDay: span.fromDay, untilDay: span.untilDay, label: span.label, next: next ? next.label : null }, rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/entry/:entryId", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.entryId);
    const [old] = await db.select().from(schema.truckLedgerEntries).where(eq(schema.truckLedgerEntries.id, id)).limit(1);
    if (!old || old.isDeleted || old.derivedTripId == null) return res.status(404).json({ error: "Entry not found" });
    const b = req.body || {};
    const patch: Record<string, any> = { updatedAt: new Date(), updatedBy: req.user?.id };
    if (b.entryDate) {
      const d = dayAt(b.entryDate);
      if (isNaN(d.getTime())) return res.status(400).json({ error: "The date is not valid · تاریخ درست نہیں" });
      patch.entryDate = d;
      patch.rawDate = d.toISOString().slice(0, 10);
    }
    let cashRow: typeof schema.truckLedgerEntries.$inferSelect | undefined;
    let cashNew = 0;
    if (b.amount !== undefined) {
      const amt = whole(b.amount);
      if (amt <= 0) return res.status(400).json({ error: "Enter an amount · رقم لکھیں" });
      patch.paid = amt;
      if (old.paidFromEntryId && amt !== old.paid) {
        // paid out of trip cash: the cash entry gives up / gets back the difference
        [cashRow] = await db.select().from(schema.truckLedgerEntries).where(and(eq(schema.truckLedgerEntries.id, old.paidFromEntryId), eq(schema.truckLedgerEntries.isDeleted, false))).limit(1);
        if (cashRow) {
          cashNew = cashRow.paid - (amt - old.paid);
          if (cashNew < 0) return res.status(400).json({ error: `Only PKR ${(cashRow.paid + old.paid).toLocaleString()} of the trip cash is available for this — raise the cash given first · ٹرپ نقد میں اتنی رقم نہیں` });
        }
      }
    }
    if (b.description !== undefined) patch.description = clean(b.description) || null;
    if (b.kind !== undefined && MONEY_KINDS[String(b.kind)]) {
      if (old.paidFromEntryId && b.kind === "cash") return res.status(400).json({ error: "This was paid out of the trip cash — it cannot itself be trip cash. Untick “paid from trip cash” first · یہ ٹرپ نقد میں سے ادا ہوئی تھی" });
      patch.category = MONEY_KINDS[String(b.kind)].category;
    }
    if (b.method !== undefined && PAID_HOW.includes(String(b.method))) patch.method = String(b.method);
    const [row] = await db.update(schema.truckLedgerEntries).set(patch).where(eq(schema.truckLedgerEntries.id, id)).returning();
    if (cashRow) {
      await db.update(schema.truckLedgerEntries).set({ paid: cashNew, updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.truckLedgerEntries.id, cashRow.id));
      await audit(req, "UPDATE", "truck_ledger_entries", cashRow.id, cashRow, { ...cashRow, paid: cashNew, note: `entry ${id} changed from PKR ${old.paid} to PKR ${row.paid}` });
      if (cashRow.ledgerId !== old.ledgerId) await recompute(cashRow.ledgerId);
    }
    await recompute(old.ledgerId);
    await audit(req, "UPDATE", "truck_ledger_entries", id, old, row);
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** "This was paid out of the trip cash": take it out of the cash entry (fixes cash + diesel entered as two sums). */
router.post("/entry/:entryId/from-cash", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.entryId);
    const [old] = await db.select().from(schema.truckLedgerEntries).where(eq(schema.truckLedgerEntries.id, id)).limit(1);
    if (!old || old.isDeleted || old.derivedTripId == null) return res.status(404).json({ error: "Entry not found" });
    if (old.category === MONEY_KINDS.cash.category) return res.status(400).json({ error: "This is the trip cash itself · یہ خود ٹرپ نقد ہے" });
    if (old.paidFromEntryId) return res.status(400).json({ error: "Already taken out of the trip cash · پہلے ہی نقد میں سے لی گئی ہے" });
    const cash = await tripCashFor(old.derivedTripId, old.paid, id, parseInt(req.body?.cashEntryId) || undefined);
    await db.update(schema.truckLedgerEntries).set({ paidFromEntryId: cash.id, updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.truckLedgerEntries.id, id));
    await db.update(schema.truckLedgerEntries).set({ paid: cash.paid - old.paid, updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.truckLedgerEntries.id, cash.id));
    await audit(req, "UPDATE", "truck_ledger_entries", cash.id, cash, { ...cash, paid: cash.paid - old.paid, note: `PKR ${old.paid} of it was entry ${id}` });
    await audit(req, "UPDATE", "truck_ledger_entries", id, old, { ...old, paidFromEntryId: cash.id });
    await recompute(old.ledgerId);
    if (cash.ledgerId !== old.ledgerId) await recompute(cash.ledgerId);
    res.json({ ok: true, cashEntryId: cash.id, cashNow: cash.paid - old.paid });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/** Undo the above: the amount goes back into the trip cash. */
router.delete("/entry/:entryId/from-cash", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.entryId);
    const [old] = await db.select().from(schema.truckLedgerEntries).where(eq(schema.truckLedgerEntries.id, id)).limit(1);
    if (!old || old.isDeleted || !old.paidFromEntryId) return res.status(404).json({ error: "This entry was not paid out of trip cash" });
    const [cash] = await db.select().from(schema.truckLedgerEntries).where(and(eq(schema.truckLedgerEntries.id, old.paidFromEntryId), eq(schema.truckLedgerEntries.isDeleted, false))).limit(1);
    await db.update(schema.truckLedgerEntries).set({ paidFromEntryId: null, updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.truckLedgerEntries.id, id));
    if (cash) {
      await db.update(schema.truckLedgerEntries).set({ paid: cash.paid + old.paid, updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.truckLedgerEntries.id, cash.id));
      await audit(req, "UPDATE", "truck_ledger_entries", cash.id, cash, { ...cash, paid: cash.paid + old.paid, note: `entry ${id} unlinked — PKR ${old.paid} back in the trip cash` });
    }
    await audit(req, "UPDATE", "truck_ledger_entries", id, old, { ...old, paidFromEntryId: null });
    await recompute(old.ledgerId);
    if (cash && cash.ledgerId !== old.ledgerId) await recompute(cash.ledgerId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/entry/:entryId", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.entryId);
    const [old] = await db.select().from(schema.truckLedgerEntries).where(eq(schema.truckLedgerEntries.id, id)).limit(1);
    if (!old || old.isDeleted || old.derivedTripId == null) return res.status(404).json({ error: "Entry not found" });
    const [kids] = await db
      .select({ n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(paid), 0)::int` })
      .from(schema.truckLedgerEntries)
      .where(and(eq(schema.truckLedgerEntries.paidFromEntryId, id), eq(schema.truckLedgerEntries.isDeleted, false)));
    if (kids?.n) return res.status(400).json({ error: `${kids.n} entr${kids.n === 1 ? "y" : "ies"} (PKR ${Number(kids.sum).toLocaleString()}) were paid out of this trip cash — delete or unlink ${kids.n === 1 ? "it" : "them"} first · اس نقد میں سے ادا ہوئی انٹریاں پہلے ہٹائیں` });
    await db.update(schema.truckLedgerEntries).set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(schema.truckLedgerEntries.id, id));
    if (old.paidFromEntryId) {
      // it came out of a trip-cash entry: put that money back
      const [cashRow] = await db.select().from(schema.truckLedgerEntries).where(and(eq(schema.truckLedgerEntries.id, old.paidFromEntryId), eq(schema.truckLedgerEntries.isDeleted, false))).limit(1);
      if (cashRow) {
        await db.update(schema.truckLedgerEntries).set({ paid: cashRow.paid + old.paid, updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.truckLedgerEntries.id, cashRow.id));
        await audit(req, "UPDATE", "truck_ledger_entries", cashRow.id, cashRow, { ...cashRow, paid: cashRow.paid + old.paid, note: `entry ${id} deleted — PKR ${old.paid} back in the trip cash` });
        if (cashRow.ledgerId !== old.ledgerId) await recompute(cashRow.ledgerId);
      }
    }
    await recompute(old.ledgerId);
    await audit(req, "DELETE", "truck_ledger_entries", id, old, null);
    res.json({ deleted: 1 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.trips).where(and(eq(schema.trips.id, id), eq(schema.trips.isDeleted, false))).limit(1);
    if (!old) return res.status(404).json({ error: "Trip not found" });
    const b = req.body || {};
    const patch: Record<string, any> = { updatedAt: new Date(), updatedBy: req.user?.id };

    if (b.departure) {
      const d = new Date(b.departure);
      if (isNaN(d.getTime())) return res.status(400).json({ error: "The departure date is not valid · روانگی کی تاریخ درست نہیں" });
      patch.departureTime = d;
      patch.actualDepartureTime = d.getTime() <= Date.now() ? d : null;
      patch.expectedArrival = new Date(d.getTime() + (old.etaHours || 0) * 3600_000);
    }
    if (b.freight !== undefined) {
      patch.revenue = whole(b.freight);
      patch.expectedProfit = whole(b.freight);
    }
    if (b.cargo !== undefined) patch.cargo = clean(b.cargo) || null;

    const from = clean(b.from);
    const to = clean(b.to);
    if (from || to) {
      const [cur] = await db.select().from(schema.routes).where(eq(schema.routes.id, old.routeId)).limit(1);
      const o = from || cur.origin;
      const d = to || cur.destination;
      let [route] = await db.select().from(schema.routes).where(and(eq(schema.routes.isDeleted, false), sql`lower(trim(${schema.routes.origin})) = ${o.toLowerCase()}`, sql`lower(trim(${schema.routes.destination})) = ${d.toLowerCase()}`)).limit(1);
      if (!route) [route] = await db.insert(schema.routes).values({ origin: o, destination: d, distance: 0, expectedHours: 0, benchmarkFuel: 0, expectedToll: 0, revenue: 0, createdBy: req.user?.id }).returning();
      patch.routeId = route.id;
      patch.currentAddress = route.origin;
    }

    const company = clean(b.customer);
    if (company) {
      let [con] = await db.select().from(schema.contractors).where(and(eq(schema.contractors.isDeleted, false), sql`lower(trim(${schema.contractors.company})) = ${company.toLowerCase()}`)).limit(1);
      if (!con) [con] = await db.insert(schema.contractors).values({ company, createdBy: req.user?.id }).returning();
      patch.contractorId = con.id;
    }

    const driverName = clean(b.driverName);
    if (driverName) {
      const phone = clean(b.driverPhone);
      const digits = phone.replace(/\D/g, "");
      let [drv] = await db.select().from(schema.drivers).where(and(eq(schema.drivers.isDeleted, false), digits ? sql`regexp_replace(${schema.drivers.mobile}, '[^0-9]', '', 'g') = ${digits}` : sql`lower(trim(${schema.drivers.driverName})) = ${driverName.toLowerCase()}`)).limit(1);
      if (!drv) {
        const tag = randomBytes(4).toString("hex").toUpperCase();
        [drv] = await db.insert(schema.drivers).values({ driverName, cnic: `PENDING-${tag}`, licenseNumber: `PENDING-${tag}`, licenseExpiry: new Date(0), mobile: phone, salary: 0, createdBy: req.user?.id }).returning();
      } else if (phone && drv.mobile !== phone) {
        await db.update(schema.drivers).set({ mobile: phone }).where(eq(schema.drivers.id, drv.id));
      }
      patch.driverId = drv.id;
      await db.update(schema.drivers).set({ status: "On Trip", assignedVehicleId: old.vehicleId }).where(eq(schema.drivers.id, drv.id));
    }

    const [row] = await db.update(schema.trips).set(patch).where(eq(schema.trips.id, id)).returning();
    await audit(req, "UPDATE", "trips", id, old, row);
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/delete", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((n: any) => parseInt(n)).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: "No trip selected · کوئی ٹرپ منتخب نہیں" });

    const trips = await db
      .select()
      .from(schema.trips)
      .where(and(eq(schema.trips.isDeleted, false), sql`(${schema.trips.id} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) or ${schema.trips.parentTripId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}))`));
    const now = new Date();
    const entries = trips.length
      ? await db
          .select({ id: schema.truckLedgerEntries.id, ledgerId: schema.truckLedgerEntries.ledgerId })
          .from(schema.truckLedgerEntries)
          .where(and(inArray(schema.truckLedgerEntries.derivedTripId, trips.map((t) => t.id)), eq(schema.truckLedgerEntries.isDeleted, false)))
      : [];
    if (entries.length) {
      await db
        .update(schema.truckLedgerEntries)
        .set({ isDeleted: true, deletedAt: now, deletedBy: req.user?.id })
        .where(inArray(schema.truckLedgerEntries.id, entries.map((e) => e.id)));
      for (const lid of new Set(entries.map((e) => e.ledgerId))) await recompute(lid);
    }
    // receipts attached to a deleted trip / its entries must not keep haunting the duplicate-slip check
    const tripIdList = trips.map((t) => t.id);
    const entryIdList = entries.map((e) => e.id);
    if (tripIdList.length) {
      const gone = await db
        .update(schema.attachments)
        .set({ isDeleted: true, deletedAt: now, deletedBy: req.user?.id })
        .where(and(eq(schema.attachments.isDeleted, false), sql`((${schema.attachments.entityType} = 'trip' and ${schema.attachments.entityId} in (${sql.join(tripIdList.map((i) => sql`${i}`), sql`, `)}))${entryIdList.length ? sql` or (${schema.attachments.entityType} = 'truck_ledger_entry' and ${schema.attachments.entityId} in (${sql.join(entryIdList.map((i) => sql`${i}`), sql`, `)}))` : sql``})`))
        .returning({ id: schema.attachments.id });
      if (gone.length) await db.delete(schema.attachmentBlobs).where(inArray(schema.attachmentBlobs.attachmentId, gone.map((g) => g.id)));
    }
    await db
      .update(schema.trips)
      .set({ isDeleted: true, deletedAt: now, deletedBy: req.user?.id })
      .where(inArray(schema.trips.id, trips.map((t) => t.id)));

    // free the truck / driver if this was their only open trip
    for (const t of trips) {
      const open = await db
        .select({ id: schema.trips.id })
        .from(schema.trips)
        .where(and(eq(schema.trips.vehicleId, t.vehicleId), eq(schema.trips.isDeleted, false), sql`${schema.trips.status} not in ('Completed','Cancelled')`))
        .limit(1);
      if (!open.length) await db.update(schema.vehicles).set({ currentStatus: "Available" }).where(eq(schema.vehicles.id, t.vehicleId));
      const openDrv = await db
        .select({ id: schema.trips.id })
        .from(schema.trips)
        .where(and(eq(schema.trips.driverId, t.driverId), eq(schema.trips.isDeleted, false), sql`${schema.trips.status} not in ('Completed','Cancelled')`))
        .limit(1);
      if (!openDrv.length) await db.update(schema.drivers).set({ status: "Available" }).where(eq(schema.drivers.id, t.driverId));
      await audit(req, "DELETE", "trips", t.id, t, null);
    }
    res.json({ deleted: trips.length, khataEntriesRemoved: entries.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Masters (truck / driver / route / customer) — one lean add/edit/delete API.
// Only the name fields are required; everything else is optional and blank
// values are stored as the schema's neutral defaults.
// ---------------------------------------------------------------------------
type FieldType = "text" | "int" | "date";
interface MasterCfg {
  table: any;
  required: string[];
  fields: Record<string, FieldType>;
  list: string[];
  unique?: (b: Record<string, any>) => Promise<string | null>;
  create: (v: Record<string, any>) => Record<string, any>;
}
const FIELD_LABEL: Record<string, string> = { vehicleNumber: "Truck number", driverName: "Driver name", origin: "From", destination: "To", company: "Customer name" };
const NULLABLE_TEXT = ["address", "contactPerson", "phone", "email"];
const KEEP_IF_BLANK = ["cnic", "licenseNumber", "email"];

const MASTERS: Record<string, MasterCfg> = {
  vehicles: {
    table: schema.vehicles,
    required: ["vehicleNumber"],
    fields: {
      vehicleNumber: "text", vehicleType: "text", truckBrand: "text", model: "text", year: "int",
      containerType: "text", payloadCapacity: "int", currentOdometer: "int", engineNumber: "text",
      chassisNumber: "text", insuranceExpiry: "date", fitnessExpiry: "date",
    },
    list: ["id", "vehicleNumber", "vehicleType", "truckBrand", "model", "year", "currentStatus", "insuranceExpiry", "fitnessExpiry", "engineNumber", "chassisNumber", "containerType", "payloadCapacity", "currentOdometer"],
    unique: async (b) => {
      const [x] = await db
        .select({ id: schema.vehicles.id })
        .from(schema.vehicles)
        .where(and(eq(schema.vehicles.isDeleted, false), sql`regexp_replace(upper(${schema.vehicles.vehicleNumber}), '[^A-Z0-9]', '', 'g') = ${normPlate(b.vehicleNumber)}`))
        .limit(1);
      return x ? `${b.vehicleNumber} already exists · پہلے سے موجود ہے` : null;
    },
    create: (v) => ({
      vehicleNumber: clean(v.vehicleNumber).toUpperCase(),
      registrationNumber: clean(v.vehicleNumber).toUpperCase(),
      engineNumber: clean(v.engineNumber),
      chassisNumber: clean(v.chassisNumber),
      vehicleType: clean(v.vehicleType) || "Truck",
      truckBrand: clean(v.truckBrand),
      model: clean(v.model),
      year: whole(v.year),
      containerType: clean(v.containerType),
      payloadCapacity: whole(v.payloadCapacity),
      currentOdometer: whole(v.currentOdometer),
      insuranceExpiry: v.insuranceExpiry ? new Date(v.insuranceExpiry) : null,
      fitnessExpiry: v.fitnessExpiry ? new Date(v.fitnessExpiry) : null,
    }),
  },
  drivers: {
    table: schema.drivers,
    required: ["driverName"],
    fields: { driverName: "text", mobile: "text", cnic: "text", licenseNumber: "text", licenseExpiry: "date", salary: "int", address: "text" },
    list: ["id", "driverName", "mobile", "status", "cnic", "licenseNumber", "licenseExpiry", "salary", "address"],
    create: (v) => {
      const tag = randomBytes(4).toString("hex").toUpperCase();
      return {
        driverName: clean(v.driverName),
        mobile: clean(v.mobile),
        cnic: clean(v.cnic) || `PENDING-${tag}`,
        licenseNumber: clean(v.licenseNumber) || `PENDING-${tag}`,
        licenseExpiry: v.licenseExpiry ? new Date(v.licenseExpiry) : new Date(0),
        salary: whole(v.salary),
        address: clean(v.address) || null,
      };
    },
  },
  routes: {
    table: schema.routes,
    required: ["origin", "destination"],
    fields: { origin: "text", destination: "text", distance: "int", expectedHours: "int", benchmarkFuel: "int", expectedToll: "int", revenue: "int" },
    list: ["id", "origin", "destination", "distance", "expectedHours", "benchmarkFuel", "expectedToll", "revenue"],
    unique: async (b) => {
      const [x] = await db
        .select({ id: schema.routes.id })
        .from(schema.routes)
        .where(and(eq(schema.routes.isDeleted, false), sql`lower(trim(${schema.routes.origin})) = ${clean(b.origin).toLowerCase()}`, sql`lower(trim(${schema.routes.destination})) = ${clean(b.destination).toLowerCase()}`))
        .limit(1);
      return x ? "This route already exists · یہ روٹ پہلے سے موجود ہے" : null;
    },
    create: (v) => ({
      origin: clean(v.origin),
      destination: clean(v.destination),
      distance: whole(v.distance),
      expectedHours: whole(v.expectedHours),
      benchmarkFuel: whole(v.benchmarkFuel),
      expectedToll: whole(v.expectedToll),
      revenue: whole(v.revenue),
    }),
  },
  customers: {
    table: schema.contractors,
    required: ["company"],
    fields: { company: "text", contactPerson: "text", phone: "text", email: "text", address: "text", paymentTerms: "text" },
    list: ["id", "company", "contactPerson", "phone", "email", "address", "paymentTerms", "outstandingBalance", "status"],
    unique: async (b) => {
      const [x] = await db
        .select({ id: schema.contractors.id })
        .from(schema.contractors)
        .where(and(eq(schema.contractors.isDeleted, false), sql`lower(trim(${schema.contractors.company})) = ${clean(b.company).toLowerCase()}`))
        .limit(1);
      return x ? `${b.company} already exists · پہلے سے موجود ہے` : null;
    },
    create: (v) => ({
      company: clean(v.company),
      contactPerson: clean(v.contactPerson) || null,
      phone: clean(v.phone) || null,
      email: clean(v.email) || null,
      address: clean(v.address) || null,
      paymentTerms: clean(v.paymentTerms) || "Net 30",
    }),
  },
};

const masterOr404 = (req: AuthRequest, res: Response): MasterCfg | null => {
  const cfg = MASTERS[req.params.kind];
  if (!cfg) {
    res.status(404).json({ error: "Unknown list" });
    return null;
  }
  return cfg;
};
const tableName = (kind: string) => (kind === "customers" ? "contractors" : kind);

router.get("/master/:kind", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const cfg = masterOr404(req, res);
    if (!cfg) return;
    const rows = await db.select().from(cfg.table).where(eq(cfg.table.isDeleted, false)).orderBy(desc(cfg.table.id)).limit(2000);
    res.json(rows.map((r: any) => Object.fromEntries(cfg.list.map((k) => [k, r[k] ?? null]))));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/master/:kind", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const cfg = masterOr404(req, res);
    if (!cfg) return;
    const b = req.body || {};
    for (const k of cfg.required) if (!clean(b[k])) return res.status(400).json({ error: `${FIELD_LABEL[k] || k} is required · ضروری ہے` });
    const dup = cfg.unique ? await cfg.unique(b) : null;
    if (dup) return res.status(409).json({ error: dup });
    const [row] = (await db.insert(cfg.table).values({ ...cfg.create(b), createdBy: req.user?.id } as any).returning()) as any[];
    await audit(req, "CREATE", tableName(req.params.kind), row.id, null, row);
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/master/:kind/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const cfg = masterOr404(req, res);
    if (!cfg) return;
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(cfg.table).where(eq(cfg.table.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Not found" });
    const patch: Record<string, any> = {};
    for (const [k, type] of Object.entries(cfg.fields)) {
      if (!(k in (req.body || {}))) continue;
      const raw = req.body[k];
      if (cfg.required.includes(k) && !clean(raw)) return res.status(400).json({ error: `${FIELD_LABEL[k] || k} cannot be empty · خالی نہیں ہو سکتا` });
      if (type === "int") patch[k] = whole(raw);
      else if (type === "date") {
        if (clean(raw)) patch[k] = new Date(raw);
      } else if (clean(raw)) patch[k] = clean(raw);
      else if (!KEEP_IF_BLANK.includes(k)) patch[k] = NULLABLE_TEXT.includes(k) ? null : "";
    }
    if (patch.vehicleNumber) {
      patch.vehicleNumber = String(patch.vehicleNumber).toUpperCase();
      patch.registrationNumber = patch.vehicleNumber;
    }
    if (!Object.keys(patch).length) return res.json(old);
    const [row] = (await db.update(cfg.table).set({ ...patch, updatedAt: new Date(), updatedBy: req.user?.id } as any).where(eq(cfg.table.id, id)).returning()) as any[];
    await audit(req, "UPDATE", tableName(req.params.kind), id, old, row);
    res.json(row);
  } catch (e: any) {
    res.status(e.code === "23505" ? 409 : 500).json({ error: e.code === "23505" ? "This value is already used by another record · یہ ویلیو کسی اور ریکارڈ میں پہلے سے ہے" : e.message });
  }
});

router.post("/master/:kind/delete", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const cfg = masterOr404(req, res);
    if (!cfg) return;
    const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((n: any) => parseInt(n)).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: "Nothing selected · کچھ منتخب نہیں" });
    const rows = (await db
      .update(cfg.table)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id } as any)
      .where(inArray(cfg.table.id, ids))
      .returning()) as any[];
    for (const r of rows) await audit(req, "DELETE", tableName(req.params.kind), r.id, r, null);
    res.json({ deleted: rows.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Close trip (option C): bills, what came in per customer, 50/50 when all is received ----
const money = (v: any) => whole(String(v ?? "").replace(/[^0-9.]/g, ""));

async function journeyOr404(req: AuthRequest, res: Response) {
  const rootId = await rootOf(parseInt(req.params.id));
  if (!rootId) {
    res.status(404).json({ error: "Trip not found" });
    return null;
  }
  const m = await journeyMoney(rootId);
  if (!m) {
    res.status(404).json({ error: "Trip not found" });
    return null;
  }
  return m;
}

router.get("/:id/close", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const m = await journeyOr404(req, res);
    if (!m) return;
    const partnership = m.vehicleNumber ? await partnershipPreviewForPlate(m.vehicleNumber) : null;
    res.json({ ...m, partnership });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Mark every stop Completed (frees truck and driver, makes each customer's bill) and the journey closed. */
router.post("/:id/close/complete", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const m = await journeyOr404(req, res);
    if (!m) return;
    const legs = await journeyStops(m.rootId);
    for (const l of legs) {
      if (l.trip.status !== "Completed") {
        await db.update(schema.trips).set({ status: "Completed", updatedAt: new Date() }).where(eq(schema.trips.id, l.trip.id));
        await audit(req, "UPDATE", "trips", l.trip.id, { status: l.trip.status }, { status: "Completed", via: "Close trip" });
        try {
          await triggerAutoInvoicing(l.trip.id, { userId: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] as string });
        } catch (err: any) {
          console.error("[close trip] invoicing failed:", err?.message);
        }
      }
      await syncStopInvoice(l.trip.id, req.user?.id); // money already received marks the new bill paid
    }
    const last = legs[legs.length - 1].trip;
    await db.update(schema.vehicles).set({ currentStatus: "Available" }).where(eq(schema.vehicles.id, last.vehicleId));
    await db.update(schema.drivers).set({ status: "Available" }).where(eq(schema.drivers.id, last.driverId));
    await db.update(schema.trips).set({ closedAt: m.closedAt ?? new Date() }).where(eq(schema.trips.id, m.rootId));
    res.json(await journeyMoney(m.rootId));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Money received for one stop: a Cash Book "Kirya jama" entry linked to the truck, tagged to the stop. */
router.post("/:id/close/receive", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const m = await journeyOr404(req, res);
    if (!m) return;
    const b = req.body || {};
    const stop = m.stops.find((s) => s.id === Number(b.stopId));
    if (!stop) return res.status(400).json({ error: "Pick the stop / customer · کسٹمر منتخب کریں" });
    const amount = money(b.amount);
    if (amount <= 0) return res.status(400).json({ error: "Enter the amount · رقم لکھیں" });
    const method = clean(b.method) || "Cash";
    const row = await createCashEntry(
      {
        entryDate: b.date || new Date().toISOString(),
        direction: "In",
        amount,
        person: stop.customer || null,
        description: `${m.vehicleNumber} • Kiraya jama — ${stop.customer || "customer"} — ${stop.from || ""} → ${stop.to || ""} (${method})`,
        notes: clean(b.note) || null,
        linkType: "truck",
        linkTargetId: m.vehicleId,
      },
      req.user?.id,
    );
    if (row?.derivedEntryId) {
      const [e] = await db
        .update(schema.truckLedgerEntries)
        .set({ derivedTripId: stop.id, category: "Freight", method })
        .where(eq(schema.truckLedgerEntries.id, row.derivedEntryId))
        .returning({ ledgerId: schema.truckLedgerEntries.ledgerId });
      if (e) await recompute(e.ledgerId);
    }
    await syncStopInvoice(stop.id, req.user?.id);
    res.json(await journeyMoney(m.rootId));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** "Is this Sardar Wali's?" — tie kiraya already in the truck's khata to a stop (or untie it). */
router.post("/:id/close/assign", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const m = await journeyOr404(req, res);
    if (!m) return;
    const b = req.body || {};
    const entryId = Number(b.entryId);
    const stopId = b.stopId ? Number(b.stopId) : null;
    if (stopId && !m.stops.some((s) => s.id === stopId)) return res.status(400).json({ error: "That stop is not part of this trip" });
    const allowed = new Set([...m.unassigned.map((u) => u.id), ...m.stops.flatMap((s) => s.receipts.map((r) => r.id))]);
    if (!allowed.has(entryId)) return res.status(400).json({ error: "That khata row is not money received for this truck since the trip began" });
    const [before] = await db.select({ tripId: schema.truckLedgerEntries.derivedTripId }).from(schema.truckLedgerEntries).where(eq(schema.truckLedgerEntries.id, entryId)).limit(1);
    const [e] = await db
      .update(schema.truckLedgerEntries)
      .set({ derivedTripId: stopId, ...(stopId ? { category: "Freight" } : {}) })
      .where(eq(schema.truckLedgerEntries.id, entryId))
      .returning({ ledgerId: schema.truckLedgerEntries.ledgerId });
    if (e) await recompute(e.ledgerId);
    if (before?.tripId && before.tripId !== stopId) await resyncStopInvoice(before.tripId, req.user?.id); // its bill goes back down
    if (stopId) await resyncStopInvoice(stopId, req.user?.id);
    await audit(req, "UPDATE", "truck_ledger_entries", entryId, null, { derivedTripId: stopId, via: "Close trip" });
    res.json(await journeyMoney(m.rootId));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** A customer won't pay the rest (or pays less): write it off so the trip can close. 0 undoes it. */
router.post("/:id/close/writeoff", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const m = await journeyOr404(req, res);
    if (!m) return;
    const b = req.body || {};
    const stop = m.stops.find((s) => s.id === Number(b.stopId));
    if (!stop) return res.status(400).json({ error: "Pick the stop / customer · کسٹمر منتخب کریں" });
    const most = Math.max(0, stop.freight - stop.received);
    const amount = b.amount === "rest" ? most : Math.min(most, money(b.amount));
    await db.update(schema.trips).set({ freightWrittenOff: amount }).where(eq(schema.trips.id, stop.id));
    await audit(req, "UPDATE", "trips", stop.id, { freightWrittenOff: stop.writtenOff }, { freightWrittenOff: amount, note: clean(b.note) || null });
    res.json(await journeyMoney(m.rootId));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** All customers paid: split the result 50/50 (closes the truck's Partner P&L cycle). */
router.post("/:id/close/split", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const m = await journeyOr404(req, res);
    if (!m) return;
    if (m.splitAt) return res.status(400).json({ error: "This trip was already split · پہلے ہی تقسیم ہو چکا" });
    if (!m.allPaid) {
      const who = m.stops.filter((s) => s.pending > 0).map((s) => `${s.customer} ${s.pending.toLocaleString()}`).join(", ");
      return res.status(400).json({ error: `Still to receive: ${who}. Mark it received, or write it off, first · ابھی رقم باقی ہے` });
    }
    const p = m.vehicleNumber ? await partnershipPreviewForPlate(m.vehicleNumber) : null;
    if (!p) return res.status(400).json({ error: "This truck has no partnership — nothing to split · اس ٹرک کا شراکتی حساب نہیں" });
    const r = await closePartnershipCycle(p.accountId, { date: new Date(), splitLoss: !!req.body?.splitLoss, userId: req.user?.id, note: `trip ${m.route}` });
    await db.update(schema.trips).set({ splitAt: new Date(), splitAmount: r.net, splitAccountId: p.accountId }).where(eq(schema.trips.id, m.rootId));
    await audit(req, "UPDATE", "trips", m.rootId, null, { split: r });
    res.json({ ...(await journeyMoney(m.rootId)), split: r });
  } catch (e: any) {
    const known = /Nothing written|short by|not found/.test(e.message || "");
    res.status(known ? 400 : 500).json({ error: e.message });
  }
});

/** A receipt of this trip: the khata line and the Cash Book entry that made it (if any). */
async function receiptOf(m: NonNullable<Awaited<ReturnType<typeof journeyMoney>>>, entryId: number) {
  const stop = m.stops.find((s) => s.receipts.some((r: any) => r.id === entryId));
  if (!stop) return null;
  const [cash] = await db
    .select()
    .from(schema.cashTransactions)
    .where(and(eq(schema.cashTransactions.derivedEntryId, entryId), eq(schema.cashTransactions.linkType, "truck"), eq(schema.cashTransactions.isDeleted, false)))
    .limit(1);
  return { stop, cash: cash ?? null };
}

/** Fix a receipt's amount / date — the khata line and its Cash Book entry change together. */
router.post("/:id/close/receipt/edit", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const m = await journeyOr404(req, res);
    if (!m) return;
    if (m.splitAt) return res.status(400).json({ error: "This trip is already split — take the split back first · پہلے تقسیم واپس لیں" });
    const b = req.body || {};
    const entryId = Number(b.entryId);
    const r = await receiptOf(m, entryId);
    if (!r) return res.status(404).json({ error: "Receipt not found on this trip" });
    const amount = money(b.amount);
    if (amount <= 0) return res.status(400).json({ error: "Enter the amount · رقم لکھیں" });
    const date = b.date ? new Date(b.date) : null;
    const [e] = await db
      .update(schema.truckLedgerEntries)
      .set({ received: amount, ...(date ? { entryDate: date, rawDate: String(b.date).slice(0, 10) } : {}), updatedAt: new Date(), updatedBy: req.user?.id })
      .where(eq(schema.truckLedgerEntries.id, entryId))
      .returning({ ledgerId: schema.truckLedgerEntries.ledgerId });
    if (r.cash) {
      await db
        .update(schema.cashTransactions)
        .set({ amount, ...(date ? { entryDate: date } : {}), updatedAt: new Date(), updatedBy: req.user?.id })
        .where(eq(schema.cashTransactions.id, r.cash.id));
    }
    if (e) await recompute(e.ledgerId);
    await resyncStopInvoice(r.stop.id, req.user?.id);
    await audit(req, "UPDATE", "truck_ledger_entries", entryId, null, { received: amount, date: b.date || null, cashEntry: r.cash?.id ?? null, via: "Close trip" });
    res.json(await journeyMoney(m.rootId));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Delete a receipt entered by mistake: its khata line and its Cash Book entry go. */
router.post("/:id/close/receipt/delete", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const m = await journeyOr404(req, res);
    if (!m) return;
    if (m.splitAt) return res.status(400).json({ error: "This trip is already split — take the split back first · پہلے تقسیم واپس لیں" });
    const entryId = Number(req.body?.entryId);
    const r = await receiptOf(m, entryId);
    if (!r) return res.status(404).json({ error: "Receipt not found on this trip" });
    const [e] = await db
      .update(schema.truckLedgerEntries)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id })
      .where(eq(schema.truckLedgerEntries.id, entryId))
      .returning({ ledgerId: schema.truckLedgerEntries.ledgerId });
    if (r.cash) {
      await db.update(schema.cashTransactions).set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id }).where(eq(schema.cashTransactions.id, r.cash.id));
    }
    if (e) await recompute(e.ledgerId);
    await resyncStopInvoice(r.stop.id, req.user?.id);
    await audit(req, "DELETE", "truck_ledger_entries", entryId, { stop: r.stop.id, cashEntry: r.cash?.id ?? null }, null);
    res.json(await journeyMoney(m.rootId));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** Take the 50/50 split back (reopens the Partner P&L cycle — only if it's the latest split). */
router.post("/:id/close/unsplit", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const m = await journeyOr404(req, res);
    if (!m) return;
    if (!m.splitAt || !m.splitAccountId) return res.status(400).json({ error: "This trip isn't split" });
    await reopenLastCycle(m.splitAccountId, req.user?.id, `trip ${m.route}`);
    await db.update(schema.trips).set({ splitAt: null, splitAmount: null, splitAccountId: null }).where(eq(schema.trips.id, m.rootId));
    await audit(req, "UPDATE", "trips", m.rootId, { splitAt: m.splitAt, splitAmount: m.splitAmount }, { split: "taken back" });
    res.json(await journeyMoney(m.rootId));
  } catch (e: any) {
    res.status(/later split|No closed|not found/.test(e.message || "") ? 400 : 500).json({ error: e.message });
  }
});

/** Reopen the trip: bills removed (with Close trip's payments), stops back to Arrived. Receipts stay. */
router.post("/:id/close/reopen", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const m = await journeyOr404(req, res);
    if (!m) return;
    if (m.splitAt) return res.status(400).json({ error: "Take the 50/50 split back first · پہلے تقسیم واپس لیں" });
    const legs = await journeyStops(m.rootId);
    // check every bill can go before touching any
    for (const l of legs) {
      const [inv] = await db
        .select({ id: schema.invoices.id, no: schema.invoices.invoiceNumber })
        .from(schema.invoices)
        .where(and(eq(schema.invoices.tripId, l.trip.id), eq(schema.invoices.isDeleted, false)))
        .limit(1);
      if (!inv) continue;
      const other = await db
        .select({ id: schema.payments.id })
        .from(schema.invoicePayments)
        .innerJoin(schema.payments, eq(schema.invoicePayments.paymentId, schema.payments.id))
        .where(and(eq(schema.invoicePayments.invoiceId, inv.id), sql`coalesce(${schema.payments.referenceNumber}, '') <> ${`TRIP-${l.trip.id}`}`));
      if (other.length) return res.status(400).json({ error: `Bill ${inv.no} has payments entered in Finance — remove those there first · فنانس والی ادائیگی پہلے ہٹائیں` });
    }
    for (const l of legs) {
      await deleteStopInvoice(l.trip.id);
      if (l.trip.status === "Completed") await db.update(schema.trips).set({ status: "Arrived", updatedAt: new Date() }).where(eq(schema.trips.id, l.trip.id));
    }
    await db.update(schema.trips).set({ closedAt: null }).where(eq(schema.trips.id, m.rootId));
    await audit(req, "UPDATE", "trips", m.rootId, { closedAt: m.closedAt }, { reopened: true });
    res.json(await journeyMoney(m.rootId));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export const tripDeskRouter = router;
