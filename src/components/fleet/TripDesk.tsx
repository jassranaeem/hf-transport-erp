/**
 * Trip Desk — one trip = one whole journey of a truck, however many stops it has
 * (e.g. Karachi → 250 border with meat, then 250 border → Islamabad with grapes).
 * A single form starts the trip; later stops are added inside it; cash, diesel and
 * receipts hang off the trip; and the trip is completed once, at the very end.
 * Anything that does not exist yet (truck, driver, route, customer, ledger) is
 * created automatically.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import AttachmentPanel from "../common/AttachmentPanel.tsx";
import { Plus, Trash2, Search, ChevronDown, ChevronRight, Loader2, RefreshCw, Pencil } from "lucide-react";

const fmt = (n: number) => "PKR " + Math.round(n || 0).toLocaleString();
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const toLocal = (iso: string) => {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const emptyForm = () => ({
  truck: "", driverName: "", driverPhone: "", from: "", to: "", customer: "",
  departure: nowLocal(), freight: "", cash: "", dieselAmount: "", dieselLitres: "", dieselPump: "", dieselRef: "", dieselPayment: "Cash", cargo: "",
});
const STATUSES = ["Scheduled", "In Transit", "Arrived", "Completed"];

interface Opts {
  vehicles: { id: number; vehicleNumber: string }[];
  drivers: { id: number; driverName: string; mobile: string }[];
  contractors: { id: number; company: string }[];
  routes: { id: number; origin: string; destination: string }[];
}
interface Journey {
  root: number;
  legs: any[];
  first: any;
  last: any;
  freight: number;
  given: number;
  fromLedger: number;
  cash: number;
  diesel: number;
  route: string;
  loads: string;
  customers: string;
}

export default function TripDesk({
  showFeedback,
}: {
  showFeedback: (type: "success" | "error", message: string) => void;
}) {
  const [opts, setOpts] = useState<Opts>({ vehicles: [], drivers: [], contractors: [], routes: [] });
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openId, setOpenId] = useState<number | null>(null);
  const [money, setMoney] = useState({ tripId: 0, kind: "cash", amount: "", note: "" });
  const [addingMoney, setAddingMoney] = useState(false);
  const [stop, setStop] = useState({ from: "", to: "", cargo: "", customer: "", freight: "", departure: nowLocal() });
  const [addingStop, setAddingStop] = useState(false);
  const [entries, setEntries] = useState<any[]>([]);
  const [editLegId, setEditLegId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [entryEdit, setEntryEdit] = useState<{ id: number; date: string; amount: string; description: string } | null>(null);

  const loadEntries = useCallback((rootId: number) => {
    enterpriseFetch(`/api/trip-desk/${rootId}/entries?journey=1`).then(setEntries).catch(() => setEntries([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      enterpriseFetch("/api/trip-desk").then(setTrips),
      enterpriseFetch("/api/trip-desk/options").then(setOpts),
    ])
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(load, [load]);
  useEffect(() => {
    setEditLegId(null);
    setEntryEdit(null);
    if (openId != null) loadEntries(openId);
  }, [openId, loadEntries]);

  const set = (k: keyof ReturnType<typeof emptyForm>, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const truckKnown = form.truck.trim() && opts.vehicles.some((v) => norm(v.vehicleNumber) === norm(form.truck));
  const driverMatch = opts.drivers.find((d) => d.driverName.toLowerCase() === form.driverName.trim().toLowerCase());
  const onDriverName = (v: string) => {
    const m = opts.drivers.find((d) => d.driverName.toLowerCase() === v.trim().toLowerCase());
    setForm((f) => ({ ...f, driverName: v, driverPhone: m && !f.driverPhone ? m.mobile || "" : f.driverPhone }));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const r = await enterpriseFetch("/api/trip-desk", {
        method: "POST",
        body: JSON.stringify({ ...form, departure: new Date(form.departure).toISOString() }),
      });
      showFeedback("success", `Trip created (${r.tripNumber})${r.created.length ? " · new: " + r.created.join(", ") : ""} · ٹرپ بن گئی`);
      setForm(emptyForm());
      load();
    } catch (e: any) {
      showFeedback("error", e.message || "Could not create the trip · ٹرپ نہیں بن سکی");
    } finally {
      setSaving(false);
    }
  };

  // one journey = the first leg + every later stop; shown as ONE trip
  const journeyList: Journey[] = useMemo(() => {
    const byRoot = new Map<number, any[]>();
    for (const t of trips) {
      const root = t.parentTripId || t.id;
      byRoot.set(root, [...(byRoot.get(root) || []), t]);
    }
    const list = [...byRoot.entries()].map(([root, legs]) => {
      legs.sort((a, b) => (a.legNo || 1) - (b.legNo || 1));
      const first = legs[0];
      const last = legs[legs.length - 1];
      const stops = [first.origin, ...legs.map((l) => l.destination)];
      return {
        root, legs, first, last,
        freight: legs.reduce((s, x) => s + (x.revenue || 0), 0),
        given: legs.reduce((s, x) => s + (x.totalGiven || 0) + (x.ledgerPaid || 0), 0),
        fromLedger: legs.reduce((s, x) => s + (x.ledgerPaid || 0), 0),
        cash: legs.reduce((s, x) => s + (x.cash || 0), 0),
        diesel: legs.reduce((s, x) => s + (x.diesel || 0), 0),
        route: stops.join(" → "),
        loads: legs.map((l) => l.cargo || "Empty").join(" → "),
        customers: [...new Set(legs.map((l) => l.company).filter(Boolean))].join(", "),
      } as Journey;
    });
    list.sort((a, b) => new Date(b.first.departureTime).getTime() - new Date(a.first.departureTime).getTime());
    return list;
  }, [trips]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return journeyList;
    return journeyList.filter((j) =>
      [j.first.vehicleNumber, j.first.driverName, j.route, j.customers, j.loads, ...j.legs.map((l) => l.tripNumber)].join(" ").toLowerCase().includes(n),
    );
  }, [journeyList, q]);

  const allSel = filtered.length > 0 && filtered.every((j) => selected.has(j.root));
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const deleteSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} trip(s) with all their stops? Their cash / diesel ledger entries and receipts will be removed too. · کیا ${ids.length} ٹرپ حذف کریں؟ ان کی کیش / ڈیزل انٹریز اور رسیدیں بھی ہٹ جائیں گی۔`)) return;
    try {
      const r = await enterpriseFetch("/api/trip-desk/delete", { method: "POST", body: JSON.stringify({ ids }) });
      showFeedback("success", `${r.deleted} record(s) deleted, ${r.khataEntriesRemoved} ledger entries removed · حذف ہو گئیں`);
      setSelected(new Set());
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const setStatus = async (id: number, status: string) =>
    enterpriseFetch(`/api/operations/trips/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });

  // the trip has ONE status: the status of its current (last) stop. Completing it completes every stop.
  const changeJourneyStatus = async (j: Journey, status: string) => {
    if (status === "Completed" && !window.confirm("Completing this trip will create the invoice(s) for its stops automatically. Continue? · ٹرپ مکمل کرنے پر انوائس خود بن جائیں گی۔ جاری رکھیں؟")) return;
    try {
      if (status === "Completed") {
        for (const l of j.legs) if (l.status !== "Completed") await setStatus(l.id, "Completed");
      } else {
        await setStatus(j.last.id, status);
      }
      showFeedback("success", `${j.first.vehicleNumber}: ${status}`);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const addStop = async (j: Journey) => {
    setAddingStop(true);
    try {
      const r = await enterpriseFetch(`/api/trip-desk/${j.last.id}/next-leg`, {
        method: "POST",
        body: JSON.stringify({ ...stop, departure: new Date(stop.departure).toISOString() }),
      });
      showFeedback("success", `Stop ${r.legNo} added to the trip · اگلا پڑاؤ شامل ہو گیا`);
      setStop({ from: "", to: "", cargo: "", customer: "", freight: "", departure: nowLocal() });
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setAddingStop(false);
    }
  };

  const startEditLeg = (l: any) => {
    setEditForm({
      departure: toLocal(l.departureTime), from: l.origin || "", to: l.destination || "", customer: l.company || "",
      freight: String(l.revenue || ""), cargo: l.cargo || "", driverName: l.driverName || "", driverPhone: l.driverMobile || "",
    });
    setEditLegId(l.id);
  };
  const saveEditLeg = async () => {
    if (editLegId == null) return;
    setSavingEdit(true);
    try {
      await enterpriseFetch(`/api/trip-desk/${editLegId}`, {
        method: "PUT",
        body: JSON.stringify({ ...editForm, departure: new Date(editForm.departure).toISOString() }),
      });
      showFeedback("success", "Updated · اپڈیٹ ہو گیا");
      setEditLegId(null);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const addMoney = async (j: Journey) => {
    setAddingMoney(true);
    try {
      await enterpriseFetch(`/api/trip-desk/${money.tripId || j.last.id}/money`, {
        method: "POST",
        body: JSON.stringify({ kind: money.kind, amount: Number(money.amount), note: money.note }),
      });
      showFeedback("success", "Ledger entry added · کھاتے میں انٹری ہو گئی");
      setMoney({ tripId: 0, kind: "cash", amount: "", note: "" });
      loadEntries(j.root);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setAddingMoney(false);
    }
  };
  const saveEntry = async (rootId: number) => {
    if (!entryEdit) return;
    try {
      await enterpriseFetch(`/api/trip-desk/entry/${entryEdit.id}`, {
        method: "PUT",
        body: JSON.stringify({ entryDate: entryEdit.date, amount: Number(entryEdit.amount), description: entryEdit.description }),
      });
      showFeedback("success", "Entry updated · انٹری اپڈیٹ ہو گئی");
      setEntryEdit(null);
      loadEntries(rootId);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  const deleteEntry = async (id: number, rootId: number) => {
    if (!window.confirm("Delete this entry? · کیا یہ انٹری حذف کریں؟")) return;
    try {
      await enterpriseFetch(`/api/trip-desk/entry/${id}`, { method: "DELETE" });
      loadEntries(rootId);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const inp = "mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white";
  const lbl = "text-[11px] font-semibold text-slate-500";
  const small = "border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white";
  const btn = "text-sm font-semibold rounded-lg bg-emerald-600 text-white px-4 py-1.5 hover:bg-emerald-700 disabled:opacity-60";

  return (
    <div className="space-y-4 p-3">
      <datalist id="td-trucks">{opts.vehicles.map((v) => <option key={v.id} value={v.vehicleNumber} />)}</datalist>
      <datalist id="td-drivers">{opts.drivers.map((d) => <option key={d.id} value={d.driverName} />)}</datalist>
      <datalist id="td-customers">{opts.contractors.map((c) => <option key={c.id} value={c.company} />)}</datalist>
      <datalist id="td-from">{[...new Set(opts.routes.map((r) => r.origin))].map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="td-to">{[...new Set(opts.routes.map((r) => r.destination))].map((o) => <option key={o} value={o} />)}</datalist>

      <div className="border border-emerald-200 rounded-xl bg-white p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <h2 className="text-base font-bold text-slate-800">New trip <span className="text-slate-400 font-normal text-sm">· نئی ٹرپ</span></h2>
          <span className="text-[11px] text-slate-400">Fill in the first stop. More stops (e.g. the loaded run back) are added inside the trip. · پہلا پڑاؤ بھریں، آگے کے پڑاؤ ٹرپ کے اندر شامل ہوں گے</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={lbl}>Truck number * · ٹرک نمبر</label>
            <input list="td-trucks" className={inp} value={form.truck} onChange={(e) => set("truck", e.target.value)} placeholder="e.g. ABC 123" />
            {form.truck.trim() && <div className={`text-[10px] mt-0.5 ${truckKnown ? "text-emerald-700" : "text-amber-600"}`}>{truckKnown ? "In fleet ✓" : "A new truck will be created"}</div>}
          </div>
          <div>
            <label className={lbl}>Driver * · ڈرائیور</label>
            <input list="td-drivers" className={inp} value={form.driverName} onChange={(e) => onDriverName(e.target.value)} placeholder="Driver name" />
            {form.driverName.trim() && <div className={`text-[10px] mt-0.5 ${driverMatch ? "text-emerald-700" : "text-amber-600"}`}>{driverMatch ? "Already exists ✓" : "A new driver will be created"}</div>}
          </div>
          <div>
            <label className={lbl}>Driver phone · فون</label>
            <input className={inp} value={form.driverPhone} onChange={(e) => set("driverPhone", e.target.value)} placeholder="03XX XXXXXXX" />
          </div>
          <div>
            <label className={lbl}>Customer / carrier * · کسٹمر</label>
            <input list="td-customers" className={inp} value={form.customer} onChange={(e) => set("customer", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>From * · کہاں سے</label>
            <input list="td-from" className={inp} value={form.from} onChange={(e) => set("from", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>To * · کہاں تک</label>
            <input list="td-to" className={inp} value={form.to} onChange={(e) => set("to", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Departure · روانگی</label>
            <input type="datetime-local" className={inp} value={form.departure} onChange={(e) => set("departure", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Freight (PKR) · کرایہ</label>
            <input type="number" className={inp} value={form.freight} onChange={(e) => set("freight", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Load / cargo · مال (blank = empty)</label>
            <input className={inp} value={form.cargo} onChange={(e) => set("cargo", e.target.value)} placeholder="Empty" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label className={lbl}>Cash given (PKR) · نقد رقم</label>
            <input type="number" className={inp} value={form.cash} onChange={(e) => set("cash", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Diesel amount (PKR) · ڈیزل کی رقم</label>
            <input type="number" className={inp} value={form.dieselAmount} onChange={(e) => set("dieselAmount", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Diesel litres · لیٹر</label>
            <input type="number" className={inp} value={form.dieselLitres} onChange={(e) => set("dieselLitres", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Pump · پمپ</label>
            <input className={inp} value={form.dieselPump} onChange={(e) => set("dieselPump", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Slip / reference no. · سلپ نمبر</label>
            <input className={inp} value={form.dieselRef} onChange={(e) => set("dieselRef", e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Diesel paid by · ادائیگی</label>
            <select className={inp} value={form.dieselPayment} onChange={(e) => set("dieselPayment", e.target.value)}>
              <option value="Cash">Cash</option>
              <option value="Bank">Bank transfer</option>
            </select>
          </div>
        </div>

        <button onClick={submit} disabled={saving} className="inline-flex items-center gap-1.5 text-sm font-semibold rounded-lg bg-emerald-600 text-white px-5 py-2 hover:bg-emerald-700 disabled:opacity-60">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create trip · ٹرپ بنائیں
        </button>
      </div>

      <div className="border border-slate-200 rounded-xl bg-white">
        <div className="p-3 flex items-center gap-2 border-b border-slate-100 flex-wrap">
          <Search className="w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search truck, driver, route, customer… · تلاش" className="text-sm flex-1 min-w-[140px] outline-none" />
          {selected.size > 0 && (
            <button onClick={deleteSelected} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg border border-red-300 text-red-600 px-3 py-1.5 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" /> Delete {selected.size} selected
            </button>
          )}
          <button onClick={load} className="inline-flex items-center gap-1.5 text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 hover:bg-slate-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="w-8 px-2 py-2"><input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(filtered.map((j) => j.root)))} /></th>
                <th className="w-6" />
                <th className="text-left px-2 py-2">Truck · ٹرک</th>
                <th className="text-left px-2">Driver · ڈرائیور</th>
                <th className="text-left px-2">Route · روٹ</th>
                <th className="text-left px-2">Customer · کسٹمر</th>
                <th className="text-left px-2">Started · شروع</th>
                <th className="text-right px-2">Cash · نقد</th>
                <th className="text-right px-2">Diesel · ڈیزل</th>
                <th className="text-right px-2">Freight · کرایہ</th>
                <th className="text-left px-2">Status · حالت</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="p-6 text-center text-slate-400 text-sm">{loading ? "Loading…" : "No trips yet. · ابھی کوئی ٹرپ نہیں۔"}</td></tr>
              )}
              {filtered.map((j) => {
                const open = openId === j.root;
                const net = j.freight - j.given;
                return (
                  <React.Fragment key={j.root}>
                    <tr className={`border-t border-slate-100 hover:bg-slate-50 ${selected.has(j.root) ? "bg-red-50/40" : ""}`}>
                      <td className="px-2 py-2"><input type="checkbox" checked={selected.has(j.root)} onChange={() => toggle(j.root)} /></td>
                      <td className="cursor-pointer" onClick={() => setOpenId(open ? null : j.root)}>
                        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                      </td>
                      <td className="px-2 font-semibold text-slate-800">{j.first.vehicleNumber}</td>
                      <td className="px-2">{j.first.driverName}{j.first.driverMobile ? <span className="text-slate-400 text-xs"> · {j.first.driverMobile}</span> : null}</td>
                      <td className="px-2">
                        {j.route}
                        <div className="text-[10px] text-slate-500">{j.loads}</div>
                      </td>
                      <td className="px-2">{j.customers}</td>
                      <td className="px-2 whitespace-nowrap">{new Date(j.first.departureTime).toLocaleDateString()}</td>
                      <td className="px-2 text-right tabular-nums">{j.cash ? fmt(j.cash) : "—"}</td>
                      <td className="px-2 text-right tabular-nums">{j.diesel ? fmt(j.diesel) : "—"}</td>
                      <td className="px-2 text-right tabular-nums">{j.freight ? fmt(j.freight) : "—"}</td>
                      <td className="px-2">
                        <select
                          value={j.legs.every((l) => l.status === "Completed") ? "Completed" : j.last.status}
                          onChange={(e) => changeJourneyStatus(j, e.target.value)}
                          className="text-[11px] rounded-lg border border-slate-200 bg-white px-1.5 py-1"
                        >
                          {[...new Set([j.last.status, ...STATUSES])].map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={11} className="px-4 py-3 space-y-3">
                          <div className="text-xs font-semibold text-slate-700">
                            Whole trip · پورا سفر: freight {fmt(j.freight)} − given {fmt(j.given)} = <b>{net < 0 ? "−" : ""}{fmt(Math.abs(net))}</b>
                            {j.fromLedger > 0 && <span className="text-slate-500 font-normal"> (given includes {fmt(j.fromLedger)} already in this truck's ledger since the trip started)</span>}
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="text-[10px] uppercase text-slate-500 bg-slate-50">
                                <tr><th className="text-left px-2 py-1.5">Stop · پڑاؤ</th><th className="text-left px-2">Route</th><th className="text-left px-2">Load</th><th className="text-left px-2">Customer</th><th className="text-right px-2">Freight</th><th className="text-left px-2">Departure</th><th className="w-10" /></tr>
                              </thead>
                              <tbody>
                                {j.legs.map((l) => (
                                  <tr key={l.id} className="border-t border-slate-100">
                                    <td className="px-2 py-1.5">{l.legNo || 1}</td>
                                    <td className="px-2">{l.origin} → {l.destination}</td>
                                    <td className="px-2">{l.cargo || "Empty · خالی"}</td>
                                    <td className="px-2">{l.company}</td>
                                    <td className="px-2 text-right tabular-nums">{l.revenue ? fmt(l.revenue) : "—"}</td>
                                    <td className="px-2 whitespace-nowrap">{new Date(l.departureTime).toLocaleString()}</td>
                                    <td className="px-2"><button onClick={() => startEditLeg(l)} className="text-slate-500 hover:text-emerald-700" title="Edit"><Pencil className="w-3.5 h-3.5" /></button></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {editLegId != null && j.legs.some((l) => l.id === editLegId) && (
                            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                              <div className="text-[11px] font-semibold text-slate-500">Edit stop {j.legs.find((l) => l.id === editLegId)?.legNo || 1} · پڑاؤ میں ترمیم</div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {([
                                  ["departure", "Departure · روانگی", "datetime-local"],
                                  ["from", "From · کہاں سے", "text"],
                                  ["to", "To · کہاں تک", "text"],
                                  ["customer", "Customer · کسٹمر", "text"],
                                  ["freight", "Freight (PKR) · کرایہ", "number"],
                                  ["cargo", "Load / cargo · مال", "text"],
                                  ["driverName", "Driver · ڈرائیور", "text"],
                                  ["driverPhone", "Driver phone · فون", "text"],
                                ] as const).map(([k, label, type]) => (
                                  <div key={k}>
                                    <label className={lbl}>{label}</label>
                                    <input type={type} className={inp} value={editForm[k] ?? ""} onChange={(e) => setEditForm({ ...editForm, [k]: e.target.value })} />
                                  </div>
                                ))}
                              </div>
                              <div className="flex gap-2">
                                <button onClick={saveEditLeg} disabled={savingEdit} className={btn}>Save · محفوظ کریں</button>
                                <button onClick={() => setEditLegId(null)} className="text-sm rounded-lg border border-slate-300 bg-white px-4 py-1.5">Cancel</button>
                              </div>
                            </div>
                          )}

                          <div className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="text-[11px] font-semibold text-slate-500 mb-1">Add next stop to this trip (e.g. the loaded run) · اگلا پڑاؤ</div>
                            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                              <input list="td-from" className={small} placeholder={`From (${j.last.destination})`} value={stop.from} onChange={(e) => setStop({ ...stop, from: e.target.value })} />
                              <input list="td-to" className={small} placeholder="To *" value={stop.to} onChange={(e) => setStop({ ...stop, to: e.target.value })} />
                              <input className={small} placeholder="Load / cargo" value={stop.cargo} onChange={(e) => setStop({ ...stop, cargo: e.target.value })} />
                              <input list="td-customers" className={small} placeholder={`Customer (${j.last.company})`} value={stop.customer} onChange={(e) => setStop({ ...stop, customer: e.target.value })} />
                              <input type="number" className={small} placeholder="Freight (PKR)" value={stop.freight} onChange={(e) => setStop({ ...stop, freight: e.target.value })} />
                              <input type="datetime-local" className={small} value={stop.departure} onChange={(e) => setStop({ ...stop, departure: e.target.value })} />
                            </div>
                            <button onClick={() => addStop(j)} disabled={addingStop || !stop.to.trim()} className={`mt-2 ${btn}`}>Add stop · پڑاؤ شامل کریں</button>
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                            <div className="text-[11px] font-semibold text-slate-500">Money given for this trip · اس ٹرپ کے لیے دی گئی رقم</div>
                            <div className="flex flex-wrap items-end gap-2">
                              {j.legs.length > 1 && (
                                <select className={small} value={money.tripId || j.last.id} onChange={(e) => setMoney({ ...money, tripId: Number(e.target.value) })}>
                                  {j.legs.map((l) => <option key={l.id} value={l.id}>Stop {l.legNo || 1}: {l.origin} → {l.destination}</option>)}
                                </select>
                              )}
                              <select className={small} value={money.kind} onChange={(e) => setMoney({ ...money, kind: e.target.value })}>
                                <option value="cash">Cash</option>
                                <option value="diesel">Diesel</option>
                                <option value="other">Other expense</option>
                              </select>
                              <input type="number" placeholder="Amount" className={`${small} w-32`} value={money.amount} onChange={(e) => setMoney({ ...money, amount: e.target.value })} />
                              <input placeholder="Note" className={`${small} flex-1 min-w-[140px]`} value={money.note} onChange={(e) => setMoney({ ...money, note: e.target.value })} />
                              <button onClick={() => addMoney(j)} disabled={addingMoney || !money.amount} className={btn}>Add to ledger · کھاتے میں ڈالیں</button>
                            </div>
                            {entries.length > 0 && (
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead className="text-[10px] uppercase text-slate-500 bg-slate-50">
                                    <tr><th className="text-left px-2 py-1.5">Date · تاریخ</th><th className="text-left px-2">Type</th><th className="text-right px-2">Amount · رقم</th><th className="text-left px-2">Note · تفصیل</th><th className="w-16" /></tr>
                                  </thead>
                                  <tbody>
                                    {entries.map((en) => (
                                      <tr key={en.id} className="border-t border-slate-100">
                                        {entryEdit?.id === en.id ? (
                                          <>
                                            <td className="px-2 py-1"><input type="date" className="border border-slate-300 rounded px-1.5 py-1" value={entryEdit.date} onChange={(e) => setEntryEdit({ ...entryEdit, date: e.target.value })} /></td>
                                            <td className="px-2">{en.category}</td>
                                            <td className="px-2 text-right"><input type="number" className="border border-slate-300 rounded px-1.5 py-1 w-28 text-right" value={entryEdit.amount} onChange={(e) => setEntryEdit({ ...entryEdit, amount: e.target.value })} /></td>
                                            <td className="px-2"><input className="border border-slate-300 rounded px-1.5 py-1 w-full" value={entryEdit.description} onChange={(e) => setEntryEdit({ ...entryEdit, description: e.target.value })} /></td>
                                            <td className="px-2 whitespace-nowrap">
                                              <button onClick={() => saveEntry(j.root)} className="font-semibold text-emerald-700 mr-2">Save</button>
                                              <button onClick={() => setEntryEdit(null)} className="text-slate-500">Cancel</button>
                                            </td>
                                          </>
                                        ) : (
                                          <>
                                            <td className="px-2 py-1.5 whitespace-nowrap">{en.entryDate ? new Date(en.entryDate).toLocaleDateString() : "—"}</td>
                                            <td className="px-2">{en.category}</td>
                                            <td className="px-2 text-right tabular-nums">{fmt(en.paid)}</td>
                                            <td className="px-2">{en.description || "—"}</td>
                                            <td className="px-2 whitespace-nowrap">
                                              <button onClick={() => setEntryEdit({ id: en.id, date: en.entryDate ? String(en.entryDate).slice(0, 10) : "", amount: String(en.paid), description: en.description || "" })} className="text-slate-500 hover:text-emerald-700 mr-2" title="Edit"><Pencil className="w-3.5 h-3.5 inline" /></button>
                                              <button onClick={() => deleteEntry(en.id, j.root)} className="text-slate-500 hover:text-red-600" title="Delete"><Trash2 className="w-3.5 h-3.5 inline" /></button>
                                            </td>
                                          </>
                                        )}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>

                          <AttachmentPanel entityType="trip" entityId={j.root} title="Receipts & proof · رسیدیں اور ثبوت" />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
