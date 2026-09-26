/**
 * Invoices — the hub. Every raised invoice in one list: view / print, record a
 * payment, track outstanding & overdue, and raise a new one.
 *
 *   GET  /api/finance/invoices            list
 *   GET  /api/finance/invoices/aging      AR buckets
 *   POST /api/finance/invoices/:id/payments   record a payment
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import InvoiceDocument from "./InvoiceDocument.tsx";
import NewInvoice from "./NewInvoice.tsx";
import {
  FileText, Plus, Printer, RefreshCw, Loader2, Search, Wallet, ArrowLeft, CheckCircle, Pencil,
} from "lucide-react";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

const PKR = (n: number) => "Rs " + Math.round(n || 0).toLocaleString("en-PK");
const d = (s: string) => (s ? new Date(s).toLocaleDateString("en-GB") : "—");

const STATUS_STYLE: Record<string, string> = {
  Paid: "bg-[#E6ECF6] text-[#173563]",
  "Partially Paid": "bg-[#F3F4F6] text-[#374151]",
  Unpaid: "bg-[#FFE0E0] text-[#8C0004]",
};

export default function InvoicesList({
  showFeedback,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [aging, setAging] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [viewId, setViewId] = useState<number | null>(null);
  const [payFor, setPayFor] = useState<number | null>(null);
  const [payForm, setPayForm] = useState<any>({ paymentMethod: "Bank Transfer", amount: "", referenceNumber: "", notes: "" });
  const [posting, setPosting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      enterpriseFetch(`/api/finance/invoices`).then((r) => setRows(Array.isArray(r) ? r : [])),
      enterpriseFetch(`/api/finance/invoices/aging`).then(setAging).catch(() => {}),
    ])
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "Overdue") {
        if (!(new Date(r.dueDate).getTime() < Date.now() && r.outstandingBalance > 0)) return false;
      } else if (statusFilter && r.status !== statusFilter) return false;
      if (!s) return true;
      return `${r.invoiceNumber} ${r.contractorName || ""} ${r.tripNumber || ""}`.toLowerCase().includes(s);
    });
  }, [rows, q, statusFilter]);

  const totals = useMemo(() => {
    const out = rows.reduce((a, r) => a + Number(r.outstandingBalance || 0), 0);
    const billed = rows.reduce((a, r) => a + Number(r.totalAmount || 0), 0);
    const overdue = rows.filter((r) => new Date(r.dueDate).getTime() < Date.now() && r.outstandingBalance > 0)
      .reduce((a, r) => a + Number(r.outstandingBalance || 0), 0);
    return { out, billed, overdue, count: rows.length };
  }, [rows]);

  const recordPayment = async (id: number) => {
    if (!Number(payForm.amount)) { showFeedback("error", "Enter an amount · رقم درج کریں"); return; }
    setPosting(true);
    try {
      await enterpriseFetch(`/api/finance/invoices/${id}/payments`, {
        method: "POST",
        body: JSON.stringify({ ...payForm, amount: Number(payForm.amount) }),
      });
      showFeedback("success", "Payment recorded — ledger updated");
      setPayFor(null);
      setPayForm({ paymentMethod: "Bank Transfer", amount: "", referenceNumber: "", notes: "" });
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setPosting(false);
    }
  };

  if (creating || editingId != null) {
    const backTo = () => { setCreating(false); setEditingId(null); };
    return (
      <div className="space-y-3">
        <button onClick={backTo} className="text-xs flex items-center gap-1.5 text-slate-600 hover:text-slate-900">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to invoices
        </button>
        <NewInvoice
          showFeedback={showFeedback}
          editInvoiceId={editingId ?? undefined}
          onCreated={(id) => { backTo(); load(); setViewId(id); }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <FileText className="w-4 h-4" /> Invoices <span className="text-[#9CA3AF] font-normal text-sm">· انوائسز</span>
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">Every invoice in one place — view / print, record payments, outstanding &amp; overdue. · ہر انوائس ایک جگہ۔</p>
        </div>
        <div className="flex-1" />
        <button onClick={load} disabled={loading} className="h-9 px-3 rounded-lg border border-[#E5E7EB] bg-white text-sm flex items-center gap-1.5 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
        <ModuleDataIO entityKey="invoices" label="Invoices" onImported={load} />
        <button onClick={() => setCreating(true)} className="h-9 px-4 rounded-lg bg-[#24539B] text-white text-sm font-semibold flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> New Invoice · نیا انوائس
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Invoices" value={String(totals.count)} />
        <Tile label="Total billed" value={PKR(totals.billed)} />
        <Tile label="Outstanding" value={PKR(totals.out)} tone={totals.out ? "warn" : "ok"} />
        <Tile label="Overdue" value={PKR(totals.overdue)} tone={totals.overdue ? "bad" : "ok"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 border border-[#E5E7EB] rounded-lg px-2 bg-white flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number / client / trip…" className="text-sm py-1.5 w-full outline-none" />
        </div>
        {["", "Unpaid", "Partially Paid", "Paid", "Overdue"].map((s) => (
          <button
            key={s || "all"}
            onClick={() => setStatusFilter(s)}
            className={`text-xs rounded-full px-2.5 py-1 ${statusFilter === s ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F9FAFB] text-[#6B7280]">
              <tr>
                <th className="text-left px-2 py-1.5">Invoice #</th>
                <th className="text-left px-2 py-1.5">Date</th>
                <th className="text-left px-2 py-1.5">Client</th>
                <th className="text-left px-2 py-1.5">Trip</th>
                <th className="text-right px-2 py-1.5">Total</th>
                <th className="text-right px-2 py-1.5">Balance</th>
                <th className="text-left px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isOverdue = new Date(r.dueDate).getTime() < Date.now() && r.outstandingBalance > 0;
                return (
                  <React.Fragment key={r.id}>
                    <tr className="border-t border-[#F3F4F6]">
                      <td className="px-2 py-1.5 font-semibold whitespace-nowrap">{r.invoiceNumber}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{d(r.invoiceDate)}</td>
                      <td className="px-2 py-1.5" dir="auto">{r.contractorName || "—"}</td>
                      <td className="px-2 py-1.5 text-slate-500">{r.tripNumber || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{PKR(r.totalAmount)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${r.outstandingBalance > 0 ? "text-[#B00005]" : "text-[#1E4480]"}`}>{PKR(r.outstandingBalance)}</td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${isOverdue ? "bg-[#FFE0E0] text-[#8C0004]" : STATUS_STYLE[r.status] || "bg-slate-100 text-slate-600"}`}>
                          {isOverdue ? "OVERDUE" : (r.status || "").toUpperCase()}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-right">
                        <button onClick={() => setViewId(r.id)} className="text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 mr-2" title="View / Print / Download">
                          <Printer className="w-3.5 h-3.5" /> View
                        </button>
                        <button onClick={() => setEditingId(r.id)} className="text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 mr-2" title="Edit this invoice">
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </button>
                        {r.outstandingBalance > 0 && (
                          <button onClick={() => { setPayFor(payFor === r.id ? null : r.id); setPayForm((f: any) => ({ ...f, amount: String(r.outstandingBalance) })); }} className="text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1" title="Record payment">
                            <Wallet className="w-3.5 h-3.5" /> Payment
                          </button>
                        )}
                      </td>
                    </tr>
                    {payFor === r.id && (
                      <tr className="bg-[#F2F5FA]">
                        <td colSpan={8} className="px-3 py-3">
                          <div className="flex flex-wrap items-end gap-2 text-xs">
                            <label className="flex flex-col text-[10px] text-slate-500">Method
                              <select value={payForm.paymentMethod} onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })} className="border rounded px-2 py-1 text-slate-800">
                                {["Bank Transfer", "Cash", "Cheque", "Online", "Card"].map((m) => <option key={m}>{m}</option>)}
                              </select>
                            </label>
                            <label className="flex flex-col text-[10px] text-slate-500">Amount
                              <input value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value.replace(/[^\d]/g, "") })} className="border rounded px-2 py-1 text-slate-800 font-semibold" />
                            </label>
                            <label className="flex flex-col text-[10px] text-slate-500">Reference
                              <input value={payForm.referenceNumber} onChange={(e) => setPayForm({ ...payForm, referenceNumber: e.target.value })} className="border rounded px-2 py-1 text-slate-800" />
                            </label>
                            <label className="flex flex-col text-[10px] text-slate-500 flex-1 min-w-[160px]">Notes
                              <input value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} className="border rounded px-2 py-1 text-slate-800" />
                            </label>
                            <button onClick={() => recordPayment(r.id)} disabled={posting} className="bg-emerald-600 text-white rounded px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60">
                              {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Record
                            </button>
                            <button onClick={() => setPayFor(null)} className="border border-slate-300 rounded px-3 py-1.5 text-xs">Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={8} className="px-2 py-8 text-center text-[#9CA3AF]">
                  No invoices{q || statusFilter ? " match this filter" : " yet"}. Click <b>New Invoice</b> to raise one.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {viewId != null && <InvoiceDocument invoiceId={viewId} onClose={() => setViewId(null)} />}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const c = tone === "bad" ? "border-[#FFC2C3] bg-[#FFF1F1] text-[#B00005]"
    : tone === "warn" ? "border-[#E5E7EB] bg-[#F9FAFB] text-[#4B5563]"
    : "border-[#E5E7EB] bg-white text-[#1F2937]";
  return (
    <div className={`rounded-xl border p-3 ${c}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide">{label}</div>
      <div className="text-lg font-extrabold tabular-nums">{value}</div>
    </div>
  );
}
