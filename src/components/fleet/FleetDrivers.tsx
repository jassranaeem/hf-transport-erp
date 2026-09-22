import React, { useState, useEffect } from "react";
import { UserCheck, Plus, Trash2, Edit2, Search, Download, Upload, Filter, Calendar, Award, AlertTriangle } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import RecordAttachments from "../common/RecordAttachments.tsx";
import ModuleDataIO from "../common/ModuleDataIO.tsx";

interface Driver {
  id: number;
  driverName: string;
  photoUrl: string | null;
  cnic: string;
  licenseNumber: string;
  licenseExpiry: string;
  mobile: string;
  emergencyContact: string | null;
  address: string | null;
  bloodGroup: string | null;
  joiningDate: string;
  salary: number;
  allowance: number;
  experienceYears: number;
  status: string;
  assignedVehicleId: number | null;
  assignedRouteId: number | null;
  performanceRating: string | null;
  violationCount: number;
  medicalExpiry: string | null;
}

interface FleetDriversProps {
  showFeedback: (type: "success" | "error", message: string) => void;
}

export default function FleetDrivers({ showFeedback }: FleetDriversProps) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [bloodFilter, setBloodFilter] = useState("");
  
  // Pagination
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 10;

  // Drawer / Form State
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    driverName: "",
    photoUrl: "",
    cnic: "",
    licenseNumber: "",
    licenseExpiry: "",
    mobile: "",
    emergencyContact: "",
    address: "",
    bloodGroup: "O+",
    joiningDate: "",
    salary: 45000,
    allowance: 400,
    experienceYears: 5,
    status: "Available",
    assignedVehicleId: "",
    assignedRouteId: "",
    performanceRating: "5.0",
    violationCount: 0,
    medicalExpiry: "",
  });

  // Bulk Import
  const [importJson, setImportJson] = useState("");
  const [isImportOpen, setIsImportOpen] = useState(false);

  const fetchDrivers = async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      const queryParams = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
        search,
        status: statusFilter,
        bloodGroup: bloodFilter,
      });

      const result = await enterpriseFetch(`/api/operations/drivers?${queryParams}`);
      setDrivers(result.data);
      setTotal(result.pagination.total);
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to load drivers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrivers();
  }, [page, search, statusFilter, bloodFilter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    console.log("Submitting driver form, current state:", formData);
    try {
      const url = editingDriver ? `/api/operations/drivers/${editingDriver.id}` : "/api/operations/drivers";
      const method = editingDriver ? "PUT" : "POST";
      console.log(`Sending ${method} request to ${url}...`);

      const parseDateSafe = (val: any, fallback: string | null = null) => {
        if (!val) return fallback;
        const d = new Date(val);
        return isNaN(d.getTime()) ? fallback : d.toISOString();
      };

      const cleanedForm = {
        ...formData,
        salary: Number(formData.salary),
        allowance: Number(formData.allowance),
        experienceYears: Number(formData.experienceYears),
        violationCount: Number(formData.violationCount),
        assignedVehicleId: formData.assignedVehicleId ? Number(formData.assignedVehicleId) : null,
        assignedRouteId: formData.assignedRouteId ? Number(formData.assignedRouteId) : null,
        licenseExpiry: parseDateSafe(formData.licenseExpiry, new Date().toISOString())!,
        joiningDate: parseDateSafe(formData.joiningDate, new Date().toISOString())!,
        medicalExpiry: parseDateSafe(formData.medicalExpiry),
      };
      console.log("Prepared cleaned form payload for drivers:", cleanedForm);

      const result = await enterpriseFetch(url, {
        method,
        body: JSON.stringify(cleanedForm),
      });
      console.log("Response received from driver save:", result);

      showFeedback("success", editingDriver ? "Driver record updated" : "New driver profile registered");
      setIsDrawerOpen(false);
      setEditingDriver(null);
      fetchDrivers();
    } catch (err: any) {
      console.error("Save driver details error:", err);
      showFeedback("error", err.message || "Failed to save driver info");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (driver: Driver) => {
    setEditingDriver(driver);
    setFormData({
      driverName: driver.driverName,
      photoUrl: driver.photoUrl || "",
      cnic: driver.cnic,
      licenseNumber: driver.licenseNumber,
      licenseExpiry: driver.licenseExpiry ? driver.licenseExpiry.substring(0, 10) : "",
      mobile: driver.mobile,
      emergencyContact: driver.emergencyContact || "",
      address: driver.address || "",
      bloodGroup: driver.bloodGroup || "O+",
      joiningDate: driver.joiningDate ? driver.joiningDate.substring(0, 10) : "",
      salary: driver.salary,
      allowance: driver.allowance,
      experienceYears: driver.experienceYears,
      status: driver.status,
      assignedVehicleId: driver.assignedVehicleId?.toString() || "",
      assignedRouteId: driver.assignedRouteId?.toString() || "",
      performanceRating: driver.performanceRating || "5.0",
      violationCount: driver.violationCount,
      medicalExpiry: driver.medicalExpiry ? driver.medicalExpiry.substring(0, 10) : "",
    });
    setIsDrawerOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to retire this driver and deactivate their operational status?")) return;
    try {
      await enterpriseFetch(`/api/operations/drivers/${id}`, { method: "DELETE" });
      showFeedback("success", "Driver profile retired and logged successfully");
      fetchDrivers();
    } catch (err: any) {
      showFeedback("error", err.message || "Retirement failed");
    }
  };

  const handleExport = async () => {
    try {
      const data = await enterpriseFetch("/api/operations/drivers/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `HF_Fleet_Drivers_Export_${Date.now()}.json`;
      link.click();
      showFeedback("success", "Driver database exported");
    } catch (err: any) {
      showFeedback("error", err.message || "Export failed");
    }
  };

  const handleImport = async () => {
    try {
      const parsed = JSON.parse(importJson);
      const data = await enterpriseFetch("/api/operations/drivers/import", {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      showFeedback("success", data.message || "Bulk driver profiles imported successfully");
      setIsImportOpen(false);
      setImportJson("");
      fetchDrivers();
    } catch (err: any) {
      showFeedback("error", err.message || "Bulk import failed");
    }
  };

  const openAddDrawer = () => {
    setEditingDriver(null);
    setFormData({
      driverName: "",
      photoUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200",
      cnic: `35201-${Math.floor(Math.random() * 9000000) + 1000000}-1`,
      licenseNumber: `LIC-PB-${Math.floor(Math.random() * 900000) + 100000}`,
      licenseExpiry: "2031-12-31",
      mobile: "+92 300 1234567",
      emergencyContact: "+92 321 7654321",
      address: "Mughalpura Sector C-3, Lahore, Pakistan",
      bloodGroup: "B+",
      joiningDate: "2025-06-01",
      salary: 55000,
      allowance: 600,
      experienceYears: 8,
      status: "Available",
      assignedVehicleId: "",
      assignedRouteId: "",
      performanceRating: "4.8",
      violationCount: 0,
      medicalExpiry: "2027-12-31",
    });
    setIsDrawerOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/40 p-4 border border-slate-900 rounded-xl">
        <div className="flex items-center gap-3">
          <UserCheck className="w-8 h-8 text-blue-500" />
          <div>
            <h2 className="text-xl font-bold text-white">Driver Personnel Roster</h2>
            <p className="text-xs text-slate-400">Total verified active commercial drivers: {total}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <ModuleDataIO entityKey="drivers" label="Drivers" onImported={fetchDrivers} />
          <button
            onClick={openAddDrawer}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition"
          >
            <Plus className="w-4 h-4" /> Add Driver
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
            <Upload className="w-4 h-4" /> Import Roster
          </button>
        </div>
      </div>

      {/* Filters bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-950/20 p-4 rounded-xl border border-slate-900">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by driver name, CNIC, license number..."
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
            <option value="On Trip">On Trip / Dispatched</option>
            <option value="Leave">On Leave</option>
            <option value="Suspended">Suspended</option>
          </select>
        </div>

        <div>
          <select
            value={bloodFilter}
            onChange={(e) => { setBloodFilter(e.target.value); setPage(1); }}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="">All Blood Groups</option>
            <option value="A+">A+</option>
            <option value="A-">A-</option>
            <option value="B+">B+</option>
            <option value="B-">B-</option>
            <option value="O+">O+</option>
            <option value="O-">O-</option>
            <option value="AB+">AB+</option>
          </select>
        </div>
      </div>

      {/* Bulk Import */}
      {isImportOpen && (
        <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-white">Bulk Driver Roster Import (JSON)</h3>
            <button onClick={() => setIsImportOpen(false)} className="text-slate-500 hover:text-white text-xs">Close</button>
          </div>
          <textarea
            placeholder='[{"driverName": "Amjad Khan", "cnic": "35201-9921232-1", "licenseNumber": "LIC-PB-991", "licenseExpiry": "2030-01-01", "mobile": "+923000000001", "salary": 50000}]'
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 h-32 text-xs text-slate-300 font-mono focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleImport}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition"
          >
            Inject Driver Profiles
          </button>
        </div>
      )}

      {/* Grid Roster Cards Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="h-44 bg-slate-950/20 border border-slate-900 rounded-xl animate-pulse" />
          ))
        ) : drivers.length === 0 ? (
          <div className="col-span-2 text-center py-12 text-slate-500 text-xs">
            No matching driver profiles located in operations directory.
          </div>
        ) : (
          drivers.map((d) => {
            const isLicenseExpired = new Date(d.licenseExpiry).getTime() < Date.now();
            return (
              <div key={d.id} className="bg-slate-950/40 border border-slate-900 rounded-xl p-4 flex flex-col sm:flex-row justify-between gap-4 hover:border-slate-800 transition">
                <div className="flex gap-4">
                  <img
                    src={d.photoUrl || "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200"}
                    alt={d.driverName}
                    className="w-16 h-16 rounded-full object-cover border border-slate-800 self-start"
                  />
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      {d.driverName}
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                        d.status === "Available" ? "bg-emerald-500/10 text-emerald-400" : "bg-blue-500/10 text-blue-400"
                      }`}>
                        {d.status}
                      </span>
                    </h3>
                    <div className="text-[11px] text-slate-400">CNIC: <span className="font-mono text-slate-300">{d.cnic}</span></div>
                    <div className="text-[11px] text-slate-400">Mobile: <span className="font-mono text-slate-300">{d.mobile}</span></div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-1">
                      License: <span className="font-mono text-slate-300">{d.licenseNumber}</span>
                      {isLicenseExpired && (
                        <span className="text-[9px] text-rose-400 flex items-center gap-0.5 font-bold">
                          <AlertTriangle className="w-3 h-3" /> EXPIRED
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5 pt-1">
                      <Award className="w-3.5 h-3.5 text-amber-500" />
                      Rating: <span className="font-bold text-slate-300">{d.performanceRating || "5.0"}</span>
                      <span className="text-slate-600">|</span>
                      Violations: <span className="font-bold text-rose-400">{d.violationCount}</span>
                    </div>
                  </div>
                </div>

                <div className="flex sm:flex-col justify-between items-end gap-2 border-t sm:border-t-0 border-slate-900 pt-3 sm:pt-0">
                  <div className="text-right">
                    <div className="text-[10px] text-slate-500">Salary Package</div>
                    <div className="text-xs font-bold text-white font-mono">PKR {d.salary.toLocaleString()}</div>
                    <div className="text-[10px] text-slate-500">Trip Allowance</div>
                    <div className="text-[10px] font-semibold text-blue-400 font-mono">PKR {d.allowance} / km</div>
                  </div>

                  <div className="flex gap-1">
                    <button
                      onClick={() => handleEdit(d)}
                      className="p-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-lg transition"
                      title="Edit Profile"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(d.id)}
                      className="p-1.5 bg-slate-900 border border-slate-800 hover:bg-rose-500/10 hover:text-rose-400 text-slate-400 rounded-lg transition"
                      title="Retire Driver"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="bg-white rounded-lg mt-2">
                  <RecordAttachments entityType="driver" entityId={d.id} label="Licence / CNIC / documents" />
                </div>
              </div>
            );
          })
        )}
        </div>

      {/* Pagination controls */}
      <div className="flex justify-between items-center bg-slate-950/20 border border-slate-900 p-3 rounded-xl text-xs text-slate-400">
        <div>Showing {drivers.length} out of {total} registered personnel</div>
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

      {/* Drawer Form */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/80 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-2xl bg-slate-950 border-l border-slate-900 p-6 overflow-y-auto space-y-6 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-900 pb-4">
              <div className="flex items-center gap-2">
                <UserCheck className="w-6 h-6 text-blue-500" />
                <h3 className="text-lg font-bold text-white">
                  {editingDriver ? `Edit Personnel: ${formData.driverName}` : "Enroll Commercial Driver Profile"}
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
                  <label className="block text-slate-400 mb-1">Driver Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Amjad Khan"
                    value={formData.driverName}
                    onChange={(e) => setFormData({ ...formData, driverName: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">CNIC (National ID card) *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 35201-1234567-1"
                    value={formData.cnic}
                    onChange={(e) => setFormData({ ...formData, cnic: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Row 2 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Commercial License Number *</label>
                  <input
                    type="text"
                    required
                    value={formData.licenseNumber}
                    onChange={(e) => setFormData({ ...formData, licenseNumber: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">License Expiration Date *</label>
                  <input
                    type="date"
                    required
                    value={formData.licenseExpiry}
                    onChange={(e) => setFormData({ ...formData, licenseExpiry: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Row 3 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Mobile / GSM Contact *</label>
                  <input
                    type="text"
                    required
                    value={formData.mobile}
                    onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Emergency SOS Contact</label>
                  <input
                    type="text"
                    value={formData.emergencyContact}
                    onChange={(e) => setFormData({ ...formData, emergencyContact: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  />
                </div>
              </div>

              {/* Row 4 */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Blood Group</label>
                  <select
                    value={formData.bloodGroup}
                    onChange={(e) => setFormData({ ...formData, bloodGroup: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  >
                    <option value="A+">A+</option>
                    <option value="A-">A-</option>
                    <option value="B+">B+</option>
                    <option value="B-">B-</option>
                    <option value="O+">O+</option>
                    <option value="O-">O-</option>
                    <option value="AB+">AB+</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Experience (Years)</label>
                  <input
                    type="number"
                    value={formData.experienceYears}
                    onChange={(e) => setFormData({ ...formData, experienceYears: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Rating</label>
                  <input
                    type="text"
                    value={formData.performanceRating}
                    onChange={(e) => setFormData({ ...formData, performanceRating: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  />
                </div>
              </div>

              {/* Address */}
              <div>
                <label className="block text-slate-400 mb-1">Permanent Address</label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none h-16"
                />
              </div>

              {/* Financial packages */}
              <div className="grid grid-cols-2 gap-4 border-t border-slate-900 pt-4">
                <div>
                  <label className="block text-slate-400 mb-1">Base Salary Package (PKR / month) *</label>
                  <input
                    type="number"
                    required
                    value={formData.salary}
                    onChange={(e) => setFormData({ ...formData, salary: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Transit Allowance (PKR / km)</label>
                  <input
                    type="number"
                    value={formData.allowance}
                    onChange={(e) => setFormData({ ...formData, allowance: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                  />
                </div>
              </div>

              {/* Status parameters */}
              <div className="grid grid-cols-3 gap-4 border-t border-slate-900 pt-4">
                <div>
                  <label className="block text-slate-400 mb-1">Operational Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none"
                  >
                    <option value="Available">Available</option>
                    <option value="On Trip">On Trip</option>
                    <option value="Leave">On Leave</option>
                    <option value="Suspended">Suspended</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Medical Expiry</label>
                  <input
                    type="date"
                    value={formData.medicalExpiry}
                    onChange={(e) => setFormData({ ...formData, medicalExpiry: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Violation Penalties Count</label>
                  <input
                    type="number"
                    value={formData.violationCount}
                    onChange={(e) => setFormData({ ...formData, violationCount: Number(e.target.value) })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                  />
                </div>
              </div>

              {/* Photo URL */}
              <div>
                <label className="block text-slate-400 mb-1">Avatar / Photo URL</label>
                <input
                  type="text"
                  value={formData.photoUrl}
                  onChange={(e) => setFormData({ ...formData, photoUrl: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white"
                />
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
                    "Save Driver Profile"
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
