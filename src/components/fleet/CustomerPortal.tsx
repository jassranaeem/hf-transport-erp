import React, { useEffect, useState } from "react";
import { UserCheck, Shield, MapPin, FileText, Download, Landmark, HelpCircle, Check, Compass } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";

interface Contractor {
  id: number;
  company: string;
  outstandingBalance: number;
}

interface CustomerTrip {
  tripNumber: string;
  route: string;
  status: string;
  eta: string;
  remainingKm: number;
}

interface InvoiceRow {
  id: number;
  invoiceNumber: string;
  date: string;
  amount: number;
  paymentStatus: "Unpaid" | "Paid" | "Partially Paid" | "Overdue";
}

interface SupportTicket {
  id: string;
  subject: string;
  date: string;
  status: "Open" | "In Progress" | "Resolved";
  priority: "High" | "Medium" | "Low";
}

interface CustomerPortalProps {
  showFeedback: (type: "success" | "error", message: string) => void;
}

/**
 * This used to be a static mockup: a fixed 4-name client dropdown (Lucky
 * Cement, Fauji Fertilizer, PSO Fuel Corp, Nestle Pakistan) and hardcoded
 * trips/invoices/balances that never reflected anything actually entered in
 * the ERP — a real customer added here (e.g. "Bestway Cement Ltd") never
 * showed up, because nothing on this screen ever read the database. It now
 * loads real Contractors, their real Trips, Invoices, and Outstanding
 * Balance. The one piece still NOT backed by a real table is the support
 * ticket list below — there's no ticketing table in the schema yet, so it's
 * clearly kept as a session-only draft rather than pretending to persist.
 */
