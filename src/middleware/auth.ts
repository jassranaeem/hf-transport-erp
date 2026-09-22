import { Request, Response, NextFunction } from "express";
import { getUserByUid, getOrCreateUser, ensureSuperAdminRole } from "../db/users.ts";
import { verifySession, type SessionClaims } from "../lib/auth/index.ts";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    uid: string;
    email: string;
    name: string | null;
    role: string;
    status: string;
    phone: string | null;
    department: string | null;
    requestedRole: string | null;
  };
  session?: SessionClaims;
}

/**
 * LOCAL-ONLY developer login bypass.
 * Enabled only when DEV_AUTH_BYPASS=true AND NODE_ENV !== "production".
 * Lets you exercise the app without a Firebase service-account key while
 * developing / testing. It is compiled out of any production deployment by the
 * NODE_ENV guard, and logs loudly on every use.
 */
const DEV_AUTH_BYPASS =
  process.env.DEV_AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production";
const DEV_AUTH_EMAIL = process.env.DEV_AUTH_EMAIL || "jassranaeem@gmail.com";

if (DEV_AUTH_BYPASS) {
  console.warn(
    `\n*** DEV_AUTH_BYPASS is ON - API auth is bypassed for "${DEV_AUTH_EMAIL}". ` +
      `NEVER use this with NODE_ENV=production. ***\n`
  );
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  console.log(`\n--- [Auth Pipeline: Start] ---`);
  console.log(`[Auth Step 1] Authorization Header: ${authHeader ? "Bearer [redacted]" : "MISSING"}`);

  if (
    DEV_AUTH_BYPASS &&
    (req.headers["x-dev-bypass"] === "1" || authHeader === "Bearer DEV_BYPASS")
  ) {
    console.warn(`[Auth] DEV BYPASS used for ${req.method} ${req.originalUrl || req.url}`);
    const ipAddress = req.ip || req.socket.remoteAddress || undefined;
    const userAgent = req.headers["user-agent"] || undefined;
    const dbUser = await getOrCreateUser(
      "dev-bypass-uid",
      DEV_AUTH_EMAIL,
      "Developer (bypass)",
      ipAddress,
      userAgent
    );
    req.user = {
      id: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
      status: dbUser.status,
      phone: dbUser.phone,
      department: dbUser.department,
      requestedRole: dbUser.requestedRole ?? null,
    };
    return next();
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log(`[Auth Step 1 Failure] Missing or invalid Authorization header structure`);
    return res.status(401).json({ error: "Unauthorized: Missing authentication token" });
  }

  const token = authHeader.split("Bearer ")[1];
  try {
    const claims = verifySession(token);
    if (!claims) {
      return res.status(401).json({ error: "Unauthorized: Invalid or expired session" });
    }

    let dbUser = await getUserByUid(claims.uid);
    if (!dbUser) {
      return res.status(401).json({ error: "Unauthorized: Account no longer exists" });
    }
    dbUser = await ensureSuperAdminRole(dbUser);

    req.session = claims;
    req.user = {
      id: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
      status: dbUser.status,
      phone: dbUser.phone,
      department: dbUser.department,
      requestedRole: dbUser.requestedRole ?? null,
    };

    console.log(`[Auth] ${req.method} ${req.originalUrl || req.url} as ${dbUser.email} (${dbUser.role})`);
    next();
  } catch (error) {
    console.error(`[Auth Failure]`, error);
    return res.status(401).json({ error: "Unauthorized: Invalid or expired session" });
  }
};

export const requireApproved = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized: Authentication required" });
  }
  if (req.user.status !== "Approved" || req.user.role === "Pending") {
    return res.status(403).json({
      error: "Forbidden: Your account is awaiting administrator approval and does not have access to the ERP.",
    });
  }
  next();
};

// RBAC middleware
import { logAudit } from "../db/audit.ts";
import { Resource, Action } from "../lib/rbac.ts";
import { hasPermissionServer } from "../../server/rbac_service.ts";

