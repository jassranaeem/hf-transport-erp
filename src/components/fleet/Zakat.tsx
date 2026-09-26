/**
 * Zakat — a standalone register, separate from Personal & Household Expenses
 * and separate from the business Parties/Khata. You log what you actually
 * gave, when, and to whom. The Yearly Report shows a 2.5%-of-wealth ESTIMATE
 * to check against — this page is the real, self-entered record.
 *
 *   /api/zakat                  list + create
 *   /api/zakat/:id              edit / delete
 *   /api/zakat/summary/year     year total + month-by-month
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Landmark, RefreshCw, Loader2, Plus, Pencil, Trash2, CheckCircle, X, History, ChevronDown, ChevronRight } from "lucide-react";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

const PKR = (n: number) => "PKR " + Math.round(Math.abs(n || 0)).toLocaleString();
const today = () => new Date().toISOString().slice(0, 10);
const thisYear = () => new Date().getFullYear();
const METHODS = ["Cash", "Bank", "Card", "Online", "Cheque"];

const BLANK = { entryDate: today(), amount: "", recipient: "", description: "", method: "Cash", refNo: "", paidBy: "", notes: "" };

export default function Zakat({ showFeedback }: { showFeedback: (t: "success" | "error", m: string) => void }) {
  const [year, setYear] = useState(thisYear());
  const [yearData, setYearData] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [showTrend, setShowTrend] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<any>(BLANK);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      enterpriseFetch(`/api/zakat/summary/year?year=${year}`).then(setYearData),
      enterpriseFetch(`/api/zakat?from=${year}-01-01&to=${year}-12-31&limit=500`).then((r) => setRows(r.rows || [])),
    ])
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [year, showFeedback]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!Number(form.amount)) { showFeedback("error", "Enter an amount · رقم درج کریں"); return; }
    setSaving(true);
    try {
      await enterpriseFetch("/api/zakat", { method: "POST", body: JSON.stringify(form) });
      showFeedback("success", "Saved · محفوظ ہو گیا");
      setForm({ ...BLANK, entryDate: form.entryDate, method: form.method });
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
      amount: r.amount || "",
      recipient: r.recipient || "",
      description: r.description || "",
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
      await enterpriseFetch(`/api/zakat/${editId}`, { method: "PUT", body: JSON.stringify(editForm) });
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
    if (!window.confirm("Delete this Zakat entry? · یہ اندراج حذف کریں؟")) return;
    try {
      await enterpriseFetch(`/api/zakat/${id}`, { method: "DELETE" });
      showFeedback("success", "Deleted · حذف ہو گیا");
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <Landmark className="w-4 h-4" /> Zakat <span className="text-[#9CA3AF] font-normal text-sm">· زکوٰۃ کا اندراج</span>
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">
            Log what you actually gave, when, and to whom — separate from the business ledger and household expenses. ·
            آپ نے جو زکوٰۃ دی وہ یہاں خود درج کریں۔
          </p>
        </div>
        <div className="flex-1" />
        <label className="flex flex-col text-[11px] text-[#6B7280]">
          Year
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="border border-[#E5E7EB] rounded px-2 py-1 text-sm w-24" />
        </label>
        <button onClick={load} disabled={loading} className="h-9 px-3 rounded-lg border border-[#E5E7EB] bg-white text-sm flex items-center gap-1.5 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
        <ModuleDataIO entityKey="zakat_payments" label="Zakat" onImported={load} />
        <button onClick={() => { setShowAdd((s) => !s); setEditId(null); }} className="h-9 px-4 rounded-lg bg-[#24539B] text-white text-sm font-semibold flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add Zakat given · نئی ادائیگی
        </button>
      </div>

      {showAdd && (
        <EntryForm value={form} onChange={setForm} onSubmit={add} saving={saving} onCancel={() => setShowAdd(false)} submitLabel="Save · محفوظ کریں" />
      )}

      {yearData && (
        <div className="grid grid-cols-2 gap-3">
          <Big label={`Zakat given in ${year} · کل دی گئی زکوٰۃ`} value={PKR(yearData.total)} tone="good" big />
          <Big label="Entries · اندراجات" value={String(yearData.count)} tone="neutral" />
        </div>
      )}
      <p className="text-[11px] text-[#4B5563] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-3 py-2" dir="auto">
        This is your real record of Zakat given. It is separate from the automatic 2.5%-of-wealth estimate on the
        Yearly Report (Finance → Monthly Report → Yearly) — compare the two there. · یہ آپ کی اصل زکوٰۃ کی فہرست ہے،
        سالانہ رپورٹ کے تخمینے سے الگ۔
      </p>

      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <button onClick={() => setShowTrend((s) => !s)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold bg-[#F2F5FA]">
          <span className="flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Month by month · مہینہ بہ مہینہ — {year}</span>
          {showTrend ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        {showTrend && yearData && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F9FAFB] text-[#6B7280]"><tr><th className="text-left px-2 py-1.5">Month</th><th className="text-right px-2 py-1.5">Given</th><th className="text-right px-2 py-1.5">Entries</th></tr></thead>
              <tbody>
                {yearData.months.map((m: any) => (
                  <tr key={m.month} className="border-t border-[#F3F4F6]">
                    <td className="px-2 py-1.5">{m.month}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#1E4480] font-semibold">{PKR(m.total)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">{m.count}</td>
                  </tr>
                ))}
                {yearData.months.length === 0 && (
                  <tr><td colSpan={3} className="px-2 py-4 text-center text-[#9CA3AF]">No Zakat logged for {year} yet · ابھی کوئی اندراج نہیں</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA]">Entries · {year} ({rows.length})</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F9FAFB] text-[#6B7280]">
              <tr>
                <th className="text-left px-2 py-1.5">Date</th>
                <th className="text-left px-2 py-1.5">Recipient</th>
                <th className="text-left px-2 py-1.5">Description</th>
                <th className="text-left px-2 py-1.5">Method</th>
                <th className="text-right px-2 py-1.5">Amount</th>
                <th className="px-1"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-[#F3F4F6]">
                    <td className="px-2 py-1.5 whitespace-nowrap text-[#6B7280]">{r.entryDate?.slice(0, 10)}</td>
                    <td className="px-2 py-1.5" dir="auto">{r.recipient || "—"}</td>
                    <td className="px-2 py-1.5 max-w-[260px] truncate" dir="auto" title={r.description || ""}>{r.description || "—"}</td>
                    <td className="px-2 py-1.5">{r.method}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-[#1E4480]">{PKR(r.amount)}</td>
                    <td className="px-1 whitespace-nowrap">
                      <button onClick={() => startEdit(r)} title="Edit" className="text-slate-400 hover:text-emerald-700 p-0.5"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => del(r.id)} title="Delete" className="text-slate-400 hover:text-red-600 p-0.5"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                  {editId === r.id && (
                    <tr className="bg-[#F2F5FA]">
                      <td colSpan={6} className="px-3 py-3">
                        <EntryForm value={editForm} onChange={setEditForm} onSubmit={saveEdit} saving={saving} onCancel={() => setEditId(null)} submitLabel="Save changes" compact />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-2 py-6 text-center text-[#9CA3AF]">No Zakat entries for {year} · اس سال کوئی اندراج نہیں</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EntryForm({ value, onChange, onSubmit, saving, onCancel, submitLabel, compact }: {
  value: any; onChange: (v: any) => void; onSubmit: () => void; saving: boolean; onCancel: () => void; submitLabel: string; compact?: boolean;
}) {
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className={`rounded-lg border border-[#C9D7EC] bg-[#F2F5FA] p-3 ${compact ? "" : "shadow-sm"}`}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <label className="flex flex-col text-[10px] text-slate-500">Date · تاریخ
          <input type="date" value={value.entryDate} onChange={(e) => set("entryDate", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Amount (PKR) · رقم
          <input inputMode="numeric" value={value.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d]/g, ""))} className="border rounded px-2 py-1 text-slate-800 font-semibold" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Recipient · کس کو دی
          <input dir="auto" value={value.recipient} onChange={(e) => set("recipient", e.target.value)} className="border rounded px-2 py-1 text-slate-800" placeholder="e.g. widow / relative / mosque" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Method · ذریعہ
          <select value={value.method} onChange={(e) => set("method", e.target.value)} className="border rounded px-2 py-1 text-slate-800">
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-[10px] text-slate-500 col-span-2">Description · تفصیل
          <input dir="auto" value={value.description} onChange={(e) => set("description", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Paid by · کس نے دی
          <input dir="auto" value={value.paidBy} onChange={(e) => set("paidBy", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Ref no.
          <input value={value.refNo} onChange={(e) => set("refNo", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500 col-span-2 md:col-span-4">Notes · نوٹ
          <input dir="auto" value={value.notes} onChange={(e) => set("notes", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button onClick={onSubmit} disabled={saving} className="bg-[#24539B] text-white rounded px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} {submitLabel}
        </button>
        <button onClick={onCancel} className="border border-slate-300 rounded px-3 py-1.5 text-xs flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel</button>
      </div>
    </div>
  );
}

function Big({ label, value, tone, big }: { label: string; value: string; tone: "good" | "bad" | "neutral"; big?: boolean }) {
  const c = tone === "good" ? "border-[#C9D7EC] bg-[#F2F5FA] text-[#1E4480]" : tone === "bad" ? "border-[#FFC2C3] bg-[#FFF1F1] text-[#B00005]" : "border-[#E5E7EB] bg-white text-[#1F2937]";
  return (
    <div className={`rounded-xl border p-3 ${c}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide" dir="auto">{label}</div>
      <div className={`${big ? "text-2xl" : "text-lg"} font-extrabold tabular-nums`}>{value}</div>
    </div>
  );
}
