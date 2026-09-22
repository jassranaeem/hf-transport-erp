import { db } from "./index.ts";
import { users } from "./schema.ts";
import { eq, and, asc, desc, like, sql, or } from "drizzle-orm";
import { logAudit } from "./audit.ts";
import { SUPER_ADMIN_EMAIL, hashPassword, newUid, tempPassword } from "../lib/auth/index.ts";

/** Roles/status a brand-new account should get. */
async function assignRoleForNewUser(email: string) {
  const isSuperAdmin = email.toLowerCase() === SUPER_ADMIN_EMAIL;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(users);
  const firstEver = Number(count || 0) === 0;
  const role = isSuperAdmin || firstEver ? "Super Admin" : "Pending";
  const status = role === "Super Admin" ? "Approved" : "Pending Approval";
  return { role, status };
}

export async function getUserByEmail(email: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email.toLowerCase().trim()), eq(users.isDeleted, false)))
    .limit(1);
  return row || null;
}

export async function setUserPassword(userId: number, plainPassword: string) {
  const passwordHash = await hashPassword(plainPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
}

/** Record the role a still-pending user is requesting. */
export async function setRequestedRole(userId: number, requestedRole: string) {
  await db
    .update(users)
    .set({ requestedRole, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function touchLastLogin(userId: number) {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(and(eq(users.id, userId), or(sql`${users.lastLoginAt} is null`, sql`${users.lastLoginAt} < ${cutoff}`)));
}

/** Force the configured super-admin account to Super Admin / Approved. */
export async function ensureSuperAdminRole(user: typeof users.$inferSelect) {
  if (
    user.email?.toLowerCase() === SUPER_ADMIN_EMAIL &&
    (user.role !== "Super Admin" || user.status !== "Approved")
  ) {
    const [promoted] = await db
      .update(users)
      .set({ role: "Super Admin", status: "Approved", updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    return promoted;
  }
  return user;
}

/**
 * Create a new local (email+password) account, or return the existing one.
 */
export async function registerLocalUser(input: {
  email: string;
  passwordHash: string;
  name?: string | null;
  phone?: string | null;
  department?: string | null;
  requestedRole?: string | null;
  ipAddress?: string;
  userAgent?: string;
}) {
  const email = input.email.toLowerCase().trim();
  const existing = await getUserByEmail(email);
  if (existing) {
    const err: any = new Error("An account with this email already exists.");
    err.code = "EMAIL_TAKEN";
    throw err;
  }
  const { role, status } = await assignRoleForNewUser(email);
  const [inserted] = await db
    .insert(users)
    .values({
      uid: newUid(),
      email,
      passwordHash: input.passwordHash,
      authProvider: "password",
      name: input.name || null,
      phone: input.phone || null,
      department: input.department || null,
      requestedRole: role === "Super Admin" ? null : input.requestedRole || null,
      role,
      status,
      lastLoginAt: new Date(),
    })
    .returning();

  await logAudit({
    action: "CREATE",
    tableName: "users",
    recordId: inserted.id,
    oldValues: null,
    newValues: { id: inserted.id, email: inserted.email, role: inserted.role, status: inserted.status, provider: "password" },
    performedBy: inserted.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
  return inserted;
}

/**
 * Sync an externally-authenticated identity (Google, dev bypass) into the users
 * table. Matches an existing row by uid OR email so a person can use Google and
 * password sign-in for the same address.
 */
export async function getOrCreateUser(
  uid: string,
  email: string,
  name?: string,
  ipAddress?: string,
  userAgent?: string,
  phone?: string,
  department?: string,
  authProvider: string = "password",
  requestedRole?: string | null
) {
  try {
    const normEmail = email.toLowerCase().trim();
    // 1. Check if user exists (match by uid or email; include soft-deleted)
    const existing = await db
      .select()
      .from(users)
      .where(or(eq(users.uid, uid), eq(users.email, normEmail)))
      .limit(1);

    if (existing.length > 0) {
      const user = existing[0];
      if (user.isDeleted) {
        // Restore user if soft deleted
        const [restored] = await db
          .update(users)
          .set({
            isDeleted: false,
            deletedAt: null,
            deletedBy: null,
            updatedAt: new Date(),
            lastLoginAt: new Date(),
          })
          .where(eq(users.id, user.id))
          .returning();
        
        await logAudit({
          action: "UPDATE",
          tableName: "users",
          recordId: restored.id,
          oldValues: user,
          newValues: restored,
          performedBy: restored.id,
          ipAddress,
          userAgent,
        });
        return restored;
      }
      
      // Keep the configured Super Admin account escalated
      const promoted = await ensureSuperAdminRole(user);
      if (promoted !== user) return promoted;

      // Refresh lastLoginAt (throttled) + backfill a stable uid if matched by email
      const patch: Record<string, unknown> = {};
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      if (!user.lastLoginAt || new Date(user.lastLoginAt) < fifteenMinutesAgo) {
        patch.lastLoginAt = new Date();
      }
      if (Object.keys(patch).length === 0) return user;
      const [updated] = await db.update(users).set(patch).where(eq(users.id, user.id)).returning();
      return updated;
    }

    // 2. New identity - seed role/status
    const { role: assignedRole, status: assignedStatus } = await assignRoleForNewUser(normEmail);

    // 3. Create new user
    const [inserted] = await db
      .insert(users)
      .values({
        uid,
        email: normEmail,
        authProvider,
        name: name || null,
        role: assignedRole,
        phone: phone || null,
        department: department || null,
        requestedRole: assignedRole === "Super Admin" ? null : requestedRole || null,
        status: assignedStatus,
        lastLoginAt: new Date(),
      })
      .returning();

    // Log the creation audit
    await logAudit({
      action: "CREATE",
      tableName: "users",
      recordId: inserted.id,
      oldValues: null,
      newValues: inserted,
      performedBy: inserted.id,
      ipAddress,
      userAgent,
    });

    return inserted;
  } catch (error) {
    console.error("Error in getOrCreateUser:", error);
    throw new Error("Failed to authenticate or register user in database.", { cause: error });
  }
}

export async function getUserById(id: number) {
  try {
    const result = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.isDeleted, false)))
      .limit(1);
    return result[0] || null;
  } catch (error) {
    console.error("Error in getUserById:", error);
    throw new Error("Failed to fetch user by ID.");
  }
}

export async function getUserByUid(uid: string) {
  try {
    const result = await db
      .select()
      .from(users)
      .where(and(eq(users.uid, uid), eq(users.isDeleted, false)))
      .limit(1);
    return result[0] || null;
  } catch (error) {
    console.error("Error in getUserByUid:", error);
    throw new Error("Failed to fetch user by UID.");
  }
}

export async function updateUserRole(
  targetUserId: number,
  newRole: string,
  updatedByUserId: number,
  ipAddress?: string,
  userAgent?: string,
  status?: string
) {
  try {
    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, targetUserId), eq(users.isDeleted, false)))
      .limit(1);

    if (!existing) {
      throw new Error("User not found or is deleted.");
    }

    const updateFields: any = {
      role: newRole,
      updatedBy: updatedByUserId,
      updatedAt: new Date(),
    };

    if (status) {
      updateFields.status = status;
    }

    const [updated] = await db
      .update(users)
      .set(updateFields)
      .where(eq(users.id, targetUserId))
      .returning();

    // Log the role change audit
    await logAudit({
      action: "ROLE_CHANGE",
      tableName: "users",
      recordId: updated.id,
      oldValues: { role: existing.role, status: existing.status },
      newValues: { role: updated.role, status: updated.status },
      performedBy: updatedByUserId,
      ipAddress,
      userAgent,
    });

    return updated;
  } catch (error) {
    console.error("Error in updateUserRole:", error);
    throw error;
  }
}

export async function softDeleteUser(
  targetUserId: number,
  deletedByUserId: number,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, targetUserId), eq(users.isDeleted, false)))
      .limit(1);

    if (!existing) {
      throw new Error("User not found or already deleted.");
    }

    const [deleted] = await db
      .update(users)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: deletedByUserId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetUserId))
      .returning();

    // Log delete audit
    await logAudit({
      action: "DELETE",
      tableName: "users",
      recordId: deleted.id,
      oldValues: existing,
      newValues: { isDeleted: true, deletedAt: deleted.deletedAt },
      performedBy: deletedByUserId,
      ipAddress,
      userAgent,
    });

    return deleted;
  } catch (error) {
    console.error("Error in softDeleteUser:", error);
    throw error;
  }
}

