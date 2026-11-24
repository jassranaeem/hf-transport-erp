/**
 * The evening cash count · نقد کی گنتی (Daily Cash Book) — count the notes, the system compares
 * with what the cash book says; a difference stays red (Books Check) until an entry is added or
 * "Record the difference" writes the shortage / excess into the cash book.
 * And the summary · خلاصہ — in / out / closing by day, week, month or year, with the counts.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Calculator, Loader2, CheckCircle2, AlertTriangle, Trash2, BarChart3 } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";

type Feedback = (t: "success" | "error", m: string) => void;
const NOTES = ["5000", "1000", "500", "100", "50", "20", "10"];
const PKR = (n: number) => (n < 0 ? "−" : "") + "PKR " + Math.abs(Math.round(n || 0)).toLocaleString();

export function CashCountPanel({ date, showFeedback, onChanged, version }: { date: string; showFeedback: Feedback; onChanged: () => void; version: number }) {
  const [data, setData] = useState<any>(null);
  const [den, setDen] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    enterpriseFetch(`/api/cash-book/count?date=${date}`)
      .then((r) => {
        setData(r);
        const d = r.count?.denominations || {};
        setDen(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v)])));
        setTyped(r.count && !r.count.denominations ? String(r.count.declaredBalance) : "");
        setNotes(r.count?.notes || "");
        setOpen(!r.count);
      })
      .catch(() => setData(null));
  }, [date]);
  useEffect(load, [load, version]);

  const fromNotes = Object.entries(den).reduce((s, [k, v]) => s + (Number(v) || 0) * (k === "coins" ? 1 : Number(k)), 0);
  const counted = typed !== "" ? Number(typed) || 0 : fromNotes;

  const save = async () => {
    setBusy(true);
    try {
      const body = { date, denominations: Object.fromEntries(Object.entries(den).filter(([, v]) => Number(v))), notes, ...(typed !== "" ? { counted: Number(typed) || 0 } : {}) };
      const r = await enterpriseFetch("/api/cash-book/count", { method: "PUT", body: JSON.stringify(body) });
      showFeedback(r.difference === 0 ? "success" : "error", r.difference === 0 ? "Counted — matches the book · گنتی کتاب کے برابر" : `Counted — ${r.difference < 0 ? "short" : "extra"} ${PKR(Math.abs(r.difference))} · فرق`);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };

  const settle = async () => {
    const d = data.difference;
    if (!window.confirm(`Write the ${d < 0 ? "shortage" : "excess"} of ${PKR(Math.abs(d))} into the cash book for ${date}? It goes to the books as "Cash shortage / excess". Only do this if the reason cannot be found. · فرق کیش بک میں درج کریں؟`)) return;
    setBusy(true);
    try {
      const r = await enterpriseFetch("/api/cash-book/count/settle", { method: "POST", body: JSON.stringify({ date }) });
      showFeedback("success", `${r.message} · درج ہو گیا`);
      onChanged();
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove the cash count of ${date}? · یہ گنتی حذف کریں؟`)) return;
    try {
      await enterpriseFetch(`/api/cash-book/count?date=${date}`, { method: "DELETE" });
      showFeedback("success", "Count removed · حذف");
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  if (!data) return null;
  const diff = data.difference;
  const has = !!data.count;
  const tone = !has ? "border-[#FCD34D] bg-[#FFFBEB]" : diff === 0 ? "border-[#A7F3D0] bg-[#F0FDF4]" : "border-[#FCA5A5] bg-[#FEF2F2]";

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-bold flex items-center gap-1.5"><Calculator className="w-4 h-4" /> Cash count · نقد کی گنتی</span>
        <span>Book says · کتاب: <b className="tabular-nums">{PKR(data.book.closing)}</b></span>
        {has && <span>Counted · گنا: <b className="tabular-nums">{PKR(data.count.declaredBalance)}</b></span>}
        {has &&
          (diff === 0 ? (
            <span className="text-[#166534] font-semibold flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Matches · برابر</span>
          ) : (
            <span className="text-[#991B1B] font-semibold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> {diff < 0 ? "Short" : "Extra"} {PKR(Math.abs(diff))} · {diff < 0 ? "کم" : "زیادہ"}</span>
          ))}
        {!has && <span className="text-[#92400E]">Not counted yet — count the cash in the drawer · ابھی نہیں گنا</span>}
        <span className="ml-auto flex items-center gap-3 text-xs">
          <button onClick={() => setOpen((v) => !v)} className="underline text-[#24539B]">{open ? "Hide" : has ? "Count again" : "Count now"}</button>
          {has && <button onClick={remove} className="text-[#6B7280] hover:text-[#B91C1C]" title="Remove this count"><Trash2 className="w-3.5 h-3.5" /></button>}
        </span>
      </div>
      {has && diff !== 0 && (
        <div className="text-xs text-[#7F1D1D] flex flex-wrap items-center gap-2">
          First look for a missing or wrong entry today. If the reason cannot be found:
          <button disabled={busy} onClick={settle} className="rounded-lg border border-[#991B1B] text-[#991B1B] px-2 py-0.5 font-semibold hover:bg-white disabled:opacity-60">
            Record the difference · فرق درج کریں
          </button>
        </div>
      )}
      {open && (
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {[...NOTES, "coins"].map((k) => (
              <label key={k} className="flex flex-col gap-0.5">
                <span className="text-[10px] text-[#6B7280]">{k === "coins" ? "Coins (Rs)" : `Rs ${k} ×`}</span>
                <input id={`den-${k}`} inputMode="numeric" value={den[k] || ""} onChange={(e) => { setTyped(""); setDen({ ...den, [k]: e.target.value.replace(/\D/g, "") }); }} className="border rounded px-2 py-1 tabular-nums bg-white" />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>From notes · نوٹوں سے: <b className="tabular-nums">{PKR(fromNotes)}</b></div>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-[#6B7280]">…or type the total · یا کل رقم</span>
              <input id="count-total" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))} className="border rounded px-2 py-1 w-36 tabular-nums bg-white" />
            </label>
            <label className="flex flex-col gap-0.5 flex-1 min-w-[160px]">
              <span className="text-[10px] text-[#6B7280]">Note · نوٹ</span>
              <input id="count-note" value={notes} onChange={(e) => setNotes(e.target.value)} className="border rounded px-2 py-1 bg-white" dir="auto" />
            </label>
            <button disabled={busy} onClick={save} className="rounded-lg bg-[#24539B] text-white px-4 py-1.5 font-semibold disabled:opacity-60 flex items-center gap-1.5">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save count · گنتی محفوظ ({PKR(counted)})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const BY = [
  { key: "day", label: "Day · دن" },
  { key: "week", label: "Week · ہفتہ" },
  { key: "month", label: "Month · مہینہ" },
  { key: "year", label: "Year · سال" },
];

export function CashSummary({ showFeedback, onPickDay }: { showFeedback: Feedback; onPickDay: (d: string) => void }) {
  const [open, setOpen] = useState(false);
  const [by, setBy] = useState("month");
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    if (!open) return;
    setData(null);
    enterpriseFetch(`/api/cash-book/summary?by=${by}`).then(setData).catch((e) => showFeedback("error", e.message));
  }, [open, by, showFeedback]);
  const label = (r: any) => {
    if (by === "day") return r.key.split("-").reverse().join(".");
    if (by === "week") return `Week of ${r.key.split("-").reverse().join(".")}`;
    if (by === "month") return new Date(`${r.key}-01T00:00:00`).toLocaleString("en-GB", { month: "long", year: "numeric" });
    return r.key;
  };
  return (
    <div className="rounded-xl border border-[#E3E8EF] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]">
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-1.5">
        <BarChart3 className="w-3.5 h-3.5" /> Summary · خلاصہ — day, week, month, year (this financial year)
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 text-xs">
          <div className="flex gap-1">
            {BY.map((b) => (
              <button key={b.key} onClick={() => setBy(b.key)} className={`rounded-full px-3 py-1 ${by === b.key ? "bg-[#24539B] text-white" : "bg-[#F3F4F6] text-[#374151]"}`}>{b.label}</button>
            ))}
          </div>
          {!data ? (
            <div className="text-[#6B7280] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding up…</div>
          ) : data.rows.length === 0 ? (
            <div className="text-[#6B7280]">No cash entries in this financial year yet.</div>
          ) : (
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full">
                <thead className="text-[#6B7280] sticky top-0 bg-white">
                  <tr><th className="text-left py-1">Period</th><th className="text-right">Opening</th><th className="text-right">In · آیا</th><th className="text-right">Out · گیا</th><th className="text-right">Closing · باقی</th><th className="text-right">Counted</th><th className="text-right">Difference</th></tr>
                </thead>
                <tbody>
                  {[...data.rows].reverse().map((r: any) => (
                    <tr key={r.key} className="border-t border-[#F3F4F6]">
                      <td className="py-1 whitespace-nowrap">{by === "day" ? <button onClick={() => onPickDay(r.key)} className="text-[#24539B] underline">{label(r)}</button> : label(r)}</td>
                      <td className="text-right tabular-nums text-[#6B7280]">{PKR(r.opening)}</td>
                      <td className="text-right tabular-nums text-[#047857]">{PKR(r.in)}</td>
                      <td className="text-right tabular-nums text-[#B91C1C]">{PKR(r.out)}</td>
                      <td className={`text-right tabular-nums font-semibold ${r.closing < 0 ? "text-[#B91C1C]" : ""}`}>{PKR(r.closing)}</td>
                      <td className="text-right tabular-nums">{r.counted ? `${r.counted}/${r.days} days` : <span className="text-[#92400E]">—</span>}</td>
                      <td className={`text-right tabular-nums ${r.difference ? "text-[#991B1B] font-semibold" : "text-[#166534]"}`}>{r.counted ? (r.difference ? PKR(r.difference) : "✓") : ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#E5E7EB] font-semibold">
                    <td className="py-1">Year so far</td>
                    <td className="text-right tabular-nums">{PKR(data.opening)}</td>
                    <td className="text-right tabular-nums">{PKR(data.totalIn)}</td>
                    <td className="text-right tabular-nums">{PKR(data.totalOut)}</td>
                    <td className="text-right tabular-nums">{PKR(data.closing)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
