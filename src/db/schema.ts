import { pgTable, serial, text, timestamp, boolean, integer, jsonb, index, numeric, uniqueIndex, customType } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------
// USERS TABLE
// ---------------------------------------------------------
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  uid: text("uid").notNull().unique(), // internal auth id (uuid for password users, google:<sub> for Google)
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"), // bcrypt hash; null for Google-only accounts
  authProvider: text("auth_provider").notNull().default("password"), // password | google
  requestedRole: text("requested_role"), // role the user asked for at sign-up; admin approves it
  name: text("name"),
  role: text("role").notNull().default("Pending"), // Roles: Super Admin, Admin, Operations Manager, Dispatcher, Accountant, Fleet Manager, HR Manager, Driver, Viewer, Pending
  phone: text("phone"),
  department: text("department"),
  status: text("status").notNull().default("Pending Approval"), // Pending Approval, Approved, Rejected, Disabled
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  lastLoginAt: timestamp("last_login_at"),
  createdBy: integer("created_by"), // References users.id (self-referential, set nullable to avoid cycle blocks)
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// Users self-relations
export const usersRelations = relations(users, ({ one, many }) => ({
  creator: one(users, {
    fields: [users.createdBy],
    references: [users.id],
    relationName: "user_creator",
  }),
  updater: one(users, {
    fields: [users.updatedBy],
    references: [users.id],
    relationName: "user_updater",
  }),
  deleter: one(users, {
    fields: [users.deletedBy],
    references: [users.id],
    relationName: "user_deleter",
  }),
  auditLogs: many(auditLogs, { relationName: "audit_performed_by" }),
}));

// ---------------------------------------------------------
// AUDIT LOGS TABLE
// ---------------------------------------------------------
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(), // CREATE, UPDATE, DELETE, LOGIN, LOGOUT, ROLE_CHANGE
  tableName: text("table_name"),
  recordId: integer("record_id"),
  oldValues: jsonb("old_values"),
  newValues: jsonb("new_values"),
  performedBy: integer("performed_by").references(() => users.id),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    performedByIdx: index("audit_performed_by_idx").on(table.performedBy),
    actionIdx: index("audit_action_idx").on(table.action),
    tableNameIdx: index("audit_table_name_idx").on(table.tableName),
  };
});

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  performer: one(users, {
    fields: [auditLogs.performedBy],
    references: [users.id],
    relationName: "audit_performed_by",
  }),
}));

// ---------------------------------------------------------
// BRANCHES TABLE
// ---------------------------------------------------------
export const branches = pgTable("branches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  address: text("address"),
  phone: text("phone"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// SYSTEM SETTINGS TABLE
// ---------------------------------------------------------
export const systemSettings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// FILES TABLE
// ---------------------------------------------------------
export const files = pgTable("files", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  mimeType: text("mime_type"),
  size: integer("size"),
  path: text("path").notNull(),
  category: text("category").notNull(), // Driver License, CNIC, Vehicle Registration, Insurance, Fitness Certificate, Invoice, etc.
  version: integer("version").notNull().default(1),
  parentId: integer("parent_id"), // Self-referencing for history/version control

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// NOTIFICATIONS TABLE
// ---------------------------------------------------------
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  type: text("type").notNull(), // Information, Warning, Critical, Emergency, Maintenance, Finance, etc.
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false).notNull(),
  readAt: timestamp("read_at"),
  channel: text("channel").default("all").notNull(), // in-app, email, whatsapp, all

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    userIdIdx: index("notif_user_id_idx").on(table.userId),
    isReadIdx: index("notif_is_read_idx").on(table.isRead),
  };
});

// ---------------------------------------------------------
// CHAT ROOMS TABLE
// ---------------------------------------------------------
export const chatRooms = pgTable("chat_rooms", {
  id: serial("id").primaryKey(),
  name: text("name"),
  type: text("type").default("group").notNull(), // one-to-one, group
  module: text("module"), // Operations, Dispatch, Finance, HR, Fleet, Admin

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// CHAT ROOM PARTICIPANTS TABLE
// ---------------------------------------------------------
export const chatRoomParticipants = pgTable("chat_room_participants", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").references(() => chatRooms.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    roomUserIdx: index("chat_room_user_idx").on(table.roomId, table.userId),
  };
});

// ---------------------------------------------------------
// CHAT MESSAGES TABLE
// ---------------------------------------------------------
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").references(() => chatRooms.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  message: text("message"),
  fileId: integer("file_id").references(() => files.id),
  isRead: boolean("is_read").default(false).notNull(),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    roomIdIdx: index("chat_msg_room_id_idx").on(table.roomId),
  };
});

