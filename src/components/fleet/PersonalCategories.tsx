/**
 * Manage the ledgers (categories) of Personal & Household — make a new one, rename one (every entry
 * of it follows), change its Urdu name, remove one (an empty one, or after moving its entries).
 * A few are used by the rest of the system (the default Household, Pocket money, Funds in, Other): their
 * names stay, their Urdu names can change.
 *
 *   /api/personal-expenses/categories
 */
import React, { useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Plus, Check, Trash2, Lock, Loader2, X } from "lucide-react";

export interface CategoryDetail { id: number; name: string; nameUr: string | null; count: number; protected: boolean }

export default function PersonalCategories({
  details,
  onChanged,
  onRenamed,
  onClose,
  showFeedback,
}: {
  details: CategoryDetail[];
  onChanged: () => void;
  onRenamed: (from: string, to: string) => void;
  onClose: () => void;
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [draft, setDraft] = useState<Record<number, { name: string; nameUr: string }>>({});
  const [newName, setNewName] = useState("");
  const [newUr, setNewUr] = useState("");
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [removing, setRemoving] = useState<{ id: number; moveTo: string } | null>(null);

  // start each row from what is saved (and again whenever the list is reloaded)
  useEffect(() => {
    setDraft(Object.fromEntries(details.map((c) => [c.id, { name: c.name, nameUr: c.nameUr || "" }])));
  }, [details]);

  const inp = "border border-slate-300 rounded px-2 py-1 text-xs bg-white w-full";

  const add = async () => {
    if (!newName.trim()) return showFeedback("error", "Write the name of the new ledger · نئے کھاتے کا نام لکھیں");
    setBusy("new");
    try {
      await enterpriseFetch("/api/personal-expenses/categories", { method: "POST", body: JSON.stringify({ name: newName, nameUr: newUr }) });
      showFeedback("success", `Ledger "${newName.trim()}" is made — pick it when you add an expense · نیا کھاتہ بن گیا`);
      setNewName("");
      setNewUr("");
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const save = async (c: CategoryDetail) => {
    const d = draft[c.id];
    if (!d) return;
    const renamed = d.name.trim() !== c.name;
    if (renamed && c.count > 0 && !window.confirm(`Rename "${c.name}" to "${d.name.trim()}"?\n\nIts ${c.count} entr${c.count === 1 ? "y" : "ies"} change with it, in every report.\n\nنام بدلیں؟ اس کے ${c.count} اندراج بھی نئے نام سے ہو جائیں گے۔`)) return;
    setBusy(c.id);
    try {
      const r = await enterpriseFetch(`/api/personal-expenses/categories/${c.id}`, { method: "PUT", body: JSON.stringify({ name: d.name, nameUr: d.nameUr }) });
      showFeedback("success", renamed ? `Renamed — ${r.entriesRenamed} entr${r.entriesRenamed === 1 ? "y" : "ies"} follow it · نام بدل گیا` : "Saved · محفوظ");
      if (renamed) onRenamed(c.name, r.name);
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (c: CategoryDetail, moveTo?: string) => {
    if (!moveTo && c.count === 0 && !window.confirm(`Remove the empty ledger "${c.name}"? · خالی کھاتہ ہٹائیں؟`)) return;
    setBusy(c.id);
    try {
      const r = await enterpriseFetch(`/api/personal-expenses/categories/${c.id}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ""}`, { method: "DELETE" });
      showFeedback("success", moveTo ? `Removed — ${r.moved} entr${r.moved === 1 ? "y" : "ies"} moved to "${moveTo}" · ہٹا دیا` : "Removed · ہٹا دیا");
      setRemoving(null);
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-[#C9D7EC] bg-[#F2F5FA] p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-sm font-bold">Manage ledgers · کھاتے سنبھالیں</div>
        <span className="text-[11px] text-slate-500">make your own, rename, change the Urdu name, remove · اپنا کھاتہ بنائیں، نام بدلیں، ہٹائیں</span>
        <div className="flex-1" />
        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-800 p-1"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end bg-white border border-slate-200 rounded-lg p-2">
        <label className="flex flex-col text-[10px] text-slate-500">New ledger · نیا کھاتہ
          <input id="pc-new-name" dir="auto" className={inp} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="e.g. School fees · اسکول فیس" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Urdu name (optional) · اردو نام
          <input id="pc-new-ur" dir="auto" className={inp} value={newUr} onChange={(e) => setNewUr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        </label>
        <button onClick={add} disabled={busy === "new"} className="inline-flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 bg-[#24539B] text-white font-semibold disabled:opacity-60">
          {busy === "new" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Make ledger
        </button>
      </div>

      <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-2 py-1.5">Name · نام</th>
              <th className="text-left px-2 py-1.5">Urdu name · اردو نام</th>
              <th className="text-right px-2 py-1.5">Entries</th>
              <th className="px-2 py-1.5 w-40"></th>
            </tr>
          </thead>
          <tbody>
            {details.map((c) => {
              const d = draft[c.id] || { name: c.name, nameUr: c.nameUr || "" };
              const changed = d.name.trim() !== c.name || d.nameUr.trim() !== (c.nameUr || "");
              return (
                <React.Fragment key={c.id}>
                  <tr className="border-t border-slate-100">
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        {c.protected && <span title="Used by the rest of the system — the name cannot change"><Lock className="w-3 h-3 text-slate-400" /></span>}
                        <input dir="auto" className={`${inp} ${c.protected ? "bg-slate-50 text-slate-500" : ""}`} value={d.name} disabled={c.protected} onChange={(e) => setDraft({ ...draft, [c.id]: { ...d, name: e.target.value } })} />
                      </div>
                    </td>
                    <td className="px-2 py-1"><input dir="auto" className={inp} value={d.nameUr} onChange={(e) => setDraft({ ...draft, [c.id]: { ...d, nameUr: e.target.value } })} /></td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-600">{c.count}</td>
                    <td className="px-2 py-1 whitespace-nowrap text-right">
                      {changed && (
                        <button onClick={() => save(c)} disabled={busy === c.id} className="inline-flex items-center gap-1 text-[11px] font-semibold rounded px-2 py-0.5 bg-emerald-600 text-white mr-2 disabled:opacity-60">
                          {busy === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                        </button>
                      )}
                      {!c.protected && (
                        <button
                          onClick={() => (c.count === 0 ? remove(c) : setRemoving(removing?.id === c.id ? null : { id: c.id, moveTo: details.find((x) => x.id !== c.id && x.name === "Other")?.name || details.find((x) => x.id !== c.id)!.name }))}
                          disabled={busy === c.id}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-600"
                          title="Remove this ledger"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                  {removing?.id === c.id && (
                    <tr className="bg-amber-50">
                      <td colSpan={4} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span>"{c.name}" holds <b>{c.count}</b> entr{c.count === 1 ? "y" : "ies"}. Move {c.count === 1 ? "it" : "them"} to · انہیں منتقل کریں:</span>
                          <select id={`pc-moveto-${c.id}`} className="border border-slate-300 rounded px-2 py-1" value={removing.moveTo} onChange={(e) => setRemoving({ id: c.id, moveTo: e.target.value })}>
                            {details.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}
                          </select>
                          <button onClick={() => remove(c, removing.moveTo)} disabled={busy === c.id} className="rounded px-3 py-1 bg-red-600 text-white font-semibold disabled:opacity-60">Move &amp; remove the ledger</button>
                          <button onClick={() => setRemoving(null)} className="text-slate-500">Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
