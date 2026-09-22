import React, { useState } from "react";
import { Wrench, Calendar, Sparkles, AlertTriangle, ShieldCheck, CheckCircle, Plus, Send } from "lucide-react";

interface MaintenanceAlert {
  id: string;
  vehicleNumber: string;
  type: "Oil Change" | "Brake Service" | "Tyre Replacement" | "Engine Tuneup" | "Insurance Expiry" | "Permit Expiry";
  triggerSource: "Mileage" | "Engine Hours" | "Date Calendar";
  currentValue: string;
  limitValue: string;
  predictedRisk: "Critical" | "Warning" | "Good";
  predictedBreakdownDays: number;
  workOrderCreated: boolean;
}

interface PredictiveMaintenanceProps {
  showFeedback: (type: "success" | "error", message: string) => void;
}

export default function PredictiveMaintenance({ showFeedback }: PredictiveMaintenanceProps) {
  const [alerts, setAlerts] = useState<MaintenanceAlert[]>([
    {
      id: "maint-1",
      vehicleNumber: "LES-9921",
      type: "Brake Service",
      triggerSource: "Engine Hours",
      currentValue: "1,240 hrs",
      limitValue: "1,200 hrs",
      predictedRisk: "Critical",
      predictedBreakdownDays: 4,
      workOrderCreated: false
    },
    {
      id: "maint-2",
      vehicleNumber: "PST-4412",
      type: "Oil Change",
      triggerSource: "Mileage",
      currentValue: "14,850 km",
      limitValue: "15,000 km",
      predictedRisk: "Warning",
      predictedBreakdownDays: 12,
      workOrderCreated: false
    },
    {
      id: "maint-3",
      vehicleNumber: "KHI-8080",
      type: "Tyre Replacement",
      triggerSource: "Mileage",
      currentValue: "48,200 km",
      limitValue: "50,000 km",
      predictedRisk: "Warning",
      predictedBreakdownDays: 18,
      workOrderCreated: false
    },
    {
      id: "maint-4",
      vehicleNumber: "RWP-1122",
      type: "Insurance Expiry",
      triggerSource: "Date Calendar",
      currentValue: "July 01, 2026",
      limitValue: "July 01, 2026",
      predictedRisk: "Warning",
      predictedBreakdownDays: 5,
      workOrderCreated: true
    }
  ]);

  const [notifiedManager, setNotifiedManager] = useState<Record<string, boolean>>({});

  const handleCreateWorkOrder = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, workOrderCreated: true } : a));
    showFeedback("success", `Work order initiated automatically in the corporate maintenance workshop registry!`);
  };

  const handleNotifyManager = (id: string, vehicle: string) => {
    setNotifiedManager(prev => ({ ...prev, [id]: true }));
    showFeedback("success", `Sms & WhatsApp telemetry diagnostic alert dispatched to Fleet Manager for ${vehicle}!`);
  };

  return (
    <div className="space-y-6">
      {/* Top banner / stats */}
      <div className="bg-gradient-to-r from-blue-950/40 to-slate-950/40 border border-slate-900 rounded-xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" /> AI-Driven Predictive Maintenance Diagnostics
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Analyzing real-time odometer readings, engine telemetry hours, and historical maintenance logs to predict failures.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded text-[11px] font-mono font-bold text-rose-400">
            {alerts.filter(a => a.predictedRisk === "Critical").length} CRITICAL FAILURE RISKS
          </div>
          <div className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded text-[11px] font-mono font-bold text-amber-400">
            {alerts.filter(a => a.predictedRisk === "Warning").length} WARNINGS
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main predicted failures panel */}
        <div className="lg:col-span-2 bg-slate-950/40 border border-slate-900 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5 border-b border-slate-900 pb-2">
            <Wrench className="w-4 h-4 text-blue-500" /> Maintenance Anomalies & Diagnostics
          </h3>

          <div className="space-y-3">
            {alerts.map((item) => (
              <div
                key={item.id}
                className={`p-4 rounded-xl border text-xs space-y-3 transition hover:border-slate-800 ${
                  item.predictedRisk === "Critical" ? "bg-rose-500/5 border-rose-500/20" : "bg-slate-900/30 border-slate-900"
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm font-mono">{item.vehicleNumber}</span>
                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase ${
                        item.predictedRisk === "Critical" ? "bg-rose-500/20 text-rose-400 animate-pulse" : "bg-amber-500/20 text-amber-400"
                      }`}>
                        {item.predictedRisk} RISK
                      </span>
                    </div>
                    <p className="text-slate-400 font-semibold">{item.type} diagnostic needed</p>
                    <p className="text-[10px] text-slate-500">Telemetry Trigger: {item.triggerSource} ({item.currentValue} / Threshold: {item.limitValue})</p>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 block">Predicted breakdown in</span>
                    <span className={`text-base font-black font-mono ${item.predictedRisk === "Critical" ? "text-rose-400" : "text-amber-400"}`}>
                      {item.predictedBreakdownDays} Days
                    </span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-900/40">
                  <button
                    onClick={() => handleNotifyManager(item.id, item.vehicleNumber)}
                    disabled={notifiedManager[item.id]}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-[10px] text-slate-300 font-bold rounded flex items-center gap-1 border border-slate-800 transition"
                  >
                    <Send className="w-3 h-3 text-slate-400" />
                    {notifiedManager[item.id] ? "Manager Notified" : "Notify Fleet Manager"}
                  </button>
                  <button
                    onClick={() => handleCreateWorkOrder(item.id)}
                    disabled={item.workOrderCreated}
                    className={`px-3 py-1.5 text-[10px] font-bold rounded flex items-center gap-1 transition shadow ${
                      item.workOrderCreated ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-blue-600 hover:bg-blue-700 text-white"
                    }`}
                  >
                    {item.workOrderCreated ? <CheckCircle className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    {item.workOrderCreated ? "Work Order Draft Active" : "Create Auto Work Order"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Diagnostic rules list */}
        <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-blue-500" /> Threshold Diagnostic Controls
          </h3>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Configure baseline rules used by the AI logic engine to analyze odometer trends and flag predictive failures.
          </p>

          <div className="space-y-3 text-xs">
            <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-900 flex justify-between">
              <span className="text-slate-400 font-semibold">Mobil Oil Limit</span>
              <span className="font-mono text-white font-bold">15,000 km</span>
            </div>
            <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-900 flex justify-between">
              <span className="text-slate-400 font-semibold">Brake Pads Limit</span>
              <span className="font-mono text-white font-bold">25,000 km</span>
            </div>
            <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-900 flex justify-between">
              <span className="text-slate-400 font-semibold">Tyres Baseline Limit</span>
              <span className="font-mono text-white font-bold">50,000 km</span>
            </div>
            <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-900 flex justify-between">
              <span className="text-slate-400 font-semibold">Depot Inspection Period</span>
              <span className="font-mono text-white font-bold">180 Days</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
