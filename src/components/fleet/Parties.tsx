import React, { useCallback, useEffect, useRef, useState } from "react";
import { enterpriseFetch, uploadFile, uploadAttachment } from "../../../client/api.ts";
import AttachmentPanel from "../common/AttachmentPanel.tsx";
import ModuleDataIO from "../common/ModuleDataIO.tsx";
import DuesAlerts from "./DuesAlerts.tsx";
import {
  Users, Search, AlertTriangle, Plus, Loader2, ChevronDown, ChevronRight,
  FileSpreadsheet, Upload, CheckCircle, Save, Building2, Paperclip, Pencil, Trash2,
} from "lucide-react";

const TYPES = ["Customer", "Supplier", "Lender", "Borrower", "Transporter", "Agent", "Broker", "Bank", "Other"];
const STATUSES = ["Active", "Inactive", "Blocked"];
const METHODS = ["Cash", "Online", "Cheque", "Bank Transfer", "Adjustment", "Other"];
const ENTRY_CATS = ["Freight", "Payment", "Advance", "Adjustment", "Expense", "Commission", "Partnership", "Other"];
// bank-routed money must carry a receipt / proof
const BANK_METHODS = ["Online", "Cheque", "Bank Transfer", "Bank", "IBFT", "RTGS", "Wire"];
const fmt = (n: number) => "PKR " + Math.abs(Math.round(n || 0)).toLocaleString();
const balLabel = (b: number) =>
  b > 0 ? `Receivable · لینا: ${fmt(b)}` : b < 0 ? `Payable · دینا: ${fmt(b)}` : "Clear · صاف";

interface Party {
  id: number; partyCode: string; name: string; type: string; phone: string | null;
  address: string | null; city: string | null; ntn: string | null; strn: string | null;
  bankName: string | null; bankAccountTitle: string | null; bankAccountNo: string | null; iban: string | null;
  openingBalance: number; closingBalance: number; notes: string | null; status: string;
  entryCount?: number; totalDebit?: number; totalCredit?: number; needsReviewCount?: number;
}
interface Entry {
  id: number; srNo: number | null; entryDate: string | null; rawDate: string | null;
  description: string | null; refNo: string | null; method: string | null;
  debit: number; credit: number; runningBalance: number; category: string;
  sectionLabel: string | null; needsReview: boolean; reviewReason: string | null;
  attachmentCount?: number;
}

