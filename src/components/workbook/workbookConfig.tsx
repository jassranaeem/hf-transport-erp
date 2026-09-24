/**
 * Workbook / sheet catalogue for the Excel-style shell.
 *
 * Every screen the ERP has ever had is reachable here as a "sheet":
 *   - kind:"entity"    -> editable spreadsheet grid (EntitySheet + /api/entities)
 *   - kind:"component" -> an existing rich screen mounted as-is
 *   - kind:"embed"     -> one tab body of the legacy EnterpriseDashboard
 *
 * Role visibility reuses the same permission matrix as the old sidebar.
 */
import type { Resource } from "../../lib/rbac.ts";
import {
  Truck,
  BookOpen,
  Briefcase,
  UsersRound,
  Droplet,
  Wrench,
  Globe,
  BarChart3,
  ShieldCheck,
} from "lucide-react";

export type SheetKind = "entity" | "component" | "embed";

export interface SheetDef {
  id: string;
  label: string;
  kind: SheetKind;
  /** entity key for kind:"entity" */
  entityKey?: string;
  /** component id for kind:"component" (resolved in WorkbookShell) */
  component?: string;
  /** legacy tab id for kind:"embed" */
  tab?: string;
  /** RBAC resource gate; omitted = visible to any approved user */
  resource?: Resource;
  /** hide the per-sheet import/export control */
  noImport?: boolean;
}

export interface WorkbookDef {
  id: string;
  label: string;
  icon: any;
  sheets: SheetDef[];
}

const e = (id: string, label: string, entityKey: string, resource?: Resource, noImport?: boolean): SheetDef => ({
  id,
  label,
  kind: "entity",
  entityKey,
  resource,
  noImport,
});
const c = (id: string, label: string, component: string, resource?: Resource): SheetDef => ({
  id,
  label,
  kind: "component",
  component,
  resource,
});
const b = (id: string, label: string, tab: string, resource?: Resource): SheetDef => ({
  id,
  label,
  kind: "embed",
  tab,
  resource,
});