export const requirePermission = (resource: Resource, action: Action) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    console.log(`\n--- [RBAC Dynamic Authorization Check] ---`);
    console.log(`[RBAC Step 1] Route Path: ${req.method} ${req.originalUrl || req.url}`);

    if (!req.user) {
      console.log(`[RBAC Failure] req.user is undefined. Authentication check was bypassed or failed.`);
      return res.status(401).json({ error: "Unauthorized: Authentication required" });
    }

    const { role, email, id } = req.user;
    console.log(`[RBAC Step 2] User Details:`);
    console.log(`  - User Email: ${email}`);
    console.log(`  - User Role: ${role}`);
    console.log(`  - Required Permission: ${action.toUpperCase()} on resource '${resource}'`);

    // Validation
    const allowed = hasPermissionServer(role, resource, action);

    if (allowed) {
      console.log(`[RBAC Success] Permission GRANTED.`);
      console.log(`--- [RBAC Pipeline: End Success] ---\n`);
      return next();
    }

    console.log(`[RBAC Failure] Permission DENIED: User role '${role}' lacks required access.`);
    
    // AUDIT LOG FOR DENIAL
    try {
      const ipAddress = req.ip || req.socket.remoteAddress || undefined;
      const userAgent = req.headers["user-agent"] || undefined;
      await logAudit({
        action: "ROLE_CHANGE", // Storing security failures under security logs / audit trail
        tableName: `rbac_denied:${resource}`,
        recordId: id,
        oldValues: { role, resource, action },
        newValues: {
          error: "Permission Denied",
          user: email,
          role: role,
          module: resource,
          action: action,
          timestamp: new Date().toISOString(),
          ip: ipAddress || "unknown",
          reason: `User with role '${role}' attempted unauthorized '${action}' on resource '${resource}'.`,
          userAgent
        },
        performedBy: id,
        ipAddress,
        userAgent
      });
      console.log(`[RBAC Audit] Security denial logged successfully in the database.`);
    } catch (auditErr: any) {
      console.error(`[RBAC Audit Error] Failed to log security denial:`, auditErr.message || auditErr);
    }

    console.log(`--- [RBAC Pipeline: End Forbidden (403)] ---\n`);
    return res.status(403).json({
      error: `Forbidden: Access restricted. You do not have permission to perform '${action}' on '${resource}'. Current role: ${role}`,
    });
  };
};

export const requireRole = (allowedRoles: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    console.log(`\n--- [RBAC Authorization Check] ---`);
    console.log(`[RBAC Step 1] Route Path: ${req.method} ${req.originalUrl || req.url}`);

    if (!req.user) {
      console.log(`[RBAC Failure] req.user is undefined. Authentication check was bypassed or failed.`);
      return res.status(401).json({ error: "Unauthorized: Authentication required" });
    }

    const { role, email, id } = req.user;
    console.log(`[RBAC Step 2] User Details:`);
    console.log(`  - User Email: ${email}`);
    console.log(`  - User Role: ${role}`);
    console.log(`  - Required Roles: [${allowedRoles.join(", ")}]`);

    // Super Admin has access to everything
    if (role === "Super Admin") {
      console.log(`[RBAC Success] Permission GRANTED immutably via Super Admin Privilege.`);
      console.log(`--- [RBAC Pipeline: End Success] ---\n`);
      return next();
    }

    if (allowedRoles.includes(role)) {
      console.log(`[RBAC Success] Permission GRANTED: User role '${role}' is in the allowed list.`);
      console.log(`--- [RBAC Pipeline: End Success] ---\n`);
      return next();
    }

    console.log(`[RBAC Failure] Permission DENIED: User role '${role}' lacks required access.`);
    
    // AUDIT LOG FOR DENIAL
    try {
      const ipAddress = req.ip || req.socket.remoteAddress || undefined;
      const userAgent = req.headers["user-agent"] || undefined;
      await logAudit({
        action: "ROLE_CHANGE",
        tableName: `rbac_denied_role_check`,
        recordId: id,
        oldValues: { role, allowedRoles },
        newValues: {
          error: "Permission Denied",
          user: email,
          role: role,
          module: req.originalUrl || req.url,
          action: req.method,
          timestamp: new Date().toISOString(),
          ip: ipAddress || "unknown",
          reason: `User with role '${role}' failed requireRole check. Allowed: [${allowedRoles.join(", ")}].`,
          userAgent
        },
        performedBy: id,
        ipAddress,
        userAgent
      });
    } catch (auditErr: any) {
      console.error(`[RBAC Audit Error] Failed to log security denial:`, auditErr.message || auditErr);
    }

    console.log(`--- [RBAC Pipeline: End Forbidden (403)] ---\n`);
    return res.status(403).json({
      error: `Forbidden: Access restricted. Required roles: [${allowedRoles.join(", ")}]. Current role: ${role}`,
    });
  };
};
