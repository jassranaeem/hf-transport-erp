# Live GPS / Fleet Tracking

Goal: **always know where the container is — even when the tracker loses signal.**

## How it works

```
 Hardware GPS tracker ──(GSM/GPRS)──▶  Traccar server ──(webhook)──▶  POST /api/tracking/traccar
        │                                                                     │
        └───────────────── direct HTTP (JSON) ──────────────────────▶  POST /api/tracking/ingest
                                                                              │
                                                                              ▼
                                                            vehicle_positions  (append-only history)
                                                            tracker_devices    (last confirmed fix)
                                                                              │
                                        socket "tracking:update" ◀────────────┤
                                        socket "tracking:signal_lost" ◀── 60s sweep
                                                                              │
                                                                              ▼
                                              GET /api/tracking/live  ──▶  Live GPS Tracking screen
                                                                           (Leaflet + OpenStreetMap)
```

### Never losing the container

1. **On-device buffering.** Use a tracker that stores fixes locally when GSM
   drops and replays them on reconnect (Teltonika FMx, Concox/Jimi, Queclink,
   and Traccar-bridged devices all do). The API accepts **backdated** points and
   de-duplicates on `(device, recordedAt)`, so a reconnecting tracker can dump
   its whole offline log with no duplicates and no lost history.
2. **Last confirmed fix** is denormalised on `tracker_devices` for instant map
   loads.
3. **Signal-loss detection.** A sweep every 60 s flags any device with no fix
   for `TRACKING_STALE_MINUTES` (default 10) as `SignalLost` and emits
   `tracking:signal_lost`. When the tracker reports again, `tracking:signal_restored`
   fires (with the outage length and how many buffered fixes came back).
4. **Route-aware dead-reckoned estimate.** While a device is stale,
   `GET /api/tracking/live` also returns a `projected` position:
   - if the vehicle has an active trip whose route has coordinates and the last
     fix is within ~2 km of that corridor, the estimate is advanced **along the
     road**, not in a straight line (`method: "route"`);
   - otherwise it falls back to last speed + heading (`method: "heading"`);
   - it carries an `uncertaintyMeters` that **grows the longer the signal is
     out**, drawn on the map as a widening circle, and is capped at a 45-minute
     projection window.
   The map shows the last confirmed marker solid + the estimate as a pulsing
   dashed truck inside the uncertainty circle, with a dashed connector line — so
   the dot never silently freezes, and you always see roughly where it should be.
5. **Live map.** Leaflet, keyless OpenStreetMap street tiles by default, with a
   layer switcher for Esri **Satellite** / **Topographic**. Draws the trip
   corridor (O → D), the breadcrumb trail, and a "connection events" feed of
   signal-lost / restored alerts.
6. **Offline client.** The app is a PWA; the service worker serves the last
   `/api/tracking/live` response when the phone/laptop itself is offline.

## Environment variables

| var | default | meaning |
|-----|---------|---------|
| `TRACKING_STALE_MINUTES` | `10` | no fix for this long ⇒ `SignalLost` |
| `TRACKING_INGEST_TOKEN` | – | global shared secret accepted by `/ingest` (in addition to each device's own `ingestToken`) |
| `TRACKING_TRACCAR_TOKEN` | = `TRACKING_INGEST_TOKEN` | `?token=` required on `/traccar` |
| `TRACKING_AUTO_REGISTER` | `false` | `true` = create a device row automatically the first time an unknown IMEI reports (must present `TRACKING_INGEST_TOKEN`) |

## Connecting a tracker

### Option A — Traccar (recommended, supports 200+ protocols)

1. Run Traccar (`docker run -d -p 5055:5055 -p 5000-5150:5000-5150 traccar/traccar`).
2. Point your devices at the Traccar server as usual.
3. In Traccar: **Settings → Server → Forward** →
   URL `https://YOUR_ERP/api/tracking/traccar?token=YOUR_TRACCAR_TOKEN`,
   format **JSON**.
4. In the ERP: **Governance → Data Import / Export** is *not* it — use the
   **Live GPS Tracking** screen; register each device (or set
   `TRACKING_AUTO_REGISTER=true`) and link it to a vehicle.

### Option B — device posts JSON directly

```
POST /api/tracking/ingest
Content-Type: application/json

{
  "imei": "356938035643809",
  "token": "<device ingestToken or TRACKING_INGEST_TOKEN>",
  "positions": [
    { "lat": 31.5204, "lng": 74.3587, "speed": 62, "heading": 210,
      "timestamp": "2026-09-07T09:15:00Z", "ignition": true, "battery": 87 },
    { "lat": 31.5100, "lng": 74.3300, "speed": 58, "heading": 215,
      "timestamp": "2026-09-07T09:16:00Z", "source": "buffered" }
  ]
}
```

Single fix: send one `position` object (or the bare fields) instead of
`positions`. Field aliases accepted: `latitude/longitude/lon`, `course/bearing`
for heading, `time/deviceTime/fixTime` for timestamp.

## API reference

| method | path | auth | purpose |
|--------|------|------|---------|
| `POST` | `/api/tracking/ingest` | device token | push 1..N fixes |
| `POST` | `/api/tracking/traccar?token=` | traccar token | Traccar forward webhook |
| `GET`  | `/api/tracking/live` | user | latest state of every device + signal-loss + estimate |
| `GET`  | `/api/tracking/vehicles/:id/history?from=&to=&limit=` | user | breadcrumb trail |
| `GET`  | `/api/tracking/devices` | Super Admin / Admin / Ops | list devices |
| `POST` | `/api/tracking/devices` | ″ | register a device (returns `ingestToken`) |
| `PATCH`| `/api/tracking/devices/:id` | ″ | link to vehicle / rename / toggle sim |
| `POST` | `/api/tracking/devices/:id/rotate-token` | ″ | new `ingestToken` |
| `POST` | `/api/tracking/simulate` | Ops+ | move sim devices along active trips (demo, no hardware) |

## Demo without hardware

Dispatch a trip, open **Live GPS Tracking**, press **Simulate movement**. A
`simulator` device is auto-created per vehicle and driven along the route; every
tick flows through the exact same ingest pipeline as real hardware.
