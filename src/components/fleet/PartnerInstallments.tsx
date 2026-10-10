/**
 * Instalments (qist) of a lease-to-own truck · قسطیں
 *
 *   price − advance = to be paid in instalments. It comes down two ways: an instalment the partner
 *   pays (cash / bank), and the truck's earnings settled against it. Both fill the plan's
 *   instalments oldest first, so the list shows which are paid, part-paid, overdue or still to come.
 */
import React, { useState } from "react";
import { CalendarClock, CheckCircle, Loader2, Plus, Undo2, AlertTriangle, X } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";

const PKR = (n: number) => "PKR " + Math.round(Math.abs(n || 0)).toLocaleString();
const dmy = (d?: string | null) => (d ? d.slice(0, 10).split("-").reverse().join(".") : "—");
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const TONE: Record<string, string> = {
  paid: "bg-[#DCFCE7] text-[#166534]",
  part: "bg-[#FEF3C7] text-[#92400E]",
  overdue: "bg-[#FEE2E2] text-[#991B1B]",
  upcoming: "bg-[#F1F4F9] text-[#4B5563]",
};
const LABEL: Record<string, string> = { paid: "Paid · ادا", part: "Part paid · کچھ ادا", overdue: "Overdue · باقی", upcoming: "To come · آئندہ" };

