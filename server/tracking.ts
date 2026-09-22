/**
 * Live GPS / fleet tracking API.
 *
 * Design goals (per requirement: "container ke location se kabhi door na hon,
 * signal drop ho jaye tab bhi"):
 *   - Hardware trackers push positions to POST /ingest (or Traccar -> /traccar).
 *   - A tracker that loses GSM signal buffers points on-device and dumps them on
 *     reconnect; we accept backdated points and de-duplicate on (device, time),
 *     so no history is ever lost.
 *   - Every position is stored append-only in vehicle_positions.
 *   - GET /live always returns the LAST CONFIRMED fix plus, when the signal is
 *     stale, a dead-reckoned ESTIMATED position and "last seen N min ago", so
 *     the map never just freezes silently.
 *   - A 60s sweep flips stale devices to SignalLost and emits socket alerts.
 *   - Works on any device: it's a normal web API + socket, the map is a
 *     responsive React page, and the app ships a PWA manifest + service worker.
 *
 * No Google Maps key required - the frontend uses Leaflet + OpenStreetMap.
 */
import { Router, Response, Request } from "express";
import { randomBytes } from "crypto";
import { and, eq, ne, gte, lte, desc, asc, sql, inArray } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { SocketServer } from "../src/sockets/socket.ts";
import { deadReckon, num } from "../src/lib/tracking/geo.ts";

const router = Router();

const STALE_MINUTES = Number(process.env.TRACKING_STALE_MINUTES) || 10;
const GLOBAL_INGEST_TOKEN = process.env.TRACKING_INGEST_TOKEN || "";
const TRACCAR_TOKEN = process.env.TRACKING_TRACCAR_TOKEN || GLOBAL_INGEST_TOKEN;
const AUTO_REGISTER = process.env.TRACKING_AUTO_REGISTER === "true";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type DeviceRow = typeof schema.trackerDevices.$inferSelect;

function newToken() {
  return randomBytes(24).toString("hex");
}

interface RawPoint {
  lat: unknown;
  lng: unknown;
  speed?: unknown; // km/h
  heading?: unknown; // deg
  altitude?: unknown;
  accuracy?: unknown;
  satellites?: unknown;
  ignition?: unknown;
  battery?: unknown;
  timestamp?: unknown; // ISO string or epoch ms/sec
  source?: string;
}

interface CleanPoint {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  altitude: number | null;
  accuracy: number | null;
  satellites: number | null;
  ignition: boolean | null;
  battery: number | null;
  recordedAt: Date;
  source: string;
}

