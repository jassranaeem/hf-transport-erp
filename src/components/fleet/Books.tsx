/**
 * Books · کتاب — the company's double-entry book, built by the system from every module
 * (server/books.ts). Trial balance for a year or any dates, each account's entries, and which
 * account each kind of truck-khata row goes to (editable; the books rebuild on save).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, RefreshCw, Loader2, X, CheckCircle2, AlertTriangle, Settings2, ExternalLink } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";

type Feedback = (type: "success" | "error", message: string) => void;
type Nav = (wb: string, sheet: string, focus?: { ledgerId?: number; partyId?: number; entryId?: number; date?: string }) => void;

const fmt = (n: number) => Math.round(Math.abs(n)).toLocaleString("en-US");
const drcr = (n: number) => (n === 0 ? "—" : `${fmt(n)} ${n > 0 ? "Dr" : "Cr"}`);
const dmy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

function fyOptions() {
  const now = new Date();
  const cur = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const list = [];
  for (let y = cur; y >= 2025; y--) list.push({ label: `FY ${y}-${String((y + 1) % 100).padStart(2, "0")} (Jul ${y} – Jun ${y + 1})`, from: `${y}-07-01`, to: `${y + 1}-06-30` });
  return list;
}

const TYPE_ORDER = ["Asset", "Liability", "Equity", "Income", "Expense"];
const TYPE_URDU: Record<string, string> = { Asset: "اثاثے", Liability: "واجبات", Equity: "سرمایہ", Income: "آمدن", Expense: "اخراجات" };

export default function Books({ showFeedback, onNavigate }: { showFeedback: Feedback; onNavigate?: Nav }) {
  const fys = useMemo(fyOptions, []);
  const [range, setRange] = useState({ from: fys[0].from, to: fys[0].to });
  const [status, setStatus] = useState<any>(null);
  const [tb, setTb] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [lines, setLines] = useState<{ code: string; name: string; list: any[] | null } | null>(null);
  const [showRules, setShowRules] = useState(false);

  const loadStatus = useCallback(() => enterpriseFetch("/api/books/status").then(setStatus).catch(() => {}), []);
  const loadTb = useCallback(() => {
    setLoading(true);
    enterpriseFetch(`/api/books/trial-balance?from=${range.from}&to=${range.to}`)
      .then((r) => {
        setTb(r);
        loadStatus();
      })
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [range.from, range.to, showFeedback, loadStatus]);
  useEffect(loadTb, [loadTb]);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      const r = await enterpriseFetch("/api/books/rebuild", { method: "POST" });
      showFeedback("success", `Books rebuilt in ${(r.ms / 1000).toFixed(1)} s — debit ${fmt(r.totalDebit)} = credit ${fmt(r.totalCredit)} · کتاب دوبارہ بن گئی`);
      loadTb();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setRebuilding(false);
    }
  };

  const openLines = (a: any) => {
    setLines({ code: a.code, name: a.name, list: null });
    enterpriseFetch(`/api/books/lines?code=${a.code}&from=${range.from}&to=${range.to}`)
      .then((list) => setLines({ code: a.code, name: a.name, list }))
      .catch((e) => {
        showFeedback("error", e.message);
        setLines(null);
      });
  };

  const accounts: any[] = tb?.accounts || [];
  const review = new Set<string>(tb?.reviewCodes || []);
  const balanced = tb && tb.totals.debit === tb.totals.credit && tb.totals.closing === 0;
  const pnl = accounts.filter((a) => a.type === "Income" || a.type === "Expense");
  const income = -pnl.filter((a) => a.type === "Income").reduce((s, a) => s + a.debit - a.credit, 0);
  const expense = pnl.filter((a) => a.type === "Expense").reduce((s, a) => s + a.debit - a.credit, 0);

  return (
    <div className="p-3 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-0 basis-64">
          <h2 className="text-[19px] font-semibold text-[#111827] flex items-center gap-2 leading-tight">
            <BookOpenCheck className="w-5 h-5 text-[#24539B]" /> Books <span className="text-[#9CA3AF] font-normal text-sm">· کتاب (double-entry)</span>
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">
            The company's one book, made by the system from the cash book, truck and party ledgers, Partner P&amp;L, household, zakat, invoices and bills — every rupee once. ·
            ایک کتاب جو سسٹم خود ہر ماڈیول سے بناتا ہے — ہر روپیہ ایک دفعہ۔
          </p>
        </div>
        <button onClick={rebuild} disabled={rebuilding} className="inline-flex items-center gap-1.5 text-xs border border-[#D1D5DB] rounded-lg px-3 py-1.5 hover:bg-[#F9FAFB] disabled:opacity-60">
          {rebuilding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Rebuild now · ابھی بنائیں
        </button>
      </div>

      {status && (
        <div className="rounded-xl border border-[#E3E8EF] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] px-3 py-2 text-[12px] text-[#374151] flex flex-wrap gap-x-5 gap-y-1">
          <span>Books start · کتاب کا آغاز: <b>{status.booksStart ? dmy(status.booksStart) : "—"}</b> (with opening balances)</span>
          <span>Last built · آخری بار: <b>{status.lastRebuildAt ? new Date(status.lastRebuildAt).toLocaleString("en-GB") : "never"}</b></span>
          <span>Entries · انٹریاں: <b>{(status.autoEntries || 0).toLocaleString()}</b></span>
          <span className={status.stale ? "text-[#92400E]" : "text-[#166534]"}>{status.stale ? "Something changed — rebuilds by itself within 10 min, or press Rebuild" : "Up to date ✓"}</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 text-xs">
        <select id="books-fy" value={`${range.from}|${range.to}`} onChange={(e) => { const [from, to] = e.target.value.split("|"); setRange({ from, to }); }} className="border rounded-lg px-2 py-1.5">
          {fys.map((f) => <option key={f.from} value={`${f.from}|${f.to}`}>{f.label}</option>)}
          {!fys.some((f) => f.from === range.from && f.to === range.to) && <option value={`${range.from}|${range.to}`}>{dmy(range.from)} – {dmy(range.to)}</option>}
        </select>
        <label className="flex items-center gap-1">From <input id="books-from" type="date" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} className="border rounded px-1.5 py-1" /></label>
        <label className="flex items-center gap-1">To <input id="books-to" type="date" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} className="border rounded px-1.5 py-1" /></label>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-[#6B7280]" />}
      </div>

      {tb && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card label="Income · آمدن" value={fmt(income)} />
            <Card label="Expenses · اخراجات" value={fmt(expense)} />
            <Card label={income - expense >= 0 ? "Profit · منافع" : "Loss · نقصان"} value={fmt(income - expense)} tone={income - expense >= 0 ? "good" : "bad"} />
          </div>

          <div className={`rounded-xl border px-3 py-2 text-xs flex items-center gap-2 ${balanced ? "border-[#A7F3D0] bg-[#F0FDF4] text-[#166534]" : "border-[#FCA5A5] bg-[#FEF2F2] text-[#991B1B]"}`}>
            {balanced ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {balanced ? `Balanced: debit ${fmt(tb.totals.debit)} = credit ${fmt(tb.totals.credit)} · ڈیبٹ کریڈٹ برابر` : `NOT balanced: debit ${fmt(tb.totals.debit)} · credit ${fmt(tb.totals.credit)} — see Books Check`}
          </div>

          <div className="rounded-xl border border-[#E3E8EF] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="text-[#6B7280] bg-[#F9FAFB]">
                <tr>
                  <th className="text-left px-3 py-2">Account · کھاتہ</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap">Before {dmy(range.from)}</th>
                  <th className="text-right px-2 py-2">Debit</th>
                  <th className="text-right px-2 py-2">Credit</th>
                  <th className="text-right px-3 py-2 whitespace-nowrap">On {dmy(range.to)}</th>
                </tr>
              </thead>
              {TYPE_ORDER.map((t) => {
                const list = accounts.filter((a) => a.type === t);
                if (!list.length) return null;
                return (
                  <tbody key={t}>
                    <tr className="bg-[#F2F5FA]"><td colSpan={5} className="px-3 py-1 font-semibold text-[#1E3A6E]">{t} · {TYPE_URDU[t]}</td></tr>
                    {list.map((a) => (
                      <tr key={a.code} onClick={() => openLines(a)} className={`border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F9FAFB] ${review.has(a.code) && a.closing !== 0 ? "bg-[#FFFBEB]" : ""}`}>
                        <td className="px-3 py-1.5">
                          <span className="tabular-nums text-[#6B7280] mr-2">{a.code}</span>
                          {a.name}
                          {review.has(a.code) && a.closing !== 0 && <span className="ml-2 text-[10px] font-semibold text-[#92400E]">review · جانچ</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#6B7280] whitespace-nowrap">{drcr(a.opening)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{a.debit ? fmt(a.debit) : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{a.credit ? fmt(a.credit) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap">{drcr(a.closing)}</td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
              <tfoot>
                <tr className="border-t-2 border-[#E5E7EB] font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td />
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(tb.totals.debit)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(tb.totals.credit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{drcr(tb.totals.closing)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-[11px] text-[#6B7280]" dir="auto">
            Yellow “review” accounts hold money the system could not place for sure (no category, no payment method, not linked…). Click one to see its entries; fix them in their
            ledger, or set the account in “Which account” below. · پیلے “جانچ” کھاتوں میں وہ رقم ہے جس کی جگہ یقینی نہیں — کلک کر کے دیکھیں۔
          </p>
        </>
      )}

      <div className="rounded-xl border border-[#E3E8EF] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <button onClick={() => setShowRules((v) => !v)} className="w-full text-left px-3 py-2 text-xs font-semibold flex items-center gap-1.5">
          <Settings2 className="w-3.5 h-3.5" /> Which account · کون سا کھاتہ — where each kind of truck-khata row goes
        </button>
        {showRules && <Rules showFeedback={showFeedback} onSaved={loadTb} />}
      </div>

      {lines && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setLines(null)}>
          <div className="w-full max-w-3xl h-full bg-white shadow-xl overflow-y-auto p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="font-bold text-sm flex-1">{lines.code} · {lines.name} <span className="font-normal text-[#6B7280]">— {dmy(range.from)} to {dmy(range.to)}</span></div>
              <button onClick={() => setLines(null)} className="p-1 rounded hover:bg-[#F3F4F6]" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            {!lines.list ? (
              <div className="text-sm text-[#6B7280] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : lines.list.length === 0 ? (
              <div className="text-sm text-[#6B7280]">No entries in these dates.</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead className="text-[#6B7280]"><tr><th className="text-left py-1">Date</th><th className="text-left">Detail</th><th className="text-left">Truck / party</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th /></tr></thead>
                <tbody>
                  {lines.list.map((l, i) => {
                    const [kind, id] = String(l.source_key || "").split(":");
                    const link =
                      kind === "tle" && l.truck_ledger_id ? () => onNavigate?.("khata", "truck_ledgers", { ledgerId: l.truck_ledger_id, entryId: Number(id) }) :
                      (kind === "ple" || kind === "pship") && l.party ? null :
                      kind === "ct" ? () => onNavigate?.("finance", "cash_book", { date: String(l.entry_date).slice(0, 10) }) : null;
                    return (
                      <tr key={i} className="border-t border-[#F3F4F6]">
                        <td className="py-1 pr-2 whitespace-nowrap">{new Date(l.entry_date).toLocaleDateString("en-GB")}</td>
                        <td className="pr-2" dir="auto">{l.description}</td>
                        <td className="pr-2 whitespace-nowrap" dir="auto">{l.vehicle_number || l.party || l.customer || ""}</td>
                        <td className="text-right tabular-nums">{l.debit ? fmt(l.debit) : ""}</td>
                        <td className="text-right tabular-nums">{l.credit ? fmt(l.credit) : ""}</td>
                        <td className="pl-2 text-right">{link && <button onClick={link} className="text-[#24539B]" title="Open the entry"><ExternalLink className="w-3 h-3" /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {lines.list && lines.list.length >= 1000 && <div className="text-[11px] text-[#6B7280]">Showing the latest 1,000 — pick shorter dates for the rest.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === "good" ? "border-[#A7F3D0] bg-[#F0FDF4]" : tone === "bad" ? "border-[#FCA5A5] bg-[#FEF2F2]" : "border-[#E5E7EB] bg-white"}`}>
      <div className="text-[11px] font-semibold text-[#4B5563]">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${tone === "good" ? "text-[#166534]" : tone === "bad" ? "text-[#991B1B]" : ""}`}>PKR {value}</div>
    </div>
  );
}

/** Truck-khata category → account, for money in and money out. */
function Rules({ showFeedback, onSaved }: { showFeedback: Feedback; onSaved: () => void }) {
  const [data, setData] = useState<any>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    enterpriseFetch("/api/books/rules").then(setData).catch((e) => showFeedback("error", e.message));
  }, [showFeedback]);
  if (!data) return <div className="px-3 pb-3 text-xs text-[#6B7280] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>;

  const ruleFor = (cat: string, side: "in" | "out") =>
    data.rules.find((r: any) => r.source === "truck" && r.category === cat && r.side === side) || data.rules.find((r: any) => r.source === "truck" && r.category === cat && r.side === "any");
  const current = (cat: string, side: "in" | "out") => edits[`${cat}|${side}`] ?? ruleFor(cat, side)?.account_code ?? (side === "in" ? "4098" : "5098");
  const changed = Object.keys(edits).length;

  const save = async () => {
    setSaving(true);
    try {
      const body = Object.entries(edits).map(([k, accountCode]) => {
        const [category, side] = k.split("|");
        return { source: "truck", category, side, accountCode };
      });
      const r = await enterpriseFetch("/api/books/rules", { method: "PUT", body: JSON.stringify(body) });
      showFeedback("success", `Saved — books rebuilt (${(r.ms / 1000).toFixed(1)} s) · محفوظ`);
      setEdits({});
      setData(await enterpriseFetch("/api/books/rules"));
      onSaved();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const Pick = ({ cat, side }: { cat: string; side: "in" | "out" }) => (
    <select id={`rule-${cat}-${side}`} value={current(cat, side)} onChange={(e) => setEdits({ ...edits, [`${cat}|${side}`]: e.target.value })} className={`border rounded px-1.5 py-1 max-w-[260px] ${data.reviewCodes.includes(current(cat, side)) ? "bg-[#FFFBEB]" : ""}`}>
      {data.accounts.map((a: any) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
    </select>
  );

  return (
    <div className="px-3 pb-3 space-y-2 text-xs">
      <p className="text-[#6B7280]" dir="auto">
        Each truck-khata row goes to an account by its category. Change one and save — the whole book is rebuilt with it. · ہر قسم کس کھاتے میں جائے — بدلیں اور محفوظ کریں۔
      </p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="text-[#6B7280]"><tr><th className="text-left py-1">Category · قسم</th><th className="text-right pr-3">Rows</th><th className="text-left">Money in · وصول</th><th className="text-left">Money out · ادائیگی</th></tr></thead>
          <tbody>
            {data.truckCategories.filter((c: any) => c.category !== "SafiBachat").map((c: any) => (
              <tr key={c.category} className="border-t border-[#F3F4F6]">
                <td className="py-1 font-semibold">{c.category}</td>
                <td className="text-right pr-3 tabular-nums text-[#6B7280]">{c.n.toLocaleString()}</td>
                <td className="py-1"><Pick cat={c.category} side="in" /></td>
                <td className="py-1"><Pick cat={c.category} side="out" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-[#6B7280]">SafiBachat (صافی بچت) rows are not posted — the partner's share is posted from Partner P&amp;L.</div>
      <button onClick={save} disabled={!changed || saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#24539B] text-white px-3 py-1.5 font-semibold disabled:opacity-50">
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save {changed ? `(${changed})` : ""} and rebuild
      </button>
    </div>
  );
}
