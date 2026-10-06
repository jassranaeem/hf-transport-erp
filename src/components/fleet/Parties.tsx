import React, { useCallback, useEffect, useRef, useState } from "react";
import { enterpriseFetch, uploadFile, uploadAttachment } from "../../../client/api.ts";
import BalanceFlow, { ALL, Period, periodParams } from "./BalanceFlow.tsx";
import EntryOrigin from "./EntryOrigin.tsx";
import AttachmentPanel from "../common/AttachmentPanel.tsx";
import ModuleDataIO from "../common/ModuleDataIO.tsx";
import DuesAlerts from "./DuesAlerts.tsx";
import {
  Users, Search, AlertTriangle, Plus, Loader2, ChevronDown, ChevronRight,
  FileSpreadsheet, Upload, CheckCircle, Save, Building2, Paperclip, Pencil, Trash2, RefreshCw,
} from "lucide-react";
import { useNewestFirst, inOrder, DateHead } from "../common/NewestFirst.tsx";
import { PageHeader, Btn, Card, SidePanel, Empty, Tabs } from "../ui/kit.tsx";

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
  focusEntryId,
  onNavigate,
}: {
  showFeedback: (type: "success" | "error", message: string) => void;
  focusPartyId?: number;
  focusEntryId?: number;
  onNavigate?: (wb: string, sheet: string, focus?: any) => void;
}) {
  const [rows, setRows] = useState<Party[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 60;

  const [selId, setSelId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ party: Party; entries: Entry[]; totals: any } | null>(null);
  const [newestFirst, toggleNewest] = useNewestFirst();
  const [loading, setLoading] = useState(false);
  const [editParty, setEditParty] = useState<any>(null);
  // Quick entry (debit/credit) is now shown immediately once a party is
  // picked, not behind an extra "Add entry" click — search → select → type
  // the amount → save, in one screen. The full historical ledger is the
  // opposite: collapsed by default (showLedger), one click to open — most
  // of the time you're here to log today's naam/jama, not review history.
  const [ptab, setPtab] = useState<"entry" | "ledger" | "details">("entry");
  const setShowLedger = (v: boolean) => setPtab(v ? "ledger" : "entry");
  const [entryForm, setEntryForm] = useState<any>({ entryDate: "", description: "", refNo: "", method: "Cash", debit: "", credit: "", category: "Other" });
  const [entryFile, setEntryFile] = useState<File | null>(null);
  const [entryBusy, setEntryBusy] = useState(false);
  const [dupWarn, setDupWarn] = useState<string | null>(null);
  const entryFileRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newParty, setNewParty] = useState<any>(null);

  const [showImport, setShowImport] = useState(false);
  const [importIsLender, setImportIsLender] = useState(false);
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

  const [period, setPeriod] = useState<Period>(ALL);
  const loadDetail = useCallback((id: number) => {
    setLoading(true);
    enterpriseFetch(`/api/parties/${id}?${new URLSearchParams(periodParams(period))}`)
      .then((d) => { setDetail(d); setEditParty(d.party); })
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback, period]);
  useEffect(() => {
    if (selId != null) {
      loadDetail(selId);
      // each newly-picked party starts on quick-entry — unless a link asked for one of its rows
      setShowLedger(!!focusEntryId && selId === focusPartyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, loadDetail]);

  // deep-link: open a specific party's ledger (from an alert / dues link)
  useEffect(() => {
    if (focusPartyId) {
      setSelId(focusPartyId);
      setExpanded(null);
      if (focusEntryId) setShowLedger(true); // the full ledger is collapsed by default — force it open to reach the row
    }
  }, [focusPartyId, focusEntryId]);

  // once that party's entries are loaded, scroll to and briefly highlight the exact row
  // (e.g. jumped here from a Daily Cash Book entry's "opened this entry" link)
  const [highlightEntryId, setHighlightEntryId] = useState<number | null>(null);
  useEffect(() => {
    if (!focusEntryId || !detail || detail.party.id !== focusPartyId) return;
    setHighlightEntryId(focusEntryId);
    const t1 = setTimeout(() => {
      document.getElementById(`party-entry-${focusEntryId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    const t2 = setTimeout(() => setHighlightEntryId(null), 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [focusEntryId, focusPartyId, detail]);

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
    if (!debit && !credit) { showFeedback("error", "Enter an amount in Debit or Credit · ڈیبٹ یا کریڈٹ میں رقم درج کریں۔"); return; }
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
            const w = `⚠ This receipt file is already attached (${(up.duplicateOf || []).filter((d: any) => d.id !== up.id).map((d: any) => `${d.entityType} #${d.entityId}`).join(", ")}) — duplicate slip? · دہری رسید؟`;
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

  // ---- edit / delete an existing ledger entry ------------------------
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

  // Delete the whole party — every ledger entry in it, not just one at a time.
  const deleteParty = async () => {
    if (!selId || !detail) return;
    const count = detail.entries.length;
    const warning =
      `Delete the entire party "${detail.party.name}"? This removes all ${count} entries permanently — not just one row.\n\n` +
      `Type DELETE to confirm.`;
    const typed = window.prompt(warning);
    if (typed !== "DELETE") return;
    try {
      const r = await enterpriseFetch(`/api/parties/${selId}`, { method: "DELETE" });
      showFeedback("success", r.message || "Party deleted");
      setSelId(null);
      setDetail(null);
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
      if (importIsLender) fd.append("partyType", "lender");
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

  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] text-[#111827] bg-white";
  const chip = (on: boolean) =>
    `text-[11.5px] rounded-md px-2 py-1 ${on ? "bg-[#EAF0F8] text-[#24539B] font-semibold" : "text-[#6B7280] hover:bg-[#F4F6FA]"}`;
  const balTone = (b: number) => (b > 0 ? "text-[#166534]" : b < 0 ? "text-[#B91C1C]" : "text-[#9CA3AF]");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Party Ledgers"
        urdu="پارٹی کھاتے"
        subtitle="Customers, suppliers, lenders — who owes us and whom we owe · کس سے لینا ہے، کس کو دینا ہے"
        actions={
          <>
            <Btn kind="ghost" onClick={() => { loadList(); if (selId != null) loadDetail(selId); }} title="Refresh · تازہ کریں" icon={<RefreshCw />} />
            <Btn onClick={() => setShowImport(true)} icon={<FileSpreadsheet />} title="Import your parties workbook (.xlsx)">Parties workbook</Btn>
            <ModuleDataIO entityKey="parties" label="Parties" onImported={loadList} />
            <Btn kind="primary" onClick={() => setNewParty({ name: "", type: "Customer", openingBalance: 0, status: "Active" })} icon={<Plus />}>New party · نئی پارٹی</Btn>
          </>
        }
      />

      {showImport && (
        <SidePanel title="Import parties from Excel · ایکسل سے" subtitle="One sheet per party" onClose={() => setShowImport(false)}>
          <Card bodyClassName="p-4 space-y-3">
            <p className="text-[13px] text-[#4B5563] leading-relaxed">
              Upload your parties ledger workbook (one sheet per party, same layout as the truck ledgers). The system
              reads every sheet, builds the running debit / credit balance and flags anything to review. Re-uploading is
              non-destructive — it updates, it never wipes.
            </p>
            <label
              className="flex items-center gap-2 text-[13px] text-[#374151]"
              title="For someone who loaned HFK money (deposit + our own expenses paid from it) — this flips the balance to payable instead of receivable."
            >
              <input type="checkbox" checked={importIsLender} onChange={(e) => setImportIsLender(e.target.checked)} />
              Lender sheet (they loaned us money)
            </label>
            <Btn kind="primary" onClick={() => importRef.current?.click()} disabled={importBusy} icon={importBusy ? <Loader2 className="animate-spin" /> : <Upload />}>
              {importBusy ? "Importing…" : "Choose .xlsx file"}
            </Btn>
            <input ref={importRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
          </Card>
          {importResult && !importResult.error && (
            <div className="rounded-xl border border-[#CFE3D6] bg-[#F1F8F4] p-3 text-[12.5px]">
              <div className="flex items-center gap-2 font-semibold text-[#166534]"><CheckCircle className="w-4 h-4" /> {importResult.message}</div>
              {Array.isArray(importResult.failedSheets) && importResult.failedSheets.length > 0 && (
                <div className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  {importResult.failedSheets.length} sheet(s) failed — rest imported:
                  <ul className="list-disc pl-4">{importResult.failedSheets.slice(0, 6).map((f: any, i: number) => <li key={i}>{f.sheet}: {f.error}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          {importResult?.error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-700">{importResult.error}</div>}
        </SidePanel>
      )}

      {/* dues & alerts — who to pay / who to collect from / do-not-pay */}
      <DuesAlerts compact showFeedback={showFeedback} onOpenParty={(id) => { setSelId(id); setExpanded(null); }} />

      <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-4 items-start">
        {/* the parties */}
        <Card className="overflow-hidden lg:sticky lg:top-0" bodyClassName="">
          <div className="p-2.5 border-b border-[#EEF1F5] space-y-2">
            <div className="flex items-center gap-2 border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 bg-white">
              <Search className="w-4 h-4 text-[#9CA3AF] shrink-0" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder="Name / phone / NTN / city… · تلاش" className="text-[13px] w-full outline-none border-0 p-0" style={{ boxShadow: "none" }} />
            </div>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => { setTypeFilter(""); setOffset(0); }} className={chip(typeFilter === "")}>All {total ? total.toLocaleString() : ""}</button>
              {TYPES.map((t) => (
                <button key={t} onClick={() => { setTypeFilter(typeFilter === t ? "" : t); setOffset(0); }} className={chip(typeFilter === t)}>{t}</button>
              ))}
            </div>
          </div>
          <div className="max-h-[45vh] lg:max-h-[calc(100vh-300px)] overflow-y-auto">
            {rows.map((p) => (
              <button
                key={p.id}
                onClick={() => { setSelId(p.id); setExpanded(null); }}
                className={`w-full text-left px-3.5 py-2.5 border-b border-[#F1F4F9] border-l-[3px] transition ${selId === p.id ? "bg-[#EAF0F8] border-l-[#24539B]" : "border-l-transparent hover:bg-[#F8FAFC]"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[13px] text-[#111827] truncate" dir="auto">{p.name}</span>
                  <span className={`text-[12px] font-semibold tabular-nums whitespace-nowrap ${balTone(p.closingBalance)}`}>{fmt(p.closingBalance)}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[#6B7280]">
                  <span className="rounded bg-[#F1F4F9] px-1.5">{p.type}</span>
                  <span>{p.partyCode}</span>
                  <span>{p.entryCount || 0} entries</span>
                  {(p.needsReviewCount || 0) > 0 && (
                    <span
                      onClick={(ev) => { ev.stopPropagation(); setSelId(p.id); setExpanded(null); }}
                      title={`${p.needsReviewCount} row(s) need checking · دیکھنے کے لیے کلک کریں`}
                      className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 text-amber-800 px-1.5 py-px font-medium cursor-pointer hover:bg-amber-200"
                    >
                      <AlertTriangle className="w-3 h-3" />{p.needsReviewCount}
                    </span>
                  )}
                </div>
              </button>
            ))}
            {rows.length === 0 && <div className="p-6 text-center text-[12.5px] text-[#9CA3AF]">No parties. Add one or import your Excel.</div>}
          </div>
          {total > LIMIT && (
            <div className="flex items-center justify-between px-3 py-2 text-[11.5px] text-[#6B7280] border-t border-[#EEF1F5]">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))} className="disabled:opacity-40 hover:text-[#24539B]">‹ Prev</button>
              <span>{offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()}</span>
              <button disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)} className="disabled:opacity-40 hover:text-[#24539B]">Next ›</button>
            </div>
          )}
        </Card>

        {/* the open party */}
        <Card className="min-w-0" bodyClassName="">
          {!detail ? (
            <Empty icon={<Users />} title="Pick a party to open its khata" hint="کھاتہ کھولنے کے لیے بائیں طرف سے پارٹی منتخب کریں" />
          ) : (
            <div>
              {/* record header */}
              <div className="px-5 pt-4 pb-0 border-b border-[#EEF1F5]">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[20px] font-semibold text-[#111827] leading-tight" dir="auto">{detail.party.name}</h2>
                      {detail.party.status && detail.party.status !== "Active" && (
                        <span className={`text-[11px] rounded-full px-2 py-0.5 ${detail.party.status === "Blocked" ? "bg-red-50 text-red-700" : "bg-[#F1F4F9] text-[#6B7280]"}`}>
                          {detail.party.status === "Blocked" ? "Do not pay" : detail.party.status}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-[#6B7280] mt-0.5">
                      {detail.party.partyCode} · {detail.party.type}
                      {detail.party.phone ? ` · ${detail.party.phone}` : ""}
                      {detail.party.city ? ` · ${detail.party.city}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-[11.5px] text-[#6B7280]">{detail.party.closingBalance > 0 ? "Receivable · لینا" : detail.party.closingBalance < 0 ? "Payable · دینا" : "Balance"}</div>
                    <div className={`text-[20px] font-semibold tabular-nums leading-tight ${balTone(detail.party.closingBalance)}`}>{detail.party.closingBalance ? fmt(detail.party.closingBalance) : "Clear · صاف"}</div>
                  </div>
                  <Btn kind="danger" onClick={deleteParty} title="Delete this whole party (ledger) and all its entries" icon={<Trash2 />} />
                </div>
                <div className="mt-3 -mb-px">
                  <Tabs
                    value={ptab}
                    onChange={setPtab}
                    items={[
                      { id: "entry", label: <><Plus className="w-3.5 h-3.5" /> New entry · نیا اندراج</> },
                      { id: "ledger", label: "Ledger · کھاتہ", count: detail.totals.entries ?? detail.entries.length },
                      { id: "details", label: <><Building2 className="w-3.5 h-3.5" /> Details · تفصیل</> },
                    ]}
                  />
                </div>
              </div>

              <div className="p-5 space-y-4">
                {/* opening + we gave − we received = balance now */}
                <BalanceFlow
                  mode="party"
                  balance={detail.balance}
                  period={period}
                  onPeriod={setPeriod}
                  onSaveOpening={async (amount) => {
                    try {
                      await enterpriseFetch(`/api/parties/${detail.party.id}`, { method: "PUT", body: JSON.stringify({ openingBalance: amount }) });
                      showFeedback("success", "Opening balance saved · ابتدائی بیلنس محفوظ");
                      loadDetail(detail.party.id);
                      loadList();
                    } catch (e: any) {
                      showFeedback("error", e.message);
                      throw e;
                    }
                  }}
                />

                {dupWarn && (
                  <div className="rounded-lg border border-red-300 bg-red-50 text-red-800 px-3 py-2 text-[12.5px] flex items-start gap-2 whitespace-pre-line" dir="auto">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span className="flex-1"><b>Possible duplicate — </b>{dupWarn}</span>
                    <button onClick={() => setDupWarn(null)} className="shrink-0 font-bold">✕</button>
                  </div>
                )}

                {/* the party's master record */}
                {ptab === "details" && editParty && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {([
                        ["name", "Name"], ["phone", "Phone"], ["city", "City"],
                        ["ntn", "NTN"], ["strn", "STRN"], ["address", "Address"],
                        ["bankName", "Bank name"], ["bankAccountTitle", "Account title"], ["bankAccountNo", "Account no"],
                        ["iban", "IBAN"], ["notes", "Notes"],
                      ] as [string, string][]).map(([k, l]) => (
                        <label key={k} className={lbl}>
                          {l}
                          <input dir="auto" value={editParty[k] || ""} onChange={(e) => setEditParty({ ...editParty, [k]: e.target.value })} className={inp} />
                        </label>
                      ))}
                      <label className={lbl}>
                        Type
                        <select value={editParty.type} onChange={(e) => setEditParty({ ...editParty, type: e.target.value })} className={inp}>
                          {TYPES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                      </label>
                      <label className={lbl}>
                        Status
                        <select value={editParty.status || "Active"} onChange={(e) => setEditParty({ ...editParty, status: e.target.value })} className={inp}>
                          {STATUSES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                        {editParty.status === "Blocked" && <span className="text-[11px] text-red-600 font-normal">Do-not-pay: shows under "Do not pay" on the alerts board · ادائیگی نہیں کرنی</span>}
                      </label>
                      <label className={lbl}>
                        Opening balance (+ receivable / − payable)
                        <input type="number" value={editParty.openingBalance} onChange={(e) => setEditParty({ ...editParty, openingBalance: e.target.value })} className={inp} />
                      </label>
                    </div>
                    <label className="flex items-center gap-2 text-[13px] text-[#374151]">
                      <input type="checkbox" checked={!!editParty.smsAlerts} onChange={(e) => setEditParty({ ...editParty, smsAlerts: e.target.checked })} />
                      <span dir="auto">SMS alerts — text this party on every credit/debit entry (once an SMS gateway is set up) · ہر اندراج پر SMS</span>
                    </label>
                    <Btn kind="primary" onClick={saveParty} icon={<Save />}>Save details</Btn>
                  </div>
                )}

                {/* quick entry — the moment a party is picked: type the amount, save */}
                {ptab === "entry" && (
                  <div className="rounded-xl border border-[#C9D7EC] bg-[#F7F9FD] p-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <label className={lbl}>Date · تاریخ<input type="date" value={entryForm.entryDate} onChange={(e) => setEntryForm({ ...entryForm, entryDate: e.target.value })} className={inp} /></label>
                      <label className={lbl}>Method · طریقہ
                        <select value={entryForm.method} onChange={(e) => setEntryForm({ ...entryForm, method: e.target.value })} className={inp}>
                          {METHODS.map((m) => <option key={m}>{m}</option>)}
                        </select>
                      </label>
                      <label className={lbl}>Debit · نام<input inputMode="decimal" dir="auto" placeholder="0" value={entryForm.debit} onChange={(e) => setEntryForm({ ...entryForm, debit: e.target.value })} className={inp} /></label>
                      <label className={lbl}>Credit · جمع<input inputMode="decimal" dir="auto" placeholder="0" value={entryForm.credit} onChange={(e) => setEntryForm({ ...entryForm, credit: e.target.value })} className={inp} /></label>
                      <label className={`${lbl} col-span-2 md:col-span-3`}>Description · تفصیل<input dir="auto" value={entryForm.description} onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })} className={inp} /></label>
                      <label className={lbl}>Ref (bilty / cheque)<input dir="auto" value={entryForm.refNo} onChange={(e) => setEntryForm({ ...entryForm, refNo: e.target.value })} className={inp} /></label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <Btn
                        size="sm"
                        kind={BANK_METHODS.includes(entryForm.method) && !entryFile ? "danger" : "secondary"}
                        onClick={() => entryFileRef.current?.click()}
                        icon={<Paperclip />}
                      >
                        {entryFile ? "Change receipt" : "Attach receipt / proof"}
                        {BANK_METHODS.includes(entryForm.method) && <span className="text-red-600">*</span>}
                      </Btn>
                      <input ref={entryFileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setEntryFile(e.target.files?.[0] || null)} />
                      {entryFile && <span className="text-[12px] text-[#4B5563] truncate max-w-[220px]">📎 {entryFile.name}</span>}
                      {BANK_METHODS.includes(entryForm.method) && !entryFile && (
                        <span className="text-[11.5px] text-red-600" dir="auto">Receipt required for {entryForm.method} · رسید لازمی</span>
                      )}
                      <Btn kind="primary" className="ml-auto" onClick={addEntry} disabled={entryBusy} icon={entryBusy ? <Loader2 className="animate-spin" /> : <CheckCircle />}>Save entry</Btn>
                    </div>
                  </div>
                )}

                {ptab === "ledger" && (loading ? (
                  <div className="text-[13px] text-[#9CA3AF] flex items-center gap-2 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
                ) : (
                  <div className="overflow-x-auto border border-[#E3E8EF] rounded-lg">
                    <table className="w-full text-[12.5px]">
                      <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]">
                        <tr className="border-b border-[#E3E8EF]">
                          <th className="text-left px-3 py-2"><DateHead newestFirst={newestFirst} onToggle={toggleNewest} /></th>
                          <th className="text-left px-3 py-2">Description</th>
                          <th className="text-right px-3 py-2">Debit · نام</th>
                          <th className="text-right px-3 py-2">Credit · جمع</th>
                          <th className="text-right px-3 py-2">Balance</th>
                          <th className="px-2 w-[90px]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.entries.length === 0 && (
                          <tr><td colSpan={6} className="px-3 py-8 text-center text-[#9CA3AF]">No entries in this period · اس مدت میں کوئی اندراج نہیں</td></tr>
                        )}
                        {inOrder<any>(detail.entries, newestFirst).map((e) => (
                          <React.Fragment key={e.id}>
                            <tr
                              id={`party-entry-${e.id}`}
                              onClick={(ev) => {
                                if ((ev.target as HTMLElement).closest("button, a, input, select, textarea, label")) return;
                                setEditId(null);
                                setExpanded(expanded === e.id ? null : e.id);
                              }}
                              title="Click for the whole entry and where it came from · پوری تفصیل"
                              className={`group cursor-pointer border-t border-[#F1F4F9] transition-colors ${
                                e.id === highlightEntryId ? "bg-[#DCE7F7]" : expanded === e.id ? "bg-[#F4F7FC]" : (e as any).issue ? "bg-red-50" : e.needsReview ? "bg-amber-50/60" : "hover:bg-[#F8FAFC]"
                              }`}
                            >
                              <td className="px-3 py-2 whitespace-nowrap text-[#4B5563] tabular-nums align-top">{e.entryDate ? e.entryDate.slice(0, 10) : <span className="text-amber-700">{e.rawDate || "—"}</span>}</td>
                              <td className="px-3 py-2 max-w-[300px] align-top">
                                <div className="truncate text-[#1F2937]" dir="auto" title={e.description || ""}>{e.description || "—"}{e.refNo ? <span className="text-[#9CA3AF]"> · {e.refNo}</span> : ""}</div>
                                {(e as any).issue && (
                                  <div className="text-[11px] text-red-700 font-medium flex items-start gap-1 mt-0.5">
                                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                                    <span>{(e as any).issue}</span>
                                  </div>
                                )}
                                {e.needsReview && (
                                  <div className="text-[11px] text-red-600 flex items-start gap-1 mt-0.5">
                                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                                    <span>{e.reviewReason || "Row flagged as doubtful during import · امپورٹ کے دوران مشکوک سطر"}</span>
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-[#B91C1C] align-top">{e.debit ? e.debit.toLocaleString() : ""}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-[#166534] align-top">{e.credit ? e.credit.toLocaleString() : ""}</td>
                              <td className={`px-3 py-2 text-right tabular-nums font-medium align-top ${e.runningBalance < 0 ? "text-[#B91C1C]" : "text-[#111827]"}`}>{e.runningBalance.toLocaleString()}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap text-right align-top">
                                {(e.attachmentCount || 0) > 0 && (
                                  <span className="inline-flex items-center gap-0.5 text-[#24539B] text-[11px] mr-1" title={`${e.attachmentCount} receipt(s)`}>
                                    <Paperclip className="w-3 h-3" />{e.attachmentCount}
                                  </span>
                                )}
                                <span className="opacity-40 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => startEdit(e)} title="Edit this entry · اندراج درست کریں" className="text-[#6B7280] hover:text-[#24539B] p-1 rounded hover:bg-white">
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => deleteEntry(e.id)} title="Delete this entry · اندراج حذف کریں" className="text-[#6B7280] hover:text-red-600 p-1 rounded hover:bg-white">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </span>
                                <button onClick={() => { setEditId(null); setExpanded(expanded === e.id ? null : e.id); }} className="text-[#6B7280] hover:text-[#111827] p-1">
                                  {expanded === e.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                </button>
                              </td>
                            </tr>
                            {expanded === e.id && (
                              <tr className="bg-[#F4F7FC]"><td colSpan={6} className="px-4 pb-4 pt-1">
                                {e.needsReview && e.reviewReason && <p className="text-[12px] text-amber-800 mb-2 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {e.reviewReason}</p>}

                                {editId === e.id ? (
                                  <div className="rounded-xl border border-[#C9D7EC] bg-white p-4 mb-3">
                                    <div className="text-[13px] font-semibold text-[#1F2937] mb-3 flex items-center gap-1.5">
                                      <Pencil className="w-3.5 h-3.5 text-[#24539B]" /> Edit entry · اندراج درست کریں
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                      <label className={lbl}>Date
                                        <input type="date" value={editForm.entryDate} onChange={(ev) => setEditForm({ ...editForm, entryDate: ev.target.value })} className={inp} />
                                      </label>
                                      <label className={lbl}>Method
                                        <select value={editForm.method} onChange={(ev) => setEditForm({ ...editForm, method: ev.target.value })} className={inp}>
                                          {METHODS.map((m) => <option key={m}>{m}</option>)}
                                        </select>
                                      </label>
                                      <label className={lbl}>Debit · نام
                                        <input value={editForm.debit} onChange={(ev) => setEditForm({ ...editForm, debit: ev.target.value })} className={inp} />
                                      </label>
                                      <label className={lbl}>Credit · جمع
                                        <input value={editForm.credit} onChange={(ev) => setEditForm({ ...editForm, credit: ev.target.value })} className={inp} />
                                      </label>
                                      <label className={`${lbl} col-span-2`}>Description
                                        <input dir="auto" value={editForm.description} onChange={(ev) => setEditForm({ ...editForm, description: ev.target.value })} className={inp} />
                                      </label>
                                      <label className={lbl}>Ref (bilty / cheque)
                                        <input dir="auto" value={editForm.refNo} onChange={(ev) => setEditForm({ ...editForm, refNo: ev.target.value })} className={inp} />
                                      </label>
                                      <label className={lbl}>Category
                                        <select value={editForm.category} onChange={(ev) => setEditForm({ ...editForm, category: ev.target.value })} className={inp}>
                                          {ENTRY_CATS.map((c) => <option key={c}>{c}</option>)}
                                        </select>
                                      </label>
                                    </div>
                                    <label className="flex items-center gap-1.5 text-[12px] text-[#B45309] mt-3">
                                      <input type="checkbox" checked={!!editForm.needsReview} onChange={(ev) => setEditForm({ ...editForm, needsReview: ev.target.checked })} />
                                      Keep flagged for review
                                    </label>
                                    <div className="flex items-center gap-2 mt-3">
                                      <Btn kind="primary" size="sm" onClick={saveEdit} disabled={savingEdit} icon={savingEdit ? <Loader2 className="animate-spin" /> : <CheckCircle />}>Save changes</Btn>
                                      <Btn size="sm" onClick={() => setEditId(null)}>Cancel</Btn>
                                      <Btn size="sm" kind="danger" className="ml-auto" onClick={() => deleteEntry(e.id)} icon={<Trash2 />}>Delete entry</Btn>
                                    </div>
                                    <p className="text-[11px] text-[#9CA3AF] mt-2" dir="auto">
                                      Changing an amount or date rebuilds every later balance in this ledger automatically. · رقم یا تاریخ بدلنے پر آگے کے تمام بیلنس خود دوبارہ بن جائیں گے۔
                                    </p>
                                  </div>
                                ) : null}

                                <EntryOrigin kind="ple" id={e.id} onNavigate={onNavigate} />
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
            </div>
          )}
        </Card>
      </div>

      {/* new party */}
      {newParty && (
        <SidePanel title="New party · نئی پارٹی" subtitle="Contact and bank details; a receipt goes with each credit / debit entry" onClose={() => setNewParty(null)}>
          <Card bodyClassName="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                ["name", "Name · نام *", "sm:col-span-2"],
                ["phone", "Phone · رابطہ نمبر", ""],
                ["city", "City · شہر", ""],
                ["address", "Address · پتہ", "sm:col-span-2"],
                ["ntn", "NTN", ""],
                ["strn", "STRN", ""],
                ["bankName", "Bank name", ""],
                ["bankAccountTitle", "Account title", ""],
                ["bankAccountNo", "Account no", ""],
                ["iban", "IBAN", ""],
                ["notes", "Notes · نوٹ", "sm:col-span-2"],
              ] as [string, string, string][]).map(([k, l, cls]) => (
                <label key={k} className={`${lbl} ${cls}`}>
                  {l}
                  <input dir="auto" value={newParty[k] || ""} onChange={(e) => setNewParty({ ...newParty, [k]: e.target.value })} className={inp} autoFocus={k === "name"} />
                </label>
              ))}
              <label className={lbl}>Type<select value={newParty.type} onChange={(e) => setNewParty({ ...newParty, type: e.target.value })} className={inp}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label className={lbl}>Status<select value={newParty.status} onChange={(e) => setNewParty({ ...newParty, status: e.target.value })} className={inp}>{STATUSES.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label className={`${lbl} sm:col-span-2`}>Opening balance (+ receivable / − payable) · ابتدائی بیلنس<input type="number" value={newParty.openingBalance} onChange={(e) => setNewParty({ ...newParty, openingBalance: e.target.value })} className={inp} /></label>
            </div>
          </Card>
          <div className="flex gap-2">
            <Btn kind="primary" onClick={createParty} disabled={!newParty.name}>Create party</Btn>
            <Btn onClick={() => setNewParty(null)}>Cancel</Btn>
          </div>
        </SidePanel>
      )}
    </div>
  );
}

