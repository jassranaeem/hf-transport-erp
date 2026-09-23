/**
 * Daily Cash Book — log every cash in/out for the day (who, how much), and
 * see the running balance update live. Each day runs midnight to midnight;
 * the opening balance is just the running total of everything before today,
 * so nothing needs to be re-entered each morning.
 *
 *   /api/cash-book/day?date=YYYY-MM-DD   one day's opening/entries/closing
 *   /api/cash-book                       create
 *   /api/cash-book/:id                   edit / delete
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Wallet, RefreshCw, Loader2, Plus, Pencil, Trash2, CheckCircle, X, ArrowDownCircle, ArrowUpCircle } from "lucide-react";

const PKR = (n: number) => "PKR " + Math.round(Math.abs(n || 0)).toLocaleString();
const today = () => new Date().toISOString().slice(0, 10);

const BLANK = { direction: "Out", amount: "", person: "", description: "", notes: "" };

export default function CashBook({ showFeedback }: { showFeedback: (t: "success" | "error", m: string) => void }) {
  const [date, setDate] = useState(today());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<any>(BLANK);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const load = useCallback(() => {
    setLoading(true);
    enterpriseFetch(`/api/cash-book/day?date=${date}`)
      .then(setData)
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [date, showFeedback]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!Number(form.amount)) { showFeedback("error", "Amount daalein · رقم درج کریں"); return; }
    setSaving(true);
    try {
      await enterpriseFetch("/api/cash-book", { method: "POST", body: JSON.stringify({ ...form, entryDate: `${date}T${new Date().toTimeString().slice(0, 8)}` }) });
      showFeedback("success", "Saved · محفوظ ہو گیا");
      setForm(BLANK);
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
    setEditForm({ direction: r.direction, amount: r.amount || "", person: r.person || "", description: r.description || "", notes: r.notes || "" });
  };
  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    try {
      await enterpriseFetch(`/api/cash-book/${editId}`, { method: "PUT", body: JSON.stringify(editForm) });
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
      await enterpriseFetch(`/api/cash-book/${id}`, { method: "DELETE" });
      showFeedback("success", "Deleted · حذف ہو گیا");
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  // running position as each entry happened, for the "yahan gaya itna reh gaya" feel
  let running = data?.openingBalance ?? 0;
  const withRunning = (data?.entries || []).map((e: any) => {
    running = e.direction === "In" ? running + e.amount : running - e.amount;
    return { ...e, runningAfter: running };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <Wallet className="w-4 h-4" /> Daily Cash Book <span className="text-[#9CA3AF] font-normal text-sm">· روزانہ کیش بک</span>
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">
            Aaj jo aya aur jisko jitna diya, wo yahan log karein — balance khud update hota rahega. · جو آیا اور جسے
            دیا وہ یہاں درج کریں، بیلنس خود بخود اپڈیٹ ہوگا۔
          </p>
        </div>
        <div className="flex-1" />
        <label className="flex flex-col text-[11px] text-[#6B7280]">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-[#E5E7EB] rounded px-2 py-1 text-sm" />
        </label>
        <button onClick={load} disabled={loading} className="h-9 px-3 rounded-lg border border-[#E5E7EB] bg-white text-sm flex items-center gap-1.5 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
        <button onClick={() => { setShowAdd((s) => !s); setEditId(null); }} className="h-9 px-4 rounded-lg bg-[#16A34A] text-white text-sm font-semibold flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add entry · نئی اندراج
        </button>
      </div>

      {showAdd && (
        <EntryForm value={form} onChange={setForm} onSubmit={add} saving={saving} onCancel={() => setShowAdd(false)} submitLabel="Save · محفوظ کریں" />
      )}

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Big label="Opening · صبح کا بیلنس" value={PKR(data.openingBalance)} tone="neutral" />
          <Big label="Total In · کل آیا" value={PKR(data.totalIn)} tone="good" />
          <Big label="Total Out · کل گیا" value={PKR(data.totalOut)} tone="bad" />
          <Big label="Closing · باقی بچا" value={PKR(data.closingBalance)} tone={data.closingBalance >= 0 ? "good" : "bad"} big />
        </div>
      )}

      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F3F7F4]">{date} — Entries ({withRunning.length})</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F9FAFB] text-[#6B7280]">
              <tr>
                <th className="text-left px-2 py-1.5">Time</th>
                <th className="text-left px-2 py-1.5">In/Out</th>
                <th className="text-left px-2 py-1.5">Person</th>
                <th className="text-left px-2 py-1.5">Description</th>
                <th className="text-right px-2 py-1.5">Amount</th>
                <th className="text-right px-2 py-1.5">Balance</th>
                <th className="px-1"></th>
              </tr>
            </thead>
            <tbody>
              {withRunning.map((r: any) => (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-[#F3F4F6]">
                    <td className="px-2 py-1.5 whitespace-nowrap text-[#6B7280]">{r.entryDate ? new Date(r.entryDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className="px-2 py-1.5">
                      {r.direction === "In" ? (
                        <span className="flex items-center gap-1 text-[#15803D] font-semibold"><ArrowDownCircle className="w-3.5 h-3.5" /> In</span>
                      ) : (
                        <span className="flex items-center gap-1 text-[#B91C1C] font-semibold"><ArrowUpCircle className="w-3.5 h-3.5" /> Out</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5" dir="auto">{r.person || "—"}</td>
                    <td className="px-2 py-1.5 max-w-[260px] truncate" dir="auto" title={r.description || ""}>{r.description || "—"}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${r.direction === "In" ? "text-[#15803D]" : "text-[#B91C1C]"}`}>{PKR(r.amount)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#1F2937]">{PKR(r.runningAfter)}</td>
                    <td className="px-1 whitespace-nowrap">
                      <button onClick={() => startEdit(r)} title="Edit" className="text-slate-400 hover:text-emerald-700 p-0.5"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => del(r.id)} title="Delete" className="text-slate-400 hover:text-red-600 p-0.5"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                  {editId === r.id && (
                    <tr className="bg-[#F0FDF4]">
                      <td colSpan={7} className="px-3 py-3">
                        <EntryForm value={editForm} onChange={setEditForm} onSubmit={saveEdit} saving={saving} onCancel={() => setEditId(null)} submitLabel="Save changes" compact />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {withRunning.length === 0 && (
                <tr><td colSpan={7} className="px-2 py-6 text-center text-[#9CA3AF]">No entries for {date} yet · ابھی کوئی اندراج نہیں</td></tr>
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
    <div className={`rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3 ${compact ? "" : "shadow-sm"}`}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <label className="flex flex-col text-[10px] text-slate-500">In / Out
          <select value={value.direction} onChange={(e) => set("direction", e.target.value)} className="border rounded px-2 py-1 text-slate-800">
            <option value="Out">Out (diya)</option>
            <option value="In">In (aya)</option>
          </select>
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Amount (PKR) · رقم
          <input inputMode="numeric" value={value.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d]/g, ""))} className="border rounded px-2 py-1 text-slate-800 font-semibold" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500 col-span-2">Person · کس کو / کس سے
          <input dir="auto" value={value.person} onChange={(e) => set("person", e.target.value)} className="border rounded px-2 py-1 text-slate-800" placeholder="e.g. Person 1" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500 col-span-2 md:col-span-3">Description · تفصیل
          <input dir="auto" value={value.description} onChange={(e) => set("description", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Notes
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
  const c = tone === "good" ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]" : tone === "bad" ? "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]" : "border-[#E5E7EB] bg-white text-[#1F2937]";
  return (
    <div className={`rounded-xl border p-3 ${c}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide" dir="auto">{label}</div>
      <div className={`${big ? "text-2xl" : "text-lg"} font-extrabold tabular-nums`}>{value}</div>
    </div>
  );
}
