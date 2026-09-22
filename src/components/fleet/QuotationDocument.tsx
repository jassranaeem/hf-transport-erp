/**
 * Printable Quotation ("qaraya nama") — a rate quote with a validity window.
 * Same letterhead/logo as an invoice; explicitly says how many days the
 * quoted rate is held for.
 */
import React, { useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Printer, X, Loader2, Clock } from "lucide-react";

interface Seller {
  tradeName?: string; legalName?: string; tagline?: string; addressLines?: string; city?: string;
  country?: string; phones?: string[]; email?: string; website?: string; ntn?: string; strn?: string;
  logoDataUrl?: string | null;
}
interface Line { description: string; qty: number; unit: string; rate: number; amount: number }
interface QuotationFull {
  id: number; quotationNumber: string; quotationDate: string; validUntil: string; validityDays: number; status: string;
  clientCompany: string; clientContactPerson: string | null; clientPhone: string | null; clientEmail: string | null; clientAddress: string | null;
  routeFrom: string | null; routeTo: string | null; cargoDescription: string | null; cargoWeightKg: number | null;
  vehicleType: string | null; rateBasis: string | null; linesJson: Line[]; subtotal: number; totalAmount: number;
  notes: string | null; sellerSnapshotJson: Seller | null; isExpired: boolean;
}

const money = (n: number) => "Rs " + Math.round(n || 0).toLocaleString("en-PK");
const d = (s: string) => (s ? new Date(s).toLocaleDateString("en-GB") : "—");

