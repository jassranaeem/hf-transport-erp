import React, { useEffect, useMemo, useRef, useState } from "react";
import { enterpriseFetch, uploadFile } from "../../../client/api.ts";
import BalanceFlow, { ALL, Period, periodParams } from "./BalanceFlow.tsx";
import EntryOrigin from "./EntryOrigin.tsx";
import AttachmentPanel from "../common/AttachmentPanel.tsx";
import ModuleDataIO from "../common/ModuleDataIO.tsx";
import {
  BookOpen, Search, AlertTriangle, Plus, Loader2, TrendingUp, TrendingDown,
  ChevronDown, ChevronRight, Handshake, Upload, FileSpreadsheet, CheckCircle, RefreshCw,
  Pencil, Trash2,
} from "lucide-react";
import { useNewestFirst, inOrder, DateHead } from "../common/NewestFirst.tsx";
import TruckSheetImport from "./TruckSheetImport.tsx";
import { PageHeader, Btn, Card, KpiStrip, SidePanel, Empty } from "../ui/kit.tsx";

const CATS = ["Freight","Diesel","TripCash","Tyre","Visa","Carnet","TomanFX","PartsBill","Garage","Salary","Battery","Insurance","MobilOil","Permit","OnlineTransfer","Capital","SafiBachat","Other"];

interface LedgerRow {
  id: number;
  registration: string;
  title: string;
  ownerName: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehicleNumber: string | null;
  isPartnership: boolean;
  entryCount: number;
  needsReviewCount: number;
  totalReceived: number;
  totalPaid: number;
  netProfit: number;
  closingBalance: number;
}
interface Entry {
  id: number;
  srNo: number | null;
  entryDate: string | null;
  rawDate: string | null;
  method: string | null;
  partyFrom: string | null;
  partyTo: string | null;
  description: string | null;
  received: number;
  paid: number;
  runningBalance: number;
  sheetBalance: number | null;
  category: string;
  direction: string | null;
  sectionLabel: string | null;
  routeFrom: string | null;
  routeTo: string | null;
  cargo: string | null;
  needsReview: boolean;
  reviewReason: string | null;
}
interface LedgerDetail {
  ledger: LedgerRow & { sourceSheet: string | null; openingBalance: number };
  partnerAgreement: any | null;
  entries: Entry[];
  pnl: { totalReceived: number; totalPaid: number; netProfit: number; byCategory: Array<{ category: string; received: number; paid: number; entries: number }> };
  balance: any;
}

const fmt = (n: number) => (n < 0 ? "-" : "") + "PKR " + Math.abs(Math.round(n)).toLocaleString();
const CAT_COLORS: Record<string, string> = {
  Freight: "bg-emerald-100 text-emerald-800", Diesel: "bg-amber-100 text-amber-800",
  TripCash: "bg-sky-100 text-sky-800", Tyre: "bg-slate-200 text-slate-700",
  TomanFX: "bg-purple-100 text-purple-800", Capital: "bg-indigo-100 text-indigo-800",
  SafiBachat: "bg-teal-100 text-teal-800", OnlineTransfer: "bg-blue-100 text-blue-800",
};
const CAT_LABEL: Record<string, string> = { TripCash: "Trip cash", TomanFX: "Toman FX", PartsBill: "Parts bill", MobilOil: "Mobil oil", OnlineTransfer: "Online transfer", SafiBachat: "Net savings" };
const catLabel = (c: string) => CAT_LABEL[c] || c;
const catClass = (c: string) => CAT_COLORS[c] || "bg-slate-100 text-slate-600";

