/**
 * Trips · ٹرپس — one trip = one whole journey of a truck, however many stops it has.
 *
 *   The list           every trip on the road (or finished): truck, route, freight, money given, result.
 *   + New trip         a short form in a window: the first stop, and any money given at the start.
 *   Click a trip       its file opens on the side: the result (freight − given), its stops, its money
 *                      (cash to the driver, what he spent out of it, what he gave back, what the office
 *                      paid), receipts, and the actions — status, Close trip, new trip, delete.
 *
 * Anything that does not exist yet (truck, driver, route, customer, khata) is created on the way.
 */
import { PageHeader, Btn } from "../ui/kit.tsx";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import AttachmentPanel from "../common/AttachmentPanel.tsx";
import CloseTrip from "./CloseTrip.tsx";
import TripMoney from "./TripMoney.tsx";
import { Plus, Trash2, Search, Loader2, RefreshCw, Pencil, MapPin, History, Truck, AlertCircle, X, ChevronRight, Calculator } from "lucide-react";

const fmt = (n: number) => (n < 0 ? "−" : "") + "PKR " + Math.abs(Math.round(n || 0)).toLocaleString();
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
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB");
const emptyForm = () => ({
  truck: "", driverName: "", driverPhone: "", from: "", to: "", customer: "",
  departure: nowLocal(), freight: "", cash: "", dieselAmount: "", dieselLitres: "", dieselPump: "", dieselRef: "", dieselPayment: "Cash", dieselBy: "" as "" | "driver" | "office" | "bank", cargo: "",
});
const STATUSES = ["Scheduled", "In Transit", "Arrived", "Completed"];
const STATUS_TONE: Record<string, string> = {
  Scheduled: "bg-slate-100 text-slate-700",
  Started: "bg-sky-100 text-sky-800",
  "In Transit": "bg-sky-100 text-sky-800",
  Arrived: "bg-amber-100 text-amber-800",
  Completed: "bg-emerald-100 text-emerald-800",
};

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
  route: string;
  loads: string;
  customers: string;
  received: number; // kiraya received, tied to its stops
  pending: number; // kiraya still to come
  completed: boolean; // every stop completed → the trip sits in History
  status: string;
}