export default function PartnerInstallments({
  data,
  onChanged,
  onEditPlan,
  showFeedback,
}: {
  data: any;
  onChanged: () => void;
  onEditPlan: () => void;
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const ag = data.agreement;
  const sch = data.schedule;
  const paid: any[] = data.installments || [];
  const [show, setShow] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ amount: "", date: today(), method: "Cash", reference: "", notes: "", toCashBook: true });
  const recovered = ag.openingBalance - ag.currentBalance;
  const fromEarnings = Math.max(0, recovered - (data.totals.totalInstallments || 0));

  const open = () => {
    setF((x) => ({ ...x, amount: String(Math.min(ag.currentBalance, sch?.next?.amount || ag.installmentAmount || 0) || ""), date: today() }));
    setShow(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await enterpriseFetch(`/api/partnerships/agreements/${ag.id}/installments`, { method: "POST", body: JSON.stringify({ ...f, amount: Number(f.amount) }) });
      showFeedback("success", `Instalment received — ${PKR(r.currentBalance)} still to pay${r.cashBookEntry ? " · also in the Cash Book" : ""} · قسط وصول`);
      setShow(false);
      setF({ amount: "", date: today(), method: "Cash", reference: "", notes: "", toCashBook: true });
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const undo = async (i: any) => {
    if (!window.confirm(`Take back the instalment of ${PKR(i.amount)} (${dmy(i.pay_day)})?${i.cash_transaction_id ? " Its Cash Book entry is removed too." : ""} · واپس لیں؟`)) return;
    try {
      const r = await enterpriseFetch(`/api/partnerships/agreements/${ag.id}/installments/${i.id}`, { method: "DELETE" });
      showFeedback(r.warning ? "error" : "success", r.warning || "Taken back · واپس");
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white";
  const rows: any[] = sch?.rows || [];
  // by default: what is overdue / part-paid, the next few to come, and the last two paid
  const firstOpen = rows.findIndex((r) => r.status !== "paid");
  const visible = showAll || rows.length <= 8 ? rows : rows.slice(Math.max(0, (firstOpen < 0 ? rows.length : firstOpen) - 2), (firstOpen < 0 ? rows.length : firstOpen) + 6);

  return (
    <div className="rounded-xl border border-[#E3E8EF] bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#EEF1F5] flex flex-wrap items-center gap-2">
        <CalendarClock className="w-4 h-4 text-[#24539B]" />
        <span className="text-[13px] font-semibold text-[#1F2937]">Instalments · قسطیں</span>
        {sch ? (
          <span className="text-[12px] text-[#6B7280]">
            {PKR(ag.installmentAmount)} a month · {sch.paidCount} of {sch.count} paid{sch.lastDue ? ` · ends ${dmy(sch.lastDue)}` : ""}
          </span>
        ) : (
          <span className="text-[12px] text-[#B45309]">No plan yet — set the monthly amount and the first date</span>
        )}
        <span className="flex-1" />
        <button onClick={onEditPlan} className="text-[12px] text-[#24539B] hover:underline">{sch ? "Change plan" : "Set the plan · پلان"}</button>
        {ag.currentBalance > 0 && (
          <button onClick={open} className="inline-flex items-center gap-1 rounded-lg bg-[#24539B] text-white text-[12.5px] font-medium px-3 py-1.5 hover:bg-[#1E4480]">
            <Plus className="w-3.5 h-3.5" /> Receive instalment · قسط وصول
          </button>
        )}
      </div>

      {/* how the balance is made */}
      <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-[#EEF1F5] border-b border-[#EEF1F5] text-[12px]">
        {([
          ["Truck price · قیمت", PKR(ag.agreedPrice), ""],
          ["Advance · ایڈوانس", "− " + PKR(ag.advancePaid), ""],
          ["Instalments paid · قسطیں", "− " + PKR(data.totals.totalInstallments || 0), "text-[#166534]"],
          ["From truck earnings · کمائی سے", "− " + PKR(fromEarnings), "text-[#166534]"],
          ["Still to pay · باقی", PKR(ag.currentBalance), "text-[#B91C1C] font-semibold"],
        ] as const).map(([l, v, c]) => (
          <div key={l} className="px-3 py-2">
            <div className="text-[11px] text-[#6B7280]">{l}</div>
            <div className={`text-[14px] tabular-nums ${c || "text-[#111827]"}`}>{v}</div>
          </div>
        ))}
      </div>
      {ag.agreedPrice - ag.advancePaid !== ag.openingBalance && (
        <div className="px-4 py-1.5 text-[11.5px] text-[#B45309] bg-amber-50 border-b border-amber-100">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
          Price − advance is {PKR(ag.agreedPrice - ag.advancePaid)}, but this agreement started with {PKR(ag.openingBalance)} to pay (as imported). Open “Edit agreement” and save the right price / advance to correct it.
        </div>
      )}

      {sch && (sch.overdue > 0 || sch.ahead > 0 || sch.next) && (
        <div className={`px-4 py-2 text-[12.5px] border-b border-[#EEF1F5] ${sch.overdue > 0 ? "bg-[#FEF2F2] text-[#991B1B]" : "bg-[#F8FAFC] text-[#374151]"}`}>
          {sch.overdue > 0 ? (
            <><AlertTriangle className="w-3.5 h-3.5 inline mr-1" /><b>{PKR(sch.overdue)} overdue</b> — {sch.overdueCount} instalment(s) behind the plan · قسطیں باقی ہیں</>
          ) : sch.ahead > 0 ? (
            <><CheckCircle className="w-3.5 h-3.5 inline mr-1 text-[#166534]" />Ahead of the plan by {PKR(sch.ahead)} · پلان سے آگے</>
          ) : (
            <>On time · وقت پر</>
          )}
          {sch.next && <span className="text-[#6B7280]"> · next: instalment {sch.next.no}, {PKR(sch.next.amount)} on {dmy(sch.next.due)}</span>}
        </div>
      )}

      {show && (
        <div className="p-4 bg-[#F7F9FD] border-b border-[#EEF1F5]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className={lbl}>Amount received · رقم<input inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d]/g, "") })} className={`${inp} font-semibold tabular-nums`} autoFocus /></label>
            <label className={lbl}>Date · تاریخ<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inp} /></label>
            <label className={lbl}>How · طریقہ
              <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} className={inp}>{["Cash", "Online", "Cheque", "Bank Transfer"].map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label className={lbl}>Receipt / cheque no.<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} className={inp} /></label>
            <label className={`${lbl} col-span-2 md:col-span-4`}>Note<input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inp} dir="auto" /></label>
          </div>
          {f.method === "Cash" && (
            <label className="flex items-center gap-2 text-[12.5px] text-[#374151] mt-3">
              <input type="checkbox" checked={f.toCashBook} onChange={(e) => setF({ ...f, toCashBook: e.target.checked })} />
              Also write it in the Daily Cash Book as money in · کیش بک میں بھی درج کریں
            </label>
          )}
          {Number(f.amount) > 0 && <div className="text-[12px] text-[#6B7280] mt-2">Still to pay after this: <b>{PKR(Math.max(0, ag.currentBalance - Number(f.amount)))}</b>{Number(f.amount) > ag.currentBalance && <span className="text-red-600"> — more than is owed</span>}</div>}
          <div className="flex gap-2 mt-3">
            <button onClick={save} disabled={busy || !Number(f.amount)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#24539B] text-white text-[13px] font-medium px-3.5 py-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Save
            </button>
            <button onClick={() => setShow(false)} className="inline-flex items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white text-[13px] px-3.5 py-2"><X className="w-4 h-4" /> Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-0 xl:divide-x divide-[#EEF1F5]">
        {/* the plan */}
        <div>
          <div className="px-4 py-2 text-[12px] font-semibold text-[#374151] flex items-center gap-2">
            The plan · پلان
            {rows.length > 8 && <button onClick={() => setShowAll((s) => !s)} className="font-normal text-[#24539B] hover:underline">{showAll ? "show fewer" : `show all ${rows.length}`}</button>}
          </div>
          {!sch ? (
            <div className="px-4 pb-4 text-[12.5px] text-[#6B7280]">
              Set how much is paid each month and from which date — the instalments then show here with what is paid and what is overdue.
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]"><tr><th className="text-left px-4 py-1.5">#</th><th className="text-left px-3 py-1.5">Due · تاریخ</th><th className="text-right px-3 py-1.5">Instalment</th><th className="text-right px-3 py-1.5">Paid</th><th className="text-left px-3 py-1.5">Status</th></tr></thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.no} className="border-t border-[#F1F4F9]">
                    <td className="px-4 py-1.5 text-[#6B7280]">{r.no}</td>
                    <td className="px-3 py-1.5 tabular-nums">{dmy(r.due)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.amount.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.paid ? r.paid.toLocaleString() : ""}</td>
                    <td className="px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] ${TONE[r.status]}`}>{LABEL[r.status]}{r.status === "part" || (r.status === "overdue" && r.paid) ? ` (${(r.amount - r.paid).toLocaleString()} left)` : ""}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* what was actually received */}
        <div>
          <div className="px-4 py-2 text-[12px] font-semibold text-[#374151]">Instalments received · وصول شدہ ({paid.length})</div>
          {paid.length === 0 ? (
            <div className="px-4 pb-4 text-[12.5px] text-[#6B7280]">None yet. Press “Receive instalment” when the partner pays.</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]"><tr><th className="text-left px-4 py-1.5">Date</th><th className="text-left px-3 py-1.5">How</th><th className="text-right px-3 py-1.5">Amount</th><th className="px-3 py-1.5" /></tr></thead>
              <tbody>
                {[...paid].reverse().map((i) => (
                  <tr key={i.id} className="group border-t border-[#F1F4F9]">
                    <td className="px-4 py-1.5 tabular-nums">{dmy(i.pay_day)}</td>
                    <td className="px-3 py-1.5 text-[#4B5563]">{i.method}{i.reference ? ` · ${i.reference}` : ""}{i.cash_transaction_id ? " · in Cash Book" : ""}{i.notes ? <span className="text-[#9CA3AF]" dir="auto"> · {i.notes}</span> : null}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-[#166534]">{Number(i.amount).toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right"><button onClick={() => undo(i)} className="opacity-40 group-hover:opacity-100 text-[#6B7280] hover:text-red-600" title="Take back"><Undo2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
