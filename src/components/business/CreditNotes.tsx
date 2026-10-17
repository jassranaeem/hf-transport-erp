/**
 * Credit Notes · کریڈٹ نوٹ — what was taken off an invoice and will not be paid: a shortage the
 * customer deducted, a damage or late-delivery claim, a discount. The invoice keeps its amount;
 * what is still owed goes down, and the books show it as a freight deduction (4090).
 */
import React, { useEffect, useState } from "react";
import { ReceiptText, Plus, Trash2, Loader2 } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { PageHeader, Btn, Card, KpiStrip, SidePanel, Empty } from "../ui/kit.tsx";
import { pkr, dmy } from "../../lib/share.ts";

export function NewCreditNote({
  invoice,
  onClose,
  onSaved,
  showFeedback,
}: {
  invoice?: { id: number; invoiceNumber: string; contractorName?: string; outstandingBalance: number } | null;
  onClose: () => void;
  onSaved: () => void;
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [kinds, setKinds] = useState<string[]>(["Shortage", "Damage claim", "Late delivery", "Discount", "Rate difference", "Other"]);
  const [f, setF] = useState({ invoiceId: invoice?.id ? String(invoice.id) : "", amount: "", kind: "Shortage", noteDate: new Date().toISOString().slice(0, 10), reason: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!invoice) enterpriseFetch("/api/finance/invoices").then((r) => setInvoices((Array.isArray(r) ? r : r.data || r.invoices || []).filter((i: any) => i.outstandingBalance > 0))).catch(() => {});
    enterpriseFetch("/api/credit-notes").then((r) => r.kinds && setKinds(r.kinds)).catch(() => {});
  }, [invoice]);
  const pick = invoice || invoices.find((i) => String(i.id) === f.invoiceId);
  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white";
  const save = async () => {
    setSaving(true);
    try {
      await enterpriseFetch("/api/credit-notes", { method: "POST", body: JSON.stringify({ ...f, invoiceId: Number(f.invoiceId) }) });
      showFeedback("success", "Credit note saved — the invoice balance is lower now · کریڈٹ نوٹ محفوظ");
      onSaved();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <SidePanel title="New credit note · کریڈٹ نوٹ" subtitle="Money taken off an invoice that will not be paid" onClose={onClose}>
      <Card bodyClassName="p-4 space-y-3">
        {invoice ? (
          <div className="text-[13px]">
            Invoice <b>{invoice.invoiceNumber}</b> · {invoice.contractorName} · still owed <b className="text-[#B91C1C]">{pkr(invoice.outstandingBalance)}</b>
          </div>
        ) : (
          <label className={lbl}>
            Invoice · انوائس
            <select value={f.invoiceId} onChange={(e) => setF({ ...f, invoiceId: e.target.value })} className={inp}>
              <option value="">— choose an unpaid invoice —</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>{i.invoiceNumber} · {i.contractorName} · owed {Number(i.outstandingBalance).toLocaleString()}</option>
              ))}
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className={lbl}>Amount taken off · رقم<input inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d]/g, "") })} className={`${inp} font-semibold`} placeholder="0" /></label>
          <label className={lbl}>Date · تاریخ<input type="date" value={f.noteDate} onChange={(e) => setF({ ...f, noteDate: e.target.value })} className={inp} /></label>
          <label className={lbl}>Why · وجہ
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={inp}>{kinds.map((k) => <option key={k}>{k}</option>)}</select>
          </label>
          <label className={lbl}>Details · تفصیل<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className={inp} placeholder="e.g. 12 bags short at Karachi" dir="auto" /></label>
        </div>
        {pick && Number(f.amount) > 0 && (
          <div className="text-[12.5px] text-[#4B5563] bg-[#F8FAFC] rounded-lg px-3 py-2">
            Still owed after this: <b>{pkr(Math.max(0, pick.outstandingBalance - Number(f.amount)))}</b>
            {Number(f.amount) > pick.outstandingBalance && <span className="text-red-600"> — more than is owed</span>}
          </div>
        )}
      </Card>
      <div className="flex gap-2">
        <Btn kind="primary" onClick={save} disabled={saving || !f.invoiceId || !Number(f.amount)}>{saving ? "Saving…" : "Save credit note"}</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </SidePanel>
  );
}

export default function CreditNotes({ showFeedback }: { showFeedback: (t: "success" | "error", m: string) => void }) {
  const [list, setList] = useState<any[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const load = () => enterpriseFetch("/api/credit-notes").then((r) => setList(r.notes || [])).catch((e) => showFeedback("error", e.message));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const del = async (n: any) => {
    if (!window.confirm(`Take back credit note ${n.note_number} (${pkr(n.amount)})? The invoice will be owed this much again. · واپس لیں؟`)) return;
    try {
      await enterpriseFetch(`/api/credit-notes/${n.id}`, { method: "DELETE" });
      showFeedback("success", "Taken back · واپس");
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  const total = (list || []).reduce((s, n) => s + Number(n.amount), 0);
  const byKind: Record<string, number> = {};
  for (const n of list || []) byKind[n.kind] = (byKind[n.kind] || 0) + Number(n.amount);
  const top = Object.entries(byKind).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Credit Notes"
        urdu="کریڈٹ نوٹ"
        icon={<ReceiptText />}
        subtitle="Shortages, claims and discounts taken off invoices · انوائس سے کٹی ہوئی رقم"
        actions={<Btn kind="primary" onClick={() => setShowNew(true)} icon={<Plus />}>New credit note</Btn>}
      />
      <KpiStrip
        items={[
          { label: "Credit notes", value: (list || []).length },
          { label: "Total taken off · کل کٹوتی", value: pkr(total), tone: total ? "bad" : undefined },
          { label: "Most often · زیادہ تر", value: top ? top[0] : "—", sub: top ? pkr(top[1]) : undefined },
        ]}
      />
      <Card bodyClassName="">
        {list === null ? (
          <div className="p-8 text-center text-[#9CA3AF]"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
        ) : list.length === 0 ? (
          <Empty icon={<ReceiptText />} title="No credit notes yet" hint="When a customer pays less (shortage, claim, discount), record it here — the invoice then shows the right balance." action={<Btn kind="primary" onClick={() => setShowNew(true)} icon={<Plus />}>New credit note</Btn>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]">
                <tr className="border-b border-[#E3E8EF]"><th className="text-left px-3 py-2">Number</th><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Invoice</th><th className="text-left px-3 py-2">Customer</th><th className="text-left px-3 py-2">Why</th><th className="text-right px-3 py-2">Amount</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody>
                {list.map((n) => (
                  <tr key={n.id} className="group border-t border-[#F1F4F9] hover:bg-[#F8FAFC]">
                    <td className="px-3 py-2 font-semibold text-[#24539B]">{n.note_number}</td>
                    <td className="px-3 py-2 tabular-nums text-[#6B7280]">{dmy(n.note_date)}</td>
                    <td className="px-3 py-2">{n.invoice_number}</td>
                    <td className="px-3 py-2">{n.contractor_name}</td>
                    <td className="px-3 py-2"><span className="rounded-full bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 text-[11px]">{n.kind}</span> <span className="text-[#6B7280]" dir="auto">{n.reason}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#B91C1C]">{pkr(n.amount)}</td>
                    <td className="px-3 py-2 text-right"><button onClick={() => del(n)} className="opacity-40 group-hover:opacity-100 text-[#6B7280] hover:text-red-600 p-1" title="Take back"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {showNew && <NewCreditNote onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} showFeedback={showFeedback} />}
    </div>
  );
}