export default function Parties({
  showFeedback,
  focusPartyId,
}: {
  showFeedback: (type: "success" | "error", message: string) => void;
  focusPartyId?: number;
}) {
  const [rows, setRows] = useState<Party[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 60;

  const [selId, setSelId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ party: Party; entries: Entry[]; totals: any } | null>(null);
  const [loading, setLoading] = useState(false);
  const [editParty, setEditParty] = useState<any>(null);
  // Quick entry (debit/credit) is now shown immediately once a party is
  // picked, not behind an extra "Add entry" click — search → select → type
  // the amount → save, in one screen. The full historical ledger is the
  // opposite: collapsed by default (showLedger), one click to open — most
  // of the time you're here to log today's naam/jama, not review history.
  const [showLedger, setShowLedger] = useState(false);
  const [entryForm, setEntryForm] = useState<any>({ entryDate: "", description: "", refNo: "", method: "Cash", debit: "", credit: "", category: "Other" });
  const [entryFile, setEntryFile] = useState<File | null>(null);
  const [entryBusy, setEntryBusy] = useState(false);
  const [dupWarn, setDupWarn] = useState<string | null>(null);
  const entryFileRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newParty, setNewParty] = useState<any>(null);

  const [showImport, setShowImport] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(() => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (q.trim()) p.set("search", q.trim());
    if (typeFilter) p.set("type", typeFilter);
    enterpriseFetch(`/api/parties?${p}`)
      .then((r) => { setRows(r.parties || []); setTotal(r.total || 0); })
      .catch((e) => showFeedback("error", e.message));
  }, [q, typeFilter, offset, showFeedback]);
  useEffect(loadList, [loadList]);

  const loadDetail = useCallback((id: number) => {
    setLoading(true);
    enterpriseFetch(`/api/parties/${id}`)
      .then((d) => { setDetail(d); setEditParty(d.party); })
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(() => {
    if (selId != null) {
      loadDetail(selId);
      setShowLedger(false); // each newly-picked party starts on quick-entry, not the full ledger
    }
  }, [selId, loadDetail]);

  // deep-link: open a specific party's khata (from an alert / dues link)
  useEffect(() => {
    if (focusPartyId) { setSelId(focusPartyId); setExpanded(null); }
  }, [focusPartyId]);

  const saveParty = async () => {
    if (!editParty) return;
    try {
      await enterpriseFetch(`/api/parties/${editParty.id}`, { method: "PUT", body: JSON.stringify(editParty) });
      showFeedback("success", "Party saved");
      loadDetail(editParty.id);
      loadList();
    } catch (e: any) { showFeedback("error", e.message); }
  };

  const createParty = async () => {
    try {
      const r = await enterpriseFetch("/api/parties", { method: "POST", body: JSON.stringify(newParty) });
      showFeedback("success", `Party ${r.partyCode} created`);
      setNewParty(null);
      loadList();
      setSelId(r.id);
    } catch (e: any) { showFeedback("error", e.message); }
  };

  const addEntry = async () => {
    if (!selId) return;
    const debit = Number(entryForm.debit) || 0;
    const credit = Number(entryForm.credit) || 0;
    if (!debit && !credit) { showFeedback("error", "Enter an amount in Debit (Naam) or Credit (Jama) · نام یا جمع میں رقم درج کریں۔"); return; }
    // bank-routed money must have a receipt / proof attached
    if (BANK_METHODS.includes(entryForm.method) && !entryFile) {
      showFeedback("error", `A receipt / proof is required for a ${entryForm.method} entry · اس ادائیگی کے لیے رسید لازمی ہے۔`);
      return;
    }
    setEntryBusy(true);
    setDupWarn(null);
    try {
      const created = await enterpriseFetch(`/api/parties/${selId}/entries`, {
        method: "POST",
        body: JSON.stringify({ ...entryForm, debit, credit }),
      });
      if (created?.duplicateWarning) {
        setDupWarn(created.duplicateWarning);
        showFeedback("error", "⚠ Possible DUPLICATE — same amount, date & ref already recorded");
      }
      if (entryFile && created?.id) {
        try {
          const up: any = await uploadAttachment("party_ledger_entry", created.id, entryFile, "Entry receipt");
          if (up?.duplicate && (up.duplicateOf || []).some((d: any) => d.id !== up.id)) {
            const w = `⚠ Yehi receipt file pehle bhi lagi hai (${(up.duplicateOf || []).filter((d: any) => d.id !== up.id).map((d: any) => `${d.entityType} #${d.entityId}`).join(", ")}) — double slip?`;
            setDupWarn((prev) => (prev ? prev + "\n" + w : w));
            showFeedback("error", "⚠ DUPLICATE receipt file");
          }
        } catch (ue: any) {
          showFeedback("error", `Entry saved, but the receipt upload failed: ${ue.message}`);
        }
      }
      if (!created?.duplicateWarning) {
        showFeedback("success", entryFile ? "Entry + receipt saved" : "Entry added");
        setEntryForm({ entryDate: "", description: "", refNo: "", method: "Cash", debit: "", credit: "", category: "Other" });
        setEntryFile(null);
        if (entryFileRef.current) entryFileRef.current.value = "";
      }
      loadDetail(selId);
      loadList();
    } catch (e: any) { showFeedback("error", e.message); }
    finally { setEntryBusy(false); }
  };

  // ---- edit / delete an existing khata entry ------------------------
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const startEdit = (e: Entry) => {
    setEditId(e.id);
    setExpanded(e.id);
    setEditForm({
      entryDate: e.entryDate ? e.entryDate.slice(0, 10) : "",
      description: e.description || "",
      refNo: e.refNo || "",
      method: e.method || "Cash",
      category: e.category || "Other",
      debit: e.debit || "",
      credit: e.credit || "",
      needsReview: e.needsReview,
    });
  };
  const saveEdit = async () => {
    if (!editId || !selId) return;
    setSavingEdit(true);
    try {
      await enterpriseFetch(`/api/parties/entries/${editId}`, {
        method: "PUT",
        body: JSON.stringify({
          ...editForm,
          debit: Number(editForm.debit) || 0,
          credit: Number(editForm.credit) || 0,
        }),
      });
      showFeedback("success", "Entry updated · اندراج درست ہو گیا");
      setEditId(null);
      loadDetail(selId);
      loadList();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSavingEdit(false);
    }
  };
  const deleteEntry = async (id: number) => {
    if (!selId) return;
    if (!window.confirm("Delete this entry? The running balance will be recalculated. · یہ اندراج حذف کریں؟")) return;
    try {
      await enterpriseFetch(`/api/parties/entries/${id}`, { method: "DELETE" });
      showFeedback("success", "Entry deleted · اندراج حذف ہو گیا");
      setEditId(null);
      setExpanded(null);
      loadDetail(selId);
      loadList();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const doImport = async (file: File) => {
    setImportBusy(true); setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await uploadFile("/api/parties/import-workbook", fd);
      setImportResult(r);
      showFeedback("success", r.message);
      loadList();
    } catch (e: any) {
      showFeedback("error", e.message);
      setImportResult({ error: e.message });
    } finally {
      setImportBusy(false);
      if (importRef.current) importRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      {/* import from Excel */}
      <div className="border border-slate-200 rounded-xl bg-white">
        <button onClick={() => setShowImport((s) => !s)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700">
          <span className="flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Import Parties from Excel</span>
          {showImport ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {showImport && (
          <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-3">
            <p className="text-[12px] text-slate-500">
              Upload your parties khata workbook (one sheet per party, same layout as the truck khatas). The system
              reads every sheet, builds the running naam/jama balance and flags anything to review. Re-uploading is
              non-destructive — it updates, it never wipes.
            </p>
            <button onClick={() => importRef.current?.click()} disabled={importBusy} className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg px-4 py-2 flex items-center gap-2 disabled:opacity-50">
              {importBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}{importBusy ? "Importing…" : "Choose .xlsx file"}
            </button>
            <input ref={importRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
            {importResult && !importResult.error && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-[12px]">
                <div className="flex items-center gap-2 font-semibold text-emerald-800"><CheckCircle className="w-4 h-4" /> {importResult.message}</div>
                {Array.isArray(importResult.failedSheets) && importResult.failedSheets.length > 0 && (
                  <div className="mt-2 text-[11px] text-amber-800 bg-amber-100 rounded p-2">
                    {importResult.failedSheets.length} sheet(s) failed — rest imported:
                    <ul className="list-disc pl-4">{importResult.failedSheets.slice(0, 6).map((f: any, i: number) => <li key={i}>{f.sheet}: {f.error}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
            {importResult?.error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{importResult.error}</div>}
          </div>
        )}
      </div>

      {/* dues & alerts — kisko dena / kis se lena / kisko NAHI dena */}
      <DuesAlerts compact showFeedback={showFeedback} onOpenParty={(id) => { setSelId(id); setExpanded(null); }} />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button onClick={() => setNewParty({ name: "", type: "Customer", openingBalance: 0, status: "Active" })} className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg px-3 py-1.5 flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> New party
        </button>
        <ModuleDataIO entityKey="parties" label="Parties" onImported={loadList} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {/* list */}
        <div className="border border-slate-200 rounded-xl bg-white overflow-hidden md:sticky md:top-4">
          <div className="p-3 border-b border-slate-100 flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Search name / phone / NTN / city…" className="text-sm w-full outline-none" />
          </div>
          <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap gap-1">
            <button onClick={() => { setTypeFilter(""); setOffset(0); }} className={`text-[11px] rounded-full px-2 py-0.5 ${typeFilter === "" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}>all</button>
            {TYPES.map((t) => (
              <button key={t} onClick={() => { setTypeFilter(typeFilter === t ? "" : t); setOffset(0); }} className={`text-[11px] rounded-full px-2 py-0.5 ${typeFilter === t ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}>{t}</button>
            ))}
          </div>
          <div className="max-h-[45vh] md:max-h-[65vh] overflow-y-auto">
            {rows.map((p) => (
              <button key={p.id} onClick={() => { setSelId(p.id); setExpanded(null); }} className={`w-full text-left px-3 py-2.5 border-b border-slate-50 hover:bg-slate-50 ${selId === p.id ? "bg-emerald-50" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-800 truncate">{p.name}</span>
                  <span className={`text-xs font-semibold ${p.closingBalance > 0 ? "text-emerald-700" : p.closingBalance < 0 ? "text-red-600" : "text-slate-400"}`}>{fmt(p.closingBalance)}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                  <span className="rounded-full bg-slate-100 px-1.5">{p.type}</span>
                  <span>{p.partyCode}</span>
                  <span>{p.entryCount || 0} entries</span>
                  {(p.needsReviewCount || 0) > 0 && (
                    <span
                      onClick={(ev) => { ev.stopPropagation(); setSelId(p.id); setExpanded(null); }}
                      title={`${p.needsReviewCount} row(s) need checking · دیکھنے کے لیے کلک کریں`}
                      className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 font-semibold cursor-pointer hover:bg-amber-200"
                    >
                      <AlertTriangle className="w-3 h-3" />{p.needsReviewCount} to review
                    </span>
                  )}
                </div>
              </button>
            ))}
            {rows.length === 0 && <p className="text-[12px] text-slate-400 p-3">No parties. Add one or import your Excel.</p>}
          </div>
          {total > LIMIT && (
            <div className="flex items-center justify-between px-3 py-2 text-[11px] text-slate-500 border-t border-slate-100">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} className="disabled:opacity-40">‹ prev</button>
              <span>{offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()}</span>
              <button disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)} className="disabled:opacity-40">next ›</button>
            </div>
          )}
        </div>

        {/* detail */}
        <div className="md:col-span-2 border border-slate-200 rounded-xl bg-white">
          {!detail ? (
            <div className="p-10 text-center text-sm text-slate-400 flex flex-col items-center gap-2"><Users className="w-8 h-8" /> Pick a party to open its khata</div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{detail.party.name}</h3>
                  <p className="text-xs text-slate-500">{detail.party.partyCode} · {detail.party.type}</p>
                  <p className={`text-sm font-semibold mt-1 ${detail.party.closingBalance > 0 ? "text-emerald-700" : detail.party.closingBalance < 0 ? "text-red-600" : "text-slate-500"}`}>
                    {balLabel(detail.party.closingBalance)}
                  </p>
                </div>
                <button onClick={() => setShowLedger((s) => !s)} className="text-xs font-semibold border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                  {showLedger ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  {showLedger ? "Hide full ledger" : `View full ledger (${detail.totals.entries ?? detail.entries.length})`}
                </button>
              </div>

              {/* party master form */}
              {editParty && (
                <details className="rounded-lg border border-slate-200">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Party details (phone, address, NTN, bank…)</summary>
                  <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                    {([
                      ["name", "Name"], ["phone", "Phone"], ["city", "City"],
                      ["ntn", "NTN"], ["strn", "STRN"], ["address", "Address"],
                      ["bankName", "Bank name"], ["bankAccountTitle", "Account title"], ["bankAccountNo", "Account no"],
                      ["iban", "IBAN"], ["notes", "Notes"],
                    ] as [string, string][]).map(([k, lbl]) => (
                      <label key={k} className="flex flex-col">
                        <span className="text-slate-400">{lbl}</span>
                        <input dir="auto" value={editParty[k] || ""} onChange={(e) => setEditParty({ ...editParty, [k]: e.target.value })} className="border rounded px-2 py-1" />
                      </label>
                    ))}
                    <label className="flex flex-col">
                      <span className="text-slate-400">Type</span>
                      <select value={editParty.type} onChange={(e) => setEditParty({ ...editParty, type: e.target.value })} className="border rounded px-2 py-1">
                        {TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col">
                      <span className="text-slate-400">Status</span>
                      <select value={editParty.status || "Active"} onChange={(e) => setEditParty({ ...editParty, status: e.target.value })} className="border rounded px-2 py-1">
                        {STATUSES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                      {editParty.status === "Blocked" && <span className="text-[10px] text-red-600 mt-0.5">Do-not-pay: alerts board pe "kisko NAHI dena" mein aaye gi.</span>}
                    </label>
                    <label className="flex flex-col">
                      <span className="text-slate-400">Opening balance (+lena / −dena)</span>
                      <input type="number" value={editParty.openingBalance} onChange={(e) => setEditParty({ ...editParty, openingBalance: e.target.value })} className="border rounded px-2 py-1" />
                    </label>
                    <label className="flex items-center gap-2 col-span-2 md:col-span-3 mt-1">
                      <input type="checkbox" checked={!!editParty.smsAlerts} onChange={(e) => setEditParty({ ...editParty, smsAlerts: e.target.checked })} />
                      <span dir="auto">SMS alerts — text this party on every credit/debit entry (once an SMS gateway is set up) · ہر اندراج پر اس پارٹی کو SMS بھیجیں</span>
                    </label>
                    <div className="col-span-2 md:col-span-3">
                      <button onClick={saveParty} className="bg-slate-800 text-white rounded px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"><Save className="w-3.5 h-3.5" /> Save details</button>
                    </div>
                  </div>
                </details>
              )}

              <div className="grid grid-cols-3 gap-3">
                <Stat label="Total naam (debit)" value={fmt(detail.totals.totalDebit)} tone="bad" />
                <Stat label="Total jama (credit)" value={fmt(detail.totals.totalCredit)} tone="good" />
                <Stat label="Balance" value={fmt(detail.party.closingBalance)} tone={detail.party.closingBalance >= 0 ? "good" : "bad"} />
              </div>

              {dupWarn && (
                <div className="rounded-lg border border-red-300 bg-red-600 text-white px-3 py-2 text-[12px] flex items-start gap-2 whitespace-pre-line" dir="auto">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#fff", stroke: "#fff" }} />
                  <span className="flex-1"><b>DUPLICATE — </b>{dupWarn}</span>
                  <button onClick={() => setDupWarn(null)} className="shrink-0 font-bold">✕</button>
                </div>
              )}

              {/* Quick entry — always here the moment a party is selected,
                  no extra "Add entry" click. Search → select → type the
                  amount → Save entry, all on this one screen. */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 space-y-2">
                <div className="text-xs font-bold text-emerald-800 flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Naya credit / debit · New entry</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  <input type="date" value={entryForm.entryDate} onChange={(e) => setEntryForm({ ...entryForm, entryDate: e.target.value })} className="border rounded px-2 py-1" />
                  <input dir="auto" placeholder="Ref (bilty/cheque)" value={entryForm.refNo} onChange={(e) => setEntryForm({ ...entryForm, refNo: e.target.value })} className="border rounded px-2 py-1" />
                  <select value={entryForm.method} onChange={(e) => setEntryForm({ ...entryForm, method: e.target.value })} className="border rounded px-2 py-1">
                    {METHODS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <input dir="auto" placeholder="Description · تفصیل" value={entryForm.description} onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })} className="border rounded px-2 py-1 col-span-2 md:col-span-3" />
                  <input dir="auto" placeholder="Debit / Naam (نام)" value={entryForm.debit} onChange={(e) => setEntryForm({ ...entryForm, debit: e.target.value })} className="border rounded px-2 py-1" />
                  <input dir="auto" placeholder="Credit / Jama (جمع)" value={entryForm.credit} onChange={(e) => setEntryForm({ ...entryForm, credit: e.target.value })} className="border rounded px-2 py-1" />
                  <div className="col-span-2 md:col-span-3 flex flex-wrap items-center gap-2 border-t border-emerald-200 pt-2">
                    <button
                      type="button"
                      onClick={() => entryFileRef.current?.click()}
                      className={`rounded px-2.5 py-1 font-semibold flex items-center gap-1.5 border ${
                        BANK_METHODS.includes(entryForm.method) && !entryFile
                          ? "border-red-400 text-red-700 bg-red-50"
                          : "border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      {entryFile ? "Change receipt" : "Attach receipt / proof"}
                      {BANK_METHODS.includes(entryForm.method) && <span className="text-red-600">*</span>}
                    </button>
                    <input
                      ref={entryFileRef}
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(e) => setEntryFile(e.target.files?.[0] || null)}
                    />
                    {entryFile && <span className="text-[11px] text-slate-600 truncate max-w-[220px]">📎 {entryFile.name}</span>}
                    {BANK_METHODS.includes(entryForm.method) && (
                      <span className="text-[10px] text-red-600" dir="auto">
                        Receipt required for {entryForm.method} · رسید لازمی
                      </span>
                    )}
                    <button
                      onClick={addEntry}
                      disabled={entryBusy}
                      className="ml-auto bg-emerald-600 text-white rounded px-3 py-1 font-semibold disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {entryBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Save entry
                    </button>
                  </div>
                </div>
              </div>

              {showLedger && (loading ? (
                <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> loading…</div>
              ) : (
                <div className="overflow-x-auto border border-slate-100 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left px-2 py-1.5">Date</th>
                        <th className="text-left px-2 py-1.5">Description</th>
                        <th className="text-right px-2 py-1.5">Naam</th>
                        <th className="text-right px-2 py-1.5">Jama</th>
                        <th className="text-right px-2 py-1.5">Balance</th>
                        <th className="px-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.entries.map((e) => (
                        <React.Fragment key={e.id}>
                          <tr className={`border-t border-slate-50 ${e.needsReview ? "bg-amber-50/50" : ""}`}>
                            <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{e.entryDate ? e.entryDate.slice(0, 10) : <span className="text-amber-600">{e.rawDate || "—"}</span>}</td>
                            <td className="px-2 py-1.5 max-w-[260px]">
                              <div className="truncate" dir="auto" title={e.description || ""}>{e.description || "—"}{e.refNo ? ` · ${e.refNo}` : ""}</div>
                              {e.needsReview && (
                                <div className="text-[10px] text-red-600 flex items-start gap-1 mt-0.5">
                                  <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                                  <span>{e.reviewReason || "Row flagged as doubtful during import · امپورٹ کے دوران مشکوک سطر"}</span>
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right text-red-600">{e.debit ? e.debit.toLocaleString() : ""}</td>
                            <td className="px-2 py-1.5 text-right text-emerald-700">{e.credit ? e.credit.toLocaleString() : ""}</td>
                            <td className={`px-2 py-1.5 text-right font-medium ${e.runningBalance < 0 ? "text-red-600" : "text-slate-700"}`}>{e.runningBalance.toLocaleString()}</td>
                            <td className="px-1 whitespace-nowrap">
                              <button onClick={() => startEdit(e)} title="Edit this entry · اندراج درست کریں" className="text-slate-400 hover:text-emerald-700 p-0.5">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => deleteEntry(e.id)} title="Delete this entry · اندراج حذف کریں" className="text-slate-400 hover:text-red-600 p-0.5">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => { setEditId(null); setExpanded(expanded === e.id ? null : e.id); }} className="text-slate-400 hover:text-slate-700 inline-flex items-center gap-0.5 p-0.5">
                                {(e.attachmentCount || 0) > 0 && (
                                  <span className="inline-flex items-center gap-0.5 text-emerald-700" title={`${e.attachmentCount} receipt(s)`}>
                                    <Paperclip className="w-3 h-3" />{e.attachmentCount}
                                  </span>
                                )}
                                {expanded === e.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                          </tr>
                          {expanded === e.id && (
                            <tr><td colSpan={6} className="px-3 py-2 bg-slate-50/60">
                              {e.needsReview && e.reviewReason && <p className="text-[11px] text-amber-700 mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {e.reviewReason}</p>}

                              {editId === e.id ? (
                                <div className="rounded-lg border border-emerald-300 bg-white p-3 mb-3">
                                  <div className="text-[11px] font-bold text-emerald-800 mb-2 flex items-center gap-1.5">
                                    <Pencil className="w-3 h-3" /> Edit entry · اندراج درست کریں
                                  </div>
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                                    <label className="flex flex-col text-[10px] text-slate-500">Date
                                      <input type="date" value={editForm.entryDate} onChange={(ev) => setEditForm({ ...editForm, entryDate: ev.target.value })} className="border rounded px-2 py-1 text-slate-800" />
                                    </label>
                                    <label className="flex flex-col text-[10px] text-slate-500">Ref (bilty/cheque)
                                      <input dir="auto" value={editForm.refNo} onChange={(ev) => setEditForm({ ...editForm, refNo: ev.target.value })} className="border rounded px-2 py-1 text-slate-800" />
                                    </label>
                                    <label className="flex flex-col text-[10px] text-slate-500">Method
                                      <select value={editForm.method} onChange={(ev) => setEditForm({ ...editForm, method: ev.target.value })} className="border rounded px-2 py-1 text-slate-800">
                                        {METHODS.map((m) => <option key={m}>{m}</option>)}
                                      </select>
                                    </label>
                                    <label className="flex flex-col text-[10px] text-slate-500">Category
                                      <select value={editForm.category} onChange={(ev) => setEditForm({ ...editForm, category: ev.target.value })} className="border rounded px-2 py-1 text-slate-800">
                                        {ENTRY_CATS.map((c) => <option key={c}>{c}</option>)}
                                      </select>
                                    </label>
                                    <label className="flex flex-col text-[10px] text-slate-500 col-span-2 md:col-span-3">Description
                                      <input dir="auto" value={editForm.description} onChange={(ev) => setEditForm({ ...editForm, description: ev.target.value })} className="border rounded px-2 py-1 text-slate-800" />
                                    </label>
                                    <label className="flex flex-col text-[10px] text-slate-500">Debit / Naam (نام)
                                      <input value={editForm.debit} onChange={(ev) => setEditForm({ ...editForm, debit: ev.target.value })} className="border rounded px-2 py-1 text-red-600" />
                                    </label>
                                    <label className="flex flex-col text-[10px] text-slate-500">Credit / Jama (جمع)
                                      <input value={editForm.credit} onChange={(ev) => setEditForm({ ...editForm, credit: ev.target.value })} className="border rounded px-2 py-1 text-emerald-700" />
                                    </label>
                                    <label className="flex items-center gap-1 text-[10px] text-amber-700 mt-4">
                                      <input type="checkbox" checked={!!editForm.needsReview} onChange={(ev) => setEditForm({ ...editForm, needsReview: ev.target.checked })} />
                                      keep flagged for review
                                    </label>
                                  </div>
                                  <div className="flex items-center gap-2 mt-3">
                                    <button onClick={saveEdit} disabled={savingEdit} className="bg-emerald-600 text-white rounded px-3 py-1 text-xs font-semibold flex items-center gap-1 disabled:opacity-60">
                                      {savingEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />} Save changes
                                    </button>
                                    <button onClick={() => setEditId(null)} className="border border-slate-300 rounded px-3 py-1 text-xs">Cancel</button>
                                    <button onClick={() => deleteEntry(e.id)} className="ml-auto text-red-600 hover:bg-red-50 rounded px-2 py-1 text-xs flex items-center gap-1">
                                      <Trash2 className="w-3 h-3" /> Delete entry
                                    </button>
                                  </div>
                                  <p className="text-[10px] text-slate-400 mt-2" dir="auto">
                                    Changing an amount or date rebuilds every later balance in this khata automatically. · رقم یا تاریخ بدلنے پر آگے کے تمام بیلنس خود دوبارہ بن جائیں گے۔
                                  </p>
                                </div>
                              ) : null}

                              <div className="text-[11px] text-slate-500 mb-2 flex flex-wrap gap-x-4">
                                <span>Section: {e.sectionLabel}</span>{e.method && <span>Method: {e.method}</span>}<span>Category: {e.category}</span>
                              </div>
                              <AttachmentPanel entityType="party_ledger_entry" entityId={e.id} title="Receipts for this entry" />
                            </td></tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* new party modal */}
      {newParty && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl mt-10">
            <h3 className="text-sm font-bold text-slate-800 mb-1">New party · نیا کھاتہ</h3>
            <p className="text-[11px] text-slate-500 mb-3" dir="auto">
              Add as many accounts as you need. Fill contact + bank details here; a receipt attaches with each credit/debit entry. · جتنے کھاتے چاہیں بنائیں۔
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              {([
                ["name", "Name / نام *", "col-span-2 md:col-span-1"],
                ["phone", "Phone / رابطہ نمبر", ""],
                ["city", "City / شہر", ""],
                ["address", "Address / پتہ", "col-span-2 md:col-span-3"],
                ["ntn", "NTN", ""],
                ["strn", "STRN", ""],
                ["bankName", "Bank name", ""],
                ["bankAccountTitle", "Account title", ""],
                ["bankAccountNo", "Account no", ""],
                ["iban", "IBAN", ""],
                ["notes", "Notes / نوٹ", "col-span-2 md:col-span-3"],
              ] as [string, string, string][]).map(([k, lbl, cls]) => (
                <label key={k} className={`flex flex-col ${cls}`}>
                  <span className="text-slate-400">{lbl}</span>
                  <input dir="auto" value={newParty[k] || ""} onChange={(e) => setNewParty({ ...newParty, [k]: e.target.value })} className="border rounded px-2 py-1" />
                </label>
              ))}
              <label className="flex flex-col"><span className="text-slate-400">Type</span><select value={newParty.type} onChange={(e) => setNewParty({ ...newParty, type: e.target.value })} className="border rounded px-2 py-1">{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label className="flex flex-col"><span className="text-slate-400">Status</span><select value={newParty.status} onChange={(e) => setNewParty({ ...newParty, status: e.target.value })} className="border rounded px-2 py-1">{STATUSES.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label className="flex flex-col"><span className="text-slate-400">Opening balance (+lena / −dena)</span><input type="number" value={newParty.openingBalance} onChange={(e) => setNewParty({ ...newParty, openingBalance: e.target.value })} className="border rounded px-2 py-1" /></label>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={createParty} disabled={!newParty.name} className="bg-emerald-600 text-white rounded px-4 py-1.5 text-xs font-semibold disabled:opacity-50">Create</button>
              <button onClick={() => setNewParty(null)} className="border rounded px-3 py-1.5 text-xs">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "bad" }) {
  const c = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-600" : "text-slate-800";
  return (
    <div className="border border-slate-200 rounded-xl bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-bold ${c}`}>{value}</div>
    </div>
  );
}
