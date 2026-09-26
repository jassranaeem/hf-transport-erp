/**
 * Finance Overview — a lean hub, not a mega-dashboard. Correct top-line
 * numbers (read from the real General Ledger, same source as the Income
 * Statement — not the narrower `invoices`/`expenses` tables), plus one-click
 * links out to every linked module: Invoices, Quotations, Bills, Payments,
 * Expenses, Cash Closings, Bank Accounts, Chart of Accounts, Journal
 * Entries, Partners.
 *
 * Deliberately does NOT duplicate those modules' own forms/tables inline —
 * that duplication (the old FinanceDashboard) is exactly what made the
 * numbers here drift from the real sheets. This just summarizes and links.
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import {
  Briefcase, RefreshCw, Loader2, TrendingUp, TrendingDown, Landmark, FileText,
  Receipt, BookOpen, ListChecks, Handshake, ArrowRight, ClipboardList,
} from "lucide-react";

const PKR = (n: number) => "PKR " + Math.round(Math.abs(n || 0)).toLocaleString();

const LINKS = [
  { sheet: "cash_book", label: "Daily Cash Book", icon: Landmark },
  { sheet: "invoices", label: "Invoices", icon: FileText },
  { sheet: "quotations", label: "Quotations", icon: ClipboardList },
  { sheet: "bills_payments_expenses", label: "Bills / Payments / Expenses", icon: Receipt },
  { sheet: "bank_accounts", label: "Bank Accounts", icon: Landmark },
  { sheet: "accounts", label: "Chart of Accounts", icon: BookOpen },
  { sheet: "journal_entries", label: "Journal Entries", icon: ListChecks },
  { sheet: "partners", label: "Partners", icon: Handshake },
];

export default function FinanceOverview({
  showFeedback,
  onNavigate,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
  onNavigate?: (workbook: string, sheet: string) => void;
}) {
  const [profit, setProfit] = useState<any>(null);
  const [cash, setCash] = useState<any>(null);
  const [arAging, setArAging] = useState<any>(null);
  const [apAging, setApAging] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      enterpriseFetch("/api/finance/profitability/summary").then((r) => setProfit(r.summary)),
      enterpriseFetch("/api/finance/cash-position").then(setCash),
      enterpriseFetch("/api/finance/invoices/aging").then(setArAging),
      enterpriseFetch("/api/finance/bills/aging").then(setApAging),
    ])
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(() => { load(); }, [load]);

  const profitOk = profit && profit.netProfit >= 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <Briefcase className="w-4 h-4" /> Finance Overview <span className="text-[#9CA3AF] font-normal text-sm">· کاروباری کتابوں کا خلاصہ</span>
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">
            Figures here come from the real General Ledger (the same source as the Income Statement) — click any card
            to open that module.
          </p>
        </div>
        <div className="flex-1" />
        <button onClick={load} disabled={loading} className="h-9 px-3 rounded-lg border border-[#E5E7EB] bg-white text-sm flex items-center gap-1.5 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
      </div>

      {profit && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Big label="Revenue (GL) · آمدنی" value={PKR(profit.totalRevenue)} tone="good" />
          <Big label="Expenses (GL) · خرچہ" value={PKR(profit.totalExpenses)} tone="bad" />
          <Big label={profitOk ? "Net profit · صافی منافع" : "Net loss · صافی نقصان"} value={(profitOk ? "" : "−") + PKR(profit.netProfit)} tone={profitOk ? "good" : "bad"} big />
          <Big label="Margin · مارجن" value={profit.profitMargin} tone="neutral" />
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280] flex items-center gap-1.5 mb-2">
            <Landmark className="w-3.5 h-3.5" /> Cash &amp; bank position (GL)
          </div>
          <div className="text-2xl font-extrabold tabular-nums text-[#1F2937]">{cash ? PKR(cash.total) : "—"}</div>
          <p className="text-[10px] text-[#9CA3AF] mt-1" dir="auto">Every Cash/Bank ledger account's real balance — cash payments included, not just registered bank accounts.</p>
        </div>
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280] flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3.5 h-3.5" /> Receivable (Invoices)
          </div>
          <div className="text-2xl font-extrabold tabular-nums text-[#1E4480]">{arAging ? PKR(arAging.totalAR) : "—"}</div>
          {arAging && (arAging.overdue60 + arAging.overdue90 + arAging.overdue120 + arAging.overdue120Plus) > 0 && (
            <p className="text-[10px] text-[#B00005] mt-1">{PKR(arAging.overdue60 + arAging.overdue90 + arAging.overdue120 + arAging.overdue120Plus)} overdue 60+ days</p>
          )}
        </div>
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280] flex items-center gap-1.5 mb-2">
            <TrendingDown className="w-3.5 h-3.5" /> Payable (Bills)
          </div>
          <div className="text-2xl font-extrabold tabular-nums text-[#B00005]">{apAging ? PKR(apAging.totalAP) : "—"}</div>
        </div>
      </div>

      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA]">Go to · جائیں</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 p-3">
          {LINKS.map(({ sheet, label, icon: Icon }) => (
            <button
              key={sheet}
              onClick={() => onNavigate?.("finance", sheet)}
              className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-xs font-semibold text-[#374151] hover:border-[#24539B] hover:bg-[#F2F5FA] transition-colors"
            >
              <Icon className="w-4 h-4 text-[#6B7280] shrink-0" />
              <span className="flex-1 text-left">{label}</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#9CA3AF]" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Big({ label, value, tone, big }: { label: string; value: string; tone: "good" | "bad" | "neutral"; big?: boolean }) {
  const c = tone === "good" ? "border-[#C9D7EC] bg-[#F2F5FA] text-[#1E4480]" : tone === "bad" ? "border-[#FFC2C3] bg-[#FFF1F1] text-[#B00005]" : "border-[#E5E7EB] bg-white text-[#1F2937]";
  return (
    <div className={`rounded-xl border p-3 ${c}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide" dir="auto">{label}</div>
      <div className={`${big ? "text-2xl" : "text-lg"} font-extrabold tabular-nums`}>{value}</div>
    </div>
  );
}
