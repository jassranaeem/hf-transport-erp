/**
 * The line above each day's entries in a ledger, the way a paper day-book is kept:
 *
 *   18.01.2025   Opening 20,000  +  In 10,000  −  Out 30,000  =  Closing 0
 *
 * The opening is the day before's closing, and this closing is the next day's opening.
 * `days` comes from the server (balance.days) and covers every row of the period.
 */
import React from "react";

export interface DayFigures {
  day: string;
  opening: number;
  in: number;
  out: number;
  closing: number;
}

const n = (v: number) => (v < 0 ? "−" : "") + Math.abs(Math.round(v || 0)).toLocaleString();
export const dmy = (d: string) => d.split("-").reverse().join(".");

/** The calendar day of a row's date (an ISO string or Date), as YYYY-MM-DD, or null. */
export function dayOf(v: any): string | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function DayStripRow({ d, colSpan, inLabel, outLabel }: { d: DayFigures; colSpan: number; inLabel: string; outLabel: string }) {
  return (
    <tr className="bg-[#EEF3FA] border-t border-[#D5E0F0]">
      <td colSpan={colSpan} className="px-3 py-1.5 text-[11.5px]">
        <div className="sticky left-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5" style={{ width: "min(560px, calc(100vw - 6rem))" }}>
          <b className="text-[#13294B] tabular-nums">{dmy(d.day)}</b>
          <span className="text-[#4B5563]">Opening · ابتدائی <b className="tabular-nums text-[#111827]">{n(d.opening)}</b></span>
          <span className="text-[#6B7280]">+ {inLabel} <b className="tabular-nums text-[#166534]">{n(d.in)}</b></span>
          <span className="text-[#6B7280]">− {outLabel} <b className="tabular-nums text-[#B91C1C]">{n(d.out)}</b></span>
          <span className="text-[#4B5563]">= Closing · اختتامی <b className={`tabular-nums ${d.closing < 0 ? "text-[#B91C1C]" : "text-[#13294B]"}`}>{n(d.closing)}</b></span>
        </div>
      </td>
    </tr>
  );
}
