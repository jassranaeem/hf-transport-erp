/**
 * Quotations — every rate quote ("qaraya nama") sent to a company, with its
 * validity window. Expired ones are flagged automatically.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import QuotationDocument from "./QuotationDocument.tsx";
import NewQuotation from "./NewQuotation.tsx";
import {
  FileText, Plus, Printer, RefreshCw, Loader2, Search, ArrowLeft, Pencil, Trash2, ArrowRightCircle, Clock,
} from "lucide-react";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

const PKR = (n: number) => "Rs " + Math.round(n || 0).toLocaleString("en-PK");
const d = (s: string) => (s ? new Date(s).toLocaleDateString("en-GB") : "—");

const STATUS_STYLE: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600",
  Sent: "bg-[#E6ECF6] text-[#173563]",
  Accepted: "bg-[#E6ECF6] text-[#173563]",
  Rejected: "bg-[#FFE0E0] text-[#8C0004]",
};

export default function QuotationsList({
  showFeedback,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [viewId, setViewId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    enterpriseFetch(`/api/quotations`)
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "Expired") { if (!r.isExpired) return false; }
      else if (statusFilter && r.status !== statusFilter) return false;
      if (!s) return true;
      return `${r.quotationNumber} ${r.clientCompany || ""} ${r.routeFrom || ""} ${r.routeTo || ""}`.toLowerCase().includes(s);
    });
  }, [rows, q, statusFilter]);

  const del = async (id: number) => {
    if (!window.confirm("Delete this quotation?")) return;
    try {
      await enterpriseFetch(`/api/quotations/${id}`, { method: "DELETE" });
      showFeedback("success", "Deleted");
      load();
    } catch (e: any) { showFeedback("error", e.message); }
  };

  const convert = async (id: number, r: any) => {
    if (!r.contractorId) { showFeedback("error", "Link this to a registered client first (Edit → choose an existing client), then convert. · پہلے اسے رجسٹرڈ کلائنٹ سے جوڑیں (ایڈٹ ← موجودہ کلائنٹ منتخب کریں)، پھر تبدیل کریں۔"); return; }
    if (!window.confirm(`Convert this quotation into an invoice? · کیا اس کوٹیشن کو انوائس میں تبدیل کریں؟`)) return;
    try {
      const res = await enterpriseFetch(`/api/quotations/${id}/convert-to-invoice`, { method: "POST" });
      showFeedback("success", `Invoice ${res.invoice?.invoiceNumber || ""} created · بن گئی`);
      load();
    } catch (e: any) { showFeedback("error", e.message); }
  };

  if (creating || editingId != null) {
    const back = () => { setCreating(false); setEditingId(null); };
    return (
      <div className="space-y-3">
        <button onClick={back} className="text-xs flex items-center gap-1.5 text-slate-600 hover:text-slate-900"><ArrowLeft className="w-3.5 h-3.5" /> Back to quotations</button>
        <NewQuotation showFeedback={showFeedback} editQuotationId={editingId ?? undefined} onCreated={(id) => { back(); load(); setViewId(id); }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2"><FileText className="w-4 h-4" /> Quotations <span className="text-[#9CA3AF] font-normal text-sm">· قیمتی تخمینے</span></h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">Send a rate quote to a company with a validity window; convert it to an invoice once accepted. · کسی کمپنی کو ریٹ کوٹ بھیجیں، مدتِ قبولیت کے ساتھ۔ منظور ہونے پر انوائس میں تبدیل کریں۔</p>
        </div>
        <div className="flex-1" />
        <button onClick={load} disabled={loading} className="h-9 px-3 rounded-lg border border-[#E5E7EB] bg-white text-sm flex items-center gap-1.5 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
        <ModuleDataIO entityKey="quotations" label="Quotations" onImported={load} />
        <button onClick={() => setCreating(true)} className="h-9 px-4 rounded-lg bg-[#24539B] text-white text-sm font-semibold flex items-center gap-1.5"><Plus className="w-4 h-4" /> New Quotation · نیا تخمینہ</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 border border-[#E5E7EB] rounded-lg px-2 bg-white flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number / company / route…" className="text-sm py-1.5 w-full outline-none" />
        </div>
        {["", "Draft", "Sent", "Accepted", "Rejected", "Expired"].map((s) => (
          <button key={s || "all"} onClick={() => setStatusFilter(s)} className={`text-xs rounded-full px-2.5 py-1 ${statusFilter === s ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}>{s || "All"}</button>
        ))}
      </div>

      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F9FAFB] text-[#6B7280]">
              <tr>
                <th className="text-left px-2 py-1.5">Quotation #</th>
                <th className="text-left px-2 py-1.5">Date</th>
                <th className="text-left px-2 py-1.5">Company</th>
                <th className="text-left px-2 py-1.5">Route</th>
                <th className="text-right px-2 py-1.5">Total</th>
                <th className="text-left px-2 py-1.5">Valid until</th>
                <th className="text-left px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-[#F3F4F6]">
                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap">{r.quotationNumber}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{d(r.quotationDate)}</td>
                  <td className="px-2 py-1.5" dir="auto">{r.clientCompany}</td>
                  <td className="px-2 py-1.5 text-slate-500">{[r.routeFrom, r.routeTo].filter(Boolean).join(" → ") || "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{PKR(r.totalAmount)}</td>
                  <td className={`px-2 py-1.5 whitespace-nowrap ${r.isExpired ? "text-[#B00005] font-semibold" : "text-slate-500"}`}>
                    <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {d(r.validUntil)}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    {r.convertedInvoiceId ? (
                      <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-[#E6ECF6] text-[#173563]">INVOICED</span>
                    ) : (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${r.isExpired ? "bg-[#FFE0E0] text-[#8C0004]" : STATUS_STYLE[r.status] || "bg-slate-100 text-slate-600"}`}>
                        {r.isExpired ? "EXPIRED" : (r.status || "").toUpperCase()}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-right">
                    <button onClick={() => setViewId(r.id)} className="text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 mr-2" title="View / Print / Download"><Printer className="w-3.5 h-3.5" /> View</button>
                    <button onClick={() => setEditingId(r.id)} className="text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 mr-2" title="Edit"><Pencil className="w-3.5 h-3.5" /> Edit</button>
                    {!r.convertedInvoiceId && (
                      <button onClick={() => convert(r.id, r)} className="text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 mr-2" title="Convert to invoice"><ArrowRightCircle className="w-3.5 h-3.5" /> To Invoice</button>
                    )}
                    <button onClick={() => del(r.id)} className="text-slate-400 hover:text-red-600 inline-flex items-center gap-1" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={8} className="px-2 py-8 text-center text-[#9CA3AF]">No quotations{q || statusFilter ? " match this filter" : " yet"}. Click <b>New Quotation</b> to make one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {viewId != null && <QuotationDocument quotationId={viewId} onClose={() => setViewId(null)} />}
    </div>
  );
}
