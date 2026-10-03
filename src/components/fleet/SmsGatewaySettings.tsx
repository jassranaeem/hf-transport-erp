/**
 * SMS Gateway — connect an SMS sender so drivers / parties get a text on every
 * credit / debit entry. Pick a provider, paste its details, flip Enable on,
 * send a test. Stored in the DB — no server restart.
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import {
  MessageSquare,
  Save,
  Send,
  Loader2,
  CheckCircle,
  XCircle,
  Info,
  RefreshCw,
} from "lucide-react";

type Provider = "smsgate" | "textbee" | "generic" | "sendpk";

interface Cfg {
  enabled: boolean;
  provider: Provider;
  url: string;
  method: "GET" | "POST";
  username: string;
  password: string;
  apiKey: string;
  senderId: string;
  label: string;
  notifyDrivers: boolean;
  notifyInvoices: boolean;
  templateId: string;
  templateVarsTemplate: string;
  hasPassword?: boolean;
  hasApiKey?: boolean;
}

const PROVIDER_NAME: Record<Provider, string> = {
  smsgate: "SMS Gate — Android phone (no signup)",
  textbee: "textbee — Android phone + free tier",
  sendpk: "SendPK — Fixed-SMS template API (current)",
  generic: "Generic HTTP API (LifetimeSMS / Zong / local)",
};

const SENDPK_TOKEN_HELP =
  "{{who}} {{move}} {{amount}} {{balance}} {{balanceLabel}} {{ref}} {{date}}  (ledger)   ·   {{invoiceNumber}} {{amount}} {{dueDate}} {{route}}  (invoice)";

export default function SmsGatewaySettings({
  showFeedback,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [defaults, setDefaults] = useState<Record<Provider, string>>({ smsgate: "", textbee: "", generic: "" });
  const [guide, setGuide] = useState<Record<Provider, string>>({ smsgate: "", textbee: "", generic: "" });
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testTokensJson, setTestTokensJson] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);

  const load = useCallback(() => {
    enterpriseFetch("/api/sms/config")
      .then((d) => {
        setCfg(d.config);
        setDefaults(d.providerDefaults);
        setGuide(d.guide);
      })
      .catch((e) => showFeedback("error", e.message));
    enterpriseFetch("/api/sms/logs?limit=10")
      .then((d) => setLogs(d.logs || []))
      .catch(() => {});
  }, [showFeedback]);
  useEffect(load, [load]);

  if (!cfg) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#4B5563] p-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  const set = (patch: Partial<Cfg>) => setCfg({ ...cfg, ...patch });
  const changeProvider = (p: Provider) => set({ provider: p, url: defaults[p] || cfg.url, method: p === "generic" ? cfg.method : "POST" });

  const save = async () => {
    setSaving(true);
    try {
      const body: any = {
        enabled: cfg.enabled,
        provider: cfg.provider,
        url: cfg.url,
        method: cfg.method,
        username: cfg.username,
        senderId: cfg.senderId,
        label: cfg.label,
        notifyDrivers: cfg.notifyDrivers,
        notifyInvoices: cfg.notifyInvoices,
        templateId: cfg.templateId,
        templateVarsTemplate: cfg.templateVarsTemplate,
      };
      if (cfg.password && !/^•+$/.test(cfg.password)) body.password = cfg.password;
      // sendpk's api_key is backend-.env-only — never sent from here (the
      // server ignores it for this provider anyway, this just keeps intent clear).
      if (cfg.provider !== "sendpk" && cfg.apiKey && !cfg.apiKey.includes("••")) body.apiKey = cfg.apiKey;
      const r = await enterpriseFetch("/api/sms/config", { method: "PUT", body: JSON.stringify(body) });
      setCfg(r.config);
      showFeedback("success", "SMS gateway saved" + (cfg.enabled ? " and enabled" : ""));
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!testTo) {
      showFeedback("error", "Enter a phone number for the test");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      // save current form first so the test uses it
      const body: any = { to: testTo, config: { ...cfg } };
      if (cfg.password && /^•+$/.test(cfg.password)) delete body.config.password;
      if (cfg.apiKey && cfg.apiKey.includes("••")) delete body.config.apiKey;
      if (cfg.provider === "sendpk") delete body.config.apiKey; // .env-only, never sent from the browser
      if (cfg.provider === "sendpk" && testTokensJson.trim()) {
        try {
          body.tokens = JSON.parse(testTokensJson);
        } catch {
          showFeedback("error", "Sample tokens must be valid JSON, e.g. {\"who\":\"Test Driver\",\"amount\":\"PKR 1,000\"}");
          setTesting(false);
          return;
        }
      }
      const r = await enterpriseFetch("/api/sms/test", { method: "POST", body: JSON.stringify(body) });
      setTestResult(r.log);
      load();
      if (r.log?.status === "sent") showFeedback("success", "Test SMS sent");
      else if (r.log?.status === "skipped") showFeedback("error", "SMS is still disabled — enable it and save first");
      else showFeedback("error", "Test failed — see the response below");
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold flex items-center gap-2">
          <MessageSquare className="w-4 h-4" /> SMS Gateway <span className="text-[#9CA3AF] font-normal text-sm">· ایس ایم ایس گیٹ وے</span>
        </h2>
        <button onClick={load} className="flex items-center gap-1.5 text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white hover:bg-[#F2F5FA]">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* what auto-sends */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 space-y-2">
        <h3 className="text-sm font-semibold">What sends automatically</h3>
        <p className="text-[12px] text-[#6B7280]">
          Once a sender is connected below, these go out on their own — the system picks the driver's number,
          no per-entry or per-driver setup.
        </p>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={cfg.notifyDrivers} onChange={(e) => set({ notifyDrivers: e.target.checked })} />
          <span>Text the assigned <b>driver</b> on every truck-ledger <b>credit / debit</b> entry</span>
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={cfg.notifyInvoices} onChange={(e) => set({ notifyInvoices: e.target.checked })} />
          <span>Text the trip's <b>driver</b> when an <b>invoice</b> is raised (invoice no. + amount + due date)</span>
        </label>
        <p className="text-[11px] text-[#9CA3AF]">
          Nothing goes to customers / clients — driver notifications only.
        </p>
      </div>

      {/* recommendation */}
      <div className="rounded-lg border border-[#C9D7EC] bg-[#F2F5FA] p-3 text-[12px] text-[#173563] space-y-1">
        <div className="font-semibold flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> Connect a sender (one time)</div>
        <p><b>Easiest, no signup:</b> put a spare SIM in any Android phone, install the free <b>SMS Gate</b> app — it shows a username + password. Pick provider = <i>SMS Gate</i>, paste them, Enable, Save. Done — SMS go out on that SIM.</p>
        <p><b>Company-name sender (HFK Transport uses this):</b> pick <i>SendPK</i>. The API key is already set in the server's <code className="font-mono">.env.local</code> — just fill in the approved Sender ID, Template ID and the template's JSON variable shape below, then Enable + Save.</p>
        <p><b>Any other package:</b> get a send-URL + API key from your provider (LifetimeSMS, Zong corporate, a local aggregator), pick <i>Generic HTTP API</i>.</p>
      </div>

      {/* form */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 space-y-3">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Enable SMS
          <span className={`text-[10px] rounded-full px-2 py-0.5 ${cfg.enabled ? "bg-[#E6ECF6] text-[#1E4480]" : "bg-[#F3F4F6] text-[#6B7280]"}`}>
            {cfg.enabled ? "ON" : "OFF"}
          </span>
        </label>

        <label className="flex flex-col text-xs gap-1">
          <span className="text-[#6B7280]">Provider</span>
          <select
            value={cfg.provider}
            onChange={(e) => changeProvider(e.target.value as Provider)}
            className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm"
          >
            {(Object.keys(PROVIDER_NAME) as Provider[]).map((p) => (
              <option key={p} value={p}>{PROVIDER_NAME[p]}</option>
            ))}
          </select>
          <span className="text-[11px] text-[#9CA3AF]">{guide[cfg.provider]}</span>
        </label>

        <label className="flex flex-col text-xs gap-1">
          <span className="text-[#6B7280]">
            Send URL {cfg.provider === "generic" && <span className="text-[#9CA3AF]">— use {"{to}"} and {"{text}"} (also {"{key}"}, {"{from}"})</span>}
          </span>
          <input
            value={cfg.url}
            onChange={(e) => set({ url: e.target.value })}
            placeholder={defaults[cfg.provider] || "https://…/send?api_key={key}&mobile={to}&message={text}"}
            className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm font-mono"
            dir="ltr"
          />
        </label>

        {cfg.provider === "generic" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col text-xs gap-1">
              <span className="text-[#6B7280]">Method</span>
              <select value={cfg.method} onChange={(e) => set({ method: e.target.value as "GET" | "POST" })} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm">
                <option>GET</option>
                <option>POST</option>
              </select>
            </label>
            <label className="flex flex-col text-xs gap-1">
              <span className="text-[#6B7280]">Sender / mask ID ({"{from}"})</span>
              <input value={cfg.senderId} onChange={(e) => set({ senderId: e.target.value })} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm" placeholder="HF Transport" />
            </label>
          </div>
        )}

        {cfg.provider === "sendpk" && (
          <div className="space-y-3">
            <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-2.5 text-[12px] text-[#374151]">
              <b>API key:</b> set once in the server's <code className="font-mono">.env.local</code> as{" "}
              <code className="font-mono">SMS_GATEWAY_KEY</code> — never entered here, never sent to the browser.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col text-xs gap-1">
                <span className="text-[#6B7280]">Approved Sender ID</span>
                <input value={cfg.senderId} onChange={(e) => set({ senderId: e.target.value })} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm" dir="ltr" placeholder="e.g. HFTRANS" />
              </label>
              <label className="flex flex-col text-xs gap-1">
                <span className="text-[#6B7280]">Approved Template ID</span>
                <input value={cfg.templateId} onChange={(e) => set({ templateId: e.target.value })} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm font-mono" dir="ltr" />
              </label>
            </div>
            <label className="flex flex-col text-xs gap-1">
              <span className="text-[#6B7280]">Template variables (JSON) — key names must match what SendPK approved</span>
              <textarea
                value={cfg.templateVarsTemplate}
                onChange={(e) => set({ templateVarsTemplate: e.target.value })}
                rows={2}
                className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm font-mono"
                dir="ltr"
                placeholder={'{"name":"{{who}}","amount":"{{amount}}"}'}
              />
              <span className="text-[11px] text-[#9CA3AF]">Available tokens: {SENDPK_TOKEN_HELP}</span>
            </label>
          </div>
        )}

        {cfg.provider === "smsgate" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col text-xs gap-1">
              <span className="text-[#6B7280]">Username (from the app)</span>
              <input value={cfg.username} onChange={(e) => set({ username: e.target.value })} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm" dir="ltr" />
            </label>
            <label className="flex flex-col text-xs gap-1">
              <span className="text-[#6B7280]">Password</span>
              <input value={cfg.password} onChange={(e) => set({ password: e.target.value })} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm" placeholder={cfg.hasPassword ? "•••••• (saved)" : ""} dir="ltr" />
            </label>
          </div>
        )}

        {(cfg.provider === "textbee" || cfg.provider === "generic") && (
          <label className="flex flex-col text-xs gap-1">
            <span className="text-[#6B7280]">{cfg.provider === "textbee" ? "API key (x-api-key)" : "API key ({key})"}</span>
            <input value={cfg.apiKey} onChange={(e) => set({ apiKey: e.target.value })} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm font-mono" placeholder={cfg.hasApiKey ? "••••  (saved)" : ""} dir="ltr" />
          </label>
        )}

        <label className="flex flex-col text-xs gap-1">
          <span className="text-[#6B7280]">Label (for the log)</span>
          <input value={cfg.label} onChange={(e) => set({ label: e.target.value })} className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm" placeholder="e.g. Office SIM / SendPK" />
        </label>

        <div className="flex items-center gap-2 pt-1">
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 bg-[#24539B] text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </div>
      </div>

      {/* test */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 space-y-2">
        <h3 className="text-sm font-semibold">Send a test SMS</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="03xx-xxxxxxx"
            className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm w-48"
            dir="ltr"
          />
          <button onClick={sendTest} disabled={testing} className="flex items-center gap-1.5 border border-[#24539B] text-[#1E4480] text-sm font-semibold rounded-lg px-3 py-1.5 disabled:opacity-60">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send test
          </button>
        </div>
        {cfg.provider === "sendpk" && (
          <label className="flex flex-col text-xs gap-1">
            <span className="text-[#6B7280]">Sample template values (JSON, optional) — matches the {"{{token}}"}s used above</span>
            <input
              value={testTokensJson}
              onChange={(e) => setTestTokensJson(e.target.value)}
              placeholder={'{"who":"Test Driver","amount":"PKR 1,000","balance":"PKR 1,000","balanceLabel":"receivable"}'}
              className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm font-mono"
              dir="ltr"
            />
          </label>
        )}
        {testResult && (
          <div className={`text-[12px] rounded-lg border p-2 ${testResult.status === "sent" ? "border-[#C9D7EC] bg-[#F2F5FA] text-[#1E4480]" : "border-[#FFC2C3] bg-[#FFF1F1] text-[#B00005]"}`}>
            <div className="font-semibold flex items-center gap-1.5">
              {testResult.status === "sent" ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {testResult.status}
            </div>
            {testResult.error && <div>error: {testResult.error}</div>}
            {testResult.providerRef && <div className="font-mono text-[10px] break-all">gateway said: {testResult.providerRef}</div>}
          </div>
        )}
      </div>

      {/* recent log */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F2F5FA]">Recent SMS (last 10)</div>
        <table className="w-full text-xs">
          <thead className="bg-[#F9FAFB] text-[#6B7280]">
            <tr>
              <th className="text-left px-2 py-1.5">When</th>
              <th className="text-left px-2 py-1.5">To</th>
              <th className="text-left px-2 py-1.5">Status</th>
              <th className="text-left px-2 py-1.5">Body</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-[#F3F4F6]">
                <td className="px-2 py-1.5 whitespace-nowrap text-[#6B7280]">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="px-2 py-1.5 font-mono" dir="ltr">{l.toPhone}</td>
                <td className="px-2 py-1.5">
                  <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${
                    l.status === "sent" ? "bg-[#E6ECF6] text-[#1E4480]" :
                    l.status === "failed" ? "bg-[#FFE0E0] text-[#B00005]" :
                    "bg-[#F3F4F6] text-[#6B7280]"
                  }`}>{l.status}</span>
                </td>
                <td className="px-2 py-1.5 max-w-[280px] truncate" dir="auto" title={l.body}>{l.body}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={4} className="px-2 py-4 text-center text-[#9CA3AF]">No SMS yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
