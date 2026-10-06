/**
 * Depreciation Register · فرسودگی — each truck's cost, how it is depreciated (method and rate
 * from your accountant — the system never assumes one) and the charge for each financial year
 * (July–June). A register for the accountant; it does not post to the books.
 */
import React, { useEffect, useState } from "react";
import { TrendingDown, Pencil, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { PageHeader, Btn, Card, KpiStrip, SidePanel } from "../ui/kit.tsx";
import { pkr, dmy } from "../../lib/share.ts";

export default function Depreciation({ showFeedback }: { showFeedback: (t: "success" | "error", m: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [onlySet, setOnlySet] = useState(false);
  const load = () => enterpriseFetch("/api/depreciation").then(setD).catch((e) => showFeedback("error", e.message));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const list: any[] = (d?.list || []).filter((r: any) => !onlySet || r.set);
  const missing = (d?.list || []).filter((r: any) => r.missing).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Depreciation Register"
        urdu="فرسودگی"
        icon={<TrendingDown />}
        subtitle="Cost, method and rate per truck (from your accountant) → the charge each financial year · ہر سال کی فرسودگی"
      />
      <KpiStrip
        items={[
          { label: "Cost of trucks · لاگت", value: pkr(d?.totals?.cost || 0) },
          { label: "Depreciated so far · اب تک", value: pkr(d?.totals?.accumulated || 0) },
          { label: "Value now (written down) · موجودہ قیمت", value: pkr(d?.totals?.wdv || 0) },
          { label: "This year's charge · اس سال", value: pkr(d?.totals?.thisYear || 0), sub: missing ? `${missing} truck(s) still need cost / date / rate` : undefined, tone: missing ? "warn" : undefined },
        ]}
      />
      <div className="flex items-center gap-2 text-[12.5px]">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={onlySet} onChange={(e) => setOnlySet(e.target.checked)} /> Only trucks with a rate set</label>
      </div>
      <Card bodyClassName="">
        {!d ? (
          <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-[#9CA3AF]" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-[#F8FAFC] text-[#4B5563] text-[11.5px]">
                <tr className="border-b border-[#E3E8EF]"><th className="w-6" /><th className="text-left px-3 py-2">Truck</th><th className="text-right px-3 py-2">Cost</th><th className="text-left px-3 py-2">From</th><th className="text-left px-3 py-2">Method</th><th className="text-right px-3 py-2">This year</th><th className="text-right px-3 py-2">So far</th><th className="text-right px-3 py-2">Value now</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <React.Fragment key={r.vehicle_id}>
                    <tr className="group border-t border-[#F1F4F9] hover:bg-[#F8FAFC]">
                      <td className="pl-2">{r.set && <button onClick={() => setOpen(open === r.vehicle_id ? null : r.vehicle_id)} className="text-[#6B7280]">{open === r.vehicle_id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</button>}</td>
                      <td className="px-3 py-2"><div className="font-medium">{r.vehicle_number}</div><div className="text-[11px] text-[#9CA3AF]">{[r.truck_brand, r.model].filter((x: any) => x && x !== "TBD").join(" ")}</div></td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.cost ? Number(r.cost).toLocaleString() : <span className="text-amber-700">no cost</span>}</td>
                      <td className="px-3 py-2 tabular-nums">{r.start ? dmy(r.start) : <span className="text-amber-700">no date</span>}</td>
                      <td className="px-3 py-2">{r.set ? (r.method === "straight" ? `Straight line · ${r.useful_life_years} yrs` : `Reducing · ${r.rate_percent}%`) : <span className="text-amber-700">not set</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.thisYear ? Number(r.thisYear.charge).toLocaleString() : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.set ? Number(r.accumulated).toLocaleString() : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.set ? Number(r.wdv).toLocaleString() : "—"}</td>
                      <td className="px-3 py-2 text-right"><button onClick={() => setEdit(r)} className="opacity-40 group-hover:opacity-100 p-1 text-[#6B7280] hover:text-[#24539B]" title="Set cost / method / rate"><Pencil className="w-3.5 h-3.5" /></button></td>
                    </tr>
                    {open === r.vehicle_id && (
                      <tr className="bg-[#F8FAFC]">
                        <td />
                        <td colSpan={8} className="px-3 py-2">
                          <table className="text-[12px]">
                            <thead><tr className="text-[#6B7280]"><th className="text-left pr-6">Financial year</th><th className="text-right pr-6">Opening</th><th className="text-right pr-6">Charge</th><th className="text-right">Closing</th></tr></thead>
                            <tbody>{r.schedule.map((y: any) => <tr key={y.fy}><td className="pr-6">FY {y.fy}</td><td className="text-right pr-6 tabular-nums">{y.opening.toLocaleString()}</td><td className="text-right pr-6 tabular-nums">{y.charge.toLocaleString()}</td><td className="text-right tabular-nums">{y.closing.toLocaleString()}</td></tr>)}</tbody>
                          </table>
                          <div className="text-[11px] text-[#9CA3AF] mt-1">The current year is shown as a full year's charge. The first year is charged for the months owned.</div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && <EditDep r={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} showFeedback={showFeedback} />}
    </div>
  );
}

function EditDep({ r, onClose, onSaved, showFeedback }: { r: any; onClose: () => void; onSaved: () => void; showFeedback: (t: "success" | "error", m: string) => void }) {
  const [f, setF] = useState({ method: r.method || "reducing", ratePercent: r.rate_percent ?? "", usefulLifeYears: r.useful_life_years ?? "", salvageValue: r.salvage_value ?? 0, startDate: r.start || "", cost: r.cost || "", notes: r.notes || "" });
  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white";
  const save = async () => {
    try {
      await enterpriseFetch(`/api/depreciation/${r.vehicle_id}`, { method: "PUT", body: JSON.stringify(f) });
      showFeedback("success", "Saved · محفوظ");
      onSaved();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  return (
    <SidePanel title={`${r.vehicle_number} — depreciation`} subtitle="Ask your accountant for the method and rate" onClose={onClose}>
      <Card bodyClassName="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className={lbl}>Cost (PKR) · لاگت<input type="number" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} className={inp} /></label>
          <label className={lbl}>From (purchase date)<input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} className={inp} /></label>
          <label className={lbl}>Method
            <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} className={inp}><option value="reducing">Reducing balance (rate %)</option><option value="straight">Straight line (years)</option></select>
          </label>
          {f.method === "reducing" ? (
            <label className={lbl}>Rate % per year<input type="number" value={f.ratePercent} onChange={(e) => setF({ ...f, ratePercent: e.target.value })} className={inp} /></label>
          ) : (
            <label className={lbl}>Useful life (years)<input type="number" value={f.usefulLifeYears} onChange={(e) => setF({ ...f, usefulLifeYears: e.target.value })} className={inp} /></label>
          )}
          <label className={lbl}>Value left at the end (salvage)<input type="number" value={f.salvageValue} onChange={(e) => setF({ ...f, salvageValue: e.target.value })} className={inp} /></label>
        </div>
        <label className={lbl}>Note<input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inp} dir="auto" /></label>
        {!r.purchase_cost && <p className="text-[12px] text-[#6B7280]">Tip: the truck's purchase cost can also be set in Fleet → Fleet Asset Value.</p>}
      </Card>
      <div className="flex gap-2">
        <Btn kind="primary" onClick={save}>Save</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </SidePanel>
  );
}
