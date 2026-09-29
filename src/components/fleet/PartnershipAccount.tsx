/**
 * Partnership Account · شراکت کا حساب — a co-owned truck kept exactly like the paper book:
 * the open cycle of the truck's khata, close it as صافی بچت (split into both partners'
 * ledgers) or carry a shortfall (قرضدار), record شخصی برداشت (written for both sides by
 * default), a partner's old قرضہ and its repayment. See server/partnership.ts.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Handshake, RefreshCw, Loader2, Plus, Undo2, Trash2, ExternalLink, Lock } from "lucide-react";

const PKR = (n: number) => (n < 0 ? "-" : "") + Math.abs(Math.round(n || 0)).toLocaleString();
const minus = (n: number) => (n ? "−" + PKR(n) : "0");
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "");

const EVENT_TYPES = [
  { kind: "shakhsi", label: "Money taken for home · شخصی برداشت" },
  { kind: "debt", label: "Old debt (qarz) · پرانا قرضہ" },
  { kind: "repayment", label: "Debt paid back · قرضہ واپسی" },
  { kind: "payout", label: "Share paid out in cash · حصہ ادا" },
];

/** What a side's position means in plain words. */
function position(net: number, name: string) {
  if (net > 0) return { text: `${PKR(net)} of ${name}'s money is in the joint pool · جمع ہے`, tone: "good" as const };
  if (net < 0) return { text: `${name} owes ${PKR(-net)} · قرضدار ہے`, tone: "bad" as const };
  return { text: "Clear · حساب برابر", tone: "plain" as const };
}

