import React, { useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Printer, X, Loader2 } from "lucide-react";

interface Line { id: number; description: string; qty: string; unit: string | null; rate: number; amount: number }
interface Bank { bankName?: string; title?: string; accountNo?: string; iban?: string; branch?: string }
interface Seller {
  tradeName?: string; legalName?: string; tagline?: string; addressLines?: string; city?: string;
  country?: string; phones?: string[]; email?: string; website?: string; ntn?: string; strn?: string;
  bankAccounts?: Bank[] | null; footerNote?: string; terms?: string | null; logoDataUrl?: string | null;
}
interface BillTo { company?: string; contactPerson?: string; phone?: string; email?: string; address?: string; ntn?: string; strn?: string }
interface Payment { amount: number; paymentNumber?: string | null; paymentDate?: string | null; paymentMethod?: string | null }
interface InvoiceFull {
  id: number; invoiceNumber: string; invoiceDate: string; dueDate: string; status: string; paymentTerms: string;
  subtotal: number; taxAmount: number; totalAmount: number; paidAmount: number; outstandingBalance: number;
  advanceReceived: number; whtAmount: number; salesTaxPercent: string; whtPercent: string;
  containerNo: string | null; biltyNumber: string | null; routeFrom: string | null; routeTo: string | null;
  borderCrossing: string | null; cargoDescription: string | null; cargoWeightKg: number | null; rateBasis: string | null;
  notes: string | null; bankAccountRef: string | null;
  sellerSnapshotJson: Seller | null; billToSnapshotJson: BillTo | null;
  contractorName: string; tripNumber: string | null; vehicleNumber: string | null; driverName: string | null;
  lines: Line[]; payments?: Payment[];
}

const DEFAULT_TERMS = [
  "50% advance is payable when the empty vehicle is placed for loading.",
  "The remaining 50% is payable once the vehicle has been loaded.",
  "Please quote the invoice number with every payment.",
  "Goods once transported are at the consignee's risk; claims must be raised within 7 days of delivery.",
  "Any dispute is subject to the jurisdiction of Quetta courts.",
];

const money = (n: number) => "Rs " + Math.round(n || 0).toLocaleString("en-PK");
const d = (s: string) => (s ? new Date(s).toLocaleDateString("en-GB") : "—");

/** PKR amount to words — sub-continent numbering (crore / lakh / thousand). */
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

