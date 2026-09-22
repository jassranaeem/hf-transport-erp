import { db } from "./index.ts";
import { auditLogs, users } from "./schema.ts";
import { eq, and, desc, asc, sql } from "drizzle-orm";

export interface AuditLogPayload {
  action: "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT" | "ROLE_CHANGE";
  tableName?: string;
  recordId?: number;
  oldValues?: any;
  newValues?: any;
  performedBy?: number;
  ipAddress?: string;
  userAgent?: string;
}

export async function logAudit(payload: AuditLogPayload, tx?: any) {
  try {
    const client = tx || db;
    const [inserted] = await client
      .insert(auditLogs)
      .values({
        action: payload.action,
        tableName: payload.tableName || null,
        recordId: payload.recordId || null,
        oldValues: payload.oldValues || null,
        newValues: payload.newValues || null,
        performedBy: payload.performedBy || null,
        ipAddress: payload.ipAddress || null,
        userAgent: payload.userAgent || null,
        createdBy: payload.performedBy || null,
        updatedBy: payload.performedBy || null,
      })
      .returning();
    return inserted;
  } catch (error) {
    console.error("Failed to log audit record:", error);
    throw error;
  }
}

export interface ListAuditLogsOptions {
  limit: number;
  offset: number;
  action?: string;
  tableName?: string;
  performedBy?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export async function listAuditLogs(options: ListAuditLogsOptions) {
  try {
    const conditions = [eq(auditLogs.isDeleted, false)];

    if (options.action) {
      conditions.push(eq(auditLogs.action, options.action));
    }

    if (options.tableName) {
      conditions.push(eq(auditLogs.tableName, options.tableName));
    }

    if (options.performedBy) {
      conditions.push(eq(auditLogs.performedBy, options.performedBy));
    }

    if (options.search) {
      const searchPattern = `%${options.search}%`;
      conditions.push(
        sql`(${auditLogs.action} ILIKE ${searchPattern} OR ${auditLogs.tableName} ILIKE ${searchPattern} OR ${auditLogs.ipAddress} ILIKE ${searchPattern})`
      );
    }

    const finalCondition = and(...conditions);

    let orderBySpec = desc(auditLogs.createdAt);
    if (options.sortBy) {
      const isDesc = options.sortOrder === "desc";
      if (options.sortBy === "action") {
        orderBySpec = isDesc ? desc(auditLogs.action) : asc(auditLogs.action);
      } else if (options.sortBy === "tableName") {
        orderBySpec = isDesc ? desc(auditLogs.tableName) : asc(auditLogs.tableName);
      } else if (options.sortBy === "createdAt") {
        orderBySpec = isDesc ? desc(auditLogs.createdAt) : asc(auditLogs.createdAt);
      }
    }

    const data = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        tableName: auditLogs.tableName,
        recordId: auditLogs.recordId,
        oldValues: auditLogs.oldValues,
        newValues: auditLogs.newValues,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        createdAt: auditLogs.createdAt,
        performedBy: auditLogs.performedBy,
        performerEmail: users.email,
        performerName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.performedBy, users.id))
      .where(finalCondition)
      .orderBy(orderBySpec)
      .limit(options.limit)
      .offset(options.offset);

    const totalCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(finalCondition);

    const total = Number(totalCountResult[0]?.count || 0);

    return { data, total };
  } catch (error) {
    console.error("Error listing audit logs:", error);
    throw new Error("Failed to query audit logs.");
  }
}
