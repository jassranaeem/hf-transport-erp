/**
 * Fleet Asset Value — "hamare paas itne sarmaye ke trucks hain".
 *
 * One truck number = one row = its market value. Add a row when a truck is
 * bought, remove it (soft-delete, recoverable) when it's sold or written off.
 * Reads/writes the same `vehicles` table as the Fleet → Vehicles sheet via the
 * generic /api/entities API — this is just a focused, total-first view of it.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { entityList, entityCreate, entityUpdate, entityDelete } from "../../../client/api.ts";
import { Truck, Plus, Trash2, Loader2, RefreshCw, Pencil, Check, X, Wallet, ClipboardList } from "lucide-react";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

const PKR = (n: number) => "PKR " + Math.round(n || 0).toLocaleString("en-PK");

interface VehicleRow {
  id: number;
  vehicleNumber: string;
  truckBrand: string | null;
  model: string | null;
  year: number | null;
  ownershipStatus: string;
  currentStatus: string;
  purchaseCost: number | null;
  currentAssetValue: number | null;
}

const BLANK_ADD = { vehicleNumber: "", ownershipStatus: "Owned", purchaseCost: "", currentAssetValue: "" };
const TYPES = ["Yekhchal", "Tarfal"];
const plateKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** One pasted line: "TLM-916   7,000,000   Yekhchal" (tabs, commas or spaces between). */
type ListLine = { line: number; plate: string; value: number | null; type: string; error?: string };
function parseList(text: string): ListLine[] {
  const out: ListLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trim();
    if (!l || /^(serial|s\.?\s*no|truck number)/i.test(l)) return;
    const m = l.match(/(\d{1,3}(?:,\d{3})+|\d{5,})/); // the price: 7,000,000 or 7000000
    if (!m || m.index === undefined) return out.push({ line: i + 1, plate: l, value: null, type: "", error: "no price on this line" });
    // "5  TLG-704" → drop the serial number; "TLH-539 [1]" is the first truck of that number, "[2]" a second one
    const plate = l.slice(0, m.index).replace(/[\s,|]+$/, "").replace(/^\d{1,3}[.)\s]+(?=[A-Za-z])/, "").replace(/\s*\[1\]$/, "").trim();
    const type = l.slice(m.index + m[0].length).replace(/^[\s,|]+/, "").trim();
    out.push({ line: i + 1, plate, value: Number(m[0].replace(/,/g, "")), type, error: !plate ? "no truck number" : !/\d/.test(plate) ? "not a number plate (a name, e.g. Container) — add it by hand with “Add a truck”" : undefined });
  });
  return out;
}

