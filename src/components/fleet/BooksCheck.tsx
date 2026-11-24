/**
 * Books Check · حساب صحت — the system's own accountant's eye over the books.
 *
 * Every check asks the data a question each time this opens (GET /api/books-check). An item
 * stays red / amber until the data is corrected; "Open" goes straight to the entry; "This is
 * correct" takes a genuine case off the list (and can be put back); safe mistakes have a
 * one-click "Put right". Nothing here changes an entry by itself.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ShieldCheck, RefreshCw, Loader2, ChevronDown, ChevronRight, ExternalLink, CheckCircle2, AlertTriangle, AlertOctagon, Info, Wrench, Undo2 } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";

type Feedback = (type: "success" | "error", message: string) => void;
type Nav = (wb: string, sheet: string, focus?: { ledgerId?: number; partyId?: number; entryId?: number; date?: string }) => void;

const fmtDate = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "—");
const PKR = (n: number | null) => (n == null ? "" : (n < 0 ? "−" : "") + "PKR " + Math.abs(Math.round(n)).toLocaleString());

const TONE = {
  red: { card: "border-[#FCA5A5]", head: "bg-[#FEF2F2]", text: "text-[#991B1B]", badge: "bg-[#DC2626] text-white", Icon: AlertOctagon },
  amber: { card: "border-[#FCD34D]", head: "bg-[#FFFBEB]", text: "text-[#92400E]", badge: "bg-[#F59E0B] text-white", Icon: AlertTriangle },
  info: { card: "border-[#C9D7EC]", head: "bg-[#F2F5FA]", text: "text-[#1E3A6E]", badge: "bg-[#24539B] text-white", Icon: Info },
} as const;

export default function BooksCheck({ showFeedback, onNavigate }: { showFeedback: Feedback; onNavigate?: Nav }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<any[] | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    enterpriseFetch("/api/books-check")
      .then(setData)
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(load, [load]);

  const fix = async (c: any) => {
    if (!window.confirm(`${c.fixable}: ${c.title}\n\n${c.fix}\n\n${c.total} item(s). Continue? · جاری رکھیں؟`)) return;
    setBusy(c.code);
    try {
      const r = await enterpriseFetch(`/api/books-check/fix/${c.code}`, { method: "POST" });
      showFeedback("success", `${r.fixed} put right · ٹھیک ہو گئے`);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const markCorrect = async (c: any, it: any) => {
    const note = window.prompt(`Mark as correct — it leaves the list.\n${it.title} · ${it.detail}\n\nWhy is it correct? (optional) · کیوں درست ہے؟`, "");
    if (note === null) return;
    try {
      await enterpriseFetch("/api/books-check/dismiss", { method: "POST", body: JSON.stringify({ code: c.code, key: it.key, note }) });
      showFeedback("success", "Marked correct · درست مان لیا");
      load();
      if (dismissed) loadDismissed();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const loadDismissed = () =>
    enterpriseFetch("/api/books-check/dismissed")
      .then(setDismissed)
      .catch(() => setDismissed([]));

  const undoDismiss = async (d: any) => {
    try {
      await enterpriseFetch("/api/books-check/dismiss", { method: "DELETE", body: JSON.stringify({ code: d.code, key: d.item_key }) });
      showFeedback("success", "Back on the list · دوبارہ فہرست میں");
      loadDismissed();
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const checks: any[] = data?.checks || [];
  const titleOf = (code: string) => checks.find((c) => c.code === code)?.title || code;
  const order = { red: 0, amber: 1, info: 2 } as const;
  const sorted = [...checks].sort((a, b) => order[a.level as keyof typeof order] - order[b.level as keyof typeof order] || (b.total > 0 ? 1 : 0) - (a.total > 0 ? 1 : 0));
  const clean = checks.filter((c) => c.level !== "info" && c.total === 0);

  return (
    <div className="p-3 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-0 basis-64">
          <h2 className="text-[19px] font-semibold text-[#111827] flex items-center gap-2 leading-tight">
            <ShieldCheck className="w-5 h-5 text-[#24539B]" /> Books Check <span className="text-[#9CA3AF] font-normal text-sm">· حساب صحت</span>
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">
            The system checks every ledger, the cash book, bills and the accounts for mistakes by itself. A mistake stays red until it is corrected. ·
            سسٹم خود ہر کھاتے، کیش بک، بل اور حساب میں غلطیاں ڈھونڈتا ہے — جب تک ٹھیک نہ ہو، لال رہتی ہے۔
          </p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-xs border border-[#D1D5DB] rounded-lg px-3 py-1.5 hover:bg-[#F9FAFB]">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Check again · دوبارہ جانچیں
        </button>
      </div>

      {!data ? (
        <div className="text-sm text-[#6B7280] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking the books… · حساب جانچ رہے ہیں</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat tone="red" label="Mistakes to correct · ٹھیک کرنی ہیں" value={data.red} />
            <Stat tone="amber" label="Look at once · ایک بار دیکھیں" value={data.amber} />
            <div className="rounded-xl border border-[#A7F3D0] bg-[#F0FDF4] p-3">
              <div className="text-[11px] font-semibold text-[#166534]">Checks passing · ٹھیک</div>
              <div className="text-xl font-bold text-[#166534] tabular-nums">{clean.length} / {checks.filter((c) => c.level !== "info").length}</div>
              <div className="text-[10px] text-[#4B5563]">checked {new Date(data.checkedAt).toLocaleString("en-GB")}</div>
            </div>
          </div>

          <div className="space-y-2">
            {sorted.map((c) => {
              const t = TONE[c.level as keyof typeof TONE];
              const ok = c.total === 0 && c.level !== "info";
              const isOpen = !!open[c.code];
              return (
                <div key={c.code} className={`rounded-xl border bg-white overflow-hidden ${ok ? "border-[#E5E7EB]" : t.card}`}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpen({ ...open, [c.code]: !isOpen })}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen({ ...open, [c.code]: !isOpen }))}
                    className={`w-full cursor-pointer text-left px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 focus:outline-2 focus:outline-[#24539B] ${ok ? "bg-white" : t.head}`}
                  >
                    {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                    {ok ? <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" /> : <t.Icon className={`w-4 h-4 shrink-0 ${t.text}`} />}
                    <span className={`text-sm font-semibold ${ok ? "text-[#374151]" : t.text}`}>{c.title}</span>
                    <span className="text-xs text-[#6B7280]" dir="auto">· {c.urdu}</span>
                    <span className="text-[10px] text-[#9CA3AF] ml-1">{c.area}</span>
                    <span className="ml-auto">
                      {ok ? (
                        <span className="text-[11px] text-[#16A34A] font-semibold">All right · ٹھیک ✓</span>
                      ) : (
                        <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 tabular-nums ${t.badge}`}>{c.total.toLocaleString()}</span>
                      )}
                    </span>
                  </div>
                  {isOpen && (
                    <div className="px-3 py-2 space-y-2 border-t border-[#F3F4F6]">
                      <div className="text-[12px] text-[#374151]">
                        <b>Why it matters:</b> {c.why}
                        <br />
                        <b>What to do:</b> {c.fix}
                      </div>
                      {c.error && <div className="text-[11px] text-[#B91C1C]">Could not run this check: {c.error}</div>}
                      {c.fixable && c.total > 0 && (
                        <button disabled={busy === c.code} onClick={() => fix(c)} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg bg-[#24539B] text-white px-3 py-1.5 disabled:opacity-60">
                          {busy === c.code ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />} {c.fixable} ({c.total})
                        </button>
                      )}
                      {c.items.length > 0 && (
                        <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-[#F3F4F6] rounded-lg">
                          <table className="w-full text-[12.5px]">
                            <tbody>
                              {c.items.map((it: any) => (
                                <tr key={it.key} className="border-t border-[#F3F4F6] first:border-t-0">
                                  <td className="px-3 py-2 whitespace-nowrap text-[#6B7280]">{fmtDate(it.date)}</td>
                                  <td className="px-3 py-2 font-semibold whitespace-nowrap" dir="auto">{it.title}</td>
                                  <td className="px-3 py-2 text-[#4B5563]" dir="auto">{it.detail}</td>
                                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{PKR(it.amount)}</td>
                                  <td className="px-3 py-2 text-right whitespace-nowrap">
                                    {it.link && onNavigate && (
                                      <button onClick={() => onNavigate(it.link.wb, it.link.sheet, it.link.focus)} className="inline-flex items-center gap-1 text-[#24539B] hover:underline mr-3">
                                        Open <ExternalLink className="w-3 h-3" />
                                      </button>
                                    )}
                                    {c.level !== "info" && (
                                      <button onClick={() => markCorrect(c, it)} className="text-[#6B7280] hover:text-[#166534]" title="It looks wrong but it is right — take it off the list">
                                        This is correct · درست ہے
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {c.total > c.items.length && <div className="text-[11px] text-[#6B7280]">Showing {c.items.length} of {c.total.toLocaleString()} — correct these and the rest come up.</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-[#E3E8EF] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]">
            <button onClick={() => (dismissed ? setDismissed(null) : loadDismissed())} className="w-full text-left px-3 py-2 text-xs font-semibold flex items-center gap-1.5">
              {dismissed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Marked correct · درست مانی گئیں
            </button>
            {dismissed && (
              <div className="px-3 pb-3 text-xs">
                {dismissed.length === 0 ? (
                  <div className="text-[#6B7280]">Nothing marked correct yet.</div>
                ) : (
                  <table className="w-full">
                    <tbody>
                      {dismissed.map((d) => (
                        <tr key={d.id} className="border-t border-[#F3F4F6]">
                          <td className="py-1 pr-2 whitespace-nowrap text-[#6B7280]">{new Date(d.created_at).toLocaleDateString("en-GB")}</td>
                          <td className="py-1 pr-2">{titleOf(d.code)}</td>
                          <td className="py-1 pr-2 text-[#6B7280]">{d.item_key}</td>
                          <td className="py-1 pr-2" dir="auto">{d.note || ""}{d.by_name ? ` — ${d.by_name}` : ""}</td>
                          <td className="py-1 text-right">
                            <button onClick={() => undoDismiss(d)} className="inline-flex items-center gap-1 text-[#6B7280] hover:text-[#B91C1C]">
                              <Undo2 className="w-3 h-3" /> Put back
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ tone, label, value }: { tone: "red" | "amber"; label: string; value: number }) {
  const t = TONE[tone];
  return (
    <div className={`rounded-xl border p-3 ${value ? `${t.card} ${t.head}` : "border-[#A7F3D0] bg-[#F0FDF4]"}`}>
      <div className={`text-[11px] font-semibold ${value ? t.text : "text-[#166534]"}`}>{label}</div>
      <div className={`text-xl font-bold tabular-nums ${value ? t.text : "text-[#166534]"}`}>{value.toLocaleString()}</div>
    </div>
  );
}
