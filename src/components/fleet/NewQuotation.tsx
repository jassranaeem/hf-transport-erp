/**
 * New Quotation — a rate quote ("qaraya nama") for a company that asked
 * "what's your rate?". Same letterhead as an invoice, plus a validity window
 * (default 10 days: "is rate ke hum sirf N din ke paband hain").
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import QuotationDocument from "./QuotationDocument.tsx";
import { FileText, Plus, Trash2, Loader2, CheckCircle, Building2 } from "lucide-react";

const PKR = (n: number) => "Rs " + Math.round(n || 0).toLocaleString("en-PK");
const today = () => new Date().toISOString().slice(0, 10);

type Line = { description: string; qty: string; unit: string; rate: string };
const BLANK_LINE: Line = { description: "", qty: "1", unit: "trip", rate: "" };

export default function NewQuotation({
  showFeedback,
  onCreated,
  editQuotationId,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
  onCreated?: (id: number) => void;
  editQuotationId?: number;
}) {
  const isEdit = !!editQuotationId;
  const [contractors, setContractors] = useState<any[]>([]);
  const [contractorId, setContractorId] = useState<number | "">("");

  const [f, setF] = useState<any>({
    quotationDate: today(),
    validityDays: "10",
    clientCompany: "",
    clientContactPerson: "",
    clientPhone: "",
    clientEmail: "",
    clientAddress: "",
    routeFrom: "",
    routeTo: "",
    vehicleType: "",
    rateBasis: "",
    cargoDescription: "",
    cargoWeightKg: "",
    notes: "",
  });
  const [lines, setLines] = useState<Line[]>([{ ...BLANK_LINE }]);
  const [busy, setBusy] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [quoteNumber, setQuoteNumber] = useState<string>("");

  useEffect(() => {
    enterpriseFetch(`/api/entities/contractors?limit=500&sort=company&dir=asc`).then((r) => setContractors(r.rows || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editQuotationId) return;
    enterpriseFetch(`/api/quotations/${editQuotationId}`)
      .then((d) => {
        setQuoteNumber(d.quotationNumber || "");
        setContractorId(d.contractorId || "");
        setF({
          quotationDate: d.quotationDate ? d.quotationDate.slice(0, 10) : today(),
          validityDays: String(d.validityDays ?? 3),
          clientCompany: d.clientCompany || "",
          clientContactPerson: d.clientContactPerson || "",
          clientPhone: d.clientPhone || "",
          clientEmail: d.clientEmail || "",
          clientAddress: d.clientAddress || "",
          routeFrom: d.routeFrom || "",
          routeTo: d.routeTo || "",
          vehicleType: d.vehicleType || "",
          rateBasis: d.rateBasis || "",
          cargoDescription: d.cargoDescription || "",
          cargoWeightKg: d.cargoWeightKg ? String(d.cargoWeightKg) : "",
          notes: d.notes || "",
        });
        setLines((d.linesJson || []).length ? d.linesJson.map((l: any) => ({ description: l.description || "", qty: String(l.qty ?? 1), unit: l.unit || "trip", rate: String(l.rate ?? 0) })) : [{ ...BLANK_LINE }]);
      })
      .catch((e) => showFeedback("error", e.message));
  }, [editQuotationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickContractor = (id: number | "") => {
    setContractorId(id);
    if (!id) return;
    const c = contractors.find((x) => x.id === id);
    if (c) setF((cur: any) => ({ ...cur, clientCompany: c.company, clientContactPerson: c.contactPerson, clientPhone: c.phone, clientEmail: c.email, clientAddress: c.address }));
  };

  const setLine = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const validUntil = new Date(new Date(f.quotationDate).getTime() + (Number(f.validityDays) || 3) * 86400000);

  const save = async () => {
    if (!f.clientCompany.trim() && !contractorId) { showFeedback("error", "Enter a client company name or choose an existing client. · کلائنٹ کمپنی کا نام لکھیں یا موجودہ کلائنٹ منتخب کریں۔"); return; }
    const goodLines = lines.filter((l) => l.description.trim() && (Number(l.rate) || 0) > 0)
      .map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 1, unit: l.unit || "trip", rate: Number(l.rate) || 0 }));
    if (!goodLines.length) { showFeedback("error", "Add at least one line item (description + rate). · کم از کم ایک لائن آئٹم (تفصیل + ریٹ) شامل کریں۔"); return; }

    setBusy(true);
    try {
      const body: any = {
        contractorId: contractorId || undefined,
        clientCompany: f.clientCompany || undefined,
        clientContactPerson: f.clientContactPerson || undefined,
        clientPhone: f.clientPhone || undefined,
        clientEmail: f.clientEmail || undefined,
        clientAddress: f.clientAddress || undefined,
        quotationDate: f.quotationDate,
        validityDays: Number(f.validityDays) || 3,
        routeFrom: f.routeFrom || undefined,
        routeTo: f.routeTo || undefined,
        vehicleType: f.vehicleType || undefined,
        rateBasis: f.rateBasis || undefined,
        cargoDescription: f.cargoDescription || undefined,
        cargoWeightKg: f.cargoWeightKg ? Number(f.cargoWeightKg) : undefined,
        notes: f.notes || undefined,
        lines: goodLines,
      };
      if (isEdit) {
        const r = await enterpriseFetch(`/api/quotations/${editQuotationId}`, { method: "PUT", body: JSON.stringify(body) });
        showFeedback("success", `Quotation ${r.quotationNumber || ""} updated · اپڈیٹ ہو گئی`);
        if (onCreated) onCreated(r.id); else setPreviewId(r.id);
      } else {
        const r = await enterpriseFetch(`/api/quotations`, { method: "POST", body: JSON.stringify(body) });
        showFeedback("success", `Quotation ${r.quotationNumber || ""} created — valid for ${f.validityDays} days · بن گئی`);
        if (onCreated) onCreated(r.id); else setPreviewId(r.id);
      }
    } catch (e: any) {
      showFeedback("error", e.message || "Could not save · محفوظ نہیں ہوا");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h2 className="text-base font-bold flex items-center gap-2">
          <FileText className="w-4 h-4" /> {isEdit ? "Edit Quotation" : "New Quotation"} <span className="text-[#9CA3AF] font-normal text-sm">· {isEdit ? "قیمت درست کریں" : "نیا قیمتی تخمینہ"}</span>
          {isEdit && quoteNumber && <span className="text-[10px] font-normal text-slate-400">({quoteNumber})</span>}
        </h2>
        <p className="text-[12px] text-[#6B7280]" dir="auto">
          Send a rate quote to the company that asked — letterhead, rates and how many days the rates hold. It does not post anything to the ledger or invoices. · ریٹ پوچھنے والی کمپنی کو کوٹیشن بھیجیں — لیٹر ہیڈ، ریٹ اور ریٹ کتنے دن قابلِ عمل ہیں۔ یہ لیجر / انوائس میں کچھ پوسٹ نہیں کرتا۔
        </p>
      </div>

      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 space-y-3">
        <div className="text-xs font-bold text-slate-600 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Quotation For · کس کمپنی کے لیے</div>
        <label className="flex flex-col text-[10px] text-slate-500">
          Existing client (optional) — or type a new name below · موجودہ کلائنٹ (اختیاری) — یا نیچے نیا نام لکھیں
          <select value={contractorId} onChange={(e) => pickContractor(e.target.value ? Number(e.target.value) : "")} className="border rounded px-2 py-1.5 text-sm text-slate-800">
            <option value="">— new / walk-in company —</option>
            {contractors.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          <Field label="Company name *"><input dir="auto" value={f.clientCompany} onChange={(e) => setF({ ...f, clientCompany: e.target.value })} className="i" /></Field>
          <Field label="Contact person"><input dir="auto" value={f.clientContactPerson} onChange={(e) => setF({ ...f, clientContactPerson: e.target.value })} className="i" /></Field>
          <Field label="Phone"><input value={f.clientPhone} onChange={(e) => setF({ ...f, clientPhone: e.target.value })} className="i" /></Field>
          <Field label="Email"><input value={f.clientEmail} onChange={(e) => setF({ ...f, clientEmail: e.target.value })} className="i" /></Field>
          <Field label="Address" wide><input dir="auto" value={f.clientAddress} onChange={(e) => setF({ ...f, clientAddress: e.target.value })} className="i" /></Field>
        </div>
      </section>

      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Field label="Quotation date · تاریخ"><input type="date" value={f.quotationDate} onChange={(e) => setF({ ...f, quotationDate: e.target.value })} className="i" /></Field>
        <Field label="Valid for (days) · کتنے دن پابند">
          <input inputMode="numeric" value={f.validityDays} onChange={(e) => setF({ ...f, validityDays: e.target.value.replace(/[^\d]/g, "") })} className="i font-semibold" />
        </Field>
        <Field label="Route from · سے"><input dir="auto" value={f.routeFrom} onChange={(e) => setF({ ...f, routeFrom: e.target.value })} className="i" /></Field>
        <Field label="Route to · تک"><input dir="auto" value={f.routeTo} onChange={(e) => setF({ ...f, routeTo: e.target.value })} className="i" /></Field>
        <Field label="Vehicle type"><input dir="auto" placeholder="40ft container / 10-wheeler" value={f.vehicleType} onChange={(e) => setF({ ...f, vehicleType: e.target.value })} className="i" /></Field>
        <Field label="Rate basis"><input dir="auto" placeholder="per trip / per ton" value={f.rateBasis} onChange={(e) => setF({ ...f, rateBasis: e.target.value })} className="i" /></Field>
        <Field label="Cargo weight (kg)"><input inputMode="numeric" value={f.cargoWeightKg} onChange={(e) => setF({ ...f, cargoWeightKg: e.target.value.replace(/[^\d]/g, "") })} className="i" /></Field>
        <Field label="Cargo description · مال کی تفصیل" wide><input dir="auto" value={f.cargoDescription} onChange={(e) => setF({ ...f, cargoDescription: e.target.value })} className="i" /></Field>
      </section>

      <div className="rounded-lg border border-[#C9D7EC] bg-[#F2F5FA] px-3 py-2 text-[12px] text-[#1E4480]" dir="auto">
        These rates hold for <b>{f.validityDays || 3} days</b> — until <b>{isNaN(validUntil.getTime()) ? "—" : validUntil.toLocaleDateString("en-GB")}</b>. After that the company is not bound to these rates. · اس کے بعد کمپنی ان ریٹس کی پابند نہیں۔
      </div>

      <section className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA]">Line items · تفصیل</div>
        <table className="w-full text-xs">
          <thead className="bg-[#F9FAFB] text-[#6B7280]">
            <tr>
              <th className="text-left px-2 py-1.5">Description</th>
              <th className="text-right px-2 py-1.5 w-16">Qty</th>
              <th className="text-left px-2 py-1.5 w-20">Unit</th>
              <th className="text-right px-2 py-1.5 w-28">Rate</th>
              <th className="text-right px-2 py-1.5 w-32">Amount</th>
              <th className="px-1"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-[#F3F4F6]">
                <td className="px-2 py-1"><input dir="auto" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} className="w-full border rounded px-2 py-1" placeholder="Freight — Karachi to Quetta" /></td>
                <td className="px-2 py-1"><input value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value.replace(/[^\d.]/g, ""))} className="w-full border rounded px-2 py-1 text-right" /></td>
                <td className="px-2 py-1"><input value={l.unit} onChange={(e) => setLine(i, "unit", e.target.value)} className="w-full border rounded px-2 py-1" /></td>
                <td className="px-2 py-1"><input value={l.rate} onChange={(e) => setLine(i, "rate", e.target.value.replace(/[^\d.]/g, ""))} className="w-full border rounded px-2 py-1 text-right" /></td>
                <td className="px-2 py-1 text-right tabular-nums">{PKR((Number(l.qty) || 0) * (Number(l.rate) || 0))}</td>
                <td className="px-1">{lines.length > 1 && <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-2 flex items-center justify-between">
          <button onClick={() => setLines((ls) => [...ls, { ...BLANK_LINE }])} className="text-xs flex items-center gap-1 text-emerald-700 font-semibold"><Plus className="w-3.5 h-3.5" /> Add line</button>
          <span className="text-sm font-bold">Quoted Total: {PKR(subtotal)}</span>
        </div>
      </section>

      <Field label="Notes"><input dir="auto" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="i" /></Field>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className="h-10 px-5 rounded-lg bg-[#24539B] text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} {isEdit ? "Save changes · تبدیلیاں محفوظ کریں" : "Create quotation · قیمت بنائیں"}
        </button>
      </div>

      <style>{`.i{border:1px solid #E5E7EB;border-radius:6px;padding:4px 8px;font-size:12px;width:100%}`}</style>

      {previewId != null && <QuotationDocument quotationId={previewId} onClose={() => setPreviewId(null)} />}
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col text-[10px] text-slate-500 ${wide ? "col-span-2 md:col-span-4" : ""}`}>
      <span dir="auto">{label}</span>
      {children}
    </label>
  );
}
