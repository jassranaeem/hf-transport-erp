/**
 * Partners — partner-owned trucks on a lease-to-own basis, in one place:
 * the partner, their agreement (price/advance/balance/share), and every
 * settlement against that agreement (revenue declared, expenses, what came
 * to the company, and the under-reporting check against GPS/fuel data).
 *
 * Backed by the dedicated /api/partnerships engine (not the generic grid) —
 * /partners, /agreements, /agreements/:id/ledger, /agreements/:id/settlements.
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import {
  Handshake, RefreshCw, Loader2, Plus, X, CheckCircle, ChevronDown, ChevronRight,
  AlertTriangle, TrendingUp, TrendingDown, FileText,
} from "lucide-react";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

const PKR = (n: number) => "PKR " + Math.round(Math.abs(n || 0)).toLocaleString();
const today = () => new Date().toISOString().slice(0, 10);

export default function Partners({ showFeedback }: { showFeedback: (t: "success" | "error", m: string) => void }) {
  const [partners, setPartners] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const [showAddPartner, setShowAddPartner] = useState(false);
  const [partnerForm, setPartnerForm] = useState({ name: "", cnic: "", phone: "", email: "", address: "", notes: "" });
  const [savingPartner, setSavingPartner] = useState(false);

  const [showAddAgreement, setShowAddAgreement] = useState(false);
  const [agreementForm, setAgreementForm] = useState({
    partnerId: "", vehicleId: "", agreedPrice: "", advancePaid: "", companySharePercent: "100", expenseRatioBenchmark: "55", startDate: today(), notes: "",
  });
  const [savingAgreement, setSavingAgreement] = useState(false);

  const [openId, setOpenId] = useState<number | null>(null);
  const [ledger, setLedger] = useState<Record<number, any>>({});
  const [ledgerLoading, setLedgerLoading] = useState<number | null>(null);

  const [showSettleFor, setShowSettleFor] = useState<number | null>(null);
  const [settleForm, setSettleForm] = useState<any>({ grossRevenue: "", expenses: [{ type: "Diesel", amount: "" }], periodFrom: "", periodTo: today(), notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      enterpriseFetch("/api/partnerships/partners").then(setPartners),
      enterpriseFetch("/api/partnerships/agreements").then(setAgreements),
      enterpriseFetch("/api/operations/vehicles?limit=500").then((r) => setVehicles(r?.data || r?.rows || [])).catch(() => {}),
      enterpriseFetch("/api/partnerships/summary").then(setSummary).catch(() => {}),
    ])
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(() => { load(); }, [load]);

  const addPartner = async () => {
    if (!partnerForm.name.trim()) { showFeedback("error", "Name required"); return; }
    setSavingPartner(true);
    try {
      await enterpriseFetch("/api/partnerships/partners", { method: "POST", body: JSON.stringify(partnerForm) });
      showFeedback("success", "Partner added");
      setPartnerForm({ name: "", cnic: "", phone: "", email: "", address: "", notes: "" });
      setShowAddPartner(false);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSavingPartner(false);
    }
  };

  const addAgreement = async () => {
    if (!agreementForm.partnerId || !agreementForm.vehicleId || !agreementForm.agreedPrice) {
      showFeedback("error", "Partner, vehicle and agreed price are required");
      return;
    }
    setSavingAgreement(true);
    try {
      await enterpriseFetch("/api/partnerships/agreements", { method: "POST", body: JSON.stringify(agreementForm) });
      showFeedback("success", "Agreement created");
      setAgreementForm({ partnerId: "", vehicleId: "", agreedPrice: "", advancePaid: "", companySharePercent: "100", expenseRatioBenchmark: "55", startDate: today(), notes: "" });
      setShowAddAgreement(false);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSavingAgreement(false);
    }
  };

  const openLedger = async (id: number) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (ledger[id]) return;
    setLedgerLoading(id);
    try {
      const r = await enterpriseFetch(`/api/partnerships/agreements/${id}/ledger`);
      setLedger((prev) => ({ ...prev, [id]: r }));
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setLedgerLoading(null);
    }
  };

  const submitSettlement = async (agreementId: number) => {
    if (!Number(settleForm.grossRevenue)) { showFeedback("error", "Gross revenue required"); return; }
    setSaving(true);
    try {
      const body = {
        ...settleForm,
        grossRevenue: Number(settleForm.grossRevenue),
        expenses: settleForm.expenses.filter((e: any) => Number(e.amount) > 0).map((e: any) => ({ type: e.type, amount: Number(e.amount) })),
      };
      const r = await enterpriseFetch(`/api/partnerships/agreements/${agreementId}/settlements`, { method: "POST", body: JSON.stringify(body) });
      if (r.analysis?.flags?.length) {
        showFeedback("error", `Settlement saved, but flagged: ${r.analysis.flags.join(", ")}`);
      } else {
        showFeedback("success", "Settlement recorded");
      }
      setShowSettleFor(null);
      setSettleForm({ grossRevenue: "", expenses: [{ type: "Diesel", amount: "" }], periodFrom: "", periodTo: today(), notes: "" });
      delete ledger[agreementId];
      setLedger({ ...ledger });
      openLedger(agreementId);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <Handshake className="w-4 h-4" /> Partners <span className="text-[#9CA3AF] font-normal text-sm">· شراکت دار</span>
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">Partner-owned trucks on lease-to-own — partner, agreement, and every settlement together.</p>
        </div>
        <div className="flex-1" />
        <button onClick={load} disabled={loading} className="h-9 px-3 rounded-lg border border-[#E5E7EB] bg-white text-sm flex items-center gap-1.5 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
        <ModuleDataIO entityKey="partner_agreements" label="Agreements" onImported={load} />
        <button onClick={() => setShowAddPartner((s) => !s)} className="h-9 px-3 rounded-lg border border-[#E5E7EB] bg-white text-sm font-semibold flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Partner
        </button>
        <button onClick={() => setShowAddAgreement((s) => !s)} className="h-9 px-4 rounded-lg bg-[#24539B] text-white text-sm font-semibold flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> New Agreement
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Big label="Active agreements" value={String(summary.activeCount ?? agreements.filter((a) => a.status === "Active").length)} tone="neutral" />
          <Big label="Total outstanding" value={PKR(summary.totalOutstanding ?? agreements.reduce((s, a) => s + (a.currentBalance || 0), 0))} tone="bad" />
          <Big label="Total recovered" value={PKR(summary.totalRecovered ?? agreements.reduce((s, a) => s + (a.recoveredAmount || 0), 0))} tone="good" />
          <Big label="Partners" value={String(partners.length)} tone="neutral" />
        </div>
      )}

      {showAddPartner && (
        <div className="rounded-lg border border-[#C9D7EC] bg-[#F2F5FA] p-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <Field label="Name *"><input value={partnerForm.name} onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })} className="border rounded px-2 py-1" /></Field>
            <Field label="CNIC"><input value={partnerForm.cnic} onChange={(e) => setPartnerForm({ ...partnerForm, cnic: e.target.value })} className="border rounded px-2 py-1" /></Field>
            <Field label="Phone"><input value={partnerForm.phone} onChange={(e) => setPartnerForm({ ...partnerForm, phone: e.target.value })} className="border rounded px-2 py-1" /></Field>
            <Field label="Email"><input value={partnerForm.email} onChange={(e) => setPartnerForm({ ...partnerForm, email: e.target.value })} className="border rounded px-2 py-1" /></Field>
            <Field label="Address" className="col-span-2"><input value={partnerForm.address} onChange={(e) => setPartnerForm({ ...partnerForm, address: e.target.value })} className="border rounded px-2 py-1" /></Field>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={addPartner} disabled={savingPartner} className="bg-[#24539B] text-white rounded px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5">
              {savingPartner ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Save Partner
            </button>
            <button onClick={() => setShowAddPartner(false)} className="border rounded px-3 py-1.5 text-xs flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel</button>
          </div>
        </div>
      )}

      {showAddAgreement && (
        <div className="rounded-lg border border-[#C9D7EC] bg-[#F2F5FA] p-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Field label="Partner *">
              <select value={agreementForm.partnerId} onChange={(e) => setAgreementForm({ ...agreementForm, partnerId: e.target.value })} className="border rounded px-2 py-1">
                <option value="">-- choose --</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Vehicle *">
              <select value={agreementForm.vehicleId} onChange={(e) => setAgreementForm({ ...agreementForm, vehicleId: e.target.value })} className="border rounded px-2 py-1">
                <option value="">-- choose --</option>
                {vehicles.map((v: any) => <option key={v.id} value={v.id}>{v.vehicleNumber || v.registration}</option>)}
              </select>
            </Field>
            <Field label="Agreed price (PKR) *"><input inputMode="numeric" value={agreementForm.agreedPrice} onChange={(e) => setAgreementForm({ ...agreementForm, agreedPrice: e.target.value.replace(/\D/g, "") })} className="border rounded px-2 py-1" /></Field>
            <Field label="Advance paid"><input inputMode="numeric" value={agreementForm.advancePaid} onChange={(e) => setAgreementForm({ ...agreementForm, advancePaid: e.target.value.replace(/\D/g, "") })} className="border rounded px-2 py-1" /></Field>
            <Field label="Company share %"><input inputMode="numeric" value={agreementForm.companySharePercent} onChange={(e) => setAgreementForm({ ...agreementForm, companySharePercent: e.target.value.replace(/\D/g, "") })} className="border rounded px-2 py-1" /></Field>
            <Field label="Expected expense ratio %"><input inputMode="numeric" value={agreementForm.expenseRatioBenchmark} onChange={(e) => setAgreementForm({ ...agreementForm, expenseRatioBenchmark: e.target.value.replace(/\D/g, "") })} className="border rounded px-2 py-1" /></Field>
            <Field label="Start date"><input type="date" value={agreementForm.startDate} onChange={(e) => setAgreementForm({ ...agreementForm, startDate: e.target.value })} className="border rounded px-2 py-1" /></Field>
            <Field label="Notes" className="col-span-2"><input value={agreementForm.notes} onChange={(e) => setAgreementForm({ ...agreementForm, notes: e.target.value })} className="border rounded px-2 py-1" /></Field>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={addAgreement} disabled={savingAgreement} className="bg-[#24539B] text-white rounded px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5">
              {savingAgreement ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Save Agreement
            </button>
            <button onClick={() => setShowAddAgreement(false)} className="border rounded px-3 py-1.5 text-xs flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel</button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA]">Agreements · {agreements.length}</div>
        <div className="divide-y divide-[#F3F4F6]">
          {agreements.map((a) => (
            <div key={a.id}>
              <button onClick={() => openLedger(a.id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-xs hover:bg-[#F9FAFB]">
                {openId === a.id ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                <span className="font-mono text-[#6B7280] w-28 shrink-0">{a.agreementNumber}</span>
                <span className="font-semibold w-32 shrink-0 truncate">{a.partnerName || "—"}</span>
                <span className="text-[#6B7280] w-24 shrink-0">{a.vehicleNumber || "—"}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${a.status === "Settled" ? "bg-[#E6ECF6] text-[#173563]" : "bg-[#F3F4F6] text-[#374151]"}`}>{a.status}</span>
                <span className="flex-1" />
                <span className="text-[#6B7280]">Outstanding</span>
                <span className="font-bold tabular-nums text-[#B00005] w-28 text-right">{PKR(a.currentBalance)}</span>
                <span className="text-[#6B7280] w-16 text-right">{a.recoveryPercent}%</span>
              </button>
              {openId === a.id && (
                <div className="px-3 pb-3 bg-[#FAFAFA]">
                  {ledgerLoading === a.id ? (
                    <div className="py-4 text-center text-[#9CA3AF] text-xs flex items-center justify-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
                  ) : ledger[a.id] ? (
                    <AgreementLedger
                      data={ledger[a.id]}
                      onSettle={() => setShowSettleFor(a.id)}
                      showSettleForm={showSettleFor === a.id}
                      settleForm={settleForm}
                      setSettleForm={setSettleForm}
                      onSubmitSettlement={() => submitSettlement(a.id)}
                      onCancelSettle={() => setShowSettleFor(null)}
                      saving={saving}
                    />
                  ) : null}
                </div>
              )}
            </div>
          ))}
          {agreements.length === 0 && <div className="px-3 py-8 text-center text-[#9CA3AF] text-xs">No agreements yet · ابھی کوئی معاہدہ نہیں</div>}
        </div>
      </div>
    </div>
  );
}

function AgreementLedger({ data, onSettle, showSettleForm, settleForm, setSettleForm, onSubmitSettlement, onCancelSettle, saving }: any) {
  const t = data.totals;
  return (
    <div className="space-y-3 pt-1">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <Big label="Declared revenue" value={PKR(t.totalDeclaredRevenue)} tone="neutral" />
        <Big label="Expenses" value={PKR(t.totalExpenses)} tone="bad" />
        <Big label="Net earnings" value={PKR(t.totalNet)} tone="neutral" />
        <Big label="Recovered" value={PKR(t.totalRecovered)} tone="good" />
        <Big label="Outstanding" value={PKR(t.outstanding)} tone="bad" />
      </div>
      {t.estimatedPartnerSkimToDate > 0 && (
        <div className="rounded-lg border border-[#FF9294] bg-[#FFF1F1] px-3 py-2 text-[11px] text-[#B00005] flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Possible under-reporting: expected revenue (GPS/fuel-based) runs ~{PKR(t.estimatedPartnerSkimToDate)} higher than what's been declared ({t.revenueUnderReportPercent}%).
        </div>
      )}

      {!showSettleForm ? (
        <button onClick={onSettle} className="text-xs font-semibold text-[#24539B] flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Record a settlement</button>
      ) : (
        <div className="rounded-lg border border-[#C9D7EC] bg-[#F2F5FA] p-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-2">
            <Field label="Gross revenue *"><input inputMode="numeric" value={settleForm.grossRevenue} onChange={(e: any) => setSettleForm({ ...settleForm, grossRevenue: e.target.value.replace(/\D/g, "") })} className="border rounded px-2 py-1" /></Field>
            <Field label="Period from"><input type="date" value={settleForm.periodFrom} onChange={(e: any) => setSettleForm({ ...settleForm, periodFrom: e.target.value })} className="border rounded px-2 py-1" /></Field>
            <Field label="Period to"><input type="date" value={settleForm.periodTo} onChange={(e: any) => setSettleForm({ ...settleForm, periodTo: e.target.value })} className="border rounded px-2 py-1" /></Field>
            <Field label="Notes"><input value={settleForm.notes} onChange={(e: any) => setSettleForm({ ...settleForm, notes: e.target.value })} className="border rounded px-2 py-1" /></Field>
          </div>
          <div className="text-[10px] text-[#6B7280] font-bold uppercase mb-1">Partner's declared expenses</div>
          {settleForm.expenses.map((ex: any, i: number) => (
            <div key={i} className="flex gap-2 mb-1">
              <input value={ex.type} onChange={(e: any) => { const arr = [...settleForm.expenses]; arr[i] = { ...arr[i], type: e.target.value }; setSettleForm({ ...settleForm, expenses: arr }); }} className="border rounded px-2 py-1 text-xs w-32" placeholder="Type" />
              <input inputMode="numeric" value={ex.amount} onChange={(e: any) => { const arr = [...settleForm.expenses]; arr[i] = { ...arr[i], amount: e.target.value.replace(/\D/g, "") }; setSettleForm({ ...settleForm, expenses: arr }); }} className="border rounded px-2 py-1 text-xs w-28" placeholder="Amount" />
            </div>
          ))}
          <button onClick={() => setSettleForm({ ...settleForm, expenses: [...settleForm.expenses, { type: "", amount: "" }] })} className="text-[11px] text-[#24539B] mb-2">+ add expense line</button>
          <div className="flex gap-2">
            <button onClick={onSubmitSettlement} disabled={saving} className="bg-[#24539B] text-white rounded px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Submit Settlement
            </button>
            <button onClick={onCancelSettle} className="border rounded px-3 py-1.5 text-xs flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel</button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-[#F9FAFB] text-[#6B7280]">
            <tr><th className="text-left px-2 py-1.5">Settlement</th><th className="text-left px-2 py-1.5">Period</th><th className="text-right px-2 py-1.5">Revenue</th><th className="text-right px-2 py-1.5">Expenses</th><th className="text-right px-2 py-1.5">To Company</th><th className="text-left px-2 py-1.5">Flags</th></tr>
          </thead>
          <tbody>
            {data.settlements.map((s: any) => (
              <tr key={s.id} className="border-t border-[#F3F4F6]">
                <td className="px-2 py-1.5 font-mono">{s.settlementNumber}</td>
                <td className="px-2 py-1.5 text-[#6B7280]">{s.periodFrom?.slice(0, 10)} → {s.periodTo?.slice(0, 10)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{PKR(s.grossRevenue)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-[#B00005]">{PKR(s.totalExpenses)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-[#1E4480]">{PKR(s.amountToCompany)}</td>
                <td className="px-2 py-1.5">
                  {s.flags?.length ? <span className="text-[#B00005] flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{s.flags.join(", ")}</span> : <CheckCircle className="w-3 h-3 text-[#1E4480]" />}
                </td>
              </tr>
            ))}
            {data.settlements.length === 0 && <tr><td colSpan={6} className="px-2 py-4 text-center text-[#9CA3AF]">No settlements recorded yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`flex flex-col text-[10px] text-slate-500 ${className || ""}`}>{label}{children}</label>;
}

function Big({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "neutral" }) {
  const c = tone === "good" ? "border-[#C9D7EC] bg-[#F2F5FA] text-[#1E4480]" : tone === "bad" ? "border-[#FFC2C3] bg-[#FFF1F1] text-[#B00005]" : "border-[#E5E7EB] bg-white text-[#1F2937]";
  return (
    <div className={`rounded-xl border p-2.5 ${c}`}>
      <div className="text-[9px] font-bold uppercase tracking-wide">{label}</div>
      <div className="text-base font-extrabold tabular-nums">{value}</div>
    </div>
  );
}
