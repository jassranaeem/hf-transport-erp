/**
 * Personal & Household Expenses — the owner's personal book.
 * Household kharcha, pocket money, personal spend, utilities, rent, medical …
 * Deliberately kept OUT of the business (truck) profit & loss.
 *
 * One register + a one-click monthly roll-up (by category, by person, by method),
 * with full add / edit / delete.
 *
 *   /api/personal-expenses            list + create
 *   /api/personal-expenses/:id        edit / delete
 *   /api/personal-expenses/summary    monthly roll-up
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import {
  Wallet, RefreshCw, Loader2, Plus, Pencil, Trash2, CheckCircle, TrendingDown, Users, X,
  History, ChevronDown, ChevronRight,
} from "lucide-react";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

const PKR = (n: number) => "PKR " + Math.round(Math.abs(n || 0)).toLocaleString();
const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);

const CAT_UR: Record<string, string> = {
  Household: "گھر کا خرچہ",
  PocketMoney: "جیب خرچ",
  Personal: "ذاتی",
  Groceries: "راشن",
  Utilities: "بجلی/گیس/پانی",
  Rent: "کرایہ",
  Medical: "علاج",
  Education: "تعلیم",
  Travel: "سفر",
  Gift: "تحفہ",
  Charity: "خیرات",
  "Domestic Staff": "ملازمین",
  "Vehicle (personal)": "ذاتی گاڑی",
  Entertainment: "تفریح",
  "Funds In": "رقم جمع",
  Other: "دیگر",
};

const BLANK = {
  entryDate: today(),
  category: "Household",
  direction: "expense",
  person: "",
  description: "",
  payee: "",
  amount: "",
  method: "Cash",
  refNo: "",
  paidBy: "",
  notes: "",
};

export default function PersonalExpenses({
  showFeedback,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [mode, setMode] = useState<"month" | "range" | "all">("month");
  const [month, setMonth] = useState(thisMonth());
  const [from, setFrom] = useState(`${thisMonth()}-01`);
  const [to, setTo] = useState(today());
  const [summary, setSummary] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterPerson, setFilterPerson] = useState<string | null>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [showTrend, setShowTrend] = useState(true);
  const [meta, setMeta] = useState<any>({ categories: [], methods: ["Cash"], people: [] });
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<any>(BLANK);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const monthStart = `${month}-01`;
  const monthEnd = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m, 0); // last day of month
    return d.toISOString().slice(0, 10);
  }, [month]);

  // effective window for the list + breakdowns
  const win = useMemo(() => {
    if (mode === "month") return { from: monthStart, to: monthEnd, label: month };
    if (mode === "range") return { from, to, label: `${from} → ${to}` };
    return { from: "", to: "", label: "All history · پوری ہسٹری" };
  }, [mode, monthStart, monthEnd, month, from, to]);

  // client-side roll-up (used for range / all — the /summary endpoint is month-only)
  const localSummary = useMemo(() => {
    if (mode === "month") return null;
    const exp = rows.filter((r) => r.direction === "expense");
    const inc = rows.filter((r) => r.direction === "income");
    const sum = (a: any[]) => a.reduce((s, r) => s + (r.amount || 0), 0);
    const group = (a: any[], key: string) => {
      const m = new Map<string, { spend: number; count: number }>();
      for (const r of a) {
        const k = r[key] || (key === "person" ? "" : "Other");
        if (key === "person" && !k) continue;
        const g = m.get(k) || { spend: 0, count: 0 };
        g.spend += r.amount || 0; g.count += 1; m.set(k, g);
      }
      return [...m.entries()].map(([k, v]) => ({ [key]: k, spend: v.spend, net: v.spend, count: v.count }))
        .sort((x: any, y: any) => y.spend - x.spend);
    };
    return {
      totals: {
        expense: sum(exp), income: sum(inc), net: sum(exp) - sum(inc),
        pocketMoney: sum(exp.filter((r) => r.category === "PocketMoney")),
        entries: rows.length,
      },
      byCategory: group(exp, "category").map((g: any) => ({ ...g, income: 0 })),
      byPerson: group(exp, "person"),
      byMethod: group(exp, "method"),
      note: "Personal book — this is NOT part of any truck / business profit & loss. · یہ ذاتی کھاتہ ہے، کاروباری منافع و نقصان سے الگ۔",
    };
  }, [mode, rows]);

  const load = useCallback(() => {
    setLoading(true);
    setFilterCategory(null);
    setFilterPerson(null);
    const p = new URLSearchParams({ limit: "1000" });
    if (win.from) p.set("from", win.from);
    if (win.to) p.set("to", win.to);
    const from12 = (() => { const d = new Date(); d.setMonth(d.getMonth() - 11); return d.toISOString().slice(0, 7); })();
    Promise.all([
      mode === "month"
        ? enterpriseFetch(`/api/personal-expenses/summary?month=${month}`).then(setSummary)
        : Promise.resolve(setSummary(null)),
      enterpriseFetch(`/api/personal-expenses?${p.toString()}`).then((r) => setRows(r.rows || [])),
      enterpriseFetch(`/api/personal-expenses/meta`).then(setMeta).catch(() => {}),
      enterpriseFetch(`/api/personal-expenses/summary/range?from=${from12}&to=${thisMonth()}`)
        .then((r) => setTrend(r.months || []))
        .catch(() => {}),
    ])
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [mode, month, win.from, win.to, showFeedback]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!Number(form.amount)) { showFeedback("error", "Amount daalein · رقم درج کریں"); return; }
    setSaving(true);
    try {
      await enterpriseFetch("/api/personal-expenses", { method: "POST", body: JSON.stringify(form) });
      showFeedback("success", "Saved · محفوظ ہو گیا");
      setForm({ ...BLANK, entryDate: form.entryDate, category: form.category, person: form.person, method: form.method });
      setShowAdd(false);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (r: any) => {
    setEditId(r.id);
    setEditForm({
      entryDate: r.entryDate ? r.entryDate.slice(0, 10) : today(),
      category: r.category,
      direction: r.direction,
      person: r.person || "",
      description: r.description || "",
      payee: r.payee || "",
      amount: r.amount || "",
      method: r.method || "Cash",
      refNo: r.refNo || "",
      paidBy: r.paidBy || "",
      notes: r.notes || "",
    });
  };
  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    try {
      await enterpriseFetch(`/api/personal-expenses/${editId}`, { method: "PUT", body: JSON.stringify(editForm) });
      showFeedback("success", "Updated · درست ہو گیا");
      setEditId(null);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };
  const del = async (id: number) => {
    if (!window.confirm("Delete this entry? · یہ اندراج حذف کریں؟")) return;
    try {
      await enterpriseFetch(`/api/personal-expenses/${id}`, { method: "DELETE" });
      showFeedback("success", "Deleted · حذف ہو گیا");
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const view = summary || localSummary; // month-mode server summary, else client roll-up
  const t = view?.totals;
  const displayRows = rows.filter(
    (r) => (!filterCategory || r.category === filterCategory) && (!filterPerson || r.person === filterPerson),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <Wallet className="w-4 h-4" /> Personal &amp; Household <span className="text-[#9CA3AF] font-normal text-sm">· ذاتی و گھریلو اخراجات</span>
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">
            Household kharcha, pocket money, personal spend — kept separate from the business P&amp;L. · کاروبار سے الگ ذاتی کھاتہ۔
          </p>
        </div>
        <div className="flex-1" />
        {/* view switch */}
        <div className="flex rounded-lg border border-[#E5E7EB] overflow-hidden text-xs">
          {([["month", "This month · یہ مہینہ"], ["range", "Any dates · تاریخیں"], ["all", "All · سب"]] as [any, string][]).map(([m, lbl]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-2 ${mode === m ? "bg-[#16A34A] text-white font-semibold" : "bg-white text-[#374151] hover:bg-[#F3F4F6]"}`}
            >
              {lbl}
            </button>
          ))}
        </div>
        {mode === "month" && (
          <label className="flex flex-col text-[11px] text-[#6B7280]">
            Month · مہینہ
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-[#E5E7EB] rounded px-2 py-1 text-sm" />
          </label>
        )}
        {mode === "range" && (
          <>
            <label className="flex flex-col text-[11px] text-[#6B7280]">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-[#E5E7EB] rounded px-2 py-1 text-sm" /></label>
            <label className="flex flex-col text-[11px] text-[#6B7280]">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-[#E5E7EB] rounded px-2 py-1 text-sm" /></label>
          </>
        )}
        <button onClick={load} disabled={loading} className="h-9 px-3 rounded-lg border border-[#E5E7EB] bg-white text-sm flex items-center gap-1.5 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
        <ModuleDataIO entityKey="personal_expenses" label="Personal Expenses" onImported={load} />
        <button onClick={() => { setShowAdd((s) => !s); setEditId(null); }} className="h-9 px-4 rounded-lg bg-[#16A34A] text-white text-sm font-semibold flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add expense · نیا اندراج
        </button>
      </div>

      {/* add form */}
      {showAdd && (
        <EntryForm
          value={form}
          onChange={setForm}
          meta={meta}
          onSubmit={add}
          saving={saving}
          onCancel={() => setShowAdd(false)}
          submitLabel="Save · محفوظ کریں"
        />
      )}

      {/* month-by-month history */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <button onClick={() => setShowTrend((s) => !s)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold bg-[#F3F7F4]">
          <span className="flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Month-by-month history · مہینہ وار ہسٹری (last 12)</span>
          {showTrend ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        {showTrend && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F9FAFB] text-[#6B7280]">
                <tr>
                  <th className="text-left px-2 py-1.5">Month</th>
                  <th className="text-right px-2 py-1.5">Spend · خرچہ</th>
                  <th className="text-right px-2 py-1.5">Funds in · جمع</th>
                  <th className="text-right px-2 py-1.5">Net · صافی</th>
                  <th className="text-right px-2 py-1.5">Pocket money</th>
                  <th className="text-right px-2 py-1.5">Entries</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((mo: any) => (
                  <tr
                    key={mo.month}
                    onClick={() => { setMode("month"); setMonth(mo.month); }}
                    className={`border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F0FDF4] ${mode === "month" && month === mo.month ? "bg-[#ECFDF5]" : ""}`}
                    title="Open this month · یہ مہینہ کھولیں"
                  >
                    <td className="px-2 py-1.5 font-medium">{mo.month}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#B91C1C]">{PKR(mo.expense)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#15803D]">{mo.income ? PKR(mo.income) : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{PKR(mo.net)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">{mo.pocketMoney ? PKR(mo.pocketMoney) : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">{mo.entries}</td>
                  </tr>
                ))}
                {trend.length === 0 && (
                  <tr><td colSpan={6} className="px-2 py-4 text-center text-[#9CA3AF]">No history yet · ابھی کوئی ہسٹری نہیں</td></tr>
                )}
              </tbody>
              {trend.length > 0 && (
                <tfoot className="border-t-2 border-[#E5E7EB] bg-[#F9FAFB] font-bold">
                  <tr>
                    <td className="px-2 py-1.5">12-month total</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#B91C1C]">{PKR(trend.reduce((s: number, m: any) => s + (m.expense || 0), 0))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#15803D]">{PKR(trend.reduce((s: number, m: any) => s + (m.income || 0), 0))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{PKR(trend.reduce((s: number, m: any) => s + (m.net || 0), 0))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">{PKR(trend.reduce((s: number, m: any) => s + (m.pocketMoney || 0), 0))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">{trend.reduce((s: number, m: any) => s + (m.entries || 0), 0)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* summary cards */}
      {t && (
        <>
          <div className="text-[11px] text-[#6B7280] font-semibold" dir="auto">Showing: {win.label}</div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Big label="Total spend · کل خرچہ" value={PKR(t.expense)} tone="bad" big />
            <Big label="Funds in · رقم جمع" value={PKR(t.income)} tone="good" />
            <Big label="Net from pocket · جیب سے صافی" value={PKR(t.net)} tone="neutral" />
            <Big label="Pocket money · جیب خرچ" value={PKR(t.pocketMoney)} tone="neutral" />
            <Big label="Entries · اندراجات" value={String(t.entries)} tone="neutral" />
          </div>
          <p className="text-[11px] text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3 py-2" dir="auto">
            {view.note}
          </p>
        </>
      )}

      {/* breakdowns */}
      {view && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
            <div className="px-3 py-2 text-xs font-bold bg-[#F3F7F4] flex items-center gap-1.5">
              <TrendingDown className="w-3.5 h-3.5" /> By category · کس مد میں <span className="text-[#9CA3AF] font-normal">(click a row for its entries)</span>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {view.byCategory.map((c: any) => (
                  <tr
                    key={c.category}
                    onClick={() => setFilterCategory((cur) => (cur === c.category ? null : c.category))}
                    className={`border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F0FDF4] ${filterCategory === c.category ? "bg-[#DCFCE7]" : ""}`}
                  >
                    <td className="px-2 py-1.5" dir="auto">{c.category}<span className="text-[#9CA3AF]"> · {CAT_UR[c.category] || ""}</span></td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">{c.count}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${c.net >= 0 ? "text-[#B91C1C]" : "text-[#15803D]"}`}>
                      {c.net >= 0 ? "" : "+"}{PKR(c.net)}
                    </td>
                  </tr>
                ))}
                {view.byCategory.length === 0 && (
                  <tr><td className="px-2 py-6 text-center text-[#9CA3AF]" colSpan={3}>No entries in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
            <div className="px-3 py-2 text-xs font-bold bg-[#F3F7F4] flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> By person · فرد کے حساب سے (pocket money etc.) <span className="text-[#9CA3AF] font-normal">(click a row for its entries)</span>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {view.byPerson.map((p: any) => (
                  <tr
                    key={p.person}
                    onClick={() => setFilterPerson((cur) => (cur === p.person ? null : p.person))}
                    className={`border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F0FDF4] ${filterPerson === p.person ? "bg-[#DCFCE7]" : ""}`}
                  >
                    <td className="px-2 py-1.5" dir="auto">{p.person}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">{p.count}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-[#B91C1C]">{PKR(p.spend)}</td>
                  </tr>
                ))}
                {view.byPerson.length === 0 && (
                  <tr><td className="px-2 py-6 text-center text-[#9CA3AF]" colSpan={3}>No per-person entries. Tag a "person" on pocket-money rows.</td></tr>
                )}
              </tbody>
              {view.byMethod?.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-[#E5E7EB] bg-[#F9FAFB]">
                    <td className="px-2 py-1 text-[10px] text-[#6B7280]" colSpan={3} dir="auto">
                      Paid by: {view.byMethod.map((m: any) => `${m.method} ${PKR(m.spend)}`).join(" · ")}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* entries for the month */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F3F7F4] flex items-center gap-2 flex-wrap" dir="auto">
          <span>Entries · {win.label} ({displayRows.length}{displayRows.length !== rows.length ? ` of ${rows.length}` : ""})</span>
          {filterCategory && (
            <button onClick={() => setFilterCategory(null)} className="text-[10px] bg-[#DCFCE7] text-[#166534] rounded-full px-2 py-0.5 font-semibold">
              {filterCategory} ✕
            </button>
          )}
          {filterPerson && (
            <button onClick={() => setFilterPerson(null)} className="text-[10px] bg-[#DCFCE7] text-[#166534] rounded-full px-2 py-0.5 font-semibold">
              {filterPerson} ✕
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F9FAFB] text-[#6B7280]">
              <tr>
                <th className="text-left px-2 py-1.5">Date</th>
                <th className="text-left px-2 py-1.5">Category</th>
                <th className="text-left px-2 py-1.5">Person</th>
                <th className="text-left px-2 py-1.5">Description</th>
                <th className="text-left px-2 py-1.5">Payee</th>
                <th className="text-left px-2 py-1.5">Method</th>
                <th className="text-right px-2 py-1.5">Amount</th>
                <th className="px-1"></th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-[#F3F4F6]">
                    <td className="px-2 py-1.5 whitespace-nowrap text-[#6B7280]">{r.entryDate?.slice(0, 10)}</td>
                    <td className="px-2 py-1.5" dir="auto">
                      {r.category}
                      {r.direction === "income" && <span className="ml-1 text-[9px] bg-[#DCFCE7] text-[#166534] rounded px-1">funds in</span>}
                    </td>
                    <td className="px-2 py-1.5" dir="auto">{r.person || "—"}</td>
                    <td className="px-2 py-1.5 max-w-[220px] truncate" dir="auto" title={r.description || ""}>{r.description || "—"}</td>
                    <td className="px-2 py-1.5" dir="auto">{r.payee || "—"}</td>
                    <td className="px-2 py-1.5">{r.method}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${r.direction === "income" ? "text-[#15803D]" : "text-[#B91C1C]"}`}>
                      {r.direction === "income" ? "+" : "−"}{PKR(r.amount)}
                    </td>
                    <td className="px-1 whitespace-nowrap">
                      <button onClick={() => startEdit(r)} title="Edit · درست کریں" className="text-slate-400 hover:text-emerald-700 p-0.5"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => del(r.id)} title="Delete · حذف کریں" className="text-slate-400 hover:text-red-600 p-0.5"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                  {editId === r.id && (
                    <tr className="bg-[#F0FDF4]">
                      <td colSpan={8} className="px-3 py-3">
                        <EntryForm
                          value={editForm}
                          onChange={setEditForm}
                          meta={meta}
                          onSubmit={saveEdit}
                          saving={saving}
                          onCancel={() => setEditId(null)}
                          submitLabel="Save changes · تبدیلیاں محفوظ کریں"
                          compact
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {displayRows.length === 0 && (
                <tr><td colSpan={8} className="px-2 py-6 text-center text-[#9CA3AF]">
                  {rows.length === 0 ? "No entries in this period · اس مدت میں کوئی اندراج نہیں" : "No entries match this filter · اس فلٹر میں کوئی اندراج نہیں"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EntryForm({
  value,
  onChange,
  meta,
  onSubmit,
  saving,
  onCancel,
  submitLabel,
  compact,
}: {
  value: any;
  onChange: (v: any) => void;
  meta: any;
  onSubmit: () => void;
  saving: boolean;
  onCancel: () => void;
  submitLabel: string;
  compact?: boolean;
}) {
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className={`rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3 ${compact ? "" : "shadow-sm"}`}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <label className="flex flex-col text-[10px] text-slate-500">Date · تاریخ
          <input type="date" value={value.entryDate} onChange={(e) => set("entryDate", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Category · مد
          <select value={value.category} onChange={(e) => set("category", e.target.value)} className="border rounded px-2 py-1 text-slate-800">
            {(meta.categories || []).map((c: string) => <option key={c} value={c}>{c}{CAT_UR[c] ? ` · ${CAT_UR[c]}` : ""}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Type
          <select value={value.direction} onChange={(e) => set("direction", e.target.value)} className="border rounded px-2 py-1 text-slate-800">
            <option value="expense">Expense · خرچہ</option>
            <option value="income">Funds in · رقم جمع</option>
          </select>
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Amount (PKR) · رقم
          <input inputMode="numeric" value={value.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d]/g, ""))} className="border rounded px-2 py-1 text-slate-800 font-semibold" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Person · فرد <span className="text-slate-400">(pocket money)</span>
          <input dir="auto" list="pe-people" value={value.person} onChange={(e) => set("person", e.target.value)} className="border rounded px-2 py-1 text-slate-800" placeholder="e.g. son / wife / self" />
          <datalist id="pe-people">{(meta.people || []).map((p: string) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Payee · کس کو دیا
          <input dir="auto" value={value.payee} onChange={(e) => set("payee", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Method · ذریعہ
          <select value={value.method} onChange={(e) => set("method", e.target.value)} className="border rounded px-2 py-1 text-slate-800">
            {(meta.methods || ["Cash"]).map((m: string) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Ref no.
          <input value={value.refNo} onChange={(e) => set("refNo", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500 col-span-2 md:col-span-2">Description · تفصیل
          <input dir="auto" value={value.description} onChange={(e) => set("description", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Paid by · کس نے دیا
          <input dir="auto" value={value.paidBy} onChange={(e) => set("paidBy", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Notes · نوٹ
          <input dir="auto" value={value.notes} onChange={(e) => set("notes", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button onClick={onSubmit} disabled={saving} className="bg-[#16A34A] text-white rounded px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} {submitLabel}
        </button>
        <button onClick={onCancel} className="border border-slate-300 rounded px-3 py-1.5 text-xs flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel</button>
      </div>
    </div>
  );
}

function Big({ label, value, tone, big }: { label: string; value: string; tone: "good" | "bad" | "neutral"; big?: boolean }) {
  const c =
    tone === "good"
      ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]"
      : tone === "bad"
      ? "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]"
      : "border-[#E5E7EB] bg-white text-[#1F2937]";
  return (
    <div className={`rounded-xl border p-3 ${c}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide" dir="auto">{label}</div>
      <div className={`${big ? "text-2xl" : "text-lg"} font-extrabold tabular-nums`}>{value}</div>
    </div>
  );
}