export default function FleetAssetValue({
  showFeedback,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canWrite, setCanWrite] = useState(true);
  const [canDelete, setCanDelete] = useState(true);

  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ ...BLANK_ADD });
  const [saving, setSaving] = useState(false);

  const [listOpen, setListOpen] = useState(false);
  const [listText, setListText] = useState("");
  const [applying, setApplying] = useState(false);
  const [typeEditId, setTypeEditId] = useState<number | null>(null);
  const [typeValue, setTypeValue] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [costEditId, setCostEditId] = useState<number | null>(null);
  const [costValue, setCostValue] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    entityList("vehicles", { limit: 1000, sort: "vehicleNumber", dir: "asc" })
      .then((r) => {
        setRows(r.rows as VehicleRow[]);
        setCanWrite(r.canWrite);
        setCanDelete(r.canDelete);
      })
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(load, [load]);

  const worth = (r: VehicleRow) => r.currentAssetValue ?? r.purchaseCost ?? 0;
  const hasValue = (r: VehicleRow) => r.currentAssetValue != null || r.purchaseCost != null;

  const groups = useMemo(() => {
    const by = (status: string) => rows.filter((r) => r.ownershipStatus === status);
    const owned = by("Owned");
    const leased = by("Leased");
    const thirdParty = by("Third-Party");
    const sum = (list: VehicleRow[]) => list.reduce((s, r) => s + worth(r), 0);
    return {
      owned: { list: owned, total: sum(owned), unvalued: owned.filter((r) => !hasValue(r)).length },
      leased: { list: leased, total: sum(leased) },
      thirdParty: { list: thirdParty, total: sum(thirdParty) },
    };
  }, [rows]);

  const startEdit = (r: VehicleRow) => {
    setEditingId(r.id);
    setEditValue(r.currentAssetValue != null ? String(r.currentAssetValue) : "");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };
  const saveEdit = async (r: VehicleRow) => {
    const n = editValue.trim() === "" ? null : Number(editValue);
    if (editValue.trim() !== "" && (Number.isNaN(n as number) || (n as number) < 0)) {
      showFeedback("error", "Market value must be a positive number");
      return;
    }
    setBusyId(r.id);
    try {
      await entityUpdate("vehicles", r.id, { currentAssetValue: n });
      setRows((prev) => prev.map((row) => (row.id === r.id ? { ...row, currentAssetValue: n } : row)));
      setEditingId(null);
      showFeedback("success", `${r.vehicleNumber} value updated`);
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusyId(null);
    }
  };

  // ---- the pasted list, matched to the fleet by number plate (spaces / dashes ignored)
  const preview = useMemo(() => {
    const byPlate = new Map<string, VehicleRow[]>();
    for (const r of rows) byPlate.set(plateKey(r.vehicleNumber), [...(byPlate.get(plateKey(r.vehicleNumber)) || []), r]);
    const seen = new Set<string>();
    return parseList(listText).map((l) => {
      const key = plateKey(l.plate);
      const matches = [...(byPlate.get(key) || [])].sort((a, b) => a.id - b.id);
      const truck = matches[0] || null;
      const notes: string[] = [];
      const dup = seen.has(key);
      if (dup) notes.push("this truck is twice in the list — only the first line is used");
      if (matches.length > 1) notes.push(`${matches.length} rows on file for this number — the first (#${truck!.id}) is updated`);
      if (truck && truck.ownershipStatus !== "Owned") notes.push(`marked ${truck.ownershipStatus} — not counted in the owned total`);
      seen.add(key);
      const type = TYPES.find((t) => t.toLowerCase() === l.type.toLowerCase()) || l.type;
      const changes = truck ? (!!type && truck.truckBrand !== type) || truck.currentAssetValue !== l.value : true;
      return { ...l, type, truck, dup, notes, changes };
    });
  }, [listText, rows]);
  const toApply = preview.filter((p) => !p.error && !p.dup && p.changes);

  const applyList = async () => {
    const adds = toApply.filter((p) => !p.truck).length;
    if (!window.confirm(`Update ${toApply.length - adds} truck(s)${adds ? ` and add ${adds} new truck(s)` : ""}?\n\nType goes into Brand / Model / Year, the price into Market Value. · لاگو کریں؟`)) return;
    setApplying(true);
    let done = 0;
    const failed: string[] = [];
    for (const p of toApply) {
      try {
        if (p.truck) await entityUpdate("vehicles", p.truck.id, { truckBrand: p.type || p.truck.truckBrand, currentAssetValue: p.value });
        else
          await entityCreate("vehicles", {
            vehicleNumber: p.plate,
            registrationNumber: p.plate,
            engineNumber: "TBD",
            chassisNumber: "TBD",
            vehicleType: "Containerized",
            truckBrand: p.type || "TBD",
            model: "TBD",
            year: new Date().getFullYear(),
            containerType: "40ft",
            payloadCapacity: 25000,
            currentOdometer: 0,
            ownershipStatus: "Owned",
            currentAssetValue: p.value,
          });
        done++;
      } catch (e: any) {
        failed.push(`${p.plate}: ${e.message}`);
      }
    }
    setApplying(false);
    showFeedback(failed.length ? "error" : "success", `${done} truck(s) updated · اپ ڈیٹ ہو گئے${failed.length ? ` — not done: ${failed.join("; ")}` : ""}`);
    if (!failed.length) {
      setListText("");
      setListOpen(false);
    }
    load();
  };

  const saveType = async (r: VehicleRow) => {
    setBusyId(r.id);
    try {
      const t = typeValue.trim() || "TBD";
      await entityUpdate("vehicles", r.id, { truckBrand: t });
      setRows((prev) => prev.map((row) => (row.id === r.id ? { ...row, truckBrand: t } : row)));
      setTypeEditId(null);
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusyId(null);
    }
  };

  const saveCost = async (r: VehicleRow) => {
    const n = costValue.trim() === "" ? null : Number(costValue.replace(/,/g, ""));
    if (costValue.trim() !== "" && (Number.isNaN(n as number) || (n as number) < 0)) {
      showFeedback("error", "Purchase cost must be a positive number");
      return;
    }
    setBusyId(r.id);
    try {
      await entityUpdate("vehicles", r.id, { purchaseCost: n });
      setRows((prev) => prev.map((row) => (row.id === r.id ? { ...row, purchaseCost: n } : row)));
      setCostEditId(null);
      showFeedback("success", `${r.vehicleNumber} purchase cost updated · خرید کی قیمت اپ ڈیٹ`);
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusyId(null);
    }
  };

  const removeTruck = async (r: VehicleRow) => {
    if (!window.confirm(`Remove ${r.vehicleNumber} from the fleet — sold / written off?\n\n(This can be restored later if it was a mistake.)`)) return;
    setBusyId(r.id);
    try {
      await entityDelete("vehicles", r.id);
      setRows((prev) => prev.filter((row) => row.id !== r.id));
      showFeedback("success", `${r.vehicleNumber} removed from the fleet`);
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusyId(null);
    }
  };

  const addTruck = async () => {
    const vehicleNumber = addForm.vehicleNumber.trim();
    if (!vehicleNumber) {
      showFeedback("error", "Truck / registration number is required");
      return;
    }
    setSaving(true);
    try {
      const r = await entityCreate("vehicles", {
        vehicleNumber,
        registrationNumber: vehicleNumber,
        // Full spec (brand, engine no., chassis no. ...) can be filled in later
        // from the Vehicles sheet — same "TBD" convention already used for the
        // real trucks on file, so this stays a quick, one-field add.
        engineNumber: "TBD",
        chassisNumber: "TBD",
        vehicleType: "Containerized",
        truckBrand: "TBD",
        model: "TBD",
        year: new Date().getFullYear(),
        containerType: "40ft",
        payloadCapacity: 25000,
        currentOdometer: 0,
        ownershipStatus: addForm.ownershipStatus,
        purchaseCost: addForm.purchaseCost ? Number(addForm.purchaseCost) : null,
        currentAssetValue: addForm.currentAssetValue ? Number(addForm.currentAssetValue) : null,
      });
      setRows((prev) => [...prev, r.row as VehicleRow].sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber)));
      setAddForm({ ...BLANK_ADD });
      setAdding(false);
      showFeedback("success", `${vehicleNumber} added to the fleet`);
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#4B5563] p-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading fleet…
      </div>
    );
  }

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <Truck className="w-4 h-4" /> Fleet Asset Value <span className="text-[#9CA3AF] font-normal text-sm">· ٹرکوں کی مالیت</span>
          </h2>
          <p className="text-[12px] text-[#6B7280]" dir="auto">
            The market value of every truck — add a new purchase, remove a truck when sold or written off. · ہر ٹرک کی مارکیٹ ویلیو — نیا خریدیں تو شامل کریں، بیچ دیں یا خراب ہو جائے تو ہٹا دیں۔
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModuleDataIO entityKey="vehicles" label="Vehicles" onImported={load} />
          <button onClick={load} className="flex items-center gap-1.5 text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white hover:bg-[#F2F5FA]">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* headline total */}
      <div className="rounded-xl border border-[#C9D7EC] bg-[#F2F5FA] p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#1E4480]">
          <Wallet className="w-3.5 h-3.5" /> Total Fleet Worth (Owned trucks)
        </div>
        <div className="text-2xl font-extrabold mt-1 tabular-nums text-[#1E4480]">{PKR(groups.owned.total)}</div>
        <div className="text-[12px] text-[#173563] mt-0.5">across {groups.owned.list.length} owned truck{groups.owned.list.length === 1 ? "" : "s"}</div>
        {groups.owned.unvalued > 0 && (
          <div className="text-[11px] text-[#4B5563] mt-1.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded px-2 py-1 inline-block">
            {groups.owned.unvalued} owned truck{groups.owned.unvalued === 1 ? "" : "s"} still {groups.owned.unvalued === 1 ? "has" : "have"} no value entered — click "Set value" below.
          </div>
        )}
      </div>

      {/* leased / third-party — informational only, not owned capital */}
      {(groups.leased.list.length > 0 || groups.thirdParty.list.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {groups.leased.list.length > 0 && (
            <div className="rounded-lg border border-[#E5E7EB] bg-white p-3">
              <div className="text-[10px] font-bold uppercase text-[#6B7280]">Leased (not owned capital)</div>
              <div className="text-sm font-bold tabular-nums">{groups.leased.list.length} trucks · {PKR(groups.leased.total)}</div>
            </div>
          )}
          {groups.thirdParty.list.length > 0 && (
            <div className="rounded-lg border border-[#E5E7EB] bg-white p-3">
              <div className="text-[10px] font-bold uppercase text-[#6B7280]">Third-party (not owned capital)</div>
              <div className="text-sm font-bold tabular-nums">{groups.thirdParty.list.length} trucks · {PKR(groups.thirdParty.total)}</div>
            </div>
          )}
        </div>
      )}

      {/* add truck */}
      {canWrite && (
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-3">
          {!adding ? (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-[#1E4480] hover:underline"
            >
              <Plus className="w-4 h-4" /> Add a truck · نیا ٹرک شامل کریں
            </button>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <input
                  autoFocus
                  value={addForm.vehicleNumber}
                  onChange={(e) => setAddForm({ ...addForm, vehicleNumber: e.target.value })}
                  placeholder="Truck / registration number *"
                  className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm"
                  dir="ltr"
                />
                <select
                  value={addForm.ownershipStatus}
                  onChange={(e) => setAddForm({ ...addForm, ownershipStatus: e.target.value })}
                  className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm"
                >
                  <option>Owned</option>
                  <option>Leased</option>
                  <option>Third-Party</option>
                </select>
                <input
                  value={addForm.purchaseCost}
                  onChange={(e) => setAddForm({ ...addForm, purchaseCost: e.target.value })}
                  placeholder="Purchase cost (PKR)"
                  type="number"
                  className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm font-mono"
                  dir="ltr"
                />
                <input
                  value={addForm.currentAssetValue}
                  onChange={(e) => setAddForm({ ...addForm, currentAssetValue: e.target.value })}
                  placeholder="Market value now (PKR)"
                  type="number"
                  className="border border-[#E5E7EB] rounded px-2 py-1.5 text-sm font-mono"
                  dir="ltr"
                />
              </div>
              <p className="text-[11px] text-[#9CA3AF]">
                Full details (brand, engine no., chassis no. …) can be filled in later from Fleet → Vehicles.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={addTruck}
                  disabled={saving}
                  className="flex items-center gap-1.5 bg-[#24539B] text-white text-sm font-semibold rounded-lg px-3 py-1.5 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add truck
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setAddForm({ ...BLANK_ADD });
                  }}
                  className="text-sm text-[#6B7280] px-3 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* update many trucks from a pasted list */}
      {canWrite && (
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-3 space-y-2">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setListOpen((o) => !o)}
            onKeyDown={(e) => e.key === "Enter" && setListOpen((o) => !o)}
            className="flex items-center gap-1.5 text-sm font-semibold text-[#1E4480] hover:underline cursor-pointer select-none w-fit"
          >
            <ClipboardList className="w-4 h-4" /> Update from a list · فہرست سے اپ ڈیٹ کریں
          </div>
          {listOpen && (
            <>
              <p className="text-[11px] text-[#6B7280]" dir="auto">
                One truck per line: number, price, type — e.g. <span className="font-mono">TLM-916 7,000,000 Yekhchal</span>. Copying from Excel works too. Trucks are found by
                their number (spaces and dashes do not matter); a number not on file is added as a new truck. Nothing changes until you press Apply. · ہر لائن میں ٹرک نمبر، قیمت، ٹائپ
              </p>
              <textarea
                id="fav-list"
                value={listText}
                onChange={(e) => setListText(e.target.value)}
                rows={6}
                dir="ltr"
                placeholder={"TLM-916  7,000,000  Yekhchal\nTMC-792  12,000,000  Tarfal"}
                className="w-full border border-[#E5E7EB] rounded px-2 py-1.5 text-sm font-mono"
              />
              {preview.length > 0 && (
                <div className="overflow-x-auto border border-[#E5E7EB] rounded">
                  <table className="w-full text-[12px]">
                    <thead className="bg-[#F9FAFB] text-[#6B7280]">
                      <tr>
                        <th className="text-left px-2 py-1">Line</th>
                        <th className="text-left px-2 py-1">Truck (list)</th>
                        <th className="text-left px-2 py-1">Found</th>
                        <th className="text-left px-2 py-1">Type now → new</th>
                        <th className="text-right px-2 py-1">Value now → new</th>
                        <th className="text-left px-2 py-1">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((p) => (
                        <tr key={p.line} className={`border-t border-[#F3F4F6] ${p.error || p.dup ? "bg-[#FEF2F2]" : !p.truck ? "bg-[#FFFBEB]" : !p.changes ? "text-[#9CA3AF]" : ""}`}>
                          <td className="px-2 py-1">{p.line}</td>
                          <td className="px-2 py-1 font-semibold">{p.plate || "—"}</td>
                          <td className="px-2 py-1">
                            {p.error ? <span className="text-[#991B1B]">{p.error}</span> : p.truck ? `${p.truck.vehicleNumber} (#${p.truck.id})` : <span className="text-[#92400E]">not on file — will be added</span>}
                          </td>
                          <td className="px-2 py-1">
                            {p.truck ? `${p.truck.truckBrand && p.truck.truckBrand !== "TBD" ? p.truck.truckBrand : "—"} → ` : ""}
                            <b>{p.type || "—"}</b>
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {p.truck ? `${p.truck.currentAssetValue != null ? PKR(p.truck.currentAssetValue) : "—"} → ` : ""}
                            <b>{p.value != null ? PKR(p.value) : "—"}</b>
                          </td>
                          <td className="px-2 py-1 text-[#6B7280]">{!p.error && !p.dup && !p.changes ? "already the same" : p.notes.join("; ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={applyList}
                  disabled={applying || !toApply.length}
                  className="flex items-center gap-1.5 bg-[#24539B] text-white text-sm font-semibold rounded-lg px-3 py-1.5 disabled:opacity-60"
                >
                  {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Apply {toApply.length} · لاگو کریں
                </button>
                {preview.length > 0 && (
                  <span className="text-[11px] text-[#6B7280]">
                    The list: {preview.filter((p) => !p.error && !p.dup).length} trucks · {PKR(preview.filter((p) => !p.error && !p.dup).reduce((s, p) => s + (p.value || 0), 0))}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* table */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-[#F9FAFB] text-[#6B7280] text-[11px] uppercase">
              <tr>
                <th className="text-left px-3 py-2">Truck Number</th>
                <th className="text-left px-3 py-2">Brand / Model / Year</th>
                <th className="text-left px-3 py-2">Ownership</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Purchase Cost</th>
                <th className="text-right px-3 py-2">Market Value</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[#F3F4F6] hover:bg-[#F9FAFB]">
                  <td className="px-3 py-2 font-semibold" dir="ltr">{r.vehicleNumber}</td>
                  <td className="px-3 py-2 text-[#6B7280]">
                    {typeEditId === r.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          list="fav-types"
                          value={typeValue}
                          onChange={(e) => setTypeValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveType(r);
                            if (e.key === "Escape") setTypeEditId(null);
                          }}
                          className="w-28 border border-[#E5E7EB] rounded px-1.5 py-1 text-sm"
                          placeholder="Yekhchal / Tarfal"
                        />
                        <button onClick={() => saveType(r)} disabled={busyId === r.id} className="text-[#1E4480] p-1">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setTypeEditId(null)} className="text-[#9CA3AF] p-1">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (!canWrite) return;
                          setTypeEditId(r.id);
                          setTypeValue(r.truckBrand && r.truckBrand !== "TBD" ? r.truckBrand : "");
                        }}
                        disabled={!canWrite}
                        className={`text-left ${canWrite ? "hover:underline" : ""}`}
                        title={canWrite ? "Click to set the type (Yekhchal / Tarfal)" : ""}
                      >
                        {[r.truckBrand, r.model].filter((x) => x && x !== "TBD").join(" ") || (canWrite ? "Set type" : "—")}
                        {r.year ? ` · ${r.year}` : ""}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${
                      r.ownershipStatus === "Owned" ? "bg-[#E6ECF6] text-[#1E4480]" : "bg-[#F3F4F6] text-[#6B7280]"
                    }`}>{r.ownershipStatus}</span>
                  </td>
                  <td className="px-3 py-2 text-[#6B7280]">{r.currentStatus}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[#6B7280]">
                    {costEditId === r.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <input
                          autoFocus
                          type="number"
                          value={costValue}
                          onChange={(e) => setCostValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveCost(r);
                            if (e.key === "Escape") setCostEditId(null);
                          }}
                          className="w-28 border border-[#E5E7EB] rounded px-1.5 py-1 text-right text-sm font-mono"
                          dir="ltr"
                        />
                        <button onClick={() => saveCost(r)} disabled={busyId === r.id} className="text-[#1E4480] p-1">
                          {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => setCostEditId(null)} className="text-[#9CA3AF] p-1">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (!canWrite) return;
                          setCostEditId(r.id);
                          setCostValue(r.purchaseCost != null ? String(r.purchaseCost) : "");
                        }}
                        disabled={!canWrite}
                        className={`flex items-center gap-1 justify-end ml-auto ${canWrite ? "hover:underline" : ""}`}
                        title={canWrite ? "Click to set the purchase cost" : ""}
                      >
                        {r.purchaseCost != null ? PKR(r.purchaseCost) : canWrite ? "Set cost" : "—"}
                        {canWrite && <Pencil className="w-3 h-3 opacity-50" />}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {editingId === r.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <input
                          autoFocus
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit(r);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          className="w-28 border border-[#E5E7EB] rounded px-1.5 py-1 text-right text-sm font-mono"
                          dir="ltr"
                        />
                        <button onClick={() => saveEdit(r)} disabled={busyId === r.id} className="text-[#1E4480] p-1">
                          {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={cancelEdit} className="text-[#9CA3AF] p-1">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => canWrite && startEdit(r)}
                        disabled={!canWrite}
                        className={`font-semibold flex items-center gap-1 justify-end ml-auto ${r.currentAssetValue == null ? "text-[#4B5563]" : ""} ${canWrite ? "hover:underline" : ""}`}
                        title={canWrite ? "Click to set market value" : ""}
                      >
                        {r.currentAssetValue != null ? PKR(r.currentAssetValue) : "Set value"}
                        {canWrite && <Pencil className="w-3 h-3 opacity-50" />}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canDelete && (
                      <button
                        onClick={() => removeTruck(r)}
                        disabled={busyId === r.id}
                        title="Remove — sold / written off"
                        className="text-[#B00005] hover:bg-[#FFF1F1] rounded p-1.5 disabled:opacity-40"
                      >
                        {busyId === r.id && editingId !== r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-[#9CA3AF]">No trucks yet — add one above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <datalist id="fav-types">
        {TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <p className="text-[11px] text-[#9CA3AF]" dir="auto">
        {rows.length} truck{rows.length === 1 ? "" : "s"} on file. Removing a truck here soft-deletes it (recoverable) —
        it also disappears from Fleet → Vehicles, exactly like deleting it there would.
      </p>
    </div>
  );
}
