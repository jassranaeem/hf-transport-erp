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

const PKR = (n: number) => "PKR " + Math.round(Math.abs(n || 0)).toLocaleString();
const today = () => new Date().toISOString().slice(0, 10);

const BLANK = { direction: "Out", amount: "", person: "", description: "", notes: "", linkType: "", linkTargetId: "" };
interface LinkOptions { trucks: { id: number; registration: string }[]; parties: { id: number; name: string }[] }

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
  const [linkOptions, setLinkOptions] = useState<LinkOptions>({ trucks: [], parties: [] });
  const [data, setData] = useState<any>(null);
  const [countVersion, setCountVersion] = useState(0); // re-read the count when the day's entries change
  const [newestFirst, toggleNewest] = useNewestFirst();
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<any>(BLANK);
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
    enterpriseFetch("/api/cash-book/link-options").then(setLinkOptions).catch(() => {});
  }, []);

  const add = async () => {
    if (!Number(form.amount)) { showFeedback("error", "Enter an amount · رقم درج کریں"); return; }
    setSaving(true);
    try {
      await enterpriseFetch("/api/cash-book", { method: "POST", body: JSON.stringify({ ...form, entryDate: `${date}T${new Date().toTimeString().slice(0, 8)}` }) });
      showFeedback("success", "Saved · محفوظ ہو گیا");
      setForm(BLANK);
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
    setEditForm({ direction: r.direction, amount: r.amount || "", person: r.person || "", description: r.description || "", notes: r.notes || "", linkType: r.linkType || "", linkTargetId: r.linkTargetId || "" });
  };
  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    try {
      await enterpriseFetch(`/api/cash-book/${editId}`, { method: "PUT", body: JSON.stringify(editForm) });
      showFeedback("success", "Updated · درست ہو گیا");
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
        <EntryForm value={form} onChange={setForm} onSubmit={add} saving={saving} onCancel={() => setShowAdd(false)} submitLabel="Save · محفوظ کریں" linkOptions={linkOptions} title={`New entry for ${date} · نیا اندراج`} />
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
              {inOrder(withRunning, newestFirst).map((r: any) => (
                <React.Fragment key={r.id}>
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
                          ↔ {LINK_LABEL[r.linkType] || r.linkType}{linkNote(r) ? `: ${linkNote(r)}` : ""} · open →
                        </button>
                      ) : r.linkType ? (
                        <div className="text-[11px] text-[#24539B]">↔ {LINK_LABEL[r.linkType] || r.linkType}{linkNote(r) ? `: ${linkNote(r)}` : ""}</div>
                      ) : null}
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
                        <EntryForm value={editForm} onChange={setEditForm} onSubmit={saveEdit} saving={saving} onCancel={() => setEditId(null)} submitLabel="Save changes" compact linkOptions={linkOptions} />
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

function EntryForm({ value, onChange, onSubmit, saving, onCancel, submitLabel, compact, linkOptions, title }: {
  value: any; onChange: (v: any) => void; onSubmit: () => void; saving: boolean; onCancel: () => void; submitLabel: string; compact?: boolean; linkOptions: LinkOptions; title?: string;
}) {
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
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
                onClick={() => set("direction", v)}
                className={`rounded-md py-1.5 text-[12.5px] ${value.direction === v ? (v === "In" ? "bg-[#166534] text-white font-semibold" : "bg-[#B91C1C] text-white font-semibold") : "text-[#4B5563]"}`}
                style={value.direction === v ? { backgroundColor: v === "In" ? "#166534" : "#B91C1C", color: "#fff" } : undefined}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <label className={lbl}>Amount (PKR) · رقم
          <input inputMode="numeric" value={value.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d]/g, ""))} className={`${inp} font-semibold tabular-nums`} autoFocus={!compact} placeholder="0" />
        </label>
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
          <select value={value.linkType} onChange={(e) => onChange({ ...value, linkType: e.target.value, linkTargetId: "" })} className={inp}>
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
              <option value="">— choose —</option>
              {linkOptions.trucks.map((t) => <option key={t.id} value={t.id}>{t.registration}</option>)}
            </select>
          </label>
        )}
        {value.linkType === "party" && (
          <label className={`${lbl} col-span-2`}>Which party · کونسی پارٹی
            <select value={value.linkTargetId} onChange={(e) => set("linkTargetId", e.target.value)} className={inp}>
              <option value="">— choose —</option>
              {linkOptions.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <Btn kind="primary" onClick={onSubmit} disabled={saving} icon={saving ? <Loader2 className="animate-spin" /> : <CheckCircle />}>{submitLabel}</Btn>
        <Btn onClick={onCancel} icon={<X />}>Cancel</Btn>
      </div>
    </div>
  );
}

