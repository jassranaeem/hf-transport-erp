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
import { Truck, Plus, Trash2, Loader2, RefreshCw, Pencil, Check, X, Wallet } from "lucide-react";
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

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
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
            Har truck ki market value — naya lein to add karein, bech dein ya kharab ho jaye to hata dein.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModuleDataIO entityKey="vehicles" label="Vehicles" onImported={load} />
          <button onClick={load} className="flex items-center gap-1.5 text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white hover:bg-[#F0FAF4]">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* headline total */}
      <div className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#15803D]">
          <Wallet className="w-3.5 h-3.5" /> Total Fleet Worth (Owned trucks)
        </div>
        <div className="text-2xl font-extrabold mt-1 tabular-nums text-[#15803D]">{PKR(groups.owned.total)}</div>
        <div className="text-[12px] text-[#166534] mt-0.5">across {groups.owned.list.length} owned truck{groups.owned.list.length === 1 ? "" : "s"}</div>
        {groups.owned.unvalued > 0 && (
          <div className="text-[11px] text-[#B45309] mt-1.5 bg-[#FFFBEB] border border-[#FDE68A] rounded px-2 py-1 inline-block">
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
              className="flex items-center gap-1.5 text-sm font-semibold text-[#15803D] hover:underline"
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
                  className="flex items-center gap-1.5 bg-[#16A34A] text-white text-sm font-semibold rounded-lg px-3 py-1.5 disabled:opacity-60"
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
                    {[r.truckBrand, r.model].filter((x) => x && x !== "TBD").join(" ") || "—"}
                    {r.year ? ` · ${r.year}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${
                      r.ownershipStatus === "Owned" ? "bg-[#DCFCE7] text-[#15803D]" : "bg-[#F3F4F6] text-[#6B7280]"
                    }`}>{r.ownershipStatus}</span>
                  </td>
                  <td className="px-3 py-2 text-[#6B7280]">{r.currentStatus}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[#6B7280]">{r.purchaseCost != null ? PKR(r.purchaseCost) : "—"}</td>
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
                        <button onClick={() => saveEdit(r)} disabled={busyId === r.id} className="text-[#15803D] p-1">
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
                        className={`font-semibold flex items-center gap-1 justify-end ml-auto ${r.currentAssetValue == null ? "text-[#B45309]" : ""} ${canWrite ? "hover:underline" : ""}`}
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
                        className="text-[#B91C1C] hover:bg-[#FEF2F2] rounded p-1.5 disabled:opacity-40"
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

      <p className="text-[11px] text-[#9CA3AF]" dir="auto">
        {rows.length} truck{rows.length === 1 ? "" : "s"} on file. Removing a truck here soft-deletes it (recoverable) —
        it also disappears from Fleet → Vehicles, exactly like deleting it there would.
      </p>
    </div>
  );
}
