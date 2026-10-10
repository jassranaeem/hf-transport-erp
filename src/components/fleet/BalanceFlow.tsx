/**
 * The balance of a khata in one line, the way it is read on paper:
 *
 *   truck   Opening (before) + Received (came in) − Paid (spent) = Closing (now)   · profit = received − paid
 *   party   Opening (before) + We gave (debit)    − We received (credit) = Closing  · + receivable / − payable
 *
 * with the period to look at (all, this month, this year Jul–Jun, or dates) and the khata's own opening
 * balance, which can be set or changed here.
 */
import React, { useState } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";

const fmt = (n: number) => (n < 0 ? "−" : "") + "PKR " + Math.abs(Math.round(n || 0)).toLocaleString();
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export type Period = { key: "all" | "month" | "year" | "dates"; from: string; to: string };
export const ALL: Period = { key: "all", from: "", to: "" };

export function periodParams(p: Period): Record<string, string> {
  return p.key === "all" ? {} : { ...(p.from ? { from: p.from } : {}), ...(p.to ? { to: p.to } : {}) };
}

function presets(key: Period["key"]): Period {
  const now = new Date();
  if (key === "month") return { key, from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  if (key === "year") {
    const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    return { key, from: `${y}-07-01`, to: `${y + 1}-06-30` };
  }
  if (key === "dates") return { key, from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  return ALL;
}

export default function BalanceFlow({
  mode,
  balance,
  period,
  onPeriod,
  onSaveOpening,
}: {
  mode: "truck" | "party";
  balance: any;
  period: Period;
  onPeriod: (p: Period) => void;
  onSaveOpening: (amount: number, date: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [amt, setAmt] = useState("");
  const [sign, setSign] = useState<1 | -1>(1);
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  if (!balance) return null;

  const truck = mode === "truck";
  const inAmt = truck ? balance.received : balance.debit;
  const outAmt = truck ? balance.paid : balance.credit;
  const closing = balance.closing;
  const closingLabel = truck
    ? closing >= 0
      ? "Balance now · اب بقایا"
      : "Balance now (short) · اب بقایا (کمی)"
    : closing > 0
      ? "Receivable now · لینا ہے"
      : closing < 0
        ? "Payable now · دینا ہے"
        : "Clear · صاف";

  const startEdit = () => {
    const b = Number(balance.openingBalance || 0);
    setAmt(b ? String(Math.abs(b)) : "");
    setSign(b < 0 ? -1 : 1);
    setDate(balance.openingDate || "");
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSaveOpening(sign * Math.round(Number(amt) || 0), truck ? date || null : null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  // one strip: Opening + In − Out = Now (the operators show once there is room for them)
  const cell = "px-4 py-3 min-w-0";
  const sym = "hidden xl:flex items-center justify-center w-6 text-base font-semibold text-[#9CA3AF]";
  const label = "text-[11.5px] text-[#6B7280] truncate";
  const num = "text-[17px] font-semibold tabular-nums leading-tight mt-0.5 truncate";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="inline-flex flex-wrap max-w-full rounded-lg border border-[#CBD5E1] bg-white p-0.5">
          {([
            ["all", "All · سب"],
            ["month", "This month · یہ مہینہ"],
            ["year", "This year · یہ سال"],
            ["dates", "Dates · تاریخیں"],
          ] as const).map(([k, l]) => (
            <button
              key={k}
              onClick={() => onPeriod(presets(k))}
              className={`rounded-md px-2.5 py-1 whitespace-nowrap ${period.key === k ? "bg-[#24539B] text-white font-semibold" : "text-[#4B5563] hover:bg-[#F4F6FA]"}`}
            >
              {l}
            </button>
          ))}
        </div>
        {period.key === "dates" && (
          <>
            <input type="date" className="border border-[#CBD5E1] rounded-md px-2 py-1" value={period.from} onChange={(e) => onPeriod({ ...period, from: e.target.value })} />
            <span className="text-[#9CA3AF]">→</span>
            <input type="date" className="border border-[#CBD5E1] rounded-md px-2 py-1" value={period.to} onChange={(e) => onPeriod({ ...period, to: e.target.value })} />
          </>
        )}
        {period.key !== "all" && period.from && (
          <span className="text-[#9CA3AF]">{period.from.split("-").reverse().join(".")} – {(period.to || "").split("-").reverse().join(".")}</span>
        )}
      </div>

      <div className="rounded-xl border border-[#E3E8EF] bg-white grid grid-cols-2 xl:flex xl:items-stretch overflow-hidden">
        <div className={`${cell} xl:flex-1 bg-[#F8FAFC]`}>
          <div className={`${label} flex items-center gap-1`}>
            <span className="truncate">{period.key === "all" ? "Opening balance · ابتدائی" : "Balance before · پہلے کا"}</span>
            <button onClick={startEdit} title="Set / change the opening balance" className="ml-auto shrink-0 text-[#9CA3AF] hover:text-[#24539B]"><Pencil className="w-3 h-3" /></button>
          </div>
          <div className={`${num} text-[#111827]`}>{fmt(balance.opening)}</div>
          {period.key !== "all" && balance.openingBalance ? <div className="text-[11px] text-[#9CA3AF] truncate">incl. opening {fmt(balance.openingBalance)}</div> : null}
        </div>
        <div className={sym}>+</div>
        <div className={`${cell} xl:flex-1 border-l border-[#EEF1F5] xl:border-l-0`}>
          <div className={label}>{truck ? "Received · آیا" : "We gave · دیا (نام)"}</div>
          <div className={`${num} text-[#166534]`}>{fmt(inAmt)}</div>
        </div>
        <div className={sym}>−</div>
        <div className={`${cell} xl:flex-1 border-t xl:border-t-0 border-[#EEF1F5]`}>
          <div className={label}>{truck ? "Paid / spent · خرچ" : "We received · ملا (جمع)"}</div>
          <div className={`${num} text-[#B91C1C]`}>{fmt(outAmt)}</div>
        </div>
        <div className={sym}>=</div>
        <div className={`${cell} xl:flex-1 border-t border-l xl:border-t-0 border-[#EEF1F5] ${closing < 0 ? "bg-[#FEF2F2]" : "bg-[#EAF0F8]"}`}>
          <div className={`${label} font-medium`}>{closingLabel}</div>
          <div className={`text-[19px] font-bold tabular-nums leading-tight mt-0.5 truncate ${closing < 0 ? "text-[#B91C1C]" : "text-[#13294B]"}`}>{truck ? fmt(closing) : fmt(Math.abs(closing))}</div>
        </div>
      </div>

      <div className="text-[12px] text-[#6B7280]" dir="auto">
        {truck ? (
          <>
            {period.key === "all" ? "Profit · منافع" : "Profit in these dates · اس مدت کا منافع"} = received − spent = <b className={balance.profit < 0 ? "text-red-600" : "text-emerald-700"}>{fmt(balance.profit)}</b>
            {" "}· the opening balance is money from before — it is not profit · ابتدائی بیلنس منافع نہیں
            {balance.driverCash && (
              <div className="mt-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-[#374151]">
                Driver's cash · ڈرائیور کی نقد: given <b>{fmt(balance.driverCash.given)}</b> − spent out of it <b>{fmt(balance.driverCash.spent)}</b>
                {balance.driverCash.returned ? <> − returned <b>{fmt(balance.driverCash.returned)}</b></> : null} = <b className="text-amber-800">still with the driver {fmt(balance.driverCash.withDriver)}</b>
                <span className="text-slate-500"> · ڈرائیور کے پاس باقی — when he returns it or brings the slips, enter it</span>
              </div>
            )}
            {period.key === "all" && balance.runningClosing != null && balance.runningClosing !== balance.closing && (
              <span className="text-amber-700"> · the last row's running balance reads {fmt(balance.runningClosing)} (old paper pages each start from 0)</span>
            )}
          </>
        ) : (
          <>
            + means the party owes HFK (لینا), − means HFK owes the party (دینا)
            {balance.undated > 0 && <span className="text-amber-700"> · {balance.undated} row(s) with no date are not in these dates</span>}
          </>
        )}
      </div>

      {editing && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[#C9D7EC] bg-[#F7F9FD] p-3 text-xs">
          <label className="flex flex-col gap-0.5">
            <span className="text-slate-500">Opening balance · ابتدائی بیلنس</span>
            <input autoFocus inputMode="numeric" className="border border-slate-300 rounded px-2 py-1 w-36 tabular-nums" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d]/g, ""))} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="PKR" />
          </label>
          <div className="flex gap-1">
            {(truck
              ? ([[1, "In hand / to its credit · جمع"], [-1, "Short / owed · نام"]] as const)
              : ([[1, "Party owes HFK · لینا ہے"], [-1, "HFK owes party · دینا ہے"]] as const)
            ).map(([v, l]) => (
              <button key={v} onClick={() => setSign(v)} className={`rounded-md px-2.5 py-1.5 border ${sign === v ? "bg-[#24539B] border-[#24539B] text-white" : "bg-white border-[#CBD5E1] text-[#4B5563]"}`}>
                {l}
              </button>
            ))}
          </div>
          {truck && (
            <label className="flex flex-col gap-0.5">
              <span className="text-slate-500">As on · تاریخ</span>
              <input type="date" className="border border-slate-300 rounded px-2 py-1" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          )}
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 bg-[#24539B] text-white font-semibold disabled:opacity-60">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
          </button>
          <button onClick={() => setEditing(false)} className="text-slate-500 p-1"><X className="w-4 h-4" /></button>
          <span className="text-slate-400 basis-full">Leave it 0 to remove the opening balance · صفر رکھیں تو ہٹ جائے گا</span>
        </div>
      )}
    </div>
  );
}
