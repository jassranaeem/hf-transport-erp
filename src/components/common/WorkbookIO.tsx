import React, { useRef, useState } from "react";
import { Download, Upload, Loader2, X, CheckCircle, AlertTriangle } from "lucide-react";
import { enterpriseFetch, downloadFile, uploadFile } from "../../../client/api.ts";

/**
 * One-click Import / Export for several tables at once: Export writes one Excel
 * workbook with a sheet per table; Import reads a workbook like that, shows what
 * each sheet would add / update, and only saves after you confirm.
 */
export default function WorkbookIO({
  entities,
  fileName,
  onImported,
}: {
  entities: string[];
  fileName: string;
  onImported?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportAll = async () => {
    setBusy("export");
    setErr(null);
    try {
      await downloadFile(`/api/data/workbook/export?entities=${entities.join(",")}`, `${fileName}.xlsx`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const validate = async (file: File) => {
    setBusy("validate");
    setErr(null);
    setDone(null);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      setPreview(await uploadFile("/api/data/workbook/validate?mode=upsert", fd));
    } catch (e: any) {
      setErr(e.message || "Could not read the file");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const commit = async () => {
    const tokens = (preview?.sheets || []).filter((s: any) => s.batchToken && !s.error && (s.summary?.valid ?? 0) > 0).map((s: any) => s.batchToken);
    if (!tokens.length) return;
    setBusy("commit");
    setErr(null);
    try {
      const r = await enterpriseFetch("/api/data/workbook/commit", { method: "POST", body: JSON.stringify({ batchTokens: tokens }) });
      setDone(r);
      setPreview(null);
      onImported?.();
    } catch (e: any) {
      setErr(e.message || "Import failed");
    } finally {
      setBusy(null);
    }
  };

  const btn = "inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:opacity-60";

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button onClick={exportAll} disabled={!!busy} className={btn}>
          {busy === "export" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Export all · سب ایکسپورٹ
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={!!busy} className={btn}>
          {busy === "validate" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Import all · سب امپورٹ
        </button>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && validate(e.target.files[0])} />
      </div>

      {(preview || done || err) && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-xs space-y-2 max-w-3xl">
          <div className="flex items-start justify-between">
            <div className="font-semibold text-slate-700">Import · امپورٹ</div>
            <button onClick={() => { setPreview(null); setDone(null); setErr(null); }} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
          {err && <p className="text-red-600 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {err}</p>}
          {preview && (
            <>
              <p className="text-slate-500">{preview.file} — nothing is saved until you confirm. · تصدیق تک کچھ محفوظ نہیں ہوتا۔</p>
              <table className="w-full">
                <thead className="text-[10px] uppercase text-slate-500 bg-slate-50">
                  <tr><th className="text-left px-2 py-1">Sheet</th><th className="text-left px-2">Table</th><th className="text-right px-2">New</th><th className="text-right px-2">Update</th><th className="text-right px-2">Errors</th></tr>
                </thead>
                <tbody>
                  {(preview.sheets || []).map((s: any) => (
                    <tr key={s.sheetName} className="border-t border-slate-100">
                      <td className="px-2 py-1">{s.sheetName}</td>
                      <td className="px-2">{s.label}</td>
                      {s.error ? (
                        <td colSpan={3} className="px-2 text-red-600">{s.error}</td>
                      ) : (
                        <>
                          <td className="px-2 text-right">{s.summary?.toInsert ?? 0}</td>
                          <td className="px-2 text-right">{s.summary?.toUpdate ?? 0}</td>
                          <td className={`px-2 text-right ${(s.summary?.invalid ?? 0) > 0 ? "text-red-600 font-semibold" : ""}`}>{s.summary?.invalid ?? 0}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {(preview.unmatched || []).length > 0 && <p className="text-slate-500">Ignored sheets (not recognised): {(preview.unmatched || []).join(", ")}</p>}
              {(preview.sheets || []).some((s: any) => s.errors?.length) && (
                <ul className="text-red-600 list-disc pl-4 max-h-28 overflow-y-auto">
                  {(preview.sheets || []).flatMap((s: any) => (s.errors || []).slice(0, 5).map((er: any, i: number) => <li key={s.sheetName + i}>{s.sheetName} row {er.row}: {er.message || er.error}</li>))}
                </ul>
              )}
              <button onClick={commit} disabled={busy === "commit"} className="text-sm font-semibold rounded-lg bg-emerald-600 text-white px-4 py-1.5 hover:bg-emerald-700 disabled:opacity-60">
                {busy === "commit" ? "Saving…" : "Confirm import · تصدیق کریں"}
              </button>
            </>
          )}
          {done && (
            <p className="text-slate-700 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Imported: {done.inserted} new, {done.updated} updated · امپورٹ ہو گیا</p>
          )}
        </div>
      )}
    </div>
  );
}