export default function TripDesk({
  showFeedback,
  focusTripId,
}: {
  showFeedback: (type: "success" | "error", message: string) => void;
  focusTripId?: number; // open this trip (a link from a ledger entry)
}) {
  const [opts, setOpts] = useState<Opts>({ vehicles: [], drivers: [], contractors: [], routes: [] });
  const [trips, setTrips] = useState<any[]>([]);
  const [closingId, setClosingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [view, setView] = useState<"active" | "history">("active");

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([enterpriseFetch("/api/trip-desk").then(setTrips), enterpriseFetch("/api/trip-desk/options").then(setOpts)])
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(load, [load]);
  // trip status follows the truck's GPS on the server; re-read quietly every minute
  useEffect(() => {
    const t = setInterval(() => enterpriseFetch("/api/trip-desk").then(setTrips).catch(() => {}), 60000);
    return () => clearInterval(t);
  }, []);

  // one journey = the first leg + every later stop; shown as ONE trip
  const journeyList: Journey[] = useMemo(() => {
    const byRoot = new Map<number, any[]>();
    for (const t of trips) byRoot.set(t.parentTripId || t.id, [...(byRoot.get(t.parentTripId || t.id) || []), t]);
    const list = [...byRoot.entries()].map(([root, legs]) => {
      legs.sort((a, b) => (a.legNo || 1) - (b.legNo || 1));
      const first = legs[0];
      const last = legs[legs.length - 1];
      const completed = legs.every((l) => l.status === "Completed");
      return {
        root, legs, first, last, completed,
        status: completed ? "Completed" : last.status,
        freight: legs.reduce((s, x) => s + (x.revenue || 0), 0),
        given: legs.reduce((s, x) => s + (x.totalGiven || 0) + (x.ledgerPaid || 0), 0),
        fromLedger: legs.reduce((s, x) => s + (x.ledgerPaid || 0), 0),
        route: [first.origin, ...legs.map((l) => l.destination)].join(" → "),
        loads: legs.map((l) => l.cargo || "Empty").join(" → "),
        customers: [...new Set(legs.map((l) => l.company).filter(Boolean))].join(", "),
        received: legs.reduce((s, x) => s + (x.received || 0), 0),
        pending: legs.reduce((s, x) => s + Math.max(0, (x.revenue || 0) - (x.received || 0) - (x.freightWrittenOff || 0)), 0),
      } as Journey;
    });
    list.sort((a, b) => new Date(b.first.departureTime).getTime() - new Date(a.first.departureTime).getTime());
    return list;
  }, [trips]);

  // a link from a ledger entry: open its trip
  const focusedRef = React.useRef<number | null>(null);
  useEffect(() => {
    if (!focusTripId || focusedRef.current === focusTripId || !journeyList.length) return;
    const j = journeyList.find((x) => x.root === focusTripId || x.legs.some((l: any) => l.id === focusTripId));
    if (!j) return;
    focusedRef.current = focusTripId;
    setView(j.completed ? "history" : "active");
    setOpenId(j.root);
  }, [focusTripId, journeyList]);

  const inView = useMemo(() => journeyList.filter((j) => (view === "history") === j.completed), [journeyList, view]);
  const activeCount = journeyList.filter((j) => !j.completed).length;
  const historyCount = journeyList.length - activeCount;
  const moneyPending = journeyList.filter((j) => j.completed && j.pending > 0);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return inView;
    return inView.filter((j) => [j.first.vehicleNumber, j.first.driverName, j.route, j.customers, j.loads, ...j.legs.map((l) => l.tripNumber)].join(" ").toLowerCase().includes(n));
  }, [inView, q]);
  const open = journeyList.find((j) => j.root === openId) || null;

  // ---- new trip
  const set = (k: keyof ReturnType<typeof emptyForm>, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const truckKnown = form.truck.trim() && opts.vehicles.some((v) => norm(v.vehicleNumber) === norm(form.truck));
  const driverMatch = opts.drivers.find((d) => d.driverName.toLowerCase() === form.driverName.trim().toLowerCase());
  const onDriverName = (v: string) => {
    const m = opts.drivers.find((d) => d.driverName.toLowerCase() === v.trim().toLowerCase());
    setForm((f) => ({ ...f, driverName: v, driverPhone: m && !f.driverPhone ? m.mobile || "" : f.driverPhone }));
  };
  // who paid the diesel: the driver out of the cash (usual when cash was given), the office / pump account, or the bank
  const dieselBy = form.dieselBy || (Number(form.cash) > 0 && Number(form.dieselAmount) <= Number(form.cash) ? "driver" : "office");
  const submit = async () => {
    setSaving(true);
    try {
      const r = await enterpriseFetch("/api/trip-desk", {
        method: "POST",
        body: JSON.stringify({ ...form, dieselFromCash: dieselBy === "driver" && Number(form.cash) > 0, dieselPayment: dieselBy === "bank" ? "Bank" : "Cash", departure: new Date(form.departure).toISOString() }),
      });
      showFeedback("success", `Trip ${r.tripNumber} created · ٹرپ بن گئی${r.created.length ? " · new: " + r.created.join(", ") : ""}${gpsNote(r.gps)}`);
      setForm(emptyForm());
      setShowNew(false);
      setView("active");
      setOpenId(r.tripId);
      load();
    } catch (e: any) {
      showFeedback("error", e.message || "Could not create the trip · ٹرپ نہیں بن سکی");
    } finally {
      setSaving(false);
    }
  };
  // the next trip of the same truck: truck, driver and the place it ended
  const newTripFrom = (j: Journey) => {
    setForm({ ...emptyForm(), truck: j.first.vehicleNumber || "", driverName: j.last.driverName || j.first.driverName || "", driverPhone: j.last.driverMobile || j.first.driverMobile || "", from: j.last.destination || "" });
    setOpenId(null);
    setShowNew(true);
  };

  const inp = "mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30";
  const lbl = "text-[11px] font-semibold text-slate-500";

  return (
    <div className="space-y-4 p-3">
      {closingId && <CloseTrip tripId={closingId} onClose={() => setClosingId(null)} onChanged={load} showFeedback={showFeedback} />}
      <datalist id="td-trucks">{opts.vehicles.map((v) => <option key={v.id} value={v.vehicleNumber} />)}</datalist>
      <datalist id="td-drivers">{opts.drivers.map((d) => <option key={d.id} value={d.driverName} />)}</datalist>
      <datalist id="td-customers">{opts.contractors.map((c) => <option key={c.id} value={c.company} />)}</datalist>
      <datalist id="td-from">{[...new Set(opts.routes.map((r) => r.origin))].map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="td-to">{[...new Set(opts.routes.map((r) => r.destination))].map((o) => <option key={o} value={o} />)}</datalist>

      {/* header */}
      <PageHeader
        title="Trips"
        urdu="ٹرپس"
        subtitle="Click a trip to see its money, stops and receipts · ٹرپ پر کلک کریں"
        actions={<Btn kind="primary" onClick={() => { setForm(emptyForm()); setShowNew(true); }} icon={<Plus />}>New trip · نئی ٹرپ</Btn>}
      />

      {moneyPending.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-red-800 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> Freight still to come · باقی کرایہ: {fmt(moneyPending.reduce((s, j) => s + j.pending, 0))}</span>
          {moneyPending.slice(0, 6).map((j) => (
            <button key={j.root} onClick={() => { setView("history"); setOpenId(j.root); }} className="text-red-700 hover:underline">
              {j.first.vehicleNumber} {fmt(j.pending)}
            </button>
          ))}
        </div>
      )}

      {/* list */}
      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-3 pt-2 border-b border-slate-200">
          {([["active", `On the road · چل رہی ہیں (${activeCount})`, Truck], ["history", `Finished · مکمل (${historyCount})`, History]] as const).map(([k, l, Icon]) => (
            <button key={k} onClick={() => { setView(k); setOpenId(null); }} className={`text-xs px-3 py-2 -mb-px border-b-2 inline-flex items-center gap-1.5 ${view === k ? "border-emerald-600 text-emerald-700 font-semibold" : "border-transparent text-slate-500"}`}>
              <Icon className="w-3.5 h-3.5" /> {l}
            </button>
          ))}
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 mb-1.5 border border-slate-200 rounded-lg px-2 py-1">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search truck, driver, route… · تلاش" className="text-xs w-44 outline-none" />
          </div>
          <button onClick={load} title="Refresh" className="mb-1.5 text-slate-500 hover:text-slate-800 p-1"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Trip</th>
                <th className="text-left px-3">Truck · Driver</th>
                <th className="text-left px-3">Route</th>
                <th className="text-right px-3">Freight · کرایہ</th>
                <th className="text-right px-3">Given · دیا</th>
                <th className="text-right px-3">Result · نتیجہ</th>
                <th className="text-left px-3">Status</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-slate-400 text-sm">{loading ? "Loading…" : view === "history" ? "No finished trips yet · ابھی کوئی مکمل ٹرپ نہیں" : "No trip on the road — press “New trip” · کوئی ٹرپ نہیں چل رہی"}</td></tr>
              )}
              {filtered.map((j) => {
                const net = j.freight - j.given;
                return (
                  <tr key={j.root} id={`trip-row-${j.root}`} onClick={() => setOpenId(j.root)} className={`border-t border-slate-100 cursor-pointer hover:bg-emerald-50/40 ${openId === j.root ? "bg-emerald-50/60" : ""}`}>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-slate-800">{dateOf(j.first.departureTime)}</div>
                      <div className="text-[10px] text-slate-400">{j.first.tripNumber}{j.legs.length > 1 ? ` · ${j.legs.length} stops` : ""}</div>
                    </td>
                    <td className="px-3">
                      <div className="font-semibold text-slate-800">{j.first.vehicleNumber}</div>
                      <div className="text-[11px] text-slate-500">{j.last.driverName || j.first.driverName}</div>
                    </td>
                    <td className="px-3">
                      <div className="text-slate-700">{j.route}</div>
                      <div className="text-[10px] text-slate-400">{j.customers}{j.loads && !/^Empty( → Empty)*$/.test(j.loads) ? ` · ${j.loads}` : ""}</div>
                    </td>
                    <td className="px-3 text-right tabular-nums whitespace-nowrap">{j.freight ? fmt(j.freight) : "—"}</td>
                    <td className="px-3 text-right tabular-nums whitespace-nowrap">{j.given ? fmt(j.given) : "—"}</td>
                    <td className={`px-3 text-right tabular-nums font-semibold whitespace-nowrap ${net < 0 ? "text-red-600" : "text-emerald-700"}`}>{j.freight || j.given ? fmt(net) : "—"}</td>
                    <td className="px-3">
                      <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS_TONE[j.status] || "bg-slate-100 text-slate-700"}`}>{j.status}</span>
                      {j.completed && j.pending > 0 && <div className="text-[10px] text-red-600 mt-0.5">{fmt(j.pending)} to come</div>}
                    </td>
                    <td className="pr-2 text-slate-300"><ChevronRight className="w-4 h-4" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* new trip */}
      {showNew && (
        <Sheet title="New trip · نئی ٹرپ" subtitle="The first stop. More stops are added inside the trip. · پہلا پڑاؤ" onClose={() => setShowNew(false)}>
          <Section title="Trip · ٹرپ">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Truck number * · ٹرک نمبر</label>
                <input list="td-trucks" className={inp} value={form.truck} onChange={(e) => set("truck", e.target.value)} placeholder="e.g. TLE-730" autoFocus />
                {form.truck.trim() && <div className={`text-[10px] mt-0.5 ${truckKnown ? "text-emerald-700" : "text-amber-600"}`}>{truckKnown ? "In the fleet ✓" : "A new truck will be added"}</div>}
              </div>
              <div>
                <label className={lbl}>Driver * · ڈرائیور</label>
                <input list="td-drivers" className={inp} value={form.driverName} onChange={(e) => onDriverName(e.target.value)} placeholder="Driver name" />
                {form.driverName.trim() && <div className={`text-[10px] mt-0.5 ${driverMatch ? "text-emerald-700" : "text-amber-600"}`}>{driverMatch ? "Known driver ✓" : "A new driver will be added"}</div>}
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
                <label className={lbl}>Customer * · کسٹمر</label>
                <input list="td-customers" className={inp} value={form.customer} onChange={(e) => set("customer", e.target.value)} />
              </div>
              <div>
                <label className={lbl}>Freight · کرایہ (PKR)</label>
                <input inputMode="numeric" className={inp} value={form.freight} onChange={(e) => set("freight", e.target.value.replace(/[^\d]/g, ""))} placeholder="0 if empty" />
              </div>
              <div>
                <label className={lbl}>Departure · روانگی</label>
                <input type="datetime-local" className={inp} value={form.departure} onChange={(e) => set("departure", e.target.value)} />
              </div>
              <div>
                <label className={lbl}>Load · مال</label>
                <input className={inp} value={form.cargo} onChange={(e) => set("cargo", e.target.value)} placeholder="Empty · خالی" />
              </div>
              <div>
                <label className={lbl}>Driver phone · فون</label>
                <input className={inp} value={form.driverPhone} onChange={(e) => set("driverPhone", e.target.value)} placeholder="03XX XXXXXXX" />
              </div>
            </div>
          </Section>

          <Section title="Money at the start (optional) · شروع کے پیسے">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Cash to the driver · ڈرائیور کو نقد</label>
                <input inputMode="numeric" className={inp} value={form.cash} onChange={(e) => set("cash", e.target.value.replace(/[^\d]/g, ""))} placeholder="PKR" />
              </div>
              <div>
                <label className={lbl}>Diesel · ڈیزل (PKR)</label>
                <input inputMode="numeric" className={inp} value={form.dieselAmount} onChange={(e) => set("dieselAmount", e.target.value.replace(/[^\d]/g, ""))} placeholder="PKR" />
              </div>
            </div>
            {Number(form.dieselAmount) > 0 && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={lbl}>Litres · لیٹر</label>
                    <input inputMode="numeric" className={inp} value={form.dieselLitres} onChange={(e) => set("dieselLitres", e.target.value.replace(/[^\d.]/g, ""))} />
                  </div>
                  <div>
                    <label className={lbl}>Pump · پمپ</label>
                    <input className={inp} value={form.dieselPump} onChange={(e) => set("dieselPump", e.target.value)} />
                  </div>
                  <div>
                    <label className={lbl}>Slip no. · سلپ</label>
                    <input className={inp} value={form.dieselRef} onChange={(e) => set("dieselRef", e.target.value)} />
                  </div>
                </div>
                <div>
                  <div className={lbl}>Who paid the diesel? · ڈیزل کس نے دیا؟</div>
                  <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {([
                      ["driver", "The driver, from the cash", "ڈرائیور نے نقد سے"],
                      ["office", "Office / pump account", "دفتر / پمپ کھاتہ"],
                      ["bank", "Bank transfer", "بینک"],
                    ] as const)
                      .filter(([k]) => k !== "driver" || Number(form.cash) > 0)
                      .map(([k, l, u]) => (
                        <button key={k} type="button" onClick={() => set("dieselBy", k)} className={`text-left rounded-lg border px-3 py-2 text-xs ${dieselBy === k ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600" : "border-slate-300 bg-white hover:bg-slate-50"}`}>
                          <div className="font-semibold text-slate-800">{l}</div>
                          <div className="text-slate-500">{u}</div>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}
            {(Number(form.cash) > 0 || Number(form.dieselAmount) > 0) && (
              <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700 space-y-0.5">
                {Number(form.cash) > 0 && <div>Cash to the driver · نقد: <b>{fmt(Number(form.cash))}</b></div>}
                {Number(form.dieselAmount) > 0 && dieselBy === "driver" && Number(form.cash) > 0 && (
                  Number(form.dieselAmount) > Number(form.cash)
                    ? <div className="text-red-600">The diesel is more than the cash given · ڈیزل نقد سے زیادہ ہے</div>
                    : <div>Diesel out of that cash · اسی نقد سے ڈیزل: {fmt(Number(form.dieselAmount))} → with the driver · ڈرائیور کے پاس: <b>{fmt(Number(form.cash) - Number(form.dieselAmount))}</b></div>
                )}
                {Number(form.dieselAmount) > 0 && dieselBy !== "driver" && <div>Diesel paid by the {dieselBy === "bank" ? "bank" : "office"} · ڈیزل: <b>{fmt(Number(form.dieselAmount))}</b></div>}
                <div className="font-semibold">Given on this trip · کل دیا: {fmt(Number(form.cash || 0) + (dieselBy === "driver" && Number(form.cash) > 0 ? 0 : Number(form.dieselAmount || 0)))}</div>
              </div>
            )}
          </Section>

          <div className="flex gap-2 pt-2">
            <button onClick={submit} disabled={saving} className="inline-flex items-center gap-1.5 text-sm font-semibold rounded-lg bg-emerald-600 text-white px-5 py-2 hover:bg-emerald-700 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create trip · ٹرپ بنائیں
            </button>
            <button onClick={() => setShowNew(false)} className="text-sm rounded-lg border border-slate-300 bg-white px-4 py-2">Cancel</button>
          </div>
        </Sheet>
      )}

      {/* a trip's file */}
      {open && (
        <TripFile
          j={open}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onCloseTrip={() => setClosingId(open.root)}
          onNewTrip={() => newTripFrom(open)}
          showFeedback={showFeedback}
        />
      )}
    </div>
  );
}

