/**
 * Ledger Overview — the whole khata at a glance, correctly calculated,
 * connected to every sheet in this workbook in the order you'd actually
 * use them: Truck Ledgers, Parties List, Party Ledgers, Dues & Alerts,
 * Receipt Search.
 *
 * Reads GET /api/ledgers/summary (truck khata totals) and
 * GET /api/parties/alerts (party khata totals) — the same aggregate
 * endpoints those sheets themselves are built on, so this page can never
 * show a different number than the sheet it links to.
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import {
  BookOpen, RefreshCw, Loader2, Truck, Users, BookMarked, Bell, Search, ArrowRight, AlertTriangle,
} from "lucide-react";

const PKR = (n: number) => "PKR " + Math.round(Math.abs(n || 0)).toLocaleString();

const LINKS = [
  { sheet: "truck_ledgers", label: "Truck Ledgers", icon: Truck, desc: "Every truck's income, expense and running balance" },
  { sheet: "party_list", label: "Parties List", icon: Users, desc: "Everyone you deal with — customers, vendors, contractors" },
  { sheet: "parties", label: "Party Ledgers", icon: BookMarked, desc: "Each party's full transaction history" },
  { sheet: "dues", label: "Dues & Alerts", icon: Bell, desc: "Who to collect from, who to pay, what's overdue" },
  { sheet: "receipt_search", label: "Receipt Search", icon: Search, desc: "Find a receipt or attachment across every ledger" },
];

export default function KhataOverview({
  showFeedback,
  onNavigate,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
  onNavigate?: (workbook: string, sheet: string) => void;
}) {
  const [truckSummary, setTruckSummary] = useState<any>(null);
  const [partyAlerts, setPartyAlerts] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      enterpriseFetch("/api/ledgers/summary").then(setTruckSummary),
      enterpriseFetch("/api/parties/alerts").then(setPartyAlerts),
    ])
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(() => { load(); }, [load]);

  const tt = truckSummary?.totals;
  const pt = partyAlerts?.totals;
  const truckProfit = tt && tt.netProfit >= 0;
  const partyNet = pt && pt.net >= 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <BookOpen className="w-4 h-4" /> Ledger Overview <span className="text-[#9CA3AF] font-normal text-sm">· مکمل کھاتے کا خلاصہ</span>
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">
            The same totals shown on Truck Ledgers and Dues &amp; Alerts — this page only summarizes and links, it
            never recalculates on its own.
          </p>
        </div>
        <div className="flex-1" />
        <button onClick={load} disabled={loading} className="h-9 px-3 rounded-lg border border-[#E5E7EB] bg-white text-sm flex items-center gap-1.5 disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
      </div>

      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA] flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" /> Truck ledgers · ٹرک کھاتہ</div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 p-3">
          <Big label="Trucks · ٹرک" value={String(tt?.ledgers ?? "—")} tone="neutral" />
          <Big label="Entries · اندراجات" value={String(tt?.entries ?? "—")} tone="neutral" />
          <Big label="Income · آمدنی" value={tt ? PKR(tt.totalReceived) : "—"} tone="good" />
          <Big label="Expense · خرچہ" value={tt ? PKR(tt.totalPaid) : "—"} tone="bad" />
          <Big label={truckProfit ? "Net profit · صافی منافع" : "Net loss · صافی نقصان"} value={tt ? (truckProfit ? "" : "−") + PKR(tt.netProfit) : "—"} tone={tt ? (truckProfit ? "good" : "bad") : "neutral"} big />
        </div>
        {tt?.needsReview > 0 && (
          <div className="mx-3 mb-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[11px] text-[#4B5563] flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {tt.needsReview} truck ledger entries are flagged "needs review" — open Truck Ledgers to fix them.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA] flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Party ledgers · پارٹی کھاتہ</div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 p-3">
          <Big label="Active parties · فعال پارٹیاں" value={String(pt?.counts?.active ?? "—")} tone="neutral" />
          <Big label="Receiving · لینا ہے" value={pt ? PKR(pt.receiving) : "—"} tone="good" />
          <Big label="Payable · دینا ہے" value={pt ? "−" + PKR(pt.payable) : "—"} tone="bad" />
          <Big label={partyNet ? "Net receivable · صافی وصولی" : "Net payable · صافی ادائیگی"} value={pt ? (partyNet ? "" : "−") + PKR(Math.abs(pt.net)) : "—"} tone={pt ? (partyNet ? "good" : "bad") : "neutral"} big />
          <Big label="Dead / stuck · پھنسی ہوئی" value={pt ? PKR(pt.dead) : "—"} tone="bad" />
        </div>
      </div>

      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA]">Go to · جائیں (in order)</div>
        <div className="divide-y divide-[#F3F4F6]">
          {LINKS.map(({ sheet, label, icon: Icon, desc }, i) => (
            <button
              key={sheet}
              onClick={() => onNavigate?.("khata", sheet)}
              className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-[#F9FAFB] transition-colors"
            >
              <span className="w-5 h-5 rounded-full bg-[#E9EEF5] text-[#24539B] text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <Icon className="w-4 h-4 text-[#6B7280] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[#1F2937]">{label}</div>
                <div className="text-[11px] text-[#9CA3AF]" dir="auto">{desc}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-[#9CA3AF] shrink-0" />
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
