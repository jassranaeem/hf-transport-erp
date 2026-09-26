import React, { useState, useEffect } from "react";
import { 
  Droplet, 
  AlertTriangle, 
  DollarSign, 
  CheckCircle, 
  Plus, 
  RefreshCw, 
  Calendar, 
  FileText, 
  Truck, 
  Users, 
  Trash2, 
  Check, 
  TrendingUp, 
  HelpCircle,
  MapPin,
  CreditCard,
  Layers,
  ArrowRight,
  ShieldCheck,
  AlertCircle
} from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import ModuleDataIO from "../common/ModuleDataIO.tsx";
import { motion, AnimatePresence } from "motion/react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  Legend 
} from "recharts";

interface FuelIntelligenceProps {
  showFeedback: (type: "success" | "error", message: string) => void;
}

export default function FuelIntelligence({ showFeedback }: FuelIntelligenceProps) {
  const [activeSubTab, setActiveSubTab] = useState<"dashboard" | "transactions" | "tanks" | "mileage" | "theft" | "vendors">("dashboard");
  const [loading, setLoading] = useState(false);

  // Lists & data states from backend
  const [analytics, setAnalytics] = useState<any>({
    summary: { totalLitres: 0, totalCost: 0, avgRate: 270, txnTransactionsCount: 0, activeTheftCount: 0 },
    trends: [],
    topVehicles: []
  });
  const [transactions, setTransactions] = useState<any[]>([]);
  const [tanks, setTanks] = useState<any[]>([]);
  const [issueSlips, setIssueSlips] = useState<any[]>([]);
  const [mileageList, setMileageList] = useState<any[]>([]);
  const [theftAlerts, setTheftAlerts] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [forecasts, setForecasts] = useState<any[]>([]);

  // Operational references (vehicles, drivers, trips) for dropdown selections
  const [opsVehicles, setOpsVehicles] = useState<any[]>([]);
  const [opsDrivers, setOpsDrivers] = useState<any[]>([]);
  const [opsTrips, setOpsTrips] = useState<any[]>([]);

  // Modals / forms states
  const [showAddTxn, setShowAddTxn] = useState(false);
  const [showAddSlip, setShowAddSlip] = useState(false);
  const [showAddTank, setShowAddTank] = useState(false);

  // States and forms for on-the-fly creations
  const [showCreateCardModal, setShowCreateCardModal] = useState(false);
  const [showCreateVendorModal, setShowCreateVendorModal] = useState(false);
  const [showCreateStationModal, setShowCreateStationModal] = useState(false);

  const [newCardForm, setNewCardForm] = useState({
    cardNumber: "",
    pin: "1234",
    vehicleId: "",
    driverId: "",
    vendorId: ""
  });

  const [newVendorForm, setNewVendorForm] = useState({
    vendorName: "",
    company: "HF Logistics",
    phone: "",
    email: "",
    address: ""
  });

  const [newStationForm, setNewStationForm] = useState({
    stationName: "",
    company: "PSO",
    city: "Lahore",
    province: "Punjab",
    gpsLocation: "31.5204, 74.3587"
  });

  const handleCreateCardOnTheFly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCardForm.cardNumber) {
      showFeedback("error", "Card Number is required");
      return;
    }
    try {
      await enterpriseFetch("/api/fuel/cards", {
        method: "POST",
        body: JSON.stringify({
          ...newCardForm,
          vehicleId: newCardForm.vehicleId ? parseInt(newCardForm.vehicleId) : null,
          driverId: newCardForm.driverId ? parseInt(newCardForm.driverId) : null,
          vendorId: newCardForm.vendorId ? parseInt(newCardForm.vendorId) : null,
        })
      });
      showFeedback("success", "Fuel Card registered successfully!");
      setShowCreateCardModal(false);
      setNewCardForm({ cardNumber: "", pin: "1234", vehicleId: "", driverId: "", vendorId: "" });
      const cardList = await enterpriseFetch("/api/fuel/cards");
      setCards(cardList);
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleCreateVendorOnTheFly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVendorForm.vendorName) {
      showFeedback("error", "Vendor Name is required");
      return;
    }
    try {
      await enterpriseFetch("/api/fuel/vendors", {
        method: "POST",
        body: JSON.stringify(newVendorForm)
      });
      showFeedback("success", "Vendor contract registered successfully!");
      setShowCreateVendorModal(false);
      setNewVendorForm({ vendorName: "", company: "HF Logistics", phone: "", email: "", address: "" });
      const vList = await enterpriseFetch("/api/fuel/vendors");
      setVendors(vList);
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleCreateStationOnTheFly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStationForm.stationName) {
      showFeedback("error", "Station Name is required");
      return;
    }
    try {
      await enterpriseFetch("/api/fuel/stations", {
        method: "POST",
        body: JSON.stringify(newStationForm)
      });
      showFeedback("success", "Fuel depot registered successfully!");
      setShowCreateStationModal(false);
      setNewStationForm({ stationName: "", company: "PSO", city: "Lahore", province: "Punjab", gpsLocation: "31.5204, 74.3587" });
      const sList = await enterpriseFetch("/api/fuel/stations");
      setStations(sList);
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  // Forms
  const [txnForm, setTxnForm] = useState({
    vehicleId: "",
    driverId: "",
    tripId: "",
    vendorId: "",
    fuelStationId: "",
    fuelCardId: "",
    litres: "",
    rate: "272",
    paymentType: "Card",
    odometer: "",
    invoiceNumber: "",
    receiptUrl: "",
    geoCoordinates: "31.5204, 74.3587"
  });

  const [slipForm, setSlipForm] = useState({
    vehicleId: "",
    driverId: "",
    tripId: "",
    fuelTankId: "",
    litres: "",
    purpose: "Trip"
  });

  const [tankForm, setTankForm] = useState({
    tankName: "",
    capacity: "15000",
    openingBalance: "10000",
    branchId: "1",
    leakStatus: "No Leak"
  });

  useEffect(() => {
    fetchCoreData();
    fetchOpsData();
  }, [activeSubTab]);

  const fetchCoreData = async () => {
    setLoading(true);
    try {
      // Always fetch reference lists so transaction/issue forms are populated
      const [cardList, vList, sList] = await Promise.all([
        enterpriseFetch("/api/fuel/cards").catch(() => []),
        enterpriseFetch("/api/fuel/vendors").catch(() => []),
        enterpriseFetch("/api/fuel/stations").catch(() => [])
      ]);
      setCards(cardList);
      setVendors(vList);
      setStations(sList);

      if (activeSubTab === "dashboard") {
        const analyticsData = await enterpriseFetch("/api/fuel/analytics");
        const fc = await enterpriseFetch("/api/fuel/forecasting");
        setAnalytics(analyticsData);
        setForecasts(fc);
      } else if (activeSubTab === "transactions") {
        const list = await enterpriseFetch("/api/fuel/transactions");
        setTransactions(list);
        const cardList = await enterpriseFetch("/api/fuel/cards");
        setCards(cardList);
        const vList = await enterpriseFetch("/api/fuel/vendors");
        setVendors(vList);
        const sList = await enterpriseFetch("/api/fuel/stations");
        setStations(sList);
      } else if (activeSubTab === "tanks") {
        const tankList = await enterpriseFetch("/api/fuel/tanks");
        setTanks(tankList);
        const slips = await enterpriseFetch("/api/fuel/issue-slips");
        setIssueSlips(slips);
      } else if (activeSubTab === "mileage") {
        const list = await enterpriseFetch("/api/fuel/mileage-intelligence");
        setMileageList(list);
        const fc = await enterpriseFetch("/api/fuel/forecasting");
        setForecasts(fc);
      } else if (activeSubTab === "theft") {
        const list = await enterpriseFetch("/api/fuel/theft-detection");
        setTheftAlerts(list);
      } else if (activeSubTab === "vendors") {
        const vList = await enterpriseFetch("/api/fuel/vendors");
        setVendors(vList);
        const sList = await enterpriseFetch("/api/fuel/stations");
        setStations(sList);
        const cardList = await enterpriseFetch("/api/fuel/cards");
        setCards(cardList);
      }
    } catch (err: any) {
      console.error(err);
      showFeedback("error", `Error fetching fuel logs: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchOpsData = async () => {
    try {
      const v = await enterpriseFetch("/api/operations/vehicles");
      setOpsVehicles(v?.data || (Array.isArray(v) ? v : []));
      const d = await enterpriseFetch("/api/operations/drivers");
      setOpsDrivers(d?.data || (Array.isArray(d) ? d : []));
      const t = await enterpriseFetch("/api/operations/trips");
      setOpsTrips(t?.data || (Array.isArray(t) ? t : []));
    } catch (e) {
      // safe bypass if operations router not fully loaded
    }
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!txnForm.litres || !txnForm.rate || !txnForm.odometer) {
        showFeedback("error", "Please provide litres, rate per litre, and current odometer.");
        return;
      }
      await enterpriseFetch("/api/fuel/transactions", {
        method: "POST",
        body: JSON.stringify({
          ...txnForm,
          vehicleId: txnForm.vehicleId ? parseInt(txnForm.vehicleId) : null,
          driverId: txnForm.driverId ? parseInt(txnForm.driverId) : null,
          tripId: txnForm.tripId ? parseInt(txnForm.tripId) : null,
          vendorId: txnForm.vendorId ? parseInt(txnForm.vendorId) : null,
          fuelStationId: txnForm.fuelStationId ? parseInt(txnForm.fuelStationId) : null,
          fuelCardId: txnForm.fuelCardId ? parseInt(txnForm.fuelCardId) : null,
        })
      });
      showFeedback("success", "Fuel Purchase Logged and General Ledger updated with balanced bookings.");
      setShowAddTxn(false);
      fetchCoreData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleCreateIssueSlip = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!slipForm.fuelTankId || !slipForm.litres) {
        showFeedback("error", "Please select internal tank and litres to issue.");
        return;
      }
      await enterpriseFetch("/api/fuel/issue-slips", {
        method: "POST",
        body: JSON.stringify({
          ...slipForm,
          vehicleId: slipForm.vehicleId ? parseInt(slipForm.vehicleId) : null,
          driverId: slipForm.driverId ? parseInt(slipForm.driverId) : null,
          tripId: slipForm.tripId ? parseInt(slipForm.tripId) : null,
          fuelTankId: parseInt(slipForm.fuelTankId),
        })
      });
      showFeedback("success", "Fuel Issue slip approved. Internal tank stock debited.");
      setShowAddSlip(false);
      fetchCoreData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleCreateTank = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/fuel/tanks", {
        method: "POST",
        body: JSON.stringify(tankForm)
      });
      showFeedback("success", "New internal fuel storage depot commissioned.");
      setShowAddTank(false);
      fetchCoreData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleResolveAlert = async (id: number) => {
    try {
      await enterpriseFetch(`/api/fuel/theft-detection/resolve/${id}`, { method: "POST" });
      showFeedback("success", "Abuse flag cleared and marked resolved.");
      fetchCoreData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Tab Selectors */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-900 pb-3">
        <div className="ml-auto order-last">
          <ModuleDataIO entityKey="fuel_transactions" label="Fuel Transactions" onImported={fetchCoreData} />
        </div>
        {[
          { id: "dashboard", label: "Executive Analytics Dashboard", icon: Droplet },
          { id: "transactions", label: "Refuelling Transactions", icon: DollarSign },
          { id: "tanks", label: "Internal Tanks & Yards", icon: Layers },
          { id: "mileage", label: "Mileage & AI Forecasts", icon: TrendingUp },
          { id: "theft", label: "Theft & Security Alerts", icon: AlertTriangle },
          { id: "vendors", label: "Vendors & Cards Directory", icon: CreditCard },
        ].map((sub) => {
          const IconComponent = sub.icon;
          return (
            <button
              key={sub.id}
              onClick={() => setActiveSubTab(sub.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeSubTab === sub.id
                  ? "bg-blue-600/10 border border-blue-500/30 text-blue-400"
                  : "text-slate-400 border border-transparent hover:text-slate-200"
              }`}
            >
              <IconComponent className="w-3.5 h-3.5" />
              <span>{sub.label}</span>
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="flex justify-center items-center py-12">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      )}

      {!loading && (
        <AnimatePresence mode="wait">
          
          {/* TAB 1: ANALYTICS DASHBOARD */}
          {activeSubTab === "dashboard" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Stat metrics */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">Total Fuel Consumed</span>
                    <p className="text-2xl font-mono font-black text-white">
                      {Number(analytics?.summary?.totalLitres || 0).toLocaleString()} L
                    </p>
                  </div>
                  <div className="bg-blue-500/10 p-3 rounded-lg border border-blue-500/20">
                    <Droplet className="w-6 h-6 text-blue-400" />
                  </div>
                </div>

                <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">Total Refuel Capital Outlay</span>
                    <p className="text-2xl font-mono font-black text-amber-500">
                      PKR {Number(analytics?.summary?.totalCost || 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-amber-500/10 p-3 rounded-lg border border-amber-500/20">
                    <DollarSign className="w-6 h-6 text-amber-500" />
                  </div>
                </div>

                <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">Average Rate / Litre</span>
                    <p className="text-2xl font-mono font-black text-slate-200">
                      PKR {Math.round(analytics?.summary?.avgRate || 272)}
                    </p>
                  </div>
                  <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-750">
                    <Calendar className="w-6 h-6 text-slate-400" />
                  </div>
                </div>

                <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1">Active Security Deviations</span>
                    <p className={`text-2xl font-mono font-black ${analytics?.summary?.activeTheftCount > 0 ? "text-rose-500 animate-pulse" : "text-emerald-400"}`}>
                      {analytics?.summary?.activeTheftCount} Alerts
                    </p>
                  </div>
                  <div className={`p-3 rounded-lg border ${analytics?.summary?.activeTheftCount > 0 ? "bg-rose-500/10 border-rose-500/20" : "bg-emerald-500/10 border-emerald-500/20"}`}>
                    <AlertTriangle className={`w-6 h-6 ${analytics?.summary?.activeTheftCount > 0 ? "text-rose-400" : "text-emerald-400"}`} />
                  </div>
                </div>
              </div>

              {/* Charts & Trends */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Consumption Over Time Chart */}
                <div className="lg:col-span-8 bg-slate-900/30 border border-slate-900 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-white mb-4">Daily Fleet Fuel Outlay & Consumption</h3>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.trends}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="day" stroke="#64748b" fontSize={11} />
                        <YAxis stroke="#64748b" fontSize={11} />
                        <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155" }} />
                        <Legend />
                        <Bar name="Consumption (L)" dataKey="totalLitres" fill="#2C5CAE" radius={[4, 4, 0, 0]} />
                        <Bar name="Spent (PKR)" dataKey="totalSpent" fill="#9CA3AF" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Top Refuelling Assets */}
                <div className="lg:col-span-4 bg-slate-900/30 border border-slate-900 rounded-xl p-5 flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-4">Top Consuming Transport Assets</h3>
                    <div className="space-y-4">
                      {analytics.topVehicles?.map((v: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-xs p-2 bg-slate-950/40 border border-slate-900 rounded-lg">
                          <div className="flex items-center gap-2">
                            <Truck className="w-3.5 h-3.5 text-blue-400" />
                            <span className="font-mono font-bold text-slate-200">{v.vehicleNumber}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-white font-mono font-black">{Math.round(v.totalLitres)} L</span>
                            <p className="text-[10px] text-slate-500">PKR {Number(v.totalSpent).toLocaleString()}</p>
                          </div>
                        </div>
                      ))}
                      {(!analytics.topVehicles || analytics.topVehicles.length === 0) && (
                        <div className="text-center text-xs text-slate-600 py-12">No high consuming vehicles logged.</div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-900 flex justify-between items-center text-[11px] text-slate-500">
                    <span>Total Logs Analyzed:</span>
                    <span className="font-mono text-slate-300 font-bold">{analytics?.summary?.txnTransactionsCount || 0} purchases</span>
                  </div>
                </div>
              </div>

              {/* AI Forecast overview */}
              <div className="bg-blue-950/20 border border-blue-900/40 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="bg-blue-500/10 p-2.5 rounded-lg border border-blue-500/20 text-blue-400">
                    <TrendingUp className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Gemini AI Fleet Refuelling Forecast</h4>
                    <p className="text-xs text-slate-400 max-w-xl mt-1">
                      Based on historical runtimes, the corporate logistics forecast estimates next refill and requirements:
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  {forecasts.map((f: any, idx: number) => (
                    <div key={idx} className="bg-slate-950/60 border border-slate-900 px-4 py-2.5 rounded-lg text-right">
                      <span className="text-[9px] text-slate-500 font-bold uppercase">{f.targetType} Requirement</span>
                      <p className="text-sm font-black font-mono text-blue-400">{Math.round(parseFloat(f.predictedRequirementLitres || "0"))} L</p>
                      <p className="text-[10px] text-slate-500 font-mono">Next: {new Date(f.nextRefillDate).toLocaleDateString()}</p>
                    </div>
                  ))}
                </div>
              </div>

            </motion.div>
          )}

          {/* TAB 2: REFUELLING TRANSACTIONS */}
          {activeSubTab === "transactions" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold text-white">Fuel Purchase Transaction Ledger</h3>
                <button
                  onClick={() => setShowAddTxn(true)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Log Refuelling Transaction</span>
                </button>
              </div>

              {/* Transactions list */}
              <div className="bg-slate-900/30 border border-slate-900 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/40 text-slate-500 font-mono uppercase tracking-wider border-b border-slate-900">
                    <tr>
                      <th className="p-4">Txn Number & Date</th>
                      <th className="p-4">Vehicle & Driver</th>
                      <th className="p-4">Vendor & Card</th>
                      <th className="p-4 text-right">Litres</th>
                      <th className="p-4 text-right">Rate</th>
                      <th className="p-4 text-right">Total Cost</th>
                      <th className="p-4">Payment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900 font-mono">
                    {transactions.map((t) => (
                      <tr key={t.txn.id} className="hover:bg-slate-900/20 text-slate-300">
                        <td className="p-4">
                          <div className="font-bold text-slate-200">{t.txn.transactionNumber}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {new Date(t.txn.transactionDate).toLocaleString()}
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="text-blue-400 font-bold">{t.vehicleNumber}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{t.driverName}</div>
                        </td>
                        <td className="p-4">
                          <div className="text-slate-200">{t.vendorName || "Retail Station"}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">Card: {t.cardNumber || "N/A"}</div>
                        </td>
                        <td className="p-4 text-right font-black text-white">{t.txn.litres} L</td>
                        <td className="p-4 text-right text-slate-400">PKR {t.txn.rate}</td>
                        <td className="p-4 text-right font-black text-amber-500">PKR {t.txn.total.toLocaleString()}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            t.txn.paymentType === "Cash" ? "bg-emerald-500/10 text-emerald-400" :
                            t.txn.paymentType === "Card" ? "bg-blue-500/10 text-blue-400" :
                            t.txn.paymentType === "Credit" ? "bg-amber-500/10 text-amber-400" :
                            "bg-purple-500/10 text-purple-400"
                          }`}>
                            {t.txn.paymentType}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {transactions.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center py-12 text-slate-600">
                          No Refuelling transactions recorded in the corporate ledger.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* TAB 3: INTERNAL TANKS & ISSUES */}
          {activeSubTab === "tanks" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold text-white">Yard Tank Storage Depots</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddTank(true)}
                    className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold rounded-lg px-3 py-1.5 text-xs border border-slate-800 transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Setup Storage Tank</span>
                  </button>
                  <button
                    onClick={() => setShowAddSlip(true)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-xs transition"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Issue Internal Fuel Slip</span>
                  </button>
                </div>
              </div>

              {/* Tanks grid view */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {tanks.map((tk) => (
                  <div key={tk.tank.id} className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-white">{tk.tank.tankName}</h4>
                        <span className="text-[10px] text-slate-500 font-mono block mt-0.5">YARD: {tk.branchName || "Main Yard"}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        tk.tank.leakStatus === "No Leak" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400 animate-pulse"
                      }`}>
                        {tk.tank.leakStatus}
                      </span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-slate-400">Current Stock</span>
                        <span className="text-white font-bold">{tk.tank.currentStock} / {tk.tank.capacity} L</span>
                      </div>
                      {/* Fuel level bar */}
                      <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-900 flex">
                        <div 
                          className={`h-full transition-all duration-500 ${
                            tk.tank.tankLevelPercent < 15 ? "bg-rose-500 animate-pulse" :
                            tk.tank.tankLevelPercent < 40 ? "bg-amber-500" : "bg-blue-600"
                          }`}
                          style={{ width: `${tk.tank.tankLevelPercent}%` }}
                        />
                      </div>
                      <p className="text-right font-mono text-[10px] text-slate-500">{tk.tank.tankLevelPercent}% Capacity</p>
                    </div>

                    <div className="pt-2 border-t border-slate-900 flex justify-between text-[11px] text-slate-500">
                      <span>Opening: {tk.tank.openingBalance} L</span>
                      <span>Leak Status: Secured</span>
                    </div>
                  </div>
                ))}
                {tanks.length === 0 && (
                  <div className="col-span-3 text-center py-12 border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs">
                    No internal fuel tanks commission in this depot node.
                  </div>
                )}
              </div>

              {/* Issue slips ledger */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Internal Fuel Issue Slips</h3>
                <div className="bg-slate-900/30 border border-slate-900 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950/40 text-slate-500 font-mono uppercase border-b border-slate-900">
                      <tr>
                        <th className="p-4">Slip Code & Date</th>
                        <th className="p-4">Target Vehicle</th>
                        <th className="p-4">Driver</th>
                        <th className="p-4">Storage Tank</th>
                        <th className="p-4">Litres</th>
                        <th className="p-4">Purpose</th>
                        <th className="p-4">Dispatcher</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900 font-mono">
                      {issueSlips.map((s) => (
                        <tr key={s.slip.id} className="hover:bg-slate-900/20 text-slate-300">
                          <td className="p-4">
                            <div className="font-bold text-slate-200">{s.slip.slipNumber}</div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{new Date(s.slip.issueDate).toLocaleString()}</div>
                          </td>
                          <td className="p-4 text-blue-400 font-bold">{s.vehicleNumber}</td>
                          <td className="p-4 text-slate-400">{s.driverName}</td>
                          <td className="p-4 text-slate-400">{s.tankName}</td>
                          <td className="p-4 font-black text-white">{s.slip.litres} L</td>
                          <td className="p-4">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-slate-300">
                              {s.slip.purpose}
                            </span>
                          </td>
                          <td className="p-4 text-[10px] text-slate-400">{s.issuedByName}</td>
                        </tr>
                      ))}
                      {issueSlips.length === 0 && (
                        <tr>
                          <td colSpan={7} className="text-center py-8 text-slate-600">
                            No internal fuel issue slips written.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 4: MILEAGE & AI FORECAST */}
          {activeSubTab === "mileage" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Mileage tracking */}
              <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-semibold text-white">Mileage & Fuel Consumption Performance</h3>
                  <span className="text-[10px] text-slate-500 font-mono">Benchmarked target baseline: 4.5 KM/L</span>
                </div>

                <div className="overflow-hidden border border-slate-900 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950/40 text-slate-500 font-mono uppercase tracking-wider border-b border-slate-900">
                      <tr>
                        <th className="p-4">Vehicle Asset</th>
                        <th className="p-4 text-right">Total Litres Refuelled</th>
                        <th className="p-4 text-right">Avg Consumption Rate</th>
                        <th className="p-4 text-right">Fuel Cost / KM</th>
                        <th className="p-4 text-right">Baseline Variance</th>
                        <th className="p-4">Status Recommendation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900 font-mono">
                      {mileageList.map((m, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/20 text-slate-300">
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <Truck className="w-3.5 h-3.5 text-blue-400" />
                              <span className="font-bold text-white">{m.vehicleNumber}</span>
                            </div>
                          </td>
                          <td className="p-4 text-right">{Math.round(m.totalLitres)} L</td>
                          <td className="p-4 text-right text-white font-black">{m.averageKmPerL != null ? `${m.averageKmPerL} KM/L` : "—"}</td>
                          <td className="p-4 text-right text-amber-500 font-bold">{m.fuelCostPerKm != null ? `PKR ${m.fuelCostPerKm} / KM` : "—"}</td>
                          <td className="p-4 text-right">
                            {m.variancePercent != null ? (
                              <span className={`font-bold ${m.variancePercent < 0 ? "text-rose-500" : "text-emerald-400"}`}>
                                {m.variancePercent > 0 ? "+" : ""}{m.variancePercent}%
                              </span>
                            ) : "—"}
                          </td>
                          <td className="p-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              m.fuelEfficiencyRating === "Optimal" ? "bg-emerald-500/10 text-emerald-400" :
                              m.fuelEfficiencyRating === "Sub-Optimal Performance" ? "bg-amber-500/10 text-amber-400" :
                              m.fuelEfficiencyRating === "Insufficient Data" ? "bg-slate-500/10 text-slate-400" :
                              "bg-rose-500/10 text-rose-400 animate-pulse"
                            }`}>
                              {m.fuelEfficiencyRating}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {mileageList.length === 0 && (
                        <tr>
                          <td colSpan={6} className="text-center py-12 text-slate-600">
                            Insufficient refuelling history to model vehicle performance rates.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* AI Predictions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 space-y-4">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Estimated Refill Forecasting (AI Engine)</h3>
                  <div className="space-y-3">
                    {forecasts.map((f, idx) => (
                      <div key={idx} className="p-3 bg-slate-950/40 border border-slate-900 rounded-lg flex items-center justify-between text-xs">
                        <div className="space-y-1">
                          <p className="font-bold text-white">{f.targetType} Requirement</p>
                          <p className="text-[10px] text-slate-500">Predicted refill date: {new Date(f.nextRefillDate).toLocaleDateString()}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black font-mono text-blue-400">{Math.round(parseFloat(f.predictedRequirementLitres))} Litres</p>
                          <span className="text-[10px] text-slate-500">Accuracy Score: {Math.round(parseFloat(f.accuracyScore) * 100)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 flex flex-col justify-between">
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Benchmarking & Standard Factors</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Logistics operations require continuous benchmarking to secure target gross margins. The platform combines:
                    </p>
                    <ul className="space-y-1.5 text-[11px] text-slate-400 list-disc list-inside">
                      <li>Odometer variance checks</li>
                      <li>Fuel card allocation limits</li>
                      <li>GPS telemetry siphoning scans</li>
                      <li>Internal yard refill calibration logs</li>
                    </ul>
                  </div>
                  <div className="pt-4 border-t border-slate-900 flex justify-between items-center text-[11px] text-slate-500 font-mono">
                    <span>Active Telemetry Engine:</span>
                    <span className="text-emerald-400 font-bold">ONLINE</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 5: THEFT & SECURITY ALERTS */}
          {activeSubTab === "theft" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <h3 className="text-sm font-semibold text-white">Active Telemetry Anomalies & Theft Alarm</h3>

              <div className="space-y-3">
                {theftAlerts.map((alt) => (
                  <div
                    key={alt.alert.id}
                    className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition ${
                      alt.alert.resolved 
                        ? "bg-emerald-950/20 border-emerald-900/40 text-emerald-300"
                        : alt.alert.severity === "Critical"
                        ? "bg-rose-950/30 border-rose-900/50 text-rose-300 animate-pulse"
                        : "bg-amber-950/20 border-amber-900/40 text-amber-300"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg border shrink-0 ${
                        alt.alert.resolved ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                        alt.alert.severity === "Critical" ? "bg-rose-500/15 border-rose-500/30 text-rose-400" :
                        "bg-amber-500/10 border-amber-500/20 text-amber-400"
                      }`}>
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-white text-xs uppercase tracking-wide font-mono">
                            {alt.alert.alertType}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                            alt.alert.severity === "Critical" ? "bg-rose-500/20 text-rose-400" :
                            alt.alert.severity === "High" ? "bg-amber-500/20 text-amber-400" : "bg-slate-800 text-slate-400"
                          }`}>
                            {alt.alert.severity} Risk
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">{alt.alert.description}</p>
                        <p className="text-[10px] text-slate-500 font-mono">
                          VEHICLE: <span className="text-blue-400 font-bold">{alt.vehicleNumber || "N/A"}</span> • 
                          DRIVER: <span>{alt.driverName || "N/A"}</span> • 
                          TIME: <span>{new Date(alt.alert.createdAt).toLocaleString()}</span>
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {!alt.alert.resolved ? (
                        <button
                          onClick={() => handleResolveAlert(alt.alert.id)}
                          className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-bold rounded-lg text-slate-200 transition"
                        >
                          Acknowledge & Clear Flag
                        </button>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-emerald-400 font-bold font-mono">
                          <Check className="w-4 h-4" />
                          <span>RESOLVED</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {theftAlerts.length === 0 && (
                  <div className="text-center py-12 border border-dashed border-slate-900 rounded-xl text-slate-500 text-xs">
                    All telemetry feeds validated. Zero siphoning alarms raised.
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* TAB 6: VENDORS & CARDS */}
          {activeSubTab === "vendors" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Vendors */}
                <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 space-y-4">
                  <h3 className="text-sm font-semibold text-white">Fuel Vendors & Contracting</h3>
                  <div className="space-y-3">
                    {vendors.map((v) => (
                      <div key={v.id} className="p-4 bg-slate-950/40 border border-slate-900 rounded-lg flex justify-between items-center text-xs">
                        <div>
                          <p className="font-bold text-slate-200">{v.vendorName}</p>
                          <p className="text-[10px] text-slate-500 mt-1 font-mono">Payment Terms: {v.paymentTerms} • Status: {v.status}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-slate-500">Outstanding Payable</span>
                          <p className="text-sm font-black font-mono text-amber-500">PKR {Number(v.outstandingBalance || 0).toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                    {vendors.length === 0 && (
                      <div className="text-center py-6 text-slate-600 text-xs">No active vendors registered.</div>
                    )}
                  </div>
                </div>

                {/* Cards */}
                <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 space-y-4">
                  <h3 className="text-sm font-semibold text-white">Fleet Fuel Cards Allocations</h3>
                  <div className="space-y-3">
                    {cards.map((c) => (
                      <div key={c.card.id} className="p-4 bg-slate-950/40 border border-slate-900 rounded-lg flex justify-between items-center text-xs">
                        <div>
                          <p className="font-bold font-mono text-slate-200">#{c.card.cardNumber}</p>
                          <p className="text-[10px] text-slate-500 mt-1">Vehicle: {c.vehicleNumber || "Common Pool"}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-slate-500">Limits</span>
                          <p className="text-xs font-mono text-slate-300">Daily: PKR {c.card.dailyLimit.toLocaleString()}</p>
                          <p className="text-xs font-mono text-slate-300">Monthly: PKR {c.card.monthlyLimit.toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                    {cards.length === 0 && (
                      <div className="text-center py-6 text-slate-600 text-xs">No fuel cards provisioned on roster.</div>
                    )}
                  </div>
                </div>

              </div>
            </motion.div>
          )}

        </AnimatePresence>
      )}

      {/* MODAL 1: ADD TRANSACTION */}
      {showAddTxn && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-center items-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 space-y-4"
          >
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm">Record Refuelling Transaction</h3>
              <button 
                onClick={() => setShowAddTxn(false)}
                className="text-slate-500 hover:text-slate-300 font-mono text-xs"
              >
                CLOSE [X]
              </button>
            </div>

            <form onSubmit={handleCreateTransaction} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <label className="block text-slate-400">Select Vehicle Asset</label>
                <select
                  value={txnForm.vehicleId}
                  onChange={(e) => setTxnForm({ ...txnForm, vehicleId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                >
                  <option value="">-- Choose Asset --</option>
                  {opsVehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.vehicleNumber}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Select Active Driver</label>
                <select
                  value={txnForm.driverId}
                  onChange={(e) => setTxnForm({ ...txnForm, driverId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                >
                  <option value="">-- Choose Driver --</option>
                  {opsDrivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.driverName}</option>
                  ))}
                </select>
                {opsDrivers.length === 0 && (
                  <p className="text-[11px] text-amber-400">No drivers found — add drivers under Fleet → Drivers first.</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Associate Active Trip</label>
                <select
                  value={txnForm.tripId}
                  onChange={(e) => setTxnForm({ ...txnForm, tripId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                >
                  <option value="">-- Choose Trip (Optional) --</option>
                  {opsTrips.map((t) => (
                    <option key={t.id} value={t.id}>{t.tripNumber}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="block text-slate-400">Associate Fuel Card</label>
                  <button
                    type="button"
                    onClick={() => setShowCreateCardModal(true)}
                    className="text-[10px] text-green-500 hover:underline flex items-center gap-0.5"
                  >
                    + Create Card
                  </button>
                </div>
                {cards.length === 0 ? (
                  <div className="text-[11px] text-yellow-500 bg-slate-900 border border-yellow-900/40 border-dashed p-2 rounded-lg flex justify-between items-center">
                    <span>No cards found.</span>
                    <button
                      type="button"
                      onClick={() => setShowCreateCardModal(true)}
                      className="text-green-500 hover:underline font-semibold"
                    >
                      Create Card
                    </button>
                  </div>
                ) : (
                  <select
                    value={txnForm.fuelCardId}
                    onChange={(e) => setTxnForm({ ...txnForm, fuelCardId: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  >
                    <option value="">-- Choose Card (Optional) --</option>
                    {cards.map((c) => (
                      <option key={c?.card?.id || c?.id} value={c?.card?.id || c?.id}>#{c?.card?.cardNumber || c?.cardNumber}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 col-span-2">
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="block text-slate-400">Vendor Contract</label>
                    <button
                      type="button"
                      onClick={() => setShowCreateVendorModal(true)}
                      className="text-[10px] text-green-500 hover:underline flex items-center gap-0.5"
                    >
                      + Create Vendor
                    </button>
                  </div>
                  {vendors.length === 0 ? (
                    <div className="text-[11px] text-yellow-500 bg-slate-900 border border-yellow-900/40 border-dashed p-2 rounded-lg flex justify-between items-center">
                      <span>No vendors.</span>
                      <button
                        type="button"
                        onClick={() => setShowCreateVendorModal(true)}
                        className="text-green-500 hover:underline font-semibold"
                      >
                        Create Vendor
                      </button>
                    </div>
                  ) : (
                    <select
                      value={txnForm.vendorId}
                      onChange={(e) => setTxnForm({ ...txnForm, vendorId: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                    >
                      <option value="">-- Choose Vendor (Optional) --</option>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>{v.vendorName}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="block text-slate-400">Fuel Station Depot</label>
                    <button
                      type="button"
                      onClick={() => setShowCreateStationModal(true)}
                      className="text-[10px] text-green-500 hover:underline flex items-center gap-0.5"
                    >
                      + Create Station
                    </button>
                  </div>
                  {stations.length === 0 ? (
                    <div className="text-[11px] text-yellow-500 bg-slate-900 border border-yellow-900/40 border-dashed p-2 rounded-lg flex justify-between items-center">
                      <span>No stations.</span>
                      <button
                        type="button"
                        onClick={() => setShowCreateStationModal(true)}
                        className="text-green-500 hover:underline font-semibold"
                      >
                        Create Station
                      </button>
                    </div>
                  ) : (
                    <select
                      value={txnForm.fuelStationId}
                      onChange={(e) => setTxnForm({ ...txnForm, fuelStationId: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                    >
                      <option value="">-- Choose Station (Optional) --</option>
                      {stations.map((s) => (
                        <option key={s.id} value={s.id}>{s.stationName}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Litres Refuelled</label>
                <input
                  type="number"
                  step="0.01"
                  value={txnForm.litres}
                  onChange={(e) => setTxnForm({ ...txnForm, litres: e.target.value })}
                  placeholder="e.g. 150"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Rate / Litre (PKR)</label>
                <input
                  type="number"
                  value={txnForm.rate}
                  onChange={(e) => setTxnForm({ ...txnForm, rate: e.target.value })}
                  placeholder="e.g. 272"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Odometer Reading (KM)</label>
                <input
                  type="number"
                  value={txnForm.odometer}
                  onChange={(e) => setTxnForm({ ...txnForm, odometer: e.target.value })}
                  placeholder="e.g. 14205"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Payment Type</label>
                <select
                  value={txnForm.paymentType}
                  onChange={(e) => setTxnForm({ ...txnForm, paymentType: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                >
                  <option value="Card">Fuel Card</option>
                  <option value="Cash">Cash on Hand</option>
                  <option value="Bank">Bank Account</option>
                  <option value="Credit">Credit Accounts Payable</option>
                  <option value="Inventory">Fuel Tank Inventory</option>
                </select>
              </div>

              <div className="space-y-1 col-span-2">
                <label className="block text-slate-400">Vendor Bill / Invoice Number</label>
                <input
                  type="text"
                  value={txnForm.invoiceNumber}
                  onChange={(e) => setTxnForm({ ...txnForm, invoiceNumber: e.target.value })}
                  placeholder="e.g. INV-881223"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                />
              </div>

              <div className="col-span-2 pt-4 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowAddTxn(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg"
                >
                  Approve & Post Ledger
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* MODAL 2: ADD ISSUE SLIP */}
      {showAddSlip && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-center items-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm">Issue Internal Fuel Slip</h3>
              <button 
                onClick={() => setShowAddSlip(false)}
                className="text-slate-500 hover:text-slate-300 font-mono text-xs"
              >
                CLOSE [X]
              </button>
            </div>

            <form onSubmit={handleCreateIssueSlip} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="block text-slate-400">Select Internal Storage Tank</label>
                <select
                  value={slipForm.fuelTankId}
                  onChange={(e) => setSlipForm({ ...slipForm, fuelTankId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                >
                  <option value="">-- Select Tank depot --</option>
                  {tanks.map((tk) => (
                    <option key={tk.tank.id} value={tk.tank.id}>{tk.tank.tankName} ({tk.tank.currentStock} L left)</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Target Vehicle Asset</label>
                <select
                  value={slipForm.vehicleId}
                  onChange={(e) => setSlipForm({ ...slipForm, vehicleId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                >
                  <option value="">-- Choose Asset --</option>
                  {opsVehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.vehicleNumber}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Assigned Driver</label>
                <select
                  value={slipForm.driverId}
                  onChange={(e) => setSlipForm({ ...slipForm, driverId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                >
                  <option value="">-- Choose Driver --</option>
                  {opsDrivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.driverName}</option>
                  ))}
                </select>
                {opsDrivers.length === 0 && (
                  <p className="text-[11px] text-amber-400">No drivers found — add drivers under Fleet → Drivers first.</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Issue Litres Quantity</label>
                <input
                  type="number"
                  value={slipForm.litres}
                  onChange={(e) => setSlipForm({ ...slipForm, litres: e.target.value })}
                  placeholder="e.g. 100"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Issue Purpose</label>
                <select
                  value={slipForm.purpose}
                  onChange={(e) => setSlipForm({ ...slipForm, purpose: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                >
                  <option value="Trip">Trip Fuel Allowance</option>
                  <option value="Backup">Backup Generator</option>
                  <option value="Local">Local Shunting</option>
                  <option value="Workshop">Workshop Servicing</option>
                </select>
              </div>

              <div className="pt-4 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowAddSlip(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg"
                >
                  Write & Release Fuel
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* MODAL 3: ADD STORAGE TANK */}
      {showAddTank && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-center items-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm">Setup Storage Tank Depot</h3>
              <button 
                onClick={() => setShowAddTank(false)}
                className="text-slate-500 hover:text-slate-300 font-mono text-xs"
              >
                CLOSE [X]
              </button>
            </div>

            <form onSubmit={handleCreateTank} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="block text-slate-400">Tank Identification / Label</label>
                <input
                  type="text"
                  value={tankForm.tankName}
                  onChange={(e) => setTankForm({ ...tankForm, tankName: e.target.value })}
                  placeholder="e.g. Lahore Depot Tank A"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Total Tank Capacity (Litres)</label>
                <input
                  type="number"
                  value={tankForm.capacity}
                  onChange={(e) => setTankForm({ ...tankForm, capacity: e.target.value })}
                  placeholder="e.g. 15000"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Opening Balance / Current Stock (Litres)</label>
                <input
                  type="number"
                  value={tankForm.openingBalance}
                  onChange={(e) => setTankForm({ ...tankForm, openingBalance: e.target.value })}
                  placeholder="e.g. 10000"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none"
                  required
                />
              </div>

              <div className="pt-4 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowAddTank(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg"
                >
                  Commission Tank
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* ON-THE-FLY MODAL 1: CREATE CARD */}
      {showCreateCardModal && (
        <div className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex justify-center items-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm text-emerald-500">Register New Fuel Card</h3>
              <button 
                type="button"
                onClick={() => setShowCreateCardModal(false)}
                className="text-slate-500 hover:text-slate-300 font-mono text-xs"
              >
                CLOSE [X]
              </button>
            </div>

            <form onSubmit={handleCreateCardOnTheFly} className="space-y-4 text-xs text-left">
              <div className="space-y-1">
                <label className="block text-slate-400">Card Number *</label>
                <input
                  type="text"
                  value={newCardForm.cardNumber}
                  onChange={(e) => setNewCardForm({ ...newCardForm, cardNumber: e.target.value })}
                  placeholder="e.g. CARD-5544-22"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none font-mono text-slate-200"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Security PIN (4-digit)</label>
                <input
                  type="text"
                  maxLength={4}
                  value={newCardForm.pin}
                  onChange={(e) => setNewCardForm({ ...newCardForm, pin: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none text-slate-200"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Associate Vehicle (Optional)</label>
                <select
                  value={newCardForm.vehicleId}
                  onChange={(e) => setNewCardForm({ ...newCardForm, vehicleId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none text-slate-200"
                >
                  <option value="">-- Choose Vehicle --</option>
                  {opsVehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.vehicleNumber}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Associate Driver (Optional)</label>
                <select
                  value={newCardForm.driverId}
                  onChange={(e) => setNewCardForm({ ...newCardForm, driverId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none text-slate-200"
                >
                  <option value="">-- Choose Driver --</option>
                  {opsDrivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.driverName}</option>
                  ))}
                </select>
                {opsDrivers.length === 0 && (
                  <p className="text-[11px] text-amber-400">No drivers found — add drivers under Fleet → Drivers first.</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Vendor Network (Optional)</label>
                <select
                  value={newCardForm.vendorId}
                  onChange={(e) => setNewCardForm({ ...newCardForm, vendorId: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none text-slate-200"
                >
                  <option value="">-- Choose Vendor --</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.vendorName}</option>
                  ))}
                </select>
              </div>

              <div className="pt-4 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowCreateCardModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg"
                >
                  Register Card
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* ON-THE-FLY MODAL 2: CREATE VENDOR */}
      {showCreateVendorModal && (
        <div className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex justify-center items-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm text-emerald-500">Create Fuel Vendor Contract</h3>
              <button 
                type="button"
                onClick={() => setShowCreateVendorModal(false)}
                className="text-slate-500 hover:text-slate-300 font-mono text-xs"
              >
                CLOSE [X]
              </button>
            </div>

            <form onSubmit={handleCreateVendorOnTheFly} className="space-y-4 text-xs text-left">
              <div className="space-y-1">
                <label className="block text-slate-400">Vendor / Brand Name *</label>
                <input
                  type="text"
                  value={newVendorForm.vendorName}
                  onChange={(e) => setNewVendorForm({ ...newVendorForm, vendorName: e.target.value })}
                  placeholder="e.g. Total Parco Pakistan"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none text-slate-200"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Company Name</label>
                <input
                  type="text"
                  value={newVendorForm.company}
                  onChange={(e) => setNewVendorForm({ ...newVendorForm, company: e.target.value })}
                  placeholder="e.g. Total Parco Ltd"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none text-slate-200"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-slate-400">Contact Phone</label>
                  <input
                    type="text"
                    value={newVendorForm.phone}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, phone: e.target.value })}
                    placeholder="+923001234567"
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none text-slate-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-slate-400">Email Address</label>
                  <input
                    type="email"
                    value={newVendorForm.email}
                    onChange={(e) => setNewVendorForm({ ...newVendorForm, email: e.target.value })}
                    placeholder="vendor@pso.com.pk"
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none text-slate-200"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Corporate Address</label>
                <textarea
                  value={newVendorForm.address}
                  onChange={(e) => setNewVendorForm({ ...newVendorForm, address: e.target.value })}
                  placeholder="Street 10, Sector G-5, Islamabad"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none h-16 text-slate-200"
                />
              </div>

              <div className="pt-4 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowCreateVendorModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg"
                >
                  Register Vendor
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* ON-THE-FLY MODAL 3: CREATE STATION */}
      {showCreateStationModal && (
        <div className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex justify-center items-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm text-emerald-500">Add Fuel Station / Depot</h3>
              <button 
                type="button"
                onClick={() => setShowCreateStationModal(false)}
                className="text-slate-500 hover:text-slate-300 font-mono text-xs"
              >
                CLOSE [X]
              </button>
            </div>

            <form onSubmit={handleCreateStationOnTheFly} className="space-y-4 text-xs text-left">
              <div className="space-y-1">
                <label className="block text-slate-400">Station Name *</label>
                <input
                  type="text"
                  value={newStationForm.stationName}
                  onChange={(e) => setNewStationForm({ ...newStationForm, stationName: e.target.value })}
                  placeholder="e.g. Shell Ring Road Station"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none text-slate-200"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">Operator Company</label>
                <input
                  type="text"
                  value={newStationForm.company}
                  onChange={(e) => setNewStationForm({ ...newStationForm, company: e.target.value })}
                  placeholder="e.g. Shell Pakistan"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none text-slate-200"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-slate-400">City</label>
                  <input
                    type="text"
                    value={newStationForm.city}
                    onChange={(e) => setNewStationForm({ ...newStationForm, city: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none text-slate-200"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-slate-400">Province / Region</label>
                  <input
                    type="text"
                    value={newStationForm.province}
                    onChange={(e) => setNewStationForm({ ...newStationForm, province: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none text-slate-200"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-slate-400">GPS Coordinates (Optional)</label>
                <input
                  type="text"
                  value={newStationForm.gpsLocation}
                  onChange={(e) => setNewStationForm({ ...newStationForm, gpsLocation: e.target.value })}
                  placeholder="31.5204, 74.3587"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-2 focus:outline-none font-mono text-slate-200"
                />
              </div>

              <div className="pt-4 flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowCreateStationModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg"
                >
                  Save Station
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

    </div>
  );
}
