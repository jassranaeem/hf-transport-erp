/**
 * Custom Fields · اپنے خانے — your own extra fields on parties, trucks, drivers, customers,
 * invoices, truck khatas or staff (e.g. CNIC, permit number, route card). They show under
 * "More details" on that record.
 */
import React, { useEffect, useState } from "react";
import { SlidersHorizontal, Plus, Trash2 } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { PageHeader, Btn, Card, Empty } from "../ui/kit.tsx";

const TYPE: Record<string, string> = { text: "Text", number: "Number", date: "Date", select: "Choose from a list", yesno: "Yes / No" };

export default function CustomFieldsSettings({ showFeedback }: { showFeedback: (t: "success" | "error", m: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [f, setF] = useState({ entity: "party", label: "", fieldType: "text", options: "" });
  const load = () => enterpriseFetch("/api/custom-fields").then(setD).catch((e) => showFeedback("error", e.message));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => {
    try {
      await enterpriseFetch("/api/custom-fields", { method: "POST", body: JSON.stringify(f) });
      showFeedback("success", "Field added · خانہ شامل");
      setF({ ...f, label: "", options: "" });
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  const del = async (x: any) => {
    if (!window.confirm(`Remove the field “${x.label}”? What was filled in is kept but no longer shown.`)) return;
    await enterpriseFetch(`/api/custom-fields/${x.id}`, { method: "DELETE" }).catch((e) => showFeedback("error", e.message));
    load();
  };
  const ents: Record<string, string> = d?.entities || {};
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white";
  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader title="Custom Fields" urdu="اپنے خانے" icon={<SlidersHorizontal />} subtitle="Your own extra fields — they show under “More details” on that record" />
      <Card title="Add a field · نیا خانہ" bodyClassName="p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <label className={lbl}>On<select value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })} className={inp}>{Object.entries(ents).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className={lbl}>Name of the field<input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} className={inp} placeholder="e.g. CNIC / Route permit no." dir="auto" /></label>
        <label className={lbl}>Kind<select value={f.fieldType} onChange={(e) => setF({ ...f, fieldType: e.target.value })} className={inp}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <Btn kind="primary" onClick={add} disabled={!f.label.trim()} icon={<Plus />}>Add field</Btn>
        {f.fieldType === "select" && <label className={`${lbl} sm:col-span-4`}>Choices (comma separated)<input value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} className={inp} placeholder="Owner, Partner, Hired" /></label>}
      </Card>
      {Object.entries(ents).map(([k, v]) => {
        const list = (d?.fields || []).filter((x: any) => x.entity === k);
        if (!list.length) return null;
        return (
          <React.Fragment key={k}>
          <Card title={v} bodyClassName="">
            {list.map((x: any) => (
              <div key={x.id} className="group px-4 py-2.5 border-t border-[#F1F4F9] first:border-t-0 flex items-center gap-3 text-[13px]">
                <span className="font-medium flex-1" dir="auto">{x.label}</span>
                <span className="text-[#6B7280]">{TYPE[x.field_type]}{x.options?.length ? `: ${x.options.join(", ")}` : ""}</span>
                <button onClick={() => del(x)} className="opacity-40 group-hover:opacity-100 text-[#6B7280] hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </Card>
          </React.Fragment>
        );
      })}
      {d && !(d.fields || []).length && <Card bodyClassName=""><Empty icon={<SlidersHorizontal />} title="No custom fields yet" hint="Add a field above — e.g. a party's CNIC or a truck's route-permit number." /></Card>}
    </div>
  );
}
