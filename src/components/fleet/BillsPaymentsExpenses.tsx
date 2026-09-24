/**
 * Bills, Payments, and Expenses — three related money-out records that used
 * to live as separate workbook tabs, combined into one sheet with a simple
 * switch so they're easy to find together.
 */
import React, { useState } from "react";
import { Receipt, Wallet, ReceiptText } from "lucide-react";
import EntitySheet from "../sheets/EntitySheet.tsx";

const TABS = [
  { key: "bills", label: "Bills", icon: Receipt },
  { key: "payments", label: "Payments", icon: Wallet },
  { key: "expenses", label: "Expenses", icon: ReceiptText },
] as const;

export default function BillsPaymentsExpenses({
  showFeedback,
}: {
  showFeedback: (type: "success" | "error", message: string) => void;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("bills");

  return (
    <div className="h-full flex flex-col">
      <div className="flex gap-1 px-3 pt-3">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`text-xs font-semibold rounded-full px-3 py-1.5 flex items-center gap-1.5 ${
              tab === key ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 p-3">
        <EntitySheet entityKey={tab} title={TABS.find((t) => t.key === tab)!.label} showFeedback={showFeedback} />
      </div>
    </div>
  );
}
