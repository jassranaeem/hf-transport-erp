import { Router, Response, NextFunction } from "express";
import { requireAuth, requirePermission, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { eq, desc, and, isNull, sql, lt, gte, or } from "drizzle-orm";
import { logAudit } from "../src/db/audit.ts";
import { SocketServer } from "../src/sockets/socket.ts";
import { createBalancedJournalEntry } from "./finance_engine.ts";
import { Resource, Action } from "../src/lib/rbac.ts";

const router = Router();

// Ensure user is authenticated before checking permissions
router.use(requireAuth);

// Router-Level Dynamic Authorization Middleware
router.use((req: AuthRequest, res: Response, next: NextFunction) => {
  const path = req.path;
  const method = req.method;

  let resource: Resource = "hrms";
  let action: Action = "read";

  if (method === "POST") action = "create";
  else if (method === "PUT" || method === "PATCH") action = "update";
  else if (method === "DELETE") action = "delete";

  if (path.startsWith("/payroll")) {
    resource = "payroll";
  } else {
    resource = "hrms";
  }

  // Delegate authorization dynamically to our core requirePermission middleware
  return requirePermission(resource, action)(req, res, next);
});

// Reusable Audit Helper
async function auditHR(
  req: AuthRequest,
  action: "CREATE" | "UPDATE" | "DELETE",
  tableName: string,
  recordId: number,
  oldValues: any,
  newValues: any
) {
  await logAudit({
    action,
    tableName,
    recordId,
    oldValues,
    newValues,
    performedBy: req.user?.id,
    ipAddress: req.ip || req.socket.remoteAddress || undefined,
    userAgent: req.headers["user-agent"] || undefined,
  });
}

// ---------------------------------------------------------
// 1. ORGANIZATIONAL UNITS & SHIFTS
// ---------------------------------------------------------

router.get("/org/departments", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select()
      .from(schema.departments)
      .where(eq(schema.departments.isDeleted, false))
      .orderBy(desc(schema.departments.createdAt));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/org/departments", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name, code, managerId } = req.body;
    const [existing] = await db
      .select()
      .from(schema.departments)
      .where(and(eq(schema.departments.code, code), eq(schema.departments.isDeleted, false)))
      .limit(1);

    if (existing) {
      return res.status(400).json({ error: "Department code already exists." });
    }

    const [inserted] = await db
      .insert(schema.departments)
      .values({
        name,
        code,
        managerId: managerId ? Number(managerId) : null,
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "departments", inserted.id, null, inserted);
    SocketServer.emit("hr_event", { type: "DEPARTMENT_CREATED", data: inserted });

    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/org/designations", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select()
      .from(schema.designations)
      .where(eq(schema.designations.isDeleted, false))
      .orderBy(desc(schema.designations.createdAt));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/org/designations", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name, grade } = req.body;
    const [inserted] = await db
      .insert(schema.designations)
      .values({
        name,
        grade: grade || "Junior",
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "designations", inserted.id, null, inserted);
    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/org/branches", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.isDeleted, false));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/org/shifts", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select()
      .from(schema.shifts)
      .where(eq(schema.shifts.isDeleted, false))
      .orderBy(desc(schema.shifts.createdAt));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/org/shifts", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name, type, startTime, endTime, weekendRules, ramadanTiming } = req.body;
    const [inserted] = await db
      .insert(schema.shifts)
      .values({
        name,
        type: type || "Regular",
        startTime,
        endTime,
        weekendRules: weekendRules || "Sunday Only",
        ramadanTiming: !!ramadanTiming,
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "shifts", inserted.id, null, inserted);
    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// 2. EMPLOYEE MASTER
// ---------------------------------------------------------

router.get("/employees", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        id: schema.employees.id,
        employeeCode: schema.employees.employeeCode,
        fullName: schema.employees.fullName,
        cnic: schema.employees.cnic,
        email: schema.employees.email,
        phone: schema.employees.phone,
        status: schema.employees.status,
        employmentType: schema.employees.employmentType,
        joiningDate: schema.employees.joiningDate,
        basicSalary: schema.employees.basicSalary,
        fuelAllowance: schema.employees.fuelAllowance,
        otherAllowances: schema.employees.otherAllowances,
        departmentId: schema.employees.departmentId,
        designationId: schema.employees.designationId,
        branchId: schema.employees.branchId,
        departmentName: schema.departments.name,
        designationName: schema.designations.name,
        branchName: schema.branches.name,
      })
      .from(schema.employees)
      .leftJoin(schema.departments, eq(schema.employees.departmentId, schema.departments.id))
      .leftJoin(schema.designations, eq(schema.employees.designationId, schema.designations.id))
      .leftJoin(schema.branches, eq(schema.employees.branchId, schema.branches.id))
      .where(eq(schema.employees.isDeleted, false))
      .orderBy(desc(schema.employees.createdAt));

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/employees/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [emp] = await db
      .select()
      .from(schema.employees)
      .where(and(eq(schema.employees.id, id), eq(schema.employees.isDeleted, false)))
      .limit(1);

    if (!emp) {
      return res.status(404).json({ error: "Employee not found." });
    }
    res.json(emp);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/employees", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const payload = req.body;
    
    // Auto generate Employee Code
    const year = new Date().getFullYear();
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.employees);
    const codeSeq = String(count + 1).padStart(4, "0");
    const employeeCode = `EMP-${year}-${codeSeq}`;

    // Barcode & QR Code generators placeholders
    const barcode = `BAR-${employeeCode}`;
    const qrCode = `QR-${employeeCode}`;

    const [inserted] = await db
      .insert(schema.employees)
      .values({
        employeeCode,
        fullName: payload.fullName,
        fatherName: payload.fatherName,
        cnic: payload.cnic,
        passport: payload.passport,
        nationality: payload.nationality || "Pakistani",
        gender: payload.gender,
        dob: new Date(payload.dob),
        maritalStatus: payload.maritalStatus || "Single",
        bloodGroup: payload.bloodGroup,
        address: payload.address,
        city: payload.city,
        province: payload.province,
        country: payload.country || "Pakistan",
        phone: payload.phone,
        email: payload.email,
        emergencyContact: payload.emergencyContact,
        qualification: payload.qualification,
        experience: payload.experience,
        departmentId: payload.departmentId ? Number(payload.departmentId) : null,
        designationId: payload.designationId ? Number(payload.designationId) : null,
        branchId: payload.branchId ? Number(payload.branchId) : null,
        joiningDate: payload.joiningDate ? new Date(payload.joiningDate) : new Date(),
        employmentType: payload.employmentType || "Full-time",
        status: "Active",
        managerId: payload.managerId ? Number(payload.managerId) : null,
        basicSalary: Number(payload.basicSalary || 0),
        fuelAllowance: Number(payload.fuelAllowance || 0),
        otherAllowances: Number(payload.otherAllowances || 0),
        bankName: payload.bankName,
        bankAccount: payload.bankAccount,
        taxNumber: payload.taxNumber,
        barcode,
        qrCode,
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "employees", inserted.id, null, inserted);
    SocketServer.emit("hr_event", { type: "EMPLOYEE_CREATED", data: inserted });

    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/employees/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const payload = req.body;

    const [existing] = await db
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Employee not found." });
    }

    const [updated] = await db
      .update(schema.employees)
      .set({
        fullName: payload.fullName,
        fatherName: payload.fatherName,
        cnic: payload.cnic,
        passport: payload.passport,
        nationality: payload.nationality,
        gender: payload.gender,
        dob: payload.dob ? new Date(payload.dob) : existing.dob,
        maritalStatus: payload.maritalStatus,
        bloodGroup: payload.bloodGroup,
        address: payload.address,
        city: payload.city,
        province: payload.province,
        country: payload.country,
        phone: payload.phone,
        email: payload.email,
        emergencyContact: payload.emergencyContact,
        qualification: payload.qualification,
        experience: payload.experience,
        departmentId: payload.departmentId ? Number(payload.departmentId) : existing.departmentId,
        designationId: payload.designationId ? Number(payload.designationId) : existing.designationId,
        branchId: payload.branchId ? Number(payload.branchId) : existing.branchId,
        joiningDate: payload.joiningDate ? new Date(payload.joiningDate) : existing.joiningDate,
        employmentType: payload.employmentType,
        status: payload.status,
        managerId: payload.managerId ? Number(payload.managerId) : existing.managerId,
        basicSalary: Number(payload.basicSalary || 0),
        fuelAllowance: Number(payload.fuelAllowance || 0),
        otherAllowances: Number(payload.otherAllowances || 0),
        bankName: payload.bankName,
        bankAccount: payload.bankAccount,
        taxNumber: payload.taxNumber,
        updatedAt: new Date(),
        updatedBy: req.user?.id,
      })
      .where(eq(schema.employees.id, id))
      .returning();

    await auditHR(req, "UPDATE", "employees", id, existing, updated);
    SocketServer.emit("hr_event", { type: "EMPLOYEE_UPDATED", data: updated });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/employees/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Employee not found." });
    }

    await db
      .update(schema.employees)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user?.id,
      })
      .where(eq(schema.employees.id, id));

    await auditHR(req, "DELETE", "employees", id, existing, { isDeleted: true });
    SocketServer.emit("hr_event", { type: "EMPLOYEE_DELETED", id });

    res.json({ success: true, message: "Employee deleted successfully." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// 3. ATTENDANCE & SHIFTS LOGGING
// ---------------------------------------------------------

router.get("/attendance", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        id: schema.attendance.id,
        employeeId: schema.attendance.employeeId,
        employeeName: schema.employees.fullName,
        employeeCode: schema.employees.employeeCode,
        date: schema.attendance.date,
        clockIn: schema.attendance.clockIn,
        clockOut: schema.attendance.clockOut,
        status: schema.attendance.status,
        latitudeIn: schema.attendance.latitudeIn,
        longitudeIn: schema.attendance.longitudeIn,
        lateArrival: schema.attendance.lateArrival,
        earlyLeaving: schema.attendance.earlyLeaving,
        overtimeMinutes: schema.attendance.overtimeMinutes,
        correctionRequested: schema.attendance.correctionRequested,
        correctionNotes: schema.attendance.correctionNotes,
        correctionsApproved: schema.attendance.correctionsApproved,
      })
      .from(schema.attendance)
      .innerJoin(schema.employees, eq(schema.attendance.employeeId, schema.employees.id))
      .where(eq(schema.attendance.isDeleted, false))
      .orderBy(desc(schema.attendance.date));

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/attendance/clock-in", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId, latitude, longitude } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if already clocked in today
    const [existing] = await db
      .select()
      .from(schema.attendance)
      .where(
        and(
          eq(schema.attendance.employeeId, Number(employeeId)),
          gte(schema.attendance.date, today),
          eq(schema.attendance.isDeleted, false)
        )
      )
      .limit(1);

    if (existing) {
      return res.status(400).json({ error: "Already clocked in today." });
    }

    // Determine late arrival based on standard 9 AM rule
    const now = new Date();
    const isLate = now.getHours() >= 9 && now.getMinutes() > 15;

    const [inserted] = await db
      .insert(schema.attendance)
      .values({
        employeeId: Number(employeeId),
        date: new Date(),
        clockIn: new Date(),
        latitudeIn: latitude,
        longitudeIn: longitude,
        status: "Present",
        lateArrival: isLate,
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "attendance", inserted.id, null, inserted);
    SocketServer.emit("hr_event", { type: "ATTENDANCE_CLOCK_IN", data: inserted });

    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/attendance/clock-out", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId, latitude, longitude } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [existing] = await db
      .select()
      .from(schema.attendance)
      .where(
        and(
          eq(schema.attendance.employeeId, Number(employeeId)),
          gte(schema.attendance.date, today),
          eq(schema.attendance.isDeleted, false)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(400).json({ error: "No clock-in found for today." });
    }

    const clockOutTime = new Date();
    const isEarlyLeaving = clockOutTime.getHours() < 17; // standard 5 PM check

    // Calculate overtime minutes
    let overtimeMinutes = 0;
    if (existing.clockIn) {
      const diffMs = clockOutTime.getTime() - new Date(existing.clockIn).getTime();
      const workingHours = diffMs / (1000 * 60 * 60);
      if (workingHours > 9) { // 9 hours standard shift (including break)
        overtimeMinutes = Math.round((workingHours - 9) * 60);
      }
    }

    const [updated] = await db
      .update(schema.attendance)
      .set({
        clockOut: clockOutTime,
        latitudeOut: latitude,
        longitudeOut: longitude,
        earlyLeaving: isEarlyLeaving,
        overtimeMinutes,
        updatedAt: new Date(),
      })
      .where(eq(schema.attendance.id, existing.id))
      .returning();

    await auditHR(req, "UPDATE", "attendance", existing.id, existing, updated);
    SocketServer.emit("hr_event", { type: "ATTENDANCE_CLOCK_OUT", data: updated });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/attendance/correction", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id, notes } = req.body;
    const [existing] = await db
      .select()
      .from(schema.attendance)
      .where(eq(schema.attendance.id, Number(id)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Attendance record not found." });
    }

    const [updated] = await db
      .update(schema.attendance)
      .set({
        correctionRequested: true,
        correctionNotes: notes,
        updatedAt: new Date(),
      })
      .where(eq(schema.attendance.id, Number(id)))
      .returning();

    await auditHR(req, "UPDATE", "attendance", Number(id), existing, updated);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/attendance/correction/:id/approve", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status, overtimeMinutes } = req.body;

    const [existing] = await db
      .select()
      .from(schema.attendance)
      .where(eq(schema.attendance.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Attendance record not found." });
    }

    const [updated] = await db
      .update(schema.attendance)
      .set({
        correctionRequested: false,
        correctionsApproved: true,
        status: status || existing.status,
        overtimeMinutes: overtimeMinutes !== undefined ? Number(overtimeMinutes) : existing.overtimeMinutes,
        lateArrival: false,
        earlyLeaving: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.attendance.id, id))
      .returning();

    await auditHR(req, "UPDATE", "attendance", id, existing, updated);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/attendance/manual", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId, date, status, clockIn, clockOut } = req.body;

    const [inserted] = await db
      .insert(schema.attendance)
      .values({
        employeeId: Number(employeeId),
        date: new Date(date),
        clockIn: clockIn ? new Date(clockIn) : null,
        clockOut: clockOut ? new Date(clockOut) : null,
        status: status || "Present",
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "attendance", inserted.id, null, inserted);
    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// 4. LEAVE MANAGEMENT
// ---------------------------------------------------------

router.get("/leaves", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        id: schema.leaves.id,
        employeeId: schema.leaves.employeeId,
        employeeName: schema.employees.fullName,
        employeeCode: schema.employees.employeeCode,
        leaveType: schema.leaves.leaveType,
        startDate: schema.leaves.startDate,
        endDate: schema.leaves.endDate,
        reason: schema.leaves.reason,
        status: schema.leaves.status,
      })
      .from(schema.leaves)
      .innerJoin(schema.employees, eq(schema.leaves.employeeId, schema.employees.id))
      .where(eq(schema.leaves.isDeleted, false))
      .orderBy(desc(schema.leaves.startDate));

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/leaves", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId, leaveType, startDate, endDate, reason } = req.body;

    const [inserted] = await db
      .insert(schema.leaves)
      .values({
        employeeId: Number(employeeId),
        leaveType,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
        status: "Pending",
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "leaves", inserted.id, null, inserted);
    SocketServer.emit("hr_event", { type: "LEAVE_REQUESTED", data: inserted });

    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/leaves/:id/approve", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body; // Approved or Rejected

    const [existing] = await db
      .select()
      .from(schema.leaves)
      .where(eq(schema.leaves.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Leave application not found." });
    }

    const [updated] = await db
      .update(schema.leaves)
      .set({
        status,
        approvedBy: req.user?.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.leaves.id, id))
      .returning();

    await auditHR(req, "UPDATE", "leaves", id, existing, updated);

    // If approved, automatically insert an attendance record with status "Leave" for the days
    if (status === "Approved") {
      const start = new Date(existing.startDate);
      const end = new Date(existing.endDate);
      const dateList: Date[] = [];
      let temp = new Date(start);
      while (temp <= end) {
        dateList.push(new Date(temp));
        temp.setDate(temp.getDate() + 1);
      }

      for (const d of dateList) {
        await db.insert(schema.attendance).values({
          employeeId: existing.employeeId,
          date: d,
          status: "Leave",
          createdBy: req.user?.id,
        });
      }
    }

    SocketServer.emit("hr_event", { type: "LEAVE_STATUS_UPDATED", data: updated });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// 5. PAYROLL AUTOMATION ENGINE (PHASE 4 CENTRAL ENGINE)
// ---------------------------------------------------------

router.get("/payroll", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        id: schema.payrolls.id,
        employeeId: schema.payrolls.employeeId,
        employeeName: schema.employees.fullName,
        employeeCode: schema.employees.employeeCode,
        payrollPeriod: schema.payrolls.payrollPeriod,
        basicSalary: schema.payrolls.basicSalary,
        allowances: schema.payrolls.allowances,
        fuelAllowance: schema.payrolls.fuelAllowance,
        tripAllowance: schema.payrolls.tripAllowance,
        bonus: schema.payrolls.bonus,
        commission: schema.payrolls.commission,
        overtime: schema.payrolls.overtime,
        deductions: schema.payrolls.deductions,
        loans: schema.payrolls.loans,
        tax: schema.payrolls.tax,
        eobi: schema.payrolls.eobi,
        socialSecurity: schema.payrolls.socialSecurity,
        netSalary: schema.payrolls.netSalary,
        status: schema.payrolls.status,
        paymentDate: schema.payrolls.paymentDate,
        bankTransferRef: schema.payrolls.bankTransferRef,
        journalEntryId: schema.payrolls.journalEntryId,
      })
      .from(schema.payrolls)
      .innerJoin(schema.employees, eq(schema.payrolls.employeeId, schema.employees.id))
      .where(eq(schema.payrolls.isDeleted, false))
      .orderBy(desc(schema.payrolls.payrollPeriod));

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/payroll/calculate", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { period } = req.body; // e.g. "2026-06"
    if (!period) {
      return res.status(400).json({ error: "Payroll period is required." });
    }

    // Clear any existing Draft payroll for this period to allow re-runs
    await db
      .update(schema.payrolls)
      .set({ isDeleted: true })
      .where(and(eq(schema.payrolls.payrollPeriod, period), eq(schema.payrolls.status, "Draft")));

    // Fetch all active employees
    const activeEmployees = await db
      .select()
      .from(schema.employees)
      .where(and(eq(schema.employees.status, "Active"), eq(schema.employees.isDeleted, false)));

    const createdPayrolls = [];

    for (const emp of activeEmployees) {
      // 1. Calculate trip allowances if the employee is also listed as a driver
      // Look up driver record by CNIC or Name
      const [drv] = await db
        .select()
        .from(schema.drivers)
        .where(and(eq(schema.drivers.cnic, emp.cnic), eq(schema.drivers.isDeleted, false)))
        .limit(1);

      let tripAllowance = 0;
      let fuelBonus = 0;
      let safetyBonus = 0;
      let onTimeBonus = 0;
      let violationPenalties = 0;

      if (drv) {
        // Query completed trips for this driver in the current period
        const periodStart = new Date(`${period}-01T00:00:00`);
        const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0, 23, 59, 59);

        const driverTrips = await db
          .select()
          .from(schema.trips)
          .where(
            and(
              eq(schema.trips.driverId, drv.id),
              eq(schema.trips.status, "Completed"),
              gte(schema.trips.actualArrivalTime, periodStart),
              lt(schema.trips.actualArrivalTime, periodEnd)
            )
          );

        // Drivers get standard 5000 PKR per completed trip allowance
        tripAllowance = driverTrips.length * 5000;

        // On-time Bonus: 1500 PKR for each trip with 0 delay hours
        const onTimeTrips = driverTrips.filter((t) => t.delayHours <= 0);
        onTimeBonus = onTimeTrips.length * 1500;

        // Safe Driving Bonus: 2500 PKR if total violation count on driver profile is 0
        if (drv.violationCount === 0) {
          safetyBonus = 2500;
        } else {
          violationPenalties = drv.violationCount * 1000; // Deduct 1000 PKR per violation
        }

        // Fuel bonus: 3000 PKR standard if driver rating is high
        if (Number(drv.performanceRating || "5.0") >= 4.5) {
          fuelBonus = 3000;
        }
      }

      // 2. Calculate Overtime Hours from attendance database
      const periodStart = new Date(`${period}-01T00:00:00`);
      const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0, 23, 59, 59);

      const attendanceLogs = await db
        .select({
          overtimeMinutes: schema.attendance.overtimeMinutes,
        })
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.employeeId, emp.id),
            gte(schema.attendance.date, periodStart),
            lt(schema.attendance.date, periodEnd)
          )
        );

      const totalOTMinutes = attendanceLogs.reduce((sum, log) => sum + (log.overtimeMinutes || 0), 0);
      const otRatePerHour = Math.round((emp.basicSalary / 200) * 1.5); // Standard Overtime rate is 1.5x of hourly rate
      const overtimePay = Math.round((totalOTMinutes / 60) * otRatePerHour);

      // 3. Tax, EOBI, and Social Security deductions
      const taxRate = emp.basicSalary > 150000 ? 0.15 : emp.basicSalary > 75000 ? 0.05 : 0;
      const tax = Math.round(emp.basicSalary * taxRate);
      const eobi = 780; // Fixed EOBI standard PKR in Pakistan
      const socialSecurity = Math.round(emp.basicSalary * 0.02); // 2% social security standard

      const totalAllowances = emp.fuelAllowance + emp.otherAllowances + tripAllowance + fuelBonus + safetyBonus + onTimeBonus + overtimePay;
      const totalDeductions = tax + eobi + socialSecurity + violationPenalties;
      const netSalary = emp.basicSalary + totalAllowances - totalDeductions;

      // Insert payroll voucher
      const [pay] = await db
        .insert(schema.payrolls)
        .values({
          employeeId: emp.id,
          payrollPeriod: period,
          basicSalary: emp.basicSalary,
          allowances: emp.otherAllowances,
          fuelAllowance: emp.fuelAllowance,
          tripAllowance,
          bonus: fuelBonus + safetyBonus + onTimeBonus,
          overtime: overtimePay,
          deductions: violationPenalties,
          tax,
          eobi,
          socialSecurity,
          netSalary,
          status: "Draft",
          createdBy: req.user?.id,
        })
        .returning();

      createdPayrolls.push(pay);
    }

    SocketServer.emit("hr_event", { type: "PAYROLL_CALCULATED", period });
    res.json({ success: true, count: createdPayrolls.length, data: createdPayrolls });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// 6. ACCOUNTING LEDGER INTEGRATION (DOUBLE ENTRY POSTING)
// ---------------------------------------------------------

router.post("/payroll/post", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { period } = req.body;
    if (!period) {
      return res.status(400).json({ error: "Payroll period is required." });
    }

    // Fetch all Draft payrolls for this period
    const drafts = await db
      .select()
      .from(schema.payrolls)
      .where(and(eq(schema.payrolls.payrollPeriod, period), eq(schema.payrolls.status, "Draft"), eq(schema.payrolls.isDeleted, false)));

    if (drafts.length === 0) {
      return res.status(400).json({ error: "No Draft payrolls found for this period." });
    }

    // Calculate aggregate debit & credit amounts for double entry
    let totalGrossExpense = 0; // Debited to Salary Expense
    let totalNetPayable = 0;   // Credited to Salary Payable
    let totalTaxPayable = 0;   // Credited to Tax Liability
    let totalEobiPayable = 0;  // Credited to EOBI Payable
    let totalSspayable = 0;    // Credited to Social Security Payable

    for (const d of drafts) {
      const gross = d.basicSalary + d.allowances + d.fuelAllowance + d.tripAllowance + d.bonus + d.overtime;
      totalGrossExpense += gross;
      totalNetPayable += d.netSalary;
      totalTaxPayable += d.tax;
      totalEobiPayable += d.eobi;
      totalSspayable += d.socialSecurity + d.deductions;
    }

    // Fetch accounting periods/fiscal years & core accounts from chart of accounts
    const [salaryExpAcc] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, "5100")).limit(1); // Salary Expense
    const [salaryPayAcc] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, "2200")).limit(1); // Salary Payable
    const [taxPayAcc] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, "2100")).limit(1); // Tax Payable
    const [eobiPayAcc] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, "2300")).limit(1); // EOBI Liability

    if (!salaryExpAcc || !salaryPayAcc || !taxPayAcc || !eobiPayAcc) {
      return res.status(400).json({
        error: "Core chart of accounts must contain 5100 (Salary Expense), 2200 (Salary Payable), 2100 (Tax Liability), and 2300 (EOBI Liability).",
      });
    }

    // Post double entry journal ledger
    const journalEntry = await createBalancedJournalEntry(
      `JE-PAYROLL-${period}`,
      `Accrued Enterprise Payroll for period ${period}`,
      "Manual",
      null,
      [
        { accountId: salaryExpAcc.id, debit: totalGrossExpense, credit: 0, description: "Monthly Gross Payroll Accrual" },
        { accountId: salaryPayAcc.id, debit: 0, credit: totalNetPayable, description: "Monthly Net Salaries Payable" },
        { accountId: taxPayAcc.id, debit: 0, credit: totalTaxPayable, description: "Withholding Tax Liabilities" },
        { accountId: eobiPayAcc.id, debit: 0, credit: totalEobiPayable + totalSspayable, description: "EOBI & Social Security Liabilities" },
      ],
      { userId: req.user?.id, ipAddress: req.ip }
    );

    // Update draft payrolls to Approved & attach the journal entry ID
    for (const d of drafts) {
      await db
        .update(schema.payrolls)
        .set({
          status: "Approved",
          journalEntryId: journalEntry.journalEntry.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.payrolls.id, d.id));
    }

    SocketServer.emit("hr_event", { type: "PAYROLL_POSTED", period, journalEntryId: journalEntry.journalEntry.id });
    res.json({ success: true, message: "Payroll approved & posted to GL successfully.", journalEntry });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/payroll/pay", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { period, bankAccountId, bankTransferRef } = req.body;
    if (!period) {
      return res.status(400).json({ error: "Payroll period is required." });
    }

    // Fetch Approved payrolls
    const approved = await db
      .select()
      .from(schema.payrolls)
      .where(and(eq(schema.payrolls.payrollPeriod, period), eq(schema.payrolls.status, "Approved"), eq(schema.payrolls.isDeleted, false)));

    if (approved.length === 0) {
      return res.status(400).json({ error: "No Approved payroll vouchers found for this period to process payment." });
    }

    const totalPaid = approved.reduce((sum, p) => sum + p.netSalary, 0);

    const [salaryPayAcc] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, "2200")).limit(1); // Salary Payable
    const [bankAccount] = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, Number(bankAccountId))).limit(1);

    if (!salaryPayAcc || !bankAccount) {
      return res.status(400).json({ error: "Salary Payable (Code: 2200) account and Bank Account must exist." });
    }

    // Map bank account ledger code
    const receivingAccountCode = "1002"; // Standard HBL bank ledger
    const [bankAccLedger] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, receivingAccountCode)).limit(1);

    if (!bankAccLedger) {
      return res.status(400).json({ error: "Standard HBL Cash Ledger (Code: 1002) must exist." });
    }

    // Post Payment Journal Entry
    // Debit: Salary Payable (2200)
    // Credit: HBL Bank (1002)
    const journalEntry = await createBalancedJournalEntry(
      `JE-PAYROLL-PAY-${period}`,
      `Disbursed Net Salaries for period ${period} via bank transfer`,
      "Payment",
      null,
      [
        { accountId: salaryPayAcc.id, debit: totalPaid, credit: 0, description: "Settled Monthly Salaries Payable" },
        { accountId: bankAccLedger.id, debit: 0, credit: totalPaid, description: "Salaries payout bank deduction" },
      ],
      { userId: req.user?.id, ipAddress: req.ip }
    );

    // Deduct from bank account balance
    await db
      .update(schema.bankAccounts)
      .set({
        currentBalance: sql`${schema.bankAccounts.currentBalance} - ${totalPaid}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.bankAccounts.id, bankAccount.id));

    // Update payroll statuses to Paid
    for (const p of approved) {
      await db
        .update(schema.payrolls)
        .set({
          status: "Paid",
          paymentDate: new Date(),
          bankTransferRef: bankTransferRef || `REF-${period}-${Date.now()}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.payrolls.id, p.id));
    }

    SocketServer.emit("hr_event", { type: "PAYROLL_PAID", period, amountPaid: totalPaid });
    res.json({ success: true, message: "Payroll disbursements complete and posted to ledger.", totalPaid });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// 7. PERFORMANCE MANAGEMENT (KPIs & MONTHLY RANKINGS)
