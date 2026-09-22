import React, { useEffect, useMemo, useState } from "react";
import { enterpriseFetch, downloadFile, uploadFile } from "../../../client/api.ts";
import {
  Database, Download, Upload, FileSpreadsheet, CheckCircle, AlertTriangle, ArrowRight, Loader2, Info,
} from "lucide-react";

interface ColumnMeta {
  column: string; required: boolean; type: string;
  enumValues: string[] | null; isRef: boolean; naturalKey: boolean; note: string | null;
}
interface EntityMeta {
  key: string; label: string; description?: string; resource?: string; columns: ColumnMeta[];
}
interface RowError { row: number; column?: string; message: string }
interface ValidateResult {
  entity: string;
  summary: { dataRows: number; valid: number; invalid: number; toInsert: number; toUpdate: number; unknownColumns: string[] };
  errors: RowError[];
  preview: Record<string, unknown>[];
  batchToken: string;
}
interface CommitResult {
  entity: string; mode: string; inserted: number; updated: number; skipped: number; errors: RowError[];
}

export default function DataPortal({
  showFeedback,
}: {
  showFeedback: (type: "success" | "error", message: string) => void;
}) {
  const [entities, setEntities] = useState<EntityMeta[]>([]);
  const [entityKey, setEntityKey] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"insert" | "upsert">("insert");
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  const entity = useMemo(() => entities.find((e) => e.key === entityKey) || null, [entities, entityKey]);

  useEffect(() => {
    enterpriseFetch("/api/data/entities")
      .then((res) => {
        setEntities(res.entities || []);
        if (res.entities?.[0]) setEntityKey(res.entities[0].key);
      })
      .catch((err) => showFeedback("error", err.message || "Failed to load entity list"));
  }, [showFeedback]);

  // reset the import state when switching entity / file / mode
  useEffect(() => {
    setValidation(null);
    setCommitResult(null);
  }, [entityKey, file, mode]);

  const doDownload = async (path: string, name: string, tag: string) => {
    setBusy(tag);
    try {
      await downloadFile(path, name);
    } catch (err: any) {
      showFeedback("error", err.message || "Download failed");
    } finally {
      setBusy(null);
    }
  };

  const doValidate = async () => {
    if (!file || !entity) return;
    setBusy("validate");
    setCommitResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res: ValidateResult = await uploadFile(
        `/api/data/${entity.key}/validate?mode=${mode}`,
        fd
      );
      setValidation(res);
      if (res.errors.length === 0 && res.summary.valid > 0) {
        showFeedback("success", `${res.summary.valid} row(s) ready to import`);
      } else if (res.errors.length) {
        showFeedback("error", `${res.errors.length} problem(s) found — see below`);
      }
    } catch (err: any) {
      showFeedback("error", err.message || "Validation failed");
    } finally {
      setBusy(null);
    }
  };

  const doCommit = async () => {
    if (!validation) return;
    setBusy("commit");
    try {
      const res: CommitResult = await enterpriseFetch("/api/data/commit", {
        method: "POST",
        body: JSON.stringify({ batchToken: validation.batchToken }),
      });
      setCommitResult(res);
      setValidation(null);
      setFile(null);
      showFeedback(
        "success",
        `Import done — ${res.inserted} inserted, ${res.updated} updated${res.skipped ? `, ${res.skipped} skipped` : ""}`
      );
    } catch (err: any) {
      showFeedback("error", err.message || "Import failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Database className="w-5 h-5 text-indigo-600" /> Data Import / Export
        </h2>
        <p className="text-sm text-slate-500">
          Move data in and out with Excel (.xlsx) or CSV — no SQL required. Templates include every
          column, allowed values and lookup hints.
        </p>
      </div>

      {/* entity picker */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-slate-600 mb-1">Table</span>
          <select
            value={entityKey}
            onChange={(e) => setEntityKey(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm min-w-[240px]"
          >
            {entities.map((e) => (
              <option key={e.key} value={e.key}>{e.label}</option>
            ))}
          </select>
        </label>

        <button
          onClick={() =>
            entity && doDownload(`/api/data/${entity.key}/template`, `${entity.key}-template.xlsx`, "template")
          }
          disabled={!entity || busy === "template"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "template" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
          Download template
        </button>

        <button
          onClick={() =>
            entity && doDownload(`/api/data/${entity.key}/export?format=xlsx`, `${entity.key}.xlsx`, "xlsx")
          }
          disabled={!entity || busy === "xlsx"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "xlsx" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export .xlsx
        </button>
        <button
          onClick={() =>
            entity && doDownload(`/api/data/${entity.key}/export?format=csv`, `${entity.key}.csv`, "csv")
          }
          disabled={!entity || busy === "csv"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Export .csv
        </button>
      </div>

      {/* column reference */}
      {entity && (
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
            {entity.label} columns ({entity.columns.length})
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-1.5">Column</th>
                  <th className="text-left px-3 py-1.5">Type</th>
                  <th className="text-left px-3 py-1.5">Req</th>
                  <th className="text-left px-3 py-1.5">Notes</th>
                </tr>
              </thead>
              <tbody>
                {entity.columns.map((c) => (
                  <tr key={c.column} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-medium">
                      {c.column}
                      {c.naturalKey && <span className="ml-1 text-indigo-600" title="unique key">★</span>}
                    </td>
                    <td className="px-3 py-1.5">{c.isRef ? "lookup" : c.type}</td>
                    <td className="px-3 py-1.5">{c.required ? "yes" : ""}</td>
                    <td className="px-3 py-1.5 text-slate-500">
                      {c.enumValues ? `One of: ${c.enumValues.join(", ")}` : c.note || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* import */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-medium flex items-center gap-1.5">
          <Upload className="w-4 h-4 text-emerald-600" /> Import into {entity?.label || "…"}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-sm"
          />
          <label className="text-sm inline-flex items-center gap-1.5">
            <input type="radio" checked={mode === "insert"} onChange={() => setMode("insert")} />
            Insert new only
          </label>
          <label className="text-sm inline-flex items-center gap-1.5">
            <input type="radio" checked={mode === "upsert"} onChange={() => setMode("upsert")} />
            Update existing (match on ★ key)
          </label>

          <button
            onClick={doValidate}
            disabled={!file || busy === "validate"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "validate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Validate
          </button>
        </div>

        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" />
          Nothing is written until you press <b>Confirm import</b> after reviewing the dry-run below.
        </p>

        {validation && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
              {([
                ["Rows", validation.summary.dataRows, "border-slate-200 bg-slate-50 text-slate-700"],
                ["Valid", validation.summary.valid, "border-emerald-200 bg-emerald-50 text-emerald-700"],
                ["Invalid", validation.summary.invalid, "border-red-200 bg-red-50 text-red-700"],
                ["To insert", validation.summary.toInsert, "border-indigo-200 bg-indigo-50 text-indigo-700"],
                ["To update", validation.summary.toUpdate, "border-amber-200 bg-amber-50 text-amber-700"],
              ] as [string, number, string][]).map(([label, val, cls]) => (
                <div key={label} className={`rounded-lg border p-2 ${cls}`}>
                  <div className="text-lg font-semibold">{val}</div>
                  <div className="text-[11px] text-slate-500">{label}</div>
                </div>
              ))}
            </div>

            {validation.summary.unknownColumns.length > 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                Ignored unrecognised columns: {validation.summary.unknownColumns.join(", ")}
              </div>
            )}

            {validation.errors.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-red-200">
                <table className="w-full text-xs">
                  <thead className="bg-red-50 text-red-700 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-1.5 w-16">Row</th>
                      <th className="text-left px-3 py-1.5 w-40">Column</th>
                      <th className="text-left px-3 py-1.5">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.errors.map((e, i) => (
                      <tr key={i} className="border-t border-red-100">
                        <td className="px-3 py-1.5">{e.row}</td>
                        <td className="px-3 py-1.5">{e.column || "—"}</td>
                        <td className="px-3 py-1.5 text-red-600">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {validation.preview.length > 0 && (
              <details className="rounded-lg border border-slate-200">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
                  Preview first {validation.preview.length} row(s)
                </summary>
                <div className="overflow-x-auto max-h-56">
                  <table className="text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        {Object.keys(validation.preview[0]).map((k) => (
                          <th key={k} className="text-left px-3 py-1.5 whitespace-nowrap">{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {validation.preview.map((r, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          {Object.keys(validation.preview[0]).map((k) => (
                            <td key={k} className="px-3 py-1.5 whitespace-nowrap">{String((r as any)[k] ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            <button
              onClick={doCommit}
              disabled={busy === "commit" || validation.summary.valid === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === "commit" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Confirm import ({validation.summary.valid} row{validation.summary.valid === 1 ? "" : "s"})
            </button>
          </div>
        )}

        {commitResult && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <div className="font-medium text-emerald-800 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> Import complete
            </div>
            <div className="text-emerald-700 text-xs mt-1">
              {commitResult.inserted} inserted · {commitResult.updated} updated · {commitResult.skipped} skipped
              {commitResult.errors.length > 0 && ` · ${commitResult.errors.length} failed`}
            </div>
            {commitResult.errors.length > 0 && (
              <ul className="mt-2 text-xs text-red-600 list-disc pl-5">
                {commitResult.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>Row {e.row}: {e.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
