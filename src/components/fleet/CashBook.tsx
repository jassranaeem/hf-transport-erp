/**
 * Daily Cash Book — log every cash in/out for the day (who, how much), and
 * see the running balance update live. Each day runs midnight to midnight;
 * the opening balance is just the running total of everything before today,
 * so nothing needs to be re-entered each morning.
 *
 *   /api/cash-book/day?date=YYYY-MM-DD   one day's opening/entries/closing
 *   /api/cash-book                       create
 *   /api/cash-book/:id                   edit / delete
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { enterpriseFetch, uploadFile } from "../../../client/api.ts";
import ModuleDataIO from "../common/ModuleDataIO.tsx";
import AttachmentPanel from "../common/AttachmentPanel.tsx";
import { Wallet, RefreshCw, Loader2, Plus, Pencil, Trash2, CheckCircle, X, ArrowDownCircle, ArrowUpCircle, FileSpreadsheet, ChevronLeft, ChevronRight, Upload } from "lucide-react";
import { PageHeader, Btn, Card, KpiStrip, SidePanel, Empty } from "../ui/kit.tsx";
import { useNewestFirst, inOrder, DateHead } from "../common/NewestFirst.tsx";
import { CashCountPanel, CashSummary } from "./CashCount.tsx";
import KhataKindPicker, { KhataBuckets, KhataKindValue } from "./KhataKindPicker.tsx";
import { kindOf, bucketTotals, catLabel, INCOME_CATS, EXPENSE_CATS, KhataKind } from "../../lib/khataKinds.ts";

const PKR = (n: number) => "PKR " + Math.round(Math.abs(n || 0)).toLocaleString();
const today = () => new Date().toISOString().slice(0, 10);

const BLANK = { direction: "Out", amount: "", person: "", description: "", notes: "", linkType: "", linkTargetId: "", linkCategory: "" };
interface LinkOptions {
  trucks: { id: number; registration: string }[];
  parties: { id: number; name: string }[];
  loading?: boolean; // the truck / party list is being fetched
  error?: string; // why it could not be (shown, with a Try again)
  reload?: () => void;
}

export default function CashBook({
  showFeedback,
  onNavigate,
  focusDate,
}: {
  focusDate?: string; // open on this day (a link from the books check)
  showFeedback: (t: "success" | "error", m: string) => void;
  onNavigate?: (wb: string, sheet: string, focus?: { ledgerId?: number; partyId?: number; entryId?: number }) => void;
}) {
  const [date, setDate] = useState(focusDate || today());
  useEffect(() => {
    if (focusDate) setDate(focusDate);
  }, [focusDate]);
  const [links, setLinks] = useState<LinkOptions>({ trucks: [], parties: [], loading: true });
  const [data, setData] = useState<any>(null);
  const [countVersion, setCountVersion] = useState(0); // re-read the count when the day's entries change
  const [newestFirst, toggleNewest] = useNewestFirst();
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  // one form, several lines (some In, some Out): they are saved together as a voucher
  const [lines, setLines] = useState<any[]>([BLANK]);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [showImport, setShowImport] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    enterpriseFetch(`/api/cash-book/day?date=${date}`)
      .then((r) => {
        setData(r);
        setCountVersion((v) => v + 1);
      })
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [date, showFeedback]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    loadLinks();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the trucks and parties to pick from — asked for again if the server was asleep or the request failed
  // (it used to be asked once, and a failure left the list empty with no word of why)
  const loadLinks = useCallback(async () => {
    setLinks((l) => ({ ...l, loading: true, error: undefined }));
    let err = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await enterpriseFetch("/api/cash-book/link-options");
        setLinks({ trucks: r.trucks || [], parties: r.parties || [] });
        return;
      } catch (e: any) {
        err = e?.message || "Could not load the list";
        if (attempt < 2) await new Promise((res) => setTimeout(res, 3000));
      }
    }
    setLinks((l) => ({ ...l, loading: false, error: err }));
  }, []);
  const linkOptions: LinkOptions = { ...links, reload: loadLinks };

  const filledLines = lines.filter((l) => Number(l.amount) > 0);
  const vIn = filledLines.filter((l) => l.direction === "In").reduce((s, l) => s + Number(l.amount), 0);
  const vOut = filledLines.filter((l) => l.direction !== "In").reduce((s, l) => s + Number(l.amount), 0);
  // the next line starts from the last one: same person / truck / party, the other direction
  const addLine = () =>
    setLines((ls) => {
      const last = ls[ls.length - 1];
      return [...ls, { ...BLANK, direction: last.direction === "In" ? "Out" : "In", person: last.person, linkType: last.linkType, linkTargetId: last.linkTargetId }];
    });
  const add = async () => {
    if (!filledLines.length) { showFeedback("error", "Enter an amount · رقم درج کریں"); return; }
    setSaving(true);
    try {
      const at = `${date}T${new Date().toTimeString().slice(0, 8)}`;
      if (filledLines.length === 1) {
        const r = await enterpriseFetch("/api/cash-book", { method: "POST", body: JSON.stringify({ ...filledLines[0], entryDate: at }) });
        showFeedback("success", r?.pendingApproval ? r.message : r?.lease ? `Saved · also counted in the lease ${r.lease.number}: ${PKR(r.lease.balance)} still to pay · محفوظ` : "Saved · محفوظ ہو گیا");
      } else {
        const r = await enterpriseFetch("/api/cash-book/voucher", { method: "POST", body: JSON.stringify({ lines: filledLines, entryDate: at }) });
        showFeedback("success", r?.pendingApproval ? r.message : `Saved ${filledLines.length} lines together · In ${PKR(vIn)} · Out ${PKR(vOut)}${r?.lease ? ` · lease ${r.lease.number}: ${PKR(r.lease.balance)} still to pay` : ""} · محفوظ`);
      }
      setLines([BLANK]);
      setShowAdd(false);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (r: any) => {
    setEditId(r.id);
    setEditForm({ direction: r.direction, amount: r.amount || "", person: r.person || "", description: r.description || "", notes: r.notes || "", linkType: r.linkType || "", linkTargetId: r.linkTargetId || "", linkCategory: r.truckCategory || "" });
  };
  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    try {
      const r = await enterpriseFetch(`/api/cash-book/${editId}`, { method: "PUT", body: JSON.stringify(editForm) });
      showFeedback("success", r?.lease ? `Updated · the lease ${r.lease.number} now has ${PKR(r.lease.balance)} still to pay · درست` : "Updated · درست ہو گیا");
      setEditId(null);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };
  const del = async (id: number) => {
    if (!window.confirm("Delete this entry? · یہ اندراج حذف کریں؟")) return;
    try {
      await enterpriseFetch(`/api/cash-book/${id}`, { method: "DELETE" });
      showFeedback("success", "Deleted · حذف ہو گیا");
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };

  const previewImport = async (file: File) => {
    setImportFile(file);
    setImportPreview(null);
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await uploadFile("/api/cash-book/import/preview", fd);
      setImportPreview(r);
    } catch (e: any) {
      showFeedback("error", e.message);
      setImportFile(null);
    } finally {
      setImportBusy(false);
      if (importRef.current) importRef.current.value = "";
    }
  };
  const commitImport = async () => {
    if (!importFile) return;
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      const r = await uploadFile("/api/cash-book/import", fd);
      showFeedback("success", r.message);
      setImportPreview(null);
      setImportFile(null);
      setShowImport(false);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setImportBusy(false);
    }
  };

  // running position as each entry happened, for the "yahan gaya itna reh gaya" feel
  let running = data?.openingBalance ?? 0;
  const withRunning = (data?.entries || []).map((e: any) => {
    running = e.direction === "In" ? running + e.amount : running - e.amount;
    return { ...e, runningAfter: running };
  });

  const LINK_LABEL: Record<string, string> = { truck: "Truck", party: "Party", personal: "Personal & Household", zakat: "Zakat" };
  const linkNote = (r: any) => {
    if (r.linkType === "truck") return linkOptions.trucks.find((t) => t.id === r.linkTargetId)?.registration;
    if (r.linkType === "party") return linkOptions.parties.find((p) => p.id === r.linkTargetId)?.name;
    return null;
  };

  const shiftDay = (n: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + n);
    setDate(d.toISOString().slice(0, 10));
  };
  const dayName = new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Daily Cash Book"
        urdu="روزانہ کیش بک"
        subtitle={<span dir="auto">What came in and what went out — the balance updates by itself · جو آیا اور جو گیا، بیلنس خود بنتا ہے</span>}
        actions={
          <>
            <Btn kind="ghost" onClick={load} disabled={loading} title="Refresh · تازہ کریں" icon={loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} />
            <Btn onClick={() => setShowImport(true)} icon={<FileSpreadsheet />} title="Import the dual cash-book Excel (Daliy work.xlsx)">Daily-work Excel</Btn>
            <ModuleDataIO entityKey="cash_transactions" label="Cash Book" onImported={load} />
            <Btn kind="primary" onClick={() => { setShowAdd((s) => !s); setEditId(null); }} icon={<Plus />}>Add entry · نیا اندراج</Btn>
          </>
        }
      />

      {/* the day being looked at */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-[#CBD5E1] bg-white overflow-hidden">
          <button onClick={() => shiftDay(-1)} title="Previous day · پچھلا دن" className="px-2.5 py-2 text-[#4B5563] hover:bg-[#F4F6FA]"><ChevronLeft className="w-4 h-4" /></button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="border-0 border-x border-[#E3E8EF] rounded-none px-2 py-1.5 text-[13px]" style={{ boxShadow: "none" }} />
          <button onClick={() => shiftDay(1)} title="Next day · اگلا دن" className="px-2.5 py-2 text-[#4B5563] hover:bg-[#F4F6FA]"><ChevronRight className="w-4 h-4" /></button>
        </div>
        {date !== today() && <Btn size="sm" kind="ghost" onClick={() => setDate(today())}>Today · آج</Btn>}
        <span className="text-[13px] text-[#4B5563]">{dayName}</span>
      </div>

      {showImport && (
        <SidePanel title="Import daily-work Excel · ایکسل سے" subtitle="The dual cash-book format, e.g. “Daliy work.xlsx”" width="lg" onClose={() => setShowImport(false)}>
          <Card bodyClassName="p-4 space-y-3">
            <p className="text-[13px] text-[#4B5563] leading-relaxed" dir="auto">
              Date / Truck / Received / Description / Credit ‖ Date / Truck / Paid / Description / Debit — every row creates one
              “In” and one “Out” entry. You see what will be added before anything is saved. · ہر قطار سے ایک "In" اور ایک "Out" اندراج بنتا ہے۔
            </p>
            <Btn kind="primary" onClick={() => importRef.current?.click()} disabled={importBusy} icon={importBusy ? <Loader2 className="animate-spin" /> : <Upload />}>Choose .xlsx file</Btn>
            <input ref={importRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => e.target.files?.[0] && previewImport(e.target.files[0])} />
          </Card>
          {importPreview && (
            <Card title="Before you import · پہلے دیکھ لیں" bodyClassName="p-4 text-[12.5px] space-y-3">
              <KpiStrip
                items={[
                  { label: "Rows found", value: importPreview.rowCount },
                  { label: "Total in · آیا", value: PKR(importPreview.totalIn), tone: "good" },
                  { label: "Total out · گیا", value: PKR(importPreview.totalOut), tone: "bad" },
                ]}
              />
              {importPreview.skippedSheets?.length > 0 && (
                <div className="text-[12px] text-amber-800">Skipped sheets (no recognizable data): {importPreview.skippedSheets.join(", ")}</div>
              )}
              {importPreview.alreadyThere?.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900 space-y-1" dir="auto">
                  <div className="font-semibold">
                    {importPreview.alreadyThere.length} of these rows are already in the Cash Book — they will NOT be added again · یہ لائنیں پہلے سے موجود ہیں
                  </div>
                  <ul className="list-disc pl-4">
                    {importPreview.alreadyThere.slice(0, 12).map((r: any, i: number) => (
                      <li key={i}>
                        {r.rawDate || ""} · {r.direction} · {PKR(r.amount)} · {r.description}
                      </li>
                    ))}
                  </ul>
                  <div>
                    Will be imported: <b>{importPreview.newCount}</b> entries — In {PKR(importPreview.newIn)}, Out {PKR(importPreview.newOut)} · صرف نئی لائنیں شامل ہوں گی
                  </div>
                </div>
              )}
              <Btn kind="primary" onClick={commitImport} disabled={importBusy} icon={importBusy ? <Loader2 className="animate-spin" /> : <CheckCircle />}>Confirm import</Btn>
            </Card>
          )}
        </SidePanel>
      )}

      {showAdd && (
        <div className="space-y-3 rounded-xl border border-[#C9D7EC] bg-[#F7F9FD] p-3">
          <div>
            <div className="text-[13px] font-semibold text-[#1F2937]">New entry for {date} · نیا اندراج</div>
            <div className="text-[11.5px] text-[#6B7280]" dir="auto">
              One form can hold several lines — money In and money Out together — saved as one voucher, shown together in the day's list. ·
              ایک فارم میں کئی لائنیں: آمد اور ادائیگی دونوں، ایک ساتھ محفوظ
            </div>
          </div>
          {lines.map((ln, i) => (
            <div key={i} className="space-y-1.5">
              {lines.length > 1 && (
                <div className="flex items-center justify-between text-[12px]">
                  <b className={ln.direction === "In" ? "text-[#166534]" : "text-[#B91C1C]"}>Line {i + 1} · {ln.direction === "In" ? "In · وصول" : "Out · ادا"}</b>
                  <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="inline-flex items-center gap-1 text-[#6B7280] hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /> Remove line</button>
                </div>
              )}
              <EntryForm
                value={ln}
                onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? v : x)))}
                onSubmit={add}
                saving={saving}
                onCancel={() => setShowAdd(false)}
                submitLabel="Save · محفوظ کریں"
                compact={i > 0}
                hideActions
                linkOptions={linkOptions}
                onNavigate={onNavigate}
              />
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Btn kind="primary" onClick={add} disabled={saving} icon={saving ? <Loader2 className="animate-spin" /> : <CheckCircle />}>
              Save · محفوظ کریں{filledLines.length > 1 ? ` (${filledLines.length} lines)` : ""}
            </Btn>
            <button type="button" onClick={addLine} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#24539B] hover:underline"><Plus className="w-3.5 h-3.5" /> Add another line · ایک اور لائن</button>
            <Btn onClick={() => { setShowAdd(false); setLines([BLANK]); }} icon={<X />}>Cancel</Btn>
            {filledLines.length > 0 && (
              <span className="text-[12px] tabular-nums text-[#4B5563]">
                In <b className="text-[#166534]">{PKR(vIn)}</b> · Out <b className="text-[#B91C1C]">{PKR(vOut)}</b> · net <b>{vIn - vOut < 0 ? "−" : ""}{PKR(vIn - vOut)}</b>
              </span>
            )}
          </div>
        </div>
      )}

      {data && (
        <KpiStrip
          items={[
            { label: "Opening · صبح کا بیلنس", value: PKR(data.openingBalance) },
            { label: "Total in · کل آیا", value: PKR(data.totalIn), tone: "good" },
            { label: "Total out · کل گیا", value: PKR(data.totalOut), tone: "bad" },
            { label: "Closing · باقی بچا", value: (data.closingBalance < 0 ? "−" : "") + PKR(data.closingBalance), tone: data.closingBalance >= 0 ? undefined : "bad", sub: "opening + in − out" },
          ]}
        />
      )}

      <CashCountPanel date={date} showFeedback={showFeedback} onChanged={load} version={countVersion} />

      <Card
        className="overflow-hidden"
        bodyClassName=""
        title={
          <span className="flex items-center gap-3">
            Entries · اندراجات <span className="text-[12px] font-normal text-[#9CA3AF]">{withRunning.length}</span>
            <span className="font-normal"><DateHead newestFirst={newestFirst} onToggle={toggleNewest} label="Order" /></span>
          </span>
        }
        actions={
          withRunning.length > 0 ? (
            <Btn
              size="sm"
              kind="danger"
              icon={<Trash2 />}
              title="Delete every entry of this day (to import the day's sheet again cleanly)"
              onClick={async () => {
                if (
                  !window.confirm(
                    `Delete ALL ${withRunning.length} entries of ${date}? Their links in Truck / Party Ledgers are removed too. Use this to import the day's sheet again cleanly. · اس دن کی تمام ${withRunning.length} انٹریاں حذف کریں؟`,
                  )
                )
                  return;
                try {
                  const r = await enterpriseFetch(`/api/cash-book/day?date=${date}`, { method: "DELETE" });
                  showFeedback("success", `${r.message} · حذف ہو گئیں`);
                  load();
                } catch (e: any) {
                  showFeedback("error", e.message);
                }
              }}
            >
              Clear this day
            </Btn>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]">
              <tr className="border-b border-[#E3E8EF]">
                <th className="text-left px-3 py-2">Time</th>
                <th className="text-left px-3 py-2">In / Out</th>
                <th className="text-left px-3 py-2">Person · کس کو / کس سے</th>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-right px-3 py-2">Amount</th>
                <th className="text-right px-3 py-2">Balance</th>
                <th className="px-2 w-[64px]"></th>
              </tr>
            </thead>
            <tbody>
              {inOrder(withRunning, newestFirst).map((r: any, i: number, list: any[]) => (
                <React.Fragment key={r.id}>
                  {r.voucherKey && list[i - 1]?.voucherKey !== r.voucherKey && (() => {
                    const g = list.filter((x: any) => x.voucherKey === r.voucherKey);
                    const gin = g.filter((x: any) => x.direction === "In").reduce((s: number, x: any) => s + x.amount, 0);
                    const gout = g.filter((x: any) => x.direction !== "In").reduce((s: number, x: any) => s + x.amount, 0);
                    return (
                      <tr className="bg-[#F5F3FF] border-t border-[#DDD6FE]">
                        <td colSpan={7} className="px-3 py-1 text-[11.5px] text-[#5B21B6]" dir="auto">
                          <div className="sticky left-0" style={{ width: "min(640px, calc(100vw - 6rem))" }}>
                            <b>Voucher · {g.length} lines · ایک ساتھ</b> <span className="tabular-nums">· In {PKR(gin)} · Out {PKR(gout)} · net {gin - gout < 0 ? "−" : ""}{PKR(gin - gout)}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                  <tr
                    onClick={() => (editId === r.id ? setEditId(null) : startEdit(r))}
                    className={`group border-t border-[#F1F4F9] cursor-pointer ${editId === r.id ? "bg-[#F4F7FC]" : "hover:bg-[#F8FAFC]"}`}
                    title="Click to open this entry's full detail · مکمل تفصیل کے لیے کلک کریں"
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-[#6B7280] tabular-nums align-top">{r.entryDate ? new Date(r.entryDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className="px-3 py-2 align-top">
                      {r.direction === "In" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF3] text-[#166534] px-2 py-0.5 text-[11.5px] font-medium"><ArrowDownCircle className="w-3.5 h-3.5" /> In</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#FEF2F2] text-[#B91C1C] px-2 py-0.5 text-[11.5px] font-medium"><ArrowUpCircle className="w-3.5 h-3.5" /> Out</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top" dir="auto">
                      <span className="text-[#1F2937]">{r.person || "—"}</span>
                      {r.linkType && (r.resolvedLedgerId || r.resolvedPartyId) ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (r.resolvedLedgerId) onNavigate?.("khata", "truck_ledgers", { ledgerId: r.resolvedLedgerId, entryId: r.derivedEntryId });
                            else if (r.resolvedPartyId) onNavigate?.("khata", "parties", { partyId: r.resolvedPartyId, entryId: r.derivedEntryId });
                          }}
                          title="Open this entry in its ledger · اس اندراج کو اس کے کھاتے میں کھولیں"
                          className="block text-[11px] text-[#24539B] hover:underline"
                        >
                          ↔ {LINK_LABEL[r.linkType] || r.linkType}{linkNote(r) ? `: ${linkNote(r)}` : ""}{r.truckCategory && r.truckCategory !== "Other" ? ` · ${catLabel(r.truckCategory)}` : ""} · open →
                        </button>
                      ) : r.linkType ? (
                        <div className="text-[11px] text-[#24539B]">↔ {LINK_LABEL[r.linkType] || r.linkType}{linkNote(r) ? `: ${linkNote(r)}` : ""}</div>
                      ) : null}
                      {r.alsoIn?.length > 0 && (
                        <div className="text-[11px] text-[#92400E]" title="This entry also shows in these modules · یہ اندراج ان میں بھی نظر آتا ہے">also in: {r.alsoIn.join(" · ")}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[280px] truncate text-[#374151] align-top" dir="auto" title={r.description || ""}>{r.description || "—"}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold align-top ${r.direction === "In" ? "text-[#166534]" : "text-[#B91C1C]"}`}>{PKR(r.amount)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums align-top ${r.runningAfter < 0 ? "text-[#B91C1C]" : "text-[#111827]"}`}>{r.runningAfter < 0 ? "−" : ""}{PKR(r.runningAfter)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-right align-top opacity-40 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); startEdit(r); }} title="Edit" className="text-[#6B7280] hover:text-[#24539B] p-1 rounded hover:bg-white"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={(e) => { e.stopPropagation(); del(r.id); }} title="Delete" className="text-[#6B7280] hover:text-red-600 p-1 rounded hover:bg-white"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                  {editId === r.id && (
                    <tr className="bg-[#F4F7FC]">
                      <td colSpan={7} className="px-4 pb-4 pt-1">
                        <EntryForm value={editForm} onChange={setEditForm} onSubmit={saveEdit} saving={saving} onCancel={() => setEditId(null)} submitLabel="Save changes" compact linkOptions={linkOptions} onNavigate={onNavigate} />
                        <div className="mt-3">
                          {/* a receipt here also shows on the khata / party / trip row this entry wrote, and theirs here */}
                          <AttachmentPanel entityType="cash_transaction" entityId={r.id} title="Receipts for this entry · رسیدیں" />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {withRunning.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <Empty icon={<Wallet />} title={`No entries for ${date} yet`} hint="ابھی کوئی اندراج نہیں — “Add entry” سے شروع کریں" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <CashSummary showFeedback={showFeedback} onPickDay={setDate} />
    </div>
  );
}

function EntryForm({ value, onChange, onSubmit, saving, onCancel, submitLabel, compact, linkOptions, title, onNavigate, hideActions }: {
  value: any; onChange: (v: any) => void; onSubmit: () => void; saving: boolean; onCancel: () => void; submitLabel: string; compact?: boolean; linkOptions: LinkOptions; title?: string; hideActions?: boolean;
  onNavigate?: (wb: string, sheet: string, focus?: { ledgerId?: number; partyId?: number; entryId?: number }) => void;
}) {
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
  // a truck picked: its khata's detail, and the same "what is this money" choice as Truck Ledger
  const truckId = value.linkType === "truck" && value.linkTargetId ? Number(value.linkTargetId) : null;
  const [truck, setTruck] = useState<any>(null);
  const [truckErr, setTruckErr] = useState("");
  useEffect(() => {
    setTruck(null);
    setTruckErr("");
    if (!truckId) return;
    let live = true;
    enterpriseFetch(`/api/cash-book/truck/${truckId}`)
      .then((r) => live && setTruck(r))
      .catch((e) => live && setTruckErr(e.message));
    return () => {
      live = false;
    };
  }, [truckId]);
  const kv: KhataKindValue = {
    kind: kindOf(value.linkCategory || "Other", value.direction === "In" ? 1 : 0, value.direction === "Out" ? 1 : 0),
    category: value.linkCategory || "Other",
    direction: value.direction === "In" ? "In" : "Out",
  };
  // In / Out flipped by hand: keep the kind when it still fits, else plain "Other"
  const setDirection = (d: "In" | "Out") => {
    if (!truckId || d === value.direction) return set("direction", d);
    const k: KhataKind = kv.kind;
    const fits = k === "shakhsi" || k === "safi" || k === "capital" || (d === "In" ? INCOME_CATS : EXPENSE_CATS).includes(kv.category);
    onChange({ ...value, direction: d, linkCategory: fits ? value.linkCategory : "Other" });
  };
  // foreign money: $1,100 × 284 → PKR 312,400, with the rate written into the description
  const [fx, setFx] = useState<{ open: boolean; code: string; amount: string; rate: string; source: string }>({ open: false, code: "USD", amount: "", rate: "", source: "" });
  // choose a currency → today's rate comes by itself (yours if you typed one for today, else the internet's)
  const pickFx = (code: string) => {
    setFx((f) => ({ ...f, code, rate: "", source: "getting today's rate…" }));
    enterpriseFetch(`/api/currency/live?code=${code}`)
      .then((r) => setFx((f) => (f.code === code ? { ...f, rate: String(r.rate), source: r.source === "yours" ? "your rate for today" : r.source === "internet" ? "today's internet rate — change it if you got another" : r.warning || "last saved rate" } : f)))
      .catch((e) => setFx((f) => ({ ...f, source: e.message })));
  };
  const openFx = () => {
    const opening = !fx.open;
    setFx((f) => ({ ...f, open: opening }));
    if (opening && !fx.rate) pickFx(fx.code);
  };
  const fxPkr = Math.round((Number(fx.amount) || 0) * (Number(fx.rate) || 0));
  const applyFx = () => {
    if (!fxPkr) return;
    const note = `(${fx.code} ${Number(fx.amount).toLocaleString()} × ${Number(fx.rate).toLocaleString()})`;
    onChange({ ...value, amount: String(fxPkr), description: `${String(value.description || "").replace(/\s*\([A-Z]{3} [\d,.]+ × [\d,.]+\)$/, "")} ${note}`.trim() });
    setFx((f) => ({ ...f, open: false }));
  };
  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] text-[#111827] bg-white";
  return (
    <div className={`rounded-xl border border-[#C9D7EC] p-4 ${compact ? "bg-white" : "bg-[#F7F9FD]"}`}>
      {title && <div className="text-[13px] font-semibold text-[#1F2937] mb-3">{title}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={lbl}>
          In / Out
          <div className="grid grid-cols-2 rounded-lg border border-[#CBD5E1] bg-white p-0.5">
            {([["Out", "Out · ادا"], ["In", "In · وصول"]] as const).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => setDirection(v)}
                className={`rounded-md py-1.5 text-[12.5px] ${value.direction === v ? (v === "In" ? "bg-[#166534] text-white font-semibold" : "bg-[#B91C1C] text-white font-semibold") : "text-[#4B5563]"}`}
                style={value.direction === v ? { backgroundColor: v === "In" ? "#166534" : "#B91C1C", color: "#fff" } : undefined}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <label className={lbl}>
          <span className="flex items-center justify-between">Amount (PKR) · رقم <button type="button" onClick={openFx} className="text-[11px] text-[#24539B] hover:underline font-normal" title="Dollar / Toman / Afghani → PKR">$ → PKR</button></span>
          <input inputMode="numeric" value={value.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d]/g, ""))} className={`${inp} font-semibold tabular-nums`} autoFocus={!compact} placeholder="0" />
        </label>
        {fx.open && (
          <div className="col-span-2 md:col-span-4 rounded-lg border border-[#C9D7EC] bg-white p-3 flex flex-wrap items-end gap-2">
            <label className={lbl}>Currency
              <select value={fx.code} onChange={(e) => pickFx(e.target.value)} className={inp}>
                {["USD", "TMN", "IRR", "AFN", "AED", "SAR", "CNY", "EUR", "GBP"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className={lbl}>Amount<input inputMode="decimal" value={fx.amount} onChange={(e) => setFx({ ...fx, amount: e.target.value })} className={`${inp} w-28`} placeholder="1100" /></label>
            <label className={lbl}>Rate (1 = PKR)<input inputMode="decimal" value={fx.rate} onChange={(e) => setFx({ ...fx, rate: e.target.value, source: "your rate" })} className={`${inp} w-28`} placeholder="…" /></label>
            <div className="text-[13px] pb-2">= <b className="tabular-nums">PKR {fxPkr.toLocaleString()}</b></div>
            <Btn size="sm" kind="primary" onClick={applyFx} disabled={!fxPkr}>Use this</Btn>
            <span className="text-[11px] text-[#9CA3AF] basis-full">{fx.source}{fx.source ? " · " : ""}The description will note the conversion. All rates: Finance → Currency Rates.</span>
          </div>
        )}
        <label className={`${lbl} col-span-2`}>Person · کس کو / کس سے
          <input dir="auto" value={value.person} onChange={(e) => set("person", e.target.value)} className={inp} placeholder="e.g. driver, pump, customer" />
        </label>
        <label className={`${lbl} col-span-2 md:col-span-3`}>Description · تفصیل
          <input dir="auto" value={value.description} onChange={(e) => set("description", e.target.value)} className={inp} />
        </label>
        <label className={lbl}>Notes
          <input dir="auto" value={value.notes} onChange={(e) => set("notes", e.target.value)} className={inp} />
        </label>
        <label className={`${lbl} col-span-2`}>Also add to · بھی شامل کریں
          <select value={value.linkType} onChange={(e) => onChange({ ...value, linkType: e.target.value, linkTargetId: "", linkCategory: "" })} className={inp}>
            <option value="">Just Cash Book · صرف کیش بک</option>
            <option value="truck">Truck Ledger · ٹرک کھاتہ</option>
            <option value="party">Party Ledger · پارٹی کھاتہ</option>
            <option value="personal">Personal &amp; Household · ذاتی کھاتہ</option>
            <option value="zakat">Zakat · زکوٰۃ</option>
          </select>
        </label>
        {value.linkType === "truck" && (
          <label className={`${lbl} col-span-2`}>Which truck · کونسا ٹرک
            <select value={value.linkTargetId} onChange={(e) => set("linkTargetId", e.target.value)} className={inp}>
              <option value="">{linkOptions.loading ? "Loading the trucks…" : linkOptions.trucks.length ? "— choose —" : "— no trucks —"}</option>
              {linkOptions.trucks.map((t) => <option key={t.id} value={t.id}>{t.registration}</option>)}
            </select>
            {linkOptions.error ? (
              <span className="text-[11.5px] font-normal text-[#B91C1C]" dir="auto">
                The truck list could not be loaded: {linkOptions.error}{" "}
                <button type="button" onClick={linkOptions.reload} className="underline font-semibold">Try again · دوبارہ</button>
              </span>
            ) : !linkOptions.loading && linkOptions.trucks.length === 0 ? (
              <span className="text-[11.5px] font-normal text-[#92400E]" dir="auto">No trucks are saved yet — add them in Fleet → Vehicles · ابھی کوئی ٹرک محفوظ نہیں</span>
            ) : null}
          </label>
        )}
        {truckId && (
          <div className="col-span-2 md:col-span-4 space-y-3">
            {truckErr ? (
              <div className="text-[12px] text-[#B91C1C]">{truckErr}</div>
            ) : !truck ? (
              <div className="text-[12px] text-[#6B7280] flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Opening the truck's khata…</div>
            ) : (
              <TruckSnapshot t={truck} onOpen={onNavigate && truck.ledgerId ? () => onNavigate("khata", "truck_ledgers", { ledgerId: truck.ledgerId }) : undefined} />
            )}
            <div className="rounded-lg border border-[#E3E8EF] bg-white p-3">
              <KhataKindPicker
                value={kv}
                onChange={(n) => onChange({ ...value, linkCategory: n.category, direction: n.direction })}
                isPartnership={!!truck?.sharedWithPartner}
                showQist={truck?.lease?.status === "Active"}
                onOpenPartnerPnl={onNavigate && truck?.ledgerId ? () => onNavigate("finance", "partner_pnl", { ledgerId: truck.ledgerId }) : undefined}
              />
            </div>
          </div>
        )}
        {value.linkType === "party" && (
          <label className={`${lbl} col-span-2`}>Which party · کونسی پارٹی
            <select value={value.linkTargetId} onChange={(e) => set("linkTargetId", e.target.value)} className={inp}>
              <option value="">{linkOptions.loading ? "Loading the parties…" : linkOptions.parties.length ? "— choose —" : "— no parties —"}</option>
              {linkOptions.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {linkOptions.error && (
              <span className="text-[11.5px] font-normal text-[#B91C1C]" dir="auto">
                The party list could not be loaded: {linkOptions.error}{" "}
                <button type="button" onClick={linkOptions.reload} className="underline font-semibold">Try again · دوبارہ</button>
              </span>
            )}
          </label>
        )}
      </div>
      {!hideActions && (
      <div className="flex items-center gap-2 mt-3">
        <Btn kind="primary" onClick={onSubmit} disabled={saving || (kv.kind === "shakhsi" && !!truckId && !!truck?.sharedWithPartner)} icon={saving ? <Loader2 className="animate-spin" /> : <CheckCircle />}>{submitLabel}</Btn>
        <Btn onClick={onCancel} icon={<X />}>Cancel</Btn>
      </div>
      )}
    </div>
  );
}

/** The picked truck at a glance: its khata balance, the five totals, the last rows. */
function TruckSnapshot({ t, onOpen }: { t: any; onOpen?: () => void }) {
  const pkr = (n: number) => (n < 0 ? "−" : "") + "PKR " + Math.abs(Math.round(n || 0)).toLocaleString();
  return (
    <div className="rounded-lg border border-[#C9D7EC] bg-white">
      <div className="px-3 py-2.5 flex flex-wrap items-start gap-x-4 gap-y-1 border-b border-[#EEF1F5]">
        <div className="flex-1 min-w-[180px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-[#111827]">{t.registration}</span>
            {t.sharedWithPartner && <span className="rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 text-[10.5px] font-semibold">Partnership · شراکت</span>}
            {t.lease && t.lease.status !== "Settled" && (
              <span className="rounded-full bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 text-[10.5px] font-semibold" dir="auto">
                Lease {t.lease.number}{t.lease.partner ? ` · ${t.lease.partner}` : ""} · left {pkr(t.lease.balance)}
              </span>
            )}
          </div>
          <div className="text-[11.5px] text-[#6B7280]" dir="auto">
            {t.driverName ? `Driver: ${t.driverName}` : "Driver not set"}
            {t.lastDay ? ` · last entry ${t.lastDay.split("-").reverse().join(".")}` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-[#6B7280]">Khata balance · کھاتہ بیلنس</div>
          <div className={`text-[16px] font-semibold tabular-nums ${t.balance < 0 ? "text-[#B91C1C]" : "text-[#111827]"}`}>{pkr(t.balance)}</div>
          {onOpen && <button type="button" onClick={onOpen} className="text-[11px] text-[#24539B] hover:underline">Open the khata →</button>}
        </div>
      </div>
      <div className="p-3 space-y-2.5">
        {t.lease && t.lease.status === "Active" && (
          <div className="rounded-lg border border-[#FCD34D] bg-[#FFFBEB] px-3 py-2 text-[12px] text-[#92400E]" dir="auto">
            This truck is being paid off on a lease ({t.lease.number}{t.lease.partner ? ` · ${t.lease.partner}` : ""}): <b>{pkr(t.lease.balance)}</b> still to pay. Choose <b>Qist received</b> for cash he brings — it counts toward the lease and shows in Partners. Kiraya, kharcha and Shakhsi bardasht show in its truck ledger and in the lease's trip qist. ·
            لیز پر چلنے والا ٹرک — اس کی نقد قسط «قسط وصول» چنیں، شراکت دار میں بھی نظر آئے گی
          </div>
        )}
        {t.sharedWithPartner && !(t.lease && t.lease.status === "Active") && (
          <div className="rounded-lg border border-[#C7D2FE] bg-[#EEF2FF] px-3 py-2 text-[12px] text-[#3730A3]" dir="auto">
            This truck has a partnership: its income and expenses written here show in <b>Partner P&amp;L</b>'s open cycle. Money taken for home is written in Partner P&amp;L itself. · اس ٹرک کی شراکت ہے — آمدن اور خرچہ Partner P&amp;L میں نظر آئیں گے
          </div>
        )}
        {t.ledgerId ? (
          <KhataBuckets t={bucketTotals(t.byCategory)} />
        ) : (
          <div className="text-[12px] text-[#6B7280]">This truck has no khata of its own yet — one opens with this entry · پہلا اندراج کھاتہ کھول دے گا</div>
        )}
        {t.recent?.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="text-[#6B7280]">
                  <th className="text-left font-medium py-1 pr-2">Last entries</th>
                  <th className="text-left font-medium py-1 pr-2">Kind</th>
                  <th className="text-right font-medium py-1 pr-2">In</th>
                  <th className="text-right font-medium py-1">Out</th>
                </tr>
              </thead>
              <tbody>
                {t.recent.map((r: any) => (
                  <tr key={r.id} className="border-t border-[#F1F4F9]">
                    <td className="py-1 pr-2 max-w-[260px] truncate" dir="auto" title={r.description || ""}>
                      <span className="text-[#9CA3AF] tabular-nums">{r.day ? r.day.split("-").reverse().join(".") : "—"}</span> {r.description || "—"}
                    </td>
                    <td className="py-1 pr-2 whitespace-nowrap text-[#4B5563]">{catLabel(r.category || "Other")}</td>
                    <td className="py-1 pr-2 text-right tabular-nums text-[#166534]">{r.received ? r.received.toLocaleString() : ""}</td>
                    <td className="py-1 text-right tabular-nums text-[#B91C1C]">{r.paid ? r.paid.toLocaleString() : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {t.otherKhatas?.length > 0 && (
          <div className="text-[11px] text-[#6B7280]" dir="auto">
            Older khata sheets of this truck (imported): {t.otherKhatas.map((o: any) => `${o.sheet || o.title} (${pkr(o.balance)})`).join(", ")}. This entry goes to the khata above.
          </div>
        )}
      </div>
    </div>
  );
}
