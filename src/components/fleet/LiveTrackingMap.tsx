import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  MapContainer, TileLayer, LayersControl, Marker, Popup, Polyline, Circle, CircleMarker, useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { io, Socket } from "socket.io-client";
import { enterpriseFetch } from "../../../client/api.ts";
import {
  Truck, Wifi, WifiOff, Gauge, Clock, MapPin, RefreshCw, Play, Battery, AlertTriangle,
  Flag, Navigation, Radio, CheckCircle2, Route as RouteIcon, Crosshair,
} from "lucide-react";

type Status = "Moving" | "Idle" | "Stopped" | "SignalLost" | "Unknown";

interface LastFix {
  lat: number; lng: number; speed: number; heading: number;
  address: string | null; at: string | null; ageSeconds: number | null;
}
interface Projected {
  lat: number; lng: number; distanceMeters: number; capped: boolean;
  method: "route" | "heading"; uncertaintyMeters: number;
}
interface TripInfo {
  tripNumber: string; status: string; origin: string; destination: string;
  distanceKm: number | null; remainingKm: number | null; etaHours: number | null;
  expectedArrival: string | null; path: { lat: number; lng: number }[] | null;
}
interface LiveVehicle {
  deviceId: number; imei: string; label: string | null; provider: string;
  vehicleId: number | null; vehicleNumber: string | null; vehicleType: string | null;
  status: Status;
  lastFix: LastFix | null;
  projected: Projected | null;
  battery: number | null; signalLost: boolean;
  trip: TripInfo | null;
}
interface TrailPoint { lat: number; lng: number; speed: number; at: string; source: string }
interface AlertItem { id: string; kind: "lost" | "restored"; text: string; at: number }

const COLOR: Record<Status, string> = {
  Moving: "#16a34a",
  Idle: "#d97706",
  Stopped: "#64748b",
  SignalLost: "#dc2626",
  Unknown: "#94a3b8",
};

/** speed text that is honest about missing / stale data */
function speedLabel(v: LiveVehicle, staleMin: number): string {
  const f = v.lastFix;
  if (!f) return "no GPS";
  const age = f.ageSeconds ?? (f.at ? (Date.now() - new Date(f.at).getTime()) / 1000 : null);
  const stale = age != null && age > staleMin * 60;
  const spd = Number.isFinite(f.speed) ? Math.round(f.speed) : 0;
  if (stale) {
    const m = age != null ? Math.round(age / 60) : "?";
    return `${spd} km/h · stale ${m}m`;
  }
  return `${spd} km/h`;
}

