/**
 * Pure-logic tests for the new tracking + data-io helpers (no DB needed).
 * Run: npm run test:features
 */
import { haversineMeters, bearingDeg, projectPoint, deadReckon } from "../src/lib/tracking/geo.ts";
import { buildTemplateWorkbook } from "../src/lib/dataio/engine.ts";
import { getEntity } from "../src/lib/dataio/registry.ts";
import { amountIn, dateIn, readByRules } from "../server/ai/context.ts";
import { parseJsonLoose } from "../server/ai/llm.ts";
import { nextDue } from "../server/recurring.ts";
import { depreciationSchedule } from "../server/business_misc.ts";
import { waNumber } from "../src/lib/share.ts";

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

console.log("AI Accountant — reading without AI");
{
  ok("25 hazar = 25,000", amountIn("diesel 25 hazar") === 25000);
  ok("1.5 lakh = 150,000", amountIn("1.5 lakh mile") === 150000);
  ok("2,50,000 (Pakistani commas) = 250,000", amountIn("2,50,000") === 250000);
  ok("a year is not an amount", amountIn("2026 ka kiraya 5000") === 5000);
  ok("aaj = today", dateIn("aaj diye", "2026-10-04") === "2026-10-04");
  ok("kal = yesterday", dateIn("kal mile", "2026-10-04") === "2026-10-03");
  ok("03/10/2026 is day first", dateIn("03/10/2026", "2026-10-04") === "2026-10-03");
  ok("3.5 lakh is money, not a date", dateIn("3.5 lakh received", "2026-10-04") === null);
  const dir: any = { trucks: [{ id: 1, plate: "TLE730", registration: "TLE-730" }], parties: [{ id: 5, name: "Haji Akbar Goods", norm: "akbar goods" }], booksStart: "2025-07-01", lockedThrough: null, today: "2026-10-04" };
  const [a1] = readByRules(dir, "TLE-730 ko 500 toll diya");
  ok("plate digits are not the amount", a1?.amount === 500, a1);
  ok("toll on a truck = Out, kind toll", a1?.direction === "Out" && a1?.kind === "toll" && a1?.plate === "TLE-730", a1);
  const [a2] = readByRules(dir, "akbar goods se 2 lakh online mile kal");
  ok("money from a party = In, online, matched by name", a2?.direction === "In" && a2?.method === "Online" && a2?.party === "Haji Akbar Goods" && a2?.amount === 200000, a2);
  ok("one line per entry", readByRules(dir, "TLE-730 diesel 1000 diye\nghar ke liye 2000 kharcha").length === 2);
  ok("AI reply with fences and words is parsed", parseJsonLoose('Sure:\n```json\n{"rows":[{"d":"a}b"}]}\n```').rows[0].d === "a}b");
}

console.log("business tools");
{
  ok("monthly on the 31st stays at the month's end", nextDue("2026-01-31", "monthly", 31) === "2026-02-28" && nextDue("2026-02-28", "monthly", 31) === "2026-03-31");
  ok("weekly is 7 days on", nextDue("2026-10-06", "weekly") === "2026-10-13");
  ok("quarterly and yearly", nextDue("2026-10-06", "quarterly", 6) === "2027-01-06" && nextDue("2026-10-06", "yearly", 6) === "2027-10-06");
  const sch = depreciationSchedule({ cost: 10000000, method: "reducing", ratePercent: 15, usefulLifeYears: null, salvage: 0, start: "2024-01-15" }, new Date("2026-10-06T12:00:00"));
  ok("first year charged for the months owned (Jan–Jun = 6)", sch[0]?.fy === "2023-24" && sch[0]?.charge === 750000, sch[0]);
  ok("reducing balance on the written-down value", sch[1]?.charge === 1387500 && sch.length === 4, sch);
  const sl = depreciationSchedule({ cost: 1200000, method: "straight", ratePercent: null, usefulLifeYears: 4, salvage: 0, start: "2025-07-01" }, new Date("2026-10-06T12:00:00"));
  ok("straight line = cost / years", sl[0]?.charge === 300000 && sl[1]?.charge === 300000, sl);
  ok("phone 0300-1234567 → 923001234567", waNumber("0300-1234567") === "923001234567" && waNumber("+92 300 1234567") === "923001234567" && waNumber("12") === null);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
