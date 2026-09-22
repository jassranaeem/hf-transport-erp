import React, { useState, useEffect } from "react";
import { Briefcase, Plus, Trash2, Edit2, Search, Percent, ShieldCheck } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import RecordAttachments from "../common/RecordAttachments.tsx";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

interface Contractor {
  id: number;
  contractorName: string;
  contractorCode: string;
  contactPerson: string | null;
  mobile: string;
  email: string | null;
  billingAddress: string | null;
  paymentTerms: string;
  taxRegistrationNumber: string | null;
  creditLimit: number;
  currentOutstanding: number;
  rating: string | null;
  isActive: boolean;
}

interface FleetContractorsProps {
  showFeedback: (type: "success" | "error", message: string) => void;
}

export default function FleetContractors({ showFeedback }: FleetContractorsProps) {
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Drawer Form state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingContractor, setEditingContractor] = useState<Contractor | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    contractorName: "",
    contractorCode: "",
    contactPerson: "",
    mobile: "",
    email: "",
    billingAddress: "",
    paymentTerms: "Net 30",
    taxRegistrationNumber: "",
    creditLimit: 2500000,
    currentOutstanding: 0,
    rating: "4.8",
    isActive: true,
  });

  const fetchContractors = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({ search });
      const data = await enterpriseFetch(`/api/operations/contractors?${queryParams}`);
      setContractors(data);
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to load contractors");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContractors();
  }, [search]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    console.log("Submitting contractor form, current state:", formData);
    try {
      const url = editingContractor ? `/api/operations/contractors/${editingContractor.id}` : "/api/operations/contractors";
      const method = editingContractor ? "PUT" : "POST";
      console.log(`Sending ${method} request to ${url}...`);

      const cleanedForm = {
        ...formData,
        creditLimit: Number(formData.creditLimit),
        currentOutstanding: Number(formData.currentOutstanding),
      };
      console.log("Prepared cleaned form payload for contractors:", cleanedForm);

      const result = await enterpriseFetch(url, {
        method,
        body: JSON.stringify(cleanedForm),
      });
      console.log("Response received from contractor save:", result);

      showFeedback("success", editingContractor ? "Contractor profile updated" : "New corporate contractor registered");
      setIsDrawerOpen(false);
      setEditingContractor(null);
      fetchContractors();
    } catch (err: any) {
      console.error("Save contractor details error:", err);
      showFeedback("error", err.message || "Failed to save contractor profile");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (c: Contractor) => {
    setEditingContractor(c);
    setFormData({
      contractorName: c.contractorName,
      contractorCode: c.contractorCode,
      contactPerson: c.contactPerson || "",
      mobile: c.mobile,
      email: c.email || "",
      billingAddress: c.billingAddress || "",
      paymentTerms: c.paymentTerms,
      taxRegistrationNumber: c.taxRegistrationNumber || "",
      creditLimit: c.creditLimit,
      currentOutstanding: c.currentOutstanding,
      rating: c.rating || "4.8",
      isActive: c.isActive,
    });
    setIsDrawerOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to suspend/deactivate this corporate contractor account?")) return;
    try {
      await enterpriseFetch(`/api/operations/contractors/${id}`, { method: "DELETE" });
      showFeedback("success", "Contractor record retired and logged");
      fetchContractors();
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to deactivate contractor");
    }
  };

  const openAddDrawer = () => {
    setEditingContractor(null);
    setFormData({
      contractorName: "",
      contractorCode: `CON-${Math.floor(Math.random() * 900) + 100}`,
      contactPerson: "",
      mobile: "+92 300 9876543",
      email: "billing@contractor.com",
      billingAddress: "Industrial Estate Block 4A, Lahore, Pakistan",
      paymentTerms: "Net 30",
      taxRegistrationNumber: `NTN-${Math.floor(Math.random() * 9000000) + 1000000}-4`,
      creditLimit: 5000000,
      currentOutstanding: 0,
      rating: "5.0",
      isActive: true,
    });
    setIsDrawerOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/40 p-4 border border-slate-900 rounded-xl">
        <div className="flex items-center gap-3">
          <Briefcase className="w-8 h-8 text-blue-500" />
          <div>
            <h2 className="text-xl font-bold text-white">Corporate Customers & Contractors</h2>
            <p className="text-xs text-slate-400">Total authorized corporate accounts: {contractors.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ModuleDataIO entityKey="contractors" label="Contractors" onImported={fetchContractors} />
          <button
            onClick={openAddDrawer}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition"
          >
            <Plus className="w-4 h-4" /> Register Customer/Contractor
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Filter contractors by corporate name, NTN, or registration code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Corporate Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="h-44 bg-slate-950/20 border border-slate-900 rounded-xl animate-pulse" />
          ))
        ) : contractors.length === 0 ? (
          <div className="col-span-3 text-center py-12 text-slate-500 text-xs">
            No matching corporate customers defined yet.
          </div>
        ) : (
          contractors.map((c) => (
            <div key={c.id} className="bg-slate-950/40 border border-slate-900 rounded-xl p-4 flex flex-col justify-between hover:border-slate-800 transition space-y-3">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-mono text-slate-500 font-bold bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
                      {c.contractorCode}
                    </span>
                    <h3 className="text-sm font-bold text-white mt-1.5">{c.contractorName}</h3>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                    c.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                  }`}>
                    {c.isActive ? "Active Account" : "Suspended"}
                  </span>
                </div>

                <div className="text-[11px] text-slate-400">
                  <span className="text-slate-500">Rep:</span> {c.contactPerson || "Not Set"}
                  <br />
                  <span className="text-slate-500">NTN:</span> <span className="font-mono">{c.taxRegistrationNumber || "N/A"}</span>
                </div>

                {/* Credit Limit & Terms */}
                <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-900/60 pt-2 font-mono">
                  <div>
                    <p className="text-[9px] text-slate-500">Credit Limit</p>
                    <p className="text-xs font-bold text-slate-300">PKR {c.creditLimit.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-500">Outstanding Balance</p>
                    <p className="text-xs font-bold text-rose-400">PKR {c.currentOutstanding.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center border-t border-slate-900 pt-3 text-[11px]">
                <span className="text-blue-400 flex items-center gap-1 font-bold">
                  <ShieldCheck className="w-3.5 h-3.5" /> Terms: {c.paymentTerms}
                </span>

                <div className="flex gap-1">
                  <button
                    onClick={() => handleEdit(c)}
                    className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-400 hover:text-white transition"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="p-1.5 bg-slate-900 hover:bg-rose-500/10 border border-slate-800 rounded-lg text-slate-500 hover:text-rose-400 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="bg-white rounded-lg -mx-1 -mb-1">
                <RecordAttachments entityType="contractor" entityId={c.id} label="Documents / proof" />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Drawer Form */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/80 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-lg bg-slate-950 border-l border-slate-900 p-6 overflow-y-auto space-y-6 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-900 pb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Briefcase className="w-6 h-6 text-blue-500" />
                {editingContractor ? `Modify: ${formData.contractorName}` : "Register Corporate Account"}
              </h3>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="text-slate-500 hover:text-white text-xs px-2 py-1 bg-slate-900 rounded-lg"
              >
                ESC
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Corporate / Customer Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Pakistan State Oil"
                    value={formData.contractorName}
                    onChange={(e) => setFormData({ ...formData, contractorName: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Contractor Code *</label>
                  <input
                    type="text"
                    required
                    value={formData.contractorCode}
                    onChange={(e) => setFormData({ ...formData, contractorCode: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Billing Representative *</label>
                  <input
                    type="text"
                    required
                    placeholder="Contact person name"
                    value={formData.contactPerson}
                    onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Tax Registration NTN *</label>
                  <input
                    type="text"
                    required
                    value={formData.taxRegistrationNumber}
                    onChange={(e) => setFormData({ ...formData, taxRegistrationNumber: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">GSM Mobile *</label>
                  <input
                    type="text"
                    required
                    value={formData.mobile}
                    onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">E-mail for Invoicing</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Billing Address</label>
                <textarea
                  value={formData.billingAddress}
                  onChange={(e) => setFormData({ ...formData, billingAddress: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white h-16"
                />
              </div>

              <div className="grid grid-cols-3 gap-4 border-t border-slate-900 pt-4">
                <div>
                  <label className="block text-slate-400 mb-1">Payment Terms</label>
                  <select
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  >
                    <option value="Cash on Delivery">Cash on Delivery</option>
                    <option value="Net 15">Net 15 Days</option>
                    <option value="Net 30">Net 30 Days</option>
                    <option value="Net 45">Net 45 Days</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Credit Limit (PKR) *</label>
                  <input
                    type="number"
                    required
                    value={formData.creditLimit}
                    onChange={(e) => setFormData({ ...formData, creditLimit: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Outstanding Balance</label>
                  <input
                    type="number"
                    value={formData.currentOutstanding}
                    onChange={(e) => setFormData({ ...formData, currentOutstanding: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t border-slate-900">
                <button
                  type="button"
                  onClick={() => setIsDrawerOpen(false)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:text-slate-400 text-white rounded-lg font-semibold flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Saving...
                    </>
                  ) : (
                    "Save Contractor Profile"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
