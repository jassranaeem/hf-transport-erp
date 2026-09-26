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
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { recompute } from "./ledgers.ts";

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

const MONEY_KINDS: Record<string, { method: string; category: string }> = {
  cash: { method: "Cash", category: "TripCash" },
  diesel: { method: "Diesel", category: "Diesel" },
  other: { method: "Cash", category: "Other" },
};

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
      createdBy: opts.userId,
    })
    .returning();
  return row;
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
          })
          .from(schema.truckLedgerEntries)
          .where(and(inArray(schema.truckLedgerEntries.derivedTripId, ids), eq(schema.truckLedgerEntries.isDeleted, false)))
          .groupBy(schema.truckLedgerEntries.derivedTripId, schema.truckLedgerEntries.category)
      : [];
    const byTrip = new Map<number, Record<string, number>>();
    for (const m of money) {
      if (m.tripId == null) continue;
      const cur = byTrip.get(m.tripId) || {};
      cur[m.category] = Number(m.paid);
      byTrip.set(m.tripId, cur);
    }

    res.json(
      rows.map((r) => {
        const m = byTrip.get(r.trip.id) || {};
        const total = Object.values(m).reduce((s, n) => s + n, 0);
        return {
          id: r.trip.id,
          tripNumber: r.trip.tripNumber,
          status: r.trip.status,
          departureTime: r.trip.departureTime,
          revenue: r.trip.revenue,
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

    // --- truck
    const plate = normPlate(truckInput);
    let [veh] = await db
      .select()
      .from(schema.vehicles)
      .where(and(eq(schema.vehicles.isDeleted, false), sql`regexp_replace(upper(${schema.vehicles.vehicleNumber}), '[^A-Z0-9]', '', 'g') = ${plate}`))
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
        createdBy: req.user?.id,
      })
      .returning();
    await audit(req, "CREATE", "trips", trip.id, null, trip);

    await db.update(schema.vehicles).set({ currentStatus: "Active" }).where(eq(schema.vehicles.id, veh.id));
    await db.update(schema.drivers).set({ status: "On Trip", assignedVehicleId: veh.id }).where(eq(schema.drivers.id, drv.id));

    // --- khata + money given
    let [led] = await db
      .select()
      .from(schema.truckLedgers)
      .where(
        and(
          eq(schema.truckLedgers.isDeleted, false),
          sql`regexp_replace(upper(${schema.truckLedgers.registration}), '[^A-Z0-9]', '', 'g') = ${plate}`,
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
    if (cash > 0) {
      await addMoneyEntry({ ledgerId: led.id, tripId: trip.id, kind: "cash", amount: cash, date: departure, description: `Trip cash · ${routeLabel}`, userId: req.user?.id, routeFrom: route.origin, routeTo: route.destination });
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

    res.json({ tripId: trip.id, tripNumber: trip.tripNumber, ledgerId: led.id, created });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/money", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const tripId = parseInt(req.params.id);
    const kind = clean(req.body?.kind) as keyof typeof MONEY_KINDS;
    const amount = whole(req.body?.amount);
    if (!MONEY_KINDS[kind]) return res.status(400).json({ error: "kind must be cash, diesel or other" });
    if (amount <= 0) return res.status(400).json({ error: "Enter an amount · رقم لکھیں" });

    const [trip] = await db.select().from(schema.trips).where(and(eq(schema.trips.id, tripId), eq(schema.trips.isDeleted, false))).limit(1);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    const [veh] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, trip.vehicleId)).limit(1);
    let [led] = await db
      .select()
      .from(schema.truckLedgers)
      .where(and(eq(schema.truckLedgers.isDeleted, false), eq(schema.truckLedgers.vehicleId, trip.vehicleId)))
      .limit(1);
    if (!led) {
      [led] = await db
        .insert(schema.truckLedgers)
        .values({ vehicleId: veh.id, registration: veh.vehicleNumber, title: veh.vehicleNumber, createdBy: req.user?.id })
        .returning();
    }
    const date = req.body?.date ? new Date(req.body.date) : new Date();
    const entry = await addMoneyEntry({
      ledgerId: led.id,
      tripId,
      kind,
      amount,
      date,
      description: clean(req.body?.note) || (kind === "cash" ? "Trip cash" : kind === "diesel" ? "Diesel" : "Kharcha"),
      userId: req.user?.id,
    });
    await recompute(led.id);
    await audit(req, "CREATE", "truck_ledger_entries", entry.id, null, entry);
    res.json(entry);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/delete", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((n: any) => parseInt(n)).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: "No trip selected · کوئی ٹرپ منتخب نہیں" });

    const trips = await db.select().from(schema.trips).where(and(inArray(schema.trips.id, ids), eq(schema.trips.isDeleted, false)));
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

export const tripDeskRouter = router;