export default function CustomerPortal({ showFeedback }: CustomerPortalProps) {
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [activeClientId, setActiveClientId] = useState<number | "">("");
  const [loading, setLoading] = useState(true);

  const [activeTrips, setActiveTrips] = useState<CustomerTrip[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [lastPayment, setLastPayment] = useState<number>(0);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [newTicketSubject, setNewTicketSubject] = useState("");
  const [newTicketPriority, setNewTicketPriority] = useState<"High" | "Medium" | "Low">("Medium");

  useEffect(() => {
    enterpriseFetch(`/api/entities/contractors?limit=500&sort=company&dir=asc`)
      .then((r) => {
        const list: Contractor[] = (r.rows || []).map((c: any) => ({
          id: c.id,
          company: c.company,
          outstandingBalance: Number(c.outstandingBalance || 0),
        }));
        setContractors(list);
        if (list.length) setActiveClientId(list[0].id);
      })
      .catch(() => showFeedback("error", "Contractors load nahi ho sake"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeClientId) {
      setActiveTrips([]);
      setInvoices([]);
      setLastPayment(0);
      return;
    }
    let cancelled = false;

    Promise.all([
      enterpriseFetch(`/api/operations/trips`).catch(() => []),
      enterpriseFetch(`/api/entities/invoices?limit=500`).catch(() => ({ rows: [] })),
      enterpriseFetch(`/api/entities/payments?limit=500&sort=paymentDate&dir=desc`).catch(() => ({ rows: [] })),
    ]).then(([tripsRes, invRes, payRes]) => {
      if (cancelled) return;
      const allTrips = Array.isArray(tripsRes) ? tripsRes : [];
      const liveTrips = allTrips
        .filter((t: any) => t.contractorId === activeClientId && t.status !== "Completed")
        .slice(0, 6)
        .map((t: any) => ({
          tripNumber: t.tripNumber,
          route: [t.origin, t.destination].filter(Boolean).join(" ➜ ") || "Route not set",
          status: t.status || "Scheduled",
          eta: t.expectedArrival ? new Date(t.expectedArrival).toLocaleString() : "TBD",
          remainingKm: Number(t.remainingDistance ?? t.distance ?? 0),
        }));
      setActiveTrips(liveTrips);

      // /api/entities/invoices and /api/entities/payments are the generic,
      // registry-driven list route, which resolves every FK column (here,
      // contractorId) to the OTHER entity's natural-key STRING for display —
      // so `inv.contractorId` here is actually "Bestway Cement Ltd", not a
      // numeric id. Comparing it against the numeric activeClientId (as a
      // number OR as its string form, "1") never matched anything, so every
      // invoice/payment silently failed the filter and the portal showed
      // "no invoices" even with real ones in the database. /api/operations/
      // trips is a different, hand-written route that returns the raw
      // numeric contractorId untouched, which is why that filter (above)
      // was fine as-is.
      const activeCompany = contractors.find((c) => c.id === activeClientId)?.company;
      const allInvoices = invRes?.rows || [];
      const clientInvoices = allInvoices
        .filter((inv: any) => inv.contractorId === activeCompany)
        .map((inv: any) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          date: inv.invoiceDate ? String(inv.invoiceDate).slice(0, 10) : "",
          amount: Number(inv.totalAmount || 0),
          paymentStatus: inv.status || "Unpaid",
        }));
      setInvoices(clientInvoices);

      const allPayments = payRes?.rows || [];
      const clientPayment = allPayments.find((p: any) => p.contractorId === activeCompany);
      setLastPayment(Number(clientPayment?.amount || 0));
    });

    return () => {
      cancelled = true;
    };
  }, [activeClientId]);

  const activeContractor = contractors.find((c) => c.id === activeClientId);

  const handleDownloadInvoice = (inv: string) => {
    showFeedback("success", `${inv} ka invoice download shuru — Finance → Invoices se print/PDF milega.`);
  };

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicketSubject.trim()) return;
    const newT: SupportTicket = {
      id: `tkt-${Date.now().toString().slice(-4)}`,
      subject: newTicketSubject,
      date: new Date().toISOString().split("T")[0],
      status: "Open",
      priority: newTicketPriority,
    };
    setTickets((prev) => [newT, ...prev]);
    setNewTicketSubject("");
    showFeedback("success", "Ticket is session mein note ho gaya (abhi database mein save nahi hota — yeh feature aage banegi).");
  };

  return (
    <div className="space-y-6">
      {/* Selector banner */}
      <div className="bg-slate-950/40 p-5 border border-slate-900 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-500" /> Secure Corporate Client Portal
          </h2>
          <p className="text-[11px] text-slate-400 mt-1">Live view of a real contractor's trips, invoices, and account balance — as they'd see it.</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Viewing client portal:</span>
          <select
            value={activeClientId}
            onChange={(e) => setActiveClientId(Number(e.target.value))}
            className="bg-slate-900 border border-slate-800 text-xs text-white rounded p-1.5 focus:outline-none focus:border-emerald-500"
          >
            {loading && <option>Loading…</option>}
            {!loading && contractors.length === 0 && <option>No contractors yet</option>}
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>{c.company}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Live Shipments & Bills */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active Shipments */}
          <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5 border-b border-slate-900 pb-2">
              <Compass className="w-4 h-4 text-blue-500 animate-spin" /> Live Shipments & Transit Tracking
            </h3>

            {activeTrips.length === 0 ? (
              <p className="text-[11px] text-slate-500">Is client ki koi active (non-completed) trip nahi mili.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeTrips.map((trip, idx) => (
                  <div key={idx} className="bg-slate-900/30 border border-slate-900 rounded-lg p-3 text-xs space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-bold text-white">{trip.tripNumber}</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-bold text-emerald-400 uppercase">
                        {trip.status}
                      </span>
                    </div>
                    <p className="text-slate-300 font-semibold">{trip.route}</p>
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                      <span>ETA: {trip.eta}</span>
                      <span>{trip.remainingKm} km remaining</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bills & Invoices */}
          <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5 border-b border-slate-900 pb-2">
              <FileText className="w-4 h-4 text-emerald-500" /> Digital Invoices
            </h3>

            {invoices.length === 0 ? (
              <p className="text-[11px] text-slate-500">Is client ka koi invoice nahi mila.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/40 border-b border-slate-900 text-slate-400">
                    <tr>
                      <th className="p-3">Invoice Number</th>
                      <th className="p-3">Billing Date</th>
                      <th className="p-3">Total Amount</th>
                      <th className="p-3">Payment Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/40">
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-900/10">
                        <td className="p-3 font-mono font-bold text-white">{inv.invoiceNumber}</td>
                        <td className="p-3 text-slate-500">{inv.date}</td>
                        <td className="p-3 font-mono font-bold">PKR {inv.amount.toLocaleString()}</td>
                        <td className="p-3">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            inv.paymentStatus === "Paid" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                          }`}>
                            {inv.paymentStatus}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => handleDownloadInvoice(inv.invoiceNumber)}
                            className="p-1 bg-blue-600 hover:bg-blue-700 text-white rounded"
                            title="Open in Invoices"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Statements & Help Desk */}
        <div className="space-y-6">
          {/* Outstanding financial profile */}
          <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Landmark className="w-4 h-4 text-blue-500" /> Account Statement Summary
            </h3>
            <p className="text-[11px] text-slate-400">Consolidated financial standing of corporate ledger dues in Pak Rupees.</p>

            <div className="grid grid-cols-2 gap-2 text-xs pt-2">
              <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-900">
                <span className="text-[10px] text-slate-500 block uppercase">Outstanding Balance</span>
                <span className="font-mono text-sm font-black text-rose-400">
                  PKR {(activeContractor?.outstandingBalance ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-900">
                <span className="text-[10px] text-slate-500 block uppercase">Last Payment Made</span>
                <span className="font-mono text-sm font-black text-emerald-400">PKR {lastPayment.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* CRM Help desk */}
          <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5 border-b border-slate-900 pb-2">
              <HelpCircle className="w-4 h-4 text-blue-500" /> Support Desk & Service Tickets
            </h3>
            <p className="text-[10px] text-amber-400/80">Draft only — ticket history isn't saved to the database yet.</p>

            <form onSubmit={handleCreateTicket} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Issue Subject / Description</label>
                <input
                  type="text"
                  placeholder="Describe your transit discrepancy..."
                  value={newTicketSubject}
                  onChange={(e) => setNewTicketSubject(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white placeholder-slate-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Severity / Priority</label>
                <select
                  value={newTicketPriority}
                  onChange={(e: any) => setNewTicketPriority(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-xs text-white rounded p-1.5"
                >
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>

              <button
                type="submit"
                className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-xs transition"
              >
                Add Ticket (this session)
              </button>
            </form>

            <div className="space-y-2 border-t border-slate-900 pt-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ticket History</p>
              {tickets.map((t) => (
                <div key={t.id} className="p-2 bg-slate-900/30 rounded border border-slate-900 text-[11px] flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-white">{t.subject}</span>
                    <p className="text-[9px] text-slate-500">Date: {t.date} | ID: {t.id}</p>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[8px] bg-blue-500/10 text-blue-400 font-bold border border-blue-500/20">
                    {t.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