function truckIcon(color: string, heading = 0, opts: { pulse?: boolean; ghost?: boolean; label?: string } = {}) {
  const size = 34;
  const rot = Number.isFinite(heading) ? heading : 0;
  return L.divIcon({
    className: "hf-truck",
    html: `
      <div style="position:relative;width:${size}px;height:${size}px">
        ${opts.pulse ? `<span style="position:absolute;inset:-8px;border-radius:50%;background:${color};opacity:.18;animation:hfpulse 1.8s ease-out infinite"></span>` : ""}
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
          border-radius:50%;background:#fff;border:2px solid ${color};
          ${opts.ghost ? "border-style:dashed;opacity:.85;" : "box-shadow:0 1px 4px rgba(0,0,0,.35);"}">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${rot}deg)">
            <path d="M12 2 L12 18 M12 2 L7 9 M12 2 L17 9"/>
          </svg>
        </div>
        ${opts.label ? `<div style="position:absolute;top:${size + 2}px;left:50%;transform:translateX(-50%);
          white-space:nowrap;font:600 10px/1.2 ui-sans-serif,system-ui;color:#0f172a;
          background:rgba(255,255,255,.9);border:1px solid #e2e8f0;border-radius:4px;padding:1px 4px">${opts.label}</div>` : ""}
      </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function endpointIcon(color: string, letter: string) {
  return L.divIcon({
    className: "hf-endpoint",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;
      border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};
      border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)">
      <span style="transform:rotate(45deg);color:#fff;font:700 10px/1 ui-sans-serif,system-ui">${letter}</span>
    </div>`,
    iconSize: [20, 20], iconAnchor: [10, 20],
  });
}

function timeAgo(sec: number | null): string {
  if (sec == null) return "no data";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function MapReady() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize();
    const t = setTimeout(fix, 60);
    window.addEventListener("resize", fix);
    return () => { clearTimeout(t); window.removeEventListener("resize", fix); };
  }, [map]);
  return null;
}

function Controller({
  focus, followTarget,
}: {
  focus: { pts: [number, number][]; k: number } | null;
  followTarget: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!focus || focus.pts.length === 0) return;
    if (focus.pts.length === 1) {
      map.flyTo(focus.pts[0], Math.max(map.getZoom(), 12), { duration: 0.7 });
    } else {
      map.flyToBounds(L.latLngBounds(focus.pts), { padding: [80, 80], maxZoom: 13, duration: 0.7 });
    }
  }, [focus, map]);
  useEffect(() => {
    if (followTarget) map.panTo([followTarget.lat, followTarget.lng], { animate: true, duration: 0.5 });
  }, [followTarget, map]);
  return null;
}

function FitBounds({ points, trigger }: { points: [number, number][]; trigger: number }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) { map.setView(points[0], 12); return; }
    map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return null;
}

export default function LiveTrackingMap({
  showFeedback, role,
}: {
  showFeedback: (type: "success" | "error", message: string) => void;
  role?: string;
}) {
  const [vehicles, setVehicles] = useState<LiveVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [staleMinutes, setStaleMinutes] = useState(10);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [trail, setTrail] = useState<TrailPoint[]>([]);
  const [focus, setFocus] = useState<{ pts: [number, number][]; k: number } | null>(null);
  const [fitTrigger, setFitTrigger] = useState(0);
  const [simulating, setSimulating] = useState(false);
  const [follow, setFollow] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const firstLoad = useRef(true);

  const canSimulate = !role || ["Super Admin", "Admin", "Operations Manager", "Dispatcher"].includes(role);

  const load = useCallback(async (fit = false, manual = false) => {
    if (manual) setLoading(true);
    try {
      const res = await enterpriseFetch("/api/tracking/live");
      const list = res.vehicles || [];
      setVehicles(list);
      setGeneratedAt(res.generatedAt || null);
      setStaleMinutes(res.staleMinutes || 10);
      if (fit || firstLoad.current) {
        setFitTrigger((t) => t + 1);
        firstLoad.current = false;
      }
      if (manual) {
        const withFix = list.filter((v: LiveVehicle) => v.lastFix).length;
        const newest = list
          .map((v: LiveVehicle) => (v.lastFix?.at ? new Date(v.lastFix.at).getTime() : 0))
          .reduce((a: number, b: number) => Math.max(a, b), 0);
        const ageMin = newest ? Math.round((Date.now() - newest) / 60000) : null;
        if (!withFix) {
          showFeedback("error", "No live GPS fix yet — connect the tracker in Console → GPS Provider (Eagle Tracker login), then Sync. · GPS Provider میں لاگ اِن کریں۔");
        } else {
          showFeedback("success", `Refreshed — ${withFix}/${list.length} trucks ka fix${ageMin != null ? `, sabse naya ${ageMin} min purana` : ""}.`);
        }
      }
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to load live positions");
    } finally {
      setLoading(false);
    }
  }, [showFeedback]);

  useEffect(() => {
    load(true);
    const poll = setInterval(() => load(false), 15000);

    const socket = io(window.location.origin, { transports: ["polling", "websocket"] });
    socketRef.current = socket;
    const onUpdate = () => load(false);
    const onLost = (p: any) => {
      const name = p.vehicleNumber || p.imei || `device ${p.deviceId}`;
      setAlerts((a) => [{ id: `${p.deviceId}-${Date.now()}`, kind: "lost", text: `${name} — signal lost (no fix ${p.staleMinutes}m)`, at: Date.now() }, ...a].slice(0, 12));
      load(false);
    };
    const onRestored = (p: any) => {
      const name = p.vehicleNumber || p.imei || `device ${p.deviceId}`;
      const mins = Math.round((p.outageSeconds || 0) / 60);
      setAlerts((a) => [{ id: `${p.deviceId}-${Date.now()}`, kind: "restored", text: `${name} — back online after ${mins}m${p.bufferedPoints ? ` (+${p.bufferedPoints} buffered fixes)` : ""}`, at: Date.now() }, ...a].slice(0, 12));
      load(false);
    };
    socket.on("tracking:update", onUpdate);
    socket.on("tracking:signal_lost", onLost);
    socket.on("tracking:signal_restored", onRestored);

    return () => {
      clearInterval(poll);
      socket.off("tracking:update", onUpdate);
      socket.off("tracking:signal_lost", onLost);
      socket.off("tracking:signal_restored", onRestored);
      socket.disconnect();
    };
  }, [load]);

  const selectVehicle = useCallback(async (v: LiveVehicle) => {
    setSelectedId(v.deviceId);
    const pts: [number, number][] = [];
    if (v.lastFix) pts.push([v.lastFix.lat, v.lastFix.lng]);
    if (v.projected) pts.push([v.projected.lat, v.projected.lng]);
    if (pts.length) setFocus({ pts, k: Date.now() });
    setTrail([]);
    if (!v.vehicleId) return;
    try {
      const res = await enterpriseFetch(`/api/tracking/vehicles/${v.vehicleId}/history?limit=1500`);
      setTrail(res.points || []);
    } catch { /* best-effort */ }
  }, []);

  const runSimulation = async () => {
    setSimulating(true);
    try {
      const res = await enterpriseFetch("/api/tracking/simulate", { method: "POST", body: JSON.stringify({ step: 0.08 }) });
      showFeedback("success", `Advanced ${res.simulated} trip(s)`);
      load(false);
    } catch (err: any) {
      showFeedback("error", err.message || "Simulation failed");
    } finally {
      setSimulating(false);
    }
  };

  const allPoints = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    vehicles.forEach((v) => {
      if (v.lastFix) pts.push([v.lastFix.lat, v.lastFix.lng]);
      if (v.projected) pts.push([v.projected.lat, v.projected.lng]);
    });
    return pts;
  }, [vehicles]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { Moving: 0, Idle: 0, Stopped: 0, SignalLost: 0, Unknown: 0 };
    vehicles.forEach((v) => { c[v.status] = (c[v.status] || 0) + 1; });
    return c;
  }, [vehicles]);

  const selected = vehicles.find((v) => v.deviceId === selectedId) || null;
  const followTarget = follow && selected ? (selected.projected || selected.lastFix) : null;

  return (
    <div className="flex flex-col gap-3">
      <style>{`
        @keyframes hfpulse{0%{transform:scale(.7);opacity:.4}100%{transform:scale(2.4);opacity:0}}
        .leaflet-container{font:inherit}
      `}</style>

      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <MapPin className="w-5 h-5 text-emerald-600" /> Live Fleet Tracking
          </h2>
          <p className="text-sm text-slate-500">
            {counts.Moving + counts.Idle + counts.Stopped + counts.SignalLost} tracked ·{" "}
            <span className="text-emerald-600 font-medium">{counts.Moving} moving</span> ·{" "}
            <span className="text-red-600 font-medium">{counts.SignalLost} signal-lost</span> ·
            threshold {staleMinutes}m ·{" "}
            {generatedAt ? `updated ${new Date(generatedAt).toLocaleTimeString()}` : "…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected && (
            <button
              onClick={() => setFollow((f) => !f)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${
                follow ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-300 hover:bg-slate-50"
              }`}
            >
              <Crosshair className="w-4 h-4" /> {follow ? "Following" : "Follow"}
            </button>
          )}
          <button
            onClick={() => load(true, true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Refreshing…" : "Refresh"}
          </button>
          {canSimulate && (
            <button
              onClick={runSimulation}
              disabled={simulating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 text-white px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-50"
            >
              <Play className="w-4 h-4" /> {simulating ? "Advancing…" : "Simulate movement"}
            </button>
          )}
        </div>
      </div>

      {/* legend */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(COLOR) as Status[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLOR[k] }} />
            {k} <b className="text-slate-500">{counts[k] || 0}</b>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-slate-500">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-red-500" /> estimated (signal lost)
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[330px_1fr] gap-3">
        {/* left column: vehicle list + alerts */}
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-slate-200 bg-white max-h-[46vh] overflow-y-auto">
            {vehicles.length === 0 && !loading && (
              <div className="p-4 text-sm text-slate-500 space-y-2">
                <p className="font-medium text-slate-700">No trackers reporting yet.</p>
                <p>Fit a hardware GPS tracker and point it (or a Traccar server) at:</p>
                <code className="block bg-slate-50 border rounded p-2 text-[11px] break-all">
                  POST {window.location.origin}/api/tracking/ingest
                </code>
                <p>Or press <b>Simulate movement</b> to demo with an active trip.</p>
              </div>
            )}
            {vehicles.map((v) => {
              const est = v.signalLost && v.projected;
              return (
                <button
                  key={v.deviceId}
                  onClick={() => selectVehicle(v)}
                  className={`w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 ${
                    selectedId === v.deviceId ? "bg-emerald-50" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm flex items-center gap-1.5">
                      <Truck className="w-4 h-4 text-slate-400" />
                      {v.vehicleNumber || v.label || v.imei}
                    </span>
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white inline-flex items-center gap-1"
                      style={{ background: COLOR[v.status] }}
                    >
                      {v.status === "SignalLost" ? <WifiOff className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
                      {v.status === "SignalLost" ? "SIGNAL LOST" : v.status}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1"><Gauge className="w-3 h-3" />{speedLabel(v, staleMinutes)}</span>
                    <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{timeAgo(v.lastFix?.ageSeconds ?? null)}</span>
                    {v.battery != null && (
                      <span className={`inline-flex items-center gap-1 ${v.battery < 20 ? "text-red-600" : ""}`}>
                        <Battery className="w-3 h-3" />{v.battery}%
                      </span>
                    )}
                  </div>

                  {v.trip && (
                    <div className="mt-1 text-[11px] text-slate-500 inline-flex items-center gap-1">
                      <RouteIcon className="w-3 h-3" />
                      {v.trip.origin} → {v.trip.destination}
                      {v.trip.remainingKm != null && <span className="text-slate-400"> · {v.trip.remainingKm} km left</span>}
                    </div>
                  )}

                  {est && (
                    <div className="mt-1 rounded-md bg-red-50 border border-red-200 px-2 py-1 text-[11px] text-red-700">
                      <div className="inline-flex items-center gap-1 font-medium">
                        <AlertTriangle className="w-3 h-3" />
                        Estimated {(v.projected!.distanceMeters / 1000).toFixed(1)} km on from last fix
                        {v.projected!.method === "route" ? " (along route)" : ""}
                      </div>
                      <div className="text-red-500">± {(v.projected!.uncertaintyMeters / 1000).toFixed(1)} km {v.projected!.capped ? "· capped 45m" : ""}</div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* alert feed */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 max-h-[22vh] overflow-y-auto">
            <div className="text-xs font-semibold text-slate-600 flex items-center gap-1.5 mb-1.5">
              <Radio className="w-3.5 h-3.5" /> Connection events
            </div>
            {alerts.length === 0 ? (
              <p className="text-[11px] text-slate-400">No signal events yet.</p>
            ) : (
              <ul className="space-y-1">
                {alerts.map((a) => (
                  <li key={a.id} className={`text-[11px] flex items-start gap-1.5 ${a.kind === "lost" ? "text-red-600" : "text-emerald-600"}`}>
                    {a.kind === "lost" ? <WifiOff className="w-3 h-3 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" />}
                    <span><b className="text-slate-400 font-normal">{new Date(a.at).toLocaleTimeString()}</b> — {a.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* map */}
        <div className="rounded-xl border border-slate-200 overflow-hidden h-[70vh] min-h-[420px]">
          <MapContainer center={[30.3753, 69.3451]} zoom={6} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
            <LayersControl position="topright">
              <LayersControl.BaseLayer checked name="Streets">
                {/* Esri's World Street Map service — NOT the raw OpenStreetMap
                    tile server. That one explicitly disallows this kind of
                    app traffic (see osm.wiki/Blocked) and starts returning
                    403s once real usage picks up, which is exactly what was
                    happening here. (CARTO's "free" basemap tiles were tried
                    first, but those now nag for a signup API key too — see
                    carto.com/basemaps/apikey — so this uses the same Esri
                    ArcGIS Online service already relied on below for
                    Satellite/Topographic, which needs no key.) */}
                <TileLayer
                  attribution="Tiles &copy; Esri"
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
                  maxZoom={19}
                />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Satellite">
                <TileLayer
                  attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics"
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  maxZoom={19}
                />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Topographic">
                <TileLayer
                  attribution="Tiles &copy; Esri"
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
                  maxZoom={19}
                />
              </LayersControl.BaseLayer>
            </LayersControl>

            <MapReady />
            <Controller focus={focus} followTarget={followTarget ? { lat: followTarget.lat, lng: followTarget.lng } : null} />
            <FitBounds points={allPoints} trigger={fitTrigger} />

            {/* route corridor for the selected vehicle (or all with a trip if none selected) */}
            {vehicles
              .filter((v) => v.trip?.path && v.trip.path.length >= 2 && (!selected || v.deviceId === selectedId))
              .map((v) => {
                const path = v.trip!.path!.map((p) => [p.lat, p.lng] as [number, number]);
                return (
                  <React.Fragment key={`route-${v.deviceId}`}>
                    <Polyline positions={path} pathOptions={{ color: "#2563eb", weight: 3, opacity: 0.4, dashArray: "2 8" }} />
                    <Marker position={path[0]} icon={endpointIcon("#2563eb", "O")}>
                      <Popup><b>{v.trip!.origin}</b><br />route origin</Popup>
                    </Marker>
                    <Marker position={path[path.length - 1]} icon={endpointIcon("#7c3aed", "D")}>
                      <Popup><b>{v.trip!.destination}</b><br />route destination</Popup>
                    </Marker>
                  </React.Fragment>
                );
              })}

            {/* breadcrumb trail for the selected vehicle */}
            {selected && trail.length > 1 && (
              <Polyline
                positions={trail.map((p) => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: "#0ea5e9", weight: 3, opacity: 0.75 }}
              />
            )}

            {/* vehicles */}
            {vehicles.map((v) => {
              const nodes: React.ReactNode[] = [];
              const label = v.vehicleNumber || v.label || v.imei;

              if (v.lastFix) {
                nodes.push(
                  <Marker
                    key={`fix-${v.deviceId}`}
                    position={[v.lastFix.lat, v.lastFix.lng]}
                    icon={truckIcon(v.signalLost ? "#dc2626" : COLOR[v.status], v.lastFix.heading, {
                      pulse: v.status === "Moving",
                      ghost: v.signalLost,
                      label,
                    })}
                    eventHandlers={{ click: () => selectVehicle(v) }}
                  >
                    <Popup>
                      <div className="text-xs space-y-0.5 min-w-[190px]">
                        <div className="font-semibold text-sm">{label}</div>
                        <div>Status: <b style={{ color: COLOR[v.status] }}>{v.status}</b></div>
                        <div>Speed {v.lastFix.speed} km/h · heading {v.lastFix.heading}°</div>
                        <div>Last confirmed fix: {timeAgo(v.lastFix.ageSeconds)}</div>
                        {v.lastFix.at && <div className="text-slate-400">{new Date(v.lastFix.at).toLocaleString()}</div>}
                        {v.lastFix.address && <div>{v.lastFix.address}</div>}
                        {v.trip && <div className="pt-1 border-t mt-1">{v.trip.origin} → {v.trip.destination}{v.trip.remainingKm != null ? ` · ${v.trip.remainingKm} km left` : ""}</div>}
                        {v.signalLost && (
                          <div className="text-red-600 mt-1 font-medium">⚠ Signal lost — dashed marker is where it likely is now.</div>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                );
              }

              if (v.signalLost && v.projected && v.lastFix) {
                nodes.push(
                  <Polyline
                    key={`link-${v.deviceId}`}
                    positions={[[v.lastFix.lat, v.lastFix.lng], [v.projected.lat, v.projected.lng]]}
                    pathOptions={{ color: "#dc2626", dashArray: "5 8", weight: 2, opacity: 0.8 }}
                  />
                );
                nodes.push(
                  <Circle
                    key={`unc-${v.deviceId}`}
                    center={[v.projected.lat, v.projected.lng]}
                    radius={v.projected.uncertaintyMeters}
                    pathOptions={{ color: "#dc2626", weight: 1, opacity: 0.5, fillColor: "#dc2626", fillOpacity: 0.08 }}
                  />
                );
                nodes.push(
                  <Marker
                    key={`est-${v.deviceId}`}
                    position={[v.projected.lat, v.projected.lng]}
                    icon={truckIcon("#dc2626", v.lastFix.heading, { pulse: true, ghost: true, label: `${label} (est.)` })}
                    eventHandlers={{ click: () => selectVehicle(v) }}
                  >
                    <Popup>
                      <div className="text-xs space-y-0.5">
                        <div className="font-semibold text-red-600">Estimated position — no live signal</div>
                        <div>~{(v.projected.distanceMeters / 1000).toFixed(1)} km on from the last confirmed fix</div>
                        <div>method: {v.projected.method === "route" ? "projected along the trip route" : "last speed + heading"}</div>
                        <div>confidence radius ± {(v.projected.uncertaintyMeters / 1000).toFixed(1)} km</div>
                        {v.projected.capped && <div>(estimate capped at 45 min)</div>}
                        <div className="text-slate-400 pt-1 border-t mt-1">Last confirmed {timeAgo(v.lastFix.ageSeconds)}</div>
                      </div>
                    </Popup>
                  </Marker>
                );
              }

              if (!v.lastFix && v.projected) {
                nodes.push(
                  <CircleMarker key={`u-${v.deviceId}`} center={[v.projected.lat, v.projected.lng]} radius={7}
                    pathOptions={{ color: COLOR.Unknown, fillOpacity: 0.3 }} />
                );
              }
              return <React.Fragment key={v.deviceId}>{nodes}</React.Fragment>;
            })}
          </MapContainer>
        </div>
      </div>

      {/* selected vehicle detail strip */}
      {selected && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium flex items-center gap-1.5">
              <Navigation className="w-4 h-4 text-blue-600" />
              {selected.vehicleNumber || selected.label || selected.imei}
              <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ background: COLOR[selected.status] }}>
                {selected.status === "SignalLost" ? "SIGNAL LOST" : selected.status}
              </span>
            </span>
            <span className="text-slate-500 text-xs">{trail.length} trail points</span>
          </div>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
              <div className="text-slate-400">Speed</div>
              <div className="font-semibold">{speedLabel(selected, staleMinutes)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
              <div className="text-slate-400">Last confirmed fix</div>
              <div className="font-semibold">{timeAgo(selected.lastFix?.ageSeconds ?? null)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
              <div className="text-slate-400">Battery</div>
              <div className="font-semibold">{selected.battery != null ? `${selected.battery}%` : "—"}</div>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2">
              <div className="text-slate-400">Trip</div>
              <div className="font-semibold truncate">
                {selected.trip ? `${selected.trip.origin} → ${selected.trip.destination}` : "no active trip"}
              </div>
            </div>
          </div>
          {selected.trip && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1"><Flag className="w-3 h-3" />{selected.trip.tripNumber} · {selected.trip.status}</span>
              {selected.trip.distanceKm != null && <span>route {selected.trip.distanceKm} km</span>}
              {selected.trip.remainingKm != null && <span className="text-slate-700 font-medium">{selected.trip.remainingKm} km remaining</span>}
              {selected.trip.expectedArrival && <span>ETA {new Date(selected.trip.expectedArrival).toLocaleString()}</span>}
            </div>
          )}
          {selected.signalLost && selected.projected && (
            <div className="mt-2 rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700">
              <b>Signal lost.</b> Best estimate: ~{(selected.projected.distanceMeters / 1000).toFixed(1)} km on from the last
              confirmed fix {selected.projected.method === "route" ? "along the trip route" : "on the last heading"},
              ± {(selected.projected.uncertaintyMeters / 1000).toFixed(1)} km. Buffered fixes from the tracker will fill the
              gap automatically when it reconnects.
            </div>
          )}
          {!selected.vehicleId && (
            <p className="text-slate-500 text-xs mt-2">This device isn't linked to a vehicle — link it under Fleet Vehicles to see trip context.</p>
          )}
        </div>
      )}
    </div>
  );
}
