/**
 * Trip Fuel History — per-trip fuel cost, litres, average and margin.
 * "Truck Lahore se nikla, Quetta aya — kitna fuel liya, kitna cost, km/L?"
 * GET /api/fuel/trip-history
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Fuel, RefreshCw, Loader2, ChevronDown, ChevronRight, Info } from "lucide-react";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

const PKR = (n: number | null | undefined) => (n == null ? "—" : "PKR " + Math.round(n).toLocaleString());
const NUM = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString());

export default function TripFuelHistory({
  showFeedback,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    enterpriseFetch(`/api/fuel/trip-history?${p.toString()}`)
      .then(setData)
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [from, to, showFeedback]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const s = data?.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <Fuel className="w-4 h-4" /> Trip Fuel History <span className="text-[#9CA3AF] font-normal text-sm">· فی ٹرپ فیول</span>
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">Per trip: litres drawn, cost, km per litre, and vs the route benchmark · فی ٹرپ فیول، لاگت، اوسط</p>
        </div>
        <div className="flex-1" />
        <label className="flex flex-col text-[11px] text-[#6B7280]">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-[#E5E7EB] rounded px-2 py-1 text-sm" /></label>
        <label className="flex flex-col text-[11px] text-[#6B7280]">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-[#E5E7EB] rounded px-2 py-1 text-sm" /></label>
        <button onClick={load} disabled={loading} className="h-9 px-3 rounded-lg border border-[#E5E7EB] bg-white text-sm flex items-center gap-1.5 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
        <ModuleDataIO entityKey="fuel_transactions" label="Fuel Transactions" onImported={load} />
      </div>

      {/* how a "trip" is counted + how the numbers are worked out */}
      <div className="rounded-lg border border-[#C9D7EC] bg-[#F2F5FA] px-3 py-2.5 text-[12px] text-[#1E3A8A] space-y-1.5" dir="auto">
        <div className="font-bold flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> How this is calculated · حساب کیسے لگتا ہے</div>
        <p><b>1 trip = 1 leg.</b> Lahore → Karachi is one trip. The return Karachi → Lahore is a <b>separate</b> trip with its own km, revenue and fuel. They are <b>not</b> merged into one round-trip. · لاہور → کراچی ایک ٹرپ، واپسی الگ ٹرپ۔</p>
        <p><b>Litres &amp; fuel cost</b> = the sum of every fuel slip (fuel transaction) linked to that trip. <b>Fills</b> = how many slips.</p>
        <p><b>km / L</b> = trip distance ÷ litres. &nbsp; <b>Cost / km</b> = fuel cost ÷ distance. &nbsp; <b>Avg rate</b> = fuel cost ÷ litres.</p>
        <p><b>Benchmark L</b> = trip benchmark, else the route's benchmark, else the trip's expected fuel. <b>Variance</b> = litres − benchmark. A row turns <b>red</b> when it is 10%+ over benchmark.</p>
        <p className="text-[#173563]">Click any row to see its full working. · تفصیل کے لیے قطار پر کلک کریں۔</p>
      </div>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Tile label="Trips (with fuel)" value={`${s.tripsWithFuel} / ${s.trips}`} />
          <Tile label="Total litres" value={`${s.totalLitres.toLocaleString()} L`} />
          <Tile label="Total fuel cost" value={PKR(s.totalFuelCost)} tone="bad" />
          <Tile label="Avg km / litre" value={s.avgKmPerLitre ?? "—"} tone="good" />
          <Tile label="Over benchmark" value={`${s.overBenchmarkTrips} trips`} tone={s.overBenchmarkTrips ? "bad" : "good"} />
        </div>
      )}

      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F9FAFB] text-[#6B7280]">
              <tr>
                <th className="px-1 py-1.5"></th>
                <th className="text-left px-2 py-1.5">Trip</th>
                <th className="text-left px-2 py-1.5">Route</th>
                <th className="text-left px-2 py-1.5">Truck</th>
                <th className="text-right px-2 py-1.5">Km</th>
                <th className="text-right px-2 py-1.5">Litres</th>
                <th className="text-right px-2 py-1.5">Fills</th>
                <th className="text-right px-2 py-1.5">Fuel cost</th>
                <th className="text-right px-2 py-1.5">Benchmark L</th>
                <th className="text-right px-2 py-1.5">Variance</th>
                <th className="text-right px-2 py-1.5">km/L</th>
                <th className="text-right px-2 py-1.5">Cost/km</th>
                <th className="text-right px-2 py-1.5">Fuel % rev</th>
              </tr>
            </thead>
            <tbody>
              {(data?.trips || []).map((t: any) => {
                const isOpen = open === t.tripId;
                return (
                  <React.Fragment key={t.tripId}>
                    <tr
                      onClick={() => setOpen(isOpen ? null : t.tripId)}
                      className={`border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F9FAFB] ${(t.variancePercent ?? 0) > 10 ? "bg-[#FFF1F1]" : ""}`}
                    >
                      <td className="px-1 py-1.5 text-[#9CA3AF]">{isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{t.tripNumber}</td>
                      <td className="px-2 py-1.5" dir="auto">{t.route || "—"}</td>
                      <td className="px-2 py-1.5">{t.vehicle || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{t.distanceKm?.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{t.litres || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{t.fills || ""}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#B00005]">{t.fuelCost ? PKR(t.fuelCost) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">{t.benchmarkLitres ?? "—"}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${(t.varianceLitres ?? 0) > 0 ? "text-[#B00005]" : "text-[#1E4480]"}`}>
                        {t.varianceLitres == null ? "—" : `${t.varianceLitres > 0 ? "+" : ""}${t.varianceLitres} L${t.variancePercent != null ? ` (${t.variancePercent}%)` : ""}`}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{t.kmPerLitre ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{t.costPerKm ? PKR(t.costPerKm) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{t.fuelShareOfRevenue != null ? `${t.fuelShareOfRevenue}%` : "—"}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-[#F9FAFB]">
                        <td colSpan={13} className="px-4 py-3">
                          <div className="text-[11px] font-bold text-slate-600 mb-2" dir="auto">
                            {t.tripNumber} — {t.route || "route not set"} · full working
                          </div>
                          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 text-[12px]">
                            <Calc k="Distance (trip)" v={`${NUM(t.distanceKm)} km`} />
                            <Calc k="Fuel slips linked" v={`${t.fills || 0} slip(s)`} />
                            <Calc k="Litres drawn" v={`${t.litres || 0} L  (sum of the slips)`} />
                            <Calc k="Fuel cost" v={`${PKR(t.fuelCost)}  (sum of the slips)`} />
                            <Calc k="Avg rate / litre" v={`${PKR(t.fuelCost)} ÷ ${t.litres || 0} L = ${PKR(t.avgRatePerLitre)}`} />
                            <Calc k="Mileage (km / L)" v={`${NUM(t.distanceKm)} ÷ ${t.litres || 0} = ${t.kmPerLitre ?? "—"} km/L`} />
                            <Calc k="Cost / km" v={`${PKR(t.fuelCost)} ÷ ${NUM(t.distanceKm)} km = ${PKR(t.costPerKm)}`} />
                            <Calc k="Benchmark litres" v={`${t.benchmarkLitres ?? "not set"}`} />
                            <Calc
                              k="Variance vs benchmark"
                              v={
                                t.varianceLitres == null
                                  ? "no benchmark set for this route"
                                  : `${t.litres || 0} − ${t.benchmarkLitres} = ${t.varianceLitres > 0 ? "+" : ""}${t.varianceLitres} L (${t.variancePercent}%)`
                              }
                              tone={(t.varianceLitres ?? 0) > 0 ? "bad" : "good"}
                            />
                            <Calc k="Trip revenue" v={PKR(t.revenue)} />
                            <Calc k="Fuel as % of revenue" v={t.fuelShareOfRevenue != null ? `${PKR(t.fuelCost)} ÷ ${PKR(t.revenue)} = ${t.fuelShareOfRevenue}%` : "—"} />
                            <Calc k="Departure → arrival" v={`${t.departure ? new Date(t.departure).toLocaleDateString() : "—"} → ${t.arrival ? new Date(t.arrival).toLocaleDateString() : "—"}`} />
                          </div>
                          {t.varianceLitres != null && t.variancePercent > 10 && (
                            <p className="mt-2 text-[11px] text-[#B00005]" dir="auto">
                              This trip burned {t.varianceLitres} L more than the route benchmark ({t.variancePercent}% over) — worth a check. ·
                              اس ٹرپ میں معیار سے {t.varianceLitres} لیٹر زیادہ فیول لگا۔
                            </p>
                          )}
                          {!t.litres && (
                            <p className="mt-2 text-[11px] text-[#4B5563]" dir="auto">
                              No fuel slip is linked to this trip yet, so litres / km-L / cost cannot be worked out. Link the fuel transactions to this trip. ·
                              اس ٹرپ سے کوئی فیول سلپ منسلک نہیں۔
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {(!data?.trips || data.trips.length === 0) && (
                <tr><td colSpan={13} className="px-2 py-6 text-center text-[#9CA3AF]">No trips in range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-[#9CA3AF]" dir="auto">
        Variance = litres drawn − route benchmark. Red rows = 10%+ over benchmark. · سرخ = معیار سے 10%+ زیادہ فیول۔
      </p>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: any; tone?: "good" | "bad" }) {
  const c = tone === "bad" ? "border-[#FFC2C3] bg-[#FFF1F1] text-[#B00005]" : tone === "good" ? "border-[#C9D7EC] bg-[#F2F5FA] text-[#1E4480]" : "border-[#E5E7EB] bg-white text-[#1F2937]";
  return (
    <div className={`rounded-xl border p-3 ${c}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide" dir="auto">{label}</div>
      <div className="text-lg font-extrabold tabular-nums">{value}</div>
    </div>
  );
}

function Calc({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "good" | "bad" }) {
  const c = tone === "bad" ? "text-[#B00005]" : tone === "good" ? "text-[#1E4480]" : "text-slate-800";
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-slate-200 py-0.5">
      <span className="text-slate-500">{k}</span>
      <span className={`text-right tabular-nums ${c}`} dir="auto">{v}</span>
    </div>
  );
}
