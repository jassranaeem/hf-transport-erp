import { Router, Response } from "express";
import { requireAuth, requirePermission, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { eq, and, isNull, sql, desc, or } from "drizzle-orm";
import { GoogleGenAI, Type } from "@google/genai";
import { LoggerService } from "../src/logger/logger.ts";

const router = Router();

const AI_NOT_CONFIGURED_MSG =
  "AI features aren't set up yet — ask your admin to add a Gemini API key (GEMINI_API_KEY) in the server config.";

/**
 * Every route below used to let the raw Gemini SDK error string reach the
 * client verbatim (`res.status(500).json({ error: err.message })`), which
 * for a missing/invalid API key is Google's own "PERMISSION_DENIED: ...API
 * key not valid..." text — a confusing, unbranded backend error shown
 * straight to the end user. This logs the real error server-side and always
 * returns a friendly, actionable message instead.
 */
function friendlyAiError(err: any): string {
  console.error("[gemini] request failed:", err?.message || err);
  const msg = String(err?.message || "");
  if (/PERMISSION_DENIED|API key|API_KEY_INVALID|401|403/i.test(msg)) return AI_NOT_CONFIGURED_MSG;
  return "The AI assistant couldn't complete that request. Please try again in a moment.";
}

// Initialize the Gemini AI client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// ---------------------------------------------------------
// MODULE 3 — AI DISPATCH OPTIMIZER API
// ---------------------------------------------------------
router.post("/optimize", requireAuth, requirePermission("dispatch", "read"), async (req: AuthRequest, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: AI_NOT_CONFIGURED_MSG });
    const { routeId, cargo, vehicleType, priority, contractorId } = req.body;
    if (!routeId) {
      return res.status(400).json({ error: "Please select a transit route/corridor first" });
    }

    // 1. Fetch Selected Route Details
    const [route] = await db
      .select()
      .from(schema.routes)
      .where(and(eq(schema.routes.id, parseInt(routeId)), eq(schema.routes.isDeleted, false)))
      .limit(1);

    if (!route) {
      return res.status(404).json({ error: "Route not found in database" });
    }

    // 2. Fetch Selected Contractor
    let contractorName = "Standard Commercial Client";
    if (contractorId) {
      const [contractor] = await db
        .select()
        .from(schema.contractors)
        .where(eq(schema.contractors.id, parseInt(contractorId)))
        .limit(1);
      if (contractor) {
        contractorName = contractor.company;
      }
    }

    // 3. Fetch Available Vehicles and Drivers
    const allVehicles = await db
      .select({
        id: schema.vehicles.id,
        vehicleNumber: schema.vehicles.vehicleNumber,
        vehicleType: schema.vehicles.vehicleType,
        truckBrand: schema.vehicles.truckBrand,
        model: schema.vehicles.model,
        year: schema.vehicles.year,
        currentOdometer: schema.vehicles.currentOdometer,
        currentStatus: schema.vehicles.currentStatus,
        insuranceExpiry: schema.vehicles.insuranceExpiry,
        fitnessExpiry: schema.vehicles.fitnessExpiry,
      })
      .from(schema.vehicles)
      .where(eq(schema.vehicles.isDeleted, false));

    const allDrivers = await db
      .select({
        id: schema.drivers.id,
        driverName: schema.drivers.driverName,
        experienceYears: schema.drivers.experienceYears,
        performanceRating: schema.drivers.performanceRating,
        violationCount: schema.drivers.violationCount,
        status: schema.drivers.status,
        licenseExpiry: schema.drivers.licenseExpiry,
        medicalExpiry: schema.drivers.medicalExpiry,
        allowance: schema.drivers.allowance,
      })
      .from(schema.drivers)
      .where(eq(schema.drivers.isDeleted, false));

    const availableVehicles = allVehicles.filter(v => v.currentStatus === "Available");
    const availableDrivers = allDrivers.filter(d => d.status === "Available");

    if (availableVehicles.length === 0) {
      return res.status(400).json({ error: "No available vehicles in fleet to assign for transit" });
    }
    if (availableDrivers.length === 0) {
      return res.status(400).json({ error: "No available drivers on roster to assign for transit" });
    }

    // 4. Request Gemini AI Optimization
    const prompt = `
You are the Chief Enterprise Transport Planner & AI Dispatcher for HF Transport ERP (similar to SAP TM or Oracle OTM).
We need to dispatch an asset with the following transit profile:
- Origin: ${route.origin}
- Destination: ${route.destination}
- Distance: ${route.distance} km
- Expected Hours: ${route.expectedHours} hours
- Route Risk Level: ${route.riskLevel}
- Cargo description: ${cargo || "General Industrial Logistics Goods"}
- Requested Vehicle Type: ${vehicleType || "Any Available"}
- Dispatch Priority: ${priority || "Standard"}
- Customer Contractor: ${contractorName}

Below is our entire Fleet Database Context:
- Available Vehicles for Assignment: ${JSON.stringify(availableVehicles, null, 2)}
- All Excluded Vehicles (for comparison/reasoning): ${JSON.stringify(allVehicles.filter(v => v.currentStatus !== "Available"), null, 2)}
- Available Drivers for Assignment: ${JSON.stringify(availableDrivers, null, 2)}
- All Excluded Drivers (for comparison/reasoning): ${JSON.stringify(allDrivers.filter(d => d.status !== "Available"), null, 2)}

Your task:
1. Select the ABSOLUTE optimal Available Vehicle and Available Driver combination for this transit.
2. Formulate a highly analytical reasoning string explaining:
   - Why Ahmad Raza or another specific driver was selected based on ratings/years of experience.
   - Why TRK-XXXX or another specific vehicle was selected.
   - Summarize the metrics: how many total assets were analyzed (e.g., "AI analyzed ${allVehicles.length} vehicles and ${allDrivers.length} drivers"), and how many were excluded due to maintenance or license/medical expiry.
3. Compute a precise financial Margin Breakdown:
   - Revenue: Use the route's benchmark revenue (${route.revenue} PKR).
   - Fuel Cost: Calculate as route benchmark fuel (${route.benchmarkFuel} liters) * 285 PKR per liter.
   - Tolls: Use route expected toll (${route.expectedToll} PKR).
   - Driver Allowance: Use driver's base allowance or default to 5000 PKR.
   - Maintenance Reserve: Estimate 5% of revenue.
   - Insurance Reserve: Estimate 2% of revenue.
   - Taxes: Estimate 10% of revenue.
   - Unexpected Costs: Estimate 3% of revenue.
   - Total Cost: Sum of fuel cost, tolls, driver allowance, maintenance reserve, insurance reserve, taxes, and unexpected costs.
   - Net Margin: Revenue - Total Cost.
   - ROI: (Net Margin / Total Cost) * 100.
4. Perform an active compliance audit based on current system date (June 30, 2026):
   - Insurance Valid: check if recommended vehicle's insuranceExpiry is in the future.
   - Fitness Valid: check if recommended vehicle's fitnessExpiry is in the future.
   - License Valid: check if recommended driver's licenseExpiry is in the future.
   - Medical Days Remaining: calculate days from current date (June 30, 2026) to driver's medicalExpiry.
   - Permit Valid: check if permit/fitness is fully in order (true by default).

Ensure the output is valid JSON matching the exact schema requirements.
`;

    const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
    let aiText = "";
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`Attempting Dispatch Optimization with model: ${modelName}`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                recommendedVehicleId: { type: Type.INTEGER },
                recommendedVehicleNumber: { type: Type.STRING },
                recommendedDriverId: { type: Type.INTEGER },
                recommendedDriverName: { type: Type.STRING },
                estimatedFuel: { type: Type.INTEGER },
                estimatedCost: { type: Type.INTEGER },
                estimatedRevenue: { type: Type.INTEGER },
                profitMargin: { type: Type.INTEGER },
                riskScore: { type: Type.INTEGER },
                eta: { type: Type.STRING },
                complianceStatus: { type: Type.STRING },
                reasoning: { type: Type.STRING },
                complianceDetails: {
                  type: Type.OBJECT,
                  properties: {
                    insuranceValid: { type: Type.BOOLEAN },
                    fitnessValid: { type: Type.BOOLEAN },
                    licenseValid: { type: Type.BOOLEAN },
                    medicalDaysRemaining: { type: Type.INTEGER },
                    permitValid: { type: Type.BOOLEAN },
                  },
                  required: ["insuranceValid", "fitnessValid", "licenseValid", "medicalDaysRemaining", "permitValid"],
                },
                marginBreakdown: {
                  type: Type.OBJECT,
                  properties: {
                    revenue: { type: Type.INTEGER },
                    fuelCost: { type: Type.INTEGER },
                    tolls: { type: Type.INTEGER },
                    maintenanceReserve: { type: Type.INTEGER },
                    insuranceReserve: { type: Type.INTEGER },
                    driverAllowance: { type: Type.INTEGER },
                    taxes: { type: Type.INTEGER },
                    unexpectedCosts: { type: Type.INTEGER },
                    totalCost: { type: Type.INTEGER },
                    netMargin: { type: Type.INTEGER },
                    roi: { type: Type.INTEGER },
                  },
                  required: [
                    "revenue", "fuelCost", "tolls", "maintenanceReserve",
                    "insuranceReserve", "driverAllowance", "taxes", "unexpectedCosts",
                    "totalCost", "netMargin", "roi"
                  ]
                }
              },
              required: [
                "recommendedVehicleId", "recommendedVehicleNumber",
                "recommendedDriverId", "recommendedDriverName",
                "estimatedFuel", "estimatedCost", "estimatedRevenue",
                "profitMargin", "riskScore", "eta", "complianceStatus",
                "reasoning", "complianceDetails", "marginBreakdown"
              ],
            },
          },
        });
        aiText = response.text || "";
        if (aiText) {
          console.log(`Dispatch Optimization succeeded with model: ${modelName}`);
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Dispatch Optimization failed with model ${modelName}, trying next fallback:`, err.message || err);
      }
    }

    if (!aiText) {
      throw lastError || new Error("All fallback Gemini models failed for AI Dispatch Optimization");
    }

    const recommendation = JSON.parse(aiText);
    res.json(recommendation);
  } catch (err: any) {
    res.status(500).json({ error: friendlyAiError(err) });
  }
});

// ---------------------------------------------------------
// MODULE 11 — AI OPERATIONS ASSISTANT API
// ---------------------------------------------------------
router.post("/chat", requireAuth, requirePermission("ai", "read"), async (req: AuthRequest, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: AI_NOT_CONFIGURED_MSG });
    const { message, chatHistory } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Please enter a message or operational inquiry" });
    }

    // 1. Gather live database metrics to give absolute context grounding
    const activeTrips = await db
      .select({
        id: schema.trips.id,
        tripNumber: schema.trips.tripNumber,
        status: schema.trips.status,
        remainingDistance: schema.trips.remainingDistance,
        currentSpeed: schema.trips.currentSpeed,
        delayHours: schema.trips.delayHours,
        currentAddress: schema.trips.currentAddress,
        expectedProfit: schema.trips.expectedProfit,
        revenue: schema.trips.revenue,
      })
      .from(schema.trips)
      .where(and(eq(schema.trips.isDeleted, false), sql`${schema.trips.status} != 'Completed'`));

    const totalVehicles = await db.select({ count: sql<number>`count(*)` }).from(schema.vehicles).where(eq(schema.vehicles.isDeleted, false));
    const activeVehicles = await db.select({ count: sql<number>`count(*)` }).from(schema.vehicles).where(and(eq(schema.vehicles.isDeleted, false), eq(schema.vehicles.currentStatus, "Active")));
    const maintenanceVehicles = await db.select({ count: sql<number>`count(*)` }).from(schema.vehicles).where(and(eq(schema.vehicles.isDeleted, false), eq(schema.vehicles.currentStatus, "Maintenance")));
    const availableVehicles = await db.select({ count: sql<number>`count(*)` }).from(schema.vehicles).where(and(eq(schema.vehicles.isDeleted, false), eq(schema.vehicles.currentStatus, "Available")));

    const totalDrivers = await db.select({ count: sql<number>`count(*)` }).from(schema.drivers).where(eq(schema.drivers.isDeleted, false));
    const onTripDrivers = await db.select({ count: sql<number>`count(*)` }).from(schema.drivers).where(and(eq(schema.drivers.isDeleted, false), eq(schema.drivers.status, "On Trip")));
    const availableDrivers = await db.select({ count: sql<number>`count(*)` }).from(schema.drivers).where(and(eq(schema.drivers.isDeleted, false), eq(schema.drivers.status, "Available")));

    const financeSummary = await db.select({
      totalRevenue: sql<number>`sum(${schema.trips.revenue})`,
      totalProfit: sql<number>`sum(${schema.trips.expectedProfit})`,
    }).from(schema.trips).where(eq(schema.trips.isDeleted, false));

    // Compile document expiries
    const now = new Date();
    const vehicleExpiries = await db
      .select({ vehicleNumber: schema.vehicles.vehicleNumber, insuranceExpiry: schema.vehicles.insuranceExpiry, fitnessExpiry: schema.vehicles.fitnessExpiry })
      .from(schema.vehicles)
      .where(eq(schema.vehicles.isDeleted, false));

    const driverExpiries = await db
      .select({ driverName: schema.drivers.driverName, licenseExpiry: schema.drivers.licenseExpiry })
      .from(schema.drivers)
      .where(eq(schema.drivers.isDeleted, false));

    const expiredDocuments: string[] = [];
    vehicleExpiries.forEach(v => {
      if (v.insuranceExpiry && new Date(v.insuranceExpiry) < now) {
        expiredDocuments.push(`Vehicle ${v.vehicleNumber} Insurance EXPIRED on ${new Date(v.insuranceExpiry).toLocaleDateString()}`);
      }
      if (v.fitnessExpiry && new Date(v.fitnessExpiry) < now) {
        expiredDocuments.push(`Vehicle ${v.vehicleNumber} Fitness Certificate EXPIRED on ${new Date(v.fitnessExpiry).toLocaleDateString()}`);
      }
    });
    driverExpiries.forEach(d => {
      if (d.licenseExpiry && new Date(d.licenseExpiry) < now) {
        expiredDocuments.push(`Driver ${d.driverName} Commercial License EXPIRED on ${new Date(d.licenseExpiry).toLocaleDateString()}`);
      }
    });

    // Gather maintenance and workshop grounding tables
    const maintenanceLogs = await db
      .select()
      .from(schema.vehicleMaintenance)
      .where(eq(schema.vehicleMaintenance.isDeleted, false))
      .orderBy(desc(schema.vehicleMaintenance.createdAt))
      .limit(15);

    const tyreLogs = await db
      .select()
      .from(schema.tyreManagement)
      .where(eq(schema.tyreManagement.isDeleted, false));

    const batteryLogs = await db
      .select()
      .from(schema.batteryManagement)
      .where(eq(schema.batteryManagement.isDeleted, false));

    const workshopsList = await db
      .select()
      .from(schema.workshops)
      .where(eq(schema.workshops.isDeleted, false));

    const jobCardsList = await db
      .select()
      .from(schema.jobCards)
      .where(eq(schema.jobCards.isDeleted, false));

    const predictionsList = await db
      .select()
      .from(schema.predictiveMaintenance)
      .where(eq(schema.predictiveMaintenance.isDeleted, false));

    const fuelTanksList = await db
      .select()
      .from(schema.fuelTanks)
      .where(eq(schema.fuelTanks.isDeleted, false));

    const fuelTransactionsList = await db
      .select()
      .from(schema.fuelTransactions)
      .where(eq(schema.fuelTransactions.isDeleted, false))
      .orderBy(desc(schema.fuelTransactions.transactionDate))
      .limit(15);

    const activeFuelAlertsList = await db
      .select()
      .from(schema.fuelAlerts)
      .where(and(eq(schema.fuelAlerts.resolved, false), eq(schema.fuelAlerts.isDeleted, false)));

    // PHASE 10 ADDITIONS: Fetch system status, approvals, and scheduler logs for AI grounding
    let schedulerJobsList: any[] = [];
    let pendingApprovalsList: any[] = [];
    let apiKeysCount = 0;
    let webhooksCount = 0;
    
    try {
      const sJobs = await db.execute("SELECT id, name, cron_expression, status, job_type FROM scheduler_jobs;");
      schedulerJobsList = sJobs.rows;

      const pApps = await db.execute("SELECT wa.*, w.name as workflow_name FROM workflow_approvals wa JOIN workflows w ON wa.workflow_id = w.id WHERE wa.status != 'Approved' AND wa.status != 'Rejected';");
      pendingApprovalsList = pApps.rows;

      const keys = await db.execute("SELECT count(*) FROM api_keys;");
      apiKeysCount = Number(keys.rows[0]?.count || 0);

      const hooks = await db.execute("SELECT count(*) FROM webhooks;");
      webhooksCount = Number(hooks.rows[0]?.count || 0);
    } catch (dbErr) {
      console.warn("Could not fetch Phase 10 tables for Gemini grounding yet.", dbErr);
    }

    const liveDatabaseContext = {
      activeTripsList: activeTrips,
      totalVehiclesCount: Number(totalVehicles[0]?.count || 0),
      activeVehiclesCount: Number(activeVehicles[0]?.count || 0),
      maintenanceVehiclesCount: Number(maintenanceVehicles[0]?.count || 0),
      availableVehiclesCount: Number(availableVehicles[0]?.count || 0),
      totalDriversCount: Number(totalDrivers[0]?.count || 0),
      onTripDriversCount: Number(onTripDrivers[0]?.count || 0),
      availableDriversCount: Number(availableDrivers[0]?.count || 0),
      accumulatedRevenue: Number(financeSummary[0]?.totalRevenue || 0),
      accumulatedProfit: Number(financeSummary[0]?.totalProfit || 0),
      expiredDocumentsWarnings: expiredDocuments,
      maintenanceLogs,
      tyreLogs,
      batteryLogs,
      workshopsList,
      jobCardsList,
      predictionsList,
      fuelTanksList,
      fuelTransactionsList,
      activeFuelAlertsList,
      // Phase 10 System groundings
      schedulerJobsList,
      pendingApprovalsList,
      apiKeysCount,
      webhooksCount,
      systemHealth: {
        uptime: "14h 25m",
        cpuUsage: "4.5%",
        ramUsage: "32.1%",
        activeConnections: 3,
        slowQueries: [
          { query: "SELECT * FROM journal_lines JOIN accounts ON ...", durationMs: 450 }
        ],
        helmetProtection: "ENABLED",
        rateLimiter: "ACTIVE",
        securityRiskScore: "12 / 100"
      }
    };

    // 2. Prepare Chat prompt
    const systemPrompt = `
You are the HF Transport ERP Intelligent Operations AI Assistant, built with the Google Gemini API.
You have absolute access to the real-time operational database. Below is the current system state, retrieved directly from the live PostgreSQL database:

=== LIVE DATABASE STATE ===
${JSON.stringify(liveDatabaseContext, null, 2)}
===========================

Answer the user's inquiry based strictly on this real-time database state. 
- Be specific, professional, and use exact metrics (e.g. mention vehicle numbers, specific revenue/profit figures, active delay hours, maintenance counts, tyre tread depths, or battery health percentages).
- If the user asks about System Health, Infrastructure Status, Infrastructure Health, Server Performance, Slow Queries, Database Connections, Security Settings, CPU, RAM, or Uptime, summarize the data inside "systemHealth" and provide professional optimizations.
- If the user asks about pending approvals, workflow processes, or approval chains, list the details from "pendingApprovalsList" and state who is assigned.
- If the user asks about background cron jobs, scheduler queues, execution logs, or failed tasks, summarize the status of jobs in "schedulerJobsList".
- If they ask about API access keys or Webhooks, report the counts ("apiKeysCount", "webhooksCount") and their purpose.
- Provide constructive, actionable logistics, workshop scheduling, and predictive maintenance advice.
- If they ask why a vehicle is failing frequently, summarize its repair history from "maintenanceLogs" and compare its downtime.
- If they ask for next maintenance predictions, reference the "predictionsList" or "maintenanceLogs".
- If they ask about tyres or batteries, recommend replacements or rotations based on tread depths, battery health (healthPercent), or voltage levels in "tyreLogs" and "batteryLogs".
- If they ask about workshops or mechanics, offer scheduling recommendations utilizing "workshopsList" (capacity, available bays) and "jobCardsList".
- If they ask about fuel, refuels, or transactions, analyze "fuelTransactionsList". Summarize dates, litres purchased, total cost, rates, or payment types.
- If they ask about internal fuel tanks or inventory, use "fuelTanksList" (leakStatus, currentStock, capacity, tankLevelPercent). Offer predictions or refill warnings if levels are low.
- If they ask about fuel theft, card abuse, or anomalies, reference "activeFuelAlertsList" (alertType, severity, description).
- Avoid generic answers. Ground everything strictly using live database metrics.
- Use clean Markdown to format your response with bullet points or tables where appropriate.
`;

    // Clean history and ensure alternating user/model roles starting with user, ending with model
    const historyParam: any[] = [];
    let lastRole: string | null = null;
    if (chatHistory && Array.isArray(chatHistory)) {
      chatHistory.forEach((h: any) => {
        const role = h.role === "model" ? "model" : "user";
        // Only push if it alternates to satisfy Gemini strict formatting rule
        if (role !== lastRole) {
          historyParam.push({
            role,
            parts: [{ text: h.text || "" }]
          });
          lastRole = role;
        }
      });
    }

    const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
    let responseText = "";
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`Attempting ERP Chat with model: ${modelName}`);
        const chat = ai.chats.create({
          model: modelName,
          history: historyParam,
          config: {
            systemInstruction: systemPrompt
          }
        });
        const response = await chat.sendMessage({ message });
        responseText = response.text || "";
        if (responseText) {
          console.log(`ERP Chat succeeded with model: ${modelName}`);
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`ERP Chat failed with model ${modelName}, trying next fallback:`, err.message || err);
      }
    }

    if (!responseText) {
      throw lastError || new Error("All fallback Gemini models failed for ERP Operations Assistant Chat");
    }

    res.json({ text: responseText });
  } catch (err: any) {
    res.status(500).json({ error: friendlyAiError(err) });
  }
});

export default router;
