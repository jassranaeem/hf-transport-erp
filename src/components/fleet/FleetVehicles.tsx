import React, { useState, useEffect } from "react";
import { Truck, Plus, Trash2, Edit2, Search, Download, Upload, Filter, Calendar, ShieldAlert } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Paperclip } from "lucide-react";
import AttachmentPanel from "../common/AttachmentPanel.tsx";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

interface Vehicle {
  id: number;
  vehicleNumber: string;
  registrationNumber: string;
  engineNumber: string;
  chassisNumber: string;
  vehicleType: string;
  truckBrand: string;
  model: string;
  year: number;
  containerType: string;
  payloadCapacity: number;
  fuelType: string;
  currentOdometer: number;
  gpsDeviceImei: string | null;
  insuranceNumber: string | null;
  insuranceExpiry: string | null;
  fitnessCertificate: string | null;
  fitnessExpiry: string | null;
  ownershipStatus: string;
  purchaseDate: string | null;
  purchaseCost: number | null;
  currentAssetValue: number | null;
  depreciationPercent: number | null;
  currentStatus: string;
  photoUrl: string | null;
}

interface FleetVehiclesProps {
  showFeedback: (type: "success" | "error", message: string) => void;
}

export default function FleetVehicles({ showFeedback }: FleetVehiclesProps) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  
  // Pagination
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 10;

  // Drawer / Form State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [attachVehicleId, setAttachVehicleId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    vehicleNumber: "",
    registrationNumber: "",
    engineNumber: "",
    chassisNumber: "",
    vehicleType: "Flatbed",
    truckBrand: "Hino",
    model: "",
    year: new Date().getFullYear(),
    containerType: "40ft Container",
    payloadCapacity: 25000,
    fuelType: "Diesel",
    currentOdometer: 120000,
    gpsDeviceImei: "",
    insuranceNumber: "",
    insuranceExpiry: "",
    fitnessCertificate: "",
    fitnessExpiry: "",
    ownershipStatus: "Owned",
    purchaseDate: "",
    purchaseCost: 8500000,
    currentAssetValue: 7200000,
    depreciationPercent: 15,
    currentStatus: "Available",
    photoUrl: "",
  });

  // Bulk Import
  const [importJson, setImportJson] = useState("");
  const [isImportOpen, setIsImportOpen] = useState(false);

  const fetchVehicles = async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      const queryParams = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
        search,
        status: statusFilter,
        type: typeFilter,
        sortBy,
        sortOrder,
      });

      const result = await enterpriseFetch(`/api/operations/vehicles?${queryParams}`);
      setVehicles(result.data);
      setTotal(result.pagination.total);
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to load vehicles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVehicles();
  }, [page, search, statusFilter, typeFilter, sortBy, sortOrder]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    console.log("Submitting vehicle form, current state:", formData);
    try {
      const url = editingVehicle ? `/api/operations/vehicles/${editingVehicle.id}` : "/api/operations/vehicles";
      const method = editingVehicle ? "PUT" : "POST";
      console.log(`Sending ${method} request to ${url}...`);

      const parseDateSafe = (val: any) => {
        if (!val) return null;
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d.toISOString();
      };

      const cleanedForm = {
        ...formData,
        year: Number(formData.year),
        payloadCapacity: Number(formData.payloadCapacity),
        currentOdometer: Number(formData.currentOdometer),
        purchaseCost: formData.purchaseCost ? Number(formData.purchaseCost) : null,
        currentAssetValue: formData.currentAssetValue ? Number(formData.currentAssetValue) : null,
        depreciationPercent: formData.depreciationPercent ? Number(formData.depreciationPercent) : null,
        insuranceExpiry: parseDateSafe(formData.insuranceExpiry),
        fitnessExpiry: parseDateSafe(formData.fitnessExpiry),
        purchaseDate: parseDateSafe(formData.purchaseDate),
      };
      console.log("Prepared cleaned form payload for vehicles:", cleanedForm);

      const result = await enterpriseFetch(url, {
        method,
        body: JSON.stringify(cleanedForm),
      });
      console.log("Response received from vehicle save:", result);

      showFeedback("success", editingVehicle ? "Vehicle updated successfully" : "Vehicle registered successfully");
      setIsDrawerOpen(false);
      setEditingVehicle(null);
      fetchVehicles();
    } catch (err: any) {
      console.error("Save vehicle details error:", err);
      showFeedback("error", err.message || "Failed to save vehicle details");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setFormData({
      vehicleNumber: vehicle.vehicleNumber,
      registrationNumber: vehicle.registrationNumber,
      engineNumber: vehicle.engineNumber,
      chassisNumber: vehicle.chassisNumber,
      vehicleType: vehicle.vehicleType,
      truckBrand: vehicle.truckBrand,
      model: vehicle.model,
      year: vehicle.year,
      containerType: vehicle.containerType,
      payloadCapacity: vehicle.payloadCapacity,
      fuelType: vehicle.fuelType,
      currentOdometer: vehicle.currentOdometer,
      gpsDeviceImei: vehicle.gpsDeviceImei || "",
      insuranceNumber: vehicle.insuranceNumber || "",
      insuranceExpiry: vehicle.insuranceExpiry ? vehicle.insuranceExpiry.substring(0, 10) : "",
      fitnessCertificate: vehicle.fitnessCertificate || "",
      fitnessExpiry: vehicle.fitnessExpiry ? vehicle.fitnessExpiry.substring(0, 10) : "",
      ownershipStatus: vehicle.ownershipStatus,
      purchaseDate: vehicle.purchaseDate ? vehicle.purchaseDate.substring(0, 10) : "",
      purchaseCost: vehicle.purchaseCost || 0,
      currentAssetValue: vehicle.currentAssetValue || 0,
      depreciationPercent: vehicle.depreciationPercent || 0,
      currentStatus: vehicle.currentStatus,
      photoUrl: vehicle.photoUrl || "",
    });
    setIsDrawerOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to retire this vehicle from active operations?")) return;
    try {
      await enterpriseFetch(`/api/operations/vehicles/${id}`, { method: "DELETE" });
      showFeedback("success", "Vehicle soft-deleted and logged successfully");
      fetchVehicles();
    } catch (err: any) {
      showFeedback("error", err.message || "Deletion failed");
    }
  };

  const handleExport = async () => {
    try {
      const data = await enterpriseFetch("/api/operations/vehicles/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `HF_Fleet_Vehicles_Export_${Date.now()}.json`;
      link.click();
      showFeedback("success", "Database vehicles exported successfully");
    } catch (err: any) {
      showFeedback("error", err.message || "Export failed");
    }
  };

  const handleImport = async () => {
    try {
      const parsed = JSON.parse(importJson);
      const data = await enterpriseFetch("/api/operations/vehicles/import", {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      showFeedback("success", data.message || "Bulk vehicles imported successfully");
      setIsImportOpen(false);
      setImportJson("");
      fetchVehicles();
    } catch (err: any) {
      showFeedback("error", err.message || "Bulk import failed");
    }
  };

  const openAddDrawer = () => {
    setEditingVehicle(null);
    setFormData({
      vehicleNumber: "",
      registrationNumber: "",
      engineNumber: "",
      chassisNumber: "",
      vehicleType: "Containerized",
      truckBrand: "Hino",
      model: "300 Series",
      year: new Date().getFullYear(),
      containerType: "40ft Container",
      payloadCapacity: 32000,
      fuelType: "Diesel",
      currentOdometer: 145000,
      gpsDeviceImei: `IMEI-${Math.floor(Math.random() * 900000) + 100000}`,
      insuranceNumber: `INS-${Math.floor(Math.random() * 90000) + 10000}`,
      insuranceExpiry: "2027-06-30",
      fitnessCertificate: `FIT-${Math.floor(Math.random() * 90000) + 10000}`,
      fitnessExpiry: "2027-06-30",
      ownershipStatus: "Owned",
      purchaseDate: "2024-01-15",
      purchaseCost: 12000000,
      currentAssetValue: 9800000,
      depreciationPercent: 12,
      currentStatus: "Available",
      photoUrl: "https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&q=80&w=400",
    });
    setIsDrawerOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/40 p-4 border border-slate-900 rounded-xl">
        <div className="flex items-center gap-3">
          <Truck className="w-8 h-8 text-blue-500" />
          <div>
            <h2 className="text-xl font-bold text-white">Vehicle Fleet Inventory</h2>
            <p className="text-xs text-slate-400">Total verified transport fleet units: {total}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <ModuleDataIO entityKey="vehicles" label="Vehicles" onImported={fetchVehicles} />
          <button
            onClick={openAddDrawer}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition"
          >
            <Plus className="w-4 h-4" /> Add Vehicle
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition border border-slate-700"
          >
            <Download className="w-4 h-4" /> Export Data
          </button>
          <button
            onClick={() => setIsImportOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition border border-slate-700"
          >
            <Upload className="w-4 h-4" /> Bulk Import
          </button>
        </div>
      </div>

      {/* Filters bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-950/20 p-4 rounded-xl border border-slate-900">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by vehicle, registration, IMEI..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="">All Statuses</option>
            <option value="Available">Available</option>
            <option value="Active">Active / On Trip</option>
            <option value="Maintenance">Maintenance</option>
            <option value="Out of Service">Out of Service</option>
          </select>
        </div>

        <div>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="">All Types</option>
            <option value="Containerized">Containerized</option>
            <option value="Flatbed">Flatbed</option>
            <option value="Reefer">Reefer (Cold Chain)</option>
            <option value="Lowboy">Lowboy Trailer</option>
          </select>
        </div>

        <div>
          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [by, order] = e.target.value.split("-");
              setSortBy(by);
              setSortOrder(order as any);
              setPage(1);
            }}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="createdAt-desc">Newest Registered</option>
            <option value="vehicleNumber-asc">Vehicle Number (A-Z)</option>
            <option value="currentOdometer-asc">Odometer (Low to High)</option>
            <option value="currentOdometer-desc">Odometer (High to Low)</option>
            <option value="year-desc">Model Year (New to Old)</option>
          </select>
        </div>
      </div>

      {/* Bulk Import Dialog */}
      {isImportOpen && (
        <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-white">Bulk Database Vehicles Import (JSON Schema)</h3>
            <button onClick={() => setIsImportOpen(false)} className="text-slate-500 hover:text-white text-xs">Close</button>
          </div>
          <p className="text-[11px] text-slate-400">
            Provide a valid JSON array of vehicle objects. Ensure fields match exactly: `vehicleNumber`, `registrationNumber`, `engineNumber`, `chassisNumber`, `vehicleType`, `truckBrand`, `model`, `year`, `containerType`, `payloadCapacity`, `currentOdometer`.
          </p>
          <textarea
            placeholder='[{"vehicleNumber": "LES-9912", "registrationNumber": "REG-882", "engineNumber": "E77", "chassisNumber": "C321", "vehicleType": "Flatbed", "truckBrand": "Volvo", "model": "FH16", "year": 2022, "containerType": "None", "payloadCapacity": 40000, "currentOdometer": 84500}]'
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 h-32 text-xs text-slate-300 font-mono focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleImport}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition"
          >
            Execute Bulk Injection
          </button>
        </div>
      )}

      {/* Table Section */}
      <div className="bg-slate-950/20 border border-slate-900 rounded-xl overflow-x-auto">
        {loading ? (
          <div className="p-8 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 bg-slate-900/40 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : vehicles.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            No matching vehicle assets found. Add new assets or clear filters.
          </div>
        ) : (
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/40 border-b border-slate-900 text-slate-400">
              <tr>
                <th className="p-3 font-semibold">Vehicle Code</th>
                <th className="p-3 font-semibold">Make & Brand</th>
                <th className="p-3 font-semibold">Type / Payload</th>
                <th className="p-3 font-semibold">Current Odometer</th>
                <th className="p-3 font-semibold">GPS Track IMEI</th>
                <th className="p-3 font-semibold">Compliance Status</th>
                <th className="p-3 font-semibold">Asset Value (PKR)</th>
                <th className="p-3 font-semibold">Operational Status</th>
                <th className="p-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/50">
              {vehicles.map((v) => {
                const insDaysLeft = v.insuranceExpiry 
                  ? Math.ceil((new Date(v.insuranceExpiry).getTime() - Date.now()) / (1000 * 3600 * 24))
                  : null;
                const fitDaysLeft = v.fitnessExpiry 
                  ? Math.ceil((new Date(v.fitnessExpiry).getTime() - Date.now()) / (1000 * 3600 * 24))
                  : null;
                const isCompliant = (insDaysLeft === null || insDaysLeft > 0) && (fitDaysLeft === null || fitDaysLeft > 0);

                return (
                  <React.Fragment key={v.id}>
                  <tr className="hover:bg-slate-900/30 transition-colors">
                    <td className="p-3">
                      <div className="font-bold text-white font-mono">{v.vehicleNumber}</div>
                      <div className="text-[10px] text-slate-500">Reg: {v.registrationNumber}</div>
                    </td>
                    <td className="p-3">
                      <div>{v.truckBrand} {v.model}</div>
                      <div className="text-[10px] text-slate-500">Year: {v.year}</div>
                    </td>
                    <td className="p-3">
                      <div>{v.vehicleType}</div>
                      <div className="text-[10px] text-slate-500">Capacity: {(v.payloadCapacity / 1000).toFixed(1)} Tons</div>
                    </td>
                    <td className="p-3 font-mono">{v.currentOdometer.toLocaleString()} km</td>
                    <td className="p-3 font-mono text-slate-400">{v.gpsDeviceImei || "Unlinked"}</td>
                    <td className="p-3">
                      {isCompliant ? (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-medium">
                          Active & Valid
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 font-medium flex items-center gap-1 w-fit">
                          <ShieldAlert className="w-3 h-3" /> Expired Certs
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono">
                      {v.currentAssetValue ? `${(v.currentAssetValue / 100000).toFixed(1)}L` : "Unvalued"}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        v.currentStatus === "Available" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                        v.currentStatus === "Active" ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
                        "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      }`}>
                        {v.currentStatus}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => setAttachVehicleId(attachVehicleId === v.id ? null : v.id)}
                          className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded transition"
                          title="Documents / proof"
                        >
                          <Paperclip className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleEdit(v)}
                          className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                          title="Edit vehicle details"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(v.id)}
                          className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition"
                          title="Soft delete vehicle"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {attachVehicleId === v.id && (
                    <tr>
                      <td colSpan={12} className="p-3 bg-white">
                        <AttachmentPanel entityType="vehicle" entityId={v.id} title={`Documents for ${v.vehicleNumber}`} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination controls */}
      <div className="flex justify-between items-center bg-slate-950/20 border border-slate-900 p-3 rounded-xl text-xs text-slate-400">
        <div>Showing {vehicles.length} out of {total} registered vehicle assets</div>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            disabled={page === 1}
            className="px-3 py-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-white rounded-lg disabled:opacity-50 transition"
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page * limit >= total}
            className="px-3 py-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-white rounded-lg disabled:opacity-50 transition"
          >
            Next
          </button>
        </div>
      </div>

      {/* Sliding Drawer Form for Add / Edit */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/80 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-2xl bg-slate-950 border-l border-slate-900 p-6 overflow-y-auto space-y-6 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-900 pb-4">
              <div className="flex items-center gap-2">
                <Truck className="w-6 h-6 text-blue-500" />
                <h3 className="text-lg font-bold text-white">
                  {editingVehicle ? `Edit Asset: ${formData.vehicleNumber}` : "Register New Fleet Vehicle"}
                </h3>
              </div>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="text-slate-500 hover:text-white font-mono text-sm px-2 py-1 bg-slate-900 border border-slate-800 rounded-lg"
              >
                ESC
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              {/* Row 1 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Vehicle Number / plate *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. LES-1234"
                    value={formData.vehicleNumber}
                    onChange={(e) => setFormData({ ...formData, vehicleNumber: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Registration Number *</label>
                  <input
                    type="text"
                    required
                    value={formData.registrationNumber}
                    onChange={(e) => setFormData({ ...formData, registrationNumber: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Row 2 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Engine Number *</label>
                  <input
                    type="text"
                    required
                    value={formData.engineNumber}
                    onChange={(e) => setFormData({ ...formData, engineNumber: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Chassis Number *</label>
                  <input
                    type="text"
                    required
                    value={formData.chassisNumber}
                    onChange={(e) => setFormData({ ...formData, chassisNumber: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              {/* Row 3 */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Vehicle Brand *</label>
                  <select
                    value={formData.truckBrand}
                    onChange={(e) => setFormData({ ...formData, truckBrand: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="Hino">Hino</option>
                    <option value="Volvo">Volvo</option>
                    <option value="Isuzu">Isuzu</option>
                    <option value="Faw">FAW</option>
                    <option value="Master">Master</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Model *</label>
                  <input
                    type="text"
                    required
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Model Year *</label>
                  <input
                    type="number"
                    required
                    value={formData.year}
                    onChange={(e) => setFormData({ ...formData, year: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              {/* Row 4 */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Type *</label>
                  <select
                    value={formData.vehicleType}
                    onChange={(e) => setFormData({ ...formData, vehicleType: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="Containerized">Containerized</option>
                    <option value="Flatbed">Flatbed</option>
                    <option value="Reefer">Reefer</option>
                    <option value="Lowboy">Lowboy</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Container Capacity</label>
                  <input
                    type="text"
                    value={formData.containerType}
                    onChange={(e) => setFormData({ ...formData, containerType: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Payload Limit (kg) *</label>
                  <input
                    type="number"
                    required
                    value={formData.payloadCapacity}
                    onChange={(e) => setFormData({ ...formData, payloadCapacity: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  />
                </div>
              </div>

              {/* Row 5 */}
              <div className="grid grid-cols-2 gap-4 border-t border-slate-900 pt-4">
                <div>
                  <label className="block text-slate-400 mb-1">Odometer (km) *</label>
                  <input
                    type="number"
                    required
                    value={formData.currentOdometer}
                    onChange={(e) => setFormData({ ...formData, currentOdometer: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">GPS Tracker IMEI</label>
                  <input
                    type="text"
                    value={formData.gpsDeviceImei}
                    onChange={(e) => setFormData({ ...formData, gpsDeviceImei: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Compliance documents row */}
              <div className="grid grid-cols-2 gap-4 border-t border-slate-900 pt-4">
                <div>
                  <h4 className="font-bold text-white mb-2">Insurance Details</h4>
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Policy number"
                      value={formData.insuranceNumber}
                      onChange={(e) => setFormData({ ...formData, insuranceNumber: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                    />
                    <input
                      type="date"
                      value={formData.insuranceExpiry}
                      onChange={(e) => setFormData({ ...formData, insuranceExpiry: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none font-mono"
                    />
                  </div>
                </div>
                <div>
                  <h4 className="font-bold text-white mb-2">Fitness Certification</h4>
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Certificate number"
                      value={formData.fitnessCertificate}
                      onChange={(e) => setFormData({ ...formData, fitnessCertificate: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                    />
                    <input
                      type="date"
                      value={formData.fitnessExpiry}
                      onChange={(e) => setFormData({ ...formData, fitnessExpiry: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Financial Ownership Details */}
              <div className="grid grid-cols-4 gap-4 border-t border-slate-900 pt-4">
                <div>
                  <label className="block text-slate-400 mb-1">Ownership</label>
                  <select
                    value={formData.ownershipStatus}
                    onChange={(e) => setFormData({ ...formData, ownershipStatus: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  >
                    <option value="Owned">Owned</option>
                    <option value="Leased">Leased</option>
                    <option value="Third-Party">Third-Party</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Purchase Cost</label>
                  <input
                    type="number"
                    value={formData.purchaseCost}
                    onChange={(e) => setFormData({ ...formData, purchaseCost: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Asset Value</label>
                  <input
                    type="number"
                    value={formData.currentAssetValue}
                    onChange={(e) => setFormData({ ...formData, currentAssetValue: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Depreciation %</label>
                  <input
                    type="number"
                    value={formData.depreciationPercent}
                    onChange={(e) => setFormData({ ...formData, depreciationPercent: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  />
                </div>
              </div>

              {/* Status and photo */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Current Status</label>
                  <select
                    value={formData.currentStatus}
                    onChange={(e) => setFormData({ ...formData, currentStatus: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  >
                    <option value="Available">Available</option>
                    <option value="Active">Active</option>
                    <option value="Maintenance">Maintenance</option>
                    <option value="Out of Service">Out of Service</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Vehicle Image URL</label>
                  <input
                    type="text"
                    value={formData.photoUrl}
                    onChange={(e) => setFormData({ ...formData, photoUrl: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t border-slate-900">
                <button
                  type="button"
                  onClick={() => setIsDrawerOpen(false)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:text-slate-400 text-white rounded-lg font-semibold flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Saving...
                    </>
                  ) : (
                    "Save Asset Profile"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
