/**
 * Partner P&L · شراکت کا حساب — everything about a truck shared with a partner, in one place,
 * kept the way the paper book keeps it (server/partnership.ts):
 *
 *   1. This cycle  — both sides' positions, the open cycle of the truck's khata, close it as
 *                    صافی بچت (or carry a قرضدار), money taken for home, old debt.
 *   2. History     — every entry of the partner and HFK, cycles closed here, and the old
 *                    paper pages of the khata with their results.
 *   3. Profit report — any dates: money in − money out by category, split by %.
 *
 * Every row opens its full detail with its receipts (attach more there), and jumps to the
 * exact row in Truck Ledgers / Party Ledgers.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Handshake, RefreshCw, Loader2, Plus, Undo2, Trash2, ExternalLink, Lock, Paperclip, X, ChevronDown, ChevronRight, Search, Upload } from "lucide-react";
import AttachmentPanel from "../common/AttachmentPanel.tsx";
import TruckSheetImport from "./TruckSheetImport.tsx";

type Nav = (wb: string, sheet: string, focus?: { ledgerId?: number; partyId?: number; entryId?: number }) => void;
type Feedback = (t: "success" | "error", m: string) => void;

const PKR = (n: number) => (n < 0 ? "-" : "") + Math.abs(Math.round(n || 0)).toLocaleString();
const minus = (n: number) => (n ? "−" + PKR(n) : "0");
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "");
const rowDate = (r: any) => r.rawDate || fmtDate(r.entryDate);

const EVENT_TYPES = [
  { kind: "shakhsi", label: "Money taken for home · شخصی برداشت" },
  { kind: "debt", label: "Old debt (qarz) · پرانا قرضہ" },
  { kind: "repayment", label: "Debt paid back · قرضہ واپسی" },
  { kind: "payout", label: "Share paid out in cash · حصہ ادا" },
];
const LEFT_OUT_WHY: Record<string, string> = {
  carry: "Carried from the previous page · پچھلے صفحے سے منتقل",
  settle: "Page settled to zero · صفحہ برابر کیا",
  box: "Figure from the side box, not a khata row · ساتھ والے خانے کا حساب",
  safi: "صافی بچت line",
};

/** Clickable row detail: what it is, where it lives, and its receipts. */
type Detail =
  | { type: "khata"; ledgerId: number; row: any }
  | { type: "party"; partyId: number; partyName: string; row: any };

