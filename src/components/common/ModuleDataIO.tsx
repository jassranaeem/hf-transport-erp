import React, { useRef, useState } from "react";
import { Download, Upload, FileSpreadsheet, Loader2, X, CheckCircle, AlertTriangle, ChevronDown, Printer } from "lucide-react";
import { enterpriseFetch, downloadFile, uploadFile } from "../../../client/api.ts";

/**
 * Compact per-module Import / Export control. Drop into any module header:
 *
 *   <ModuleDataIO entityKey="vehicles" label="Vehicles" onImported={fetchVehicles} />
 *
 * Reuses the generic /api/data/:entity engine (template / export / validate /
 * commit) — the same safe dry-run flow the central Data screen uses.
 */
export default function ModuleDataIO({
  entityKey,
  label,
  onImported,
}: {
  entityKey: string;
  label?: string;
  onImported?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [validation, setValidation] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"insert" | "upsert">("upsert");
  const fileRef = useRef<HTMLInputElement>(null);
  const name = label || entityKey;

  const dl = async (suffix: string, fname: string, tag: string) => {
    setBusy(tag);
    try {
      await downloadFile(`/api/data/${entityKey}/${suffix}`, fname);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
      setMenuOpen(false);
    }
  };

  const validate = async (file: File) => {
    setBusy("validate");
    setErr(null);
    setValidation(null);
    setDone(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await uploadFile(`/api/data/${entityKey}/validate?mode=${mode}`, fd);
      setValidation(r);
    } catch (e: any) {
      setErr(e.message || "Validation failed");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const commit = async () => {
    if (!validation?.batchToken) return;
    setBusy("commit");
    try {
      const r = await enterpriseFetch("/api/data/commit", {
        method: "POST",
        body: JSON.stringify({ batchToken: validation.batchToken }),
      });
      setDone(r);
      setValidation(null);
      onImported?.();
    } catch (e: any) {
      setErr(e.message || "Import failed");
    } finally {
      setBusy(null);
    }
  };

  const s = validation?.summary;

  return (
    <div className="relative inline-flex items-center gap-2 print:hidden">
      {/* export menu */}
      <div className="relative">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Download className="w-3.5 h-3.5" /> Export <ChevronDown className="w-3 h-3" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg text-xs">
            <button onClick={() => dl(`export?format=xlsx`, `${entityKey}.xlsx`, "xlsx")} className="block w-full text-left px-3 py-1.5 hover:bg-slate-50">
              {busy === "xlsx" ? "…" : "Export .xlsx"}
            </button>
            <button onClick={() => dl(`export?format=csv`, `${entityKey}.csv`, "csv")} className="block w-full text-left px-3 py-1.5 hover:bg-slate-50">
              {busy === "csv" ? "…" : "Export .csv"}
            </button>
            <button onClick={() => dl(`template`, `${entityKey}-template.xlsx`, "tmpl")} className="block w-full text-left px-3 py-1.5 hover:bg-slate-50">
              {busy === "tmpl" ? "…" : "Blank template"}
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button
              onClick={() => { setMenuOpen(false); window.print(); }}
              className="flex w-full items-center gap-1.5 text-left px-3 py-1.5 hover:bg-slate-50"
            >
              <Printer className="w-3.5 h-3.5" /> Print / Save as PDF
            </button>
          </div>
        )}
      </div>

      <button
        onClick={() => { setModal(true); setValidation(null); setDone(null); setErr(null); }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
      >
        <Upload className="w-3.5 h-3.5" /> Import
      </button>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl mt-16">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Import {name} from Excel / CSV
              </h3>
              <button onClick={() => setModal(false)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
            </div>

            <p className="text-[11px] text-slate-500 mb-3">
              Download a template or export first, edit in Excel, then upload. Nothing is written until you press
              <b> Confirm</b> after the check below.
            </p>

            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy === "validate"}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy === "validate" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                Choose file
              </button>
              <label className="text-[11px] flex items-center gap-1">
                <input type="radio" checked={mode === "upsert"} onChange={() => setMode("upsert")} /> update existing (match on key)
              </label>
              <label className="text-[11px] flex items-center gap-1">
                <input type="radio" checked={mode === "insert"} onChange={() => setMode("insert")} /> new only
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && validate(e.target.files[0])}
              />
            </div>

            {err && <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-2">{err}</div>}

            {s && (
              <div className="space-y-2">
                <div className="grid grid-cols-5 gap-1.5 text-center text-[11px]">
                  {[
                    ["Rows", s.dataRows], ["Valid", s.valid], ["Invalid", s.invalid],
                    ["Insert", s.toInsert], ["Update", s.toUpdate],
                  ].map(([l, v]) => (
                    <div key={l as string} className="rounded border border-slate-200 bg-slate-50 py-1">
                      <div className="text-sm font-bold text-slate-700">{v as number}</div>{l}
                    </div>
                  ))}
                </div>
                {validation.errors?.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded border border-red-200 text-[11px]">
                    <table className="w-full">
                      <thead className="bg-red-50 text-red-700 sticky top-0"><tr><th className="text-left px-2 py-1">Row</th><th className="text-left px-2 py-1">Problem</th></tr></thead>
                      <tbody>
                        {validation.errors.slice(0, 40).map((e: any, i: number) => (
                          <tr key={i} className="border-t border-red-100"><td className="px-2 py-1">{e.row}</td><td className="px-2 py-1 text-red-600">{e.column ? `${e.column}: ` : ""}{e.message}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <button
                  onClick={commit}
                  disabled={busy === "commit" || s.valid === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white px-4 py-2 text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy === "commit" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  Confirm import ({s.valid} row{s.valid === 1 ? "" : "s"})
                </button>
              </div>
            )}

            {done && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                <div className="font-semibold flex items-center gap-1.5"><CheckCircle className="w-4 h-4" /> Import complete</div>
                <div className="mt-1">{done.inserted} inserted · {done.updated} updated · {done.skipped} skipped{done.errors?.length ? ` · ${done.errors.length} failed` : ""}</div>
                {done.errors?.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-red-600">
                    {done.errors.slice(0, 10).map((e: any, i: number) => <li key={i}>Row {e.row}: {e.message}</li>)}
                  </ul>
                )}
                <button onClick={() => setModal(false)} className="mt-2 text-emerald-700 underline">close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
