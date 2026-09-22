/**
 * Enterprise Role-Based Access Control (RBAC) System
 * Centralized Permission Matrix & Authorization Engine
 */

export type Action =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "approve"
  | "export"
  | "print"
  | "manage"
  | "ai_access"
  | "reports"
  | "settings";

export type Resource =
  | "users"
  | "settings"
  | "governance"
  | "audit_logs"
  | "health"
  | "backups"
  | "vehicles"
  | "drivers"
  | "routes"
  | "contractors"
  | "dispatch"
  | "fuel"
  | "maintenance"
  | "hrms"
  | "finance"
  | "payroll"
  | "reports"
  | "documents"
  | "chat"
  | "ai";

export interface PermissionSet {
  [resource: string]: Action[];
}

export const permissionMatrix: Record<string, PermissionSet> = {
  "Super Admin": {
    users: ["create", "read", "update", "delete"],
    settings: ["create", "read", "update", "delete"],
    governance: ["create", "read", "update", "delete"],
    audit_logs: ["create", "read", "update", "delete"],
    health: ["create", "read", "update", "delete"],
    backups: ["create", "read", "update", "delete"],
    vehicles: ["create", "read", "update", "delete"],
    drivers: ["create", "read", "update", "delete"],
    routes: ["create", "read", "update", "delete"],
    contractors: ["create", "read", "update", "delete"],
    dispatch: ["create", "read", "update", "delete"],
    fuel: ["create", "read", "update", "delete"],
    maintenance: ["create", "read", "update", "delete"],
    hrms: ["create", "read", "update", "delete"],
    finance: ["create", "read", "update", "delete"],
    payroll: ["create", "read", "update", "delete"],
    reports: ["create", "read", "update", "delete"],
    documents: ["create", "read", "update", "delete"],
    chat: ["create", "read", "update", "delete"],
    ai: ["create", "read", "update", "delete"],
  },
  "Admin": {
    dispatch: ["create", "read", "update", "delete"],
    routes: ["create", "read", "update", "delete"],
    reports: ["create", "read", "update", "delete"],
    chat: ["create", "read", "update", "delete"],
  },
  "Fleet Manager": {
    vehicles: ["create", "read", "update", "delete"],
    drivers: ["create", "read", "update", "delete"],
    fuel: ["create", "read", "update", "delete"],
    maintenance: ["create", "read", "update", "delete"],
    reports: ["create", "read", "update", "delete"],
    documents: ["create", "read", "update", "delete"],
    chat: ["create", "read", "update", "delete"],
  },
  "Operations Manager": {
    dispatch: ["create", "read", "update", "delete"],
    routes: ["create", "read", "update", "delete"],
    reports: ["create", "read", "update", "delete"],
    vehicles: ["read"],
    drivers: ["read"],
    chat: ["create", "read", "update", "delete"],
  },
  "Workshop Manager": {
    maintenance: ["create", "read", "update", "delete"],
    vehicles: ["read"],
    chat: ["create", "read", "update", "delete"],
  },
  "HR Manager": {
    hrms: ["create", "read", "update", "delete"],
    drivers: ["create", "read", "update", "delete"],
    reports: ["create", "read", "update", "delete"],
    chat: ["create", "read", "update", "delete"],
  },
  "Finance Manager": {
    finance: ["create", "read", "update", "delete"],
    payroll: ["create", "read", "update", "delete"],
    reports: ["create", "read", "update", "delete"],
    documents: ["create", "read", "update", "delete"],
    chat: ["create", "read", "update", "delete"],
  },
  "Accountant": {
    finance: ["create", "read", "update", "delete"],
    payroll: ["create", "read", "update", "delete"],
    chat: ["create", "read", "update", "delete"],
  },
  "Dispatcher": {
    dispatch: ["create", "read", "update", "delete"],
    routes: ["create", "read", "update", "delete"],
    chat: ["create", "read", "update", "delete"],
  },
  "Viewer": {
    vehicles: ["read"],
    drivers: ["read"],
    routes: ["read"],
    contractors: ["read"],
    dispatch: ["read"],
    fuel: ["read"],
    maintenance: ["read"],
    hrms: ["read"],
    finance: ["read"],
    payroll: ["read"],
    reports: ["read"],
    documents: ["read"],
    chat: ["read"],
  },
  "Pending": {},
};

/**
 * Validates whether a given role can perform an action on a resource.
 */
export function hasPermission(
  role: string | null | undefined,
  resource: Resource,
  action: Action
): boolean {
  if (!role) return false;
  if (role === "Super Admin") return true;
  if (role === "Pending") return false;

  const permissions = permissionMatrix[role];
  if (!permissions) return false;

  const resourcePermissions = permissions[resource];
  if (!resourcePermissions) return false;

  // Viewer cannot write under any circumstances
  if (role === "Viewer" && action !== "read") {
    return false;
  }

  return resourcePermissions.includes(action);
}

/**
 * Returns list of accessible resources for a role
 */
export function getAccessibleResources(role: string | null | undefined): Resource[] {
  if (!role) return [];
  if (role === "Super Admin") {
    return [
      "users", "settings", "governance", "audit_logs", "health", "backups",
      "vehicles", "drivers", "routes", "contractors", "dispatch", "fuel",
      "maintenance", "hrms", "finance", "payroll", "reports", "documents", "chat", "ai"
    ];
  }
  const permissions = permissionMatrix[role];
  if (!permissions) return [];
  return Object.keys(permissions) as Resource[];
}
