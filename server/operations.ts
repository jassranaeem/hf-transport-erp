import { Router, Response } from "express";
import { requireAuth, requireRole, requirePermission, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { eq, desc, and, isNull, sql, ilike, or, asc, inArray, gte, lte } from "drizzle-orm";
import { logAudit } from "../src/db/audit.ts";
import { SocketServer } from "../src/sockets/socket.ts";
import { LoggerService } from "../src/logger/logger.ts";

const router = Router();

// ---------------------------------------------------------
// REUSABLE AUDIT HELPER
// ---------------------------------------------------------
async function audit(
  req: AuthRequest,
  action: "CREATE" | "UPDATE" | "DELETE",
  tableName: string,
  recordId: number,
  oldValues: any,
  newValues: any,
  tx?: any
) {
  await logAudit({
    action,
    tableName,
    recordId,
    oldValues,
    newValues,
    performedBy: req.user?.id,
    ipAddress: req.ip || req.socket.remoteAddress || undefined,
    userAgent: req.headers["user-agent"] || undefined,
  }, tx);
  
  // Real-time broadcast of data modifications
  SocketServer.broadcastNotification(null, {
    id: Math.floor(Math.random() * 100000),
    userId: null,
    type: "Operations",
    title: `${tableName.toUpperCase()} ${action}D`,
    message: `Record #${recordId} in ${tableName} was successfully ${action.toLowerCase()}d by ${req.user?.name || "System"}.`,
    isRead: false,
    channel: "in-app",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    createdBy: req.user?.id || null,
    updatedBy: null,
    deletedBy: null,
    isDeleted: false,
  });
}

// ---------------------------------------------------------
// MODULE 1 — VEHICLES API
// ---------------------------------------------------------

// List Vehicles (with Search, Filtering, Sorting, Pagination)
router.get("/vehicles", requireAuth, requirePermission("vehicles", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string) || "";
    const type = (req.query.type as string) || "";
    const status = (req.query.status as string) || "";
    const brand = (req.query.brand as string) || "";
    const sortBy = (req.query.sortBy as string) || "createdAt";
    const sortOrder = (req.query.sortOrder as "asc" | "desc") || "desc";

    const conditions = [eq(schema.vehicles.isDeleted, false)];

    if (search) {
      conditions.push(
        or(
          ilike(schema.vehicles.vehicleNumber, `%${search}%`),
          ilike(schema.vehicles.registrationNumber, `%${search}%`),
          ilike(schema.vehicles.gpsDeviceImei, `%${search}%`),
          ilike(schema.vehicles.model, `%${search}%`)
        ) as any
      );
    }

    if (type) {
      conditions.push(eq(schema.vehicles.vehicleType, type));
    }
    if (status) {
      conditions.push(eq(schema.vehicles.currentStatus, status));
    }
    if (brand) {
      conditions.push(eq(schema.vehicles.truckBrand, brand));
    }

    let orderBySpec = desc(schema.vehicles.createdAt);
    if (sortBy === "vehicleNumber") {
      orderBySpec = sortOrder === "asc" ? asc(schema.vehicles.vehicleNumber) : desc(schema.vehicles.vehicleNumber);
    } else if (sortBy === "currentOdometer") {
      orderBySpec = sortOrder === "asc" ? asc(schema.vehicles.currentOdometer) : desc(schema.vehicles.currentOdometer);
    } else if (sortBy === "year") {
      orderBySpec = sortOrder === "asc" ? asc(schema.vehicles.year) : desc(schema.vehicles.year);
    }

    const data = await db
      .select()
      .from(schema.vehicles)
      .where(and(...conditions))
      .orderBy(orderBySpec)
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.vehicles)
      .where(and(...conditions));

    const total = Number(countResult[0]?.count || 0);

    res.json({ data, pagination: { limit, offset, total } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create Vehicle
router.post("/vehicles", requireAuth, requirePermission("vehicles", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const payload = req.body;
    payload.createdBy = req.user?.id;
    payload.updatedAt = new Date();

    if (payload.insuranceExpiry) payload.insuranceExpiry = new Date(payload.insuranceExpiry);
    if (payload.fitnessExpiry) payload.fitnessExpiry = new Date(payload.fitnessExpiry);
    if (payload.purchaseDate) payload.purchaseDate = new Date(payload.purchaseDate);

    if (payload.gpsDeviceImei === "" || (typeof payload.gpsDeviceImei === "string" && payload.gpsDeviceImei.trim() === "")) {
      payload.gpsDeviceImei = null;
    }

    const created = await db.transaction(async (tx) => {
      const [resObj] = await tx.insert(schema.vehicles).values(payload).returning();
      await audit(req, "CREATE", "vehicles", resObj.id, null, resObj, tx);
      return resObj;
    });
    res.json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update Vehicle
router.put("/vehicles/:id", requireAuth, requirePermission("vehicles", "update"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const payload = req.body;
    payload.updatedAt = new Date();
    payload.updatedBy = req.user?.id;

    if (payload.insuranceExpiry) payload.insuranceExpiry = new Date(payload.insuranceExpiry);
    if (payload.fitnessExpiry) payload.fitnessExpiry = new Date(payload.fitnessExpiry);
    if (payload.purchaseDate) payload.purchaseDate = new Date(payload.purchaseDate);

    if (payload.gpsDeviceImei === "" || (typeof payload.gpsDeviceImei === "string" && payload.gpsDeviceImei.trim() === "")) {
      payload.gpsDeviceImei = null;
    }

    const [old] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Vehicle not found" });

    // Clean payload of read-only fields
    delete payload.id;
    delete payload.createdAt;

    const [updated] = await db
      .update(schema.vehicles)
      .set(payload)
      .where(eq(schema.vehicles.id, id))
      .returning();

    await audit(req, "UPDATE", "vehicles", id, old, updated);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Soft Delete Vehicle
router.delete("/vehicles/:id", requireAuth, requirePermission("vehicles", "delete"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Vehicle not found" });

    const [updated] = await db
      .update(schema.vehicles)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user?.id,
      })
      .where(eq(schema.vehicles.id, id))
      .returning();

    await audit(req, "DELETE", "vehicles", id, old, updated);
    SocketServer.emit("vehicle:deleted", { id });
    res.json({ message: "Vehicle deleted successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Import Vehicles Bulk
router.post("/vehicles/import", requireAuth, requirePermission("vehicles", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const list = req.body;
    if (!Array.isArray(list)) return res.status(400).json({ error: "Payload must be an array of objects" });

    const inserted: any[] = [];
    for (const item of list) {
      item.createdBy = req.user?.id;
      const [res] = await db.insert(schema.vehicles).values(item).returning();
      await audit(req, "CREATE", "vehicles", res.id, null, res);
      inserted.push(res);
    }
    res.json({ message: `Successfully imported ${inserted.length} vehicles`, count: inserted.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Export Vehicles
router.get("/vehicles/export", requireAuth, requirePermission("vehicles", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const list = await db.select().from(schema.vehicles).where(eq(schema.vehicles.isDeleted, false));
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// "Truck 360" profile — every module's data for ONE truck, in one call, so
// searching a vehicle number shows everything about it (khata, trips,
// expenses, maintenance, fuel, compliance) without hunting across separate
// screens. Ledgers/entries are the deep khata history (kept summarised —
// each ledger's last 15 entries + its own total — the full ledger is still
// reachable at GET /api/ledgers/:id, same as the Khata screen's "view full
// ledger"), everything else is a recent-N + running totals.
router.get("/vehicles/:id/profile", requireAuth, requirePermission("vehicles", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [vehicle] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id)).limit(1);
    if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });

    const [driver] = await db
      .select()
      .from(schema.drivers)
      .where(and(eq(schema.drivers.assignedVehicleId, id), eq(schema.drivers.isDeleted, false)))
      .limit(1);

    // ---- Khata: every truck_ledgers row for this vehicle (one per source
    // file/sheet it was ever imported from — see sourceSheet), each with its
    // own recent entries + closing balance. ----------------------------
    const ledgerRows = await db
      .select()
      .from(schema.truckLedgers)
      .where(and(eq(schema.truckLedgers.vehicleId, id), eq(schema.truckLedgers.isDeleted, false)))
      .orderBy(desc(schema.truckLedgers.updatedAt));
    const ledgerIds = ledgerRows.map((l) => l.id);
    const recentEntriesByLedger = new Map<number, any[]>();
    const entryCountByLedger = new Map<number, number>();
    if (ledgerIds.length) {
      const allEntries = await db
        .select()
        .from(schema.truckLedgerEntries)
        .where(and(inArray(schema.truckLedgerEntries.ledgerId, ledgerIds), eq(schema.truckLedgerEntries.isDeleted, false)))
        .orderBy(desc(schema.truckLedgerEntries.entryDate), desc(schema.truckLedgerEntries.id));
      for (const e of allEntries) {
        entryCountByLedger.set(e.ledgerId, (entryCountByLedger.get(e.ledgerId) || 0) + 1);
        const bucket = recentEntriesByLedger.get(e.ledgerId) || [];
        if (bucket.length < 15) bucket.push(e);
        recentEntriesByLedger.set(e.ledgerId, bucket);
      }
    }
    const khata = {
      totalLedgers: ledgerRows.length,
      totalEntries: [...entryCountByLedger.values()].reduce((s, n) => s + n, 0),
      netBalance: ledgerRows.reduce((s, l) => s + (l.closingBalance || 0), 0),
      ledgers: ledgerRows.map((l) => ({
        ...l,
        entryCount: entryCountByLedger.get(l.id) || 0,
        recentEntries: recentEntriesByLedger.get(l.id) || [],
      })),
    };

    // ---- Trips --------------------------------------------------------
    const tripRows = await db
      .select()
      .from(schema.trips)
      .where(and(eq(schema.trips.vehicleId, id), eq(schema.trips.isDeleted, false)))
      .orderBy(desc(schema.trips.departureTime))
      .limit(15);
    const [tripAgg] = await db
      .select({ n: sql<number>`count(*)::int`, revenue: sql<number>`coalesce(sum(${schema.trips.revenue}),0)::bigint` })
      .from(schema.trips)
      .where(and(eq(schema.trips.vehicleId, id), eq(schema.trips.isDeleted, false)));

    // ---- Expenses -------------------------------------------------------
    const expenseRows = await db
      .select()
      .from(schema.expenses)
      .where(and(eq(schema.expenses.vehicleId, id), eq(schema.expenses.isDeleted, false)))
      .orderBy(desc(schema.expenses.expenseDate))
      .limit(15);
    const [expenseAgg] = await db
      .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${schema.expenses.amount}),0)::bigint` })
      .from(schema.expenses)
      .where(and(eq(schema.expenses.vehicleId, id), eq(schema.expenses.isDeleted, false)));
    const expenseByType = await db
      .select({ type: schema.expenses.expenseType, total: sql<number>`coalesce(sum(${schema.expenses.amount}),0)::bigint` })
      .from(schema.expenses)
      .where(and(eq(schema.expenses.vehicleId, id), eq(schema.expenses.isDeleted, false)))
      .groupBy(schema.expenses.expenseType);

    // ---- Maintenance ------------------------------------------------
    const maintenanceRows = await db
      .select()
      .from(schema.vehicleMaintenance)
      .where(and(eq(schema.vehicleMaintenance.vehicleId, id), eq(schema.vehicleMaintenance.isDeleted, false)))
      .orderBy(desc(schema.vehicleMaintenance.scheduledDate))
      .limit(15);
    const [maintenanceAgg] = await db
      .select({ n: sql<number>`count(*)::int`, cost: sql<number>`coalesce(sum(${schema.vehicleMaintenance.actualCost}),0)::bigint` })
      .from(schema.vehicleMaintenance)
      .where(and(eq(schema.vehicleMaintenance.vehicleId, id), eq(schema.vehicleMaintenance.isDeleted, false)));

    // ---- Fuel -------------------------------------------------------
    const fuelRows = await db
      .select()
      .from(schema.fuelTransactions)
      .where(and(eq(schema.fuelTransactions.vehicleId, id), eq(schema.fuelTransactions.isDeleted, false)))
      .orderBy(desc(schema.fuelTransactions.transactionDate))
      .limit(15);
    const [fuelAgg] = await db
      .select({
        n: sql<number>`count(*)::int`,
        litres: sql<number>`coalesce(sum(${schema.fuelTransactions.litres}),0)::numeric`,
        cost: sql<number>`coalesce(sum(${schema.fuelTransactions.total}),0)::bigint`,
      })
      .from(schema.fuelTransactions)
      .where(and(eq(schema.fuelTransactions.vehicleId, id), eq(schema.fuelTransactions.isDeleted, false)));

    // ---- Compliance (insurance/fitness expiry, same thresholds as the
    // Fleet Search compliance board) -------------------------------------
    const now = Date.now();
    const daysLeft = (d: Date | null) => (d ? Math.ceil((new Date(d).getTime() - now) / 86400000) : null);
    const complianceStatus = (days: number | null) => {
      if (days == null) return "Unknown";
      if (days < 0) return "Expired";
      if (days <= 15) return "Critical";
      if (days <= 45) return "Warning";
      return "Valid";
    };
    const insuranceDays = daysLeft(vehicle.insuranceExpiry);
    const fitnessDays = daysLeft(vehicle.fitnessExpiry);

    res.json({
      vehicle,
      driver: driver || null,
      compliance: {
        insurance: { expiry: vehicle.insuranceExpiry, daysLeft: insuranceDays, status: complianceStatus(insuranceDays) },
        fitness: { expiry: vehicle.fitnessExpiry, daysLeft: fitnessDays, status: complianceStatus(fitnessDays) },
      },
      khata,
      trips: { total: tripAgg?.n || 0, totalRevenue: Number(tripAgg?.revenue || 0), recent: tripRows },
      expenses: { total: expenseAgg?.n || 0, totalAmount: Number(expenseAgg?.total || 0), byType: expenseByType, recent: expenseRows },
      maintenance: { total: maintenanceAgg?.n || 0, totalCost: Number(maintenanceAgg?.cost || 0), recent: maintenanceRows },
      fuel: { total: fuelAgg?.n || 0, totalLitres: Number(fuelAgg?.litres || 0), totalCost: Number(fuelAgg?.cost || 0), recent: fuelRows },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// MODULE 2 — DRIVERS API
// ---------------------------------------------------------

// List Drivers
router.get("/drivers", requireAuth, requirePermission("drivers", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "";
    const bloodGroup = (req.query.bloodGroup as string) || "";

    const conditions = [eq(schema.drivers.isDeleted, false)];

    if (search) {
      conditions.push(
        or(
          ilike(schema.drivers.driverName, `%${search}%`),
          ilike(schema.drivers.cnic, `%${search}%`),
          ilike(schema.drivers.licenseNumber, `%${search}%`),
          ilike(schema.drivers.mobile, `%${search}%`)
        ) as any
      );
    }

    if (status) conditions.push(eq(schema.drivers.status, status));
    if (bloodGroup) conditions.push(eq(schema.drivers.bloodGroup, bloodGroup));

    const data = await db
      .select()
      .from(schema.drivers)
      .where(and(...conditions))
      .orderBy(desc(schema.drivers.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.drivers)
      .where(and(...conditions));

    const total = Number(countResult[0]?.count || 0);

    res.json({ data, pagination: { limit, offset, total } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create Driver
router.post("/drivers", requireAuth, requirePermission("drivers", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const payload = req.body;
    payload.createdBy = req.user?.id;
    if (payload.licenseExpiry) payload.licenseExpiry = new Date(payload.licenseExpiry);
    if (payload.joiningDate) payload.joiningDate = new Date(payload.joiningDate);
    if (payload.medicalExpiry) payload.medicalExpiry = new Date(payload.medicalExpiry);

    const created = await db.transaction(async (tx) => {
      const [resObj] = await tx.insert(schema.drivers).values(payload).returning();
      await audit(req, "CREATE", "drivers", resObj.id, null, resObj, tx);
      return resObj;
    });
    res.json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update Driver
router.put("/drivers/:id", requireAuth, requirePermission("drivers", "update"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const payload = req.body;
    payload.updatedAt = new Date();
    payload.updatedBy = req.user?.id;

    if (payload.licenseExpiry) payload.licenseExpiry = new Date(payload.licenseExpiry);
    if (payload.joiningDate) payload.joiningDate = new Date(payload.joiningDate);
    if (payload.medicalExpiry) payload.medicalExpiry = new Date(payload.medicalExpiry);

    const [old] = await db.select().from(schema.drivers).where(eq(schema.drivers.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Driver not found" });

    delete payload.id;
    delete payload.createdAt;

    const [updated] = await db
      .update(schema.drivers)
      .set(payload)
      .where(eq(schema.drivers.id, id))
      .returning();

    await audit(req, "UPDATE", "drivers", id, old, updated);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Driver
router.delete("/drivers/:id", requireAuth, requirePermission("drivers", "delete"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.drivers).where(eq(schema.drivers.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Driver not found" });

    const [updated] = await db
      .update(schema.drivers)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user?.id,
      })
      .where(eq(schema.drivers.id, id))
      .returning();

    await audit(req, "DELETE", "drivers", id, old, updated);
    SocketServer.emit("driver:deleted", { id });
    res.json({ message: "Driver soft deleted" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk Import Drivers
router.post("/drivers/import", requireAuth, requirePermission("drivers", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const list = req.body;
    if (!Array.isArray(list)) return res.status(400).json({ error: "Payload must be an array" });

    const inserted: any[] = [];
    for (const item of list) {
      item.createdBy = req.user?.id;
      if (item.licenseExpiry) item.licenseExpiry = new Date(item.licenseExpiry);
      if (item.joiningDate) item.joiningDate = new Date(item.joiningDate);
      if (item.medicalExpiry) item.medicalExpiry = new Date(item.medicalExpiry);
      
      const [res] = await db.insert(schema.drivers).values(item).returning();
      await audit(req, "CREATE", "drivers", res.id, null, res);
      inserted.push(res);
    }
    res.json({ message: `Successfully imported ${inserted.length} drivers`, count: inserted.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Export Drivers
router.get("/drivers/export", requireAuth, requirePermission("drivers", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const list = await db.select().from(schema.drivers).where(eq(schema.drivers.isDeleted, false));
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------------------------------------------------
// MODULE 3 — ROUTE MANAGEMENT
// ---------------------------------------------------------

// List Routes
router.get("/routes", requireAuth, requirePermission("routes", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const conditions = [eq(schema.routes.isDeleted, false)];
    const search = (req.query.search as string) || "";
    if (search) {
      conditions.push(
        or(
          ilike(schema.routes.origin, `%${search}%`),
          ilike(schema.routes.destination, `%${search}%`)
        ) as any
      );
    }

    const list = await db
      .select()
      .from(schema.routes)
      .where(and(...conditions))
      .orderBy(desc(schema.routes.createdAt));

    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create Route
router.post("/routes", requireAuth, requirePermission("routes", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const payload = req.body;
    payload.createdBy = req.user?.id;
    const created = await db.transaction(async (tx) => {
      const [resObj] = await tx.insert(schema.routes).values(payload).returning();
      await audit(req, "CREATE", "routes", resObj.id, null, resObj, tx);
      return resObj;
    });
    res.json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update Route
router.put("/routes/:id", requireAuth, requirePermission("routes", "update"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const payload = req.body;
    payload.updatedAt = new Date();
    payload.updatedBy = req.user?.id;

    const [old] = await db.select().from(schema.routes).where(eq(schema.routes.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Route not found" });

    delete payload.id;
    delete payload.createdAt;

    const [updated] = await db
      .update(schema.routes)
      .set(payload)
      .where(eq(schema.routes.id, id))
      .returning();

    await audit(req, "UPDATE", "routes", id, old, updated);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Route
router.delete("/routes/:id", requireAuth, requirePermission("routes", "delete"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.routes).where(eq(schema.routes.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Route not found" });

    const [updated] = await db
      .update(schema.routes)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user?.id,
      })
      .where(eq(schema.routes.id, id))
      .returning();

    await audit(req, "DELETE", "routes", id, old, updated);
    SocketServer.emit("route:deleted", { id });
    res.json({ message: "Route soft deleted" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------------------------------------------------
// MODULE 4 — CONTRACTORS / CUSTOMERS
// ---------------------------------------------------------

// List Contractors
router.get("/contractors", requireAuth, requirePermission("contractors", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const conditions = [eq(schema.contractors.isDeleted, false)];
    const search = (req.query.search as string) || "";
    if (search) {
      conditions.push(
        or(
          ilike(schema.contractors.company, `%${search}%`),
          ilike(schema.contractors.contactPerson, `%${search}%`),
          ilike(schema.contractors.ntn, `%${search}%`)
        ) as any
      );
    }

    const list = await db
      .select()
      .from(schema.contractors)
      .where(and(...conditions))
      .orderBy(desc(schema.contractors.createdAt));

    const mapped = list.map(c => ({
      id: c.id,
      contractorName: c.company,
      contractorCode: `CON-${c.id + 100}`,
      contactPerson: c.contactPerson,
      mobile: c.phone,
      email: c.email,
      billingAddress: c.address,
      paymentTerms: c.paymentTerms,
      taxRegistrationNumber: c.ntn,
      creditLimit: c.creditLimit,
      currentOutstanding: c.outstandingBalance,
      rating: "5.0",
      isActive: c.status === "Active"
    }));

    res.json(mapped);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create Contractor
router.post("/contractors", requireAuth, requirePermission("contractors", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const payload = req.body;
    
    const dbPayload: any = {
      company: payload.contractorName,
      contactPerson: payload.contactPerson,
      phone: payload.mobile,
      email: payload.email,
      ntn: payload.taxRegistrationNumber,
      strn: payload.taxRegistrationNumber ? `STRN-${payload.taxRegistrationNumber.split("-")[1] || "1234"}` : null,
      address: payload.billingAddress,
      creditLimit: payload.creditLimit ? Number(payload.creditLimit) : 0,
      outstandingBalance: payload.currentOutstanding ? Number(payload.currentOutstanding) : 0,
      paymentTerms: payload.paymentTerms || "Net 30",
      status: payload.isActive ? "Active" : "Suspended",
      createdBy: req.user?.id,
      updatedAt: new Date()
    };

    if (dbPayload.strn === "") dbPayload.strn = null;

    const created = await db.transaction(async (tx) => {
      const [resObj] = await tx.insert(schema.contractors).values(dbPayload).returning();
      await audit(req, "CREATE", "contractors", resObj.id, null, resObj, tx);
      return resObj;
    });
    
    const mappedCreated = {
      id: created.id,
      contractorName: created.company,
      contractorCode: `CON-${created.id + 100}`,
      contactPerson: created.contactPerson,
      mobile: created.phone,
      email: created.email,
      billingAddress: created.address,
      paymentTerms: created.paymentTerms,
      taxRegistrationNumber: created.ntn,
      creditLimit: created.creditLimit,
      currentOutstanding: created.outstandingBalance,
      rating: "5.0",
      isActive: created.status === "Active"
    };
    
    res.json(mappedCreated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update Contractor
router.put("/contractors/:id", requireAuth, requirePermission("contractors", "update"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const payload = req.body;

    const [old] = await db.select().from(schema.contractors).where(eq(schema.contractors.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Contractor not found" });

    const dbPayload: any = {
      company: payload.contractorName,
      contactPerson: payload.contactPerson,
      phone: payload.mobile,
      email: payload.email,
      ntn: payload.taxRegistrationNumber,
      address: payload.billingAddress,
      creditLimit: payload.creditLimit ? Number(payload.creditLimit) : 0,
      outstandingBalance: payload.currentOutstanding ? Number(payload.currentOutstanding) : 0,
      paymentTerms: payload.paymentTerms || "Net 30",
      status: payload.isActive ? "Active" : "Suspended",
      updatedAt: new Date(),
      updatedBy: req.user?.id
    };

    const [updated] = await db
      .update(schema.contractors)
      .set(dbPayload)
      .where(eq(schema.contractors.id, id))
      .returning();

    await audit(req, "UPDATE", "contractors", id, old, updated);
    
    const mappedUpdated = {
      id: updated.id,
      contractorName: updated.company,
      contractorCode: `CON-${updated.id + 100}`,
      contactPerson: updated.contactPerson,
      mobile: updated.phone,
      email: updated.email,
      billingAddress: updated.address,
      paymentTerms: updated.paymentTerms,
      taxRegistrationNumber: updated.ntn,
      creditLimit: updated.creditLimit,
      currentOutstanding: updated.outstandingBalance,
      rating: "5.0",
      isActive: updated.status === "Active"
    };

    res.json(mappedUpdated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Contractor
router.delete("/contractors/:id", requireAuth, requirePermission("contractors", "delete"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.contractors).where(eq(schema.contractors.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Contractor not found" });

    const [updated] = await db
      .update(schema.contractors)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user?.id,
      })
      .where(eq(schema.contractors.id, id))
      .returning();

    await audit(req, "DELETE", "contractors", id, old, updated);
    SocketServer.emit("contractor:deleted", { id });
    res.json({ message: "Contractor soft deleted successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------------------------------------------------
// MODULE 5 & 7 — SMART DISPATCH & GPS AUTO STATUS API
// ---------------------------------------------------------

// List Trips / Dispatches
router.get("/trips", requireAuth, requirePermission("dispatch", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const conditions = [eq(schema.trips.isDeleted, false)];
    const status = (req.query.status as string) || "";
    if (status) conditions.push(eq(schema.trips.status, status));

    const data = await db
      .select({
        id: schema.trips.id,
        tripNumber: schema.trips.tripNumber,
        vehicleId: schema.trips.vehicleId,
        vehicleNumber: schema.vehicles.vehicleNumber,
        driverId: schema.trips.driverId,
        driverName: schema.drivers.driverName,
        routeId: schema.trips.routeId,
        origin: schema.routes.origin,
        destination: schema.routes.destination,
        contractorId: schema.trips.contractorId,
        company: schema.contractors.company,
        departureTime: schema.trips.departureTime,
        actualDepartureTime: schema.trips.actualDepartureTime,
        actualArrivalTime: schema.trips.actualArrivalTime,
        revenue: schema.trips.revenue,
        distance: schema.trips.distance,
        etaHours: schema.trips.etaHours,
        fuelBenchmark: schema.trips.fuelBenchmark,
        expectedProfit: schema.trips.expectedProfit,
        expectedArrival: schema.trips.expectedArrival,
        expectedFuel: schema.trips.expectedFuel,
        status: schema.trips.status,
        currentLat: schema.trips.currentLat,
        currentLng: schema.trips.currentLng,
        currentSpeed: schema.trips.currentSpeed,
        delayHours: schema.trips.delayHours,
        currentAddress: schema.trips.currentAddress,
        remainingDistance: schema.trips.remainingDistance,
        createdAt: schema.trips.createdAt,
      })
      .from(schema.trips)
      .innerJoin(schema.vehicles, eq(schema.trips.vehicleId, schema.vehicles.id))
      .innerJoin(schema.drivers, eq(schema.trips.driverId, schema.drivers.id))
      .innerJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
      .innerJoin(schema.contractors, eq(schema.trips.contractorId, schema.contractors.id))
      .where(and(...conditions))
      .orderBy(desc(schema.trips.createdAt));

    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-calculation endpoint (dispatcher makes selections, details populate automatically)
router.post("/dispatch/calculate", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { vehicleId, driverId, routeId, contractorId } = req.body;
    if (!vehicleId || !driverId || !routeId || !contractorId) {
      return res.status(400).json({ error: "Missing required selection fields for calculation" });
    }

    // Resolve entities
    const [route] = await db.select().from(schema.routes).where(eq(schema.routes.id, parseInt(routeId))).limit(1);
    const [driver] = await db.select().from(schema.drivers).where(eq(schema.drivers.id, parseInt(driverId))).limit(1);
    const [vehicle] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, parseInt(vehicleId))).limit(1);

    if (!route) return res.status(404).json({ error: "Route definition not found" });
    if (!driver) return res.status(404).json({ error: "Driver profile not found" });
    if (!vehicle) return res.status(404).json({ error: "Vehicle definition not found" });

    // Auto calculate
    const contractRevenue = route.revenue;
    const distance = route.distance;
    const expectedHours = route.expectedHours;
    const benchmarkFuel = route.benchmarkFuel;
    const expectedToll = route.expectedToll;
    const driverAllowance = driver.allowance || 5000;

    // Estimate cost = Fuel Cost (Benchmark * ~ PKR 280) + Expected Tolls + Driver Allowance
    const estimatedFuelCost = benchmarkFuel * 280;
    const estimatedCost = estimatedFuelCost + expectedToll + driverAllowance;
    const expectedNetMargin = contractRevenue - estimatedCost;
    const marginPercent = contractRevenue > 0 ? (expectedNetMargin / contractRevenue) * 100 : 0;

    // Risk Audit checks
    const now = new Date();
    const insuranceValid = vehicle.insuranceExpiry ? new Date(vehicle.insuranceExpiry) > now : false;
    const fitnessValid = vehicle.fitnessExpiry ? new Date(vehicle.fitnessExpiry) > now : false;
    const licenseValid = driver.licenseExpiry ? new Date(driver.licenseExpiry) > now : false;
    const hasViolations = (driver.violationCount || 0) > 0;
    const clearedForTransit = insuranceValid && fitnessValid && licenseValid;

    res.json({
      distance,
      expectedHours,
      benchmarkFuel,
      expectedToll,
      driverAllowance,
      estimatedCost,
      contractRevenue,
      expectedNetMargin,
      marginPercent,
      riskAudit: {
        insuranceValid,
        fitnessValid,
        licenseValid,
        hasViolations,
        clearedForTransit
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/trips/dispatch-calculate", requireAuth, async (req: AuthRequest, res: Response) => {
  // Alias for compatibility if needed
  try {
    const { vehicleId, driverId, routeId } = req.body;
    const [route] = await db.select().from(schema.routes).where(eq(schema.routes.id, parseInt(routeId))).limit(1);
    const [driver] = await db.select().from(schema.drivers).where(eq(schema.drivers.id, parseInt(driverId))).limit(1);
    if (!route || !driver) return res.status(404).json({ error: "Route or Driver not found" });
    const revenue = route.revenue;
    const distance = route.distance;
    const etaHours = route.expectedHours;
    const fuelBenchmark = route.benchmarkFuel;
    const expectedArrival = new Date(Date.now() + etaHours * 60 * 60 * 1000);
    const estimatedCost = (fuelBenchmark * 280) + route.expectedToll + (driver.allowance || 5000);
    const expectedProfit = revenue - estimatedCost;

    res.json({
      revenue,
      distance,
      etaHours,
      fuelBenchmark,
      expectedProfit,
      expectedArrival,
      expectedFuel: fuelBenchmark,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Dispatch Execution (Saves full Smart Trip)
router.post("/dispatch/execute", requireAuth, requirePermission("dispatch", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const { vehicleId, driverId, routeId, contractorId, departureTime } = req.body;
    if (!vehicleId || !driverId || !routeId || !contractorId) {
      return res.status(400).json({ error: "Missing dispatch requirements" });
    }

    // Resolve details for insertion
    const [v] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, parseInt(vehicleId))).limit(1);
    const [d] = await db.select().from(schema.drivers).where(eq(schema.drivers.id, parseInt(driverId))).limit(1);
    const [r] = await db.select().from(schema.routes).where(eq(schema.routes.id, parseInt(routeId))).limit(1);
    const [c] = await db.select().from(schema.contractors).where(eq(schema.contractors.id, parseInt(contractorId))).limit(1);

    if (!v || !d || !r || !c) {
      return res.status(404).json({ error: "One or more dispatch references were not found in database" });
    }

    // Double check status of vehicle & driver
    if (v.currentStatus !== "Available" && v.currentStatus !== "Active") {
      return res.status(400).json({ error: `Vehicle number ${v.vehicleNumber} is currently ${v.currentStatus} and cannot be dispatched` });
    }
    if (d.status !== "Available" && d.status !== "On Trip") {
      return res.status(400).json({ error: `Driver ${d.driverName} is currently ${d.status} and cannot be dispatched` });
    }

    // Automatic calculation values
    const revenue = r.revenue;
    const distance = r.distance;
    const etaHours = r.expectedHours;
    const fuelBenchmark = r.benchmarkFuel;
    const depTimeParsed = departureTime ? new Date(departureTime) : new Date();
    const expectedArrival = new Date(depTimeParsed.getTime() + etaHours * 60 * 60 * 1000);
    
    // Profit margin calc
    const estimatedCost = (fuelBenchmark * 280) + r.expectedToll + (d.allowance || 5000);
    const expectedProfit = Math.max(revenue - estimatedCost, 12000);

    // Generate unique Trip number
    const tripNumber = `TRIP-${Date.now().toString().slice(-6)}`;

    const [tripCreated] = await db.insert(schema.trips).values({
      tripNumber,
      vehicleId: v.id,
      driverId: d.id,
      routeId: r.id,
      contractorId: c.id,
      departureTime: depTimeParsed,
      revenue,
      distance,
      etaHours,
      fuelBenchmark,
      expectedProfit,
      expectedArrival,
      expectedFuel: fuelBenchmark,
      status: "Scheduled", // Default to scheduled
      currentLat: "31.5204", // Default starting point near Lahore/Operations hub
      currentLng: "74.3587",
      currentSpeed: 0,
      delayHours: 0,
      currentAddress: r.origin,
      remainingDistance: distance,
      createdBy: req.user?.id,
    }).returning();

    // Lock vehicle and driver to active trip statuses
    await db.update(schema.vehicles).set({ currentStatus: "Active" }).where(eq(schema.vehicles.id, v.id));
    await db.update(schema.drivers).set({ status: "On Trip", assignedVehicleId: v.id }).where(eq(schema.drivers.id, d.id));

    await audit(req, "CREATE", "trips", tripCreated.id, null, tripCreated);

    // Trigger logs
    await LoggerService.logSystem(
      "Smart Dispatch",
      "DISPATCH",
      `Trip ${tripNumber} successfully dispatched. Vehicle: ${v.vehicleNumber}, Driver: ${d.driverName}, Route: ${r.origin} to ${r.destination}`,
      { tripId: tripCreated.id },
      req.user?.id
    );

    res.json(tripCreated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/trips/dispatch", requireAuth, requirePermission("dispatch", "create"), async (req: AuthRequest, res: Response) => {
  // Forward to execute for compatibility
  try {
    const { vehicleId, driverId, routeId, contractorId, departureTime } = req.body;
    const [v] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, parseInt(vehicleId))).limit(1);
    const [d] = await db.select().from(schema.drivers).where(eq(schema.drivers.id, parseInt(driverId))).limit(1);
    const [r] = await db.select().from(schema.routes).where(eq(schema.routes.id, parseInt(routeId))).limit(1);
    const [c] = await db.select().from(schema.contractors).where(eq(schema.contractors.id, parseInt(contractorId))).limit(1);

    if (!v || !d || !r || !c) {
      return res.status(404).json({ error: "One or more dispatch references were not found in database" });
    }

    const revenue = r.revenue;
    const distance = r.distance;
    const etaHours = r.expectedHours;
    const fuelBenchmark = r.benchmarkFuel;
    const depTimeParsed = departureTime ? new Date(departureTime) : new Date();
    const expectedArrival = new Date(depTimeParsed.getTime() + etaHours * 60 * 60 * 1000);
    const estimatedCost = (fuelBenchmark * 280) + r.expectedToll + (d.allowance || 5000);
    const expectedProfit = Math.max(revenue - estimatedCost, 12000);

    const tripNumber = `TRIP-${Date.now().toString().slice(-6)}`;

    const [tripCreated] = await db.insert(schema.trips).values({
      tripNumber,
      vehicleId: v.id,
      driverId: d.id,
      routeId: r.id,
      contractorId: c.id,
      departureTime: depTimeParsed,
      revenue,
      distance,
      etaHours,
      fuelBenchmark,
      expectedProfit,
      expectedArrival,
      expectedFuel: fuelBenchmark,
      status: "Scheduled",
      currentLat: "31.5204",
      currentLng: "74.3587",
      currentSpeed: 0,
      delayHours: 0,
      currentAddress: r.origin,
      remainingDistance: distance,
      createdBy: req.user?.id,
    }).returning();

    await db.update(schema.vehicles).set({ currentStatus: "Active" }).where(eq(schema.vehicles.id, v.id));
    await db.update(schema.drivers).set({ status: "On Trip", assignedVehicleId: v.id }).where(eq(schema.drivers.id, d.id));

    await audit(req, "CREATE", "trips", tripCreated.id, null, tripCreated);

    res.json(tripCreated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update manual status if required (though mostly automated)
router.put("/trips/:id/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "Missing status parameter" });

    const [old] = await db.select().from(schema.trips).where(eq(schema.trips.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Trip not found" });

    const [updated] = await db.update(schema.trips).set({ status }).where(eq(schema.trips.id, id)).returning();
    await audit(req, "UPDATE", "trips", id, old, updated);

    // If completed or cancelled, release vehicle and driver
    if (status === "Completed") {
      await db.update(schema.vehicles).set({ currentStatus: "Available" }).where(eq(schema.vehicles.id, old.vehicleId));
      await db.update(schema.drivers).set({ status: "Available" }).where(eq(schema.drivers.id, old.driverId));
      
      // Auto Invoicing and balanced bookkeeping triggers
      try {
        const { triggerAutoInvoicing } = await import("./finance_engine.ts");
        await triggerAutoInvoicing(id, {
          userId: req.user?.id,
          ipAddress: req.ip || req.socket.remoteAddress || undefined,
          userAgent: req.headers["user-agent"] || undefined,
        });
      } catch (finErr: any) {
        console.error("Auto Invoicing failed:", finErr);
      }
    }

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------------------------------------------------
// MODULE 6 — GPS SIMULATOR TICK ENGINE (Live updates status machine)
// ---------------------------------------------------------
router.post("/trips/simulate-tick", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    // Find all active or non-completed trips
    const activeTrips = await db
      .select({
        id: schema.trips.id,
        tripNumber: schema.trips.tripNumber,
        status: schema.trips.status,
        remainingDistance: schema.trips.remainingDistance,
        distance: schema.trips.distance,
        vehicleId: schema.trips.vehicleId,
        driverId: schema.trips.driverId,
        routeId: schema.trips.routeId,
        origin: schema.routes.origin,
        destination: schema.routes.destination,
      })
      .from(schema.trips)
      .innerJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
      .where(and(eq(schema.trips.isDeleted, false), sql`${schema.trips.status} != 'Completed'`));

    if (activeTrips.length === 0) {
      return res.status(400).json({
        error: "No active dispatches found. Create a dispatch first before starting GPS simulation.",
        logs: []
      });
    }

    const updatedTrips: any[] = [];
    const logs: string[] = [];

    for (const trip of activeTrips) {
      let nextStatus = trip.status;
      let remaining = trip.remainingDistance !== null ? trip.remainingDistance : trip.distance;
      let currentSpeed = 0;
      let address = "";
      let lat = "31.5204";
      let lng = "74.3587";

      // Status Machine Transitions based on distance reduction
      if (trip.status === "Scheduled") {
        nextStatus = "Started";
        remaining = trip.distance;
        currentSpeed = 45;
        address = `Departed from ${trip.origin} Operations Terminal`;
        lat = "31.5497"; // Lahore coordinates shifting
        lng = "74.3436";
      } else if (trip.status === "Started") {
        nextStatus = "In Transit";
        remaining = Math.max(Math.floor(trip.distance * 0.7), 10);
        currentSpeed = 68;
        address = `Highway Transit corridor near ${trip.origin}`;
        lat = "32.0824"; // Moving north/central
        lng = "74.1865";
      } else if (trip.status === "In Transit") {
        if (remaining > 15) {
          remaining = Math.max(Math.floor(remaining * 0.4), 3);
          currentSpeed = 75;
          address = `N-5 national arterial corridor towards ${trip.destination}`;
          lat = "33.5651"; // Approaching Rawalpindi/Islamabad region
          lng = "73.0169";
        } else {
          nextStatus = "Arrived";
          remaining = 0;
          currentSpeed = 10;
          address = `Entering ${trip.destination} Terminal Outer Perimeter`;
          lat = "33.6844";
          lng = "72.9904";
        }
      } else if (trip.status === "Arrived") {
        nextStatus = "Completed";
        remaining = 0;
        currentSpeed = 0;
        address = `Offloaded at ${trip.destination} Distribution Yard`;
        lat = "33.7294";
        lng = "73.0931";

        // Free vehicle and driver
        await db.update(schema.vehicles).set({ currentStatus: "Available" }).where(eq(schema.vehicles.id, trip.vehicleId));
        await db.update(schema.drivers).set({ status: "Available" }).where(eq(schema.drivers.id, trip.driverId));

        // Auto Invoicing and balanced bookkeeping triggers
        try {
          const { triggerAutoInvoicing } = await import("./finance_engine.ts");
          await triggerAutoInvoicing(trip.id, {
            userId: req.user?.id,
            ipAddress: req.ip || req.socket.remoteAddress || undefined,
            userAgent: req.headers["user-agent"] || undefined,
          });
        } catch (finErr: any) {
          console.error("Auto Invoicing during simulation failed:", finErr);
        }
      }

      // Update Database
      const [updated] = await db
        .update(schema.trips)
        .set({
          status: nextStatus,
          remainingDistance: remaining,
          currentSpeed,
          currentAddress: address,
          currentLat: lat,
          currentLng: lng,
          actualDepartureTime: trip.status === "Scheduled" ? new Date() : undefined,
          actualArrivalTime: nextStatus === "Completed" ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(schema.trips.id, trip.id))
        .returning();

      // Emit live real-time Socket updates of vehicle movements to all map sessions
      SocketServer.emit("trip:location_update", {
        tripId: trip.id,
        tripNumber: trip.tripNumber,
        status: nextStatus,
        lat,
        lng,
        speed: currentSpeed,
        remaining,
        address,
        origin: trip.origin,
        destination: trip.destination,
      });

      // Generate a descriptive telemetry log for visual output
      const logMsg = `[GPS Simulator] Trip ${trip.tripNumber} updated. Status: ${nextStatus}. Speed: ${currentSpeed} km/h. Coordinates: ${lat}, ${lng}. Location: ${address}.`;
      logs.push(logMsg);

      updatedTrips.push(updated);
    }

    res.json({ success: true, count: updatedTrips.length, updated: updatedTrips, logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// COMPLIANCE & SEARCH ALIASES FOR FRONTEND
// ---------------------------------------------------------
router.get("/compliance/alerts", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const vehicleExpiries = await db
      .select({
        id: schema.vehicles.id,
        vehicleNumber: schema.vehicles.vehicleNumber,
        insuranceExpiry: schema.vehicles.insuranceExpiry,
        fitnessExpiry: schema.vehicles.fitnessExpiry,
      })
      .from(schema.vehicles)
      .where(and(eq(schema.vehicles.isDeleted, false)));

    const driverExpiries = await db
      .select({
        id: schema.drivers.id,
        driverName: schema.drivers.driverName,
        licenseExpiry: schema.drivers.licenseExpiry,
        medicalExpiry: schema.drivers.medicalExpiry,
      })
      .from(schema.drivers)
      .where(and(eq(schema.drivers.isDeleted, false)));

    const alerts: any[] = [];
    const now = new Date();

    vehicleExpiries.forEach(v => {
      if (v.insuranceExpiry) {
        const daysLeft = Math.ceil((new Date(v.insuranceExpiry).getTime() - now.getTime()) / (1000 * 3600 * 24));
        const status = daysLeft < 0 ? "Expired" : daysLeft < 7 ? "Critical" : daysLeft < 30 ? "Warning" : "Valid";
        if (daysLeft < 30) {
          alerts.push({
            entityType: "Vehicle",
            entityName: v.vehicleNumber,
            field: "Insurance Expiry",
            expiryDate: v.insuranceExpiry.toISOString(),
            daysLeft,
            status,
          });
        }
      }
      if (v.fitnessExpiry) {
        const daysLeft = Math.ceil((new Date(v.fitnessExpiry).getTime() - now.getTime()) / (1000 * 3600 * 24));
        const status = daysLeft < 0 ? "Expired" : daysLeft < 7 ? "Critical" : daysLeft < 30 ? "Warning" : "Valid";
        if (daysLeft < 30) {
          alerts.push({
            entityType: "Vehicle",
            entityName: v.vehicleNumber,
            field: "Fitness Certificate Expiry",
            expiryDate: v.fitnessExpiry.toISOString(),
            daysLeft,
            status,
          });
        }
      }
    });

    driverExpiries.forEach(d => {
      if (d.licenseExpiry) {
        const daysLeft = Math.ceil((new Date(d.licenseExpiry).getTime() - now.getTime()) / (1000 * 3600 * 24));
        const status = daysLeft < 0 ? "Expired" : daysLeft < 7 ? "Critical" : daysLeft < 30 ? "Warning" : "Valid";
        if (daysLeft < 30) {
          alerts.push({
            entityType: "Driver",
            entityName: d.driverName,
            field: "Driver License Expiry",
            expiryDate: d.licenseExpiry.toISOString(),
            daysLeft,
            status,
          });
        }
      }
      if (d.medicalExpiry) {
        const daysLeft = Math.ceil((new Date(d.medicalExpiry).getTime() - now.getTime()) / (1000 * 3600 * 24));
        const status = daysLeft < 0 ? "Expired" : daysLeft < 7 ? "Critical" : daysLeft < 30 ? "Warning" : "Valid";
        if (daysLeft < 30) {
          alerts.push({
            entityType: "Driver",
            entityName: d.driverName,
            field: "Medical Expiry",
            expiryDate: d.medicalExpiry.toISOString(),
            daysLeft,
            status,
          });
        }
      }
    });

    res.json(alerts.sort((a, b) => a.daysLeft - b.daysLeft));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/search", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const q = (req.query.q as string) || "";
    if (!q || q.length < 2) {
      return res.json({ vehicles: [], drivers: [], routes: [], contractors: [] });
    }

    const pattern = `%${q}%`;

    const foundVehicles = await db
      .select()
      .from(schema.vehicles)
      .where(
        and(
          eq(schema.vehicles.isDeleted, false),
          or(
            ilike(schema.vehicles.vehicleNumber, pattern),
            ilike(schema.vehicles.registrationNumber, pattern),
            ilike(schema.vehicles.gpsDeviceImei, pattern),
            ilike(schema.vehicles.truckBrand, pattern)
          )
        )
      )
      .limit(10);

    const foundDrivers = await db
      .select()
      .from(schema.drivers)
      .where(
        and(
          eq(schema.drivers.isDeleted, false),
          or(
            ilike(schema.drivers.driverName, pattern),
            ilike(schema.drivers.cnic, pattern),
            ilike(schema.drivers.licenseNumber, pattern)
          )
        )
      )
      .limit(10);

    const foundRoutes = await db
      .select()
      .from(schema.routes)
      .where(
        and(
          eq(schema.routes.isDeleted, false),
          or(
            ilike(schema.routes.origin, pattern),
            ilike(schema.routes.destination, pattern)
          )
        )
      )
      .limit(10);

    const foundContractors = await db
      .select()
      .from(schema.contractors)
      .where(
        and(
          eq(schema.contractors.isDeleted, false),
          or(
            ilike(schema.contractors.company, pattern),
            ilike(schema.contractors.contactPerson, pattern)
          )
        )
      )
      .limit(10);

    res.json({
      vehicles: foundVehicles,
      drivers: foundDrivers,
      routes: foundRoutes,
      contractors: foundContractors,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// RECEIPT / REFERENCE SEARCH
// "3-6-12 mahine baad koi purani receipt mil jaye — yeh kiske khate mein
// jama hui thi?" Searches the reference number / description / notes on
// every party-khata entry, truck-khata entry and Finance expense, AND the
// filename of every uploaded receipt attachment (a scan is sometimes named
// with the slip number even when the description text isn't), so a receipt
// number, bank reference, or amount finds exactly where — or confirms it was
// never entered at all, which is the other half of the same real problem
// (missed entries, or one filed under the wrong party by mistake).
// ---------------------------------------------------------
router.get("/receipt-search", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const qRaw = ((req.query.q as string) || "").trim();
    const amountRaw = (req.query.amount as string) || "";
    const amount = amountRaw ? Math.round(Number(amountRaw)) : null;
    const from = req.query.from ? new Date(req.query.from as string) : null;
    const to = req.query.to ? new Date(req.query.to as string) : null;
    if (!qRaw && amount == null) return res.json({ results: [] });
    const pattern = qRaw ? `%${qRaw}%` : null;

    type Hit = {
      source: "party" | "truck" | "expense";
      id: number;
      label: string;
      entryDate: string | null;
      amount: number;
      direction: "In" | "Out" | null;
      description: string | null;
      refNo: string | null;
      matchedVia: string;
      focus: { partyId?: number; ledgerId?: number };
      attachments: Array<{ id: number; fileName: string }>;
    };
    const hits = new Map<string, Hit>(); // dedupe key: `${source}:${id}`

    // ---- party ledger entries: refNo / description --------------------
    const pConds = [eq(schema.partyLedgerEntries.isDeleted, false)];
    const pTextOr = pattern ? [ilike(schema.partyLedgerEntries.refNo, pattern), ilike(schema.partyLedgerEntries.description, pattern)] : [];
    const pAmountOr = amount != null ? [eq(schema.partyLedgerEntries.debit, amount), eq(schema.partyLedgerEntries.credit, amount)] : [];
    if (pTextOr.length || pAmountOr.length) pConds.push(or(...pTextOr, ...pAmountOr) as any);
    if (from) pConds.push(gte(schema.partyLedgerEntries.entryDate, from) as any);
    if (to) pConds.push(lte(schema.partyLedgerEntries.entryDate, to) as any);
    const partyHits =
      pTextOr.length || pAmountOr.length
        ? await db
            .select({ e: schema.partyLedgerEntries, partyName: schema.parties.name })
            .from(schema.partyLedgerEntries)
            .innerJoin(schema.parties, eq(schema.partyLedgerEntries.partyId, schema.parties.id))
            .where(and(...pConds))
            .orderBy(desc(schema.partyLedgerEntries.entryDate))
            .limit(50)
        : [];
    for (const { e, partyName } of partyHits) {
      hits.set(`party:${e.id}`, {
        source: "party",
        id: e.id,
        label: partyName,
        entryDate: e.rawDate,
        amount: e.debit > 0 ? e.debit : e.credit,
        direction: e.debit > 0 ? "Out" : e.credit > 0 ? "In" : null,
        description: e.description,
        refNo: e.refNo,
        matchedVia: "reference/description",
        focus: { partyId: e.partyId },
        attachments: [],
      });
    }

    // ---- truck ledger entries: description (no dedicated refNo field) ----
    const tConds = [eq(schema.truckLedgerEntries.isDeleted, false)];
    const tTextOr = pattern ? [ilike(schema.truckLedgerEntries.description, pattern)] : [];
    const tAmountOr = amount != null ? [eq(schema.truckLedgerEntries.received, amount), eq(schema.truckLedgerEntries.paid, amount)] : [];
    if (tTextOr.length || tAmountOr.length) tConds.push(or(...tTextOr, ...tAmountOr) as any);
    if (from) tConds.push(gte(schema.truckLedgerEntries.entryDate, from) as any);
    if (to) tConds.push(lte(schema.truckLedgerEntries.entryDate, to) as any);
    const truckHits =
      tTextOr.length || tAmountOr.length
        ? await db
            .select({ e: schema.truckLedgerEntries, registration: schema.truckLedgers.registration, ledgerId: schema.truckLedgers.id })
            .from(schema.truckLedgerEntries)
            .innerJoin(schema.truckLedgers, eq(schema.truckLedgerEntries.ledgerId, schema.truckLedgers.id))
            .where(and(...tConds))
            .orderBy(desc(schema.truckLedgerEntries.entryDate))
            .limit(50)
        : [];
    for (const { e, registration, ledgerId } of truckHits) {
      hits.set(`truck:${e.id}`, {
        source: "truck",
        id: e.id,
        label: registration,
        entryDate: e.rawDate,
        amount: e.received > 0 ? e.received : e.paid,
        direction: e.received > 0 ? "In" : e.paid > 0 ? "Out" : null,
        description: e.description,
        refNo: null,
        matchedVia: "description",
        focus: { ledgerId },
        attachments: [],
      });
    }

    // ---- Finance expenses: notes --------------------------------------
    const xConds = [eq(schema.expenses.isDeleted, false)];
    const xTextOr = pattern ? [ilike(schema.expenses.notes, pattern), ilike(schema.expenses.expenseNumber, pattern)] : [];
    const xAmountOr = amount != null ? [eq(schema.expenses.amount, amount)] : [];
    if (xTextOr.length || xAmountOr.length) xConds.push(or(...xTextOr, ...xAmountOr) as any);
    if (from) xConds.push(gte(schema.expenses.expenseDate, from) as any);
    if (to) xConds.push(lte(schema.expenses.expenseDate, to) as any);
    const expenseHits =
      xTextOr.length || xAmountOr.length
        ? await db
            .select({ e: schema.expenses, vehicleNumber: schema.vehicles.vehicleNumber })
            .from(schema.expenses)
            .leftJoin(schema.vehicles, eq(schema.expenses.vehicleId, schema.vehicles.id))
            .where(and(...xConds))
            .orderBy(desc(schema.expenses.expenseDate))
            .limit(50)
        : [];
    for (const { e, vehicleNumber } of expenseHits) {
      hits.set(`expense:${e.id}`, {
        source: "expense",
        id: e.id,
        label: vehicleNumber || e.expenseType,
        entryDate: e.expenseDate ? new Date(e.expenseDate).toISOString().slice(0, 10) : null,
        amount: e.amount,
        direction: "Out",
        description: e.notes,
        refNo: e.expenseNumber,
        matchedVia: "notes/expense number",
        focus: {},
        attachments: [],
      });
    }

    // ---- receipt scans themselves: a filename often carries the slip
    // number even when nobody typed it into the description ------------
    if (pattern) {
      const attMatches = await db
        .select({ id: schema.attachments.id, fileName: schema.attachments.fileName, entityType: schema.attachments.entityType, entityId: schema.attachments.entityId })
        .from(schema.attachments)
        .where(and(eq(schema.attachments.isDeleted, false), ilike(schema.attachments.fileName, pattern)))
        .limit(50);
      const partyEntryIds = attMatches.filter((a) => a.entityType === "party_ledger_entry").map((a) => a.entityId);
      const truckEntryIds = attMatches.filter((a) => a.entityType === "truck_ledger_entry").map((a) => a.entityId);
      const byPartyEntryId = new Map<number, any>();
      const byTruckEntryId = new Map<number, any>();
      if (partyEntryIds.length) {
        const rows = await db
          .select({ e: schema.partyLedgerEntries, partyName: schema.parties.name })
          .from(schema.partyLedgerEntries)
          .innerJoin(schema.parties, eq(schema.partyLedgerEntries.partyId, schema.parties.id))
          .where(inArray(schema.partyLedgerEntries.id, partyEntryIds));
        for (const r of rows) byPartyEntryId.set(r.e.id, r);
      }
      if (truckEntryIds.length) {
        const rows = await db
          .select({ e: schema.truckLedgerEntries, registration: schema.truckLedgers.registration, ledgerId: schema.truckLedgers.id })
          .from(schema.truckLedgerEntries)
          .innerJoin(schema.truckLedgers, eq(schema.truckLedgerEntries.ledgerId, schema.truckLedgers.id))
          .where(inArray(schema.truckLedgerEntries.id, truckEntryIds));
        for (const r of rows) byTruckEntryId.set(r.e.id, r);
      }
      for (const a of attMatches) {
        if (a.entityType === "party_ledger_entry" && byPartyEntryId.has(a.entityId)) {
          const { e, partyName } = byPartyEntryId.get(a.entityId);
          const key = `party:${e.id}`;
          const existing = hits.get(key);
          if (existing) existing.attachments.push({ id: a.id, fileName: a.fileName });
          else
            hits.set(key, {
              source: "party", id: e.id, label: partyName, entryDate: e.rawDate,
              amount: e.debit > 0 ? e.debit : e.credit, direction: e.debit > 0 ? "Out" : e.credit > 0 ? "In" : null,
              description: e.description, refNo: e.refNo, matchedVia: "receipt file name",
              focus: { partyId: e.partyId }, attachments: [{ id: a.id, fileName: a.fileName }],
            });
        } else if (a.entityType === "truck_ledger_entry" && byTruckEntryId.has(a.entityId)) {
          const { e, registration, ledgerId } = byTruckEntryId.get(a.entityId);
          const key = `truck:${e.id}`;
          const existing = hits.get(key);
          if (existing) existing.attachments.push({ id: a.id, fileName: a.fileName });
          else
            hits.set(key, {
              source: "truck", id: e.id, label: registration, entryDate: e.rawDate,
              amount: e.received > 0 ? e.received : e.paid, direction: e.received > 0 ? "In" : e.paid > 0 ? "Out" : null,
              description: e.description, refNo: null, matchedVia: "receipt file name",
              focus: { ledgerId }, attachments: [{ id: a.id, fileName: a.fileName }],
            });
        }
      }
    }

    // attach counts for every direct hit too (so "0 attachments" is visible —
    // a found entry with no scan on file is exactly the "party ne diya tha,
    // humne receipt nahi lagai" case worth flagging back to her)
    const results = [...hits.values()];
    const partyIds = results.filter((h) => h.source === "party").map((h) => h.id);
    const truckIds = results.filter((h) => h.source === "truck").map((h) => h.id);
    if (partyIds.length || truckIds.length) {
      const attRows = await db
        .select({ entityType: schema.attachments.entityType, entityId: schema.attachments.entityId, id: schema.attachments.id, fileName: schema.attachments.fileName })
        .from(schema.attachments)
        .where(
          and(
            eq(schema.attachments.isDeleted, false),
            or(
              partyIds.length ? and(eq(schema.attachments.entityType, "party_ledger_entry"), inArray(schema.attachments.entityId, partyIds)) : sql`false`,
              truckIds.length ? and(eq(schema.attachments.entityType, "truck_ledger_entry"), inArray(schema.attachments.entityId, truckIds)) : sql`false`
            )
          )
        );
      const byKey = new Map<string, Array<{ id: number; fileName: string }>>();
      for (const a of attRows) {
        const key = `${a.entityType === "party_ledger_entry" ? "party" : "truck"}:${a.entityId}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key)!.push({ id: a.id, fileName: a.fileName });
      }
      for (const h of results) {
        const key = `${h.source}:${h.id}`;
        const existing = byKey.get(key) || [];
        const already = new Set(h.attachments.map((a) => a.id));
        for (const a of existing) if (!already.has(a.id)) h.attachments.push(a);
      }
    }

    results.sort((a, b) => (b.entryDate || "").localeCompare(a.entryDate || ""));
    res.json({ query: qRaw, amount, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// MODULE 8 — DOCUMENTS EXPIRY MANAGER API
// ---------------------------------------------------------
router.get("/documents/expiries", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    // Collect all certificate expiry metadata across fleet & personnel
    const vehicleExpiries = await db
      .select({
        id: schema.vehicles.id,
        vehicleNumber: schema.vehicles.vehicleNumber,
        insuranceExpiry: schema.vehicles.insuranceExpiry,
        fitnessExpiry: schema.vehicles.fitnessExpiry,
      })
      .from(schema.vehicles)
      .where(and(eq(schema.vehicles.isDeleted, false)));

    const driverExpiries = await db
      .select({
        id: schema.drivers.id,
        driverName: schema.drivers.driverName,
        licenseExpiry: schema.drivers.licenseExpiry,
        medicalExpiry: schema.drivers.medicalExpiry,
      })
      .from(schema.drivers)
      .where(and(eq(schema.drivers.isDeleted, false)));

    const expiries = [
      ...vehicleExpiries.flatMap(v => [
        {
          id: `v-ins-${v.id}`,
          entityId: v.id,
          entityType: "Vehicle",
          entityName: v.vehicleNumber,
          documentType: "Insurance Policy",
          expiryDate: v.insuranceExpiry,
          daysLeft: v.insuranceExpiry ? Math.ceil((new Date(v.insuranceExpiry).getTime() - Date.now()) / (1000 * 3600 * 24)) : null,
        },
        {
          id: `v-fit-${v.id}`,
          entityId: v.id,
          entityType: "Vehicle",
          entityName: v.vehicleNumber,
          documentType: "Fitness Certificate",
          expiryDate: v.fitnessExpiry,
          daysLeft: v.fitnessExpiry ? Math.ceil((new Date(v.fitnessExpiry).getTime() - Date.now()) / (1000 * 3600 * 24)) : null,
        }
      ]),
      ...driverExpiries.flatMap(d => [
        {
          id: `d-lic-${d.id}`,
          entityId: d.id,
          entityType: "Driver",
          entityName: d.driverName,
          documentType: "Commercial License",
          expiryDate: d.licenseExpiry,
          daysLeft: d.licenseExpiry ? Math.ceil((new Date(d.licenseExpiry).getTime() - Date.now()) / (1000 * 3600 * 24)) : null,
        },
        {
          id: `d-med-${d.id}`,
          entityId: d.id,
          entityType: "Driver",
          entityName: d.driverName,
          documentType: "Medical Fitness Certificate",
          expiryDate: d.medicalExpiry,
          daysLeft: d.medicalExpiry ? Math.ceil((new Date(d.medicalExpiry).getTime() - Date.now()) / (1000 * 3600 * 24)) : null,
        }
      ])
    ].filter(item => item.expiryDate !== null)
     .sort((a, b) => (a.daysLeft || 0) - (b.daysLeft || 0));

    res.json(expiries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------------------------------------------------
// MODULE 9 — UNIFIED GLOBAL SEARCH ENGINE
// ---------------------------------------------------------
router.get("/global-search", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const q = (req.query.q as string) || "";
    if (!q || q.length < 2) {
      return res.json({ vehicles: [], drivers: [], trips: [], routes: [], contractors: [] });
    }

    const pattern = `%${q}%`;

    // 1. Search Vehicles
    const foundVehicles = await db
      .select()
      .from(schema.vehicles)
      .where(
        and(
          eq(schema.vehicles.isDeleted, false),
          or(
            ilike(schema.vehicles.vehicleNumber, pattern),
            ilike(schema.vehicles.registrationNumber, pattern),
            ilike(schema.vehicles.gpsDeviceImei, pattern),
            ilike(schema.vehicles.truckBrand, pattern)
          )
        )
      )
      .limit(5);

    // 2. Search Drivers
    const foundDrivers = await db
      .select()
      .from(schema.drivers)
      .where(
        and(
          eq(schema.drivers.isDeleted, false),
          or(
            ilike(schema.drivers.driverName, pattern),
            ilike(schema.drivers.cnic, pattern),
            ilike(schema.drivers.licenseNumber, pattern)
          )
        )
      )
      .limit(5);

    // 3. Search Contractors
    const foundContractors = await db
      .select()
      .from(schema.contractors)
      .where(
        and(
          eq(schema.contractors.isDeleted, false),
          or(
            ilike(schema.contractors.company, pattern),
            ilike(schema.contractors.contactPerson, pattern),
            ilike(schema.contractors.ntn, pattern)
          )
        )
      )
      .limit(5);

    // 4. Search Routes
    const foundRoutes = await db
      .select()
      .from(schema.routes)
      .where(
        and(
          eq(schema.routes.isDeleted, false),
          or(
            ilike(schema.routes.origin, pattern),
            ilike(schema.routes.destination, pattern)
          )
        )
      )
      .limit(5);

    // 5. Search Trips
    const foundTrips = await db
      .select({
        id: schema.trips.id,
        tripNumber: schema.trips.tripNumber,
        status: schema.trips.status,
        vehicleNumber: schema.vehicles.vehicleNumber,
        driverName: schema.drivers.driverName,
      })
      .from(schema.trips)
      .innerJoin(schema.vehicles, eq(schema.trips.vehicleId, schema.vehicles.id))
      .innerJoin(schema.drivers, eq(schema.trips.driverId, schema.drivers.id))
      .where(
        and(
          eq(schema.trips.isDeleted, false),
          or(
            ilike(schema.trips.tripNumber, pattern),
            ilike(schema.vehicles.vehicleNumber, pattern),
            ilike(schema.drivers.driverName, pattern)
          )
        )
      )
      .limit(5);

    res.json({
      vehicles: foundVehicles,
      drivers: foundDrivers,
      contractors: foundContractors,
      routes: foundRoutes,
      trips: foundTrips,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