export interface ListUsersOptions {
  limit: number;
  offset: number;
  search?: string;
  role?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export async function listUsers(options: ListUsersOptions) {
  try {
    let query = db.select().from(users).where(eq(users.isDeleted, false));

    // Simple count query
    let countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.isDeleted, false));

    const conditions = [eq(users.isDeleted, false)];

    if (options.role) {
      conditions.push(eq(users.role, options.role));
    }

    if (options.search) {
      const searchPattern = `%${options.search}%`;
      conditions.push(
        sql`(${users.email} ILIKE ${searchPattern} OR ${users.name} ILIKE ${searchPattern})`
      );
    }

    const finalCondition = and(...conditions);

    // Apply sorting
    let orderBySpec = desc(users.createdAt);
    if (options.sortBy) {
      const isDesc = options.sortOrder === "desc";
      if (options.sortBy === "email") {
        orderBySpec = isDesc ? desc(users.email) : asc(users.email);
      } else if (options.sortBy === "name") {
        orderBySpec = isDesc ? desc(users.name) : asc(users.name);
      } else if (options.sortBy === "role") {
        orderBySpec = isDesc ? desc(users.role) : asc(users.role);
      } else if (options.sortBy === "createdAt") {
        orderBySpec = isDesc ? desc(users.createdAt) : asc(users.createdAt);
      } else if (options.sortBy === "lastLoginAt") {
        orderBySpec = isDesc ? desc(users.lastLoginAt) : asc(users.lastLoginAt);
      } else if (options.sortBy === "createdBy") {
        orderBySpec = isDesc ? desc(users.createdBy) : asc(users.createdBy);
      } else if (options.sortBy === "status") {
        orderBySpec = isDesc ? desc(users.status) : asc(users.status);
      } else if (options.sortBy === "department") {
        orderBySpec = isDesc ? desc(users.department) : asc(users.department);
      }
    }

