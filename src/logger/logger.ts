import { db, schema } from "../db/index.ts";

export class LoggerService {
  /**
   * Logs a general system event
   */
  public static async logSystem(
    module: string,
    action: string,
    message: string,
    meta?: any,
    createdBy?: number
  ): Promise<void> {
    try {
      await db.insert(schema.systemLogs).values({
        module,
        action,
        message,
        meta: meta ? meta : null,
        createdBy,
      });
      console.log(`[SYSTEM LOG] [${module}] [${action}] ${message}`);
    } catch (err: any) {
      console.error("Failed to write system log to database:", err.message);
    }
  }

  /**
   * Logs an application/runtime error with optional request details
   */
  public static async logError(
    error: Error | string,
    meta?: {
      severity?: "low" | "medium" | "high" | "critical";
      requestPath?: string;
      requestMethod?: string;
      requestBody?: any;
      userId?: number;
    }
  ): Promise<void> {
    const errMsg = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;
    const severity = meta?.severity || "low";

    try {
      await db.insert(schema.errorLogs).values({
        errorMessage: errMsg,
        stackTrace: stack || null,
        severity,
        requestPath: meta?.requestPath || null,
        requestMethod: meta?.requestMethod || null,
        requestBody: meta?.requestBody ? meta.requestBody : null,
        userId: meta?.userId || null,
      });
      console.error(`[ERROR LOG] [${severity.toUpperCase()}] ${errMsg}`);

      if (severity === "critical" || severity === "high") {
        // Trigger Critical Alert (can log to console or simulate Slack/Webhooks)
        console.warn(`🚨 CENTRAL ALERTS SYSTEM: Critical alert triggered! Error: ${errMsg}`);
      }
    } catch (err: any) {
      console.error("Failed to write error log to database:", err.message);
    }
  }

  /**
   * Logs a security or authentication event
   */
  public static async logSecurity(
    eventType: string,
    description: string,
    meta?: {
      ipAddress?: string;
      userAgent?: string;
      userId?: number;
    }
  ): Promise<void> {
    try {
      await db.insert(schema.securityLogs).values({
        eventType,
        description,
        ipAddress: meta?.ipAddress || null,
        userAgent: meta?.userAgent || null,
        userId: meta?.userId || null,
      });
      console.warn(`[SECURITY LOG] [${eventType}] ${description}`);
    } catch (err: any) {
      console.error("Failed to write security log to database:", err.message);
    }
  }

  /**
   * Logs API execution details and response latency
   */
  public static async logApi(
    method: string,
    path: string,
    statusCode: number,
    executionTimeMs: number,
    meta?: {
      ipAddress?: string;
      userAgent?: string;
      userId?: any;
    }
  ): Promise<void> {
    try {
      const safeMethod = typeof method === "string" ? method : "UNKNOWN";
      const safePath = typeof path === "string" ? path : "/";
      const safeStatusCode = typeof statusCode === "number" && !isNaN(statusCode) ? statusCode : 200;
      const safeExecutionTimeMs = typeof executionTimeMs === "number" && !isNaN(executionTimeMs) ? executionTimeMs : 0;

      let safeUserId: number | null = null;
      if (meta?.userId !== undefined && meta?.userId !== null) {
        const parsed = Number(meta.userId);
        if (!isNaN(parsed) && Number.isInteger(parsed)) {
          safeUserId = parsed;
        }
      }

      await db.insert(schema.apiLogs).values({
        method: safeMethod,
        path: safePath,
        statusCode: safeStatusCode,
        executionTimeMs: safeExecutionTimeMs,
        ipAddress: typeof meta?.ipAddress === "string" ? meta.ipAddress : null,
        userAgent: typeof meta?.userAgent === "string" ? meta.userAgent : null,
        userId: safeUserId,
      });
    } catch (err: any) {
      console.error("Failed to write API log to database:", err);
    }
  }

  /**
   * Logs a background job process execution
   */
  public static async logJob(
    queueName: string,
    jobId: string,
    jobName: string,
    status: "COMPLETED" | "FAILED",
    durationMs?: number,
    attempts?: number,
    error?: string
  ): Promise<void> {
    try {
      await db.insert(schema.jobLogs).values({
        queueName,
        jobId,
        jobName,
        status,
        durationMs: durationMs || null,
        attempts: attempts || 1,
        error: error || null,
      });
      console.log(`[JOB LOG] [${queueName}] Job #${jobId} (${jobName}) finished with status: ${status}`);
    } catch (err: any) {
      console.error("Failed to write job log to database:", err.message);
    }
  }
}
