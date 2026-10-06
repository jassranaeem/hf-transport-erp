/**
 * Approvals · منظوری — big payments waiting for the owner, the decisions made, and the rule
 * (on/off, the amount, who approves).
 */
import React, { useEffect, useState } from "react";
import { ShieldCheck, Check, X, Settings2, Loader2 } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { PageHeader, Btn, Card, KpiStrip, Tabs, SidePanel, Empty } from "../ui/kit.tsx";
import { pkr } from "../../lib/share.ts";

const ROLES = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Operations Manager"];
const KIND: Record<string, string> = { cash_book: "Cash Book", party_payment: "Party payment", truck_payment: "Truck khata" };

export default function Approvals({ showFeedback }: { showFeedback: (t: "success" | "error", m: string) => void }) {
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [showCfg, setShowCfg] = useState(false);
  const load = () => enterpriseFetch(`/api/approvals?status=${tab}`).then(setD).catch((e) => showFeedback("error", e.message));
  useEffect(() => {
    load();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (a: any, ok: boolean) => {
    const note = ok ? "" : window.prompt("Why is it rejected? (the person who asked will see this) · وجہ", "") ?? null;
    if (note === null) return;
    setBusy(a.id);
    try {
      await enterpriseFetch(`/api/approvals/${a.id}/${ok ? "approve" : "reject"}`, { method: "POST", body: JSON.stringify({ note }) });
      showFeedback("success", ok ? "Approved — it is written now · منظور" : "Rejected · مسترد");
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(null);
    }
  };
  const cfg = d?.config;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approvals"
        urdu="منظوری"
        icon={<ShieldCheck />}
        subtitle={cfg?.enabled ? `Money going out of PKR ${Number(cfg.threshold).toLocaleString()} or more waits for: ${cfg.approverRoles.join(", ")}` : "Off — every payment is written straight away. Turn it on in Settings."}
        actions={<Btn onClick={() => setShowCfg(true)} icon={<Settings2 />}>Settings</Btn>}
      />
      <KpiStrip
        items={[
          { label: "Waiting · منتظر", value: d?.pending ?? "—", tone: d?.pending ? "warn" : undefined },
          { label: "Rule", value: cfg?.enabled ? "On" : "Off", tone: cfg?.enabled ? "good" : undefined },
          { label: "Limit · حد", value: cfg ? pkr(cfg.threshold) : "—" },
          { label: "You can approve", value: d?.canApprove ? "Yes" : "No" },
        ]}
      />
      <Card bodyClassName="">
        <div className="px-3 pt-1">
          <Tabs value={tab} onChange={setTab} items={[{ id: "pending", label: "Waiting · منتظر", count: d?.pending }, { id: "approved", label: "Approved · منظور" }, { id: "rejected", label: "Rejected · مسترد" }]} />
        </div>
        {!d ? (
          <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-[#9CA3AF]" /></div>
        ) : d.list.length === 0 ? (
          <Empty icon={<ShieldCheck />} title={tab === "pending" ? "Nothing is waiting" : "Nothing here yet"} />
        ) : (
          <div className="divide-y divide-[#F1F4F9]">
            {d.list.map((a: any) => (
              <div key={a.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[240px]">
                  <div className="text-[13.5px] font-medium text-[#111827]" dir="auto">{a.summary}</div>
                  <div className="text-[11.5px] text-[#6B7280]">
                    #{a.id} · {KIND[a.kind] || a.kind} · asked by {a.requested_by_name || "—"} · {new Date(a.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {a.decided_by_name ? ` · ${a.status} by ${a.decided_by_name}` : ""}
                    {a.decision_note ? ` — “${a.decision_note}”` : ""}
                  </div>
                </div>
                <div className="text-[17px] font-semibold tabular-nums text-[#B91C1C]">{pkr(a.amount)}</div>
                {tab === "pending" && d.canApprove && (
                  <div className="flex gap-2">
                    <Btn size="sm" kind="primary" onClick={() => decide(a, true)} disabled={busy === a.id} icon={busy === a.id ? <Loader2 className="animate-spin" /> : <Check />}>Approve</Btn>
                    <Btn size="sm" kind="danger" onClick={() => decide(a, false)} disabled={busy === a.id} icon={<X />}>Reject</Btn>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      {showCfg && cfg && <ApprovalSettings cfg={cfg} onClose={() => setShowCfg(false)} onSaved={() => { setShowCfg(false); load(); }} showFeedback={showFeedback} />}
    </div>
  );
}

function ApprovalSettings({ cfg, onClose, onSaved, showFeedback }: { cfg: any; onClose: () => void; onSaved: () => void; showFeedback: (t: "success" | "error", m: string) => void }) {
  const [f, setF] = useState({ ...cfg });
  const save = async () => {
    try {
      await enterpriseFetch("/api/approvals/config", { method: "PUT", body: JSON.stringify(f) });
      showFeedback("success", "Saved · محفوظ");
      onSaved();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  return (
    <SidePanel title="Approval rule · منظوری کا اصول" onClose={onClose}>
      <Card bodyClassName="p-4 space-y-3">
        <label className="flex items-center gap-2 text-[13px] font-semibold"><input type="checkbox" checked={!!f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Big payments need approval · بڑی ادائیگی کے لیے منظوری</label>
        <label className="flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]">
          From this amount (PKR) · اس رقم سے
          <input type="number" value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px]" />
        </label>
        <div className="text-[11.5px] font-medium text-[#4B5563]">Who approves (their own entries go straight in)</div>
        <div className="grid grid-cols-2 gap-1.5 text-[13px]">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1.5">
              <input type="checkbox" disabled={r === "Super Admin"} checked={f.approverRoles.includes(r)} onChange={(e) => setF({ ...f, approverRoles: e.target.checked ? [...f.approverRoles, r] : f.approverRoles.filter((x: string) => x !== r) })} />
              {r}
            </label>
          ))}
        </div>
        <p className="text-[12px] text-[#6B7280]">It covers a Daily Cash Book “Out”, a payment to a party (cash / bank) and a payment from a truck's khata. A waiting payment is not in any balance until it is approved.</p>
      </Card>
      <div className="flex gap-2">
        <Btn kind="primary" onClick={save}>Save rule</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </SidePanel>
  );
}
