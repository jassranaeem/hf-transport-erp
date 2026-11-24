/**
 * Email · ای میل — the company mailbox invoices, statements and reminders are sent from.
 * The password is never typed here: it lives only on the server (SMTP_PASSWORD).
 */
import React, { useEffect, useState } from "react";
import { Mail, Send, ShieldCheck, Loader2 } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { PageHeader, Btn, Card } from "../ui/kit.tsx";

export default function EmailSettings({ showFeedback }: { showFeedback: (t: "success" | "error", m: string) => void }) {
  const [f, setF] = useState<any>(null);
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => enterpriseFetch("/api/mail/config").then(setF).catch((e) => showFeedback("error", e.message));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true);
    try {
      const { passwordSet, ready, ...rest } = f;
      setF(await enterpriseFetch("/api/mail/config", { method: "PUT", body: JSON.stringify(rest) }));
      showFeedback("success", "Saved · محفوظ");
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      await enterpriseFetch("/api/mail/test", { method: "POST", body: JSON.stringify({ to: testTo }) });
      showFeedback("success", `Test email sent to ${testTo}`);
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!f) return <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-[#9CA3AF]" /></div>;
  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white";

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="Email" urdu="ای میل" icon={<Mail />} subtitle="The mailbox invoices, statements and payment reminders are sent from" />
      <div className={`rounded-lg border px-3 py-2 text-[13px] ${f.ready ? "border-[#CFE3D6] bg-[#F1F8F4] text-[#166534]" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        {f.ready ? "Email is ready." : `Email is not ready yet: ${!f.enabled ? "it is turned off; " : ""}${!f.host || !f.user ? "server / user not filled; " : ""}${!f.passwordSet ? "the password is not set on the server." : ""}`}
      </div>
      <Card title="Mail server (SMTP)" bodyClassName="p-4 space-y-3">
        <label className="flex items-center gap-2 text-[13px] font-semibold"><input type="checkbox" checked={!!f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Send email from the app</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className={`${lbl} sm:col-span-2`}>Server (host)<input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} className={inp} placeholder="smtp.gmail.com" /></label>
          <label className={lbl}>Port<input type="number" value={f.port} onChange={(e) => setF({ ...f, port: Number(e.target.value) })} className={inp} /></label>
          <label className={`${lbl} sm:col-span-2`}>User (the mailbox)<input value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} className={inp} placeholder="accounts@yourcompany.com" /></label>
          <label className="flex items-end gap-2 text-[13px] pb-2"><input type="checkbox" checked={!!f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} /> SSL (port 465)</label>
          <label className={lbl}>Sender name<input value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} className={inp} /></label>
          <label className={lbl}>From address<input value={f.fromAddress} onChange={(e) => setF({ ...f, fromAddress: e.target.value })} className={inp} /></label>
          <label className={lbl}>Replies to (optional)<input value={f.replyTo || ""} onChange={(e) => setF({ ...f, replyTo: e.target.value })} className={inp} /></label>
        </div>
        <Btn kind="primary" onClick={save} disabled={busy}>Save</Btn>
      </Card>
      <Card title={<span className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-[#24539B]" /> The password</span>} bodyClassName="p-4 text-[13px] text-[#374151] space-y-2">
        <p>For safety the mailbox password is <b>never typed into the app</b>. It is set on the server only, as <code>SMTP_PASSWORD</code>:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>On the live site: Render → your service → Environment → add <code>SMTP_PASSWORD</code>.</li>
          <li>On this computer: add a line <code>SMTP_PASSWORD=…</code> to <code>.env.local</code> and restart.</li>
          <li>For Gmail use an “App password” (Google Account → Security → 2-Step Verification → App passwords), not your normal password.</li>
        </ul>
        <p>Right now the password is <b>{f.passwordSet ? "set ✓" : "not set"}</b>.</p>
      </Card>
      <Card title="Send a test" bodyClassName="p-4 flex gap-2">
        <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="your@email.com" className={`${inp} flex-1`} />
        <Btn onClick={test} disabled={!testTo || busy || !f.ready} icon={busy ? <Loader2 className="animate-spin" /> : <Send />}>Send test</Btn>
      </Card>
    </div>
  );
}
