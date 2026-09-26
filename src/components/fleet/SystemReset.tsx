/**
 * System Reset — a self-service "start fresh" button. No developer/AI needed:
 * type the confirmation phrase and click. Always takes a real backup first
 * (a JSON snapshot of every table, stored in the database itself — works the
 * same in dev and in a hosted deploy, survives redeploys).
 *
 * Super Admin only.
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import {
  ShieldAlert,
  Database,
  Save,
  RotateCcw,
  Loader2,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Trash2,
} from "lucide-react";

const RESET_PHRASE = "RESET SYSTEM";
const RESTORE_PHRASE = "RESTORE BACKUP";

const fmtBytes = (n: number | null) => {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

interface BackupRow {
  id: number;
  fileName: string;
  fileSize: number | null;
  status: string;
  verified: boolean;
  kind: string;
  createdAt: string;
  restorable: boolean;
}

export default function SystemReset({
  showFeedback,
  isSuperAdmin,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
  isSuperAdmin: boolean;
}) {
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);

  const [resetText, setResetText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<any>(null);

  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);
  const [restoreText, setRestoreText] = useState("");
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    enterpriseFetch("/api/system/backups")
      .then(setBackups)
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(load, [load]);

  if (!isSuperAdmin) {
    return (
      <div className="rounded-xl border border-[#FFC2C3] bg-[#FFF1F1] p-4 text-sm text-[#B00005] flex items-center gap-2">
        <ShieldAlert className="w-4 h-4" /> Super Admin only.
      </div>
    );
  }

  const takeBackup = async () => {
    setBackingUp(true);
    try {
      const r = await enterpriseFetch("/api/system/backup", { method: "POST" });
      showFeedback("success", r.message || "Backup saved");
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBackingUp(false);
    }
  };

  const doReset = async () => {
    if (resetText !== RESET_PHRASE) return;
    setResetting(true);
    setResetResult(null);
    try {
      const r = await enterpriseFetch("/api/system/factory-reset", {
        method: "POST",
        body: JSON.stringify({ confirmText: resetText }),
      });
      setResetResult(r);
      setResetText("");
      showFeedback("success", "System reset to a fresh state");
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setResetting(false);
    }
  };

  const doRestore = async () => {
    if (!restoreTarget || restoreText !== RESTORE_PHRASE) return;
    setRestoring(true);
    try {
      const r = await enterpriseFetch(`/api/system/backups/${restoreTarget.id}/restore`, {
        method: "POST",
        body: JSON.stringify({ confirmText: restoreText }),
      });
      showFeedback("success", `Restored ${r.restoredTables} tables from "${restoreTarget.fileName}"`);
      setRestoreTarget(null);
      setRestoreText("");
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold flex items-center gap-2">
          <Database className="w-4 h-4" /> System Reset &amp; Backups <span className="text-[#9CA3AF] font-normal text-sm">· سسٹم ری سیٹ اور بیک اپ</span>
        </h2>
        <button onClick={load} className="flex items-center gap-1.5 text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white hover:bg-[#F2F5FA]">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* backup */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><Save className="w-4 h-4 text-[#24539B]" /> Take a backup</h3>
        <p className="text-[12px] text-[#6B7280]" dir="auto">
          Saves every table's data right now, inside the database itself (no separate file to lose). Do this any time —
          before a big import, before letting someone new experiment, or just weekly.
        </p>
        <button
          onClick={takeBackup}
          disabled={backingUp}
          className="flex items-center gap-1.5 bg-[#24539B] text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60"
        >
          {backingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Backup now
        </button>
      </div>

      {/* backup list */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA]">Recent backups</div>
        <table className="w-full text-xs">
          <thead className="bg-[#F9FAFB] text-[#6B7280]">
            <tr>
              <th className="text-left px-2 py-1.5">When</th>
              <th className="text-left px-2 py-1.5">File</th>
              <th className="text-left px-2 py-1.5">Kind</th>
              <th className="text-right px-2 py-1.5">Size</th>
              <th className="text-left px-2 py-1.5">Status</th>
              <th className="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.id} className="border-t border-[#F3F4F6]">
                <td className="px-2 py-1.5 whitespace-nowrap text-[#6B7280]">{new Date(b.createdAt).toLocaleString()}</td>
                <td className="px-2 py-1.5 font-mono" dir="ltr">{b.fileName}</td>
                <td className="px-2 py-1.5">{b.kind === "pre-reset" ? "Before a reset" : "Manual"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtBytes(b.fileSize)}</td>
                <td className="px-2 py-1.5">
                  {b.restorable ? (
                    <span className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-[#E6ECF6] text-[#1E4480]">Restorable</span>
                  ) : (
                    <span className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-[#F3F4F6] text-[#6B7280]" title="Old entry from before real backups existed">
                      Not restorable
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {b.restorable && (
                    <button
                      onClick={() => { setRestoreTarget(b); setRestoreText(""); }}
                      className="text-[11px] font-semibold text-[#4B5563] hover:underline flex items-center gap-1 ml-auto"
                    >
                      <RotateCcw className="w-3 h-3" /> Restore
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {backups.length === 0 && (
              <tr><td colSpan={6} className="px-2 py-4 text-center text-[#9CA3AF]">No backups yet — take one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* restore confirm panel */}
      {restoreTarget && (
        <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4 space-y-2">
          <h3 className="text-sm font-bold text-[#374151] flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> Restore "{restoreTarget.fileName}"?
          </h3>
          <p className="text-[12px] text-[#374151]" dir="auto">
            This REPLACES whatever is in the system right now with what was saved at that backup's time. Anything added
            since then will be lost (unless you back that up first too). Type <b>{RESTORE_PHRASE}</b> to confirm.
          </p>
          <div className="flex items-center gap-2">
            <input
              value={restoreText}
              onChange={(e) => setRestoreText(e.target.value)}
              placeholder={RESTORE_PHRASE}
              className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm font-mono flex-1"
              dir="ltr"
            />
            <button
              onClick={doRestore}
              disabled={restoreText !== RESTORE_PHRASE || restoring}
              className="flex items-center gap-1.5 bg-[#4B5563] text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-40"
            >
              {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Restore
            </button>
            <button onClick={() => { setRestoreTarget(null); setRestoreText(""); }} className="text-sm text-[#6B7280] px-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* danger zone: factory reset */}
      <div className="rounded-xl border-2 border-[#FFC2C3] bg-[#FFF1F1] p-4 space-y-2">
        <h3 className="text-sm font-bold text-[#B00005] flex items-center gap-1.5">
          <Trash2 className="w-4 h-4" /> Reset to a fresh system · سسٹم کو نیا کریں
        </h3>
        <p className="text-[12px] text-[#B00005]" dir="auto">
          Clears every truck, driver, ledger entry, invoice, quotation, trip, fuel/HR/workshop record — back to a blank
          system, exactly like a fresh install. Your login, Company Profile (letterhead/NTN/bank), and SMS/GPS settings
          are kept. <b>A backup is taken automatically first</b> — you can always restore it from the list above if this
          was a mistake.
        </p>
        <p className="text-[12px] text-[#B00005]" dir="auto">
          Type <b>{RESET_PHRASE}</b> below to confirm:
        </p>
        <div className="flex items-center gap-2">
          <input
            value={resetText}
            onChange={(e) => setResetText(e.target.value)}
            placeholder={RESET_PHRASE}
            className="border border-[#FFC2C3] rounded px-2 py-1.5 text-sm font-mono flex-1"
            dir="ltr"
          />
          <button
            onClick={doReset}
            disabled={resetText !== RESET_PHRASE || resetting}
            className="flex items-center gap-1.5 bg-[#B00005] text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-40"
          >
            {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Reset to Fresh System
          </button>
        </div>
        {resetResult && (
          <div className="rounded-lg border border-[#C9D7EC] bg-[#F2F5FA] p-2.5 text-[12px] text-[#1E4480] flex items-start gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{resetResult.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
