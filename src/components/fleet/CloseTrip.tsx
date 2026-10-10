/**
 * Close trip · ٹرپ کا حساب (Fleet Desk) — option C for one journey:
 * each customer's freight red until received, green once paid; money comes in through the Daily
 * Cash Book (tie it to the customer here) or "Mark received"; when every customer is green the
 * result is split 50/50 into the partner's and HFK's ledgers (closes the Partner P&L cycle).
 * Server: server/trip_close.ts + /api/trip-desk/:id/close…
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { X, Loader2, CheckCircle, Handshake, ExternalLink, Pencil, Trash2, Undo2 } from "lucide-react";

const PKR = (n: number) => (n < 0 ? "-" : "") + Math.abs(Math.round(n || 0)).toLocaleString("en-IN");
const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "");
const today = () => new Date().toISOString().slice(0, 10);
function amountWords(raw: string): string {
  const n = Math.round(Number(String(raw || "").replace(/[^0-9.]/g, "")) || 0);
  if (!n) return "";
  const w = n >= 10000000 ? `${+(n / 10000000).toFixed(2)} crore` : n >= 100000 ? `${+(n / 100000).toFixed(2)} lakh` : n >= 1000 ? `${+(n / 1000).toFixed(1)} thousand` : "";
  return `= ${n.toLocaleString("en-IN")}${w ? ` · ${w}` : ""}`;
}

const STATE_STYLE: Record<string, string> = {
  paid: "bg-[#DCFCE7] text-[#166534] border-[#86EFAC]",
  partial: "bg-[#FEF3C7] text-[#92400E] border-[#FCD34D]",
  pending: "bg-[#FEE2E2] text-[#991B1B] border-[#FCA5A5]",
};
const STATE_LABEL: Record<string, string> = {
  paid: "Paid · وصول",
  partial: "Part paid · کچھ وصول",
  pending: "Pending · باقی",
};

export default function CloseTrip({
  tripId,
  onClose,
  onChanged,
  showFeedback,
}: {
  tripId: number;
  onClose: () => void;
  onChanged: () => void;
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [recv, setRecv] = useState<{ stopId: number; amount: string; date: string; method: string } | null>(null);
  const [editRc, setEditRc] = useState<{ entryId: number; amount: string; date: string } | null>(null);

  const load = useCallback(() => {
    enterpriseFetch(`/api/trip-desk/${tripId}/close`).then(setD).catch((e) => showFeedback("error", e.message));
  }, [tripId]);
  useEffect(load, [load]);

  const act = async (path: string, body: any, ok: (r: any) => string) => {
    setBusy(true);
    try {
      const r = await enterpriseFetch(`/api/trip-desk/${tripId}/close${path}`, { method: "POST", body: JSON.stringify(body || {}) });
      showFeedback("success", ok(r));
      load();
      onChanged();
      return r;
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };

  const t = d?.totals;
  const p = d?.partnership;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[92vh] overflow-auto rounded-xl bg-white shadow-xl p-4 space-y-4 text-xs" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-bold">Close trip · ٹرپ کا حساب {d ? `— ${d.vehicleNumber}` : ""}</div>
            {d && <div className="text-[#4B5563]" dir="auto">{d.route}</div>}
          </div>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#111827]"><X className="w-5 h-5" /></button>
        </div>

        {!d && <div className="flex items-center gap-2 text-sm text-[#4B5563]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

        {d && (
          <>
            {/* 1. the trip itself */}
            <div className="flex items-center justify-between gap-2 flex-wrap rounded-lg border border-[#E5E7EB] px-3 py-2">
              <span dir="auto">
                {d.allCompleted ? (
                  <b className="text-[#166534]">Trip completed — customers' bills are made · بل بن گئے</b>
                ) : (
                  <>Step 1: mark the trip completed — this makes each customer's bill (Finance → Invoices) · ٹرپ مکمل کریں</>
                )}
              </span>
              {!d.allCompleted && (
                <button
                  disabled={busy}
                  onClick={() =>
                    window.confirm("Mark every stop Completed and make the customers' bills? · ٹرپ مکمل کر کے بل بنائیں؟") &&
                    act("/complete", {}, () => "Trip completed — bills made · ٹرپ مکمل")
                  }
                  className="bg-[#24539B] text-white font-semibold rounded-lg px-3 py-1.5 disabled:opacity-60"
                >
                  Complete trip · ٹرپ مکمل
                </button>
              )}
              {d.allCompleted && !d.splitAt && (
                <button
                  disabled={busy}
                  onClick={() =>
                    window.confirm(
                      "Reopen this trip? The customers' bills are removed (and their payments from this screen); received money stays tied to the customers. · ٹرپ دوبارہ کھولیں؟ بل ہٹ جائیں گے",
                    ) && act("/reopen", {}, () => "Trip reopened — bills removed · ٹرپ دوبارہ کھل گئی")
                  }
                  className="flex items-center gap-1 border border-[#E5E7EB] rounded-lg px-2.5 py-1 text-[#4B5563] hover:bg-[#F9FAFB]"
                >
                  <Undo2 className="w-3.5 h-3.5" /> Reopen trip · دوبارہ کھولیں
                </button>
              )}
            </div>

            {/* 2. each customer: red until received, green when paid */}
            <div className="rounded-lg border border-[#E5E7EB] overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#F2F5FA] text-[#4B5563]">
                  <tr>
                    <th className="text-left px-2 py-2">Customer · کسٹمر</th>
                    <th className="text-left px-2">Route</th>
                    <th className="text-right px-2">Freight · کرایہ</th>
                    <th className="text-right px-2">Received · وصول</th>
                    <th className="text-right px-2">Still to come · باقی</th>
                    <th className="text-left px-2">State</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.stops.map((s: any) => (
                    <React.Fragment key={s.id}>
                      <tr className="border-t border-[#F3F4F6] align-top">
                        <td className="px-2 py-2 font-semibold" dir="auto">{s.customer || "—"}</td>
                        <td className="px-2 py-2" dir="auto">{s.from} → {s.to}{s.cargo ? <div className="text-[10px] text-[#6B7280]">{s.cargo}</div> : null}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{PKR(s.freight)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-[#166534]">
                          {PKR(s.received)}
                          {s.writtenOff > 0 && <div className="text-[10px] text-[#6B7280]">written off {PKR(s.writtenOff)}</div>}
                        </td>
                        <td className={`px-2 py-2 text-right tabular-nums font-semibold ${s.pending > 0 ? "text-[#B91C1C]" : "text-[#166534]"}`}>{PKR(s.pending)}</td>
                        <td className="px-2 py-2">
                          <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${STATE_STYLE[s.state]}`}>{STATE_LABEL[s.state]}</span>
                          {s.invoice && <div className="text-[10px] text-[#6B7280] mt-0.5">bill {s.invoice.number} · {s.invoice.status}</div>}
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          {s.pending > 0 && !d.splitAt && (
                            <div className="inline-flex gap-1">
                              <button onClick={() => setRecv({ stopId: s.id, amount: String(s.pending), date: today(), method: "Online" })} className="border border-[#166534] text-[#166534] rounded px-2 py-1 hover:bg-[#F0FDF4]">
                                Mark received · وصول
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  window.confirm(`${s.customer} will not pay the remaining ${PKR(s.pending)}? Write it off so the trip can close. · باقی رقم معاف کریں؟`) &&
                                  act("/writeoff", { stopId: s.id, amount: "rest" }, () => "Written off · معاف")
                                }
                                className="border border-[#E5E7EB] text-[#6B7280] rounded px-2 py-1 hover:bg-[#F9FAFB]"
                              >
                                Write off · معاف
                              </button>
                            </div>
                          )}
                          {s.writtenOff > 0 && !d.splitAt && (
                            <button disabled={busy} onClick={() => act("/writeoff", { stopId: s.id, amount: 0 }, () => "Write-off undone")} className="ml-1 text-[10px] underline text-[#6B7280]">
                              undo write-off
                            </button>
                          )}
                        </td>
                      </tr>
                      {recv?.stopId === s.id && (
                        <tr className="bg-[#F0FDF4]">
                          <td colSpan={7} className="px-2 py-2">
                            <div className="flex items-end gap-2 flex-wrap">
                              <label className="flex flex-col gap-1">
                                <span className="text-[#4B5563]">Amount · رقم</span>
                                <input id="ct-amount" inputMode="numeric" value={recv.amount} onChange={(e) => setRecv({ ...recv, amount: e.target.value })} className="border border-[#E5E7EB] rounded px-2 py-1.5 w-36 tabular-nums" />
                                <span className="text-[10px] text-[#24539B]">{amountWords(recv.amount)}</span>
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-[#4B5563]">Date · تاریخ</span>
                                <input id="ct-date" type="date" value={recv.date} onChange={(e) => setRecv({ ...recv, date: e.target.value })} className="border border-[#E5E7EB] rounded px-2 py-1.5" />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-[#4B5563]">How · طریقہ</span>
                                <select id="ct-method" value={recv.method} onChange={(e) => setRecv({ ...recv, method: e.target.value })} className="border border-[#E5E7EB] rounded px-2 py-1.5">
                                  <option>Online</option>
                                  <option>Cash</option>
                                  <option>Cheque</option>
                                </select>
                              </label>
                              <button
                                disabled={busy}
                                onClick={async () => {
                                  const r = await act("/receive", recv, () => "Received — added to the Daily Cash Book and the truck's khata · وصول درج");
                                  if (r) setRecv(null);
                                }}
                                className="bg-[#166534] text-white font-semibold rounded-lg px-3 py-1.5 disabled:opacity-60"
                              >
                                Save · محفوظ
                              </button>
                              <button onClick={() => setRecv(null)} className="underline text-[#4B5563]">Cancel</button>
                              <span className="text-[10px] text-[#6B7280]" dir="auto">
                                Goes into the Daily Cash Book (In, linked to the truck) and the truck's khata — don't enter it there again · کیش بک میں دوبارہ نہ لکھیں
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                      {s.receipts.length > 0 && (
                        <tr>
                          <td colSpan={7} className="px-2 pb-2 text-[10px] text-[#166534]" dir="auto">
                            {s.receipts.map((r: any) =>
                              editRc?.entryId === r.id ? (
                                <span key={r.id} className="mr-3 inline-flex items-center gap-1 flex-wrap text-[#111827]">
                                  <input id={`ct-rc-amt-${r.id}`} inputMode="numeric" value={editRc.amount} onChange={(e) => setEditRc({ ...editRc, amount: e.target.value })} className="border border-[#E5E7EB] rounded px-1.5 py-0.5 w-28 tabular-nums" />
                                  <input id={`ct-rc-date-${r.id}`} type="date" value={editRc.date} onChange={(e) => setEditRc({ ...editRc, date: e.target.value })} className="border border-[#E5E7EB] rounded px-1.5 py-0.5" />
                                  <span className="text-[#24539B]">{amountWords(editRc.amount)}</span>
                                  <button
                                    disabled={busy}
                                    onClick={async () => {
                                      const x = await act("/receipt/edit", editRc, () => "Receipt corrected — Cash Book and khata updated · درست ہو گیا");
                                      if (x) setEditRc(null);
                                    }}
                                    className="bg-[#166534] text-white rounded px-2 py-0.5"
                                  >
                                    Save
                                  </button>
                                  <button onClick={() => setEditRc(null)} className="underline text-[#6B7280]">Cancel</button>
                                </span>
                              ) : (
                                <span key={r.id} className="mr-3 inline-flex items-center gap-1.5">
                                  ✓ {fmtDate(r.date)} {PKR(r.amount)} — {String(r.description || "").slice(0, 60)}
                                  {!d.splitAt && (
                                    <>
                                      <button
                                        title="Edit amount / date · ترمیم"
                                        onClick={() => setEditRc({ entryId: r.id, amount: String(r.amount), date: r.date ? new Date(r.date).toISOString().slice(0, 10) : today() })}
                                        className="text-[#6B7280] hover:text-[#24539B]"
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </button>
                                      <button
                                        title="Delete this receipt · حذف"
                                        disabled={busy}
                                        onClick={() =>
                                          window.confirm(
                                            `Delete this receipt of ${PKR(r.amount)}? It is removed from the truck's khata AND the Daily Cash Book. (To keep it but take it off this customer, use "untie".) · یہ وصولی حذف کریں؟`,
                                          ) && act("/receipt/delete", { entryId: r.id }, () => "Receipt deleted · حذف ہو گیا")
                                        }
                                        className="text-[#6B7280] hover:text-[#B91C1C]"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                      <button disabled={busy} onClick={() => act("/assign", { entryId: r.id, stopId: null }, () => "Untied from this customer — it's back in the list below")} className="underline text-[#6B7280]">
                                        untie
                                      </button>
                                    </>
                                  )}
                                </span>
                              ),
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* money already in the khata (Daily Cash Book "Kirya jama") — whose is it? */}
            {d.unassigned.length > 0 && !d.splitAt && (
              <div className="rounded-lg border border-[#FCD34D] bg-[#FFFBEB] p-3 space-y-2">
                <div className="font-semibold" dir="auto">
                  Money received into {d.vehicleNumber}'s khata since this trip began — which customer's is it? · یہ کس کسٹمر کا کرایہ ہے؟
                </div>
                {d.unassigned.map((u: any) => {
                  const guess = d.stops.find((s: any) => s.pending === u.received);
                  return (
                    <div key={u.id} className="flex items-center gap-2 flex-wrap">
                      <span className="tabular-nums font-semibold">{PKR(u.received)}</span>
                      <span className="text-[#4B5563]">{u.rawDate || fmtDate(u.entryDate)}</span>
                      <span className="flex-1 min-w-[200px]" dir="auto">{u.description}</span>
                      <select
                        id={`ct-assign-${u.id}`}
                        defaultValue={guess ? String(guess.id) : ""}
                        onChange={(e) => e.target.value && act("/assign", { entryId: u.id, stopId: Number(e.target.value) }, () => "Tied to the customer — turns green when fully paid · وصول درج")}
                        className="border border-[#E5E7EB] rounded px-2 py-1 bg-white"
                      >
                        <option value="">Pick the customer…</option>
                        {d.stops.map((s: any) => (
                          <option key={s.id} value={s.id}>
                            {s.customer} ({s.from} → {s.to}) · baqi {PKR(s.pending)}
                          </option>
                        ))}
                      </select>
                      {guess && (
                        <button disabled={busy} onClick={() => act("/assign", { entryId: u.id, stopId: guess.id }, () => "Tied to the customer · وصول درج")} className="border border-[#166534] text-[#166534] rounded px-2 py-1 bg-white">
                          Yes, {guess.customer}'s · ہاں
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 3. the result */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Card label="Freight · کل کرایہ" value={PKR(t.freight)} />
              <Card label="Received · وصول" value={PKR(t.received)} tone="good" />
              <Card label="Still to come · باقی" value={PKR(t.pending)} tone={t.pending > 0 ? "bad" : "good"} />
              <Card label="Spent on the trip · خرچہ" value={PKR(t.expenses)} />
              <Card label="Profit so far (received − spent) · اب تک" value={PKR(t.profitSoFar)} tone={t.profitSoFar >= 0 ? "good" : "bad"} />
              <Card label="Profit when all comes in · مکمل" value={PKR(t.expectedProfit)} tone={t.pending > 0 ? "warn" : t.expectedProfit >= 0 ? "good" : "bad"} />
            </div>

            {/* 4. 50/50 for a partnership truck */}
            {p ? (
              <div className="rounded-lg border border-[#24539B] bg-[#EEF3FB] p-3 space-y-2">
                <div className="font-bold flex items-center gap-1.5"><Handshake className="w-4 h-4" /> Split 50/50 · تقسیم — {p.partnerName} {p.partnerPercent}% / {p.hfkName} {100 - p.partnerPercent}%</div>
                {d.splitAt ? (
                  <div className="text-[#166534] font-semibold" dir="auto">
                    <CheckCircle className="w-4 h-4 inline" /> Split on {fmtDate(d.splitAt)}: result {PKR(d.splitAmount)} — {p.partnerName} {PKR(Math.round((d.splitAmount * p.partnerPercent) / 100))}, {p.hfkName}{" "}
                    {PKR(d.splitAmount - Math.round((d.splitAmount * p.partnerPercent) / 100))} · تقسیم ہو گیا
                    <button
                      disabled={busy}
                      onClick={() =>
                        window.confirm(`Take this split back? Both shares leave ${p.partnerName}'s and ${p.hfkName}'s ledgers, and the trip can be corrected and split again. · تقسیم واپس لیں؟`) &&
                        act("/unsplit", {}, () => "Split taken back — shares removed from both ledgers · تقسیم واپس")
                      }
                      className="ml-3 inline-flex items-center gap-1 font-normal border border-[#E5E7EB] bg-white rounded-lg px-2 py-0.5 text-[#4B5563] hover:bg-[#F9FAFB]"
                    >
                      <Undo2 className="w-3 h-3" /> Take split back · تقسیم واپس
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="tabular-nums" dir="auto">
                      The truck's khata since the last split: in {PKR(p.received)} − out {PKR(p.paid)} = <b>{PKR(p.net)}</b> → {p.partnerName} <b>{PKR(p.partnerShare)}</b>, {p.hfkName} <b>{PKR(p.hfkShare)}</b>
                      {t.pending > 0 && <span className="text-[#B91C1C]"> — provisional: {PKR(t.pending)} still to come · عارضی</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        disabled={busy || !d.allPaid}
                        onClick={() =>
                          window.confirm(`Split ${PKR(p.net)} now — ${p.partnerName} ${PKR(p.partnerShare)}, ${p.hfkName} ${PKR(p.hfkShare)}, into their ledgers? · تقسیم کریں؟`) &&
                          act("/split", {}, (r) => `Split — ${r.split.partnerName} ${PKR(r.split.partnerShare)}, ${r.split.hfkName} ${PKR(r.split.hfkShare)} · تقسیم ہو گیا`)
                        }
                        className="bg-[#24539B] text-white font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50"
                      >
                        Split 50/50 · تقسیم کریں
                      </button>
                      {!d.allPaid && (
                        <span className="text-[#B91C1C]" dir="auto">
                          Opens when every customer is paid (green) — still to come: {d.stops.filter((s: any) => s.pending > 0).map((s: any) => `${s.customer} ${PKR(s.pending)}`).join(", ")}
                        </span>
                      )}
                    </div>
                  </>
                )}
                <a href="?wb=finance&sheet=partner_pnl" className="inline-flex items-center gap-1 text-[#24539B] underline">
                  Open Partner P&amp;L (both ledgers) <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ) : (
              <div className="text-[#6B7280]" dir="auto">This truck has no partnership — the whole result is HFK's; nothing to split. · یہ ٹرک شراکتی نہیں</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "warn" }) {
  const c = tone === "good" ? "text-[#166534]" : tone === "bad" ? "text-[#B91C1C]" : tone === "warn" ? "text-[#92400E]" : "";
  return (
    <div className="rounded-lg border border-[#E5E7EB] p-2">
      <div className="text-[10px] text-[#6B7280]" dir="auto">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${c}`}>{value}</div>
    </div>
  );
}