function parseTimestamp(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return new Date();
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    // seconds vs milliseconds
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function cleanPoint(p: RawPoint): { point?: CleanPoint; error?: string } {
  const lat = num(p.lat);
  const lng = num(p.lng);
  if (lat === null || lng === null) return { error: "lat/lng missing or not numeric" };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { error: "lat/lng out of range" };

  const recordedAt = parseTimestamp(p.timestamp);
  if (!recordedAt) return { error: "invalid timestamp" };
  // reject points more than a day in the future (bad device clock)
  if (recordedAt.getTime() - Date.now() > 86_400_000) return { error: "timestamp is in the future" };

  const speed = Math.max(0, Math.round(num(p.speed) ?? 0));
  let heading = Math.round(num(p.heading) ?? 0);
  heading = ((heading % 360) + 360) % 360;

  const batteryRaw = num(p.battery);

  return {
    point: {
      lat,
      lng,
      speed,
      heading,
      altitude: num(p.altitude),
      accuracy: num(p.accuracy),
      satellites: num(p.satellites),
      ignition:
        p.ignition === undefined || p.ignition === null
          ? null
          : p.ignition === true || p.ignition === "true" || p.ignition === 1 || p.ignition === "1",
      battery: batteryRaw === null ? null : Math.max(0, Math.min(100, Math.round(batteryRaw))),
      recordedAt,
      source: p.source || "live",
    },
  };
}

async function resolveDevice(
  imei: string,
  token: string | undefined,
  trusted = false
): Promise<{ device?: DeviceRow; error?: string; status?: number }> {
  if (!imei) return { error: "imei is required", status: 400 };

  const [existing] = await db
    .select()
    .from(schema.trackerDevices)
    .where(eq(schema.trackerDevices.imei, String(imei)))
    .limit(1);

  if (existing) {
    if (existing.isDeleted) return { error: "device disabled", status: 403 };
    const ok =
      trusted ||
      (token && token === existing.ingestToken) ||
      (GLOBAL_INGEST_TOKEN && token === GLOBAL_INGEST_TOKEN);
    if (!ok) return { error: "bad device token", status: 401 };
    return { device: existing };
  }

  if (!AUTO_REGISTER) {
    return { error: "unknown imei (set TRACKING_AUTO_REGISTER=true to accept new devices)", status: 404 };
  }
  if (!trusted && GLOBAL_INGEST_TOKEN && token !== GLOBAL_INGEST_TOKEN) {
    return { error: "bad token for auto-registration", status: 401 };
  }

  const [created] = await db
    .insert(schema.trackerDevices)
    .values({
      imei: String(imei),
      label: `Auto ${String(imei).slice(-6)}`,
      ingestToken: token || newToken(),
      provider: "generic",
    })
    .returning();
  return { device: created };
}

/** Newest-first active trip for a vehicle. */
async function activeTripIdForVehicle(vehicleId: number | null): Promise<number | null> {
  if (!vehicleId) return null;
  const [t] = await db
    .select({ id: schema.trips.id })
    .from(schema.trips)
    .where(
      and(
        eq(schema.trips.vehicleId, vehicleId),
        eq(schema.trips.isDeleted, false),
        ne(schema.trips.status, "Completed")
      )
    )
    .orderBy(desc(schema.trips.departureTime))
    .limit(1);
  return t?.id ?? null;
}

function movementStatus(speed: number, ignition: boolean | null): string {
  if (speed > 5) return "Moving";
  if (ignition) return "Idle";
  return "Stopped";
}

/**
 * Core ingestion path shared by /ingest, /traccar and the simulator.
 */
async function ingest(device: DeviceRow, rawPoints: RawPoint[]) {
  const clean: CleanPoint[] = [];
  const rejected: { index: number; error: string }[] = [];
  rawPoints.forEach((rp, i) => {
    const { point, error } = cleanPoint(rp);
    if (error) rejected.push({ index: i, error });
    else clean.push(point!);
  });

  if (clean.length === 0) {
    return { accepted: 0, duplicates: 0, rejected };
  }

  clean.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  const tripId = await activeTripIdForVehicle(device.vehicleId);

  const rows = clean.map((p) => ({
    deviceId: device.id,
    vehicleId: device.vehicleId,
    tripId,
    lat: String(p.lat),
    lng: String(p.lng),
    speed: p.speed,
    heading: p.heading,
    altitude: p.altitude,
    accuracy: p.accuracy,
    satellites: p.satellites,
    ignition: p.ignition,
    source: p.source,
    recordedAt: p.recordedAt,
  }));

  const insertedRows = await db
    .insert(schema.vehiclePositions)
    .values(rows)
    .onConflictDoNothing({
      target: [schema.vehiclePositions.deviceId, schema.vehiclePositions.recordedAt],
    })
    .returning({ id: schema.vehiclePositions.id });

  const accepted = insertedRows.length;
  const duplicates = rows.length - accepted;

  // Update the device's denormalised "last confirmed fix" from the newest point,
  // but only if it is actually newer than what we already have.
  const newest = clean[clean.length - 1];
  const prevSeen = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0;
  const wasDark = device.status === "SignalLost";
  const darkForMs = prevSeen ? Date.now() - prevSeen : 0;
  if (newest.recordedAt.getTime() >= prevSeen) {
    const status = movementStatus(newest.speed, newest.ignition);
    await db
      .update(schema.trackerDevices)
      .set({
        lastSeenAt: newest.recordedAt,
        lastLat: String(newest.lat),
        lastLng: String(newest.lng),
        lastSpeed: newest.speed,
        lastHeading: newest.heading,
        batteryPercent: newest.battery ?? device.batteryPercent ?? null,
        status,
        updatedAt: new Date(),
      })
      .where(eq(schema.trackerDevices.id, device.id));

    if (device.vehicleId && tripId) {
      await db
        .update(schema.trips)
        .set({
          currentLat: String(newest.lat),
          currentLng: String(newest.lng),
          currentSpeed: newest.speed,
          updatedAt: new Date(),
        })
        .where(eq(schema.trips.id, tripId));
    }

    SocketServer.emit("tracking:update", {
      deviceId: device.id,
      imei: device.imei,
      vehicleId: device.vehicleId,
      tripId,
      lat: newest.lat,
      lng: newest.lng,
      speed: newest.speed,
      heading: newest.heading,
      status,
      battery: newest.battery,
      recordedAt: newest.recordedAt.toISOString(),
      source: newest.source,
    });

    // signal came back after being dark
    if (wasDark) {
      SocketServer.emit("tracking:signal_restored", {
        deviceId: device.id,
        imei: device.imei,
        vehicleId: device.vehicleId,
        outageSeconds: Math.round(darkForMs / 1000),
        bufferedPoints: clean.filter((p) => p.recordedAt.getTime() < Date.now() - 60_000).length,
        at: newest.recordedAt.toISOString(),
      });
    }
  }

  return { accepted, duplicates, rejected };
}

// ===========================================================================
// GPSWOX PROVIDER POLLER  (Eagle Tracker / eagletracker.com.pk and any GPSWOX)
// ---------------------------------------------------------------------------
// The customer's trackers are on a GPSWOX platform. We log in with their panel
// credentials, pull /api/get_devices every minute, match each device to a
// vehicle by number, and feed the fix through the same ingest() path — so the
// live map, history, signal-loss and dead-reckoning all work with real data.
// Config lives in system_settings key "gps_provider" (set from Console → GPS
// Provider), so no redeploy is needed.
// ===========================================================================
export interface GpsProviderConfig {
  enabled: boolean;
  kind: "gpswox";
  url: string; // e.g. https://eagletracker.com.pk
  username: string;
  password: string;
  label: string;
}
const GPS_SETTINGS_KEY = "gps_provider";
const GPS_ENV_DEFAULT: GpsProviderConfig = {
  enabled: process.env.GPS_PROVIDER_ENABLED === "true",
  kind: "gpswox",
  url: (process.env.GPS_PROVIDER_URL || "").replace(/\/$/, ""),
  username: process.env.GPS_PROVIDER_USER || "",
  password: process.env.GPS_PROVIDER_PASS || "",
  label: process.env.GPS_PROVIDER_LABEL || "",
};
let gpsCfgCache: { at: number; cfg: GpsProviderConfig } | null = null;
let gpswoxHash: { hash: string; at: number } | null = null;
let lastGpsSync: { at: string; devices: number; matched: number; accepted: number; error?: string } | null = null;

export async function loadGpsProviderConfig(force = false): Promise<GpsProviderConfig> {
  if (!force && gpsCfgCache && Date.now() - gpsCfgCache.at < 15_000) return gpsCfgCache.cfg;
  let cfg: GpsProviderConfig = { ...GPS_ENV_DEFAULT };
  try {
    const [row] = await db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, GPS_SETTINGS_KEY))
      .limit(1);
    if (row?.value && typeof row.value === "object") cfg = { ...cfg, ...(row.value as Partial<GpsProviderConfig>) };
  } catch {
    /* table not ready */
  }
  cfg.url = (cfg.url || "").replace(/\/$/, "");
  gpsCfgCache = { at: Date.now(), cfg };
  return cfg;
}

