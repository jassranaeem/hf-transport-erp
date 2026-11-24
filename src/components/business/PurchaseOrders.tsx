/**
 * Purchase Orders · خریداری آرڈر — order parts from a supplier; when they arrive press Receive:
 * the lines go into Parts Stock and the supplier's bill is made (Bills, payable), so the order,
 * the stock and what we owe always agree.
 */
import React, { useEffect, useState } from "react";
import { ClipboardList, Plus, PackageCheck, X, Loader2, Trash2 } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { PageHeader, Btn, Card, KpiStrip, SidePanel, Empty, Tabs } from "../ui/kit.tsx";
import { pkr, dmy } from "../../lib/share.ts";

const TONE: Record<string, string> = { Open: "bg-[#EAF0F8] text-[#24539B]", Received: "bg-[#DCFCE7] text-[#166534]", Cancelled: "bg-[#F1F4F9] text-[#6B7280]", Receiving: "bg-amber-50 text-amber-800" };

export default function PurchaseOrders({ showFeedback }: { showFeedback: (t: "success" | "error", m: string) => void }) {
  const [list, setList] = useState<any[] | null>(null);
  const [tab, setTab] = useState<"Open" | "Received" | "all">("Open");
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const load = () => enterpriseFetch("/api/stock/po").then((r) => setList(r.list || [])).catch((e) => showFeedback("error", e.message));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (p: any, what: "receive" | "cancel") => {
    if (what === "receive" && !window.confirm(`Received ${p.po_number} from ${p.vendor_name}? Its lines go into stock and a bill of ${pkr(p.total)} is made. · وصول ہو گیا؟`)) return;
    if (what === "cancel" && !window.confirm(`Cancel ${p.po_number}?`)) return;
    setBusy(p.id);
    try {
      await enterpriseFetch(`/api/stock/po/${p.id}/${what}`, { method: "POST", body: "{}" });
      showFeedback("success", what === "receive" ? "Received — in stock, bill made · اسٹاک اور بل" : "Cancelled");
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(null);
    }
  };
  const all = list || [];
  const shown = tab === "all" ? all : all.filter((p) => p.status === tab);
  const open = all.filter((p) => p.status === "Open");

  return (
    <div className="space-y-4">
      <PageHeader title="Purchase Orders" urdu="خریداری آرڈر" icon={<ClipboardList />} subtitle="Order parts → receive → stock in + supplier's bill, in one step" actions={<Btn kind="primary" onClick={() => setShowNew(true)} icon={<Plus />}>New order</Btn>} />
      <KpiStrip
        items={[
          { label: "Open orders · کھلے", value: open.length },
          { label: "Value on order · مالیت", value: pkr(open.reduce((s, p) => s + p.total, 0)) },
          { label: "Received this month", value: all.filter((p) => p.status === "Received" && String(p.order_day).slice(0, 7) === new Date().toISOString().slice(0, 7)).length },
        ]}
      />
      <Card bodyClassName="">
        <div className="px-3 pt-1"><Tabs value={tab} onChange={setTab} items={[{ id: "Open", label: "Open · کھلے", count: open.length }, { id: "Received", label: "Received · وصول" }, { id: "all", label: "All" }]} /></div>
        {!list ? (
          <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-[#9CA3AF]" /></div>
        ) : shown.length === 0 ? (
          <Empty icon={<ClipboardList />} title="No orders here" action={<Btn kind="primary" onClick={() => setShowNew(true)} icon={<Plus />}>New order</Btn>} />
        ) : (
          <div className="divide-y divide-[#F1F4F9]">
            {shown.map((p) => (
              <div key={p.id} className="px-4 py-3 flex flex-wrap gap-3 items-start">
                <div className="flex-1 min-w-[240px]">
                  <div className="flex items-center gap-2"><b className="text-[#24539B]">{p.po_number}</b><span className={`text-[11px] rounded-full px-2 ${TONE[p.status] || ""}`}>{p.status}</span><span className="text-[13px]">{p.vendor_name}</span></div>
                  <div className="text-[11.5px] text-[#6B7280]">Ordered {dmy(p.order_day)}{p.expected_day ? ` · expected ${dmy(p.expected_day)}` : ""}{p.bill_number ? ` · bill ${p.bill_number}${p.bill_due > 0 ? ` (owed ${Number(p.bill_due).toLocaleString()})` : " (paid)"}` : ""}</div>
                  <div className="text-[12px] text-[#374151] mt-1">{(p.lines || []).map((l: any) => `${l.qty} × ${l.name || "item"} @ ${Number(l.rate).toLocaleString()}`).join(" · ")}</div>
                </div>
                <div className="text-right">
                  <div className="text-[17px] font-semibold tabular-nums">{pkr(p.total)}</div>
                  {p.status === "Open" && (
                    <div className="flex gap-1.5 mt-1.5">
                      <Btn size="sm" kind="primary" onClick={() => act(p, "receive")} disabled={busy === p.id} icon={busy === p.id ? <Loader2 className="animate-spin" /> : <PackageCheck />}>Receive</Btn>
                      <Btn size="sm" kind="ghost" onClick={() => act(p, "cancel")} icon={<X />}>Cancel</Btn>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      {showNew && <NewPO onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} showFeedback={showFeedback} />}
    </div>
  );
}

function NewPO({ onClose, onSaved, showFeedback }: { onClose: () => void; onSaved: () => void; showFeedback: (t: "success" | "error", m: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState({ vendorName: "", orderDate: new Date().toISOString().slice(0, 10), expectedDate: "", notes: "" });
  const [lines, setLines] = useState<any[]>([{ itemId: "", name: "", qty: "", rate: "" }]);
  useEffect(() => {
    enterpriseFetch("/api/stock/items").then((r) => setItems(r.items || [])).catch(() => {});
  }, []);
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const setLine = (i: number, patch: any) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-2.5 py-2 text-[13px] bg-white";
  const save = async () => {
    try {
      await enterpriseFetch("/api/stock/po", { method: "POST", body: JSON.stringify({ ...f, lines: lines.map((l) => ({ ...l, itemId: l.itemId || null })) }) });
      showFeedback("success", "Order saved · آرڈر محفوظ");
      onSaved();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  return (
    <SidePanel title="New purchase order · نیا آرڈر" width="lg" onClose={onClose}>
      <Card bodyClassName="p-4 grid grid-cols-3 gap-3">
        <label className={`${lbl} col-span-3 sm:col-span-1`}>Supplier · سپلائر<input value={f.vendorName} onChange={(e) => setF({ ...f, vendorName: e.target.value })} className={inp} autoFocus dir="auto" /></label>
        <label className={lbl}>Order date<input type="date" value={f.orderDate} onChange={(e) => setF({ ...f, orderDate: e.target.value })} className={inp} /></label>
        <label className={lbl}>Expected<input type="date" value={f.expectedDate} onChange={(e) => setF({ ...f, expectedDate: e.target.value })} className={inp} /></label>
      </Card>
      <Card title="Lines · اشیاء" bodyClassName="p-3 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_80px_110px_28px] gap-2 items-center">
            <div>
              <select value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value, name: items.find((x) => String(x.id) === e.target.value)?.name || "", rate: l.rate || items.find((x) => String(x.id) === e.target.value)?.last_cost || "" })} className={`${inp} w-full`}>
                <option value="">— new item (type below) —</option>
                {items.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.on_hand} on hand)</option>)}
              </select>
              {!l.itemId && <input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="Item name" className={`${inp} w-full mt-1`} dir="auto" />}
            </div>
            <input type="number" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder="Qty" className={inp} />
            <input type="number" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} placeholder="Rate" className={inp} />
            <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-[#9CA3AF] hover:text-red-600" disabled={lines.length === 1}><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <div className="flex items-center justify-between pt-1">
          <Btn size="sm" kind="ghost" onClick={() => setLines([...lines, { itemId: "", name: "", qty: "", rate: "" }])} icon={<Plus />}>Add line</Btn>
          <div className="text-[14px]">Total <b className="tabular-nums">{pkr(total)}</b></div>
        </div>
      </Card>
      <div className="flex gap-2"><Btn kind="primary" onClick={save} disabled={!f.vendorName.trim() || !total}>Save order</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </SidePanel>
  );
}
