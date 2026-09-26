import React, { useEffect, useMemo, useRef, useState } from "react";
import { enterpriseFetch, uploadFile } from "../../../client/api.ts";
import AttachmentPanel from "../common/AttachmentPanel.tsx";
import ModuleDataIO from "../common/ModuleDataIO.tsx";
import {
  BookOpen, Search, AlertTriangle, Plus, Loader2, TrendingUp, TrendingDown,
  ChevronDown, ChevronRight, Handshake, Upload, FileSpreadsheet, CheckCircle, RefreshCw,
  Pencil, Trash2,
} from "lucide-react";

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
}: {
  showFeedback: (type: "success" | "error", message: string) => void;
  focusLedgerId?: number;
}) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LedgerDetail | null>(null);
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

  const loadDetail = (id: number) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (catFilter) params.set("category", catFilter);
    if (reviewOnly) params.set("needsReview", "1");
    enterpriseFetch(`/api/ledgers/${id}?${params}`)
      .then(setDetail)
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (selId != null) loadDetail(selId);
  }, [selId, catFilter, reviewOnly]); // eslint-disable-line react-hooks/exhaustive-deps

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
      paid: e.paid || "",
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
          paid: Number(editForm.paid) || 0,
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

  const doImport = async (file: File) => {
    setImportBusy(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await uploadFile("/api/ledgers/import-workbook", fd);
      setImportResult(r);
      showFeedback("success", r.message || "Workbook imported");
      loadList();
      setSelId(null);
      setDetail(null);
    } catch (e: any) {
      showFeedback("error", e.message || "Import failed");
      setImportResult({ error: e.message });
    } finally {
      setImportBusy(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold flex items-center gap-2">
          <BookOpen className="w-4 h-4" /> Truck Ledgers <span className="text-[#9CA3AF] font-normal text-sm">· ٹرک کھاتہ</span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNew((s) => !s)}
            className="flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <Plus className="w-3.5 h-3.5" /> New Ledger <span className="opacity-80">نیا کھاتہ</span>
          </button>
          <ModuleDataIO entityKey="truck_ledgers" label="Truck Ledgers" onImported={refreshAll} />
          <button
            onClick={refreshAll}
            className="flex items-center gap-1.5 text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${listLoading ? "animate-spin" : ""}`} /> Refresh <span className="text-[#9CA3AF]">تازہ کریں</span>
          </button>
        </div>
      </div>

      {showNew && (
        <div className="border border-emerald-200 rounded-xl bg-white p-4 space-y-3">
          <div className="text-sm font-bold text-slate-800">New truck ledger · نیا ٹرک کھاتہ</div>
          <div className="relative">
            <label className="text-[11px] font-semibold text-slate-500">Truck (search the fleet or type a new number) · ٹرک</label>
            <input
              value={truckQ}
              onChange={(e) => { setTruckQ(e.target.value); setNewForm({ ...newForm, vehicleId: null }); }}
              placeholder="e.g. TLD 918"
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            {newForm.vehicleId && <div className="text-[11px] text-emerald-700 mt-1">Fleet truck selected ✓</div>}
            {truckHits.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow max-h-48 overflow-y-auto">
                {truckHits.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => { setNewForm({ ...newForm, vehicleId: v.id }); setTruckQ(v.vehicleNumber); setTruckHits([]); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50"
                  >
                    {v.vehicleNumber} <span className="text-slate-400 text-xs">{v.truckBrand} {v.model}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {([
              ["title", "Ledger name (optional) · کھاتے کا نام", "text"],
              ["ownerName", "Owner / partner · مالک / پارٹنر", "text"],
              ["driverName", "Driver name · ڈرائیور کا نام", "text"],
              ["driverPhone", "Driver phone · ڈرائیور کا فون", "text"],
              ["openingBalance", "Opening balance (PKR) · ابتدائی بیلنس", "number"],
              ["openingDate", "Opening date", "date"],
            ] as const).map(([k, label, type]) => (
              <div key={k}>
                <label className="text-[11px] font-semibold text-slate-500">{label}</label>
                <input
                  type={type}
                  value={(newForm as any)[k]}
                  onChange={(e) => setNewForm({ ...newForm, [k]: e.target.value })}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500">Notes</label>
            <textarea
              value={newForm.notes}
              onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })}
              rows={2}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={newForm.isPartnership} onChange={(e) => setNewForm({ ...newForm, isPartnership: e.target.checked })} />
            Partnership truck
          </label>
          <div className="flex gap-2">
            <button onClick={createLedger} disabled={savingNew} className="text-sm font-semibold rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">
              {savingNew ? "Saving…" : "Create ledger · کھاتہ بنائیں"}
            </button>
            <button onClick={() => setShowNew(false)} className="text-sm rounded-lg border border-slate-300 px-4 py-2 bg-white">Cancel</button>
          </div>
        </div>
      )}

      {/* Excel import */}
      <div className="border border-slate-200 rounded-xl bg-white">
        <button
          onClick={() => setShowImport((s) => !s)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700"
        >
          <span className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            Import from Excel (your truck workbook)
          </span>
          {showImport ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {showImport && (
          <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-3">
            <p className="text-[12px] text-slate-500">
              Upload the same workbook you keep your truck ledgers in (<code>.xlsx</code>). The system reads every
              truck sheet, classifies each row (freight / diesel / tyre / visa / toman …), rebuilds the running
              balances and flags anything that needs a look. Re-uploading replaces the previous import.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => importFileRef.current?.click()}
                disabled={importBusy}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg px-4 py-2 flex items-center gap-2 disabled:opacity-50"
              >
                {importBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {importBusy ? "Importing…" : "Choose .xlsx file"}
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
              />
            </div>

            {importResult && !importResult.error && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-[12px] text-slate-700">
                <div className="flex items-center gap-2 font-semibold text-emerald-800">
                  <CheckCircle className="w-4 h-4" /> {importResult.message}
                </div>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                  <div className="mt-2 text-[11px] text-amber-800 bg-amber-100 rounded p-2">
                    <b>{importResult.failedSheets.length} sheet(s) failed</b> — the rest imported fine:
                    <ul className="list-disc pl-4 mt-1">
                      {importResult.failedSheets.slice(0, 8).map((f: any, i: number) => (
                        <li key={i}>{f.sheet}: {f.error}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(importResult.report?.ledgers) && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-slate-500">per-sheet reconciliation</summary>
                    <div className="mt-1 max-h-56 overflow-y-auto border border-slate-200 rounded">
                      <table className="w-full text-[11px]">
                        <thead className="bg-slate-100 text-slate-500 sticky top-0">
                          <tr><th className="text-left px-2 py-1">Sheet</th><th className="text-right px-2 py-1">Rows</th><th className="text-right px-2 py-1">Review</th><th className="text-right px-2 py-1">Computed close</th><th className="text-right px-2 py-1">Sheet close</th><th className="px-2"></th></tr>
                        </thead>
                        <tbody>
                          {importResult.report.ledgers.map((l: any) => (
                            <tr key={l.sheet} className={`border-t border-slate-100 ${l.closingMatches ? "" : "bg-amber-50/60"}`}>
                              <td className="px-2 py-1">{l.sheet}{l.isPartnership ? " · partner" : ""}</td>
                              <td className="px-2 py-1 text-right">{l.rowsImported}</td>
                              <td className="px-2 py-1 text-right">{l.rowsNeedReview || ""}</td>
                              <td className="px-2 py-1 text-right">{l.computedClosing?.toLocaleString?.()}</td>
                              <td className="px-2 py-1 text-right">{l.sheetClosing?.toLocaleString?.() ?? "—"}</td>
                              <td className="px-2 py-1">{l.closingMatches ? "✓" : "⚠"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
            )}
            {importResult?.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{importResult.error}</div>
            )}
          </div>
        )}
      </div>

      {/* portfolio summary */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Truck ledgers · ٹرک کھاتے" value={summary.totals.ledgers} />
          <Stat label="Total entries · کل اندراجات" value={summary.totals.entries.toLocaleString()} />
          <Stat label="Net profit · صافی بچت" value={fmt(summary.totals.netProfit)} tone={summary.totals.netProfit >= 0 ? "good" : "bad"} />
          <Stat label="Rows to review · نظرثانی" value={summary.totals.needsReview} tone={summary.totals.needsReview ? "warn" : "good"} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {/* list */}
        <div className="border border-slate-200 rounded-xl bg-white overflow-hidden md:sticky md:top-4">
          <div className="p-3 border-b border-slate-100 flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search truck / owner…"
              className="text-sm w-full outline-none"
            />
          </div>
          <div className="max-h-[38vh] md:max-h-[75vh] overflow-y-auto">
            {filtered.map((r) => (
              <button
                key={r.id}
                onClick={() => { setSelId(r.id); setExpanded(null); }}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-50 hover:bg-slate-50 transition ${
                  selId === r.id ? "bg-emerald-50" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-800">{r.registration}</span>
                  <span className={`text-xs font-semibold ${r.netProfit >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {fmt(r.netProfit)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                  <span>{r.entryCount} entries</span>
                  {r.isPartnership && (
                    <span className="inline-flex items-center gap-1 text-indigo-600"><Handshake className="w-3 h-3" /> partner</span>
                  )}
                  {r.needsReviewCount > 0 && (
                    <span
                      onClick={(ev) => { ev.stopPropagation(); setSelId(r.id); setExpanded(null); setReviewOnly(true); }}
                      title={`${r.needsReviewCount} row(s) need checking — click to see them · دیکھنے کے لیے کلک کریں`}
                      className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 font-semibold cursor-pointer hover:bg-amber-200"
                    >
                      <AlertTriangle className="w-3 h-3" /> {r.needsReviewCount} to review
                    </span>
                  )}
                </div>
                {(r.ownerName || r.driverName) && (
                  <div className="text-[10px] text-slate-400 truncate">
                    {r.ownerName}
                    {r.ownerName && r.driverName ? " · " : ""}
                    {r.driverName ? `Driver: ${r.driverName}` : ""}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* detail */}
        <div className="md:col-span-2 border border-slate-200 rounded-xl bg-white">
          {!detail ? (
            <div className="p-10 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
              <BookOpen className="w-8 h-8" />
              Pick a truck to open its ledger · کھاتہ کھولنے کے لیے ٹرک منتخب کریں
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{detail.ledger.registration}</h3>
                  <p className="text-xs text-slate-500">
                    {detail.ledger.title}
                    {detail.ledger.sourceSheet ? ` · sheet "${detail.ledger.sourceSheet}"` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAdd((s) => !s)}
                    className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add entry
                  </button>
                  <button
                    onClick={deleteLedger}
                    title="Delete this whole ledger (sheet) and all its entries"
                    className="text-xs font-semibold border border-red-200 text-red-600 hover:bg-red-50 rounded-lg px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete ledger
                  </button>
                </div>
              </div>

              {/* driver — the source workbook has no clean "driver" column,
                  so this is filled in by hand, not extracted */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs">
                {editingDriver ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={driverForm.driverName}
                      onChange={(e) => setDriverForm({ ...driverForm, driverName: e.target.value })}
                      placeholder="Driver name · ڈرائیور کا نام"
                      className="border border-slate-300 rounded px-2 py-1 text-xs"
                      dir="auto"
                    />
                    <input
                      value={driverForm.driverPhone}
                      onChange={(e) => setDriverForm({ ...driverForm, driverPhone: e.target.value })}
                      placeholder="Phone"
                      className="border border-slate-300 rounded px-2 py-1 text-xs"
                      dir="ltr"
                    />
                    <button onClick={saveDriver} disabled={savingDriver} className="text-emerald-700 font-semibold px-2 py-1 rounded bg-emerald-100 hover:bg-emerald-200 disabled:opacity-50">
                      {savingDriver ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => setEditingDriver(false)} className="text-slate-500 px-2 py-1">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setEditingDriver(true)} className="flex items-center gap-2 text-left w-full hover:text-emerald-700">
                    <span className="text-slate-500">Driver:</span>
                    <span className="font-semibold" dir="auto">
                      {detail.ledger.driverName || "— not set, click to add"}
                    </span>
                    {detail.ledger.driverPhone && <span className="text-slate-400" dir="ltr">· {detail.ledger.driverPhone}</span>}
                    <Pencil className="w-3 h-3 text-slate-400" />
                  </button>
                )}
              </div>

              {/* P&L */}
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Received" value={fmt(detail.pnl.totalReceived)} tone="good" icon={<TrendingUp className="w-3.5 h-3.5" />} />
                <Stat label="Paid" value={fmt(detail.pnl.totalPaid)} tone="bad" icon={<TrendingDown className="w-3.5 h-3.5" />} />
                <Stat label="Net profit · صافی بچت" value={fmt(detail.pnl.netProfit)} tone={detail.pnl.netProfit >= 0 ? "good" : "bad"} />
              </div>

              {detail.partnerAgreement && (
                <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3 text-xs text-indigo-900">
                  <div className="font-semibold flex items-center gap-1.5"><Handshake className="w-3.5 h-3.5" /> Partnership {detail.partnerAgreement.agreementNumber}</div>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    <span>Price: {fmt(detail.partnerAgreement.agreedPrice)}</span>
                    <span>Advance: {fmt(detail.partnerAgreement.advancePaid)}</span>
                    <span>Balance: {fmt(detail.partnerAgreement.currentBalance)}</span>
                  </div>
                </div>
              )}

              {/* category chips */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setCatFilter("")}
                  className={`text-[11px] rounded-full px-2 py-0.5 ${catFilter === "" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  all
                </button>
                {detail.pnl.byCategory.map((c) => (
                  <button
                    key={c.category}
                    onClick={() => setCatFilter(catFilter === c.category ? "" : c.category)}
                    className={`text-[11px] rounded-full px-2 py-0.5 ${catFilter === c.category ? "ring-2 ring-slate-800 " : ""}${catClass(c.category)}`}
                  >
                    {catLabel(c.category)} · {c.entries}
                  </button>
                ))}
                <label className="text-[11px] flex items-center gap-1 ml-auto text-amber-700">
                  <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
                  needs review only · صرف نظرثانی والی
                </label>
              </div>

              {(reviewOnly || detail.entries.some((e) => e.needsReview)) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 flex items-start gap-2" dir="auto">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    <b>What are "review" rows?</b> Rows the Excel import found doubtful — the date could not be read,
                    or the amount / running-balance did not match the sheet's own balance. The reason is shown in
                    <b> red</b> under each such row below. Edit the row to fix it. ·
                    یہ وہ سطریں ہیں جو امپورٹ کے دوران مشکوک لگیں — تاریخ نہ پڑھی گئی یا بیلنس میل نہیں کھایا۔
                  </span>
                </div>
              )}

              {dupWarn && (
                <div className="rounded-lg border border-red-300 bg-red-600 text-white px-3 py-2 text-[12px] flex items-start gap-2" dir="auto">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#fff", stroke: "#fff" }} />
                  <span className="flex-1"><b>DUPLICATE — </b>{dupWarn}</span>
                  <button onClick={() => setDupWarn(null)} className="shrink-0 font-bold">✕</button>
                </div>
              )}

              {showAdd && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  <input type="date" value={form.entryDate} onChange={(e) => setForm({ ...form, entryDate: e.target.value })} className="border rounded px-2 py-1" />
                  <input placeholder="Method (Cash/Online…)" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="border rounded px-2 py-1" />
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="border rounded px-2 py-1">
                    {CATS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
                  </select>
                  <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="border rounded px-2 py-1 col-span-2 md:col-span-3" />
                  <input placeholder="Received (in)" value={form.received} onChange={(e) => setForm({ ...form, received: e.target.value })} className="border rounded px-2 py-1" />
                  <input placeholder="Paid (out)" value={form.paid} onChange={(e) => setForm({ ...form, paid: e.target.value })} className="border rounded px-2 py-1" />
                  <button onClick={addEntry} className="bg-emerald-600 text-white rounded px-3 py-1 font-semibold">Save entry</button>
                </div>
              )}

              {/* entries */}
              {loading ? (
                <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> loading…</div>
              ) : (
                <div className="overflow-x-auto border border-slate-100 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left px-2 py-1.5">Date</th>
                        <th className="text-left px-2 py-1.5">Description</th>
                        <th className="text-left px-2 py-1.5">Cat</th>
                        <th className="text-right px-2 py-1.5">In</th>
                        <th className="text-right px-2 py-1.5">Out</th>
                        <th className="text-right px-2 py-1.5">Balance</th>
                        <th className="px-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.entries.map((e) => (
                        <React.Fragment key={e.id}>
                          <tr className={`border-t border-slate-50 ${e.needsReview ? "bg-amber-50/50" : ""}`}>
                            <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">
                              {e.entryDate ? e.entryDate.slice(0, 10) : <span className="text-amber-600" title={e.rawDate || ""}>{e.rawDate || "—"}</span>}
                            </td>
                            <td className="px-2 py-1.5 max-w-[240px]">
                              <div className="truncate" dir="auto" title={e.description || ""}>{e.description || "—"}</div>
                              {(e.routeFrom || e.routeTo) && (
                                <div className="text-[10px] text-slate-400">{e.routeFrom} → {e.routeTo}{e.cargo ? ` · ${e.cargo}` : ""}</div>
                              )}
                              {e.needsReview && (
                                <div className="text-[10px] text-red-600 flex items-start gap-1 mt-0.5">
                                  <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                                  <span>{e.reviewReason || "Row flagged as doubtful during import · امپورٹ کے دوران مشکوک سطر"}</span>
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[10px] ${catClass(e.category)}`}>{catLabel(e.category)}</span></td>
                            <td className="px-2 py-1.5 text-right text-emerald-700">{e.received ? e.received.toLocaleString() : ""}</td>
                            <td className="px-2 py-1.5 text-right text-red-600">{e.paid ? e.paid.toLocaleString() : ""}</td>
                            <td className={`px-2 py-1.5 text-right font-medium ${e.runningBalance < 0 ? "text-red-600" : "text-slate-700"}`}>{e.runningBalance.toLocaleString()}</td>
                            <td className="px-1 whitespace-nowrap">
                              <button onClick={() => startEdit(e)} title="Edit this entry · اندراج درست کریں" className="text-slate-400 hover:text-emerald-700 p-0.5">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => deleteEntry(e.id)} title="Delete this entry · اندراج حذف کریں" className="text-slate-400 hover:text-red-600 p-0.5">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => { setEditId(null); setExpanded(expanded === e.id ? null : e.id); }} className="text-slate-400 hover:text-slate-700 p-0.5">
                                {expanded === e.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                          </tr>
                          {expanded === e.id && (
                            <tr>
                              <td colSpan={7} className="px-3 py-2 bg-slate-50/60">
                                {e.needsReview && e.reviewReason && (
                                  <p className="text-[11px] text-amber-700 mb-2 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" /> {e.reviewReason}
                                  </p>
                                )}

                                {editId === e.id ? (
                                  <div className="rounded-lg border border-emerald-300 bg-white p-3 mb-3">
                                    <div className="text-[11px] font-bold text-emerald-800 mb-2 flex items-center gap-1.5">
                                      <Pencil className="w-3 h-3" /> Edit entry · اندراج درست کریں
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                                      <label className="flex flex-col text-[10px] text-slate-500">Date
                                        <input type="date" value={editForm.entryDate} onChange={(ev) => setEditForm({ ...editForm, entryDate: ev.target.value })} className="border rounded px-2 py-1 text-slate-800" />
                                      </label>
                                      <label className="flex flex-col text-[10px] text-slate-500">Method
                                        <input value={editForm.method} onChange={(ev) => setEditForm({ ...editForm, method: ev.target.value })} className="border rounded px-2 py-1 text-slate-800" />
                                      </label>
                                      <label className="flex flex-col text-[10px] text-slate-500">Category
                                        <select value={editForm.category} onChange={(ev) => setEditForm({ ...editForm, category: ev.target.value })} className="border rounded px-2 py-1 text-slate-800">
                                          {CATS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
                                        </select>
                                      </label>
                                      <label className="flex flex-col text-[10px] text-slate-500 col-span-2 md:col-span-3">Description
                                        <input dir="auto" value={editForm.description} onChange={(ev) => setEditForm({ ...editForm, description: ev.target.value })} className="border rounded px-2 py-1 text-slate-800" />
                                      </label>
                                      <label className="flex flex-col text-[10px] text-slate-500">Received (in)
                                        <input value={editForm.received} onChange={(ev) => setEditForm({ ...editForm, received: ev.target.value })} className="border rounded px-2 py-1 text-emerald-700" />
                                      </label>
                                      <label className="flex flex-col text-[10px] text-slate-500">Paid (out)
                                        <input value={editForm.paid} onChange={(ev) => setEditForm({ ...editForm, paid: ev.target.value })} className="border rounded px-2 py-1 text-red-600" />
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
                                  </div>
                                ) : null}
                                <div className="text-[11px] text-slate-500 mb-2 flex flex-wrap gap-x-4 gap-y-0.5">
                                  <span>Section: {e.sectionLabel}</span>
                                  {e.method && <span>Method: {e.method}</span>}
                                  {e.partyFrom && <span>From: {e.partyFrom}</span>}
                                  {e.partyTo && <span>To: {e.partyTo}</span>}
                                  {e.sheetBalance != null && <span>Sheet balance: {e.sheetBalance.toLocaleString()}</span>}
                                </div>
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
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, icon }: { label: string; value: React.ReactNode; tone?: "good" | "bad" | "warn"; icon?: React.ReactNode }) {
  const toneCls = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-slate-800";
  return (
    <div className="border border-slate-200 rounded-xl bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 flex items-center gap-1">{icon}{label}</div>
      <div className={`text-lg font-bold ${toneCls}`}>{value}</div>
    </div>
  );
}
