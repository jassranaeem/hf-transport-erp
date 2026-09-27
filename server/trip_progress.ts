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

/** Straight-line km from a fix to the destination, or null when the destination isn't a known place. */
export function distanceToDestinationKm(destination: string, lat: number, lng: number): number | null {
  const place = findKnownPlace(destination);
  return place ? Math.round(haversineKm(lat, lng, place.lat, place.lng)) : null;
}

/** Called from GPS ingest with a fresh, real fix for a vehicle's active trip. */
export async function updateTripStatusFromGps(tripId: number, lat: number, lng: number): Promise<void> {
  const [trip] = await db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).limit(1);
  if (!trip || trip.isDeleted || trip.status === "Completed" || trip.status === "Arrived") return;

  if (trip.status === "Scheduled") {
    await db.update(schema.trips).set({ status: "In Transit", actualDepartureTime: trip.actualDepartureTime || new Date() }).where(eq(schema.trips.id, tripId));
    trip.status = "In Transit";
  }

  const [route] = await db.select().from(schema.routes).where(eq(schema.routes.id, trip.routeId)).limit(1);
  if (!route) return;
  const place = findKnownPlace(route.destination);
  if (!place) return; // no known coordinates for this destination — nothing more we can safely check

  const distanceKm = haversineKm(lat, lng, place.lat, place.lng);
  if (distanceKm <= place.radiusKm) {
    await db.update(schema.trips).set({ status: "Arrived", remainingDistance: 0 }).where(eq(schema.trips.id, tripId));
  }
}