    const data = await db
      .select()
      .from(users)
      .where(finalCondition)
      .orderBy(orderBySpec)
      .limit(options.limit)
      .offset(options.offset);

    const totalCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(finalCondition);

    const total = Number(totalCountResult[0]?.count || 0);

    return { data, total };
  } catch (error) {
    console.error("Error listing users:", error);
    throw new Error("Failed to list users.");
  }
}

/**
 * On boot, guarantee a usable Super Admin account exists in PostgreSQL.
 *
 * - The account is SUPER_ADMIN_EMAIL (default jassranaeem@gmail.com).
 * - If it does not exist yet, it is created with a password so the very first
 *   login works. Password precedence:
 *     SUPER_ADMIN_PASSWORD env  ->  else a random one printed to the console once.
 * - If it exists, its role/status are corrected to Super Admin / Approved.
 * - Google sign-in with that same email also resolves to this account.
 */
export async function ensureSuperAdminExists() {
  try {
    const email = SUPER_ADMIN_EMAIL;
    const existing = await getUserByEmail(email);

    if (existing) {
      if (existing.role !== "Super Admin" || existing.status !== "Approved") {
        await db
          .update(users)
          .set({ role: "Super Admin", status: "Approved", updatedAt: new Date() })
          .where(eq(users.id, existing.id));
        console.log(`[Super Admin] Corrected ${email} -> Super Admin / Approved.`);
      } else {
        console.log(`[Super Admin] ${email} verified.`);
      }
      return;
    }

    const provided = process.env.SUPER_ADMIN_PASSWORD;
    const password = provided || tempPassword();
    const passwordHash = await hashPassword(password);

    const [inserted] = await db
      .insert(users)
      .values({
        uid: newUid(),
        email,
        passwordHash,
        authProvider: "password",
        name: "Super Admin",
        role: "Super Admin",
        status: "Approved",
        lastLoginAt: null,
      })
      .returning();

    await logAudit({
      action: "CREATE",
      tableName: "users",
      recordId: inserted.id,
      oldValues: null,
      newValues: { id: inserted.id, email, role: "Super Admin", status: "Approved" },
      performedBy: inserted.id,
      ipAddress: "127.0.0.1",
      userAgent: "System Bootstrapper",
    });

    if (provided) {
      console.log(`[Super Admin] Seeded ${email} with SUPER_ADMIN_PASSWORD from env.`);
    } else {
      console.log(
        "\n==================== SUPER ADMIN CREATED ====================\n" +
          `  Email:    ${email}\n` +
          `  Password: ${password}\n` +
          "  Log in and change it, or sign in with Google using this email.\n" +
          "  (Set SUPER_ADMIN_PASSWORD in .env.local to control this.)\n" +
          "===========================================================\n"
      );
    }
  } catch (error: any) {
    console.error("[Super Admin Setup Error]", error.message || error);
  }
}
