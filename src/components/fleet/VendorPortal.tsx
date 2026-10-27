import React, { useEffect, useState } from "react";
import { Truck, Shield, Landmark, FileText } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";

interface VendorInvoice {
  id: number;
  vendorName: string;
  category: string;
  invoiceNumber: string;
  dueDate: string;
  amount: number;
  status: string;
}

interface VendorPortalProps {
  showFeedback: (type: "success" | "error", message: string) => void;
}

/** vendorCategory -> the real Chart-of-Accounts expense account each bill should post against. */
const EXPENSE_ACCOUNT_BY_CATEGORY: Record<string, string> = {
  "Fuel Supply": "5001", // Fuel Expense
  Tyres: "5003", // Maintenance & Repairs Expense
  "Workshop Repairs": "5003",
};

/**
 * This used to be a static mockup end to end: 3 fake supplier invoices
 * (Shell Pakistan Depot, General Tyres Ltd, ...), 2 fake purchase orders,
 * and hardcoded "Dues Pending" / "Paid Dues" totals that never changed no
 * matter what happened in the real ERP — and the "Submit Invoice" form only
 * ever appended to that same local, in-memory list, never actually posting
 * a real vendor bill. It now reads and writes the real `bills` table (the
 * same Accounts Payable module used by Finance → Bills), so a submitted
 * invoice here shows up there too, with a real GL journal entry behind it.
 * There is genuinely no Purchase Order table in the schema yet — rather
 * than show fake PO numbers, that section says so plainly instead of
 * pretending to track something the system doesn't.
 */
