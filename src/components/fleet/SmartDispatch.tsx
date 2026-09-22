import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { enterpriseFetch } from "../../../client/api.ts";
import RecordAttachments from "../common/RecordAttachments.tsx";
import { 
  Play, 
  Navigation, 
  AlertCircle, 
  TrendingUp, 
  Compass, 
  DollarSign, 
  ShieldAlert, 
  Cpu, 
  Plus, 
  CheckCircle, 
  Layers, 
  Sparkles, 
  X, 
  ChevronRight, 
  Eye, 
  Gauge, 
  Thermometer, 
  MapPin, 
  ShieldCheck, 
  Activity, 
  AlertTriangle,
  Info,
  Calendar,
  User,
  Truck
} from "lucide-react";

interface Vehicle {
  id: number;
  vehicleNumber: string;
  vehicleType: string;
  currentStatus: string;
  insuranceExpiry?: string | null;
  fitnessExpiry?: string | null;
}

interface Driver {
  id: number;
  driverName: string;
  status: string;
  licenseExpiry?: string | null;
  medicalExpiry?: string | null;
  violationCount?: number;
}

interface TransitRoute {
  id: number;
  origin: string;
  destination: string;
  distance: number;
  expectedHours: number;
  benchmarkFuel: number;
  expectedToll: number;
  revenue: number;
}

interface Contractor {
  id: number;
  contractorName: string;
}

interface Trip {
  id: number;
  tripNumber: string;
  origin: string;
  destination: string;
  status: string;
  currentLat: number | null;
  currentLng: number | null;
  currentSpeed: number | null;
  remainingDistance: number | null;
  currentAddress: string | null;
  vehicleNumber: string;
  driverName: string;
  contractorId?: number;
}

interface CalculationResult {
  distance: number;
  expectedHours: number;
  benchmarkFuel: number;
  expectedToll: number;
  driverAllowance: number;
  estimatedCost: number;
  contractRevenue: number;
  expectedNetMargin: number;
  marginPercent: number;
  riskAudit: {
    insuranceValid: boolean;
    fitnessValid: boolean;
    licenseValid: boolean;
    hasViolations: boolean;
    clearedForTransit: boolean;
  };
}

interface SmartDispatchProps {
  showFeedback: (type: "success" | "error", message: string) => void;
}

