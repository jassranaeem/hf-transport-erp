/**
 * Recurring Entries · ہر ماہ کی اندراجات — salary, rent, an instalment: written once; on each due
 * day it waits here (and in AI Accountant) as a draft for you to approve. Approve → it is in the
 * Cash Book / khata; it can be undone like any draft.
 */
import React, { useEffect, useState } from "react";
import { Repeat, Plus, Pause, Play, Trash2, Check, Loader2 } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { PageHeader, Btn, Card, KpiStrip, SidePanel, Empty } from "../ui/kit.tsx";
import { pkr, dmy } from "../../lib/share.ts";

const FREQ: Record<string, string> = { monthly: "Every month", weekly: "Every week", quarterly: "Every 3 months", yearly: "Every year" };
const TARGET: Record<string, string> = { cash: "Daily Cash Book", truck: "Truck khata", party: "Party khata" };

export default function Recurring({ showFeedback }: { showFeedback: (t: "success" | "error", m: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => enterpriseFetch("/api/recurring").then(setD).catch((e) => showFeedback("error", e.message));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (r: any) => {
    await enterpriseFetch(`/api/recurring/${r.id}`, { method: "PUT", body: JSON.stringify({ isActive: !r.is_active }) }).catch((e) => showFeedback("error", e.message));
    load();
  };
  const del = async (r: any) => {
    if (!window.confirm(`Stop and remove “${r.name}”? Entries already made stay. · ہٹا دیں؟`)) return;
    await enterpriseFetch(`/api/recurring/${r.id}`, { method: "DELETE" }).catch((e) => showFeedback("error", e.message));
    load();
  };
  const approve = async (ids: number[]) => {
    setBusy(true);
    try {
      const r = await enterpriseFetch("/api/ai-accountant/drafts/approve", { method: "POST", body: JSON.stringify({ ids }) });
      if (r.failed) showFeedback("error", r.results.find((x: any) => !x.ok)?.error || `${r.failed} could not be posted`);
      else showFeedback("success", `${r.posted} entered · درج ہو گئیں`);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const reject = async (id: number) => {
    await enterpriseFetch("/api/ai-accountant/drafts/reject", { method: "POST", body: JSON.stringify({ ids: [id] }) }).catch((e) => showFeedback("error", e.message));
    load();
  };

  const list: any[] = d?.list || [];
  const pending: any[] = d?.pending || [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Recurring Entries"
        urdu="ہر ماہ کی اندراجات"
        icon={<Repeat />}
        subtitle="Salary, rent, instalments — made for you on the day, entered when you approve · منظوری کے بعد درج"
        actions={<Btn kind="primary" onClick={() => setShowNew(true)} icon={<Plus />}>New recurring entry</Btn>}
      />
      <KpiStrip
        items={[
          { label: "Waiting for approval · منظوری", value: pending.length, tone: pending.length ? "warn" : undefined },
          { label: "Active · جاری", value: list.filter((r) => r.is_active).length },
          { label: "About each month · ماہانہ", value: pkr(d?.monthly || 0), tone: (d?.monthly || 0) < 0 ? "bad" : "good", sub: (d?.monthly || 0) < 0 ? "goes out" : "comes in" },
        ]}
      />

      {pending.length > 0 && (
        <Card title={<span>Due — approve to enter them · آج کی اندراجات</span>} actions={<Btn size="sm" kind="primary" disabled={busy} onClick={() => approve(pending.map((p) => p.id))} icon={busy ? <Loader2 className="animate-spin" /> : <Check />}>Approve all</Btn>} bodyClassName="">
          <div className="divide-y divide-[#F1F4F9]">
            {pending.map((p) => (
              <div key={p.id} className="px-4 py-2.5 flex flex-wrap items-center gap-3 text-[13px]">
                <span className="tabular-nums text-[#6B7280] w-24">{dmy(p.entry_date)}</span>
                <span className="flex-1 min-w-[200px]"><b>{p.source_name}</b> · {p.description} <span className="text-[#9CA3AF]">→ {TARGET[p.target] || p.target}</span>{p.status === "failed" && <span className="text-red-600"> · could not post</span>}</span>
                <span className={`tabular-nums font-semibold ${p.direction === "Out" ? "text-[#B91C1C]" : "text-[#166534]"}`}>{p.direction === "Out" ? "−" : "+"}{pkr(p.amount)}</span>
                <Btn size="sm" kind="outline" disabled={busy} onClick={() => approve([p.id])} icon={<Check />}>Approve</Btn>
                <Btn size="sm" kind="ghost" onClick={() => reject(p.id)}>Skip</Btn>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card bodyClassName="">
        {!d ? (
          <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-[#9CA3AF]" /></div>
        ) : list.length === 0 ? (
          <Empty icon={<Repeat />} title="No recurring entries yet" hint="Salary on the 1st, rent on the 5th, a truck instalment every month — write it once." action={<Btn kind="primary" onClick={() => setShowNew(true)} icon={<Plus />}>New recurring entry</Btn>} />
        ) : (
          <table className="w-full text-[12.5px]">
            <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]">
              <tr className="border-b border-[#E3E8EF]"><th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Goes to</th><th className="text-left px-3 py-2">How often</th><th className="text-left px-3 py-2">Next</th><th className="text-right px-3 py-2">Amount</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className={`group border-t border-[#F1F4F9] ${r.is_active ? "" : "opacity-50"}`}>
                  <td className="px-3 py-2"><div className="font-medium text-[#111827]">{r.name}</div><div className="text-[11px] text-[#6B7280]" dir="auto">{r.template?.description}</div></td>
                  <td className="px-3 py-2">{TARGET[r.target]}{r.truck ? ` · ${r.truck}` : ""}{r.party ? ` · ${r.party}` : ""}</td>
                  <td className="px-3 py-2">{FREQ[r.frequency]}{r.end_day ? ` · until ${dmy(r.end_day)}` : ""}</td>
                  <td className="px-3 py-2 tabular-nums">{r.is_active ? dmy(r.next_day) : "paused"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.template?.direction === "Out" ? "text-[#B91C1C]" : "text-[#166534]"}`}>{r.template?.direction === "Out" ? "−" : "+"}{pkr(r.template?.amount)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => toggle(r)} className="p-1 text-[#6B7280] hover:text-[#24539B]" title={r.is_active ? "Pause" : "Start again"}>{r.is_active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}</button>
                    <button onClick={() => del(r)} className="p-1 text-[#6B7280] hover:text-red-600" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {showNew && <NewRecurring onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} showFeedback={showFeedback} />}
    </div>
  );
}

function NewRecurring({ onClose, onSaved, showFeedback }: { onClose: () => void; onSaved: () => void; showFeedback: (t: "success" | "error", m: string) => void }) {
  const [opts, setOpts] = useState<{ trucks: any[]; parties: any[] }>({ trucks: [], parties: [] });
  const [f, setF] = useState<any>({ name: "", target: "cash", link: "", frequency: "monthly", nextDate: new Date().toISOString().slice(0, 10), endDate: "", direction: "Out", amount: "", method: "Cash", vehicleId: "", partyId: "", category: "", description: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    enterpriseFetch("/api/cash-book/link-options").then((r) => setOpts({ trucks: r.trucks || [], parties: r.parties || [] })).catch(() => {});
  }, []);
  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white";
  const save = async () => {
    setSaving(true);
    try {
      const truck = opts.trucks.find((t) => String(t.id) === String(f.vehicleId));
      const r = await enterpriseFetch("/api/recurring", {
        method: "POST",
        body: JSON.stringify({
          name: f.name,
          target: f.target,
          frequency: f.frequency,
          nextDate: f.nextDate,
          endDate: f.endDate || null,
          template: {
            direction: f.direction,
            amount: Number(f.amount),
            method: f.method,
            // the Cash Book links by vehicle; the truck khata picks the truck's own khata
            vehicleId: (f.target === "truck" || (f.target === "cash" && f.link === "truck")) && truck ? truck.vehicleId ?? truck.id : null,
            partyId: f.target === "party" || (f.target === "cash" && f.link === "party") ? Number(f.partyId) || null : null,
            person: f.target === "cash" && f.link === "personal" ? "personal" : null,
            category: f.category || null,
            description: f.description,
          },
        }),
      });
      showFeedback("success", r.made ? `Saved — ${r.made} due now, waiting for your approval` : "Saved · محفوظ");
      onSaved();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <SidePanel title="New recurring entry · ہر ماہ کی اندراج" onClose={onClose}>
      <Card bodyClassName="p-4 space-y-3">
        <label className={lbl}>Name · نام<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inp} placeholder="e.g. Office rent" dir="auto" autoFocus /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className={lbl}>Goes to · کہاں
            <select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} className={inp}>
              <option value="cash">Daily Cash Book</option>
              <option value="truck">A truck's khata</option>
              <option value="party">A party's khata</option>
            </select>
          </label>
          {f.target === "cash" && (
            <label className={lbl}>Also add to
              <select value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} className={inp}>
                <option value="">Just the Cash Book</option>
                <option value="truck">A truck</option>
                <option value="party">A party</option>
                <option value="personal">Personal & Household</option>
              </select>
            </label>
          )}
          {(f.target === "truck" || (f.target === "cash" && f.link === "truck")) && (
            <label className={lbl}>Truck<select value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })} className={inp}><option value="">— choose —</option>{opts.trucks.map((t) => <option key={t.id} value={t.id}>{t.registration}</option>)}</select></label>
          )}
          {(f.target === "party" || (f.target === "cash" && f.link === "party")) && (
            <label className={lbl}>Party<select value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })} className={inp}><option value="">— choose —</option>{opts.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          )}
          <label className={lbl}>In / Out
            <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} className={inp}><option value="Out">Out (paid) · ادا</option><option value="In">In (received) · وصول</option></select>
          </label>
          <label className={lbl}>Amount (PKR) · رقم<input inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d]/g, "") })} className={`${inp} font-semibold`} /></label>
          <label className={lbl}>How often
            <select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} className={inp}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className={lbl}>First date · پہلی تاریخ<input type="date" value={f.nextDate} onChange={(e) => setF({ ...f, nextDate: e.target.value })} className={inp} /></label>
          <label className={lbl}>Until (optional)<input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} className={inp} /></label>
          <label className={lbl}>Method<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} className={inp}>{["Cash", "Online", "Cheque", "Bank Transfer"].map((m) => <option key={m}>{m}</option>)}</select></label>
          {f.target === "truck" && <label className={lbl}>Category<input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={inp} placeholder="Salary / Insurance / Permit…" /></label>}
        </div>
        <label className={lbl}>Description · تفصیل<input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={inp} placeholder="What it is for" dir="auto" /></label>
        <p className="text-[12px] text-[#6B7280]">On each date it is made as a draft — nothing is entered until you approve it.</p>
      </Card>
      <div className="flex gap-2">
        <Btn kind="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </SidePanel>
  );
}
