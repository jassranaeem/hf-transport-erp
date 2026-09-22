/**
 * Small geospatial helpers - no external service, no API key.
 */

const R = 6371000; // earth radius, metres
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Initial bearing from a to b, degrees 0-359. */
export function bearingDeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Project a point `distanceMeters` along `headingDeg` from the origin. */
export function projectPoint(
  origin: { lat: number; lng: number },
  headingDeg: number,
  distanceMeters: number
): { lat: number; lng: number } {
  const ang = distanceMeters / R;
  const brng = toRad(headingDeg);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brng)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

export type LL = { lat: number; lng: number };

export interface DeadReckoning {
  lat: number;
  lng: number;
  /** metres travelled in the estimate */
  distanceMeters: number;
  /** true if the projection was capped at the max window */
  capped: boolean;
  /** how the estimate was made */
  method: "route" | "heading";
  /** 1-sigma uncertainty radius in metres - grows the longer the signal is out */
  uncertaintyMeters: number;
}

/** Total length of a polyline in metres. */
export function pathLengthMeters(path: LL[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += haversineMeters(path[i - 1], path[i]);
  return d;
}

/**
 * Snap `p` onto the polyline: returns the closest point on the path and how far
 * along the path (metres from the start) that point sits.
 */
export function snapToPath(path: LL[], p: LL): { point: LL; alongMeters: number; offsetMeters: number } {
  let best = { point: path[0], alongMeters: 0, offsetMeters: Infinity };
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = haversineMeters(a, b);
    // project p onto segment a-b in a local planar approximation
    const ax = 0;
    const ay = 0;
    const scale = Math.cos(toRad(a.lat));
    const bx = (b.lng - a.lng) * scale;
    const by = b.lat - a.lat;
    const px = (p.lng - a.lng) * scale;
    const py = p.lat - a.lat;
    const segSq = bx * bx + by * by || 1e-12;
    let t = (px * bx + py * by) / segSq;
    t = Math.max(0, Math.min(1, t));
    const proj: LL = { lat: a.lat + by * t, lng: a.lng + (bx * t) / scale };
    const off = haversineMeters(p, proj);
    if (off < best.offsetMeters) {
      best = { point: proj, alongMeters: acc + segLen * t, offsetMeters: off };
    }
    acc += segLen;
  }
  return best;
}

/** Point that is `alongMeters` from the start of the polyline. */
export function pointAlongPath(path: LL[], alongMeters: number): LL {
  if (alongMeters <= 0) return path[0];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = haversineMeters(a, b);
    if (acc + segLen >= alongMeters) {
      const t = (alongMeters - acc) / (segLen || 1);
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    acc += segLen;
  }
  return path[path.length - 1];
}

/**
 * Estimate where a vehicle probably is now, given its last confirmed fix.
 *
 * If a route `path` is supplied AND the last fix is reasonably close to it
 * (<= 2 km), the estimate is projected ALONG the road - far more realistic for
 * a truck on a highway than a straight line. Otherwise it falls back to
 * heading + speed dead-reckoning.
 *
 * `uncertaintyMeters` grows with the elapsed time so the map can draw a circle
 * that visibly widens the longer the tracker stays dark.
 */
export function deadReckon(
  last: { lat: number; lng: number; speedKmh: number; headingDeg: number; at: Date },
  now: Date,
  opts: { maxWindowMinutes?: number; path?: LL[] | null } = {}
): DeadReckoning | null {
  const maxWindow = (opts.maxWindowMinutes ?? 45) * 60_000;
  const elapsedMs = Math.max(0, now.getTime() - last.at.getTime());
  if (last.speedKmh <= 1 || elapsedMs < 30_000) return null; // was stopped, or too fresh

  const capped = elapsedMs > maxWindow;
  const usableMs = Math.min(elapsedMs, maxWindow);
  const elapsedSec = usableMs / 1000;
  const distanceMeters = (last.speedKmh * 1000) / 3600 * elapsedSec;

  // uncertainty: ~15% of distance travelled, min 150 m, plus 3 m/s of drift
  const uncertaintyMeters = Math.min(
    8000,
    Math.max(150, distanceMeters * 0.15 + elapsedSec * 3)
  );

  const path = opts.path && opts.path.length >= 2 ? opts.path : null;
  if (path) {
    const snap = snapToPath(path, last);
    if (snap.offsetMeters <= 2000) {
      const total = pathLengthMeters(path);
      const along = Math.min(total, snap.alongMeters + distanceMeters);
      const p = pointAlongPath(path, along);
      return {
        lat: p.lat,
        lng: p.lng,
        distanceMeters,
        capped,
        method: "route",
        uncertaintyMeters,
      };
    }
  }

  const p = projectPoint(last, last.headingDeg, distanceMeters);
  return { lat: p.lat, lng: p.lng, distanceMeters, capped, method: "heading", uncertaintyMeters };
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
