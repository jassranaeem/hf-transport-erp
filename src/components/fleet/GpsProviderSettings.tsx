/**
 * GPS Provider — connect the Eagle Tracker (GPSWOX) panel so real truck
 * positions, speed and history flow into the Live GPS Map.
 *
 * One-time: paste the panel URL + the same email/password used at
 * eagletracker.com.pk, Enable, Save, then "Sync now". After that a background
 * job pulls every truck's fix once a minute.
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Satellite, Save, RefreshCw, Loader2, CheckCircle, XCircle, Info } from "lucide-react";

interface Cfg {
  enabled: boolean;
  kind: "gpswox";
  url: string;
  username: string;
  password: string;
  label: string;
  hasPassword?: boolean;
}

export default function GpsProviderSettings({
  showFeedback,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [lastSync, setLastSync] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    enterpriseFetch("/api/tracking/provider/config")
      .then((d) => {
        setCfg(d.config);
        setLastSync(d.lastSync);
      })
      .catch((e) => showFeedback("error", e.message));
  }, [showFeedback]);
  useEffect(load, [load]);

  if (!cfg) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#4B5563] p-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }
  const set = (p: Partial<Cfg>) => setCfg({ ...cfg, ...p });

  const save = async () => {
    setSaving(true);
    try {
      const body: any = { enabled: cfg.enabled, kind: "gpswox", url: cfg.url, username: cfg.username, label: cfg.label };
      if (cfg.password && !/^•+$/.test(cfg.password)) body.password = cfg.password;
      const r = await enterpriseFetch("/api/tracking/provider/config", { method: "PUT", body: JSON.stringify(body) });
      setCfg(r.config);
      showFeedback("success", "GPS provider saved" + (cfg.enabled ? " and enabled" : ""));
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const body: any = { config: { ...cfg } };
      if (cfg.password && /^•+$/.test(cfg.password)) delete body.config.password;
      const r = await enterpriseFetch("/api/tracking/provider/sync", { method: "POST", body: JSON.stringify(body) });
      setLastSync(r);
      load();
      if (r.error) showFeedback("error", "Sync failed: " + r.error);
      else showFeedback("success", `Synced — ${r.devices} devices, ${r.matched} matched to trucks, ${r.accepted} new fixes`);
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <h2 className="text-base font-bold flex items-center gap-2">
        <Satellite className="w-4 h-4" /> GPS Provider <span className="text-[#9CA3AF] font-normal text-sm">· جی پی ایس فراہم کنندہ</span>
      </h2>

      <div className="rounded-lg border border-[#C9D7EC] bg-[#F2F5FA] p-3 text-[12px] text-[#173563] space-y-1">
        <div className="font-semibold flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> Eagle Tracker (GPSWOX)</div>
        <p>Panel URL is <b>https://eagletracker.com.pk</b>. Use the same email + password you sign in with there. After Save + "Sync now", positions/speed/history flow into the Live GPS Map automatically (refreshed every minute).</p>
        <p className="text-[11px]">Trucks are matched to devices by number (e.g. device "Les-1384" → vehicle "LES 1384"). If a device doesn't match, rename it in the Eagle panel or link it under Live Map → devices.</p>
      </div>

      <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 space-y-3">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Enable live pull
          <span className={`text-[10px] rounded-full px-2 py-0.5 ${cfg.enabled ? "bg-[#E6ECF6] text-[#1E4480]" : "bg-[#F3F4F6] text-[#6B7280]"}`}>
            {cfg.enabled ? "ON" : "OFF"}
          </span>
        </label>
        <label className="flex flex-col text-xs gap-1">
          <span className="text-[#6B7280]">Panel URL</span>
          <input value={cfg.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://eagletracker.com.pk" className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm font-mono" dir="ltr" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col text-xs gap-1">
            <span className="text-[#6B7280]">Email / username</span>
            <input value={cfg.username} onChange={(e) => set({ username: e.target.value })} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm" dir="ltr" />
          </label>
          <label className="flex flex-col text-xs gap-1">
            <span className="text-[#6B7280]">Password</span>
            <input value={cfg.password} onChange={(e) => set({ password: e.target.value })} placeholder={cfg.hasPassword ? "•••••• (saved)" : ""} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm" dir="ltr" />
          </label>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 bg-[#24539B] text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
          <button onClick={syncNow} disabled={syncing} className="flex items-center gap-1.5 border border-[#24539B] text-[#1E4480] text-sm font-semibold rounded-lg px-3 py-1.5 disabled:opacity-60">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sync now
          </button>
        </div>
      </div>

      {lastSync && (
        <div className={`rounded-xl border p-3 text-[12px] ${lastSync.error ? "border-[#FFC2C3] bg-[#FFF1F1] text-[#B00005]" : "border-[#C9D7EC] bg-[#F2F5FA] text-[#1E4480]"}`}>
          <div className="font-semibold flex items-center gap-1.5">
            {lastSync.error ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
            Last sync · {new Date(lastSync.at).toLocaleString()}
          </div>
          {lastSync.error ? (
            <div>error: {lastSync.error}</div>
          ) : (
            <div>{lastSync.devices} devices · {lastSync.matched} matched to trucks · {lastSync.accepted} new position(s) ingested</div>
          )}
        </div>
      )}
    </div>
  );
}
