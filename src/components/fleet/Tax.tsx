/**
 * Tax · ٹیکس — withholding tax registers and the year's tax summary. No tax rate is assumed:
 * the consultant fills "Rates"; filing on FBR (IRIS) is done by the company / consultant.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Receipt, Loader2, Plus, Trash2, Download, AlertTriangle, Save } from "lucide-react";
import { enterpriseFetch, downloadFile } from "../../../client/api.ts";

type Feedback = (type: "success" | "error", message: string) => void;
const PKR = (v: number | null | undefined) => (v == null ? "—" : (v < 0 ? "−" : "") + Math.abs(Math.round(v)).toLocaleString("en-US"));
const dmy = (d: any) => (d ? new Date(d).toISOString().slice(0, 10).split("-").reverse().join(".") : "");
const today = () => new Date().toISOString().slice(0, 10);

function years() {
  const now = new Date();
  const cur = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const out = [];
  for (let y = cur; y >= 2025; y--) out.push({ label: `FY ${y}-${String((y + 1) % 100).padStart(2, "0")} (tax year ${y + 1})`, from: `${y}-07-01`, to: `${y + 1}-06-30` });
  return out;
}

const TABS = [
  { k: "summary", l: "Year summary · سال کا خلاصہ" },
  { k: "deducted_from_us", l: "Deducted from us · ہم سے کٹا" },
  { k: "we", l: "We deducted & paid · ہم نے کاٹا اور جمع کیا" },
  { k: "rates", l: "Rates (consultant) · شرحیں" },
] as const;

export default function Tax({ showFeedback }: { showFeedback: Feedback }) {
  const ys = useMemo(years, []);
  const [fy, setFy] = useState(ys[0]);
  const [tab, setTab] = useState<(typeof TABS)[number]["k"]>("summary");
  const [summary, setSummary] = useState<any>(null);
  const [entries, setEntries] = useState<any[] | null>(null);
  const [rates, setRates] = useState<any[] | null>(null);
  const [opts, setOpts] = useState<{ contractors: any[]; parties: any[]; invoices: any[] }>({ contractors: [], parties: [], invoices: [] });

  const loadSummary = useCallback(() => {
    setSummary(null);
    enterpriseFetch(`/api/tax/summary?from=${fy.from}&to=${fy.to}`).then(setSummary).catch((e) => showFeedback("error", e.message));
  }, [fy, showFeedback]);
  const loadEntries = useCallback(() => {
    setEntries(null);
    enterpriseFetch(`/api/tax/entries?from=${fy.from}&to=${fy.to}`).then(setEntries).catch((e) => showFeedback("error", e.message));
  }, [fy, showFeedback]);
  const loadRates = useCallback(() => enterpriseFetch("/api/tax/rates").then(setRates).catch((e) => showFeedback("error", e.message)), [showFeedback]);
  useEffect(() => {
    loadSummary();
    loadEntries();
  }, [loadSummary, loadEntries]);
  useEffect(() => {
    loadRates();
    Promise.all([
      enterpriseFetch("/api/trip-desk/options").catch(() => ({ contractors: [] })),
      enterpriseFetch("/api/cash-book/link-options").catch(() => ({ parties: [] })),
      enterpriseFetch("/api/finance/invoices").catch(() => []),
    ]).then(([o, l, inv]) => setOpts({ contractors: o.contractors || [], parties: l.parties || [], invoices: Array.isArray(inv) ? inv : inv?.rows || [] }));
  }, [loadRates]);

  const refresh = () => {
    loadSummary();
    loadEntries();
  };
  const remove = async (e: any) => {
    if (!window.confirm(`Delete this tax entry (${PKR(e.tax_amount)})? · حذف کریں؟`)) return;
    try {
      await enterpriseFetch(`/api/tax/entries/${e.id}`, { method: "DELETE" });
      showFeedback("success", "Deleted · حذف");
      refresh();
    } catch (x: any) {
      showFeedback("error", x.message);
    }
  };
  const exportCsv = (kind: string) => downloadFile(`/api/tax/export?kind=${kind}&from=${fy.from}&to=${fy.to}`, `tax-${kind}.csv`).catch((e) => showFeedback("error", e.message));
  const rateLabel = (code: string) => (rates || []).find((r) => r.code === code)?.label?.split(" · ")[0] || code || "";

  return (
    <div className="p-3 space-y-4">
      <div>
        <h2 className="text-base font-bold flex items-center gap-2"><Receipt className="w-4 h-4" /> Tax <span className="text-[#9CA3AF] font-normal text-sm">· ٹیکس</span></h2>
        <p className="text-[12px] text-[#6B7280]" dir="auto">
          Withholding tax kept by customers and by us, payments to FBR, and the year's figures for the return. The system uses only the rates your tax consultant enters; filing on FBR is done by you / the consultant. ·
          شرحیں ٹیکس کنسلٹنٹ درج کریں گے؛ سسٹم خود کوئی شرح نہیں لگاتا۔
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select id="tax-fy" value={fy.from} onChange={(e) => setFy(ys.find((y) => y.from === e.target.value)!)} className="border rounded-lg px-2 py-1.5">
          {ys.map((y) => <option key={y.from} value={y.from}>{y.label}</option>)}
        </select>
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`rounded-full px-3 py-1.5 ${tab === t.k ? "bg-[#24539B] text-white" : "bg-[#F3F4F6] text-[#374151]"}`}>{t.l}</button>
        ))}
      </div>

      {tab === "summary" && (!summary ? <Wait /> : <Summary s={summary} />)}

      {tab === "deducted_from_us" && (
        <div className="space-y-3">
          <EntryForm kind="deducted_from_us" opts={opts} rates={rates || []} showFeedback={showFeedback} onSaved={refresh} />
          <Register title="Tax customers kept from our freight (our advance tax) · ہم سے کٹا ٹیکس" list={(entries || []).filter((e) => e.kind === "deducted_from_us")} loading={!entries} onDelete={remove} onExport={() => exportCsv("deducted_from_us")} rateLabel={rateLabel} />
        </div>
      )}

      {tab === "we" && (
        <div className="space-y-3">
          <EntryForm kind="we_deducted" opts={opts} rates={rates || []} showFeedback={showFeedback} onSaved={refresh} />
          <Register title="Tax we kept from payments (owed to FBR) · ہم نے کاٹا" list={(entries || []).filter((e) => e.kind === "we_deducted")} loading={!entries} onDelete={remove} onExport={() => exportCsv("we_deducted")} rateLabel={rateLabel} />
          <EntryForm kind="deposited" opts={opts} rates={rates || []} showFeedback={showFeedback} onSaved={refresh} />
          <Register title="Paid to FBR (CPR / challan) · ایف بی آر کو جمع" list={(entries || []).filter((e) => e.kind === "deposited")} loading={!entries} onDelete={remove} onExport={() => exportCsv("deposited")} rateLabel={rateLabel} />
        </div>
      )}

      {tab === "rates" && (!rates ? <Wait /> : <Rates rates={rates} showFeedback={showFeedback} onSaved={(r) => { setRates(r); loadSummary(); }} />)}
    </div>
  );
}

function Wait() {
  return <div className="text-sm text-[#6B7280] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
}

function Summary({ s }: { s: any }) {
  const Line = ({ l, v, strong, tone }: { l: string; v: number | null; strong?: boolean; tone?: "bad" | "good" }) => (
    <tr className="border-t border-[#F3F4F6]"><td className={`px-3 py-1.5 ${strong ? "font-bold" : ""}`}>{l}</td><td className={`px-3 py-1.5 text-right tabular-nums ${strong ? "font-bold" : ""} ${tone === "bad" ? "text-[#B91C1C]" : tone === "good" ? "text-[#166534]" : ""}`}>{PKR(v)}</td></tr>
  );
  return (
    <div className="space-y-3">
      {s.ratesMissing > 0 && (
        <div className="rounded-xl border border-[#FCD34D] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E] flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {s.ratesMissing} tax rate(s) not entered yet — ask the tax consultant to fill “Rates”. Until then no estimate is made.</div>
      )}
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <table className="w-full text-xs">
          <tbody>
            <tr className="bg-[#F2F5FA]"><td colSpan={2} className="px-3 py-1.5 font-semibold text-[#1E3A6E]">From the books · کتاب سے</td></tr>
            <Line l="Turnover (freight & other operating income) · کل آمدن" v={s.turnover} />
            <Line l="Profit per books (before tax) · کتاب کے مطابق منافع" v={s.profit} tone={s.profit < 0 ? "bad" : undefined} />
            <Line l="Sales tax charged on invoices · انوائس پر سیلز ٹیکس" v={s.salesTaxCharged} />
            <tr className="bg-[#F2F5FA]"><td colSpan={2} className="px-3 py-1.5 font-semibold text-[#1E3A6E]">Tax already paid in advance · پہلے سے ادا ٹیکس</td></tr>
            <Line l="Deducted by customers (register) · کسٹمرز نے کاٹا" v={s.deductedFromUs} />
            <Line l="Deducted by banks (statement lines marked tax) · بینک نے کاٹا" v={s.deductedByBank} />
            <Line l="Advance tax in the books (all of the above) · کتاب میں ایڈوانس ٹیکس" v={s.advanceTaxInBooks} strong />
            {s.deductedFromUsNoCertificate > 0 && <tr><td colSpan={2} className="px-3 py-1 text-[#92400E]">{s.deductedFromUsNoCertificate} deduction(s) without a certificate number — get the certificates.</td></tr>}
            <tr className="bg-[#F2F5FA]"><td colSpan={2} className="px-3 py-1.5 font-semibold text-[#1E3A6E]">Tax we kept from others · ہم نے کاٹا</td></tr>
            <Line l="Deducted by us · کاٹا" v={s.weDeducted} />
            <Line l="Paid to FBR · جمع کرایا" v={s.deposited} />
            <Line l="Not yet paid to FBR · ابھی جمع نہیں" v={s.notDeposited} strong tone={s.notDeposited > 0 ? "bad" : "good"} />
            <tr className="bg-[#F2F5FA]"><td colSpan={2} className="px-3 py-1.5 font-semibold text-[#1E3A6E]">Estimate · اندازہ</td></tr>
            {s.corporateRate == null ? (
              <tr><td colSpan={2} className="px-3 py-1.5 text-[#6B7280]">Company tax rate not entered — no estimate. (Ask the consultant to fill “Rates”.)</td></tr>
            ) : (
              <>
                <Line l={`Tax at ${s.corporateRate}% of profit per books (estimate only — the consultant works out taxable income)`} v={s.estimatedTax} />
                <Line l="Less advance tax already paid → left to pay (or refund if negative)" v={s.estimatedAfterAdvance} strong />
              </>
            )}
          </tbody>
        </table>
      </div>
      {s.months.length > 0 && (
        <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[#6B7280] bg-[#F9FAFB]"><tr><th className="text-left px-3 py-1.5">Month</th><th className="text-right px-2">We deducted</th><th className="text-right px-2">Paid to FBR</th><th className="text-right px-3">Pending</th></tr></thead>
            <tbody>
              {s.months.map((m: any) => (
                <tr key={m.month} className="border-t border-[#F3F4F6]"><td className="px-3 py-1">{m.month}</td><td className="px-2 text-right tabular-nums">{PKR(m.withheld)}</td><td className="px-2 text-right tabular-nums">{PKR(m.deposited)}</td><td className={`px-3 text-right tabular-nums font-semibold ${m.pending > 0 ? "text-[#B91C1C]" : "text-[#166534]"}`}>{m.pending > 0 ? PKR(m.pending) : "✓"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-[#6B7280]" dir="auto">These figures are for the consultant's return working. Taxable income can differ from book profit (tax depreciation, inadmissible expenses); the consultant decides. · یہ اعداد کنسلٹنٹ کے لیے ہیں۔</p>
    </div>
  );
}

function Register({ title, list, loading, onDelete, onExport, rateLabel }: { title: string; list: any[]; loading: boolean; onDelete: (e: any) => void; onExport: () => void; rateLabel: (c: string) => string }) {
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white">
      <div className="px-3 py-2 text-xs font-bold flex items-center gap-2">
        {title}
        <span className="font-normal text-[#6B7280]">— {list.length} · total {PKR(list.reduce((s, e) => s + Number(e.tax_amount), 0))}</span>
        <button onClick={onExport} className="ml-auto inline-flex items-center gap-1 font-normal text-[#24539B]"><Download className="w-3.5 h-3.5" /> CSV for the consultant</button>
      </div>
      {loading ? <div className="px-3 pb-3"><Wait /></div> : list.length === 0 ? <div className="px-3 pb-3 text-xs text-[#6B7280]">Nothing entered for this year.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[#6B7280] bg-[#F9FAFB]"><tr><th className="text-left px-3 py-1.5">Date</th><th className="text-left px-2">Who</th><th className="text-left px-2">Type</th><th className="text-right px-2">Gross</th><th className="text-right px-2">Tax</th><th className="text-left px-2">Certificate / CPR</th><th /></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="border-t border-[#F3F4F6]">
                  <td className="px-3 py-1.5 whitespace-nowrap">{dmy(e.entry_date)}{e.for_month ? <span className="text-[#9CA3AF]"> · for {e.for_month}</span> : null}</td>
                  <td className="px-2" dir="auto">{e.party_name || e.customer || e.party || "—"}{e.invoice_number ? <span className="text-[#9CA3AF]"> · {e.invoice_number}</span> : null}{e.ntn_cnic ? <span className="text-[#9CA3AF]"> · {e.ntn_cnic}</span> : null}</td>
                  <td className="px-2">{rateLabel(e.rate_code)}</td>
                  <td className="px-2 text-right tabular-nums">{e.gross_amount ? PKR(Number(e.gross_amount)) : ""}</td>
                  <td className="px-2 text-right tabular-nums font-semibold">{PKR(Number(e.tax_amount))}</td>
                  <td className="px-2">{e.certificate_no || e.cpr_no || <span className="text-[#92400E]">{e.kind === "deducted_from_us" ? "no certificate yet" : e.kind === "deposited" ? "no CPR" : ""}</span>}</td>
                  <td className="px-2 text-right"><button onClick={() => onDelete(e)} className="text-[#6B7280] hover:text-[#B91C1C]" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const KIND_TEXT: Record<string, { title: string; who: string }> = {
  deducted_from_us: { title: "Add: a customer kept tax from our payment · کسٹمر نے ٹیکس کاٹا", who: "Customer" },
  we_deducted: { title: "Add: we kept tax when paying someone · ہم نے ٹیکس کاٹا", who: "Paid to (party)" },
  deposited: { title: "Add: tax paid to FBR · ایف بی آر کو جمع", who: "" },
};

function EntryForm({ kind, opts, rates, showFeedback, onSaved }: { kind: string; opts: any; rates: any[]; showFeedback: Feedback; onSaved: () => void }) {
  const blank = { entryDate: today(), forMonth: today().slice(0, 7), rateCode: kind === "deducted_from_us" ? "freight_received" : kind === "we_deducted" ? "services_paid" : "", contractorId: "", invoiceId: "", partyId: "", partyName: "", ntnCnic: "", grossAmount: "", taxAmount: "", certificateNo: "", cprNo: "", notes: "" };
  const [f, setF] = useState<any>(blank);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rate = rates.find((r) => r.code === f.rateCode);
  const auto = !f.taxAmount && f.grossAmount && rate?.rate != null ? Math.round((Number(f.grossAmount) * Number(rate.rate)) / 100) : null;
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    setBusy(true);
    try {
      await enterpriseFetch("/api/tax/entries", { method: "POST", body: JSON.stringify({ ...f, kind }) });
      showFeedback("success", "Saved · محفوظ");
      setF(blank);
      setOpen(false);
      onSaved();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const t = KIND_TEXT[kind];
  const input = "border rounded px-2 py-1 w-full";
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white">
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left px-3 py-2 text-xs font-semibold flex items-center gap-1.5 text-[#24539B]"><Plus className="w-3.5 h-3.5" /> {t.title}</button>
      {open && (
        <div className="px-3 pb-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <L label="Date"><input id={`tx-${kind}-date`} type="date" value={f.entryDate} onChange={(e) => set("entryDate", e.target.value)} className={input} /></L>
          {kind === "deposited" ? (
            <>
              <L label="For month (deductions of)"><input id={`tx-${kind}-month`} type="month" value={f.forMonth} onChange={(e) => set("forMonth", e.target.value)} className={input} /></L>
              <L label="CPR / challan no"><input id={`tx-${kind}-cpr`} value={f.cprNo} onChange={(e) => set("cprNo", e.target.value)} className={input} /></L>
            </>
          ) : (
            <L label="Type">
              <select id={`tx-${kind}-type`} value={f.rateCode} onChange={(e) => set("rateCode", e.target.value)} className={input}>
                {rates.filter((r) => r.code !== "corporate").map((r) => <option key={r.code} value={r.code}>{r.label.split(" · ")[0]}{r.rate != null ? ` (${r.rate}%)` : ""}</option>)}
              </select>
            </L>
          )}
          {kind === "deducted_from_us" && (
            <>
              <L label="Customer">
                <select id={`tx-${kind}-cust`} value={f.contractorId} onChange={(e) => set("contractorId", e.target.value)} className={input}>
                  <option value="">—</option>
                  {opts.contractors.map((c: any) => <option key={c.id} value={c.id}>{c.company}</option>)}
                </select>
              </L>
              <L label="Invoice (optional)">
                <select id={`tx-${kind}-inv`} value={f.invoiceId} onChange={(e) => set("invoiceId", e.target.value)} className={input}>
                  <option value="">—</option>
                  {opts.invoices.filter((i: any) => !f.contractorId || String(i.contractorId) === String(f.contractorId)).map((i: any) => <option key={i.id} value={i.id}>{i.invoiceNumber} · {PKR(i.totalAmount)}</option>)}
                </select>
              </L>
              <L label="Certificate no"><input id={`tx-${kind}-cert`} value={f.certificateNo} onChange={(e) => set("certificateNo", e.target.value)} className={input} /></L>
            </>
          )}
          {kind === "we_deducted" && (
            <>
              <L label="Paid to (party)">
                <select id={`tx-${kind}-party`} value={f.partyId} onChange={(e) => set("partyId", e.target.value)} className={input}>
                  <option value="">— type the name instead —</option>
                  {opts.parties.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </L>
              {!f.partyId && <L label="Name"><input id={`tx-${kind}-name`} value={f.partyName} onChange={(e) => set("partyName", e.target.value)} className={input} dir="auto" /></L>}
              <L label="NTN / CNIC"><input id={`tx-${kind}-ntn`} value={f.ntnCnic} onChange={(e) => set("ntnCnic", e.target.value)} className={input} /></L>
            </>
          )}
          {kind !== "deposited" && <L label="Gross amount (before tax)"><input id={`tx-${kind}-gross`} inputMode="numeric" value={f.grossAmount} onChange={(e) => set("grossAmount", e.target.value.replace(/\D/g, ""))} className={input} /></L>}
          <L label={auto != null ? `Tax (rate gives ${PKR(auto)})` : "Tax amount"}><input id={`tx-${kind}-tax`} inputMode="numeric" value={f.taxAmount} placeholder={auto != null ? String(auto) : ""} onChange={(e) => set("taxAmount", e.target.value.replace(/\D/g, ""))} className={input} /></L>
          <L label="Note"><input id={`tx-${kind}-note`} value={f.notes} onChange={(e) => set("notes", e.target.value)} className={input} dir="auto" /></L>
          <div className="flex items-end">
            <button disabled={busy} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-[#24539B] text-white px-4 py-1.5 font-semibold disabled:opacity-60">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-0.5"><span className="text-[10px] text-[#6B7280]">{label}</span>{children}</label>;
}

function Rates({ rates, showFeedback, onSaved }: { rates: any[]; showFeedback: Feedback; onSaved: (r: any[]) => void }) {
  const [edit, setEdit] = useState<Record<string, any>>(() => Object.fromEntries<any>(rates.map((r) => [r.code, { rate: r.rate ?? "", section: r.section ?? "", notes: r.notes ?? "" }])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await enterpriseFetch("/api/tax/rates", { method: "PUT", body: JSON.stringify(Object.entries(edit).map(([code, v]) => ({ code, ...(v as object) }))) });
      showFeedback("success", "Rates saved · محفوظ");
      onSaved(r);
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-3 space-y-2 text-xs">
      <p className="text-[#6B7280]" dir="auto">For the tax consultant: enter the rate (%) and the section of the law for each line, as they apply to HFK Enterprises (Pvt) Ltd this year. Leave a line empty if it does not apply. Rates change with each budget — check them every July. · ہر بجٹ کے بعد شرحیں چیک کریں۔</p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="text-[#6B7280]"><tr><th className="text-left py-1">Tax</th><th className="text-left">Rate %</th><th className="text-left">Section</th><th className="text-left">Note</th></tr></thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.code} className="border-t border-[#F3F4F6]">
                <td className="py-1 pr-2" dir="auto">{r.label}</td>
                <td className="pr-2"><input id={`rate-${r.code}`} inputMode="decimal" value={edit[r.code]?.rate ?? ""} onChange={(e) => setEdit({ ...edit, [r.code]: { ...edit[r.code], rate: e.target.value.replace(/[^\d.]/g, "") } })} className="border rounded px-2 py-1 w-20 tabular-nums" /></td>
                <td className="pr-2"><input id={`sec-${r.code}`} value={edit[r.code]?.section ?? ""} onChange={(e) => setEdit({ ...edit, [r.code]: { ...edit[r.code], section: e.target.value } })} className="border rounded px-2 py-1 w-32" /></td>
                <td><input id={`note-${r.code}`} value={edit[r.code]?.notes ?? ""} onChange={(e) => setEdit({ ...edit, [r.code]: { ...edit[r.code], notes: e.target.value } })} className="border rounded px-2 py-1 w-full" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button disabled={busy} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-[#24539B] text-white px-4 py-1.5 font-semibold disabled:opacity-60">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save rates</button>
    </div>
  );
}
