import React, { useState, useEffect } from "react";
import { MapPin, Plus, Trash2, Edit2, Search, Route, Landmark, AlertTriangle } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import RecordAttachments from "../common/RecordAttachments.tsx";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

interface TransitRoute {
  id: number;
  origin: string;
  destination: string;
  distance: number;
  expectedHours: number;
  benchmarkFuel: number;
  expectedToll: number;
  revenue: number;
  averageSpeed: number;
  allowedSpeed: number;
  riskLevel: string;
  status: string;
}

interface FleetRoutesProps {
  showFeedback: (type: "success" | "error", message: string) => void;
}

export default function FleetRoutes({ showFeedback }: FleetRoutesProps) {
  const [routes, setRoutes] = useState<TransitRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Drawer Form state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<TransitRoute | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    origin: "",
    destination: "",
    distance: 380,
    expectedHours: 6,
    benchmarkFuel: 110,
    expectedToll: 2500,
    revenue: 140000,
    averageSpeed: 60,
    allowedSpeed: 80,
    riskLevel: "Low",
    status: "Active",
  });

  const fetchRoutes = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({ search });
      const data = await enterpriseFetch(`/api/operations/routes?${queryParams}`);
      if (Array.isArray(data)) {
        setRoutes(data);
      } else {
        setRoutes([]);
        showFeedback("error", "Failed to fetch routes");
      }
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to load routes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoutes();
  }, [search]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    console.log("Submitting route form, current state:", formData);
    try {
      const url = editingRoute ? `/api/operations/routes/${editingRoute.id}` : "/api/operations/routes";
      const method = editingRoute ? "PUT" : "POST";
      console.log(`Sending ${method} request to ${url}...`);

      const cleanedForm = {
        ...formData,
        distance: Number(formData.distance),
        expectedHours: Number(formData.expectedHours),
        benchmarkFuel: Number(formData.benchmarkFuel),
        expectedToll: Number(formData.expectedToll),
        revenue: Number(formData.revenue),
        averageSpeed: Number(formData.averageSpeed),
        allowedSpeed: Number(formData.allowedSpeed),
      };
      console.log("Prepared cleaned form payload for routes:", cleanedForm);

      const result = await enterpriseFetch(url, {
        method,
        body: JSON.stringify(cleanedForm),
      });
      console.log("Response received from route save:", result);

      showFeedback("success", editingRoute ? "Transit route configuration saved" : "New route registered");
      setIsDrawerOpen(false);
      setEditingRoute(null);
      fetchRoutes();
    } catch (err: any) {
      console.error("Save route details error:", err);
      showFeedback("error", err.message || "Failed to save route");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (r: TransitRoute) => {
    setEditingRoute(r);
    setFormData({
      origin: r.origin,
      destination: r.destination,
      distance: r.distance,
      expectedHours: r.expectedHours,
      benchmarkFuel: r.benchmarkFuel,
      expectedToll: r.expectedToll,
      revenue: r.revenue,
      averageSpeed: r.averageSpeed,
      allowedSpeed: r.allowedSpeed,
      riskLevel: r.riskLevel,
      status: r.status,
    });
    setIsDrawerOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Deactivate this operational freight corridor route?")) return;
    try {
      await enterpriseFetch(`/api/operations/routes/${id}`, { method: "DELETE" });
      showFeedback("success", "Route corridor deactivated and logged");
      fetchRoutes();
    } catch (err: any) {
      showFeedback("error", err.message || "Deactivation failed");
    }
  };

  const openAddDrawer = () => {
    setEditingRoute(null);
    setFormData({
      origin: "Lahore Terminal",
      destination: "Karachi Port Qasim",
      distance: 1250,
      expectedHours: 24,
      benchmarkFuel: 380,
      expectedToll: 12500,
      revenue: 380000,
      averageSpeed: 60,
      allowedSpeed: 80,
      riskLevel: "Medium",
      status: "Active",
    });
    setIsDrawerOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/40 p-4 border border-slate-900 rounded-xl">
        <div className="flex items-center gap-3">
          <Route className="w-8 h-8 text-blue-500" />
          <div>
            <h2 className="text-xl font-bold text-white">Freight Corridor Routes</h2>
            <p className="text-xs text-slate-400">Total verified primary logistics transit corridors: {routes.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
        <ModuleDataIO entityKey="routes" label="Routes" onImported={fetchRoutes} />
        <button
          onClick={openAddDrawer}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition"
        >
          <Plus className="w-4 h-4" /> Define Route Corridor
        </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Filter route corridors by origin or destination..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Grid of Route Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="h-48 bg-slate-950/20 border border-slate-900 rounded-xl animate-pulse" />
          ))
        ) : routes.length === 0 ? (
          <div className="col-span-3 text-center py-12 text-slate-500 text-xs">
            No transit routes defined yet. Add routes to enable Smart Dispatch.
          </div>
        ) : (
          routes.map((r) => (
            <div key={r.id} className="bg-slate-950/40 border border-slate-900 rounded-xl p-4 flex flex-col justify-between hover:border-slate-800 transition space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 font-bold">
                    <MapPin className="w-3.5 h-3.5 text-blue-500" />
                    <span>Corridor {r.id}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                    r.status === "Active" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                  }`}>
                    {r.status}
                  </span>
                </div>

                <div className="flex justify-between items-center bg-slate-900/40 p-2 rounded-lg border border-slate-900">
                  <div className="text-left">
                    <p className="text-[10px] text-slate-500 font-bold uppercase">Origin</p>
                    <p className="text-xs font-bold text-white">{r.origin}</p>
                  </div>
                  <div className="text-slate-600 font-bold font-mono">➜</div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500 font-bold uppercase">Destination</p>
                    <p className="text-xs font-bold text-white">{r.destination}</p>
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-2 text-center pt-2">
                  <div className="bg-slate-950/50 p-1.5 rounded border border-slate-900/80">
                    <p className="text-[9px] text-slate-500">Distance</p>
                    <p className="text-xs font-bold text-slate-300 font-mono">{r.distance} km</p>
                  </div>
                  <div className="bg-slate-950/50 p-1.5 rounded border border-slate-900/80">
                    <p className="text-[9px] text-slate-500">Hours</p>
                    <p className="text-xs font-bold text-slate-300 font-mono">{r.expectedHours} hrs</p>
                  </div>
                  <div className="bg-slate-950/50 p-1.5 rounded border border-slate-900/80">
                    <p className="text-[9px] text-slate-500">Fuel Cap</p>
                    <p className="text-xs font-bold text-slate-300 font-mono">{r.benchmarkFuel} L</p>
                  </div>
                </div>

                {/* Financials & Risks */}
                <div className="grid grid-cols-2 gap-2 text-left pt-2">
                  <div>
                    <p className="text-[9px] text-slate-500">Expected Revenue</p>
                    <p className="text-xs font-bold text-emerald-400 font-mono">PKR {r.revenue.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500">Transit Speed Limits</p>
                    <p className="text-xs font-bold text-slate-300 font-mono">{r.averageSpeed} / {r.allowedSpeed} kmh</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center border-t border-slate-900 pt-3">
                <span className={`text-[10px] font-semibold ${
                  r.riskLevel === "Low" ? "text-emerald-400" : r.riskLevel === "Medium" ? "text-amber-400" : "text-rose-400"
                } flex items-center gap-1`}>
                  <AlertTriangle className="w-3.5 h-3.5" /> Risk: {r.riskLevel}
                </span>

                <div className="flex gap-1">
                  <button
                    onClick={() => handleEdit(r)}
                    className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-400 hover:text-white transition"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="p-1.5 bg-slate-900 hover:bg-rose-500/10 border border-slate-800 rounded-lg text-slate-500 hover:text-rose-400 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="bg-white rounded-lg mt-2">
                <RecordAttachments entityType="route" entityId={r.id} label="Route docs / permits" />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Drawer Form */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/80 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-lg bg-slate-950 border-l border-slate-900 p-6 overflow-y-auto space-y-6 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-900 pb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Route className="w-6 h-6 text-blue-500" />
                {editingRoute ? "Modify Route Corridor Parameters" : "Define Primary Freight Corridor"}
              </h3>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="text-slate-500 hover:text-white text-xs px-2 py-1 bg-slate-900 rounded-lg"
              >
                ESC
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Origin Terminal *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Lahore Operations Hub"
                    value={formData.origin}
                    onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Destination Terminal *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Karachi Port Qasim"
                    value={formData.destination}
                    onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 border-t border-slate-900 pt-4">
                <div>
                  <label className="block text-slate-400 mb-1">Distance (km) *</label>
                  <input
                    type="number"
                    required
                    value={formData.distance}
                    onChange={(e) => setFormData({ ...formData, distance: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Expected Hours *</label>
                  <input
                    type="number"
                    required
                    value={formData.expectedHours}
                    onChange={(e) => setFormData({ ...formData, expectedHours: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Benchmark Fuel (L) *</label>
                  <input
                    type="number"
                    required
                    value={formData.benchmarkFuel}
                    onChange={(e) => setFormData({ ...formData, benchmarkFuel: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-slate-900 pt-4">
                <div>
                  <label className="block text-slate-400 mb-1">Expected Toll Taxes (PKR)</label>
                  <input
                    type="number"
                    value={formData.expectedToll}
                    onChange={(e) => setFormData({ ...formData, expectedToll: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Contractor Tariff Revenue (PKR) *</label>
                  <input
                    type="number"
                    required
                    value={formData.revenue}
                    onChange={(e) => setFormData({ ...formData, revenue: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 border-t border-slate-900 pt-4">
                <div>
                  <label className="block text-slate-400 mb-1">Average Speed (kmh)</label>
                  <input
                    type="number"
                    value={formData.averageSpeed}
                    onChange={(e) => setFormData({ ...formData, averageSpeed: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Max Allowed Speed</label>
                  <input
                    type="number"
                    value={formData.allowedSpeed}
                    onChange={(e) => setFormData({ ...formData, allowedSpeed: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Security Risk Level</label>
                  <select
                    value={formData.riskLevel}
                    onChange={(e) => setFormData({ ...formData, riskLevel: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  >
                    <option value="Low">Low Risk</option>
                    <option value="Medium">Medium Risk</option>
                    <option value="High">High Threat Corridor</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Corridor Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                >
                  <option value="Active">Active Corridor</option>
                  <option value="Suspended">Suspended</option>
                </select>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t border-slate-900">
                <button
                  type="button"
                  onClick={() => setIsDrawerOpen(false)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:text-slate-400 text-white rounded-lg font-semibold flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Saving...
                    </>
                  ) : (
                    "Save Corridor Config"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
