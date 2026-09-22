/**
 * End-to-end demo seed for HF Transport ERP.
 *
 * Drives the REAL HTTP API (same paths the UI uses) as the super admin via the
 * dev-auth bypass, so every server-side automation fires: trip dispatch locks
 * the vehicle/driver, completing a trip auto-generates an invoice, a fuel
 * transaction posts balanced journal entries and auto-creates GL accounts,
 * completing a maintenance job books a maintenance expense, etc.
 *
 * Usage:  node scripts/seed-demo.mjs [baseUrl]
 * Default baseUrl: http://localhost:5173
 *
 * Requires the dev server running with DEV_AUTH_BYPASS=true (see .env.local).
 * At the end it writes ./demo-data-export.json and ./demo-data-summary.md.
 */

import { writeFileSync } from "node:fs";

const BASE = (process.argv[2] || process.env.SEED_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const TAG = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ""); // e.g. 202609081012
const rid = (n) => String(n).padStart(3, "0");

let ok = 0;
let fail = 0;
const failures = [];

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer DEV_BYPASS",
      "x-dev-bypass": "1",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new Error(`${method} ${path} -> ${res.status} ${msg}`);
  }
  return data;
}

async function step(label, fn) {
  try {
    const out = await fn();
    ok++;
    const id = out && (out.id ?? out.device?.id ?? out.deviceId);
    console.log(`  ok   ${label}${id ? `  (#${id})` : ""}`);
    return out;
  } catch (err) {
    fail++;
    failures.push(`${label}: ${err.message}`);
    console.log(`  FAIL ${label}  ->  ${err.message}`);
    return null;
  }
}

// like step(), but a benign "already exists" is treated as success
async function softStep(label, fn) {
  try {
    const out = await fn();
    ok++;
    console.log(`  ok   ${label}`);
    return out;
  } catch (err) {
    if (/already exists/i.test(err.message)) {
      ok++;
      console.log(`  ok   ${label}  (exists)`);
      return null;
    }
    fail++;
    failures.push(`${label}: ${err.message}`);
    console.log(`  FAIL ${label}  ->  ${err.message}`);
    return null;
  }
}

const pick = (arr, i) => arr[i % arr.length];

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const CITIES = [
  { city: "Karachi", province: "Sindh", lat: 24.8607, lng: 67.0011 },
  { city: "Lahore", province: "Punjab", lat: 31.5204, lng: 74.3587 },
  { city: "Islamabad", province: "Islamabad", lat: 33.6844, lng: 73.0479 },
  { city: "Multan", province: "Punjab", lat: 30.1575, lng: 71.5249 },
  { city: "Faisalabad", province: "Punjab", lat: 31.4187, lng: 73.0791 },
  { city: "Hyderabad", province: "Sindh", lat: 25.396, lng: 68.3578 },
  { city: "Peshawar", province: "KPK", lat: 34.0151, lng: 71.5249 },
  { city: "Quetta", province: "Balochistan", lat: 30.1798, lng: 66.975 },
];

const created = {
  vehicles: [],
  routes: [],
  drivers: [],
  contractors: [],
  trips: [],
  fuelVendors: [],
  fuelStations: [],
  fuelCards: [],
  fuelTransactions: [],
  workshops: [],
  mechanics: [],
  maintenance: [],
  tyres: [],
  jobCards: [],
  banks: [],
  bills: [],
  expenses: [],
  departments: [],
  designations: [],
  shifts: [],
  employees: [],
  attendance: [],
  trackerDevices: [],
};

// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nHF Transport ERP — demo seed`);
  console.log(`base: ${BASE}   tag: ${TAG}\n`);

  // sanity: server + auth
  const me = await api("GET", "/api/auth/me");
  console.log(`auth: ${me.user?.email} (${me.user?.role})\n`);
  if (me.user?.role !== "Super Admin") {
    throw new Error(`expected Super Admin via DEV_BYPASS, got ${me.user?.role}`);
  }

  // ----- FINANCE: chart of accounts (needed before trips/fuel/bills) ----
  console.log("Finance · chart of accounts");
  const COA = [
    ["1001", "Cash on Hand", "Asset", "Cash"],
    ["1002", "Bank General Ledger", "Asset", "Bank"],
    ["1100", "Accounts Receivable", "Asset", "Accounts Receivable"],
    ["1301", "Fuel Inventory Asset", "Asset", "Fuel"],
    ["2000", "Accounts Payable", "Liability", "Accounts Payable"],
    ["2100", "Sales Tax Payable", "Liability", "Miscellaneous"],
    ["4000", "Freight Revenue", "Income", "Revenue"],
    ["4001", "Other Operating Revenue", "Income", "Revenue"],
    ["5001", "Fuel Expense", "Expense", "Fuel"],
    ["5002", "Salary Expense", "Expense", "Salary"],
    ["5003", "Maintenance Expense", "Expense", "Maintenance"],
    ["5004", "Insurance Expense", "Expense", "Insurance"],
    ["5005", "Toll Expense", "Expense", "Toll"],
    ["5006", "Depreciation Expense", "Expense", "Depreciation"],
    ["5099", "Miscellaneous Expense", "Expense", "Miscellaneous"],
  ];
  for (const [code, name, type, category] of COA) {
    await softStep(`account ${code} ${name}`, () =>
      api("POST", "/api/finance/accounts", { code, name, type, category, description: "Seeded chart of accounts" })
    );
  }

  // ----- FLEET: vehicles -------------------------------------------------
  console.log("\nFleet · vehicles");
  const brands = ["Hino", "Volvo", "Isuzu", "Mercedes-Benz", "MAN", "Shacman"];
  const vTypes = ["Containerized", "Flatbed", "Reefer", "Tanker"];
  const contTypes = ["20ft", "40ft", "40ft HC"];
  for (let i = 0; i < 6; i++) {
    const yr = 2018 + (i % 6);
    const v = await step(`vehicle HF-${TAG.slice(-4)}-${rid(i + 1)}`, () =>
      api("POST", "/api/operations/vehicles", {
        vehicleNumber: `HFD-${TAG.slice(-4)}-${rid(i + 1)}`,
        registrationNumber: `LES-${TAG.slice(-4)}${i}`,
        engineNumber: `ENG-${TAG}-${rid(i + 1)}`,
        chassisNumber: `CHS-${TAG}-${rid(i + 1)}`,
        vehicleType: pick(vTypes, i),
        truckBrand: pick(brands, i),
        model: `${pick(brands, i)} ${["500", "700", "FH16", "1618", "TGS", "X3000"][i % 6]}`,
        year: yr,
        containerType: pick(contTypes, i),
        payloadCapacity: 25000 + i * 1500,
        fuelType: "Diesel",
        currentOdometer: 120000 + i * 43000,
        ownershipStatus: i % 3 === 0 ? "Leased" : "Owned",
        insuranceNumber: `INS-${TAG}-${rid(i + 1)}`,
        insuranceExpiry: new Date(Date.now() + (120 + i * 20) * 864e5).toISOString(),
        fitnessCertificate: `FIT-${TAG}-${rid(i + 1)}`,
        fitnessExpiry: new Date(Date.now() + (90 + i * 15) * 864e5).toISOString(),
        purchaseDate: new Date(`${yr}-03-15`).toISOString(),
        purchaseCost: 18000000 + i * 900000,
        currentStatus: "Available",
      })
    );
    if (v) created.vehicles.push(v);
  }

  // ----- FLEET: routes -------------------------------------------------
  console.log("\nFleet · routes");
  const routePairs = [
    [0, 1], [1, 2], [0, 3], [3, 4], [1, 5], [2, 6], [0, 7], [4, 1],
  ];
  for (let i = 0; i < routePairs.length; i++) {
    const [a, b] = routePairs[i];
    const o = CITIES[a];
    const d = CITIES[b];
    const dist = Math.round(
      Math.hypot((o.lat - d.lat) * 111, (o.lng - d.lng) * 100) * 1.25 + 80
    );
    const r = await step(`route ${o.city} -> ${d.city} (${dist} km)`, () =>
      api("POST", "/api/operations/routes", {
        origin: o.city,
        destination: d.city,
        distance: dist,
        expectedHours: Math.max(3, Math.round(dist / 55)),
        benchmarkFuel: Math.round(dist / 3.2),
        expectedToll: 1500 + Math.round(dist * 3.5),
        revenue: 90000 + dist * 420,
        averageSpeed: 55,
        allowedSpeed: 90,
        riskLevel: pick(["Low", "Low", "Medium", "High"], i),
        geofenceOrigin: { lat: o.lat, lng: o.lng, radius: 500 },
        geofenceDestination: { lat: d.lat, lng: d.lng, radius: 500 },
        mapPolyline: JSON.stringify([
          [o.lat, o.lng],
          [(o.lat + d.lat) / 2 + 0.15, (o.lng + d.lng) / 2 - 0.1],
          [d.lat, d.lng],
        ]),
        status: "Active",
      })
    );
    if (r) created.routes.push({ ...r, _o: o, _d: d });
  }

  // ----- FLEET: drivers -------------------------------------------------
  console.log("\nFleet · drivers");
  const names = [
    "Muhammad Aslam", "Zulfiqar Ali", "Imran Khan", "Ghulam Murtaza",
    "Naveed Akhtar", "Shahid Mehmood", "Abdul Rehman", "Tariq Javed",
  ];
  const blood = ["A+", "B+", "O+", "AB+", "O-", "B-"];
  for (let i = 0; i < 6; i++) {
    const dr = await step(`driver ${names[i]}`, () =>
      api("POST", "/api/operations/drivers", {
        driverName: names[i],
        cnic: `35202-${TAG.slice(-7)}-${i}`,
        licenseNumber: `LHR-DL-${TAG.slice(-6)}-${i}`,
        licenseExpiry: new Date(Date.now() + (200 + i * 30) * 864e5).toISOString(),
        mobile: `+9230${i}${TAG.slice(-7)}`,
        emergencyContact: `+9231${i}${TAG.slice(-7)}`,
        address: `House ${12 + i}, Street ${4 + i}, ${pick(CITIES, i).city}`,
        bloodGroup: pick(blood, i),
        joiningDate: new Date(Date.now() - (300 + i * 90) * 864e5).toISOString(),
        salary: 55000 + i * 6000,
        allowance: 8000 + i * 750,
        experienceYears: 4 + i,
        status: "Available",
        medicalExpiry: new Date(Date.now() + (150 + i * 20) * 864e5).toISOString(),
      })
    );
    if (dr) created.drivers.push(dr);
  }

  // ----- FLEET: contractors -------------------------------------------------
  console.log("\nFleet · contractors (clients)");
  const clients = [
    "Indus Logistics Pvt Ltd", "Al-Karam Textiles", "Pak Agro Traders",
    "Continental FMCG", "Sapphire Distribution",
  ];
  for (let i = 0; i < clients.length; i++) {
    const c = await step(`contractor ${clients[i]}`, () =>
      api("POST", "/api/operations/contractors", {
        contractorName: clients[i],
        contactPerson: pick(names, i + 2),
        mobile: `+9232${i}${TAG.slice(-7)}`,
        email: `ap${i}.${TAG.slice(-6)}@${clients[i].split(" ")[0].toLowerCase()}.com.pk`,
        taxRegistrationNumber: `NTN-${TAG.slice(-7)}${i}`,
        billingAddress: `Plot ${20 + i}, SITE Area, ${pick(CITIES, i).city}`,
        creditLimit: 2000000 + i * 500000,
        currentOutstanding: 0,
        paymentTerms: pick(["Net 15", "Net 30", "Net 45"], i),
        isActive: true,
      })
    );
    if (c) created.contractors.push(c);
  }

  // ----- OPERATIONS: dispatch trips ------------------------------------
  console.log("\nOperations · dispatch trips");
  const nTrips = Math.min(6, created.vehicles.length, created.drivers.length, created.routes.length);
  for (let i = 0; i < nTrips; i++) {
    const v = created.vehicles[i];
    const dr = created.drivers[i];
    const r = created.routes[i];
    const c = pick(created.contractors, i);
    if (!v || !dr || !r || !c) continue;
    const t = await step(`trip ${r._o.city} -> ${r._d.city} (${v.vehicleNumber} / ${dr.driverName})`, () =>
      api("POST", "/api/operations/trips/dispatch", {
        vehicleId: v.id,
        driverId: dr.id,
        routeId: r.id,
        contractorId: c.id,
        departureTime: new Date(Date.now() - (i * 6 + 2) * 3600e3).toISOString(),
      })
    );
    if (t) created.trips.push({ ...t, _route: r, _vehicle: v, _driver: dr });
  }

  // progress a few trips through their lifecycle; complete 2 -> auto invoice
  console.log("\nOperations · trip lifecycle");
  for (let i = 0; i < created.trips.length; i++) {
    const t = created.trips[i];
    const flow = i < 2
      ? ["Started", "In Transit", "Arrived", "Completed"]
      : i < 4
      ? ["Started", "In Transit"]
      : ["Started"];
    for (const status of flow) {
      await step(`trip ${t.tripNumber} -> ${status}`, () =>
        api("PUT", `/api/operations/trips/${t.id}/status`, { status })
      );
    }
    t._finalStatus = flow[flow.length - 1];
  }

  // ----- FUEL --------------------------------------------------------
  console.log("\nFuel · vendors / stations / cards");
  const oilCos = ["PSO", "Shell Pakistan", "Total PARCO", "Attock Petroleum", "Hascol"];
  for (let i = 0; i < 3; i++) {
    const fv = await step(`fuel vendor ${oilCos[i]}`, () =>
      api("POST", "/api/fuel/vendors", {
        vendorName: `${oilCos[i]} Fleet Desk`,
        company: oilCos[i],
        phone: `+9221${i}${TAG.slice(-7)}`,
        email: `fleet${i}.${TAG.slice(-6)}@${oilCos[i].split(" ")[0].toLowerCase()}.com`,
        address: `${oilCos[i]} House, ${pick(CITIES, i).city}`,
        fuelRatesJson: { diesel: 288.5, petrol: 268.0 },
        creditLimit: 5000000,
        paymentTerms: "Net 30",
        status: "Active",
      })
    );
    if (fv) created.fuelVendors.push(fv);
  }
  for (let i = 0; i < 5; i++) {
    const city = pick(CITIES, i);
    const fs = await step(`fuel station ${oilCos[i % oilCos.length]} ${city.city}`, () =>
      api("POST", "/api/fuel/stations", {
        stationName: `${oilCos[i % oilCos.length]} ${city.city} Bypass`,
        company: oilCos[i % oilCos.length],
        city: city.city,
        province: city.province,
        gpsLocation: `${city.lat},${city.lng}`,
        contactPerson: pick(names, i),
        phone: `+9224${i}${TAG.slice(-7)}`,
        diesel: true,
        adblue: i % 2 === 0,
        status: "Active",
      })
    );
    if (fs) created.fuelStations.push(fs);
  }
  for (let i = 0; i < Math.min(4, created.vehicles.length); i++) {
    const fc = await step(`fuel card for ${created.vehicles[i].vehicleNumber}`, () =>
      api("POST", "/api/fuel/cards", {
        cardNumber: `FCARD-${TAG}-${rid(i + 1)}`,
        pin: String(1000 + i * 7),
        vehicleId: created.vehicles[i].id,
        driverId: created.drivers[i]?.id,
        vendorId: pick(created.fuelVendors, i)?.id,
        dailyLimit: 60000,
        monthlyLimit: 900000,
        currentBalance: 500000,
        status: "Active",
      })
    );
    if (fc) created.fuelCards.push(fc);
  }

  console.log("\nFuel · transactions (posts balanced journal entries)");
  for (let i = 0; i < 10; i++) {
    const v = pick(created.vehicles, i);
    const dr = created.drivers[created.vehicles.indexOf(v)] || pick(created.drivers, i);
    const trip = created.trips.find((t) => t._vehicle?.id === v?.id) || null;
    const litres = 120 + (i % 5) * 45;
    const rate = 286 + (i % 4);
    const ft = await step(`fuel txn ${litres}L @ ${rate} (${v?.vehicleNumber})`, () =>
      api("POST", "/api/fuel/transactions", {
        vehicleId: v?.id,
        driverId: dr?.id,
        tripId: trip?.id,
        vendorId: pick(created.fuelVendors, i)?.id,
        fuelStationId: pick(created.fuelStations, i)?.id,
        fuelCardId: created.fuelCards.find((c) => c.vehicleId === v?.id)?.id,
        invoiceNumber: `FINV-${TAG}-${rid(i + 1)}`,
        litres: String(litres),
        rate: String(rate),
        odometer: (v?.currentOdometer || 150000) + (i + 1) * 850,
        remainingFuelPercent: 30 + (i % 6) * 10,
        paymentType: pick(["Card", "Cash", "Credit"], i),
        geoCoordinates: `${pick(CITIES, i).lat},${pick(CITIES, i).lng}`,
      })
    );
    if (ft) created.fuelTransactions.push(ft);
  }

  // ----- MAINTENANCE ------------------------------------------------
  console.log("\nMaintenance · workshops / mechanics");
  const wsNames = ["HF Central Workshop — Lahore", "HF Port Workshop — Karachi", "HF North Hub — Islamabad"];
  for (let i = 0; i < wsNames.length; i++) {
    const w = await step(`workshop ${wsNames[i]}`, () =>
      api("POST", "/api/maintenance/workshops", {
        workshopName: wsNames[i],
        location: pick(CITIES, i).city,
        manager: pick(names, i),
        contact: `+9242${i}${TAG.slice(-7)}`,
        workingHours: "08:00-20:00",
        capacity: 8,
        availableBays: 6,
        status: "Active",
      })
    );
    if (w) created.workshops.push(w);
  }
  const specs = ["Engine", "Electrical", "Tyres", "Hydraulics", "Transmission"];
  for (let i = 0; i < 5; i++) {
    const m = await step(`mechanic MECH-${TAG.slice(-4)}-${rid(i + 1)} (${specs[i]})`, () =>
      api("POST", "/api/maintenance/mechanics", {
        mechanicCode: `MECH-${TAG}-${rid(i + 1)}`,
        specialization: specs[i],
        certification: `${specs[i]} Level ${1 + (i % 3)}`,
        experienceYears: 5 + i,
        availability: "Available",
      })
    );
    if (m) created.mechanics.push(m);
  }

  console.log("\nMaintenance · job orders (2 completed -> books expense)");
  const mtTypes = ["Preventive", "Corrective", "Inspection", "Breakdown"];
  for (let i = 0; i < 4; i++) {
    const v = pick(created.vehicles, i + 1);
    const cost = 45000 + i * 30000;
    const mnt = await step(`maintenance ${mtTypes[i]} on ${v?.vehicleNumber}`, () =>
      api("POST", "/api/maintenance/maintenance", {
        maintenanceNumber: `MNT-${TAG}-${rid(i + 1)}`,
        vehicleId: v?.id,
        vehicleRegistration: v?.registrationNumber,
        odometer: (v?.currentOdometer || 150000) + 1200,
        currentKm: (v?.currentOdometer || 150000) + 1200,
        maintenanceType: mtTypes[i],
        priority: pick(["Low", "Medium", "High", "Critical"], i),
        status: "Scheduled",
        workshopId: pick(created.workshops, i)?.id,
        mechanicId: pick(created.mechanics, i)?.id,
        estimatedCost: cost,
        actualCost: cost,
        remarks: `${mtTypes[i]} service — seeded demo record`,
      })
    );
    if (mnt) {
      created.maintenance.push(mnt);
      if (i < 2) {
        await step(`maintenance ${mnt.maintenanceNumber} -> Completed`, () =>
          api("PUT", `/api/maintenance/maintenance/${mnt.id}`, {
            status: "Completed",
            actualCost: cost,
          })
        );
      }
    }
  }

  console.log("\nMaintenance · tyres / job cards");
  for (let i = 0; i < 6; i++) {
    const v = pick(created.vehicles, i);
    const ty = await step(`tyre TYRE-${TAG.slice(-4)}-${rid(i + 1)}`, () =>
      api("POST", "/api/maintenance/tyres", {
        tyreNumber: `TYRE-${TAG}-${rid(i + 1)}`,
        tyreBrand: pick(["Bridgestone", "Michelin", "General", "Servis"], i),
        tyreSize: "11R22.5",
        tyreType: "Radial",
        serialNumber: `SN-${TAG}-${rid(i + 1)}`,
        purchaseCost: 42000 + i * 1500,
        warrantyMonths: 24,
        position: pick(["Front Left", "Front Right", "Rear Left", "Rear Right", "Spare"], i),
        currentTreadDepth: String(12 - i * 0.6),
        currentPsi: "110",
        expectedLifeKm: 80000,
        currentMileage: 8000 + i * 4000,
        scrapStatus: "Active",
        vehicleId: v?.id,
      })
    );
    if (ty) created.tyres.push(ty);
  }
  for (let i = 0; i < 4; i++) {
    const v = pick(created.vehicles, i + 2);
    const jc = await step(`job card JC-${TAG.slice(-4)}-${rid(i + 1)}`, () =>
      api("POST", "/api/maintenance/job-cards", {
        jobCardNumber: `JC-${TAG}-${rid(i + 1)}`,
        vehicleId: v?.id,
        mechanicId: pick(created.mechanics, i)?.id,
        complaint: pick(
          ["AC not cooling", "Brake noise on downhill", "Engine warning light", "Air suspension leak"],
          i
        ),
        diagnosis: "Inspected and parts identified",
        labourHours: String(2 + i),
        status: pick(["Open", "In_Progress", "Completed"], i),
        priority: pick(["Low", "Medium", "High"], i),
        approvalStatus: i % 2 === 0 ? "Approved" : "Pending",
      })
    );
    if (jc) created.jobCards.push(jc);
  }

  // ----- FINANCE --------------------------------------------------
  console.log("\nFinance · banks / bills / expenses");
  const bankDefs = [
    ["Habib Bank Ltd", "Main Boulevard Gulberg", "PK36HABB0000001234567890"],
    ["Meezan Bank", "I.I. Chundrigar Road", "PK24MEZN0000009876543210"],
    ["Bank Alfalah", "Blue Area", "PK11ALFH0000005555444433"],
  ];
  for (let i = 0; i < bankDefs.length; i++) {
    const b = await step(`bank ${bankDefs[i][0]}`, () =>
      api("POST", "/api/finance/banks", {
        bankName: bankDefs[i][0],
        branchName: bankDefs[i][1],
        accountNumber: `${1000 + i}-${TAG.slice(-8)}`,
        iban: bankDefs[i][2].slice(0, -2) + rid(i).slice(-2),
        openingBalance: 5000000 + i * 2500000,
      })
    );
    if (b) created.banks.push(b);
  }
  const billVendors = [
    ["Fuel Vendor", "PSO Fleet Desk", "5001"],
    ["Repair Workshop", "Bilal Auto Works", "5003"],
    ["Tyre Supplier", "Bridgestone Distributor", "5003"],
    ["Insurance Company", "EFU General Insurance", "5004"],
    ["Office Expense", "K-Electric", "5099"],
  ];
  for (let i = 0; i < billVendors.length; i++) {
    const amt = 150000 + i * 90000;
    const bill = await step(`bill ${billVendors[i][1]} (${amt})`, () =>
      api("POST", "/api/finance/bills", {
        vendorType: billVendors[i][0],
        vendorName: billVendors[i][1],
        dueDate: new Date(Date.now() + (15 + i * 10) * 864e5).toISOString(),
        amount: amt,
        expenseTypeCode: billVendors[i][2],
        notes: "Seeded vendor bill",
      })
    );
    if (bill) created.bills.push(bill);
  }
  const expTypes = ["Toll", "Food", "Parking", "Hotel", "Miscellaneous", "Repairs"];
  for (let i = 0; i < 8; i++) {
    const trip = pick(created.trips, i);
    const e = await step(`expense ${expTypes[i % expTypes.length]} (trip ${trip?.tripNumber || "-"})`, () =>
      api("POST", "/api/finance/expenses", {
        tripId: trip?.id,
        vehicleId: trip?._vehicle?.id,
        driverId: trip?._driver?.id,
        department: "Operations",
        costCenter: "FLEET-OPS",
        expenseType: expTypes[i % expTypes.length],
        amount: 3000 + i * 1200,
        paymentMethod: pick(["Cash", "Bank Transfer", "Card"], i),
        bankAccountId: i % 3 === 0 ? pick(created.banks, i)?.id : undefined,
        notes: "Seeded operational expense",
      })
    );
    if (e) created.expenses.push(e);
  }

  // ----- HR --------------------------------------------------
  console.log("\nHR · org structure");
  const deptDefs = [
    ["Operations", "OPS"], ["Finance & Accounts", "FIN"], ["Human Resources", "HR"],
    ["Fleet Maintenance", "MNT"], ["Fuel Management", "FUEL"],
  ];
  for (const [name, code] of deptDefs) {
    const d = await step(`department ${name}`, () =>
      api("POST", "/api/hr/org/departments", { name, code: `${code}-${TAG.slice(-4)}` })
    );
    if (d) created.departments.push(d);
  }
  const desigDefs = [
    ["Operations Manager", "M2"], ["Dispatcher", "O1"], ["Accountant", "O2"],
    ["HR Officer", "O1"], ["Workshop Supervisor", "M1"],
  ];
  for (const [name, grade] of desigDefs) {
    const d = await step(`designation ${name}`, () =>
      api("POST", "/api/hr/org/designations", { name, grade })
    );
    if (d) created.designations.push(d);
  }
  const shiftDefs = [
    ["General Day", "Regular", "09:00", "18:00"],
    ["Night Ops", "Night", "20:00", "05:00"],
    ["Early Dispatch", "Regular", "06:00", "15:00"],
  ];
  for (const [name, type, startTime, endTime] of shiftDefs) {
    const s = await step(`shift ${name}`, () =>
      api("POST", "/api/hr/org/shifts", { name, type, startTime, endTime })
    );
    if (s) created.shifts.push(s);
  }

  console.log("\nHR · employees + attendance");
  const empNames = [
    "Sana Yousuf", "Bilal Ahmed", "Fatima Noor", "Kamran Shah",
    "Ayesha Siddiqui", "Usman Ghani", "Hina Pervez", "Rizwan Malik",
  ];
  for (let i = 0; i < 8; i++) {
    const city = pick(CITIES, i);
    const emp = await step(`employee ${empNames[i]}`, () =>
      api("POST", "/api/hr/employees", {
        fullName: empNames[i],
        fatherName: pick(names, i),
        cnic: `42101-${TAG.slice(-7)}-${i}`,
        gender: i % 2 === 0 ? "Female" : "Male",
        dob: new Date(`${1988 + i}-0${1 + (i % 8)}-1${i % 9}`).toISOString(),
        maritalStatus: i % 2 === 0 ? "Married" : "Single",
        bloodGroup: pick(blood, i),
        address: `Flat ${3 + i}, Block ${i}, ${city.city}`,
        city: city.city,
        province: city.province,
        phone: `+9233${i}${TAG.slice(-7)}`,
        email: `emp${i}.${TAG.slice(-6)}@hftransport.pk`,
        emergencyContact: `+9234${i}${TAG.slice(-7)}`,
        qualification: pick(["B.Com", "BBA", "MBA", "BS Accounting", "Intermediate"], i),
        experience: `${3 + i} years`,
        departmentId: pick(created.departments, i)?.id,
        designationId: pick(created.designations, i)?.id,
        joiningDate: new Date(Date.now() - (200 + i * 60) * 864e5).toISOString(),
        employmentType: "Full-time",
        basicSalary: 60000 + i * 15000,
        fuelAllowance: 10000,
        otherAllowances: 8000 + i * 500,
        bankName: pick(bankDefs, i)[0],
        bankAccount: `ACCT-${TAG.slice(-6)}-${i}`,
        taxNumber: `TAX-${TAG.slice(-7)}${i}`,
      })
    );
    if (emp) created.employees.push(emp);
  }
  // 3 days of attendance for the first 5 employees
  for (let d = 0; d < 3; d++) {
    for (let i = 0; i < Math.min(5, created.employees.length); i++) {
      const emp = created.employees[i];
      const day = new Date(Date.now() - (d + 1) * 864e5);
      const late = (i + d) % 4 === 0;
      const a = await step(`attendance ${emp.employeeCode} day-${d + 1}${late ? " (late)" : ""}`, () =>
        api("POST", "/api/hr/attendance/manual", {
          employeeId: emp.id,
          date: day.toISOString(),
          status: late ? "Late" : "Present",
          clockIn: new Date(day.setHours(late ? 10 : 9, late ? 15 : 2)).toISOString(),
          clockOut: new Date(day.setHours(18, 5)).toISOString(),
        })
      );
      if (a) created.attendance.push(a);
    }
  }

  // ----- TRACKING --------------------------------------------------
  console.log("\nTracking · devices + position ingest");
  for (let i = 0; i < Math.min(4, created.vehicles.length); i++) {
    const v = created.vehicles[i];
    const dev = await step(`tracker device for ${v.vehicleNumber}`, () =>
      api("POST", "/api/tracking/devices", {
        imei: `86${TAG}${rid(i + 1)}`,
        label: `Tracker ${v.vehicleNumber}`,
        vehicleId: v.id,
        provider: "generic",
        simEnabled: true,
      })
    );
    if (dev && dev.device) {
      created.trackerDevices.push(dev.device);
      // feed a short track along the trip route (or Lahore->Islamabad fallback)
      const trip = created.trips.find((t) => t._vehicle?.id === v.id);
      const o = trip?._route?._o || CITIES[1];
      const d = trip?._route?._d || CITIES[2];
      const positions = [];
      const N = 8;
      for (let k = 0; k <= N; k++) {
        const f = k / N;
        positions.push({
          lat: o.lat + (d.lat - o.lat) * f * 0.6,
          lng: o.lng + (d.lng - o.lng) * f * 0.6,
          speed: 60 + ((k * 7) % 25),
          heading: 45,
          battery: 95 - k,
          timestamp: new Date(Date.now() - (N - k) * 6 * 60e3).toISOString(),
        });
      }
      await step(`ingest ${positions.length} fixes for ${v.vehicleNumber}`, () =>
        api("POST", "/api/tracking/ingest", {
          imei: dev.device.imei,
          token: dev.device.ingestToken,
          positions,
        })
      );
      // leave device #1 "dark" so the signal-loss estimate is visible on the map
      if (i === 0) {
        await step(`backdate last fix for ${v.vehicleNumber} (signal-loss demo)`, () =>
          api("POST", "/api/tracking/ingest", {
            imei: dev.device.imei,
            token: dev.device.ingestToken,
            position: {
              lat: o.lat + (d.lat - o.lat) * 0.62,
              lng: o.lng + (d.lng - o.lng) * 0.62,
              speed: 72,
              heading: 45,
              battery: 86,
              timestamp: new Date(Date.now() - 22 * 60e3).toISOString(),
            },
          })
        );
      }
    }
  }

  // ---------------------------------------------------------------------
  // Pull the resulting state back for the export
  // ---------------------------------------------------------------------
  console.log("\nCollecting final state for export ...");
  const safeGet = async (p) => {
    try {
      return await api("GET", p);
    } catch (e) {
      return { _error: e.message };
    }
  };
  const listData = (x) => (Array.isArray(x) ? x : x?.data ?? x?.rows ?? x);

  const finalState = {
    vehicles: listData(await safeGet("/api/operations/vehicles?limit=100")),
    drivers: listData(await safeGet("/api/operations/drivers?limit=100")),
    routes: listData(await safeGet("/api/operations/routes")),
    contractors: listData(await safeGet("/api/operations/contractors?limit=100")),
    trips: listData(await safeGet("/api/operations/trips?limit=100")),
    fuelTransactions: listData(await safeGet("/api/fuel/transactions?limit=100")),
    fuelVendors: listData(await safeGet("/api/fuel/vendors")),
    fuelStations: listData(await safeGet("/api/fuel/stations")),
    maintenance: listData(await safeGet("/api/maintenance/maintenance?limit=100")),
    workshops: listData(await safeGet("/api/maintenance/workshops")),
    tyres: listData(await safeGet("/api/maintenance/tyres?limit=100")),
    invoices: listData(await safeGet("/api/finance/invoices?limit=100")),
    banks: listData(await safeGet("/api/finance/banks")),
    expenses: listData(await safeGet("/api/finance/expenses?limit=100")),
    accounts: listData(await safeGet("/api/finance/accounts?limit=200")),
    employees: listData(await safeGet("/api/hr/employees?limit=100")),
    liveTracking: await safeGet("/api/tracking/live"),
  };

  const count = (x) => (Array.isArray(x) ? x.length : x && x._error ? `err: ${x._error}` : "?");
  const counts = Object.fromEntries(Object.entries(finalState).map(([k, v]) => [k, count(v)]));

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    tag: TAG,
    stepsOk: ok,
    stepsFailed: fail,
    failures,
    createdThisRun: Object.fromEntries(
      Object.entries(created).map(([k, v]) => [k, v.length])
    ),
    finalCounts: counts,
    finalState,
  };

  writeFileSync("demo-data-export.json", JSON.stringify(report, null, 2));

  // human-readable summary
  const md = [];
  md.push(`# HF Transport ERP — demo data seed`);
  md.push("");
  md.push(`- Generated: ${report.generatedAt}`);
  md.push(`- Target: ${BASE}`);
  md.push(`- Steps: **${ok} ok**, **${fail} failed**`);
  md.push("");
  md.push(`## Records created this run`);
  md.push("");
  md.push(`| Entity | Created |`);
  md.push(`|---|---|`);
  for (const [k, v] of Object.entries(report.createdThisRun)) md.push(`| ${k} | ${v} |`);
  md.push("");
  md.push(`## Totals now in the database (via API)`);
  md.push("");
  md.push(`| Module list | Rows |`);
  md.push(`|---|---|`);
  for (const [k, v] of Object.entries(counts)) md.push(`| ${k} | ${v} |`);
  md.push("");
  if (failures.length) {
    md.push(`## Failed steps`);
    md.push("");
    for (const f of failures) md.push(`- ${f}`);
    md.push("");
  }
  md.push(`## Notes`);
  md.push("");
  md.push(`- 2 trips were driven to **Completed** — each auto-generated a customer **invoice**.`);
  md.push(`- 10 fuel transactions each posted a **balanced journal entry** (GL accounts auto-created).`);
  md.push(`- 2 maintenance jobs were **Completed** — each booked a maintenance expense entry.`);
  md.push(`- Tracker device #1 is intentionally left "dark" (~22 min) so the **signal-loss estimate** shows on the live map.`);
  md.push(`- Full structured dump: \`demo-data-export.json\`.`);
  writeFileSync("demo-data-summary.md", md.join("\n"));

  console.log(`\n----------------------------------------`);
  console.log(`steps: ${ok} ok / ${fail} failed`);
  console.log(`final counts:`, counts);
  console.log(`wrote: demo-data-export.json, demo-data-summary.md`);
  if (fail) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  - ${f}`);
  }
}

main().catch((e) => {
  console.error("\nFATAL:", e.message);
  process.exit(1);
});
