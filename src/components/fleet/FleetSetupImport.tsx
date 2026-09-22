/**
 * Fleet Setup Import — the ONE place to drop Excel files, no matter how many
 * or what shape. Pick one file, ten files, fifty files — the system reads
 * every one of them and figures out what's in it, exactly like a person
 * dragging each file in one at a time would, just all in one go:
 *   - sheets named after a module (Vehicles / Drivers / Routes / Trips /
 *     Parties …) -> the generic module-sheet matcher
 *   - sheets that are one truck's running-balance khata each (named by
 *     registration, e.g. "TLB 100") -> the khata parser
 *   - sheets that are a per-trip log (many vehicles, one row per trip, no
 *     running balance) -> the trip-log parser
 *   - sheets that are a daily income|expense cash book (two columns side by
 *     side) -> the cash-book parser
 * All four run against every uploaded file (POST /api/ledgers/import-batch/
 * preview + commit); the three ledger-shape parsers are mutually exclusive
 * per sheet server-side, so running all of them never double-counts a rupee.
 * Only genuinely unrecognisable sheets (blank/junk) are ever called out.
 */
import React, { useRef, useState } from "react";
import { uploadFile, downloadFile } from "../../../client/api.ts";
import {
  FileSpreadsheet,
  Upload,
  Loader2,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Download,
  Truck,
  X,
} from "lucide-react";

const LEDGER_LABELS: Record<string, string> = {
  khata: "Truck Ledger (khata)",
  freightLog: "Trip log",
  cashbook: "Cash book",
};

export default function FleetSetupImport({
  showFeedback,
  onImported,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
  onImported?: () => void;
}) {
  const [busy, setBusy] = useState<"validate" | "commit" | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<any>(null); // { files: [...] }
  const [done, setDone] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const buildFormData = (list: File[]) => {
    const fd = new FormData();
    for (const f of list) fd.append("files", f);
    return fd;
  };

  const doValidate = async (list: File[]) => {
    setBusy("validate");
    setPreview(null);
    setDone(null);
    setFiles(list);
    try {
      const res = await uploadFile("/api/ledgers/import-batch/preview", buildFormData(list));
      setPreview(res);
    } catch (e: any) {
      showFeedback("error", e.message);
      setFiles([]);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const anyRecognised = (f: any) =>
    (f.module?.sheets?.length || 0) > 0 ||
    (f.khata?.ledgerCount || 0) > 0 ||
    (f.freightLog?.ledgerCount || 0) > 0 ||
    (f.cashbook?.ledgerCount || 0) > 0;

  const totalRecognisedFiles = (preview?.files || []).filter(anyRecognised).length;

  const doCommit = async () => {
    if (!files.length) return;
    setBusy("commit");
    try {
      const res = await uploadFile("/api/ledgers/import-batch", buildFormData(files));
      setDone(res);
      setPreview(null);
      setFiles([]);
      showFeedback("success", res.message);
      onImported?.();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const removeFile = (name: string) => {
    const next = files.filter((f) => f.name !== name);
    if (next.length) doValidate(next);
    else {
      setFiles([]);
      setPreview(null);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-base font-bold flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-[#16A34A]" /> Fleet Setup — Import Excel
        </h2>
        <p className="text-[12px] text-[#6B7280] mt-1" dir="auto">
          Ek ya bohot sari Excel files ek saath select karein — jitni bhi files hon, sab is ek screen se import ho jayengi.
          Chahe sheets kisi module ke naam ki ho (<b>Vehicles</b>, <b>Drivers</b>, <b>Routes</b>, <b>Trips</b>, <b>Parties</b>),
          truck khata ho (ek sheet = ek truck, jaise "TLB 100"), trip log ho (kai vehicles ek sheet mein), ya daily
          income/expense cash book ho — system har file mein khud pehchan kar sab data import kar dega. ·
          جتنی بھی فائلیں ہوں، ایک ساتھ منتخب کریں — سسٹم خود پہچان کر سب ڈیٹا ڈال دے گا۔
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => downloadFile("/api/data/vehicles/template", "vehicles-template.xlsx")}
          className="text-[11px] flex items-center gap-1 border border-[#E5E7EB] rounded px-2 py-1 bg-white hover:bg-[#F0FAF4]"
        >
          <Download className="w-3 h-3" /> Sample sheet
        </button>
      </div>

      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy != null}
        className="bg-[#16A34A] text-white text-sm font-semibold rounded-lg px-4 py-2 flex items-center gap-2 disabled:opacity-60"
      >
        {busy === "validate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {busy === "validate" ? `Reading ${files.length || ""} workbook(s)…` : "Choose .xlsx workbook(s) · ایک یا زیادہ فائلیں منتخب کریں"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xlsm,.csv"
        multiple
        className="hidden"
        onChange={(e) => e.target.files?.length && doValidate(Array.from(e.target.files))}
      />

      {/* preview */}
      {preview && (
        <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden divide-y divide-[#E5E7EB]">
          <div className="px-3 py-2 text-xs font-bold bg-[#F3F7F4] flex items-center justify-between">
            <span>
              {preview.files.length} file{preview.files.length === 1 ? "" : "s"} read — {totalRecognisedFiles} with recognised data
            </span>
          </div>

          {preview.files.map((f: any) => {
            const recognised = anyRecognised(f);
            return (
              <div key={f.fileName} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#374151] truncate" dir="auto">{f.fileName}</span>
                  <button onClick={() => removeFile(f.fileName)} title="Remove this file" className="text-[#9CA3AF] hover:text-[#B91C1C] shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {f.error && <div className="text-[11px] text-[#B91C1C] mt-1">{f.error}</div>}

                {!f.error && (
                  <div className="mt-1 space-y-1">
                    {f.module?.sheets?.length > 0 && (
                      <div className="text-[11px] text-[#15803D] flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" />
                        {f.module.sheets.length} module sheet{f.module.sheets.length === 1 ? "" : "s"}:{" "}
                        {f.module.sheets.map((s: any) => `${s.sheetName} → ${s.label}`).join(", ")}
                      </div>
                    )}
                    {(["khata", "freightLog", "cashbook"] as const).map(
                      (key) =>
                        (f[key]?.ledgerCount || 0) > 0 && (
                          <div key={key} className="text-[11px] text-[#15803D] flex items-center gap-1">
                            <Truck className="w-3 h-3" />
                            {LEDGER_LABELS[key]}: {f[key].ledgerCount} ledger{f[key].ledgerCount === 1 ? "" : "s"} ({f[key].entries} entries)
                          </div>
                        )
                    )}
                    {!recognised && (
                      <div className="text-[11px] text-[#B45309] flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Nothing recognised in this file.
                      </div>
                    )}
                    {f.trulyUnmatched?.length > 0 && (
                      <div className="text-[10px] text-[#92400E]">
                        Skipped sheet(s): {f.trulyUnmatched.join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="px-3 py-2 flex justify-end">
            <button
              onClick={doCommit}
              disabled={busy != null || totalRecognisedFiles === 0}
              className="bg-[#16A34A] text-white text-sm font-semibold rounded-lg px-4 py-2 flex items-center gap-2 disabled:opacity-60"
            >
              {busy === "commit" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Import everything
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-sm text-[#15803D]">
          <div className="font-semibold flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> Setup imported
          </div>
          <p className="text-[12px] mt-1">{done.message}</p>
          <p className="text-[12px] mt-1" dir="auto">Fleet sheets are now populated. · اب فلیٹ کی شیٹس میں ڈیٹا موجود ہے۔</p>
        </div>
      )}
    </div>
  );
}
