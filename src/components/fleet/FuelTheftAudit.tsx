/**
 * Fuel Theft Audit — "is fuel being stolen?" made obvious · فیول چوری کی جانچ.
 *
 * /api/fuel/theft-detection  — rule-based anomalies (big fill, rapid refill,
 *                              night refill, fuel without trip, odometer tricks).
 * /api/fuel/integrity-audit  — per driver / per truck: litres drawn vs the km
 *                              actually driven, with the full calculation.
 * Everything flagged is shown RED with the reason, the maths, and Resolve.
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import {
  Fuel,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  TrendingDown,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

const PKR = (n: number) => "PKR " + Math.abs(Math.round(n || 0)).toLocaleString();
const L = (n: number | null | undefined) => (n == null ? "—" : `${n} L`);

export default function FuelTheftAudit({
  showFeedback,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [audit, setAudit] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      enterpriseFetch("/api/fuel/theft-detection").catch(() => []),
      enterpriseFetch("/api/fuel/integrity-audit").catch(() => null),
    ])
      .then(([a, au]) => {
        setAlerts(Array.isArray(a) ? a : []);
        setAudit(au);
      })
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(load, [load]);

  const resolve = async (id: number) => {
    try {
      await enterpriseFetch(`/api/fuel/theft-detection/resolve/${id}`, { method: "POST" });
      showFeedback("success", "Alert resolved · حل شدہ");
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const open = alerts.map((r) => r.alert || r).filter((a) => !a.resolved);
  const withMeta = alerts.map((r) => ({ a: r.alert || r, vehicleNumber: r.vehicleNumber, driverName: r.driverName, tripNumber: r.tripNumber }))
    .filter((x) => !x.a.resolved);

  const drivers: any[] = audit?.drivers || [];
  const flagged = drivers.filter((d) => d.riskLevel && d.riskLevel !== "Low");
  const s = audit?.summary;
  const params = audit?.params;
  // link flaggedTransactions by id for the per-anomaly calc
  const txnCalc = new Map<number, any>();
  for (const ft of audit?.flaggedTransactions || []) txnCalc.set(ft.transactionId, ft);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <Fuel className="w-4 h-4" /> Fuel Theft Audit <span className="text-[#9CA3AF] font-normal text-sm">· فیول چوری کی جانچ</span>
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">
            Litres a driver / truck drew vs the km actually driven — with the calculation ·
            کتنا فیول ڈلوایا بمقابلہ کتنا سفر ہوا — مکمل حساب کے ساتھ
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white hover:bg-[#F0FAF4]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh <span className="text-[#9CA3AF]">تازہ کریں</span>
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Open anomalies · کھلی بے قاعدگیاں" value={String(open.length)} tone={open.length ? "bad" : "good"} />
        <Tile label="Drivers flagged · مشکوک ڈرائیور" value={String(flagged.length)} tone={flagged.length ? "bad" : "good"} />
        {s && (
          <Tile
            label="Suspected fuel loss · مشتبہ نقصان"
            value={`${s.estimatedFuelLossLitres} L`}
            tone={s.estimatedFuelLossLitres > 0 ? "bad" : "good"}
          />
        )}
        {s && (
          <Tile
            label="Loss value · نقصان کی مالیت"
            value={PKR(s.estimatedFuelLossValue)}
            tone={s.estimatedFuelLossValue > 0 ? "bad" : "neutral"}
          />
        )}
      </div>

      {params && (
        <p className="text-[10px] text-[#9CA3AF]" dir="auto">
          Benchmark: {params.expectedKmPerLitre} km / litre · tolerance {params.tolerancePercent}% · avg rate PKR{" "}
          {params.avgFuelRate}/L · معیار: {params.expectedKmPerLitre} کلومیٹر فی لیٹر
        </p>
      )}

      {/* rule-based anomalies */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#DC2626] text-white flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" style={{ color: "#fff", stroke: "#fff" }} />
          Anomalies ({withMeta.length}) · بے قاعدگیاں — click a row for the calculation
        </div>
        <div className="divide-y divide-[#F3F4F6]">
          {withMeta.length === 0 && (
            <p className="text-[12px] text-[#9CA3AF] p-3" dir="auto">No anomalies — clean · کوئی بے قاعدگی نہیں</p>
          )}
          {withMeta.map(({ a, vehicleNumber, driverName, tripNumber }) => {
            const rowKey = `a${a.id}`;
            const isOpen = openRow === rowKey;
            const ft = a.transactionId ? txnCalc.get(a.transactionId) : null;
            return (
              <div key={a.id}>
                <button
                  onClick={() => setOpenRow(isOpen ? null : rowKey)}
                  className="w-full text-left p-3 flex items-start justify-between gap-3 hover:bg-[#FEF2F2]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase rounded px-1.5 py-0.5 bg-[#FEE2E2] text-[#B91C1C]">
                        {a.severity}
                      </span>
                      <span className="text-[13px] font-semibold">{a.alertType}</span>
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </div>
                    <p className="text-[12px] text-[#374151] mt-0.5" dir="auto">{a.description}</p>
                    <p className="text-[10px] text-[#6B7280] mt-0.5">
                      {vehicleNumber ? `Truck ${vehicleNumber}` : ""}
                      {driverName ? ` · Driver ${driverName}` : ""}
                      {tripNumber ? ` · Trip ${tripNumber}` : ""}
                      {a.createdAt ? ` · ${new Date(a.createdAt).toLocaleString()}` : ""}
                    </p>
                  </div>
                  <span
                    onClick={(e) => { e.stopPropagation(); resolve(a.id); }}
                    className="shrink-0 flex items-center gap-1 text-[11px] rounded-md bg-[#16A34A] text-white px-2 py-1 cursor-pointer"
                  >
                    <ShieldCheck className="w-3 h-3" /> Resolve
                  </span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-3 bg-[#FEF2F2]">
                    {ft ? (
                      <table className="text-[11px] w-full max-w-md">
                        <tbody>
                          <CalcRow k="Fuel drawn · ڈلوایا" v={L(ft.litres)} />
                          <CalcRow k="Distance to next fill (odometer) · اگلے فِل تک سفر" v={ft.legKm != null ? `${ft.legKm} km` : "no next fill / odometer"} />
                          <CalcRow k="Benchmark · معیار" v={`${params?.expectedKmPerLitre ?? 3.5} km / litre`} />
                          <CalcRow k="Expected fuel = km ÷ benchmark" v={ft.expectedLitresForLeg != null ? `${ft.legKm} ÷ ${params?.expectedKmPerLitre ?? 3.5} = ${ft.expectedLitresForLeg} L` : "—"} />
                          <CalcRow
                            k="Over-draw · زائد"
                            v={ft.overdrawLitresForLeg != null ? `${ft.litres} − ${ft.expectedLitresForLeg} = ${ft.overdrawLitresForLeg} L` : "—"}
                            bold
                          />
                          <CalcRow k="Mileage on this fill · اس فِل کی ایوریج" v={ft.legKmpl != null ? `${ft.legKmpl} km / litre` : "—"} />
                          {ft.flags?.map((fl: any, i: number) => (
                            <tr key={i} className="text-[#B45309]">
                              <td className="py-0.5 pr-3 align-top" dir="auto">{fl.code}</td>
                              <td className="py-0.5" dir="auto">{fl.detail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-[11px] text-[#6B7280]" dir="auto">
                        {a.description}
                        <br />
                        <span className="text-[10px]">
                          Odometer / next-fill data incomplete, so the full calculation isn't available for this row.
                        </span>
                      </p>
                    )}
                    <p className="text-[10px] text-[#6B7280] mt-1.5" dir="auto">
                      Why flagged: more fuel was drawn than the distance to the next fill can justify (beyond the
                      tolerance). · اتنا فیول ڈلوایا مگر اتنا سفر نہیں ہوا۔
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* per-driver integrity audit with calculation columns */}
      {drivers.length > 0 && (
        <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
          <div className="px-3 py-2 text-xs font-bold bg-[#EA580C] text-white flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5" style={{ color: "#fff", stroke: "#fff" }} />
            Per driver — litres drawn vs km driven · فی ڈرائیور — ڈلوایا بمقابلہ سفر
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F9FAFB] text-[#6B7280]">
                <tr>
                  <th className="text-left px-2 py-1.5">Driver</th>
                  <th className="text-right px-2 py-1.5">Litres drawn</th>
                  <th className="text-right px-2 py-1.5">Km driven</th>
                  <th className="text-right px-2 py-1.5">Expected L</th>
                  <th className="text-right px-2 py-1.5">Over-draw L (%)</th>
                  <th className="text-right px-2 py-1.5">km/L</th>
                  <th className="text-right px-2 py-1.5">Loss value</th>
                  <th className="text-left px-2 py-1.5">Risk</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d: any) => {
                  const risky = d.riskLevel && d.riskLevel !== "Low";
                  return (
                    <tr key={d.driverId} className={`border-t border-[#F3F4F6] ${risky ? "bg-[#FEF2F2]" : ""}`}>
                      <td className="px-2 py-1.5" dir="auto">{d.driverName}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{d.litresDrawn}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{d.distanceKm}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{d.expectedLitres}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${d.overdrawLitres > 0 ? "text-[#B91C1C]" : "text-[#15803D]"}`}>
                        {d.overdrawLitres} {d.overdrawPercent != null ? `(${d.overdrawPercent}%)` : ""}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{d.impliedKmPerLitre ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#B91C1C]">{d.estimatedLossValue ? PKR(d.estimatedLossValue) : "—"}</td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${
                            risky ? "bg-[#FEE2E2] text-[#B91C1C]" : "bg-[#DCFCE7] text-[#15803D]"
                          }`}
                        >
                          {d.riskLevel}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-[10px] text-[#6B7280] border-t border-[#F3F4F6]" dir="auto">
            <b>Over-draw L</b> = litres drawn − (km driven ÷ benchmark). Only fills that power a measured leg count
            (the last fill's fuel is still in the tank). · زائد لیٹر = ڈلوایا − (سفر ÷ معیار)۔
          </p>
        </div>
      )}
    </div>
  );
}

function CalcRow({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <tr className={bold ? "font-bold text-[#B91C1C]" : ""}>
      <td className="py-0.5 pr-3 align-top text-[#4B5563]" dir="auto">{k}</td>
      <td className="py-0.5" dir="auto">{v}</td>
    </tr>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "neutral" }) {
  const c =
    tone === "bad"
      ? "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]"
      : tone === "good"
      ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]"
      : "border-[#E5E7EB] bg-white text-[#1F2937]";
  return (
    <div className={`rounded-xl border p-3 ${c}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide" dir="auto">{label}</div>
      <div className="text-lg font-extrabold tabular-nums">{value}</div>
    </div>
  );
}
