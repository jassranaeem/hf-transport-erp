/**
 * Keeps a trip's status honest against what the truck's own GPS is actually doing,
 * instead of only changing when someone remembers to click the status dropdown.
 *
 *  - Scheduled -> In Transit the moment a real GPS fix arrives for that truck after
 *    departure (the truck is verifiably moving; no more waiting for someone to flip it).
 *  - In Transit -> Arrived once the fix falls within a known place's radius of the
 *    route's destination TEXT (matched by name, e.g. "Islamabad", "Karachi").
 *
 * Arrival detection only works for destinations in KNOWN_PLACES below (a short list of
 * well-known city centres — safe, publicly known coordinates). A destination that isn't
 * one of these (a specific border post, a customer's yard, a colloquial name like
 * "250 border") has no coordinates on file, so it is left alone rather than guessed —
 * add it to KNOWN_PLACES (or set the route's own geofenceDestination) once its real
 * coordinates are known, and arrival detection starts working for it immediately.
 * Never touches "Completed" — that stays a deliberate action (it raises the invoice).
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";

const KNOWN_PLACES: { name: string; lat: number; lng: number; radiusKm: number }[] = [
  { name: "quetta", lat: 30.1798, lng: 66.975, radiusKm: 15 },
  { name: "karachi", lat: 24.8607, lng: 67.0011, radiusKm: 20 },
  { name: "islamabad", lat: 33.6844, lng: 73.0479, radiusKm: 15 },
  { name: "rawalpindi", lat: 33.5651, lng: 73.0169, radiusKm: 15 },
  { name: "lahore", lat: 31.5204, lng: 74.3587, radiusKm: 18 },
  { name: "peshawar", lat: 34.0151, lng: 71.5249, radiusKm: 15 },
  { name: "hyderabad", lat: 25.396, lng: 68.3578, radiusKm: 15 },
  { name: "multan", lat: 30.1575, lng: 71.5249, radiusKm: 15 },
  { name: "faisalabad", lat: 31.4504, lng: 73.135, radiusKm: 15 },
  { name: "sukkur", lat: 27.7052, lng: 68.8574, radiusKm: 12 },
];

function normPlace(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

function findKnownPlace(destination: string) {
  const n = normPlace(destination);
  return KNOWN_PLACES.find((p) => n.includes(p.name)) || null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const normPlate = (s: string | null | undefined) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Which of `plates` (already normalized) does a tracker belong to? A tracker's name comes from
 * the GPS provider and is often more than the bare plate ("TLD 918 Bhagwan", "HINO TLD-918"),
 * and it may not be linked to any vehicle row at all. Exact match first, then the longest plate
 * contained in the name — plates shorter than 5 characters are never matched by containment
 * (a bare "918" would hit too many things), and a digit right next to the match rules it out
 * ("TLD 9180" is not "TLD 918").
 */
export function matchPlate(nameKey: string, plates: Iterable<string>): string | null {
  if (!nameKey) return null;
  const isDigit = (c: string | undefined) => !!c && c >= "0" && c <= "9";
  let best: string | null = null;
  for (const p of plates) {
    if (!p) continue;
    if (p === nameKey) return p;
    if (p.length < 5 || (best && p.length <= best.length)) continue;
    for (let i = nameKey.indexOf(p); i !== -1; i = nameKey.indexOf(p, i + 1)) {
      if (!isDigit(nameKey[i - 1]) && !isDigit(nameKey[i + p.length])) {
        best = p;
        break;
      }
    }
  }
  return best;
}

/** Straight-line km from a fix to the destination, or null when the destination isn't a known place. */
export function distanceToDestinationKm(destination: string, lat: number, lng: number): number | null {
  const place = findKnownPlace(destination);
  return place ? Math.round(haversineKm(lat, lng, place.lat, place.lng)) : null;
}

/**
 * Called from GPS ingest (and right after a trip is created) with a real fix for the trip's truck.
 * Returns the status the trip ended up with.
 *
 * Scheduled -> In Transit only when the truck is actually moving, or is outside its origin city:
 * a truck parked in the Quetta yard with tomorrow's trip booked must stay Scheduled.
 */
