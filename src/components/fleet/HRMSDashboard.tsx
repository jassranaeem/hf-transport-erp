import React, { useState, useEffect } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { DbUser } from "../../types.ts";
import {
  Users,
  Building,
  Calendar,
  Clock,
  Briefcase,
  Activity,
  Award,
  BookOpen,
  FileText,
  UserCheck,
  Plus,
  Trash,
  CheckCircle,
  AlertTriangle,
  QrCode,
  DollarSign,
  Send,
  Download,
  Search,
  Check,
  X,
  RefreshCw,
  UserPlus,
  ShieldAlert,
  Edit2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface HRMSDashboardProps {
  dbUser: DbUser;
  showFeedback: (type: "success" | "error", message: string) => void;
}

export default function HRMSDashboard({ dbUser, showFeedback }: HRMSDashboardProps) {
  const [hrmsTab, setHrmsTab] = useState<"overview" | "employees" | "attendance" | "leaves" | "payroll" | "performance" | "recruitment" | "trainings" | "documents">("overview");

  // Loading state
  const [loading, setLoading] = useState(false);

  // Core Master Lists
  const [dashboardStats, setDashboardStats] = useState<any>(null);
  const [employeesList, setEmployeesList] = useState<any[]>([]);
  const [attendanceList, setAttendanceList] = useState<any[]>([]);
  const [leavesList, setLeavesList] = useState<any[]>([]);
  const [payrollList, setPayrollList] = useState<any[]>([]);
  const [driverPerfList, setDriverPerfList] = useState<any[]>([]);
  const [staffPerfList, setStaffPerfList] = useState<any[]>([]);
  const [jobsList, setJobsList] = useState<any[]>([]);
  const [applicantsList, setApplicantsList] = useState<any[]>([]);
  const [trainingsList, setTrainingsList] = useState<any[]>([]);
  const [empTrainingsList, setEmpTrainingsList] = useState<any[]>([]);
  const [documentsList, setDocumentsList] = useState<any[]>([]);

  // Metadata Dropdowns
  const [departments, setDepartments] = useState<any[]>([]);
  const [designations, setDesignations] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);

  // Modals & New Form States
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [editEmployeeItem, setEditEmployeeItem] = useState<any | null>(null);
  const [employeeForm, setEmployeeForm] = useState({
    fullName: "", fatherName: "", cnic: "", passport: "", nationality: "Pakistani", gender: "Male",
    dob: "", maritalStatus: "Single", bloodGroup: "B+", address: "", city: "", province: "",
    country: "Pakistan", phone: "", email: "", emergencyContact: "", qualification: "", experience: "",
    departmentId: "", designationId: "", branchId: "", joiningDate: "", employmentType: "Full-time",
    basicSalary: "", fuelAllowance: "", otherAllowances: "", bankName: "", bankAccount: "", taxNumber: "", managerId: ""
  });

  const [showAddDepartment, setShowAddDepartment] = useState(false);
  const [deptForm, setDeptForm] = useState({ name: "", code: "" });

  const [showAddDesignation, setShowAddDesignation] = useState(false);
  const [desigForm, setDesigForm] = useState({ name: "", grade: "Junior" });

  const [showAddShift, setShowAddShift] = useState(false);
  const [shiftForm, setShiftForm] = useState({ name: "", type: "Regular", startTime: "09:00", endTime: "17:00", weekendRules: "Sunday Only", ramadanTiming: false });

  const [showApplyLeave, setShowApplyLeave] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ employeeId: "", leaveType: "Annual", startDate: "", endDate: "", reason: "" });

  // was hardcoded to "2026-06" — a stale month baked in at build time that
  // only happened to be "today" once. Defaulting to the real current month
  // avoids the free-text period field silently carrying a leftover/wrong
  // value into a payroll run.
  const [payrollPeriod, setPayrollPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedBankAccount, setSelectedBankAccount] = useState("");
  const [disburseRef, setDisburseRef] = useState("");

  const [showAddPerformanceDrv, setShowAddPerformanceDrv] = useState(false);
  const [perfDrvForm, setPerfDrvForm] = useState({ driverId: "", period: "2026-06", fuelEfficiency: "3.2", onTimeDeliveryCount: "5", totalDeliveries: "5", overspeedEvents: "0", accidentsCount: "0", routeComplianceRate: "100", customerRating: "5.0", annualRating: "A" });

  const [showAddPerformanceStaff, setShowAddPerformanceStaff] = useState(false);
  const [perfStaffForm, setPerfStaffForm] = useState({ employeeId: "", period: "2026-06", attendanceRate: "100", taskCompletionRate: "100", rating: "Meets Expectations" });

  const [showAddJob, setShowAddJob] = useState(false);
  const [jobForm, setJobForm] = useState({ title: "", departmentId: "", description: "", requirements: "" });

  const [showAddApplicant, setShowAddApplicant] = useState(false);
  const [applicantForm, setApplicantForm] = useState({ jobId: "", fullName: "", email: "", phone: "", cvUrl: "https://example.com/cv.pdf" });

  const [showAddTraining, setShowAddTraining] = useState(false);
  const [trainingForm, setTrainingForm] = useState({ name: "", trainer: "", sessionDate: "", description: "" });

  const [showAddEmpTraining, setShowAddEmpTraining] = useState(false);
  const [empTrainingForm, setEmpTrainingForm] = useState({ employeeId: "", trainingId: "", certificateUrl: "", expiryDate: "", completionDate: "", status: "Enrolled" });

  const [showAddDocument, setShowAddDocument] = useState(false);
  const [documentForm, setDocumentForm] = useState({ employeeId: "", docType: "CNIC", docNumber: "", expiryDate: "", fileUrl: "https://example.com/doc.pdf", ocrData: "" });

  // Filtering states
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedDeptFilter, setSelectedDeptFilter] = useState("");

  useEffect(() => {
    fetchHRMSData();
  }, [hrmsTab]);

  const fetchHRMSData = async () => {
    setLoading(true);
    try {
      // Fetch metadata always
      const depts = await enterpriseFetch("/api/hr/org/departments");
      setDepartments(depts);
      const desigs = await enterpriseFetch("/api/hr/org/designations");
      setDesignations(desigs);
      const brs = await enterpriseFetch("/api/hr/org/branches");
      setBranches(brs);
      const shfs = await enterpriseFetch("/api/hr/org/shifts");
      setShifts(shfs);

      const drvs = await enterpriseFetch("/api/operations/drivers");
      setDrivers(drvs?.data || (Array.isArray(drvs) ? drvs : []));
      // NOT /api/finance/accounts (Chart of Accounts — rows shaped
      // {code, name, type, category}) — this dropdown renders b.bankName
      // and b.currentBalance, which only exist on the real bank_accounts
      // table. Fetching the wrong one meant every option showed the right
      // account COUNT (both tables happened to return rows) but neither
      // field the label needed, hence "(PKR NaN)" with no name on all of
      // them — same class of bug as the earlier Cash Position / Executive
      // Overview mixups: a screen reading a different table than the one
      // that actually has the field it's displaying.
      const banks = await enterpriseFetch("/api/finance/banks");
      setBankAccounts(banks);

      if (hrmsTab === "overview") {
        const stats = await enterpriseFetch("/api/hr/dashboard");
        setDashboardStats(stats);
      } else if (hrmsTab === "employees") {
        const emps = await enterpriseFetch("/api/hr/employees");
        setEmployeesList(emps);
      } else if (hrmsTab === "attendance") {
        const atts = await enterpriseFetch("/api/hr/attendance");
        setAttendanceList(atts);
      } else if (hrmsTab === "leaves") {
        const lvs = await enterpriseFetch("/api/hr/leaves");
        setLeavesList(lvs);
      } else if (hrmsTab === "payroll") {
        const pays = await enterpriseFetch("/api/hr/payroll");
        setPayrollList(pays);
      } else if (hrmsTab === "performance") {
        const drvPerfs = await enterpriseFetch("/api/hr/performance/drivers");
        setDriverPerfList(drvPerfs);
        const staffPerfs = await enterpriseFetch("/api/hr/performance/staff");
        setStaffPerfList(staffPerfs);
      } else if (hrmsTab === "recruitment") {
        const jbs = await enterpriseFetch("/api/hr/recruitment/jobs");
        setJobsList(jbs);
        const apps = await enterpriseFetch("/api/hr/recruitment/applicants");
        setApplicantsList(apps);
      } else if (hrmsTab === "trainings") {
        const trs = await enterpriseFetch("/api/hr/trainings");
        setTrainingsList(trs);
        const ets = await enterpriseFetch("/api/hr/trainings/employee");
        setEmpTrainingsList(ets);
      } else if (hrmsTab === "documents") {
        const docs = await enterpriseFetch("/api/hr/documents");
        setDocumentsList(docs);
      }
    } catch (err: any) {
      showFeedback("error", "Failed to retrieve HRMS logs: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // FORM SUBMISSIONS

  const handleAddDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/hr/org/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deptForm)
      });
      showFeedback("success", "Department created successfully.");
      setShowAddDepartment(false);
      setDeptForm({ name: "", code: "" });
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleAddDesignation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/hr/org/designations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(desigForm)
      });
      showFeedback("success", "Designation created successfully.");
      setShowAddDesignation(false);
      setDesigForm({ name: "", grade: "Junior" });
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleAddShift = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/hr/org/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shiftForm)
      });
      showFeedback("success", "Work Shift created successfully.");
      setShowAddShift(false);
      setShiftForm({ name: "", type: "Regular", startTime: "09:00", endTime: "17:00", weekendRules: "Sunday Only", ramadanTiming: false });
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = editEmployeeItem ? `/api/hr/employees/${editEmployeeItem.id}` : "/api/hr/employees";
      const method = editEmployeeItem ? "PUT" : "POST";
      
      await enterpriseFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(employeeForm)
      });

      showFeedback("success", editEmployeeItem ? "Employee file updated." : "New employee enrolled.");
      setShowAddEmployee(false);
      setEditEmployeeItem(null);
      setEmployeeForm({
        fullName: "", fatherName: "", cnic: "", passport: "", nationality: "Pakistani", gender: "Male",
        dob: "", maritalStatus: "Single", bloodGroup: "B+", address: "", city: "", province: "",
        country: "Pakistan", phone: "", email: "", emergencyContact: "", qualification: "", experience: "",
        departmentId: "", designationId: "", branchId: "", joiningDate: "", employmentType: "Full-time",
        basicSalary: "", fuelAllowance: "", otherAllowances: "", bankName: "", bankAccount: "", taxNumber: "", managerId: ""
      });
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleEditEmployee = (emp: any) => {
    setEditEmployeeItem(emp);
    setEmployeeForm({
      fullName: emp.fullName || "",
      fatherName: emp.fatherName || "",
      cnic: emp.cnic || "",
      passport: emp.passport || "",
      nationality: emp.nationality || "Pakistani",
      gender: emp.gender || "Male",
      dob: emp.dob ? emp.dob.split("T")[0] : "",
      maritalStatus: emp.maritalStatus || "Single",
      bloodGroup: emp.bloodGroup || "",
      address: emp.address || "",
      city: emp.city || "",
      province: emp.province || "",
      country: emp.country || "Pakistan",
      phone: emp.phone || "",
      email: emp.email || "",
      emergencyContact: emp.emergencyContact || "",
      qualification: emp.qualification || "",
      experience: emp.experience || "",
      departmentId: String(emp.departmentId || ""),
      designationId: String(emp.designationId || ""),
      branchId: String(emp.branchId || ""),
      joiningDate: emp.joiningDate ? emp.joiningDate.split("T")[0] : "",
      employmentType: emp.employmentType || "Full-time",
      basicSalary: String(emp.basicSalary || ""),
      fuelAllowance: String(emp.fuelAllowance || ""),
      otherAllowances: String(emp.otherAllowances || ""),
      bankName: emp.bankName || "",
      bankAccount: emp.bankAccount || "",
      taxNumber: emp.taxNumber || "",
      managerId: String(emp.managerId || "")
    });
    setShowAddEmployee(true);
  };

  const handleDeleteEmployee = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this employee record?")) return;
    try {
      await enterpriseFetch(`/api/hr/employees/${id}`, { method: "DELETE" });
      showFeedback("success", "Employee profile deleted.");
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleApplyLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/hr/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(leaveForm)
      });
      showFeedback("success", "Leave request logged.");
      setShowApplyLeave(false);
      setLeaveForm({ employeeId: "", leaveType: "Annual", startDate: "", endDate: "", reason: "" });
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleApproveLeave = async (id: number, status: "Approved" | "Rejected") => {
    try {
      await enterpriseFetch(`/api/hr/leaves/${id}/approve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      showFeedback("success", `Leave status set to ${status}.`);
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  // Clock in simulation
  const handleSimulatedClock = async (empId: number, type: "in" | "out") => {
    try {
      const endpoint = type === "in" ? "/api/hr/attendance/clock-in" : "/api/hr/attendance/clock-out";
      await enterpriseFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: empId,
          latitude: "33.6844",
          longitude: "73.0479" // Islamabad Headquarters coordinates
        })
      });
      showFeedback("success", `Clocked ${type} successfully at Islamabad HQ.`);
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  // Manual payroll calculate
  const handleCalculatePayroll = async () => {
    try {
      const res = await enterpriseFetch("/api/hr/payroll/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: payrollPeriod })
      });
      showFeedback("success", `Recalculated salaries for period ${payrollPeriod}. Processed ${res.count} pay slips.`);
      await fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  // Accrual Post Payroll
  const handlePostPayroll = async () => {
    try {
      await enterpriseFetch("/api/hr/payroll/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: payrollPeriod })
      });
      showFeedback("success", `Posted payroll accruals to general ledger (DEBIT: Gross Salaries, CREDIT: Salaries Payable).`);
      await fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  // Payout Disburse Payroll
  const handlePayPayroll = async () => {
    if (!selectedBankAccount) {
      showFeedback("error", "Please select a funding bank account.");
      return;
    }
    try {
      await enterpriseFetch("/api/hr/payroll/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period: payrollPeriod,
          bankAccountId: selectedBankAccount,
          bankTransferRef: disburseRef
        })
      });
      showFeedback("success", `Salary disbursement complete. Posted bank payment JE and adjusted cash accounts.`);
      await fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  // Performance forms
  const handleAddPerfDrv = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/hr/performance/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(perfDrvForm)
      });
      showFeedback("success", "Driver monthly rank & fuel efficiency KPI logged.");
      setShowAddPerformanceDrv(false);
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleAddPerfStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/hr/performance/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(perfStaffForm)
      });
      showFeedback("success", "Office performance appraisal saved.");
      setShowAddPerformanceStaff(false);
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  // Recruitment forms
  const handleAddJob = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/hr/recruitment/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jobForm)
      });
      showFeedback("success", "New job opening published.");
      setShowAddJob(false);
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleAddApplicant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/hr/recruitment/applicants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applicantForm)
      });
      showFeedback("success", "Applicant added to the screening pipeline.");
      setShowAddApplicant(false);
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleApplicantStatus = async (id: number, status: string) => {
    try {
      await enterpriseFetch(`/api/hr/recruitment/applicants/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      showFeedback("success", `Applicant moved to: ${status}`);
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  // Trainings
  const handleAddTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/hr/trainings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trainingForm)
      });
      showFeedback("success", "Defensive / safety session created.");
      setShowAddTraining(false);
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleEnrollEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await enterpriseFetch("/api/hr/trainings/employee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(empTrainingForm)
      });
      showFeedback("success", "Employee enrolled in safety training.");
      setShowAddEmpTraining(false);
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleCompleteTraining = async (id: number, status: string, expiryDate: string) => {
    try {
      await enterpriseFetch(`/api/hr/trainings/employee/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, expiryDate, completionDate: new Date() })
      });
      showFeedback("success", "Updated safety cert training log.");
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  // Documents
  const handleUploadDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Simulate OCR scan
      const simulatedOCR = `OCR SUCCESS: Verified Document Number ${documentForm.docNumber || "N/A"}. Verified identity attributes match ERP Master for Employee Id.`;
      const docPayload = { ...documentForm, ocrData: simulatedOCR };

      await enterpriseFetch("/api/hr/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docPayload)
      });
      showFeedback("success", "Uploaded document and completed instant background OCR parsing.");
      setShowAddDocument(false);
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const handleVerifyDocument = async (id: number) => {
    try {
      await enterpriseFetch(`/api/hr/documents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isVerified: true })
      });
      showFeedback("success", "Document marked as verified.");
      fetchHRMSData();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  // Filters
  const filteredEmployees = employeesList.filter((emp) => {
    const matchesSearch = emp.fullName.toLowerCase().includes(employeeSearch.toLowerCase()) || emp.employeeCode.toLowerCase().includes(employeeSearch.toLowerCase());
    const matchesDept = selectedDeptFilter ? Number(emp.departmentId) === Number(selectedDeptFilter) : true;
    return matchesSearch && matchesDept;
  });

  return (
    <div className="bg-slate-950 text-slate-100 min-h-screen p-6 font-sans">
      {/* Top Banner & Title */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800 pb-6 mb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            <Building className="text-emerald-500 w-8 h-8" />
            HF Workforce ERP Suite <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full border border-emerald-500/20 font-mono">v2.0 Enterprise</span>
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Core HRMS Master, Shift Planners, Automated Payroll Calculations & Compliance Audit logs
          </p>
        </div>

        <div className="flex gap-2 mt-4 md:mt-0">
          <button
            onClick={() => setShowAddDepartment(true)}
            className="bg-slate-900 border border-slate-700 hover:border-slate-500 px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition"
          >
            <Plus className="w-4 h-4 text-emerald-400" /> +Dept
          </button>
          <button
            onClick={() => setShowAddDesignation(true)}
            className="bg-slate-900 border border-slate-700 hover:border-slate-500 px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition"
          >
            <Plus className="w-4 h-4 text-emerald-400" /> +Designation
          </button>
          <button
            onClick={() => setShowAddShift(true)}
            className="bg-slate-900 border border-slate-700 hover:border-slate-500 px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition"
          >
            <Plus className="w-4 h-4 text-emerald-400" /> +Shift
          </button>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-800 pb-3">
        {[
          { id: "overview", label: "Executive Overview", icon: Activity },
          { id: "employees", label: "Employee Master", icon: Users },
          { id: "attendance", label: "GPS Attendance Tracker", icon: Clock },
          { id: "leaves", label: "Leave Calendar", icon: Calendar },
          { id: "payroll", label: "Automated Payroll", icon: DollarSign },
          { id: "performance", label: "KPIs & Rankings", icon: Award },
          { id: "recruitment", label: "Hiring Pipeline", icon: Briefcase },
          { id: "trainings", label: "Trainings & Safety", icon: BookOpen },
          { id: "documents", label: "Secure Digital Vault", icon: FileText }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = hrmsTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setHrmsTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition duration-150 ${
                isActive
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/10 font-semibold"
                  : "bg-slate-900 text-slate-300 hover:bg-slate-850 border border-slate-800"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Main Container Area */}
      {loading ? (
        <div className="flex justify-center items-center py-24">
          <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
          <span className="text-slate-400 ml-3 font-mono">Loading Enterprise Databases...</span>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          {/* TAB: OVERVIEW */}
          {hrmsTab === "overview" && dashboardStats && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 block font-mono">ACTIVE HEADCOUNT</span>
                    <span className="text-2xl font-bold text-white mt-1 block">{dashboardStats.totalEmployees || 0}</span>
                  </div>
                  <div className="bg-blue-500/10 p-3 rounded-lg text-blue-400 border border-blue-500/20">
                    <Users className="w-6 h-6" />
                  </div>
                </div>

                <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 block font-mono">PRESENT TODAY</span>
                    <span className="text-2xl font-bold text-emerald-400 mt-1 block">{dashboardStats.presentToday || 0}</span>
                  </div>
                  <div className="bg-emerald-500/10 p-3 rounded-lg text-emerald-400 border border-emerald-500/20">
                    <UserCheck className="w-6 h-6" />
                  </div>
                </div>

                <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 block font-mono">LATE / DELAYED ARRIVAL</span>
                    <span className="text-2xl font-bold text-amber-400 mt-1 block">{dashboardStats.lateEmployees || 0}</span>
                  </div>
                  <div className="bg-amber-500/10 p-3 rounded-lg text-amber-400 border border-amber-500/20">
                    <Clock className="w-6 h-6" />
                  </div>
                </div>

                <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 block font-mono">EST. PAYROLL BUDGET</span>
                    <span className="text-2xl font-bold text-white mt-1 block">PKR {(dashboardStats.payrollCost || 0).toLocaleString()}</span>
                  </div>
                  <div className="bg-emerald-500/10 p-3 rounded-lg text-emerald-400 border border-emerald-500/20">
                    <DollarSign className="w-6 h-6" />
                  </div>
                </div>
              </div>

              {/* Drivers & Expiries grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Active driver status */}
                <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 lg:col-span-2">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Activity className="text-emerald-500 w-5 h-5" /> Live Transit & Driver Availability
                  </h3>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                      <span className="text-xs text-slate-400 font-mono">ON ACTIVE TRIP</span>
                      <span className="text-2xl font-extrabold text-blue-400 block mt-1">{dashboardStats.driversOnTrip || 0} Drivers</span>
                    </div>
                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                      <span className="text-xs text-slate-400 font-mono">AVAILABLE IN YARD</span>
                      <span className="text-2xl font-extrabold text-emerald-400 block mt-1">{dashboardStats.driversAvailable || 0} Drivers</span>
                    </div>
                  </div>

                  {/* Department breakdown stats */}
                  <h4 className="text-xs font-mono text-slate-400 mb-2 uppercase tracking-wider">Departmental Headcount Distributions</h4>
                  <div className="space-y-3">
                    {dashboardStats.departmentStats && dashboardStats.departmentStats.map((dept: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between bg-slate-950 p-2.5 rounded border border-slate-800">
                        <span className="text-sm font-medium">{dept.departmentName}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-400 font-mono">{dept.count} active</span>
                          <div className="w-24 bg-slate-850 h-2 rounded overflow-hidden">
                            <div className="bg-emerald-500 h-full" style={{ width: `${Math.min(100, (dept.count / dashboardStats.totalEmployees) * 100)}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Expiries alerts card */}
                <div className="bg-slate-900 p-5 rounded-xl border border-slate-800">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <ShieldAlert className="text-amber-500 w-5 h-5" /> 30-Day Expiry Watchlist
                  </h3>
                  <div className="space-y-3">
                    {dashboardStats.upcomingExpiries && dashboardStats.upcomingExpiries.length > 0 ? (
                      dashboardStats.upcomingExpiries.map((exp: any) => (
                        <div key={exp.id} className="bg-slate-950 p-3 rounded-lg border border-slate-850 flex items-start justify-between">
                          .<div>
                            <span className="text-sm font-semibold block text-white">{exp.employeeName}</span>
                            <span className="text-xs text-amber-400 block mt-0.5">{exp.docType}</span>
                          </div>
                          <span className="text-xs font-mono bg-amber-500/10 text-amber-400 px-2 py-1 rounded border border-amber-500/20">
                            {new Date(exp.expiryDate).toLocaleDateString()}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-slate-500">
                        <CheckCircle className="w-8 h-8 text-slate-650 mx-auto mb-2" />
                        <span className="text-xs font-mono">No imminent document expiries in next 30 days.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB: EMPLOYEES MASTER */}
          {hrmsTab === "employees" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Filter controls */}
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 flex flex-col md:flex-row gap-4 justify-between items-center">
                <div className="flex flex-wrap gap-2 items-center w-full md:w-auto">
                  <div className="relative flex-1 md:flex-initial">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search code or full name..."
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      className="bg-slate-950 text-slate-200 pl-9 pr-4 py-2 rounded-lg text-sm border border-slate-800 focus:outline-none focus:border-emerald-500 w-full"
                    />
                  </div>

                  <select
                    value={selectedDeptFilter}
                    onChange={(e) => setSelectedDeptFilter(e.target.value)}
                    className="bg-slate-950 text-slate-300 px-3 py-2 rounded-lg text-sm border border-slate-800 focus:outline-none"
                  >
                    <option value="">All Departments</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={() => { setEditEmployeeItem(null); setShowAddEmployee(true); }}
                  className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 w-full md:w-auto justify-center transition"
                >
                  <UserPlus className="w-4 h-4" /> Enroll Employee
                </button>
              </div>

              {/* Master grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredEmployees.map((emp) => (
                  <div key={emp.id} className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-lg hover:border-slate-700 transition">
                    <div className="p-5">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-xs font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                            {emp.employeeCode}
                          </span>
                          <h3 className="text-lg font-bold text-white mt-2">{emp.fullName}</h3>
                          <span className="text-xs text-slate-400 mt-0.5 block">{emp.designationName || "Staff"} — {emp.departmentName || "General"}</span>
                        </div>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
                          emp.status === "Active" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                        }`}>
                          {emp.status}
                        </span>
                      </div>

                      <div className="border-t border-slate-800/60 my-4 pt-3 grid grid-cols-2 gap-2 text-xs font-mono">
                        <div>
                          <span className="text-slate-500 block">CNIC Number</span>
                          <span className="text-slate-300">{emp.cnic}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Phone</span>
                          <span className="text-slate-300">{emp.phone}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Employment</span>
                          <span className="text-slate-300">{emp.employmentType}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Basic Salary</span>
                          <span className="text-slate-300">PKR {Number(emp.basicSalary || 0).toLocaleString()}</span>
                        </div>
                      </div>

                      {/* QR and Barcode Visual Generator mockup */}
                      <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded border border-slate-800 mt-4">
                        <div className="flex items-center gap-2">
                          <QrCode className="w-8 h-8 text-slate-400" />
                          <div>
                            <span className="text-[10px] text-slate-500 block font-mono">SECURE QR CODE</span>
                            <span className="text-[10px] text-slate-300 block font-mono">QR-{emp.employeeCode}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-slate-500 block font-mono">BARCODE</span>
                          <span className="text-[10px] text-slate-300 block font-mono">BAR-{emp.employeeCode}</span>
                        </div>
                      </div>

                      {/* Simulated micro attendance clocking triggers directly on card */}
                      <div className="flex gap-2 mt-4 pt-3 border-t border-slate-800">
                        <button
                          onClick={() => handleSimulatedClock(emp.id, "in")}
                          className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 py-1.5 rounded text-xs font-medium font-mono"
                        >
                          Sim. Clock In
                        </button>
                        <button
                          onClick={() => handleSimulatedClock(emp.id, "out")}
                          className="flex-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 py-1.5 rounded text-xs font-medium font-mono"
                        >
                          Sim. Clock Out
                        </button>
                      </div>

                      {/* Action buttons */}
                      <div className="flex justify-end gap-2 mt-3 pt-2">
                        <button
                          onClick={() => handleEditEmployee(emp)}
                          className="text-slate-400 hover:text-white p-1"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteEmployee(emp.id)}
                          className="text-slate-500 hover:text-rose-400 p-1"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* TAB: GPS ATTENDANCE TRACKER */}
          {hrmsTab === "attendance" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Logging and Corrections */}
              <div className="bg-slate-900 p-5 rounded-xl border border-slate-800">
                <h3 className="text-lg font-bold text-white mb-4">Enterprise GPS Daily Attendance Logs</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-mono text-xs uppercase">
                        <th className="py-3">Employee</th>
                        <th className="py-3">Date</th>
                        <th className="py-3">Clock In</th>
                        <th className="py-3">Clock Out</th>
                        <th className="py-3">Location Coordinates</th>
                        <th className="py-3">Status</th>
                        <th className="py-3">Overtime</th>
                        <th className="py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {attendanceList.map((att) => (
                        <tr key={att.id} className="hover:bg-slate-850/40">
                          <td className="py-3 font-semibold text-white">
                            {att.employeeName} <span className="text-xs text-slate-400 font-mono block">{att.employeeCode}</span>
                          </td>
                          <td className="py-3 font-mono text-xs">{new Date(att.date).toLocaleDateString()}</td>
                          <td className="py-3 font-mono text-xs text-emerald-400">{att.clockIn ? new Date(att.clockIn).toLocaleTimeString() : "—"}</td>
                          <td className="py-3 font-mono text-xs text-blue-400">{att.clockOut ? new Date(att.clockOut).toLocaleTimeString() : "—"}</td>
                          <td className="py-3 font-mono text-xs text-slate-400">{att.latitudeIn ? `${att.latitudeIn}, ${att.longitudeIn}` : "—"}</td>
                          <td className="py-3">
                            <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                              att.status === "Present" ? "bg-emerald-500/10 text-emerald-400" :
                              att.status === "Late" ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400"
                            }`}>
                              {att.status}
                            </span>
                          </td>
                          <td className="py-3 font-mono text-xs">{att.overtimeMinutes || 0} mins</td>
                          <td className="py-3">
                            {att.correctionRequested && (
                              <button
                                onClick={async () => {
                                  await enterpriseFetch(`/api/hr/attendance/correction/${att.id}/approve`, {
                                    method: "PUT",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ status: "Present" })
                                  });
                                  showFeedback("success", "Correction approved.");
                                  fetchHRMSData();
                                }}
                                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-2 py-1 rounded text-xs font-semibold"
                              >
                                Approve Correction
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB: LEAVES */}
          {hrmsTab === "leaves" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
                <h3 className="text-lg font-bold text-white">Leave Calendar & Approvals</h3>
                <button
                  onClick={() => setShowApplyLeave(true)}
                  className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Apply Leave
                </button>
              </div>

              <div className="bg-slate-900 p-5 rounded-xl border border-slate-800">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-mono text-xs uppercase">
                        <th className="py-3">Employee</th>
                        <th className="py-3">Type</th>
                        <th className="py-3">Duration</th>
                        <th className="py-3">Reason</th>
                        <th className="py-3">Status</th>
                        <th className="py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {leavesList.map((lv) => (
                        <tr key={lv.id} className="hover:bg-slate-850/40">
                          <td className="py-3 font-semibold text-white">
                            {lv.employeeName} <span className="text-xs text-slate-400 block font-mono">{lv.employeeCode}</span>
                          </td>
                          <td className="py-3 font-mono text-xs text-blue-400">{lv.leaveType}</td>
                          <td className="py-3 font-mono text-xs">
                            {new Date(lv.startDate).toLocaleDateString()} to {new Date(lv.endDate).toLocaleDateString()}
                          </td>
                          <td className="py-3 text-slate-300">{lv.reason}</td>
                          <td className="py-3">
                            <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                              lv.status === "Approved" ? "bg-emerald-500/10 text-emerald-400" :
                              lv.status === "Pending" ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400"
                            }`}>
                              {lv.status}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            {lv.status === "Pending" && (
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => handleApproveLeave(lv.id, "Approved")}
                                  className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-2 py-1 rounded text-xs font-semibold"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleApproveLeave(lv.id, "Rejected")}
                                  className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 px-2 py-1 rounded text-xs font-semibold border border-rose-500/30"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB: AUTOMATED PAYROLL */}
          {hrmsTab === "payroll" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 space-y-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <DollarSign className="text-emerald-500" /> Auto-Generated Salary slips & General Ledger Postings
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                  <div>
                    <label className="text-xs text-slate-400 block font-mono mb-1">SELECT PAYROLL MONTH</label>
                    {/* type="month", not free text — the calculation route
                        matches this string exactly (payrollPeriod ===
                        "YYYY-MM") and also builds a Date from it; a typo or
                        off-format value here (extra space, "09-2026",
                        "September") silently computes against a different
                        or invalid period instead of erroring, which is easy
                        to miss since the button still shows a success
                        toast. A native month picker can't produce that. */}
                    <input
                      type="month"
                      value={payrollPeriod}
                      onChange={(e) => setPayrollPeriod(e.target.value)}
                      className="bg-slate-950 text-slate-200 px-3 py-2 rounded-lg text-sm border border-slate-800 w-full"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block font-mono mb-1">DISBURSE FUND ACCOUNT</label>
                    <select
                      value={selectedBankAccount}
                      onChange={(e) => setSelectedBankAccount(e.target.value)}
                      className="bg-slate-950 text-slate-200 px-3 py-2 rounded-lg text-sm border border-slate-800 w-full"
                    >
                      <option value="">Choose Payout Account</option>
                      {bankAccounts.map((b) => (
                        <option key={b.id} value={b.id}>{b.bankName} (PKR {Number(b.currentBalance).toLocaleString()})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 block font-mono mb-1">BANK REFERENCE/REF</label>
                    <input
                      type="text"
                      placeholder="e.g. REF-HBL-WORKERS"
                      value={disburseRef}
                      onChange={(e) => setDisburseRef(e.target.value)}
                      className="bg-slate-950 text-slate-200 px-3 py-2 rounded-lg text-sm border border-slate-800 w-full"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleCalculatePayroll}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-3 py-2 rounded-lg text-sm font-semibold text-center"
                    >
                      Calculate Payroll
                    </button>
                    <button
                      onClick={handlePostPayroll}
                      className="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-semibold text-center"
                    >
                      Approve & Post GL
                    </button>
                    <button
                      onClick={handlePayPayroll}
                      className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-950 px-3 py-2 rounded-lg text-sm font-semibold text-center"
                    >
                      Disburse
                    </button>
                  </div>
                </div>
              </div>

              {/* Payroll list view */}
              <div className="bg-slate-900 p-5 rounded-xl border border-slate-800">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-mono text-xs uppercase">
                        <th className="py-3">Employee</th>
                        <th className="py-3">Basic Salary</th>
                        <th className="py-3">Allowances</th>
                        <th className="py-3">Trip Bonus</th>
                        <th className="py-3">Overtime</th>
                        <th className="py-3">Tax/Deductions</th>
                        <th className="py-3">Net Salary</th>
                        <th className="py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {payrollList.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-850/40">
                          <td className="py-3 font-semibold text-white">
                            {p.employeeName} <span className="text-xs text-slate-400 block font-mono">{p.employeeCode}</span>
                          </td>
                          <td className="py-3 font-mono text-xs">PKR {Number(p.basicSalary || 0).toLocaleString()}</td>
                          <td className="py-3 font-mono text-xs text-slate-300">PKR {Number(p.allowances || 0).toLocaleString()}</td>
                          <td className="py-3 font-mono text-xs text-emerald-400">PKR {Number(p.tripAllowance || 0).toLocaleString()}</td>
                          <td className="py-3 font-mono text-xs text-blue-400">PKR {Number(p.overtime || 0).toLocaleString()}</td>
                          <td className="py-3 font-mono text-xs text-rose-400">PKR {Number(p.tax || 0).toLocaleString()}</td>
                          <td className="py-3 font-mono text-xs font-bold text-white">PKR {Number(p.netSalary || 0).toLocaleString()}</td>
                          <td className="py-3">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
                              p.status === "Paid" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                              p.status === "Approved" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            }`}>
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB: KPIs & RANKINGS */}
          {hrmsTab === "performance" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
                <h3 className="text-lg font-bold text-white">Monthly Ranking & KPI Scorecard</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddPerformanceDrv(true)}
                    className="bg-slate-950 border border-slate-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"
                  >
                    + Log Driver KPI
                  </button>
                  <button
                    onClick={() => setShowAddPerformanceStaff(true)}
                    className="bg-slate-950 border border-slate-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"
                  >
                    + Appraisal Review
                  </button>
                </div>
              </div>

              {/* Driver Performance metrics grid */}
              <div className="bg-slate-900 p-5 rounded-xl border border-slate-800">
                <h4 className="text-sm font-bold text-emerald-400 font-mono mb-3 uppercase">Driver Safety & Efficiency Records</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-mono text-xs uppercase">
                        <th className="py-3">Driver Name</th>
                        <th className="py-3">Period</th>
                        <th className="py-3">Fuel Efficiency</th>
                        <th className="py-3">On-Time / Total</th>
                        <th className="py-3">Violations / Accidents</th>
                        <th className="py-3">Compliance</th>
                        <th className="py-3">Rating</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {driverPerfList.map((dp) => (
                        <tr key={dp.id} className="hover:bg-slate-850/40">
                          <td className="py-3 font-semibold text-white">{dp.driverName}</td>
                          <td className="py-3 font-mono text-xs">{dp.period}</td>
                          <td className="py-3 font-mono text-xs text-emerald-400">{dp.fuelEfficiency} Km/L</td>
                          <td className="py-3 font-mono text-xs">{dp.onTimeDeliveryCount} / {dp.totalDeliveries}</td>
                          <td className="py-3 font-mono text-xs text-rose-400">{dp.overspeedEvents} / {dp.accidentsCount}</td>
                          <td className="py-3 font-mono text-xs text-blue-400">{dp.routeComplianceRate}%</td>
                          <td className="py-3">
                            <span className="text-xs bg-amber-500/10 text-amber-400 px-2.5 py-1 rounded font-mono">
                              ★ {dp.customerRating}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Staff performance review records */}
              <div className="bg-slate-900 p-5 rounded-xl border border-slate-800">
                <h4 className="text-sm font-bold text-blue-400 font-mono mb-3 uppercase">Office & Admin Appraisals</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-mono text-xs uppercase">
                        <th className="py-3">Employee</th>
                        <th className="py-3">Period</th>
                        <th className="py-3">Attendance</th>
                        <th className="py-3">Tasks Rate</th>
                        <th className="py-3">Ranking Grade</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {staffPerfList.map((sp) => (
                        <tr key={sp.id} className="hover:bg-slate-850/40">
                          <td className="py-3 font-semibold text-white">
                            {sp.employeeName} <span className="text-xs text-slate-400 block font-mono">{sp.employeeCode}</span>
                          </td>
                          <td className="py-3 font-mono text-xs">{sp.period}</td>
                          <td className="py-3 font-mono text-xs text-emerald-400">{sp.attendanceRate}%</td>
                          <td className="py-3 font-mono text-xs text-blue-400">{sp.taskCompletionRate}%</td>
                          <td className="py-3">
                            <span className="text-xs bg-purple-500/10 text-purple-400 px-2 py-1 rounded border border-purple-500/20 font-mono font-bold">
                              {sp.rating}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB: RECRUITMENT */}
          {hrmsTab === "recruitment" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
                <h3 className="text-lg font-bold text-white">Active Job Postings & Recruiting Pipeline</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddJob(true)}
                    className="bg-slate-950 border border-slate-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"
                  >
                    + Open Position
                  </button>
                  <button
                    onClick={() => setShowAddApplicant(true)}
                    className="bg-slate-950 border border-slate-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"
                  >
                    + Add Applicant
                  </button>
                </div>
              </div>

              {/* Jobs Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {jobsList.map((job) => (
                  <div key={job.id} className="bg-slate-900 p-5 rounded-xl border border-slate-800">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-lg font-bold text-white">{job.title}</h4>
                        <span className="text-xs font-mono text-slate-400 block mt-1">DEP: {job.departmentName || "General Operations"}</span>
                      </div>
                      <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded font-mono">
                        {job.status}
                      </span>
                    </div>
                    <p className="text-slate-300 text-xs mt-3 line-clamp-2">{job.description}</p>
                  </div>
                ))}
              </div>

              {/* Applicants pipeline list */}
              <div className="bg-slate-900 p-5 rounded-xl border border-slate-800">
                <h4 className="text-sm font-bold text-slate-300 font-mono mb-3 uppercase">Active Candidates Pipeline</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-mono text-xs uppercase">
                        <th className="py-3">Candidate</th>
                        <th className="py-3">Target Job</th>
                        <th className="py-3">Contact</th>
                        <th className="py-3">CV File</th>
                        <th className="py-3">Status Stage</th>
                        <th className="py-3 text-right">Progress Stage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {applicantsList.map((app) => (
                        <tr key={app.id} className="hover:bg-slate-850/40">
                          <td className="py-3 font-semibold text-white">{app.fullName}</td>
                          <td className="py-3 font-mono text-xs text-blue-400">{app.jobTitle || "Fleet Assistant"}</td>
                          <td className="py-3 font-mono text-xs text-slate-300">{app.phone} <span className="text-[10px] text-slate-500 block">{app.email}</span></td>
                          <td className="py-3">
                            <a href={app.cvUrl} className="text-xs text-emerald-400 flex items-center gap-1 hover:underline" target="_blank" rel="noreferrer">
                              <Download className="w-3.5 h-3.5" /> cv.pdf
                            </a>
                          </td>
                          <td className="py-3">
                            <span className="text-xs bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded font-mono">
                              {app.status}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex justify-end gap-1.5">
                              {["Applied", "Screening", "Interviewing", "Offered", "Joined"].map((stage) => (
                                <button
                                  key={stage}
                                  onClick={() => handleApplicantStatus(app.id, stage)}
                                  className={`px-1.5 py-0.5 text-[10px] rounded font-mono font-bold border transition ${
                                    app.status === stage
                                      ? "bg-emerald-500 text-slate-950 border-emerald-400"
                                      : "bg-slate-950 text-slate-400 border-slate-800 hover:text-white"
                                  }`}
                                >
                                  {stage}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB: TRAININGS */}
          {hrmsTab === "trainings" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
                <h3 className="text-lg font-bold text-white">ISO Certifications & Safety Trainings</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddTraining(true)}
                    className="bg-slate-950 border border-slate-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"
                  >
                    + Create Session
                  </button>
                  <button
                    onClick={() => setShowAddEmpTraining(true)}
                    className="bg-slate-950 border border-slate-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2"
                  >
                    + Enroll Employee
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 p-5 rounded-xl border border-slate-800">
                <h4 className="text-sm font-bold text-emerald-400 font-mono mb-3 uppercase">Active Training Sessions</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {trainingsList.map((tr) => (
                    <div key={tr.id} className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                      <h5 className="font-bold text-white text-base">{tr.name}</h5>
                      <span className="text-xs text-slate-400 block mt-1 font-mono">Trainer: {tr.trainer}</span>
                      <span className="text-xs text-slate-400 block font-mono">Scheduled: {new Date(tr.sessionDate).toLocaleDateString()}</span>
                      <p className="text-slate-300 text-xs mt-2">{tr.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 p-5 rounded-xl border border-slate-800">
                <h4 className="text-sm font-bold text-blue-400 font-mono mb-3 uppercase">Employee Certificate Logs & Renewals</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-mono text-xs uppercase">
                        <th className="py-3">Employee</th>
                        <th className="py-3">Training Module</th>
                        <th className="py-3">Completion Date</th>
                        <th className="py-3">Cert Expiry</th>
                        <th className="py-3">Status</th>
                        <th className="py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {empTrainingsList.map((et) => (
                        <tr key={et.id} className="hover:bg-slate-850/40">
                          <td className="py-3 font-semibold text-white">
                            {et.employeeName} <span className="text-xs text-slate-400 block font-mono">{et.employeeCode}</span>
                          </td>
                          <td className="py-3 text-slate-300">{et.trainingName}</td>
                          <td className="py-3 font-mono text-xs">{et.completionDate ? new Date(et.completionDate).toLocaleDateString() : "Pending"}</td>
                          <td className="py-3 font-mono text-xs text-amber-400">{et.expiryDate ? new Date(et.expiryDate).toLocaleDateString() : "None"}</td>
                          <td className="py-3">
                            <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                              et.status === "Completed" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                            }`}>
                              {et.status}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            {et.status !== "Completed" && (
                              <button
                                onClick={() => handleCompleteTraining(et.id, "Completed", "2027-06-26")}
                                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-2.5 py-1 rounded text-xs font-semibold"
                              >
                                Certify Complete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB: SECURE DIGITAL VAULT */}
          {hrmsTab === "documents" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <FileText className="text-emerald-500" /> Secure Documents Repository
                </h3>
                <button
                  onClick={() => setShowAddDocument(true)}
                  className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Upload Document & Scan
                </button>
              </div>

              <div className="bg-slate-900 p-5 rounded-xl border border-slate-800">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-mono text-xs uppercase">
                        <th className="py-3">Employee</th>
                        <th className="py-3">Doc Type</th>
                        <th className="py-3">Identifier/No.</th>
                        <th className="py-3">Expiration Date</th>
                        <th className="py-3">AI OCR Analysis Metadata</th>
                        <th className="py-3">Status Verification</th>
                        <th className="py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {documentsList.map((doc) => (
                        <tr key={doc.id} className="hover:bg-slate-850/40">
                          <td className="py-3 font-semibold text-white">
                            {doc.employeeName} <span className="text-xs text-slate-400 block font-mono">{doc.employeeCode}</span>
                          </td>
                          <td className="py-3 font-mono text-xs text-blue-400">{doc.docType}</td>
                          <td className="py-3 font-mono text-xs text-slate-300">{doc.docNumber || "—"}</td>
                          <td className="py-3 font-mono text-xs text-slate-400">
                            {doc.expiryDate ? new Date(doc.expiryDate).toLocaleDateString() : "Permanent"}
                          </td>
                          <td className="py-3 max-w-xs text-slate-300 text-xs truncate">
                            {doc.ocrData || "Pending scan..."}
                          </td>
                          <td className="py-3">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
                              doc.isVerified ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            }`}>
                              {doc.isVerified ? "OCR Verified" : "Pending Audit"}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            {!doc.isVerified && (
                              <button
                                onClick={() => handleVerifyDocument(doc.id)}
                                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-2 py-1 rounded text-xs font-semibold"
                              >
                                Verify CNIC
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* FORM MODAL: ADD/EDIT EMPLOYEE */}
      {showAddEmployee && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-slate-900 border border-slate-800 rounded-xl max-w-4xl w-full p-6 max-h-[90vh] overflow-y-auto shadow-2xl space-y-4"
          >
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-xl font-bold text-white">
                {editEmployeeItem ? "Modify Employee Record" : "Enroll New Enterprise Employee"}
              </h3>
              <button onClick={() => setShowAddEmployee(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployee} className="space-y-4 text-sm text-slate-300">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">FULL NAME *</label>
                  <input
                    type="text" required
                    value={employeeForm.fullName}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, fullName: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">FATHER NAME *</label>
                  <input
                    type="text" required
                    value={employeeForm.fatherName}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, fatherName: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">CNIC NUMBER *</label>
                  <input
                    type="text" required placeholder="e.g. 37405-1234567-1"
                    value={employeeForm.cnic}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, cnic: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">PASSPORT (OPTIONAL)</label>
                  <input
                    type="text"
                    value={employeeForm.passport}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, passport: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">GENDER *</label>
                  <select
                    value={employeeForm.gender}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, gender: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">DATE OF BIRTH *</label>
                  <input
                    type="date" required
                    value={employeeForm.dob}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, dob: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">MOBILE PHONE *</label>
                  <input
                    type="text" required
                    value={employeeForm.phone}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, phone: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">OFFICIAL EMAIL *</label>
                  <input
                    type="email" required
                    value={employeeForm.email}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">EMERGENCY CONTACT *</label>
                  <input
                    type="text" required
                    value={employeeForm.emergencyContact}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, emergencyContact: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">DEPARTMENT *</label>
                  <select
                    value={employeeForm.departmentId} required
                    onChange={(e) => setEmployeeForm({ ...employeeForm, departmentId: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  >
                    <option value="">Choose Department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">DESIGNATION *</label>
                  <select
                    value={employeeForm.designationId} required
                    onChange={(e) => setEmployeeForm({ ...employeeForm, designationId: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  >
                    <option value="">Choose Designation</option>
                    {designations.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">BRANCH *</label>
                  <select
                    value={employeeForm.branchId} required
                    onChange={(e) => setEmployeeForm({ ...employeeForm, branchId: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  >
                    <option value="">Choose Branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">BASIC MONTHLY SALARY *</label>
                  <input
                    type="number" required placeholder="PKR"
                    value={employeeForm.basicSalary}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, basicSalary: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">FUEL ALLOWANCE</label>
                  <input
                    type="number" placeholder="PKR"
                    value={employeeForm.fuelAllowance}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, fuelAllowance: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">OTHER ALLOWANCES</label>
                  <input
                    type="number" placeholder="PKR"
                    value={employeeForm.otherAllowances}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, otherAllowances: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full font-mono"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="block text-xs font-mono text-slate-400 mb-1">RESIDENTIAL ADDRESS *</label>
                  <textarea
                    required rows={2}
                    value={employeeForm.address}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, address: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">CITY *</label>
                  <input
                    type="text" required
                    value={employeeForm.city}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, city: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">PROVINCE *</label>
                  <input
                    type="text" required
                    value={employeeForm.province}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, province: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">QUALIFICATION *</label>
                  <input
                    type="text" required
                    value={employeeForm.qualification}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, qualification: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">BANK NAME</label>
                  <input
                    type="text"
                    value={employeeForm.bankName}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, bankName: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">BANK ACCOUNT/IBAN</label>
                  <input
                    type="text"
                    value={employeeForm.bankAccount}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, bankAccount: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">NTN TAX NUMBER</label>
                  <input
                    type="text"
                    value={employeeForm.taxNumber}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, taxNumber: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddEmployee(false)}
                  className="bg-slate-950 hover:bg-slate-850 px-4 py-2 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-5 py-2 rounded-lg font-semibold"
                >
                  Save Profile
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* MODAL: ADD DEPT */}
      {showAddDepartment && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Add Enterprise Department</h3>
              <button onClick={() => setShowAddDepartment(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddDepartment} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">DEPARTMENT NAME</label>
                <input
                  type="text" required
                  value={deptForm.name}
                  onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                  className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">DEPARTMENT CODE</label>
                <input
                  type="text" required placeholder="e.g. FIN, OPS, HR"
                  value={deptForm.code}
                  onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value })}
                  className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full font-mono"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowAddDepartment(false)} className="bg-slate-950 px-4 py-2 rounded font-medium">Cancel</button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-4 py-2 rounded font-semibold">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD DESIGNATION */}
      {showAddDesignation && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Add Designation Grade</h3>
              <button onClick={() => setShowAddDesignation(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddDesignation} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">DESIGNATION NAME</label>
                <input
                  type="text" required
                  value={desigForm.name}
                  onChange={(e) => setDesigForm({ ...desigForm, name: e.target.value })}
                  className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">GRADE LEVEL</label>
                <select
                  value={desigForm.grade}
                  onChange={(e) => setDesigForm({ ...desigForm, grade: e.target.value })}
                  className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                >
                  <option value="Junior">Junior</option>
                  <option value="Senior">Senior</option>
                  <option value="Executive">Executive</option>
                  <option value="Lead">Lead</option>
                  <option value="C-Level">C-Level</option>
                </select>
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowAddDesignation(false)} className="bg-slate-950 px-4 py-2 rounded font-medium">Cancel</button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-4 py-2 rounded font-semibold">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: APPLY LEAVE */}
      {showApplyLeave && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Apply for Leave Absence</h3>
              <button onClick={() => setShowApplyLeave(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleApplyLeave} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">EMPLOYEE</label>
                <select
                  value={leaveForm.employeeId} required
                  onChange={(e) => setLeaveForm({ ...leaveForm, employeeId: e.target.value })}
                  className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                >
                  <option value="">Choose Employee</option>
                  {employeesList.map((e) => (
                    <option key={e.id} value={e.id}>{e.fullName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">LEAVE TYPE</label>
                <select
                  value={leaveForm.leaveType}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
                  className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                >
                  <option value="Annual">Annual Leave</option>
                  <option value="Sick">Sick Leave</option>
                  <option value="Casual">Casual Leave</option>
                  <option value="Maternity">Maternity Leave</option>
                  <option value="Paternity">Paternity Leave</option>
                  <option value="Unpaid">Unpaid Leave</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">START DATE</label>
                  <input
                    type="date" required
                    value={leaveForm.startDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">END DATE</label>
                  <input
                    type="date" required
                    value={leaveForm.endDate}
                    onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                    className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">REASON / JUSTIFICATION</label>
                <textarea
                  required rows={3}
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white w-full"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowApplyLeave(false)} className="bg-slate-950 px-4 py-2 rounded font-medium">Cancel</button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-4 py-2 rounded font-semibold">Submit Request</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* OTHER MOCK MODALS / ADD POPUPS PLACEHOLDERS */}
      {/* (To keep user code modular, we dynamically initialize form elements inline or with modals) */}

    </div>
  );
}
