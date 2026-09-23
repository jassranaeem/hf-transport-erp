/**
 * Domain registry for the Import / Export engine.
 *
 * HOW TO ADD A NEW IMPORTABLE TABLE
 * --------------------------------
 * 1. import the drizzle table from ../../db/schema.ts
 * 2. push a new EntitySpec onto ENTITIES with its business columns
 * 3. mark the natural-key column(s) with `naturalKey: true`
 * 4. for foreign keys use `ref: { entity: "<otherKey>" }` and put the other
 *    table's natural key value in the cell (composite keys are written
 *    "value1 | value2")
 * That's it - templates, validation, dropdowns, export and upsert all work.
 */
import * as schema from "../../db/schema.ts";
import type { EntitySpec } from "./types.ts";
import { autoEntity } from "./introspect.ts";

const STATUS_ACTIVE = ["Active", "Suspended", "Inactive"] as const;

const V = { vehicleId: { entity: "vehicles" } };
const VD = { vehicleId: { entity: "vehicles" }, driverId: { entity: "drivers" } };
const EMP = { employeeId: { entity: "employees" } };

/**
 * Auto-derived specs for every remaining business table. Column labels, types
 * and enums are introspected from the Drizzle schema; only foreign keys and the
 * natural key are hinted here. Hand-written specs above win on key collision.
 */
