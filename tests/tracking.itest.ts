/**
 * Integration test for GPS tracking (simulate + live + signal-loss) - needs a
 * running Postgres (config from .env.local). Run: npm run test:itest
 * TRUNCATEs tracking + trip/vehicle/route tables - dev DB only.
 */
import "../src/config/env.ts";
import { db, schema } from "../src/db/index.ts";
import { sql, eq } from "drizzle-orm";
import { getLiveVehicles, runSimulationTick } from "../server/tracking.ts";

let fail = 0;
const chk = (n: string, c: boolean, x?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${n}`); if (!c) { fail++; if (x !== undefined) console.log("     →", x); } };

async function run() {
  await db.execute(sql`TRUNCATE vehicle_positions, tracker_devices, trips, vehicles, drivers, contractors, routes RESTART IDENTITY CASCADE`);

  const [veh] = await db.insert(schema.vehicles).values({
    vehicleNumber: "SIM-001", registrationNumber: "R", engineNumber: "E", chassisNumber: "C",
    vehicleType: "Flatbed", truckBrand: "Hino", model: "500", year: 2022, containerType: "40ft",
    payloadCapacity: 25000, currentOdometer: 1000,
  }).returning();

  const [route] = await db.insert(schema.routes).values({
    origin: "Karachi", destination: "Lahore", distance: 1200, expectedHours: 22,
    benchmarkFuel: 380, expectedToll: 6000, revenue: 240000,
    geofenceOrigin: { lat: 24.8607, lng: 67.0011, radius: 500 },
    geofenceDestination: { lat: 31.5204, lng: 74.3587, radius: 500 },
  }).returning();

  const [drv] = await db.insert(schema.drivers).values({
    driverName: "Test", cnic: "1-2-3", licenseNumber: "L1", licenseExpiry: new Date("2027-01-01"),
    mobile: "+92300", salary: 50000,
  }).returning();
  const [con] = await db.insert(schema.contractors).values({
    company: "C", contactPerson: "x", phone: "1", email: "e@e.com", ntn: "N1",
  }).returning();

  const [trip] = await db.insert(schema.trips).values({
    tripNumber: "T-1", vehicleId: veh.id, driverId: drv.id, routeId: route.id, contractorId: con.id,
    departureTime: new Date(), revenue: 240000, distance: 1200, etaHours: 22, fuelBenchmark: 380,
    expectedProfit: 60000, expectedArrival: new Date(Date.now() + 22 * 3600e3), expectedFuel: 400,
    status: "Scheduled",
  }).returning();

  console.log("\n[simulate] progresses trip + creates sim device + fixes");
  let r = await runSimulationTick(0.1);
  chk("tick 1 ok, 1 simulated", r.ok === true && "simulated" in r && r.simulated === 1, r);
  await runSimulationTick(0.1);
  r = await runSimulationTick(0.1);
  chk("tick returns In Transit-ish", r.ok === true && "results" in r && /Transit|Started/.test(r.results[0].status), (r as any).results);

  const positions = await db.select().from(schema.vehiclePositions);
  chk("≥3 positions recorded from sim", positions.length >= 3, positions.length);
  chk("all sim positions along Karachi→Lahore box", positions.every(p =>
    Number(p.lat) >= 24 && Number(p.lat) <= 32 && Number(p.lng) >= 66 && Number(p.lng) <= 75), positions.map(p => `${p.lat},${p.lng}`));

  const [devRow] = await db.select().from(schema.trackerDevices);
  chk("sim device linked to vehicle + provider simulator", devRow.vehicleId === veh.id && devRow.provider === "simulator", devRow);

  const tripNow = (await db.select().from(schema.trips).where(eq(schema.trips.id, trip.id)))[0];
  chk("trip.currentLat updated by ingest", tripNow.currentLat != null, tripNow.currentLat);
  chk("trip status advanced from Scheduled", tripNow.status !== "Scheduled", tripNow.status);

  console.log("\n[live] fresh fix => Moving, no projection");
  let live = await getLiveVehicles();
  chk("1 vehicle in live feed", live.count === 1, live.count);
  let v = live.vehicles[0];
  chk("status Moving/Idle/Stopped (not SignalLost)", ["Moving", "Idle", "Stopped"].includes(v.status), v.status);
  chk("has lastFix with small age", !!v.lastFix && v.lastFix.ageSeconds! < 120, v.lastFix?.ageSeconds);
  chk("no projected position when fresh", v.projected === null);
  chk("vehicleNumber joined", v.vehicleNumber === "SIM-001", v.vehicleNumber);

  console.log("\n[live] stale fix => SignalLost + dead-reckoned estimate");
  await db.update(schema.trackerDevices)
    .set({ lastSeenAt: new Date(Date.now() - 20 * 60_000), lastSpeed: 70, lastHeading: 90, status: "Moving" })
    .where(eq(schema.trackerDevices.id, devRow.id));
  live = await getLiveVehicles();
  v = live.vehicles[0];
  chk("status flips to SignalLost", v.status === "SignalLost", v.status);
  chk("signalLost flag set", v.signalLost === true);
  chk("projected position present", !!v.projected, v.projected);
  chk("projected ~ up to 30min @ 70km/h ≈ ≤35km", !!v.projected && v.projected.distanceMeters / 1000 <= 36, v.projected?.distanceMeters);
  chk("projected differs from last fix", !!v.projected && (v.projected.lat !== v.lastFix!.lat || v.projected.lng !== v.lastFix!.lng));

  console.log(fail === 0 ? "\nALL PASSED" : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
