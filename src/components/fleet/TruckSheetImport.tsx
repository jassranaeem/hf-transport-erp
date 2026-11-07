/**
 * "Import truck sheet" — reads the file first, then asks where each truck's rows should go:
 * into the khata that truck already has (default — rows already there are skipped, the rest
 * placed where they sit on the paper), or a new separate khata. Used by Truck Ledgers and
 * Partner P&L. Server: POST /api/ledgers/import-workbook/preview, then /import-workbook with
 * `targets` ({ sheet: khataId | "new" | "auto" }).
 */
import React, { useEffect, useState } from "react";
import { uploadFile } from "../../../client/api.ts";
import { Loader2, X, Upload } from "lucide-react";

export default function TruckSheetImport({
  file,
  onCancel,
  onDone,
  showFeedback,
}: {
  file: File;
  onCancel: () => void;
  onDone: (result: any) => void;
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [preview, setPreview] = useState<any>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fd = new FormData();
    fd.append("file", file);
    uploadFile("/api/ledgers/import-workbook/preview", fd)
      .then((r) => {
        setPreview(r);
        const t: Record<string, string> = {};
        for (const tr of r.trucks || []) t[tr.sheet] = tr.ownKhataId ? String(tr.ownKhataId) : tr.joinsSheet ? "auto" : String(tr.defaultTarget);
        setTargets(t);
      })
      .catch((e) => setError(e.message || "Could not read this file"));
  }, [file]);

  const run = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const t: Record<string, number | "new" | "auto"> = {};
      for (const [sheet, v] of Object.entries(targets)) t[sheet] = v === "new" || v === "auto" ? v : Number(v);
      fd.append("targets", JSON.stringify(t));
      const r = await uploadFile("/api/ledgers/import-workbook", fd);
      showFeedback("success", r.message || "Imported");
      onDone(r);
    } catch (e: any) {
      showFeedback("error", e.message || "Import failed");
      setError(e.message || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const trucks: any[] = preview?.trucks || [];
  const sel = "border border-[#E5E7EB] rounded px-2 py-1 text-xs max-w-full";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onCancel}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-auto rounded-xl bg-white shadow-xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-bold">Import truck sheet · ٹرک شیٹ امپورٹ</div>
            <div className="text-[12px] text-[#6B7280]" dir="auto">
              {file.name} — choose where each truck's rows go. A truck that already has a khata gets the rows added INTO it: rows already there are
              skipped, the rest go where they sit on the paper. · جس ٹرک کا کھاتہ پہلے سے ہے، نئی لائنیں اسی میں جائیں گی۔
            </div>
          </div>
          <button onClick={onCancel} className="text-[#6B7280] hover:text-[#111827]"><X className="w-5 h-5" /></button>
        </div>

        {!preview && !error && (
          <div className="flex items-center gap-2 text-sm text-[#4B5563]"><Loader2 className="w-4 h-4 animate-spin" /> Reading the file…</div>
        )}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{error}</div>}

        {preview && (
          <>
            <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
              <table className="w-full text-[12.5px]">
                <thead className="bg-[#F2F5FA] text-[#4B5563]">
                  <tr>
                    <th className="text-left px-3 py-2">Sheet / table in the file</th>
                    <th className="text-left px-3 py-2">Truck · ٹرک</th>
                    <th className="text-right px-3 py-2">Rows</th>
                    <th className="text-left px-3 py-2">Goes into · کہاں جائے</th>
                  </tr>
                </thead>
                <tbody>
                  {trucks.map((t) => {
                    const v = targets[t.sheet];
                    const chosenMain = t.plan && String(t.defaultTarget) === v;
                    return (
                      <tr key={t.sheet} className="border-t border-[#F3F4F6] align-top">
                        <td className="px-3 py-2" dir="auto">{t.sheet}</td>
                        <td className="px-3 py-2 font-semibold">{t.registration}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{t.entries}</td>
                        <td className="px-3 py-2">
                          {t.ownKhataId ? (
                            <span className="text-[#B45309]" dir="auto">
                              Already has its own khata “{String(t.ownKhataTitle || "").replace(/\s+/g, " ").slice(0, 50)}” from an earlier import — that khata is updated, not {t.registration}'s main
                              khata. To put these rows into the main khata instead, delete that khata in Truck Ledgers first, then import again.
                              · اس کا الگ کھاتہ پہلے سے ہے — پہلے اسے حذف کریں
                            </span>
                          ) : !t.looksLikeVehicle ? (
                            <span className="text-[#4B5563]">Not a truck number — its own khata</span>
                          ) : (
                            <div className="space-y-1">
                              <select id={`tsi-${t.sheet}`} value={v} onChange={(e) => setTargets((x) => ({ ...x, [t.sheet]: e.target.value }))} className={sel}>
                                {t.candidates.map((k: any) => (
                                  <option key={k.id} value={String(k.id)}>
                                    Add into “{k.title}” · {k.entries} rows{k.partnership ? " · partnership" : ""}
                                  </option>
                                ))}
                                {t.joinsSheet && <option value="auto">Same khata as “{t.joinsSheet}” (new)</option>}
                                <option value="new">New separate khata · الگ نیا کھاتہ</option>
                              </select>
                              {chosenMain && (
                                <div className="text-[11px] text-[#047857]">
                                  {t.plan.already} rows already there (skipped) · {t.plan.add} new rows will be added
                                </div>
                              )}
                              {chosenMain && t.plan.unclear > 0 && (
                                <div className="text-[11px] text-[#B45309]" dir="auto" title={t.plan.unclearSample.join("\n")}>
                                  {t.plan.unclear} rows this file reads wrongly (same amount in both columns / balance off) — not added. Use the original Excel
                                  for these. · یہ فائل ان لائنوں کو صحیح نہیں پڑھ رہی
                                </div>
                              )}
                              {v === "new" && t.candidates.length > 0 && (
                                <div className="text-[11px] text-[#B45309]" dir="auto">
                                  {t.registration} already has a khata — a separate one means the same rows may be in Truck Ledgers twice. · دو بار نہ ہو
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!trucks.length && (
                    <tr><td colSpan={4} className="px-3 py-3 text-center text-[#6B7280]">No truck-khata sheets were recognised in this file.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {preview.skippedSheets?.length > 0 && (
              <div className="text-[11px] text-[#6B7280]">Not read as a khata: {preview.skippedSheets.join(", ")}</div>
            )}
            <div className="flex items-center gap-2">
              <button disabled={busy || !trucks.length} onClick={run} className="bg-[#24539B] text-white font-semibold rounded-lg px-4 py-2 text-xs flex items-center gap-1.5 disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Import · امپورٹ کریں
              </button>
              <button onClick={onCancel} className="text-xs text-[#4B5563] underline">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