// ================================================================ the trip's file (side panel)
function TripFile({
  j,
  onClose,
  onChanged,
  onCloseTrip,
  onNewTrip,
  showFeedback,
}: {
  j: Journey;
  onClose: () => void;
  onChanged: () => void;
  onCloseTrip: () => void;
  onNewTrip: () => void;
  showFeedback: (type: "success" | "error", message: string) => void;
}) {
  const [showStop, setShowStop] = useState(false);
  const [stop, setStop] = useState({ from: "", to: "", cargo: "", customer: "", freight: "", departure: nowLocal() });
  const [addingStop, setAddingStop] = useState(false);
  const [editLegId, setEditLegId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [khata, setKhata] = useState<{ rows: any[] } | null>(null);
  const [showKhata, setShowKhata] = useState(false);
  useEffect(() => {
    setShowStop(false);
    setEditLegId(null);
    setShowKhata(false);
    enterpriseFetch(`/api/trip-desk/${j.root}/khata-rows`).then(setKhata).catch(() => setKhata({ rows: [] }));
  }, [j.root]);

  const net = j.freight - j.given;
  const setStatus = (id: number, status: string) => enterpriseFetch(`/api/operations/trips/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
  const changeStatus = async (status: string) => {
    if (status === "Completed" && !window.confirm("Completing this trip creates the invoice(s) for its stops. Continue? · ٹرپ مکمل کرنے پر انوائس خود بن جائیں گی۔ جاری رکھیں؟")) return;
    try {
      if (status === "Completed") {
        for (const l of j.legs) if (l.status !== "Completed") await setStatus(l.id, "Completed");
      } else await setStatus(j.last.id, status);
      showFeedback("success", `${j.first.vehicleNumber}: ${status}`);
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  const del = async () => {
    if (!window.confirm(`Delete this trip (${j.first.vehicleNumber}, ${j.route}) with all its stops? Its money entries in the truck's khata and its receipts are removed too. · ٹرپ حذف کریں؟`)) return;
    try {
      await enterpriseFetch("/api/trip-desk/delete", { method: "POST", body: JSON.stringify({ ids: [j.root] }) });
      showFeedback("success", "Trip deleted · ٹرپ حذف");
      onClose();
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  const addStop = async () => {
    setAddingStop(true);
    try {
      const r = await enterpriseFetch(`/api/trip-desk/${j.last.id}/next-leg`, { method: "POST", body: JSON.stringify({ ...stop, departure: new Date(stop.departure).toISOString() }) });
      showFeedback("success", `Stop ${r.legNo} added · اگلا پڑاؤ شامل${gpsNote(r.gps)}`);
      setStop({ from: "", to: "", cargo: "", customer: "", freight: "", departure: nowLocal() });
      setShowStop(false);
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setAddingStop(false);
    }
  };
  const startEditLeg = (l: any) => {
    setEditForm({ departure: toLocal(l.departureTime), from: l.origin || "", to: l.destination || "", customer: l.company || "", freight: String(l.revenue || ""), cargo: l.cargo || "", driverName: l.driverName || "", driverPhone: l.driverMobile || "" });
    setEditLegId(l.id);
  };
  const saveEditLeg = async () => {
    if (editLegId == null) return;
    setSavingEdit(true);
    try {
      await enterpriseFetch(`/api/trip-desk/${editLegId}`, { method: "PUT", body: JSON.stringify({ ...editForm, departure: new Date(editForm.departure).toISOString() }) });
      showFeedback("success", "Updated · اپڈیٹ ہو گیا");
      setEditLegId(null);
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const small = "border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white";
  return (
    <Sheet
      wide
      title={`${j.first.vehicleNumber} · ${j.route}`}
      subtitle={`${j.first.tripNumber} · ${dateOf(j.first.departureTime)} · ${j.last.driverName || j.first.driverName || ""}${j.last.driverMobile ? ` · ${j.last.driverMobile}` : ""}`}
      onClose={onClose}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <select value={j.status} onChange={(e) => changeStatus(e.target.value)} className={`text-xs font-semibold rounded-lg border border-slate-300 px-2 py-1.5 ${STATUS_TONE[j.status] || ""}`}>
            {[...new Set([j.status, ...STATUSES])].map((s) => <option key={s}>{s}</option>)}
          </select>
          <button onClick={onCloseTrip} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg border border-[#24539B] text-[#24539B] bg-white px-3 py-1.5 hover:bg-[#F2F5FA]">
            <Calculator className="w-3.5 h-3.5" /> {j.first.splitAt ? "Closed · حساب ہو گیا" : "Close trip · ٹرپ کا حساب"}
          </button>
          {j.completed && (
            <button onClick={onNewTrip} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white px-3 py-1.5">
              <Plus className="w-3.5 h-3.5" /> Next trip · اگلی ٹرپ
            </button>
          )}
          <button onClick={del} title="Delete this trip" className="text-slate-400 hover:text-red-600 p-1.5"><Trash2 className="w-4 h-4" /></button>
        </div>
      }
    >
      <GpsLine gps={j.last.gps} destination={j.last.destination} />

      {/* the result */}
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Freight · کرایہ" value={fmt(j.freight)} sub={j.pending > 0 ? `${fmt(j.received)} received` : j.freight ? "all received" : undefined} />
        <Tile label="Given · دیا" value={fmt(j.given)} sub={j.fromLedger > 0 ? `incl. ${fmt(j.fromLedger)} from the khata` : "cash + diesel + costs"} />
        <Tile label={net < 0 ? "Short · کمی" : "Left · بچت"} value={fmt(net)} tone={net < 0 ? "bad" : "good"} sub="freight − given" />
      </div>

      {/* stops */}
      <Section title={`Stops · پڑاؤ (${j.legs.length})`}>
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {j.legs.map((l: any) =>
            editLegId === l.id ? (
              <div key={l.id} className="p-3 bg-slate-50 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ["from", "From · کہاں سے", "text"], ["to", "To · کہاں تک", "text"], ["customer", "Customer · کسٹمر", "text"], ["freight", "Freight · کرایہ", "number"],
                    ["cargo", "Load · مال", "text"], ["departure", "Departure · روانگی", "datetime-local"], ["driverName", "Driver · ڈرائیور", "text"], ["driverPhone", "Phone · فون", "text"],
                  ] as const).map(([k, label, type]) => (
                    <label key={k} className="flex flex-col text-[11px] text-slate-500">{label}
                      <input type={type} className={small} value={editForm[k] ?? ""} onChange={(e) => setEditForm({ ...editForm, [k]: e.target.value })} />
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEditLeg} disabled={savingEdit} className="text-sm font-semibold rounded-lg bg-emerald-600 text-white px-4 py-1.5 disabled:opacity-60">Save</button>
                  <button onClick={() => setEditLegId(null)} className="text-sm rounded-lg border border-slate-300 bg-white px-4 py-1.5">Cancel</button>
                </div>
              </div>
            ) : (
              <div key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-6 h-6 shrink-0 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold flex items-center justify-center">{l.legNo || 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800">{l.origin} → {l.destination}</div>
                  <div className="text-[11px] text-slate-500">{l.company} · {l.cargo || "Empty · خالی"} · {dateOf(l.departureTime)}</div>
                </div>
                <div className="text-right tabular-nums text-sm">{l.revenue ? fmt(l.revenue) : <span className="text-slate-400">—</span>}</div>
                <button onClick={() => startEditLeg(l)} title="Edit stop" className="text-slate-400 hover:text-emerald-700 p-1"><Pencil className="w-3.5 h-3.5" /></button>
              </div>
            ),
          )}
        </div>
        {!showStop ? (
          <button onClick={() => setShowStop(true)} className="mt-2 text-xs font-semibold text-emerald-700 hover:underline">+ Add next stop · اگلا پڑاؤ</button>
        ) : (
          <div className="mt-2 rounded-lg border border-slate-200 p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input list="td-from" className={small} placeholder={`From (${j.last.destination})`} value={stop.from} onChange={(e) => setStop({ ...stop, from: e.target.value })} />
              <input list="td-to" className={small} placeholder="To * · کہاں تک" value={stop.to} onChange={(e) => setStop({ ...stop, to: e.target.value })} />
              <input list="td-customers" className={small} placeholder={`Customer (${j.last.company || ""})`} value={stop.customer} onChange={(e) => setStop({ ...stop, customer: e.target.value })} />
              <input inputMode="numeric" className={small} placeholder="Freight · کرایہ" value={stop.freight} onChange={(e) => setStop({ ...stop, freight: e.target.value.replace(/[^\d]/g, "") })} />
              <input className={small} placeholder="Load · مال" value={stop.cargo} onChange={(e) => setStop({ ...stop, cargo: e.target.value })} />
              <input type="datetime-local" className={small} value={stop.departure} onChange={(e) => setStop({ ...stop, departure: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button onClick={addStop} disabled={addingStop || !stop.to.trim()} className="text-sm font-semibold rounded-lg bg-emerald-600 text-white px-4 py-1.5 disabled:opacity-60">Add stop</button>
              <button onClick={() => setShowStop(false)} className="text-sm rounded-lg border border-slate-300 bg-white px-4 py-1.5">Cancel</button>
            </div>
          </div>
        )}
      </Section>

      {/* money */}
      <TripMoney root={j.root} stops={j.legs} onChanged={onChanged} showFeedback={showFeedback} />

      {/* receipts */}
      <AttachmentPanel entityType="trip" entityId={j.root} title="Receipts · رسیدیں" />

      {khata && khata.rows.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <button onClick={() => setShowKhata((v) => !v)} className="w-full text-left px-3 py-2 text-[11px] font-semibold text-slate-500 hover:text-slate-800">
            {showKhata ? "▾" : "▸"} Other entries in the truck's khata during this trip ({khata.rows.length}) · ٹرک کھاتے کی دوسری انٹریاں
          </button>
          {showKhata && (
            <div className="overflow-x-auto max-h-64 overflow-y-auto border-t border-slate-100">
              <table className="w-full text-xs">
                <tbody>
                  {khata.rows.map((r: any) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 whitespace-nowrap text-slate-500">{r.entryDate ? dateOf(r.entryDate) : "—"}</td>
                      <td className="px-2" dir="auto">{r.description || r.category}</td>
                      <td className="px-2 text-right tabular-nums text-emerald-700">{r.received ? fmt(r.received) : ""}</td>
                      <td className="px-3 text-right tabular-nums text-red-700">{r.paid ? fmt(r.paid) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ================================================================ small pieces
/** A side panel over the page (a window on a phone). */
function Sheet({ title, subtitle, onClose, actions, wide, children }: { title: string; subtitle?: string; onClose: () => void; actions?: React.ReactNode; wide?: boolean; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className={`relative h-full w-full ${wide ? "max-w-3xl" : "max-w-xl"} bg-slate-50 shadow-2xl flex flex-col`}>
        <div className="bg-white border-b border-slate-200 px-4 py-3 space-y-2">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-base font-bold text-slate-800 truncate">{title}</div>
              {subtitle && <div className="text-xs text-slate-500 truncate">{subtitle}</div>}
            </div>
            <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-800 p-1"><X className="w-5 h-5" /></button>
          </div>
          {actions}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">{title}</div>
      {children}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tone === "bad" ? "border-red-200 bg-red-50" : tone === "good" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${tone === "bad" ? "text-red-700" : tone === "good" ? "text-emerald-800" : "text-slate-800"}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** What the truck's GPS said the moment the trip was created — appended to the success message. */
function gpsNote(gps: any): string {
  if (!gps) return "";
  if (!gps.found) return " · No GPS tracker for this truck · اس ٹرک کا ٹریکر نہیں";
  if (!gps.fresh) return ` · GPS last seen ${ago(gps.lastSeenAt)} (signal lost) — status not changed · جی پی ایس سگنل نہیں`;
  const where = gps.address ? ` near ${String(gps.address).split(",").slice(0, 2).join(",")}` : "";
  const left = gps.kmToDestination != null ? ` · ${gps.kmToDestination} km to go` : "";
  return ` · GPS: ${gps.speed || 0} km/h${where}${left} → ${gps.status} · جی پی ایس سے اسٹیٹس`;
}

/** One line under a trip's status: is this truck actually being tracked, and how close is it? */
function GpsLine({ gps, destination }: { gps: any; destination: string | null }) {
  if (!gps) {
    return <div className="text-[10px] text-slate-400 mt-0.5 whitespace-nowrap">No GPS tracker · ٹریکر نہیں</div>;
  }
  const minutes = gps.lastSeenAt ? (Date.now() - new Date(gps.lastSeenAt).getTime()) / 60000 : Infinity;
  const live = minutes <= 15;
  return (
    <div className={`text-[10px] mt-0.5 whitespace-nowrap flex items-center gap-1 ${live ? "text-emerald-700" : "text-red-600"}`}>
      <MapPin className="w-3 h-3" />
      {live ? `GPS live · ${gps.speed || 0} km/h` : "GPS signal lost"} · {ago(gps.lastSeenAt)}
      {gps.kmToDestination != null && destination ? ` · ${gps.kmToDestination} km to ${destination}` : ""}
    </div>
  );
}
