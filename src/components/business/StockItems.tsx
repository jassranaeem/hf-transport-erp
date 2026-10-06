/**
 * Parts Stock · اسٹاک — what the workshop keeps (tyres, filters, oil, batteries…), how many are on
 * hand, what is running low, and every in / out (out = fitted on a truck).
 */
import React, { useEffect, useState } from "react";
import { Package, Plus, ArrowDownToLine, ArrowUpFromLine, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { PageHeader, Btn, Card, KpiStrip, SidePanel, Empty, Tabs } from "../ui/kit.tsx";
import { pkr, dmy } from "../../lib/share.ts";

export default function StockItems({ showFeedback }: { showFeedback: (t: "success" | "error", m: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [tab, setTab] = useState<"items" | "moves">("items");
  const [q, setQ] = useState("");
  const [newItem, setNewItem] = useState(false);
  const [move, setMove] = useState<{ item: any; kind: "in" | "out" | "adjust" } | null>(null);
  const load = () => {
    enterpriseFetch("/api/stock/items").then(setD).catch((e) => showFeedback("error", e.message));
    enterpriseFetch("/api/stock/moves").then((r) => setMoves(r.moves || [])).catch(() => {});
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  const items: any[] = (d?.items || []).filter((i: any) => !q || `${i.code} ${i.name} ${i.category || ""}`.toLowerCase().includes(q.toLowerCase()));
  const delMove = async (m: any) => {
    if (!window.confirm("Take this stock move back? · واپس لیں؟")) return;
    await enterpriseFetch(`/api/stock/moves/${m.id}`, { method: "DELETE" }).then(load).catch((e) => showFeedback("error", e.message));
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Parts Stock"
        urdu="اسٹاک"
        icon={<Package />}
        subtitle="Tyres, filters, oil, batteries, spare parts — on hand, running low, fitted on which truck"
        actions={<Btn kind="primary" onClick={() => setNewItem(true)} icon={<Plus />}>New item</Btn>}
      />
      <KpiStrip
        items={[
          { label: "Items · اشیاء", value: d?.totals?.items ?? "—" },
          { label: "Stock value · مالیت", value: pkr(d?.totals?.value || 0), sub: "at the last price paid" },
          { label: "Running low · کم", value: d?.totals?.low ?? 0, tone: d?.totals?.low ? "warn" : undefined },
        ]}
      />
      <Card bodyClassName="">
        <div className="px-3 pt-1 flex items-end gap-2">
          <div className="flex-1">
            <Tabs value={tab} onChange={setTab} items={[{ id: "items", label: "Items · اشیاء", count: d?.items?.length }, { id: "moves", label: "In / out · آمد و خرچ", count: moves.length }]} />
          </div>
          {tab === "items" && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="mb-1.5 border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 text-[12.5px] w-48" />}
        </div>
        {!d ? (
          <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-[#9CA3AF]" /></div>
        ) : tab === "items" ? (
          items.length === 0 ? (
            <Empty icon={<Package />} title="No items yet" hint="Add what the workshop keeps, or receive a purchase order — its lines become items." action={<Btn kind="primary" onClick={() => setNewItem(true)} icon={<Plus />}>New item</Btn>} />
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]"><tr className="border-b border-[#E3E8EF]"><th className="text-left px-3 py-2">Code</th><th className="text-left px-3 py-2">Item</th><th className="text-right px-3 py-2">On hand</th><th className="text-right px-3 py-2">Last price</th><th className="text-right px-3 py-2">Value</th><th className="px-3 py-2" /></tr></thead>
              <tbody>
                {items.map((i) => {
                  const low = i.reorder_level > 0 && i.on_hand <= i.reorder_level;
                  return (
                    <tr key={i.id} className={`border-t border-[#F1F4F9] ${low ? "bg-amber-50/60" : "hover:bg-[#F8FAFC]"}`}>
                      <td className="px-3 py-2 text-[#6B7280]">{i.code}</td>
                      <td className="px-3 py-2"><div className="font-medium" dir="auto">{i.name}</div><div className="text-[11px] text-[#9CA3AF]">{i.category}{i.reorder_level ? ` · re-order at ${i.reorder_level}` : ""}</div></td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${low ? "text-amber-800" : ""}`}>{low && <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />}{i.on_hand} {i.unit}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(i.last_cost).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(i.value || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Btn size="sm" kind="ghost" onClick={() => setMove({ item: i, kind: "in" })} icon={<ArrowDownToLine />}>In</Btn>
                        <Btn size="sm" kind="ghost" onClick={() => setMove({ item: i, kind: "out" })} icon={<ArrowUpFromLine />} disabled={i.on_hand <= 0}>Fit on truck</Btn>
                        <Btn size="sm" kind="ghost" onClick={() => setMove({ item: i, kind: "adjust" })}>Count</Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : moves.length === 0 ? (
          <Empty icon={<Package />} title="No stock moves yet" />
        ) : (
          <table className="w-full text-[12.5px]">
            <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]"><tr className="border-b border-[#E3E8EF]"><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Item</th><th className="text-right px-3 py-2">Qty</th><th className="text-left px-3 py-2">What</th><th className="text-right px-3 py-2">Price</th><th className="text-left px-3 py-2">By</th><th /></tr></thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id} className="group border-t border-[#F1F4F9]">
                  <td className="px-3 py-2 tabular-nums">{dmy(m.day)}</td>
                  <td className="px-3 py-2">{m.item}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${m.qty < 0 ? "text-[#B91C1C]" : "text-[#166534]"}`}>{m.qty > 0 ? "+" : ""}{m.qty}</td>
                  <td className="px-3 py-2">{m.kind === "out" ? `Fitted on ${m.truck || "—"}` : m.po_number ? `Received · ${m.po_number}` : m.kind === "adjust" ? "Count correction" : "In"}{m.notes ? <span className="text-[#9CA3AF]"> · {m.notes}</span> : null}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(m.unit_cost).toLocaleString()}</td>
                  <td className="px-3 py-2 text-[#6B7280]">{m.by_name}</td>
                  <td className="px-3 py-2 text-right">{!m.po_id && <button onClick={() => delMove(m)} className="opacity-40 group-hover:opacity-100 text-[#6B7280] hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {newItem && <NewItem onClose={() => setNewItem(false)} onSaved={() => { setNewItem(false); load(); }} showFeedback={showFeedback} />}
      {move && <MoveForm item={move.item} kind={move.kind} onClose={() => setMove(null)} onSaved={() => { setMove(null); load(); }} showFeedback={showFeedback} />}
    </div>
  );
}

const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white";

function NewItem({ onClose, onSaved, showFeedback }: { onClose: () => void; onSaved: () => void; showFeedback: (t: "success" | "error", m: string) => void }) {
  const [f, setF] = useState({ name: "", code: "", unit: "pcs", category: "", reorderLevel: "", lastCost: "" });
  const save = async () => {
    try {
      await enterpriseFetch("/api/stock/items", { method: "POST", body: JSON.stringify(f) });
      showFeedback("success", "Item added · شامل");
      onSaved();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  return (
    <SidePanel title="New stock item · نئی چیز" onClose={onClose}>
      <Card bodyClassName="p-4 grid grid-cols-2 gap-3">
        <label className={`${lbl} col-span-2`}>Name · نام<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inp} placeholder="e.g. Oil filter (Hino)" autoFocus dir="auto" /></label>
        <label className={lbl}>Code (optional)<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className={inp} /></label>
        <label className={lbl}>Unit<select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} className={inp}>{["pcs", "set", "litre", "kg", "pair", "box"].map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className={lbl}>Kind<input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={inp} placeholder="Tyre / Filter / Oil…" /></label>
        <label className={lbl}>Re-order when at<input type="number" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} className={inp} /></label>
        <label className={lbl}>Price (PKR)<input type="number" value={f.lastCost} onChange={(e) => setF({ ...f, lastCost: e.target.value })} className={inp} /></label>
      </Card>
      <div className="flex gap-2"><Btn kind="primary" onClick={save} disabled={!f.name.trim()}>Add item</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </SidePanel>
  );
}

function MoveForm({ item, kind, onClose, onSaved, showFeedback }: { item: any; kind: "in" | "out" | "adjust"; onClose: () => void; onSaved: () => void; showFeedback: (t: "success" | "error", m: string) => void }) {
  const [trucks, setTrucks] = useState<any[]>([]);
  const [f, setF] = useState({ qty: "", unitCost: kind === "in" ? String(item.last_cost || "") : "", vehicleId: "", date: new Date().toISOString().slice(0, 10), notes: "" });
  useEffect(() => {
    if (kind === "out") enterpriseFetch("/api/cash-book/link-options").then((r) => setTrucks(r.trucks || [])).catch(() => {});
  }, [kind]);
  const save = async () => {
    try {
      const qty = kind === "adjust" ? Number(f.qty) - item.on_hand : Number(f.qty);
      if (kind === "adjust" && qty === 0) return onClose();
      await enterpriseFetch("/api/stock/moves", { method: "POST", body: JSON.stringify({ ...f, itemId: item.id, kind, qty }) });
      showFeedback("success", "Saved · محفوظ");
      onSaved();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  const title = kind === "in" ? "Stock in · آمد" : kind === "out" ? "Fit on a truck · ٹرک پر لگایا" : "Count correction · گنتی";
  return (
    <SidePanel title={title} subtitle={`${item.name} · on hand ${item.on_hand} ${item.unit}`} onClose={onClose}>
      <Card bodyClassName="p-4 grid grid-cols-2 gap-3">
        <label className={lbl}>{kind === "adjust" ? "Counted now" : "Quantity"}<input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={inp} autoFocus /></label>
        <label className={lbl}>Date<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inp} /></label>
        {kind === "in" && <label className={lbl}>Price each (PKR)<input type="number" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} className={inp} /></label>}
        {kind === "out" && (
          <label className={lbl}>Truck · ٹرک<select value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })} className={inp}><option value="">— choose —</option>{trucks.map((t) => <option key={t.id} value={t.id}>{t.registration}</option>)}</select></label>
        )}
        <label className={`${lbl} col-span-2`}>Note<input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inp} dir="auto" /></label>
        {kind === "adjust" && f.qty !== "" && <div className="col-span-2 text-[12.5px] text-[#4B5563]">Difference: <b>{Number(f.qty) - item.on_hand}</b></div>}
      </Card>
      <div className="flex gap-2"><Btn kind="primary" onClick={save} disabled={f.qty === "" || (kind === "out" && !f.vehicleId)}>Save</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </SidePanel>
  );
}
