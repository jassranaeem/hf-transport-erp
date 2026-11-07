/**
 * Distance actually driven between two moments, from real GPS breadcrumbs
 * (vehicle_positions) — used as a fallback wherever a fuel calculation needs
 * "km since the last fill" but the truck's odometer was never entered (stored
 * as 0, which is indistinguishable from a real zero — see alerts.ts / fuel.ts).
 * Sums the great-circle distance between consecutive reported fixes, which
 * runs a little short of the real road distance on winding roads but is a
 * solid, honest number instead of guessing from an odometer nobody logged.
 */
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** null when there aren't at least 2 real fixes for this vehicle in the window. */
export async function gpsDistanceKm(vehicleId: number, from: Date, to: Date): Promise<number | null> {
  if (!vehicleId || !(from < to)) return null;
  const points = await db
    .select({ lat: schema.vehiclePositions.lat, lng: schema.vehiclePositions.lng })
    .from(schema.vehiclePositions)
    .where(and(eq(schema.vehiclePositions.vehicleId, vehicleId), gte(schema.vehiclePositions.recordedAt, from), lte(schema.vehiclePositions.recordedAt, to)))
    .orderBy(asc(schema.vehiclePositions.recordedAt));
  if (points.length < 2) return null;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineKm(+points[i - 1].lat, +points[i - 1].lng, +points[i].lat, +points[i].lng);
  }
  return +total.toFixed(1);
}
