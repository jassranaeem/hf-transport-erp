/**
 * Dues & Alerts — "kisko dena · kis se lena · kisko NAHI dena".
 *
 * Reads /api/parties/alerts and shows the money position at a glance:
 *   Receiving (lena) · Payable (dena) · Net · Dead (phansa hua) + who-owes-who lists.
 * Used both as its own Khata sheet and, in compact mode, at the top of Parties.
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  Clock,
  RefreshCw,
  Scale,
  Wallet,
} from "lucide-react";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

const fmt = (n: number) => "PKR " + Math.abs(Math.round(n || 0)).toLocaleString();

interface PartyRow {
  id: number;
  partyCode: string;
  name: string;
  phone: string | null;
  type: string;
  status: string;
  balance: number;
  notes: string | null;
  lastEntryAt: string | null;
  daysSince: number | null;
}
interface Alerts {
  totals: {
    receiving: number;
    payable: number;
    net: number;
    dead: number;
    counts: { total: number; active: number; blocked: number; inactive: number };
  };
  collectFrom: PartyRow[];
  payTo: PartyRow[];
  doNotPay: PartyRow[];
  overdue: PartyRow[];
  overdueDays: number;
}

export default function DuesAlerts({
  showFeedback,
  compact,
  onOpenParty,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
  compact?: boolean;
  onOpenParty?: (id: number) => void;
}) {
  const [data, setData] = useState<Alerts | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    enterpriseFetch("/api/parties/alerts")
      .then(setData)
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(load, [load]);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#4B5563] p-4">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading dues…
      </div>
    );
  }
  if (!data) return null;
  const t = data.totals;

  const Card = ({
    icon: Icon,
    label,
    urdu,
    value,
    tone,
  }: {
    icon: any;
    label: string;
    urdu: string;
    value: string;
    tone: "good" | "bad" | "neutral" | "warn";
  }) => {
    const c =
      tone === "good"
        ? "text-[#1E4480] border-[#C9D7EC] bg-[#F2F5FA]"
        : tone === "bad"
        ? "text-[#B00005] border-[#FFC2C3] bg-[#FFF1F1]"
        : tone === "warn"
        ? "text-[#4B5563] border-[#E5E7EB] bg-[#F9FAFB]"
        : "text-[#1F2937] border-[#E5E7EB] bg-white";
    return (
      <div className={`rounded-xl border p-3 ${c}`}>
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide">
          <Icon className="w-3.5 h-3.5" /> {label}
        </div>
        <div className="text-[11px] opacity-70" dir="auto">{urdu}</div>
        <div className="text-lg font-extrabold mt-0.5 tabular-nums">{value}</div>
      </div>
    );
  };

  const PartyList = ({
    title,
    urdu,
    rows,
    tone,
    showAge,
  }: {
    title: string;
    urdu: string;
    rows: PartyRow[];
    tone: "good" | "bad" | "block";
    showAge?: boolean;
  }) => (
    <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden flex flex-col min-h-0">
      <div
        className={`px-3 py-2 text-xs font-bold flex items-center justify-between ${
          tone === "good" ? "bg-[#F2F5FA] text-[#1E4480]" : tone === "bad" ? "bg-[#FFF1F1] text-[#B00005]" : "bg-[#FFF1F1] text-[#B00005]"
        }`}
      >
        <span>{title}</span>
        <span className="text-[10px] font-medium opacity-70" dir="auto">{urdu}</span>
      </div>
      <div className="overflow-y-auto max-h-[260px]">
        {rows.length === 0 && <p className="text-[12px] text-[#9CA3AF] p-3">— none —</p>}
        {rows.map((p) => (
          <button
            key={p.id}
            onClick={() => onOpenParty?.(p.id)}
            className="w-full text-left px-3 py-2 border-b border-[#F3F4F6] hover:bg-[#F2F5FA] flex items-center justify-between gap-2"
          >
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold truncate" dir="auto">{p.name}</span>
              <span className="block text-[10px] text-[#6B7280]">
                {p.partyCode} · {p.type}
                {p.phone ? ` · ${p.phone}` : ""}
                {showAge && p.daysSince != null ? ` · ${p.daysSince}d idle` : showAge ? " · no entry" : ""}
              </span>
            </span>
            <span
              className={`text-[13px] font-bold tabular-nums shrink-0 ${
                p.balance > 0 ? "text-[#1E4480]" : p.balance < 0 ? "text-[#B00005]" : "text-[#9CA3AF]"
              }`}
            >
              {fmt(p.balance)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className={compact ? "space-y-3" : "space-y-4 p-1"}>
      {!compact && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold">Dues &amp; Alerts <span className="text-[#9CA3AF] font-normal text-sm">· بقایا جات و انتباہ</span></h2>
            <p className="text-[12px] text-[#6B7280]" dir="auto">
              Who to collect from, who to pay, who NOT to pay — all dues at a glance ·
              کس سے وصولی · کس کو ادائیگی · کس کو نہیں دینا
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ModuleDataIO entityKey="parties" label="Parties" onImported={load} />
            <button
              onClick={load}
              className="flex items-center gap-1.5 text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white hover:bg-[#F2F5FA]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh <span className="text-[#9CA3AF]">تازہ کریں</span>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card icon={ArrowDownLeft} label="Receivable" urdu="وصول طلب (پارٹی سے لینا)" value={fmt(t.receiving)} tone="good" />
        <Card icon={Wallet} label="Payable" urdu="واجب الادا (پارٹی کو دینا)" value={fmt(t.payable)} tone="bad" />
        <Card icon={Scale} label="Net position" urdu="خالص پوزیشن" value={fmt(t.net)} tone={t.net >= 0 ? "good" : "bad"} />
        <Card icon={AlertTriangle} label="Dead / stuck" urdu="پھنسا ہوا (Blocked/Inactive)" value={fmt(t.dead)} tone="warn" />
      </div>

      {(t.dead > 0 || data.doNotPay.length > 0) && (
        <div className="rounded-lg border border-[#FFC2C3] bg-[#FFF1F1] px-3 py-2 text-[12px] text-[#B00005] flex items-start gap-2">
          <Ban className="w-4 h-4 mt-0.5 shrink-0" />
          <span dir="auto">
            <b>{data.doNotPay.length}</b> blocked part{data.doNotPay.length === 1 ? "y" : "ies"} — hold all payments to them ·
            اِن کو ادائیگی روک دیں۔
            {t.dead > 0 && <> Stuck receivable <b>{fmt(t.dead)}</b> from blocked / inactive parties.</>}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <PartyList title="Collect from" urdu="اِن سے وصولی کرنی ہے" rows={data.collectFrom} tone="good" />
        <PartyList title="Pay to" urdu="اِن کو ادائیگی کرنی ہے" rows={data.payTo} tone="bad" />
        <PartyList title="Do NOT pay (blocked)" urdu="اِن کو ادائیگی نہ کریں" rows={data.doNotPay} tone="block" />
      </div>

      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F9FAFB] text-[#4B5563] flex items-center gap-1.5" dir="auto">
          <Clock className="w-3.5 h-3.5" /> Overdue — no entry for {data.overdueDays}+ days, balance still open
          <span className="ml-auto text-[10px] font-medium opacity-70">پرانے بقایا جات</span>
        </div>
        <div className="overflow-y-auto max-h-[300px]">
          {data.overdue.length === 0 && <p className="text-[12px] text-[#9CA3AF] p-3" dir="auto">All up to date · سب اپ ٹو ڈیٹ</p>}
          {data.overdue.map((p) => (
            <button
              key={p.id}
              onClick={() => onOpenParty?.(p.id)}
              className="w-full text-left px-3 py-2 border-b border-[#F3F4F6] hover:bg-[#F2F5FA] flex items-center justify-between gap-2"
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold truncate" dir="auto">{p.name}</span>
                <span className="block text-[10px] text-[#6B7280]">
                  {p.partyCode} · {p.phone || "no phone"} ·{" "}
                  {p.daysSince != null ? `quiet for ${p.daysSince} days` : "no entry yet"}
                </span>
              </span>
              <span
                className={`text-[13px] font-bold tabular-nums shrink-0 ${
                  p.balance > 0 ? "text-[#1E4480]" : "text-[#B00005]"
                }`}
              >
                {p.balance > 0 ? "collect " : "pay "}
                {fmt(p.balance)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {!compact && (
        <p className="text-[11px] text-[#9CA3AF]" dir="auto">
          {t.counts.total} parties · {t.counts.active} active · {t.counts.blocked} blocked · {t.counts.inactive} inactive.
          To block a party, set its Status = Blocked in the party detail form ·
          کسی پارٹی کو بلاک کرنے کے لیے اس کی تفصیل میں Status = Blocked کریں۔
        </p>
      )}
    </div>
  );
}
