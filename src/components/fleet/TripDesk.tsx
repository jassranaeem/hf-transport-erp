/**
 * Trip Desk — the one place to start a trip. One short form creates the
 * truck / driver / route / customer if they're new, the trip itself, the
 * truck's khata, and the cash + diesel given. The list below lets you pick
 * trips and delete them, or add more cash / diesel to a running trip.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import AttachmentPanel from "../common/AttachmentPanel.tsx";
import { Plus, Trash2, Search, ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";

const fmt = (n: number) => "PKR " + Math.round(n || 0).toLocaleString();
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const emptyForm = () => ({
  truck: "", driverName: "", driverPhone: "", from: "", to: "", customer: "",
  departure: nowLocal(), freight: "", cash: "", dieselAmount: "", dieselLitres: "", dieselPump: "", dieselRef: "", dieselPayment: "Cash",
});

interface Opts {
  vehicles: { id: number; vehicleNumber: string }[];
  drivers: { id: number; driverName: string; mobile: string }[];
  contractors: { id: number; company: string }[];
  routes: { id: number; origin: string; destination: string }[];
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
  const [money, setMoney] = useState({ kind: "cash", amount: "", note: "" });
  const [addingMoney, setAddingMoney] = useState(false);

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

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return trips;
    return trips.filter((t) =>
      [t.vehicleNumber, t.driverName, t.origin, t.destination, t.company, t.tripNumber].join(" ").toLowerCase().includes(n),
    );
  }, [trips, q]);

  const allSel = filtered.length > 0 && filtered.every((t) => selected.has(t.id));
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const deleteSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} trip(s)? Their cash / diesel ledger entries will be removed too. · کیا ${ids.length} ٹرپ حذف کریں؟ ان کی کیش / ڈیزل کھاتہ انٹریز بھی ہٹ جائیں گی۔`)) return;
    try {
      const r = await enterpriseFetch("/api/trip-desk/delete", { method: "POST", body: JSON.stringify({ ids }) });
      showFeedback("success", `${r.deleted} trip(s) deleted, ${r.khataEntriesRemoved} ledger entries removed · حذف ہو گئیں`);
      setSelected(new Set());
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const changeStatus = async (t: any, status: string) => {
    if (status === "Completed" && !window.confirm("Completing this trip will create its invoice automatically. Continue? · ٹرپ مکمل کرنے پر اس کی انوائس خود بن جائے گی۔ جاری رکھیں؟")) return;
    try {
      await enterpriseFetch(`/api/operations/trips/${t.id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
      showFeedback("success", `${t.vehicleNumber}: ${status}`);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const addMoney = async (tripId: number) => {
    setAddingMoney(true);
    try {
      await enterpriseFetch(`/api/trip-desk/${tripId}/money`, {
        method: "POST",
        body: JSON.stringify({ kind: money.kind, amount: Number(money.amount), note: money.note }),
      });
      showFeedback("success", "Ledger entry added · کھاتے میں انٹری ہو گئی");
      setMoney({ kind: "cash", amount: "", note: "" });
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setAddingMoney(false);
    }
  };

  const inp = "mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white";
  const lbl = "text-[11px] font-semibold text-slate-500";

  return (
    <div className="space-y-4 p-3">
      <datalist id="td-trucks">{opts.vehicles.map((v) => <option key={v.id} value={v.vehicleNumber} />)}</datalist>
      <datalist id="td-drivers">{opts.drivers.map((d) => <option key={d.id} value={d.driverName} />)}</datalist>
      <datalist id="td-customers">{opts.contractors.map((c) => <option key={c.id} value={c.company} />)}</datalist>
      <datalist id="td-from">{[...new Set(opts.routes.map((r) => r.origin))].map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="td-to">{[...new Set(opts.routes.map((r) => r.destination))].map((o) => <option key={o} value={o} />)}</datalist>

      <div className="border border-emerald-200 rounded-xl bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800">New trip <span className="text-slate-400 font-normal text-sm">· ایک فارم، سب کچھ</span></h2>
          <span className="text-[11px] text-slate-400">Anything that does not exist yet is created automatically · جو موجود نہیں وہ خود بن جاتا ہے</span>
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

        <button
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center gap-1.5 text-sm font-semibold rounded-lg bg-emerald-600 text-white px-5 py-2 hover:bg-emerald-700 disabled:opacity-60"
        >
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
                <th className="w-8 px-2 py-2"><input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(filtered.map((t) => t.id)))} /></th>
                <th className="w-6" />
                <th className="text-left px-2 py-2">Truck · ٹرک</th>
                <th className="text-left px-2">Driver · ڈرائیور</th>
                <th className="text-left px-2">Route · روٹ</th>
                <th className="text-left px-2">Customer · کسٹمر</th>
                <th className="text-left px-2">Date · تاریخ</th>
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
              {filtered.map((t) => (
                <React.Fragment key={t.id}>
                  <tr className={`border-t border-slate-100 hover:bg-slate-50 ${selected.has(t.id) ? "bg-red-50/40" : ""}`}>
                    <td className="px-2 py-2"><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></td>
                    <td className="cursor-pointer" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                      {openId === t.id ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                    </td>
                    <td className="px-2 font-semibold text-slate-800">{t.vehicleNumber}</td>
                    <td className="px-2">{t.driverName}{t.driverMobile ? <span className="text-slate-400 text-xs"> · {t.driverMobile}</span> : null}</td>
                    <td className="px-2">{t.origin} → {t.destination}</td>
                    <td className="px-2">{t.company}</td>
                    <td className="px-2 whitespace-nowrap">{new Date(t.departureTime).toLocaleDateString()}</td>
                    <td className="px-2 text-right tabular-nums">{t.cash ? fmt(t.cash) : "—"}</td>
                    <td className="px-2 text-right tabular-nums">{t.diesel ? fmt(t.diesel) : "—"}</td>
                    <td className="px-2 text-right tabular-nums">{t.revenue ? fmt(t.revenue) : "—"}</td>
                    <td className="px-2">
                      <select
                        value={t.status}
                        onChange={(e) => changeStatus(t, e.target.value)}
                        className="text-[11px] rounded-lg border border-slate-200 bg-white px-1.5 py-1"
                      >
                        {["Scheduled", "Started", "In Transit", "Arrived", "Completed"].map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                  {openId === t.id && (
                    <tr className="bg-slate-50/60">
                      <td colSpan={11} className="px-4 py-3">
                        <div className="text-xs text-slate-500 mb-2">
                          {t.tripNumber} · Total given: <b className="text-slate-700">{fmt(t.totalGiven)}</b>
                          {t.otherExpense > 0 && <> (other expenses {fmt(t.otherExpense)})</>}
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <select className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white" value={money.kind} onChange={(e) => setMoney({ ...money, kind: e.target.value })}>
                            <option value="cash">Cash</option>
                            <option value="diesel">Diesel</option>
                            <option value="other">Other expense</option>
                          </select>
                          <input type="number" placeholder="Amount" className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-32" value={money.amount} onChange={(e) => setMoney({ ...money, amount: e.target.value })} />
                          <input placeholder="Note" className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1 min-w-[140px]" value={money.note} onChange={(e) => setMoney({ ...money, note: e.target.value })} />
                          <button onClick={() => addMoney(t.id)} disabled={addingMoney || !money.amount} className="text-sm font-semibold rounded-lg bg-emerald-600 text-white px-4 py-1.5 hover:bg-emerald-700 disabled:opacity-60">
                            Add to ledger · کھاتے میں ڈالیں
                          </button>
                        </div>
                        <div className="mt-3">
                          <AttachmentPanel entityType="trip" entityId={t.id} title="Receipts & proof · رسیدیں اور ثبوت" />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