export const WORKBOOKS: WorkbookDef[] = [
  {
    id: "fleet",
    label: "Fleet",
    icon: Truck,
    // Truck Search (full profile + Setup Import) first — the one place people
    // land to look something up or bring in Excel data. Then asset value,
    // then the individual master-data sheets, then GPS (trackers + map
    // combined), then Dispatch last.
    sheets: [
      c("compliance", "Truck Search (Full Profile)", "FleetSearch", "vehicles"),
      c("asset_value", "Fleet Asset Value", "FleetAssetValue", "vehicles"),
      e("vehicles", "Vehicles", "vehicles", "vehicles"),
      e("drivers", "Drivers", "drivers", "drivers"),
      e("routes", "Routes", "routes", "routes"),
      e("contractors", "Carriers / Customers", "contractors", "contractors"),
      e("trips", "Trips", "trips", "dispatch"),
      c("gps", "GPS Tracking", "GpsTracking", "dispatch"),
      c("dispatch", "Dispatch Board", "SmartDispatch", "dispatch"),
    ],
  },
  {
    id: "khata",
    label: "Khata",
    icon: BookOpen,
    // Overview first (the whole khata at a glance), then the natural
    // reading order: which trucks, which parties, each one's ledger, who's
    // owed/owing, then lookup. The old "raw" grids are gone — driver-name
    // editing and entry-level fixes now live inside Truck Ledgers itself.
    sheets: [
      c("overview", "Overview", "KhataOverview", "finance"),
      c("truck_ledgers", "Truck Ledgers", "TruckLedgers", "finance"),
      e("party_list", "Parties List", "parties", "finance"),
      c("parties", "Party Ledgers", "Parties", "finance"),
      c("dues", "Dues & Alerts", "DuesAlerts", "finance"),
      c("receipt_search", "Receipt Search", "ReceiptSearch", "finance"),
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: Briefcase,
    // Order requested directly by the client: overview/setup, daily cash,
    // partners, personal, zakat, reports, then the sales docs (invoice/
    // quotation) and purchases, GL internals last. Invoices and Quotations
    // already build "new" + line-item detail inline (no separate tabs
    // needed); Bills/Payments/Expenses share one sheet; Cash Closings folds
    // into Daily Cash Book.
    sheets: [
      c("overview", "Overview", "FinanceOverview", "finance"),
      c("company_profile", "Company Profile (Letterhead)", "CompanyProfile", "settings"),
      c("cash_book", "Daily Cash Book", "CashBook", "finance"),
      c("partners", "Partners", "Partners", "finance"),
      c("partner_pnl", "Partner P&L", "PartnerPnL", "finance"),
      c("personal", "Personal & Household", "PersonalExpenses", "finance"),
      c("zakat", "Zakat", "Zakat", "finance"),
      c("monthly", "Monthly Report", "MonthlyReport", "finance"),
      c("invoices", "Invoices", "InvoicesList", "finance"),
      c("quotations", "Quotations", "QuotationsList", "finance"),
      c("bills_payments_expenses", "Bills / Payments / Expenses", "BillsPaymentsExpenses", "finance"),
      e("bank_accounts", "Bank Accounts (Accounting)", "bank_accounts", "finance"),
      e("accounts", "Chart of Accounts", "accounts", "finance"),
      e("journal_entries", "Journal Entries", "journal_entries", "finance"),
      e("journal_lines", "Journal Lines (raw)", "journal_lines", "finance"),
    ],
  },
  {
    id: "hr",
    label: "HR & Payroll",
    icon: UsersRound,
    // Org setup (departments/designations/shifts feed the Employees dropdowns)
    // before Employees, then day-to-day HR, then recruitment/training last.
    sheets: [
      c("overview", "Overview", "HRMSDashboard", "hrms"),
      e("departments", "Departments", "departments", "hrms"),
      e("designations", "Designations", "designations", "hrms"),
      e("shifts", "Shifts", "shifts", "hrms"),
      e("employees", "Employees", "employees", "hrms"),
      e("attendance", "Attendance", "attendance", "hrms"),
      e("leaves", "Leaves", "leaves", "hrms"),
      e("payrolls", "Payroll", "payrolls", "payroll"),
      e("driver_performances", "Driver Performance", "driver_performances", "hrms"),
      e("staff_performances", "Staff Performance", "staff_performances", "hrms"),
      e("recruitment_jobs", "Recruitment Jobs", "recruitment_jobs", "hrms"),
      e("recruitment_applicants", "Applicants", "recruitment_applicants", "hrms"),
      e("trainings", "Trainings", "trainings", "hrms"),
    ],
  },
  {
    id: "fuel",
    label: "Fuel",
    icon: Droplet,
    // Master data (stations/vendors/cards/tanks) first, then day-to-day
    // transactions, then budgets and the two analysis/audit views last.
    sheets: [
      c("overview", "Overview", "FuelIntelligence", "fuel"),
      e("fuel_stations", "Stations", "fuel_stations", "fuel"),
      e("fuel_vendors", "Vendors", "fuel_vendors", "fuel"),
      e("fuel_cards", "Cards", "fuel_cards", "fuel"),
      e("fuel_tanks", "Tanks", "fuel_tanks", "fuel"),
      e("fuel_transactions", "Transactions", "fuel_transactions", "fuel"),
      e("fuel_issue_slips", "Issue Slips", "fuel_issue_slips", "fuel"),
      e("fuel_budgets", "Budgets", "fuel_budgets", "fuel"),
      c("trip_fuel", "Trip Fuel History", "TripFuelHistory", "fuel"),
      c("theft", "Fuel Theft Audit", "FuelTheftAudit", "fuel"),
    ],
  },
  {
    id: "workshop",
    label: "Workshop",
    icon: Wrench,
    // Who does the work (workshops/mechanics) first, then the work itself
    // (maintenance/schedules/job cards/parts), then breakdowns & reminders.
    sheets: [
      c("overview", "Overview", "FleetMaintenance", "maintenance"),
      e("workshops", "Workshops", "workshops", "maintenance"),
      e("mechanics", "Mechanics", "mechanics", "maintenance"),
      e("vehicle_maintenance", "Maintenance", "vehicle_maintenance", "maintenance"),
      e("service_schedules", "Service Schedules", "service_schedules", "maintenance"),
      e("job_cards", "Job Cards", "job_cards", "maintenance"),
      e("spare_parts_usage", "Spare Parts", "spare_parts_usage", "maintenance"),
      e("tyre_management", "Tyres", "tyre_management", "maintenance"),
      e("battery_management", "Batteries", "battery_management", "maintenance"),
      e("breakdown_management", "Breakdowns", "breakdown_management", "maintenance"),
      e("maintenance_reminders", "Reminders", "maintenance_reminders", "maintenance"),
    ],
  },
  {
    id: "portals",
    label: "Portals",
    icon: Globe,
    sheets: [
      c("customer", "Customer Portal", "CustomerPortal", "contractors"),
      c("vendor", "Vendor Portal", "VendorPortal", "contractors"),
    ],
  },
  {
    id: "insights",
    label: "Insights",
    icon: BarChart3,
    sheets: [
      b("dashboard", "Dashboard", "dashboard"),
      c("alerts", "Alerts", "AlertsCenter"),
      c("bi", "Executive BI", "ExecutiveBI", "reports"),
      c("ai", "AI Assistant", "AIAssistant", "ai"),
    ],
  },
  {
    id: "console",
    label: "Console",
    icon: ShieldCheck,
    // Access/identity first, then org setup, then the two external
    // integrations (GPS, SMS) with their logs right after each, then data
    // tools, then automation/dev, then comms & docs, then system ops last.
    sheets: [
      b("settings", "Users & RBAC", "settings", "settings"),
      e("branches", "Branches", "branches", "settings"),
      e("system_settings", "System Settings", "system_settings", "settings"),
      c("gps_provider", "GPS Provider", "GpsProviderSettings", "settings"),
      c("sms_gateway", "SMS Gateway", "SmsGatewaySettings", "settings"),
      e("sms_logs", "SMS Log", "sms_logs", "settings"),
      c("data_portal", "Data Import / Export", "DataPortal", "settings"),
      e("saved_reports", "Saved Reports", "saved_reports", "reports"),
      e("workflows", "Workflows", "workflows", "settings"),
      e("scheduler_jobs", "Scheduler Jobs", "scheduler_jobs", "settings"),
      e("api_keys", "API Keys", "api_keys", "settings"),
      e("webhooks", "Webhooks", "webhooks", "settings"),
      b("files", "Files (DMS)", "files", "documents"),
      b("notifications", "Notifications", "notifications"),
      b("chat", "Staff Chat", "chat", "chat"),
      b("health", "System Health", "health", "health"),
      b("backups", "Backups (legacy)", "backups", "backups"),
      c("system_reset", "System Reset & Backups", "SystemReset", "settings"),
    ],
  },
];
