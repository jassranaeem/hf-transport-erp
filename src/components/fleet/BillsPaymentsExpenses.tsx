/**
 * Bills, Payments, and Expenses — three related money-out records that used
 * to live as separate workbook tabs, combined into one sheet with a simple
 * switch so they're easy to find together.
 *
 * The Bills tab also has "Pay bills": mark a vendor bill paid (or pay part of it), see the
 * payments made on it and undo a wrong one (POST / GET / DELETE /api/finance/bills/:id/payments).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Receipt, Wallet, ReceiptText, CheckCircle, History, Undo2, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import EntitySheet from "../sheets/EntitySheet.tsx";

const TABS = [
  { key: "bills", label: "Bills", icon: Receipt },
  { key: "payments", label: "Payments", icon: Wallet },
  { key: "expenses", label: "Expenses", icon: ReceiptText },
] as const;

type Feedback = (type: "success" | "error", message: string) => void;

export default function BillsPaymentsExpenses({ showFeedback }: { showFeedback: Feedback }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("bills");
  const [reload, setReload] = useState(0);

  return (
    <div className="h-full flex flex-col">
      <div className="flex gap-1 px-3 pt-3">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`text-xs font-semibold rounded-full px-3 py-1.5 flex items-center gap-1.5 ${
              tab === key ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>
      {tab === "bills" && <BillPayPanel showFeedback={showFeedback} onChanged={() => setReload((n) => n + 1)} />}
      <div className="flex-1 min-h-0 p-3">
        <React.Fragment key={`${tab}-${reload}`}>
          <EntitySheet entityKey={tab} title={TABS.find((t) => t.key === tab)!.label} showFeedback={showFeedback} />
        </React.Fragment>
      </div>
    </div>
  );
}

const PKR = (n: number) => "Rs " + Math.round(n || 0).toLocaleString("en-PK");
const fmt = (s: any) => (s ? new Date(s).toLocaleDateString("en-GB") : "—");
const STATUS: Record<string, string> = {
  Paid: "bg-[#DCFCE7] text-[#166534]",
  "Partially Paid": "bg-[#FEF3C7] text-[#92400E]",
  Unpaid: "bg-[#FEE2E2] text-[#991B1B]",
};

/** Vendor bills: paid / unpaid, pay (all or part), payment history with undo. */
function BillPayPanel({ showFeedback, onChanged }: { showFeedback: Feedback; onChanged: () => void }) {
  const [open, setOpen] = useState(true);
  const [bills, setBills] = useState<any[] | null>(null);
  const [payFor, setPayFor] = useState<{ id: number; amount: string; method: string; ref: string } | null>(null);
  const [histFor, setHistFor] = useState<number | null>(null);
  const [hist, setHist] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    enterpriseFetch("/api/finance/bills")
      .then((r) => setBills(Array.isArray(r) ? r : []))
      .catch((e) => showFeedback("error", e.message));
  }, []);
  useEffect(load, [load]);

  const after = () => {
    load();
    onChanged();
  };

  const pay = async (billId: number, amount: number, method: string, ref: string) => {
    setBusy(true);
    try {
      await enterpriseFetch(`/api/finance/bills/${billId}/payments`, { method: "POST", body: JSON.stringify({ paymentMethod: method, amount, referenceNumber: ref }) });
      showFeedback("success", "Payment recorded · ادائیگی درج");
      setPayFor(null);
      after();
      if (histFor === billId) openHistory(billId, true);
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };

  const openHistory = (id: number, keepOpen = false) => {
    if (histFor === id && !keepOpen) {
      setHistFor(null);
      return;
    }
    setHistFor(id);
    setHist(null);
    enterpriseFetch(`/api/finance/bills/${id}/payments`).then(setHist).catch((e) => { showFeedback("error", e.message); setHist([]); });
  };

  const undo = async (billId: number, p: any) => {
    if (!window.confirm(`Undo the payment of ${PKR(p.amount)} (${fmt(p.date)})? The bill becomes unpaid by that amount again. · یہ ادائیگی واپس لیں؟`)) return;
    try {
      const r = await enterpriseFetch(`/api/finance/bills/${billId}/payments/${p.id}`, { method: "DELETE" });
      showFeedback("success", `Payment undone — bill is now ${r.status} · واپس ہو گئی`);
      after();
      openHistory(billId, true);
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const list = (bills || []).slice(0, 30);
  return (
    <div className="mx-3 mt-3 rounded-xl border border-[#E5E7EB] bg-white text-xs">
      <button onClick={() => setOpen((v) => !v)} className="w-full px-3 py-2 font-bold bg-[#F2F5FA] rounded-t-xl flex items-center gap-1.5 text-left">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        Pay bills · بل ادا کریں
        <span className="font-normal text-[#6B7280]">— mark a vendor bill paid, pay part of it, see and undo payments (the table below edits / deletes bills)</span>
      </button>
      {open && (
        <div className="max-h-72 overflow-auto">
          {!bills ? (
            <div className="p-3 flex items-center gap-2 text-[#4B5563]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading bills…</div>
          ) : list.length === 0 ? (
            <div className="p-3 text-[#6B7280]">No vendor bills yet · ابھی کوئی بل نہیں</div>
          ) : (
            <table className="w-full">
              <tbody>
                {list.map((b) => (
                  <React.Fragment key={b.id}>
                    <tr className="border-t border-[#F3F4F6]">
                      <td className="px-3 py-1.5 font-semibold whitespace-nowrap">{b.billNumber}</td>
                      <td className="px-2 py-1.5" dir="auto">{b.vendorName}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-[#6B7280]">{fmt(b.billDate)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{PKR(b.amount)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${b.outstandingBalance > 0 ? "text-[#B91C1C]" : "text-[#166534]"}`}>{PKR(b.outstandingBalance)}</td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS[b.status] || "bg-slate-100 text-slate-600"}`}>{b.status}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap">
                        {b.outstandingBalance > 0 && (
                          <>
                            <button
                              disabled={busy}
                              onClick={() => window.confirm(`Mark ${b.billNumber} PAID — ${PKR(b.outstandingBalance)} paid to ${b.vendorName}? · مکمل ادا درج کریں؟`) && pay(b.id, b.outstandingBalance, "Cash", "Marked paid")}
                              className="text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 mr-2"
                            >
                              <CheckCircle className="w-3.5 h-3.5" /> Mark paid
                            </button>
                            <button onClick={() => setPayFor(payFor?.id === b.id ? null : { id: b.id, amount: String(b.outstandingBalance), method: "Cash", ref: "" })} className="text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 mr-2">
                              <Wallet className="w-3.5 h-3.5" /> Pay part
                            </button>
                          </>
                        )}
                        <button onClick={() => openHistory(b.id)} className="text-slate-500 hover:text-slate-900 inline-flex items-center gap-1">
                          <History className="w-3.5 h-3.5" /> Payments
                        </button>
                      </td>
                    </tr>
                    {payFor?.id === b.id && (
                      <tr className="bg-[#F0FDF4]">
                        <td colSpan={7} className="px-3 py-2">
                          <div className="flex items-end gap-2 flex-wrap">
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] text-[#6B7280]">Amount · رقم</span>
                              <input id={`bp-amt-${b.id}`} inputMode="numeric" value={payFor.amount} onChange={(e) => setPayFor({ ...payFor, amount: e.target.value.replace(/[^\d]/g, "") })} className="border rounded px-2 py-1 w-32 tabular-nums" />
                            </label>
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] text-[#6B7280]">How · طریقہ</span>
                              <select id={`bp-method-${b.id}`} value={payFor.method} onChange={(e) => setPayFor({ ...payFor, method: e.target.value })} className="border rounded px-2 py-1">
                                {["Cash", "Online", "Cheque", "Bank Transfer"].map((m) => <option key={m}>{m}</option>)}
                              </select>
                            </label>
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] text-[#6B7280]">Reference</span>
                              <input id={`bp-ref-${b.id}`} value={payFor.ref} onChange={(e) => setPayFor({ ...payFor, ref: e.target.value })} className="border rounded px-2 py-1" />
                            </label>
                            <button disabled={busy || !Number(payFor.amount)} onClick={() => pay(b.id, Number(payFor.amount), payFor.method, payFor.ref)} className="bg-emerald-600 text-white rounded px-3 py-1 font-semibold disabled:opacity-60">
                              Save · محفوظ
                            </button>
                            <button onClick={() => setPayFor(null)} className="underline text-[#4B5563]">Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {histFor === b.id && (
                      <tr className="bg-[#F9FAFB]">
                        <td colSpan={7} className="px-3 py-2">
                          {!hist ? (
                            <span className="text-[#6B7280] flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</span>
                          ) : hist.length === 0 ? (
                            <span className="text-[#6B7280]">No payments on this bill yet · ابھی کوئی ادائیگی نہیں</span>
                          ) : (
                            hist.map((p) => (
                              <div key={p.id} className="flex items-center gap-3 py-0.5">
                                <span className="whitespace-nowrap">{fmt(p.date)}</span>
                                <span className="tabular-nums font-semibold">{PKR(p.amount)}</span>
                                <span className="text-[#6B7280] flex-1" dir="auto">{p.description}</span>
                                <button onClick={() => undo(b.id, p)} className="inline-flex items-center gap-1 text-slate-500 hover:text-red-700">
                                  <Undo2 className="w-3.5 h-3.5" /> Undo · واپس
                                </button>
                              </div>
                            ))
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