export default function PartnershipAccount({
  showFeedback,
  onOpenParty,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
  onOpenParty?: (id: number) => void;
}) {
  const [list, setList] = useState<any[] | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const fb = useRef(showFeedback);
  fb.current = showFeedback;

  const loadList = useCallback(() => {
    enterpriseFetch("/api/partnership")
      .then((d) => {
        setList(d);
        setSel((cur) => cur ?? d[0]?.id ?? null);
        if (!d.length) setShowNew(true);
      })
      .catch((e) => fb.current("error", e.message));
  }, []);
  useEffect(loadList, [loadList]);

  const loadDetail = useCallback(() => {
    if (!sel) return setDetail(null);
    enterpriseFetch(`/api/partnership/${sel}`).then(setDetail).catch((e) => fb.current("error", e.message));
  }, [sel]);
  useEffect(loadDetail, [loadDetail]);

  const refresh = () => {
    loadList();
    loadDetail();
  };

  const act = async (fn: () => Promise<any>, ok: (r: any) => string) => {
    setBusy(true);
    try {
      const r = await fn();
      showFeedback("success", ok(r));
      refresh();
      return r;
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };

  const d = detail;
  const cyc = d?.cycle;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <Handshake className="w-4 h-4" /> Partnership Account <span className="text-[#9CA3AF] font-normal text-sm">· شراکت کا حساب</span>
          </h2>
          <p className="text-[12px] text-[#6B7280] max-w-3xl" dir="auto">
            A truck shared with a partner, kept like the paper book: each cycle's صافی بچت is split into both partners' ledgers, money taken for
            home is written for both sides, and a partner's old debt is cut down by his share. · ہر حساب کی صافی بچت دونوں شریکوں کے کھاتے میں۔
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowNew((v) => !v)} className="flex items-center gap-1.5 text-xs border border-[#24539B] text-[#24539B] rounded-lg px-2.5 py-1.5 bg-white hover:bg-[#F2F5FA]">
            <Plus className="w-3.5 h-3.5" /> New partnership · نیا شراکتی حساب
          </button>
          <button onClick={refresh} className="flex items-center gap-1.5 text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white hover:bg-[#F2F5FA]">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {showNew && (
        <NewPartnership
          onCancel={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            setSel(id);
            loadList();
          }}
          showFeedback={showFeedback}
        />
      )}

      {/* all partnership trucks at a glance */}
      {list && list.length > 0 && (
        <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#F2F5FA] text-[#4B5563]">
              <tr>
                <th className="text-left px-3 py-2">Truck · ٹرک</th>
                <th className="text-left px-3 py-2">Partner · شریک</th>
                <th className="text-right px-3 py-2">Open cycle · موجودہ حساب</th>
                <th className="text-right px-3 py-2">Joint pool · مشترکہ جمع</th>
                <th className="text-right px-3 py-2">Partner position · شریک کی حالت</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} onClick={() => setSel(a.id)} className={`border-t border-[#F3F4F6] cursor-pointer ${sel === a.id ? "bg-[#EEF3FB]" : "hover:bg-[#F9FAFB]"}`}>
                  <td className="px-3 py-2 font-semibold">{a.truck}</td>
                  <td className="px-3 py-2" dir="auto">{a.partnerName} · {a.partnerPercent}%</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${a.cycleNet < 0 ? "text-[#B91C1C]" : ""}`}>{PKR(a.cycleNet)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{PKR(a.pool)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${a.partner.net < 0 ? "text-[#B91C1C] font-semibold" : "text-[#047857]"}`}>
                    {a.partner.net < 0 ? `owes ${PKR(-a.partner.net)} · قرضدار` : `${PKR(a.partner.net)} · جمع`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!d && sel && <div className="flex items-center gap-2 text-sm text-[#4B5563]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

      {d && (
        <>
          {/* the three positions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-[#24539B] bg-[#EEF3FB] p-3">
              <div className="text-[11px] text-[#4B5563]">Joint pool left · بقایا مشترکہ جمع</div>
              <div className="text-xl font-bold tabular-nums">{PKR(d.pool)}</div>
              <div className="text-[11px] text-[#6B7280]">{d.truck} · {d.account.partnerPercent}% / {100 - d.account.partnerPercent}%</div>
            </div>
            <Side title={`${d.partnerName} (partner ${d.account.partnerPercent}%)`} s={d.partner} onOpen={onOpenParty ? () => onOpenParty(d.account.partnerPartyId) : undefined} />
            <Side title={`${d.hfkName} (HFK ${100 - d.account.partnerPercent}%)`} s={d.hfk} onOpen={onOpenParty ? () => onOpenParty(d.account.hfkPartyId) : undefined} />
          </div>

          {/* open cycle */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
            <div className="px-3 py-2 bg-[#F2F5FA] flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs font-bold">
                Open cycle {cyc.cycleNo} · موجودہ حساب — {cyc.lines.length} khata rows since the last close
                <span className="font-normal text-[#6B7280]"> (from the {d.truckTitle} khata, in the order written)</span>
              </div>
              {d.account.cycleNo > 0 && (
                <button
                  disabled={busy}
                  onClick={() => window.confirm("Reopen the last closed cycle? Its صافی بچت entries are removed from both ledgers. · آخری بند حساب دوبارہ کھولیں؟") &&
                    act(() => enterpriseFetch(`/api/partnership/${d.account.id}/undo-close`, { method: "POST" }), () => "Last cycle reopened · حساب دوبارہ کھل گیا")}
                  className="flex items-center gap-1 text-[11px] text-[#4B5563] underline"
                >
                  <Undo2 className="w-3 h-3" /> Reopen last cycle
                </button>
              )}
            </div>
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-[#6B7280] sticky top-0 bg-white">
                  <tr>
                    <th className="text-left px-3 py-1.5">Date · تاریخ</th>
                    <th className="text-left px-3 py-1.5">Detail · تفصیل</th>
                    <th className="text-right px-3 py-1.5">In · وصول</th>
                    <th className="text-right px-3 py-1.5">Out · ادائیگی</th>
                    <th className="text-right px-3 py-1.5">Balance · بقایا</th>
                  </tr>
                </thead>
                <tbody>
                  {cyc.lines.map((r: any) => (
                    <tr key={r.id} className="border-t border-[#F3F4F6]">
                      <td className="px-3 py-1.5 whitespace-nowrap">{r.rawDate || fmtDate(r.entryDate)}</td>
                      <td className="px-3 py-1.5" dir="auto">{r.description}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#047857]">{r.received ? PKR(r.received) : ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#B91C1C]">{r.paid ? PKR(r.paid) : ""}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${r.balance < 0 ? "text-[#B91C1C]" : ""}`}>{PKR(r.balance)}</td>
                    </tr>
                  ))}
                  {!cyc.lines.length && (
                    <tr><td colSpan={5} className="px-3 py-3 text-center text-[#6B7280]">Nothing written in the khata since the last close · پچھلے حساب کے بعد کوئی انٹری نہیں</td></tr>
                  )}
                </tbody>
              </table>
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
                  onClick={() => window.confirm(`Close cycle ${cyc.cycleNo}: صافی بچت ${PKR(cyc.net)} → ${d.partnerName} ${PKR(cyc.partnerShare)}, ${d.hfkName} ${PKR(cyc.hfkShare)}?`) &&
                    act(() => enterpriseFetch(`/api/partnership/${d.account.id}/close`, { method: "POST", body: JSON.stringify({ date: today() }) }), (r) => `Cycle ${r.cycleNo} closed — ${PKR(r.partnerShare)} to ${d.partnerName}, ${PKR(r.hfkShare)} to ${d.hfkName}`)}
                  className="bg-[#24539B] text-white font-semibold rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-60"
                >
                  <Lock className="w-3.5 h-3.5" /> Close cycle · صافی بچت: {PKR(cyc.partnerShare)} + {PKR(cyc.hfkShare)}
                </button>
              )}
              {cyc.lines.length > 0 && cyc.net < 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[#4B5563]" dir="auto">Short — carries into the next trip (paper method) · اگلے حساب میں شامل ہو گا</span>
                  <button
                    disabled={busy}
                    onClick={() => window.confirm(`Split the loss ${PKR(-cyc.net)} now (${d.account.partnerPercent}/${100 - d.account.partnerPercent}) instead of carrying it? · نقصان ابھی تقسیم کریں؟`) &&
                      act(() => enterpriseFetch(`/api/partnership/${d.account.id}/close`, { method: "POST", body: JSON.stringify({ date: today(), splitLoss: true }) }), () => "Loss split into both ledgers · نقصان تقسیم ہو گیا")}
                    className="border border-[#B91C1C] text-[#B91C1C] rounded-lg px-2.5 py-1 disabled:opacity-60"
                  >
                    Split the loss now · نقصان ابھی تقسیم کریں
                  </button>
                </div>
              )}
            </div>
          </div>

          <AddEntry d={d} busy={busy} act={act} />

          {/* history */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
            <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA]">History · تاریخچہ <span className="font-normal text-[#6B7280]">(these lines are in the two party ledgers)</span></div>
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
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.history.map((h: any) => (
                    <tr key={h.id} className="border-t border-[#F3F4F6]">
                      <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(h.entryDate)}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap" dir="auto">{h.side === "partner" ? d.partnerName : d.hfkName}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap" dir="auto">{h.label}</td>
                      <td className="px-3 py-1.5" dir="auto">{h.description}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#047857]">{h.credit ? PKR(h.credit) : ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#B91C1C]">{h.debit ? PKR(h.debit) : ""}</td>
                      <td className="px-2 py-1.5 text-right">
                        {h.kind !== "safi" && h.kind !== "loss" && (
                          <button
                            title="Remove this entry"
                            disabled={busy}
                            onClick={() => window.confirm("Remove this entry from the party ledger? · یہ انٹری ہٹائیں؟") &&
                              act(() => enterpriseFetch(`/api/partnership/${d.account.id}/event/${h.id}`, { method: "DELETE" }), () => "Entry removed · انٹری ہٹ گئی")}
                            className="text-[#9CA3AF] hover:text-[#B91C1C]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!d.history.length && (
                    <tr><td colSpan={7} className="px-3 py-3 text-center text-[#6B7280]">No entries yet · ابھی کوئی انٹری نہیں</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Side({ title, s, onOpen }: { title: string; s: any; onOpen?: () => void }) {
  const p = position(s.net, title.split(" (")[0]);
  const tone = p.tone === "bad" ? "border-[#FCA5A5] bg-[#FEF2F2]" : p.tone === "good" ? "border-[#A7F3D0] bg-[#F0FDF4]" : "border-[#E5E7EB] bg-white";
  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-[#374151]" dir="auto">{title}</div>
        {onOpen && (
          <button onClick={onOpen} className="text-[11px] text-[#24539B] flex items-center gap-1 whitespace-nowrap">
            ledger <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className={`text-sm font-bold mt-1 ${p.tone === "bad" ? "text-[#B91C1C]" : p.tone === "good" ? "text-[#047857]" : ""}`} dir="auto">{p.text}</div>
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
      () =>
        enterpriseFetch(`/api/partnership/${d.account.id}/event`, {
          method: "POST",
          body: JSON.stringify({ kind, who: whoNow, amount, date, method, note, matchOther }),
        }),
      (r) => r.warning || "Saved in the party ledger · کھاتے میں درج ہو گیا",
    );
    if (r) {
      setAmount("");
      setNote("");
    }
  };

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-3 space-y-2">
      <div className="text-xs font-bold">Add an entry · نئی انٹری</div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-[#6B7280]">Type · قسم</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="border border-[#E5E7EB] rounded px-2 py-1.5">
            {EVENT_TYPES.map((t) => <option key={t.kind} value={t.kind}>{t.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">Whose · کس کا</span>
          <select value={whoNow} disabled={partnerOnly} onChange={(e) => setWho(e.target.value as any)} className="border border-[#E5E7EB] rounded px-2 py-1.5">
            <option value="partner">{d.partnerName}</option>
            <option value="hfk">{d.hfkName}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">Amount · رقم *</span>
          <input id="pship-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className="border border-[#E5E7EB] rounded px-2 py-1.5 tabular-nums" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">Date · تاریخ</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-[#E5E7EB] rounded px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">How · طریقہ</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="border border-[#E5E7EB] rounded px-2 py-1.5">
            <option>Cash</option>
            <option>Online</option>
            <option>Cheque</option>
            <option>Adjustment</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 md:col-span-4">
          <span className="text-[#6B7280]">Note · تفصیل</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} dir="auto" className="border border-[#E5E7EB] rounded px-2 py-1.5" />
        </label>
        <div className="md:col-span-2 flex items-end">
          <button disabled={busy || !amount} onClick={submit} className="w-full bg-[#24539B] text-white font-semibold rounded-lg px-3 py-1.5 disabled:opacity-60">
            {busy ? "Saving…" : "Save · محفوظ کریں"}
          </button>
        </div>
      </div>
      {kind === "shakhsi" && (
        <label className="flex items-center gap-2 text-[11px] text-[#374151]" dir="auto">
          <input type="checkbox" checked={matchOther} onChange={(e) => setMatchOther(e.target.checked)} />
          Write the same amount for {whoNow === "partner" ? d.hfkName : d.partnerName} too, so the 50/50 stays level (paper method) · برابر رقم دوسرے شریک کے نام بھی
        </label>
      )}
      {whoNow === "partner" && (kind === "shakhsi" || kind === "payout") && partnerOwes && (
        <div className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[11px] text-[#B91C1C]" dir="auto">
          {d.partnerName} already owes {PKR(-d.partner.net)}. Whatever he takes now is added to his debt. · یہ پہلے سے قرضدار ہے — جو رقم لے گا وہ قرضے میں جمع ہو گی۔
        </div>
      )}
      <div className="text-[11px] text-[#6B7280]" dir="auto">
        Record this here only, not again in the Daily Cash Book's “Also add to party” — otherwise it is counted twice. · یہ انٹری صرف یہاں کریں، کیش بک میں دوبارہ پارٹی سے نہ جوڑیں۔
      </div>
    </div>
  );
}

function NewPartnership({ onCancel, onCreated, showFeedback }: { onCancel: () => void; onCreated: (id: number) => void; showFeedback: (t: "success" | "error", m: string) => void }) {
  const [opts, setOpts] = useState<{ ledgers: any[]; parties: any[] } | null>(null);
  const [f, setF] = useState({ truckLedgerId: "", partnerName: "", hfkName: "", partnerPercent: "50", openingPool: "", openingDate: today(), openingDebt: "", debtNote: "" });
  const [truckQ, setTruckQ] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    enterpriseFetch("/api/partnership/options").then(setOpts).catch((e) => showFeedback("error", e.message));
  }, []);
  const set = (k: string) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  const trucks = useMemo(() => {
    const q = truckQ.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return (opts?.ledgers || []).filter((l) => !q || `${l.registration}${l.title}`.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(q));
  }, [opts, truckQ]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await enterpriseFetch("/api/partnership", { method: "POST", body: JSON.stringify({ ...f, truckLedgerId: Number(f.truckLedgerId) }) });
      showFeedback("success", "Partnership account created · شراکتی حساب بن گیا");
      onCreated(r.id);
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
        <label className="flex flex-col gap-1">
          <span className="text-[#6B7280]">Truck khata · ٹرک کا کھاتہ *</span>
          <input id="pship-truck-q" value={truckQ} onChange={(e) => setTruckQ(e.target.value)} placeholder="Type the truck number… (TLE 730)" className={inp} />
          <select value={f.truckLedgerId} onChange={set("truckLedgerId")} size={5} className={inp}>
            {trucks.slice(0, 200).map((l) => (
              <option key={l.id} value={l.id}>{l.title} · {l.entries} rows</option>
            ))}
          </select>
          <span className="text-[#6B7280]" dir="auto">The open cycle starts after this khata's last صافی بچت / “حساب نیل” line.</span>
        </label>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[#6B7280]">Partner's name · شریک کا نام *</span>
            <input id="pship-partner" list="pship-parties" value={f.partnerName} onChange={set("partnerName")} placeholder="Qudrat Ullah" dir="auto" className={inp} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[#6B7280]">HFK side (whose ledger holds HFK's half) · HFK کا کھاتہ *</span>
            <input id="pship-hfk" list="pship-parties" value={f.hfkName} onChange={set("hfkName")} placeholder="Haji Mahboob (HFK)" dir="auto" className={inp} />
          </label>
          <datalist id="pship-parties">{(opts?.parties || []).map((p) => <option key={p.id} value={p.name} />)}</datalist>
          <label className="flex flex-col gap-1">
            <span className="text-[#6B7280]">Partner's share % · شریک کا حصہ</span>
            <input id="pship-pct" inputMode="numeric" value={f.partnerPercent} onChange={set("partnerPercent")} className={inp} />
          </label>
        </div>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[#6B7280]">Joint pool already saved (optional) · بقایا مشترکہ جمع</span>
            <input id="pship-pool" inputMode="numeric" value={f.openingPool} onChange={set("openingPool")} placeholder="2029168" className={inp} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[#6B7280]">As of · تاریخ</span>
            <input type="date" value={f.openingDate} onChange={set("openingDate")} className={inp} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[#6B7280]">Partner's old debt (optional) · پرانا قرضہ</span>
            <input id="pship-debt" inputMode="numeric" value={f.openingDebt} onChange={set("openingDebt")} placeholder="5000000" className={inp} />
            <input id="pship-debt-note" value={f.debtNote} onChange={set("debtNote")} placeholder="what the debt is for · قرضہ کس بات کا" dir="auto" className={inp} />
          </label>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={saving || !f.truckLedgerId || !f.partnerName.trim() || !f.hfkName.trim()} onClick={save} className="bg-[#24539B] text-white font-semibold rounded-lg px-4 py-1.5 disabled:opacity-60">
          {saving ? "Saving…" : "Create · بنائیں"}
        </button>
        <button onClick={onCancel} className="text-[#4B5563] underline">Cancel</button>
      </div>
    </div>
  );
}