export default function SmartDispatch({ showFeedback }: SmartDispatchProps) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [routes, setRoutes] = useState<TransitRoute[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);

  // Dispatch Form Selections
  const [selectedVehicle, setSelectedVehicle] = useState("");
  const [selectedDriver, setSelectedDriver] = useState("");
  const [selectedRoute, setSelectedRoute] = useState("");
  const [selectedContractor, setSelectedContractor] = useState("");
  const [dispatchResult, setDispatchResult] = useState<CalculationResult | null>(null);

  // New Smart Cargo & Priority State fields
  const [cargo, setCargo] = useState("");
  const [vehicleType, setVehicleType] = useState("Containerized");
  const [priority, setPriority] = useState("Medium");

  // Enterprise Fleet Control Center State variables
  const [selectedTripForDrawer, setSelectedTripForDrawer] = useState<Trip | null>(null);
  const [mapStyle, setMapStyle] = useState<"road" | "satellite">("road");
  const [showTrafficOverlay, setShowTrafficOverlay] = useState(true);
  const [showGeofences, setShowGeofences] = useState(true);

  // Map filters
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterContractor, setFilterContractor] = useState("All");

  // AI Optimizer State variables
  const [optimizing, setOptimizing] = useState(false);
  const [aiRecommendation, setAiRecommendation] = useState<any | null>(null);
  const [showAiModal, setShowAiModal] = useState(false);

  const fetchDependencies = async () => {
    try {
      const [vData, dData, rData, cData] = await Promise.all([
        enterpriseFetch("/api/operations/vehicles?limit=100"),
        enterpriseFetch("/api/operations/drivers?limit=100"),
        enterpriseFetch("/api/operations/routes"),
        enterpriseFetch("/api/operations/contractors"),
      ]);

      const loadedVehicles = vData?.data || [];
      const loadedDrivers = dData?.data || [];

      setVehicles(loadedVehicles);
      setDrivers(loadedDrivers);
      setRoutes(Array.isArray(rData) ? rData : []);
      setContractors(Array.isArray(cData) ? cData : []);
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to load dispatch dependency profiles");
    }
  };

  const fetchTrips = async () => {
    setLoading(true);
    try {
      const data = await enterpriseFetch("/api/operations/trips");
      setTrips(data);
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to load active dispatch trips");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDependencies();
    fetchTrips();
  }, []);

  // Filter lists to only show Available ones in manual selectors
  const availableVehicles = vehicles.filter(v => v.currentStatus === "Available");
  const availableDrivers = drivers.filter(d => d.status === "Available");

  const handleCalculate = async () => {
    if (!selectedVehicle || !selectedDriver || !selectedRoute || !selectedContractor) {
      showFeedback("error", "Please select vehicle, driver, corridor and corporate contractor to perform calculation.");
      return;
    }

    setCalculating(true);
    try {
      const data = await enterpriseFetch("/api/operations/dispatch/calculate", {
        method: "POST",
        body: JSON.stringify({
          vehicleId: Number(selectedVehicle),
          driverId: Number(selectedDriver),
          routeId: Number(selectedRoute),
          contractorId: Number(selectedContractor),
        }),
      });

      setDispatchResult(data);
      showFeedback("success", "Transit calculations and regulatory compliance checks complete!");
    } catch (err: any) {
      showFeedback("error", err.message || "Compliance calculation failed");
    } finally {
      setCalculating(false);
    }
  };

  const handleExecuteDispatch = async (vId?: string, dId?: string, rId?: string, cId?: string) => {
    const finalVehicle = vId || selectedVehicle;
    const finalDriver = dId || selectedDriver;
    const finalRoute = rId || selectedRoute;
    const finalContractor = cId || selectedContractor;

    if (!finalVehicle || !finalDriver || !finalRoute || !finalContractor) {
      showFeedback("error", "Incomplete dispatch details. Unable to schedule transit.");
      return;
    }

    // Run dynamic compliance check before executing
    const matchedVehicle = vehicles.find(v => String(v.id) === String(finalVehicle));
    const matchedDriver = drivers.find(d => String(d.id) === String(finalDriver));
    
    let isFullyCompliant = true;
    if (matchedVehicle && matchedDriver) {
      const now = new Date();
      const insuranceValid = matchedVehicle.insuranceExpiry ? new Date(matchedVehicle.insuranceExpiry) > now : false;
      const fitnessValid = matchedVehicle.fitnessExpiry ? new Date(matchedVehicle.fitnessExpiry) > now : false;
      const licenseValid = matchedDriver.licenseExpiry ? new Date(matchedDriver.licenseExpiry) > now : false;
      isFullyCompliant = insuranceValid && fitnessValid && licenseValid;
    }

    if (!isFullyCompliant) {
      if (!confirm("WARNING: The assigned vehicle or driver has expired compliance documents (Insurance, Road Fitness, or Driver License). Dispatch anyway under administrative waiver?")) {
        return;
      }
    }

    try {
      const data = await enterpriseFetch("/api/operations/dispatch/execute", {
        method: "POST",
        body: JSON.stringify({
          vehicleId: Number(finalVehicle),
          driverId: Number(finalDriver),
          routeId: Number(finalRoute),
          contractorId: Number(finalContractor),
        }),
      });

      showFeedback("success", `Enterprise transit scheduled! Route: ${data.tripNumber}`);
      
      // Reset form variables
      setSelectedVehicle("");
      setSelectedDriver("");
      setSelectedRoute("");
      setSelectedContractor("");
      setDispatchResult(null);
      setAiRecommendation(null);
      
      // Sync fresh records
      fetchDependencies();
      fetchTrips();
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to execute trip dispatch");
    }
  };

  const handleAIOptimize = async () => {
    if (!selectedRoute) {
      showFeedback("error", "Please select a Corridor/Route first to let Gemini optimize assets.");
      return;
    }

    setOptimizing(true);
    try {
      const data = await enterpriseFetch("/api/gemini/optimize", {
        method: "POST",
        body: JSON.stringify({ 
          routeId: selectedRoute,
          cargo,
          vehicleType,
          priority,
          contractorId: selectedContractor 
        }),
      });
      setAiRecommendation(data);
      setShowAiModal(true);
      showFeedback("success", "Gemini AI optimal vehicle and crew match compiled!");
    } catch (err: any) {
      showFeedback("error", err.message || "AI matching model failed");
    } finally {
      setOptimizing(false);
    }
  };

  const applyRecommendation = () => {
    if (!aiRecommendation) return;

    // Direct vehicle and driver selection update
    setSelectedVehicle(String(aiRecommendation.recommendedVehicleId));
    setSelectedDriver(String(aiRecommendation.recommendedDriverId));
    
    // Automatically trigger pre-dispatch margin calculation
    setDispatchResult({
      distance: routes.find(r => r.id === Number(selectedRoute))?.distance || 300,
      expectedHours: routes.find(r => r.id === Number(selectedRoute))?.expectedHours || 8,
      benchmarkFuel: aiRecommendation.estimatedFuel || 120,
      expectedToll: aiRecommendation.marginBreakdown?.tolls || 2000,
      driverAllowance: aiRecommendation.marginBreakdown?.driverAllowance || 5000,
      estimatedCost: aiRecommendation.estimatedCost || 35000,
      contractRevenue: aiRecommendation.estimatedRevenue || 55000,
      expectedNetMargin: aiRecommendation.marginBreakdown?.netMargin || 20000,
      marginPercent: aiRecommendation.profitMargin || 36,
      riskAudit: {
        insuranceValid: aiRecommendation.complianceDetails?.insuranceValid,
        fitnessValid: aiRecommendation.complianceDetails?.fitnessValid,
        licenseValid: aiRecommendation.complianceDetails?.licenseValid,
        hasViolations: false,
        clearedForTransit: aiRecommendation.complianceStatus === "Fully Compliant"
      }
    });

    setShowAiModal(false);
    showFeedback("success", "AI Selection applied! Calculations compiled in Margin Control Panel.");
  };

  return (
    <div className="space-y-6">
      {/* Plain-language explanation of what this screen does and how to use it */}
      <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex items-start gap-3">
        <div className="p-2 bg-emerald-600 text-white rounded-lg mt-0.5">
          <Info className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-800">Dispatch Board — start a new trip</h3>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            Use this before a truck leaves: pick the route, vehicle, driver and customer, then{" "}
            <strong>Calculate Pre-Dispatch Margin</strong> to see expected revenue minus fuel/toll/tax
            (or let <strong>Optimize with AI</strong> suggest a vehicle+driver pairing). It also checks
            that the vehicle's insurance/fitness and the driver's license/medical are still valid before
            you dispatch. Once you're happy with the numbers, click <strong>Approve Dispatch</strong> —
            that creates the trip, which then shows up on the GPS Map and in Trips.
          </p>
        </div>
      </div>

      {/* Top action layout */}
      <div className="flex items-center gap-3 bg-white p-5 border border-slate-100 rounded-xl shadow-sm">
        <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
          <Cpu className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">Smart Dispatch Console</h2>
          <p className="text-xs text-slate-500">Pick a trip, check the margin and compliance, then dispatch it</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Col 1 & 2: Dispatch Form and GPS Live Map */}
        <div className="lg:col-span-2 space-y-6">
          {/* Smart Selection Panel */}
          <div className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-600" /> 1. Configure Transit Dispatch
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Logistics Corridor *</label>
                <select
                  value={selectedRoute}
                  onChange={(e) => setSelectedRoute(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white transition-all font-medium"
                >
                  <option value="">-- Choose Corridor --</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>{r.origin} ➜ {r.destination} ({r.distance} km)</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Corporate Client / Customer *</label>
                <select
                  value={selectedContractor}
                  onChange={(e) => setSelectedContractor(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white transition-all font-medium"
                >
                  <option value="">-- Choose Customer --</option>
                  {contractors.map((c) => (
                    <option key={c.id} value={c.id}>{c.contractorName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Cargo Description</label>
                <input
                  type="text"
                  placeholder="e.g. Pharmaceutical cold storage vaccines, bulk steel"
                  value={cargo}
                  onChange={(e) => setCargo(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Required Vehicle</label>
                  <select
                    value={vehicleType}
                    onChange={(e) => setVehicleType(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white transition-all"
                  >
                    <option value="Containerized">Containerized</option>
                    <option value="Flatbed">Flatbed</option>
                    <option value="Reefer">Reefer (Cold-chain)</option>
                    <option value="Open High-side">Open High-side</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white transition-all"
                  >
                    <option value="Low">Low (Standard)</option>
                    <option value="Medium">Medium (Regular)</option>
                    <option value="High">High (Express)</option>
                    <option value="Express">Urgent (Overnight)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Manual Override Fields (collapsible if AI matching is utilized) */}
            <div className="pt-2">
              <span className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400 block mb-2">Manual Dispatch Selections</span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Vehicle Match Override</label>
                  <select
                    value={selectedVehicle}
                    onChange={(e) => setSelectedVehicle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none font-medium"
                  >
                    <option value="">-- Manual Select Vehicle --</option>
                    {availableVehicles.map((v) => (
                      <option key={v.id} value={v.id}>{v.vehicleNumber} ({v.vehicleType})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Driver Match Override</label>
                  <select
                    value={selectedDriver}
                    onChange={(e) => setSelectedDriver(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none font-medium"
                  >
                    <option value="">-- Manual Select Driver --</option>
                    {availableDrivers.map((d) => (
                      <option key={d.id} value={d.id}>{d.driverName}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-slate-100">
              <p className="text-[10px] text-slate-400 italic">Fields marked with * are necessary to run AI optimization</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAIOptimize}
                  disabled={optimizing}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-sm border border-emerald-700/20"
                  title="Prompt Gemini AI to recommend and match the compliant crew and vehicle combo"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {optimizing ? "Gemini AI Matching..." : "Optimize Dispatch with Gemini AI"}
                </button>
                <button
                  onClick={handleCalculate}
                  disabled={calculating}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition border border-slate-200"
                  title="Validate manual configurations and calculate operational margins"
                >
                  {calculating ? "Analyzing Compliance..." : "Calculate Pre-Dispatch Margin"}
                </button>
              </div>
            </div>
          </div>

          {/* Real-time Map Canvas */}
          <div className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-600" /> GPS Dispatch Hub & Live Radar
                </h3>
                <p className="text-[10px] text-slate-500">Live operational geofenced tracking matrix</p>
              </div>

              {/* Map controls and toggle buttons */}
              <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                <button
                  onClick={() => setMapStyle(mapStyle === "road" ? "satellite" : "road")}
                  className={`px-2.5 py-1 rounded transition border ${
                    mapStyle === "satellite" 
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700" 
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900"
                  }`}
                >
                  📡 {mapStyle === "satellite" ? "Satellite Mesh" : "Vector Road Map"}
                </button>
                <button
                  onClick={() => setShowTrafficOverlay(!showTrafficOverlay)}
                  className={`px-2.5 py-1 rounded transition border ${
                    showTrafficOverlay 
                      ? "bg-amber-50 border-amber-200 text-amber-700" 
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900"
                  }`}
                >
                  🚦 Traffic Status {showTrafficOverlay ? "ON" : "OFF"}
                </button>
                <button
                  onClick={() => setShowGeofences(!showGeofences)}
                  className={`px-2.5 py-1 rounded transition border ${
                    showGeofences 
                      ? "bg-blue-50 border-blue-200 text-blue-700" 
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900"
                  }`}
                >
                  🛡️ Geofences {showGeofences ? "Active" : "Hidden"}
                </button>
              </div>
            </div>

            {/* Live Filter bar above map */}
            <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 border border-slate-200 rounded-lg text-xs">
              <div>
                <label className="block text-[10px] text-slate-500 font-bold uppercase mb-1">Filter by Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded p-1 text-slate-800 focus:outline-none text-[11px]"
                >
                  <option value="All">All Active Statuses</option>
                  <option value="Scheduled">Scheduled</option>
                  <option value="Started">Started</option>
                  <option value="In Transit">In Transit</option>
                  <option value="Arrived">Arrived</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 font-bold uppercase mb-1">Filter by Customer</label>
                <select
                  value={filterContractor}
                  onChange={(e) => setFilterContractor(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded p-1 text-slate-800 focus:outline-none text-[11px]"
                >
                  <option value="All">All Customers</option>
                  {contractors.map(c => (
                    <option key={c.id} value={c.id}>{c.contractorName}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Interactive SVG / Canvas Map container */}
            <div className={`relative w-full h-[360px] rounded-xl border border-slate-100 overflow-hidden flex items-center justify-center transition-all duration-500 ${
              mapStyle === "satellite" ? "bg-slate-900" : "bg-slate-50"
            }`}>
              {/* Grid backdrop */}
              <div className={`absolute inset-0 bg-[radial-gradient(#cbd5e1_1.2px,transparent_1.2px)] [background-size:20px_20px] transition-opacity duration-500 ${
                mapStyle === "satellite" ? "opacity-10" : "opacity-30"
              }`} />

              {/* Fake satellite visual scan lines if active */}
              {mapStyle === "satellite" && (
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent pointer-events-none animate-pulse" />
              )}

              {/* Map layout design using SVG */}
              <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
                {/* Standard corridor line paths */}
                <path
                  d="M 120,280 Q 220,200 280,150 T 340,60"
                  fill="none"
                  stroke={mapStyle === "satellite" ? "#1e293b" : "#cbd5e1"}
                  strokeWidth="5"
                />
                <path
                  d="M 120,280 Q 220,200 280,150 T 340,60"
                  fill="none"
                  stroke={mapStyle === "satellite" ? "#22c55e" : "#16a34a"}
                  strokeWidth="1.5"
                  opacity="0.3"
                  strokeDasharray="4,4"
                />

                {/* Congested neon orange paths if traffic overlay is enabled */}
                {showTrafficOverlay && (
                  <>
                    <path
                      d="M 120,280 Q 220,200 280,150 T 340,60"
                      fill="none"
                      stroke="#ea580c"
                      strokeWidth="2.5"
                      strokeDasharray="10, 20"
                      opacity="0.5"
                      className="animate-[dash_8s_linear_infinite]"
                    />
                    {/* Concentrated red congestion zone near Lahore Entrance */}
                    <path
                      d="M 260,165 L 280,150"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="4"
                      opacity="0.7"
                    />
                    {/* Concentrated red congestion zone near Karachi Toll */}
                    <path
                      d="M 130,270 L 155,255"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="4"
                      opacity="0.7"
                    />
                  </>
                )}

                {/* Concentric shaded geofence boundaries around hubs if enabled */}
                {showGeofences && (
                  <>
                    {/* Karachi Geofence */}
                    <circle cx="120" cy="280" r="30" fill="none" stroke="#f43f5e" strokeWidth="1" strokeDasharray="3,3" opacity="0.4" />
                    <circle cx="120" cy="280" r="15" fill="none" stroke="#f43f5e" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.2" />
                    {/* Lahore Geofence */}
                    <circle cx="280" cy="150" r="35" fill="none" stroke="#16a34a" strokeWidth="1" strokeDasharray="3,3" opacity="0.4" />
                    <circle cx="280" cy="150" r="18" fill="none" stroke="#16a34a" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.2" />
                    {/* Peshawar Geofence */}
                    <circle cx="340" cy="60" r="25" fill="none" stroke="#2563eb" strokeWidth="1" strokeDasharray="3,3" opacity="0.4" />
                  </>
                )}

                {/* Hub anchors */}
                <g transform="translate(120, 280)">
                  <circle r="7" fill={mapStyle === "satellite" ? "#020617" : "#ffffff"} stroke="#2563eb" strokeWidth="3" />
                  <text x="14" y="3" fill={mapStyle === "satellite" ? "#ffffff" : "#1e293b"} fontSize="10" fontWeight="bold" className="pointer-events-none select-none">Karachi Port Hub</text>
                </g>
                <g transform="translate(280, 150)">
                  <circle r="7" fill={mapStyle === "satellite" ? "#020617" : "#ffffff"} stroke="#16a34a" strokeWidth="3" />
                  <text x="14" y="3" fill={mapStyle === "satellite" ? "#ffffff" : "#1e293b"} fontSize="10" fontWeight="bold" className="pointer-events-none select-none">Lahore Logistics HQ</text>
                </g>
                <g transform="translate(340, 60)">
                  <circle r="7" fill={mapStyle === "satellite" ? "#020617" : "#ffffff"} stroke="#7c3aed" strokeWidth="3" />
                  <text x="14" y="3" fill={mapStyle === "satellite" ? "#ffffff" : "#1e293b"} fontSize="10" fontWeight="bold" className="pointer-events-none select-none">Peshawar North Corridor</text>
                </g>

                {/* Active database trips rendered on map dynamically */}
                {trips
                  .filter((t) => {
                    if (t.status === "Completed") return false;
                    if (filterStatus !== "All" && t.status !== filterStatus) return false;
                    if (filterContractor !== "All" && String(t.contractorId) !== filterContractor) return false;
                    return true;
                  })
                  .map((t) => {
                    const latVal = t.currentLat || 31.52;
                    const lngVal = t.currentLng || 74.35;

                    const pctX = (lngVal - 60) / 15;
                    const pctY = (37 - latVal) / 13;

                    const x = 40 + pctX * 380;
                    const y = 30 + pctY * 260;

                    const isMoving = t.status === "In Transit";

                    return (
                      <g 
                        key={t.id} 
                        transform={`translate(${x}, ${y})`}
                        onClick={() => setSelectedTripForDrawer(t)}
                        className="cursor-pointer group"
                      >
                        {/* Interactive glow effect */}
                        <circle
                          r={isMoving ? "14" : "10"}
                          fill={isMoving ? "#16a34a" : "#2563eb"}
                          opacity="0.25"
                          className={isMoving ? "animate-ping" : "group-hover:scale-125 duration-200 transition-transform"}
                        />
                        <circle
                          r="6.5"
                          fill={
                            t.status === "In Transit" ? "#16a34a" :
                            t.status === "Scheduled" ? "#2563eb" :
                            t.status === "Arrived" ? "#f59e0b" : "#64748b"
                          }
                          stroke="#ffffff"
                          strokeWidth="2"
                        />
                        <text
                          y="-12"
                          fill={mapStyle === "satellite" ? "#ffffff" : "#0f172a"}
                          fontSize="9"
                          fontWeight="bold"
                          textAnchor="middle"
                          className="font-mono tracking-tighter select-none drop-shadow"
                        >
                          {t.vehicleNumber}
                        </text>
                      </g>
                    );
                  })}
              </svg>

              {/* Onboarding Empty Map Message if no active transit dispatches exist (Phase 9 & 11) */}
              {trips.filter(t => t.status !== "Completed").length === 0 && (
                <div className="absolute inset-x-8 bg-white/95 border border-slate-200 p-4.5 rounded-xl shadow-lg text-center max-w-sm pointer-events-auto">
                  <Compass className="w-8 h-8 text-slate-400 mx-auto mb-2 animate-bounce" />
                  <p className="text-xs font-semibold text-slate-700">No active dispatches currently on road.</p>
                  <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                    The radar scanner is fully calibrated. Please configure a new transit route and assign vehicles above to start live tracking.
                  </p>
                </div>
              )}

              {/* Telemetry live HUD */}
              {trips.filter(t => t.status === "In Transit").length > 0 && (
                <div className="absolute bottom-3 left-3 bg-slate-900/95 border border-slate-800 p-3.5 rounded-lg text-[10px] space-y-1.5 backdrop-blur max-w-xs text-white">
                  <p className="font-extrabold uppercase text-[8px] text-emerald-400 tracking-wider">Live Active Telemetry</p>
                  {trips
                    .filter(t => t.status === "In Transit")
                    .slice(0, 2)
                    .map(t => (
                      <div key={t.id} className="text-slate-300 font-mono flex justify-between gap-4 border-b border-white/5 pb-1 last:border-0 last:pb-0">
                        <span className="font-bold text-white">{t.vehicleNumber}</span>
                        <span>{t.currentSpeed} km/h • {t.remainingDistance ? Math.round(t.remainingDistance) : 0} km left</span>
                      </div>
                    ))}
                </div>
              )}

              {/* Interactive map hint */}
              <div className="absolute top-3 right-3 bg-white border border-slate-200 px-2 py-1 rounded text-[8px] text-slate-600 font-bold uppercase tracking-wide shadow-sm">
                🖱️ Click active vehicle nodes for logs
              </div>
            </div>
          </div>
        </div>

        {/* Col 3: Side control panels */}
        <div className="space-y-6">
          {/* Dispatch Margin & Calculations Control Panel (Phase 7 & 8) */}
          {dispatchResult ? (
            <div className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900">Margin Control Panel</h3>
              </div>

              {/* FINANCIAL BREAKDOWN WITH FORMULAS (Phase 7) */}
              <div className="space-y-2.5 text-xs">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-slate-500 font-bold uppercase text-[9px] tracking-wide">Route Contract Revenue</span>
                    <span className="font-bold text-slate-900 font-mono">PKR {dispatchResult.contractRevenue.toLocaleString()}</span>
                  </div>
                  <p className="text-[9px] text-slate-400 leading-normal">
                    Formula: Standard freight contract rate defined for the specific corridor.
                  </p>
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
                  <span className="text-slate-500 font-bold uppercase text-[9px] tracking-wide block border-b pb-1">Variable Cost Breakdown</span>
                  
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-600">Fuel Cost Estimation</span>
                    <span className="font-bold text-slate-800 font-mono">PKR {(dispatchResult.benchmarkFuel * 285).toLocaleString()}</span>
                  </div>
                  <p className="text-[9px] text-slate-400 leading-normal mb-2">
                    Formula: {dispatchResult.benchmarkFuel} Liters (Benchmark) × PKR 285/L (Diesel Price Index).
                  </p>

                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-600">Highway Toll Fees</span>
                    <span className="font-bold text-slate-800 font-mono">PKR {dispatchResult.expectedToll.toLocaleString()}</span>
                  </div>
                  <p className="text-[9px] text-slate-400 leading-normal mb-2">
                    Formula: Expected national highway transit tolls.
                  </p>

                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-600">Driver Allowance</span>
                    <span className="font-bold text-slate-800 font-mono">PKR {dispatchResult.driverAllowance.toLocaleString()}</span>
                  </div>
                  <p className="text-[9px] text-slate-400 leading-normal">
                    Formula: Standard driver food, lodging and overtime stipend.
                  </p>

                  <div className="border-t pt-2 space-y-1">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-600">Maintenance Reserve (5%)</span>
                      <span className="font-bold text-slate-800 font-mono">PKR {(dispatchResult.contractRevenue * 0.05).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-600">Tax Provision (10%)</span>
                      <span className="font-bold text-slate-800 font-mono">PKR {(dispatchResult.contractRevenue * 0.10).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-600">Insurance & Reserves (2%)</span>
                      <span className="font-bold text-slate-800 font-mono">PKR {(dispatchResult.contractRevenue * 0.02).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-600">Contingency Reserve (3%)</span>
                      <span className="font-bold text-slate-800 font-mono">PKR {(dispatchResult.contractRevenue * 0.03).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center py-2 px-1 border-t border-b">
                  <span className="text-slate-600 font-semibold">Total Operating Cost</span>
                  <span className="font-bold text-slate-900 font-mono">
                    PKR {(
                      (dispatchResult.benchmarkFuel * 285) + 
                      dispatchResult.expectedToll + 
                      dispatchResult.driverAllowance + 
                      (dispatchResult.contractRevenue * 0.20)
                    ).toLocaleString()}
                  </span>
                </div>

                <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex justify-between items-center">
                  <div>
                    <span className="text-[9px] text-green-700 font-extrabold uppercase">Net Transit Margin</span>
                    <p className="text-sm font-extrabold text-green-600 font-mono">
                      PKR {(
                        dispatchResult.contractRevenue - 
                        ((dispatchResult.benchmarkFuel * 285) + dispatchResult.expectedToll + dispatchResult.driverAllowance + (dispatchResult.contractRevenue * 0.20))
                      ).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] text-green-700 font-extrabold uppercase">Return on Investment (ROI)</span>
                    <p className="text-sm font-extrabold text-green-600 font-mono">
                      {(
                        ((dispatchResult.contractRevenue - 
                        ((dispatchResult.benchmarkFuel * 285) + dispatchResult.expectedToll + dispatchResult.driverAllowance + (dispatchResult.contractRevenue * 0.20))) / 
                        ((dispatchResult.benchmarkFuel * 285) + dispatchResult.expectedToll + dispatchResult.driverAllowance + (dispatchResult.contractRevenue * 0.20))) * 100
                      ).toFixed(1)}%
                    </p>
                  </div>
                </div>

                {/* COMPLIANCE CHECKLIST WITH EXPIRES (Phase 8) */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <h4 className="font-bold text-slate-900 text-[10px] uppercase tracking-wide">Regulatory Compliance Audit</h4>
                  
                  {/* Dynamic safety score */}
                  {(() => {
                    const matchedVehicle = vehicles.find(v => String(v.id) === String(selectedVehicle));
                    const matchedDriver = drivers.find(d => String(d.id) === String(selectedDriver));
                    const now = new Date();
                    
                    const insuranceValid = matchedVehicle?.insuranceExpiry ? new Date(matchedVehicle.insuranceExpiry) > now : false;
                    const fitnessValid = matchedVehicle?.fitnessExpiry ? new Date(matchedVehicle.fitnessExpiry) > now : false;
                    const licenseValid = matchedDriver?.licenseExpiry ? new Date(matchedDriver.licenseExpiry) > now : false;
                    const medicalValid = matchedDriver?.medicalExpiry ? new Date(matchedDriver.medicalExpiry) > now : false;
                    
                    let safetyScore = 0;
                    if (insuranceValid) safetyScore += 20;
                    if (fitnessValid) safetyScore += 20;
                    if (licenseValid) safetyScore += 20;
                    if (medicalValid) safetyScore += 20;
                    if (matchedDriver && (matchedDriver.violationCount || 0) === 0) safetyScore += 20;

                    return (
                      <div className="space-y-2.5">
                        <div className="flex justify-between items-center text-[10px] font-bold">
                          <span className="text-slate-500">FLEET OPERATIONAL INDEX</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] ${
                            safetyScore >= 80 ? "bg-green-100 text-green-700" :
                            safetyScore >= 60 ? "bg-amber-100 text-amber-700" :
                            "bg-red-100 text-red-700"
                          }`}>
                            {safetyScore}% COMPLIANT
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden flex">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${
                              safetyScore >= 80 ? "bg-green-600" :
                              safetyScore >= 60 ? "bg-amber-500" :
                              "bg-red-600"
                            }`}
                            style={{ width: `${safetyScore}%` }}
                          />
                        </div>

                        {/* Detailed credential rows (Phase 8) */}
                        <div className="space-y-1.5 border border-slate-100 p-2.5 rounded-lg bg-slate-50 text-[10px]">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-500">1. Vehicle Insurance Certification:</span>
                            <span className={`font-bold ${insuranceValid ? "text-green-600" : "text-red-600"}`}>
                              {insuranceValid ? `✓ Valid` : "Expired / Warning"}
                            </span>
                          </div>
                          {matchedVehicle?.insuranceExpiry && (
                            <p className="text-[9px] text-slate-400 font-mono text-right">Expires: {new Date(matchedVehicle.insuranceExpiry).toLocaleDateString()}</p>
                          )}

                          <div className="flex justify-between items-center border-t border-slate-200/50 pt-1.5">
                            <span className="text-slate-500">2. Motorway Fitness Certificate:</span>
                            <span className={`font-bold ${fitnessValid ? "text-green-600" : "text-red-600"}`}>
                              {fitnessValid ? `✓ Certified` : "Expired / Attention Required"}
                            </span>
                          </div>
                          {matchedVehicle?.fitnessExpiry && (
                            <p className="text-[9px] text-slate-400 font-mono text-right">Expires: {new Date(matchedVehicle.fitnessExpiry).toLocaleDateString()}</p>
                          )}

                          <div className="flex justify-between items-center border-t border-slate-200/50 pt-1.5">
                            <span className="text-slate-500">3. Driver Heavy Transport License:</span>
                            <span className={`font-bold ${licenseValid ? "text-green-600" : "text-red-600"}`}>
                              {licenseValid ? `✓ Active` : "Expired / Recalibration"}
                            </span>
                          </div>
                          {matchedDriver?.licenseExpiry && (
                            <p className="text-[9px] text-slate-400 font-mono text-right">Expires: {new Date(matchedDriver.licenseExpiry).toLocaleDateString()}</p>
                          )}

                          <div className="flex justify-between items-center border-t border-slate-200/50 pt-1.5">
                            <span className="text-slate-500">4. Driver Medical Fitness Clearance:</span>
                            <span className={`font-bold ${medicalValid ? "text-green-600" : "text-red-600"}`}>
                              {medicalValid ? `✓ Approved` : "Requires Medical Review"}
                            </span>
                          </div>
                          {matchedDriver?.medicalExpiry && (
                            <p className="text-[9px] text-slate-400 font-mono text-right">Expires: {new Date(matchedDriver.medicalExpiry).toLocaleDateString()}</p>
                          )}

                          <div className="flex justify-between items-center border-t border-slate-200/50 pt-1.5">
                            <span className="text-slate-500">5. Geofence Crossing Permit:</span>
                            <span className="font-bold text-green-600">✓ Fully Cleared</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <button
                  onClick={() => handleExecuteDispatch()}
                  className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition text-xs shadow-sm shadow-green-900/10 flex items-center justify-center gap-1.5"
                >
                  <Play className="w-4 h-4" /> Approve Dispatch & Activate Fleet
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-100 rounded-xl p-8 text-center text-xs text-slate-400 shadow-sm leading-relaxed">
              <TrendingUp className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="font-semibold text-slate-700">Margin Analyzer Idle</p>
              <p className="text-[10px] mt-1 text-slate-400">Select a Logistics Corridor and client to compute variable operating costs, highway tolls, taxes and ROI before scheduling.</p>
            </div>
          )}
        </div>
      </div>

      {/* Roster of active dispatches in the database */}
      <div className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 mb-4">Active Database Transit Dispatches</h3>

        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-slate-50 rounded animate-pulse" />
            ))}
          </div>
        ) : trips.length === 0 ? (
          <p className="text-center text-slate-400 text-xs py-6 font-medium">No active dispatches found on road database. Schedule a trip above to begin.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase text-[9px] font-bold">
                <tr>
                  <th className="p-3">Trip Number</th>
                  <th className="p-3">Vehicle / Driver</th>
                  <th className="p-3">Logistics Corridor</th>
                  <th className="p-3">Simulated Coordinates</th>
                  <th className="p-3">Odo / Distance Left</th>
                  <th className="p-3">Current Location</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trips.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-bold text-slate-800 font-mono">{t.tripNumber}</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-800">{t.vehicleNumber}</div>
                      <div className="text-[10px] text-slate-500 font-medium">{t.driverName}</div>
                    </td>
                    <td className="p-3 font-medium">
                      <div>{t.origin}</div>
                      <div className="text-[10px] text-slate-400">➜ {t.destination}</div>
                    </td>
                    <td className="p-3 font-mono text-[10px] text-slate-500">
                      {t.currentLat ? `${Number(t.currentLat).toFixed(4)}, ${Number(t.currentLng).toFixed(4)}` : "Not Dispatched"}
                    </td>
                    <td className="p-3 font-mono text-[10px] font-bold text-slate-700">
                      {t.remainingDistance ? `${Math.round(t.remainingDistance)} km left` : "0 km / Arrived"}
                    </td>
                    <td className="p-3 text-[10px] text-slate-500 max-w-[150px] truncate">
                      {t.currentAddress || "Pending dispatch Start"}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                        t.status === "Scheduled" ? "bg-blue-50 text-blue-700 border border-blue-100" :
                        t.status === "Started" ? "bg-amber-50 text-amber-700 border border-amber-100" :
                        t.status === "In Transit" ? "bg-green-50 text-green-700 border border-green-100" :
                        t.status === "Arrived" ? "bg-pink-50 text-pink-700 border border-pink-100" :
                        "bg-slate-50 text-slate-700 border border-slate-100"
                      }`}>
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* GPS TELEMETRY DRAWER: Uber Fleet / Yango inspired detailed drawer */}
      <AnimatePresence>
        {selectedTripForDrawer && (
          <div className="fixed inset-0 z-50 overflow-hidden pointer-events-none">
            {/* Backdrop */}
            <div 
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm pointer-events-auto"
              onClick={() => setSelectedTripForDrawer(null)}
            />

            {/* Slide-out Panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white border-l border-slate-100 shadow-2xl p-6 overflow-y-auto pointer-events-auto flex flex-col justify-between"
            >
              <div>
                {/* Header */}
                <div className="flex justify-between items-start pb-4 border-b border-slate-100">
                  <div>
                    <span className="text-[10px] font-mono font-bold bg-blue-50 border border-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                      {selectedTripForDrawer.tripNumber}
                    </span>
                    <h3 className="text-base font-extrabold text-slate-900 mt-1">{selectedTripForDrawer.vehicleNumber}</h3>
                    <p className="text-xs text-slate-500">Transit Corridor Telemetry Diagnostics</p>
                  </div>
                  <button
                    onClick={() => setSelectedTripForDrawer(null)}
                    className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-900 transition-colors"
                  >
                    ✕
                  </button>
                </div>

                {/* Main Stats Grid */}
                <div className="grid grid-cols-2 gap-3 my-6">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <span className="text-[10px] text-slate-500 block uppercase font-bold">Engine Status</span>
                    <p className="text-xs font-bold text-green-600 flex items-center gap-1.5 mt-1">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-ping" />
                      SYSTEM ONLINE
                    </p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <span className="text-[10px] text-slate-500 block uppercase font-bold">Current Speed</span>
                    <p className="text-sm font-mono font-extrabold text-slate-800 mt-1">
                      {selectedTripForDrawer.currentSpeed || 0} <span className="text-[10px] text-slate-400 font-sans font-normal">km/h</span>
                    </p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <span className="text-[10px] text-slate-500 block uppercase font-bold">Fuel Level</span>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-full bg-slate-200 h-2 rounded overflow-hidden">
                        <div className="bg-emerald-500 h-full rounded" style={{ width: "72%" }} />
                      </div>
                      <span className="text-xs font-mono text-slate-600 font-bold">72%</span>
                    </div>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <span className="text-[10px] text-slate-500 block uppercase font-bold">ETA Remaining</span>
                    <p className="text-xs font-mono text-slate-700 font-bold mt-1">
                      {selectedTripForDrawer.remainingDistance 
                        ? `${Math.round(selectedTripForDrawer.remainingDistance / 60)} hrs ${Math.round(selectedTripForDrawer.remainingDistance % 60)} mins`
                        : "0 mins (Arrived)"
                      }
                    </p>
                  </div>
                </div>

                {/* Logistics Crew details */}
                <div className="space-y-4">
                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500 block uppercase font-bold">Assigned Crew / Driver</span>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold">
                        {selectedTripForDrawer.driverName?.charAt(0)}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-800">{selectedTripForDrawer.driverName}</p>
                        <p className="text-[10px] text-slate-500 font-medium">Primary Heavy Transit Operator</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500 block uppercase font-bold">Route Path</span>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Origin Loading Terminal</span>
                        <span className="font-bold text-slate-800">{selectedTripForDrawer.origin}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Destination Discharging Hub</span>
                        <span className="font-bold text-slate-800">{selectedTripForDrawer.destination}</span>
                      </div>
                      <div className="flex justify-between border-t pt-2">
                        <span className="text-slate-500 font-semibold">Remaining Corridor Path</span>
                        <span className="font-bold text-emerald-600 font-mono">
                          {selectedTripForDrawer.remainingDistance ? Math.round(selectedTripForDrawer.remainingDistance) : 0} km left
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500 block uppercase font-bold">Live Address Context</span>
                    <p className="text-xs font-mono text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100 leading-relaxed">
                      📍 {selectedTripForDrawer.currentAddress || "Pending active transit signal..."}
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <RecordAttachments entityType="trip" entityId={selectedTripForDrawer.id} label="Trip documents / bilty / POD" />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 mt-6">
                <button
                  onClick={() => setSelectedTripForDrawer(null)}
                  className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold border border-slate-200 transition-colors"
                >
                  Close Telemetry Panel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* COMPREHENSIVE GEMINI AI RECOMMENDATION PROPOSAL MODAL (Phase 3, 6, 7 & 8) */}
      <AnimatePresence>
        {showAiModal && aiRecommendation && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div 
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setShowAiModal(false)}
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-2xl bg-white border border-slate-100 rounded-2xl p-6 shadow-2xl space-y-4 overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              {/* Top ambient green brand accent line */}
              <div className="absolute top-0 left-0 right-0 h-[4px] bg-[#16A34A]" />

              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">Gemini AI Dispatch Recommendation</h3>
                    <p className="text-[10px] text-slate-500">Autonomous multi-criteria fleet optimization & safety vetting</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAiModal(false)}
                  className="text-slate-400 hover:text-slate-900 text-xs p-1 rounded-full hover:bg-slate-50"
                >
                  ✕
                </button>
              </div>

              {/* Recommendation Proposal Content */}
              <div className="space-y-4 text-xs">
                {/* Scoring metrics (Phase 3 & 6) */}
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                    <span className="text-[9px] text-slate-500 uppercase font-bold block">Profit Margin</span>
                    <p className="text-sm font-mono font-extrabold text-green-600 mt-0.5">{aiRecommendation.profitMargin}%</p>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                    <span className="text-[9px] text-slate-500 uppercase font-bold block">Transit ETA</span>
                    <p className="text-sm font-mono font-extrabold text-slate-800 mt-0.5">{aiRecommendation.eta}</p>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                    <span className="text-[9px] text-slate-500 uppercase font-bold block">Compliance Stat</span>
                    <p className="text-xs font-bold text-blue-600 mt-1 truncate">{aiRecommendation.complianceStatus}</p>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-100">
                    <span className="text-[9px] text-slate-500 uppercase font-bold block">Risk Score</span>
                    <p className="text-sm font-mono font-extrabold text-red-600 mt-0.5">{aiRecommendation.riskScore}/100</p>
                  </div>
                </div>

                {/* Selected Asset Matching (Phase 3) */}
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 space-y-2.5">
                  <h4 className="font-bold text-[10px] uppercase tracking-wider text-slate-700">Recommended Fleet Pairing</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2.5 bg-white p-2.5 rounded-lg border border-slate-100">
                      <Truck className="w-5 h-5 text-slate-500" />
                      <div>
                        <span className="text-[9px] text-slate-400 uppercase font-bold block">Vehicle Selected</span>
                        <span className="font-bold text-slate-800 font-mono text-xs">{aiRecommendation.recommendedVehicleNumber}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 bg-white p-2.5 rounded-lg border border-slate-100">
                      <User className="w-5 h-5 text-slate-500" />
                      <div>
                        <span className="text-[9px] text-slate-400 uppercase font-bold block">Logistics Crew Assigned</span>
                        <span className="font-bold text-slate-800 text-xs">{aiRecommendation.recommendedDriverName}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* FINANCIAL BREAKDOWN TABLE (Phase 7) */}
                <div className="border border-slate-100 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 p-2.5 border-b font-extrabold text-slate-700 uppercase text-[9px] tracking-wide">
                    Pre-Dispatch Financial Feasibility Analysis
                  </div>
                  <div className="p-3 space-y-2 font-mono text-[11px] text-slate-700">
                    <div className="flex justify-between">
                      <span>Contract Freight Revenue:</span>
                      <span className="font-bold text-slate-900">PKR {aiRecommendation.marginBreakdown?.revenue?.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 pl-2">
                      <span>• Formula: Fixed pricing for Logistics Corridor</span>
                    </div>

                    <div className="flex justify-between border-t pt-1.5">
                      <span>Fuel Cost (Est):</span>
                      <span className="font-bold text-slate-800">PKR {aiRecommendation.marginBreakdown?.fuelCost?.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 pl-2">
                      <span>• Formula: Benchmark {aiRecommendation.estimatedFuel} Liters × PKR 285/L</span>
                    </div>

                    <div className="flex justify-between border-t pt-1.5">
                      <span>Tolls & Allowances:</span>
                      <span className="font-bold text-slate-800">PKR {((aiRecommendation.marginBreakdown?.tolls || 0) + (aiRecommendation.marginBreakdown?.driverAllowance || 0))?.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 pl-2">
                      <span>• Formula: Corridor toll fees + crew transit allowance stipend</span>
                    </div>

                    <div className="flex justify-between border-t pt-1.5">
                      <span>Taxes & Operating Provisions:</span>
                      <span className="font-bold text-slate-800">
                        PKR {(
                          (aiRecommendation.marginBreakdown?.taxes || 0) + 
                          (aiRecommendation.marginBreakdown?.maintenanceReserve || 0) + 
                          (aiRecommendation.marginBreakdown?.insuranceReserve || 0) + 
                          (aiRecommendation.marginBreakdown?.unexpectedCosts || 0)
                        )?.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 pl-2">
                      <span>• Formula: Prov. Tax (10%) + Maint. Res. (5%) + Insur. Res. (2%) + Contingency (3%)</span>
                    </div>

                    <div className="flex justify-between border-t pt-2 font-sans font-bold text-xs text-slate-900 bg-slate-50 p-1.5 rounded">
                      <span>Calculated Net Margin / ROI:</span>
                      <span className="text-green-600 font-mono">
                        PKR {aiRecommendation.marginBreakdown?.netMargin?.toLocaleString()} ({aiRecommendation.marginBreakdown?.roi?.toFixed(1)}% ROI)
                      </span>
                    </div>
                  </div>
                </div>

                {/* COMPLIANCE CERTIFICATE CHECKS (Phase 8) */}
                <div className="border border-slate-100 rounded-xl p-3.5 bg-slate-50 space-y-2 text-[10px]">
                  <h4 className="font-bold uppercase tracking-wider text-slate-700">Crew & Vehicle Regulatory Clearance Checks</h4>
                  <div className="grid grid-cols-2 gap-2.5 text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${aiRecommendation.complianceDetails?.insuranceValid ? "bg-green-500" : "bg-red-500"}`} />
                      <span>Vehicle Insurance: <strong>{aiRecommendation.complianceDetails?.insuranceValid ? "Vetted Valid" : "Expired / Attention"}</strong></span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${aiRecommendation.complianceDetails?.fitnessValid ? "bg-green-500" : "bg-red-500"}`} />
                      <span>Road Fitness Certificate: <strong>{aiRecommendation.complianceDetails?.fitnessValid ? "Certified Valid" : "Expired"}</strong></span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${aiRecommendation.complianceDetails?.licenseValid ? "bg-green-500" : "bg-red-500"}`} />
                      <span>Heavy Transport License: <strong>{aiRecommendation.complianceDetails?.licenseValid ? "Active Vetted" : "Expired / Warning"}</strong></span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      <span>Crew Medical Exam: <strong>Cleared ({aiRecommendation.complianceDetails?.medicalDaysRemaining} Days Remaining)</strong></span>
                    </div>
                  </div>
                </div>

                {/* Detailed Narrative Explanation (Phase 6) */}
                <div className="space-y-1">
                  <span className="text-[9px] text-slate-500 uppercase font-extrabold tracking-wider block">AI Vetting & Exclusion Narrative</span>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-[11px] text-slate-600 leading-relaxed font-sans max-h-[120px] overflow-y-auto">
                    {aiRecommendation.reasoning}
                  </div>
                </div>
              </div>

              {/* Action Buttons (Phase 3) */}
              <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100">
                <button
                  onClick={() => setShowAiModal(false)}
                  className="py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 rounded-lg text-xs font-bold transition"
                >
                  Discard AI Recommendations
                </button>
                <button
                  onClick={() => {
                    applyRecommendation();
                  }}
                  className="py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-xs transition shadow-md shadow-green-900/10"
                >
                  Confirm & Apply Optimal Match
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
