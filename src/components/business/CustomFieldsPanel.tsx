/**
 * Your own fields on a record (set up in Console → Custom Fields) · اپنے خانے.
 * Shows nothing when no field has been made for this kind of record.
 */
import React, { useEffect, useState } from "react";
import { Loader2, Save, SlidersHorizontal } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";

export default function CustomFieldsPanel({
  entity,
  recordId,
  showFeedback,
}: {
  entity: string;
  recordId: number;
  showFeedback?: (t: "success" | "error", m: string) => void;
}) {
  const [fields, setFields] = useState<any[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDirty(false);
    Promise.all([enterpriseFetch(`/api/custom-fields?entity=${entity}`), enterpriseFetch(`/api/custom-fields/values?entity=${entity}&recordId=${recordId}`)])
      .then(([f, v]) => {
        setFields(f.fields || []);
        setValues(v.values || {});
      })
      .catch(() => setFields([]));
  }, [entity, recordId]);

  if (!fields.length) return null;
  const set = (k: string, v: string) => {
    setValues({ ...values, [k]: v });
    setDirty(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      await enterpriseFetch("/api/custom-fields/values", { method: "PUT", body: JSON.stringify({ entity, recordId, values }) });
      setDirty(false);
      showFeedback?.("success", "Saved · محفوظ");
    } catch (e: any) {
      showFeedback?.("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white w-full";

  return (
    <div className="rounded-lg border border-[#E3E8EF] bg-[#F8FAFC] p-3 mt-3">
      <div className="text-[12px] font-semibold text-[#374151] flex items-center gap-1.5 mb-2">
        <SlidersHorizontal className="w-3.5 h-3.5 text-[#24539B]" /> More details · مزید تفصیل
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]">
            {f.label}
            {f.field_type === "select" ? (
              <select value={values[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} className={inp}>
                <option value="">—</option>
                {(f.options || []).map((o: string) => <option key={o}>{o}</option>)}
              </select>
            ) : f.field_type === "yesno" ? (
              <select value={values[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} className={inp}>
                <option value="">—</option>
                <option>Yes</option>
                <option>No</option>
              </select>
            ) : (
              <input
                type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                value={values[f.key] || ""}
                onChange={(e) => set(f.key, e.target.value)}
                className={inp}
                dir="auto"
              />
            )}
          </label>
        ))}
      </div>
      {dirty && (
        <button onClick={save} disabled={busy} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#24539B] text-white text-[12.5px] px-3 py-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save these
        </button>
      )}
    </div>
  );
}
