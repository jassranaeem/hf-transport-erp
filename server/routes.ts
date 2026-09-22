import { Router, Response } from "express";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { listUsers, updateUserRole, softDeleteUser } from "../src/db/users.ts";
import { listAuditLogs, logAudit } from "../src/db/audit.ts";
import { db } from "../src/db/index.ts";
import { users } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { getServerPermissionMatrix, updatePermission } from "./rbac_service.ts";
import { setUserPassword } from "../src/db/users.ts";
import { tempPassword } from "../src/lib/auth/index.ts";

const router = Router();

// ---------------------------------------------------------
// HEALTH CHECK
// ---------------------------------------------------------
router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "HF Transport ERP - Enterprise Foundation API",
    version: "2.0.0",
  });
});

// Authentication endpoints now live in server/auth.ts (mounted at /api/auth).

// ---------------------------------------------------------
// USER MANAGEMENT (RBAC Controlled)
// ---------------------------------------------------------
router.get("/users", requireAuth, requireApproved, requireRole(["Super Admin"]), async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;
    const search = (req.query.search as string) || undefined;
    const role = (req.query.role as string) || undefined;
    const sortBy = (req.query.sortBy as string) || "createdAt";
    const sortOrder = (req.query.sortOrder as "asc" | "desc") || "desc";

    const { data, total } = await listUsers({
      limit,
      offset,
      search,
      role,
      sortBy,
      sortOrder,
    });

    res.json({
      data,
      pagination: {
        limit,
        offset,
        total,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to list users" });
  }
});

router.put("/users/:id/role", requireAuth, requireApproved, requireRole(["Super Admin"]), async (req: AuthRequest, res: Response) => {
  try {
    const targetUserId = parseInt(req.params.id);
    const { role, status } = req.body;
    
    if (isNaN(targetUserId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const validRoles = [
      "Super Admin",
      "Admin",
      "Finance Manager",
      "HR Manager",
      "Fleet Manager",
      "Dispatcher",
      "Operations Manager",
      "Workshop Manager",
      "Fuel Manager",
      "Auditor",
      "Accountant",
      "Driver",
      "Viewer",
      "Pending"
    ];

    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` });
    }

    const validStatuses = ["Pending Approval", "Approved", "Rejected", "Disabled"];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }

    const currentUserId = req.user!.id;

    const updatedUser = await updateUserRole(
      targetUserId,
      role || "Pending",
      currentUserId,
      req.ip || req.socket.remoteAddress || undefined,
      req.headers["user-agent"] || undefined,
      status
    );

    res.json({
      message: "User role and status updated successfully",
      user: {
        id: updatedUser.id,
        uid: updatedUser.uid,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        status: updatedUser.status,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update user role" });
  }
});

router.put("/users/:id", requireAuth, requireApproved, requireRole(["Super Admin"]), async (req: AuthRequest, res: Response) => {
  try {
    const targetUserId = parseInt(req.params.id);
    const { name, phone, department, role, status } = req.body;
    
    if (isNaN(targetUserId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "User not found" });
    }

    const updateFields: any = {
      updatedAt: new Date(),
      updatedBy: req.user!.id,
    };

    if (name !== undefined) updateFields.name = name;
    if (phone !== undefined) updateFields.phone = phone;
    if (department !== undefined) updateFields.department = department;
    if (role !== undefined) updateFields.role = role;
    if (status !== undefined) updateFields.status = status;

    const [updated] = await db
      .update(users)
      .set(updateFields)
      .where(eq(users.id, targetUserId))
      .returning();

    // Log the user update audit
    await logAudit({
      action: "UPDATE",
      tableName: "users",
      recordId: updated.id,
      oldValues: existing,
      newValues: updated,
      performedBy: req.user!.id,
      ipAddress: req.ip || req.socket.remoteAddress || undefined,
      userAgent: req.headers["user-agent"] || undefined,
    });

    res.json({
      message: "User updated successfully",
      user: updated,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update user details" });
  }
});

router.post("/users/:id/reset-password", requireAuth, requireApproved, requireRole(["Super Admin"]), async (req: AuthRequest, res: Response) => {
  try {
    const targetUserId = parseInt(req.params.id);
    if (isNaN(targetUserId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!dbUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Admin reset: set a one-time temporary password and hand it back so the
    // admin can pass it to the user (who then changes it via /api/auth/change-password).
    const temporaryPassword = tempPassword();
    await setUserPassword(dbUser.id, temporaryPassword);

    await logAudit({
      action: "UPDATE",
      tableName: "users",
      recordId: dbUser.id,
      oldValues: { email: dbUser.email, action: "Request Reset Password" },
      newValues: { action: "Temporary password issued" },
      performedBy: req.user!.id,
      ipAddress: req.ip || req.socket.remoteAddress || undefined,
      userAgent: req.headers["user-agent"] || undefined,
    });

    res.json({
      message: `Temporary password issued for ${dbUser.email}. Share it securely; the user should change it after signing in.`,
      email: dbUser.email,
      temporaryPassword,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to reset password" });
  }
});

router.delete("/users/:id", requireAuth, requireRole(["Super Admin"]), async (req: AuthRequest, res: Response) => {
  try {
    const targetUserId = parseInt(req.params.id);
    if (isNaN(targetUserId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    if (targetUserId === req.user!.id) {
      return res.status(400).json({ error: "Self-deletion is forbidden" });
    }

    const currentUserId = req.user!.id;

    await softDeleteUser(
      targetUserId,
      currentUserId,
      req.ip || req.socket.remoteAddress || undefined,
      req.headers["user-agent"] || undefined
    );

    res.json({
      message: "User soft deleted successfully",
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete user" });
  }
});

// ---------------------------------------------------------
// AUDIT LOG MANAGEMENT (RBAC Controlled)
// ---------------------------------------------------------
router.get("/audit-logs", requireAuth, requireApproved, requireRole(["Super Admin"]), async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const action = (req.query.action as string) || undefined;
    const tableName = (req.query.tableName as string) || undefined;
    const performedBy = req.query.performedBy ? parseInt(req.query.performedBy as string) : undefined;
    const search = (req.query.search as string) || undefined;
    const sortBy = (req.query.sortBy as string) || "createdAt";
    const sortOrder = (req.query.sortOrder as "asc" | "desc") || "desc";

    const { data, total } = await listAuditLogs({
      limit,
      offset,
      action,
      tableName,
      performedBy,
      search,
      sortBy,
      sortOrder,
    });

    res.json({
      data,
      pagination: {
        limit,
        offset,
        total,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to list audit logs" });
  }
});

// ---------------------------------------------------------
// DYNAMIC RBAC PERMISSIONS MATRIX API
// ---------------------------------------------------------
router.get("/rbac/matrix", requireAuth, requireApproved, (req: AuthRequest, res: Response) => {
  try {
    const matrix = getServerPermissionMatrix();
    res.json({ matrix });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to retrieve permission matrix" });
  }
});

router.put("/rbac/permissions", requireAuth, requireApproved, requireRole(["Super Admin"]), async (req: AuthRequest, res: Response) => {
  try {
    const { role, resource, actions } = req.body;
    if (!role || !resource || !Array.isArray(actions)) {
      return res.status(400).json({ error: "Missing role, resource, or actions array in request body" });
    }
    
    await updatePermission(role, resource, actions);
    
    // Log the permission update audit
    await logAudit({
      action: "UPDATE",
      tableName: "role_permissions",
      recordId: 0, // General matrix edit
      oldValues: { role, resource },
      newValues: { role, resource, actions },
      performedBy: req.user!.id,
      ipAddress: req.ip || req.socket.remoteAddress || undefined,
      userAgent: req.headers["user-agent"] || undefined,
    });

    res.json({
      message: `Permissions updated successfully for role ${role} and resource ${resource}`,
      matrix: getServerPermissionMatrix()
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update dynamic role permission" });
  }
});

export default router;