export async function updateTripStatusFromGps(tripId: number, lat: number, lng: number, speedKmh?: number | null): Promise<string | null> {
  const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).limit(1);
  if (!trip || trip.isDeleted) return null;
  if (trip.status === "Completed" || trip.status === "Arrived") return trip.status;

  const [route] = await db.select().from(schema.routes).where(eq(schema.routes.id, trip.routeId)).limit(1);
  const dest = route ? findKnownPlace(route.destination) : null;
  const atDestination = !!dest && haversineKm(lat, lng, dest.lat, dest.lng) <= dest.radiusKm;
  // a trip booked for later whose truck merely happens to be parked in the destination city hasn't arrived
  const departed = trip.status !== "Scheduled" || (trip.departureTime && new Date(trip.departureTime).getTime() <= Date.now());

  if (atDestination && departed) {
    await db
      .update(schema.trips)
      .set({ status: "Arrived", remainingDistance: 0, actualDepartureTime: trip.actualDepartureTime || trip.departureTime || new Date() })
      .where(eq(schema.trips.id, tripId));
    return "Arrived";
  }

  if (trip.status === "Scheduled") {
    const origin = route ? findKnownPlace(route.origin) : null;
    const moving = (speedKmh ?? 0) > 5;
    const leftOrigin = !!origin && haversineKm(lat, lng, origin.lat, origin.lng) > origin.radiusKm;
    if (moving || leftOrigin) {
      await db.update(schema.trips).set({ status: "In Transit", actualDepartureTime: trip.actualDepartureTime || new Date() }).where(eq(schema.trips.id, tripId));
      return "In Transit";
    }
  }
  return trip.status;
}

/** A fix older than this doesn't say where the truck is now, so it can't change a status. */
const FRESH_FIX_MS = 60 * 60_000;

/**
 * Right after a trip is created: find the truck's tracker (by plate — linked vehicle row, a
 * near-duplicate row, or just the tracker's own name) and apply its latest fix straight away,
 * instead of waiting for the next GPS ping. Returns what was found, for the UI to tell the user.
 */
export async function applyLatestGpsToTrip(tripId: number) {
  const [row] = await db
    .select({ trip: schema.trips, vehicleNumber: schema.vehicles.vehicleNumber, destination: schema.routes.destination })
    .from(schema.trips)
    .innerJoin(schema.vehicles, eq(schema.trips.vehicleId, schema.vehicles.id))
    .innerJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
    .where(eq(schema.trips.id, tripId))
    .limit(1);
  if (!row) return null;
  const plate = normPlate(row.vehicleNumber);
  if (!plate) return null;

  const trackers = await db
    .select({ tracker: schema.trackerDevices, vehicleNumber: schema.vehicles.vehicleNumber })
    .from(schema.trackerDevices)
    .leftJoin(schema.vehicles, eq(schema.trackerDevices.vehicleId, schema.vehicles.id))
    .where(eq(schema.trackerDevices.isDeleted, false))
    .orderBy(desc(schema.trackerDevices.lastSeenAt));
  const hit = trackers.find(
    (t) => t.tracker.lastLat != null && t.tracker.lastLng != null && matchPlate(normPlate(t.vehicleNumber || t.tracker.label || ""), [plate]) === plate,
  );
  if (!hit) return { found: false as const, status: row.trip.status };

  const d = hit.tracker;
  const lat = Number(d.lastLat);
  const lng = Number(d.lastLng);
  const fresh = !!d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() <= FRESH_FIX_MS;
  await db
    .update(schema.trips)
    .set({ currentLat: String(lat), currentLng: String(lng), currentSpeed: d.lastSpeed ?? 0, ...(d.lastAddress ? { currentAddress: d.lastAddress } : {}) })
    .where(eq(schema.trips.id, tripId));
  let status: string | null = row.trip.status;
  if (fresh) {
    // created as "In Transit" only because its departure time is now — but the truck is standing
    // still inside its origin city, so it hasn't left yet. The next GPS ping moves it on once it does.
    const [route] = await db.select().from(schema.routes).where(eq(schema.routes.id, row.trip.routeId)).limit(1);
    const origin = route ? findKnownPlace(route.origin) : null;
    const parkedAtOrigin = !!origin && (d.lastSpeed ?? 0) <= 5 && haversineKm(lat, lng, origin.lat, origin.lng) <= origin.radiusKm;
    if (row.trip.status === "In Transit" && parkedAtOrigin) {
      await db.update(schema.trips).set({ status: "Scheduled", actualDepartureTime: null }).where(eq(schema.trips.id, tripId));
      status = "Scheduled";
    } else {
      status = await updateTripStatusFromGps(tripId, lat, lng, d.lastSpeed);
    }
  }
  return {
    found: true as const,
    fresh,
    status,
    lastSeenAt: d.lastSeenAt,
    speed: d.lastSpeed,
    address: d.lastAddress,
    kmToDestination: distanceToDestinationKm(row.destination, lat, lng),
  };
}
