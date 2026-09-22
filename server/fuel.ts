import { Router, Response, NextFunction } from "express";
import { requireAuth, requirePermission, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { eq, desc, asc, and, isNull, sql, lt, gte, or, lte, inArray } from "drizzle-orm";
import { logAudit } from "../src/db/audit.ts";
import { SocketServer } from "../src/sockets/socket.ts";
import { createBalancedJournalEntry } from "./finance_engine.ts";
import { Resource, Action } from "../src/lib/rbac.ts";

const router = Router();

// Ensure user is authenticated before checking permissions
router.use(requireAuth);

// Router-Level Dynamic Authorization Middleware
router.use((req: AuthRequest, res: Response, next: NextFunction) => {
  const method = req.method;

  let action: Action = "read";
  if (method === "POST") action = "create";
  else if (method === "PUT" || method === "PATCH") action = "update";
  else if (method === "DELETE") action = "delete";

  // Delegate authorization dynamically to our core requirePermission middleware for 'fuel' resource
  return requirePermission("fuel", action)(req, res, next);
});

// Reusable Audit Helper
async function auditFuel(
  req: AuthRequest,
  action: "CREATE" | "UPDATE" | "DELETE",
  tableName: string,
  recordId: number,
  oldValues: any,
  newValues: any
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
  });
}

// Reusable Account Finder/Initializer
async function getAccountByCode(code: string, name: string, category: string, type: string) {
  const [acc] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, code)).limit(1);
  if (acc) return acc;
  
  const [created] = await db
    .insert(schema.accounts)
    .values({
      code,
      name,
      category,
      type,
      isActive: true,
    })
    .returning();
  return created;
}

