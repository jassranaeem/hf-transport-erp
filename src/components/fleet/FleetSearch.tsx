import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Search, Calendar, ShieldAlert, FileText, CheckCircle, AlertTriangle, UserCheck, Truck,
  ChevronDown, ChevronRight, Wallet, Fuel, Wrench, Route, Phone, ExternalLink, Loader2,
  FileSpreadsheet,
} from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import FleetSetupImport from "./FleetSetupImport.tsx";

interface ExpiryAlert {
  entityType: "Vehicle" | "Driver";
  entityName: string;
  field: string;
  expiryDate: string;
  daysLeft: number;
  status: "Expired" | "Critical" | "Warning" | "Valid";
}

const fmt = (n: number) => "PKR " + Math.abs(Math.round(n || 0)).toLocaleString();
const dt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

const STATUS_COLORS: Record<string, string> = {
  Expired: "bg-red-100 text-red-700 border-red-200",
  Critical: "bg-red-50 text-red-600 border-red-200",
  Warning: "bg-amber-100 text-amber-800 border-amber-200",
  Valid: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Unknown: "bg-slate-100 text-slate-500 border-slate-200",
};

function StatBox({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className={`text-lg font-bold mt-0.5 ${tone || "text-slate-800"}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

// One truck's full picture — khata + trips + expenses + maintenance + fuel +
// compliance — pulled from a single call (GET /api/operations/vehicles/:id/profile)
// so "koi bhi truck search karke uski saari detail ek jagah" doesn't mean
// hunting across five separate screens.
function TruckProfile({
  vehicleId,
  showFeedback,
  onOpenLedger,
}: {
  vehicleId: number;
  showFeedback: (type: "success" | "error", message: string) => void;
  onOpenLedger?: (ledgerId: number) => void;
}) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [openLedger, setOpenLedger] = useState<number | null>(null);
  const [section, setSection] = useState<"khata" | "trips" | "expenses" | "maintenance" | "fuel">("khata");
  // profile.khata only ships the latest 15 entries per ledger (keeps the
  // initial page load light) — full history for whichever ledger is expanded
  // is fetched on demand and cached here, so "click to open" really does mean
  // the complete list, not a truncated preview.
  const [fullEntries, setFullEntries] = useState<Record<number, any[]>>({});
  const [loadingFull, setLoadingFull] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setOpenLedger(null);
    enterpriseFetch(`/api/operations/vehicles/${vehicleId}/profile`)
      .then(setProfile)
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [vehicleId, showFeedback]);

  if (loading) {
    return (
      <div className="border border-slate-200 rounded-xl bg-white p-8 flex items-center justify-center text-slate-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading truck profile…
      </div>
    );
  }
  if (!profile) return null;

  const v = profile.vehicle;
  const netKhata = profile.khata.netBalance;

  const toggleLedger = (l: any) => {
    if (openLedger === l.id) {
      setOpenLedger(null);
      return;
    }
    setOpenLedger(l.id);
    if (!fullEntries[l.id] && l.entryCount > l.recentEntries.length) {
      setLoadingFull(l.id);
      enterpriseFetch(`/api/ledgers/${l.id}?limit=5000`)
        .then((r) => setFullEntries((prev) => ({ ...prev, [l.id]: r.entries || [] })))
        .catch((e) => showFeedback("error", e.message))
        .finally(() => setLoadingFull(null));
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="border border-slate-200 rounded-xl bg-white p-4">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-emerald-600" />
              <h2 className="text-xl font-black text-slate-800">{v.vehicleNumber}</h2>
              <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">{v.currentStatus}</span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {v.truckBrand} {v.model} · {v.year} · {v.vehicleType} · {v.containerType}
            </p>
          </div>
          <div className="flex gap-2">
            <span className={`text-[11px] font-semibold rounded-full border px-2 py-1 ${STATUS_COLORS[profile.compliance.insurance.status]}`}>
              Insurance: {profile.compliance.insurance.status}
              {profile.compliance.insurance.daysLeft != null && ` (${profile.compliance.insurance.daysLeft}d)`}
            </span>
            <span className={`text-[11px] font-semibold rounded-full border px-2 py-1 ${STATUS_COLORS[profile.compliance.fitness.status]}`}>
              Fitness: {profile.compliance.fitness.status}
              {profile.compliance.fitness.daysLeft != null && ` (${profile.compliance.fitness.daysLeft}d)`}
            </span>
          </div>
        </div>

        {profile.driver && (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
            <UserCheck className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold">{profile.driver.driverName}</span>
            {profile.driver.mobile && (
              <span className="flex items-center gap-1 text-slate-400"><Phone className="w-3 h-3" /> {profile.driver.mobile}</span>
            )}
            <span className="text-slate-400">· {profile.driver.status}</span>
          </div>
        )}

        {/* at-a-glance numbers */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
          <StatBox icon={Wallet} label="Khata balance" value={fmt(netKhata)} sub={`${profile.khata.totalLedgers} ledger(s)`} tone={netKhata > 0 ? "text-emerald-700" : netKhata < 0 ? "text-red-600" : "text-slate-500"} />
          <StatBox icon={Route} label="Trips" value={String(profile.trips.total)} sub={fmt(profile.trips.totalRevenue) + " revenue"} />
          <StatBox icon={Wallet} label="Expenses" value={fmt(profile.expenses.totalAmount)} sub={`${profile.expenses.total} filed`} />
          <StatBox icon={Wrench} label="Maintenance" value={fmt(profile.maintenance.totalCost)} sub={`${profile.maintenance.total} job(s)`} />
          <StatBox icon={Fuel} label="Fuel" value={fmt(profile.fuel.totalCost)} sub={`${profile.fuel.totalLitres.toFixed(0)} L`} />
        </div>
      </div>

      {/* section tabs */}
      <div className="flex gap-1 flex-wrap">
        {([
          ["khata", "Khata", profile.khata.totalEntries],
          ["trips", "Trips", profile.trips.total],
          ["expenses", "Expenses", profile.expenses.total],
          ["maintenance", "Maintenance", profile.maintenance.total],
          ["fuel", "Fuel", profile.fuel.total],
        ] as const).map(([id, label, count]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`text-xs font-semibold rounded-full px-3 py-1.5 ${section === id ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      {section === "khata" && (
        <div className="border border-slate-200 rounded-xl bg-white divide-y divide-slate-100">
          {profile.khata.ledgers.length === 0 && <div className="p-4 text-sm text-slate-400">No khata entries found for this truck.</div>}
          {profile.khata.ledgers.map((l: any) => (
            <div key={l.id}>
              <button onClick={() => toggleLedger(l)} className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">{l.sourceSheet || l.title}</div>
                  <div className="text-[11px] text-slate-400">{l.entryCount} entries{l.ownerName ? ` · ${l.ownerName}` : ""}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-sm font-bold ${l.closingBalance > 0 ? "text-emerald-700" : l.closingBalance < 0 ? "text-red-600" : "text-slate-400"}`}>{fmt(l.closingBalance)}</span>
                  {openLedger === l.id ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                </div>
              </button>
              {openLedger === l.id && (
                <div className="px-4 pb-3">
                  {loadingFull === l.id ? (
                    <div className="flex items-center gap-2 text-sm text-slate-400 py-6 justify-center">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading complete history ({l.entryCount} entries)…
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-lg border border-slate-100 max-h-[480px] overflow-y-auto">
                        <table className="w-full text-[12px]">
                          <thead className="bg-slate-50 text-slate-500 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-1.5">Date</th>
                              <th className="text-left px-2 py-1.5">Description</th>
                              <th className="text-right px-2 py-1.5">Received</th>
                              <th className="text-right px-2 py-1.5">Paid</th>
                              <th className="text-right px-2 py-1.5">Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(fullEntries[l.id] || l.recentEntries).map((e: any) => (
                              <tr key={e.id} className="border-t border-slate-50">
                                <td className="px-2 py-1.5 text-slate-500">{e.rawDate || dt(e.entryDate)}</td>
                                <td className="px-2 py-1.5 text-slate-700">{e.description || "—"}</td>
                                <td className="px-2 py-1.5 text-right text-emerald-700">{e.received ? fmt(e.received) : ""}</td>
                                <td className="px-2 py-1.5 text-right text-red-600">{e.paid ? fmt(e.paid) : ""}</td>
                                <td className="px-2 py-1.5 text-right font-semibold">{fmt(e.runningBalance)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1.5">
                        {fullEntries[l.id] ? `Showing all ${fullEntries[l.id].length} entries.` : `Showing latest ${l.recentEntries.length} of ${l.entryCount} entries.`}
                      </p>
                    </>
                  )}
                  {onOpenLedger && (
                    <button onClick={() => onOpenLedger(l.id)} className="mt-2 text-[12px] font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1">
                      Open full ledger (edit here) <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {section === "trips" && (
        <div className="border border-slate-200 rounded-xl bg-white overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr><th className="text-left px-3 py-2">Trip #</th><th className="text-left px-3 py-2">Departure</th><th className="text-left px-3 py-2">Status</th><th className="text-right px-3 py-2">Revenue</th></tr>
            </thead>
            <tbody>
              {profile.trips.recent.map((t: any) => (
                <tr key={t.id} className="border-t border-slate-50">
                  <td className="px-3 py-2 font-mono">{t.tripNumber}</td>
                  <td className="px-3 py-2 text-slate-500">{dt(t.departureTime)}</td>
                  <td className="px-3 py-2">{t.status}</td>
                  <td className="px-3 py-2 text-right">{fmt(t.revenue)}</td>
                </tr>
              ))}
              {profile.trips.recent.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">No trips recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {section === "expenses" && (
        <div className="space-y-3">
          {profile.expenses.byType.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {profile.expenses.byType.map((t: any) => (
                <span key={t.type} className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-1">{t.type}: {fmt(t.total)}</span>
              ))}
            </div>
          )}
          <div className="border border-slate-200 rounded-xl bg-white overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Status</th><th className="text-right px-3 py-2">Amount</th></tr>
              </thead>
              <tbody>
                {profile.expenses.recent.map((e: any) => (
                  <tr key={e.id} className="border-t border-slate-50">
                    <td className="px-3 py-2 text-slate-500">{dt(e.expenseDate)}</td>
                    <td className="px-3 py-2">{e.expenseType}</td>
                    <td className="px-3 py-2">{e.status}</td>
                    <td className="px-3 py-2 text-right">{fmt(e.amount)}</td>
                  </tr>
                ))}
                {profile.expenses.recent.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">No expenses filed.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === "maintenance" && (
        <div className="border border-slate-200 rounded-xl bg-white overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Status</th><th className="text-right px-3 py-2">Cost</th></tr>
            </thead>
            <tbody>
              {profile.maintenance.recent.map((m: any) => (
                <tr key={m.id} className="border-t border-slate-50">
                  <td className="px-3 py-2 text-slate-500">{dt(m.scheduledDate)}</td>
                  <td className="px-3 py-2">{m.maintenanceType}</td>
                  <td className="px-3 py-2">{m.status}</td>
                  <td className="px-3 py-2 text-right">{fmt(m.actualCost)}</td>
                </tr>
              ))}
              {profile.maintenance.recent.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">No maintenance jobs recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {section === "fuel" && (
        <div className="border border-slate-200 rounded-xl bg-white overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr><th className="text-left px-3 py-2">Date</th><th className="text-right px-3 py-2">Litres</th><th className="text-right px-3 py-2">Total</th></tr>
            </thead>
            <tbody>
              {profile.fuel.recent.map((f: any) => (
                <tr key={f.id} className="border-t border-slate-50">
                  <td className="px-3 py-2 text-slate-500">{dt(f.transactionDate)}</td>
                  <td className="px-3 py-2 text-right">{Number(f.litres).toFixed(1)}</td>
                  <td className="px-3 py-2 text-right">{fmt(f.total)}</td>
                </tr>
              ))}
              {profile.fuel.recent.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-400">No fuel transactions recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function FleetSearch({
  showFeedback,
  onOpenLedger,
}: {
  showFeedback: (type: "success" | "error", message: string) => void;
  onOpenLedger?: (ledgerId: number) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showImport, setShowImport] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Document Expiries (fleet-wide board — kept, separate from the per-truck profile above)
  const [expiryAlerts, setExpiryAlerts] = useState<ExpiryAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);

  const fetchExpiryAlerts = useCallback(() => {
    setAlertsLoading(true);
    enterpriseFetch("/api/operations/compliance/alerts")
      .then(setExpiryAlerts)
      .catch((err: any) => showFeedback("error", err.message || "Failed to query document expiration metrics"))
      .finally(() => setAlertsLoading(false));
  }, [showFeedback]);
  useEffect(fetchExpiryAlerts, [fetchExpiryAlerts]);

  // live-as-you-type truck search — type any part of the vehicle number and
  // matching trucks show up immediately, click one to see its full profile.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      enterpriseFetch(`/api/operations/vehicles?limit=10&search=${encodeURIComponent(q.trim())}`)
        .then((r) => setResults(r.data || []))
        .catch((e: any) => showFeedback("error", e.message))
        .finally(() => setSearching(false));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, showFeedback]);

  return (
    <div className="space-y-6">
      {/* Setup Import (Excel) — collapsible, lives inside Truck Search now */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowImport((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
        >
          <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Setup Import (Excel)
          </span>
          {showImport ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        </button>
        {showImport && (
          <div className="border-t border-slate-100 p-4">
            <FleetSetupImport showFeedback={showFeedback} />
          </div>
        )}
      </div>

      {/* Search Bar Input */}
      <div className="bg-white p-4 border border-slate-200 rounded-xl space-y-3">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Search className="w-4 h-4 text-emerald-600" /> Truck Search — full profile in one place
        </h2>
        <p className="text-[12px] text-slate-500">
          Type any truck number — ledger, trips, expenses, maintenance, fuel and compliance all appear in one place. · کوئی بھی ٹرک نمبر لکھیں — کھاتہ، ٹرپس، اخراجات، مینٹیننس، ایندھن اور کمپلائنس سب ایک جگہ نظر آئیں گے۔
        </p>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            autoFocus
            placeholder="Type a truck number (e.g. TLB 100)…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setSelectedId(null); }}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:outline-none"
          />
          {searching && <Loader2 className="absolute right-3 top-2.5 w-4 h-4 text-slate-400 animate-spin" />}
        </div>

        {q.trim() && !selectedId && (
          <div className="border border-slate-100 rounded-lg divide-y divide-slate-50 max-h-64 overflow-y-auto">
            {results.length === 0 && !searching && <div className="px-3 py-3 text-sm text-slate-400">No truck matches "{q}".</div>}
            {results.map((v) => (
              <button key={v.id} onClick={() => setSelectedId(v.id)} className="w-full text-left px-3 py-2.5 hover:bg-emerald-50 flex items-center justify-between">
                <div>
                  <span className="font-bold text-sm text-slate-800">{v.vehicleNumber}</span>
                  <span className="text-slate-400 text-xs ml-2">{v.truckBrand} {v.model}</span>
                </div>
                <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">{v.currentStatus}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedId && <TruckProfile vehicleId={selectedId} showFeedback={showFeedback} onOpenLedger={onOpenLedger} />}

      {/* Compliance dashboard and Expiry lists — fleet-wide, unchanged */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 border border-slate-200 rounded-xl space-y-3 md:col-span-1">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-red-500" /> Compliance Vault Status
          </h3>
          <p className="text-[11px] text-slate-500">
            Real-time visual monitoring of all company operations permits, insurance, fitness clearances, and driver licensing deadlines.
          </p>
          <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-center justify-between">
            <div>
              <p className="text-[10px] text-red-600 font-bold uppercase">Critical Warnings</p>
              <p className="text-xl font-mono font-black text-red-600">
                {expiryAlerts.filter((a) => a.status === "Expired" || a.status === "Critical").length}
              </p>
            </div>
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>
          <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg flex items-center justify-between">
            <div>
              <p className="text-[10px] text-amber-700 font-bold uppercase">Upcoming Expirations</p>
              <p className="text-xl font-mono font-black text-amber-700">
                {expiryAlerts.filter((a) => a.status === "Warning").length}
              </p>
            </div>
            <Calendar className="w-7 h-7 text-amber-500" />
          </div>
        </div>

        <div className="bg-white p-4 border border-slate-200 rounded-xl space-y-3 md:col-span-2">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-emerald-600" /> Document Permit Expiration Alerts
          </h3>
          {alertsLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}</div>
          ) : expiryAlerts.length === 0 ? (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-lg text-emerald-700 text-xs font-semibold">
              <CheckCircle className="w-4 h-4" /> All operational certificates, insurance covers, and driver permits are fully active and compliant!
            </div>
          ) : (
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {expiryAlerts.map((alert, i) => (
                <div key={i} className={`flex justify-between items-center p-2.5 rounded text-xs border ${STATUS_COLORS[alert.status]}`}>
                  <div>
                    <span className="font-semibold">{alert.entityType}: {alert.entityName}</span>
                    <p className="text-[10px] text-slate-500">Expired permit category: {alert.field}</p>
                  </div>
                  <div className="text-right font-mono">
                    <p className="font-bold">{alert.daysLeft < 0 ? "EXPIRED" : `${alert.daysLeft} Days Left`}</p>
                    <p className="text-[9px] text-slate-400">Date: {new Date(alert.expiryDate).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
