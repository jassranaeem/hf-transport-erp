/**
 * GPS Trackers + GPS Map combined into one sheet — the device registry
 * (IMEI, provider, label) and the live map are two views of the same thing,
 * so they live together with a simple tab switch instead of two separate
 * sheets.
 */
import React, { useState } from "react";
import { MapPin, Radio } from "lucide-react";
import EntitySheet from "../sheets/EntitySheet.tsx";
import LiveTrackingMap from "./LiveTrackingMap.tsx";

export default function GpsTracking({
  showFeedback,
  role,
}: {
  showFeedback: (type: "success" | "error", message: string) => void;
  role?: string;
}) {
  const [tab, setTab] = useState<"map" | "devices">("map");

  return (
    <div className="h-full flex flex-col">
      <div className="flex gap-1 px-3 pt-3">
        <button
          onClick={() => setTab("map")}
          className={`text-xs font-semibold rounded-full px-3 py-1.5 flex items-center gap-1.5 ${
            tab === "map" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          <MapPin className="w-3.5 h-3.5" /> Live Map
        </button>
        <button
          onClick={() => setTab("devices")}
          className={`text-xs font-semibold rounded-full px-3 py-1.5 flex items-center gap-1.5 ${
            tab === "devices" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          <Radio className="w-3.5 h-3.5" /> Tracker Devices
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {tab === "map" ? (
          <LiveTrackingMap showFeedback={showFeedback} role={role} />
        ) : (
          <div className="h-full p-3">
            <EntitySheet entityKey="tracker_devices" title="GPS Trackers" showFeedback={showFeedback} />
          </div>
        )}
      </div>
    </div>
  );
}
