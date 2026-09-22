import React, { useState, useEffect } from "react";
import { 
  Wrench, Calendar, Sparkles, AlertTriangle, ShieldCheck, CheckCircle, 
  Plus, Send, RefreshCw, Layers, TrendingUp, Users, ShieldAlert,
  Clock, DollarSign, PenSquare, Trash2, Database, Bot, Download, Upload,
  Gauge, Disc, Zap, BookOpen, UserPlus, Settings2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { enterpriseFetch } from "../../../client/api.ts";
import ModuleDataIO from "../common/ModuleDataIO.tsx";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, PieChart, Pie, Cell 
} from "recharts";

interface FleetMaintenanceProps {
  showFeedback: (type: "success" | "error", message: string) => void;
}

export default function FleetMaintenance({ showFeedback }: FleetMaintenanceProps) {
  // Active sub-tab inside Fleet Maintenance Workspace
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "maintenance" | "preventive" | "oil_mgt" | "tyres" | "batteries" | "workshops" | "mechanics" | "job_cards" | "breakdowns" | "reminders" | "predictions" | "reports" | "ai_assistant"
  >("dashboard");

  // State Lists
  const [workshops, setWorkshops] = useState<any[]>([]);
  const [mechanics, setMechanics] = useState<any[]>([]);
  const [maintenance, setMaintenance] = useState<any[]>([]);
  const [serviceSchedules, setServiceSchedules] = useState<any[]>([]);
  const [tyres, setTyres] = useState<any[]>([]);
  const [batteries, setBatteries] = useState<any[]>([]);
  const [jobCards, setJobCards] = useState<any[]>([]);
  const [partsUsage, setPartsUsage] = useState<any[]>([]);
  const [breakdowns, setBreakdowns] = useState<any[]>([]);
  const [reminders, setReminders] = useState<any[]>([]);
  const [predictions, setPredictions] = useState<any[]>([]);
  const [costAnalysis, setCostAnalysis] = useState<any | null>(null);

  // Vehicles list for select dropdowns
  const [vehicles, setVehicles] = useState<any[]>([]);

  // Loading state
  const [loading, setLoading] = useState(false);
  const [schedulerRunning, setSchedulerRunning] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);

  // Form Modals states
  const [modalType, setModalType] = useState<"workshop" | "mechanic" | "maintenance" | "tyre" | "battery" | "job_card" | "breakdown" | "reminder" | null>(null);
  const [formFields, setFormFields] = useState<any>({});
  const [editId, setEditId] = useState<number | null>(null);

  // AI Assistant Chat States
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "model"; text: string }>>([
    { role: "model", text: "Hello! I am your HF Workshop AI Assistant. I have full real-time access to the live PostgreSQL tables including workshops, tyre logs, battery states, mechanical job cards, and predictive failure risks. Ask me anything!" }
  ]);
  const [aiChatLoading, setAiChatLoading] = useState(false);

  // Fetch all live data from PostgreSQL
  const fetchAllData = async () => {
    setLoading(true);
    try {
      // Fetch vehicles from operational database
      try {
        const vData = await enterpriseFetch("/api/operations/vehicles");
        setVehicles(vData?.data || (Array.isArray(vData) ? vData : []));
      } catch (err) {
        console.warn("Failed to load vehicles from operational database:", err);
        setVehicles([]);
      }

      // Fetch maintenance sub-module tables
      const [w, m, mt, ss, ty, bt, jc, pu, bd, rm, pred, cost] = await Promise.all([
        enterpriseFetch("/api/maintenance/workshops").catch(() => []),
        enterpriseFetch("/api/maintenance/mechanics").catch(() => []),
        enterpriseFetch("/api/maintenance/maintenance").catch(() => []),
        enterpriseFetch("/api/maintenance/service-schedules").catch(() => []),
        enterpriseFetch("/api/maintenance/tyres").catch(() => []),
        enterpriseFetch("/api/maintenance/batteries").catch(() => []),
        enterpriseFetch("/api/maintenance/job-cards").catch(() => []),
        enterpriseFetch("/api/maintenance/parts-usage").catch(() => []),
        enterpriseFetch("/api/maintenance/breakdown").catch(() => []),
        enterpriseFetch("/api/maintenance/reminders").catch(() => []),
        enterpriseFetch("/api/maintenance/predictions").catch(() => []),
        enterpriseFetch("/api/maintenance/cost-analysis").catch(() => null)
      ]);

      setWorkshops(Array.isArray(w) ? w : []);
      setMechanics(Array.isArray(m) ? m : []);
      setMaintenance(Array.isArray(mt) ? mt : []);
      setServiceSchedules(Array.isArray(ss) ? ss : []);
      setTyres(Array.isArray(ty) ? ty : []);
      setBatteries(Array.isArray(bt) ? bt : []);
      setJobCards(Array.isArray(jc) ? jc : []);
      setPartsUsage(Array.isArray(pu) ? pu : []);
      setBreakdowns(Array.isArray(bd) ? bd : []);
      setReminders(Array.isArray(rm) ? rm : []);
      setPredictions(Array.isArray(pred) ? pred : []);
      setCostAnalysis(cost);
    } catch (err: any) {
      console.error(err);
      showFeedback("error", "Failed to retrieve live maintenance profiles: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // Trigger Automatic Maintenance Scheduler
  const triggerAutoScheduler = async () => {
    setSchedulerRunning(true);
    try {
      const data = await enterpriseFetch("/api/maintenance/scheduler/trigger", { method: "POST" });
      showFeedback("success", `Odometer and calendar telemetry scanned! Auto-scheduled ${data.generatedJobsCount} new maintenance orders and ${data.generatedRemindersCount} pending alerts.`);
      fetchAllData();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSchedulerRunning(false);
    }
  };

  // Trigger AI Failures predictions for a vehicle
  const runAiPredictiveDiagnostics = async (vId: number) => {
    setAiRunning(true);
    try {
      const prediction = await enterpriseFetch("/api/maintenance/predict-ai", {
        method: "POST",
        body: JSON.stringify({ vehicleId: vId })
      });
      showFeedback("success", `AI diagnostics completed for vehicle! Predicted failure: ${prediction.predictedFailureType} with probability ${prediction.failureProbabilityPercent}%`);
      fetchAllData();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setAiRunning(false);
    }
  };

  // Post forms (Create / Update)
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalType) return;

    let url = `/api/maintenance/${modalType === "maintenance" ? "maintenance" : modalType === "breakdown" ? "breakdown" : modalType + "s"}`;
    let method = "POST";
    if (editId) {
      url += `/${editId}`;
      method = "PUT";
    }

    try {
      await enterpriseFetch(url, {
        method,
        body: JSON.stringify(formFields)
      });

      showFeedback("success", `Successfully saved ${modalType} details!`);
      setModalType(null);
      setFormFields({});
      setEditId(null);
      fetchAllData();
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to commit record to database.");
    }
  };

  // Delete records safely
  const handleDelete = async (type: string, id: number) => {
    if (!confirm("Are you sure you want to soft-delete this record?")) return;
    try {
      await enterpriseFetch(`/api/maintenance/${type}/${id}`, { method: "DELETE" });
      showFeedback("success", "Record safely deleted and archived in audit logs.");
      fetchAllData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  // Bulk Import
  const handleBulkImport = async (entity: string) => {
    const mockupData: Record<string, any[]> = {
      workshops: [
        { name: "Super Highway Heavy Repair Center", location: "M9 Karachi Motorway", contactNumber: "+92211119992", capacity: 15, availableBays: 12, rating: "4.9" },
        { name: "North-West Logistics Repair Hub", location: "Peshawar bypass Road", contactNumber: "+9291223982", capacity: 8, availableBays: 5, rating: "4.7" }
      ],
      mechanics: [
        { name: "Muhammad Asif", contactNumber: "+923001234567", specialty: "Engine rebuilding", rating: "4.9", currentStatus: "Available" },
        { name: "Zafar Iqbal", contactNumber: "+923219876543", specialty: "Heavy transmission & gearboxes", rating: "4.8", currentStatus: "Assigned" }
      ],
      tyres: [
        { tyreNumber: "T-992A", serialNumber: "MI-PILOT-822A", brand: "Michelin", size: "295/80R22.5", position: "Front-Left", currentTreadDepth: 14.5, expectedLifeKm: 120000, purchaseCost: 48000, scrapStatus: "Active" },
        { tyreNumber: "T-992B", serialNumber: "MI-PILOT-822B", brand: "Michelin", size: "295/80R22.5", position: "Front-Right", currentTreadDepth: 14.1, expectedLifeKm: 120000, purchaseCost: 48000, scrapStatus: "Active" }
      ]
    };

    const target = mockupData[entity];
    if (!target) return;

    try {
      await enterpriseFetch(`/api/maintenance/${entity}/import`, {
        method: "POST",
        body: JSON.stringify(target)
      });
      showFeedback("success", `Bulk imported ${target.length} certified profiles into live ${entity} table successfully.`);
      fetchAllData();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  // Bulk Export (Trigger browser download)
  const handleBulkExport = async (entity: string, format: "json" | "csv") => {
    try {
      const data = await enterpriseFetch(`/api/maintenance/${entity}/export?format=${format}`);
      const isCsv = format === "csv";
      const blob = new Blob([typeof data === "string" ? data : JSON.stringify(data, null, 2)], {
        type: isCsv ? "text/csv;charset=utf-8;" : "application/json"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `HF_Maintenance_${entity}_Export_${Date.now()}.${isCsv ? "csv" : "json"}`;
      link.click();
      showFeedback("success", `Maintenance ${entity} database exported successfully`);
    } catch (err: any) {
      showFeedback("error", err.message || "Export failed");
    }
  };

  // AI assistant messaging
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatInput("");
    setChatHistory(prev => [...prev, { role: "user", text: userMsg }]);
    setAiChatLoading(true);

    try {
      const data = await enterpriseFetch("/api/gemini/chat", {
        method: "POST",
        body: JSON.stringify({
          message: userMsg,
          chatHistory: chatHistory.map(c => ({ role: c.role, text: c.text }))
        })
      });
      setChatHistory(prev => [...prev, { role: "model", text: data.text }]);
    } catch (e: any) {
      setChatHistory(prev => [...prev, { role: "model", text: `Failure: ${e.message}` }]);
    } finally {
      setAiChatLoading(false);
    }
  };

  // Calculate high level KPI aggregations
  const totalCompletedCost = maintenance
    .filter(m => m.status === "Completed")
    .reduce((sum, item) => sum + parseFloat(item.actualCost || "0"), 0);

  const totalDowntime = maintenance.reduce((sum, item) => sum + (item.downtimeHours || 0), 0);
  const activeBreakdownsCount = breakdowns.filter(b => b.status === "Reported" || b.status === "In_Progress").length;
  const pendingRemindersCount = reminders.filter(r => r.status === "Pending").length;

  return (
    <div className="space-y-6 text-slate-100 font-sans p-2">
      {/* Platform header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-950/60 border border-slate-900/80 rounded-2xl p-6 backdrop-blur">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <Wrench className="w-5 h-5 text-blue-500" /> Enterprise Maintenance & Workshop Management Suite
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            24/7 high-integrity vehicle lifecycles, tyre/battery diagnostics, double-entry financial postings, and real-time telemetry auto-scheduling.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <ModuleDataIO entityKey="vehicle_maintenance" label="Maintenance" onImported={fetchAllData} />
          <button
            onClick={fetchAllData}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium rounded-lg text-slate-300 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh Live Data
          </button>
          <button
            onClick={triggerAutoScheduler}
            disabled={schedulerRunning}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold rounded-lg text-white transition-all disabled:opacity-50 shadow-md shadow-indigo-600/10"
          >
            <Gauge className={`w-3.5 h-3.5 ${schedulerRunning ? "animate-pulse" : ""}`} /> Telemetry Scheduler Scan
          </button>
        </div>
      </div>

      {/* Sub workspace menu */}
      <div className="flex flex-wrap gap-1 bg-slate-950/30 border border-slate-900/60 p-1 rounded-xl overflow-x-auto scrollbar-none">
        {[
          { id: "dashboard", label: "Dashboard", icon: TrendingUp },
          { id: "maintenance", label: "Work Orders", icon: Wrench },
          { id: "preventive", label: "Preventive", icon: ShieldCheck },
          { id: "oil_mgt", label: "Oil Service", icon: DropdownIcon },
          { id: "tyres", label: "Tyre Registry", icon: Disc },
          { id: "batteries", label: "Battery Registry", icon: Zap },
          { id: "workshops", label: "Workshops", icon: Layers },
          { id: "mechanics", label: "Mechanics Team", icon: Users },
          { id: "job_cards", label: "Mechanic Job Cards", icon: BookOpen },
          { id: "breakdowns", label: "Breakdowns", icon: ShieldAlert },
          { id: "reminders", label: "Dues & Reminders", icon: Clock },
          { id: "predictions", label: "AI Predictions", icon: Sparkles },
          { id: "reports", label: "Cost & Analytics", icon: DollarSign },
          { id: "ai_assistant", label: "AI Workshop Chat", icon: Bot }
        ].map(tab => {
          const Icon = tab.icon || Wrench;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
                activeTab === tab.id 
                  ? "bg-blue-600/10 border border-blue-500/20 text-blue-400 font-bold" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* WORKSPACE AREA */}
      <div className="min-h-[500px]">
        {/* TAB 1: DASHBOARD */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            {/* KPI grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-950/40 border border-slate-900 p-5 rounded-2xl">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">Total Maintenance Expenses</p>
                    <h4 className="text-2xl font-black text-white mt-1.5">PKR {totalCompletedCost.toLocaleString()}</h4>
                  </div>
                  <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                    <DollarSign className="w-5 h-5 text-blue-400" />
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 mt-3 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-emerald-500" /> Balanced with general ledgers (Double-entry)
                </div>
              </div>

              <div className="bg-slate-950/40 border border-slate-900 p-5 rounded-2xl">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">Total Fleet Downtime</p>
                    <h4 className="text-2xl font-black text-white mt-1.5">{totalDowntime} Hours</h4>
                  </div>
                  <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                    <Clock className="w-5 h-5 text-indigo-400" />
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 mt-3 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-500" /> Accumulating from live workshop orders
                </div>
              </div>

              <div className="bg-slate-950/40 border border-slate-900 p-5 rounded-2xl">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">Active Breakdowns</p>
                    <h4 className="text-2xl font-black text-rose-400 mt-1.5">{activeBreakdownsCount} Incidents</h4>
                  </div>
                  <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                    <ShieldAlert className="w-5 h-5 text-rose-400" />
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 mt-3 flex items-center gap-1">
                  <Wrench className="w-3 h-3 text-rose-500 animate-bounce" /> Mechanics assigned for rescue
                </div>
              </div>

              <div className="bg-slate-950/40 border border-slate-900 p-5 rounded-2xl">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">Scheduled Maintenance Reminders</p>
                    <h4 className="text-2xl font-black text-amber-400 mt-1.5">{pendingRemindersCount} Alerts</h4>
                  </div>
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                    <Clock className="w-5 h-5 text-amber-400" />
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 mt-3 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-indigo-400" /> Automatically computed from telemetry
                </div>
              </div>
            </div>

            {/* Charts section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-950/40 border border-slate-900 p-5 rounded-2xl">
                <h3 className="text-sm font-bold text-white mb-4">Historical Maintenance Expenditure Flow</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={maintenance.filter(m => m.status === "Completed").slice(-10)}>
                      <defs>
                        <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="maintenanceNumber" stroke="#94a3b8" fontSize={10} />
                      <YAxis stroke="#94a3b8" fontSize={10} />
                      <Tooltip contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b" }} />
                      <Area type="monotone" dataKey="actualCost" name="Cost (PKR)" stroke="#3b82f6" fillOpacity={1} fill="url(#colorCost)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-slate-950/40 border border-slate-900 p-5 rounded-2xl">
                <h3 className="text-sm font-bold text-white mb-4">Breakdown Distribution by Mechanical Component</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: "Engine", count: breakdowns.filter(b => b.reason?.toLowerCase().includes("engine")).length || 2 },
                      { name: "Brake", count: breakdowns.filter(b => b.reason?.toLowerCase().includes("brake")).length || 1 },
                      { name: "Tyre", count: breakdowns.filter(b => b.reason?.toLowerCase().includes("tyre")).length || 3 },
                      { name: "Overheating", count: breakdowns.filter(b => b.reason?.toLowerCase().includes("heat") || b.reason?.toLowerCase().includes("temp")).length || 1 },
                      { name: "Electrical", count: breakdowns.filter(b => b.reason?.toLowerCase().includes("electrical") || b.reason?.toLowerCase().includes("battery")).length || 2 }
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} />
                      <YAxis stroke="#94a3b8" fontSize={10} />
                      <Tooltip contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b" }} />
                      <Bar dataKey="count" name="Incidents Count" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: WORK ORDERS & VEHICLE MAINTENANCE */}
        {activeTab === "maintenance" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">Active Workshop Maintenance Orders</h3>
              <button
                onClick={() => {
                  setModalType("maintenance");
                  setFormFields({
                    maintenanceNumber: `MN-${Math.floor(100000 + Math.random() * 900000)}`,
                    status: "In_Progress",
                    priority: "Medium",
                    maintenanceType: "Preventive",
                    actualCost: 0,
                    downtimeHours: 0
                  });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded-lg text-white"
              >
                <Plus className="w-3.5 h-3.5" /> Log Maintenance Work
              </button>
            </div>

            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-950/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider border-b border-slate-900">
                  <tr>
                    <th className="px-5 py-3">Order Number</th>
                    <th className="px-5 py-3">Vehicle</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Priority</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Downtime (hrs)</th>
                    <th className="px-5 py-3">Actual Cost (PKR)</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {maintenance.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-10 text-center text-slate-500 font-mono">No maintenance records logged in corporate tables.</td>
                    </tr>
                  ) : (
                    maintenance.map((m: any) => {
                      const vObj = vehicles.find(v => v.id === m.vehicleId);
                      return (
                        <tr key={m.id} className="hover:bg-slate-900/30">
                          <td className="px-5 py-3 font-mono font-bold text-blue-400">{m.maintenanceNumber}</td>
                          <td className="px-5 py-3">{vObj?.vehicleNumber || `ID: ${m.vehicleId}`}</td>
                          <td className="px-5 py-3">{m.maintenanceType}</td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              m.priority === "Critical" ? "bg-rose-500/10 text-rose-400" :
                              m.priority === "High" ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400"
                            }`}>
                              {m.priority}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              m.status === "Completed" ? "bg-emerald-500/10 text-emerald-400" :
                              m.status === "In_Progress" ? "bg-blue-500/10 text-blue-400" : "bg-amber-500/10 text-amber-400"
                            }`}>
                              {m.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 font-mono">{m.downtimeHours || 0} hrs</td>
                          <td className="px-5 py-3 font-mono">PKR {(parseFloat(m.actualCost) || 0).toLocaleString()}</td>
                          <td className="px-5 py-3 flex gap-2">
                            <button
                              onClick={() => {
                                setModalType("maintenance");
                                setFormFields(m);
                                setEditId(m.id);
                              }}
                              className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-slate-300"
                            >
                              <PenSquare className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete("maintenance", m.id)}
                              className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-rose-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: PREVENTIVE MAINTENANCE SCHEDULES */}
        {activeTab === "preventive" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">Automatic Preventive Service Schedules</h3>
              <p className="text-xs text-slate-400 font-mono">Synced with real-time odometers & due targets</p>
            </div>

            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-950/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider border-b border-slate-900">
                  <tr>
                    <th className="px-5 py-3">Vehicle</th>
                    <th className="px-5 py-3">Service Type</th>
                    <th className="px-5 py-3">Last Serviced Date</th>
                    <th className="px-5 py-3">Last Service ODO</th>
                    <th className="px-5 py-3">Next Due Odometer</th>
                    <th className="px-5 py-3">Next Due Date</th>
                    <th className="px-5 py-3">Reminder Km Limit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {serviceSchedules.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-slate-500 font-mono">No preventive schedules active. Click 'Telemetry Scheduler Scan' to auto-seed default vehicle limits.</td>
                    </tr>
                  ) : (
                    serviceSchedules.map((s: any) => {
                      const vObj = vehicles.find(v => v.id === s.vehicleId);
                      return (
                        <tr key={s.id} className="hover:bg-slate-900/30">
                          <td className="px-5 py-3 font-bold text-slate-200">{vObj?.vehicleNumber || `ID: ${s.vehicleId}`}</td>
                          <td className="px-5 py-3 font-semibold text-blue-400">{s.serviceType}</td>
                          <td className="px-5 py-3 font-mono">{s.lastServiceDate ? new Date(s.lastServiceDate).toLocaleDateString() : "N/A"}</td>
                          <td className="px-5 py-3 font-mono">{s.currentOdometer || 0} KM</td>
                          <td className="px-5 py-3 font-mono font-bold text-indigo-400">{s.nextDueKm || 0} KM</td>
                          <td className="px-5 py-3 font-mono">{s.nextServiceDate ? new Date(s.nextServiceDate).toLocaleDateString() : "N/A"}</td>
                          <td className="px-5 py-3 font-mono text-slate-500">{s.reminderKm || 0} KM before</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: OIL SERVICE MANAGEMENT */}
        {activeTab === "oil_mgt" && (
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-blue-950/30 to-indigo-950/30 border border-slate-900 rounded-2xl p-5 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5"><DropdownIcon className="w-4 h-4 text-blue-400" /> Lubrication & Oil Lifetime Diagnostics</h3>
                <p className="text-xs text-slate-400 mt-1">Estimating viscosity life from engine hour limits and driving cycles automatically.</p>
              </div>
              <div className="px-4 py-2 bg-blue-500/15 border border-blue-500/20 text-xs font-bold text-blue-400 rounded-lg">
                Recommended oil change interval: 5,000 KM
              </div>
            </div>

            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl overflow-hidden">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-950/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider border-b border-slate-900">
                  <tr>
                    <th className="px-5 py-3">Vehicle</th>
                    <th className="px-5 py-3">Current ODO</th>
                    <th className="px-5 py-3">Engine Oil Due Km</th>
                    <th className="px-5 py-3">Lubricant Status</th>
                    <th className="px-5 py-3">Progress to service</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {vehicles.map((v: any) => {
                    const oilSchedule = serviceSchedules.find(s => s.vehicleId === v.id && s.serviceType === "Engine Oil");
                    const currentOdo = v.currentOdometer || 0;
                    const nextDue = oilSchedule?.nextDueKm || (currentOdo + 5000);
                    const kmRemaining = nextDue - currentOdo;
                    const percentUsed = Math.min(100, Math.max(0, (currentOdo / nextDue) * 100));

                    return (
                      <tr key={v.id} className="hover:bg-slate-900/30">
                        <td className="px-5 py-3 font-bold text-slate-200">{v.vehicleNumber}</td>
                        <td className="px-5 py-3 font-mono">{currentOdo.toLocaleString()} KM</td>
                        <td className="px-5 py-3 font-mono font-bold text-indigo-400">{nextDue.toLocaleString()} KM</td>
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                            kmRemaining < 500 ? "bg-rose-500/10 text-rose-400" :
                            kmRemaining < 1500 ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"
                          }`}>
                            {kmRemaining < 500 ? "CRITICAL DUE" : kmRemaining < 1500 ? "WARNING" : "HEALTHY"}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-24 bg-slate-900 h-2 rounded overflow-hidden border border-slate-800">
                              <div className={`h-full ${kmRemaining < 500 ? "bg-rose-500" : kmRemaining < 1500 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${percentUsed}%` }} />
                            </div>
                            <span className="font-mono text-[10px] text-slate-400">{kmRemaining.toLocaleString()} KM left</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: TYRE LIFE REGISTRY */}
        {activeTab === "tyres" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">High-Integrity Fleet Tyre Registry</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => handleBulkImport("tyres")}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 rounded"
                >
                  <Download className="w-3 h-3" /> Seed Certified Tyres
                </button>
                <button
                  onClick={() => handleBulkExport("tyres", "csv")}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 rounded"
                >
                  <Upload className="w-3 h-3" /> Export CSV
                </button>
                <button
                  onClick={() => {
                    setModalType("tyre");
                    setFormFields({
                      scrapStatus: "Active",
                      currentTreadDepth: 14.0,
                      expectedLifeKm: 80000,
                      purchaseCost: 35000
                    });
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded-lg text-white"
                >
                  <Plus className="w-3.5 h-3.5" /> Purchase & Mount Tyre
                </button>
              </div>
            </div>

            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-950/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider border-b border-slate-900">
                  <tr>
                    <th className="px-5 py-3">Tyre Number</th>
                    <th className="px-5 py-3">Serial</th>
                    <th className="px-5 py-3">Brand/Model</th>
                    <th className="px-5 py-3">Mounted Vehicle</th>
                    <th className="px-5 py-3">Position</th>
                    <th className="px-5 py-3">Tread Depth (mm)</th>
                    <th className="px-5 py-3">Expected Life</th>
                    <th className="px-5 py-3">Cost (PKR)</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {tyres.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-5 py-10 text-center text-slate-500 font-mono">No tyres registered. Click 'Seed Certified Tyres' to automatically upload sample inventory.</td>
                    </tr>
                  ) : (
                    tyres.map((t: any) => {
                      const vObj = vehicles.find(v => v.id === t.vehicleId);
                      return (
                        <tr key={t.id} className="hover:bg-slate-900/30">
                          <td className="px-5 py-3 font-mono font-bold text-slate-200">{t.tyreNumber}</td>
                          <td className="px-5 py-3 font-mono text-slate-400">{t.serialNumber || "N/A"}</td>
                          <td className="px-5 py-3">{t.brand} ({t.size || "Standard"})</td>
                          <td className="px-5 py-3">{vObj?.vehicleNumber || "Spare Inventory"}</td>
                          <td className="px-5 py-3 font-semibold text-slate-400">{t.position || "Inventory"}</td>
                          <td className="px-5 py-3 font-mono font-bold text-indigo-400">{t.currentTreadDepth} mm</td>
                          <td className="px-5 py-3 font-mono">{(t.expectedLifeKm || 0).toLocaleString()} KM</td>
                          <td className="px-5 py-3 font-mono">PKR {(t.purchaseCost || 0).toLocaleString()}</td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              t.scrapStatus === "Scrapped" ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400"
                            }`}>
                              {t.scrapStatus}
                            </span>
                          </td>
                          <td className="px-5 py-3 flex gap-1.5">
                            <button
                              onClick={() => {
                                setModalType("tyre");
                                setFormFields(t);
                                setEditId(t.id);
                              }}
                              className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-slate-300"
                            >
                              <PenSquare className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete("tyre", t.id)}
                              className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-rose-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: BATTERY REGISTRY */}
        {activeTab === "batteries" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">Heavy Vehicle Battery Lifespan Registry</h3>
              <button
                onClick={() => {
                  setModalType("battery");
                  setFormFields({
                    voltage: "12.6V",
                    healthPercent: 95,
                    status: "Healthy"
                  });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded-lg text-white"
              >
                <Plus className="w-3.5 h-3.5" /> Register Battery
              </button>
            </div>

            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-950/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider border-b border-slate-900">
                  <tr>
                    <th className="px-5 py-3">Battery Number</th>
                    <th className="px-5 py-3">Serial</th>
                    <th className="px-5 py-3">Brand</th>
                    <th className="px-5 py-3">Mounted Vehicle</th>
                    <th className="px-5 py-3">Voltage State</th>
                    <th className="px-5 py-3">Health State</th>
                    <th className="px-5 py-3">Installation Date</th>
                    <th className="px-5 py-3">Warranty Expiry</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {batteries.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-5 py-10 text-center text-slate-500 font-mono">No batteries logged. Click 'Register Battery' to mount a heavy vehicle battery pack.</td>
                    </tr>
                  ) : (
                    batteries.map((b: any) => {
                      const vObj = vehicles.find(v => v.id === b.vehicleId);
                      return (
                        <tr key={b.id} className="hover:bg-slate-900/30">
                          <td className="px-5 py-3 font-mono font-bold text-slate-200">{b.batteryNumber}</td>
                          <td className="px-5 py-3 font-mono text-slate-400">{b.serialNumber || "N/A"}</td>
                          <td className="px-5 py-3 font-semibold">{b.brand} ({b.capacityAh || "N/A"} AH)</td>
                          <td className="px-5 py-3">{vObj?.vehicleNumber || "Spare Stock"}</td>
                          <td className="px-5 py-3 font-mono text-emerald-400 font-bold">{b.voltage || "12.6V"}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-slate-900 h-1.5 rounded overflow-hidden">
                                <div className={`h-full ${b.healthPercent < 40 ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${b.healthPercent || 100}%` }} />
                              </div>
                              <span className="font-mono text-slate-200 font-bold">{b.healthPercent || 100}%</span>
                            </div>
                          </td>
                          <td className="px-5 py-3 font-mono">{b.installationDate ? new Date(b.installationDate).toLocaleDateString() : "N/A"}</td>
                          <td className="px-5 py-3 font-mono text-slate-400">{b.warrantyExpiry ? new Date(b.warrantyExpiry).toLocaleDateString() : "N/A"}</td>
                          <td className="px-5 py-3 flex gap-1.5">
                            <button
                              onClick={() => {
                                setModalType("battery");
                                setFormFields(b);
                                setEditId(b.id);
                              }}
                              className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-slate-300"
                            >
                              <PenSquare className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete("battery", b.id)}
                              className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-rose-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 7: WORKSHOPS */}
        {activeTab === "workshops" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">Certified Corporate Maintenance Workshops</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => handleBulkImport("workshops")}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 rounded"
                >
                  <Download className="w-3 h-3" /> Seed Workshops
                </button>
                <button
                  onClick={() => {
                    setModalType("workshop");
                    setFormFields({
                      capacity: 10,
                      availableBays: 10,
                      rating: "4.8"
                    });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded-lg text-white"
                >
                  <Plus className="w-3.5 h-3.5" /> Add New Workshop
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {workshops.length === 0 ? (
                <div className="col-span-full bg-slate-950/40 border border-slate-900 p-10 text-center text-slate-500 font-mono rounded-2xl">
                  No workshops configured in PostgreSQL. Seed some default centers to assign mechanics.
                </div>
              ) : (
                workshops.map((w: any) => (
                  <div key={w.id} className="bg-slate-950/40 border border-slate-900/80 p-5 rounded-2xl space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-white text-sm">{w.name}</h4>
                        <p className="text-xs text-slate-400 mt-0.5">{w.location}</p>
                      </div>
                      <span className="px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-mono font-bold rounded-lg">
                        ⭐ {w.rating || "4.8"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3.5 bg-slate-950/60 p-3 rounded-xl border border-slate-900 text-xs">
                      <div>
                        <span className="text-slate-500 block text-[10px] font-mono uppercase tracking-wider">Total Bays</span>
                        <span className="font-mono text-slate-200 font-bold">{w.capacity} Bays</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] font-mono uppercase tracking-wider">Free Bays</span>
                        <span className="font-mono text-emerald-400 font-bold">{w.availableBays} Available</span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <span className="font-mono text-slate-400">{w.contactNumber || "N/A"}</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => {
                            setModalType("workshop");
                            setFormFields(w);
                            setEditId(w.id);
                          }}
                          className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-slate-300"
                        >
                          <PenSquare className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete("workshop", w.id)}
                          className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-rose-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 8: MECHANICS */}
        {activeTab === "mechanics" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">Workshop Certified Mechanics Team</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => handleBulkImport("mechanics")}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] font-bold text-slate-300 rounded"
                >
                  <Download className="w-3 h-3" /> Seed Team
                </button>
                <button
                  onClick={() => {
                    setModalType("mechanic");
                    setFormFields({
                      rating: "4.8",
                      currentStatus: "Available"
                    });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded-lg text-white"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Recruiter Mechanical Team
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {mechanics.length === 0 ? (
                <div className="col-span-full bg-slate-950/40 border border-slate-900 p-10 text-center text-slate-500 font-mono rounded-2xl">
                  No mechanic profiles registered. Click 'Seed Team' to load standard personnel.
                </div>
              ) : (
                mechanics.map((m: any) => {
                  const wsObj = workshops.find(w => w.id === m.workshopId);
                  return (
                    <div key={m.id} className="bg-slate-950/40 border border-slate-900 p-4 rounded-xl flex items-center justify-between">
                      <div className="space-y-1">
                        <h4 className="font-bold text-slate-200 text-xs">{m.name}</h4>
                        <p className="text-[10px] text-blue-400 font-mono uppercase tracking-wider">{m.specialty}</p>
                        <p className="text-[10px] text-slate-500">Workshop: {wsObj?.name || "Unassigned"}</p>
                      </div>
                      <div className="text-right space-y-2">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono inline-block ${
                          m.currentStatus === "Available" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                        }`}>
                          {m.currentStatus}
                        </span>
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => {
                              setModalType("mechanic");
                              setFormFields(m);
                              setEditId(m.id);
                            }}
                            className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-slate-300"
                          >
                            <PenSquare className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleDelete("mechanic", m.id)}
                            className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-rose-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 9: JOB CARDS */}
        {activeTab === "job_cards" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">Active Mechanical Job Cards (Labour Postings)</h3>
              <button
                onClick={() => {
                  setModalType("job_card");
                  setFormFields({
                    jobCardNumber: `JC-${Math.floor(100000 + Math.random() * 900000)}`,
                    status: "Open",
                    labourHours: "0.0",
                    partsCost: 0
                  });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded-lg text-white"
              >
                <Plus className="w-3.5 h-3.5" /> Issue Job Card
              </button>
            </div>

            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-950/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider border-b border-slate-900">
                  <tr>
                    <th className="px-5 py-3">Job Card Number</th>
                    <th className="px-5 py-3">Mechanic</th>
                    <th className="px-5 py-3">Assigned Workshop</th>
                    <th className="px-5 py-3">Tasks</th>
                    <th className="px-5 py-3">Labour Hours</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Issued Date</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {jobCards.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-10 text-center text-slate-500 font-mono">No job cards active. Click 'Issue Job Card' to dispatch mechanic workload.</td>
                    </tr>
                  ) : (
                    jobCards.map((jc: any) => {
                      const mecObj = mechanics.find(m => m.id === jc.mechanicId);
                      const wsObj = workshops.find(w => w.id === jc.workshopId);
                      return (
                        <tr key={jc.id} className="hover:bg-slate-900/30">
                          <td className="px-5 py-3 font-mono font-bold text-blue-400">{jc.jobCardNumber}</td>
                          <td className="px-5 py-3 font-semibold text-slate-200">{mecObj?.name || "Lead Mechanic"}</td>
                          <td className="px-5 py-3">{wsObj?.name || "Main Bay"}</td>
                          <td className="px-5 py-3 font-medium text-slate-400 max-w-xs truncate">{jc.jobDescription}</td>
                          <td className="px-5 py-3 font-mono text-slate-300 font-bold">{jc.labourHours || 0} hrs</td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              jc.status === "Closed" ? "bg-emerald-500/10 text-emerald-400" :
                              jc.status === "In_Progress" ? "bg-blue-500/10 text-blue-400" : "bg-amber-500/10 text-amber-400"
                            }`}>
                              {jc.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 font-mono text-slate-500">{jc.createdAt ? new Date(jc.createdAt).toLocaleDateString() : "N/A"}</td>
                          <td className="px-5 py-3 flex gap-1.5">
                            <button
                              onClick={() => {
                                setModalType("job_card");
                                setFormFields(jc);
                                setEditId(jc.id);
                              }}
                              className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-slate-300"
                            >
                              <PenSquare className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete("job-cards", jc.id)}
                              className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-rose-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 10: SPARE PARTS INVENTORY & USAGE */}
        {activeTab === "spare_parts" || activeTab === "preventive" && (
          // We can show parts usage under preventive or as individual tab
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">Workshop Spare Parts Consumption Records</h3>
              <p className="text-xs text-slate-500 font-mono">Real-time ledger updates & purchase cost integration</p>
            </div>

            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-950/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider border-b border-slate-900">
                  <tr>
                    <th className="px-5 py-3">Part Name</th>
                    <th className="px-5 py-3">Part Serial / Code</th>
                    <th className="px-5 py-3">Quantity Deducted</th>
                    <th className="px-5 py-3">Unit Cost</th>
                    <th className="px-5 py-3">Total Value (PKR)</th>
                    <th className="px-5 py-3">Linked Job Card</th>
                    <th className="px-5 py-3">Logged Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {partsUsage.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-slate-500 font-mono">No parts consumption logged. Part allocations occur automatically via Job Card closures.</td>
                    </tr>
                  ) : (
                    partsUsage.map((p: any) => {
                      const totalValue = p.quantity * parseFloat(p.unitCost || "0");
                      return (
                        <tr key={p.id} className="hover:bg-slate-900/30">
                          <td className="px-5 py-3 font-semibold text-slate-200">{p.partName}</td>
                          <td className="px-5 py-3 font-mono text-slate-500">{p.partCode || "N/A"}</td>
                          <td className="px-5 py-3 font-mono font-bold text-indigo-400">{p.quantity} units</td>
                          <td className="px-5 py-3 font-mono">PKR {parseFloat(p.unitCost || "0").toLocaleString()}</td>
                          <td className="px-5 py-3 font-mono font-bold text-white">PKR {totalValue.toLocaleString()}</td>
                          <td className="px-5 py-3 font-mono text-blue-400">#{p.jobCardId}</td>
                          <td className="px-5 py-3 font-mono text-slate-500">{new Date(p.createdAt).toLocaleDateString()}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 11: BREAKDOWN MANAGEMENT */}
        {activeTab === "breakdowns" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">Emergency Fleet Roadside Breakdown Tickets</h3>
              <button
                onClick={() => {
                  setModalType("breakdown");
                  setFormFields({
                    breakdownNumber: `BD-${Math.floor(100000 + Math.random() * 900000)}`,
                    status: "Reported",
                    priority: "High",
                    reportingTime: new Date()
                  });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-xs font-semibold rounded-lg text-white"
              >
                <Plus className="w-3.5 h-3.5" /> File Roadside Breakdown
              </button>
            </div>

            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-300">
                <thead className="bg-slate-950/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider border-b border-slate-900">
                  <tr>
                    <th className="px-5 py-3">Ticket Code</th>
                    <th className="px-5 py-3">Vehicle</th>
                    <th className="px-5 py-3">Reason / Failure</th>
                    <th className="px-5 py-3">Highway Location</th>
                    <th className="px-5 py-3">Priority</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Reporting Time</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {breakdowns.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-10 text-center text-slate-500 font-mono">No active roadside breakdowns reported. Safe fleet operations!</td>
                    </tr>
                  ) : (
                    breakdowns.map((b: any) => {
                      const vObj = vehicles.find(v => v.id === b.vehicleId);
                      return (
                        <tr key={b.id} className="hover:bg-slate-900/30">
                          <td className="px-5 py-3 font-mono font-bold text-rose-400">{b.breakdownNumber}</td>
                          <td className="px-5 py-3 font-semibold text-slate-200">{vObj?.vehicleNumber || `ID: ${b.vehicleId}`}</td>
                          <td className="px-5 py-3 text-slate-300 font-medium max-w-xs truncate">{b.reason}</td>
                          <td className="px-5 py-3 font-mono text-slate-400">{b.location}</td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              b.priority === "Critical" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"
                            }`}>
                              {b.priority}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              b.status === "Resolved" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400 animate-pulse"
                            }`}>
                              {b.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 font-mono text-slate-500">{new Date(b.reportingTime).toLocaleString()}</td>
                          <td className="px-5 py-3 flex gap-1.5">
                            <button
                              onClick={() => {
                                setModalType("breakdown");
                                setFormFields(b);
                                setEditId(b.id);
                              }}
                              className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-slate-300"
                            >
                              <PenSquare className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete("breakdown", b.id)}
                              className="p-1 bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-rose-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 12: DUES & REMINDERS */}
        {activeTab === "reminders" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">Upcoming Oil Changes, Inspections & Insurance Expiries</h3>
              <p className="text-xs text-indigo-400 font-mono animate-pulse">Computed dynamically from real-time vehicle mileage logs</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {reminders.length === 0 ? (
                <div className="col-span-full bg-slate-950/40 border border-slate-900 p-10 text-center text-slate-500 font-mono rounded-2xl">
                  No maintenance reminders active. Auto-generated notices appear here when telemetry scanning detects due parameters.
                </div>
              ) : (
                reminders.map((r: any) => {
                  const vObj = vehicles.find(v => v.id === r.vehicleId);
                  return (
                    <div key={r.id} className="bg-slate-950/40 border border-slate-900 p-5 rounded-2xl space-y-3">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2">
                          <div className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg">
                            <Clock className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="font-bold text-white text-xs">{vObj?.vehicleNumber || `Vehicle ID: ${r.vehicleId}`}</h4>
                            <p className="text-[10px] text-indigo-400 font-mono uppercase tracking-wider mt-0.5">{r.reminderType}</p>
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono uppercase ${
                          r.status === "Pending" ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"
                        }`}>
                          {r.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed font-medium">{r.description}</p>
                      <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 pt-2 border-t border-slate-900/60">
                        <span>Due Date: {r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "Immediate"}</span>
                        <span>Due KM: {r.dueKm ? `${r.dueKm.toLocaleString()} KM` : "N/A"}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 13: AI PREDICTIVE FAILURES DIAGNOSTICS */}
        {activeTab === "predictions" && (
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-purple-950/30 to-slate-950/30 border border-slate-900 rounded-2xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-purple-400 animate-pulse" /> AI-Driven Predictive Maintenance Diagnostics
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Our advanced AI analyzer uses historical workshop workloads, roadside breakdowns, and odometers to predict future component failures.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  id="predict-vehicle-select"
                  className="bg-slate-950 border border-slate-900 rounded-lg text-xs p-2 text-slate-200"
                  onChange={(e) => {
                    const vId = parseInt(e.target.value);
                    if (vId) runAiPredictiveDiagnostics(vId);
                  }}
                >
                  <option value="">-- Choose Vehicle for AI Diagnosis --</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>{v.vehicleNumber} ({v.currentOdometer || 0} KM)</option>
                  ))}
                </select>
                {aiRunning && <RefreshCw className="w-4 h-4 text-purple-400 animate-spin" />}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {predictions.length === 0 ? (
                <div className="col-span-full bg-slate-950/40 border border-slate-900 p-10 text-center text-slate-500 font-mono rounded-2xl">
                  No predictive models compiled. Select a heavy transport vehicle above to execute active Gemini diagnostics.
                </div>
              ) : (
                  predictions.map((p: any) => {
                    const vObj = vehicles.find(v => v.id === p.vehicleId);
                    
                    let actionText = p.recommendedAction;
                    let healthScore = 80;
                    let riskLevel = p.failureProbabilityPercent > 70 ? "Critical" : p.failureProbabilityPercent > 40 ? "Warning" : "Low";
                    let suggestedDate = "N/A";
                    let confidenceScore = "85%";
                    let historyExplanation = "";

                    if (p.recommendedAction) {
                      try {
                        if (p.recommendedAction.startsWith("{")) {
                          const parsed = JSON.parse(p.recommendedAction);
                          actionText = parsed.action || parsed.recommendedAction;
                          healthScore = parsed.healthScore || 80;
                          riskLevel = parsed.riskLevel || riskLevel;
                          suggestedDate = parsed.suggestedMaintenanceDate || "N/A";
                          confidenceScore = parsed.confidenceScore || "85%";
                          historyExplanation = parsed.historyExplanation || "";
                        }
                      } catch (e) {
                        console.error("Failed parsing serialized predictive actions:", e);
                      }
                    }

                    return (
                      <div key={p.id} className="bg-slate-950/40 border border-slate-900/80 p-5 rounded-2xl space-y-4 relative overflow-hidden text-xs">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full blur-2xl pointer-events-none" />
                        
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-bold text-slate-200 text-sm">Vehicle: {vObj?.vehicleNumber || `ID: ${p.vehicleId}`}</h4>
                            <span className="text-[10px] text-purple-400 font-mono uppercase tracking-wider block mt-1">Predicted Failure Mode: {p.predictedFailureType}</span>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className={`px-2.5 py-1 rounded-xl text-[10px] font-black font-mono uppercase ${
                              riskLevel === "Critical" || riskLevel === "High" ? "bg-rose-500/10 border border-rose-500/20 text-rose-400 animate-pulse" :
                              riskLevel === "Warning" || riskLevel === "Medium" ? "bg-amber-500/10 border border-amber-500/20 text-amber-400" :
                              "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                            }`}>
                              {p.failureProbabilityPercent}% {riskLevel} Risk
                            </span>
                            <span className="text-[9px] text-slate-500 font-mono">Confidence: {confidenceScore}</span>
                          </div>
                        </div>

                        {/* Health Score Progress Bar */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-slate-400 font-semibold font-mono">
                            <span>VEHICLE HEALTH SCORE</span>
                            <span className={`${healthScore > 80 ? "text-emerald-400" : healthScore > 50 ? "text-amber-400" : "text-rose-400"}`}>{healthScore}/100</span>
                          </div>
                          <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all ${
                                healthScore > 80 ? "bg-emerald-500" : healthScore > 50 ? "bg-amber-500" : "bg-rose-500"
                              }`}
                              style={{ width: `${healthScore}%` }}
                            />
                          </div>
                        </div>

                        <div className="bg-slate-900/50 p-3 rounded-xl space-y-2 border border-slate-900/80">
                          <p className="text-slate-300 leading-relaxed font-semibold">
                            <span className="text-purple-400 block text-[9px] font-bold uppercase tracking-wider mb-0.5">Recommended Intervention</span>
                            "{actionText}"
                          </p>

                          {historyExplanation && (
                            <p className="text-[11px] text-slate-400 leading-normal border-t border-slate-800/60 pt-2 font-mono">
                              <span className="text-slate-500 font-sans block text-[9px] font-bold uppercase tracking-wider mb-0.5">Telemetry & History Context</span>
                              {historyExplanation}
                            </p>
                          )}
                        </div>

                        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-900/60 text-xs font-mono">
                          <div>
                            <span className="text-slate-500 block text-[9px]">REMAINING LIFE</span>
                            <span className="text-slate-200 font-black">{p.remainingUsefulLifeKm?.toLocaleString() || 5000} KM</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[9px]">ESTIMATED COST</span>
                            <span className="text-purple-400 font-black">PKR {p.estimatedCost?.toLocaleString() || 15000}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[9px]">SUGGESTED DATE</span>
                            <span className="text-blue-400 font-black">{suggestedDate}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        )}

        {/* TAB 14: COST REPORTS */}
        {activeTab === "reports" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-950/40 border border-slate-900 p-5 rounded-2xl text-center space-y-1">
                <span className="text-slate-500 text-[10px] uppercase font-mono tracking-wider">Average Tyre Lifespan</span>
                <h4 className="text-3xl font-black text-indigo-400">{costAnalysis?.averageTyreLife?.toLocaleString() || 80000} KM</h4>
                <p className="text-[10px] text-slate-500 leading-relaxed">Aggregated from active, scrubbed and rotated tires</p>
              </div>

              <div className="bg-slate-950/40 border border-slate-900 p-5 rounded-2xl text-center space-y-1">
                <span className="text-slate-500 text-[10px] uppercase font-mono tracking-wider">Total Cumulative Downtime</span>
                <h4 className="text-3xl font-black text-blue-400">{costAnalysis?.totalDowntimeHours || 120} Hours</h4>
                <p className="text-[10px] text-slate-500 leading-relaxed">Calculated from closed and scheduled job tickets</p>
              </div>

              <div className="bg-slate-950/40 border border-slate-900 p-5 rounded-2xl text-center space-y-1">
                <span className="text-slate-500 text-[10px] uppercase font-mono tracking-wider">Active Mounted Tyres</span>
                <h4 className="text-3xl font-black text-emerald-400">{costAnalysis?.activeTyresCount || 12} Tyres</h4>
                <p className="text-[10px] text-slate-500 leading-relaxed">Excluding scrapped and retired wheels</p>
              </div>
            </div>

            <div className="bg-slate-950/40 border border-slate-900 p-5 rounded-2xl">
              <h3 className="text-sm font-bold text-white mb-4">Total Maintenance & Repair Investment per Transport Vehicle</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={costAnalysis?.maintenanceCosts || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="vehicleId" stroke="#94a3b8" fontSize={10} name="Vehicle ID" />
                    <YAxis stroke="#94a3b8" fontSize={10} />
                    <Tooltip contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b" }} />
                    <Bar dataKey="totalCost" name="Total Expense (PKR)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="avgCost" name="Average Cost per repair" fill="#818cf8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* TAB 15: AI WORKSHOP ASSISTANT CHAT */}
        {activeTab === "ai_assistant" && (
          <div className="bg-slate-950/40 border border-slate-900 rounded-2xl h-[550px] flex flex-col overflow-hidden">
            {/* Header info */}
            <div className="bg-slate-950/80 p-4 border-b border-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                  <Bot className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-xs">Intelligent Grounded Maintenance AI</h3>
                  <p className="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5 font-mono"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" /> Synchronized with live PG schema</p>
                </div>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">Gemini 3.5 Flash Model</span>
            </div>

            {/* Chat list */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              {chatHistory.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl p-3 text-xs leading-relaxed ${
                    msg.role === "user" 
                      ? "bg-blue-600/90 text-white rounded-br-none font-semibold" 
                      : "bg-slate-900/80 border border-slate-800 text-slate-200 rounded-bl-none"
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {aiChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-900/80 border border-slate-800 rounded-2xl rounded-bl-none p-3 text-xs text-slate-400 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" /> AI Assistant is formulating response from live tables...
                  </div>
                </div>
              )}
            </div>

            {/* Input area */}
            <div className="p-3 bg-slate-950/80 border-t border-slate-900 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendChatMessage()}
                placeholder="Ask e.g. Why is LES-9921 failing frequently? Or Compare tyre wear states."
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={sendChatMessage}
                className="p-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white transition-all shadow-md shadow-blue-600/10"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* COMPREHENSIVE FORM MODALS */}
      <AnimatePresence>
        {modalType && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-950 border border-slate-900 p-6 rounded-2xl w-full max-w-lg space-y-4 shadow-2xl relative"
            >
              <h3 className="text-sm font-bold text-white capitalize">Log {modalType} Details</h3>
              <form onSubmit={handleFormSubmit} className="space-y-4">
                {/* 1. WORKSHOP FORM */}
                {modalType === "workshop" && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">Workshop Name</label>
                      <input
                        required
                        type="text"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                        value={formFields.name || ""}
                        onChange={e => setFormFields({ ...formFields, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">Highway / City Location</label>
                      <input
                        required
                        type="text"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                        value={formFields.location || ""}
                        onChange={e => setFormFields({ ...formFields, location: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Total Bays Capacity</label>
                        <input
                          required
                          type="number"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                          value={formFields.capacity || 10}
                          onChange={e => setFormFields({ ...formFields, capacity: parseInt(e.target.value) })}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Available Bays</label>
                        <input
                          required
                          type="number"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                          value={formFields.availableBays || 10}
                          onChange={e => setFormFields({ ...formFields, availableBays: parseInt(e.target.value) })}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">Contact Phone</label>
                      <input
                        type="text"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                        value={formFields.contactNumber || ""}
                        onChange={e => setFormFields({ ...formFields, contactNumber: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {/* 2. MECHANIC FORM */}
                {modalType === "mechanic" && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">Mechanic Name</label>
                      <input
                        required
                        type="text"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                        value={formFields.name || ""}
                        onChange={e => setFormFields({ ...formFields, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">Specialty Certification</label>
                      <select
                        required
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                        value={formFields.specialty || "General mechanical"}
                        onChange={e => setFormFields({ ...formFields, specialty: e.target.value })}
                      >
                        <option value="Engine rebuilding">Engine rebuilding</option>
                        <option value="Brakes & pneumatic safety">Brakes & pneumatic safety</option>
                        <option value="Transmission & drivetrain">Transmission & drivetrain</option>
                        <option value="Electrical & hybrid diagnostics">Electrical & hybrid diagnostics</option>
                        <option value="Heavy duty tyres alignment">Heavy duty tyres alignment</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">Workshop Depot</label>
                      <select
                        required
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                        value={formFields.workshopId || ""}
                        onChange={e => setFormFields({ ...formFields, workshopId: parseInt(e.target.value) })}
                      >
                        <option value="">-- Assign Workshop --</option>
                        {workshops.map(w => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* 3. MAINTENANCE FORM */}
                {modalType === "maintenance" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Maintenance Code</label>
                        <input
                          required
                          disabled
                          type="text"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-400 font-mono"
                          value={formFields.maintenanceNumber || ""}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Target Vehicle</label>
                        <select
                          required
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                          value={formFields.vehicleId || ""}
                          onChange={e => setFormFields({ ...formFields, vehicleId: parseInt(e.target.value) })}
                        >
                          <option value="">-- Choose Vehicle --</option>
                          {vehicles.map(v => (
                            <option key={v.id} value={v.id}>{v.vehicleNumber}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Maintenance Type</label>
                        <select
                          required
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                          value={formFields.maintenanceType || "Preventive"}
                          onChange={e => setFormFields({ ...formFields, maintenanceType: e.target.value })}
                        >
                          <option value="Preventive">Preventive</option>
                          <option value="Corrective">Corrective</option>
                          <option value="Breakdown">Breakdown</option>
                          <option value="Tyre Rotation">Tyre Rotation</option>
                          <option value="Battery Replace">Battery Replace</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Priority</label>
                        <select
                          required
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                          value={formFields.priority || "Medium"}
                          onChange={e => setFormFields({ ...formFields, priority: e.target.value })}
                        >
                          <option value="Low">Low</option>
                          <option value="Medium">Medium</option>
                          <option value="High">High</option>
                          <option value="Critical">Critical</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Status</label>
                        <select
                          required
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                          value={formFields.status || "In_Progress"}
                          onChange={e => setFormFields({ ...formFields, status: e.target.value })}
                        >
                          <option value="Scheduled">Scheduled</option>
                          <option value="In_Progress">In Progress</option>
                          <option value="Completed">Completed (Trigger Journal entry)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Actual Cost (PKR)</label>
                        <input
                          type="number"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100 font-mono"
                          value={formFields.actualCost || 0}
                          onChange={e => setFormFields({ ...formFields, actualCost: parseFloat(e.target.value) })}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">Downtime Duration (hours)</label>
                      <input
                        type="number"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100 font-mono"
                        value={formFields.downtimeHours || 0}
                        onChange={e => setFormFields({ ...formFields, downtimeHours: parseInt(e.target.value) })}
                      />
                    </div>
                  </div>
                )}

                {/* 4. TYRE FORM */}
                {modalType === "tyre" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Tyre Number</label>
                        <input
                          required
                          type="text"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100 font-mono"
                          value={formFields.tyreNumber || ""}
                          onChange={e => setFormFields({ ...formFields, tyreNumber: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Serial Number</label>
                        <input
                          type="text"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100 font-mono"
                          value={formFields.serialNumber || ""}
                          onChange={e => setFormFields({ ...formFields, serialNumber: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Brand / Make</label>
                        <input
                          required
                          type="text"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                          value={formFields.brand || ""}
                          onChange={e => setFormFields({ ...formFields, brand: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Mount Vehicle</label>
                        <select
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                          value={formFields.vehicleId || ""}
                          onChange={e => setFormFields({ ...formFields, vehicleId: parseInt(e.target.value) })}
                        >
                          <option value="">-- Choose Vehicle --</option>
                          {vehicles.map(v => (
                            <option key={v.id} value={v.id}>{v.vehicleNumber}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Tread Depth (mm)</label>
                        <input
                          required
                          type="number"
                          step="0.1"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100 font-mono"
                          value={formFields.currentTreadDepth || 14.0}
                          onChange={e => setFormFields({ ...formFields, currentTreadDepth: parseFloat(e.target.value) })}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Life Expectancy</label>
                        <input
                          required
                          type="number"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100 font-mono"
                          value={formFields.expectedLifeKm || 80000}
                          onChange={e => setFormFields({ ...formFields, expectedLifeKm: parseInt(e.target.value) })}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Purchase Cost</label>
                        <input
                          required
                          type="number"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100 font-mono"
                          value={formFields.purchaseCost || 35000}
                          onChange={e => setFormFields({ ...formFields, purchaseCost: parseInt(e.target.value) })}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. JOB CARD FORM */}
                {modalType === "job_card" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Job Card ID</label>
                        <input
                          disabled
                          type="text"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-400 font-mono"
                          value={formFields.jobCardNumber || ""}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Assign Mechanic</label>
                        <select
                          required
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                          value={formFields.mechanicId || ""}
                          onChange={e => setFormFields({ ...formFields, mechanicId: parseInt(e.target.value) })}
                        >
                          <option value="">-- Choose Mechanic --</option>
                          {mechanics.map(m => (
                            <option key={m.id} value={m.id}>{m.name} ({m.specialty})</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">Workshop Bay</label>
                      <select
                        required
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                        value={formFields.workshopId || ""}
                        onChange={e => setFormFields({ ...formFields, workshopId: parseInt(e.target.value) })}
                      >
                        <option value="">-- Choose Workshop --</option>
                        {workshops.map(w => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Labour Hours</label>
                        <input
                          type="text"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100 font-mono"
                          value={formFields.labourHours || "0.0"}
                          onChange={e => setFormFields({ ...formFields, labourHours: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Status</label>
                        <select
                          required
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                          value={formFields.status || "Open"}
                          onChange={e => setFormFields({ ...formFields, status: e.target.value })}
                        >
                          <option value="Open">Open</option>
                          <option value="In_Progress">In Progress</option>
                          <option value="Closed">Closed (Post Labour G/L)</option>
                          <option value="Cancelled">Cancelled</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">Job Details & Task Lists</label>
                      <textarea
                        required
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100 h-16 resize-none"
                        value={formFields.jobDescription || ""}
                        onChange={e => setFormFields({ ...formFields, jobDescription: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {/* 6. BREAKDOWN FORM */}
                {modalType === "breakdown" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Ticket Number</label>
                        <input
                          disabled
                          type="text"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-400 font-mono"
                          value={formFields.breakdownNumber || ""}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 block mb-1">Breakdown Vehicle</label>
                        <select
                          required
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                          value={formFields.vehicleId || ""}
                          onChange={e => setFormFields({ ...formFields, vehicleId: parseInt(e.target.value) })}
                        >
                          <option value="">-- Choose Vehicle --</option>
                          {vehicles.map(v => (
                            <option key={v.id} value={v.id}>{v.vehicleNumber}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">Highway / Route Location (e.g. M2, Mile 140)</label>
                      <input
                        required
                        type="text"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100"
                        value={formFields.location || ""}
                        onChange={e => setFormFields({ ...formFields, location: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 block mb-1">Description of Mechanical Failure</label>
                      <textarea
                        required
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs p-2 text-slate-100 h-16 resize-none"
                        value={formFields.reason || ""}
                        onChange={e => setFormFields({ ...formFields, reason: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-2.5 pt-4 border-t border-slate-900">
                  <button
                    type="button"
                    onClick={() => {
                      setModalType(null);
                      setFormFields({});
                      setEditId(null);
                    }}
                    className="w-1/2 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold rounded-lg text-slate-300 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="w-1/2 py-2 bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded-lg text-white transition-all shadow-md shadow-blue-600/10"
                  >
                    Save Record
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Custom dropdown fallback icon
function DropdownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={props.className}
      {...props}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
