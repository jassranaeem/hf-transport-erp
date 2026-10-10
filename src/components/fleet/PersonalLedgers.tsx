/**
 * Personal & Household ledgers · ذاتی کھاتے — one ledger for every category, one for every person
 * (pocket money…), and the house pot. Nothing is typed twice: an expense entered in the register
 * (or right here, "Add entry") appears in its category's ledger and its person's, because every
 * ledger is read from the entries. Each entry can be viewed in full, edited, deleted, and carries
 * its description and attachments (receipts, photos).
 *
 *   /api/personal-expenses/ledgers   the list with opening / spent / funds in / closing
 *   /api/personal-expenses/ledger    one ledger with its running balance
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { enterpriseFetch, uploadFile } from "../../../client/api.ts";
import { Loader2, Printer, BookOpen, Wallet, Users, X, Plus, Eye, Paperclip, Pencil, Trash2, Settings2 } from "lucide-react";
import PersonalCategories from "./PersonalCategories.tsx";
import { EntryForm, EntryDetail, blankEntry, entryToForm, uploadEntryFiles } from "./PersonalEntryForm.tsx";

const PKR = (n: number) => (n < 0 ? "−" : "") + "PKR " + Math.abs(Math.round(n || 0)).toLocaleString("en-US");
const dmy = (d: string | null | undefined) => (d ? String(d).slice(0, 10).split("-").reverse().join(".") : "—");

type Sel = { kind: "category" | "person" | "pot"; name: string };
interface Row { name: string; opening: number; spent: number; funds: number; closing: number; count: number; last: string | null }

export default function PersonalLedgers({
  from,
  to,
  label,
  catUrdu,
  selected,
  onSelect,
  refreshKey,
  meta,
  onChanged,
  onRenamedLedger,
  showFeedback,
}: {
  from: string;
  to: string;
  label: string;
  catUrdu: Record<string, string>;
  selected: Sel | null;
  onSelect: (s: Sel | null) => void;
  refreshKey: number;
  meta: any;
  onChanged: () => void;
  onRenamedLedger: (from: string, to: string) => void;
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [managing, setManaging] = useState(false);
  const [list, setList] = useState<{ categories: Row[]; people: Row[]; pot: Row } | null>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [onlyUsed, setOnlyUsed] = useState(false);

  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<any>(blankEntry());
  const [addFiles, setAddFiles] = useState<File[]>([]);
  const [viewId, setViewId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p.toString();
  }, [from, to]);

  const loadList = useCallback(() => {
    setLoading(true);
    enterpriseFetch(`/api/personal-expenses/ledgers?${qs}`)
      .then(setList)
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [qs, showFeedback]);
  useEffect(loadList, [loadList, refreshKey]);

  const loadLedger = useCallback(() => {
    if (!selected) return setLedger(null);
    const p = new URLSearchParams(qs);
    p.set("kind", selected.kind);
    p.set("name", selected.name);
    enterpriseFetch(`/api/personal-expenses/ledger?${p}`)
      .then(setLedger)
      .catch((e) => showFeedback("error", e.message));
  }, [selected, qs, showFeedback]);
  useEffect(loadLedger, [loadLedger, refreshKey]);

  // another ledger: close whatever was open in the last one
  useEffect(() => {
    setAdding(false);
    setViewId(null);
    setEditId(null);
  }, [selected?.kind, selected?.name]);

  const refresh = () => {
    loadList();
    loadLedger();
    onChanged();
  };

  const startAdd = () => {
    // the entry starts in the ledger that is open: its category, or its person
    setAddForm({
      ...blankEntry(),
      category: selected?.kind === "category" ? selected.name : "Household",
      person: selected?.kind === "person" ? selected.name : "",
      direction: selected?.kind === "category" && selected.name === "Funds In" ? "income" : "expense",
    });
    setAddFiles([]);
    setAdding(true);
    setViewId(null);
    setEditId(null);
  };
  const saveAdd = async () => {
    if (!Number(addForm.amount)) return showFeedback("error", "Enter an amount · رقم درج کریں");
    if (!String(addForm.description || "").trim()) return showFeedback("error", "Write the description — what it was for · تفصیل لکھیں کہ کس لیے");
    setSaving(true);
    try {
      const row = await enterpriseFetch("/api/personal-expenses", { method: "POST", body: JSON.stringify(addForm) });
      const up = addFiles.length ? await uploadEntryFiles(row.id, addFiles, uploadFile) : 0;
      showFeedback(up < addFiles.length ? "error" : "success", `Saved in the "${addForm.category}" ledger${addFiles.length ? ` · ${up} of ${addFiles.length} file(s) attached` : ""} · محفوظ ہو گیا`);
      setAdding(false);
      setAddFiles([]);
      refresh();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };
  const saveEdit = async () => {
    if (!editId) return;
    if (!String(editForm.description || "").trim()) return showFeedback("error", "Write the description — what it was for · تفصیل لکھیں کہ کس لیے");
    setSaving(true);
    try {
      await enterpriseFetch(`/api/personal-expenses/${editId}`, { method: "PUT", body: JSON.stringify(editForm) });
      showFeedback("success", "Updated · درست ہو گیا");
      setEditId(null);
      refresh();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };
  const del = async (r: any) => {
    if (!window.confirm(`Delete this entry?\n${dmy(r.entryDate)} · ${r.category} · ${PKR(r.amount)} · ${r.description || ""}\n\nیہ اندراج حذف کریں؟`)) return;
    try {
      await enterpriseFetch(`/api/personal-expenses/${r.id}`, { method: "DELETE" });
      showFeedback("success", "Deleted · حذف ہو گیا");
      refresh();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const print = () => {
    if (!ledger) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const esc = (s: any) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
    const rows = ledger.rows
      .map((r: any) => `<tr><td>${dmy(r.entryDate)}</td><td>${esc(r.description)}</td><td>${esc(r.payee)}</td><td>${esc(r.person)}</td><td>${esc(r.method)}</td><td style="text-align:right">${r.direction === "expense" ? r.amount.toLocaleString("en-US") : ""}</td><td style="text-align:right">${r.direction === "income" ? r.amount.toLocaleString("en-US") : ""}</td><td style="text-align:right">${r.running.toLocaleString("en-US")}</td></tr>`)
      .join("");
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(ledger.name)}</title><body style="font-family:Arial,sans-serif;margin:24px"><h2>Personal ledger — ${esc(ledger.name)}</h2><p>${esc(label)} · ${esc(ledger.balanceLabel)}</p><table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%;font-size:12px"><tr><th>Date</th><th>Description</th><th>Payee</th><th>Person</th><th>Method</th><th>Spent</th><th>Funds in</th><th>Balance</th></tr><tr><td colspan="7"><b>Opening</b></td><td style="text-align:right"><b>${ledger.opening.toLocaleString("en-US")}</b></td></tr>${rows}<tr><td colspan="5"><b>Total</b></td><td style="text-align:right"><b>${ledger.spent.toLocaleString("en-US")}</b></td><td style="text-align:right"><b>${ledger.funds.toLocaleString("en-US")}</b></td><td style="text-align:right"><b>${ledger.closing.toLocaleString("en-US")}</b></td></tr></table></body>`);
    w.document.close();
    w.print();
  };

  const shown = (list?.categories || []).filter((c) => !onlyUsed || c.count > 0 || c.opening !== 0);
  const isSel = (kind: Sel["kind"], name: string) => selected?.kind === kind && selected.name === name;
  const item = (kind: Sel["kind"], r: Row, sub?: string) => (
    <div
      key={kind + r.name}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(isSel(kind, r.name) ? null : { kind, name: r.name })}
      onKeyDown={(e) => e.key === "Enter" && onSelect({ kind, name: r.name })}
      className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer border-t border-[#F3F4F6] hover:bg-[#F2F5FA] ${isSel(kind, r.name) ? "bg-[#E6ECF6]" : ""}`}
    >
      <div className="flex-1 min-w-0 text-xs" dir="auto">
        <div className="font-medium truncate">
          {r.name}
          {sub && <span className="text-[#9CA3AF] font-normal"> · {sub}</span>}
        </div>
        <div className="text-[10px] text-[#9CA3AF]">{r.count ? `${r.count} ${r.count === 1 ? "entry" : "entries"} · last ${dmy(r.last)}` : "no entries yet · ابھی کوئی اندراج نہیں"}</div>
      </div>
      <div className={`text-xs font-semibold tabular-nums ${r.closing < 0 && kind !== "pot" ? "text-[#1E4480]" : kind === "pot" ? (r.closing < 0 ? "text-[#B00005]" : "text-[#166534]") : "text-[#B00005]"}`}>{PKR(r.closing)}</div>
    </div>
  );

  const COLS = 9;
  return (
    <div className="space-y-4">
    {managing && (
      <PersonalCategories
        details={meta.categoryDetails || []}
        onChanged={() => { refresh(); window.dispatchEvent(new Event("pe-categories-changed")); }}
        onRenamed={onRenamedLedger}
        onClose={() => setManaging(false)}
        showFeedback={showFeedback}
      />
    )}
    <div className="grid lg:grid-cols-[320px_1fr] gap-4">
      <div className="space-y-3">
        <p className="text-[11px] text-[#4B5563] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-3 py-2" dir="auto">
          Every category in "Add expense" is its own ledger, and so is every person. Pick one to see its entries; add, view, edit or delete right there. · ہر مد کا اپنا کھاتہ ہے؛ چنیں، اور وہیں اندراج کریں، دیکھیں، درست کریں یا حذف کریں۔
        </p>
        <div className="rounded-xl border border-[#E3E8EF] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-hidden">
          <div className="px-3 py-2 text-[13px] font-semibold text-[#1F2937] bg-white border-b border-[#EEF1F5] flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> House pot · گھر کا پاٹ {loading && <Loader2 className="w-3 h-3 animate-spin" />}</div>
          {list && item("pot", list.pot, "funds in − spent")}
        </div>
        <div className="rounded-xl border border-[#E3E8EF] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-hidden">
          <div className="px-3 py-2 text-[13px] font-semibold text-[#1F2937] bg-white border-b border-[#EEF1F5] flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5" /> Categories · مدّیں
            <div className="flex-1" />
            <button onClick={() => setManaging((m) => !m)} className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded px-2 py-0.5 border ${managing ? "bg-[#24539B] text-white border-[#24539B]" : "bg-white text-[#24539B] border-[#C9D7EC] hover:bg-[#E6ECF6]"}`} title="Make a new ledger, rename, remove">
              <Settings2 className="w-3 h-3" /> New / edit
            </button>
            <label className="font-normal text-[10px] flex items-center gap-1">
              <input id="pl-used" type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} /> only with entries
            </label>
          </div>
          {shown.map((c) => item("category", c, catUrdu[c.name]))}
          {!shown.length && <div className="px-3 py-4 text-xs text-[#9CA3AF] text-center">No entries yet · ابھی کوئی اندراج نہیں</div>}
        </div>
        {!!list?.people.length && (
          <div className="rounded-xl border border-[#E3E8EF] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-hidden">
            <div className="px-3 py-2 text-[13px] font-semibold text-[#1F2937] bg-white border-b border-[#EEF1F5] flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> People · افراد (pocket money…)</div>
            {list.people.map((p) => item("person", p))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#E3E8EF] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-hidden min-w-0">
        {!selected && <div className="p-8 text-center text-sm text-[#9CA3AF]">Pick a ledger on the left · بائیں سے کھاتہ چنیں</div>}
        {selected && !ledger && <div className="p-6 flex items-center gap-2 text-sm text-[#4B5563]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}
        {selected && ledger && (
          <>
            <div className="px-3 py-2 bg-[#F2F5FA] flex flex-wrap items-center gap-2">
              <div className="text-sm font-bold" dir="auto">
                {ledger.name}
                {selected.kind === "category" && catUrdu[ledger.name] ? <span className="text-[#9CA3AF] font-normal"> · {catUrdu[ledger.name]}</span> : null}
              </div>
              <span className="text-[11px] text-[#6B7280]">{label}</span>
              <div className="flex-1" />
              <button onClick={startAdd} className="inline-flex items-center gap-1.5 text-xs rounded-lg px-3 py-1 bg-[#24539B] text-white font-semibold hover:bg-[#1E4480]">
                <Plus className="w-3.5 h-3.5" /> Add entry · نیا اندراج
              </button>
              <button onClick={print} className="inline-flex items-center gap-1.5 text-xs border border-[#D1D5DB] rounded-lg px-2.5 py-1 bg-white hover:bg-[#F9FAFB]"><Printer className="w-3.5 h-3.5" /> Print</button>
              <button onClick={() => onSelect(null)} aria-label="Close ledger" className="text-[#9CA3AF] hover:text-[#111827] p-1"><X className="w-4 h-4" /></button>
            </div>
            {adding && (
              <div className="p-3 border-b border-[#E5E7EB]">
                <EntryForm value={addForm} onChange={setAddForm} meta={meta} onSubmit={saveAdd} saving={saving} onCancel={() => setAdding(false)} submitLabel="Save · محفوظ کریں" files={addFiles} onFiles={setAddFiles} />
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 text-xs">
              {[["Opening · ابتدائی", ledger.opening], ["Spent · خرچ", ledger.spent], ["Funds in · رقم جمع", ledger.funds], [ledger.balanceLabel, ledger.closing]].map(([l, v]: any) => (
                <div key={l} className="border border-[#E5E7EB] rounded-lg p-2">
                  <div className="text-[10px] text-[#6B7280]" dir="auto">{l}</div>
                  <div className="font-semibold tabular-nums">{PKR(v)}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2 min-w-[160px]">Description · تفصیل</th>
                    <th className="text-left px-3 py-2">Payee</th>
                    <th className="text-left px-3 py-2">{selected.kind === "category" ? "Person" : "Category"}</th>
                    <th className="text-left px-3 py-2">Method</th>
                    <th className="text-right px-3 py-2">Spent</th>
                    <th className="text-right px-3 py-2">Funds in</th>
                    <th className="text-right px-3 py-2">Balance</th>
                    <th className="px-1 w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-[#F3F4F6] bg-[#FAFAFA] font-semibold">
                    <td className="px-3 py-2" colSpan={COLS - 1}>Opening balance · ابتدائی بیلنس</td>
                    <td className="px-3 py-2 text-right tabular-nums">{PKR(ledger.opening)}</td>
                  </tr>
                  {ledger.rows.map((r: any) => (
                    <React.Fragment key={r.id}>
                      <tr className="border-t border-[#F3F4F6]">
                        <td className="px-3 py-2 whitespace-nowrap text-[#6B7280]">{dmy(r.entryDate)}</td>
                        <td className="px-3 py-2 max-w-[260px]" dir="auto" title={r.description || ""}>
                          <div className="truncate">{r.description || <span className="text-[#B00005]">no description · تفصیل نہیں</span>}</div>
                        </td>
                        <td className="px-3 py-2" dir="auto">{r.payee || "—"}</td>
                        <td className="px-3 py-2" dir="auto">{(selected.kind === "category" ? r.person : r.category) || "—"}</td>
                        <td className="px-3 py-2">{r.method}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#B00005]">{r.direction === "expense" ? r.amount.toLocaleString("en-US") : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#1E4480]">{r.direction === "income" ? r.amount.toLocaleString("en-US") : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{PKR(r.running)}</td>
                        <td className="px-1 whitespace-nowrap">
                          <button onClick={() => { setViewId((v) => (v === r.id ? null : r.id)); setEditId(null); setAdding(false); }} title="View details & attachments · تفصیل اور فائلیں" className={`p-0.5 ${viewId === r.id ? "text-[#24539B]" : "text-slate-400 hover:text-[#24539B]"}`}><Eye className="w-3.5 h-3.5" /></button>
                          <button onClick={() => { setViewId((v) => (v === r.id ? null : r.id)); setEditId(null); setAdding(false); }} title="Attachments · فائلیں" className={`inline-flex items-center p-0.5 ${r.attachments ? "text-emerald-700" : "text-slate-300 hover:text-slate-600"}`}>
                            <Paperclip className="w-3.5 h-3.5" />{r.attachments ? <span className="text-[10px] font-bold">{r.attachments}</span> : null}
                          </button>
                          <button onClick={() => { setEditId(r.id); setEditForm(entryToForm(r)); setViewId(null); setAdding(false); }} title="Edit · درست کریں" className="text-slate-400 hover:text-emerald-700 p-0.5"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => del(r)} title="Delete · حذف کریں" className="text-slate-400 hover:text-red-600 p-0.5"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                      {viewId === r.id && (
                        <tr className="bg-[#F2F5FA]">
                          <td colSpan={COLS} className="px-3 py-3"><EntryDetail row={r} onChanged={refresh} /></td>
                        </tr>
                      )}
                      {editId === r.id && (
                        <tr className="bg-[#F2F5FA]">
                          <td colSpan={COLS} className="px-3 py-3">
                            <EntryForm value={editForm} onChange={setEditForm} meta={meta} onSubmit={saveEdit} saving={saving} onCancel={() => setEditId(null)} submitLabel="Save changes · تبدیلیاں محفوظ کریں" compact />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {!ledger.rows.length && <tr><td colSpan={COLS} className="px-2 py-6 text-center text-[#9CA3AF]">No entries in this period — press "Add entry" · اس مدت میں کوئی اندراج نہیں</td></tr>}
                </tbody>
                {!!ledger.rows.length && (
                  <tfoot className="border-t-2 border-[#E5E7EB] bg-[#F9FAFB] font-bold">
                    <tr>
                      <td className="px-3 py-2" colSpan={5}>Total · کل ({ledger.count})</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#B00005]">{ledger.spent.toLocaleString("en-US")}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[#1E4480]">{ledger.funds.toLocaleString("en-US")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{PKR(ledger.closing)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {ledger.truncated && <div className="px-3 py-2 text-[11px] text-[#92400E]">Showing the first 5,000 entries — narrow the dates. · پہلے 5,000 اندراجات</div>}
          </>
        )}
      </div>
    </div>
    </div>
  );
}
