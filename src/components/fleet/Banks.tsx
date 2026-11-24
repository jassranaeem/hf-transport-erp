/**
 * Banks · بینک — upload each bank's statement; every line is matched to its ledger entry
 * (automatically when it is clear, by hand otherwise) or explained (charges, transfer between our
 * banks, profit, tax, cash). The statement's balance is checked against the books.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Landmark, Upload, Loader2, CheckCircle2, AlertTriangle, Link2, Unlink, Trash2, Wand2, X, Pencil } from "lucide-react";
import { enterpriseFetch, uploadFile } from "../../../client/api.ts";

type Feedback = (type: "success" | "error", message: string) => void;
const PKR = (n: number | null | undefined) => (n == null ? "—" : (n < 0 ? "−" : "") + Math.abs(Math.round(n)).toLocaleString("en-US"));
const dmy = (d: any) => (d ? new Date(d).toISOString().slice(0, 10).split("-").reverse().join(".") : "—");

export default function Banks({ showFeedback }: { showFeedback: Feedback }) {
  const [data, setData] = useState<any>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [status, setStatus] = useState("unexplained");
  const [lines, setLines] = useState<any[] | null>(null);
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [cands, setCands] = useState<any[] | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpening, setEditOpening] = useState<{ id: number; value: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    enterpriseFetch("/api/bank/accounts")
      .then((r) => {
        setData(r);
        setSel((cur) => cur ?? r.accounts[0]?.id ?? null);
      })
      .catch((e) => showFeedback("error", e.message));
  }, [showFeedback]);
  useEffect(load, [load]);

  const loadLines = useCallback(() => {
    if (!sel) return;
    setLines(null);
    enterpriseFetch(`/api/bank/lines?bank=${sel}&status=${status}`).then(setLines).catch((e) => showFeedback("error", e.message));
  }, [sel, status, showFeedback]);
  useEffect(loadLines, [loadLines]);

  const refresh = () => {
    load();
    loadLines();
  };

  const pick = async (f: File | null) => {
    if (!f || !sel) return;
    setFile(f);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("bankAccountId", String(sel));
      setPreview(await uploadFile("/api/bank/statement/preview", fd));
    } catch (e: any) {
      showFeedback("error", e.message);
      setFile(null);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doImport = async () => {
    if (!file || !sel) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bankAccountId", String(sel));
      const r = await uploadFile("/api/bank/statement/import", fd);
      showFeedback("success", `${r.imported} lines imported (${r.duplicates} already there) — ${r.autoMatched} matched automatically, ${r.left} to look at · امپورٹ ہو گئی`);
      setPreview(null);
      setFile(null);
      setStatus("unexplained");
      refresh();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleLine = (id: number) => {
    if (openLine === id) {
      setOpenLine(null);
      return;
    }
    setOpenLine(id);
    setCands(null);
    enterpriseFetch(`/api/bank/lines/${id}/candidates?days=15`).then(setCands).catch(() => setCands([]));
  };
  const act = async (path: string, body: any, ok: string) => {
    try {
      await enterpriseFetch(path, { method: path.includes("/lines/") && !path.endsWith("/match") && !path.endsWith("/explain") && !path.endsWith("/unmatch") ? "DELETE" : "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
      showFeedback("success", ok);
      setOpenLine(null);
      refresh();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  const autoMatch = async () => {
    setBusy(true);
    try {
      const r = await enterpriseFetch("/api/bank/auto-match", { method: "POST", body: JSON.stringify({ bankAccountId: sel }) });
      showFeedback("success", `${r.matched} of ${r.checked} matched · خود ملا دیں`);
      refresh();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const saveOpening = async () => {
    if (!editOpening) return;
    try {
      await enterpriseFetch(`/api/bank/accounts/${editOpening.id}/opening`, { method: "PUT", body: JSON.stringify({ openingBalance: editOpening.value }) });
      showFeedback("success", "Opening balance saved · محفوظ");
      setEditOpening(null);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const bank = data?.accounts.find((a: any) => a.id === sel);
  const kinds: Record<string, string> = data?.kinds || {};

  return (
    <div className="p-3 space-y-4">
      <div>
        <h2 className="text-[19px] font-semibold text-[#111827] flex items-center gap-2 leading-tight">
          <Landmark className="w-5 h-5 text-[#24539B]" /> Banks <span className="text-[#9CA3AF] font-normal text-sm">· بینک</span>
        </h2>
        <p className="text-[12px] text-[#6B7280]" dir="auto">
          Upload each bank's statement (Excel or CSV from internet banking). Every line is matched to its entry in the ledgers, or you say what it is — then the books know every rupee in every bank. ·
          ہر بینک کی اسٹیٹمنٹ اپلوڈ کریں — ہر لائن اپنی انٹری سے ملے گی۔
        </p>
      </div>

      {!data ? (
        <div className="text-sm text-[#6B7280] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          {data.accounts.map((a: any) => {
            const diff = a.statement_balance != null ? a.statement_balance - a.books_balance : 0;
            return (
              <div key={a.id} role="button" tabIndex={0} onClick={() => setSel(a.id)} onKeyDown={(e) => e.key === "Enter" && setSel(a.id)}
                className={`rounded-xl border p-3 cursor-pointer text-xs space-y-1 ${sel === a.id ? "border-[#24539B] ring-2 ring-[#C9D7EC]" : "border-[#E5E7EB]"} ${diff !== 0 ? "bg-[#FEF2F2]" : "bg-white"}`}>
                <div className="font-bold text-sm">{a.bank_name}</div>
                <div className="text-[#6B7280] tabular-nums">{a.account_number} · books {a.gl_code}</div>
                <div>Statement: {a.lines ? `${dmy(a.first_date)} – ${dmy(a.last_date)} · ${a.lines} lines` : <span className="text-[#92400E]">none uploaded</span>}</div>
                {a.statement_balance != null && (
                  <div className={diff ? "text-[#991B1B] font-semibold" : "text-[#166534]"}>
                    Statement {PKR(a.statement_balance)} · books {PKR(a.books_balance)} {diff ? `— differs ${PKR(diff)}` : "✓"}
                  </div>
                )}
                {a.unexplained > 0 && <div className="text-[#92400E] font-semibold">{a.unexplained} line(s) to explain</div>}
              </div>
            );
          })}
        </div>
      )}

      {bank && (
        <div className="rounded-xl border border-[#E3E8EF] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <b className="text-sm">{bank.bank_name} {bank.account_number}</b>
            <span>
              Balance on {dmy(data.booksStart)} · ابتدائی بیلنس:{" "}
              {editOpening?.id === bank.id ? (
                <>
                  <input id="bank-opening" autoFocus inputMode="numeric" value={editOpening.value} onChange={(e) => setEditOpening({ id: bank.id, value: e.target.value.replace(/[^\d-]/g, "") })} className="border rounded px-2 py-0.5 w-32 tabular-nums" />
                  <button onClick={saveOpening} className="ml-1 text-[#24539B] font-semibold">Save</button>
                  <button onClick={() => setEditOpening(null)} className="ml-1 text-[#6B7280]">Cancel</button>
                </>
              ) : (
                <>
                  <b className="tabular-nums">{PKR(bank.opening_balance)}</b>
                  <button onClick={() => setEditOpening({ id: bank.id, value: String(bank.opening_balance) })} className="ml-1 text-[#6B7280]" title="Edit — take it from the statement of 30 June"><Pencil className="w-3 h-3 inline" /></button>
                </>
              )}
            </span>
            <span className="ml-auto flex gap-2">
              <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.xls,.pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0] || null)} />
              <button disabled={busy} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#24539B] text-white px-3 py-1.5 font-semibold disabled:opacity-60">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload statement · اسٹیٹمنٹ
              </button>
              <button disabled={busy} onClick={autoMatch} className="inline-flex items-center gap-1.5 rounded-lg border border-[#D1D5DB] px-3 py-1.5">
                <Wand2 className="w-3.5 h-3.5" /> Match automatically
              </button>
            </span>
          </div>

          <div className="flex gap-1 text-xs">
            {[["unexplained", "To explain · باقی"], ["matched", "Matched · ملی ہوئی"], ["explained", "Explained · وضاحت"], ["all", "All"]].map(([k, l]) => (
              <button key={k} onClick={() => setStatus(k)} className={`rounded-full px-3 py-1 ${status === k ? "bg-[#24539B] text-white" : "bg-[#F3F4F6] text-[#374151]"}`}>{l}</button>
            ))}
          </div>

          {!lines ? (
            <div className="text-xs text-[#6B7280] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
          ) : lines.length === 0 ? (
            <div className="text-xs text-[#6B7280]">{status === "unexplained" ? (bank.lines ? "Every line is matched or explained ✓ · سب ٹھیک" : "No statement uploaded for this bank yet.") : "Nothing here."}</div>
          ) : (
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto border border-[#F3F4F6] rounded-lg">
              <table className="w-full text-[12.5px]">
                <thead className="text-[#6B7280] bg-[#F9FAFB] sticky top-0">
                  <tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-2">Statement says</th><th className="text-right px-2">Out · نکلا</th><th className="text-right px-2">In · آیا</th><th className="text-right px-2">Balance</th><th className="text-left px-2">Is · ہے</th></tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <React.Fragment key={l.id}>
                      <tr onClick={() => toggleLine(l.id)} className={`border-t border-[#F3F4F6] cursor-pointer hover:bg-[#F9FAFB] ${!l.matched_key && !l.kind ? "bg-[#FFFBEB]" : ""}`}>
                        <td className="px-3 py-2 whitespace-nowrap">{dmy(l.txn_date)}</td>
                        <td className="px-2" dir="auto">{l.description || "—"}{l.ref ? <span className="text-[#9CA3AF]"> · {l.ref}</span> : null}</td>
                        <td className="px-2 text-right tabular-nums text-[#B91C1C]">{l.withdrawal ? PKR(l.withdrawal) : ""}</td>
                        <td className="px-2 text-right tabular-nums text-[#047857]">{l.deposit ? PKR(l.deposit) : ""}</td>
                        <td className="px-2 text-right tabular-nums text-[#6B7280]">{PKR(l.balance)}</td>
                        <td className="px-2" dir="auto">
                          {l.matched_key ? (
                            <span className="text-[#166534] flex items-center gap-1"><CheckCircle2 className="w-3 h-3 shrink-0" /> {l.what || l.matched_key}{l.match_kind === "auto" ? <span className="text-[#9CA3AF]"> (auto)</span> : null}</span>
                          ) : l.kind ? (
                            <span className="text-[#1E3A6E]">{kinds[l.kind] || l.kind}{l.note ? ` — ${l.note}` : ""}</span>
                          ) : (
                            <span className="text-[#92400E] flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> to explain</span>
                          )}
                        </td>
                      </tr>
                      {openLine === l.id && (
                        <tr className="bg-[#F9FAFB]">
                          <td colSpan={6} className="px-3 py-2 space-y-2">
                            {(l.matched_key || l.kind) && (
                              <button onClick={() => act(`/api/bank/lines/${l.id}/unmatch`, null, "Undone · واپس")} className="inline-flex items-center gap-1 text-[#B91C1C]"><Unlink className="w-3 h-3" /> Undo the match / explanation</button>
                            )}
                            {!l.matched_key && (
                              <div>
                                <div className="font-semibold text-[#374151] mb-1">It is this ledger entry · یہ انٹری ہے</div>
                                {!cands ? (
                                  <span className="text-[#6B7280]">Looking…</span>
                                ) : cands.length === 0 ? (
                                  <span className="text-[#6B7280]">No ledger entry with this amount within 15 days. If it is one, enter it in its ledger (with method Bank / Online) and it will show here.</span>
                                ) : (
                                  cands.map((c) => (
                                    <div key={c.key} className="flex items-center gap-2 py-0.5">
                                      <button onClick={() => act(`/api/bank/lines/${l.id}/match`, { key: c.key }, "Matched · مل گئی")} className="inline-flex items-center gap-1 text-[#24539B] font-semibold"><Link2 className="w-3 h-3" /> Match</button>
                                      <span className="whitespace-nowrap text-[#6B7280]">{dmy(c.d)}</span>
                                      <span dir="auto">{c.what}</span>
                                      <span className="text-[#6B7280]" dir="auto">{c.detail}</span>
                                      <span className="text-[#9CA3AF]">{c.method}</span>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                            {!l.matched_key && (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-[#374151]">…or it is · یا یہ ہے:</span>
                                {Object.entries(kinds).map(([k, label]) => (
                                  <button key={k} onClick={() => act(`/api/bank/lines/${l.id}/explain`, { kind: k }, "Saved · محفوظ")} className={`rounded-full border px-2 py-0.5 ${l.kind === k ? "border-[#24539B] text-[#24539B] font-semibold" : "border-[#D1D5DB]"}`}>{label.split(" · ")[0]}</button>
                                ))}
                              </div>
                            )}
                            <button onClick={() => window.confirm("Remove this line (imported by mistake)? · یہ لائن ہٹائیں؟") && act(`/api/bank/lines/${l.id}`, null, "Removed · حذف")} className="inline-flex items-center gap-1 text-[#6B7280] hover:text-[#B91C1C]"><Trash2 className="w-3 h-3" /> Remove line</button>
                            {l.batch && <span className="ml-3 text-[#9CA3AF]">from {l.source_file} ({l.batch})</span>}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3" onClick={() => setPreview(null)}>
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl p-4 space-y-3 text-xs max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <b className="text-sm flex-1">{preview.bank.bank_name} {preview.bank.account_number} — {preview.file}</b>
              <button onClick={() => setPreview(null)} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span>Dates · تاریخیں</span><b>{dmy(preview.from)} – {dmy(preview.to)}</b>
              <span>Lines in the file</span><b>{preview.total}</b>
              <span>New · نئی</span><b className="text-[#166534]">{preview.fresh}</b>
              <span>Already imported · پہلے سے</span><b>{preview.duplicates}</b>
              <span>Money out / in (new)</span><b>{PKR(preview.withdrawals)} / {PKR(preview.deposits)}</b>
              <span>Last balance on the statement</span><b>{PKR(preview.lastBalance)}</b>
              <span>Columns found</span><span>{Object.entries(preview.columns).map(([k, v]) => `${k}: “${v}”`).join(" · ")}</span>
            </div>
            {preview.balanceBreaks > 0 && <div className="text-[#991B1B]">The statement's own balance does not follow from line to line in {preview.balanceBreaks} place(s) — part of the statement may be missing or misread.</div>}
            {preview.warnings.map((w: string) => <div key={w} className="text-[#92400E]">{w}</div>)}
            <table className="w-full">
              <tbody>
                {preview.sample.map((r: any) => (
                  <tr key={r.line} className="border-t border-[#F3F4F6]"><td className="py-0.5 pr-2 whitespace-nowrap">{dmy(r.date)}</td><td className="pr-2" dir="auto">{r.description}</td><td className="text-right text-[#B91C1C]">{r.withdrawal ? PKR(r.withdrawal) : ""}</td><td className="text-right text-[#047857]">{r.deposit ? PKR(r.deposit) : ""}</td><td className="text-right text-[#6B7280]">{PKR(r.balance)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="flex gap-2">
              <button disabled={busy || !preview.fresh} onClick={doImport} className="inline-flex items-center gap-1.5 rounded-lg bg-[#24539B] text-white px-4 py-1.5 font-semibold disabled:opacity-50">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Import {preview.fresh} line(s) · امپورٹ
              </button>
              <button onClick={() => setPreview(null)} className="rounded-lg border px-3 py-1.5">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
