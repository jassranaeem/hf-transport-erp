/**
 * Pure-logic tests for the new tracking + data-io helpers (no DB needed).
 * Run: npm run test:features
 */
import { haversineMeters, bearingDeg, projectPoint, deadReckon } from "../src/lib/tracking/geo.ts";
import { buildTemplateWorkbook } from "../src/lib/dataio/engine.ts";
import { getEntity } from "../src/lib/dataio/registry.ts";

let failures = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) {
    failures++;
    if (extra !== undefined) console.log("        ", extra);
  }
}
const approx = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

console.log("geo helpers");
{
  const karachi = { lat: 24.8607, lng: 67.0011 };
  const lahore = { lat: 31.5204, lng: 74.3587 };

  const d = haversineMeters(karachi, lahore) / 1000;
  ok("Karachi→Lahore ≈ 1020 km (great circle)", approx(d, 1020, 40), `${d.toFixed(0)} km`);

  const brg = bearingDeg(karachi, lahore);
  ok("bearing Karachi→Lahore is NE (30–70°)", brg > 30 && brg < 70, brg.toFixed(1));

  // project 100 km due east from a point, distance back should match
  const p = projectPoint(karachi, 90, 100_000);
  const back = haversineMeters(karachi, p) / 1000;
  ok("projectPoint 100 km east returns ~100 km away", approx(back, 100, 1), `${back.toFixed(2)} km`);
  ok("projectPoint due east increases longitude", p.lng > karachi.lng);

  // dead reckoning: 80 km/h for 15 min ≈ 20 km
  const last = { lat: 30, lng: 70, speedKmh: 80, headingDeg: 90, at: new Date(Date.now() - 15 * 60_000) };
  const dr = deadReckon(last, new Date());
  ok("deadReckon returns an estimate when moving", !!dr);
  ok("deadReckon ~20 km after 15 min @ 80 km/h", !!dr && approx(dr.distanceMeters / 1000, 20, 1), dr?.distanceMeters);

  // stationary vehicle => no projection
  const still = deadReckon({ ...last, speedKmh: 0 }, new Date());
  ok("deadReckon returns null when speed = 0", still === null);

  // very old fix => capped at the 45 min window (80 km/h * 0.75 h = 60 km)
  const old = deadReckon(
    { lat: 30, lng: 70, speedKmh: 80, headingDeg: 90, at: new Date(Date.now() - 5 * 3600_000) },
    new Date()
  );
  ok("deadReckon caps long gaps", !!old && old.capped && old.distanceMeters / 1000 <= 61, old?.distanceMeters);
  ok("deadReckon reports method + uncertainty", !!old && old.method === "heading" && old.uncertaintyMeters > 0);

  // route-aware projection: last fix near a straight N-S path => estimate stays on it
  const path = [{ lat: 30, lng: 70 }, { lat: 31, lng: 70 }];
  const routed = deadReckon(
    { lat: 30.1, lng: 70.02, speedKmh: 60, headingDeg: 10, at: new Date(Date.now() - 10 * 60_000) },
    new Date(),
    { path }
  );
  ok("deadReckon uses route when a path is given", !!routed && routed.method === "route");
  ok("route estimate hugs the corridor (lng ~= 70)", !!routed && Math.abs(routed.lng - 70) < 0.05, routed?.lng);
}

console.log("data-io template");
{
  const v = getEntity("vehicles");
  ok("registry has 'vehicles'", !!v);
  const wb = buildTemplateWorkbook(v!);
  const data = wb.getWorksheet("Data");
  const info = wb.getWorksheet("Instructions");
  ok("template has Data + Instructions sheets", !!data && !!info);
  const headers: string[] = [];
  data!.getRow(1).eachCell((c) => headers.push(String(c.value)));
  ok("Data header includes 'Vehicle Number'", headers.includes("Vehicle Number"));
  ok("every non-readonly field has a header column", headers.length === v!.fields.filter((f) => !f.readonly).length);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