const AUTO_ENTITIES: EntitySpec[] = [
  // ---- Finance ----
  autoEntity("bank_accounts", "Bank Accounts", schema.bankAccounts, { resource: "finance", naturalKey: "accountNumber" }),
  autoEntity("bills", "Bills / Payables", schema.bills, { resource: "finance", refs: { vehicleId: { entity: "vehicles" }, driverId: { entity: "drivers" }, contractorId: { entity: "contractors" } } }),
  autoEntity("payments", "Payments", schema.payments, { resource: "finance", refs: { contractorId: { entity: "contractors" } } }),
  autoEntity("quotations", "Quotations", schema.quotations, { resource: "finance", naturalKey: "quotationNumber", refs: { contractorId: { entity: "contractors" }, convertedInvoiceId: { entity: "invoices" } } }),
  autoEntity("invoice_payments", "Invoice Payments", schema.invoicePayments, { resource: "finance", refs: { invoiceId: { entity: "invoices" } } }),
  autoEntity("invoice_lines", "Invoice Lines", schema.invoiceLines, { resource: "finance", refs: { invoiceId: { entity: "invoices" } } }),
  autoEntity("journal_entries", "Journal Entries", schema.journalEntries, { resource: "finance" }),
  autoEntity("journal_lines", "Journal Lines", schema.journalLines, { resource: "finance" }),
  autoEntity("cash_closings", "Cash Closings", schema.cashClosings, { resource: "finance" }),
  autoEntity("personal_expenses", "Personal / Household Expenses", schema.personalExpenses, { resource: "finance", refs: { bankAccountId: { entity: "bank_accounts" } } }),
  autoEntity("zakat_payments", "Zakat", schema.zakatPayments, { resource: "finance", refs: { bankAccountId: { entity: "bank_accounts" } } }),
  autoEntity("cash_transactions", "Daily Cash Book", schema.cashTransactions, { resource: "finance" }),
  autoEntity("fiscal_years", "Fiscal Years", schema.fiscalYears, { resource: "finance" }),
  autoEntity("accounting_periods", "Accounting Periods", schema.accountingPeriods, { resource: "finance" }),
  autoEntity("company_profile", "Company Profile", schema.companyProfile, { resource: "settings" }),
  autoEntity("truck_ledgers", "Truck Ledgers (Khata)", schema.truckLedgers, { resource: "finance", naturalKey: "registration", refs: V }),

  // ---- Partnerships ----
  autoEntity("partners", "Partners", schema.partners, { resource: "finance", naturalKey: "name" }),
  autoEntity("partner_agreements", "Partner Agreements", schema.partnerAgreements, { resource: "finance", refs: { partnerId: { entity: "partners" }, vehicleId: { entity: "vehicles" } } }),
  autoEntity("partner_settlements", "Partner Settlements", schema.partnerSettlements, { resource: "finance", refs: { partnerId: { entity: "partners" }, vehicleId: { entity: "vehicles" } } }),

  // ---- HR & Payroll ----
  autoEntity("departments", "Departments", schema.departments, { resource: "hrms", naturalKey: "name" }),
  autoEntity("designations", "Designations", schema.designations, { resource: "hrms", naturalKey: "title" }),
  autoEntity("teams", "Teams", schema.teams, { resource: "hrms", naturalKey: "name" }),
  autoEntity("shifts", "Shifts", schema.shifts, { resource: "hrms", naturalKey: "name" }),
  autoEntity("attendance", "Attendance", schema.attendance, { resource: "hrms", refs: EMP }),
  autoEntity("leaves", "Leaves", schema.leaves, { resource: "hrms", refs: EMP }),
  autoEntity("payrolls", "Payrolls", schema.payrolls, { resource: "payroll", refs: EMP }),
  autoEntity("driver_performances", "Driver Performance", schema.driverPerformances, { resource: "hrms", refs: { driverId: { entity: "drivers" } } }),
  autoEntity("staff_performances", "Staff Performance", schema.staffPerformances, { resource: "hrms", refs: EMP }),
  autoEntity("recruitment_jobs", "Recruitment Jobs", schema.recruitmentJobs, { resource: "hrms" }),
  autoEntity("recruitment_applicants", "Recruitment Applicants", schema.recruitmentApplicants, { resource: "hrms" }),
  autoEntity("trainings", "Trainings", schema.trainings, { resource: "hrms" }),
  autoEntity("employee_trainings", "Employee Trainings", schema.employeeTrainings, { resource: "hrms", refs: EMP }),
  autoEntity("employee_documents", "Employee Documents", schema.employeeDocuments, { resource: "hrms", refs: EMP }),

  // ---- Workshop / Maintenance ----
  autoEntity("workshops", "Workshops", schema.workshops, { resource: "maintenance", naturalKey: "workshopName" }),
  autoEntity("mechanics", "Mechanics", schema.mechanics, { resource: "maintenance", refs: EMP }),
  autoEntity("vehicle_maintenance", "Vehicle Maintenance", schema.vehicleMaintenance, { resource: "maintenance", refs: { vehicleId: { entity: "vehicles" }, workshopId: { entity: "workshops" }, mechanicId: { entity: "mechanics" } } }),
  autoEntity("service_schedules", "Service Schedules", schema.serviceSchedules, { resource: "maintenance", refs: V }),
  autoEntity("tyre_management", "Tyres", schema.tyreManagement, { resource: "maintenance", refs: V }),
  autoEntity("battery_management", "Batteries", schema.batteryManagement, { resource: "maintenance", refs: V }),
  autoEntity("job_cards", "Job Cards", schema.jobCards, { resource: "maintenance", refs: { vehicleId: { entity: "vehicles" }, mechanicId: { entity: "mechanics" } } }),
  autoEntity("spare_parts_usage", "Spare Parts Usage", schema.sparePartsUsage, { resource: "maintenance", refs: { vehicleId: { entity: "vehicles" }, mechanicId: { entity: "mechanics" } } }),
  autoEntity("maintenance_reminders", "Maintenance Reminders", schema.maintenanceReminders, { resource: "maintenance", refs: V }),
  autoEntity("breakdown_management", "Breakdowns", schema.breakdownManagement, { resource: "maintenance", refs: { vehicleId: { entity: "vehicles" }, driverId: { entity: "drivers" }, mechanicId: { entity: "mechanics" } } }),
  autoEntity("predictive_maintenance", "Predictive Maintenance", schema.predictiveMaintenance, { resource: "maintenance", refs: V }),

  // ---- Fuel ----
  autoEntity("fuel_stations", "Fuel Stations", schema.fuelStations, { resource: "fuel", naturalKey: "stationCode" }),
  autoEntity("fuel_vendors", "Fuel Vendors", schema.fuelVendors, { resource: "fuel", naturalKey: "vendorCode" }),
  autoEntity("fuel_cards", "Fuel Cards", schema.fuelCards, { resource: "fuel", naturalKey: "cardNumber", refs: VD }),
  autoEntity("fuel_tanks", "Fuel Tanks", schema.fuelTanks, { resource: "fuel" }),
  autoEntity("fuel_issue_slips", "Fuel Issue Slips", schema.fuelIssueSlips, { resource: "fuel", refs: VD }),
  autoEntity("fuel_budgets", "Fuel Budgets", schema.fuelBudgets, { resource: "fuel" }),
  autoEntity("fuel_forecasts", "Fuel Forecasts", schema.fuelForecasts, { resource: "fuel", refs: VD }),
  autoEntity("fuel_alerts", "Fuel Alerts", schema.fuelAlerts, { resource: "fuel", refs: VD }),

  // ---- Fleet / Tracking ----
  autoEntity("tracker_devices", "GPS Tracker Devices", schema.trackerDevices, { resource: "vehicles", naturalKey: "imei", refs: V }),

  // ---- Governance ----
  autoEntity("system_settings", "System Settings", schema.systemSettings, { resource: "settings", naturalKey: "key" }),
  autoEntity("workflows", "Workflows", schema.workflows, { resource: "settings" }),
  autoEntity("scheduler_jobs", "Scheduler Jobs", schema.schedulerJobs, { resource: "settings" }),
  autoEntity("api_keys", "API Keys", schema.apiKeys, { resource: "settings", readonly: ["keyHash"] }),
  autoEntity("webhooks", "Webhooks", schema.webhooks, { resource: "settings" }),
  autoEntity("saved_reports", "Saved Reports", schema.savedReports, { resource: "reports" }),
  autoEntity("notifications", "Notifications", schema.notifications, { resource: "settings" }),
  autoEntity("sms_logs", "SMS Log", schema.smsLogs, { resource: "settings", noSoftDelete: true, readonly: ["status", "provider", "providerRef", "error", "sentAt"] }),
  autoEntity("fuel_alerts", "Fuel Theft Alerts", schema.fuelAlerts, { resource: "fuel", refs: { vehicleId: { entity: "vehicles" }, driverId: { entity: "drivers" } } }),
];