export default function TruckLedgers({
  showFeedback,
  focusLedgerId,
  focusEntryId,
  onNavigate,
}: {
  showFeedback: (type: "success" | "error", message: string) => void;
  focusLedgerId?: number;
  focusEntryId?: number;
  onNavigate?: (wb: string, sheet: string, focus?: any) => void;
}) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LedgerDetail | null>(null);
  const [newestFirst, toggleNewest] = useNewestFirst();
  const [loading, setLoading] = useState(false);
  const [catFilter, setCatFilter] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingDriver, setEditingDriver] = useState(false);
  const [driverForm, setDriverForm] = useState({ driverName: "", driverPhone: "" });
  const [savingDriver, setSavingDriver] = useState(false);
  const [form, setForm] = useState<any>({ entryDate: "", description: "", received: "", paid: "", category: "Other", method: "" });
  const [showImport, setShowImport] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const emptyNew = { vehicleId: null as number | null, registration: "", title: "", ownerName: "", driverName: "", driverPhone: "", isPartnership: false, openingBalance: "", openingDate: "", notes: "" };
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState(emptyNew);
  const [truckQ, setTruckQ] = useState("");
  const [truckHits, setTruckHits] = useState<any[]>([]);
  const [savingNew, setSavingNew] = useState(false);
  useEffect(() => {
    if (!showNew || newForm.vehicleId || !truckQ.trim()) { setTruckHits([]); return; }
    const t = setTimeout(() => {
      enterpriseFetch(`/api/operations/vehicles?limit=8&search=${encodeURIComponent(truckQ.trim())}`)
        .then((r) => setTruckHits(r.data || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [truckQ, showNew, newForm.vehicleId]);

  const createLedger = async () => {
    if (!newForm.vehicleId && !truckQ.trim()) { showFeedback("error", "Choose a truck or type its registration number · ٹرک منتخب کریں یا رجسٹریشن نمبر لکھیں"); return; }
    setSavingNew(true);
    try {
      const created = await enterpriseFetch("/api/ledgers", {
        method: "POST",
        body: JSON.stringify({
          ...newForm,
          registration: newForm.vehicleId ? undefined : truckQ.trim(),
          openingBalance: newForm.openingBalance === "" ? 0 : Number(newForm.openingBalance),
        }),
      });
      showFeedback("success", `Ledger created for ${created.registration} · کھاتہ بن گیا`);
      setShowNew(false);
      setNewForm(emptyNew);
      setTruckQ("");
      loadList();
      setSelId(created.id);
    } catch (e: any) {
      showFeedback("error", e.message || "Could not create the ledger · کھاتہ نہیں بن سکا");
    } finally {
      setSavingNew(false);
    }
  };

  const [listLoading, setListLoading] = useState(false);
  const loadList = (toast = false) => {
    setListLoading(true);
    Promise.all([
      enterpriseFetch("/api/ledgers").then(setRows).catch((e) => showFeedback("error", e.message)),
      enterpriseFetch("/api/ledgers/summary").then(setSummary).catch(() => {}),
    ]).finally(() => {
      setListLoading(false);
      if (toast) showFeedback("success", "Refreshed · تازہ ہو گیا");
    });
  };
  useEffect(() => loadList(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAll = () => {
    loadList(true);
    if (selId != null) loadDetail(selId);
  };

  const [period, setPeriod] = useState<Period>(ALL);
  const loadDetail = (id: number) => {
    setLoading(true);
    const params = new URLSearchParams(periodParams(period));
    if (catFilter) params.set("category", catFilter);
    if (reviewOnly) params.set("needsReview", "1");
    enterpriseFetch(`/api/ledgers/${id}?${params}`)
      .then(setDetail)
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (selId != null) loadDetail(selId);
  }, [selId, catFilter, reviewOnly, period]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (detail) {
      setDriverForm({ driverName: detail.ledger.driverName || "", driverPhone: detail.ledger.driverPhone || "" });
      setEditingDriver(false);
    }
  }, [detail?.ledger.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveDriver = async () => {
    if (!detail) return;
    setSavingDriver(true);
    try {
      await enterpriseFetch(`/api/entities/truck_ledgers/${detail.ledger.id}`, {
        method: "PATCH",
        body: JSON.stringify({ driverName: driverForm.driverName || null, driverPhone: driverForm.driverPhone || null }),
      });
      showFeedback("success", "Driver updated");
      setEditingDriver(false);
      refreshAll();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSavingDriver(false);
    }
  };

  // deep-link: open a specific truck's khata (from an alert / dues link)
  useEffect(() => {
    if (focusLedgerId) {
      setSelId(focusLedgerId);
      setExpanded(null);
    }
  }, [focusLedgerId]);

  // once that ledger's entries are loaded, scroll to and briefly highlight the exact row
  // (e.g. jumped here from a Daily Cash Book entry's "opened this entry" link)
  const [highlightEntryId, setHighlightEntryId] = useState<number | null>(null);
  useEffect(() => {
    if (!focusEntryId || !detail || detail.ledger.id !== focusLedgerId) return;
    setHighlightEntryId(focusEntryId);
    const t1 = setTimeout(() => {
      document.getElementById(`truck-entry-${focusEntryId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    const t2 = setTimeout(() => setHighlightEntryId(null), 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [focusEntryId, focusLedgerId, detail]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.registration} ${r.title} ${r.ownerName || ""}`.toLowerCase().includes(s)) : rows;
  }, [rows, q]);

  // ---- edit / delete an existing entry -------------------------------
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const startEdit = (e: Entry) => {
    setEditId(e.id);
    setExpanded(e.id);
    setEditForm({
      entryDate: e.entryDate ? e.entryDate.slice(0, 10) : "",
      description: e.description || "",
      category: e.category || "Other",
      method: e.method || "",
      received: e.received || "",
      // a cash row shows the cash handed over (part of it was spent on diesel, toll…)
      paid: (e as any).spentFromIt ? e.paid + (e as any).spentFromIt : e.paid || "",
      routeFrom: e.routeFrom || "",
      routeTo: e.routeTo || "",
      needsReview: e.needsReview,
    });
  };
  const saveEdit = async () => {
    if (!editId || !selId) return;
    setSavingEdit(true);
    try {
      await enterpriseFetch(`/api/ledgers/entries/${editId}`, {
        method: "PUT",
        body: JSON.stringify({
          ...editForm,
          received: Number(editForm.received) || 0,
          // stored as what is left of the cash after what was paid out of it
          paid: Math.max(0, (Number(editForm.paid) || 0) - (Number((detail?.entries.find((x) => x.id === editId) as any)?.spentFromIt) || 0)),
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
      await enterpriseFetch(`/api/ledgers/entries/${id}`, { method: "DELETE" });
      showFeedback("success", "Entry deleted · اندراج حذف ہو گیا");
      setEditId(null);
      setExpanded(null);
      loadDetail(selId);
      loadList();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  // Delete the whole sheet/ledger — every entry in it, not just one at a time.
  const deleteLedger = async () => {
    if (!selId || !detail) return;
    const count = detail.entries.length;
    const warning =
      `Delete the entire ledger "${detail.ledger.title}"? This removes all ${count} entries permanently — not just one row.\n\n` +
      `Type DELETE to confirm.`;
    const typed = window.prompt(warning);
    if (typed !== "DELETE") return;
    try {
      const r = await enterpriseFetch(`/api/ledgers/${selId}`, { method: "DELETE" });
      showFeedback("success", r.message || "Ledger deleted");
      setSelId(null);
      setDetail(null);
      loadList();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const [dupWarn, setDupWarn] = useState<string | null>(null);
  const addEntry = async () => {
    if (!selId) return;
    setDupWarn(null);
    try {
      const created = await enterpriseFetch(`/api/ledgers/${selId}/entries`, {
        method: "POST",
        body: JSON.stringify({
          ...form,
          received: Number(form.received) || 0,
          paid: Number(form.paid) || 0,
        }),
      });
      if (created?.pendingApproval) {
        showFeedback("success", created.message);
        setShowAdd(false);
        setForm({ entryDate: "", description: "", received: "", paid: "", category: "Other", method: "" });
        return;
      }
      if (created?.duplicateWarning) {
        setDupWarn(created.duplicateWarning);
        showFeedback("error", "⚠ Possible DUPLICATE — same amount, date & description already in this ledger");
      } else {
        showFeedback("success", "Entry added");
        setShowAdd(false);
        setForm({ entryDate: "", description: "", received: "", paid: "", category: "Other", method: "" });
      }
      loadDetail(selId);
      loadList();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  // the file is read first and the user chooses, per truck, which khata its rows go into
  // (the truck's existing khata by default) — see TruckSheetImport
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const doImport = (file: File) => {
    setImportResult(null);
    setPendingFile(file);
    if (importFileRef.current) importFileRef.current.value = "";
  };
  const importDone = (r: any) => {
    setPendingFile(null);
    setImportResult(r);
    loadList();
    setSelId(null);
    setDetail(null);
  };

  const [listView, setListView] = useState<"all" | "review" | "partner">("all");
  const shown = useMemo(
    () => filtered.filter((r) => (listView === "review" ? r.needsReviewCount > 0 : listView === "partner" ? r.isPartnership : true)),
    [filtered, listView],
  );
  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] text-[#111827] bg-white";

  return (
    <div className="space-y-4">
      {pendingFile && <TruckSheetImport file={pendingFile} onCancel={() => setPendingFile(null)} onDone={importDone} showFeedback={showFeedback} />}

      <PageHeader
        title="Truck Ledgers"
        urdu="ٹرک کھاتے"
        subtitle="Every truck's khata — what came in, what went out and what is left · ہر ٹرک کا حساب"
        actions={
          <>
            <Btn kind="ghost" onClick={refreshAll} title="Refresh · تازہ کریں" icon={<RefreshCw className={listLoading ? "animate-spin" : ""} />} />
            <Btn onClick={() => setShowImport(true)} icon={<FileSpreadsheet />} title="Import your truck workbook (.xlsx) · ٹرک ورک بک">Truck workbook</Btn>
            <ModuleDataIO entityKey="truck_ledgers" label="Truck Ledgers" onImported={refreshAll} />
            <Btn kind="primary" onClick={() => setShowNew(true)} icon={<Plus />}>New ledger · نیا کھاتہ</Btn>
          </>
        }
      />

      {showNew && (
        <SidePanel title="New truck ledger · نیا ٹرک کھاتہ" subtitle="Pick a truck from the fleet or type a new number" onClose={() => setShowNew(false)}>
          <Card bodyClassName="p-4 space-y-3">
            <div className="relative">
              <label className={lbl}>
                Truck · ٹرک
                <input
                  value={truckQ}
                  onChange={(e) => { setTruckQ(e.target.value); setNewForm({ ...newForm, vehicleId: null }); }}
                  placeholder="e.g. TLD 918"
                  className={inp}
                  autoFocus
                />
              </label>
              {newForm.vehicleId && <div className="text-[11px] text-[#166534] mt-1">Fleet truck selected ✓</div>}
              {truckHits.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#E3E8EF] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {truckHits.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => { setNewForm({ ...newForm, vehicleId: v.id }); setTruckQ(v.vehicleNumber); setTruckHits([]); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[#F4F6FA] border-b border-[#F1F4F9]"
                    >
                      {v.vehicleNumber} <span className="text-[#9CA3AF] text-xs">{v.truckBrand} {v.model}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                ["title", "Ledger name (optional) · کھاتے کا نام", "text"],
                ["ownerName", "Owner / partner · مالک / پارٹنر", "text"],
                ["driverName", "Driver name · ڈرائیور کا نام", "text"],
                ["driverPhone", "Driver phone · ڈرائیور کا فون", "text"],
                ["openingBalance", "Opening balance (PKR) · ابتدائی بیلنس", "number"],
                ["openingDate", "Opening date · تاریخ", "date"],
              ] as const).map(([k, label, type]) => (
                <label key={k} className={lbl}>
                  {label}
                  <input type={type} value={(newForm as any)[k]} onChange={(e) => setNewForm({ ...newForm, [k]: e.target.value })} className={inp} dir="auto" />
                </label>
              ))}
            </div>
            <label className={lbl}>
              Notes
              <textarea value={newForm.notes} onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })} rows={2} className={inp} dir="auto" />
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[#374151]">
              <input type="checkbox" checked={newForm.isPartnership} onChange={(e) => setNewForm({ ...newForm, isPartnership: e.target.checked })} />
              Partnership truck · شراکت والا ٹرک
            </label>
          </Card>
          <div className="flex gap-2">
            <Btn kind="primary" onClick={createLedger} disabled={savingNew}>{savingNew ? "Saving…" : "Create ledger · کھاتہ بنائیں"}</Btn>
            <Btn onClick={() => setShowNew(false)}>Cancel</Btn>
          </div>
        </SidePanel>
      )}

      {showImport && (
        <SidePanel title="Import from Excel · ایکسل سے" subtitle="Your truck workbook (.xlsx)" width="lg" onClose={() => setShowImport(false)}>
          <Card bodyClassName="p-4 space-y-3">
            <p className="text-[13px] text-[#4B5563] leading-relaxed">
              Upload the same workbook you keep your truck ledgers in (<code>.xlsx</code>). The system reads every
              truck sheet, classifies each row (freight / diesel / tyre / visa / toman …), rebuilds the running
              balances and flags anything that needs a look. You choose, per truck, which khata its rows go into.
            </p>
            <Btn kind="primary" onClick={() => importFileRef.current?.click()} disabled={importBusy} icon={importBusy ? <Loader2 className="animate-spin" /> : <Upload />}>
              {importBusy ? "Importing…" : "Choose .xlsx file"}
            </Btn>
            <input ref={importFileRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
          </Card>

          {importResult && !importResult.error && (
            <Card title={<span className="flex items-center gap-2 text-[#166534]"><CheckCircle className="w-4 h-4" /> {importResult.message}</span>} bodyClassName="p-4 text-[12.5px] text-[#374151]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                <span>Ledgers: <b>{importResult.ledgersInserted ?? importResult.ledgers}</b> new / <b>{importResult.ledgersUpdated ?? 0}</b> updated</span>
                <span>Entries: <b>{importResult.entriesInserted?.toLocaleString?.() ?? importResult.entriesInserted}</b> new / <b>{importResult.entriesUpdated ?? 0}</b> upd / <b>{importResult.entriesRemoved ?? 0}</b> removed</span>
                <span>Vehicles created: <b>{importResult.vehiclesCreated}</b></span>
                <span>Need review: <b>{importResult.report?.totals?.needReview}</b></span>
                <span>Freight rows: <b>{importResult.report?.totals?.freightRows}</b></span>
                <span>Partnerships: <b>{importResult.partnershipAgreements}</b></span>
                <span>Balances reconciled: <b>{importResult.reconciliation?.matched}/{importResult.reconciliation?.total}</b></span>
                <span>Sheets skipped: <b>{importResult.report?.skippedSheets?.length}</b></span>
                <span>Expenses filed (Finance): <b>{importResult.expensesCreated ?? 0}</b> new / <b>{importResult.expensesUpdated ?? 0}</b> upd</span>
                <span>Maintenance filed (Workshop): <b>{importResult.maintenanceCreated ?? 0}</b> new / <b>{importResult.maintenanceUpdated ?? 0}</b> upd</span>
              </div>
              {Array.isArray(importResult.failedSheets) && importResult.failedSheets.length > 0 && (
                <div className="mt-3 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  <b>{importResult.failedSheets.length} sheet(s) failed</b> — the rest imported fine:
                  <ul className="list-disc pl-4 mt-1">
                    {importResult.failedSheets.slice(0, 8).map((f: any, i: number) => (
                      <li key={i}>{f.sheet}: {f.error}</li>
                    ))}
                  </ul>
                </div>
              )}
              {Array.isArray(importResult.report?.ledgers) && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[#6B7280]">Per-sheet reconciliation</summary>
                  <div className="mt-2 max-h-72 overflow-y-auto border border-[#E3E8EF] rounded-lg">
                    <table className="w-full text-[12px]">
                      <thead className="bg-[#F8FAFC] sticky top-0">
                        <tr><th className="text-left px-3 py-2">Sheet</th><th className="text-right px-3 py-2">Rows</th><th className="text-right px-3 py-2">Review</th><th className="text-right px-3 py-2">Computed close</th><th className="text-right px-3 py-2">Sheet close</th><th className="px-2"></th></tr>
                      </thead>
                      <tbody>
                        {importResult.report.ledgers.map((l: any) => (
                          <tr key={l.sheet} className={`border-t border-[#EEF1F5] ${l.closingMatches ? "" : "bg-amber-50"}`}>
                            <td className="px-3 py-1.5">{l.sheet}{l.isPartnership ? " · partner" : ""}</td>
                            <td className="px-3 py-1.5 text-right">{l.rowsImported}</td>
                            <td className="px-3 py-1.5 text-right">{l.rowsNeedReview || ""}</td>
                            <td className="px-3 py-1.5 text-right">{l.computedClosing?.toLocaleString?.()}</td>
                            <td className="px-3 py-1.5 text-right">{l.sheetClosing?.toLocaleString?.() ?? "—"}</td>
                            <td className="px-2 py-1.5">{l.closingMatches ? "✓" : "⚠"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </Card>
          )}
          {importResult?.error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-700">{importResult.error}</div>}
        </SidePanel>
      )}

      {/* the whole fleet in four figures */}
      {summary && (
        <KpiStrip
          items={[
            { label: "Truck ledgers · ٹرک کھاتے", value: summary.totals.ledgers.toLocaleString() },
            { label: "Entries · اندراجات", value: summary.totals.entries.toLocaleString() },
            { label: "Net profit · صافی بچت", value: fmt(summary.totals.netProfit), tone: summary.totals.netProfit >= 0 ? "good" : "bad" },
            {
              label: "Rows to review · نظرثانی",
              value: summary.totals.needsReview.toLocaleString(),
              tone: summary.totals.needsReview ? "warn" : "good",
              sub: summary.totals.needsReview ? "click to list the trucks" : "all clear",
              onClick: summary.totals.needsReview ? () => setListView("review") : undefined,
            },
          ]}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-4 items-start">
        {/* the trucks */}
        <Card className="overflow-hidden lg:sticky lg:top-0" bodyClassName="">
          <div className="p-2.5 border-b border-[#EEF1F5] space-y-2">
            <div className="flex items-center gap-2 border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 bg-white">
              <Search className="w-4 h-4 text-[#9CA3AF] shrink-0" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search truck / owner… · تلاش" className="text-[13px] w-full outline-none border-0 p-0 shadow-none" style={{ boxShadow: "none" }} />
            </div>
            <div className="flex gap-1">
              {([["all", `All ${filtered.length}`], ["review", "To review"], ["partner", "Partner"]] as const).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setListView(k)}
                  className={`text-[11.5px] rounded-md px-2 py-1 ${listView === k ? "bg-[#EAF0F8] text-[#24539B] font-semibold" : "text-[#6B7280] hover:bg-[#F4F6FA]"}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[38vh] lg:max-h-[calc(100vh-260px)] overflow-y-auto">
            {shown.length === 0 && <div className="p-6 text-center text-[12.5px] text-[#9CA3AF]">No truck matches · کوئی ٹرک نہیں</div>}
            {shown.map((r) => (
              <button
                key={r.id}
                onClick={() => { setSelId(r.id); setExpanded(null); }}
                className={`w-full text-left px-3.5 py-2.5 border-b border-[#F1F4F9] border-l-[3px] transition ${
                  selId === r.id ? "bg-[#EAF0F8] border-l-[#24539B]" : "border-l-transparent hover:bg-[#F8FAFC]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[13px] text-[#111827] truncate">{r.registration}</span>
                  <span className={`text-[12px] font-semibold tabular-nums whitespace-nowrap ${r.netProfit >= 0 ? "text-[#166534]" : "text-[#B91C1C]"}`}>{fmt(r.netProfit)}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[#6B7280]">
                  <span>{r.entryCount} entries</span>
                  {r.isPartnership && <span className="inline-flex items-center gap-1 text-[#4338CA]"><Handshake className="w-3 h-3" /> partner</span>}
                  {r.needsReviewCount > 0 && (
                    <span
                      onClick={(ev) => { ev.stopPropagation(); setSelId(r.id); setExpanded(null); setReviewOnly(true); }}
                      title={`${r.needsReviewCount} row(s) need checking — click to see them · دیکھنے کے لیے کلک کریں`}
                      className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-1.5 py-px font-medium cursor-pointer hover:bg-amber-200"
                    >
                      <AlertTriangle className="w-3 h-3" /> {r.needsReviewCount}
                    </span>
                  )}
                </div>
                {(r.ownerName || r.driverName) && (
                  <div className="text-[11px] text-[#9CA3AF] truncate">
                    {r.ownerName}
                    {r.ownerName && r.driverName ? " · " : ""}
                    {r.driverName ? `Driver: ${r.driverName}` : ""}
                  </div>
                )}
              </button>
            ))}
          </div>
        </Card>

        {/* the open khata */}
        <Card className="min-w-0" bodyClassName="">
          {!detail ? (
            <Empty icon={<BookOpen />} title="Pick a truck to open its khata" hint="کھاتہ کھولنے کے لیے بائیں طرف سے ٹرک منتخب کریں" />
          ) : (
            <div>
              {/* record header */}
              <div className="px-5 pt-4 pb-3 border-b border-[#EEF1F5] flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[20px] font-semibold text-[#111827] leading-tight">{detail.ledger.registration}</h2>
                    {detail.ledger.isPartnership && <span className="text-[11px] rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 inline-flex items-center gap-1"><Handshake className="w-3 h-3" /> Partnership</span>}
                  </div>
                  <p className="text-[12px] text-[#6B7280] mt-0.5">
                    {detail.ledger.title}
                    {detail.ledger.sourceSheet ? ` · sheet "${detail.ledger.sourceSheet}"` : ""}
                  </p>
                  {/* driver — filled in by hand, the workbook has no clean driver column */}
                  <div className="mt-1.5 text-[12.5px]">
                    {editingDriver ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input value={driverForm.driverName} onChange={(e) => setDriverForm({ ...driverForm, driverName: e.target.value })} placeholder="Driver name · ڈرائیور کا نام" className="border border-[#CBD5E1] rounded-md px-2 py-1 text-[12.5px]" dir="auto" />
                        <input value={driverForm.driverPhone} onChange={(e) => setDriverForm({ ...driverForm, driverPhone: e.target.value })} placeholder="Phone" className="border border-[#CBD5E1] rounded-md px-2 py-1 text-[12.5px]" dir="ltr" />
                        <Btn size="sm" kind="primary" onClick={saveDriver} disabled={savingDriver}>{savingDriver ? "Saving…" : "Save"}</Btn>
                        <Btn size="sm" kind="ghost" onClick={() => setEditingDriver(false)}>Cancel</Btn>
                      </div>
                    ) : (
                      <button onClick={() => setEditingDriver(true)} className="inline-flex items-center gap-1.5 text-left hover:text-[#24539B] group">
                        <span className="text-[#6B7280]">Driver:</span>
                        <span className="font-medium text-[#1F2937]" dir="auto">{detail.ledger.driverName || "not set — click to add"}</span>
                        {detail.ledger.driverPhone && <span className="text-[#9CA3AF]" dir="ltr">· {detail.ledger.driverPhone}</span>}
                        <Pencil className="w-3 h-3 text-[#9CA3AF] group-hover:text-[#24539B]" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Btn kind="primary" onClick={() => setShowAdd((s) => !s)} icon={<Plus />}>Add entry · اندراج</Btn>
                  <Btn kind="danger" size="md" onClick={deleteLedger} title="Delete this whole ledger (sheet) and all its entries" icon={<Trash2 />} />
                </div>
              </div>

              <div className="p-5 space-y-4">
                {/* opening + received − paid = balance now */}
                <BalanceFlow
                  mode="truck"
                  balance={detail.balance}
                  period={period}
                  onPeriod={setPeriod}
                  onSaveOpening={async (amount, date) => {
                    try {
                      await enterpriseFetch(`/api/ledgers/${selId}/opening`, { method: "PUT", body: JSON.stringify({ amount, date }) });
                      showFeedback("success", "Opening balance saved · ابتدائی بیلنس محفوظ");
                      if (selId != null) loadDetail(selId);
                      loadList();
                    } catch (e: any) {
                      showFeedback("error", e.message);
                      throw e;
                    }
                  }}
                />

                {detail.partnerAgreement && (
                  <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2.5 text-[12.5px] text-indigo-900">
                    <div className="font-semibold flex items-center gap-1.5"><Handshake className="w-3.5 h-3.5" /> Partnership {detail.partnerAgreement.agreementNumber}</div>
                    <div className="mt-1 grid grid-cols-3 gap-2">
                      <span>Price: {fmt(detail.partnerAgreement.agreedPrice)}</span>
                      <span>Advance: {fmt(detail.partnerAgreement.advancePaid)}</span>
                      <span>Balance: {fmt(detail.partnerAgreement.currentBalance)}</span>
                    </div>
                  </div>
                )}

                {showAdd && (
                  <div className="rounded-xl border border-[#C9D7EC] bg-[#F7F9FD] p-4">
                    <div className="text-[13px] font-semibold text-[#1F2937] mb-3">New entry · نیا اندراج</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <label className={lbl}>Date · تاریخ<input type="date" value={form.entryDate} onChange={(e) => setForm({ ...form, entryDate: e.target.value })} className={inp} /></label>
                      <label className={lbl}>Category · قسم
                        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inp}>
                          {CATS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
                        </select>
                      </label>
                      <label className={lbl}>Received (in) · آیا<input inputMode="decimal" value={form.received} onChange={(e) => setForm({ ...form, received: e.target.value })} className={inp} placeholder="0" /></label>
                      <label className={lbl}>Paid (out) · گیا<input inputMode="decimal" value={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.value })} className={inp} placeholder="0" /></label>
                      <label className={`${lbl} col-span-2 md:col-span-3`}>Description · تفصیل<input dir="auto" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inp} /></label>
                      <label className={lbl}>Method · طریقہ<input placeholder="Cash / Online…" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className={inp} /></label>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Btn kind="primary" onClick={addEntry} icon={<CheckCircle />}>Save entry</Btn>
                      <Btn onClick={() => setShowAdd(false)}>Cancel</Btn>
                    </div>
                  </div>
                )}

                {dupWarn && (
                  <div className="rounded-lg border border-red-300 bg-red-50 text-red-800 px-3 py-2 text-[12.5px] flex items-start gap-2" dir="auto">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span className="flex-1"><b>Possible duplicate — </b>{dupWarn}</span>
                    <button onClick={() => setDupWarn(null)} className="shrink-0 font-bold">✕</button>
                  </div>
                )}

                {/* filter the entries */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => setCatFilter("")}
                    className={`text-[12px] rounded-full px-2.5 py-1 border ${catFilter === "" ? "bg-[#24539B] border-[#24539B] text-white" : "bg-white border-[#E3E8EF] text-[#4B5563] hover:bg-[#F4F6FA]"}`}
                  >
                    All
                  </button>
                  {detail.pnl.byCategory.map((c) => (
                    <button
                      key={c.category}
                      onClick={() => setCatFilter(catFilter === c.category ? "" : c.category)}
                      className={`text-[12px] rounded-full px-2.5 py-1 border ${catFilter === c.category ? "bg-[#24539B] border-[#24539B] text-white" : "bg-white border-[#E3E8EF] text-[#4B5563] hover:bg-[#F4F6FA]"}`}
                    >
                      {catLabel(c.category)} <span className="opacity-60">{c.entries}</span>
                    </button>
                  ))}
                  <label className="text-[12px] flex items-center gap-1.5 ml-auto text-[#B45309]">
                    <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
                    Needs review only · صرف نظرثانی والی
                  </label>
                </div>

                {(reviewOnly || detail.entries.some((e) => e.needsReview)) && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 flex items-start gap-2" dir="auto">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      <b>Review rows</b> are rows the Excel import found doubtful — the date could not be read, or the
                      amount / running balance did not match the sheet. The reason is under each row; edit the row to fix it. ·
                      یہ وہ سطریں ہیں جو امپورٹ کے دوران مشکوک لگیں۔
                    </span>
                  </div>
                )}

                {/* entries */}
                {loading ? (
                  <div className="text-[13px] text-[#9CA3AF] flex items-center gap-2 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
                ) : (
                  <div className="overflow-x-auto border border-[#E3E8EF] rounded-lg">
                    <table className="w-full text-[12.5px]">
                      <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]">
                        <tr className="border-b border-[#E3E8EF]">
                          <th className="text-left px-3 py-2"><DateHead newestFirst={newestFirst} onToggle={toggleNewest} /></th>
                          <th className="text-left px-3 py-2">Description</th>
                          <th className="text-left px-3 py-2 hidden xl:table-cell">Category</th>
                          <th className="text-right px-3 py-2">In · آیا</th>
                          <th className="text-right px-3 py-2">Out · گیا</th>
                          <th className="text-right px-3 py-2">Balance</th>
                          <th className="px-2 w-[76px]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.entries.length === 0 && (
                          <tr><td colSpan={7} className="px-3 py-8 text-center text-[#9CA3AF]">No entries in this period · اس مدت میں کوئی اندراج نہیں</td></tr>
                        )}
                        {inOrder<any>(detail.entries, newestFirst).map((e) => (
                          <React.Fragment key={e.id}>
                            <tr
                              id={`truck-entry-${e.id}`}
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
                              <td className="px-3 py-2 whitespace-nowrap text-[#4B5563] tabular-nums align-top">
                                {e.entryDate ? e.entryDate.slice(0, 10) : <span className="text-amber-700" title={e.rawDate || ""}>{e.rawDate || "—"}</span>}
                              </td>
                              <td className="px-3 py-2 max-w-[240px] align-top">
                                <div className="truncate text-[#1F2937]" dir="auto" title={e.description || ""}>{e.description || "—"}</div>
                                <span className={`xl:hidden inline-block mt-0.5 rounded-full px-1.5 text-[10.5px] ${catClass(e.category)}`}>{catLabel(e.category)}</span>
                                {(e.routeFrom || e.routeTo) && (
                                  <div className="text-[11px] text-[#9CA3AF]">{e.routeFrom} → {e.routeTo}{e.cargo ? ` · ${e.cargo}` : ""}</div>
                                )}
                                {e.trip && (
                                  <div className="text-[11px] text-[#24539B] whitespace-nowrap" title={e.trip.tagged ? "Typed through this trip" : "Dated inside this trip's days (from the day it left until the truck's next trip)"}>
                                    🚚 Trip {e.trip.label}{e.trip.tagged ? "" : " · دنوں میں"}
                                  </div>
                                )}
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
                              <td className="px-3 py-2 align-top hidden xl:table-cell"><span className={`rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap ${catClass(e.category)}`}>{catLabel(e.category)}</span></td>
                              <td className="px-3 py-2 text-right tabular-nums text-[#166534] align-top">{e.received ? e.received.toLocaleString() : ""}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-[#B91C1C] align-top">
                                {(e as any).fromCash ? (
                                  <span className="text-[#9CA3AF] text-[11.5px] whitespace-nowrap" title="Paid by the driver out of the cash above — not a second payment">↳ {(e as any).fromCash.toLocaleString()} from cash</span>
                                ) : (e as any).shownPaid ?? e.paid ? (
                                  ((e as any).shownPaid ?? e.paid).toLocaleString()
                                ) : (
                                  ""
                                )}
                              </td>
                              <td className={`px-3 py-2 text-right tabular-nums font-medium align-top ${((e as any).shownBalance ?? e.runningBalance) < 0 ? "text-[#B91C1C]" : "text-[#111827]"}`}>{((e as any).shownBalance ?? e.runningBalance).toLocaleString()}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap text-right align-top">
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
                              <tr className="bg-[#F4F7FC]">
                                <td colSpan={7} className="px-4 pb-4 pt-1">
                                  {e.needsReview && e.reviewReason && (
                                    <p className="text-[12px] text-amber-800 mb-2 flex items-center gap-1">
                                      <AlertTriangle className="w-3.5 h-3.5" /> {e.reviewReason}
                                    </p>
                                  )}

                                  {editId === e.id ? (
                                    <div className="rounded-xl border border-[#C9D7EC] bg-white p-4 mb-3">
                                      <div className="text-[13px] font-semibold text-[#1F2937] mb-3 flex items-center gap-1.5">
                                        <Pencil className="w-3.5 h-3.5 text-[#24539B]" /> Edit entry · اندراج درست کریں
                                      </div>
                                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <label className={lbl}>Date
                                          <input type="date" value={editForm.entryDate} onChange={(ev) => setEditForm({ ...editForm, entryDate: ev.target.value })} className={inp} />
                                        </label>
                                        <label className={lbl}>Category
                                          <select value={editForm.category} onChange={(ev) => setEditForm({ ...editForm, category: ev.target.value })} className={inp}>
                                            {CATS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
                                          </select>
                                        </label>
                                        <label className={lbl}>Received (in)
                                          <input value={editForm.received} onChange={(ev) => setEditForm({ ...editForm, received: ev.target.value })} className={inp} />
                                        </label>
                                        <label className={lbl}>Paid (out)
                                          <input value={editForm.paid} onChange={(ev) => setEditForm({ ...editForm, paid: ev.target.value })} className={inp} />
                                        </label>
                                        <label className={`${lbl} col-span-2 md:col-span-3`}>Description
                                          <input dir="auto" value={editForm.description} onChange={(ev) => setEditForm({ ...editForm, description: ev.target.value })} className={inp} />
                                        </label>
                                        <label className={lbl}>Method
                                          <input value={editForm.method} onChange={(ev) => setEditForm({ ...editForm, method: ev.target.value })} className={inp} />
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
                                    </div>
                                  ) : null}
                                  <EntryOrigin kind="tle" id={e.id} onNavigate={onNavigate} />
                                  <AttachmentPanel entityType="truck_ledger_entry" entityId={e.id} title="Receipts for this entry" />
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
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

