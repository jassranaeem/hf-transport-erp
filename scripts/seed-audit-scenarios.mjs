/**
 * Seeds two realistic AUDIT scenarios on top of the demo data so the
 * detection features have something real to catch:
 *
 *  1. FUEL INTEGRITY  — one clean driver, one siphoning driver, one borderline.
 *     Verifies GET /api/fuel/integrity-audit ranks the thief by rupee loss.
 *
 *  2. PARTNERSHIP UNDER-REPORTING — a lease-to-own truck (5,000,000, 2,000,000
 *     advance, 3,000,000 balance). One honest settlement, one where the partner
 *     under-declares revenue and pads expenses. Verifies the settlement engine
 *     flags it and estimates the skim.
 *
 * Usage:  node scripts/seed-audit-scenarios.mjs [baseUrl]
 * Needs the dev server up (DEV_AUTH_BYPASS=true) and Postgres reachable via
 * the same DATABASE_URL the server uses (for timestamp back-dating only).
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = (process.argv[2] || "http://localhost:5173").replace(/\/$/, "");
const PSQL = "C:/Users/HP/hfpg/bin/psql.exe";

const H = { "Content-Type": "application/json", Authorization: "Bearer DEV_BYPASS", "x-dev-bypass": "1" };
const api = async (m, p, b) => {
  const r = await fetch(BASE + p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text();
  let j;
  try {
    j = t ? JSON.parse(t) : null;
  } catch {
    j = t;
  }
  if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${(j && (j.error || j.message)) || t.slice(0, 120)}`);
  return j;
};
const sql = (q) =>
  execFileSync(
    PSQL,
    ["-h", "127.0.0.1", "-p", "5432", "-U", "postgres", "-d", "hf_transport_erp", "-v", "ON_ERROR_STOP=1", "-c", q],
    { encoding: "utf8", env: { ...process.env, PGPASSWORD: "hf_secure_pass_2026" } }
  );
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();

console.log(`audit scenarios -> ${BASE}\n`);

// ===========================================================================
// 1. FUEL INTEGRITY SCENARIO
// ===========================================================================
console.log("1) Fuel integrity scenario");

// drop the noisy same-timestamp demo fuel rows so the audit is clean
sql(`UPDATE fuel_transactions SET is_deleted = true WHERE is_deleted = false;`);
console.log("   cleared previous demo fuel transactions from the audit set");

const vehicles = await api("GET", "/api/operations/vehicles?limit=100");
const vlist = Array.isArray(vehicles) ? vehicles : vehicles.data;
const byNum = Object.fromEntries(vlist.map((v) => [v.vehicleNumber, v]));
const drivers = (await api("GET", "/api/operations/drivers?limit=100")).data;
const dById = Object.fromEntries(drivers.map((d) => [d.id, d]));
const trips = (await api("GET", "/api/operations/trips?limit=100"));
const tlist = Array.isArray(trips) ? trips : trips.data;
const tripForVehicle = (vid) => tlist.find((t) => t.vehicleId === vid);

// pick 3 vehicles
const clean = vlist[0];
const thief = vlist[2];
const border = vlist[1];

const stations = await api("GET", "/api/fuel/stations");
const vendors = await api("GET", "/api/fuel/vendors");
const stId = (i) => stations[i % stations.length]?.id;
const vnId = (i) => vendors[i % vendors.length]?.id;

// profile: kmPerL used to derive the odometer step from the litres drawn.
//   clean   ~3.6  (healthy)
//   border  ~3.15 (~11% thirsty — near tolerance)
//   thief   ~2.2  (~60% over — siphoning)
const PROFILES = [
  { v: clean, label: "CLEAN", kmpl: 3.6, litres: 320, fills: 8, extra: [] },
  { v: border, label: "BORDERLINE", kmpl: 3.15, litres: 300, fills: 8, extra: [] },
  {
    v: thief,
    label: "SIPHONING",
    kmpl: 2.2,
    litres: 340,
    fills: 8,
    // same thirsty economy so every leg reads ~2.2 km/L; these two just add
    // an over-capacity fill and an unlinked (no-trip) fill on top.
    extra: [
      { note: "tank over-capacity fill", litres: 640, kmpl: 2.2, daysAgo: 3 },
      { note: "fuel with no trip", litres: 300, kmpl: 2.2, noTrip: true, daysAgo: 2 },
    ],
  },
];

const seededTxns = [];
for (const p of PROFILES) {
  const vid = p.v.id;
  const trip = tripForVehicle(vid);
  let odo = p.v.currentOdometer || 150000;
  const spanDays = 22;
  const stepDays = (spanDays - 4) / (p.fills - 1); // last normal fill lands ~4 days ago
  for (let i = 0; i < p.fills; i++) {
    const litres = p.litres + ((i % 3) - 1) * 15;
    const rate = 286 + (i % 4);
    odo += Math.round(litres * p.kmpl);
    const dAgo = Math.round(spanDays - i * stepDays);
    const hour = 9 + (i % 8); // daytime
    const created = await api("POST", "/api/fuel/transactions", {
      vehicleId: vid,
      driverId: dById[trip?.driverId]?.id || trip?.driverId,
      tripId: trip?.id,
      vendorId: vnId(i),
      fuelStationId: stId(i),
      litres: String(litres),
      rate: String(rate),
      odometer: odo,
      remainingFuelPercent: 25 + (i % 6) * 10,
      paymentType: ["Card", "Credit", "Cash"][i % 3],
    });
    seededTxns.push({ id: created.id, daysAgo: dAgo, hour });
  }
  for (const e of p.extra) {
    odo += Math.round(e.litres * (e.kmpl || p.kmpl));
    const created = await api("POST", "/api/fuel/transactions", {
      vehicleId: vid,
      driverId: dById[trip?.driverId]?.id || trip?.driverId,
      tripId: e.noTrip ? undefined : trip?.id,
      vendorId: vnId(3),
      fuelStationId: stId(3),
      litres: String(e.litres),
      rate: "289",
      odometer: odo,
      remainingFuelPercent: 20,
      paymentType: "Cash",
    });
    seededTxns.push({ id: created.id, daysAgo: e.daysAgo ?? 1, hour: 3 });
  }
  console.log(`   ${p.v.vehicleNumber} [${p.label}] — ${p.fills + p.extra.length} fills, ~${p.kmpl} km/L`);
}

// back-date transaction_date so the time-based rules behave
const cases = seededTxns
  .map((t) => `WHEN id = ${t.id} THEN now() - interval '${t.daysAgo} days' + interval '${t.hour} hours'`)
  .join("\n      ");
sql(
  `UPDATE fuel_transactions
     SET transaction_date = CASE
      ${cases}
      ELSE transaction_date END
   WHERE id IN (${seededTxns.map((t) => t.id).join(",")});`
);
console.log(`   back-dated ${seededTxns.length} fills across ~16 days`);

const audit = await api("GET", "/api/fuel/integrity-audit?raise=1");
console.log("\n   --- integrity audit result ---");
console.log("   " + JSON.stringify(audit.summary));
for (const d of audit.drivers) {
  console.log(
    `   ${d.driverName.padEnd(16)} drawn ${String(d.litresDrawn).padStart(6)} L | expected ${String(
      d.expectedLitres
    ).padStart(6)} | over ${String(d.overdrawLitres).padStart(7)} (${d.overdrawPercent ?? "-"}%) | ~PKR ${String(
      d.estimatedLossValue
    ).padStart(8)} | ${d.riskLevel}`
  );
}

// ===========================================================================
// 2. PARTNERSHIP UNDER-REPORTING SCENARIO
// ===========================================================================
console.log("\n2) Partnership under-reporting scenario");

const partnerVehicle = vlist[4]; // HFD-1316-005, route Lahore->Hyderabad
const pv = partnerVehicle.id;

// give the partner truck a real recent trip + fuel history in two windows
const routes = await api("GET", "/api/operations/routes");
const route5 =
  (Array.isArray(routes) ? routes : routes.data).find((r) => r.origin === "Lahore" && r.destination === "Hyderabad") ||
  (Array.isArray(routes) ? routes : routes.data)[0];
const contractors = await api("GET", "/api/operations/contractors?limit=10");
const cId = (Array.isArray(contractors) ? contractors : contractors.data)[0].id;
const pDriver = tripForVehicle(pv)?.driverId || drivers[4].id;

// window 1: day -30..-16   window 2: day -15..0
const windowTrips = [];
for (const w of [
  { from: 30, to: 16, n: 3 },
  { from: 15, to: 1, n: 3 },
]) {
  for (let i = 0; i < w.n; i++) {
    const t = await api("POST", "/api/operations/trips/dispatch", {
      vehicleId: pv,
      driverId: pDriver,
      routeId: route5.id,
      contractorId: cId,
      departureTime: daysAgo(w.from - i * ((w.from - w.to) / w.n)),
    });
    await api("PUT", `/api/operations/trips/${t.id}/status`, { status: "Completed" });
    windowTrips.push({ id: t.id, w: w.from === 30 ? 1 : 2 });
  }
}
// back-date the trips into their windows
sql(
  windowTrips
    .map(
      (t) =>
        `UPDATE trips SET departure_time = now() - interval '${t.w === 1 ? 24 : 8} days', created_at = now() - interval '${
          t.w === 1 ? 24 : 8
        } days' WHERE id = ${t.id};`
    )
    .join("\n")
);

// fuel for the partner truck in each window (~1100 L per window)
let podo = partnerVehicle.currentOdometer || 296000;
const pFuelIds = [];
for (const w of [
  { d1: 28, d2: 17, w: 1 },
  { d1: 14, d2: 2, w: 2 },
]) {
  for (let i = 0; i < 4; i++) {
    const litres = 280 + i * 10;
    podo += Math.round(litres * 3.5);
    const created = await api("POST", "/api/fuel/transactions", {
      vehicleId: pv,
      driverId: pDriver,
      vendorId: vnId(i),
      fuelStationId: stId(i),
      litres: String(litres),
      rate: "288",
      odometer: podo,
      remainingFuelPercent: 30,
      paymentType: "Card",
    });
    const dAgo = Math.round(w.d1 - i * ((w.d1 - w.d2) / 4));
    pFuelIds.push({ id: created.id, dAgo });
  }
}
sql(
  `UPDATE fuel_transactions SET transaction_date = CASE
     ${pFuelIds.map((f) => `WHEN id = ${f.id} THEN now() - interval '${f.dAgo} days'`).join("\n     ")}
   ELSE transaction_date END WHERE id IN (${pFuelIds.map((f) => f.id).join(",")});`
);
console.log("   seeded partner-truck trips + fuel across two 2-week windows");

// partner + agreement
const partner = await api("POST", "/api/partnerships/partners", {
  name: "Rehman Cargo Services",
  cnic: "35201-9988776-5",
  phone: "+92300 4455667",
  address: "Truck Stand, Multan Road, Lahore",
});
const agreement = await api("POST", "/api/partnerships/agreements", {
  partnerId: partner.id,
  vehicleId: pv,
  agreedPrice: 5000000,
  advancePaid: 2000000,
  companySharePercent: 100,
  expenseRatioBenchmark: 55,
  notes: "Lease-to-own: 20 lakh advance, 30 lakh recovered from trip earnings.",
});
console.log(
  `   agreement ${agreement.agreementNumber}: price 50,00,000 − advance 20,00,000 = balance ${agreement.currentBalance.toLocaleString()}`
);

// Settlement A — honest: declares close to what the window's trips/fuel imply
const settA = await api("POST", `/api/partnerships/agreements/${agreement.id}/settlements`, {
  periodFrom: daysAgo(30),
  periodTo: daysAgo(16),
  grossRevenue: 1750000,
  expenses: [
    { type: "Fuel", amount: 640000, note: "3 trips diesel" },
    { type: "Toll", amount: 145000, note: "motorway + provincial" },
    { type: "Driver/Food", amount: 95000, note: "allowance + meals" },
    { type: "Misc", amount: 40000, note: "weighbridge, parking" },
  ],
  notes: "Window 1 settlement — partner declaration looks consistent.",
});
console.log(
  `   settlement ${settA.settlement.settlementNumber} [honest]  net ${settA.settlement.netEarnings.toLocaleString()} -> company ${settA.settlement.amountToCompany.toLocaleString()} | balance ${settA.agreement.balanceAfter.toLocaleString()} | flags: ${
    settA.analysis.flags.join(", ") || "none"
  }`
);

// Settlement B — skimming: under-declares revenue AND pads expenses
const settB = await api("POST", `/api/partnerships/agreements/${agreement.id}/settlements`, {
  periodFrom: daysAgo(15),
  periodTo: daysAgo(1),
  grossRevenue: 900000,
  expenses: [
    { type: "Fuel", amount: 760000, note: "claimed diesel (inflated)" },
    { type: "Repairs", amount: 220000, note: "'engine work' — no job card" },
    { type: "Toll", amount: 130000, note: "toll" },
    { type: "Misc", amount: 90000, note: "sundry" },
  ],
  notes: "Window 2 settlement — same route + fuel as window 1 but half the declared revenue.",
});
console.log(
  `   settlement ${settB.settlement.settlementNumber} [skimming] net ${settB.settlement.netEarnings.toLocaleString()} -> company ${settB.settlement.amountToCompany.toLocaleString()} | balance ${settB.agreement.balanceAfter.toLocaleString()}`
);
console.log(`   analysis: ${JSON.stringify(settB.analysis, null, 1)}`);

// full ledger + portfolio
const ledger = await api("GET", `/api/partnerships/agreements/${agreement.id}/ledger`);
const summary = await api("GET", "/api/partnerships/summary");

const report = {
  generatedAt: new Date().toISOString(),
  fuelIntegrityAudit: audit,
  partnership: { agreement, settlementHonest: settA, settlementSkimming: settB, ledger, portfolioSummary: summary },
};
writeFileSync("audit-scenarios-report.json", JSON.stringify(report, null, 2));

console.log("\n   --- partnership ledger totals ---");
console.log("   " + JSON.stringify(ledger.totals, null, 1));
console.log("\nwrote audit-scenarios-report.json");
