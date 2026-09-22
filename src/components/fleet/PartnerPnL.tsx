/**
 * Partner P&L — half-half (or any %) co-owned truck settlement.
 *
 * Pick the partnership truck + period → see revenue, every cost (fuel / tyre /
 * oil / maintenance / salary …), net profit or loss, and the split. Then post
 * the partner's share into his running account (Party Ledger / khata), so you
 * always know how much is owed / paid.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Handshake, RefreshCw, Loader2, ArrowRight, Wallet, ChevronDown, ChevronRight } from "lucide-react";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

const PKR = (n: number) => (n < 0 ? "-" : "") + "PKR " + Math.abs(Math.round(n || 0)).toLocaleString();

export default function PartnerPnL({
  showFeedback,
  onOpenParty,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
  onOpenParty?: (id: number) => void;
}) {
  const [meta, setMeta] = useState<{ vehicles: any[]; parties: any[] } | null>(null);
  const [ledgerId, setLedgerId] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pct, setPct] = useState(50);
  const [truckFilter, setTruckFilter] = useState("");
  const [partyId, setPartyId] = useState<number | null>(null);
  const [stmt, setStmt] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState<any>(null);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [categoryEntries, setCategoryEntries] = useState<any[] | null>(null);
  const [categoryLoading, setCategoryLoading] = useState(false);

  // keep the feedback callback stable so effects don't loop when App re-renders
  const fb = useRef(showFeedback);
  fb.current = showFeedback;

  const loadMeta = useCallback(() => {
    enterpriseFetch("/api/partner-pnl/vehicles")
      .then((d) => {
        setMeta(d);
        setLedgerId((cur) => {
          if (cur) return cur;
          const first = d.vehicles?.find((v: any) => v.isPartnership) || d.vehicles?.[0];
          if (first?.partnerSharePercent) setPct(first.partnerSharePercent);
          return first?.ledgerId ?? null;
        });
      })
      .catch((e) => fb.current("error", e.message));
  }, []);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  const selectedVeh = useMemo(
    () => meta?.vehicles.find((v) => v.ledgerId === ledgerId),
    [meta, ledgerId],
  );

  const truckLabel = (v: any) =>
    `${v.vehicleNumber}${v.ownerName || v.ledgerTitle ? ` — ${v.ownerName || v.ledgerTitle}` : ""}` +
    (v.isPartnership ? ` · partner${v.partnerName ? ` (${v.partnerName} ${v.partnerSharePercent}%)` : ""}` : "");

  const filteredTrucks = useMemo(() => {
    const all = meta?.vehicles || [];
    const q = truckFilter.trim().toLowerCase();
    if (!q) return all;
    return all.filter((v: any) => truckLabel(v).toLowerCase().includes(q));
  }, [meta, truckFilter]);

  const toggleCategoryDetail = async (category: string) => {
    if (openCategory === category) {
      setOpenCategory(null);
      return;
    }
    setOpenCategory(category);
    setCategoryEntries(null);
    if (!ledgerId) return;
    setCategoryLoading(true);
    try {
      const r = await enterpriseFetch(`/api/ledgers/${ledgerId}?category=${encodeURIComponent(category)}&limit=2000`);
      let entries = r.entries || [];
      // the ledger endpoint returns every entry in this category, all dates —
      // narrow to whatever from/to window is currently selected, same as the
      // totals above were calculated from.
      if (from) entries = entries.filter((e: any) => e.entryDate && e.entryDate.slice(0, 10) >= from);
      if (to) entries = entries.filter((e: any) => e.entryDate && e.entryDate.slice(0, 10) <= to);
      setCategoryEntries(entries);
    } catch (e: any) {
      fb.current("error", e.message);
      setCategoryEntries([]);
    } finally {
      setCategoryLoading(false);
    }
  };

  const run = useCallback(() => {
    if (!ledgerId) return;
    setLoading(true);
    setPosted(null);
    setOpenCategory(null);
    setCategoryEntries(null);
    setStmt(null); // drop stale cards while the new calc runs
    const p = new URLSearchParams({ ledgerId: String(ledgerId), partnerPercent: String(pct || 0) });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const hadDates = !!(from || to);
    enterpriseFetch(`/api/partner-pnl/statement?${p.toString()}`)
      .then((d) => {
        setStmt(d);
        if ((d.entriesInPeriod ?? 0) === 0 && hadDates) {
          fb.current("error", "Is date range mein is truck ki koi khata entry nahi — dates clear karein ya range barhayein.");
        }
      })
      .catch((e) => fb.current("error", e.message))
      .finally(() => setLoading(false));
  }, [ledgerId, pct, from, to]);
  // auto-recalculate whenever the truck / dates / % change (button also re-runs)
  useEffect(() => { if (ledgerId) run(); }, [run, ledgerId]);

  const createPartyForPartner = async () => {
    const name = selectedVeh?.partnerName || prompt("Partner name for the khata?") || "";
    if (!name) return;
    try {
      const r = await enterpriseFetch("/api/partner-pnl/partner-party", { method: "POST", body: JSON.stringify({ name }) });
      showFeedback("success", `Party ${r.partyCode} created for ${name}`);
      setPartyId(r.id);
      loadMeta();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const postShare = async () => {
    if (!ledgerId || !partyId) {
      showFeedback("error", "Pick the truck and the partner's khata (party) first");
      return;
    }
    setPosting(true);
    try {
      const r = await enterpriseFetch("/api/partner-pnl/post-share", {
        method: "POST",
        body: JSON.stringify({ ledgerId, partyId, from: from || null, to: to || null, partnerPercent: pct }),
      });
      setPosted(r);
      showFeedback("success", `Posted to partner khata — ${r.balanceLabel}`);
      loadMeta();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setPosting(false);
    }
  };

  const t = stmt?.totals;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <Handshake className="w-4 h-4" /> Partner P&amp;L <span className="text-[#9CA3AF] font-normal text-sm">· پارٹنر حساب</span>
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">
            Half-half truck: revenue − all costs = net, then split. Partner's share goes to his khata. ·
            آدھی آدھی گاڑی — منافع/نقصان کا حصہ پارٹنر کے کھاتے میں۔
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModuleDataIO entityKey="partner_settlements" label="Settlements" onImported={loadMeta} />
          <button onClick={loadMeta} className="flex items-center gap-1.5 text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white hover:bg-[#F0FAF4]">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* controls */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-3 grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-[#6B7280]">
            Truck (khata) · {filteredTrucks.length} of {meta?.vehicles?.length || 0}
          </span>
          <input
            value={truckFilter}
            onChange={(e) => setTruckFilter(e.target.value)}
            placeholder="Filter trucks… (number / owner / partner)"
            className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm"
            dir="auto"
          />
          <select
            value={ledgerId ?? ""}
            size={Math.min(8, Math.max(3, filteredTrucks.length))}
            onChange={(e) => {
              const v = meta?.vehicles.find((x) => x.ledgerId === Number(e.target.value));
              setLedgerId(Number(e.target.value) || null);
              if (v?.partnerSharePercent) setPct(v.partnerSharePercent);
            }}
            className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm"
          >
            {filteredTrucks.map((v: any) => (
              <option key={v.ledgerId} value={v.ledgerId}>
                {truckLabel(v)}
              </option>
            ))}
            {filteredTrucks.length === 0 && <option disabled>no match</option>}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">Partner share %</span>
          <input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm" />
        </label>
        <div className="md:col-span-5 flex items-center gap-3 flex-wrap">
          <button onClick={run} disabled={loading || !ledgerId} className="bg-[#16A34A] text-white text-sm font-semibold rounded-lg px-4 py-2 flex items-center gap-2 disabled:opacity-60">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Calculate
          </button>
          {selectedVeh && !selectedVeh.isPartnership && (
            <span className="text-[11px] text-[#B45309]" dir="auto">
              This truck isn't marked as a partnership — set the partner share % and pick / create the partner's khata below to run an ad-hoc split. · یہ ٹرک پارٹنرشپ میں نہیں — % سیٹ کریں۔
            </span>
          )}
        </div>
      </div>

      {loading && <div className="flex items-center gap-2 text-sm text-[#4B5563]"><Loader2 className="w-4 h-4 animate-spin" /> Calculating…</div>}

      {stmt && !loading && (
        <div className="text-[11px] text-[#6B7280] flex flex-wrap items-center gap-x-3" dir="auto">
          <span>
            <b>{stmt.entriesInPeriod ?? 0}</b> khata entries counted
            {stmt.period.from || stmt.period.to
              ? ` (${stmt.period.from ? stmt.period.from.slice(0, 10) : "start"} → ${stmt.period.to ? stmt.period.to.slice(0, 10) : "now"})`
              : " (all dates)"}
          </span>
          {stmt.coverage?.minDate && (
            <span>
              · this truck's khata has entries {String(stmt.coverage.minDate).slice(0, 10)} → {String(stmt.coverage.maxDate).slice(0, 10)}
            </span>
          )}
          {stmt.coverage?.undatedEntries > 0 && (
            <span className="text-[#B45309]">· {stmt.coverage.undatedEntries} entries have no date (excluded when a date filter is set)</span>
          )}
          {(from || to) && (
            <button onClick={() => { setFrom(""); setTo(""); }} className="underline text-[#16A34A]">clear dates</button>
          )}
        </div>
      )}

      {stmt && !loading && (stmt.entriesInPeriod ?? 0) === 0 && (
        <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[12px] text-[#B45309]" dir="auto">
          Is date range mein is truck ki koi khata entry nahi mili.
          {stmt.coverage?.minDate
            ? ` Is truck ka data ${String(stmt.coverage.minDate).slice(0, 10)} se ${String(stmt.coverage.maxDate).slice(0, 10)} tak hai — dates us range mein rakhein ya "clear dates" dabayein.`
            : " Is truck ki entries pe date hi nahi — dates clear karke poora hisab dekhein."}
        </div>
      )}

      {t && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Card label="Revenue · آمدنی" value={PKR(t.revenue)} tone="good" />
            <Card label="All costs · اخراجات" value={PKR(t.cost)} tone="bad" />
            <Card label={t.net >= 0 ? "NET PROFIT · منافع" : "NET LOSS · نقصان"} value={PKR(t.net)} tone={t.net >= 0 ? "good" : "bad"} big />
            <Card label={`Partner ${stmt.partnerPercent}% · پارٹنر حصہ`} value={PKR(t.partnerShare)} tone={t.partnerShare >= 0 ? "good" : "bad"} />
            <Card label={`HF ${100 - stmt.partnerPercent}% · کمپنی حصہ`} value={PKR(t.companyShare)} />
          </div>

          <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
            <div className="px-3 py-2 text-xs font-bold bg-[#F3F7F4]">Where the money went · تفصیل <span className="text-[#9CA3AF] font-normal">(click a row for its entries)</span></div>
            <table className="w-full text-xs">
              <thead className="bg-[#F9FAFB] text-[#6B7280]">
                <tr>
                  <th className="text-left px-2 py-1.5"></th>
                  <th className="text-left px-2 py-1.5">Category</th>
                  <th className="text-right px-2 py-1.5">In (revenue)</th>
                  <th className="text-right px-2 py-1.5">Out (cost)</th>
                  <th className="text-right px-2 py-1.5">Entries</th>
                  <th className="text-left px-2 py-1.5">Counted?</th>
                </tr>
              </thead>
              <tbody>
                {stmt.lines.map((l: any) => (
                  <React.Fragment key={l.category}>
                    <tr
                      onClick={() => toggleCategoryDetail(l.category)}
                      className={`border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F9FAFB] ${openCategory === l.category ? "bg-[#EFF6FF]" : ""}`}
                    >
                      <td className="px-2 py-1.5 w-5">{openCategory === l.category ? <ChevronDown className="w-3.5 h-3.5 text-[#6B7280]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#9CA3AF]" />}</td>
                      <td className="px-2 py-1.5">{l.category}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#15803D]">{l.received ? l.received.toLocaleString() : ""}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#B91C1C]">{l.paid ? l.paid.toLocaleString() : ""}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">{l.entries}</td>
                      <td className="px-2 py-1.5 text-[10px]">
                        {l.received > 0 && l.countedRevenue && <span className="text-[#15803D]">counted as revenue</span>}
                        {l.paid > 0 && l.countedCost && <span className="text-[#B91C1C]">counted as cost</span>}
                        {((l.received > 0 && !l.countedRevenue) || (l.paid > 0 && !l.countedCost)) && (
                          <span className="text-[#9CA3AF]">not counted (owner capital / transfer / profit marker)</span>
                        )}
                        {l.received === 0 && l.paid === 0 && <span className="text-[#9CA3AF]">—</span>}
                      </td>
                    </tr>
                    {openCategory === l.category && (
                      <tr>
                        <td colSpan={6} className="p-0 bg-[#FAFAFA]">
                          {categoryLoading ? (
                            <div className="py-4 text-center text-[#9CA3AF] flex items-center justify-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading entries…</div>
                          ) : (
                            <table className="w-full text-[11px]">
                              <thead className="text-[#6B7280]">
                                <tr><th className="text-left px-3 py-1.5">Date</th><th className="text-left px-3 py-1.5">Description</th><th className="text-right px-3 py-1.5">Received</th><th className="text-right px-3 py-1.5">Paid</th></tr>
                              </thead>
                              <tbody>
                                {(categoryEntries || []).map((e: any) => (
                                  <tr key={e.id} className="border-t border-[#F3F4F6]">
                                    <td className="px-3 py-1.5 text-[#6B7280] whitespace-nowrap">{e.entryDate ? e.entryDate.slice(0, 10) : "—"}</td>
                                    <td className="px-3 py-1.5 max-w-[320px] truncate" dir="auto" title={e.description || ""}>{e.description || "—"}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-[#15803D]">{e.received ? e.received.toLocaleString() : ""}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-[#B91C1C]">{e.paid ? e.paid.toLocaleString() : ""}</td>
                                  </tr>
                                ))}
                                {(categoryEntries || []).length === 0 && (
                                  <tr><td colSpan={4} className="px-3 py-4 text-center text-[#9CA3AF]">No entries in the selected date range for this category.</td></tr>
                                )}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* post to partner khata */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-3 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><Wallet className="w-4 h-4" /> Post partner's share to his khata</h3>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select value={partyId ?? ""} onChange={(e) => setPartyId(Number(e.target.value) || null)} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm">
                <option value="">— pick partner's party (khata) —</option>
                {(meta?.parties || []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.type}) · bal {PKR(p.balance)}</option>
                ))}
              </select>
              <button onClick={createPartyForPartner} className="border border-[#E5E7EB] rounded px-2 py-1.5 hover:bg-[#F0FAF4]">
                + New party for {selectedVeh?.partnerName || "partner"}
              </button>
              <button onClick={postShare} disabled={posting || !partyId} className="bg-[#16A34A] text-white font-semibold rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-60">
                {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                Post {PKR(t.partnerShare)} {t.net >= 0 ? "(we owe partner)" : "(partner owes us)"}
              </button>
            </div>
            {posted && (
              <div className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-2 text-[12px] text-[#15803D]">
                Posted. <b>{posted.balanceLabel}</b>.{" "}
                <button className="underline" onClick={() => onOpenParty?.(posted.partyId)}>Open the partner's khata</button>
              </div>
            )}
            <p className="text-[11px] text-[#9CA3AF]" dir="auto">
              Profit → credited to the partner (we owe him). Loss → debited (he owes us). When you actually pay him,
              add a debit entry in his khata. Running balance = kitna jama / kitna dena. ·
              جب پارٹنر کو ادائیگی کریں تو اس کے کھاتے میں debit اندراج کریں۔
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ label, value, tone, big }: { label: string; value: string; tone?: "good" | "bad"; big?: boolean }) {
  const c = tone === "good" ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]" : tone === "bad" ? "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]" : "border-[#E5E7EB] bg-white text-[#1F2937]";
  return (
    <div className={`rounded-xl border p-3 ${c}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide" dir="auto">{label}</div>
      <div className={`${big ? "text-2xl" : "text-lg"} font-extrabold tabular-nums`}>{value}</div>
    </div>
  );
}
