/**
 * Invoices — the hub. Every raised invoice in one list: view / print, record a
 * payment, track outstanding & overdue, and raise a new one.
 *
 *   GET  /api/finance/invoices            list
 *   GET  /api/finance/invoices/aging      AR buckets
 *   POST /api/finance/invoices/:id/payments   record a payment
 *   GET  /api/finance/invoices/:id/payments   its payments (history)
 *   DELETE /api/finance/invoices/:id/payments/:paymentId   undo one payment
 *   DELETE /api/finance/invoices/:id          delete (only with no payments)
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import InvoiceDocument from "./InvoiceDocument.tsx";
import NewInvoice from "./NewInvoice.tsx";
import {
  FileText, Plus, Printer, RefreshCw, Loader2, Search, Wallet, ArrowLeft, CheckCircle, Pencil, Trash2, History, Undo2,
} from "lucide-react";
import ModuleDataIO from "../common/ModuleDataIO.tsx";
import { PageHeader, Btn, Card, KpiStrip, Empty } from "../ui/kit.tsx";

const PKR = (n: number) => "Rs " + Math.round(n || 0).toLocaleString("en-PK");
const d = (s: string) => (s ? new Date(s).toLocaleDateString("en-GB") : "—");

const STATUS_STYLE: Record<string, string> = {
  Paid: "bg-[#DCFCE7] text-[#166534]",
  "Partially Paid": "bg-[#FEF3C7] text-[#92400E]",
  Unpaid: "bg-[#EEF2F7] text-[#374151]",
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
  const [histFor, setHistFor] = useState<number | null>(null);
  const [hist, setHist] = useState<any[] | null>(null);

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

  // one click: the whole outstanding balance received (cash) — "mark as paid"
  const markPaid = async (r: any) => {
    if (!window.confirm(`Mark ${r.invoiceNumber} as PAID — ${PKR(r.outstandingBalance)} received? (Undo is under “Payments”.) · مکمل وصول درج کریں؟`)) return;
    setPosting(true);
    try {
      await enterpriseFetch(`/api/finance/invoices/${r.id}/payments`, {
        method: "POST",
        body: JSON.stringify({ paymentMethod: "Cash", amount: Number(r.outstandingBalance), referenceNumber: "", notes: "Marked paid" }),
      });
      showFeedback("success", `${r.invoiceNumber} marked paid · وصول درج`);
      load();
      if (histFor === r.id) openHistory(r.id, true);
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setPosting(false);
    }
  };

  const openHistory = (id: number, keepOpen = false) => {
    if (histFor === id && !keepOpen) { setHistFor(null); return; }
    setHistFor(id);
    setHist(null);
    enterpriseFetch(`/api/finance/invoices/${id}/payments`).then(setHist).catch((e) => { showFeedback("error", e.message); setHist([]); });
  };

  const undoPayment = async (invoiceId: number, p: any) => {
    if (!window.confirm(`Undo the payment of ${PKR(p.amount)} (${p.paymentMethod}, ${d(p.paymentDate)})? The invoice becomes unpaid by that amount again. · یہ ادائیگی واپس لیں؟`)) return;
    try {
      const r = await enterpriseFetch(`/api/finance/invoices/${invoiceId}/payments/${p.id}`, { method: "DELETE" });
      showFeedback("success", `Payment undone — invoice is now ${r.status} · واپس ہو گئی`);
      load();
      openHistory(invoiceId, true);
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const deleteInvoice = async (r: any) => {
    if (!window.confirm(`Delete invoice ${r.invoiceNumber} (${PKR(r.totalAmount)}, ${r.contractorName || ""})? · یہ انوائس حذف کریں؟`)) return;
    try {
      const x = await enterpriseFetch(`/api/finance/invoices/${r.id}`, { method: "DELETE" });
      showFeedback("success", `${x.message} · حذف ہو گئی`);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  if (creating || editingId != null) {
    const backTo = () => { setCreating(false); setEditingId(null); };
    return (
      <div className="space-y-3">
        <Btn kind="ghost" size="sm" onClick={backTo} icon={<ArrowLeft />}>Back to invoices</Btn>
        <NewInvoice
          showFeedback={showFeedback}
          editInvoiceId={editingId ?? undefined}
          onCreated={(id) => { backTo(); load(); setViewId(id); }}
        />
      </div>
    );
  }

  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] text-[#111827] bg-white";
  const STATUSES = ["", "Unpaid", "Partially Paid", "Paid", "Overdue"];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoices"
        urdu="انوائسز"
        subtitle={<span dir="auto">Every invoice in one place — view / print, record payments, outstanding &amp; overdue · ہر انوائس ایک جگہ</span>}
        actions={
          <>
            <Btn kind="ghost" onClick={load} disabled={loading} title="Refresh · تازہ کریں" icon={loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} />
            <ModuleDataIO entityKey="invoices" label="Invoices" onImported={load} />
            <Btn kind="primary" onClick={() => setCreating(true)} icon={<Plus />}>New invoice · نیا انوائس</Btn>
          </>
        }
      />

      <KpiStrip
        items={[
          { label: "Invoices", value: totals.count.toLocaleString() },
          { label: "Total billed · کل بل", value: PKR(totals.billed) },
          { label: "Outstanding · باقی", value: PKR(totals.out), tone: totals.out ? "warn" : undefined },
          { label: "Overdue · مدت گزر گئی", value: PKR(totals.overdue), tone: totals.overdue ? "bad" : undefined, onClick: totals.overdue ? () => setStatusFilter("Overdue") : undefined },
        ]}
      />

      <Card className="overflow-hidden" bodyClassName="">
        <div className="flex flex-wrap items-center gap-2 px-3 pt-1 border-b border-[#EEF1F5]">
          <div className="flex items-end gap-1 overflow-x-auto no-scrollbar">
            {STATUSES.map((s) => (
              <button
                key={s || "all"}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-2.5 -mb-px border-b-2 text-[13px] whitespace-nowrap ${statusFilter === s ? "border-[#24539B] text-[#24539B] font-semibold" : "border-transparent text-[#6B7280] hover:text-[#1F2937]"}`}
              >
                {s || "All"}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2 border border-[#CBD5E1] rounded-lg px-2.5 bg-white my-1.5 w-full sm:w-64">
            <Search className="w-4 h-4 text-[#9CA3AF] shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number / client / trip… · تلاش" className="text-[13px] py-1.5 w-full outline-none border-0" style={{ boxShadow: "none" }} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]">
              <tr className="border-b border-[#E3E8EF]">
                <th className="text-left px-3 py-2">Invoice #</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Client</th>
                <th className="text-left px-3 py-2">Trip</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">Balance due</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isOverdue = new Date(r.dueDate).getTime() < Date.now() && r.outstandingBalance > 0;
                return (
                  <React.Fragment key={r.id}>
                    <tr
                      className="group border-t border-[#F1F4F9] hover:bg-[#F8FAFC] cursor-pointer"
                      title="Click to view / print · دیکھنے کے لیے کلک کریں"
                      onClick={(ev) => {
                        if ((ev.target as HTMLElement).closest("button, a, input, select")) return;
                        setViewId(r.id);
                      }}
                    >
                      <td className="px-3 py-2.5 font-semibold text-[#24539B] whitespace-nowrap">{r.invoiceNumber}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-[#6B7280] tabular-nums">{d(r.invoiceDate)}</td>
                      <td className="px-3 py-2.5 text-[#1F2937]" dir="auto">{r.contractorName || "—"}</td>
                      <td className="px-3 py-2.5 text-[#6B7280]">{r.tripNumber || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#111827]">{PKR(r.totalAmount)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${r.outstandingBalance > 0 ? "text-[#B91C1C]" : "text-[#9CA3AF]"}`}>{PKR(r.outstandingBalance)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${isOverdue ? "bg-[#FEE2E2] text-[#991B1B]" : STATUS_STYLE[r.status] || "bg-slate-100 text-slate-600"}`}>
                          {isOverdue ? "Overdue" : r.status || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right">
                        <span className="inline-flex items-center gap-1">
                          {r.outstandingBalance > 0 && (
                            <Btn size="sm" kind="outline" icon={<Wallet />} title="Record a (part) payment" onClick={() => { setPayFor(payFor === r.id ? null : r.id); setPayForm((f: any) => ({ ...f, amount: String(r.outstandingBalance) })); }}>
                              Payment
                            </Btn>
                          )}
                          <span className="opacity-50 group-hover:opacity-100 transition-opacity inline-flex items-center">
                            <button onClick={() => setViewId(r.id)} className="p-1.5 rounded text-[#6B7280] hover:text-[#24539B] hover:bg-white" title="View / Print / Download"><Printer className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setEditingId(r.id)} className="p-1.5 rounded text-[#6B7280] hover:text-[#24539B] hover:bg-white" title="Edit this invoice"><Pencil className="w-3.5 h-3.5" /></button>
                            {r.outstandingBalance > 0 && (
                              <button onClick={() => markPaid(r)} disabled={posting} className="p-1.5 rounded text-[#6B7280] hover:text-[#166534] hover:bg-white" title="The whole balance received — mark as paid"><CheckCircle className="w-3.5 h-3.5" /></button>
                            )}
                            <button onClick={() => openHistory(r.id)} className="p-1.5 rounded text-[#6B7280] hover:text-[#24539B] hover:bg-white" title="Payments received — undo a wrong one"><History className="w-3.5 h-3.5" /></button>
                            <button
                              onClick={() => deleteInvoice(r)}
                              className="p-1.5 rounded text-[#6B7280] hover:text-red-700 hover:bg-white"
                              title={(r.paidAmount || 0) > 0 ? "Undo its payments first, then delete" : "Delete this invoice"}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        </span>
                      </td>
                    </tr>
                    {histFor === r.id && (
                      <tr className="bg-[#F8FAFC]">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="text-[12px] font-semibold text-[#374151] mb-1.5">Payments received · وصولیاں</div>
                          {!hist ? (
                            <span className="text-[#6B7280] flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading payments…</span>
                          ) : hist.length === 0 ? (
                            <span className="text-[#6B7280]">No payments on this invoice yet · ابھی کوئی ادائیگی نہیں</span>
                          ) : (
                            <table className="w-full text-[12.5px] bg-white border border-[#E3E8EF] rounded-lg">
                              <tbody>
                                {hist.map((p: any) => (
                                  <tr key={p.id} className="border-t border-[#EEF1F5] first:border-t-0">
                                    <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{d(p.paymentDate)}</td>
                                    <td className="px-3 py-1.5">{p.paymentMethod}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{PKR(p.amount)}</td>
                                    <td className="px-3 py-1.5 text-[#6B7280]" dir="auto">{[p.referenceNumber, p.notes].filter(Boolean).join(" · ")}</td>
                                    <td className="px-3 py-1.5 text-right">
                                      <button onClick={() => undoPayment(r.id, p)} className="inline-flex items-center gap-1 text-[#6B7280] hover:text-red-700" title="Undo this payment">
                                        <Undo2 className="w-3.5 h-3.5" /> Undo · واپس
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                    {payFor === r.id && (
                      <tr className="bg-[#F4F7FC]">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <label className={lbl}>Method
                              <select value={payForm.paymentMethod} onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })} className={inp}>
                                {["Bank Transfer", "Cash", "Cheque", "Online", "Card"].map((m) => <option key={m}>{m}</option>)}
                              </select>
                            </label>
                            <label className={lbl}>Amount
                              <input value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value.replace(/[^\d]/g, "") })} className={`${inp} font-semibold tabular-nums w-36`} />
                            </label>
                            <label className={lbl}>Reference
                              <input value={payForm.referenceNumber} onChange={(e) => setPayForm({ ...payForm, referenceNumber: e.target.value })} className={inp} />
                            </label>
                            <label className={`${lbl} flex-1 min-w-[160px]`}>Notes
                              <input value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} className={inp} />
                            </label>
                            <Btn kind="primary" onClick={() => recordPayment(r.id)} disabled={posting} icon={posting ? <Loader2 className="animate-spin" /> : <CheckCircle />}>Record payment</Btn>
                            <Btn onClick={() => setPayFor(null)}>Cancel</Btn>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={8}>
                    <Empty
                      icon={<FileText />}
                      title={`No invoices${q || statusFilter ? " match this filter" : " yet"}`}
                      hint="ابھی کوئی انوائس نہیں"
                      action={!q && !statusFilter ? <Btn kind="primary" onClick={() => setCreating(true)} icon={<Plus />}>New invoice</Btn> : undefined}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {viewId != null && <InvoiceDocument invoiceId={viewId} onClose={() => setViewId(null)} />}
    </div>
  );
}

