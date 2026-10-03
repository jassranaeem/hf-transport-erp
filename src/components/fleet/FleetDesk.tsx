/**
 * Fleet Desk — trips, trucks, drivers, routes and customers in one place.
 * Each tab is a plain list with select / delete and a short add form that only
 * asks for what is really needed; everything else sits under "Aur details".
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Plus, Trash2, Search, Pencil, RefreshCw, Loader2, X } from "lucide-react";
import TripDesk from "./TripDesk.tsx";
import ModuleDataIO from "../common/ModuleDataIO.tsx";
import WorkbookIO from "../common/WorkbookIO.tsx";

interface Field { key: string; label: string; type?: "text" | "number" | "date"; placeholder?: string }
interface MasterCfg {
  kind: string;
  entity: string;
  label: string;
  noun: string;
  required: Field[];
  optional: Field[];
  columns: { key: string; label: string; date?: boolean }[];
}

const MASTERS: Record<string, MasterCfg> = {
  vehicles: {
    kind: "vehicles",
    entity: "vehicles",
    label: "Trucks",
    noun: "truck",
    required: [{ key: "vehicleNumber", label: "Truck number · ٹرک نمبر", placeholder: "TLD 918" }],
    optional: [
      { key: "vehicleType", label: "Type (flatbed / container…) · قسم" },
      { key: "truckBrand", label: "Brand" },
      { key: "model", label: "Model" },
      { key: "year", label: "Year · سال", type: "number" },
      { key: "containerType", label: "Container size" },
      { key: "payloadCapacity", label: "Payload (kg)", type: "number" },
      { key: "currentOdometer", label: "Odometer (km)", type: "number" },
      { key: "engineNumber", label: "Engine number" },
      { key: "chassisNumber", label: "Chassis number" },
      { key: "insuranceExpiry", label: "Insurance expiry", type: "date" },
      { key: "fitnessExpiry", label: "Fitness expiry", type: "date" },
    ],
    columns: [
      { key: "vehicleNumber", label: "Truck" },
      { key: "vehicleType", label: "Type" },
      { key: "truckBrand", label: "Brand" },
      { key: "model", label: "Model" },
      { key: "currentStatus", label: "Status" },
    ],
  },
  drivers: {
    kind: "drivers",
    entity: "drivers",
    label: "Drivers",
    noun: "driver",
    required: [{ key: "driverName", label: "Driver name · ڈرائیور کا نام" }],
    optional: [
      { key: "mobile", label: "Phone" },
      { key: "cnic", label: "CNIC" },
      { key: "licenseNumber", label: "License number" },
      { key: "licenseExpiry", label: "License expiry", type: "date" },
      { key: "salary", label: "Salary (PKR) · تنخواہ", type: "number" },
      { key: "address", label: "Address" },
    ],
    columns: [
      { key: "driverName", label: "Driver" },
      { key: "mobile", label: "Phone" },
      { key: "status", label: "Status" },
      { key: "licenseExpiry", label: "License expiry", date: true },
    ],
  },
  routes: {
    kind: "routes",
    entity: "routes",
    label: "Routes",
    noun: "route",
    required: [
      { key: "origin", label: "From · کہاں سے" },
      { key: "destination", label: "To · کہاں تک" },
    ],
    optional: [
      { key: "distance", label: "Distance (km)", type: "number" },
      { key: "expectedHours", label: "Expected hours · گھنٹے", type: "number" },
      { key: "benchmarkFuel", label: "Expected diesel (litres) · ڈیزل", type: "number" },
      { key: "expectedToll", label: "Toll (PKR)", type: "number" },
      { key: "revenue", label: "Freight (PKR) · کرایہ", type: "number" },
    ],
    columns: [
      { key: "origin", label: "From" },
      { key: "destination", label: "To" },
      { key: "distance", label: "km" },
      { key: "expectedHours", label: "Hours" },
      { key: "revenue", label: "Freight" },
    ],
  },
  customers: {
    kind: "customers",
    entity: "contractors",
    label: "Customers",
    noun: "customer",
    required: [{ key: "company", label: "Customer / carrier name · کسٹمر / کیریئر کا نام" }],
    optional: [
      { key: "contactPerson", label: "Contact person · رابطہ شخص" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "address", label: "Address" },
      { key: "paymentTerms", label: "Payment terms (Net 30 / Cash…)" },
    ],
    columns: [
      { key: "company", label: "Customer" },
      { key: "contactPerson", label: "Contact" },
      { key: "phone", label: "Phone" },
      { key: "status", label: "Status" },
    ],
  },
};

const TABS = [
  { id: "trips", label: "Trips" },
  { id: "vehicles", label: "Trucks" },
  { id: "drivers", label: "Drivers" },
  { id: "routes", label: "Routes" },
  { id: "customers", label: "Customers" },
];

const isRealDate = (v: any) => v && new Date(v).getFullYear() > 1971;
const show = (v: any) => (typeof v === "string" && v.startsWith("PENDING-") ? "" : v ?? "");

function MasterTab({
  cfg,
  showFeedback,
}: {
  cfg: MasterCfg;
  showFeedback: (type: "success" | "error", message: string) => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    enterpriseFetch(`/api/trip-desk/master/${cfg.kind}`)
      .then(setRows)
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [cfg.kind, showFeedback]);
  useEffect(() => {
    setSelected(new Set());
    setForm(null);
    setEditId(null);
    setQ("");
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((r) => Object.values(r).join(" ").toLowerCase().includes(n));
  }, [rows, q]);
  const allSel = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const startAdd = () => {
    setEditId(null);
    setForm({});
  };
  const startEdit = (r: any) => {
    const f: Record<string, string> = {};
    for (const fld of [...cfg.required, ...cfg.optional]) {
      const v = r[fld.key];
      f[fld.key] = fld.type === "date" ? (isRealDate(v) ? String(v).slice(0, 10) : "") : String(show(v));
    }
    setEditId(r.id);
    setForm(f);
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      if (editId) {
        await enterpriseFetch(`/api/trip-desk/master/${cfg.kind}/${editId}`, { method: "PUT", body: JSON.stringify(form) });
        showFeedback("success", "Saved · محفوظ ہو گیا");
      } else {
        await enterpriseFetch(`/api/trip-desk/master/${cfg.kind}`, { method: "POST", body: JSON.stringify(form) });
        showFeedback("success", `New ${cfg.noun} added · نیا اندراج شامل ہو گیا`);
      }
      setForm(null);
      setEditId(null);
      load();
    } catch (e: any) {
      showFeedback("error", e.message || "Could not save · محفوظ نہیں ہو سکا");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} ${cfg.noun}(s)? · کیا ${ids.length} حذف کریں؟`)) return;
    try {
      const r = await enterpriseFetch(`/api/trip-desk/master/${cfg.kind}/delete`, { method: "POST", body: JSON.stringify({ ids }) });
      showFeedback("success", `${r.deleted} deleted · حذف ہو گئے`);
      setSelected(new Set());
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const inp = "mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white";
  const lbl = "text-[11px] font-semibold text-slate-500";
  const cell = (r: any, c: MasterCfg["columns"][number]) => {
    const v = r[c.key];
    if (c.date) return isRealDate(v) ? new Date(v).toLocaleDateString() : "—";
    const s = show(v);
    return s === "" || s === 0 ? "—" : String(s);
  };

  return (
    <div className="space-y-4 p-3">
      {form && (
        <div className="border border-emerald-200 rounded-xl bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">{editId ? `Edit ${cfg.noun} · ترمیم` : `New ${cfg.noun} · نیا`}</h3>
            <button onClick={() => { setForm(null); setEditId(null); }} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {cfg.required.map((f) => (
              <div key={f.key}>
                <label className={lbl}>{f.label} *</label>
                <input className={inp} value={form[f.key] || ""} placeholder={f.placeholder} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              </div>
            ))}
          </div>
          <details open={!!editId}>
            <summary className="text-xs font-semibold text-emerald-700 cursor-pointer">More details (optional) · مزید تفصیل (اختیاری)</summary>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
              {cfg.optional.map((f) => (
                <div key={f.key}>
                  <label className={lbl}>{f.label}</label>
                  <input type={f.type || "text"} className={inp} value={form[f.key] || ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                </div>
              ))}
            </div>
          </details>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 text-sm font-semibold rounded-lg bg-emerald-600 text-white px-5 py-2 hover:bg-emerald-700 disabled:opacity-60">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      )}

      <div className="border border-slate-200 rounded-xl bg-white">
        <div className="p-3 flex items-center gap-2 border-b border-slate-100 flex-wrap">
          <Search className="w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="text-sm flex-1 min-w-[140px] outline-none" />
          {selected.size > 0 && (
            <button onClick={del} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg border border-red-300 text-red-600 px-3 py-1.5 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" /> Delete {selected.size} selected
            </button>
          )}
          <ModuleDataIO entityKey={cfg.entity} label={cfg.label} onImported={load} />
          <button onClick={load} className="inline-flex items-center gap-1.5 text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 hover:bg-slate-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button onClick={startAdd} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white px-3 py-1.5 hover:bg-emerald-700">
            <Plus className="w-3.5 h-3.5" /> New {cfg.noun}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="w-8 px-2 py-2"><input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(filtered.map((r) => r.id)))} /></th>
                {cfg.columns.map((c) => <th key={c.key} className="text-left px-2">{c.label}</th>)}
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={cfg.columns.length + 2} className="p-6 text-center text-slate-400">{loading ? "Loading…" : `No ${cfg.noun} yet. · ابھی کوئی نہیں۔`}</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className={`border-t border-slate-100 hover:bg-slate-50 ${selected.has(r.id) ? "bg-red-50/40" : ""}`}>
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} />
                  </td>
                  {cfg.columns.map((c, i) => (
                    <td key={c.key} className={`px-2 ${i === 0 ? "font-semibold text-slate-800" : ""}`}>{cell(r, c)}</td>
                  ))}
                  <td className="px-2 text-right">
                    <button onClick={() => startEdit(r)} className="text-slate-400 hover:text-emerald-700" title="Edit"><Pencil className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function FleetDesk({
  showFeedback,
}: {
  showFeedback: (type: "success" | "error", message: string) => void;
}) {
  const [tab, setTab] = useState("trips");
  const [reload, setReload] = useState(0);
  return (
    <div className="h-full flex flex-col">
      <div className="px-3 pt-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="text-xs text-slate-500" dir="auto">One click for every list · ایک کلک میں سب لسٹیں</div>
        <WorkbookIO entities={["trips", "vehicles", "drivers", "routes", "contractors"]} fileName="fleet-desk" onImported={() => setReload((n) => n + 1)} />
      </div>
      <div className="flex gap-1 px-3 pt-3 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-xs font-semibold rounded-full px-4 py-1.5 ${tab === t.id ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <React.Fragment key={tab + reload}>{tab === "trips" ? <TripDesk showFeedback={showFeedback} /> : <MasterTab cfg={MASTERS[tab]} showFeedback={showFeedback} />}</React.Fragment>
      </div>
    </div>
  );
}