export async function saveGpsProviderConfig(patch: Partial<GpsProviderConfig>, userId?: number) {
  const current = await loadGpsProviderConfig(true);
  const next = { ...current, ...patch };
  next.url = (next.url || "").replace(/\/$/, "");
  const [existing] = await db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, GPS_SETTINGS_KEY))
    .limit(1);
  if (existing) {
    await db.update(schema.systemSettings).set({ value: next, updatedAt: new Date(), updatedBy: userId }).where(eq(schema.systemSettings.key, GPS_SETTINGS_KEY));
  } else {
    await db.insert(schema.systemSettings).values({ key: GPS_SETTINGS_KEY, value: next, createdBy: userId });
  }
  gpsCfgCache = { at: Date.now(), cfg: next };
  gpswoxHash = null; // creds may have changed
  return next;
}

async function gpswoxLogin(cfg: GpsProviderConfig): Promise<string> {
  if (gpswoxHash && Date.now() - gpswoxHash.at < 40 * 60_000) return gpswoxHash.hash;
  const body = new URLSearchParams({ email: cfg.username, password: cfg.password });
  const res = await fetch(`${cfg.url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.status !== 1 || !json.user_api_hash) {
    throw new Error(`GPSWOX login failed (HTTP ${res.status}): ${json.message || JSON.stringify(json).slice(0, 120)}`);
  }
  gpswoxHash = { hash: json.user_api_hash, at: Date.now() };
  return json.user_api_hash;
}

const normPlate = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function gpswoxUpsertDevice(gw: any, vehById: Map<string, number>): Promise<DeviceRow> {
  const imei = `EAGLE-${gw.id}`;
  const [existing] = await db.select().from(schema.trackerDevices).where(eq(schema.trackerDevices.imei, imei)).limit(1);
  const vehicleId = vehById.get(normPlate(gw.name)) ?? null;
  if (existing) {
    if (vehicleId && existing.vehicleId !== vehicleId) {
      await db.update(schema.trackerDevices).set({ vehicleId, label: gw.name, updatedAt: new Date() }).where(eq(schema.trackerDevices.id, existing.id));
      return { ...existing, vehicleId, label: gw.name };
    }
    return existing;
  }
  const [created] = await db
    .insert(schema.trackerDevices)
    .values({ imei, label: gw.name, provider: "eagletracker", ingestToken: newToken(), vehicleId })
    .returning();
  return created;
}

/** Pull every device once and ingest its current fix. */
export async function syncGpsProvider(): Promise<typeof lastGpsSync> {
  const cfg = await loadGpsProviderConfig();
  if (!cfg.enabled || !cfg.url || !cfg.username) {
    lastGpsSync = { at: new Date().toISOString(), devices: 0, matched: 0, accepted: 0, error: "not configured" };
    return lastGpsSync;
  }
  try {
    const hash = await gpswoxLogin(cfg);
    const res = await fetch(`${cfg.url}/api/get_devices?lang=en&user_api_hash=${encodeURIComponent(hash)}`);
    if (res.status === 401) {
      gpswoxHash = null;
      throw new Error("session expired");
    }
    const groups: any[] = await res.json().catch(() => []);
    const devices: any[] = Array.isArray(groups) ? groups.flatMap((g) => g.items || []) : [];

    const veh = await db
      .select({ id: schema.vehicles.id, vn: schema.vehicles.vehicleNumber })
      .from(schema.vehicles)
      .where(eq(schema.vehicles.isDeleted, false));
    const vehById = new Map(veh.map((v) => [normPlate(v.vn), v.id]));

    let matched = 0;
    let accepted = 0;
    for (const gw of devices) {
      if (gw.lat == null || gw.lng == null) continue;
      const device = await gpswoxUpsertDevice(gw, vehById);
      if (device.vehicleId) matched++;
      const accSensor = (gw.sensors || []).find((s: any) => s.type === "acc");
      const satSensor = (gw.sensors || []).find((s: any) => s.type === "satellites" && /satellite/i.test(s.name || ""));
      const point: RawPoint = {
        lat: gw.lat,
        lng: gw.lng,
        speed: gw.speed,
        heading: gw.course,
        altitude: gw.altitude,
        satellites: satSensor ? Number(satSensor.val) : null,
        ignition: accSensor ? !!accSensor.val : null,
        battery: null,
        timestamp: gw.timestamp ? Number(gw.timestamp) : gw.time,
        source: "live",
      };
      try {
        const r = await ingest(device, [point]);
        accepted += r.accepted;
        if (gw.addr) {
          await db
            .update(schema.trackerDevices)
            .set({ lastAddress: String(gw.addr).slice(0, 400) })
            .where(eq(schema.trackerDevices.id, device.id));
        }
      } catch (e: any) {
        console.warn(`[gpswox] ingest ${gw.name} failed:`, e.message);
      }
    }
    lastGpsSync = { at: new Date().toISOString(), devices: devices.length, matched, accepted };
    return lastGpsSync;
  } catch (e: any) {
    lastGpsSync = { at: new Date().toISOString(), devices: 0, matched: 0, accepted: 0, error: String(e.message || e).slice(0, 200) };
    console.warn("[gpswox] sync failed:", lastGpsSync.error);
    return lastGpsSync;
  }
}

export function getLastGpsSync() {
  return lastGpsSync;
}

// ---------------------------------------------------------------------------
// INGESTION ENDPOINTS  (device-token authenticated, no user session)
// ---------------------------------------------------------------------------

/**
 * POST /api/tracking/ingest
 * body: { imei, token?, position? , positions?: [...] }
 * token may also be sent as header `x-device-token` or query `?token=`.
 */
router.post("/ingest", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const imei = String(body.imei || body.deviceId || req.query.imei || "");
    const token =
      (req.headers["x-device-token"] as string) ||
      (req.query.token as string) ||
      body.token;

    const { device, error, status } = await resolveDevice(imei, token);
    if (!device) return res.status(status || 400).json({ error });

    const points: RawPoint[] = Array.isArray(body.positions)
      ? body.positions
      : body.position
      ? [body.position]
      : [body];

    // if the payload was the bare point, strip control fields
    const normalised = points.map((p: any) => ({
      lat: p.lat ?? p.latitude,
      lng: p.lng ?? p.lon ?? p.longitude,
      speed: p.speed,
      heading: p.heading ?? p.course ?? p.bearing,
      altitude: p.altitude ?? p.alt,
      accuracy: p.accuracy ?? p.hdop,
      satellites: p.satellites ?? p.sats,
      ignition: p.ignition,
      battery: p.battery ?? p.batteryLevel,
      timestamp: p.timestamp ?? p.time ?? p.deviceTime ?? p.fixTime,
      source: p.source || (Array.isArray(body.positions) && body.positions.length > 1 ? "buffered" : "live"),
    }));

    const result = await ingest(device, normalised);
    res.json({ ok: true, device: { id: device.id, imei: device.imei }, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "ingest failed" });
  }
});

/**
 * POST /api/tracking/traccar?token=...
 * Accepts Traccar's "Forward" webhook payload (Server -> Settings -> Forward).
 */
router.post("/traccar", async (req: Request, res: Response) => {
  try {
    if (TRACCAR_TOKEN && req.query.token !== TRACCAR_TOKEN) {
      return res.status(401).json({ error: "bad token" });
    }
    const { device, position } = req.body || {};
    const imei = String(device?.uniqueId || position?.deviceId || "");
    // the ?token= gate above already authenticated this request
    const { device: dev, error, status } = await resolveDevice(imei, TRACCAR_TOKEN || undefined, true);
    if (!dev) return res.status(status || 400).json({ error });
    if (!position) return res.status(400).json({ error: "no position in payload" });

    const attr = position.attributes || {};
    const point: RawPoint = {
      lat: position.latitude,
      lng: position.longitude,
      speed: position.speed != null ? Number(position.speed) * 1.852 : 0, // Traccar knots -> km/h
      heading: position.course,
      altitude: position.altitude,
      accuracy: attr.accuracy,
      satellites: attr.sat,
      ignition: attr.ignition,
      battery: attr.batteryLevel ?? attr.battery,
      timestamp: position.deviceTime || position.fixTime || position.serverTime,
      source: "live",
    };
    const result = await ingest(dev, [point]);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "traccar ingest failed" });
  }
});

// ---------------------------------------------------------------------------
// READ ENDPOINTS  (session-authenticated)
// ---------------------------------------------------------------------------

router.use(requireAuth, requireApproved);

type LL = { lat: number; lng: number };

function isLL(v: unknown): v is LL {
  return !!v && typeof v === "object" && Number.isFinite((v as any).lat) && Number.isFinite((v as any).lng);
}

/** Build a coarse route path for a trip from its polyline or origin/destination geofences. */
function routePathFor(t: {
  polyline: unknown;
  geoOrigin: unknown;
  geoDest: unknown;
}): LL[] | null {
  // 1. explicit coordinate array in mapPolyline: "[[lat,lng],...]" or [{lat,lng}]
  if (typeof t.polyline === "string" && t.polyline.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(t.polyline);
      if (Array.isArray(parsed)) {
        const pts: LL[] = parsed
          .map((p: any) =>
            Array.isArray(p) && p.length >= 2
              ? { lat: Number(p[0]), lng: Number(p[1]) }
              : isLL(p)
              ? { lat: Number(p.lat), lng: Number(p.lng) }
              : null
          )
          .filter((p): p is LL => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
        if (pts.length >= 2) return pts;
      }
    } catch {
      /* not JSON - ignore */
    }
  }
  // 2. straight line origin -> destination from geofences
  if (isLL(t.geoOrigin) && isLL(t.geoDest)) {
    return [
      { lat: Number((t.geoOrigin as LL).lat), lng: Number((t.geoOrigin as LL).lng) },
      { lat: Number((t.geoDest as LL).lat), lng: Number((t.geoDest as LL).lng) },
    ];
  }
  return null;
}

/**
 * Latest state of every tracked vehicle, with signal-loss handling.
 * Exported so it can be unit-tested without the HTTP/auth layer.
 */
export async function getLiveVehicles() {
  const now = Date.now();
  const staleMs = STALE_MINUTES * 60_000;

  const devices = await db
    .select({
      deviceId: schema.trackerDevices.id,
      imei: schema.trackerDevices.imei,
      label: schema.trackerDevices.label,
      provider: schema.trackerDevices.provider,
      vehicleId: schema.trackerDevices.vehicleId,
      vehicleNumber: schema.vehicles.vehicleNumber,
      vehicleType: schema.vehicles.vehicleType,
      lastSeenAt: schema.trackerDevices.lastSeenAt,
      lastLat: schema.trackerDevices.lastLat,
      lastLng: schema.trackerDevices.lastLng,
      lastSpeed: schema.trackerDevices.lastSpeed,
      lastHeading: schema.trackerDevices.lastHeading,
      lastAddress: schema.trackerDevices.lastAddress,
      battery: schema.trackerDevices.batteryPercent,
      status: schema.trackerDevices.status,
    })
    .from(schema.trackerDevices)
    .leftJoin(schema.vehicles, eq(schema.trackerDevices.vehicleId, schema.vehicles.id))
    .where(eq(schema.trackerDevices.isDeleted, false));

  // active trip + route per vehicle (for route-aware projection + map overlay)
  const vehicleIds = devices.map((d) => d.vehicleId).filter((v): v is number => v != null);
  const tripRows = vehicleIds.length
    ? await db
        .select({
          vehicleId: schema.trips.vehicleId,
          tripNumber: schema.trips.tripNumber,
          status: schema.trips.status,
          distance: schema.trips.distance,
          remainingDistance: schema.trips.remainingDistance,
          etaHours: schema.trips.etaHours,
          expectedArrival: schema.trips.expectedArrival,
          origin: schema.routes.origin,
          destination: schema.routes.destination,
          polyline: schema.routes.mapPolyline,
          geoOrigin: schema.routes.geofenceOrigin,
          geoDest: schema.routes.geofenceDestination,
        })
        .from(schema.trips)
        .innerJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
        .where(
          and(
            eq(schema.trips.isDeleted, false),
            ne(schema.trips.status, "Completed"),
            inArray(schema.trips.vehicleId, vehicleIds)
          )
        )
        .orderBy(desc(schema.trips.departureTime))
    : [];

  const tripByVehicle = new Map<number, (typeof tripRows)[number]>();
  for (const t of tripRows) if (t.vehicleId != null && !tripByVehicle.has(t.vehicleId)) tripByVehicle.set(t.vehicleId, t);

  const vehicles = devices.map((d) => {
    const lastSeen = d.lastSeenAt ? new Date(d.lastSeenAt) : null;
    const ageSec = lastSeen ? Math.round((now - lastSeen.getTime()) / 1000) : null;
    const hasFix = d.lastLat != null && d.lastLng != null;
    const stale = !lastSeen || now - lastSeen.getTime() > staleMs;
    const status = !hasFix ? "Unknown" : stale ? "SignalLost" : d.status;

    const trip = d.vehicleId != null ? tripByVehicle.get(d.vehicleId) : undefined;
    const path = trip ? routePathFor(trip) : null;

    let projected:
      | { lat: number; lng: number; distanceMeters: number; capped: boolean; method: string; uncertaintyMeters: number }
      | null = null;
    if (hasFix && stale && lastSeen) {
      projected = deadReckon(
        {
          lat: Number(d.lastLat),
          lng: Number(d.lastLng),
          speedKmh: d.lastSpeed || 0,
          headingDeg: d.lastHeading || 0,
          at: lastSeen,
        },
        new Date(now),
        { path, maxWindowMinutes: 45 }
      );
    }

    return {
      deviceId: d.deviceId,
      imei: d.imei,
      label: d.label,
      provider: d.provider,
      vehicleId: d.vehicleId,
      vehicleNumber: d.vehicleNumber,
      vehicleType: d.vehicleType,
      status,
      lastFix: hasFix
        ? {
            lat: Number(d.lastLat),
            lng: Number(d.lastLng),
            speed: d.lastSpeed,
            heading: d.lastHeading,
            address: d.lastAddress,
            at: lastSeen?.toISOString() ?? null,
            ageSeconds: ageSec,
          }
        : null,
      projected,
      battery: d.battery,
      signalLost: stale && hasFix,
      trip: trip
        ? {
            tripNumber: trip.tripNumber,
            status: trip.status,
            origin: trip.origin,
            destination: trip.destination,
            distanceKm: trip.distance ?? null,
            remainingKm: trip.remainingDistance ?? null,
            etaHours: trip.etaHours ?? null,
            expectedArrival: trip.expectedArrival ? new Date(trip.expectedArrival).toISOString() : null,
            path, // [{lat,lng}, ...] for the map to draw the corridor
          }
        : null,
    };
  });

  return {
    generatedAt: new Date(now).toISOString(),
    staleMinutes: STALE_MINUTES,
    count: vehicles.length,
    vehicles,
  };
}

/**
 * GET /api/tracking/live
 */
router.get("/live", async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await getLiveVehicles());
  } catch (err: any) {
    res.status(500).json({ error: err.message || "failed to load live positions" });
  }
});

/**
 * GET /api/tracking/vehicles/:id/history?from=&to=&limit=
 * Breadcrumb trail for one vehicle.
 */
router.get("/vehicles/:id/history", async (req: AuthRequest, res: Response) => {
  try {
    const vehicleId = parseInt(req.params.id, 10);
    if (isNaN(vehicleId)) return res.status(400).json({ error: "invalid vehicle id" });

    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 500, 1), 5000);
    const conds = [eq(schema.vehiclePositions.vehicleId, vehicleId)];
    if (req.query.from) {
      const f = new Date(String(req.query.from));
      if (!isNaN(f.getTime())) conds.push(gte(schema.vehiclePositions.recordedAt, f));
    }
    if (req.query.to) {
      const t = new Date(String(req.query.to));
      if (!isNaN(t.getTime())) conds.push(lte(schema.vehiclePositions.recordedAt, t));
    }

    const rows = await db
      .select({
        lat: schema.vehiclePositions.lat,
        lng: schema.vehiclePositions.lng,
        speed: schema.vehiclePositions.speed,
        heading: schema.vehiclePositions.heading,
        source: schema.vehiclePositions.source,
        recordedAt: schema.vehiclePositions.recordedAt,
      })
      .from(schema.vehiclePositions)
      .where(and(...conds))
      .orderBy(asc(schema.vehiclePositions.recordedAt))
      .limit(limit);

    res.json({
      vehicleId,
      count: rows.length,
      points: rows.map((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lng),
        speed: r.speed,
        heading: r.heading,
        source: r.source,
        at: new Date(r.recordedAt).toISOString(),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "failed to load history" });
  }
});

// ---------------------------------------------------------------------------
// DEVICE MANAGEMENT  (Super Admin / Admin)
// ---------------------------------------------------------------------------

const canManage = requireRole(["Super Admin", "Admin", "Operations Manager"]);

// ---- GPS provider (GPSWOX / Eagle Tracker) config + manual sync ----
router.get("/provider/config", canManage, async (_req: AuthRequest, res: Response) => {
  const c = await loadGpsProviderConfig(true);
  res.json({
    config: { ...c, password: c.password ? "••••••" : "", hasPassword: !!c.password },
    lastSync: getLastGpsSync(),
  });
});

router.put("/provider/config", canManage, async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const patch: any = {};
    for (const k of ["enabled", "kind", "url", "username", "label"]) if (b[k] !== undefined) patch[k] = b[k];
    if (typeof b.password === "string" && b.password && !/^•+$/.test(b.password)) patch.password = b.password;
    const saved = await saveGpsProviderConfig(patch, req.user?.id);
    res.json({ ok: true, config: { ...saved, password: saved.password ? "••••••" : "", hasPassword: !!saved.password } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/provider/sync", canManage, async (req: AuthRequest, res: Response) => {
  if (req.body?.config) await saveGpsProviderConfig(req.body.config, req.user?.id);
  const result = await syncGpsProvider();
  res.json(result);
});

router.get("/devices", canManage, async (_req: AuthRequest, res: Response) => {
  const rows = await db
    .select()
    .from(schema.trackerDevices)
    .where(eq(schema.trackerDevices.isDeleted, false))
    .orderBy(asc(schema.trackerDevices.id));
  res.json({ devices: rows });
});

router.post("/devices", canManage, async (req: AuthRequest, res: Response) => {
  try {
    const { imei, label, vehicleId, provider, simEnabled } = req.body || {};
    if (!imei) return res.status(400).json({ error: "imei is required" });

    const [created] = await db
      .insert(schema.trackerDevices)
      .values({
        imei: String(imei).trim(),
        label: label || null,
        vehicleId: vehicleId ? Number(vehicleId) : null,
        provider: provider || "generic",
        simEnabled: !!simEnabled,
        ingestToken: newToken(),
        createdBy: req.user!.id,
        updatedBy: req.user!.id,
      })
      .returning();
    res.json({ device: created });
  } catch (err: any) {
    if (String(err.message).includes("unique")) {
      return res.status(409).json({ error: "A device with this IMEI already exists" });
    }
    res.status(500).json({ error: err.message || "failed to create device" });
  }
});

router.patch("/devices/:id", canManage, async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
    const { label, vehicleId, provider, simEnabled } = req.body || {};
    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user!.id };
    if (label !== undefined) patch.label = label;
    if (vehicleId !== undefined) patch.vehicleId = vehicleId ? Number(vehicleId) : null;
    if (provider !== undefined) patch.provider = provider;
    if (simEnabled !== undefined) patch.simEnabled = !!simEnabled;

    const [updated] = await db
      .update(schema.trackerDevices)
      .set(patch)
      .where(eq(schema.trackerDevices.id, id))
      .returning();
    res.json({ device: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "failed to update device" });
  }
});

router.post("/devices/:id/rotate-token", canManage, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
  const [updated] = await db
    .update(schema.trackerDevices)
    .set({ ingestToken: newToken(), updatedAt: new Date(), updatedBy: req.user!.id })
    .where(eq(schema.trackerDevices.id, id))
    .returning({ id: schema.trackerDevices.id, ingestToken: schema.trackerDevices.ingestToken });
  res.json({ device: updated });
});

router.delete("/devices/:id", canManage, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "invalid id" });
  await db
    .update(schema.trackerDevices)
    .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user!.id })
    .where(eq(schema.trackerDevices.id, id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// SIMULATOR  (demo without hardware) - drives sim devices along active trips
// ---------------------------------------------------------------------------

const DEFAULT_PATH: [number, number][] = [
  [24.8607, 67.0011], // Karachi
  [27.7052, 68.8574], // Sukkur
  [29.3956, 71.6836], // Bahawalpur
  [31.1704, 72.7097], // Sahiwal
  [31.5204, 74.3587], // Lahore
  [32.5, 74.0],
  [33.6844, 73.0479], // Islamabad
];

function interpolatePath(path: [number, number][], frac: number): { lat: number; lng: number; heading: number } {
  const f = Math.max(0, Math.min(1, frac));
  const total = path.length - 1;
  const seg = Math.min(Math.floor(f * total), total - 1);
  const segFrac = f * total - seg;
  const [aLat, aLng] = path[seg];
  const [bLat, bLng] = path[seg + 1];
  const lat = aLat + (bLat - aLat) * segFrac;
  const lng = aLng + (bLng - aLng) * segFrac;
  const heading = (Math.atan2(bLng - aLng, bLat - aLat) * 180) / Math.PI;
  return { lat, lng, heading: ((heading % 360) + 360) % 360 };
}

/**
 * Advance every active trip's simulator device one step along its route.
 * Exported for tests; also the body of POST /api/tracking/simulate.
 */
export async function runSimulationTick(step?: number) {
      const activeTrips = await db
        .select({
          id: schema.trips.id,
          tripNumber: schema.trips.tripNumber,
          status: schema.trips.status,
          distance: schema.trips.distance,
          remainingDistance: schema.trips.remainingDistance,
          vehicleId: schema.trips.vehicleId,
          origin: schema.routes.origin,
          destination: schema.routes.destination,
          geoOrigin: schema.routes.geofenceOrigin,
          geoDest: schema.routes.geofenceDestination,
        })
        .from(schema.trips)
        .innerJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
        .where(and(eq(schema.trips.isDeleted, false), ne(schema.trips.status, "Completed")));

      if (activeTrips.length === 0) {
        return { ok: false as const, error: "No active trips to simulate. Dispatch a trip first." };
      }

      const stepFrac = Math.max(0.02, Math.min(0.25, Number(step) || 0.08));
      const results: any[] = [];

      for (const trip of activeTrips) {
        // ensure a simulator device exists for this vehicle
        let [device] = await db
          .select()
          .from(schema.trackerDevices)
          .where(
            and(
              eq(schema.trackerDevices.vehicleId, trip.vehicleId),
              eq(schema.trackerDevices.isDeleted, false)
            )
          )
          .limit(1);

        if (!device) {
          [device] = await db
            .insert(schema.trackerDevices)
            .values({
              imei: `SIM-${trip.vehicleId}-${Date.now().toString().slice(-6)}`,
              label: `Simulator (vehicle ${trip.vehicleId})`,
              vehicleId: trip.vehicleId,
              provider: "simulator",
              simEnabled: true,
              ingestToken: newToken(),
            })
            .returning();
        }

        const dist = trip.distance || 1000;
        const prevRemaining = trip.remainingDistance ?? dist;
        const doneFrac = 1 - prevRemaining / dist;
        const nextFrac = Math.min(1, doneFrac + stepFrac);

        const path: [number, number][] =
          isLatLng(trip.geoOrigin) && isLatLng(trip.geoDest)
            ? [
                [(trip.geoOrigin as any).lat, (trip.geoOrigin as any).lng],
                [(trip.geoDest as any).lat, (trip.geoDest as any).lng],
              ]
            : DEFAULT_PATH;

        const pos = interpolatePath(path, nextFrac);
        const speed = nextFrac >= 1 ? 0 : 55 + Math.round(Math.random() * 25);

        await ingest(device, [
          {
            lat: pos.lat,
            lng: pos.lng,
            speed,
            heading: pos.heading,
            ignition: nextFrac < 1,
            timestamp: new Date(),
            source: "simulator",
          },
        ]);

        const newRemaining = Math.round(dist * (1 - nextFrac));
        let nextStatus = trip.status;
        if (trip.status === "Scheduled") nextStatus = "Started";
        else if (nextFrac >= 1) nextStatus = "Arrived";
        else nextStatus = "In Transit";

        await db
          .update(schema.trips)
          .set({
            status: nextStatus,
            remainingDistance: newRemaining,
            currentSpeed: speed,
            currentAddress: `Simulated: ${Math.round(nextFrac * 100)}% of ${trip.origin} - ${trip.destination}`,
            actualDepartureTime: trip.status === "Scheduled" ? new Date() : undefined,
            updatedAt: new Date(),
          })
          .where(eq(schema.trips.id, trip.id));

        results.push({ tripNumber: trip.tripNumber, progressPercent: Math.round(nextFrac * 100), status: nextStatus, speed });
      }

      return { ok: true as const, simulated: results.length, results };
}

router.post(
  "/simulate",
  requireRole(["Super Admin", "Admin", "Operations Manager", "Dispatcher"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const out = await runSimulationTick(req.body?.step);
      res.status(out.ok ? 200 : 400).json(out);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "simulation failed" });
    }
  }
);

function isLatLng(v: unknown): v is { lat: number; lng: number } {
  return (
    !!v &&
    typeof v === "object" &&
    Number.isFinite((v as any).lat) &&
    Number.isFinite((v as any).lng)
  );
}

// ---------------------------------------------------------------------------
// SIGNAL-LOSS SWEEP  (started from server.ts)
// ---------------------------------------------------------------------------

let sweepTimer: NodeJS.Timeout | null = null;

export function startTrackingSweep() {
  if (sweepTimer) return;
  const run = async () => {
    try {
      // pull real fixes from the GPS provider (Eagle Tracker / GPSWOX), if configured
      await syncGpsProvider().catch(() => {});

      const staleBefore = new Date(Date.now() - STALE_MINUTES * 60_000);
      const wentDark = await db
        .update(schema.trackerDevices)
        .set({ status: "SignalLost", updatedAt: new Date() })
        .where(
          and(
            eq(schema.trackerDevices.isDeleted, false),
            ne(schema.trackerDevices.status, "SignalLost"),
            sql`${schema.trackerDevices.lastSeenAt} is not null`,
            lte(schema.trackerDevices.lastSeenAt, staleBefore)
          )
        )
        .returning({
          id: schema.trackerDevices.id,
          imei: schema.trackerDevices.imei,
          vehicleId: schema.trackerDevices.vehicleId,
          lastSeenAt: schema.trackerDevices.lastSeenAt,
        });

      for (const d of wentDark) {
        SocketServer.emit("tracking:signal_lost", {
          deviceId: d.id,
          imei: d.imei,
          vehicleId: d.vehicleId,
          lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt).toISOString() : null,
          staleMinutes: STALE_MINUTES,
        });
      }
    } catch (err: any) {
      console.warn("[tracking sweep] failed:", err.message || err);
    }
  };
  sweepTimer = setInterval(run, 60_000);
  sweepTimer.unref?.();
  run();
}

export default router;
