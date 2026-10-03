/**
 * Statements · حسابات — Profit & Loss (by account, by truck, by month), Balance Sheet, Cash Flow
 * and partners' accounts, from the books, for a year or any dates; print for the accountant;
 * close the books through a date.
 */
import React, { useEffect, useMemo, useState } from "react";
import { FileBarChart, Loader2, Printer, Lock, Unlock, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";

type Feedback = (type: "success" | "error", message: string) => void;
const fmt = (v: number) => (v < 0 ? `(${Math.abs(Math.round(v)).toLocaleString("en-US")})` : Math.round(v).toLocaleString("en-US"));
const dmy = (d: string) => (d ? d.split("-").reverse().join(".") : "");
const TABS = [
  { k: "pnl", l: "Profit & Loss · نفع نقصان" },
  { k: "trucks", l: "Each truck · ہر ٹرک" },
  { k: "months", l: "By month · مہینہ وار" },
  { k: "bs", l: "Balance Sheet · بیلنس شیٹ" },
  { k: "cf", l: "Cash Flow · نقد کی آمد و رفت" },
  { k: "partners", l: "Partners · شریک" },
] as const;

function fys() {
  const now = new Date();
  const cur = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const out = [];
  for (let y = cur; y >= 2025; y--) out.push({ label: `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`, from: `${y}-07-01`, to: `${y + 1}-06-30` });
  return out;
}

export default function Statements({ showFeedback }: { showFeedback: Feedback }) {
  const years = useMemo(fys, []);
  const [tab, setTab] = useState<(typeof TABS)[number]["k"]>("pnl");
  const [range, setRange] = useState({ from: years[0].from, to: years[0].to });
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  // the figures together with the request they answer — a tab never draws another tab's figures
  const [loaded, setLoaded] = useState<{ url: string; body: any } | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [lockDate, setLockDate] = useState("");
  const [openTruck, setOpenTruck] = useState<string | null>(null);

  const url =
    tab === "pnl" ? `/api/statements/pnl?from=${range.from}&to=${range.to}` :
    tab === "trucks" ? `/api/statements/pnl-trucks?from=${range.from}&to=${range.to}` :
    tab === "months" ? `/api/statements/pnl-months?from=${range.from}&to=${range.to}` :
    tab === "bs" ? `/api/statements/balance-sheet?asOf=${asOf}` :
    tab === "cf" ? `/api/statements/cash-flow?from=${range.from}&to=${range.to}` :
    `/api/statements/partners?from=${range.from}&to=${range.to}`;

  useEffect(() => {
    let live = true;
    setLoading(true);
    enterpriseFetch(url)
      .then((body) => live && setLoaded({ url, body }))
      .catch((e) => live && showFeedback("error", e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false; // a slower answer for a tab left behind is dropped
    };
  }, [url, showFeedback]);
  const data = loaded?.url === url ? loaded.body : null;
  const loadStatus = () => enterpriseFetch("/api/books/status").then((s) => { setStatus(s); setLockDate(s.lockedThrough || ""); }).catch(() => {});
  useEffect(() => { loadStatus(); }, []);

  const setLock = async (d: string | null) => {
    if (d && !window.confirm(`Close the books through ${dmy(d)}? Entries up to that day will no longer change; any later change to them shows red in Books Check. · کتاب ${dmy(d)} تک بند کریں؟`)) return;
    if (!d && !window.confirm("Open the closed months again? The books will be rebuilt from the ledgers as they are now. · بند مہینے دوبارہ کھولیں؟")) return;
    try {
      await enterpriseFetch("/api/books/lock", { method: "PUT", body: JSON.stringify({ lockedThrough: d }) });
      showFeedback("success", d ? `Books closed through ${dmy(d)} · بند` : "Books opened · کھل گئی");
      loadStatus();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  return (
    <div className="p-3 space-y-4 statements-page">
      <style>{`@media print { .no-print { display: none !important; } .statements-page { padding: 0 !important; } }`}</style>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-0 basis-64">
          <h2 className="text-base font-bold flex items-center gap-2"><FileBarChart className="w-4 h-4" /> Statements <span className="text-[#9CA3AF] font-normal text-sm">· حسابات</span></h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">The year's accounts from the books — for the owners, the bank and the chartered accountant. · سال کے حسابات، کتاب سے۔</p>
        </div>
        <button onClick={() => window.print()} className="no-print inline-flex items-center gap-1.5 text-xs border border-[#D1D5DB] rounded-lg px-3 py-1.5"><Printer className="w-3.5 h-3.5" /> Print · پرنٹ</button>
      </div>

      <div className="no-print flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`text-xs rounded-full px-3 py-1.5 ${tab === t.k ? "bg-[#24539B] text-white" : "bg-[#F3F4F6] text-[#374151]"}`}>{t.l}</button>
        ))}
      </div>

      <div className="no-print flex flex-wrap items-end gap-2 text-xs">
        {tab === "bs" ? (
          <label className="flex items-center gap-1">As on · تاریخ تک <input id="st-asof" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="border rounded px-1.5 py-1" /></label>
        ) : (
          <>
            <select id="st-fy" value={`${range.from}|${range.to}`} onChange={(e) => { const [from, to] = e.target.value.split("|"); setRange({ from, to }); }} className="border rounded-lg px-2 py-1.5">
              {years.map((y) => <option key={y.from} value={`${y.from}|${y.to}`}>{y.label}</option>)}
              {!years.some((y) => y.from === range.from && y.to === range.to) && <option value={`${range.from}|${range.to}`}>{dmy(range.from)} – {dmy(range.to)}</option>}
            </select>
            <label className="flex items-center gap-1">From <input id="st-from" type="date" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} className="border rounded px-1.5 py-1" /></label>
            <label className="flex items-center gap-1">To <input id="st-to" type="date" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} className="border rounded px-1.5 py-1" /></label>
          </>
        )}
        {loading && <Loader2 className="w-4 h-4 animate-spin text-[#6B7280]" />}
      </div>

      <div className="text-[12px] font-semibold text-[#1E3A6E]">
        HFK Enterprises (Pvt) Ltd — {TABS.find((t) => t.k === tab)!.l.split(" · ")[0]} — {tab === "bs" ? `as on ${dmy(asOf)}` : `${dmy(range.from)} to ${dmy(range.to)}`}
      </div>

      {data && tab === "pnl" && (
        <Sheet>
          <Head title="Income · آمدن" />
          {data.income.map((r: any) => <Row key={r.code} code={r.code} name={r.name} amount={r.amount} />)}
          <Total label="Total income" amount={data.totalIncome} />
          <Head title="Expenses · اخراجات" />
          {data.expenses.map((r: any) => <Row key={r.code} code={r.code} name={r.name} amount={r.amount} />)}
          <Total label="Total expenses" amount={data.totalExpenses} />
          <Total label={data.profit >= 0 ? "Profit · منافع" : "Loss · نقصان"} amount={data.profit} strong tone={data.profit >= 0 ? "good" : "bad"} />
        </Sheet>
      )}

      {data && tab === "trucks" && (
        <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[#6B7280] bg-[#F9FAFB]"><tr><th className="text-left px-3 py-2">Truck · ٹرک</th><th className="text-right px-2">Income</th><th className="text-right px-2">Expenses</th><th className="text-right px-3">Profit · منافع</th></tr></thead>
            <tbody>
              {data.trucks.map((t: any) => (
                <React.Fragment key={t.truck || "office"}>
                  <tr onClick={() => setOpenTruck(openTruck === t.truck ? null : t.truck)} className="border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F9FAFB]">
                    <td className="px-3 py-1.5 font-semibold flex items-center gap-1">{openTruck === t.truck ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}{t.label}</td>
                    <td className="px-2 text-right tabular-nums">{fmt(t.income)}</td>
                    <td className="px-2 text-right tabular-nums">{fmt(t.expenses)}</td>
                    <td className={`px-3 text-right tabular-nums font-semibold ${t.profit < 0 ? "text-[#B91C1C]" : "text-[#166534]"}`}>{fmt(t.profit)}</td>
                  </tr>
                  {openTruck === t.truck && t.lines.map((l: any) => (
                    <tr key={l.code} className="bg-[#FAFAFA]"><td className="pl-8 pr-2 py-1 text-[#4B5563]">{l.code} · {l.name}</td><td className="px-2 text-right tabular-nums">{l.type === "Income" ? fmt(l.amount) : ""}</td><td className="px-2 text-right tabular-nums">{l.type === "Expense" ? fmt(l.amount) : ""}</td><td /></tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-[#E5E7EB] font-semibold"><td className="px-3 py-2">All</td><td className="px-2 text-right tabular-nums">{fmt(data.totalIncome)}</td><td className="px-2 text-right tabular-nums">{fmt(data.totalExpenses)}</td><td className="px-3 text-right tabular-nums">{fmt(data.totalIncome - data.totalExpenses)}</td></tr></tfoot>
          </table>
        </div>
      )}

      {data && tab === "months" && (
        <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-x-auto">
          <table className="text-xs min-w-full">
            <thead className="text-[#6B7280] bg-[#F9FAFB]"><tr><th className="text-left px-3 py-2 sticky left-0 bg-[#F9FAFB]">Account</th>{data.months.map((m: string) => <th key={m} className="text-right px-2 whitespace-nowrap">{new Date(`${m}-01T00:00:00`).toLocaleString("en-GB", { month: "short", year: "2-digit" })}</th>)}<th className="text-right px-3">Total</th></tr></thead>
            <tbody>
              {data.accounts.map((a: any) => (
                <tr key={a.code} className="border-t border-[#F3F4F6]">
                  <td className="px-3 py-1 whitespace-nowrap sticky left-0 bg-white">{a.code} · {a.name} <span className="text-[#9CA3AF]">{a.type === "Income" ? "in" : "out"}</span></td>
                  {data.months.map((m: string) => <td key={m} className="px-2 text-right tabular-nums">{a.byMonth[m] ? fmt(a.byMonth[m]) : ""}</td>)}
                  <td className="px-3 text-right tabular-nums font-semibold">{fmt(a.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-[#E5E7EB] font-semibold"><td className="px-3 py-2 sticky left-0 bg-white">Profit · منافع</td>{data.months.map((m: string) => <td key={m} className={`px-2 text-right tabular-nums ${data.profitByMonth[m] < 0 ? "text-[#B91C1C]" : ""}`}>{fmt(data.profitByMonth[m] || 0)}</td>)}<td className="px-3 text-right tabular-nums">{fmt(Object.values(data.profitByMonth as Record<string, number>).reduce((s, v) => s + v, 0))}</td></tr></tfoot>
          </table>
        </div>
      )}

      {data && tab === "bs" && (
        <>
          <Balanced ok={data.difference === 0} text={data.difference === 0 ? "Balanced: assets = liabilities + equity · برابر" : `Not balanced by ${fmt(data.difference)} — see Books Check`} />
          <Sheet>
            <Head title="Assets · اثاثے" />
            {data.assets.map((r: any) => <Row key={r.code} code={r.code} name={r.name} amount={r.amount} />)}
            <Total label="Total assets" amount={data.totalAssets} strong />
            <Head title="Liabilities · واجبات" />
            {data.liabilities.map((r: any) => <Row key={r.code} code={r.code} name={r.name} amount={r.amount} />)}
            <Total label="Total liabilities" amount={data.totalLiabilities} />
            <Head title="Equity · سرمایہ" />
            {data.equity.map((r: any) => <Row key={r.code} code={r.code} name={r.name} amount={r.amount} />)}
            <Row code="" name={`Profit of earlier years (before ${dmy(data.fyStart)})`} amount={data.retainedEarlier} />
            <Row code="" name="Profit this year · اس سال کا منافع" amount={data.profitThisYear} />
            <Total label="Total equity" amount={data.totalEquity} />
            <Total label="Liabilities + equity" amount={data.totalLiabilities + data.totalEquity} strong />
          </Sheet>
        </>
      )}

      {data && tab === "cf" && (
        <>
          <Balanced ok={data.difference === 0} text={data.difference === 0 ? "Opening + movement = closing cash & bank ✓" : `Does not add up by ${fmt(data.difference)}`} />
          <Sheet>
            <Row code="" name={`Cash & bank on ${dmy(data.from)} · ابتدائی نقد اور بینک`} amount={data.opening} />
            {data.sections.map((s: any) => (
              <React.Fragment key={s.section}>
                <Head title={s.section} />
                {s.lines.map((l: any) => <Row key={l.code} code={l.code} name={l.name} amount={l.amount} />)}
                <Total label={`Net from ${s.section.split(" · ")[0].toLowerCase()}`} amount={s.total} />
              </React.Fragment>
            ))}
            <Total label={`Cash & bank on ${dmy(data.to)} · آخری نقد اور بینک`} amount={data.closing} strong />
          </Sheet>
          <p className="text-[11px] text-[#6B7280]">Money in is positive, money out in brackets. Cash & bank = cash on hand and every bank account in the books.</p>
        </>
      )}

      {data && tab === "partners" && (
        <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[#6B7280] bg-[#F9FAFB]"><tr><th className="text-left px-3 py-2">Partner · شریک</th><th className="text-right px-2">On {dmy(data.from)}</th><th className="text-right px-2">Share & added · جمع</th><th className="text-right px-2">Taken · لیا</th><th className="text-right px-3">On {dmy(data.to)} (with us)</th></tr></thead>
            <tbody>
              {data.partners.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-[#6B7280]">No partner entries in the books for these dates.</td></tr>}
              {data.partners.map((p: any) => (
                <tr key={p.id} className="border-t border-[#F3F4F6]"><td className="px-3 py-1.5 font-semibold" dir="auto">{p.name}</td><td className="px-2 text-right tabular-nums">{fmt(p.opening)}</td><td className="px-2 text-right tabular-nums">{fmt(p.added)}</td><td className="px-2 text-right tabular-nums">{fmt(p.taken)}</td><td className="px-3 text-right tabular-nums font-semibold">{fmt(p.closing)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="no-print rounded-xl border border-[#E5E7EB] bg-white p-3 text-xs space-y-2">
        <div className="font-semibold flex items-center gap-1.5">{status?.lockedThrough ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />} Close the books · کتاب بند کرنا</div>
        <p className="text-[#6B7280]" dir="auto">
          When a month's accounts are final (counted, banks matched, accountant happy), close the books through its last day. Those entries then stop changing; if anyone later edits a ledger entry of a closed month, Books Check shows it red. ·
          جب مہینے کا حساب پکا ہو جائے تو کتاب اس دن تک بند کریں۔
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span>Closed through · بند: <b>{status?.lockedThrough ? dmy(status.lockedThrough) : "not closed · کھلی"}</b></span>
          <input id="lock-date" type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)} className="border rounded px-1.5 py-1" />
          <button disabled={!lockDate} onClick={() => setLock(lockDate)} className="inline-flex items-center gap-1 rounded-lg bg-[#24539B] text-white px-3 py-1 font-semibold disabled:opacity-50"><Lock className="w-3 h-3" /> Close through this day</button>
          {status?.lockedThrough && <button onClick={() => setLock(null)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1"><Unlock className="w-3 h-3" /> Open again</button>}
        </div>
      </div>
    </div>
  );
}

function Sheet({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden"><table className="w-full text-xs"><tbody>{children}</tbody></table></div>;
}
function Head({ title }: { title: string }) {
  return <tr className="bg-[#F2F5FA]"><td colSpan={2} className="px-3 py-1.5 font-semibold text-[#1E3A6E]">{title}</td></tr>;
}
function Row({ code, name, amount }: { code: string; name: string; amount: number; key?: React.Key }) {
  return (
    <tr className="border-t border-[#F3F4F6]">
      <td className="px-3 py-1.5"><span className="tabular-nums text-[#9CA3AF] mr-2">{code}</span>{name}</td>
      <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{fmt(amount)}</td>
    </tr>
  );
}
function Total({ label, amount, strong, tone }: { label: string; amount: number; strong?: boolean; tone?: "good" | "bad" }) {
  return (
    <tr className={`border-t ${strong ? "border-t-2 border-[#9CA3AF]" : "border-[#E5E7EB]"}`}>
      <td className={`px-3 py-1.5 ${strong ? "font-bold" : "font-semibold"}`}>{label}</td>
      <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${strong ? "font-bold" : "font-semibold"} ${tone === "good" ? "text-[#166534]" : tone === "bad" ? "text-[#B91C1C]" : ""}`}>{fmt(amount)}</td>
    </tr>
  );
}
function Balanced({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs flex items-center gap-2 ${ok ? "border-[#A7F3D0] bg-[#F0FDF4] text-[#166534]" : "border-[#FCA5A5] bg-[#FEF2F2] text-[#991B1B]"}`}>
      {ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {text}
    </div>
  );
}