export default function InvoiceDocument({ invoiceId, onClose }: { invoiceId: number; onClose: () => void }) {
  const [inv, setInv] = useState<InvoiceFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fallbackLogo, setFallbackLogo] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState<"ORIGINAL FOR RECIPIENT" | "DUPLICATE" | "OFFICE COPY">("ORIGINAL FOR RECIPIENT");

  useEffect(() => {
    enterpriseFetch(`/api/finance/invoices/${invoiceId}`)
      .then(setInv)
      .catch((e) => setErr(e.message || "Failed to load invoice"));
  }, [invoiceId]);

  const s = inv?.sellerSnapshotJson || {};
  const b = inv?.billToSnapshotJson || {};

  useEffect(() => {
    if (inv && !s.logoDataUrl && !fallbackLogo) {
      enterpriseFetch(`/api/enterprise/company-profile`)
        .then((p) => { if (p?.logoDataUrl) setFallbackLogo(p.logoDataUrl); })
        .catch(() => {});
    }
  }, [inv, s.logoDataUrl, fallbackLogo]);

  const logo = s.logoDataUrl || fallbackLogo;
  const received = Number(inv?.advanceReceived || 0) + Math.max(0, Number(inv?.paidAmount || 0) - Number(inv?.advanceReceived || 0));
  const overdue = inv ? new Date(inv.dueDate).getTime() < Date.now() && Number(inv.outstandingBalance) > 0 : false;
  const stamp =
    inv?.status === "Paid" ? { text: "PAID", color: "#1E4480" } :
    inv?.status === "Partially Paid" ? { text: "PART-PAID", color: "#4B5563" } :
    overdue ? { text: "OVERDUE", color: "#B00005" } :
    { text: "UNPAID", color: "#64748B" };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center overflow-y-auto p-4 print:p-0 print:bg-white print:static">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body * { visibility: hidden !important; }
          #invoice-doc, #invoice-doc * { visibility: visible !important; }
          #invoice-doc { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; border-radius: 0 !important; padding: 0 !important; }
          #invoice-doc table { page-break-inside: auto; }
          #invoice-doc tr { page-break-inside: avoid; page-break-after: auto; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="w-full max-w-3xl my-8 print:my-0">
        <div className="flex justify-end items-center gap-2 mb-2 no-print">
          <select
            value={copyLabel}
            onChange={(e) => setCopyLabel(e.target.value as any)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white text-slate-600"
            title="Which copy is this?"
          >
            <option>ORIGINAL FOR RECIPIENT</option>
            <option>DUPLICATE</option>
            <option>OFFICE COPY</option>
          </select>
          <button
            onClick={() => window.print()}
            disabled={!inv}
            title="Opens the print dialog — choose 'Save as PDF' as the destination to download"
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg px-4 py-2 flex items-center gap-2 disabled:opacity-50"
          >
            <Printer className="w-4 h-4" /> Download / Print PDF
          </button>
          <button onClick={onClose} className="bg-white border border-slate-200 text-slate-600 rounded-lg px-3 py-2">
            <X className="w-4 h-4" />
          </button>
        </div>

        {err ? (
          <div className="bg-white rounded-xl p-8 text-center text-red-600 text-sm">{err}</div>
        ) : !inv ? (
          <div className="bg-white rounded-xl p-10 text-center text-slate-400 flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> loading invoice…
          </div>
        ) : (
          <div id="invoice-doc" className="relative bg-white rounded-xl shadow-xl p-8 text-slate-800 text-[13px] leading-relaxed">
            {/* status stamp */}
            <div
              className="absolute right-8 top-24 border-4 rounded-lg px-3 py-1 text-lg font-extrabold tracking-widest opacity-70 rotate-[-14deg] select-none"
              style={{ color: stamp.color, borderColor: stamp.color, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
            >
              {stamp.text}
            </div>

            {/* letterhead */}
            <div className="flex justify-between items-start border-b-2 border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                {logo && (
                  <img
                    src={logo}
                    alt="logo"
                    className="h-16 w-auto max-w-[170px] object-contain shrink-0"
                    style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
                  />
                )}
                <div>
                  <h1 className="text-xl font-extrabold text-slate-900">{s.tradeName || "HF Transport"}</h1>
                  {s.legalName && s.legalName !== s.tradeName && <div className="text-[11px] text-slate-500">{s.legalName}</div>}
                  {s.tagline && <div className="text-[12px] text-slate-600">{s.tagline}</div>}
                  <div className="text-[11px] text-slate-500 mt-1 whitespace-pre-line">
                    {[s.addressLines, [s.city, s.country].filter(Boolean).join(", ")].filter(Boolean).join("\n")}
                  </div>
                  {Array.isArray(s.phones) && s.phones.length > 0 && (
                    <div className="text-[11px] text-slate-500">Phone: {s.phones.join(" / ")}</div>
                  )}
                  {(s.email || s.website) && (
                    <div className="text-[11px] text-slate-500">{[s.email, s.website].filter(Boolean).join("  ·  ")}</div>
                  )}
                  {(s.ntn || s.strn) && (
                    <div className="text-[11px] text-slate-500">
                      {s.ntn ? `NTN: ${s.ntn}` : ""} {s.strn ? ` · STRN: ${s.strn}` : ""}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xl font-extrabold tracking-wide text-slate-900">INVOICE</div>
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{copyLabel}</div>
                <table className="text-[11px] mt-2 ml-auto">
                  <tbody>
                    <tr><td className="text-slate-500 pr-3 text-left">Invoice #</td><td className="font-semibold text-slate-800 text-right">{inv.invoiceNumber}</td></tr>
                    <tr><td className="text-slate-500 pr-3 text-left">Date</td><td className="text-right">{d(inv.invoiceDate)}</td></tr>
                    <tr><td className="text-slate-500 pr-3 text-left">Due date</td><td className="text-right">{d(inv.dueDate)}</td></tr>
                    <tr><td className="text-slate-500 pr-3 text-left">Terms</td><td className="text-right">{inv.paymentTerms}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* bill to / ship to / shipment */}
            <div className="grid grid-cols-3 gap-5 mt-4">
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Bill To</div>
                <div className="font-semibold text-slate-800">{b.company || inv.contractorName}</div>
                {b.address && <div className="text-[12px] text-slate-600">{b.address}</div>}
                {b.contactPerson && <div className="text-[12px] text-slate-600">Attn: {b.contactPerson}</div>}
                {b.phone && <div className="text-[12px] text-slate-600">Phone: {b.phone}</div>}
                {(b.ntn || b.strn) && (
                  <div className="text-[11px] text-slate-500">{b.ntn ? `NTN: ${b.ntn}` : ""} {b.strn ? `· STRN: ${b.strn}` : ""}</div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Ship To</div>
                <div className="text-[12px] text-slate-600">
                  {inv.routeTo ? `${inv.routeTo}${inv.borderCrossing ? ` (via ${inv.borderCrossing})` : ""}` : (b.address || "As per bilty")}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Shipment</div>
                <table className="text-[12px] w-full">
                  <tbody>
                    {inv.tripNumber && <tr><td className="text-slate-500 pr-2">Trip</td><td>{inv.tripNumber}</td></tr>}
                    {inv.biltyNumber && <tr><td className="text-slate-500 pr-2">Bilty / GR</td><td>{inv.biltyNumber}</td></tr>}
                    {inv.vehicleNumber && <tr><td className="text-slate-500 pr-2">Vehicle</td><td>{inv.vehicleNumber}{inv.containerNo ? ` · ${inv.containerNo}` : ""}</td></tr>}
                    {inv.driverName && <tr><td className="text-slate-500 pr-2">Driver</td><td>{inv.driverName}</td></tr>}
                    {(inv.routeFrom || inv.routeTo) && (
                      <tr><td className="text-slate-500 pr-2">Route</td><td>{inv.routeFrom} → {inv.routeTo}</td></tr>
                    )}
                    {inv.cargoDescription && (
                      <tr><td className="text-slate-500 pr-2">Cargo</td><td>{inv.cargoDescription}{inv.cargoWeightKg ? ` · ${inv.cargoWeightKg.toLocaleString()} kg` : ""}</td></tr>
                    )}
                    {inv.rateBasis && <tr><td className="text-slate-500 pr-2">Rate basis</td><td>{inv.rateBasis}</td></tr>}
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
                {inv.lines.map((l, i) => (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="px-2 py-1.5 text-slate-400 align-top">{i + 1}</td>
                    <td className="px-2 py-1.5">{l.description}</td>
                    <td className="px-2 py-1.5 text-right align-top">{Number(l.qty)} {l.unit}</td>
                    <td className="px-2 py-1.5 text-right align-top">{money(l.rate)}</td>
                    <td className="px-2 py-1.5 text-right font-medium align-top">{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* totals */}
            <div className="flex justify-between items-start gap-6 mt-3">
              <div className="text-[11px] text-slate-600 max-w-[46%]">
                <span className="font-semibold text-slate-500">Amount in words: </span>
                {amountInWords(inv.totalAmount)}
              </div>
              <table className="text-[12px] w-72 shrink-0">
                <tbody>
                  {inv.lines.length > 1 && (
                    <tr><td className="text-slate-500 py-0.5">Subtotal</td><td className="text-right">{money(inv.subtotal)}</td></tr>
                  )}
                  <tr className="border-t border-slate-300 font-bold"><td className="py-1">Invoice total</td><td className="text-right">{money(inv.totalAmount)}</td></tr>
                  {received > 0 && (
                    <tr><td className="text-slate-500 py-0.5">Less: amount received</td><td className="text-right">- {money(received)}</td></tr>
                  )}
                  <tr className="border-t-2 border-slate-800 font-extrabold text-[14px]">
                    <td className="py-1.5">Balance Due</td>
                    <td className="text-right">{money(inv.outstandingBalance)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* payments received against this invoice */}
            {Array.isArray(inv.payments) && inv.payments.length > 0 && (
              <div className="mt-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Payments received</div>
                <table className="w-full text-[11px] mt-1 border-collapse">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="text-left py-1">Date</th>
                      <th className="text-left py-1">Receipt #</th>
                      <th className="text-left py-1">Method</th>
                      <th className="text-right py-1">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.payments.map((p, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1">{p.paymentDate ? d(p.paymentDate) : "—"}</td>
                        <td className="py-1">{p.paymentNumber || "—"}</td>
                        <td className="py-1">{p.paymentMethod || "—"}</td>
                        <td className="py-1 text-right tabular-nums">{money(p.amount)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold">
                      <td className="py-1" colSpan={3}>Total received</td>
                      <td className="py-1 text-right tabular-nums">{money(inv.payments.reduce((s2, p) => s2 + Number(p.amount || 0), 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* bank + terms */}
            <div className="grid grid-cols-2 gap-6 mt-5 pt-4 border-t border-slate-200">
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Payment details</div>
                {Array.isArray(s.bankAccounts) && s.bankAccounts.length > 0 ? (
                  <div className="mt-1 grid grid-cols-1 gap-1.5">
                    {s.bankAccounts.map((bk, i) => (
                      <div key={i} className="text-[11px] text-slate-600 leading-snug">
                        <span className="font-medium text-slate-700">{bk.bankName}{bk.branch ? ` — ${bk.branch}` : ""}</span>
                        {bk.title ? ` · ${bk.title}` : ""}
                        {bk.iban ? <> · IBAN <span className="font-mono">{bk.iban}</span></> : bk.accountNo ? <> · A/C <span className="font-mono">{bk.accountNo}</span></> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400 mt-1">{inv.bankAccountRef || "Bank details not configured — add them in Company Profile."}</div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Terms &amp; conditions</div>
                <ul className="text-[10.5px] text-slate-600 mt-1 list-disc pl-4 space-y-0.5">
                  {(s.terms ? s.terms.split("\n").map((t) => t.trim()).filter(Boolean) : DEFAULT_TERMS).map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
                {(inv.notes || s.footerNote) && (
                  <div className="text-[11px] text-slate-600 mt-2 whitespace-pre-line"><span className="font-semibold text-slate-500">Note: </span>{inv.notes || s.footerNote}</div>
                )}
              </div>
            </div>

            {/* signature + footer */}
            <div className="flex justify-between items-end mt-8">
              <div className="text-[10px] text-slate-400">
                This is a computer-generated invoice.<br />
                Generated on {new Date().toLocaleString("en-GB")}.
              </div>
              <div className="text-center">
                <div className="border-t border-slate-400 pt-1 w-52 text-[11px] text-slate-600">For {s.tradeName || "HF Transport"}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Authorised signatory</div>
              </div>
            </div>

            {s.footerNote && inv.notes && (
              <div className="text-center text-[10px] text-slate-400 mt-4 border-t border-slate-100 pt-2">{s.footerNote}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
