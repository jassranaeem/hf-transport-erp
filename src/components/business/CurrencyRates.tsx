/**
 * Currency Rates · کرنسی ریٹ — today's rate of each currency comes from the internet by itself
 * (updated every day). If you actually got a different rate (open market, the money changer),
 * type it for the day — yours is used instead and is never overwritten.
 * The Cash Book's "$ → PKR" helper uses the same rate: $1,100 × rate = PKR.
 */
import React, { useEffect, useState } from "react";
import { Coins, RefreshCw, Trash2, Loader2, Globe, PencilLine } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { PageHeader, Btn, Card, Empty } from "../ui/kit.tsx";
import { dmy } from "../../lib/share.ts";

export const isAuto = (note?: string | null) => String(note || "").startsWith("Auto");
const fmtRate = (n: number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 });

/** Today's rate for a currency: yours if you typed one, else the internet's. */
export async function liveRate(code: string): Promise<{ rate: number; source: string; date: string; warning?: string }> {
  return enterpriseFetch(`/api/currency/live?code=${code}`);
}

export default function CurrencyRates({ showFeedback }: { showFeedback: (t: "success" | "error", m: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ code: "USD", rate: "", date: new Date().toISOString().slice(0, 10), note: "" });
  const [calc, setCalc] = useState<{ code: string; amount: string; rate: number | null; source: string; loading: boolean }>({ code: "USD", amount: "1", rate: null, source: "", loading: false });

  const load = () => enterpriseFetch("/api/currency").then(setD).catch((e) => showFeedback("error", e.message));
  const refresh = async (quiet = false) => {
    setBusy(true);
    try {
      const r = await enterpriseFetch("/api/currency/refresh", { method: "POST", body: "{}" });
      if (!quiet) showFeedback("success", `Today's rates updated from the internet · ریٹ اپڈیٹ (${r.saved})`);
    } catch (e: any) {
      if (!quiet) showFeedback("error", e.message);
    } finally {
      setBusy(false);
      load();
    }
  };
  useEffect(() => {
    refresh(true); // open the page with today's rates
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // choose a currency → its rate comes by itself
  useEffect(() => {
    setCalc((c) => ({ ...c, loading: true }));
    liveRate(calc.code)
      .then((r) => setCalc((c) => ({ ...c, rate: r.rate, source: r.source === "yours" ? "your rate for today" : r.source === "internet" ? `internet rate, ${dmy(r.date)}` : `last saved (${dmy(r.date)})`, loading: false })))
      .catch((e) => {
        setCalc((c) => ({ ...c, rate: null, source: e.message, loading: false }));
      });
  }, [calc.code]);
  useEffect(() => {
    liveRate(f.code).then((r) => setF((x) => ({ ...x, rate: x.rate || String(r.rate) }))).catch(() => {});
  }, [f.code]);

  const add = async () => {
    try {
      await enterpriseFetch("/api/currency", { method: "POST", body: JSON.stringify(f) });
      showFeedback("success", "Your rate is saved — it is used for that day · آپ کا ریٹ محفوظ");
      setF({ ...f, rate: "", note: "" });
      load();
      setCalc((c) => ({ ...c, code: c.code })); // re-read
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  const del = async (id: number) => {
    await enterpriseFetch(`/api/currency/${id}`, { method: "DELETE" }).catch((e) => showFeedback("error", e.message));
    load();
  };
  const cur: Record<string, string> = d?.currencies || { USD: "US Dollar" };
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white";
  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const pkr = calc.rate ? Math.round(Number(calc.amount || 0) * calc.rate) : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Currency Rates"
        urdu="کرنسی ریٹ"
        icon={<Coins />}
        subtitle="Today's rates come from the internet by themselves · آج کا ریٹ خود آ جاتا ہے — type yours only if you got a different one"
        actions={<Btn onClick={() => refresh()} disabled={busy} icon={busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}>Update now</Btn>}
      />

      {/* the converter: choose a currency, the rate is there */}
      <Card bodyClassName="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className={lbl}>Currency · کرنسی
            <select value={calc.code} onChange={(e) => setCalc({ ...calc, code: e.target.value })} className={`${inp} min-w-[180px]`}>
              {Object.entries(cur).map(([k, v]) => <option key={k} value={k}>{k} — {String(v)}</option>)}
            </select>
          </label>
          <label className={lbl}>Amount · رقم<input inputMode="decimal" value={calc.amount} onChange={(e) => setCalc({ ...calc, amount: e.target.value })} className={`${inp} w-36`} /></label>
          <div className="pb-1">
            <div className="text-[11.5px] text-[#6B7280]">{calc.loading ? "getting the rate…" : calc.rate ? `1 ${calc.code} = PKR ${fmtRate(calc.rate)}` : ""}</div>
            <div className="text-[24px] font-semibold tabular-nums text-[#13294B]">{calc.loading ? <Loader2 className="w-5 h-5 animate-spin inline" /> : calc.rate ? `PKR ${pkr.toLocaleString()}` : "—"}</div>
          </div>
          <div className="pb-2 text-[11.5px] text-[#6B7280] flex items-center gap-1">
            {calc.source && (calc.source.startsWith("your") ? <PencilLine className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />)} {calc.source}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 items-start">
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {(d?.latest || []).map((r: any) => (
              <React.Fragment key={r.code}>
                <Card bodyClassName="p-3">
                  <div className="text-[11.5px] text-[#6B7280] flex items-center justify-between gap-1">
                    <span>{r.code} · {cur[r.code] || ""}</span>
                    <span title={isAuto(r.note) ? "From the internet" : "Typed by you"}>{isAuto(r.note) ? <Globe className="w-3.5 h-3.5" /> : <PencilLine className="w-3.5 h-3.5 text-[#24539B]" />}</span>
                  </div>
                  <div className="text-[19px] font-semibold tabular-nums">PKR {fmtRate(r.rate)}</div>
                  <div className="text-[11px] text-[#9CA3AF]">{isAuto(r.note) ? "internet" : "your rate"} · {dmy(r.rate_date)}</div>
                </Card>
              </React.Fragment>
            ))}
          </div>
          <Card title="Rates by day · ریٹ کی تاریخ" bodyClassName="">
            {!d?.history?.length ? (
              <Empty icon={<Coins />} title="No rate yet" hint="Press “Update now” to get today's rates." />
            ) : (
              <table className="w-full text-[12.5px]">
                <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]"><tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Currency</th><th className="text-right px-3 py-2">1 = PKR</th><th className="text-left px-3 py-2">From</th><th /></tr></thead>
                <tbody>
                  {d.history.map((r: any) => (
                    <tr key={r.id} className="group border-t border-[#F1F4F9]">
                      <td className="px-3 py-2 tabular-nums">{dmy(r.rate_date)}</td>
                      <td className="px-3 py-2">{r.code}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtRate(r.rate)}</td>
                      <td className="px-3 py-2 text-[#6B7280]" dir="auto">{isAuto(r.note) ? "Internet" : `You${r.by_name ? ` (${r.by_name})` : ""}${r.note ? ` — ${r.note}` : ""}`}</td>
                      <td className="px-3 py-2 text-right">{!isAuto(r.note) && <button onClick={() => del(r.id)} className="opacity-40 group-hover:opacity-100 text-[#6B7280] hover:text-red-600" title="Remove your rate (the internet rate is used again)"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <Card title="Got a different rate? · اپنا ریٹ" bodyClassName="p-4 space-y-3">
          <p className="text-[12px] text-[#6B7280]">The internet rate is the market reference. If the money changer gave you another rate (e.g. 284 instead of 277), type it — that day uses yours.</p>
          <label className={lbl}>Currency<select value={f.code} onChange={(e) => setF({ ...f, code: e.target.value, rate: "" })} className={inp}>{Object.entries(cur).map(([k, v]) => <option key={k} value={k}>{k} — {String(v)}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}>1 {f.code} = PKR<input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} className={inp} /></label>
            <label className={lbl}>Date<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inp} /></label>
          </div>
          <label className={lbl}>Who gave this rate (note)<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inp} dir="auto" /></label>
          <Btn kind="primary" onClick={add} disabled={!Number(f.rate)}>Save my rate</Btn>
        </Card>
      </div>
    </div>
  );
}
