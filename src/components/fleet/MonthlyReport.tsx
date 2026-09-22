/**
 * Monthly Report — one click: "is month ka trucks ka income / kharcha / profit ya loss".
 *
 * GET /api/reports/monthly?month=YYYY-MM  (built from the truck khatas).
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { CalendarDays, RefreshCw, TrendingUp, TrendingDown, Landmark } from "lucide-react";

const PKR = (n: number) => "PKR " + Math.round(Math.abs(n || 0)).toLocaleString();
const thisMonth = () => new Date().toISOString().slice(0, 7);
const thisYear = () => new Date().getFullYear();

export default function MonthlyReport({
  showFeedback,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [view, setView] = useState<"monthly" | "yearly">("monthly");
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const [year, setYear] = useState(thisYear());
  const [yearData, setYearData] = useState<any>(null);
  const [yearLoading, setYearLoading] = useState(false);

  const run = useCallback(
    (m: string) => {
      setLoading(true);
      enterpriseFetch(`/api/reports/monthly?month=${m}`)
        .then(setData)
        .catch((e) => showFeedback("error", e.message))
        .finally(() => setLoading(false));
    },
    [showFeedback],
  );
  useEffect(() => run(month), []); // eslint-disable-line react-hooks/exhaustive-deps

  const runYear = useCallback(
    (y: number) => {
      setYearLoading(true);
      enterpriseFetch(`/api/reports/yearly?year=${y}`)
        .then(setYearData)
        .catch((e) => showFeedback("error", e.message))
        .finally(() => setYearLoading(false));
    },
    [showFeedback],
  );
  useEffect(() => {
    if (view === "yearly" && !yearData) runYear(year);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = data?.totals;
  const profit = t && t.net >= 0;
  const yt = yearData?.yearTotals;
  const yearProfit = yt && yt.net >= 0;
  const z = yearData?.zakat;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <CalendarDays className="w-4 h-4" /> Monthly Report
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">Pick a month and get the whole picture in one click · مہینہ منتخب کریں، ایک کلک میں پورا حساب</p>
        </div>
        <div className="flex-1" />
        <div className="flex rounded-lg border border-[#E5E7EB] overflow-hidden text-sm font-semibold">
          <button
            onClick={() => setView("monthly")}
            className={`px-3 py-1.5 ${view === "monthly" ? "bg-[#16A34A] text-white" : "bg-white text-[#6B7280]"}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setView("yearly")}
            className={`px-3 py-1.5 ${view === "yearly" ? "bg-[#16A34A] text-white" : "bg-white text-[#6B7280]"}`}
          >
            Yearly · سالانہ
          </button>
        </div>
        {view === "monthly" ? (
          <>
            <label className="flex flex-col text-[11px] text-[#6B7280]">
              Month
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="border border-[#E5E7EB] rounded px-2 py-1 text-sm"
              />
            </label>
            <button
              onClick={() => run(month)}
              disabled={loading}
              className="h-9 px-4 rounded-lg bg-[#16A34A] text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-60"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
              Show report · حساب دکھائیں
            </button>
          </>
        ) : (
          <>
            <label className="flex flex-col text-[11px] text-[#6B7280]">
              Year
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="border border-[#E5E7EB] rounded px-2 py-1 text-sm w-24"
              />
            </label>
            <button
              onClick={() => runYear(year)}
              disabled={yearLoading}
              className="h-9 px-4 rounded-lg bg-[#16A34A] text-white text-sm font-semibold flex items-center gap-2 disabled:opacity-60"
            >
              {yearLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
              Show report · حساب دکھائیں
            </button>
          </>
        )}
      </div>

      {view === "yearly" && yt && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Big label="Yearly Income · سالانہ آمدنی" value={PKR(yt.income)} tone="good" />
            <Big label="Yearly Expense · سالانہ خرچہ" value={PKR(yt.expense)} tone="bad" />
            <Big
              label={yearProfit ? `${year} NET PROFIT · صافی منافع` : `${year} NET LOSS · صافی نقصان`}
              value={(yearProfit ? "" : "−") + PKR(yt.net)}
              tone={yearProfit ? "good" : "bad"}
              big
            />
            <Big
              label="Total profit vs loss · کل منافع بمقابلہ نقصان"
              value={`+${PKR(yt.grossProfit)} / −${PKR(yt.grossLoss)}`}
              tone="neutral"
            />
          </div>

          {z && (
            <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
              <div className="px-3 py-2 text-xs font-bold bg-[#F3F7F4] flex items-center gap-1.5">
                <Landmark className="w-3.5 h-3.5" /> Zakat · زکوٰۃ — 1 Ramadan {z.ramadanHijriYear} AH (≈ {z.ramadanStart})
              </div>
              <div className="p-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Big label={`${year} business profit · سال کا منافع`} value={(z.yearProfit >= 0 ? "" : "−") + PKR(z.yearProfit)} tone={z.yearProfit >= 0 ? "good" : "bad"} />
                <Big label="Zakatable profit · قابلِ زکوٰۃ منافع" value={PKR(z.zakatableProfit)} tone="neutral" />
                <Big label="Rate · شرح" value="2.5%" tone="neutral" />
                <Big label="Zakat due · واجب الادا زکوٰۃ" value={PKR(z.zakatDue)} tone="good" big />
              </div>
              {z.yearProfit < 0 && (
                <p className="mx-3 mb-2 text-[11px] text-[#B91C1C]" dir="auto">
                  {year} was a loss year for the business, so no Zakat is due on trading profit for this year. ·
                  اس سال کاروبار میں نقصان ہوا، اس لیے اس سال کے منافع پر زکوٰۃ واجب نہیں۔
                </p>
              )}

              {/* installment tracker — every real payment logged in Finance → Zakat
                  since 1 Ramadan is subtracted from the total due, live */}
              <div className="mx-3 mb-3 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">Total due · کل واجب</div>
                    <div className="text-lg font-extrabold tabular-nums text-[#1F2937]">{PKR(z.zakatDue)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-[#15803D]">Given since Ramadan · اب تک دی گئی</div>
                    <div className="text-lg font-extrabold tabular-nums text-[#15803D]">{PKR(z.givenSinceRamadan)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-[#B45309]">
                      {z.remaining >= 0 ? "Remaining · باقی" : "Overpaid · زائد ادا"}
                    </div>
                    <div className={`text-2xl font-extrabold tabular-nums ${z.remaining >= 0 ? "text-[#B45309]" : "text-[#15803D]"}`}>
                      {PKR(z.remaining)}
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-[#6B7280] mt-2" dir="auto">
                  Every entry you add in Finance → Zakat (50k one month, 10k another — however it actually happens) is
                  subtracted here automatically. Add entries there; this updates on its own.
                </p>
              </div>

              {z.givenByMonth?.length > 0 && (
                <div className="mx-3 mb-3 rounded-lg border border-[#E5E7EB] overflow-hidden">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#6B7280] bg-[#F9FAFB]" dir="auto">
                    Month-by-month, since 1 Ramadan ({z.ramadanStart}) — so nothing gets forgotten
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-[#F9FAFB] text-[#6B7280]">
                      <tr><th className="text-left px-2 py-1.5">Month</th><th className="text-right px-2 py-1.5">Given</th><th className="text-right px-2 py-1.5">Entries</th></tr>
                    </thead>
                    <tbody>
                      {z.givenByMonth.map((m: any) => (
                        <tr key={m.month} className="border-t border-[#F3F4F6]">
                          <td className="px-2 py-1.5">{m.month}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-[#15803D] font-semibold">{PKR(m.total)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">{m.count}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-[#E5E7EB] bg-[#F9FAFB] font-bold">
                      <tr>
                        <td className="px-2 py-1.5">Total · کل</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-[#15803D]">{PKR(z.givenSinceRamadan)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">{z.givenByMonth.reduce((s: number, m: any) => s + m.count, 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              {(!z.givenByMonth || z.givenByMonth.length === 0) && (
                <p className="mx-3 mb-3 text-[11px] text-[#B91C1C]" dir="auto">
                  No Zakat logged yet since 1 Ramadan {z.ramadanHijriYear} AH — add what's actually been given in
                  Finance → Zakat so it counts against the {PKR(z.zakatDue)} due.
                </p>
              )}

              <p className="mx-3 mb-3 text-[11px] text-[#9CA3AF]" dir="auto">
                {z.note}
              </p>
            </div>
          )}

          <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
            <div className="px-3 py-2 text-xs font-bold bg-[#F3F7F4]">Month by month · مہینہ بہ مہینہ — {year}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#F9FAFB] text-[#6B7280]">
                  <tr>
                    <th className="text-left px-2 py-1.5">Month</th>
                    <th className="text-right px-2 py-1.5">Income</th>
                    <th className="text-right px-2 py-1.5">Expense</th>
                    <th className="text-right px-2 py-1.5">Profit / Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {yearData.months.map((m: any) => (
                    <tr key={m.month} className="border-t border-[#F3F4F6]">
                      <td className="px-2 py-1.5">{m.month}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#15803D]">{PKR(m.income)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#B91C1C]">{PKR(m.expense)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${m.net >= 0 ? "text-[#15803D]" : "text-[#B91C1C]"}`}>
                        {(m.net >= 0 ? "" : "−") + PKR(m.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-[#E5E7EB] bg-[#F9FAFB] font-bold">
                  <tr>
                    <td className="px-2 py-1.5">Total · کل</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#15803D]">{PKR(yt.income)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#B91C1C]">{PKR(yt.expense)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${yt.net >= 0 ? "text-[#15803D]" : "text-[#B91C1C]"}`}>
                      {(yt.net >= 0 ? "" : "−") + PKR(yt.net)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {view === "monthly" && t && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Big label="Income · آمدنی" value={PKR(t.income)} tone="good" />
            <Big label="Expense · خرچہ" value={PKR(t.expense)} tone="bad" />
            <Big
              label={profit ? "NET PROFIT · صافی منافع" : "NET LOSS · صافی نقصان"}
              value={(profit ? "" : "−") + PKR(t.net)}
              tone={profit ? "good" : "bad"}
              big
            />
            <Big
              label="Trucks"
              value={`${t.trucksInProfit} profit · ${t.trucksInLoss} loss`}
              tone="neutral"
            />
          </div>

          {/* how much profit vs how much loss — not just the net */}
          <div className="grid grid-cols-2 gap-3">
            <Big
              label={`Total profit · کل منافع  (${t.trucksInProfit} trucks)`}
              value={"+" + PKR(t.grossProfit || 0)}
              tone="good"
            />
            <Big
              label={`Total loss · کل نقصان  (${t.trucksInLoss} trucks)`}
              value={"−" + PKR(t.grossLoss || 0)}
              tone="bad"
            />
          </div>
          <p className="text-[11px] text-[#9CA3AF]" dir="auto">
            Net = total profit − total loss = {(profit ? "+" : "−") + PKR(t.net)}. ·
            صافی = کل منافع − کل نقصان۔
          </p>

          {data.note && (
            <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[12px] text-[#B45309]" dir="auto">
              {data.note}
            </div>
          )}

          <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
            <div className="px-3 py-2 text-xs font-bold bg-[#F3F7F4]">Per truck · فی ٹرک — {data.month}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#F9FAFB] text-[#6B7280]">
                  <tr>
                    <th className="text-left px-2 py-1.5">Truck</th>
                    <th className="text-right px-2 py-1.5">Income</th>
                    <th className="text-right px-2 py-1.5">Expense</th>
                    <th className="text-right px-2 py-1.5">Profit / Loss</th>
                    <th className="text-right px-2 py-1.5">Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trucks.map((tr: any) => (
                    <tr key={tr.ledgerId} className="border-t border-[#F3F4F6]">
                      <td className="px-2 py-1.5" dir="auto">
                        {tr.truck}
                        {tr.partnership && <span className="ml-1 text-[9px] bg-[#EEF2FF] text-[#3730A3] rounded px-1">partner</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#15803D]">{PKR(tr.income)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#B91C1C]">{PKR(tr.expense)}</td>
                      <td
                        className={`px-2 py-1.5 text-right tabular-nums font-bold ${
                          tr.profit >= 0 ? "text-[#15803D]" : "text-[#B91C1C]"
                        }`}
                      >
                        {tr.profit >= 0 ? "" : "−"}
                        {PKR(tr.profit)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">{tr.entries}</td>
                    </tr>
                  ))}
                  {data.trucks.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-6 text-center text-[#9CA3AF]">
                        No ledger entries for this month · اس مہینے کوئی اندراج نہیں
                      </td>
                    </tr>
                  )}
                </tbody>
                {data.trucks.length > 0 && (
                  <tfoot className="border-t-2 border-[#E5E7EB] bg-[#F9FAFB] font-bold">
                    <tr>
                      <td className="px-2 py-1.5">Total · کل</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#15803D]">{PKR(t.income)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#B91C1C]">{PKR(t.expense)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${t.net >= 0 ? "text-[#15803D]" : "text-[#B91C1C]"}`}>
                        {(t.net >= 0 ? "" : "−") + PKR(t.net)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">
                        {data.trucks.reduce((s: number, x: any) => s + x.entries, 0)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {data.categories?.length > 0 && (
            <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
              <div className="px-3 py-2 text-xs font-bold bg-[#F3F7F4] flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5" /> Spend by category · کس مد میں خرچہ
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {data.categories.map((cat: any) => (
                      <tr key={cat.category} className="border-t border-[#F3F4F6]">
                        <td className="px-2 py-1.5">{cat.category}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-[#15803D]">{PKR(cat.income)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-[#B91C1C]">{PKR(cat.expense)}</td>
                        <td
                          className={`px-2 py-1.5 text-right tabular-nums font-semibold ${
                            cat.net >= 0 ? "text-[#15803D]" : "text-[#B91C1C]"
                          }`}
                        >
                          {PKR(cat.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Big({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "neutral";
  big?: boolean;
}) {
  const c =
    tone === "good"
      ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]"
      : tone === "bad"
      ? "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]"
      : "border-[#E5E7EB] bg-white text-[#1F2937]";
  return (
    <div className={`rounded-xl border p-3 ${c}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide">{label}</div>
      <div className={`${big ? "text-2xl" : "text-lg"} font-extrabold tabular-nums`}>{value}</div>
    </div>
  );
}