function amountInWords(num: number): string {
  num = Math.round(num || 0);
  if (num === 0) return "Zero Rupees Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number): string => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + ones[n % 10] : ""}`);
  const three = (n: number): string => {
    const h = Math.floor(n / 100), r = n % 100;
    return `${h ? ones[h] + " Hundred" + (r ? " " : "") : ""}${r ? two(r) : ""}`;
  };
  const parts: string[] = [];
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const hundred = num;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${three(lakh)} Lakh`);
  if (thousand) parts.push(`${three(thousand)} Thousand`);
  if (hundred) parts.push(three(hundred));
  return parts.join(" ").replace(/\s+/g, " ").trim() + " Rupees Only";
}

export default function QuotationDocument({ quotationId, onClose }: { quotationId: number; onClose: () => void }) {
  const [q, setQ] = useState<QuotationFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fallbackLogo, setFallbackLogo] = useState<string | null>(null);

  useEffect(() => {
    enterpriseFetch(`/api/quotations/${quotationId}`).then(setQ).catch((e) => setErr(e.message || "Failed to load quotation"));
  }, [quotationId]);

  const s = q?.sellerSnapshotJson || {};

  useEffect(() => {
    if (q && !s.logoDataUrl && !fallbackLogo) {
      enterpriseFetch(`/api/enterprise/company-profile`).then((p) => { if (p?.logoDataUrl) setFallbackLogo(p.logoDataUrl); }).catch(() => {});
    }
  }, [q, s.logoDataUrl, fallbackLogo]);
  const logo = s.logoDataUrl || fallbackLogo;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center overflow-y-auto p-4 print:p-0 print:bg-white print:static">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body * { visibility: hidden !important; }
          #quote-doc, #quote-doc * { visibility: visible !important; }
          #quote-doc { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; border-radius: 0 !important; padding: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="w-full max-w-3xl my-8 print:my-0">
        <div className="flex justify-end gap-2 mb-2 no-print">
          <button onClick={() => window.print()} disabled={!q} className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg px-4 py-2 flex items-center gap-2 disabled:opacity-50">
            <Printer className="w-4 h-4" /> Download / Print PDF
          </button>
          <button onClick={onClose} className="bg-white border border-slate-200 text-slate-600 rounded-lg px-3 py-2"><X className="w-4 h-4" /></button>
        </div>

        {err ? (
          <div className="bg-white rounded-xl p-8 text-center text-red-600 text-sm">{err}</div>
        ) : !q ? (
          <div className="bg-white rounded-xl p-10 text-center text-slate-400 flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> loading…</div>
        ) : (
          <div id="quote-doc" className="relative bg-white rounded-xl shadow-xl p-8 text-slate-800 text-[13px] leading-relaxed">
            {q.isExpired && (
              <div
                className="absolute right-8 top-24 border-4 border-[#B91C1C] text-[#B91C1C] rounded-lg px-3 py-1 text-lg font-extrabold tracking-widest opacity-70 rotate-[-14deg] select-none"
                style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
              >
                EXPIRED
              </div>
            )}

            {/* letterhead */}
            <div className="flex justify-between items-start border-b-2 border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                {logo && <img src={logo} alt="logo" className="h-16 w-auto max-w-[170px] object-contain shrink-0" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }} />}
                <div>
                  <h1 className="text-xl font-extrabold text-slate-900">{s.tradeName || "HF Transport"}</h1>
                  {s.legalName && s.legalName !== s.tradeName && <div className="text-[11px] text-slate-500">{s.legalName}</div>}
                  {s.tagline && <div className="text-[12px] text-slate-600">{s.tagline}</div>}
                  <div className="text-[11px] text-slate-500 mt-1 whitespace-pre-line">
                    {[s.addressLines, [s.city, s.country].filter(Boolean).join(", ")].filter(Boolean).join("\n")}
                  </div>
                  {Array.isArray(s.phones) && s.phones.length > 0 && <div className="text-[11px] text-slate-500">Phone: {s.phones.join(" / ")}</div>}
                  {(s.email || s.website) && <div className="text-[11px] text-slate-500">{[s.email, s.website].filter(Boolean).join("  ·  ")}</div>}
                  {(s.ntn || s.strn) && <div className="text-[11px] text-slate-500">{s.ntn ? `NTN: ${s.ntn}` : ""} {s.strn ? ` · STRN: ${s.strn}` : ""}</div>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xl font-extrabold tracking-wide text-slate-900">QUOTATION</div>
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Rate Quote · قیمت کا تخمینہ</div>
                <table className="text-[11px] mt-2 ml-auto">
                  <tbody>
                    <tr><td className="text-slate-500 pr-3 text-left">Quotation #</td><td className="font-semibold text-slate-800 text-right">{q.quotationNumber}</td></tr>
                    <tr><td className="text-slate-500 pr-3 text-left">Date</td><td className="text-right">{d(q.quotationDate)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* validity banner — the whole point of this document */}
            <div className={`mt-4 rounded-lg border-2 px-4 py-2.5 flex items-center gap-3 ${q.isExpired ? "border-[#FCA5A5] bg-[#FEF2F2]" : "border-[#16A34A] bg-[#F0FDF4]"}`}>
              <Clock className={`w-5 h-5 shrink-0 ${q.isExpired ? "text-[#B91C1C]" : "text-[#15803D]"}`} />
              <div className="text-[12.5px]">
                <span className="font-bold">
                  {q.isExpired
                    ? `This rate was only held until ${d(q.validUntil)} — it has expired.`
                    : `This rate is held for ${q.validityDays} day${q.validityDays === 1 ? "" : "s"} — valid until ${d(q.validUntil)}.`}
                </span>{" "}
                <span dir="auto" className="text-slate-500">
                  {q.isExpired
                    ? `· یہ ریٹ ${d(q.validUntil)} تک تھا — میعاد ختم ہو چکی ہے۔ نئی قیمت کے لیے رابطہ کریں۔`
                    : `· یہ ریٹ صرف ${q.validityDays} دن کے لیے مخصوص ہے — اس کے بعد نئی قیمت لاگو ہوگی۔`}
                </span>
              </div>
            </div>

            {/* client / shipment */}
            <div className="grid grid-cols-2 gap-6 mt-4">
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Quotation For</div>
                <div className="font-semibold text-slate-800">{q.clientCompany}</div>
                {q.clientAddress && <div className="text-[12px] text-slate-600">{q.clientAddress}</div>}
                {q.clientContactPerson && <div className="text-[12px] text-slate-600">Attn: {q.clientContactPerson}</div>}
                {q.clientPhone && <div className="text-[12px] text-slate-600">Phone: {q.clientPhone}</div>}
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Shipment</div>
                <table className="text-[12px] w-full">
                  <tbody>
                    {(q.routeFrom || q.routeTo) && <tr><td className="text-slate-500 pr-2">Route</td><td>{q.routeFrom} → {q.routeTo}</td></tr>}
                    {q.vehicleType && <tr><td className="text-slate-500 pr-2">Vehicle</td><td>{q.vehicleType}</td></tr>}
                    {q.cargoDescription && <tr><td className="text-slate-500 pr-2">Cargo</td><td>{q.cargoDescription}{q.cargoWeightKg ? ` · ${q.cargoWeightKg.toLocaleString()} kg` : ""}</td></tr>}
                    {q.rateBasis && <tr><td className="text-slate-500 pr-2">Rate basis</td><td>{q.rateBasis}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {/* line items */}
            <table className="w-full mt-5 text-[12px] border-collapse">
              <thead>
                <tr className="bg-slate-800 text-white" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
                  <th className="text-left px-2 py-1.5 w-8">#</th>
                  <th className="text-left px-2 py-1.5">Description</th>
                  <th className="text-right px-2 py-1.5 w-20">Qty</th>
                  <th className="text-right px-2 py-1.5 w-28">Rate</th>
                  <th className="text-right px-2 py-1.5 w-32">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(q.linesJson || []).map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-2 py-1.5 text-slate-400 align-top">{i + 1}</td>
                    <td className="px-2 py-1.5">{l.description}</td>
                    <td className="px-2 py-1.5 text-right align-top">{l.qty} {l.unit}</td>
                    <td className="px-2 py-1.5 text-right align-top">{money(l.rate)}</td>
                    <td className="px-2 py-1.5 text-right font-medium align-top">{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-between items-start gap-6 mt-3">
              <div className="text-[11px] text-slate-600 max-w-[46%]">
                <span className="font-semibold text-slate-500">Amount in words: </span>{amountInWords(q.totalAmount)}
              </div>
              <table className="text-[12px] w-72 shrink-0">
                <tbody>
                  {q.linesJson?.length > 1 && <tr><td className="text-slate-500 py-0.5">Subtotal</td><td className="text-right">{money(q.subtotal)}</td></tr>}
                  <tr className="border-t-2 border-slate-800 font-extrabold text-[14px]"><td className="py-1.5">Quoted Total</td><td className="text-right">{money(q.totalAmount)}</td></tr>
                </tbody>
              </table>
            </div>

            {/* terms */}
            <div className="mt-5 pt-4 border-t border-slate-200">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Terms</div>
              <ul className="text-[10.5px] text-slate-600 mt-1 list-disc pl-4 space-y-0.5">
                <li className="font-semibold">This rate is valid for {q.validityDays} day{q.validityDays === 1 ? "" : "s"} from {d(q.quotationDate)} — i.e. until {d(q.validUntil)}. After that the rate is subject to revision.</li>
                <li>Final billing is on the actual invoice, based on this quotation.</li>
                <li>50% advance is payable when the empty vehicle is placed for loading; the remaining 50% on loading.</li>
                <li>Rates exclude any tolls, permits or delays not listed above.</li>
              </ul>
              {q.notes && <div className="text-[11px] text-slate-600 mt-2 whitespace-pre-line"><span className="font-semibold text-slate-500">Note: </span>{q.notes}</div>}
            </div>

            <div className="flex justify-between items-end mt-8">
              <div className="text-[10px] text-slate-400">This is a computer-generated quotation.<br />Generated on {new Date().toLocaleString("en-GB")}.</div>
              <div className="text-center">
                <div className="border-t border-slate-400 pt-1 w-52 text-[11px] text-slate-600">For {s.tradeName || "HF Transport"}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Authorised signatory</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
