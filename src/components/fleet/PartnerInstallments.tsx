/**
 * Paying off a lease-to-own truck · ٹرک کی قیمت کی ادائیگی (قسطیں)
 *
 *   A driver takes a truck at an agreed price (advance if any). The truck stays 100% the company's.
 *   After each trip: earnings − the trip's expenses = net, and the net goes to pay off the price —
 *   that is one qist. He may also pay cash. When nothing is left to pay he becomes a 50% partner
 *   (Partner P&L takes over).
 */
import React, { useState } from "react";
import { CalendarClock, CheckCircle, Loader2, Plus, Undo2, AlertTriangle, X, Truck, Wallet, Handshake, BookOpen, Trash2 } from "lucide-react";
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
type Nav = (wb: string, sheet: string, focus?: any) => void;

export default function PartnerInstallments({
  data,
  onChanged,
  onEditPlan,
  onNavigate,
  showFeedback,
}: {
  data: any;
  onChanged: () => void;
  onEditPlan: () => void;
  onNavigate?: Nav;
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const ag = data.agreement;
  const sch = data.schedule;
  const payments: any[] = data.payments || [];
  const share = ag.companySharePercent ?? 100;
  const [form, setForm] = useState<null | "trip" | "cash">(null);
  const [busy, setBusy] = useState(false);
  const [filling, setFilling] = useState(false);
  const [trip, setTrip] = useState<any>({ grossRevenue: "", expenses: [{ type: "Diesel", amount: "" }], periodFrom: "", periodTo: today(), notes: "", khataNote: "" });
  const [cash, setCash] = useState({ amount: "", date: today(), method: "Cash", reference: "", notes: "", toCashBook: true });
  const fromCash = data.totals.totalInstallments || 0;
  const fromTrips = Math.max(0, ag.openingBalance - ag.currentBalance - fromCash);
  const paidOff = ag.currentBalance <= 0;
  const pct = ag.agreedPrice > 0 ? Math.min(100, Math.round(((ag.agreedPrice - ag.currentBalance) / ag.agreedPrice) * 100)) : 100;
  const lastSettlementId = Math.max(0, ...payments.filter((p) => p.settlementId).map((p) => p.settlementId));

  // ---- a trip's earnings ------------------------------------------------------------------
  const fillFromKhata = async (from?: string, to?: string) => {
    setFilling(true);
    try {
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const r = await enterpriseFetch(`/api/partnerships/agreements/${ag.id}/khata-period?${q}`);
      setTrip((t: any) => ({
        ...t,
        periodFrom: r.from,
        periodTo: r.to,
        grossRevenue: r.revenue ? String(r.revenue) : t.grossRevenue,
        expenses: r.expenses.length ? r.expenses.map((e: any) => ({ type: e.type, amount: String(e.amount) })) : t.expenses,
        khataNote: r.entries ? `From the truck's khata, ${dmy(r.from)} – ${dmy(r.to)}: ${r.entries} entries — check the figures before saving` : `Nothing in the truck's khata between ${dmy(r.from)} and ${dmy(r.to)} — type the figures`,
      }));
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setFilling(false);
    }
  };
  const openTrip = () => {
    setForm("trip");
    setTrip({ grossRevenue: "", expenses: [{ type: "Diesel", amount: "" }], periodFrom: "", periodTo: today(), notes: "", khataNote: "" });
    fillFromKhata();
  };
  const gross = Number(trip.grossRevenue) || 0;
  const exp = trip.expenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
  const net = gross - exp;
  const toTruck = Math.min(Math.max(0, Math.round((net * share) / 100)), ag.currentBalance);
  const saveTrip = async () => {
    if (!gross) return showFeedback("error", "Enter what the truck earned (kiraya) · کرایہ لکھیں");
    setBusy(true);
    try {
      const r = await enterpriseFetch(`/api/partnerships/agreements/${ag.id}/settlements`, {
        method: "POST",
        body: JSON.stringify({
          grossRevenue: gross,
          expenses: trip.expenses.filter((e: any) => Number(e.amount) > 0).map((e: any) => ({ type: e.type || "Misc", amount: Number(e.amount) })),
          periodFrom: trip.periodFrom || undefined,
          periodTo: trip.periodTo || undefined,
          notes: trip.notes,
        }),
      });
      const left = r.agreement?.balanceAfter ?? 0;
      if (r.analysis?.flags?.length) showFeedback("error", `Saved — but check: ${r.analysis.flags.join(", ")}`);
      else showFeedback("success", left <= 0 ? "Saved — the truck is fully paid! · ٹرک کی قیمت پوری ہو گئی" : `Qist saved: ${PKR(r.settlement.amountToCompany)} — ${PKR(left)} still to pay · قسط درج`);
      setForm(null);
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };

  // ---- cash paid by him ----------------------------------------------------------------------
  const saveCash = async () => {
    setBusy(true);
    try {
      const r = await enterpriseFetch(`/api/partnerships/agreements/${ag.id}/installments`, { method: "POST", body: JSON.stringify({ ...cash, amount: Number(cash.amount) }) });
      showFeedback("success", `Received — ${PKR(r.currentBalance)} still to pay${r.cashBookEntry ? " · also in the Cash Book" : ""} · وصول`);
      setForm(null);
      setCash({ amount: "", date: today(), method: "Cash", reference: "", notes: "", toCashBook: true });
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const undo = async (p: any) => {
    const what = p.settlementId ? `trip qist ${p.label}` : `payment of ${PKR(p.amount)}`;
    if (!window.confirm(`Take back the ${what} (${dmy(p.date)})? · واپس لیں؟`)) return;
    try {
      const r = await enterpriseFetch(`/api/partnerships/agreements/${ag.id}/${p.settlementId ? `settlements/${p.settlementId}` : `installments/${p.installmentId}`}`, { method: "DELETE" });
      showFeedback(r.warning ? "error" : "success", r.warning || "Taken back · واپس");
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white";

  return (
    <div className="rounded-xl border border-[#E3E8EF] bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#EEF1F5] flex flex-wrap items-center gap-2">
        <CalendarClock className="w-4 h-4 text-[#24539B]" />
        <span className="text-[13px] font-semibold text-[#1F2937]">Paying off the truck · قسطیں</span>
        <span className="text-[12px] text-[#6B7280]">{payments.length} qist so far · each trip's earnings less its expenses pays the price</span>
        <span className="flex-1" />
        {!paidOff && (
          <>
            <button onClick={() => setForm(form === "cash" ? null : "cash")} className="inline-flex items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white text-[12.5px] px-3 py-1.5 hover:bg-[#F4F6FA]">
              <Wallet className="w-3.5 h-3.5" /> He paid cash · نقد دی
            </button>
            <button onClick={() => (form === "trip" ? setForm(null) : openTrip())} className="inline-flex items-center gap-1 rounded-lg bg-[#24539B] text-white text-[12.5px] font-medium px-3 py-1.5 hover:bg-[#1E4480]">
              <Truck className="w-3.5 h-3.5" /> Add a trip's earnings · ٹرپ کی کمائی
            </button>
          </>
        )}
      </div>

      {/* how the balance is made */}
      <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-[#EEF1F5] border-b border-[#EEF1F5] text-[12px]">
        {([
          ["Truck price · قیمت", PKR(ag.agreedPrice), ""],
          ["Advance · ایڈوانس", "− " + PKR(ag.advancePaid), ""],
          ["From trips · ٹرپ کی کمائی سے", "− " + PKR(fromTrips), "text-[#166534]"],
          ["Paid by him · خود دیے", "− " + PKR(fromCash), "text-[#166534]"],
          ["Still to pay · باقی", PKR(ag.currentBalance), paidOff ? "text-[#166534] font-semibold" : "text-[#B91C1C] font-semibold"],
        ] as const).map(([l, v, c]) => (
          <div key={l} className="px-3 py-2">
            <div className="text-[11px] text-[#6B7280]">{l}</div>
            <div className={`text-[14px] tabular-nums ${c || "text-[#111827]"}`}>{v}</div>
          </div>
        ))}
      </div>
      <div className="px-4 py-2 border-b border-[#EEF1F5]">
        <div className="h-2 rounded-full bg-[#EEF2F7] overflow-hidden"><div className="h-full bg-[#24539B]" style={{ width: `${pct}%`, backgroundColor: paidOff ? "#16A34A" : "#24539B" }} /></div>
        <div className="mt-1 text-[11.5px] text-[#6B7280] flex flex-wrap gap-x-4">
          <span><b className="text-[#374151]">{pct}%</b> of the price paid</span>
          <span>{paidOff ? "Fully paid" : `The truck is 100% the company's until it is paid — then he becomes a 50% partner · ادائیگی پوری ہونے تک کمپنی 100% مالک`}</span>
        </div>
      </div>
      {ag.agreedPrice - ag.advancePaid !== ag.openingBalance && (
        <div className="px-4 py-1.5 text-[11.5px] text-[#B45309] bg-amber-50 border-b border-amber-100">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
          Price − advance is {PKR(ag.agreedPrice - ag.advancePaid)}, but this agreement started with {PKR(ag.openingBalance)} to pay (as imported). Open “Edit agreement” and save the right price / advance to correct it.
        </div>
      )}

      {/* paid off → partnership */}
      {paidOff && (
        <div className="px-4 py-3 bg-[#F0FDF4] border-b border-[#BBF7D0] flex flex-wrap items-center gap-3">
          <Handshake className="w-5 h-5 text-[#166534]" />
          <div className="flex-1 min-w-[220px] text-[13px] text-[#14532D]">
            <b>The truck is fully paid{ag.closeDate ? ` (${dmy(ag.closeDate)})` : ""}.</b>{" "}
            {data.partnership ? `He is now a ${data.partnership.percent}% partner — the truck's profit is shared in Partner P&L.` : "He now becomes a 50% partner — start the partnership so the truck's profit is shared from here on. · اب 50% شراکت شروع کریں"}
          </div>
          {onNavigate && (data.partnership?.ledgerId || data.khataLedgerId) && (
            <button onClick={() => onNavigate("finance", "partner_pnl", { ledgerId: data.partnership?.ledgerId || data.khataLedgerId })} className="inline-flex items-center gap-1.5 rounded-lg bg-[#166534] text-white text-[12.5px] font-medium px-3 py-1.5" style={{ backgroundColor: "#166534", color: "#fff" }}>
              <Handshake className="w-3.5 h-3.5" /> {data.partnership ? "Open the partnership" : "Start the 50% partnership"} →
            </button>
          )}
        </div>
      )}

      {/* a trip's earnings */}
      {form === "trip" && (
        <div className="p-4 bg-[#F7F9FD] border-b border-[#EEF1F5]">
          <div className="flex flex-wrap items-end gap-3">
            <label className={lbl}>From · سے<input type="date" value={trip.periodFrom} onChange={(e) => setTrip({ ...trip, periodFrom: e.target.value })} className={inp} /></label>
            <label className={lbl}>To · تک<input type="date" value={trip.periodTo} onChange={(e) => setTrip({ ...trip, periodTo: e.target.value })} className={inp} /></label>
            <button onClick={() => fillFromKhata(trip.periodFrom, trip.periodTo)} disabled={filling} className="inline-flex items-center gap-1.5 rounded-lg border border-[#24539B] text-[#24539B] bg-white text-[12.5px] px-3 py-2 hover:bg-[#EAF0F8]">
              {filling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />} Fill from the truck's khata · کھاتے سے
            </button>
          </div>
          {trip.khataNote && <div className="text-[11.5px] text-[#6B7280] mt-1.5">{trip.khataNote}</div>}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
            <div className="space-y-3">
              <label className={lbl}>The truck earned (kiraya) · کرایہ<input inputMode="numeric" value={trip.grossRevenue} onChange={(e) => setTrip({ ...trip, grossRevenue: e.target.value.replace(/[^\d]/g, "") })} className={`${inp} font-semibold tabular-nums`} placeholder="0" /></label>
              <div>
                <div className="text-[11.5px] font-medium text-[#4B5563] mb-1">Expenses of the trip · ٹرپ کا خرچہ</div>
                {trip.expenses.map((ex: any, i: number) => (
                  <div key={i} className="flex gap-2 mb-1.5">
                    <input value={ex.type} onChange={(e) => { const a = [...trip.expenses]; a[i] = { ...a[i], type: e.target.value }; setTrip({ ...trip, expenses: a }); }} className={`${inp} flex-1`} placeholder="Diesel / toll / khurak…" dir="auto" />
                    <input inputMode="numeric" value={ex.amount} onChange={(e) => { const a = [...trip.expenses]; a[i] = { ...a[i], amount: e.target.value.replace(/[^\d]/g, "") }; setTrip({ ...trip, expenses: a }); }} className={`${inp} w-32 tabular-nums`} placeholder="0" />
                    <button onClick={() => setTrip({ ...trip, expenses: trip.expenses.filter((_: any, j: number) => j !== i) })} className="text-[#9CA3AF] hover:text-red-600" disabled={trip.expenses.length === 1}><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                <button onClick={() => setTrip({ ...trip, expenses: [...trip.expenses, { type: "", amount: "" }] })} className="text-[12px] text-[#24539B] hover:underline"><Plus className="w-3 h-3 inline" /> add an expense</button>
              </div>
              <label className={lbl}>Note<input value={trip.notes} onChange={(e) => setTrip({ ...trip, notes: e.target.value })} className={inp} placeholder="e.g. Quetta → Karachi, 2 trips" dir="auto" /></label>
            </div>
            {/* the sum, as it will be written */}
            <div className="rounded-xl border border-[#C9D7EC] bg-white p-4 text-[13px] self-start">
              <div className="flex justify-between py-1"><span className="text-[#6B7280]">Earned · کرایہ</span><span className="tabular-nums">{gross.toLocaleString()}</span></div>
              <div className="flex justify-between py-1"><span className="text-[#6B7280]">− Expenses · خرچہ</span><span className="tabular-nums text-[#B91C1C]">{exp.toLocaleString()}</span></div>
              <div className="flex justify-between py-1 border-t border-[#EEF1F5] font-semibold"><span>Net · بچت</span><span className={`tabular-nums ${net < 0 ? "text-[#B91C1C]" : ""}`}>{net.toLocaleString()}</span></div>
              <div className="flex justify-between py-1 mt-1 text-[#166534] font-semibold"><span>This qist — goes to the truck's price{share !== 100 ? ` (${share}%)` : ""}</span><span className="tabular-nums">{toTruck.toLocaleString()}</span></div>
              {net - toTruck > 0 && <div className="flex justify-between py-1 text-[#6B7280]"><span>He keeps</span><span className="tabular-nums">{(net - toTruck).toLocaleString()}</span></div>}
              <div className="flex justify-between py-1 border-t border-[#EEF1F5]"><span className="text-[#6B7280]">Still to pay after this · باقی</span><span className="tabular-nums font-semibold">{Math.max(0, ag.currentBalance - toTruck).toLocaleString()}</span></div>
              {net <= 0 && gross > 0 && <div className="text-[11.5px] text-[#B45309] mt-1">No net this time — nothing goes to the price; it is still saved so the trip is on record.</div>}
              {gross > 0 && exp / gross > (ag.expenseRatioBenchmark ?? 55) / 100 && (
                <div className="text-[11.5px] text-[#B45309] mt-1"><AlertTriangle className="w-3 h-3 inline mr-1" />Expenses are {Math.round((exp / gross) * 100)}% of the earnings — above the {ag.expenseRatioBenchmark ?? 55}% check. Look at the slips.</div>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={saveTrip} disabled={busy || !gross} className="inline-flex items-center gap-1.5 rounded-lg bg-[#24539B] text-white text-[13px] font-medium px-3.5 py-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Save this qist
            </button>
            <button onClick={() => setForm(null)} className="inline-flex items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white text-[13px] px-3.5 py-2"><X className="w-4 h-4" /> Cancel</button>
          </div>
        </div>
      )}

      {/* cash paid by him */}
      {form === "cash" && (
        <div className="p-4 bg-[#F7F9FD] border-b border-[#EEF1F5]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className={lbl}>Amount received · رقم<input inputMode="numeric" value={cash.amount} onChange={(e) => setCash({ ...cash, amount: e.target.value.replace(/[^\d]/g, "") })} className={`${inp} font-semibold tabular-nums`} autoFocus /></label>
            <label className={lbl}>Date · تاریخ<input type="date" value={cash.date} onChange={(e) => setCash({ ...cash, date: e.target.value })} className={inp} /></label>
            <label className={lbl}>How · طریقہ<select value={cash.method} onChange={(e) => setCash({ ...cash, method: e.target.value })} className={inp}>{["Cash", "Online", "Cheque", "Bank Transfer"].map((m) => <option key={m}>{m}</option>)}</select></label>
            <label className={lbl}>Receipt / cheque no.<input value={cash.reference} onChange={(e) => setCash({ ...cash, reference: e.target.value })} className={inp} /></label>
            <label className={`${lbl} col-span-2 md:col-span-4`}>Note<input value={cash.notes} onChange={(e) => setCash({ ...cash, notes: e.target.value })} className={inp} dir="auto" /></label>
          </div>
          {cash.method === "Cash" && (
            <label className="flex items-center gap-2 text-[12.5px] text-[#374151] mt-3">
              <input type="checkbox" checked={cash.toCashBook} onChange={(e) => setCash({ ...cash, toCashBook: e.target.checked })} />
              Also write it in the Daily Cash Book as money in · کیش بک میں بھی درج کریں
            </label>
          )}
          {Number(cash.amount) > 0 && <div className="text-[12px] text-[#6B7280] mt-2">Still to pay after this: <b>{PKR(Math.max(0, ag.currentBalance - Number(cash.amount)))}</b>{Number(cash.amount) > ag.currentBalance && <span className="text-red-600"> — more than is owed</span>}</div>}
          <div className="flex gap-2 mt-3">
            <button onClick={saveCash} disabled={busy || !Number(cash.amount)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#24539B] text-white text-[13px] font-medium px-3.5 py-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Save
            </button>
            <button onClick={() => setForm(null)} className="inline-flex items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white text-[13px] px-3.5 py-2"><X className="w-4 h-4" /> Cancel</button>
          </div>
        </div>
      )}

      {/* every qist, oldest first, with what was left after it */}
      {payments.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12.5px] text-[#6B7280]">
          No qist yet. When the truck comes back from a trip, press <b>Add a trip's earnings</b> — earnings less expenses goes to the truck's price. · ابھی کوئی قسط نہیں
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]">
              <tr><th className="text-left px-4 py-2">Qist</th><th className="text-left px-3 py-2">Date · تاریخ</th><th className="text-left px-3 py-2">From · کہاں سے</th><th className="text-right px-3 py-2">Paid · ادا</th><th className="text-right px-3 py-2">Left after · باقی</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.key} className="group border-t border-[#F1F4F9]">
                  <td className="px-4 py-2 text-[#6B7280]">{p.no}</td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{dmy(p.date)}</td>
                  <td className="px-3 py-2">
                    <div className="text-[#1F2937] flex items-center gap-1.5">{p.kind === "trip" ? <Truck className="w-3.5 h-3.5 text-[#24539B]" /> : <Wallet className="w-3.5 h-3.5 text-[#24539B]" />}{p.label}</div>
                    {p.detail && <div className="text-[11px] text-[#6B7280]" dir="auto">{p.detail}</div>}
                    {p.flags?.length > 0 && <div className="text-[11px] text-[#B91C1C]"><AlertTriangle className="w-3 h-3 inline mr-1" />{p.flags.join(", ")}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#166534]">{Number(p.amount).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(p.balanceAfter).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    {(p.installmentId || p.settlementId === lastSettlementId) && (
                      <button onClick={() => undo(p)} className="opacity-40 group-hover:opacity-100 text-[#6B7280] hover:text-red-600" title="Take back"><Undo2 className="w-3.5 h-3.5" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* an agreed monthly qist is optional */}
      <div className="px-4 py-2 border-t border-[#EEF1F5] text-[12px] text-[#6B7280]">
        {sch ? (
          <details>
            <summary className="cursor-pointer">
              Monthly plan: {PKR(ag.installmentAmount)} a month · {sch.paidCount} of {sch.count} covered
              {sch.overdue > 0 ? <span className="text-[#B91C1C] font-semibold"> · {PKR(sch.overdue)} behind</span> : sch.ahead > 0 ? <span className="text-[#166534]"> · ahead by {PKR(sch.ahead)}</span> : ""} ·{" "}
              <button onClick={(e) => { e.preventDefault(); onEditPlan(); }} className="text-[#24539B] hover:underline">change</button>
            </summary>
            <table className="w-full text-[12px] mt-2">
              <tbody>
                {sch.rows.map((r: any) => (
                  <tr key={r.no} className="border-t border-[#F1F4F9]">
                    <td className="py-1 pr-3 text-[#6B7280]">{r.no}</td>
                    <td className="py-1 pr-3 tabular-nums">{dmy(r.due)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{r.amount.toLocaleString()}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{r.paid ? r.paid.toLocaleString() : ""}</td>
                    <td className="py-1"><span className={`rounded-full px-2 py-0.5 text-[11px] ${TONE[r.status]}`}>{LABEL[r.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : (
          <>Was a fixed amount each month also agreed? <button onClick={onEditPlan} className="text-[#24539B] hover:underline">Set a monthly plan</button> (optional) — the list then shows if he is behind it.</>
        )}
      </div>
    </div>
  );
}
