/**
 * Payment Reminders · یاد دہانی — who owes us and since when, with one click to remind them by
 * SMS, email or WhatsApp, the message they get, automatic reminders (off until you turn them on)
 * and everything sent.
 */
import React, { useEffect, useState } from "react";
import { BellRing, MessageCircle, Mail, Smartphone, Settings2, RefreshCw, Loader2, History, FileText } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { PageHeader, Btn, Card, KpiStrip, Tabs, SidePanel, Empty } from "../ui/kit.tsx";
import { waLink, pkr, dmy } from "../../lib/share.ts";
import StatementOfAccount from "./StatementOfAccount.tsx";

type Nav = (wb: string, sheet: string, focus?: any) => void;

export default function Reminders({ showFeedback, onNavigate }: { showFeedback: (t: "success" | "error", m: string) => void; onNavigate?: Nav }) {
  const [tab, setTab] = useState<"due" | "all" | "log">("due");
  const [data, setData] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [log, setLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [statementFor, setStatementFor] = useState<number | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({}); // message edits per row

  const load = () => {
    setLoading(true);
    Promise.all([
      enterpriseFetch(`/api/reminders/queue?all=1`).then(setData),
      enterpriseFetch(`/api/reminders/config`).then(setCfg),
      enterpriseFetch(`/api/reminders/log`).then((r) => setLog(r.log || [])),
    ])
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const key = (x: any) => (x.partyId ? `p${x.partyId}` : `c${x.contractorId}`);
  const send = async (x: any, channel: "sms" | "email" | "whatsapp") => {
    const k = key(x) + channel;
    setBusy(k);
    try {
      const r = await enterpriseFetch("/api/reminders/send", {
        method: "POST",
        body: JSON.stringify({ partyId: x.partyId, contractorId: x.contractorId, channel, message: edit[key(x)] || x.message }),
      });
      if (channel === "whatsapp") window.open(waLink(r.phone, r.message), "_blank", "noopener");
      showFeedback("success", channel === "whatsapp" ? "WhatsApp opened — press Send there · واٹس ایپ میں بھیجیں" : `Reminder sent to ${x.name} · بھیج دی گئی`);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const items: any[] = data?.items || [];
  const shown = tab === "due" ? items.filter((x) => x.due) : items;
  const totalDue = items.filter((x) => x.due).reduce((s, x) => s + x.balance, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payment Reminders"
        urdu="یاد دہانی"
        icon={<BellRing />}
        subtitle={`Who owes us — a reminder by SMS, email or WhatsApp. Shown: balances of PKR ${(cfg?.minAmount ?? 0).toLocaleString()} or more, no payment for ${cfg?.minDays ?? 30}+ days`}
        actions={
          <>
            <Btn kind="ghost" onClick={load} icon={loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} title="Refresh" />
            <Btn onClick={() => setShowSettings(true)} icon={<Settings2 />}>Settings</Btn>
          </>
        }
      />

      <KpiStrip
        items={[
          { label: "Due a reminder · یاد دہانی باقی", value: items.filter((x) => x.due).length, tone: items.some((x) => x.due) ? "warn" : undefined },
          { label: "They owe (due) · ان پر باقی", value: pkr(totalDue), tone: totalDue ? "bad" : undefined },
          { label: "Everyone who owes · کل", value: items.length },
          { label: "Automatic reminders", value: cfg?.auto ? "On" : "Off", tone: cfg?.auto ? "good" : undefined, sub: cfg?.auto ? `by ${(cfg.autoChannels || []).join(" + ") || "—"}, every ${cfg.repeatDays} days` : "turn on in Settings" },
        ]}
      />

      {cfg && (!cfg.smsReady || !cfg.emailReady) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          {!cfg.smsReady && <>SMS is not set up yet (Console → SMS Gateway). </>}
          {!cfg.emailReady && <>Email is not set up yet (Console → Email). </>}
          WhatsApp always works — it opens the chat with the message ready.
        </div>
      )}

      <Card bodyClassName="">
        <div className="px-3 pt-1">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: "due", label: "Due now · ابھی", count: items.filter((x) => x.due).length },
              { id: "all", label: "Everyone who owes · سب", count: items.length },
              { id: "log", label: <><History className="w-3.5 h-3.5" /> Sent · بھیجی گئی</>, count: log.length },
            ]}
          />
        </div>
        {tab === "log" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]">
                <tr><th className="text-left px-3 py-2">When</th><th className="text-left px-3 py-2">To</th><th className="text-left px-3 py-2">By</th><th className="text-right px-3 py-2">Amount</th><th className="text-left px-3 py-2">Result</th><th className="text-left px-3 py-2">Message</th></tr>
              </thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id} className="border-t border-[#F1F4F9]">
                    <td className="px-3 py-2 whitespace-nowrap text-[#6B7280]">{new Date(l.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{l.auto ? " · auto" : ""}</td>
                    <td className="px-3 py-2">{l.party_name || l.to_address}</td>
                    <td className="px-3 py-2 capitalize">{l.channel}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(l.amount).toLocaleString()}</td>
                    <td className={`px-3 py-2 ${l.status === "failed" ? "text-red-600" : "text-[#166534]"}`}>{l.status === "link" ? "opened in WhatsApp" : l.status}{l.error ? ` — ${l.error}` : ""}</td>
                    <td className="px-3 py-2 max-w-[360px] truncate text-[#6B7280]" title={l.body}>{l.body}</td>
                  </tr>
                ))}
                {log.length === 0 && <tr><td colSpan={6}><Empty icon={<History />} title="No reminders sent yet" /></td></tr>}
              </tbody>
            </table>
          </div>
        ) : shown.length === 0 ? (
          <Empty icon={<BellRing />} title={tab === "due" ? "Nobody is due a reminder right now" : "Nobody owes above the limit"} hint="سب ٹھیک ہے" />
        ) : (
          <div className="divide-y divide-[#F1F4F9]">
            {shown.map((x) => {
              const k = key(x);
              return (
                <div key={k} className="px-4 py-3 flex flex-wrap gap-3 items-start">
                  <div className="min-w-[220px] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[14px] text-[#111827]" dir="auto">{x.name}</span>
                      <span className="text-[11px] rounded-full bg-[#F1F4F9] text-[#4B5563] px-2">{x.kind === "invoice" ? "Customer · invoices" : "Party khata"}</span>
                      {x.remindedRecently && <span className="text-[11px] rounded-full bg-[#EAF0F8] text-[#24539B] px-2">reminded {dmy(x.lastReminder)}</span>}
                    </div>
                    <div className="text-[12px] text-[#6B7280] mt-0.5">
                      {x.kind === "invoice" ? `${x.invoices.count} invoice(s) overdue · ${x.invoices.numbers}` : x.days != null ? `No payment for ${x.days} days${x.lastPayment ? ` (last ${dmy(x.lastPayment)})` : ""}` : "No payment yet"}
                      {x.phone ? ` · ${x.phone}` : " · no phone"}
                      {x.email ? ` · ${x.email}` : ""}
                    </div>
                    <textarea
                      value={edit[k] ?? x.message}
                      onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
                      rows={2}
                      dir="auto"
                      className="mt-2 w-full border border-[#E3E8EF] rounded-lg px-2.5 py-1.5 text-[12px] text-[#374151] bg-[#F8FAFC]"
                    />
                  </div>
                  <div className="text-right">
                    <div className="text-[11.5px] text-[#6B7280]">Owes · باقی</div>
                    <div className="text-[18px] font-semibold tabular-nums text-[#B91C1C]">{pkr(x.balance)}</div>
                    <div className="flex flex-wrap justify-end gap-1.5 mt-2">
                      <Btn size="sm" kind="outline" disabled={!x.phone || !!busy} onClick={() => send(x, "whatsapp")} icon={<MessageCircle />} title={x.phone ? "Opens WhatsApp with the message" : "No phone number"}>WhatsApp</Btn>
                      <Btn size="sm" disabled={!x.phone || !cfg?.smsReady || !!busy} onClick={() => send(x, "sms")} icon={busy === k + "sms" ? <Loader2 className="animate-spin" /> : <Smartphone />}>SMS</Btn>
                      <Btn size="sm" disabled={!x.email || !cfg?.emailReady || !!busy} onClick={() => send(x, "email")} icon={busy === k + "email" ? <Loader2 className="animate-spin" /> : <Mail />} title={x.email ? x.email : "No email — add it on the party / customer"}>Email</Btn>
                      {x.partyId && <Btn size="sm" kind="ghost" onClick={() => setStatementFor(x.partyId)} icon={<FileText />} title="Statement of account">Statement</Btn>}
                      {x.partyId && onNavigate && <Btn size="sm" kind="ghost" onClick={() => onNavigate("khata", "parties", { partyId: x.partyId })}>Khata →</Btn>}
                      {x.contractorId && onNavigate && <Btn size="sm" kind="ghost" onClick={() => onNavigate("finance", "invoices", { q: x.name })}>Invoices →</Btn>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {statementFor && <StatementOfAccount partyId={statementFor} onClose={() => setStatementFor(null)} showFeedback={showFeedback} />}
      {showSettings && cfg && <ReminderSettings cfg={cfg} onClose={() => setShowSettings(false)} onSaved={() => { setShowSettings(false); load(); }} showFeedback={showFeedback} />}
    </div>
  );
}

function ReminderSettings({ cfg, onClose, onSaved, showFeedback }: { cfg: any; onClose: () => void; onSaved: () => void; showFeedback: (t: "success" | "error", m: string) => void }) {
  const [f, setF] = useState({ ...cfg });
  const [saving, setSaving] = useState(false);
  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white";
  const save = async () => {
    setSaving(true);
    try {
      await enterpriseFetch("/api/reminders/config", { method: "PUT", body: JSON.stringify(f) });
      showFeedback("success", "Saved · محفوظ");
      onSaved();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };
  const ch = (c: string) => (f.autoChannels || []).includes(c);
  return (
    <SidePanel title="Reminder settings · ترتیبات" onClose={onClose}>
      <Card bodyClassName="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <label className={lbl}>No payment for (days)<input type="number" value={f.minDays} onChange={(e) => setF({ ...f, minDays: e.target.value })} className={inp} /></label>
          <label className={lbl}>Balance at least (PKR)<input type="number" value={f.minAmount} onChange={(e) => setF({ ...f, minAmount: e.target.value })} className={inp} /></label>
          <label className={lbl}>Not again within (days)<input type="number" value={f.repeatDays} onChange={(e) => setF({ ...f, repeatDays: e.target.value })} className={inp} /></label>
        </div>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!f.includeInvoices} onChange={(e) => setF({ ...f, includeInvoices: e.target.checked })} /> Also customers with overdue invoices</label>
        <label className={lbl}>
          Message · پیغام
          <textarea rows={4} value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} className={inp} dir="auto" />
          <span className="font-normal text-[#9CA3AF]">{"{name} {amount} {date} {days} {company}"} are filled in for each person.</span>
        </label>
      </Card>
      <Card bodyClassName="p-4 space-y-2">
        <label className="flex items-center gap-2 text-[13px] font-semibold"><input type="checkbox" checked={!!f.auto} onChange={(e) => setF({ ...f, auto: e.target.checked })} /> Send reminders automatically · خود بخود بھیجیں</label>
        <p className="text-[12px] text-[#6B7280]">When on, every few hours the system reminds whoever is due — once per the days above — by:</p>
        <div className="flex gap-4 text-[13px]">
          {["sms", "email"].map((c) => (
            <label key={c} className="flex items-center gap-1.5 capitalize">
              <input type="checkbox" checked={ch(c)} onChange={(e) => setF({ ...f, autoChannels: e.target.checked ? [...(f.autoChannels || []), c] : (f.autoChannels || []).filter((x: string) => x !== c) })} />
              {c} {c === "sms" ? (cfg.smsReady ? "" : "(not set up)") : cfg.emailReady ? "" : "(not set up)"}
            </label>
          ))}
        </div>
        <p className="text-[11.5px] text-[#9CA3AF]">WhatsApp cannot be sent automatically — it needs a person to press Send.</p>
      </Card>
      <div className="flex gap-2">
        <Btn kind="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </SidePanel>
  );
}
