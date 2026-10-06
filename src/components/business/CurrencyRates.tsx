/**
 * Currency Rates · کرنسی ریٹ — the rate you got for each currency on a day (never assumed by the
 * system). The Cash Book's "foreign money" helper uses the latest one: $1,100 × 284 = PKR 312,400.
 */
import React, { useEffect, useState } from "react";
import { Coins, Plus, Trash2 } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { PageHeader, Btn, Card, Empty } from "../ui/kit.tsx";
import { dmy } from "../../lib/share.ts";

export default function CurrencyRates({ showFeedback }: { showFeedback: (t: "success" | "error", m: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [f, setF] = useState({ code: "USD", rate: "", date: new Date().toISOString().slice(0, 10), note: "" });
  const [calc, setCalc] = useState({ code: "USD", amount: "" });
  const load = () => enterpriseFetch("/api/currency").then(setD).catch((e) => showFeedback("error", e.message));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => {
    try {
      await enterpriseFetch("/api/currency", { method: "POST", body: JSON.stringify(f) });
      showFeedback("success", "Rate saved · ریٹ محفوظ");
      setF({ ...f, rate: "", note: "" });
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  const del = async (id: number) => {
    await enterpriseFetch(`/api/currency/${id}`, { method: "DELETE" }).catch((e) => showFeedback("error", e.message));
    load();
  };
  const latest = (code: string) => d?.latest?.find((r: any) => r.code === code);
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white";
  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const cur = d?.currencies || { USD: "US Dollar" };
  const conv = latest(calc.code);

  return (
    <div className="space-y-4">
      <PageHeader title="Currency Rates" urdu="کرنسی ریٹ" icon={<Coins />} subtitle="The rate you actually got — the system never guesses one · جو ریٹ ملا وہی لکھیں" />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 items-start">
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(d?.latest || []).map((r: any) => (
              <React.Fragment key={r.code}>
              <Card bodyClassName="p-3">
                <div className="text-[11.5px] text-[#6B7280]">{r.code} · {cur[r.code] || ""}</div>
                <div className="text-[19px] font-semibold tabular-nums">PKR {Number(r.rate).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                <div className="text-[11px] text-[#9CA3AF]">on {dmy(r.rate_date)}</div>
              </Card>
              </React.Fragment>
            ))}
          </div>
          <Card title="Rates entered · درج شدہ ریٹ" bodyClassName="">
            {!d?.history?.length ? (
              <Empty icon={<Coins />} title="No rate yet" hint="Add the rate you got for USD, Toman, Afghani…" />
            ) : (
              <table className="w-full text-[12.5px]">
                <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]"><tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Currency</th><th className="text-right px-3 py-2">1 = PKR</th><th className="text-left px-3 py-2">Note</th><th className="text-left px-3 py-2">By</th><th /></tr></thead>
                <tbody>
                  {d.history.map((r: any) => (
                    <tr key={r.id} className="group border-t border-[#F1F4F9]">
                      <td className="px-3 py-2 tabular-nums">{dmy(r.rate_date)}</td>
                      <td className="px-3 py-2">{r.code}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{Number(r.rate).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td className="px-3 py-2 text-[#6B7280]" dir="auto">{r.note}</td>
                      <td className="px-3 py-2 text-[#6B7280]">{r.by_name}</td>
                      <td className="px-3 py-2 text-right"><button onClick={() => del(r.id)} className="opacity-40 group-hover:opacity-100 text-[#6B7280] hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Add a rate · نیا ریٹ" bodyClassName="p-4 space-y-3">
            <label className={lbl}>Currency<select value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className={inp}>{Object.entries(cur).map(([k, v]) => <option key={k} value={k}>{k} — {String(v)}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-3">
              <label className={lbl}>1 {f.code} = PKR<input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} className={inp} placeholder="284" /></label>
              <label className={lbl}>Date<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inp} /></label>
            </div>
            <label className={lbl}>Note (who gave this rate)<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inp} dir="auto" /></label>
            <Btn kind="primary" onClick={add} disabled={!Number(f.rate)} icon={<Plus />}>Save rate</Btn>
          </Card>
          <Card title="Convert · تبدیل کریں" bodyClassName="p-4 space-y-2">
            <div className="flex gap-2">
              <select value={calc.code} onChange={(e) => setCalc({ ...calc, code: e.target.value })} className={inp}>{Object.keys(cur).map((k) => <option key={k}>{k}</option>)}</select>
              <input inputMode="decimal" value={calc.amount} onChange={(e) => setCalc({ ...calc, amount: e.target.value })} className={`${inp} flex-1`} placeholder="1100" />
            </div>
            <div className="text-[13px]">
              {conv ? (
                <>
                  {Number(calc.amount || 0).toLocaleString()} × {Number(conv.rate).toLocaleString()} = <b className="text-[16px]">PKR {Math.round(Number(calc.amount || 0) * Number(conv.rate)).toLocaleString()}</b>
                  <div className="text-[11px] text-[#9CA3AF]">rate of {dmy(conv.rate_date)}</div>
                </>
              ) : (
                <span className="text-[#9CA3AF]">No {calc.code} rate yet — add one above</span>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