export default function PartnerPnL({ showFeedback, onNavigate }: { showFeedback: Feedback; onNavigate?: Nav }) {
  const [list, setList] = useState<any[] | null>(null);
  const [opts, setOpts] = useState<{ ledgers: any[]; parties: any[] } | null>(null);
  const [ledgerId, setLedgerId] = useState<number | null>(null);
  const [tab, setTab] = useState<"cycle" | "history" | "report">("cycle");
  const [showNew, setShowNew] = useState<number | "blank" | null>(null);
  const [truckQ, setTruckQ] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [nonce, setNonce] = useState(0); // bump to re-read the open truck
  const fileRef = useRef<HTMLInputElement>(null);

  // the truck's sheet goes where it belongs — Truck Ledgers (same importer as there) — and its
  // khata is then picked here, ready to set up (or opened, if it already is a partnership)
  // the file is read first and the user picks, per truck, which khata it goes into (the truck's
  // existing khata by default — see TruckSheetImport); then that khata is picked here
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const importDone = async (r: any) => {
    setPendingFile(null);
    try {
      const o = await enterpriseFetch("/api/partnership/options");
      setOpts(o);
      loadList();
      const all = o.ledgers as any[];
      const sheets: any[] = r.report?.ledgers || [];
      // khatas the rows went into: joined existing ones first, else the sheets' own new khatas
      const ids = new Set<number>((r.merged || []).map((m: any) => m.ledgerId));
      const touched = all.filter((l) => ids.has(l.id) || (l.sourceSheet && sheets.some((sh) => l.sourceSheet === sh.sheet))).sort((x, y) => y.entries - x.entries);
      const shared = touched.find((l) => l.accountId);
      if (shared) {
        setLedgerId(shared.id); // the truck already is a partnership: open it
        setTab("cycle");
      } else if (touched[0]) {
        setLedgerId(touched[0].id);
        setShowNew(touched[0].id); // set it up, starting from that khata
      }
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const fb = useRef(showFeedback);
  fb.current = showFeedback;

  const loadList = useCallback(() => {
    enterpriseFetch("/api/partnership")
      .then((d) => {
        setList(d);
        setLedgerId((cur) => cur ?? d[0]?.truckLedgerId ?? null);
      })
      .catch((e) => fb.current("error", e.message));
    enterpriseFetch("/api/partnership/options").then(setOpts).catch(() => {});
  }, []);
  useEffect(loadList, [loadList]);

  const account = list?.find((a) => a.truckLedgerId === ledgerId) || null;
  const ledger = opts?.ledgers.find((l) => l.id === ledgerId);
  const truckName = account?.truck || ledger?.title || "";
  // a truck without a partnership account only has the report
  useEffect(() => {
    if (ledgerId && list && !account && tab !== "report") setTab("report");
  }, [ledgerId, list, account]);

  const refresh = () => {
    loadList();
    setNonce((n) => n + 1);
  };

  const otherTrucks = useMemo(() => {
    const q = truckQ.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!q) return [];
    return (opts?.ledgers || []).filter((l) => `${l.registration}${l.title}`.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(q)).slice(0, 12);
  }, [opts, truckQ]);

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <Handshake className="w-4 h-4" /> Partner P&amp;L <span className="text-[#9CA3AF] font-normal text-sm">· شراکت کا حساب</span>
          </h2>
          <p className="text-[12px] text-[#6B7280] max-w-3xl" dir="auto">
            Trucks shared with a partner, kept like the paper book. Each cycle's صافی بچت is split into the partner's ledger and HFK's ledger;
            money taken for home is written for both; a partner's old debt is cut down by his share. Click any row to see its detail and receipts. ·
            کسی بھی لائن پر کلک کریں — تفصیل اور رسیدیں کھلیں گی۔
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => e.target.files?.[0] && setPendingFile(e.target.files[0])} />
          <button
            onClick={() => fileRef.current?.click()}
            title="The sheet is saved in Truck Ledgers (same as importing it there), then picked here"
            className="flex items-center gap-1.5 text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white hover:bg-[#F2F5FA] disabled:opacity-60"
          >
            <Upload className="w-3.5 h-3.5" /> Import truck sheet (.xlsx) · ٹرک شیٹ امپورٹ
          </button>
          <button onClick={() => setShowNew("blank")} className="flex items-center gap-1.5 text-xs border border-[#24539B] text-[#24539B] rounded-lg px-2.5 py-1.5 bg-white hover:bg-[#F2F5FA]">
            <Plus className="w-3.5 h-3.5" /> New partnership · نیا شراکتی حساب
          </button>
          <button onClick={refresh} className="flex items-center gap-1.5 text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white hover:bg-[#F2F5FA]">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {pendingFile && <TruckSheetImport file={pendingFile} onCancel={() => { setPendingFile(null); if (fileRef.current) fileRef.current.value = ""; }} onDone={importDone} showFeedback={showFeedback} />}

      {showNew !== null && (
        <React.Fragment key={String(showNew)}>
        <NewPartnership
          opts={opts}
          presetLedgerId={typeof showNew === "number" ? showNew : null}
          onCancel={() => setShowNew(null)}
          onCreated={(lid) => {
            setShowNew(null);
            setLedgerId(lid);
            setTab("cycle");
            refresh();
          }}
          showFeedback={showFeedback}
        />
        </React.Fragment>
      )}

      {/* step 1: which truck */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white">
        <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA] rounded-t-xl flex items-center justify-between flex-wrap gap-2">
          <span>Partnership trucks · شراکتی ٹرک</span>
          <label className="flex items-center gap-1.5 font-normal relative">
            <Search className="w-3.5 h-3.5 text-[#6B7280]" />
            <input
              id="ppl-truck-search"
              value={truckQ}
              onChange={(e) => setTruckQ(e.target.value)}
              placeholder="Any other truck… (report only)"
              className="border border-[#E5E7EB] rounded px-2 py-1 text-xs w-56 bg-white"
            />
            {otherTrucks.length > 0 && (
              <div className="absolute right-0 top-8 z-20 w-72 max-h-64 overflow-auto rounded-lg border border-[#E5E7EB] bg-white shadow-lg">
                {otherTrucks.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => {
                      setLedgerId(l.id);
                      setTruckQ("");
                      setTab(l.accountId ? "cycle" : "report");
                    }}
                    className="block w-full text-left px-3 py-1.5 text-xs hover:bg-[#F2F5FA]"
                  >
                    {l.title} <span className="text-[#9CA3AF]">· {l.entries} rows{l.accountId ? " · partnership" : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </label>
        </div>
        {list && list.length === 0 && (
          <div className="px-3 py-3 text-xs text-[#4B5563]" dir="auto">
            No partnership truck yet — press “New partnership” and pick the truck's khata. · ابھی کوئی شراکتی ٹرک نہیں۔
          </div>
        )}
        {list && list.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[#6B7280]">
                <tr>
                  <th className="text-left px-3 py-1.5">Truck · ٹرک</th>
                  <th className="text-left px-3 py-1.5">Partner · شریک</th>
                  <th className="text-right px-3 py-1.5">This cycle · موجودہ حساب</th>
                  <th className="text-right px-3 py-1.5">Joint pool · مشترکہ جمع</th>
                  <th className="text-right px-3 py-1.5">Partner stands · شریک کی حالت</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => {
                      setLedgerId(a.truckLedgerId);
                      if (tab === "report" && !account) setTab("cycle");
                    }}
                    className={`border-t border-[#F3F4F6] cursor-pointer ${ledgerId === a.truckLedgerId ? "bg-[#EEF3FB]" : "hover:bg-[#F9FAFB]"}`}
                  >
                    <td className="px-3 py-2 font-semibold">{a.truck}</td>
                    <td className="px-3 py-2" dir="auto">{a.partnerName} · {a.partnerPercent}%</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${a.cycleNet < 0 ? "text-[#B91C1C]" : ""}`}>{PKR(a.cycleNet)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{PKR(a.pool)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${a.partner.net < 0 ? "text-[#B91C1C] font-semibold" : "text-[#047857]"}`}>
                      {a.partner.net < 0 ? `owes ${PKR(-a.partner.net)} · قرضدار` : `${PKR(a.partner.net)} in pool · جمع`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* step 2: the chosen truck */}
      {ledgerId && (
        <div className="space-y-3">
          <div className="flex items-center gap-1 border-b border-[#E5E7EB] flex-wrap">
            <span className="text-sm font-bold mr-3">{truckName}</span>
            {account && <TabBtn on={tab === "cycle"} onClick={() => setTab("cycle")}>This cycle · موجودہ حساب</TabBtn>}
            {account && <TabBtn on={tab === "history"} onClick={() => setTab("history")}>History · تاریخچہ</TabBtn>}
            <TabBtn on={tab === "report"} onClick={() => setTab("report")}>Profit report (any dates) · منافع رپورٹ</TabBtn>
            {!account && ledger && (
              <button onClick={() => setShowNew(ledger.id)} className="ml-auto mb-1 text-xs bg-[#24539B] text-white rounded-lg px-3 py-1.5">
                Make this a partnership truck · شراکتی ٹرک بنائیں
              </button>
            )}
          </div>
          {account && tab === "cycle" && <React.Fragment key={`c${account.id}-${nonce}`}><CycleTab accountId={account.id} showFeedback={showFeedback} onChanged={refresh} onOpen={setDetail} onNavigate={onNavigate} /></React.Fragment>}
          {account && tab === "history" && <React.Fragment key={`h${account.id}-${nonce}`}><HistoryTab accountId={account.id} ledgerId={ledgerId} showFeedback={showFeedback} onChanged={refresh} onOpen={setDetail} /></React.Fragment>}
          {tab === "report" && <React.Fragment key={`r${ledgerId}-${nonce}`}><ReportTab ledgerId={ledgerId} showFeedback={showFeedback} onOpen={setDetail} /></React.Fragment>}
        </div>
      )}

      {detail && <DetailDrawer d={detail} onClose={() => setDetail(null)} onNavigate={onNavigate} onFilesChanged={() => setNonce((n) => n + 1)} />}
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`text-xs px-3 py-2 -mb-px border-b-2 ${on ? "border-[#24539B] text-[#24539B] font-semibold" : "border-transparent text-[#4B5563] hover:text-[#111827]"}`}>
      {children}
    </button>
  );
}

function Clip({ n }: { n: number }) {
  return n ? (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-[#24539B]" title={`${n} receipt(s)`}>
      <Paperclip className="w-3 h-3" />
      {n}
    </span>
  ) : null;
}

/** A khata table whose rows open their detail. */
function KhataTable({ lines, ledgerId, onOpen, showBalance = true }: { lines: any[]; ledgerId: number; onOpen: (d: Detail) => void; showBalance?: boolean }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-[#6B7280] sticky top-0 bg-white">
        <tr>
          <th className="text-left px-3 py-1.5">Date · تاریخ</th>
          <th className="text-left px-3 py-1.5">Detail · تفصیل</th>
          <th className="text-right px-3 py-1.5">In · وصول</th>
          <th className="text-right px-3 py-1.5">Out · ادائیگی</th>
          {showBalance && <th className="text-right px-3 py-1.5">Balance · بقایا</th>}
          <th className="w-8" />
        </tr>
      </thead>
      <tbody>
        {lines.map((r: any) => (
          <tr key={r.id} onClick={() => onOpen({ type: "khata", ledgerId, row: r })} className="border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F2F5FA]">
            <td className="px-3 py-1.5 whitespace-nowrap">{rowDate(r)}</td>
            <td className="px-3 py-1.5" dir="auto">{r.description || <span className="text-[#9CA3AF]">—</span>}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-[#047857]">{r.received ? PKR(r.received) : ""}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-[#B91C1C]">{r.paid ? PKR(r.paid) : ""}</td>
            {showBalance && <td className={`px-3 py-1.5 text-right tabular-nums ${r.balance < 0 ? "text-[#B91C1C]" : ""}`}>{r.balance != null ? PKR(r.balance) : ""}</td>}
            <td className="px-2 py-1.5 text-right"><Clip n={r.files} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------- 1. this cycle

function CycleTab({ accountId, showFeedback, onChanged, onOpen, onNavigate }: { accountId: number; showFeedback: Feedback; onChanged: () => void; onOpen: (d: Detail) => void; onNavigate?: Nav }) {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    enterpriseFetch(`/api/partnership/${accountId}`).then(setD).catch((e) => showFeedback("error", e.message));
  }, [accountId]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<any>, ok: (r: any) => string) => {
    setBusy(true);
    try {
      const r = await fn();
      showFeedback("success", ok(r));
      onChanged();
      return r;
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!d) return <div className="flex items-center gap-2 text-sm text-[#4B5563]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  const cyc = d.cycle;
  const pct = d.account.partnerPercent;
  const openParty = (partyId: number) => onNavigate?.("khata", "parties", { partyId });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-[#24539B] bg-[#EEF3FB] p-3">
          <div className="text-[11px] text-[#4B5563]">Joint pool left · بقایا مشترکہ جمع</div>
          <div className="text-xl font-bold tabular-nums">{PKR(d.pool)}</div>
          <div className="text-[11px] text-[#6B7280]" dir="auto">
            = shares of profit − money taken for home (both sides) · {pct}% / {100 - pct}%
          </div>
        </div>
        <Side title={d.partnerName} role={`partner ${pct}%`} s={d.partner} onOpen={onNavigate ? () => openParty(d.account.partnerPartyId) : undefined} />
        <Side title={d.hfkName} role={`HFK ${100 - pct}%`} s={d.hfk} onOpen={onNavigate ? () => openParty(d.account.hfkPartyId) : undefined} />
      </div>

      {d.strays?.length > 0 && (
        <div className="rounded-xl border border-[#F59E0B] bg-[#FFFBEB] px-3 py-2 text-xs flex items-center justify-between gap-3 flex-wrap" dir="auto">
          <span>
            {d.truck} also has {d.strays.length === 1 ? "another khata" : `${d.strays.length} other khatas`} made in the app (Daily Cash Book / Trip Desk):{" "}
            {d.strays.map((x: any) => `${x.title} — ${x.entries} entries, in ${PKR(x.received)}, out ${PKR(x.paid)}`).join("; ")}. This cycle can't see them until they are
            moved here. · اس ٹرک کا ایک اور کھاتہ بھی ہے — اسے یہاں منتقل کریں تاکہ حساب مکمل ہو۔
          </span>
          <button
            disabled={busy}
            onClick={() =>
              window.confirm(`Move ${d.strays.reduce((n: number, x: any) => n + x.entries, 0)} entries into ${d.truckTitle}, so ${d.truck} has one khata? · اندراجات اس کھاتے میں منتقل کریں؟`) &&
              act(() => enterpriseFetch(`/api/partnership/${accountId}/adopt`, { method: "POST" }), (r) => `${r.moved} entries moved into this khata (${r.intoOpenCycle} in the open cycle) · منتقل ہو گئے`)
            }
            className="bg-[#B45309] text-white font-semibold rounded-lg px-3 py-1.5 whitespace-nowrap disabled:opacity-60"
          >
            Move into this khata · یہاں منتقل کریں
          </button>
        </div>
      )}

      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 bg-[#F2F5FA] flex items-center justify-between flex-wrap gap-2">
          <div className="text-xs font-bold">
            Open cycle {cyc.cycleNo} · موجودہ حساب — {cyc.lines.length} khata rows since the last close
            <span className="font-normal text-[#6B7280]"> (in the order written · click a row for detail and receipts)</span>
          </div>
          {d.account.cycleNo > 0 && (
            <button
              disabled={busy}
              onClick={() =>
                window.confirm("Reopen the last closed cycle? Its صافی بچت entries are removed from both ledgers. · آخری بند حساب دوبارہ کھولیں؟") &&
                act(() => enterpriseFetch(`/api/partnership/${accountId}/undo-close`, { method: "POST" }), () => "Last cycle reopened · حساب دوبارہ کھل گیا")
              }
              className="flex items-center gap-1 text-[11px] text-[#4B5563] underline"
            >
              <Undo2 className="w-3 h-3" /> Reopen last cycle
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-auto">
          {cyc.lines.length ? (
            <KhataTable lines={cyc.lines} ledgerId={d.account.truckLedgerId} onOpen={onOpen} />
          ) : (
            <div className="px-3 py-3 text-center text-xs text-[#6B7280]">Nothing written in the khata since the last close · پچھلے حساب کے بعد کوئی انٹری نہیں</div>
          )}
        </div>
        <div className="px-3 py-2 border-t border-[#E5E7EB] flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="tabular-nums">
            In <b className="text-[#047857]">{PKR(cyc.received)}</b> − Out <b className="text-[#B91C1C]">{PKR(cyc.paid)}</b> ={" "}
            <b className={cyc.net < 0 ? "text-[#B91C1C]" : "text-[#047857]"}>{PKR(cyc.net)}</b>
            {cyc.net >= 0 ? " · صافی بچت" : " · قرضدار"}
          </div>
          {cyc.lines.length > 0 && cyc.net >= 0 && (
            <button
              disabled={busy}
              onClick={() =>
                window.confirm(`Close cycle ${cyc.cycleNo}: صافی بچت ${PKR(cyc.net)} → ${d.partnerName} ${PKR(cyc.partnerShare)}, ${d.hfkName} ${PKR(cyc.hfkShare)}?`) &&
                act(
                  () => enterpriseFetch(`/api/partnership/${accountId}/close`, { method: "POST", body: JSON.stringify({ date: today() }) }),
                  (r) => `Cycle ${r.cycleNo} closed — ${PKR(r.partnerShare)} to ${d.partnerName}, ${PKR(r.hfkShare)} to ${d.hfkName}`,
                )
              }
              className="bg-[#24539B] text-white font-semibold rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-60"
            >
              <Lock className="w-3.5 h-3.5" /> Close cycle · صافی بچت: {d.partnerName} {PKR(cyc.partnerShare)} + HFK {PKR(cyc.hfkShare)}
            </button>
          )}
          {cyc.lines.length > 0 && cyc.net < 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[#4B5563]" dir="auto">Short — carries into the next trip (paper method) · اگلے حساب میں شامل ہو گا</span>
              <button
                disabled={busy}
                onClick={() =>
                  window.confirm(`Split the loss ${PKR(-cyc.net)} now (${pct}/${100 - pct}) instead of carrying it? · نقصان ابھی تقسیم کریں؟`) &&
                  act(() => enterpriseFetch(`/api/partnership/${accountId}/close`, { method: "POST", body: JSON.stringify({ date: today(), splitLoss: true }) }), () => "Loss split into both ledgers · نقصان تقسیم ہو گیا")
                }
                className="border border-[#B91C1C] text-[#B91C1C] rounded-lg px-2.5 py-1 disabled:opacity-60"
              >
                Split the loss now · نقصان ابھی تقسیم کریں
              </button>
            </div>
          )}
        </div>
      </div>

      <AddEntry d={d} busy={busy} act={act} />
    </div>
  );
}

function Side({ title, role, s, onOpen }: { title: string; role: string; s: any; onOpen?: () => void }) {
  const bad = s.net < 0;
  const good = s.net > 0;
  const tone = bad ? "border-[#FCA5A5] bg-[#FEF2F2]" : good ? "border-[#A7F3D0] bg-[#F0FDF4]" : "border-[#E5E7EB] bg-white";
  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-[#374151]" dir="auto">{title} <span className="font-normal text-[#6B7280]">({role})</span></div>
        {onOpen && (
          <button onClick={onOpen} className="text-[11px] text-[#24539B] flex items-center gap-1 whitespace-nowrap">
            ledger <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className={`text-sm font-bold mt-1 ${bad ? "text-[#B91C1C]" : good ? "text-[#047857]" : ""}`} dir="auto">
        {bad ? `Owes ${PKR(-s.net)} · قرضدار ہے` : good ? `${PKR(s.net)} is his in the pool · جمع ہے` : "Clear · حساب برابر"}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2 text-[11px] tabular-nums text-[#4B5563]">
        <span>Share of profit · منافع کا حصہ</span><span className="text-right">{PKR(s.share)}</span>
        <span>Taken for home · شخصی برداشت</span><span className="text-right">{minus(s.withdrawn)}</span>
        {s.paidOut ? (<><span>Paid out · ادا</span><span className="text-right">{minus(s.paidOut)}</span></>) : null}
        {s.debt ? (<><span>Old debt left · باقی قرضہ</span><span className="text-right">{minus(s.debt)}</span></>) : null}
      </div>
    </div>
  );
}

function AddEntry({ d, busy, act }: { d: any; busy: boolean; act: (fn: () => Promise<any>, ok: (r: any) => string) => Promise<any> }) {
  const [kind, setKind] = useState("shakhsi");
  const [who, setWho] = useState<"partner" | "hfk">("partner");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState("Cash");
  const [note, setNote] = useState("");
  const [matchOther, setMatchOther] = useState(true);
  const partnerOnly = kind === "debt" || kind === "repayment";
  const whoNow = partnerOnly ? "partner" : who;
  const partnerOwes = d.partner.net < 0;

  const submit = async () => {
    const r = await act(
      () => enterpriseFetch(`/api/partnership/${d.account.id}/event`, { method: "POST", body: JSON.stringify({ kind, who: whoNow, amount, date, method, note, matchOther }) }),
      (r) => r.warning || "Saved in the party ledger — attach the receipt from History · کھاتے میں درج ہو گیا",
    );
    if (r) {
      setAmount("");
      setNote("");
    }
  };

  const inp = "border border-[#E5E7EB] rounded px-2 py-1.5";
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-3 space-y-2">
      <div className="text-xs font-bold">Add an entry · نئی انٹری</div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-[#6B7280]">Type · قسم</span>
          <select id="ppl-kind" value={kind} onChange={(e) => setKind(e.target.value)} className={inp}>
            {EVENT_TYPES.map((t) => <option key={t.kind} value={t.kind}>{t.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">Whose · کس کا</span>
          <select id="ppl-who" value={whoNow} disabled={partnerOnly} onChange={(e) => setWho(e.target.value as any)} className={inp}>
            <option value="partner">{d.partnerName}</option>
            <option value="hfk">{d.hfkName}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">Amount · رقم *</span>
          <input id="ppl-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inp} tabular-nums`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">Date · تاریخ</span>
          <input id="ppl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">How · طریقہ</span>
          <select id="ppl-method" value={method} onChange={(e) => setMethod(e.target.value)} className={inp}>
            <option>Cash</option>
            <option>Online</option>
            <option>Cheque</option>
            <option>Adjustment</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 md:col-span-4">
          <span className="text-[#6B7280]">Note · تفصیل</span>
          <input id="ppl-note" value={note} onChange={(e) => setNote(e.target.value)} dir="auto" className={inp} />
        </label>
        <div className="md:col-span-2 flex items-end">
          <button disabled={busy || !amount} onClick={submit} className="w-full bg-[#24539B] text-white font-semibold rounded-lg px-3 py-1.5 disabled:opacity-60">
            {busy ? "Saving…" : "Save · محفوظ کریں"}
          </button>
        </div>
      </div>
      {kind === "shakhsi" && (
        <label className="flex items-center gap-2 text-[11px] text-[#374151]" dir="auto">
          <input id="ppl-match" type="checkbox" checked={matchOther} onChange={(e) => setMatchOther(e.target.checked)} />
          Write the same amount for {whoNow === "partner" ? d.hfkName : d.partnerName} too, so the 50/50 stays level (paper method) · برابر رقم دوسرے شریک کے نام بھی
        </label>
      )}
      {whoNow === "partner" && (kind === "shakhsi" || kind === "payout") && partnerOwes && (
        <div className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[11px] text-[#B91C1C]" dir="auto">
          {d.partnerName} already owes {PKR(-d.partner.net)}. Whatever he takes now is added to his debt. · یہ پہلے سے قرضدار ہے — جو رقم لے گا وہ قرضے میں جمع ہو گی۔
        </div>
      )}
      <div className="text-[11px] text-[#6B7280]" dir="auto">
        Record this here only — not again with the Daily Cash Book's “Also add to party”, or it is counted twice. · یہ انٹری صرف یہاں کریں۔
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 2. history

function HistoryTab({ accountId, ledgerId, showFeedback, onChanged, onOpen }: { accountId: number; ledgerId: number; showFeedback: Feedback; onChanged: () => void; onOpen: (d: Detail) => void }) {
  const [d, setD] = useState<any>(null);
  const [pages, setPages] = useState<any[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [rows, setRows] = useState<{ lines: any[]; box: any[] } | null>(null);

  useEffect(() => {
    enterpriseFetch(`/api/partnership/${accountId}`).then(setD).catch((e) => showFeedback("error", e.message));
    enterpriseFetch(`/api/partnership/ledger/${ledgerId}/pages`).then(setPages).catch(() => setPages([]));
  }, [accountId, ledgerId]);

  const toggle = (key: string, query: string) => {
    if (openKey === key) return setOpenKey(null);
    setOpenKey(key);
    setRows(null);
    enterpriseFetch(`/api/partnership/ledger/${ledgerId}/rows?${query}`).then(setRows).catch((e) => showFeedback("error", e.message));
  };

  const remove = async (id: number) => {
    if (!window.confirm("Remove this entry from the party ledger? · یہ انٹری ہٹائیں؟")) return;
    try {
      await enterpriseFetch(`/api/partnership/${accountId}/event/${id}`, { method: "DELETE" });
      showFeedback("success", "Entry removed · انٹری ہٹ گئی");
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  if (!d) return <div className="flex items-center gap-2 text-sm text-[#4B5563]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  const nameOf = (h: any) => (h.side === "partner" ? d.partnerName : d.hfkName);
  const partyOf = (h: any) => (h.side === "partner" ? d.account.partnerPartyId : d.account.hfkPartyId);

  const expander = (key: string) =>
    openKey === key && (
      <tr>
        <td colSpan={6} className="bg-[#FAFBFD] p-0">
          {!rows ? (
            <div className="p-3 text-xs text-[#4B5563] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading rows…</div>
          ) : (
            <div className="max-h-96 overflow-auto border-y border-[#E5E7EB]">
              <KhataTable lines={rows.lines} ledgerId={ledgerId} onOpen={onOpen} />
              {rows.box.length > 0 && (
                <div className="px-3 py-2 text-[11px] text-[#6B7280]" dir="auto">
                  Side-box figures on this page (not counted): {rows.box.map((b) => `${b.description || ""} ${PKR(b.received || b.paid)}`).join(" · ")}
                </div>
              )}
            </div>
          )}
        </td>
      </tr>
    );

  return (
    <div className="space-y-3">
      {/* partner + HFK entries */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA]">
          Partner &amp; HFK entries · شریکوں کی انٹریاں <span className="font-normal text-[#6B7280]">(these lines are in the two party ledgers · click for receipts)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[#6B7280]">
              <tr>
                <th className="text-left px-3 py-1.5">Date</th>
                <th className="text-left px-3 py-1.5">Whose · کس کا</th>
                <th className="text-left px-3 py-1.5">Type · قسم</th>
                <th className="text-left px-3 py-1.5">Detail</th>
                <th className="text-right px-3 py-1.5">Added · جمع</th>
                <th className="text-right px-3 py-1.5">Taken · نام</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {d.history.map((h: any) => (
                <tr key={h.id} onClick={() => onOpen({ type: "party", partyId: partyOf(h), partyName: nameOf(h), row: h })} className="border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F2F5FA]">
                  <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(h.entryDate)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap" dir="auto">{nameOf(h)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap" dir="auto">{h.label}</td>
                  <td className="px-3 py-1.5" dir="auto">{h.description}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#047857]">{h.credit ? PKR(h.credit) : ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#B91C1C]">{h.debit ? PKR(h.debit) : ""}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <Clip n={h.files} />
                    {h.kind !== "safi" && h.kind !== "loss" && (
                      <button
                        title="Remove this entry"
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(h.id);
                        }}
                        className="ml-2 text-[#9CA3AF] hover:text-[#B91C1C] align-middle"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!d.history.length && <tr><td colSpan={7} className="px-3 py-3 text-center text-[#6B7280]">No entries yet · ابھی کوئی انٹری نہیں</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* cycles */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA]">
          Cycles · حساب <span className="font-normal text-[#6B7280]">(click a cycle to see every khata row in it)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[#6B7280]">
              <tr>
                <th className="text-left px-3 py-1.5 w-6" />
                <th className="text-left px-3 py-1.5">Cycle · حساب</th>
                <th className="text-left px-3 py-1.5">Dates · تاریخیں</th>
                <th className="text-right px-3 py-1.5">In − Out</th>
                <th className="text-right px-3 py-1.5">Result · نتیجہ</th>
                <th className="text-right px-3 py-1.5">Receipts</th>
              </tr>
            </thead>
            <tbody>
              {d.closed.map((c: any) => (
                <React.Fragment key={`c${c.no}`}>
                  <tr onClick={() => toggle(`c${c.no}`, `after=${c.after}&upto=${c.upto}`)} className="border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F2F5FA]">
                    <td className="px-3 py-1.5">{openKey === `c${c.no}` ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                    <td className="px-3 py-1.5 font-semibold">Cycle {c.no} (closed here)</td>
                    <td className="px-3 py-1.5">closed {fmtDate(c.date)}</td>
                    <td className="px-3 py-1.5 text-right" />
                    <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${c.net < 0 ? "text-[#B91C1C]" : "text-[#047857]"}`}>
                      {PKR(c.net)} {c.net >= 0 ? "· صافی بچت" : "· نقصان"}
                    </td>
                    <td />
                  </tr>
                  {expander(`c${c.no}`)}
                </React.Fragment>
              ))}
              {(pages || []).map((p: any) => (
                <React.Fragment key={p.page}>
                  <tr onClick={() => toggle(p.page, `page=${encodeURIComponent(p.page)}`)} className="border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F2F5FA]">
                    <td className="px-3 py-1.5">{openKey === p.page ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                    <td className="px-3 py-1.5">
                      {p.page} <span className="text-[#9CA3AF]">· paper · {p.lines} rows</span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{p.from} → {p.to}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#6B7280]">{PKR(p.received)} − {PKR(p.paid)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${p.result < 0 ? "text-[#B91C1C]" : "text-[#047857]"}`}>
                      {PKR(p.result)} {p.result >= 0 ? "· صافی بچت" : "· قرضدار"}
                    </td>
                    <td className="px-3 py-1.5 text-right"><Clip n={p.files} /></td>
                  </tr>
                  {expander(p.page)}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 3. report

function ReportTab({ ledgerId, showFeedback, onOpen }: { ledgerId: number; showFeedback: Feedback; onOpen: (d: Detail) => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pct, setPct] = useState(50);
  const [r, setR] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [showLeft, setShowLeft] = useState(false);

  const run = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ ledgerId: String(ledgerId), pct: String(pct) });
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    enterpriseFetch(`/api/partnership/report?${q}`)
      .then(setR)
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [ledgerId, from, to, pct]);
  useEffect(run, [run]);

  const t = r?.totals;
  const inp = "border border-[#E5E7EB] rounded px-2 py-1.5 text-sm";
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-3 flex items-end gap-3 flex-wrap text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">From · سے</span>
          <input id="ppl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">To · تک</span>
          <input id="ppl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">Partner share % · شریک کا حصہ</span>
          <input id="ppl-pct" type="number" min={0} max={100} value={r?.accountId ? r.pct : pct} disabled={!!r?.accountId} onChange={(e) => setPct(Number(e.target.value))} className={`${inp} w-24`} />
        </label>
        {(from || to) && <button onClick={() => { setFrom(""); setTo(""); }} className="underline text-[#24539B] pb-2">all dates · تمام تاریخیں</button>}
        {loading && <Loader2 className="w-4 h-4 animate-spin mb-2" />}
        {r?.coverage && (
          <span className="text-[#6B7280] pb-2">this khata has entries {fmtDate(r.coverage.from)} → {fmtDate(r.coverage.to)}{r.undated ? ` · ${r.undated} rows have no date (left out when dates are set)` : ""}</span>
        )}
      </div>

      {t && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Card label="Money in · آمدنی" value={PKR(t.revenue)} tone="good" />
            <Card label="Money out · اخراجات" value={PKR(t.cost)} tone="bad" />
            <Card label={t.net >= 0 ? "Profit · منافع" : "Loss · نقصان"} value={PKR(t.net)} tone={t.net >= 0 ? "good" : "bad"} big />
            <Card label={`Partner ${r.pct}% · شریک`} value={PKR(t.partnerShare)} />
            <Card label={`HFK ${100 - r.pct}% · HFK`} value={PKR(t.hfkShare)} />
          </div>

          <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
            <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA]">Where the money came from and went · تفصیل <span className="font-normal text-[#6B7280]">(click a line for its rows)</span></div>
            <table className="w-full text-xs">
              <thead className="text-[#6B7280]">
                <tr>
                  <th className="text-left px-3 py-1.5 w-6" />
                  <th className="text-left px-3 py-1.5">Kind · قسم</th>
                  <th className="text-right px-3 py-1.5">Rows</th>
                  <th className="text-right px-3 py-1.5">In · وصول</th>
                  <th className="text-right px-3 py-1.5">Out · ادائیگی</th>
                </tr>
              </thead>
              <tbody>
                {r.categories.map((c: any) => (
                  <React.Fragment key={c.category}>
                    <tr onClick={() => setOpenCat(openCat === c.category ? null : c.category)} className="border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F2F5FA]">
                      <td className="px-3 py-1.5">{openCat === c.category ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                      <td className="px-3 py-1.5">{c.category}</td>
                      <td className="px-3 py-1.5 text-right">{c.entries}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#047857]">{c.received ? PKR(c.received) : ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#B91C1C]">{c.paid ? PKR(c.paid) : ""}</td>
                    </tr>
                    {openCat === c.category && (
                      <tr>
                        <td colSpan={5} className="bg-[#FAFBFD] p-0">
                          <div className="max-h-80 overflow-auto border-y border-[#E5E7EB]">
                            <KhataTable lines={r.rows.filter((x: any) => x.category === c.category)} ledgerId={ledgerId} onOpen={onOpen} showBalance={false} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {r.leftOut.length > 0 && (
            <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
              <button onClick={() => setShowLeft((v) => !v)} className="w-full px-3 py-2 text-xs font-bold bg-[#F9FAFB] flex items-center gap-2 text-left">
                {showLeft ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Not counted ({r.leftOut.length}) · شمار نہیں کیا
                <span className="font-normal text-[#6B7280]" dir="auto">— carried lines, page-settling lines and side-box figures would count the same money twice</span>
              </button>
              {showLeft && (
                <table className="w-full text-xs">
                  <tbody>
                    {r.leftOut.map((x: any) => (
                      <tr key={x.id} onClick={() => onOpen({ type: "khata", ledgerId, row: x })} className="border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F2F5FA]">
                        <td className="px-3 py-1.5 whitespace-nowrap">{rowDate(x)}</td>
                        <td className="px-3 py-1.5" dir="auto">{x.description || "—"} <span className="text-[#9CA3AF]">· {x.page}</span></td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{PKR(x.received || x.paid)}</td>
                        <td className="px-3 py-1.5 text-[#6B7280]" dir="auto">{LEFT_OUT_WHY[x.why]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Card({ label, value, tone, big }: { label: string; value: string; tone?: "good" | "bad"; big?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${big ? "border-[#24539B] bg-[#EEF3FB]" : "border-[#E5E7EB] bg-white"}`}>
      <div className="text-[11px] text-[#6B7280]">{label}</div>
      <div className={`${big ? "text-xl" : "text-base"} font-bold tabular-nums ${tone === "good" ? "text-[#047857]" : tone === "bad" ? "text-[#B91C1C]" : ""}`}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------- row detail

function DetailDrawer({ d, onClose, onNavigate, onFilesChanged }: { d: Detail; onClose: () => void; onNavigate?: Nav; onFilesChanged: () => void }) {
  const r = d.row;
  const isKhata = d.type === "khata";
  const facts: [string, React.ReactNode][] = isKhata
    ? [
        ["Date · تاریخ", rowDate(r) || "—"],
        ["Page · صفحہ", r.page || "—"],
        ["Sr #", r.srNo ?? "—"],
        ["Kind · قسم", r.category],
        ["How · طریقہ", r.method || "—"],
        ["In · وصول", r.received ? PKR(r.received) : "—"],
        ["Out · ادائیگی", r.paid ? PKR(r.paid) : "—"],
        ["Balance on the paper · کاغذ پر بقایا", r.sheetBalance != null ? PKR(r.sheetBalance) : "—"],
      ]
    : [
        ["Date · تاریخ", fmtDate(r.entryDate)],
        ["Whose ledger · کس کا کھاتہ", d.partyName],
        ["Type · قسم", r.label],
        ["How · طریقہ", r.method || "—"],
        ["Added · جمع", r.credit ? PKR(r.credit) : "—"],
        ["Taken · نام", r.debit ? PKR(r.debit) : "—"],
      ];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-lg h-full bg-white shadow-xl overflow-auto p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] text-[#6B7280]">{isKhata ? "Truck khata row · ٹرک کھاتہ" : "Party ledger entry · پارٹی کھاتہ"}</div>
            <div className="text-sm font-bold" dir="auto">{r.description || "—"}</div>
          </div>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#111827]"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs rounded-lg border border-[#E5E7EB] p-3">
          {facts.map(([k, v]) => (
            <React.Fragment key={k}>
              <span className="text-[#6B7280]">{k}</span>
              <span className="text-right tabular-nums" dir="auto">{v}</span>
            </React.Fragment>
          ))}
        </div>
        {isKhata && (r.box || r.carry) && (
          <div className="rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] px-3 py-2 text-[11px] text-[#4B5563]" dir="auto">
            {r.box ? LEFT_OUT_WHY.box : LEFT_OUT_WHY.carry} — not counted in the profit report.
          </div>
        )}
        {onNavigate && (
          <button
            onClick={() => {
              if (d.type === "khata") onNavigate("khata", "truck_ledgers", { ledgerId: d.ledgerId, entryId: r.id });
              else onNavigate("khata", "parties", { partyId: d.partyId, entryId: r.id });
              onClose();
            }}
            className="w-full flex items-center justify-center gap-1.5 text-xs border border-[#24539B] text-[#24539B] rounded-lg px-3 py-2 hover:bg-[#F2F5FA]"
          >
            <ExternalLink className="w-3.5 h-3.5" /> {isKhata ? "Open this row in Truck Ledgers · ٹرک کھاتے میں کھولیں" : "Open this entry in Party Ledgers · پارٹی کھاتے میں کھولیں"}
          </button>
        )}
        <div onClick={onFilesChanged}>
          <AttachmentPanel entityType={isKhata ? "truck_ledger_entry" : "party_ledger_entry"} entityId={r.id} title="Receipts & proof · رسیدیں" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- setup

/** A party picker that always shows the Party Ledgers list; typing narrows it or names a new one. */
function PartyPicker({
  id,
  label,
  parties,
  name,
  partyId,
  suggestions,
  placeholder,
  onPick,
}: {
  id: string;
  label: string;
  parties: any[];
  name: string;
  partyId: number | null;
  suggestions: { name: string; partyId: number | null; why: string }[];
  placeholder: string;
  onPick: (name: string, partyId: number | null) => void;
}) {
  const q = name.trim().toLowerCase();
  const list = useMemo(() => {
    const all = [...parties].sort((a, b) => a.name.localeCompare(b.name));
    return q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
  }, [parties, q]);
  const exact = parties.some((p) => p.name.trim().toLowerCase() === q);
  const inp = "border border-[#E5E7EB] rounded px-2 py-1.5";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[#6B7280]">{label}</span>
      <input id={id} value={name} onChange={(e) => onPick(e.target.value, null)} placeholder={placeholder} dir="auto" className={inp} />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((sg) => (
            <button
              key={sg.name}
              type="button"
              title={sg.why}
              onClick={() => onPick(sg.name, sg.partyId)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${partyId != null && partyId === sg.partyId ? "border-[#24539B] bg-[#EEF3FB] text-[#24539B]" : "border-[#E5E7EB] bg-white hover:bg-[#F2F5FA]"}`}
              dir="auto"
            >
              {sg.name} <span className="text-[#9CA3AF]">· {sg.partyId ? "has a ledger" : "new ledger"} · {sg.why.split(" · ")[0]}</span>
            </button>
          ))}
        </div>
      )}
      <select
        id={`${id}-list`}
        size={5}
        value={partyId ?? ""}
        onChange={(e) => {
          const p = parties.find((x) => x.id === Number(e.target.value));
          if (p) onPick(p.name, p.id);
        }}
        className={inp}
      >
        {list.slice(0, 500).map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <span className="text-[11px] text-[#6B7280]" dir="auto">
        {partyId
          ? "Uses this Party Ledger · یہی پارٹی کھاتہ استعمال ہو گا"
          : q && !exact
          ? `No Party Ledger named “${name.trim()}” — a new one will be made · نیا کھاتہ بنے گا`
          : `${parties.length} Party Ledgers — pick one or type a new name`}
      </span>
    </div>
  );
}

function NewPartnership({
  opts,
  presetLedgerId,
  onCancel,
  onCreated,
  showFeedback,
}: {
  opts: { ledgers: any[]; parties: any[] } | null;
  presetLedgerId: number | null;
  onCancel: () => void;
  onCreated: (ledgerId: number) => void;
  showFeedback: Feedback;
}) {
  const [f, setF] = useState({
    truckLedgerId: presetLedgerId ? String(presetLedgerId) : "",
    partnerName: "",
    partnerPartyId: null as number | null,
    hfkName: "",
    hfkPartyId: null as number | null,
    partnerPercent: "50",
    openingPool: "",
    openingDate: today(),
    openingDebt: "",
    debtNote: "",
  });
  const [truckQ, setTruckQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [sug, setSug] = useState<any>(null);
  const set = (k: string) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  const trucks = useMemo(() => {
    const q = truckQ.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return (opts?.ledgers || [])
      .filter((l) => !l.accountId && (!q || `${l.registration}${l.title}`.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(q)))
      .sort((x, y) => {
        if (q) return y.entries - x.entries;
        // real truck numbers (they have digits) first; odd sheet names like "OWNER:" last
        const dx = /\d/.test(x.registration || "") ? 0 : 1;
        const dy = /\d/.test(y.registration || "") ? 0 : 1;
        return dx - dy || String(x.registration).localeCompare(String(y.registration)) || y.entries - x.entries;
      });
  }, [opts, truckQ]);
  // typing a truck number picks its main khata straight away (it can still be changed in the list)
  useEffect(() => {
    if (truckQ.trim() && trucks.length && !trucks.some((l) => String(l.id) === f.truckLedgerId)) {
      setF((x) => ({ ...x, truckLedgerId: String(trucks[0].id) }));
    }
  }, [trucks, truckQ]);

  // a picked truck fills in what its khata already knows: partner, HFK side, where the cycle starts
  useEffect(() => {
    setSug(null);
    if (!f.truckLedgerId) return;
    let live = true;
    enterpriseFetch(`/api/partnership/suggest?ledgerId=${f.truckLedgerId}`)
      .then((r) => {
        if (!live) return;
        setSug(r);
        setF((x) => ({
          ...x,
          partnerName: x.partnerName || r.partner[0]?.name || "",
          partnerPartyId: x.partnerName ? x.partnerPartyId : r.partner[0]?.partyId ?? null,
          hfkName: x.hfkName || r.hfk[0]?.name || "",
          hfkPartyId: x.hfkName ? x.hfkPartyId : r.hfk[0]?.partyId ?? null,
        }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [f.truckLedgerId]);

  const picked = opts?.ledgers.find((l) => String(l.id) === f.truckLedgerId);
  const missing = [
    !f.truckLedgerId && "the truck's khata (1)",
    !f.partnerName.trim() && "the partner (2)",
    !f.hfkName.trim() && "the HFK side (3)",
  ].filter(Boolean);

  const save = async () => {
    setSaving(true);
    try {
      await enterpriseFetch("/api/partnership", {
        method: "POST",
        body: JSON.stringify({
          ...f,
          truckLedgerId: Number(f.truckLedgerId),
          partnerPartyId: f.partnerPartyId || undefined,
          hfkPartyId: f.hfkPartyId || undefined,
        }),
      });
      showFeedback("success", "Partnership set up · شراکتی حساب بن گیا");
      onCreated(Number(f.truckLedgerId));
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const inp = "border border-[#E5E7EB] rounded px-2 py-1.5";
  return (
    <div className="rounded-xl border border-[#24539B] bg-white p-3 space-y-3 text-xs">
      <div className="font-bold">New partnership · نیا شراکتی حساب</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 1. truck khata — every Truck Ledger is listed */}
        <div className="flex flex-col gap-1">
          <span className="text-[#6B7280]">1. Truck khata (from Truck Ledgers) · ٹرک کا کھاتہ *</span>
          <input id="ppl-new-truck-q" value={truckQ} onChange={(e) => setTruckQ(e.target.value)} placeholder="Search a truck number…" className={inp} />
          {!opts ? (
            <span className="text-[#6B7280] flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading Truck Ledgers…</span>
          ) : trucks.length ? (
            <select id="ppl-new-truck" value={f.truckLedgerId} onChange={set("truckLedgerId")} size={8} className={inp}>
              {trucks.map((l) => (
                <option key={l.id} value={l.id}>{l.title} · {l.entries} rows</option>
              ))}
            </select>
          ) : (
            <div className="rounded border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-2 text-[#B91C1C]" dir="auto">
              No truck khata matches “{truckQ}”. Import the truck's sheet with “Import truck sheet” above, or make its khata in Ledgers → Truck Ledgers. · اس نمبر کا کوئی کھاتہ نہیں ملا۔
            </div>
          )}
          <span className="text-[11px] text-[#6B7280]">{trucks.length} of {(opts?.ledgers || []).filter((l) => !l.accountId).length} Truck Ledgers</span>
          {picked && (
            <div className="rounded-lg bg-[#F2F5FA] px-2 py-2 text-[11px] text-[#374151] space-y-0.5" dir="auto">
              <div className="font-semibold">{picked.title} · {picked.entries} rows</div>
              {!sug ? (
                <div className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Reading this khata…</div>
              ) : (
                <>
                  <div>
                    Open cycle starts after:{" "}
                    {sug.cycle.startsAfter
                      ? `“${sug.cycle.startsAfter.description || "صافی بچت"}” (${String(sug.cycle.startsAfter.date || "").slice(0, 10)})`
                      : "the first row (no صافی بچت line yet)"}
                  </div>
                  <div className="tabular-nums">
                    {sug.cycle.rows} rows since then: in {PKR(sug.cycle.received)} − out {PKR(sug.cycle.paid)} ={" "}
                    <b className={sug.cycle.net < 0 ? "text-[#B91C1C]" : "text-[#047857]"}>{PKR(sug.cycle.net)}</b>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* 2 + 3. the two sides — every Party Ledger is listed */}
        <PartyPicker
          id="ppl-new-partner"
          label="2. Partner (his Party Ledger) · شریک کا کھاتہ *"
          parties={opts?.parties || []}
          name={f.partnerName}
          partyId={f.partnerPartyId}
          suggestions={sug?.partner || []}
          placeholder="Search or type the partner's name"
          onPick={(name, id) => setF((x) => ({ ...x, partnerName: name, partnerPartyId: id }))}
        />
        <PartyPicker
          id="ppl-new-hfk"
          label="3. HFK side (the ledger that holds HFK's half) · HFK کا کھاتہ *"
          parties={opts?.parties || []}
          name={f.hfkName}
          partyId={f.hfkPartyId}
          suggestions={sug?.hfk || []}
          placeholder="Search or type, e.g. Haji Mahboob (HFK)"
          onPick={(name, id) => setF((x) => ({ ...x, hfkName: name, hfkPartyId: id }))}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">4. Partner's share % · شریک کا حصہ</span>
          <input id="ppl-new-pct" inputMode="numeric" value={f.partnerPercent} onChange={set("partnerPercent")} className={inp} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">5. Joint pool already saved · بقایا مشترکہ جمع</span>
          <input id="ppl-new-pool" inputMode="numeric" value={f.openingPool} onChange={set("openingPool")} placeholder="leave empty if none" className={inp} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">As of · تاریخ</span>
          <input id="ppl-new-date" type="date" value={f.openingDate} onChange={set("openingDate")} className={inp} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">6. Partner's old debt · پرانا قرضہ</span>
          <input id="ppl-new-debt" inputMode="numeric" value={f.openingDebt} onChange={set("openingDebt")} placeholder="leave empty if none" className={inp} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">What the debt is for · قرضہ کس بات کا</span>
          <input id="ppl-new-debt-note" value={f.debtNote} onChange={set("debtNote")} dir="auto" className={inp} />
        </label>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button disabled={saving || missing.length > 0} onClick={save} className="bg-[#24539B] text-white font-semibold rounded-lg px-4 py-1.5 disabled:opacity-60">
          {saving ? "Saving…" : "Create · بنائیں"}
        </button>
        <button onClick={onCancel} className="text-[#4B5563] underline">Cancel</button>
        {missing.length > 0 && <span className="text-[#B91C1C]" dir="auto">Still needed: {missing.join(", ")} · یہ ابھی باقی ہے</span>}
      </div>
    </div>
  );
}
