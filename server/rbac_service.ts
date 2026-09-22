import { db } from "../src/db/index.ts";
import { rolePermissions } from "../src/db/schema.ts";
import { permissionMatrix, PermissionSet, Resource, Action } from "../src/lib/rbac.ts";
import { eq, and } from "drizzle-orm";

let serverPermissionMatrix: Record<string, PermissionSet> = { ...permissionMatrix };

export async function initRBAC() {
  try {
    console.log("[RBAC Service] Initializing dynamic role permissions...");
    // Fetch all role permissions from database
    const rows = await db.select().from(rolePermissions);
    
    if (rows.length === 0) {
      console.log("[RBAC Service] Dynamic database permissions empty. Seeding from default matrix...");
      // Seed default permissions
      const insertPromises = [];
      for (const [role, resources] of Object.entries(permissionMatrix)) {
        for (const [resource, actions] of Object.entries(resources)) {
          insertPromises.push(
            db.insert(rolePermissions).values({
              role,
              resource,
              actions: actions,
            })
          );
        }
      }
      await Promise.all(insertPromises);
      console.log("[RBAC Service] Default matrix seeded into database successfully.");
    } else {
      // Build serverPermissionMatrix
      const matrix: Record<string, PermissionSet> = {};
      for (const row of rows) {
        if (!matrix[row.role]) {
          matrix[row.role] = {};
        }
        matrix[row.role][row.resource] = row.actions as Action[];
      }
      serverPermissionMatrix = matrix;
      console.log("[RBAC Service] Loaded role permissions from PostgreSQL database.");
    }
  } catch (error) {
    console.error("[RBAC Service Error] Failed to initialize RBAC:", error);
  }
}

export function hasPermissionServer(
  role: string | null | undefined,
  resource: Resource,
  action: Action
): boolean {
  if (!role) return false;
  if (role === "Super Admin") return true;
  if (role === "Pending") return false;

  const permissions = serverPermissionMatrix[role];
  if (!permissions) return false;

  const resourcePermissions = permissions[resource];
  if (!resourcePermissions) return false;

  return resourcePermissions.includes(action);
}

export function getServerPermissionMatrix() {
  return serverPermissionMatrix;
}

export async function updatePermission(
  role: string,
  resource: Resource,
  actions: Action[]
) {
  // Check if record exists
  const existing = await db
    .select()
    .from(rolePermissions)
    .where(and(eq(rolePermissions.role, role), eq(rolePermissions.resource, resource)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(rolePermissions)
      .set({ actions, updatedAt: new Date() })
      .where(and(eq(rolePermissions.role, role), eq(rolePermissions.resource, resource)));
  } else {
    await db.insert(rolePermissions).values({
      role,
      resource,
      actions,
    });
  }

  // Reload dynamic permissions in memory
  const rows = await db.select().from(rolePermissions);
  const matrix: Record<string, PermissionSet> = {};
  for (const row of rows) {
    if (!matrix[row.role]) {
      matrix[row.role] = {};
    }
    matrix[row.role][row.resource] = row.actions as Action[];
  }
  serverPermissionMatrix = matrix;
}