export default function VendorPortal({ showFeedback }: VendorPortalProps) {
  const [vendorCategory, setVendorCategory] = useState("Fuel Supply");
  const [invoices, setInvoices] = useState<VendorInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBills = () => {
    setLoading(true);
    enterpriseFetch(`/api/finance/bills`)
      .then((rows) => {
        const list: VendorInvoice[] = (Array.isArray(rows) ? rows : []).map((b: any) => ({
          id: b.id,
          vendorName: b.vendorName,
          category: b.vendorType,
          invoiceNumber: b.billNumber,
          dueDate: b.dueDate ? String(b.dueDate).slice(0, 10) : "",
          amount: Number(b.amount || 0),
          status: b.status || "Unpaid",
        }));
        setInvoices(list);
      })
      .catch(() => showFeedback("error", "Could not load vendor bills · وینڈر بلز لوڈ نہیں ہو سکے"))
      .finally(() => setLoading(false));
  };

  useEffect(loadBills, []); // eslint-disable-line react-hooks/exhaustive-deps

  const duesPending = invoices
    .filter((i) => i.status !== "Paid")
    .reduce((s, i) => s + i.amount, 0);
  const totalPaid = invoices
    .filter((i) => i.status === "Paid")
    .reduce((s, i) => s + i.amount, 0);

  // Submit Invoice Form
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitVendorInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceNo.trim() || !invoiceAmount || !invoiceDueDate || !vendorName.trim()) {
      showFeedback("error", "Please fill all vendor billing details.");
      return;
    }
    setSubmitting(true);
    try {
      await enterpriseFetch(`/api/finance/bills`, {
        method: "POST",
        body: JSON.stringify({
          vendorType: vendorCategory,
          vendorName,
          dueDate: invoiceDueDate,
          amount: invoiceAmount,
          expenseTypeCode: EXPENSE_ACCOUNT_BY_CATEGORY[vendorCategory] || "5003",
          notes: `Vendor's own invoice #: ${invoiceNo}`,
        }),
      });
      setInvoiceNo("");
      setInvoiceAmount("");
      setInvoiceDueDate("");
      setVendorName("");
      loadBills();
      showFeedback("success", "Vendor bill saved — it also appears under Finance → Bills and the GL entry was posted. · وینڈر بل محفوظ ہو گیا");
    } catch (err: any) {
      showFeedback("error", err.message || "Could not save the vendor bill · وینڈر بل محفوظ نہیں ہوا");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Selector header */}
      <div className="bg-slate-950/40 p-5 border border-slate-900 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-500" /> Secure Corporate Vendor Portal
          </h2>
          <p className="text-[11px] text-slate-400 mt-1">Real Accounts Payable — invoices submitted here post as real bills with a GL entry.</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">New invoice's category:</span>
          <select
            value={vendorCategory}
            onChange={(e) => setVendorCategory(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-xs text-white rounded p-1.5 focus:outline-none focus:border-blue-500"
          >
            <option value="Fuel Supply">Fuel Depot Suppliers</option>
            <option value="Tyres">Tyre Vendors</option>
            <option value="Workshop Repairs">Maintenance Workshops</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column PO list and outstanding lists */}
        <div className="lg:col-span-2 space-y-6">
          {/* Outbound Purchase Orders */}
          <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5 border-b border-slate-900 pb-2">
              <Truck className="w-4 h-4 text-blue-400" /> Outbound Corporate Purchase Orders (PO)
            </h3>
            <p className="text-[11px] text-slate-500">
              Purchase Orders aren't a tracked module in this system yet (no PO table) — this section isn't wired to fake data
              anymore, but there's nothing real to show here either until that's built.
            </p>
          </div>

          {/* Pending bills queue */}
          <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5 border-b border-slate-900 pb-2">
              <FileText className="w-4 h-4 text-emerald-500" /> Accounts Payable (AP) Supplier Invoices
            </h3>

            {loading ? (
              <p className="text-[11px] text-slate-500">Loading…</p>
            ) : invoices.length === 0 ? (
              <p className="text-[11px] text-slate-500">No vendor bills yet. Submit one using the form below. · ابھی کوئی وینڈر بل نہیں۔ نیچے دیے فارم سے جمع کرائیں۔</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/40 border-b border-slate-900 text-slate-400">
                    <tr>
                      <th className="p-3">Vendor Title</th>
                      <th className="p-3">Category</th>
                      <th className="p-3">Invoice No</th>
                      <th className="p-3">Due Date</th>
                      <th className="p-3">Total Amount</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/40">
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-900/10">
                        <td className="p-3 font-bold text-white">{inv.vendorName}</td>
                        <td className="p-3 text-slate-400">{inv.category}</td>
                        <td className="p-3 font-mono text-slate-400">{inv.invoiceNumber}</td>
                        <td className="p-3 text-slate-500">{inv.dueDate}</td>
                        <td className="p-3 font-mono font-bold">PKR {inv.amount.toLocaleString()}</td>
                        <td className="p-3">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            inv.status === "Paid" ? "bg-emerald-500/10 text-emerald-400" :
                            inv.status === "Partially Paid" ? "bg-blue-500/10 text-blue-400" : "bg-amber-500/10 text-amber-400"
                          }`}>
                            {inv.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right column: submit bill and aggregate stats */}
        <div className="space-y-6">
          <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Landmark className="w-4 h-4 text-blue-500" /> Accounts Payable Summary
            </h3>
            <p className="text-[11px] text-slate-400">Real totals across every vendor bill on file.</p>

            <div className="grid grid-cols-2 gap-2 text-xs pt-2">
              <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-900">
                <span className="text-[10px] text-slate-500 block">Dues Pending</span>
                <span className="font-mono text-sm font-black text-rose-400">PKR {duesPending.toLocaleString()}</span>
              </div>
              <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-900">
                <span className="text-[10px] text-slate-500 block font-bold">Paid Dues (To Date)</span>
                <span className="font-mono text-sm font-black text-emerald-400">PKR {totalPaid.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Submit Supplier bill form */}
          <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5 border-b border-slate-900 pb-2">
              <Landmark className="w-4 h-4 text-emerald-500" /> Submit Supplier Invoice
            </h3>

            <form onSubmit={handleSubmitVendorInvoice} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Vendor/Supplier Name</label>
                <input
                  type="text"
                  placeholder="e.g. Shell Pakistan Depot"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Vendor Invoice Number</label>
                <input
                  type="text"
                  placeholder="e.g. SH-98521"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Due Date</label>
                <input
                  type="date"
                  value={invoiceDueDate}
                  onChange={(e) => setInvoiceDueDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Invoice Total Amount (PKR)</label>
                <input
                  type="number"
                  placeholder="e.g. 150000"
                  value={invoiceAmount}
                  onChange={(e) => setInvoiceAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-xs transition shadow-md disabled:opacity-60"
              >
                {submitting ? "Saving…" : "Submit Invoice to AP Registry"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
