/**
 * The books' first day (1 July of a financial year) — shown on Books · کتاب, changed here.
 * Moving it is a decision about the accounts, so: pick the year, see what it would do (nothing is
 * changed yet), type the confirmation, and only then is it moved. Administrators only (the server checks).
 */
import React, { useState } from "react";
import { Loader2, AlertTriangle, X } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";

const dmy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const pkr = (n: number) => (n < 0 ? "−" : "") + "PKR " + Math.abs(Math.round(n || 0)).toLocaleString("en-US");

export default function BooksStart({
  current,
  onChanged,
  onClose,
  showFeedback,
  onNavigate,
}: {
  current: string;
  onChanged: () => void;
  onClose: () => void;
  showFeedback: (t: "success" | "error", m: string) => void;
  onNavigate?: (wb: string, sheet: string) => void;
}) {
  const thisFy = (() => {
    const n = new Date();
    return n.getMonth() >= 6 ? n.getFullYear() : n.getFullYear() - 1;
  })();
  const years: number[] = [];
  for (let y = thisFy; y >= 2024; y--) years.push(y);
  const [date, setDate] = useState(`${thisFy}-07-01`);
  const [pv, setPv] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");

  const preview = async (d: string) => {
    setDate(d);
    setPv(null);
    setTyped("");
    if (d === current) return;
    setBusy(true);
    try {
      setPv(await enterpriseFetch(`/api/books/start-preview?date=${d}`));
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const change = async () => {
    setBusy(true);
    try {
      await enterpriseFetch("/api/books/start", { method: "PUT", body: JSON.stringify({ date, confirmText: typed }) });
      showFeedback("success", `Books now start on ${dmy(date)} · کتاب ${dmy(date)} سے شروع ہے`);
      onChanged();
      onClose();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };

  const e = pv?.effects;
  const ok = pv && !pv.problems?.length && typed === pv.confirmPhrase;
  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  return (
    <div className="rounded-xl border border-[#C9D7EC] bg-[#F7F9FD] p-4 space-y-3 text-[12.5px]">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-[#1F2937]">Books start · کتاب کا آغاز</div>
          <div className="text-[12px] text-[#6B7280]" dir="auto">
            Now: <b>{dmy(current)}</b>. Everything before the start day is brought in as one opening balance; the books are made from the start day on. Nothing is deleted — moving it back brings everything back. ·
            شروع کی تاریخ سے پہلے کا سب کچھ ایک ابتدائی بیلنس بن کر آتا ہے۔ کچھ حذف نہیں ہوتا۔
          </div>
        </div>
        <button onClick={onClose} className="text-[#6B7280] hover:text-[#111827]" title="Close"><X className="w-4 h-4" /></button>
      </div>

      <label className={`${lbl} max-w-xs`}>
        Financial year to start from · کس سال سے
        <select id="books-start-year" value={date} onChange={(ev) => preview(ev.target.value)} className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white">
          {years.map((y) => (
            <option key={y} value={`${y}-07-01`}>
              FY {y}-{String((y + 1) % 100).padStart(2, "0")} — from 01.07.{y}
              {`${y}-07-01` === current ? " (now)" : ""}
            </option>
          ))}
        </select>
      </label>

      {busy && !pv && <div className="flex items-center gap-1.5 text-[#6B7280]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Working out what would change…</div>}

      {pv?.problems?.length > 0 && (
        <div className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[#991B1B]" dir="auto">{pv.problems.join(" · ")}</div>
      )}

      {e && (
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-[#374151]">What moving it to {dmy(date)} does · کیا ہوگا (ابھی کچھ بدلا نہیں)</div>
          <ul className="space-y-1.5 text-[#374151]" dir="auto">
            <li>
              <b>Cash:</b> everything in the Cash Book before {dmy(date)} ({e.cash.rows.toLocaleString()} rows) becomes one opening cash balance of <b>{pkr(e.cash.net)}</b>.
            </li>
            <li>
              <b>Parties &amp; partners:</b> {e.parties.count.toLocaleString()} party balance(s) are brought in as they stood on the day before (net {pkr(e.parties.net)}).
            </li>
            <li>
              <b>Truck khata:</b> {e.truckRows.leftOut.toLocaleString()} khata row(s) before {dmy(date)} are no longer in the books ({e.truckRows.kept.toLocaleString()} stay). They all stay in Truck Ledgers as they are.
            </li>
            {(e.documentsBefore.invoices || e.documentsBefore.bills || e.documentsBefore.payments || e.documentsBefore.manual_journals) > 0 && (
              <li className="text-[#92400E]">
                <b>Look at these yourself:</b> {e.documentsBefore.invoices} invoice(s), {e.documentsBefore.bills} bill(s), {e.documentsBefore.payments} payment(s) and {e.documentsBefore.manual_journals} hand-made journal entr(ies) are dated before {dmy(date)}. They stay in the books as they are — they are not moved into the opening balance.
              </li>
            )}
          </ul>

          {e.banks.length > 0 && (
            <div className="rounded-lg border border-[#FCD34D] bg-[#FFFBEB] px-3 py-2 text-[#92400E]" dir="auto">
              <div className="flex items-start gap-1.5 font-semibold"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> Bank opening balances are NOT changed — write them again for {dmy(date)}</div>
              <div className="mt-1">
                Each bank's opening balance is its balance on the day before the books start. These were written for {dmy(current)}; change them to the bank statement of {dmy(new Date(new Date(`${date}T12:00:00`).getTime() - 86400000).toISOString().slice(0, 10))}:
              </div>
              <ul className="mt-1 list-disc pl-5">
                {e.banks.map((b: any) => <li key={b.id}>{b.name}: now {pkr(b.opening)}</li>)}
              </ul>
              {onNavigate && <button type="button" onClick={() => onNavigate("accounting", "banks")} className="mt-1 underline font-semibold">Open Banks · بینک کھولیں</button>}
            </div>
          )}

          <div className="rounded-lg border border-[#E3E8EF] bg-white px-3 py-2 text-[#374151]" dir="auto">
            The opening equity (3900) will carry the balance of everything before {dmy(date)} — the accountant splits it later. · 3900 میں پچھلے سب کا بیلنس رہے گا۔
          </div>

          <label className={`${lbl} max-w-sm`}>
            Type <b>{pv.confirmPhrase}</b> to confirm
            <input id="books-start-confirm" value={typed} onChange={(ev) => setTyped(ev.target.value)} className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white" autoComplete="off" />
          </label>
          <div className="flex gap-2">
            <button onClick={change} disabled={!ok || busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#24539B] px-3 py-1.5 text-white font-semibold disabled:opacity-50" style={{ backgroundColor: "#24539B", color: "#fff" }}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Start the books from {dmy(date)}
            </button>
            <button onClick={onClose} className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
