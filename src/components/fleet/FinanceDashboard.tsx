import React, { useState, useEffect } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { DbUser } from "../../types.ts";
import { 
  TrendingUp, 
  BookOpen, 
  DollarSign, 
  CreditCard, 
  Landmark, 
  Receipt, 
  Plus, 
  CheckCircle, 
  AlertTriangle, 
  FileText, 
  Users, 
  Truck, 
  Calendar,
  Layers,
  Activity,
  ArrowRightLeft,
  Search,
  Check,
  Ban,
  RefreshCw,
  Printer
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import InvoiceDocument from "./InvoiceDocument.tsx";
import { Paperclip } from "lucide-react";
import AttachmentPanel from "../common/AttachmentPanel.tsx";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

interface FinanceDashboardProps {
  dbUser: DbUser;
  showFeedback: (type: "success" | "error", message: string) => void;
  onNavigate?: (workbook: string, sheet: string) => void;
}

export default function FinanceDashboard({ dbUser, showFeedback, onNavigate }: FinanceDashboardProps) {
  const [financeTab, setFinanceTab] = useState<"overview" | "accounts" | "journals" | "receivables" | "payables" | "cash_bank" | "expenses" | "reports">("overview");

  // Core Data States
  const [profitability, setProfitability] = useState<any>(null);
  const [accountsList, setAccountsList] = useState<any[]>([]);
  const [journalsList, setJournalsList] = useState<any[]>([]);
  const [invoicesList, setInvoicesList] = useState<any[]>([]);
  const [invoiceAging, setInvoiceAging] = useState<any>(null);
  const [billsList, setBillsList] = useState<any[]>([]);
  const [billAging, setBillAging] = useState<any>(null);
  const [banksList, setBanksList] = useState<any[]>([]);
  const [cashClosings, setCashClosings] = useState<any[]>([]);
  const [expensesList, setExpensesList] = useState<any[]>([]);

  // List Loading states
  const [loading, setLoading] = useState(false);

  // Form modals / expanders
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({ code: "", name: "", type: "Expense", category: "Miscellaneous", description: "" });

  const [showAddJournal, setShowAddJournal] = useState(false);
  const [newJournal, setNewJournal] = useState({ description: "", lines: [{ accountId: "", debit: 0, credit: 0 }, { accountId: "", debit: 0, credit: 0 }] });

  const [showRecordPayment, setShowRecordPayment] = useState<number | null>(null);
  const [viewInvoiceId, setViewInvoiceId] = useState<number | null>(null);
  const [showInvoiceDocs, setShowInvoiceDocs] = useState<number | null>(null);
  const [expandedExpenseId, setExpandedExpenseId] = useState<number | null>(null);
  const [newPayment, setNewPayment] = useState({ amount: "", paymentMethod: "Bank Transfer", bankAccountId: "", referenceNumber: "", notes: "" });

  const [showAddBill, setShowAddBill] = useState(false);
  const [newBill, setNewBill] = useState({ vendorType: "Fuel Vendor", vendorName: "", dueDate: "", amount: "", expenseTypeCode: "5001", notes: "" });

  const [showPayBill, setShowPayBill] = useState<number | null>(null);
  const [newBillPayment, setNewBillPayment] = useState({ amount: "", paymentMethod: "Bank Transfer", bankAccountId: "" });

  const [showAddBank, setShowAddBank] = useState(false);
  const [newBank, setNewBank] = useState({ bankName: "", branchName: "", accountNumber: "", iban: "", openingBalance: "" });

  const [showTransfer, setShowTransfer] = useState(false);
  const [transferForm, setTransferForm] = useState({ sourceAccountId: "", destAccountId: "", amount: "", reference: "" });

  const [showCashClosing, setShowCashClosing] = useState(false);
  const [cashClosingForm, setCashClosingForm] = useState({ openingBalance: "", cashIn: "", cashOut: "", declaredBalance: "", notes: "" });

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [newExpense, setNewExpense] = useState({ expenseType: "Fuel", amount: "", paymentMethod: "Cash", bankAccountId: "", tripId: "", vehicleId: "", driverId: "", notes: "" });

  // Entity selection items (for linking expenses)
  const [tripsList, setTripsList] = useState<any[]>([]);
  const [vehiclesList, setVehiclesList] = useState<any[]>([]);
  const [driversList, setDriversList] = useState<any[]>([]);

  // Report States
  const [trialBalance, setTrialBalance] = useState<any[]>([]);
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [incomeStatement, setIncomeStatement] = useState<any>(null);

  useEffect(() => {
    fetchFinanceData();
  }, [financeTab]);

  const fetchFinanceData = async () => {
    setLoading(true);
    try {
      if (financeTab === "overview") {
        const prof = await enterpriseFetch("/api/finance/profitability/summary");
        setProfitability(prof);
      } else if (financeTab === "accounts") {
        const accs = await enterpriseFetch("/api/finance/accounts");
        setAccountsList(accs);
      } else if (financeTab === "journals") {
        const journals = await enterpriseFetch("/api/finance/journals");
        setJournalsList(journals);
        const accs = await enterpriseFetch("/api/finance/accounts");
        setAccountsList(accs);
      } else if (financeTab === "receivables") {
        const invoices = await enterpriseFetch("/api/finance/invoices");
        setInvoicesList(invoices);
        const aging = await enterpriseFetch("/api/finance/invoices/aging");
        setInvoiceAging(aging);
        const banks = await enterpriseFetch("/api/finance/banks");
        setBanksList(banks);
      } else if (financeTab === "payables") {
        const bills = await enterpriseFetch("/api/finance/bills");
        setBillsList(bills);
        const aging = await enterpriseFetch("/api/finance/bills/aging");
        setBillAging(aging);
        const banks = await enterpriseFetch("/api/finance/banks");
        setBanksList(banks);
      } else if (financeTab === "cash_bank") {
        const banks = await enterpriseFetch("/api/finance/banks");
        setBanksList(banks);
        const closings = await enterpriseFetch("/api/finance/cash-closing");
        setCashClosings(closings);
      } else if (financeTab === "expenses") {
        const expenses = await enterpriseFetch("/api/finance/expenses");
        setExpensesList(expenses);
        const banks = await enterpriseFetch("/api/finance/banks");
        setBanksList(banks);
        // Load relationships for dropdown selection
        try {
          const trips = await enterpriseFetch("/api/operations/trips");
          setTripsList(trips.data || trips || []);
          const vehicles = await enterpriseFetch("/api/operations/vehicles");
          setVehiclesList(vehicles.data || vehicles || []);
          const drivers = await enterpriseFetch("/api/operations/drivers");
          setDriversList(drivers.data || drivers || []);
        } catch (e) {
          // Safe fallback
        }
      } else if (financeTab === "reports") {
        const tb = await enterpriseFetch("/api/finance/reports/trial-balance");
        setTrialBalance(tb);
        const bs = await enterpriseFetch("/api/finance/reports/balance-sheet");
        setBalanceSheet(bs);
        const is = await enterpriseFetch("/api/finance/reports/income-statement");
        setIncomeStatement(is);
      }
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to load financial records");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/finance/accounts", {
        method: "POST",
        body: JSON.stringify(newAccount),
      });
      showFeedback("success", `GL Account "${newAccount.name}" registered under Code ${newAccount.code}`);
      setShowAddAccount(false);
      setNewAccount({ code: "", name: "", type: "Expense", category: "Miscellaneous", description: "" });
      fetchFinanceData();
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to register account");
    }
  };

  const handleCreateJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/finance/journals", {
        method: "POST",
        body: JSON.stringify(newJournal),
      });
      showFeedback("success", "General Ledger Journal Entry posted successfully & reconciled.");
      setShowAddJournal(false);
      setNewJournal({ description: "", lines: [{ accountId: "", debit: 0, credit: 0 }, { accountId: "", debit: 0, credit: 0 }] });
      fetchFinanceData();
    } catch (err: any) {
      showFeedback("error", err.message || "Balanced posting failed");
    }
  };

  const handleRecordPayment = async (invoiceId: number) => {
    try {
      await enterpriseFetch(`/api/finance/invoices/${invoiceId}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount: newPayment.amount,
          paymentMethod: newPayment.paymentMethod,
          bankAccountId: newPayment.bankAccountId || null,
          referenceNumber: newPayment.referenceNumber,
          notes: newPayment.notes,
        }),
      });
      showFeedback("success", "Invoice payment reconciled and Accounts Receivable updated.");
      setShowRecordPayment(null);
      setNewPayment({ amount: "", paymentMethod: "Bank Transfer", bankAccountId: "", referenceNumber: "", notes: "" });
      fetchFinanceData();
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to post payment");
    }
  };

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/finance/bills", {
        method: "POST",
        body: JSON.stringify(newBill),
      });
      showFeedback("success", `Vendor Bill for "${newBill.vendorName}" registered and auto-posted to ledger.`);
      setShowAddBill(false);
      setNewBill({ vendorType: "Fuel Vendor", vendorName: "", dueDate: "", amount: "", expenseTypeCode: "5001", notes: "" });
      fetchFinanceData();
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to post bill");
    }
  };

  const handlePayBill = async (billId: number) => {
    try {
      await enterpriseFetch(`/api/finance/bills/${billId}/payments`, {
        method: "POST",
        body: JSON.stringify(newBillPayment),
      });
      showFeedback("success", "Vendor payment reconciled and outstanding liability updated.");
      setShowPayBill(null);
      setNewBillPayment({ amount: "", paymentMethod: "Bank Transfer", bankAccountId: "" });
      fetchFinanceData();
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to apply payment");
    }
  };

  const handleCreateBank = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/finance/banks", {
        method: "POST",
        body: JSON.stringify(newBank),
      });
      showFeedback("success", `Bank Account "${newBank.bankName}" created successfully.`);
      setShowAddBank(false);
      setNewBank({ bankName: "", branchName: "", accountNumber: "", iban: "", openingBalance: "" });
      fetchFinanceData();
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to open bank account");
    }
  };

  const handleInterbankTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/finance/banks/transfer", {
        method: "POST",
        body: JSON.stringify(transferForm),
      });
      showFeedback("success", "Inter-bank funds transfer and GL journal entries posted successfully.");
      setShowTransfer(false);
      setTransferForm({ sourceAccountId: "", destAccountId: "", amount: "", reference: "" });
      fetchFinanceData();
    } catch (err: any) {
      showFeedback("error", err.message || "Transfer failed");
    }
  };

  const handleRecordCashClosing = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/finance/cash-closing", {
        method: "POST",
        body: JSON.stringify(cashClosingForm),
      });
      showFeedback("success", "Daily petty cash declared and discrepancy calculated successfully.");
      setShowCashClosing(false);
      setCashClosingForm({ openingBalance: "", cashIn: "", cashOut: "", declaredBalance: "", notes: "" });
      fetchFinanceData();
    } catch (err: any) {
      showFeedback("error", err.message || "Closing failed");
    }
  };

  const handleApproveCashClosing = async (id: number) => {
    try {
      await enterpriseFetch(`/api/finance/cash-closing/${id}/approve`, {
        method: "PUT",
      });
      showFeedback("success", "Petty cash daily closing approved.");
      fetchFinanceData();
    } catch (err: any) {
      showFeedback("error", err.message || "Approval failed");
    }
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/finance/expenses", {
        method: "POST",
        body: JSON.stringify(newExpense),
      });
      showFeedback("success", "Operational Expense recorded & auto-reconciled against fleet asset logs.");
      setShowAddExpense(false);
      setNewExpense({ expenseType: "Fuel", amount: "", paymentMethod: "Cash", bankAccountId: "", tripId: "", vehicleId: "", driverId: "", notes: "" });
      fetchFinanceData();
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to log expense");
    }
  };

  const handleAccountStatusToggle = async (id: number, active: boolean) => {
    try {
      await enterpriseFetch(`/api/finance/accounts/${id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive: !active }),
      });
      showFeedback("success", `GL Account code successfully ${!active ? "activated" : "deactivated"}`);
      fetchFinanceData();
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to toggle account state");
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Tab bar header */}
      <div className="bg-slate-950/60 border border-slate-900 rounded-xl p-1.5 flex flex-wrap gap-1">
        {[
          { id: "overview", label: "Executive GL Summary", icon: TrendingUp },
          { id: "accounts", label: "Chart of Accounts", icon: BookOpen },
          { id: "journals", label: "General Ledger Journals", icon: FileText },
          { id: "receivables", label: "Accounts Receivable (AR)", icon: DollarSign },
          { id: "payables", label: "Accounts Payable (AP)", icon: CreditCard },
          { id: "cash_bank", label: "Bank & Petty Cash", icon: Landmark },
          { id: "expenses", label: "Operational Expenses", icon: Receipt },
          { id: "reports", label: "Financial Reports", icon: Activity },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = financeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setFinanceTab(tab.id as any)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono font-medium transition ${
                isActive 
                  ? "bg-blue-600/15 border border-blue-500/35 text-blue-400" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Primary Workspace */}
      {loading ? (
        <div className="flex items-center justify-center h-96 bg-slate-950/20 border border-slate-900 rounded-xl">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : (
        <AnimatePresence mode="wait">
          
          {/* 1. OVERVIEW TAB */}
          {financeTab === "overview" && profitability && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-950/50 border border-slate-900 rounded-xl p-5">
                  <p className="text-xs text-slate-500 font-mono">TOTAL BOOKED LOGISTICS REVENUE</p>
                  <p className="text-2xl font-bold tracking-tight text-white mt-1">PKR {profitability.summary.totalRevenue.toLocaleString()}</p>
                  <span className="text-[10px] text-emerald-500 font-mono flex items-center gap-1 mt-2 font-bold">● 100% Dynamic ledger</span>
                </div>
                <div className="bg-slate-950/50 border border-slate-900 rounded-xl p-5">
                  <p className="text-xs text-slate-500 font-mono">TOTAL OPERATIONAL COSTS (GL)</p>
                  <p className="text-2xl font-bold tracking-tight text-rose-400 mt-1">PKR {profitability.summary.totalExpenses.toLocaleString()}</p>
                  <span className="text-[10px] text-rose-500 font-mono flex items-center gap-1 mt-2 font-bold">● Multi-categorized costs</span>
                </div>
                <div className="bg-slate-950/50 border border-slate-900 rounded-xl p-5">
                  <p className="text-xs text-slate-500 font-mono">NET RECONCILED ENTERPRISE PROFIT</p>
                  <p className="text-2xl font-bold tracking-tight text-emerald-400 mt-1">PKR {profitability.summary.netProfit.toLocaleString()}</p>
                  <span className="text-[10px] text-emerald-500 font-mono flex items-center gap-1 mt-2 font-bold">● Standard corporate margin</span>
                </div>
                <div className="bg-slate-950/50 border border-slate-900 rounded-xl p-5">
                  <p className="text-xs text-slate-500 font-mono">DYNAMIC REVENUE PROFIT MARGIN</p>
                  <p className="text-2xl font-bold tracking-tight text-blue-400 mt-1">{profitability.summary.profitMargin}</p>
                  <span className="text-[10px] text-slate-600 font-mono flex items-center gap-1 mt-2">Corridor transport performance</span>
                </div>
              </div>

              {/* Profitability breakdown bento grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Vehicles breakdown */}
                <div className="bg-slate-950/30 border border-slate-900 rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Truck className="w-5 h-5 text-blue-400" />
                    <h3 className="font-semibold text-white text-sm">Vehicle Assets Performance</h3>
                  </div>
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {profitability.vehicles.length === 0 ? (
                      <p className="text-xs text-slate-500 font-mono">No active vehicle ledger postings yet.</p>
                    ) : (
                      profitability.vehicles.map((v: any, i: number) => {
                        const vNet = Number(v.revenue) - Number(v.expenses);
                        return (
                          <div key={i} className="bg-slate-950/60 border border-slate-900 p-3 rounded-lg flex items-center justify-between text-xs font-mono">
                            <div>
                              <p className="font-bold text-slate-300">{v.vehicleNumber}</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">Rev: PKR {Number(v.revenue).toLocaleString()}</p>
                            </div>
                            <div className="text-right">
                              <p className={vNet >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                                PKR {vNet.toLocaleString()}
                              </p>
                              <p className="text-[10px] text-slate-500 mt-0.5">Costs: PKR {Number(v.expenses).toLocaleString()}</p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Drivers breakdown */}
                <div className="bg-slate-950/30 border border-slate-900 rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Users className="w-5 h-5 text-blue-400" />
                    <h3 className="font-semibold text-white text-sm">Driver Profit Allocation</h3>
                  </div>
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {profitability.drivers.length === 0 ? (
                      <p className="text-xs text-slate-500 font-mono">No active driver roster payouts yet.</p>
                    ) : (
                      profitability.drivers.map((d: any, i: number) => {
                        const dNet = Number(d.revenue) - Number(d.expenses);
                        return (
                          <div key={i} className="bg-slate-950/60 border border-slate-900 p-3 rounded-lg flex items-center justify-between text-xs font-mono">
                            <div>
                              <p className="font-bold text-slate-300">{d.driverName}</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">Billing: PKR {Number(d.revenue).toLocaleString()}</p>
                            </div>
                            <div className="text-right">
                              <p className={dNet >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                                PKR {dNet.toLocaleString()}
                              </p>
                              <p className="text-[10px] text-slate-500 mt-0.5">Salaries/Food: PKR {Number(d.expenses).toLocaleString()}</p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Corridor Route profitability */}
                <div className="bg-slate-950/30 border border-slate-900 rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Layers className="w-5 h-5 text-blue-400" />
                    <h3 className="font-semibold text-white text-sm">Corridor Route Yields</h3>
                  </div>
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {profitability.routes.length === 0 ? (
                      <p className="text-xs text-slate-500 font-mono">No corridor trips billed yet.</p>
                    ) : (
                      profitability.routes.map((r: any, i: number) => {
                        const rNet = Number(r.revenue) - Number(r.expenses);
                        return (
                          <div key={i} className="bg-slate-950/60 border border-slate-900 p-3 rounded-lg flex items-center justify-between text-xs font-mono">
                            <div>
                              <p className="font-bold text-slate-300">{r.routeName}</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">Billing: PKR {Number(r.revenue).toLocaleString()}</p>
                            </div>
                            <div className="text-right">
                              <p className={rNet >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                                PKR {rNet.toLocaleString()}
                              </p>
                              <p className="text-[10px] text-slate-500 mt-0.5">Transit Exp: PKR {Number(r.expenses).toLocaleString()}</p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

              </div>
            </motion.div>
          )}

          {/* 2. CHART OF ACCOUNTS TAB */}
          {financeTab === "accounts" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white font-mono">Configurable Chart of Accounts</h3>
                  <p className="text-xs text-slate-500 font-mono">Define corporate ledgers to track Assets, Liabilities, Equity, Income, and Expenses.</p>
                </div>
                <button
                  onClick={() => setShowAddAccount(!showAddAccount)}
                  className="bg-blue-600 hover:bg-blue-500 text-xs text-white font-mono px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create GL Account</span>
                </button>
              </div>

              {/* Add account form */}
              {showAddAccount && (
                <motion.form
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  onSubmit={handleCreateAccount}
                  className="bg-slate-950/40 border border-slate-900 p-5 rounded-xl grid grid-cols-1 md:grid-cols-3 gap-4"
                >
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-slate-400 block">GL ACCOUNT CODE</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 5007"
                      value={newAccount.code}
                      onChange={(e) => setNewAccount({ ...newAccount, code: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-xs text-slate-200"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-slate-400 block">ACCOUNT NAME</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Workshop Spare Parts"
                      value={newAccount.name}
                      onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-xs text-slate-200"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-slate-400 block">ACCOUNT TYPE</label>
                    <select
                      value={newAccount.type}
                      onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-xs text-slate-300"
                    >
                      <option value="Asset">Asset</option>
                      <option value="Liability">Liability</option>
                      <option value="Equity">Equity</option>
                      <option value="Income">Income</option>
                      <option value="Expense">Expense</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-slate-400 block">ACCOUNT CATEGORY</label>
                    <select
                      value={newAccount.category}
                      onChange={(e) => setNewAccount({ ...newAccount, category: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-xs text-slate-300"
                    >
                      <option value="Cash">Cash</option>
                      <option value="Bank">Bank</option>
                      <option value="Accounts Receivable">Accounts Receivable</option>
                      <option value="Accounts Payable">Accounts Payable</option>
                      <option value="Fuel">Fuel</option>
                      <option value="Salary">Salary</option>
                      <option value="Maintenance">Maintenance</option>
                      <option value="Toll">Toll</option>
                      <option value="Insurance">Insurance</option>
                      <option value="Revenue">Revenue</option>
                      <option value="Depreciation">Depreciation</option>
                      <option value="Equity">Equity</option>
                      <option value="Tax">Tax</option>
                      <option value="Miscellaneous">Miscellaneous</option>
                    </select>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[11px] font-mono text-slate-400 block">DESCRIPTION</label>
                    <input
                      type="text"
                      placeholder="Enter details about this ledger balance..."
                      value={newAccount.description}
                      onChange={(e) => setNewAccount({ ...newAccount, description: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-xs text-slate-200"
                    />
                  </div>
                  <div className="md:col-span-3 flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowAddAccount(false)}
                      className="px-4 py-2 bg-slate-900 text-xs rounded-lg text-slate-400 font-mono"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 text-xs rounded-lg text-white font-mono"
                    >
                      Save GL Account
                    </button>
                  </div>
                </motion.form>
              )}

              {/* Accounts table */}
              <div className="border border-slate-900 rounded-xl overflow-hidden bg-slate-950/20">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-slate-950/60 border-b border-slate-900 text-slate-400">
                    <tr>
                      <th className="p-3">GL CODE</th>
                      <th className="p-3">ACCOUNT NAME</th>
                      <th className="p-3">TYPE</th>
                      <th className="p-3">CATEGORY</th>
                      <th className="p-3">STATUS</th>
                      <th className="p-3 text-right">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountsList.map((acc) => (
                      <tr key={acc.id} className="border-b border-slate-900/60 hover:bg-slate-950/30">
                        <td className="p-3 font-bold text-slate-300">{acc.code}</td>
                        <td className="p-3 text-slate-200">{acc.name}</td>
                        <td className="p-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            acc.type === "Asset" ? "bg-emerald-950/40 text-emerald-400" :
                            acc.type === "Liability" ? "bg-rose-950/40 text-rose-400" :
                            acc.type === "Equity" ? "bg-purple-950/40 text-purple-400" :
                            acc.type === "Income" ? "bg-blue-950/40 text-blue-400" :
                            "bg-slate-850 text-slate-400"
                          }`}>
                            {acc.type}
                          </span>
                        </td>
                        <td className="p-3 text-slate-400">{acc.category}</td>
                        <td className="p-3">
                          {acc.isActive ? (
                            <span className="text-emerald-400 flex items-center gap-1"><Check className="w-3.5 h-3.5"/> Active</span>
                          ) : (
                            <span className="text-slate-600 flex items-center gap-1"><Ban className="w-3.5 h-3.5"/> Inactive</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => handleAccountStatusToggle(acc.id, acc.isActive)}
                            className={`text-[10px] px-2 py-1 rounded border font-mono ${
                              acc.isActive 
                                ? "border-slate-800 hover:bg-slate-900 text-slate-400" 
                                : "border-blue-900/40 hover:bg-blue-950/30 text-blue-400"
                            }`}
                          >
                            {acc.isActive ? "Deactivate" : "Activate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* 3. GENERAL LEDGER JOURNALS TAB */}
          {financeTab === "journals" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white font-mono">Immutable General Ledger Journals</h3>
                  <p className="text-xs text-slate-500 font-mono">Real-time audit records of all business transactions. Reconciled, balanced debits & credits.</p>
                </div>
                <button
                  onClick={() => setShowAddJournal(!showAddJournal)}
                  className="bg-blue-600 hover:bg-blue-500 text-xs text-white font-mono px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Post Manual Journal</span>
                </button>
              </div>

              {/* Manual journal entry block */}
              {showAddJournal && (
                <motion.form
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onSubmit={handleCreateJournal}
                  className="bg-slate-950/40 border border-slate-900 p-5 rounded-xl space-y-4"
                >
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-slate-400 block">JOURNAL DESCRIPTION</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Month-end corporate office rent accrual"
                      value={newJournal.description}
                      onChange={(e) => setNewJournal({ ...newJournal, description: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-xs text-slate-200"
                    />
                  </div>

                  <div className="space-y-3">
                    <p className="text-[11px] font-mono text-slate-400">DEBIT / CREDIT LINES (MUST BALANCE Mathematically)</p>
                    {newJournal.lines.map((line, idx) => (
                      <div key={idx} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
                        <select
                          required
                          value={line.accountId}
                          onChange={(e) => {
                            const updated = [...newJournal.lines];
                            updated[idx].accountId = e.target.value;
                            setNewJournal({ ...newJournal, lines: updated });
                          }}
                          className="bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-xs text-slate-300"
                        >
                          <option value="">Select Ledger Account</option>
                          {accountsList.map((a) => (
                            <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          placeholder="Debit (PKR)"
                          value={line.debit || ""}
                          onChange={(e) => {
                            const updated = [...newJournal.lines];
                            updated[idx].debit = parseInt(e.target.value) || 0;
                            setNewJournal({ ...newJournal, lines: updated });
                          }}
                          className="bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-xs text-slate-200"
                        />
                        <input
                          type="number"
                          placeholder="Credit (PKR)"
                          value={line.credit || ""}
                          onChange={(e) => {
                            const updated = [...newJournal.lines];
                            updated[idx].credit = parseInt(e.target.value) || 0;
                            setNewJournal({ ...newJournal, lines: updated });
                          }}
                          className="bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-xs text-slate-200"
                        />
                        {newJournal.lines.length > 2 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = newJournal.lines.filter((_, i) => i !== idx);
                              setNewJournal({ ...newJournal, lines: updated });
                            }}
                            className="text-xs text-rose-400 font-mono hover:underline self-center text-left"
                          >
                            Remove Line
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setNewJournal({ ...newJournal, lines: [...newJournal.lines, { accountId: "", debit: 0, credit: 0 }] });
                      }}
                      className="text-xs text-blue-400 font-mono hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add Journal Line
                    </button>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-900">
                    <button
                      type="button"
                      onClick={() => setShowAddJournal(false)}
                      className="px-4 py-2 bg-slate-900 text-xs rounded-lg text-slate-400 font-mono"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 text-xs rounded-lg text-white font-mono"
                    >
                      Post Balanced Entry
                    </button>
                  </div>
                </motion.form>
              )}

              {/* Journals display list */}
              <div className="space-y-4">
                {journalsList.length === 0 ? (
                  <p className="text-xs text-slate-500 font-mono">No journal postings recorded in system.</p>
                ) : (
                  journalsList.map((je) => {
                    const totalDebit = je.lines.reduce((sum: number, l: any) => sum + l.debit, 0);
                    return (
                      <div key={je.id} className="bg-slate-950/40 border border-slate-900 rounded-xl p-4 space-y-3 font-mono text-xs">
                        <div className="flex items-center justify-between border-b border-slate-900/60 pb-2">
                          <div>
                            <span className="bg-blue-950/40 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-bold">{je.entryNumber}</span>
                            <span className="text-slate-300 ml-3">{je.description}</span>
                          </div>
                          <div className="text-slate-500 flex items-center gap-3">
                            <span>Source: <strong className="text-slate-400">{je.sourceType}</strong></span>
                            <span>{new Date(je.entryDate).toLocaleDateString()}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 text-slate-400">
                          {je.lines.map((l: any) => (
                            <React.Fragment key={l.id}>
                              <div className="md:col-span-6 flex justify-between pr-4 border-r border-slate-900/40">
                                <span className="font-bold text-slate-300">{l.accountCode} - {l.accountName}</span>
                                <span className="text-slate-500 text-[10px] italic">{l.description}</span>
                              </div>
                              <div className="md:col-span-3 text-right text-emerald-400">
                                {l.debit > 0 ? `PKR ${l.debit.toLocaleString()}` : "-"}
                              </div>
                              <div className="md:col-span-3 text-right text-blue-400">
                                {l.credit > 0 ? `PKR ${l.credit.toLocaleString()}` : "-"}
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                        <div className="border-t border-slate-900/40 pt-2 flex justify-between font-bold text-slate-400">
                          <span>Balanced Reconciled Status</span>
                          <span className="text-slate-300">Total: PKR {totalDebit.toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          )}

          {/* 4. ACCOUNTS RECEIVABLE TAB */}
          {financeTab === "receivables" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {/* Aging card layout */}
              {invoiceAging && (
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  {[
                    { label: "Current (0-30 days)", val: invoiceAging.current, bg: "bg-emerald-950/25 border-emerald-500/10 text-emerald-400" },
                    { label: "Overdue 31-60", val: invoiceAging.overdue30, bg: "bg-slate-950 border-slate-900 text-slate-400" },
                    { label: "Overdue 61-90", val: invoiceAging.overdue60, bg: "bg-slate-950 border-slate-900 text-slate-400" },
                    { label: "Overdue 91-120", val: invoiceAging.overdue90, bg: "bg-amber-950/25 border-amber-500/10 text-amber-400" },
                    { label: "Overdue 120+", val: invoiceAging.overdue120Plus, bg: "bg-rose-950/25 border-rose-500/10 text-rose-400" },
                    { label: "TOTAL OUTSTANDING AR", val: invoiceAging.totalAR, bg: "bg-blue-950/25 border-blue-500/20 text-blue-400 font-bold" }
                  ].map((buck, i) => (
                    <div key={i} className={`border rounded-xl p-3 text-center ${buck.bg}`}>
                      <p className="text-[10px] font-mono tracking-tight leading-tight uppercase opacity-75">{buck.label}</p>
                      <p className="text-base font-bold mt-1.5 font-mono">PKR {Number(buck.val).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Invoices list */}
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-sm font-semibold text-white font-mono">Contractor Invoices & Aging Receivables</h3>
                    <p className="text-xs text-slate-500 font-mono">Auto-generated on trip "Completed", or raise one manually.</p>
                  </div>
                  <button
                    onClick={() => onNavigate?.("finance", "invoices")}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" /> New Invoice
                  </button>
                </div>

                <div className="space-y-3">
                  {invoicesList.length === 0 ? (
                    <p className="text-xs text-slate-500 font-mono">No corridor billing invoices recorded yet.</p>
                  ) : (
                    invoicesList.map((inv) => (
                      <div key={inv.id} className="bg-slate-950/40 border border-slate-900 rounded-xl p-4 font-mono text-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-900 pb-3">
                          <div>
                            <span className="bg-blue-950/40 border border-blue-500/20 text-blue-400 px-2.5 py-0.5 rounded font-bold font-mono">{inv.invoiceNumber}</span>
                            <span className="text-slate-300 ml-3 font-semibold">{inv.contractorName}</span>
                            <span className="text-slate-500 ml-3">• Trip: {inv.tripNumber}</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded font-bold text-[10px] self-start sm:self-center ${
                            inv.status === "Paid" ? "bg-emerald-950/40 text-emerald-400" :
                            inv.status === "Partially Paid" ? "bg-amber-950/40 text-amber-400" :
                            "bg-rose-950/40 text-rose-400"
                          }`}>
                            {inv.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-3 text-slate-400">
                          <div>
                            <p className="text-[10px] text-slate-500">BILL DATE</p>
                            <p className="text-slate-300 font-semibold mt-0.5">{new Date(inv.invoiceDate).toLocaleDateString()}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-500">DUE DATE (NET 30)</p>
                            <p className="text-slate-300 font-semibold mt-0.5">{new Date(inv.dueDate).toLocaleDateString()}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-500">INVOICE TOTAL</p>
                            <p className="text-slate-300 mt-0.5">PKR {inv.totalAmount.toLocaleString()}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-slate-500">OUTSTANDING BALANCE</p>
                            <p className="text-white font-bold text-sm mt-0.5">PKR {inv.outstandingBalance.toLocaleString()}</p>
                          </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-900/60 flex justify-end gap-2">
                          <button
                            onClick={() => setViewInvoiceId(inv.id)}
                            className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-1.5 rounded-lg text-white transition flex items-center gap-1"
                          >
                            <Printer className="w-4 h-4" /> View / Print
                          </button>
                          <button
                            onClick={() => setShowInvoiceDocs(showInvoiceDocs === inv.id ? null : inv.id)}
                            className="bg-slate-700 hover:bg-slate-600 text-xs px-3 py-1.5 rounded-lg text-white transition flex items-center gap-1"
                          >
                            <Paperclip className="w-4 h-4" /> Proof
                          </button>
                          {inv.outstandingBalance > 0 && (
                            <button
                              onClick={() => setShowRecordPayment(showRecordPayment === inv.id ? null : inv.id)}
                              className="bg-blue-600 hover:bg-blue-500 text-xs px-3 py-1.5 rounded-lg text-white transition flex items-center gap-1"
                            >
                              <Plus className="w-4.5 h-4.5" /> Reconcile Payment
                            </button>
                          )}
                        </div>

                        {showInvoiceDocs === inv.id && (
                          <div className="mt-3 bg-white rounded-lg">
                            <AttachmentPanel entityType="invoice" entityId={inv.id} title={`Proof for ${inv.invoiceNumber}`} />
                          </div>
                        )}

                        {/* Record Payment Dropdown */}
                        {showRecordPayment === inv.id && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="bg-slate-950 border border-slate-900 p-4 rounded-lg mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-end"
                          >
                            <div>
                              <label className="text-[10px] text-slate-500 block mb-1">PAYMENT AMOUNT (PKR)</label>
                              <input
                                type="number"
                                required
                                placeholder="Enter amount received..."
                                value={newPayment.amount}
                                onChange={(e) => setNewPayment({ ...newPayment, amount: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-900 px-2.5 py-1.5 rounded-md text-slate-200"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-500 block mb-1">RECIPIENT BANK / CASH LEDGER</label>
                              <select
                                value={newPayment.bankAccountId}
                                onChange={(e) => setNewPayment({ ...newPayment, bankAccountId: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-900 px-2.5 py-1.5 rounded-md text-slate-300"
                              >
                                <option value="">Physical Petty Cash Box</option>
                                {banksList.map((b) => (
                                  <option key={b.id} value={b.id}>{b.bankName} - Bal: PKR {b.currentBalance.toLocaleString()}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-500 block mb-1">PAYMENT METHOD</label>
                              <select
                                value={newPayment.paymentMethod}
                                onChange={(e) => setNewPayment({ ...newPayment, paymentMethod: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-900 px-2.5 py-1.5 rounded-md text-slate-300"
                              >
                                <option value="Bank Transfer">Bank Transfer</option>
                                <option value="Cash">Cash</option>
                                <option value="Cheque">Cheque</option>
                                <option value="Online Transfer">Online Transfer</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-500 block mb-1">TRANSACTION REFERENCE</label>
                              <input
                                type="text"
                                placeholder="Cheque # / Trans ID..."
                                value={newPayment.referenceNumber}
                                onChange={(e) => setNewPayment({ ...newPayment, referenceNumber: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-900 px-2.5 py-1.5 rounded-md text-slate-200"
                              />
                            </div>
                            <div className="md:col-span-2 flex justify-end gap-2">
                              <button
                                onClick={() => setShowRecordPayment(null)}
                                className="px-3.5 py-2 bg-slate-900 text-slate-400 rounded-lg"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleRecordPayment(inv.id)}
                                className="px-3.5 py-2 bg-blue-600 text-white rounded-lg font-bold"
                              >
                                Apply Contractor Payment
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* 5. ACCOUNTS PAYABLE TAB */}
          {financeTab === "payables" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {billAging && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {[
                    { label: "Current AP", val: billAging.current, bg: "bg-emerald-950/25 border-emerald-500/10 text-emerald-400" },
                    { label: "Overdue 1-30 days", val: billAging.overdue30, bg: "bg-slate-950 border-slate-900 text-slate-400" },
                    { label: "Overdue 31-60 days", val: billAging.overdue60, bg: "bg-slate-950 border-slate-900 text-slate-400" },
                    { label: "Overdue 61-90 days", val: billAging.overdue90, bg: "bg-amber-950/25 border-amber-500/10 text-amber-400" },
                    { label: "TOTAL LIABILITIES (AP)", val: billAging.totalAP, bg: "bg-rose-950/25 border-rose-500/20 text-rose-400 font-bold" }
                  ].map((buck, i) => (
                    <div key={i} className={`border rounded-xl p-3 text-center ${buck.bg}`}>
                      <p className="text-[10px] font-mono tracking-tight leading-tight uppercase opacity-75">{buck.label}</p>
                      <p className="text-base font-bold mt-1.5 font-mono">PKR {Number(buck.val).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white font-mono font-bold">Accounts Payable & Supplier Liabilities</h3>
                  <p className="text-xs text-slate-500 font-mono">Track and pay company operational liabilities (fuel suppliers, spare parts warehouses).</p>
                </div>
                <button
                  onClick={() => setShowAddBill(!showAddBill)}
                  className="bg-blue-600 hover:bg-blue-500 text-xs text-white font-mono px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition"
                >
                  <Plus className="w-4.5 h-4.5" />
                  <span>Log Vendor Bill</span>
                </button>
              </div>

              {showAddBill && (
                <motion.form
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onSubmit={handleCreateBill}
                  className="bg-slate-950/40 border border-slate-900 p-5 rounded-xl grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs"
                >
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 block mb-1">VENDOR TYPE</label>
                    <select
                      value={newBill.vendorType}
                      onChange={(e) => setNewBill({ ...newBill, vendorType: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-300"
                    >
                      <option value="Fuel Vendor">Fuel Vendor</option>
                      <option value="Repair Workshop">Repair Workshop</option>
                      <option value="Tyre Supplier">Tyre Supplier</option>
                      <option value="Insurance Company">Insurance Company</option>
                      <option value="Contractor">Sub-Contractor</option>
                      <option value="Office Expense">Office Expense</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 block mb-1">VENDOR NAME</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. PSO Pakistan"
                      value={newBill.vendorName}
                      onChange={(e) => setNewBill({ ...newBill, vendorName: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 block mb-1">DUE DATE</label>
                    <input
                      type="date"
                      required
                      value={newBill.dueDate}
                      onChange={(e) => setNewBill({ ...newBill, dueDate: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 block mb-1">BILL AMOUNT (PKR)</label>
                    <input
                      type="number"
                      required
                      placeholder="Enter outstanding amount..."
                      value={newBill.amount}
                      onChange={(e) => setNewBill({ ...newBill, amount: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 block mb-1">GL DEBIT ACCOUNT</label>
                    <select
                      value={newBill.expenseTypeCode}
                      onChange={(e) => setNewBill({ ...newBill, expenseTypeCode: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-300"
                    >
                      <option value="5001">5001 - Fuel Expense</option>
                      <option value="5003">5003 - Maintenance & Repairs</option>
                      <option value="5004">5004 - Insurance Premium</option>
                      <option value="5099">5099 - Miscellaneous Operating Cost</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 block mb-1">BILL DESCRIPTION</label>
                    <input
                      type="text"
                      placeholder="e.g. Bulk diesel tank refilling terminal B"
                      value={newBill.notes}
                      onChange={(e) => setNewBill({ ...newBill, notes: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                    />
                  </div>
                  <div className="md:col-span-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddBill(false)}
                      className="px-4 py-2 bg-slate-900 text-slate-400 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold"
                    >
                      Post Vendor Bill
                    </button>
                  </div>
                </motion.form>
              )}

              {/* Bills List */}
              <div className="space-y-3">
                {billsList.length === 0 ? (
                  <p className="text-xs text-slate-500 font-mono">No vendor bills recorded in database.</p>
                ) : (
                  billsList.map((bill) => (
                    <div key={bill.id} className="bg-slate-950/40 border border-slate-900 rounded-xl p-4 font-mono text-xs">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-900 pb-3">
                        <div>
                          <span className="bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded font-bold font-mono">{bill.billNumber}</span>
                          <span className="text-slate-300 ml-3 font-semibold">{bill.vendorName}</span>
                          <span className="text-slate-500 ml-2">• ({bill.vendorType})</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded font-bold text-[10px] self-start sm:self-center ${
                          bill.status === "Paid" ? "bg-emerald-950/40 text-emerald-400" :
                          bill.status === "Partially Paid" ? "bg-amber-950/40 text-amber-400" :
                          "bg-rose-950/40 text-rose-400"
                        }`}>
                          {bill.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-3 text-slate-400">
                        <div>
                          <p className="text-[10px] text-slate-500">BILL DATE</p>
                          <p className="text-slate-300 font-semibold mt-0.5">{new Date(bill.billDate).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500">DUE DATE</p>
                          <p className="text-slate-300 font-semibold mt-0.5">{new Date(bill.dueDate).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500">DESCRIPTION NOTES</p>
                          <p className="text-slate-300 mt-0.5 truncate">{bill.notes || "No details provided"}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-slate-500">OUTSTANDING LIABILITY</p>
                          <p className="text-rose-400 font-bold text-sm mt-0.5">PKR {bill.outstandingBalance.toLocaleString()}</p>
                        </div>
                      </div>

                      {bill.outstandingBalance > 0 && (
                        <div className="mt-4 pt-3 border-t border-slate-900/60 flex justify-end">
                          <button
                            onClick={() => setShowPayBill(showPayBill === bill.id ? null : bill.id)}
                            className="bg-blue-600 hover:bg-blue-500 text-xs px-3 py-1.5 rounded-lg text-white transition flex items-center gap-1"
                          >
                            <CreditCard className="w-4 h-4" /> Pay Supplier Bill
                          </button>
                        </div>
                      )}

                      {showPayBill === bill.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="bg-slate-950 border border-slate-900 p-4 rounded-lg mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-end"
                        >
                          <div>
                            <label className="text-[10px] text-slate-500 block mb-1">PAYMENT AMOUNT (PKR)</label>
                            <input
                              type="number"
                              required
                              placeholder="Enter payout amount..."
                              value={newBillPayment.amount}
                              onChange={(e) => setNewBillPayment({ ...newBillPayment, amount: e.target.value })}
                              className="w-full bg-slate-950 border border-slate-900 px-2.5 py-1.5 rounded-md text-slate-200"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-500 block mb-1">SOURCE BANK / CASH LEDGER</label>
                            <select
                              value={newBillPayment.bankAccountId}
                              onChange={(e) => setNewBillPayment({ ...newBillPayment, bankAccountId: e.target.value })}
                              className="w-full bg-slate-950 border border-slate-900 px-2.5 py-1.5 rounded-md text-slate-300"
                            >
                              <option value="">Physical Petty Cash Box</option>
                              {banksList.map((b) => (
                                <option key={b.id} value={b.id}>{b.bankName} - Bal: PKR {b.currentBalance.toLocaleString()}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-500 block mb-1">METHOD</label>
                            <select
                              value={newBillPayment.paymentMethod}
                              onChange={(e) => setNewBillPayment({ ...newBillPayment, paymentMethod: e.target.value })}
                              className="w-full bg-slate-950 border border-slate-900 px-2.5 py-1.5 rounded-md text-slate-300"
                            >
                              <option value="Bank Transfer">Bank Transfer</option>
                              <option value="Cash">Cash</option>
                              <option value="Cheque">Cheque</option>
                            </select>
                          </div>
                          <div className="md:col-span-3 flex justify-end gap-2">
                            <button
                              onClick={() => setShowPayBill(null)}
                              className="px-3.5 py-2 bg-slate-900 text-slate-400 rounded-lg"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handlePayBill(bill.id)}
                              className="px-3.5 py-2 bg-blue-600 text-white rounded-lg font-bold"
                            >
                              Execute Payout & Accrue GL
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {/* 6. BANK & CASH TAB */}
          {financeTab === "cash_bank" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {/* Banks List cards */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white font-mono font-bold">Liquid Bank Accounts</h3>
                    <p className="text-xs text-slate-500 font-mono">Manage liquidity and inter-bank transfers.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowTransfer(!showTransfer)}
                      className="border border-slate-800 hover:bg-slate-900 text-xs text-slate-300 font-mono px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition"
                    >
                      <ArrowRightLeft className="w-4 h-4" />
                      <span>Inter-bank Transfer</span>
                    </button>
                    <button
                      onClick={() => setShowAddBank(!showAddBank)}
                      className="bg-blue-600 hover:bg-blue-500 text-xs text-white font-mono px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Open Corporate Bank</span>
                    </button>
                  </div>
                </div>

                {/* Add bank form */}
                {showAddBank && (
                  <motion.form
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onSubmit={handleCreateBank}
                    className="bg-slate-950/40 border border-slate-900 p-5 rounded-xl grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs"
                  >
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 block mb-1">BANK NAME</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. United Bank Limited"
                        value={newBank.bankName}
                        onChange={(e) => setNewBank({ ...newBank, bankName: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 block mb-1">BRANCH NAME / CODE</label>
                      <input
                        type="text"
                        placeholder="e.g. I.I Chundrigar Road"
                        value={newBank.branchName}
                        onChange={(e) => setNewBank({ ...newBank, branchName: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 block mb-1">ACCOUNT NUMBER</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. 0214589632"
                        value={newBank.accountNumber}
                        onChange={(e) => setNewBank({ ...newBank, accountNumber: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 block mb-1">IBAN NUMBER</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. PK89UBL000000214589632"
                        value={newBank.iban}
                        onChange={(e) => setNewBank({ ...newBank, iban: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 block mb-1">OPENING BALANCE (PKR)</label>
                      <input
                        type="number"
                        placeholder="e.g. 5000000"
                        value={newBank.openingBalance}
                        onChange={(e) => setNewBank({ ...newBank, openingBalance: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                      />
                    </div>
                    <div className="md:col-span-3 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAddBank(false)}
                        className="px-4 py-2 bg-slate-900 text-slate-400 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold"
                      >
                        Open Bank Account
                      </button>
                    </div>
                  </motion.form>
                )}

                {/* Transfer funds form */}
                {showTransfer && (
                  <motion.form
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onSubmit={handleInterbankTransfer}
                    className="bg-slate-950/40 border border-slate-900 p-5 rounded-xl grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs"
                  >
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 block mb-1">SENDER ACCOUNT (CREDIT)</label>
                      <select
                        required
                        value={transferForm.sourceAccountId}
                        onChange={(e) => setTransferForm({ ...transferForm, sourceAccountId: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-300"
                      >
                        <option value="">Select source account</option>
                        {banksList.map((b) => (
                          <option key={b.id} value={b.id}>{b.bankName} - Bal: PKR {b.currentBalance.toLocaleString()}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 block mb-1">RECEIVER ACCOUNT (DEBIT)</label>
                      <select
                        required
                        value={transferForm.destAccountId}
                        onChange={(e) => setTransferForm({ ...transferForm, destAccountId: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-300"
                      >
                        <option value="">Select recipient account</option>
                        {banksList.map((b) => (
                          <option key={b.id} value={b.id}>{b.bankName} - Bal: PKR {b.currentBalance.toLocaleString()}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 block mb-1">TRANSFER AMOUNT (PKR)</label>
                      <input
                        type="number"
                        required
                        placeholder="Enter amount..."
                        value={transferForm.amount}
                        onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[10px] text-slate-500 block mb-1">REFERENCE DETAILS</label>
                      <input
                        type="text"
                        placeholder="Details or reason for this interbank transfer..."
                        value={transferForm.reference}
                        onChange={(e) => setTransferForm({ ...transferForm, reference: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                      />
                    </div>
                    <div className="md:col-span-3 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowTransfer(false)}
                        className="px-4 py-2 bg-slate-900 text-slate-400 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold"
                      >
                        Post Inter-bank Transfer
                      </button>
                    </div>
                  </motion.form>
                )}

                {/* Banks List Display */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {banksList.map((bank) => (
                    <div key={bank.id} className="bg-slate-950/40 border border-slate-900 rounded-xl p-5 font-mono text-xs space-y-3 relative overflow-hidden">
                      <div className="flex items-center justify-between border-b border-slate-900/60 pb-2">
                        <span className="font-bold text-slate-200 text-sm">{bank.bankName}</span>
                        <span className="bg-emerald-950/40 border border-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 rounded">Active</span>
                      </div>
                      <div className="space-y-1.5 text-slate-400">
                        <p>Account: <strong className="text-slate-300">{bank.accountNumber}</strong></p>
                        <p>IBAN: <strong className="text-slate-300">{bank.iban}</strong></p>
                        <p>Branch: <strong className="text-slate-300">{bank.branchName || "Main Branch"}</strong></p>
                      </div>
                      <div className="border-t border-slate-900/60 pt-2 flex justify-between items-center">
                        <span className="text-slate-500">CURRENT LEDGER BALANCE</span>
                        <span className="text-white font-bold text-base">PKR {bank.currentBalance.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Petty Cash Daily Closings */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white font-mono font-bold">Petty Cash Daily Closings (Module 6)</h3>
                    <p className="text-xs text-slate-500 font-mono">Operations managers must record daily cash reconciliations with automatic discrepancies tracking.</p>
                  </div>
                  <button
                    onClick={() => setShowCashClosing(!showCashClosing)}
                    className="bg-blue-600 hover:bg-blue-500 text-xs text-white font-mono px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Record Cash Closing</span>
                  </button>
                </div>

                {showCashClosing && (
                  <motion.form
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onSubmit={handleRecordCashClosing}
                    className="bg-slate-950/40 border border-slate-900 p-5 rounded-xl grid grid-cols-1 md:grid-cols-4 gap-4 font-mono text-xs"
                  >
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 block mb-1">OPENING BALANCE (PKR)</label>
                      <input
                        type="number"
                        required
                        placeholder="e.g. 150000"
                        value={cashClosingForm.openingBalance}
                        onChange={(e) => setCashClosingForm({ ...cashClosingForm, openingBalance: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 block mb-1">TOTAL DAILY CASH IN</label>
                      <input
                        type="number"
                        required
                        placeholder="e.g. 50000"
                        value={cashClosingForm.cashIn}
                        onChange={(e) => setCashClosingForm({ ...cashClosingForm, cashIn: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 block mb-1">TOTAL DAILY CASH OUT</label>
                      <input
                        type="number"
                        required
                        placeholder="e.g. 25000"
                        value={cashClosingForm.cashOut}
                        onChange={(e) => setCashClosingForm({ ...cashClosingForm, cashOut: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 block mb-1">DECLARED PHYSICAL CASH</label>
                      <input
                        type="number"
                        required
                        placeholder="Physical count box sum..."
                        value={cashClosingForm.declaredBalance}
                        onChange={(e) => setCashClosingForm({ ...cashClosingForm, declaredBalance: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <label className="text-[10px] text-slate-500 block mb-1">NOTES / AUDIT ADJUSTMENT REASON</label>
                      <input
                        type="text"
                        placeholder="Reason for cash difference, adjustments reasons..."
                        value={cashClosingForm.notes}
                        onChange={(e) => setCashClosingForm({ ...cashClosingForm, notes: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                      />
                    </div>
                    <div className="flex justify-end items-end">
                      <button
                        type="submit"
                        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-bold"
                      >
                        Submit Closing
                      </button>
                    </div>
                  </motion.form>
                )}

                {/* Closings list */}
                <div className="border border-slate-900 rounded-xl overflow-hidden bg-slate-950/20">
                  <table className="w-full text-left font-mono text-xs">
                    <thead className="bg-slate-950/60 border-b border-slate-900 text-slate-400">
                      <tr>
                        <th className="p-3">DATE</th>
                        <th className="p-3">OPENING</th>
                        <th className="p-3">CASH IN / OUT</th>
                        <th className="p-3">SYSTEM CALC</th>
                        <th className="p-3">DECLARED PHYSICAL</th>
                        <th className="p-3">DISCREPANCY</th>
                        <th className="p-3">STATUS</th>
                        <th className="p-3 text-right">ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashClosings.map((cc) => (
                        <tr key={cc.id} className="border-b border-slate-900/60 hover:bg-slate-950/30">
                          <td className="p-3 text-slate-300">{new Date(cc.closingDate).toLocaleDateString()}</td>
                          <td className="p-3 text-slate-400">PKR {cc.openingBalance.toLocaleString()}</td>
                          <td className="p-3 text-slate-400">+{cc.cashIn.toLocaleString()} / -{cc.cashOut.toLocaleString()}</td>
                          <td className="p-3 text-slate-400">PKR {cc.closingBalance.toLocaleString()}</td>
                          <td className="p-3 text-slate-200 font-semibold">PKR {cc.declaredBalance.toLocaleString()}</td>
                          <td className="p-3">
                            {cc.discrepancy === 0 ? (
                              <span className="text-emerald-400 font-bold">Balanced</span>
                            ) : (
                              <span className="text-rose-400 font-bold">PKR {cc.discrepancy.toLocaleString()}</span>
                            )}
                          </td>
                          <td className="p-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              cc.status === "Approved" ? "bg-emerald-950/40 text-emerald-400" : "bg-slate-850 text-slate-400"
                            }`}>
                              {cc.status}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {cc.status === "Draft" && (dbUser.role === "Super Admin" || dbUser.role === "Admin") ? (
                              <button
                                onClick={() => handleApproveCashClosing(cc.id)}
                                className="bg-emerald-950 border border-emerald-500/20 hover:bg-emerald-900/40 text-emerald-400 text-[10px] px-2 py-1 rounded font-bold font-mono"
                              >
                                Approve
                              </button>
                            ) : (
                              <span className="text-slate-600 text-[11px]">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

              </div>
            </motion.div>
          )}

          {/* 7. OPERATIONAL EXPENSES TAB */}
          {financeTab === "expenses" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white font-mono font-bold">Operational Fleet Expenses</h3>
                  <p className="text-xs text-slate-500 font-mono">Log on-route transit expenses, directly linking them to trips, drivers, and vehicles.</p>
                </div>
                <button
                  onClick={() => setShowAddExpense(!showAddExpense)}
                  className="bg-blue-600 hover:bg-blue-500 text-xs text-white font-mono px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Log Operational Expense</span>
                </button>
              </div>

              {showAddExpense && (
                <motion.form
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onSubmit={handleCreateExpense}
                  className="bg-slate-950/40 border border-slate-900 p-5 rounded-xl grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs"
                >
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 block mb-1">EXPENSE TYPE CATEGORY</label>
                    <select
                      value={newExpense.expenseType}
                      onChange={(e) => setNewExpense({ ...newExpense, expenseType: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-300"
                    >
                      <option value="Fuel">Fuel / Diesel</option>
                      <option value="Salary">Driver Base / Accrued Salary</option>
                      <option value="Maintenance">Maintenance & Workshop repairs</option>
                      <option value="Insurance">Asset / Cargo Insurance Policy</option>
                      <option value="Toll">Motorways Toll & Transit Taxes</option>
                      <option value="Repairs">Workshop spare parts repairs</option>
                      <option value="Miscellaneous">Miscellaneous Overhead</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 block mb-1">AMOUNT IN PKR</label>
                    <input
                      type="number"
                      required
                      placeholder="Enter amount..."
                      value={newExpense.amount}
                      onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 block mb-1">PAYMENT METHOD</label>
                    <select
                      value={newExpense.paymentMethod}
                      onChange={(e) => setNewExpense({ ...newExpense, paymentMethod: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-300"
                    >
                      <option value="Cash">Cash</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="Card">Corporate Credit Card</option>
                      <option value="Cheque">Corporate Cheque</option>
                    </select>
                  </div>
                  {newExpense.paymentMethod !== "Cash" && (
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 block mb-1">SENDER CORPORATE BANK</label>
                      <select
                        value={newExpense.bankAccountId}
                        onChange={(e) => setNewExpense({ ...newExpense, bankAccountId: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-300"
                      >
                        <option value="">Select corporate bank account</option>
                        {banksList.map((b) => (
                          <option key={b.id} value={b.id}>{b.bankName} - Bal: PKR {b.currentBalance.toLocaleString()}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 block mb-1">ALLOCATE TO VEHICLE (optional)</label>
                    <select
                      value={newExpense.vehicleId}
                      onChange={(e) => setNewExpense({ ...newExpense, vehicleId: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-300"
                    >
                      <option value="">Unallocated</option>
                      {vehiclesList.map((v) => (
                        <option key={v.id} value={v.id}>{v.vehicleNumber}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 block mb-1">ALLOCATE TO DRIVER (optional)</label>
                    <select
                      value={newExpense.driverId}
                      onChange={(e) => setNewExpense({ ...newExpense, driverId: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-300"
                    >
                      <option value="">Unallocated</option>
                      {driversList.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 block mb-1">LINK TO ACTIVE TRIP (optional)</label>
                    <select
                      value={newExpense.tripId}
                      onChange={(e) => setNewExpense({ ...newExpense, tripId: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-300"
                    >
                      <option value="">Unallocated</option>
                      {tripsList.map((t) => (
                        <option key={t.id} value={t.id}>{t.tripNumber}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-slate-500 block mb-1">MEMO / DETAILS</label>
                    <input
                      type="text"
                      placeholder="e.g. Motorway transit toll tax Lahore-Islamabad segment"
                      value={newExpense.notes}
                      onChange={(e) => setNewExpense({ ...newExpense, notes: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-900 px-3 py-2 rounded-lg text-slate-200"
                    />
                  </div>
                  <div className="md:col-span-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddExpense(false)}
                      className="px-4 py-2 bg-slate-900 text-slate-400 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold"
                    >
                      Log Operational Expense
                    </button>
                  </div>
                </motion.form>
              )}

              {/* Expense list table */}
              <div className="border border-slate-900 rounded-xl overflow-hidden bg-slate-950/20">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-slate-950/60 border-b border-slate-900 text-slate-400">
                    <tr>
                      <th className="p-3">EXP CODE</th>
                      <th className="p-3">TYPE</th>
                      <th className="p-3">AMOUNT</th>
                      <th className="p-3">VEHICLE</th>
                      <th className="p-3">DRIVER</th>
                      <th className="p-3">TRIP</th>
                      <th className="p-3">METHOD</th>
                      <th className="p-3">DATE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expensesList.map((exp) => (
                      <React.Fragment key={exp.id}>
                      <tr className="border-b border-slate-900/60 hover:bg-slate-950/30 cursor-pointer" onClick={() => setExpandedExpenseId(expandedExpenseId === exp.id ? null : exp.id)}>
                        <td className="p-3 font-bold text-slate-300">{exp.expenseNumber}</td>
                        <td className="p-3">
                          <span className="bg-slate-900 text-slate-300 px-2 py-0.5 rounded text-[10px] font-bold">
                            {exp.expenseType}
                          </span>
                        </td>
                        <td className="p-3 text-rose-400 font-bold">PKR {exp.amount.toLocaleString()}</td>
                        <td className="p-3 text-slate-400">{exp.vehicleNumber || "General"}</td>
                        <td className="p-3 text-slate-400">{exp.driverName || "General"}</td>
                        <td className="p-3 text-slate-400">{exp.tripNumber || "General"}</td>
                        <td className="p-3 text-slate-500">{exp.paymentMethod}</td>
                        <td className="p-3 text-slate-500 flex items-center gap-1"><Paperclip className="w-3 h-3 text-slate-600" />{new Date(exp.expenseDate).toLocaleDateString()}</td>
                      </tr>
                      {expandedExpenseId === exp.id && (
                        <tr><td colSpan={8} className="p-3 bg-white"><AttachmentPanel entityType="expense" entityId={exp.id} title={`Receipts for ${exp.expenseNumber}`} /></td></tr>
                      )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

            </motion.div>
          )}

          {/* 8. FINANCIAL REPORTS TAB */}
          {financeTab === "reports" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* 1. Trial Balance */}
                <div className="bg-slate-950/30 border border-slate-900 rounded-xl p-5 space-y-4">
                  <div>
                    <h4 className="font-bold text-white text-sm font-mono flex items-center gap-1"><BookOpen className="w-4.5 h-4.5 text-blue-400"/> Trial Balance</h4>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">Sum of all ledger debits and credits. Strict mathematical balance.</p>
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1 text-[11px] font-mono">
                    <div className="grid grid-cols-12 font-bold text-slate-500 border-b border-slate-900 pb-2">
                      <span className="col-span-6">GL ACCOUNT NAME</span>
                      <span className="col-span-3 text-right">DEBIT</span>
                      <span className="col-span-3 text-right">CREDIT</span>
                    </div>
                    {trialBalance.map((row, i) => (
                      <div key={i} className="grid grid-cols-12 py-1 border-b border-slate-900/40 text-slate-400">
                        <span className="col-span-6 text-slate-200">{row.accountCode} - {row.accountName}</span>
                        <span className="col-span-3 text-right text-emerald-400">{Number(row.totalDebit) > 0 ? `PKR ${Number(row.totalDebit).toLocaleString()}` : "-"}</span>
                        <span className="col-span-3 text-right text-blue-400">{Number(row.totalCredit) > 0 ? `PKR ${Number(row.totalCredit).toLocaleString()}` : "-"}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. Income Statement (P&L) */}
                <div className="bg-slate-950/30 border border-slate-900 rounded-xl p-5 space-y-4">
                  <div>
                    <h4 className="font-bold text-white text-sm font-mono flex items-center gap-1"><TrendingUp className="w-4.5 h-4.5 text-blue-400"/> Income Statement (Profit & Loss)</h4>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">Calculated dynamically from real operating revenues and operating expenses.</p>
                  </div>
                  {incomeStatement && (
                    <div className="space-y-3 text-[11px] font-mono text-slate-400">
                      <div className="border-b border-slate-900 pb-2 font-bold text-slate-300 flex justify-between">
                        <span>OPERATING REVENUES</span>
                        <span>BALANCE</span>
                      </div>
                      {incomeStatement.income.map((row: any, i: number) => (
                        <div key={i} className="flex justify-between py-1 border-b border-slate-900/40">
                          <span>{row.code} - {row.name}</span>
                          <span className="text-emerald-400">PKR {row.balance.toLocaleString()}</span>
                        </div>
                      ))}

                      <div className="border-b border-slate-900 pb-2 pt-2 font-bold text-slate-300 flex justify-between">
                        <span>OPERATING EXPENSES</span>
                        <span>BALANCE</span>
                      </div>
                      {incomeStatement.expenses.map((row: any, i: number) => (
                        <div key={i} className="flex justify-between py-1 border-b border-slate-900/40">
                          <span>{row.code} - {row.name}</span>
                          <span className="text-rose-400">PKR {row.balance.toLocaleString()}</span>
                        </div>
                      ))}

                      {/* Net calculate */}
                      {(() => {
                        const totalInc = incomeStatement.income.reduce((sum: number, r: any) => sum + r.balance, 0);
                        const totalExp = incomeStatement.expenses.reduce((sum: number, r: any) => sum + r.balance, 0);
                        const net = totalInc - totalExp;
                        return (
                          <div className="border-t border-slate-900 pt-3 flex justify-between font-bold text-sm text-white">
                            <span>NET EARNED OPERATING PROFIT</span>
                            <span className={net >= 0 ? "text-emerald-400" : "text-rose-400"}>PKR {net.toLocaleString()}</span>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* 3. Balance Sheet */}
                <div className="bg-slate-950/30 border border-slate-900 rounded-xl p-5 space-y-4 lg:col-span-2">
                  <div>
                    <h4 className="font-bold text-white text-sm font-mono flex items-center gap-1"><Landmark className="w-4.5 h-4.5 text-blue-400"/> Corporate Balance Sheet</h4>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">Summary of company Assets, Liabilities, and Equity. Balanced as Assets = Liabilities + Equity.</p>
                  </div>
                  {balanceSheet && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-[11px] font-mono text-slate-400">
                      
                      {/* Assets Column */}
                      <div className="space-y-2">
                        <p className="font-bold text-slate-300 border-b border-slate-900 pb-1 uppercase">ASSETS (DEBIT BALANCES)</p>
                        {balanceSheet.assets.map((row: any, i: number) => (
                          <div key={i} className="flex justify-between py-1 border-b border-slate-900/40">
                            <span>{row.code} - {row.name}</span>
                            <span className="text-slate-200">PKR {row.balance.toLocaleString()}</span>
                          </div>
                        ))}
                        <div className="pt-2 flex justify-between font-bold text-white border-t border-slate-900">
                          <span>TOTAL ASSETS</span>
                          <span>PKR {balanceSheet.assets.reduce((s: number, r: any) => s + r.balance, 0).toLocaleString()}</span>
                        </div>
                      </div>

                      {/* Liabilities Column */}
                      <div className="space-y-2">
                        <p className="font-bold text-slate-300 border-b border-slate-900 pb-1 uppercase">LIABILITIES (CREDIT BALANCES)</p>
                        {balanceSheet.liabilities.map((row: any, i: number) => (
                          <div key={i} className="flex justify-between py-1 border-b border-slate-900/40">
                            <span>{row.code} - {row.name}</span>
                            <span className="text-slate-200">PKR {row.balance.toLocaleString()}</span>
                          </div>
                        ))}
                        <div className="pt-2 flex justify-between font-bold text-slate-300 border-t border-slate-900">
                          <span>TOTAL LIABILITIES</span>
                          <span>PKR {balanceSheet.liabilities.reduce((s: number, r: any) => s + r.balance, 0).toLocaleString()}</span>
                        </div>
                      </div>

                      {/* Equity Column */}
                      <div className="space-y-2">
                        <p className="font-bold text-slate-300 border-b border-slate-900 pb-1 uppercase">EQUITY (CREDIT BALANCES)</p>
                        {balanceSheet.equity.map((row: any, i: number) => (
                          <div key={i} className="flex justify-between py-1 border-b border-slate-900/40">
                            <span>{row.code} - {row.name}</span>
                            <span className="text-slate-200">PKR {row.balance.toLocaleString()}</span>
                          </div>
                        ))}
                        <div className="pt-2 flex justify-between font-bold text-slate-300 border-t border-slate-900">
                          <span>TOTAL EQUITY</span>
                          <span>PKR {balanceSheet.equity.reduce((s: number, r: any) => s + r.balance, 0).toLocaleString()}</span>
                        </div>
                      </div>

                    </div>
                  )}
                </div>

              </div>
            </motion.div>
          )}

        </AnimatePresence>
      )}

      {viewInvoiceId != null && (
        <InvoiceDocument invoiceId={viewInvoiceId} onClose={() => setViewInvoiceId(null)} />
      )}

    </div>
  );
}