// ---------------------------------------------------------
// MODULE 1: FUEL STATIONS
// ---------------------------------------------------------
router.get("/stations", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select()
      .from(schema.fuelStations)
      .where(eq(schema.fuelStations.isDeleted, false))
      .orderBy(desc(schema.fuelStations.createdAt));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/stations", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    const [created] = await db
      .insert(schema.fuelStations)
      .values({
        ...data,
        createdBy: req.user?.id,
      })
      .returning();

    await auditFuel(req, "CREATE", "fuel_stations", created.id, null, created);
    SocketServer.emit("fuel:stations:updated", { id: created.id, action: "create" });
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/stations/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const data = req.body;
    const [old] = await db.select().from(schema.fuelStations).where(eq(schema.fuelStations.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Fuel station not found" });

    const [updated] = await db
      .update(schema.fuelStations)
      .set({
        ...data,
        updatedAt: new Date(),
        updatedBy: req.user?.id,
      })
      .where(eq(schema.fuelStations.id, id))
      .returning();

    await auditFuel(req, "UPDATE", "fuel_stations", id, old, updated);
    SocketServer.emit("fuel:stations:updated", { id, action: "update" });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/stations/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.fuelStations).where(eq(schema.fuelStations.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Fuel station not found" });

    const [updated] = await db
      .update(schema.fuelStations)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user?.id,
      })
      .where(eq(schema.fuelStations.id, id))
      .returning();

    await auditFuel(req, "DELETE", "fuel_stations", id, old, updated);
    SocketServer.emit("fuel:stations:updated", { id, action: "delete" });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// MODULE 2: FUEL VENDORS
// ---------------------------------------------------------
router.get("/vendors", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select()
      .from(schema.fuelVendors)
      .where(eq(schema.fuelVendors.isDeleted, false))
      .orderBy(desc(schema.fuelVendors.createdAt));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/vendors", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    const [created] = await db
      .insert(schema.fuelVendors)
      .values({
        ...data,
        createdBy: req.user?.id,
      })
      .returning();

    await auditFuel(req, "CREATE", "fuel_vendors", created.id, null, created);
    SocketServer.emit("fuel:vendors:updated", { id: created.id, action: "create" });
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/vendors/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const data = req.body;
    const [old] = await db.select().from(schema.fuelVendors).where(eq(schema.fuelVendors.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Fuel vendor not found" });

    const [updated] = await db
      .update(schema.fuelVendors)
      .set({
        ...data,
        updatedAt: new Date(),
        updatedBy: req.user?.id,
      })
      .where(eq(schema.fuelVendors.id, id))
      .returning();

    await auditFuel(req, "UPDATE", "fuel_vendors", id, old, updated);
    SocketServer.emit("fuel:vendors:updated", { id, action: "update" });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/vendors/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.fuelVendors).where(eq(schema.fuelVendors.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Fuel vendor not found" });

    const [updated] = await db
      .update(schema.fuelVendors)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user?.id,
      })
      .where(eq(schema.fuelVendors.id, id))
      .returning();

    await auditFuel(req, "DELETE", "fuel_vendors", id, old, updated);
    SocketServer.emit("fuel:vendors:updated", { id, action: "delete" });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// MODULE 3: FUEL CARDS
// ---------------------------------------------------------
router.get("/cards", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        card: schema.fuelCards,
        vehicleNumber: schema.vehicles.vehicleNumber,
        driverName: schema.drivers.driverName,
        vendorName: schema.fuelVendors.vendorName,
      })
      .from(schema.fuelCards)
      .leftJoin(schema.vehicles, eq(schema.fuelCards.vehicleId, schema.vehicles.id))
      .leftJoin(schema.drivers, eq(schema.fuelCards.driverId, schema.drivers.id))
      .leftJoin(schema.fuelVendors, eq(schema.fuelCards.vendorId, schema.fuelVendors.id))
      .where(eq(schema.fuelCards.isDeleted, false))
      .orderBy(desc(schema.fuelCards.createdAt));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/cards", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    const [created] = await db
      .insert(schema.fuelCards)
      .values({
        ...data,
        createdBy: req.user?.id,
      })
      .returning();

    await auditFuel(req, "CREATE", "fuel_cards", created.id, null, created);
    SocketServer.emit("fuel:cards:updated", { id: created.id, action: "create" });
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/cards/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const data = req.body;
    const [old] = await db.select().from(schema.fuelCards).where(eq(schema.fuelCards.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Fuel card not found" });

    const [updated] = await db
      .update(schema.fuelCards)
      .set({
        ...data,
        updatedAt: new Date(),
        updatedBy: req.user?.id,
      })
      .where(eq(schema.fuelCards.id, id))
      .returning();

    await auditFuel(req, "UPDATE", "fuel_cards", id, old, updated);
    SocketServer.emit("fuel:cards:updated", { id, action: "update" });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/cards/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.fuelCards).where(eq(schema.fuelCards.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Fuel card not found" });

    const [updated] = await db
      .update(schema.fuelCards)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user?.id,
      })
      .where(eq(schema.fuelCards.id, id))
      .returning();

    await auditFuel(req, "DELETE", "fuel_cards", id, old, updated);
    SocketServer.emit("fuel:cards:updated", { id, action: "delete" });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// MODULE 4: FUEL TRANSACTIONS & FINANCE INTEGRATION
// ---------------------------------------------------------
router.get("/transactions", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        txn: schema.fuelTransactions,
        vehicleNumber: schema.vehicles.vehicleNumber,
        driverName: schema.drivers.driverName,
        tripNumber: schema.trips.tripNumber,
        vendorName: schema.fuelVendors.vendorName,
        stationName: schema.fuelStations.stationName,
        cardNumber: schema.fuelCards.cardNumber,
      })
      .from(schema.fuelTransactions)
      .leftJoin(schema.vehicles, eq(schema.fuelTransactions.vehicleId, schema.vehicles.id))
      .leftJoin(schema.drivers, eq(schema.fuelTransactions.driverId, schema.drivers.id))
      .leftJoin(schema.trips, eq(schema.fuelTransactions.tripId, schema.trips.id))
      .leftJoin(schema.fuelVendors, eq(schema.fuelTransactions.vendorId, schema.fuelVendors.id))
      .leftJoin(schema.fuelStations, eq(schema.fuelTransactions.fuelStationId, schema.fuelStations.id))
      .leftJoin(schema.fuelCards, eq(schema.fuelTransactions.fuelCardId, schema.fuelCards.id))
      .where(eq(schema.fuelTransactions.isDeleted, false))
      .orderBy(desc(schema.fuelTransactions.transactionDate));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/transactions", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    const totalCost = Math.floor(parseFloat(data.litres) * parseFloat(data.rate));
    const gstAmount = Math.floor(totalCost * 0.15); // 15% GST standard
    const grandTotal = totalCost + gstAmount;

    const txnNumber = `TXN-FUEL-${Date.now()}`;

    // 1. Create Transaction
    const [created] = await db
      .insert(schema.fuelTransactions)
      .values({
        ...data,
        transactionNumber: txnNumber,
        subtotal: totalCost,
        gst: gstAmount,
        total: grandTotal,
        createdBy: req.user?.id,
      })
      .returning();

    // 2. Reduce Card Balance if Payment type is Card
    if (data.paymentType === "Card" && data.fuelCardId) {
      const [card] = await db.select().from(schema.fuelCards).where(eq(schema.fuelCards.id, data.fuelCardId)).limit(1);
      if (card) {
        await db
          .update(schema.fuelCards)
          .set({
            currentBalance: (card.currentBalance || 0) - grandTotal,
          })
          .where(eq(schema.fuelCards.id, data.fuelCardId));
      }
    }

    // 3. Increase Vendor Outstanding if payment is Credit
    if (data.paymentType === "Credit" && data.vendorId) {
      const [vendor] = await db.select().from(schema.fuelVendors).where(eq(schema.fuelVendors.id, data.vendorId)).limit(1);
      if (vendor) {
        await db
          .update(schema.fuelVendors)
          .set({
            outstandingBalance: (vendor.outstandingBalance || 0) + grandTotal,
          })
          .where(eq(schema.fuelVendors.id, data.vendorId));
      }
    }

    // 4. Update Vehicle current odometer
    if (data.vehicleId && data.odometer) {
      await db
        .update(schema.vehicles)
        .set({
          currentOdometer: parseInt(data.odometer),
        })
        .where(eq(schema.vehicles.id, data.vehicleId));
    }

    // 5. FINANCE INTEGRATION: Post Journal entries
    // Debit: Fuel Expense ("5001") -> grandTotal
    // Credit: according to payment type
    //  - Cash: "1001"
    //  - Card/Bank: "1002"
    //  - Credit: Accounts Payable ("2000")
    //  - Inventory: Fuel Inventory ("1301")
    let creditCode = "1002"; // default Bank
    let creditName = "Bank General Ledger";
    if (data.paymentType === "Cash") {
      creditCode = "1001";
      creditName = "Cash on Hand";
    } else if (data.paymentType === "Credit") {
      creditCode = "2000";
      creditName = "Accounts Payable";
    } else if (data.paymentType === "Inventory") {
      creditCode = "1301";
      creditName = "Fuel Inventory Asset";
    }

    const expenseGL = await getAccountByCode("5001", "Fuel Expense", "Fuel", "Expense");
    const creditGL = await getAccountByCode(creditCode, creditName, data.paymentType === "Credit" ? "Accounts Payable" : "Cash", data.paymentType === "Credit" ? "Liability" : "Asset");

    await createBalancedJournalEntry(
      `JE-FUEL-${created.id}`,
      `Fuel Purchase for Vehicle Odometer ${data.odometer} - ${created.litres} Litres`,
      "Expense",
      created.id,
      [
        {
          accountId: expenseGL.id,
          description: `Debit Fuel Expense - invoice ${data.invoiceNumber || "N/A"}`,
          debit: grandTotal,
          credit: 0,
        },
        {
          accountId: creditGL.id,
          description: `Credit ${creditName} for fuel transaction ${txnNumber}`,
          debit: 0,
          credit: grandTotal,
        }
      ],
      {
        userId: req.user?.id,
        ipAddress: req.ip || req.socket.remoteAddress || undefined,
        userAgent: req.headers["user-agent"] || undefined,
      }
    );

    // 6. Raise Realtime and Audit Logs
    await auditFuel(req, "CREATE", "fuel_transactions", created.id, null, created);
    SocketServer.emit("fuel:transactions:updated", { id: created.id, action: "create" });
    SocketServer.emit("notification", {
      type: "Fuel Purchased",
      title: "Fuel Purchased",
      message: `Vehicle Refuelled with ${created.litres} Litres. Total Cost: PKR ${grandTotal}`,
    });

    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/transactions/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.fuelTransactions).where(eq(schema.fuelTransactions.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Transaction not found" });

    const [updated] = await db
      .update(schema.fuelTransactions)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user?.id,
      })
      .where(eq(schema.fuelTransactions.id, id))
      .returning();

    await auditFuel(req, "DELETE", "fuel_transactions", id, old, updated);
    SocketServer.emit("fuel:transactions:updated", { id, action: "delete" });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// MODULE 5: TANK MANAGEMENT (INTERNAL FUEL TANKS)
// ---------------------------------------------------------
router.get("/tanks", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        tank: schema.fuelTanks,
        branchName: schema.branches.name,
      })
      .from(schema.fuelTanks)
      .leftJoin(schema.branches, eq(schema.fuelTanks.branchId, schema.branches.id))
      .where(eq(schema.fuelTanks.isDeleted, false))
      .orderBy(desc(schema.fuelTanks.createdAt));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/tanks", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    const capacity = parseInt(data.capacity || 0);
    const opening = parseInt(data.openingBalance || 0);
    const level = capacity > 0 ? Math.floor((opening / capacity) * 100) : 0;

    const [created] = await db
      .insert(schema.fuelTanks)
      .values({
        ...data,
        capacity,
        openingBalance: opening,
        currentStock: opening,
        tankLevelPercent: level,
        createdBy: req.user?.id,
      })
      .returning();

    await auditFuel(req, "CREATE", "fuel_tanks", created.id, null, created);
    SocketServer.emit("fuel:tanks:updated", { id: created.id, action: "create" });
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/tanks/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const data = req.body;
    const [old] = await db.select().from(schema.fuelTanks).where(eq(schema.fuelTanks.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Fuel tank not found" });

    const capacity = data.capacity ? parseInt(data.capacity) : old.capacity;
    const currentStock = data.currentStock !== undefined ? parseInt(data.currentStock) : old.currentStock;
    const level = capacity > 0 ? Math.floor((currentStock / capacity) * 100) : 0;

    const [updated] = await db
      .update(schema.fuelTanks)
      .set({
        ...data,
        capacity,
        currentStock,
        tankLevelPercent: level,
        updatedAt: new Date(),
        updatedBy: req.user?.id,
      })
      .where(eq(schema.fuelTanks.id, id))
      .returning();

    // Check low tank level alert
    if (level < 15) {
      SocketServer.emit("notification", {
        type: "Tank Low",
        title: "Internal Tank Level Low",
        message: `Tank ${updated.tankName} has dropped to ${level}% capacity. Stock: ${currentStock} L.`,
      });
    }

    await auditFuel(req, "UPDATE", "fuel_tanks", id, old, updated);
    SocketServer.emit("fuel:tanks:updated", { id, action: "update" });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/tanks/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.fuelTanks).where(eq(schema.fuelTanks.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Fuel tank not found" });

    const [updated] = await db
      .update(schema.fuelTanks)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user?.id,
      })
      .where(eq(schema.fuelTanks.id, id))
      .returning();

    await auditFuel(req, "DELETE", "fuel_tanks", id, old, updated);
    SocketServer.emit("fuel:tanks:updated", { id, action: "delete" });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// MODULE 6: FUEL ISSUE SLIPS (INTERNAL FUEL ISSUE) & INVENTORY REDUCTION
// ---------------------------------------------------------
router.get("/issue-slips", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        slip: schema.fuelIssueSlips,
        vehicleNumber: schema.vehicles.vehicleNumber,
        driverName: schema.drivers.driverName,
        tripNumber: schema.trips.tripNumber,
        tankName: schema.fuelTanks.tankName,
        issuedByName: schema.users.name,
      })
      .from(schema.fuelIssueSlips)
      .leftJoin(schema.vehicles, eq(schema.fuelIssueSlips.vehicleId, schema.vehicles.id))
      .leftJoin(schema.drivers, eq(schema.fuelIssueSlips.driverId, schema.drivers.id))
      .leftJoin(schema.trips, eq(schema.fuelIssueSlips.tripId, schema.trips.id))
      .leftJoin(schema.fuelTanks, eq(schema.fuelIssueSlips.fuelTankId, schema.fuelTanks.id))
      .leftJoin(schema.users, eq(schema.fuelIssueSlips.issuedBy, schema.users.id))
      .where(eq(schema.fuelIssueSlips.isDeleted, false))
      .orderBy(desc(schema.fuelIssueSlips.issueDate));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/issue-slips", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    const slipNumber = `SLIP-FUEL-${Date.now()}`;
    const issueLitres = parseFloat(data.litres || 0);

    // 1. Verify and Reduce Tank Stock
    const [tank] = await db.select().from(schema.fuelTanks).where(eq(schema.fuelTanks.id, data.fuelTankId)).limit(1);
    if (!tank) return res.status(404).json({ error: "Internal fuel tank not found" });
    if (tank.currentStock < issueLitres) {
      return res.status(400).json({ error: `Insufficient stock in tank ${tank.tankName}. Remaining: ${tank.currentStock} L.` });
    }

    const newStock = Math.max(0, tank.currentStock - issueLitres);
    const newLevel = tank.capacity > 0 ? Math.floor((newStock / tank.capacity) * 100) : 0;

    await db
      .update(schema.fuelTanks)
      .set({
        currentStock: newStock,
        tankLevelPercent: newLevel,
      })
      .where(eq(schema.fuelTanks.id, data.fuelTankId));

    // 2. Create Slip Record
    const [created] = await db
      .insert(schema.fuelIssueSlips)
      .values({
        ...data,
        slipNumber,
        issuedBy: req.user?.id,
        createdBy: req.user?.id,
      })
      .returning();

    // 3. FINANCE INTEGRATION: Balanced GL Posting
    // Debit: Fuel Expense ("5001")
    // Credit: Fuel Inventory/Asset ("1301")
    const estimatedValue = Math.floor(issueLitres * 270); // Assume benchmark PKR 270/L
    const expenseGL = await getAccountByCode("5001", "Fuel Expense", "Fuel", "Expense");
    const inventoryGL = await getAccountByCode("1301", "Fuel Inventory Asset", "Inventory", "Asset");

    await createBalancedJournalEntry(
      `JE-SLIP-${created.id}`,
      `Internal Fuel Issue ${slipNumber} - ${created.litres} Litres`,
      "Expense",
      created.id,
      [
        {
          accountId: expenseGL.id,
          description: `Debit Fuel Expense - Slip ${slipNumber}`,
          debit: estimatedValue,
          credit: 0,
        },
        {
          accountId: inventoryGL.id,
          description: `Credit Fuel Inventory for Internal Stock Issue`,
          debit: 0,
          credit: estimatedValue,
        }
      ],
      {
        userId: req.user?.id,
        ipAddress: req.ip || req.socket.remoteAddress || undefined,
        userAgent: req.headers["user-agent"] || undefined,
      }
    );

    // 4. Alerts and Sockets
    await auditFuel(req, "CREATE", "fuel_issue_slips", created.id, null, created);
    SocketServer.emit("fuel:issue-slips:updated", { id: created.id, action: "create" });
    SocketServer.emit("fuel:tanks:updated", { id: tank.id, action: "update" });

    if (newLevel < 15) {
      SocketServer.emit("notification", {
        type: "Tank Low",
        title: "Internal Tank Level Low",
        message: `Tank ${tank.tankName} has dropped to ${newLevel}% capacity. Stock: ${newStock} L.`,
      });
    }

    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// FUEL HISTORY PER TRIP  — "har trip ka fuel: kitna liya, kitna cost, average"
//   GET /api/fuel/trip-history?from=&to=&vehicleId=&limit=
// For every trip: fuel litres drawn (linked fuel_transactions), cost, fills,
// route benchmark, km/L, cost/km, and the litres vs benchmark variance.
// ---------------------------------------------------------
router.get("/trip-history", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const limit = Math.min(500, parseInt(q.limit || "200"));
    const cond = [eq(schema.trips.isDeleted, false)];
    if (q.vehicleId) cond.push(eq(schema.trips.vehicleId, Number(q.vehicleId)));
    if (q.from) cond.push(gte(schema.trips.departureTime, new Date(q.from)));
    if (q.to) cond.push(lte(schema.trips.departureTime, new Date(q.to)));

    const trips = await db
      .select({
        id: schema.trips.id,
        tripNumber: schema.trips.tripNumber,
        status: schema.trips.status,
        distance: schema.trips.distance,
        fuelBenchmark: schema.trips.fuelBenchmark,
        expectedFuel: schema.trips.expectedFuel,
        revenue: schema.trips.revenue,
        departure: schema.trips.departureTime,
        arrival: schema.trips.actualArrivalTime,
        vehicleNumber: schema.vehicles.vehicleNumber,
        driverName: schema.drivers.driverName,
        origin: schema.routes.origin,
        destination: schema.routes.destination,
        routeBenchmarkFuel: schema.routes.benchmarkFuel,
      })
      .from(schema.trips)
      .leftJoin(schema.vehicles, eq(schema.trips.vehicleId, schema.vehicles.id))
      .leftJoin(schema.drivers, eq(schema.trips.driverId, schema.drivers.id))
      .leftJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
      .where(and(...cond))
      .orderBy(desc(schema.trips.departureTime))
      .limit(limit);

    const ids = trips.map((t) => t.id);
    const fuelByTrip = new Map<number, { litres: number; cost: number; fills: number }>();
    if (ids.length) {
      const fx = await db
        .select({
          tripId: schema.fuelTransactions.tripId,
          litres: sql<number>`coalesce(sum(${schema.fuelTransactions.litres}),0)::float`,
          cost: sql<number>`coalesce(sum(${schema.fuelTransactions.total}),0)::bigint`,
          fills: sql<number>`count(*)::int`,
        })
        .from(schema.fuelTransactions)
        .where(and(eq(schema.fuelTransactions.isDeleted, false), inArray(schema.fuelTransactions.tripId, ids)))
        .groupBy(schema.fuelTransactions.tripId);
      for (const r of fx) if (r.tripId != null) fuelByTrip.set(r.tripId, { litres: Number(r.litres), cost: Number(r.cost), fills: r.fills });
    }

    const rows = trips.map((t) => {
      const f = fuelByTrip.get(t.id) || { litres: 0, cost: 0, fills: 0 };
      const benchmark = t.fuelBenchmark || t.routeBenchmarkFuel || t.expectedFuel || 0;
      const kmpl = f.litres > 0 ? +(t.distance / f.litres).toFixed(2) : null;
      const costPerKm = t.distance > 0 ? Math.round(f.cost / t.distance) : null;
      const avgRate = f.litres > 0 ? Math.round(f.cost / f.litres) : null;
      const varianceL = benchmark ? +(f.litres - benchmark).toFixed(1) : null;
      const variancePct = benchmark ? Math.round(((f.litres - benchmark) / benchmark) * 100) : null;
      return {
        tripId: t.id,
        tripNumber: t.tripNumber,
        route: [t.origin, t.destination].filter(Boolean).join(" → "),
        vehicle: t.vehicleNumber,
        driver: t.driverName,
        status: t.status,
        departure: t.departure,
        arrival: t.arrival,
        distanceKm: t.distance,
        revenue: t.revenue,
        litres: +f.litres.toFixed(1),
        fills: f.fills,
        fuelCost: f.cost,
        benchmarkLitres: benchmark || null,
        varianceLitres: varianceL,
        variancePercent: variancePct,
        kmPerLitre: kmpl,
        costPerKm,
        avgRatePerLitre: avgRate,
        fuelShareOfRevenue: t.revenue > 0 ? Math.round((f.cost / t.revenue) * 100) : null,
      };
    });

    const withFuel = rows.filter((r) => r.litres > 0);
    const totLitres = withFuel.reduce((s, r) => s + r.litres, 0);
    const totCost = withFuel.reduce((s, r) => s + r.fuelCost, 0);
    const totKm = withFuel.reduce((s, r) => s + r.distanceKm, 0);
    res.json({
      summary: {
        trips: rows.length,
        tripsWithFuel: withFuel.length,
        totalLitres: +totLitres.toFixed(1),
        totalFuelCost: totCost,
        totalDistanceKm: totKm,
        avgKmPerLitre: totLitres > 0 ? +(totKm / totLitres).toFixed(2) : null,
        avgCostPerKm: totKm > 0 ? Math.round(totCost / totKm) : null,
        overBenchmarkTrips: rows.filter((r) => (r.variancePercent ?? 0) > 10).length,
      },
      trips: rows,
    });
  } catch (e: any) {
    console.error("[fuel] trip-history failed:", e);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------
// MODULE 7: MILEAGE INTELLIGENCE & TELEMETRY
// ---------------------------------------------------------
router.get("/mileage-intelligence", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const txns = await db
      .select({
        txnId: schema.fuelTransactions.id,
        vehicleId: schema.fuelTransactions.vehicleId,
        vehicleNumber: schema.vehicles.vehicleNumber,
        litres: schema.fuelTransactions.litres,
        odometer: schema.fuelTransactions.odometer,
        total: schema.fuelTransactions.total,
        date: schema.fuelTransactions.transactionDate,
      })
      .from(schema.fuelTransactions)
      .innerJoin(schema.vehicles, eq(schema.fuelTransactions.vehicleId, schema.vehicles.id))
      .where(eq(schema.fuelTransactions.isDeleted, false))
      .orderBy(desc(schema.fuelTransactions.transactionDate));

    // Group by vehicle and sort by date ascending to calc mileage difference
    const vehicleGroups: { [key: number]: typeof txns } = {};
    txns.forEach((t) => {
      if (t.vehicleId) {
        if (!vehicleGroups[t.vehicleId]) vehicleGroups[t.vehicleId] = [];
        vehicleGroups[t.vehicleId].push(t);
      }
    });

    const intelligence: Array<{
      vehicleId: number;
      vehicleNumber: string;
      totalLitres: number;
      totalSpent: number;
      averageKmPerL: number;
      fuelCostPerKm: number;
      fuelEfficiencyRating: string;
      expectedKmPerL: number;
      variancePercent: number;
    }> = [];

    Object.keys(vehicleGroups).forEach((vIdStr) => {
      const vId = parseInt(vIdStr);
      const group = vehicleGroups[vId];
      // Sort oldest first
      group.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let totalLitres = 0;
      let totalSpent = 0;
      let totalDistance = 0;

      for (let i = 0; i < group.length; i++) {
        totalLitres += parseFloat(group[i].litres as string || "0");
        totalSpent += group[i].total;
        if (i > 0) {
          const diff = group[i].odometer - group[i - 1].odometer;
          if (diff > 0) totalDistance += diff;
        }
      }

      // With only one fuel record (or no odometer progression between records)
      // there is no real distance to measure — this used to fabricate one
      // (litres * an assumed 4.2 km/L) which then recomputed back to ~4.2
      // km/L, always reporting a plausible "near-normal" efficiency and
      // silently hiding real theft for exactly the vehicles with the least
      // fuel history to cross-check against. Report it honestly instead.
      const hasRealDistance = totalDistance > 0;

      const avgKmL = hasRealDistance && totalLitres > 0 ? parseFloat((totalDistance / totalLitres).toFixed(2)) : null;
      const costPerKm = hasRealDistance ? parseFloat((totalSpent / totalDistance).toFixed(2)) : null;
      const expectedKmL = 4.5; // Benchmarked baseline for long-haul haulage
      const variance = avgKmL !== null ? parseFloat((((avgKmL - expectedKmL) / expectedKmL) * 100).toFixed(1)) : null;

      let rating = "Insufficient Data";
      if (avgKmL !== null) {
        rating = "Optimal";
        if (avgKmL < 3.2) rating = "Critical Fuel Wastage";
        else if (avgKmL < 4.0) rating = "Sub-Optimal Performance";
      }

      if (group.length > 0) {
        intelligence.push({
          vehicleId: vId,
          vehicleNumber: group[0].vehicleNumber || `Vehicle #${vId}`,
          totalLitres,
          totalSpent,
          averageKmPerL: avgKmL,
          fuelCostPerKm: costPerKm,
          fuelEfficiencyRating: rating,
          expectedKmPerL: expectedKmL,
          variancePercent: variance,
        });
      }
    });

    res.json(intelligence);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// MODULE 8: FUEL THEFT DETECTION & ALERTS
// ---------------------------------------------------------
router.get("/theft-detection", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const txns = await db
      .select({
        txn: schema.fuelTransactions,
        vehicleNumber: schema.vehicles.vehicleNumber,
        driverName: schema.drivers.driverName,
      })
      .from(schema.fuelTransactions)
      .leftJoin(schema.vehicles, eq(schema.fuelTransactions.vehicleId, schema.vehicles.id))
      .leftJoin(schema.drivers, eq(schema.fuelTransactions.driverId, schema.drivers.id))
      .where(eq(schema.fuelTransactions.isDeleted, false))
      .orderBy(desc(schema.fuelTransactions.transactionDate));

    // Simple anomaly models
    const alertsList = await db
      .select()
      .from(schema.fuelAlerts)
      .where(eq(schema.fuelAlerts.resolved, false))
      .orderBy(desc(schema.fuelAlerts.createdAt));

    // Dynamic processing of recent transactions to raise new automated alerts
    for (let i = 0; i < txns.length; i++) {
      const t = txns[i];
      const litres = parseFloat(t.txn.litres as string || "0");
      const rate = parseFloat(t.txn.rate as string || "0");

      // Anomaly 1: Abnormal volume
      if (litres > 600) {
        const desc = `Abnormal high fuel intake of ${litres} Litres on vehicle ${t.vehicleNumber}. Standard tank limit is 500 Litres.`;
        const [existing] = await db
          .select()
          .from(schema.fuelAlerts)
          .where(and(eq(schema.fuelAlerts.transactionId, t.txn.id), eq(schema.fuelAlerts.alertType, "Abnormal Consumption")))
          .limit(1);

        if (!existing) {
          await db.insert(schema.fuelAlerts).values({
            alertType: "Abnormal Consumption",
            vehicleId: t.txn.vehicleId,
            driverId: t.txn.driverId,
            tripId: t.txn.tripId,
            transactionId: t.txn.id,
            severity: "High",
            description: desc,
          });
          SocketServer.emit("notification", {
            type: "Fuel Theft",
            title: "Fuel Anomaly Detected",
            message: desc,
          });
        }
      }

      // Anomaly 2: Repeated refills
      if (i > 0) {
        const prev = txns[i - 1];
        if (prev.txn.vehicleId === t.txn.vehicleId && prev.txn.id !== t.txn.id) {
          const hoursDiff = Math.abs(new Date(prev.txn.transactionDate).getTime() - new Date(t.txn.transactionDate).getTime()) / 36e5;
          if (hoursDiff < 1) {
            const desc = `Repeated refill alert: Vehicle ${t.vehicleNumber} refuelled twice within ${hoursDiff.toFixed(1)} hours. Potential card cloning or siphoning.`;
            const [existing] = await db
              .select()
              .from(schema.fuelAlerts)
              .where(and(eq(schema.fuelAlerts.transactionId, t.txn.id), eq(schema.fuelAlerts.alertType, "Repeated Refills")))
              .limit(1);

            if (!existing) {
              await db.insert(schema.fuelAlerts).values({
                alertType: "Repeated Refills",
                vehicleId: t.txn.vehicleId,
                driverId: t.txn.driverId,
                tripId: t.txn.tripId,
                transactionId: t.txn.id,
                severity: "Critical",
                description: desc,
              });
              SocketServer.emit("notification", {
                type: "Fuel Theft",
                title: "Repeated Refills Alarm",
                message: desc,
              });
            }
          }
        }
      }

      // Anomaly 3: Night Refill (10 PM to 5 AM)
      const txnHour = new Date(t.txn.transactionDate).getHours();
      if (txnHour >= 22 || txnHour < 5) {
        const desc = `Night refill warning: Vehicle ${t.vehicleNumber} refuelled at ${txnHour}:00. Unauthorized night route activity.`;
        const [existing] = await db
          .select()
          .from(schema.fuelAlerts)
          .where(and(eq(schema.fuelAlerts.transactionId, t.txn.id), eq(schema.fuelAlerts.alertType, "Night Refills")))
          .limit(1);

        if (!existing) {
          await db.insert(schema.fuelAlerts).values({
            alertType: "Night Refills",
            vehicleId: t.txn.vehicleId,
            driverId: t.txn.driverId,
            tripId: t.txn.tripId,
            transactionId: t.txn.id,
            severity: "Medium",
            description: desc,
          });
        }
      }
    }

    const currentAlerts = await db
      .select({
        alert: schema.fuelAlerts,
        vehicleNumber: schema.vehicles.vehicleNumber,
        driverName: schema.drivers.driverName,
        tripNumber: schema.trips.tripNumber,
      })
      .from(schema.fuelAlerts)
      .leftJoin(schema.vehicles, eq(schema.fuelAlerts.vehicleId, schema.vehicles.id))
      .leftJoin(schema.drivers, eq(schema.fuelAlerts.driverId, schema.drivers.id))
      .leftJoin(schema.trips, eq(schema.fuelAlerts.tripId, schema.trips.id))
      .where(eq(schema.fuelAlerts.isDeleted, false))
      .orderBy(desc(schema.fuelAlerts.createdAt));

    res.json(currentAlerts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/theft-detection/resolve/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [updated] = await db
      .update(schema.fuelAlerts)
      .set({
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: req.user?.id,
      })
      .where(eq(schema.fuelAlerts.id, id))
      .returning();

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// MODULE 8b: FUEL INTEGRITY AUDIT
// "Did a driver siphon fuel?" — compares fuel DRAWN against fuel that the
// distance actually travelled can justify, per driver / per vehicle / per
// fill, and ranks the drivers by the rupee value of the over-draw.
//
// Query params (all optional):
//   from, to        ISO dates to bound the audit window
//   kmpl            expected loaded km per litre  (default 3.5)
//   tank            tank capacity in litres for the over-fill check (default 500)
//   tolerance       % over expected that is still "ok"  (default 12)
//   raise           "1" => also write fuel_alerts rows for HIGH/CRITICAL items
// ---------------------------------------------------------
router.get("/integrity-audit", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const from = q.from ? new Date(q.from) : null;
    const to = q.to ? new Date(q.to) : null;
    const EXPECTED_KMPL = Math.max(0.5, parseFloat(q.kmpl || "3.5"));
    const TANK = Math.max(50, parseFloat(q.tank || "500"));
    const TOLERANCE = Math.max(0, parseFloat(q.tolerance || "12")) / 100;
    const RAISE = q.raise === "1" || q.raise === "true";

    const cond = [eq(schema.fuelTransactions.isDeleted, false)];
    if (from) cond.push(gte(schema.fuelTransactions.transactionDate, from));
    if (to) cond.push(lte(schema.fuelTransactions.transactionDate, to));

    const rows = await db
      .select({
        id: schema.fuelTransactions.id,
        transactionNumber: schema.fuelTransactions.transactionNumber,
        vehicleId: schema.fuelTransactions.vehicleId,
        driverId: schema.fuelTransactions.driverId,
        tripId: schema.fuelTransactions.tripId,
        litres: schema.fuelTransactions.litres,
        rate: schema.fuelTransactions.rate,
        total: schema.fuelTransactions.total,
        odometer: schema.fuelTransactions.odometer,
        paymentType: schema.fuelTransactions.paymentType,
        date: schema.fuelTransactions.transactionDate,
        vehicleNumber: schema.vehicles.vehicleNumber,
        driverName: schema.drivers.driverName,
      })
      .from(schema.fuelTransactions)
      .leftJoin(schema.vehicles, eq(schema.fuelTransactions.vehicleId, schema.vehicles.id))
      .leftJoin(schema.drivers, eq(schema.fuelTransactions.driverId, schema.drivers.id))
      .where(and(...cond))
      .orderBy(asc(schema.fuelTransactions.transactionDate));

    // active trips per vehicle (for the "fuel without a trip" check)
    const tripRows = await db
      .select({
        id: schema.trips.id,
        vehicleId: schema.trips.vehicleId,
        driverId: schema.trips.driverId,
        distance: schema.trips.distance,
        fuelBenchmark: schema.trips.fuelBenchmark,
        revenue: schema.trips.revenue,
        status: schema.trips.status,
        start: schema.trips.departureTime,
        end: schema.trips.expectedArrival,
      })
      .from(schema.trips)
      .where(eq(schema.trips.isDeleted, false));
    const tripsByVehicle = new Map<number, typeof tripRows>();
    for (const t of tripRows) {
      if (t.vehicleId == null) continue;
      if (!tripsByVehicle.has(t.vehicleId)) tripsByVehicle.set(t.vehicleId, []);
      tripsByVehicle.get(t.vehicleId)!.push(t);
    }

    const num = (v: any) => (v == null ? 0 : parseFloat(String(v)) || 0);
    const HOUR = 36e5;

    // group fills by vehicle, ordered by time, to reconstruct legs
    const byVehicle = new Map<number, typeof rows>();
    for (const r of rows) {
      if (r.vehicleId == null) continue;
      if (!byVehicle.has(r.vehicleId)) byVehicle.set(r.vehicleId, []);
      byVehicle.get(r.vehicleId)!.push(r);
    }

    type Flag = { code: string; severity: "Low" | "Medium" | "High" | "Critical"; detail: string };
    const txnFindings: Array<{
      transactionId: number;
      transactionNumber: string;
      date: Date;
      vehicleId: number | null;
      vehicleNumber: string | null;
      driverId: number | null;
      driverName: string | null;
      litres: number;
      legKm: number | null;
      legKmpl: number | null;
      expectedLitresForLeg: number | null;
      overdrawLitresForLeg: number | null;
      flags: Flag[];
    }> = [];

    const driverAgg = new Map<
      number,
      { driverId: number; driverName: string; fills: number; litres: number; litresInTank: number; spend: number; distanceKm: number; expectedLitres: number; flagged: number; critical: number }
    >();
    const vehicleAgg = new Map<
      number,
      { vehicleId: number; vehicleNumber: string; fills: number; litres: number; spend: number; distanceKm: number; expectedLitres: number; flagged: number }
    >();

    for (const [vehicleId, fills] of byVehicle) {
      for (let i = 0; i < fills.length; i++) {
        const f = fills[i];
        const prev = i > 0 ? fills[i - 1] : null;
        const litres = num(f.litres);
        const rate = num(f.rate) || (f.total && litres ? f.total / litres : 0);
        const flags: Flag[] = [];

        // leg = distance from this fill's odometer to the NEXT fill's odometer
        const next = i + 1 < fills.length ? fills[i + 1] : null;
        let legKm: number | null = null;
        if (next && next.odometer != null && f.odometer != null) {
          legKm = next.odometer - f.odometer;
        }
        let legKmpl: number | null = null;
        let expectedLitresForLeg: number | null = null;
        let overdrawLitresForLeg: number | null = null;
        if (legKm != null && legKm >= 0 && litres > 0) {
          legKmpl = +(legKm / litres).toFixed(2);
          expectedLitresForLeg = +(legKm / EXPECTED_KMPL).toFixed(1);
          overdrawLitresForLeg = +(litres - expectedLitresForLeg).toFixed(1);
          if (litres > expectedLitresForLeg * (1 + TOLERANCE) && overdrawLitresForLeg > 15) {
            const pct = Math.round((overdrawLitresForLeg / expectedLitresForLeg) * 100);
            flags.push({
              code: "FUEL_OVER_BENCHMARK",
              severity: pct > 60 ? "Critical" : pct > 30 ? "High" : "Medium",
              detail: `Drew ${litres} L but the ${legKm} km driven before the next fill only justifies ~${expectedLitresForLeg} L (+${pct}% / ${overdrawLitresForLeg} L over).`,
            });
          }
          if (legKmpl < 2.0) {
            flags.push({ code: "IMPLAUSIBLE_LOW_KMPL", severity: "High", detail: `Only ${legKmpl} km per litre on this leg — well below what a loaded truck can burn; likely siphoning.` });
          }
          if (legKmpl > 7.0) {
            flags.push({ code: "IMPLAUSIBLE_HIGH_KMPL", severity: "Medium", detail: `${legKmpl} km per litre on this leg — fill may be logged against the wrong vehicle, or the odometer was over-stated.` });
          }
        }

        // tank over-capacity
        if (litres > TANK) {
          flags.push({ code: "TANK_OVER_CAPACITY", severity: "High", detail: `Single fill of ${litres} L exceeds the ${TANK} L tank capacity.` });
        }

        // odometer rollback / implausible jump vs previous fill
        if (prev && prev.odometer != null && f.odometer != null) {
          const d = f.odometer - prev.odometer;
          const hrs = Math.abs(new Date(f.date).getTime() - new Date(prev.date).getTime()) / HOUR;
          if (d < 0) {
            flags.push({ code: "ODOMETER_ROLLBACK", severity: "Critical", detail: `Odometer went backwards ${prev.odometer} → ${f.odometer} since the previous fill.` });
          } else if (d > 3000 && hrs < 24) {
            flags.push({ code: "ODOMETER_JUMP", severity: "High", detail: `Odometer jumped ${d} km in ${hrs.toFixed(1)} h — physically implausible.` });
          }
          if (hrs < 3 && prev.vehicleId === f.vehicleId) {
            flags.push({ code: "RAPID_REFILL", severity: "High", detail: `Refuelled again only ${hrs.toFixed(1)} h after the previous fill — possible card abuse or siphoning.` });
          }
        }

        // night refill
        const hr = new Date(f.date).getHours();
        if (hr >= 22 || hr < 5) {
          flags.push({ code: "NIGHT_REFILL", severity: "Low", detail: `Fill booked at ${String(hr).padStart(2, "0")}:00 — outside normal fuelling hours.` });
        }

        // fuel without a trip
        if (f.tripId == null) {
          const vt = tripsByVehicle.get(vehicleId) || [];
          const covering = vt.find((t) => {
            if (!t.start) return false;
            const s = new Date(t.start).getTime() - 12 * HOUR;
            const e = (t.end ? new Date(t.end).getTime() : new Date(t.start).getTime()) + 12 * HOUR;
            const x = new Date(f.date).getTime();
            return x >= s && x <= e;
          });
          if (!covering) {
            flags.push({ code: "FUEL_WITHOUT_TRIP", severity: "Medium", detail: `Fuel drawn with no linked trip and no active trip for ${f.vehicleNumber} around this date.` });
          }
        }

        // roll-ups. Only fills that power a measurable leg (i.e. not the final
        // fill, whose fuel is still in the tank) count toward the litres-vs-
        // distance comparison — otherwise every driver looks over-drawn by
        // roughly one tank.
        const scoreable = legKm != null && legKm >= 0 && litres > 0;
        if (f.driverId != null) {
          const a =
            driverAgg.get(f.driverId) ||
            { driverId: f.driverId, driverName: f.driverName || `Driver #${f.driverId}`, fills: 0, litres: 0, litresInTank: 0, spend: 0, distanceKm: 0, expectedLitres: 0, flagged: 0, critical: 0 };
          a.fills++;
          if (scoreable) {
            a.litres += litres;
            a.spend += f.total || Math.round(litres * rate);
            a.distanceKm += legKm as number;
            a.expectedLitres += (legKm as number) / EXPECTED_KMPL;
          } else {
            a.litresInTank += litres;
          }
          if (flags.length) a.flagged++;
          if (flags.some((x) => x.severity === "Critical")) a.critical++;
          driverAgg.set(f.driverId, a);
        }
        {
          const a =
            vehicleAgg.get(vehicleId) ||
            { vehicleId, vehicleNumber: f.vehicleNumber || `Vehicle #${vehicleId}`, fills: 0, litres: 0, spend: 0, distanceKm: 0, expectedLitres: 0, flagged: 0 };
          a.fills++;
          if (scoreable) {
            a.litres += litres;
            a.spend += f.total || Math.round(litres * rate);
            a.distanceKm += legKm as number;
            a.expectedLitres += (legKm as number) / EXPECTED_KMPL;
          }
          if (flags.length) a.flagged++;
          vehicleAgg.set(vehicleId, a);
        }

        if (flags.length) {
          txnFindings.push({
            transactionId: f.id,
            transactionNumber: f.transactionNumber,
            date: f.date,
            vehicleId: f.vehicleId,
            vehicleNumber: f.vehicleNumber,
            driverId: f.driverId,
            driverName: f.driverName,
            litres,
            legKm,
            legKmpl,
            expectedLitresForLeg,
            overdrawLitresForLeg,
            flags,
          });
        }
      }
    }

    const avgRate =
      rows.length > 0
        ? rows.reduce((s, r) => s + (num(r.rate) || (r.total && num(r.litres) ? r.total / num(r.litres) : 0)), 0) / rows.length
        : 0;

    const drivers = [...driverAgg.values()]
      .map((a) => {
        const overdrawLitres = +(a.litres - a.expectedLitres).toFixed(1);
        const overdrawPct = a.expectedLitres > 0 ? Math.round((overdrawLitres / a.expectedLitres) * 100) : null;
        return {
          driverId: a.driverId,
          driverName: a.driverName,
          fills: a.fills,
          litresDrawn: +a.litres.toFixed(1), // litres that powered a measured leg
          litresInTank: +a.litresInTank.toFixed(1), // last fill(s), not yet burned — excluded from the ratio
          fuelSpend: Math.round(a.spend),
          distanceKm: Math.round(a.distanceKm),
          expectedLitres: Math.round(a.expectedLitres),
          overdrawLitres,
          overdrawPercent: overdrawPct,
          impliedKmPerLitre: a.litres > 0 ? +(a.distanceKm / a.litres).toFixed(2) : null,
          estimatedLossValue: overdrawLitres > 0 ? Math.round(overdrawLitres * (avgRate || 286)) : 0,
          flaggedFills: a.flagged,
          criticalFills: a.critical,
          riskLevel:
            (overdrawPct ?? 0) > 40 || a.critical > 0
              ? "High"
              : (overdrawPct ?? 0) > 15 || a.flagged > 0
              ? "Medium"
              : "Low",
        };
      })
      .sort((x, y) => y.estimatedLossValue - x.estimatedLossValue);

    const vehicles = [...vehicleAgg.values()]
      .map((a) => {
        const overdrawLitres = +(a.litres - a.expectedLitres).toFixed(1);
        return {
          vehicleId: a.vehicleId,
          vehicleNumber: a.vehicleNumber,
          fills: a.fills,
          litresDrawn: +a.litres.toFixed(1),
          fuelSpend: Math.round(a.spend),
          distanceKm: Math.round(a.distanceKm),
          expectedLitres: Math.round(a.expectedLitres),
          overdrawLitres,
          impliedKmPerLitre: a.litres > 0 ? +(a.distanceKm / a.litres).toFixed(2) : null,
          flaggedFills: a.flagged,
        };
      })
      .sort((x, y) => y.overdrawLitres - x.overdrawLitres);

    // optionally persist HIGH/CRITICAL findings as fuel alerts
    let raised = 0;
    if (RAISE) {
      for (const tf of txnFindings) {
        const worst = tf.flags.reduce((m, x) => (sevRank(x.severity) > sevRank(m.severity) ? x : m), tf.flags[0]);
        if (sevRank(worst.severity) < sevRank("High")) continue;
        const [exists] = await db
          .select({ id: schema.fuelAlerts.id })
          .from(schema.fuelAlerts)
          .where(and(eq(schema.fuelAlerts.transactionId, tf.transactionId), eq(schema.fuelAlerts.alertType, worst.code)))
          .limit(1);
        if (exists) continue;
        await db.insert(schema.fuelAlerts).values({
          alertType: worst.code,
          vehicleId: tf.vehicleId,
          driverId: tf.driverId,
          transactionId: tf.transactionId,
          severity: worst.severity,
          description: `[${tf.transactionNumber}] ${worst.detail}`,
          createdBy: req.user?.id,
        });
        raised++;
      }
      if (raised > 0) {
        SocketServer.emit("notification", {
          type: "Fuel Theft",
          title: "Fuel integrity audit",
          message: `${raised} new high-severity fuel finding(s) raised.`,
        });
      }
    }

    const totalOverdrawLitres = drivers.reduce((s, d) => s + Math.max(0, d.overdrawLitres), 0);
    res.json({
      params: {
        from: from?.toISOString() || null,
        to: to?.toISOString() || null,
        expectedKmPerLitre: EXPECTED_KMPL,
        tankCapacityLitres: TANK,
        tolerancePercent: TOLERANCE * 100,
        avgFuelRate: +avgRate.toFixed(2),
        alertsRaised: raised,
      },
      summary: {
        transactionsAudited: rows.length,
        flaggedTransactions: txnFindings.length,
        driversReviewed: drivers.length,
        driversHighRisk: drivers.filter((d) => d.riskLevel === "High").length,
        estimatedFuelLossLitres: +totalOverdrawLitres.toFixed(1),
        estimatedFuelLossValue: Math.round(totalOverdrawLitres * (avgRate || 286)),
      },
      drivers,
      vehicles,
      flaggedTransactions: txnFindings.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function sevRank(s: string): number {
  return { Low: 1, Medium: 2, High: 3, Critical: 4 }[s as "Low"] || 0;
}

// ---------------------------------------------------------
// MODULE 9: TRIP FUEL BUDGETS
// ---------------------------------------------------------
router.get("/budgets", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        budget: schema.fuelBudgets,
        tripNumber: schema.trips.tripNumber,
        vehicleNumber: schema.vehicles.vehicleNumber,
        driverName: schema.drivers.driverName,
      })
      .from(schema.fuelBudgets)
      .leftJoin(schema.trips, eq(schema.fuelBudgets.tripId, schema.trips.id))
      .leftJoin(schema.vehicles, eq(schema.trips.vehicleId, schema.vehicles.id))
      .leftJoin(schema.drivers, eq(schema.trips.driverId, schema.drivers.id))
      .where(eq(schema.fuelBudgets.isDeleted, false))
      .orderBy(desc(schema.fuelBudgets.createdAt));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/budgets", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    const expFuel = parseFloat(data.expectedFuel || 0);
    const expCost = parseInt(data.expectedCost || 0);
    const allowance = parseInt(data.fuelAllowance || 0);
    const totalBudget = allowance + expCost;
    const variance = allowance - expCost;

    const [created] = await db
      .insert(schema.fuelBudgets)
      .values({
        tripId: parseInt(data.tripId),
        expectedFuel: String(expFuel),
        expectedCost: expCost,
        fuelAllowance: allowance,
        tripBudget: totalBudget,
        budgetVariance: variance,
        createdBy: req.user?.id,
      })
      .returning();

    await auditFuel(req, "CREATE", "fuel_budgets", created.id, null, created);
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// MODULE 10: FUEL FORECASTING
// ---------------------------------------------------------
router.get("/forecasting", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const predictions = await db
      .select()
      .from(schema.fuelForecasts)
      .where(eq(schema.fuelForecasts.isDeleted, false));

    if (predictions.length === 0) {
      // Dynamic forecasting calculation over PostgreSQL tables if predictions don't exist
      const overallCons = await db
        .select({
          litres: sql<number>`sum(${schema.fuelTransactions.litres})`,
        })
        .from(schema.fuelTransactions)
        .where(eq(schema.fuelTransactions.isDeleted, false));

      const litresSum = overallCons[0]?.litres || 12000;

      // Seed / populate predictions
      const seeded = [
        {
          targetType: "Overall",
          targetId: null,
          nextRefillDate: new Date(Date.now() + 5 * 24 * 36e5),
          predictedRequirementLitres: String(Math.floor(litresSum * 1.1)),
          monthlyConsumptionLitres: String(litresSum),
          accuracyScore: "0.88",
        },
        {
          targetType: "Branch",
          targetId: 1,
          nextRefillDate: new Date(Date.now() + 3 * 24 * 36e5),
          predictedRequirementLitres: "4500",
          monthlyConsumptionLitres: "4000",
          accuracyScore: "0.91",
        }
      ];

      for (const s of seeded) {
        await db.insert(schema.fuelForecasts).values(s);
      }

      const freshlySeeded = await db
        .select()
        .from(schema.fuelForecasts)
        .where(eq(schema.fuelForecasts.isDeleted, false));
      return res.json(freshlySeeded);
    }

    res.json(predictions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// MODULE 11: EXECUTIVE ANALYTICS DASHBOARD
// ---------------------------------------------------------
router.get("/analytics", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const [txnsSum] = await db
      .select({
        totalLitres: sql<number>`sum(${schema.fuelTransactions.litres})`,
        totalCost: sql<number>`sum(${schema.fuelTransactions.total})`,
        avgRate: sql<number>`avg(${schema.fuelTransactions.rate})`,
        count: sql<number>`count(${schema.fuelTransactions.id})`,
      })
      .from(schema.fuelTransactions)
      .where(eq(schema.fuelTransactions.isDeleted, false));

    const totalLitres = txnsSum?.totalLitres || 0;
    const totalCost = txnsSum?.totalCost || 0;
    const avgRate = txnsSum?.avgRate || 270;
    const count = txnsSum?.count || 0;

    // Fuel Trends (Group by Month or Day)
    const trends = await db
      .select({
        day: sql<string>`to_char(${schema.fuelTransactions.transactionDate}, 'YYYY-MM-DD')`,
        totalLitres: sql<number>`sum(${schema.fuelTransactions.litres})`,
        totalSpent: sql<number>`sum(${schema.fuelTransactions.total})`,
      })
      .from(schema.fuelTransactions)
      .where(eq(schema.fuelTransactions.isDeleted, false))
      .groupBy(sql`to_char(${schema.fuelTransactions.transactionDate}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${schema.fuelTransactions.transactionDate}, 'YYYY-MM-DD')`);

    // Top Fuel Consuming Vehicles
    const topVehicles = await db
      .select({
        vehicleNumber: schema.vehicles.vehicleNumber,
        totalLitres: sql<number>`sum(${schema.fuelTransactions.litres})`,
        totalSpent: sql<number>`sum(${schema.fuelTransactions.total})`,
      })
      .from(schema.fuelTransactions)
      .innerJoin(schema.vehicles, eq(schema.fuelTransactions.vehicleId, schema.vehicles.id))
      .where(eq(schema.fuelTransactions.isDeleted, false))
      .groupBy(schema.vehicles.vehicleNumber)
      .orderBy(desc(sql`sum(${schema.fuelTransactions.litres})`))
      .limit(5);

    // Theft alerts count
    const [alertsSum] = await db
      .select({
        criticalAlerts: sql<number>`count(${schema.fuelAlerts.id})`,
      })
      .from(schema.fuelAlerts)
      .where(and(eq(schema.fuelAlerts.resolved, false), eq(schema.fuelAlerts.isDeleted, false)));

    const activeTheftCount = alertsSum?.criticalAlerts || 0;

    res.json({
      summary: {
        totalLitres,
        totalCost,
        avgRate,
        txnTransactionsCount: count,
        activeTheftCount,
      },
      trends,
      topVehicles,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// MODULE 16: EXECUTIVE REPORTS ENGINE
// ---------------------------------------------------------
router.get("/reports", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const type = req.query.type as string;
    
    if (type === "register") {
      const list = await db
        .select({
          date: schema.fuelTransactions.transactionDate,
          txnNumber: schema.fuelTransactions.transactionNumber,
          vehicle: schema.vehicles.vehicleNumber,
          driver: schema.drivers.driverName,
          litres: schema.fuelTransactions.litres,
          rate: schema.fuelTransactions.rate,
          total: schema.fuelTransactions.total,
          payment: schema.fuelTransactions.paymentType,
        })
        .from(schema.fuelTransactions)
        .leftJoin(schema.vehicles, eq(schema.fuelTransactions.vehicleId, schema.vehicles.id))
        .leftJoin(schema.drivers, eq(schema.fuelTransactions.driverId, schema.drivers.id))
        .where(eq(schema.fuelTransactions.isDeleted, false))
        .orderBy(desc(schema.fuelTransactions.transactionDate));
      return res.json(list);
    }

    if (type === "theft") {
      const list = await db
        .select({
          alertType: schema.fuelAlerts.alertType,
          description: schema.fuelAlerts.description,
          severity: schema.fuelAlerts.severity,
          created: schema.fuelAlerts.createdAt,
          resolved: schema.fuelAlerts.resolved,
          vehicle: schema.vehicles.vehicleNumber,
        })
        .from(schema.fuelAlerts)
        .leftJoin(schema.vehicles, eq(schema.fuelAlerts.vehicleId, schema.vehicles.id))
        .where(eq(schema.fuelAlerts.isDeleted, false))
        .orderBy(desc(schema.fuelAlerts.createdAt));
      return res.json(list);
    }

    if (type === "tanks") {
      const list = await db
        .select({
          tankName: schema.fuelTanks.tankName,
          capacity: schema.fuelTanks.capacity,
          currentStock: schema.fuelTanks.currentStock,
          levelPercent: schema.fuelTanks.tankLevelPercent,
          leakStatus: schema.fuelTanks.leakStatus,
        })
        .from(schema.fuelTanks)
        .where(eq(schema.fuelTanks.isDeleted, false))
        .orderBy(schema.fuelTanks.tankName);
      return res.json(list);
    }

    // Default generic summary report
    const summary = await db
      .select({
        vehicle: schema.vehicles.vehicleNumber,
        litres: sql<number>`sum(${schema.fuelTransactions.litres})`,
        cost: sql<number>`sum(${schema.fuelTransactions.total})`,
      })
      .from(schema.fuelTransactions)
      .innerJoin(schema.vehicles, eq(schema.fuelTransactions.vehicleId, schema.vehicles.id))
      .where(eq(schema.fuelTransactions.isDeleted, false))
      .groupBy(schema.vehicles.vehicleNumber);

    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