export const ENTITIES: EntitySpec[] = [
  {
    key: "branches",
    label: "Branches",
    description: "Company branches / offices",
    table: schema.branches,
    softDelete: true,
    resource: "settings",
    fields: [
      { column: "Name", field: "name", type: "string", required: true },
      { column: "Code", field: "code", type: "string", required: true, naturalKey: true, note: "Unique short code, e.g. LHR" },
      { column: "Address", field: "address", type: "string" },
      { column: "Phone", field: "phone", type: "string" },
    ],
  },

  {
    key: "accounts",
    label: "Chart of Accounts",
    description: "General-ledger accounts",
    table: schema.accounts,
    softDelete: true,
    resource: "finance",
    fields: [
      { column: "Code", field: "code", type: "string", required: true, naturalKey: true, example: "5001" },
      { column: "Name", field: "name", type: "string", required: true, example: "Fuel Expense" },
      { column: "Type", field: "type", type: "enum", required: true, enumValues: ["Asset", "Liability", "Equity", "Income", "Expense"] },
      { column: "Category", field: "category", type: "string", required: true, note: "Cash, Bank, Accounts Receivable, Fuel, Salary, Revenue, ..." },
      { column: "Active", field: "isActive", type: "boolean", default: true },
      { column: "Description", field: "description", type: "string" },
    ],
  },

  {
    key: "routes",
    label: "Routes / Corridors",
    description: "Transport corridors with benchmarks",
    table: schema.routes,
    softDelete: true,
    resource: "routes",
    fields: [
      { column: "Origin", field: "origin", type: "string", required: true, naturalKey: true, example: "Karachi" },
      { column: "Destination", field: "destination", type: "string", required: true, naturalKey: true, example: "Lahore" },
      { column: "Distance (km)", field: "distance", type: "int", required: true, example: 1200 },
      { column: "Expected Hours", field: "expectedHours", type: "int", required: true, example: 22 },
      { column: "Benchmark Fuel (L)", field: "benchmarkFuel", type: "int", required: true, example: 380 },
      { column: "Expected Toll", field: "expectedToll", type: "int", required: true, example: 6500 },
      { column: "Revenue", field: "revenue", type: "int", required: true, example: 240000 },
      { column: "Average Speed", field: "averageSpeed", type: "int", default: 60 },
      { column: "Allowed Speed", field: "allowedSpeed", type: "int", default: 80 },
      { column: "Risk Level", field: "riskLevel", type: "enum", enumValues: ["Low", "Medium", "High"], default: "Low" },
      { column: "Status", field: "status", type: "enum", enumValues: ["Active", "Suspended", "Under Construction"], default: "Active" },
    ],
  },

  {
    key: "vehicles",
    label: "Vehicles / Fleet",
    description: "Trucks and trailers",
    table: schema.vehicles,
    softDelete: true,
    resource: "vehicles",
    fields: [
      { column: "Vehicle Number", field: "vehicleNumber", type: "string", required: true, naturalKey: true, example: "LES-1234" },
      { column: "Registration Number", field: "registrationNumber", type: "string", required: true },
      { column: "Engine Number", field: "engineNumber", type: "string", required: true },
      { column: "Chassis Number", field: "chassisNumber", type: "string", required: true },
      { column: "Vehicle Type", field: "vehicleType", type: "string", required: true, note: "Flatbed, Containerized, Reefer, ..." },
      { column: "Truck Brand", field: "truckBrand", type: "string", required: true, example: "Hino" },
      { column: "Model", field: "model", type: "string", required: true },
      { column: "Year", field: "year", type: "int", required: true, example: 2021 },
      { column: "Container Type", field: "containerType", type: "string", required: true, example: "40ft" },
      { column: "Payload Capacity (kg)", field: "payloadCapacity", type: "int", required: true, example: 25000 },
      { column: "Fuel Type", field: "fuelType", type: "string", default: "Diesel" },
      { column: "Current Odometer", field: "currentOdometer", type: "int", required: true },
      { column: "GPS Device IMEI", field: "gpsDeviceImei", type: "string", note: "IMEI of the hardware tracker fitted to this vehicle" },
      { column: "Insurance Number", field: "insuranceNumber", type: "string" },
      { column: "Insurance Expiry", field: "insuranceExpiry", type: "date" },
      { column: "Fitness Expiry", field: "fitnessExpiry", type: "date" },
      { column: "Ownership Status", field: "ownershipStatus", type: "enum", enumValues: ["Owned", "Leased", "Third-Party"], default: "Owned" },
      { column: "Current Status", field: "currentStatus", type: "enum", enumValues: ["Available", "Active", "Maintenance", "Out of Service"], default: "Available" },
      { column: "Purchase Date", field: "purchaseDate", type: "date", note: "When this truck was bought" },
      { column: "Purchase Cost (PKR)", field: "purchaseCost", type: "int", note: "What was paid for it" },
      { column: "Current Market Value (PKR)", field: "currentAssetValue", type: "int", note: "Today's resale/market worth — drives the Fleet Asset Value total" },
      { column: "Depreciation %", field: "depreciationPercent", type: "int" },
    ],
  },

  {
    key: "drivers",
    label: "Drivers",
    description: "Driver master data",
    table: schema.drivers,
    softDelete: true,
    resource: "drivers",
    fields: [
      { column: "Driver Name", field: "driverName", type: "string", required: true },
      { column: "CNIC", field: "cnic", type: "string", required: true, naturalKey: true, example: "35202-1234567-1" },
      { column: "License Number", field: "licenseNumber", type: "string", required: true },
      { column: "License Expiry", field: "licenseExpiry", type: "date", required: true },
      { column: "Mobile", field: "mobile", type: "string", required: true, example: "+923001234567" },
      { column: "Emergency Contact", field: "emergencyContact", type: "string" },
      { column: "Address", field: "address", type: "string" },
      { column: "Blood Group", field: "bloodGroup", type: "string" },
      { column: "Joining Date", field: "joiningDate", type: "date" },
      { column: "Salary", field: "salary", type: "int", required: true },
      { column: "Allowance", field: "allowance", type: "int", default: 0 },
      { column: "Experience (years)", field: "experienceYears", type: "int", default: 0 },
      { column: "Status", field: "status", type: "enum", enumValues: ["Available", "On Trip", "Suspended", "Leave", "Terminated"], default: "Available" },
      { column: "Medical Expiry", field: "medicalExpiry", type: "date" },
    ],
  },

  {
    key: "contractors",
    label: "Contractors / Customers",
    description: "Contracting companies and clients",
    table: schema.contractors,
    softDelete: true,
    resource: "contractors",
    fields: [
      { column: "Company", field: "company", type: "string", required: true, naturalKey: true },
      { column: "Contact Person", field: "contactPerson", type: "string" },
      { column: "Phone", field: "phone", type: "string" },
      { column: "Email", field: "email", type: "string" },
      { column: "NTN", field: "ntn", type: "string" },
      { column: "STRN", field: "strn", type: "string" },
      { column: "Address", field: "address", type: "string" },
      { column: "Credit Limit", field: "creditLimit", type: "int", default: 0 },
      { column: "Outstanding Balance", field: "outstandingBalance", type: "int", default: 0 },
      { column: "Payment Terms", field: "paymentTerms", type: "string", default: "Net 30", note: "Net 15, Net 30, Cash, ..." },
      { column: "Contract Start", field: "contractStart", type: "date" },
      { column: "Contract End", field: "contractEnd", type: "date" },
      { column: "Notes", field: "notes", type: "string" },
      { column: "Status", field: "status", type: "enum", enumValues: STATUS_ACTIVE, default: "Active" },
    ],
  },

  {
    key: "employees",
    label: "Employees (HR)",
    description: "HR employee records",
    table: schema.employees,
    softDelete: true,
    resource: "hr",
    fields: [
      { column: "Employee Code", field: "employeeCode", type: "string", required: true, naturalKey: true, example: "EMP-2026-0001" },
      { column: "Full Name", field: "fullName", type: "string", required: true },
      { column: "Father Name", field: "fatherName", type: "string", required: true },
      { column: "CNIC", field: "cnic", type: "string", required: true },
      { column: "Passport", field: "passport", type: "string" },
      { column: "Nationality", field: "nationality", type: "string", default: "Pakistani" },
      { column: "Gender", field: "gender", type: "enum", required: true, enumValues: ["Male", "Female", "Other"] },
      { column: "Date of Birth", field: "dob", type: "date", required: true },
      { column: "Marital Status", field: "maritalStatus", type: "enum", enumValues: ["Single", "Married", "Divorced"], default: "Single" },
      { column: "Blood Group", field: "bloodGroup", type: "string" },
      { column: "Address", field: "address", type: "string", required: true },
      { column: "City", field: "city", type: "string", required: true },
      { column: "Province", field: "province", type: "string", required: true },
      { column: "Country", field: "country", type: "string", default: "Pakistan" },
      { column: "Phone", field: "phone", type: "string", required: true },
      { column: "Email", field: "email", type: "string", required: true },
      { column: "Emergency Contact", field: "emergencyContact", type: "string", required: true },
      { column: "Qualification", field: "qualification", type: "string", required: true },
      { column: "Experience", field: "experience", type: "string" },
      { column: "Branch", field: "branchId", type: "string", ref: { entity: "branches" }, note: "Branch code" },
      { column: "Joining Date", field: "joiningDate", type: "date" },
      { column: "Employment Type", field: "employmentType", type: "enum", enumValues: ["Full-time", "Part-time", "Contract", "Daily Wage"], default: "Full-time" },
      { column: "Status", field: "status", type: "enum", enumValues: ["Active", "Terminated", "Resigned", "Suspended"], default: "Active" },
      { column: "Basic Salary", field: "basicSalary", type: "int", default: 0 },
      { column: "Fuel Allowance", field: "fuelAllowance", type: "int", default: 0 },
      { column: "Other Allowances", field: "otherAllowances", type: "int", default: 0 },
      { column: "Bank Name", field: "bankName", type: "string" },
      { column: "Bank Account", field: "bankAccount", type: "string" },
      { column: "Tax Number", field: "taxNumber", type: "string" },
    ],
  },

  {
    key: "trips",
    label: "Trips",
    description: "Dispatched trips (for historical data migration)",
    table: schema.trips,
    softDelete: true,
    resource: "trips",
    fields: [
      { column: "Trip Number", field: "tripNumber", type: "string", required: true, naturalKey: true, example: "TRIP-2026-0001" },
      { column: "Vehicle Number", field: "vehicleId", type: "string", required: true, ref: { entity: "vehicles" } },
      { column: "Driver CNIC", field: "driverId", type: "string", required: true, ref: { entity: "drivers" } },
      { column: "Route (Origin | Destination)", field: "routeId", type: "string", required: true, ref: { entity: "routes" }, note: 'Write as "Karachi | Lahore"' },
      { column: "Contractor Company", field: "contractorId", type: "string", required: true, ref: { entity: "contractors" } },
      { column: "Departure Time", field: "departureTime", type: "datetime", required: true },
      { column: "Actual Departure Time", field: "actualDepartureTime", type: "datetime" },
      { column: "Actual Arrival Time", field: "actualArrivalTime", type: "datetime" },
      { column: "Revenue", field: "revenue", type: "int", required: true },
      { column: "Distance", field: "distance", type: "int", required: true },
      { column: "ETA Hours", field: "etaHours", type: "int", required: true },
      { column: "Fuel Benchmark", field: "fuelBenchmark", type: "int", required: true },
      { column: "Expected Profit", field: "expectedProfit", type: "int", required: true },
      { column: "Expected Arrival", field: "expectedArrival", type: "datetime", required: true },
      { column: "Expected Fuel", field: "expectedFuel", type: "int", required: true },
      { column: "Status", field: "status", type: "enum", enumValues: ["Scheduled", "Started", "In Transit", "Arrived", "Completed"], default: "Scheduled" },
    ],
  },

  {
    key: "fuel_transactions",
    label: "Fuel Transactions",
    description: "Fuel fill-ups and card transactions",
    table: schema.fuelTransactions,
    softDelete: true,
    resource: "fuel",
    fields: [
      { column: "Transaction Number", field: "transactionNumber", type: "string", required: true, naturalKey: true },
      { column: "Vehicle Number", field: "vehicleId", type: "string", ref: { entity: "vehicles" } },
      { column: "Driver CNIC", field: "driverId", type: "string", ref: { entity: "drivers" } },
      {
        column: "Trip",
        field: "tripId",
        type: "string",
        ref: { entity: "trips" },
        note: "Which trip this fill-up was for — without this, Trip Fuel History and the Fuel Theft Audit can't attribute the litres to any trip.",
      },
      { column: "Transaction Date", field: "transactionDate", type: "datetime" },
      { column: "Invoice Number", field: "invoiceNumber", type: "string" },
      { column: "Litres", field: "litres", type: "decimal", required: true },
      { column: "Rate", field: "rate", type: "decimal", required: true },
      { column: "Subtotal", field: "subtotal", type: "int", required: true },
      { column: "GST", field: "gst", type: "int", default: 0 },
      { column: "Total", field: "total", type: "int", required: true },
      { column: "Odometer", field: "odometer", type: "int", required: true },
      { column: "Payment Type", field: "paymentType", type: "enum", required: true, enumValues: ["Cash", "Card", "Credit", "Bank"] },
    ],
  },

  {
    key: "expenses",
    label: "Expenses",
    description: "Operational expenses",
    table: schema.expenses,
    softDelete: true,
    resource: "finance",
    fields: [
      { column: "Expense Number", field: "expenseNumber", type: "string", required: true, naturalKey: true },
      { column: "Trip Number", field: "tripId", type: "string", ref: { entity: "trips" } },
      { column: "Vehicle Number", field: "vehicleId", type: "string", ref: { entity: "vehicles" } },
      { column: "Driver CNIC", field: "driverId", type: "string", ref: { entity: "drivers" } },
      { column: "Contractor Company", field: "contractorId", type: "string", ref: { entity: "contractors" } },
      { column: "Department", field: "department", type: "string" },
      { column: "Expense Type", field: "expenseType", type: "string", required: true, note: "Fuel, Maintenance, Tyres, Salary, Hotel, Toll, Repairs, ..." },
      { column: "Amount", field: "amount", type: "int", required: true },
      { column: "Expense Date", field: "expenseDate", type: "date" },
      { column: "Payment Method", field: "paymentMethod", type: "enum", enumValues: ["Cash", "Bank Transfer", "Card", "Cheque"], default: "Cash" },
      { column: "Status", field: "status", type: "enum", enumValues: ["Pending Approval", "Approved", "Paid", "Rejected"], default: "Pending Approval" },
      { column: "Notes", field: "notes", type: "string" },
    ],
  },

  {
    key: "invoices",
    label: "Invoices",
    description: "Customer invoices",
    table: schema.invoices,
    softDelete: true,
    resource: "finance",
    fields: [
      { column: "Invoice Number", field: "invoiceNumber", type: "string", required: true, naturalKey: true },
      { column: "Trip Number", field: "tripId", type: "string", ref: { entity: "trips" }, note: "optional — manual invoices have no trip" },
      { column: "Contractor Company", field: "contractorId", type: "string", required: true, ref: { entity: "contractors" } },
      { column: "Invoice Date", field: "invoiceDate", type: "date" },
      { column: "Due Date", field: "dueDate", type: "date", required: true },
      { column: "Subtotal", field: "subtotal", type: "int", required: true },
      { column: "Tax Amount", field: "taxAmount", type: "int", default: 0 },
      { column: "Total Amount", field: "totalAmount", type: "int", required: true },
      { column: "Paid Amount", field: "paidAmount", type: "int", default: 0 },
      { column: "Outstanding Balance", field: "outstandingBalance", type: "int", required: true },
      { column: "Status", field: "status", type: "enum", enumValues: ["Unpaid", "Partially Paid", "Paid", "Overdue"], default: "Unpaid" },
    ],
  },

  {
    key: "parties",
    label: "Parties (Khata)",
    description: "Business relationships — customers, suppliers, lenders, borrowers, transporters, agents, banks",
    table: schema.parties,
    softDelete: true,
    resource: "finance",
    fields: [
      { column: "Party Code", field: "partyCode", type: "string", required: true, naturalKey: true, example: "PTY-0001" },
      { column: "Name", field: "name", type: "string", required: true },
      { column: "Type", field: "type", type: "enum", enumValues: ["Customer", "Supplier", "Lender", "Borrower", "Transporter", "Agent", "Broker", "Bank", "Other"], default: "Other" },
      { column: "Phone", field: "phone", type: "string" },
      { column: "Address", field: "address", type: "string" },
      { column: "City", field: "city", type: "string" },
      { column: "NTN", field: "ntn", type: "string" },
      { column: "STRN", field: "strn", type: "string" },
      { column: "Bank Name", field: "bankName", type: "string" },
      { column: "Bank Account Title", field: "bankAccountTitle", type: "string" },
      { column: "Bank Account No", field: "bankAccountNo", type: "string" },
      { column: "IBAN", field: "iban", type: "string" },
      { column: "Opening Balance", field: "openingBalance", type: "int", default: 0, note: "signed — +ve = party owes us, -ve = we owe party" },
      { column: "Notes", field: "notes", type: "string" },
      { column: "Status", field: "status", type: "enum", enumValues: ["Active", "Inactive", "Blocked"], default: "Active" },
    ],
  },

  {
    key: "party_ledger_entries",
    label: "Party Ledger Entries",
    description: "Running khata rows for a party (naam / jama)",
    table: schema.partyLedgerEntries,
    softDelete: true,
    resource: "finance",
    fields: [
      { column: "Party Code", field: "partyId", type: "string", required: true, ref: { entity: "parties" }, note: "the Party Code this entry belongs to" },
      { column: "SR No", field: "srNo", type: "int" },
      { column: "Date", field: "entryDate", type: "date" },
      { column: "Description", field: "description", type: "string" },
      { column: "Ref No", field: "refNo", type: "string", note: "bilty / cheque / invoice no." },
      { column: "Method", field: "method", type: "string", note: "Cash, Online, Cheque, Adjustment, ..." },
      { column: "Debit (Naam)", field: "debit", type: "int", default: 0, note: "party ko diya / party par charha" },
      { column: "Credit (Jama)", field: "credit", type: "int", default: 0, note: "party se mila" },
      { column: "Category", field: "category", type: "string", default: "Other" },
      { column: "Section", field: "sectionLabel", type: "string" },
      { column: "Needs Review", field: "needsReview", type: "boolean", default: false },
    ],
  },

  {
    key: "truck_ledger_entries",
    label: "Truck Ledger Entries",
    description: "Running per-truck cash ledger (khata) rows",
    table: schema.truckLedgerEntries,
    softDelete: true,
    resource: "finance",
    fields: [
      { column: "Ledger ID", field: "ledgerId", type: "int", required: true, note: "id of the truck_ledgers row this entry belongs to" },
      { column: "SR No", field: "srNo", type: "int" },
      { column: "Date", field: "entryDate", type: "date" },
      { column: "Raw Date", field: "rawDate", type: "string", note: "verbatim date text from the source" },
      { column: "Method", field: "method", type: "string", note: "Cash, Online, Diesel, Tuman, Carnet, ..." },
      { column: "Party From", field: "partyFrom", type: "string" },
      { column: "Party To", field: "partyTo", type: "string" },
      { column: "Description", field: "description", type: "string" },
      { column: "Received", field: "received", type: "int", default: 0 },
      { column: "Paid", field: "paid", type: "int", default: 0 },
      { column: "Category", field: "category", type: "string", default: "Other", note: "Freight, Diesel, TripCash, Tyre, Visa, Carnet, TomanFX, PartsBill, Garage, Salary, Battery, Insurance, MobilOil, Permit, OnlineTransfer, Capital, SafiBachat, Other" },
      { column: "Section", field: "sectionLabel", type: "string" },
      { column: "Route From", field: "routeFrom", type: "string" },
      { column: "Route To", field: "routeTo", type: "string" },
      { column: "Cargo", field: "cargo", type: "string" },
      { column: "Needs Review", field: "needsReview", type: "boolean", default: false },
    ],
  },
];

// hand-written specs win; auto specs fill in every other table
for (const auto of AUTO_ENTITIES) {
  if (!ENTITIES.some((e) => e.key === auto.key)) ENTITIES.push(auto);
}

export function getEntity(key: string): EntitySpec | undefined {
  return ENTITIES.find((e) => e.key === key);
}

export function listEntities() {
  return ENTITIES.map((e) => ({
    key: e.key,
    label: e.label,
    description: e.description,
    resource: e.resource,
    columns: e.fields.map((f) => ({
      column: f.column,
      required: !!f.required,
      type: f.type,
      enumValues: f.enumValues ?? null,
      isRef: !!f.ref,
      naturalKey: !!f.naturalKey,
      note: f.note ?? null,
    })),
  }));
}