// ---------------------------------------------------------
// SYSTEM LOGS TABLE
// ---------------------------------------------------------
export const systemLogs = pgTable("system_logs", {
  id: serial("id").primaryKey(),
  module: text("module").notNull(),
  action: text("action").notNull(),
  message: text("message").notNull(),
  meta: jsonb("meta"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// ERROR LOGS TABLE
// ---------------------------------------------------------
export const errorLogs = pgTable("error_logs", {
  id: serial("id").primaryKey(),
  errorMessage: text("error_message").notNull(),
  stackTrace: text("stack_trace"),
  severity: text("severity").default("low").notNull(), // low, medium, high, critical
  requestPath: text("request_path"),
  requestMethod: text("request_method"),
  requestBody: jsonb("request_body"),
  userId: integer("user_id"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// SECURITY LOGS TABLE
// ---------------------------------------------------------
export const securityLogs = pgTable("security_logs", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(), // FAILED_LOGIN, REJECTED_JWT, etc.
  description: text("description").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: integer("user_id"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// API LOGS TABLE
// ---------------------------------------------------------
export const apiLogs = pgTable("api_logs", {
  id: serial("id").primaryKey(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code").notNull(),
  executionTimeMs: integer("execution_time_ms").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: integer("user_id"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    pathIdx: index("api_log_path_idx").on(table.path),
  };
});

// ---------------------------------------------------------
// JOB LOGS TABLE
// ---------------------------------------------------------
export const jobLogs = pgTable("job_logs", {
  id: serial("id").primaryKey(),
  queueName: text("queue_name").notNull(),
  jobId: text("job_id").notNull(),
  jobName: text("job_name").notNull(),
  status: text("status").notNull(), // COMPLETED, FAILED
  durationMs: integer("duration_ms"),
  attempts: integer("attempts"),
  error: text("error"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// BACKUPS TABLE
// ---------------------------------------------------------
export const backups = pgTable("backups", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  status: text("status").notNull(), // SUCCESS, FAILED
  verified: boolean("verified").default(false).notNull(),
  error: text("error"),
  // Real snapshot payload: { [tableName]: row[] } for every table at backup
  // time. Populated by real backups (server/system_reset.ts); null on the
  // older simulated/demo rows this table used to hold (not restorable).
  dataJson: jsonb("data_json"),
  // "manual" | "pre-reset" - what triggered this backup
  kind: text("kind").default("manual").notNull(),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// VEHICLES TABLE
// ---------------------------------------------------------
export const vehicles = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  vehicleNumber: text("vehicle_number").notNull().unique(), // e.g. LES-1234
  registrationNumber: text("registration_number").notNull(),
  engineNumber: text("engine_number").notNull(),
  chassisNumber: text("chassis_number").notNull(),
  vehicleType: text("vehicle_type").notNull(), // Flatbed, Containerized, Reefer, etc.
  truckBrand: text("truck_brand").notNull(), // Hino, Volvo, Isuzu, etc.
  model: text("model").notNull(),
  year: integer("year").notNull(),
  containerType: text("container_type").notNull(), // 20ft, 40ft, etc.
  payloadCapacity: integer("payload_capacity").notNull(), // In kg
  fuelType: text("fuel_type").notNull().default("Diesel"),
  currentOdometer: integer("current_odometer").notNull(),
  gpsDeviceImei: text("gps_device_imei").unique(),
  insuranceNumber: text("insurance_number"),
  insuranceExpiry: timestamp("insurance_expiry"),
  fitnessCertificate: text("fitness_certificate"),
  fitnessExpiry: timestamp("fitness_expiry"),
  ownershipStatus: text("ownership_status").notNull().default("Owned"), // Owned, Leased, Third-Party
  purchaseDate: timestamp("purchase_date"),
  purchaseCost: integer("purchase_cost"),
  currentAssetValue: integer("current_asset_value"),
  depreciationPercent: integer("depreciation_percent"),
  currentBranchId: integer("current_branch_id").references(() => branches.id),
  currentStatus: text("current_status").notNull().default("Available"), // Available, Active, Maintenance, Out of Service
  photoUrl: text("photo_url"),
  qrCode: text("qr_code"),
  barcode: text("barcode"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    vehicleNumberIdx: index("vehicle_number_idx").on(table.vehicleNumber),
    gpsImeiIdx: index("vehicle_gps_imei_idx").on(table.gpsDeviceImei),
  };
});

// ---------------------------------------------------------
// ROUTES TABLE
// ---------------------------------------------------------
export const routes = pgTable("routes", {
  id: serial("id").primaryKey(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  distance: integer("distance").notNull(), // In km
  expectedHours: integer("expected_hours").notNull(),
  benchmarkFuel: integer("benchmark_fuel").notNull(), // In liters
  expectedToll: integer("expected_toll").notNull(), // In PKR/currency
  revenue: integer("revenue").notNull(), // In PKR/currency
  averageSpeed: integer("average_speed").notNull().default(60), // In km/h
  allowedSpeed: integer("allowed_speed").notNull().default(80), // In km/h
  riskLevel: text("risk_level").notNull().default("Low"), // Low, Medium, High
  geofenceOrigin: jsonb("geofence_origin"), // {lat: number, lng: number, radius: number}
  geofenceDestination: jsonb("geofence_destination"), // {lat: number, lng: number, radius: number}
  mapPolyline: text("map_polyline"), // Encoded map polyline or coordinates array
  status: text("status").notNull().default("Active"), // Active, Suspended, Under Construction

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    routeOriginDestIdx: index("route_origin_dest_idx").on(table.origin, table.destination),
  };
});

// ---------------------------------------------------------
// DRIVERS TABLE
// ---------------------------------------------------------
export const drivers = pgTable("drivers", {
  id: serial("id").primaryKey(),
  driverName: text("driver_name").notNull(),
  photoUrl: text("photo_url"),
  cnic: text("cnic").notNull().unique(), // CNIC with unique check
  licenseNumber: text("license_number").notNull().unique(),
  licenseExpiry: timestamp("license_expiry").notNull(),
  mobile: text("mobile").notNull(),
  emergencyContact: text("emergency_contact"),
  address: text("address"),
  bloodGroup: text("blood_group"),
  joiningDate: timestamp("joining_date").defaultNow().notNull(),
  salary: integer("salary").notNull(),
  allowance: integer("allowance").notNull().default(0),
  experienceYears: integer("experience_years").notNull().default(0),
  status: text("status").notNull().default("Available"), // Available, On Trip, Suspended, Leave, Terminated
  assignedVehicleId: integer("assigned_vehicle_id").references(() => vehicles.id),
  assignedRouteId: integer("assigned_route_id").references(() => routes.id),
  performanceRating: text("performance_rating").default("5.0"), // Rating 0.0 to 5.0
  violationCount: integer("violation_count").default(0).notNull(),
  medicalExpiry: timestamp("medical_expiry"),
  smsAlerts: boolean("sms_alerts").default(false).notNull(), // notify this driver by SMS on ledger entries

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    driverCnicIdx: index("driver_cnic_idx").on(table.cnic),
    driverLicenseIdx: index("driver_license_idx").on(table.licenseNumber),
  };
});

// ---------------------------------------------------------
// CONTRACTORS TABLE
// ---------------------------------------------------------
export const contractors = pgTable("contractors", {
  id: serial("id").primaryKey(),
  company: text("company").notNull().unique(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email").unique(),
  ntn: text("ntn").unique(), // National Tax Number
  strn: text("strn").unique(), // Sales Tax Registration Number
  address: text("address"),
  creditLimit: integer("credit_limit").notNull().default(0),
  outstandingBalance: integer("outstanding_balance").notNull().default(0),
  paymentTerms: text("payment_terms").notNull().default("Net 30"), // Net 15, Net 30, Cash, etc.
  contractStart: timestamp("contract_start"),
  contractEnd: timestamp("contract_end"),
  activeRoutes: jsonb("active_routes"), // Array of routeIds
  notes: text("notes"),
  status: text("status").notNull().default("Active"), // Active, Suspended, Inactive

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    contractorCompanyIdx: index("contractor_company_idx").on(table.company),
    contractorNtnIdx: index("contractor_ntn_idx").on(table.ntn),
  };
});

// ---------------------------------------------------------
// TRIPS TABLE
// ---------------------------------------------------------
export const trips = pgTable("trips", {
  id: serial("id").primaryKey(),
  tripNumber: text("trip_number").notNull().unique(), // e.g., TRIP-2026-0001
  vehicleId: integer("vehicle_id").references(() => vehicles.id).notNull(),
  driverId: integer("driver_id").references(() => drivers.id).notNull(),
  routeId: integer("route_id").references(() => routes.id).notNull(),
  contractorId: integer("contractor_id").references(() => contractors.id).notNull(),
  
  departureTime: timestamp("departure_time").notNull(),
  actualDepartureTime: timestamp("actual_departure_time"),
  actualArrivalTime: timestamp("actual_arrival_time"),
  
  // Auto calculated fields
  revenue: integer("revenue").notNull(),
  distance: integer("distance").notNull(),
  etaHours: integer("eta_hours").notNull(),
  fuelBenchmark: integer("fuel_benchmark").notNull(),
  expectedProfit: integer("expected_profit").notNull(),
  expectedArrival: timestamp("expected_arrival").notNull(),
  expectedFuel: integer("expected_fuel").notNull(),
  // one journey can have several legs (empty run out, loaded run back): legs point at the first leg
  parentTripId: integer("parent_trip_id"),
  legNo: integer("leg_no").default(1).notNull(),
  cargo: text("cargo"), // blank = empty run
  
  // Real-time tracking / state fields
  status: text("status").notNull().default("Scheduled"), // Scheduled -> Started -> In Transit -> Arrived -> Completed
  currentLat: text("current_lat"),
  currentLng: text("current_lng"),
  currentSpeed: integer("current_speed").default(0).notNull(),
  delayHours: integer("delay_hours").default(0).notNull(),
  currentAddress: text("current_address"),
  remainingDistance: integer("remaining_distance"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    tripNumberIdx: index("trip_number_idx").on(table.tripNumber),
    tripStatusIdx: index("trip_status_idx").on(table.status),
  };
});

// ---------------------------------------------------------
// FISCAL YEARS TABLE
// ---------------------------------------------------------
export const fiscalYears = pgTable("fiscal_years", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g. "FY2026"
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  status: text("status").notNull().default("Open"), // Open, Closed
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// ACCOUNTING PERIODS TABLE
// ---------------------------------------------------------
export const accountingPeriods = pgTable("accounting_periods", {
  id: serial("id").primaryKey(),
  fiscalYearId: integer("fiscal_year_id").references(() => fiscalYears.id).notNull(),
  name: text("name").notNull(), // e.g. "June 2026"
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  status: text("status").notNull().default("Open"), // Open, Closed

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// CHART OF ACCOUNTS TABLE
// ---------------------------------------------------------
export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // e.g., "1001", "5001"
  name: text("name").notNull(), // e.g., "Cash", "Fuel Expense"
  type: text("type").notNull(), // Asset, Liability, Equity, Income, Expense
  category: text("category").notNull(), // Cash, Bank, Accounts Receivable, Accounts Payable, Fuel, Salary, Maintenance, Toll, Insurance, Revenue, Depreciation, Equity, Miscellaneous
  isActive: boolean("is_active").default(true).notNull(),
  description: text("description"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// JOURNAL ENTRIES TABLE
// ---------------------------------------------------------
export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  entryNumber: text("entry_number").notNull().unique(), // e.g. JE-2026-0001
  entryDate: timestamp("entry_date").defaultNow().notNull(),
  description: text("description").notNull(),
  sourceType: text("source_type").notNull(), // Invoice, Payment, Bill, Expense, Manual, Closing
  sourceId: integer("source_id"), // Generic reference ID
  fiscalYearId: integer("fiscal_year_id").references(() => fiscalYears.id),
  accountingPeriodId: integer("accounting_period_id").references(() => accountingPeriods.id),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// JOURNAL LINES TABLE
// ---------------------------------------------------------
export const journalLines = pgTable("journal_lines", {
  id: serial("id").primaryKey(),
  journalEntryId: integer("journal_entry_id").references(() => journalEntries.id).notNull(),
  accountId: integer("account_id").references(() => accounts.id).notNull(),
  description: text("description"),
  debit: integer("debit").default(0).notNull(), // In PKR (or cents/paisa, let's keep as standard integers, representing PKR)
  credit: integer("credit").default(0).notNull(),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// BANK ACCOUNTS TABLE
// ---------------------------------------------------------
export const bankAccounts = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  bankName: text("bank_name").notNull(),
  branchName: text("branch_name"),
  accountNumber: text("account_number").notNull(),
  iban: text("iban").notNull().unique(),
  currency: text("currency").notNull().default("PKR"),
  openingBalance: integer("opening_balance").default(0).notNull(),
  currentBalance: integer("current_balance").default(0).notNull(),
  status: text("status").notNull().default("Active"), // Active, Suspended

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// CASH CLOSINGS TABLE
// ---------------------------------------------------------
export const cashClosings = pgTable("cash_closings", {
  id: serial("id").primaryKey(),
  closingDate: timestamp("closing_date").defaultNow().notNull(),
  openingBalance: integer("opening_balance").default(0).notNull(),
  cashIn: integer("cash_in").default(0).notNull(),
  cashOut: integer("cash_out").default(0).notNull(),
  closingBalance: integer("closing_balance").default(0).notNull(),
  declaredBalance: integer("declared_balance").default(0).notNull(),
  discrepancy: integer("discrepancy").default(0).notNull(),
  status: text("status").notNull().default("Draft"), // Draft, Approved
  approvedBy: integer("approved_by").references(() => users.id),
  notes: text("notes"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// INVOICES TABLE
// ---------------------------------------------------------
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(), // e.g. INV-2026-0001
  tripId: integer("trip_id").references(() => trips.id), // nullable: manual invoices have no trip
  contractorId: integer("contractor_id").references(() => contractors.id).notNull(),
  invoiceDate: timestamp("invoice_date").defaultNow().notNull(),
  dueDate: timestamp("due_date").notNull(),
  subtotal: integer("subtotal").notNull(),
  taxAmount: integer("tax_amount").notNull().default(0),
  totalAmount: integer("total_amount").notNull(),
  paidAmount: integer("paid_amount").default(0).notNull(),
  outstandingBalance: integer("outstanding_balance").notNull(),
  status: text("status").notNull().default("Unpaid"), // Unpaid, Partially Paid, Paid, Overdue
  pdfUrl: text("pdf_url"),
  paymentTerms: text("payment_terms").notNull().default("Net 30"),

  // Detailed-invoice fields
  sellerSnapshotJson: jsonb("seller_snapshot_json"), // company_profile captured at issue time
  billToSnapshotJson: jsonb("bill_to_snapshot_json"), // contractor captured at issue time
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  driverId: integer("driver_id").references(() => drivers.id),
  containerNo: text("container_no"),
  biltyNumber: text("bilty_number"),
  routeFrom: text("route_from"),
  routeTo: text("route_to"),
  borderCrossing: text("border_crossing"),
  cargoDescription: text("cargo_description"),
  cargoWeightKg: integer("cargo_weight_kg"),
  rateBasis: text("rate_basis"), // per trip, per kg, per ton, lump sum
  advanceReceived: integer("advance_received").default(0).notNull(),
  bankAccountRef: text("bank_account_ref"),
  salesTaxPercent: numeric("sales_tax_percent").default("0"),
  whtPercent: numeric("wht_percent").default("0"),
  whtAmount: integer("wht_amount").default(0).notNull(),
  notes: text("notes"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// PAYMENTS TABLE
// ---------------------------------------------------------
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  paymentNumber: text("payment_number").notNull().unique(), // e.g., PAY-2026-0001
  contractorId: integer("contractor_id").references(() => contractors.id),
  bankAccountId: integer("bank_account_id").references(() => bankAccounts.id), // Nullable if cash
  paymentDate: timestamp("payment_date").defaultNow().notNull(),
  paymentMethod: text("payment_method").notNull(), // Cash, Cheque, Bank Transfer, Online Transfer, Card
  amount: integer("amount").notNull(),
  referenceNumber: text("reference_number"),
  notes: text("notes"),
  status: text("status").notNull().default("Posted"), // Posted, Cleared, Cancelled

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// INVOICE PAYMENTS TABLE (Linked payments)
// ---------------------------------------------------------
export const invoicePayments = pgTable("invoice_payments", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").references(() => payments.id).notNull(),
  invoiceId: integer("invoice_id").references(() => invoices.id).notNull(),
  amount: integer("amount").notNull(),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// BILLS TABLE
// ---------------------------------------------------------
export const bills = pgTable("bills", {
  id: serial("id").primaryKey(),
  billNumber: text("bill_number").notNull().unique(), // e.g., BILL-2026-0001
  vendorType: text("vendor_type").notNull(), // Fuel Vendor, Repair Workshop, Tyre Supplier, Insurance Company, Contractor, Office Expense
  vendorId: integer("vendor_id"), // references contractors.id or any other vendor table (if exist) or can just be generic ID
  vendorName: text("vendor_name").notNull(),
  billDate: timestamp("bill_date").defaultNow().notNull(),
  dueDate: timestamp("due_date").notNull(),
  amount: integer("amount").notNull(),
  paidAmount: integer("paid_amount").default(0).notNull(),
  outstandingBalance: integer("outstanding_balance").notNull(),
  status: text("status").notNull().default("Unpaid"), // Unpaid, Partially Paid, Paid, Overdue
  notes: text("notes"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// EXPENSES TABLE
// ---------------------------------------------------------
export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  expenseNumber: text("expense_number").notNull().unique(), // e.g. EXP-2026-0001
  tripId: integer("trip_id").references(() => trips.id),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  driverId: integer("driver_id").references(() => drivers.id),
  contractorId: integer("contractor_id").references(() => contractors.id),
  department: text("department"),
  costCenter: text("cost_center"),
  expenseType: text("expense_type").notNull(), // Fuel, Maintenance, Tyres, Salary, Hotel, Food, Parking, Toll, Repairs, Miscellaneous
  amount: integer("amount").notNull(),
  expenseDate: timestamp("expense_date").defaultNow().notNull(),
  paymentMethod: text("payment_method").notNull().default("Cash"), // Cash, Bank Transfer, Card, Cheque
  bankAccountId: integer("bank_account_id").references(() => bankAccounts.id),
  receiptUrl: text("receipt_url"),
  status: text("status").notNull().default("Pending Approval"), // Pending Approval, Approved, Paid, Rejected
  notes: text("notes"),
  // Set when this row was auto-created from a truck-khata import (category
  // Diesel/Salary/TripCash/etc.) — lets a re-import update the same row
  // instead of creating a duplicate every time.
  sourceEntryId: integer("source_entry_id").references(() => truckLedgerEntries.id),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// HR & ORGANIZATIONAL SCHEMA (PHASE 4)
// ---------------------------------------------------------

export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  managerId: integer("manager_id"), // Refers to employees.id
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const designations = pgTable("designations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  grade: text("grade").notNull().default("Junior"), // Junior, Senior, Executive, Lead, C-Level
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  departmentId: integer("department_id").references(() => departments.id),
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // Morning, Evening, Night, Rotating, Driver Shift, Mechanic Shift, custom
  type: text("type").notNull().default("Regular"), // Regular, Driver, Mechanic, Custom
  startTime: text("start_time").notNull(), // e.g. "09:00"
  endTime: text("end_time").notNull(), // e.g. "17:00"
  weekendRules: text("weekend_rules").notNull().default("Sunday Only"), // e.g. "Saturday & Sunday", "Sunday Only"
  ramadanTiming: boolean("ramadan_timing").default(false).notNull(),
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  employeeCode: text("employee_code").notNull().unique(), // e.g., EMP-2026-0001
  photo: text("photo"),
  fullName: text("full_name").notNull(),
  fatherName: text("father_name"), // optional at entry — many field/daily-wage workers' full records aren't on file yet
  cnic: text("cnic"),
  passport: text("passport"),
  nationality: text("nationality").notNull().default("Pakistani"),
  gender: text("gender"), // Male, Female, Other
  dob: timestamp("dob"),
  maritalStatus: text("marital_status").notNull().default("Single"), // Single, Married, Divorced
  bloodGroup: text("blood_group"),
  address: text("address"),
  city: text("city"),
  province: text("province"),
  country: text("country").notNull().default("Pakistan"),
  phone: text("phone"),
  email: text("email"),
  emergencyContact: text("emergency_contact"),
  qualification: text("qualification"),
  experience: text("experience"), // Years or narrative
  
  departmentId: integer("department_id").references(() => departments.id),
  designationId: integer("designation_id").references(() => designations.id),
  branchId: integer("branch_id").references(() => branches.id),
  joiningDate: timestamp("joining_date").defaultNow().notNull(),
  employmentType: text("employment_type").notNull().default("Full-time"), // Full-time, Part-time, Contract, Daily Wage
  status: text("status").notNull().default("Active"), // Active, Terminated, Resigned, Suspended
  managerId: integer("manager_id"), // Self-referential
  
  // Salary and Financial
  basicSalary: integer("basic_salary").notNull().default(0),
  fuelAllowance: integer("fuel_allowance").notNull().default(0),
  otherAllowances: integer("other_allowances").notNull().default(0),
  bankName: text("bank_name"),
  bankAccount: text("bank_account"),
  taxNumber: text("tax_number"),
  
  // Dynamic features
  qrCode: text("qr_code"),
  barcode: text("barcode"),
  documentsJson: jsonb("documents_json"), // Store links
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const attendance = pgTable("attendance", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  date: timestamp("date").defaultNow().notNull(),
  clockIn: timestamp("clock_in"),
  clockOut: timestamp("clock_out"),
  latitudeIn: text("latitude_in"),
  longitudeIn: text("longitude_in"),
  latitudeOut: text("latitude_out"),
  longitudeOut: text("longitude_out"),
  status: text("status").notNull().default("Present"), // Present, Absent, Late, Half-Day, Off-Day, Leave
  earlyLeaving: boolean("early_leaving").default(false).notNull(),
  lateArrival: boolean("late_arrival").default(false).notNull(),
  breakTimeMinutes: integer("break_time_minutes").default(0).notNull(),
  overtimeMinutes: integer("overtime_minutes").default(0).notNull(),
  nightShift: boolean("night_shift").default(false).notNull(),
  correctionRequested: boolean("correction_requested").default(false).notNull(),
  correctionNotes: text("correction_notes"),
  correctionsApproved: boolean("corrections_approved").default(false).notNull(),
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const leaves = pgTable("leaves", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  leaveType: text("leave_type").notNull(), // Annual, Sick, Casual, Emergency, Maternity, Paternity, Unpaid
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("Pending"), // Pending, Approved, Rejected
  approvedBy: integer("approved_by"), // Refers to users.id
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const payrolls = pgTable("payrolls", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  payrollPeriod: text("payroll_period").notNull(), // e.g. "2026-06"
  basicSalary: integer("basic_salary").notNull().default(0),
  allowances: integer("allowances").notNull().default(0),
  fuelAllowance: integer("fuel_allowance").notNull().default(0),
  tripAllowance: integer("trip_allowance").notNull().default(0),
  bonus: integer("bonus").notNull().default(0),
  commission: integer("commission").notNull().default(0),
  overtime: integer("overtime").notNull().default(0),
  deductions: integer("deductions").notNull().default(0),
  loans: integer("loans").notNull().default(0),
  tax: integer("tax").notNull().default(0),
  eobi: integer("eobi").notNull().default(0),
  socialSecurity: integer("social_security").notNull().default(0),
  netSalary: integer("net_salary").notNull().default(0),
  status: text("status").notNull().default("Draft"), // Draft, Approved, Paid
  paymentDate: timestamp("payment_date"),
  bankTransferRef: text("bank_transfer_ref"),
  journalEntryId: integer("journal_entry_id"), // Refers to journalEntries.id
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const driverPerformances = pgTable("driver_performances", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id").notNull().references(() => drivers.id),
  period: text("period").notNull(), // e.g., "2026-06"
  fuelEfficiency: text("fuel_efficiency").notNull().default("0.0"), // Km per Liter
  onTimeDeliveryCount: integer("on_time_delivery_count").default(0).notNull(),
  totalDeliveries: integer("total_deliveries").default(0).notNull(),
  overspeedEvents: integer("overspeed_events").default(0).notNull(),
  accidentsCount: integer("accidents_count").default(0).notNull(),
  routeComplianceRate: text("route_compliance_rate").notNull().default("100"), // %
  customerRating: text("customer_rating").notNull().default("5.0"),
  monthlyRanking: integer("monthly_ranking"),
  annualRating: text("annual_rating").notNull().default("A"),
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const staffPerformances = pgTable("staff_performances", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  period: text("period").notNull(), // e.g. "2026-06"
  attendanceRate: text("attendance_rate").notNull().default("100"), // %
  taskCompletionRate: text("task_completion_rate").notNull().default("100"), // %
  reviewsJson: jsonb("reviews_json"), // Goal reviews and comments
  goalsJson: jsonb("goals_json"), // Performance goals targets
  rating: text("rating").notNull().default("Meets Expectations"), // Needs Improvement, Meets, Exceeds, Outstanding
  monthlyRanking: integer("monthly_ranking"),
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const recruitmentJobs = pgTable("recruitment_jobs", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  departmentId: integer("department_id").references(() => departments.id),
  status: text("status").notNull().default("Open"), // Open, Closed
  description: text("description"),
  requirements: text("requirements"),
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const recruitmentApplicants = pgTable("recruitment_applicants", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => recruitmentJobs.id),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  cvUrl: text("cv_url"),
  status: text("status").notNull().default("Applied"), // Applied, Screening, Interviewing, Offered, Rejected, Joined
  interviewDate: timestamp("interview_date"),
  interviewNotes: text("interview_notes"),
  offerLetterUrl: text("offer_letter_url"),
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const trainings = pgTable("trainings", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // Defensive Driving, Hazmat Handling, Cargo Safety, ISO Compliance
  description: text("description"),
  trainer: text("trainer").notNull(),
  sessionDate: timestamp("session_date").notNull(),
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const employeeTrainings = pgTable("employee_trainings", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  trainingId: integer("training_id").notNull().references(() => trainings.id),
  certificateUrl: text("certificate_url"),
  expiryDate: timestamp("expiry_date"),
  completionDate: timestamp("completion_date"),
  status: text("status").notNull().default("Enrolled"), // Enrolled, Completed, Expired, Failed
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const employeeDocuments = pgTable("employee_documents", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  docType: text("doc_type").notNull(), // CNIC, Passport, Driving License, Medical Certificate, Police Verification, Employment Contract, NDA, Offer Letter
  docNumber: text("doc_number"),
  expiryDate: timestamp("expiry_date"),
  fileUrl: text("file_url").notNull(),
  ocrData: text("ocr_data"), // Preview text/ocr metadata
  isVerified: boolean("is_verified").default(false).notNull(),
  version: integer("version").default(1).notNull(),
  
  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const workshops = pgTable("workshops", {
  id: serial("id").primaryKey(),
  workshopName: text("workshop_name").notNull(),
  location: text("location"),
  branchId: integer("branch_id").references(() => branches.id),
  manager: text("manager"),
  contact: text("contact"),
  workingHours: text("working_hours"),
  capacity: integer("capacity").default(5).notNull(),
  availableBays: integer("available_bays").default(5).notNull(),
  status: text("status").default("Active").notNull(), // Active, Inactive, Maintenance

  // Auditing
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const mechanics = pgTable("mechanics", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id),
  mechanicCode: text("mechanic_code").notNull().unique(),
  specialization: text("specialization"), // Engine, Electrical, Body, Tyres, Hydraulics, Transmission
  certification: text("certification"),
  experienceYears: integer("experience_years"),
  availability: text("availability").default("Available").notNull(), // Available, Busy, Leave
  performanceRating: numeric("performance_rating").default("5.0"),
  currentJobsCount: integer("current_jobs_count").default(0).notNull(),

  // Auditing
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const vehicleMaintenance = pgTable("vehicle_maintenance", {
  id: serial("id").primaryKey(),
  maintenanceNumber: text("maintenance_number").notNull().unique(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id),
  vehicleRegistration: text("vehicle_registration"),
  odometer: integer("odometer"),
  currentKm: integer("current_km"),
  maintenanceType: text("maintenance_type").notNull(), // Preventive, Corrective, Emergency, Breakdown, Inspection
  priority: text("priority").default("Medium").notNull(), // Low, Medium, High, Critical
  status: text("status").default("Scheduled").notNull(), // Scheduled, In_Progress, Pending_Parts, Approved, Completed, Cancelled
  workshopId: integer("workshop_id").references(() => workshops.id),
  mechanicId: integer("mechanic_id").references(() => mechanics.id),
  branchId: integer("branch_id").references(() => branches.id),
  scheduledDate: timestamp("scheduled_date"),
  dueDate: timestamp("due_date"),
  completionDate: timestamp("completion_date"),
  estimatedCost: integer("estimated_cost").default(0).notNull(),
  actualCost: integer("actual_cost").default(0).notNull(),
  downtimeHours: numeric("downtime_hours").default("0.0"),
  remarks: text("remarks"),
  // Set when this row was auto-created from a truck-khata import (category
  // Tyre/Battery/PartsBill/Garage/MobilOil) — lets a re-import update the
  // same row instead of creating a duplicate every time.
  sourceEntryId: integer("source_entry_id").references(() => truckLedgerEntries.id),

  // Auditing
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const serviceSchedules = pgTable("service_schedules", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id),
  serviceType: text("service_type").notNull(), // Oil Change, Engine Oil, Gear Oil, Transmission Oil, Differential Oil, Hydraulic Oil, Greasing, Air Filter, Fuel Filter, Cabin Filter, Brake Oil, Coolant, Radiator Flush, Wheel Alignment, Wheel Balancing, Engine Tuning, General Inspection
  currentOdometer: integer("current_odometer"),
  nextDueKm: integer("next_due_km"),
  lastServiceDate: timestamp("last_service_date"),
  nextServiceDate: timestamp("next_service_date"),
  reminderDays: integer("reminder_days"),
  reminderKm: integer("reminder_km"),

  // Auditing
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const tyreManagement = pgTable("tyre_management", {
  id: serial("id").primaryKey(),
  tyreNumber: text("tyre_number").notNull().unique(),
  tyreBrand: text("tyre_brand"),
  tyreSize: text("tyre_size"),
  tyreType: text("tyre_type"), // Tubeless, Radial, etc.
  serialNumber: text("serial_number"),
  purchaseDate: timestamp("purchase_date"),
  purchaseCost: integer("purchase_cost").default(0),
  warrantyMonths: integer("warranty_months"),
  position: text("position"), // Front Left, Front Right, Rear Left, Rear Right, Spare
  currentTreadDepth: numeric("current_tread_depth"),
  currentPsi: numeric("current_psi"),
  rotationHistory: jsonb("rotation_history"), // JSON details
  repairHistory: jsonb("repair_history"), // JSON details
  retreadCount: integer("retread_count").default(0).notNull(),
  expectedLifeKm: integer("expected_life_km"),
  currentMileage: integer("current_mileage").default(0),
  scrapStatus: text("scrap_status").default("Active").notNull(), // Active, Scrapped
  vehicleId: integer("vehicle_id").references(() => vehicles.id),

  // Auditing
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const batteryManagement = pgTable("battery_management", {
  id: serial("id").primaryKey(),
  batteryNumber: text("battery_number").notNull().unique(),
  brand: text("brand"),
  serialNumber: text("serial_number"),
  voltage: numeric("voltage"),
  cca: integer("cca"),
  installationDate: timestamp("installation_date"),
  warrantyExpiry: timestamp("warranty_expiry"),
  replacementDate: timestamp("replacement_date"),
  chargingHistory: jsonb("charging_history"), // JSON details
  healthPercent: integer("health_percent").default(100),
  currentVoltage: numeric("current_voltage"),
  status: text("status").default("Active").notNull(), // Active, Discharged, Replaced, Scrapped
  vehicleId: integer("vehicle_id").references(() => vehicles.id),

  // Auditing
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const jobCards = pgTable("job_cards", {
  id: serial("id").primaryKey(),
  jobCardNumber: text("job_card_number").notNull().unique(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id),
  mechanicId: integer("mechanic_id").references(() => mechanics.id),
  complaint: text("complaint").notNull(),
  diagnosis: text("diagnosis"),
  repairNotes: text("repair_notes"),
  labourHours: numeric("labour_hours").default("0.0"),
  partsUsed: jsonb("parts_used"), // [{partId, qty, cost}]
  status: text("status").default("Open").notNull(), // Open, In_Progress, Pending_Approval, Completed, Closed
  priority: text("priority").default("Medium").notNull(), // Low, Medium, High, Critical
  approvalStatus: text("approval_status").default("Pending").notNull(), // Pending, Approved, Rejected
  completionNotes: text("completion_notes"),

  // Auditing
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const sparePartsUsage = pgTable("spare_parts_usage", {
  id: serial("id").primaryKey(),
  partName: text("part_name").notNull(),
  quantity: integer("quantity").notNull(),
  unitCost: integer("unit_cost").notNull(),
  warehouse: text("warehouse"),
  supplier: text("supplier"),
  batchNumber: text("batch_number"),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  jobCardId: integer("job_card_id").references(() => jobCards.id),
  mechanicId: integer("mechanic_id").references(() => mechanics.id),

  // Auditing
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const maintenanceReminders = pgTable("maintenance_reminders", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id),
  reminderType: text("reminder_type").notNull(), // Oil Change, Tyres, Battery, Insurance, Fitness Certificate, Road Tax, Permit, Registration, Fire Extinguisher, GPS Device, Service Due, Brake Inspection, Air Filter, Fuel Filter
  dueDate: timestamp("due_date"),
  dueKm: integer("due_km"),
  status: text("status").default("Pending").notNull(), // Pending, Sent, Resolved, Overdue
  description: text("description"),

  // Auditing
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const breakdownManagement = pgTable("breakdown_management", {
  id: serial("id").primaryKey(),
  breakdownNumber: text("breakdown_number").notNull().unique(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id),
  driverId: integer("driver_id").references(() => drivers.id),
  tripId: integer("trip_id").references(() => trips.id),
  gpsLocation: text("gps_location"),
  reason: text("reason").notNull(),
  images: jsonb("images"),
  videos: jsonb("videos"),
  mechanicId: integer("mechanic_id").references(() => mechanics.id),
  recoveryVehicle: text("recovery_vehicle"),
  repairCost: integer("repair_cost").default(0),
  resolutionTimeMinutes: integer("resolution_time_minutes"),

  // Auditing
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const predictiveMaintenance = pgTable("predictive_maintenance", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id),
  predictedFailureType: text("predicted_failure_type").notNull(), // Engine, Battery, Tyre, Brake, Gearbox, Overheating, Suspension, Alternator, Fuel Pump
  remainingUsefulLifeKm: integer("remaining_useful_life_km"),
  failureProbabilityPercent: integer("failure_probability_percent"),
  recommendedAction: text("recommended_action"),
  estimatedCost: integer("estimated_cost").default(0),
  runAt: timestamp("run_at").defaultNow(),

  // Auditing
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ============================================================================
// PHASE 09: ENTERPRISE FUEL MANAGEMENT MODULES
// ============================================================================

// MODULE 1: Fuel Stations
export const fuelStations = pgTable("fuel_stations", {
  id: serial("id").primaryKey(),
  stationName: text("station_name").notNull(),
  company: text("company").notNull(),
  branchId: integer("branch_id").references(() => branches.id),
  gpsLocation: text("gps_location"),
  city: text("city").notNull(),
  province: text("province").notNull(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  diesel: boolean("diesel").default(true).notNull(),
  petrol: boolean("petrol").default(false).notNull(),
  adblue: boolean("adblue").default(false).notNull(),
  lng: boolean("lng").default(false).notNull(),
  cng: boolean("cng").default(false).notNull(),
  status: text("status").default("Active").notNull(), // Active, Inactive

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// MODULE 2: Fuel Vendors
export const fuelVendors = pgTable("fuel_vendors", {
  id: serial("id").primaryKey(),
  vendorName: text("vendor_name").notNull(),
  company: text("company").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  contractsJson: jsonb("contracts_json"), // Contracts details (start, end, rate, etc.)
  fuelRatesJson: jsonb("fuel_rates_json"), // { diesel: rate, petrol: rate, etc. }
  discountsJson: jsonb("discounts_json"), // discount rates per fuel type
  creditLimit: integer("credit_limit").default(0).notNull(),
  paymentTerms: text("payment_terms").default("Net 30").notNull(),
  vendorRating: numeric("vendor_rating").default("5.0").notNull(),
  outstandingBalance: integer("outstanding_balance").default(0).notNull(),
  status: text("status").default("Active").notNull(), // Active, Suspended

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// MODULE 3: Fuel Cards
export const fuelCards = pgTable("fuel_cards", {
  id: serial("id").primaryKey(),
  cardNumber: text("card_number").notNull().unique(),
  pin: text("pin").notNull(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  driverId: integer("driver_id").references(() => drivers.id),
  vendorId: integer("vendor_id").references(() => fuelVendors.id),
  dailyLimit: integer("daily_limit").default(0).notNull(),
  monthlyLimit: integer("monthly_limit").default(0).notNull(),
  currentBalance: integer("current_balance").default(0).notNull(),
  expiryDate: timestamp("expiry_date"),
  status: text("status").default("Active").notNull(), // Active, Blocked

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// MODULE 4: Fuel Transactions
export const fuelTransactions = pgTable("fuel_transactions", {
  id: serial("id").primaryKey(),
  transactionNumber: text("transaction_number").notNull().unique(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  driverId: integer("driver_id").references(() => drivers.id),
  tripId: integer("trip_id").references(() => trips.id),
  vendorId: integer("vendor_id").references(() => fuelVendors.id),
  fuelStationId: integer("fuel_station_id").references(() => fuelStations.id),
  fuelCardId: integer("fuel_card_id").references(() => fuelCards.id),
  transactionDate: timestamp("transaction_date").defaultNow().notNull(),
  invoiceNumber: text("invoice_number"),
  litres: numeric("litres").notNull(),
  rate: numeric("rate").notNull(),
  subtotal: integer("subtotal").notNull(),
  gst: integer("gst").default(0).notNull(),
  total: integer("total").notNull(),
  odometer: integer("odometer").notNull(),
  remainingFuelPercent: integer("remaining_fuel_percent").default(0).notNull(),
  paymentType: text("payment_type").notNull(), // Cash, Card, Credit, Bank
  bankAccountId: integer("bank_account_id").references(() => bankAccounts.id),
  receiptUrl: text("receipt_url"),
  geoCoordinates: text("geo_coordinates"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// MODULE 5: Tank Management (Internal Fuel Tanks)
export const fuelTanks = pgTable("fuel_tanks", {
  id: serial("id").primaryKey(),
  tankName: text("tank_name").notNull(),
  capacity: integer("capacity").notNull(),
  openingBalance: integer("opening_balance").default(0).notNull(),
  currentStock: integer("current_stock").default(0).notNull(),
  refillHistoryJson: jsonb("refill_history_json"),
  tankLevelPercent: integer("tank_level_percent").default(0).notNull(),
  leakStatus: text("leak_status").default("No Leak").notNull(), // No Leak, Warning, Leak Detected
  calibrationJson: jsonb("calibration_json"),
  branchId: integer("branch_id").references(() => branches.id),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// MODULE 6: Fuel Issue Slips (Internal Fuel Issue)
export const fuelIssueSlips = pgTable("fuel_issue_slips", {
  id: serial("id").primaryKey(),
  slipNumber: text("slip_number").notNull().unique(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  driverId: integer("driver_id").references(() => drivers.id),
  tripId: integer("trip_id").references(() => trips.id),
  fuelTankId: integer("fuel_tank_id").references(() => fuelTanks.id),
  issuedBy: integer("issued_by").references(() => users.id),
  approvedBy: integer("approved_by").references(() => users.id),
  litres: numeric("litres").notNull(),
  issueDate: timestamp("issue_date").defaultNow().notNull(),
  purpose: text("purpose").notNull(), // Trip, Backup, Local, Workshop, Shunting

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// MODULE 9: Trip Fuel Budget
export const fuelBudgets = pgTable("fuel_budgets", {
  id: serial("id").primaryKey(),
  tripId: integer("trip_id").references(() => trips.id).notNull(),
  expectedFuel: numeric("expected_fuel").notNull(),
  expectedCost: integer("expected_cost").notNull(),
  fuelAllowance: integer("fuel_allowance").notNull(),
  tripBudget: integer("trip_budget").notNull(),
  budgetVariance: integer("budget_variance").default(0).notNull(),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// MODULE 10: Fuel Forecasting
export const fuelForecasts = pgTable("fuel_forecasts", {
  id: serial("id").primaryKey(),
  targetType: text("target_type").notNull(), // Vehicle, Driver, Branch, Overall
  targetId: integer("target_id"),
  nextRefillDate: timestamp("next_refill_date"),
  predictedRequirementLitres: numeric("predicted_requirement_litres").notNull(),
  monthlyConsumptionLitres: numeric("monthly_consumption_litres").notNull(),
  accuracyScore: numeric("accuracy_score").default("1.0"),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// MODULE 8: Fuel Theft Alerts & Abuse Logs
export const fuelAlerts = pgTable("fuel_alerts", {
  id: serial("id").primaryKey(),
  alertType: text("alert_type").notNull(), // Abnormal Consumption, Fuel Drop, Repeated Refills, Night Refill, Long Idle, Fuel Without Trip, Duplicate Invoice, Card Abuse
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  driverId: integer("driver_id").references(() => drivers.id),
  tripId: integer("trip_id").references(() => trips.id),
  transactionId: integer("transaction_id").references(() => fuelTransactions.id),
  severity: text("severity").default("Medium").notNull(), // Low, Medium, High, Critical
  description: text("description").notNull(),
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by").references(() => users.id),

  // Standard enterprise auditing columns
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// MODULE 10.1: WORKFLOW ENGINE
export const workflows = pgTable("workflows", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type").notNull(), // Trip, Payroll, Maintenance, Expense
  description: text("description"),
  stepsJson: jsonb("steps_json").notNull(), // Array of steps
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const workflowApprovals = pgTable("workflow_approvals", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").references(() => workflows.id),
  targetType: text("target_type").notNull(), // Trip, Payroll, Maintenance, Expense
  targetId: integer("target_id").notNull(),
  currentStepIndex: integer("current_step_index").default(0).notNull(),
  status: text("status").default("Pending").notNull(), // Pending, Approved, Rejected, Escalated
  historyJson: jsonb("history_json").default([]).notNull(), // History of events
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// MODULE 10.2: BACKGROUND SCHEDULER
export const schedulerJobs = pgTable("scheduler_jobs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  cronExpression: text("cron_expression").notNull(),
  jobType: text("job_type").notNull(), // Report, Payroll, Invoicing, Maintenance, Backup
  payloadJson: jsonb("payload_json"),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  status: text("status").default("Idle").notNull(), // Idle, Running, Succeeded, Failed
  executionLogsJson: jsonb("execution_logs_json").default([]).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// MODULE 10.3: API MANAGEMENT & WEBHOOKS
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull().unique(),
  tokenHash: text("token_hash").notNull(),
  permissionsJson: jsonb("permissions_json").default([]).notNull(),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const webhooks = pgTable("webhooks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  eventsJson: jsonb("events_json").default([]).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const webhookLogs = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  webhookId: integer("webhook_id").references(() => webhooks.id),
  eventName: text("event_name").notNull(),
  payloadJson: jsonb("payload_json").notNull(),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  status: text("status").notNull(), // Success, Failed, Retrying
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// MODULE 10.4: SAVED REPORTS
export const savedReports = pgTable("saved_reports", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(), // Financial, Fleet, HR, Fuel, Maintenance, Custom
  format: text("format").notNull(), // CSV, Excel, PDF
  queryConfigJson: jsonb("query_config_json").notNull(),
  scheduledCron: text("scheduled_cron"),
  emailRecipientsJson: jsonb("email_recipients_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// MODULE 10.5: DYNAMIC ROLE PERMISSIONS MATRIX
export const rolePermissions = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(),
  resource: text("resource").notNull(),
  actions: jsonb("actions").default([]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ---------------------------------------------------------
// GPS / LIVE TRACKING
// ---------------------------------------------------------

// One row per physical GPS tracker (or virtual/simulator device).
export const trackerDevices = pgTable("tracker_devices", {
  id: serial("id").primaryKey(),
  imei: text("imei").notNull().unique(),
  label: text("label"),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  provider: text("provider").notNull().default("generic"), // traccar, teltonika, concox, queclink, generic, simulator
  ingestToken: text("ingest_token").notNull(), // per-device shared secret used by POST /api/tracking/ingest
  simEnabled: boolean("sim_enabled").default(false).notNull(),

  // Last confirmed fix (denormalised for fast map loads)
  // NOTE: timestamptz (unlike the rest of this codebase) so signal-age maths
  // is not corrupted by the server's local timezone.
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastLat: numeric("last_lat"),
  lastLng: numeric("last_lng"),
  lastSpeed: integer("last_speed").default(0).notNull(), // km/h
  lastHeading: integer("last_heading").default(0).notNull(), // degrees 0-359
  lastAddress: text("last_address"),
  batteryPercent: integer("battery_percent"),
  status: text("status").notNull().default("Unknown"), // Moving, Idle, Stopped, SignalLost, Unknown

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    trackerImeiIdx: index("tracker_imei_idx").on(table.imei),
    trackerVehicleIdx: index("tracker_vehicle_idx").on(table.vehicleId),
  };
});

// Append-only breadcrumb history. Buffered/backdated points are accepted and
// de-duplicated on (deviceId, recordedAt) so a tracker that lost signal can
// dump its offline log on reconnect without creating duplicates.
export const vehiclePositions = pgTable("vehicle_positions", {
  id: serial("id").primaryKey(),
  deviceId: integer("device_id").references(() => trackerDevices.id),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  tripId: integer("trip_id").references(() => trips.id),
  lat: numeric("lat").notNull(),
  lng: numeric("lng").notNull(),
  speed: integer("speed").default(0).notNull(), // km/h
  heading: integer("heading").default(0).notNull(), // degrees 0-359
  altitude: integer("altitude"),
  accuracy: integer("accuracy"), // metres
  satellites: integer("satellites"),
  ignition: boolean("ignition"),
  source: text("source").notNull().default("live"), // live, buffered, simulator, manual
  // timestamptz so ordering / dedupe / age maths are timezone-safe
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(), // device clock (can be in the past)
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(), // server clock
}, (table) => {
  return {
    vpVehicleTimeIdx: index("vp_vehicle_time_idx").on(table.vehicleId, table.recordedAt),
    vpDeviceTimeIdx: index("vp_device_time_idx").on(table.deviceId, table.recordedAt),
    vpDedupeIdx: uniqueIndex("vp_device_recorded_uniq").on(table.deviceId, table.recordedAt),
  };
});

// ---------------------------------------------------------
// PARTNERSHIPS  (company-owned trucks run by outside partners on a
// lease-to-own / hire-purchase basis: agreed price, advance, and the
// balance recovered out of each trip's net earnings)
// ---------------------------------------------------------
export const partners = pgTable("partners", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  cnic: text("cnic"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  status: text("status").notNull().default("Active"), // Active, Inactive, Blacklisted
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const partnerAgreements = pgTable("partner_agreements", {
  id: serial("id").primaryKey(),
  agreementNumber: text("agreement_number").notNull().unique(), // e.g. PA-2026-0001
  partnerId: integer("partner_id").references(() => partners.id).notNull(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id).notNull(),
  agreedPrice: integer("agreed_price").notNull(), // full sale price of the truck to the partner
  advancePaid: integer("advance_paid").notNull().default(0), // upfront down-payment
  openingBalance: integer("opening_balance").notNull(), // agreedPrice - advancePaid
  currentBalance: integer("current_balance").notNull(), // outstanding, decreases per settlement
  // % of each settlement's net earnings routed to balance recovery (default 100 = all net to company)
  companySharePercent: integer("company_share_percent").notNull().default(100),
  // healthy expense-to-revenue ratio (%); settlements above this flag possible expense inflation
  expenseRatioBenchmark: integer("expense_ratio_benchmark").notNull().default(55),
  startDate: timestamp("start_date").defaultNow().notNull(),
  closeDate: timestamp("close_date"),
  status: text("status").notNull().default("Active"), // Active, Settled, Defaulted, Suspended
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

export const partnerSettlements = pgTable("partner_settlements", {
  id: serial("id").primaryKey(),
  settlementNumber: text("settlement_number").notNull().unique(), // e.g. PS-2026-0001
  agreementId: integer("agreement_id").references(() => partnerAgreements.id).notNull(),
  tripId: integer("trip_id").references(() => trips.id), // optional link to a specific trip
  periodFrom: timestamp("period_from"),
  periodTo: timestamp("period_to"),

  grossRevenue: integer("gross_revenue").notNull(), // revenue the partner declares
  declaredExpenses: jsonb("declared_expenses"), // [{ type, amount, note }]
  totalExpenses: integer("total_expenses").notNull().default(0),
  netEarnings: integer("net_earnings").notNull(), // grossRevenue - totalExpenses
  amountToCompany: integer("amount_to_company").notNull(), // applied to currentBalance
  partnerRetained: integer("partner_retained").notNull().default(0), // net kept by partner (0 while share = 100)
  balanceBefore: integer("balance_before").notNull(),
  balanceAfter: integer("balance_after").notNull(),

  // leakage / under-reporting audit snapshot (filled by the settlement engine)
  gpsExpectedRevenue: integer("gps_expected_revenue"),
  fuelImpliedRevenue: integer("fuel_implied_revenue"),
  revenueVariancePercent: integer("revenue_variance_percent"), // (expected - declared)/expected * 100
  expenseRatioPercent: integer("expense_ratio_percent"), // totalExpenses / grossRevenue * 100
  flags: jsonb("flags"), // ["UNDER_REPORTED_REVENUE", "EXPENSE_INFLATION", ...]

  status: text("status").notNull().default("Confirmed"), // Draft, Confirmed, Disputed
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

// ---------------------------------------------------------
// COMPANY PROFILE  (single row, id = 1) — letterhead / tax / bank details
// used on invoices and other printed documents
// ---------------------------------------------------------
export const companyProfile = pgTable("company_profile", {
  id: serial("id").primaryKey(),
  legalName: text("legal_name"),
  tradeName: text("trade_name").notNull().default("HF Transport"),
  tagline: text("tagline"),
  addressLines: text("address_lines"), // multi-line, \n separated
  city: text("city"),
  country: text("country").default("Pakistan"),
  phones: jsonb("phones"), // string[]
  email: text("email"),
  website: text("website"),
  ntn: text("ntn"), // National Tax Number
  strn: text("strn"), // Sales Tax Registration Number
  logoFileId: integer("logo_file_id"),
  logoDataUrl: text("logo_data_url"), // letterhead logo inlined as a data: URL (small image)
  invoiceTerms: text("invoice_terms"), // T&C block printed on every invoice (one line = one bullet)
  invoicePrefix: text("invoice_prefix").notNull().default("INV"),
  invoiceFooterNote: text("invoice_footer_note"),
  defaultSalesTaxPercent: numeric("default_sales_tax_percent").notNull().default("13"),
  defaultWhtPercent: numeric("default_wht_percent").notNull().default("0"),
  bankAccountsJson: jsonb("bank_accounts_json"), // [{ bankName, title, accountNo, iban, branch }]
  defaultPaymentTerms: text("default_payment_terms").notNull().default("Net 30"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by"),
});

// ---------------------------------------------------------
// TRUCK LEDGERS  (the "khata" — one running cash ledger per truck, mirrors
// the customer's Excel workbook)
// ---------------------------------------------------------
export const truckLedgers = pgTable("truck_ledgers", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  registration: text("registration").notNull(), // normalised, e.g. "TLB 100"
  title: text("title").notNull(), // raw sheet name, e.g. "TLX 764 Samad khan"
  ownerName: text("owner_name"), // partner/owner extracted from the title
  // The source khata workbook has no clean "driver" column anywhere (driver
  // mentions only ever show up as free text inside an entry's description,
  // e.g. "Gadi Kharcha Driver ko") — so this is a plain editable field, not
  // something auto-extracted, for whoever currently drives this truck.
  driverName: text("driver_name"),
  driverPhone: text("driver_phone"),
  isPartnership: boolean("is_partnership").default(false).notNull(),
  partnerAgreementId: integer("partner_agreement_id").references(() => partnerAgreements.id),
  openingBalance: integer("opening_balance").default(0).notNull(),
  closingBalance: integer("closing_balance").default(0).notNull(),
  sourceSheet: text("source_sheet"),
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    truckLedgerRegIdx: index("truck_ledger_reg_idx").on(table.registration),
  };
});

export const truckLedgerEntries = pgTable("truck_ledger_entries", {
  id: serial("id").primaryKey(),
  ledgerId: integer("ledger_id").references(() => truckLedgers.id).notNull(),
  srNo: integer("sr_no"),
  entryDate: timestamp("entry_date"), // null when the source date was blank/garbage
  rawDate: text("raw_date"), // verbatim cell value
  method: text("method"), // Cash, Online, Diesel, Tyer, Tuman, Carnet, Bill, ...
  partyFrom: text("party_from"),
  partyTo: text("party_to"),
  description: text("description"),
  received: integer("received").default(0).notNull(), // money in (RACEVID / kiraya)
  paid: integer("paid").default(0).notNull(), // money out (PAYMANT)
  runningBalance: integer("running_balance").default(0).notNull(),
  sheetBalance: integer("sheet_balance"), // the BALANCE cell from the source, for reconciliation
  category: text("category").notNull().default("Other"),
  // Freight, Diesel, TripCash, Tyre, Visa, Carnet, TomanFX, PartsBill, Garage,
  // Salary, Battery, Insurance, MobilOil, Permit, OnlineTransfer, Capital,
  // SafiBachat, Other
  direction: text("direction"), // In | Out
  sectionLabel: text("section_label"),
  isSafiBachat: boolean("is_safi_bachat").default(false).notNull(),
  isReset: boolean("is_reset").default(false).notNull(),
  routeFrom: text("route_from"),
  routeTo: text("route_to"),
  cargo: text("cargo"),
  sourceRow: integer("source_row"),
  needsReview: boolean("needs_review").default(false).notNull(),
  reviewReason: text("review_reason"),
  derivedTripId: integer("derived_trip_id").references(() => trips.id),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    tleLedgerIdx: index("tle_ledger_idx").on(table.ledgerId),
    tleCategoryIdx: index("tle_category_idx").on(table.category),
  };
});

// ---------------------------------------------------------
// ATTACHMENTS  (real file uploads linked to any record in any module)
// ---------------------------------------------------------
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// File bytes live in Postgres (not on the web server disk, which is wiped on every
// redeploy / spin-down on the free host). Kept in their own table so listing
// attachments never drags the bytes along.
export const attachmentBlobs = pgTable("attachment_blobs", {
  attachmentId: integer("attachment_id").primaryKey(),
  data: bytea("data").notNull(),
});

export const attachments = pgTable("attachments", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), // trip, invoice, expense, fuel_transaction, vehicle_maintenance, vehicle, driver, contractor, partner_settlement, truck_ledger_entry, company_profile, document
  entityId: integer("entity_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  size: integer("size"),
  diskPath: text("disk_path").notNull(), // relative to the uploads dir
  sha256: text("sha256"), // content hash — used to flag the SAME receipt uploaded twice
  caption: text("caption"),
  category: text("category").default("Receipt").notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    attEntityIdx: index("att_entity_idx").on(table.entityType, table.entityId),
  };
});

// ---------------------------------------------------------
// INVOICE LINES  (detailed multi-line invoices)
// ---------------------------------------------------------
export const invoiceLines = pgTable("invoice_lines", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => invoices.id).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  description: text("description").notNull(),
  qty: numeric("qty").notNull().default("1"),
  unit: text("unit").default("trip"), // trip, kg, ton, day, lump
  rate: integer("rate").notNull().default(0),
  amount: integer("amount").notNull().default(0),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    invLineInvoiceIdx: index("inv_line_invoice_idx").on(table.invoiceId),
  };
});

// ---------------------------------------------------------
// PARTIES (KHATA)  — a running account for every business relationship:
// customers, suppliers, lenders, borrowers, transporters, agents, banks.
// Separate from `contractors` (formal invoicing) and the GL. Each party
// carries its own tax + bank details that the user fills in.
// ---------------------------------------------------------
export const parties = pgTable("parties", {
  id: serial("id").primaryKey(),
  partyCode: text("party_code").notNull().unique(), // auto PTY-0001
  name: text("name").notNull(),
  type: text("type").notNull().default("Other"),
  // Customer | Supplier | Lender | Borrower | Transporter | Agent | Broker | Bank | Other
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  ntn: text("ntn"),
  strn: text("strn"),
  bankName: text("bank_name"),
  bankAccountTitle: text("bank_account_title"),
  bankAccountNo: text("bank_account_no"),
  iban: text("iban"),
  openingBalance: integer("opening_balance").default(0).notNull(), // signed: +ve = party owes us
  closingBalance: integer("closing_balance").default(0).notNull(), // cached, recomputed
  notes: text("notes"),
  status: text("status").notNull().default("Active"), // Active | Inactive | Blocked
  smsAlerts: boolean("sms_alerts").default(false).notNull(), // SMS this party's phone on each ledger entry
  sourceSheet: text("source_sheet"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    partyNameIdx: index("party_name_idx").on(table.name),
    partyTypeIdx: index("party_type_idx").on(table.type),
  };
});

// ---------------------------------------------------------
// SMS LOG  (driver / party notifications on ledger entries)
// ---------------------------------------------------------
export const smsLogs = pgTable("sms_logs", {
  id: serial("id").primaryKey(),
  toPhone: text("to_phone").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("queued"), // queued | sent | failed | skipped(disabled)
  provider: text("provider"),
  providerRef: text("provider_ref"),
  error: text("error"),
  relatedType: text("related_type"), // party_ledger_entry | truck_ledger_entry
  relatedId: integer("related_id"),
  driverId: integer("driver_id").references(() => drivers.id),
  partyId: integer("party_id").references(() => parties.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  sentAt: timestamp("sent_at"),
  createdBy: integer("created_by"),
}, (table) => {
  return {
    smsLogRelatedIdx: index("sms_log_related_idx").on(table.relatedType, table.relatedId),
    smsLogStatusIdx: index("sms_log_status_idx").on(table.status),
  };
});

// ---------------------------------------------------------
// ALERT ACKNOWLEDGEMENTS  (dismiss / resolve an alert row)
// ---------------------------------------------------------
export const alertAcks = pgTable("alert_acks", {
  id: serial("id").primaryKey(),
  alertKey: text("alert_key").notNull().unique(), // stable hash: <type>:<entityType>:<entityId>
  alertType: text("alert_type").notNull(),
  status: text("status").notNull().default("ack"), // ack | resolved
  note: text("note"),
  actedBy: integer("acted_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const partyLedgerEntries = pgTable("party_ledger_entries", {
  id: serial("id").primaryKey(),
  partyId: integer("party_id").references(() => parties.id).notNull(),
  srNo: integer("sr_no"),
  entryDate: timestamp("entry_date"),
  rawDate: text("raw_date"),
  description: text("description"),
  refNo: text("ref_no"), // bilty / cheque / invoice no.
  method: text("method"), // Cash | Online | Cheque | Adjustment | ...
  debit: integer("debit").default(0).notNull(), // naam: party ko diya / party par charha
  credit: integer("credit").default(0).notNull(), // jama: party se mila
  runningBalance: integer("running_balance").default(0).notNull(), // recomputed = Σ(debit - credit)
  sheetBalance: integer("sheet_balance"),
  category: text("category").notNull().default("Other"),
  sectionLabel: text("section_label"),
  isReset: boolean("is_reset").default(false).notNull(),
  sourceRow: integer("source_row"),
  needsReview: boolean("needs_review").default(false).notNull(),
  reviewReason: text("review_reason"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    plePartyIdx: index("ple_party_idx").on(table.partyId),
    pleDateIdx: index("ple_date_idx").on(table.entryDate),
  };
});

// ---------------------------------------------------------
// QUOTATIONS  ("qaraya nama") — a rate quote sent to a company before any job
// exists. Same letterhead as an invoice, but it carries a validity window
// (default 10 days) and posts NOTHING to the ledgers/GL. A quotation can later
// be converted into a real invoice once the job is confirmed.
// ---------------------------------------------------------
export const quotations = pgTable("quotations", {
  id: serial("id").primaryKey(),
  quotationNumber: text("quotation_number").notNull().unique(), // QUO-2026-0001
  quotationDate: timestamp("quotation_date").defaultNow().notNull(),
  validityDays: integer("validity_days").notNull().default(10),
  validUntil: timestamp("valid_until").notNull(),
  status: text("status").notNull().default("Draft"), // Draft, Sent, Accepted, Rejected
  contractorId: integer("contractor_id").references(() => contractors.id), // optional — link once they're a real client
  clientCompany: text("client_company").notNull(),
  clientContactPerson: text("client_contact_person"),
  clientPhone: text("client_phone"),
  clientEmail: text("client_email"),
  clientAddress: text("client_address"),
  routeFrom: text("route_from"),
  routeTo: text("route_to"),
  cargoDescription: text("cargo_description"),
  cargoWeightKg: integer("cargo_weight_kg"),
  vehicleType: text("vehicle_type"), // e.g. 40ft container, 10-wheeler
  rateBasis: text("rate_basis"),
  linesJson: jsonb("lines_json").notNull(), // [{description, qty, unit, rate, amount}]
  subtotal: integer("subtotal").notNull().default(0),
  totalAmount: integer("total_amount").notNull().default(0),
  notes: text("notes"),
  sellerSnapshotJson: jsonb("seller_snapshot_json"), // letterhead/logo/bank frozen at issue
  convertedInvoiceId: integer("converted_invoice_id").references(() => invoices.id),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    quoteNumberIdx: index("quote_number_idx").on(table.quotationNumber),
    quoteValidUntilIdx: index("quote_valid_until_idx").on(table.validUntil),
  };
});

// ---------------------------------------------------------
// PERSONAL / HOUSEHOLD EXPENSES  (owner's personal book — kept out of the
// business P&L). Household kharcha, pocket money, personal spend, utilities,
// rent, medical, education … one register with category + per-person tags,
// full add / edit / delete and a monthly roll-up.
// ---------------------------------------------------------
export const personalExpenses = pgTable("personal_expenses", {
  id: serial("id").primaryKey(),
  entryDate: timestamp("entry_date").defaultNow().notNull(),
  // Household | PocketMoney | Personal | Utilities | Rent | Groceries | Medical
  // | Education | Travel | Gift | Charity | Domestic Staff | Vehicle (personal)
  // | Entertainment | Other  — also "Funds In" for money added to the house pot
  category: text("category").notNull().default("Household"),
  direction: text("direction").notNull().default("expense"), // expense | income
  person: text("person"), // family member — esp. for pocket money
  description: text("description"),
  payee: text("payee"), // shop / person paid
  amount: integer("amount").notNull().default(0), // PKR, always positive
  method: text("method").notNull().default("Cash"), // Cash | Bank | Card | Online | Cheque
  bankAccountId: integer("bank_account_id").references(() => bankAccounts.id),
  refNo: text("ref_no"),
  paidBy: text("paid_by"), // who physically paid (owner / manager / …)
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    peDateIdx: index("pe_date_idx").on(table.entryDate),
    peCategoryIdx: index("pe_category_idx").on(table.category),
    pePersonIdx: index("pe_person_idx").on(table.person),
  };
});

// Daily cash-in-hand log — itemized in/out transactions (who, how much),
// grouped into calendar days (midnight to midnight). A day's opening balance
// is just the running total of every transaction before that day started, so
// nothing needs to be manually carried forward each morning.
export const cashTransactions = pgTable("cash_transactions", {
  id: serial("id").primaryKey(),
  entryDate: timestamp("entry_date").defaultNow().notNull(),
  direction: text("direction").notNull(), // In | Out
  amount: integer("amount").notNull().default(0), // PKR, always positive
  person: text("person"), // who it came from / went to
  description: text("description"),
  notes: text("notes"),
  sourceSheet: text("source_sheet"), // set when imported, null for hand-entered rows
  sourceRow: integer("source_row"), // row number within sourceSheet - lets re-importing the same file update instead of duplicate

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    ctDateIdx: index("ct_date_idx").on(table.entryDate),
    // unique (not just indexed) so a bulk import can upsert in one statement
    // instead of one row at a time - NULLs (hand-entered rows) never conflict
    // with each other in Postgres, only two imported rows from the exact same
    // sheet+row+direction would.
    ctSourceIdx: uniqueIndex("ct_source_idx").on(table.sourceSheet, table.sourceRow, table.direction),
  };
});

// A dedicated, self-standing Zakat register — separate from Personal &
// Household Expenses on purpose. You enter what you actually paid, when, and
// to whom; the Yearly Report's 2.5%-of-wealth figure is only an estimate to
// check against — this table is the real record of what was actually given.
export const zakatPayments = pgTable("zakat_payments", {
  id: serial("id").primaryKey(),
  entryDate: timestamp("entry_date").defaultNow().notNull(),
  amount: integer("amount").notNull().default(0), // PKR, always positive
  recipient: text("recipient"), // person / family given to
  description: text("description"),
  method: text("method").notNull().default("Cash"), // Cash | Bank | Card | Online | Cheque
  bankAccountId: integer("bank_account_id").references(() => bankAccounts.id),
  refNo: text("ref_no"),
  paidBy: text("paid_by"), // who physically paid (owner / manager / …)
  notes: text("notes"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
}, (table) => {
  return {
    zpDateIdx: index("zp_date_idx").on(table.entryDate),
  };
});