// ---------------------------------------------------------

router.get("/performance/drivers", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        id: schema.driverPerformances.id,
        driverId: schema.driverPerformances.driverId,
        driverName: schema.drivers.driverName,
        period: schema.driverPerformances.period,
        fuelEfficiency: schema.driverPerformances.fuelEfficiency,
        onTimeDeliveryCount: schema.driverPerformances.onTimeDeliveryCount,
        totalDeliveries: schema.driverPerformances.totalDeliveries,
        overspeedEvents: schema.driverPerformances.overspeedEvents,
        accidentsCount: schema.driverPerformances.accidentsCount,
        routeComplianceRate: schema.driverPerformances.routeComplianceRate,
        customerRating: schema.driverPerformances.customerRating,
        monthlyRanking: schema.driverPerformances.monthlyRanking,
        annualRating: schema.driverPerformances.annualRating,
      })
      .from(schema.driverPerformances)
      .innerJoin(schema.drivers, eq(schema.driverPerformances.driverId, schema.drivers.id))
      .where(eq(schema.driverPerformances.isDeleted, false))
      .orderBy(desc(schema.driverPerformances.period));

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/performance/drivers", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { driverId, period, fuelEfficiency, onTimeDeliveryCount, totalDeliveries, overspeedEvents, accidentsCount, routeComplianceRate, customerRating, annualRating } = req.body;
    
    const [inserted] = await db
      .insert(schema.driverPerformances)
      .values({
        driverId: Number(driverId),
        period,
        fuelEfficiency: fuelEfficiency || "0.0",
        onTimeDeliveryCount: Number(onTimeDeliveryCount || 0),
        totalDeliveries: Number(totalDeliveries || 0),
        overspeedEvents: Number(overspeedEvents || 0),
        accidentsCount: Number(accidentsCount || 0),
        routeComplianceRate: routeComplianceRate || "100",
        customerRating: customerRating || "5.0",
        annualRating: annualRating || "A",
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "driver_performances", inserted.id, null, inserted);
    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/performance/staff", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        id: schema.staffPerformances.id,
        employeeId: schema.staffPerformances.employeeId,
        employeeName: schema.employees.fullName,
        employeeCode: schema.employees.employeeCode,
        period: schema.staffPerformances.period,
        attendanceRate: schema.staffPerformances.attendanceRate,
        taskCompletionRate: schema.staffPerformances.taskCompletionRate,
        rating: schema.staffPerformances.rating,
        monthlyRanking: schema.staffPerformances.monthlyRanking,
        goalsJson: schema.staffPerformances.goalsJson,
        reviewsJson: schema.staffPerformances.reviewsJson,
      })
      .from(schema.staffPerformances)
      .innerJoin(schema.employees, eq(schema.staffPerformances.employeeId, schema.employees.id))
      .where(eq(schema.staffPerformances.isDeleted, false))
      .orderBy(desc(schema.staffPerformances.period));

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/performance/staff", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId, period, attendanceRate, taskCompletionRate, rating, goalsJson, reviewsJson } = req.body;

    const [inserted] = await db
      .insert(schema.staffPerformances)
      .values({
        employeeId: Number(employeeId),
        period,
        attendanceRate: attendanceRate || "100",
        taskCompletionRate: taskCompletionRate || "100",
        rating: rating || "Meets Expectations",
        goalsJson,
        reviewsJson,
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "staff_performances", inserted.id, null, inserted);
    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// 8. RECRUITMENT PIPELINE & INTERVIEWS
// ---------------------------------------------------------

router.get("/recruitment/jobs", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        id: schema.recruitmentJobs.id,
        title: schema.recruitmentJobs.title,
        departmentId: schema.recruitmentJobs.departmentId,
        departmentName: schema.departments.name,
        status: schema.recruitmentJobs.status,
        description: schema.recruitmentJobs.description,
        requirements: schema.recruitmentJobs.requirements,
      })
      .from(schema.recruitmentJobs)
      .leftJoin(schema.departments, eq(schema.recruitmentJobs.departmentId, schema.departments.id))
      .where(eq(schema.recruitmentJobs.isDeleted, false))
      .orderBy(desc(schema.recruitmentJobs.createdAt));

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/recruitment/jobs", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { title, departmentId, description, requirements } = req.body;
    const [inserted] = await db
      .insert(schema.recruitmentJobs)
      .values({
        title,
        departmentId: departmentId ? Number(departmentId) : null,
        description,
        requirements,
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "recruitment_jobs", inserted.id, null, inserted);
    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/recruitment/applicants", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        id: schema.recruitmentApplicants.id,
        jobId: schema.recruitmentApplicants.jobId,
        jobTitle: schema.recruitmentJobs.title,
        fullName: schema.recruitmentApplicants.fullName,
        email: schema.recruitmentApplicants.email,
        phone: schema.recruitmentApplicants.phone,
        status: schema.recruitmentApplicants.status,
        cvUrl: schema.recruitmentApplicants.cvUrl,
        interviewDate: schema.recruitmentApplicants.interviewDate,
        interviewNotes: schema.recruitmentApplicants.interviewNotes,
        offerLetterUrl: schema.recruitmentApplicants.offerLetterUrl,
      })
      .from(schema.recruitmentApplicants)
      .leftJoin(schema.recruitmentJobs, eq(schema.recruitmentApplicants.jobId, schema.recruitmentJobs.id))
      .where(eq(schema.recruitmentApplicants.isDeleted, false))
      .orderBy(desc(schema.recruitmentApplicants.createdAt));

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/recruitment/applicants", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { jobId, fullName, email, phone, cvUrl } = req.body;
    const [inserted] = await db
      .insert(schema.recruitmentApplicants)
      .values({
        jobId: jobId ? Number(jobId) : null,
        fullName,
        email,
        phone,
        cvUrl,
        status: "Applied",
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "recruitment_applicants", inserted.id, null, inserted);
    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/recruitment/applicants/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status, interviewDate, interviewNotes, offerLetterUrl } = req.body;

    const [existing] = await db
      .select()
      .from(schema.recruitmentApplicants)
      .where(eq(schema.recruitmentApplicants.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Applicant not found." });
    }

    const [updated] = await db
      .update(schema.recruitmentApplicants)
      .set({
        status: status || existing.status,
        interviewDate: interviewDate ? new Date(interviewDate) : existing.interviewDate,
        interviewNotes: interviewNotes !== undefined ? interviewNotes : existing.interviewNotes,
        offerLetterUrl: offerLetterUrl !== undefined ? offerLetterUrl : existing.offerLetterUrl,
        updatedAt: new Date(),
      })
      .where(eq(schema.recruitmentApplicants.id, id))
      .returning();

    await auditHR(req, "UPDATE", "recruitment_applicants", id, existing, updated);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// 9. TRAINING & CERTIFICATIONS
// ---------------------------------------------------------

router.get("/trainings", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select()
      .from(schema.trainings)
      .where(eq(schema.trainings.isDeleted, false))
      .orderBy(desc(schema.trainings.sessionDate));
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/trainings", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, trainer, sessionDate } = req.body;
    const [inserted] = await db
      .insert(schema.trainings)
      .values({
        name,
        description,
        trainer,
        sessionDate: new Date(sessionDate),
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "trainings", inserted.id, null, inserted);
    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/trainings/employee", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        id: schema.employeeTrainings.id,
        employeeId: schema.employeeTrainings.employeeId,
        employeeName: schema.employees.fullName,
        employeeCode: schema.employees.employeeCode,
        trainingId: schema.employeeTrainings.trainingId,
        trainingName: schema.trainings.name,
        certificateUrl: schema.employeeTrainings.certificateUrl,
        expiryDate: schema.employeeTrainings.expiryDate,
        completionDate: schema.employeeTrainings.completionDate,
        status: schema.employeeTrainings.status,
      })
      .from(schema.employeeTrainings)
      .innerJoin(schema.employees, eq(schema.employeeTrainings.employeeId, schema.employees.id))
      .innerJoin(schema.trainings, eq(schema.employeeTrainings.trainingId, schema.trainings.id))
      .where(eq(schema.employeeTrainings.isDeleted, false))
      .orderBy(desc(schema.employeeTrainings.createdAt));

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/trainings/employee", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId, trainingId, certificateUrl, expiryDate, completionDate, status } = req.body;
    const [inserted] = await db
      .insert(schema.employeeTrainings)
      .values({
        employeeId: Number(employeeId),
        trainingId: Number(trainingId),
        certificateUrl,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        completionDate: completionDate ? new Date(completionDate) : null,
        status: status || "Enrolled",
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "employee_trainings", inserted.id, null, inserted);
    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/trainings/employee/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status, expiryDate, completionDate, certificateUrl } = req.body;

    const [existing] = await db
      .select()
      .from(schema.employeeTrainings)
      .where(eq(schema.employeeTrainings.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Employee training record not found." });
    }

    const [updated] = await db
      .update(schema.employeeTrainings)
      .set({
        status: status || existing.status,
        expiryDate: expiryDate ? new Date(expiryDate) : existing.expiryDate,
        completionDate: completionDate ? new Date(completionDate) : existing.completionDate,
        certificateUrl: certificateUrl !== undefined ? certificateUrl : existing.certificateUrl,
        updatedAt: new Date(),
      })
      .where(eq(schema.employeeTrainings.id, id))
      .returning();

    await auditHR(req, "UPDATE", "employee_trainings", id, existing, updated);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// 10. DOCUMENT MANAGEMENT & OCR EXPIRES
// ---------------------------------------------------------

router.get("/documents", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        id: schema.employeeDocuments.id,
        employeeId: schema.employeeDocuments.employeeId,
        employeeName: schema.employees.fullName,
        employeeCode: schema.employees.employeeCode,
        docType: schema.employeeDocuments.docType,
        docNumber: schema.employeeDocuments.docNumber,
        expiryDate: schema.employeeDocuments.expiryDate,
        fileUrl: schema.employeeDocuments.fileUrl,
        ocrData: schema.employeeDocuments.ocrData,
        isVerified: schema.employeeDocuments.isVerified,
      })
      .from(schema.employeeDocuments)
      .innerJoin(schema.employees, eq(schema.employeeDocuments.employeeId, schema.employees.id))
      .where(eq(schema.employeeDocuments.isDeleted, false))
      .orderBy(desc(schema.employeeDocuments.createdAt));

    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/documents", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId, docType, docNumber, expiryDate, fileUrl, ocrData } = req.body;

    const [inserted] = await db
      .insert(schema.employeeDocuments)
      .values({
        employeeId: Number(employeeId),
        docType,
        docNumber,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        fileUrl,
        ocrData,
        isVerified: false,
        createdBy: req.user?.id,
      })
      .returning();

    await auditHR(req, "CREATE", "employee_documents", inserted.id, null, inserted);
    res.json(inserted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/documents/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { isVerified } = req.body;

    const [existing] = await db
      .select()
      .from(schema.employeeDocuments)
      .where(eq(schema.employeeDocuments.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Document not found." });
    }

    const [updated] = await db
      .update(schema.employeeDocuments)
      .set({
        isVerified: !!isVerified,
        updatedAt: new Date(),
      })
      .where(eq(schema.employeeDocuments.id, id))
      .returning();

    await auditHR(req, "UPDATE", "employee_documents", id, existing, updated);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------
// 11. CENTRAL HR EXECUTIVE DASHBOARD
// ---------------------------------------------------------

router.get("/dashboard", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Total Employees count
    const [{ totalCount }] = await db
      .select({ totalCount: sql<number>`count(*)::int` })
      .from(schema.employees)
      .where(and(eq(schema.employees.status, "Active"), eq(schema.employees.isDeleted, false)));

    // 2. Attendance Status today
    const attendanceLogs = await db
      .select()
      .from(schema.attendance)
      .where(and(gte(schema.attendance.date, today), eq(schema.attendance.isDeleted, false)));

    const presentToday = attendanceLogs.filter((a) => a.status === "Present" || a.status === "Late").length;
    const absentToday = attendanceLogs.filter((a) => a.status === "Absent").length;
    const lateEmployees = attendanceLogs.filter((a) => a.lateArrival).length;
    const onLeave = attendanceLogs.filter((a) => a.status === "Leave").length;

    // 3. Driver Availability Statistics from `drivers` table
    const driversList = await db
      .select()
      .from(schema.drivers)
      .where(eq(schema.drivers.isDeleted, false));

    const driversOnTrip = driversList.filter((d) => d.status === "On Trip").length;
    const driversAvailable = driversList.filter((d) => d.status === "Available").length;

    // 4. Payroll Total Cost (Approved/Paid payrolls in current period)
    const currentPeriod = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const periodPayrolls = await db
      .select()
      .from(schema.payrolls)
      .where(and(eq(schema.payrolls.payrollPeriod, currentPeriod), eq(schema.payrolls.isDeleted, false)));

    const payrollCost = periodPayrolls.reduce((sum, p) => sum + p.netSalary, 0);

    // 5. Expiries of employee documents within next 30 days
    const next30Days = new Date();
    next30Days.setDate(next30Days.getDate() + 30);

    const upcomingExpiries = await db
      .select({
        id: schema.employeeDocuments.id,
        employeeName: schema.employees.fullName,
        docType: schema.employeeDocuments.docType,
        expiryDate: schema.employeeDocuments.expiryDate,
      })
      .from(schema.employeeDocuments)
      .innerJoin(schema.employees, eq(schema.employeeDocuments.employeeId, schema.employees.id))
      .where(
        and(
          eq(schema.employeeDocuments.isDeleted, false),
          gte(schema.employeeDocuments.expiryDate, new Date()),
          lt(schema.employeeDocuments.expiryDate, next30Days)
        )
      )
      .limit(5);

    // 6. Department-wise count of employees
    const deptStats = await db
      .select({
        departmentName: schema.departments.name,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.employees)
      .innerJoin(schema.departments, eq(schema.employees.departmentId, schema.departments.id))
      .where(and(eq(schema.employees.status, "Active"), eq(schema.employees.isDeleted, false)))
      .groupBy(schema.departments.name);

    res.json({
      totalEmployees: totalCount,
      presentToday,
      absentToday,
      lateEmployees,
      onLeave,
      driversOnTrip,
      driversAvailable,
      payrollCost,
      upcomingExpiries,
      departmentStats: deptStats,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
