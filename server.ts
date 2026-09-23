// MUST be first: loads .env.local / .env in development and validates config
// before any module that reads process.env at import time.
import { assertCoreEnv, IS_PROD, trustProxySetting, jwtSecretFingerprint } from "./src/config/env.ts";

import express from "express";
import fs from "fs";
import path from "path";
import { createServer } from "http";
import apiRouter from "./server/routes.ts";
import authRouter from "./server/auth.ts";
import enterpriseRouter from "./server/enterprise.ts";
import operationsRouter from "./server/operations.ts";
import financeRouter from "./server/finance.ts";
import hrRouter from "./server/hr.ts";
import geminiRouter from "./server/gemini.ts";
import maintenanceRouter from "./server/maintenance.ts";
import fuelRouter from "./server/fuel.ts";
import partnershipsRouter from "./server/partnerships.ts";
import ledgersRouter from "./server/ledgers.ts";
import partiesRouter from "./server/parties.ts";
import attachmentsRouter from "./server/attachments.ts";
import dataioRouter from "./server/dataio.ts";
import entitiesRouter from "./server/entities.ts";
import alertsRouter from "./server/alerts.ts";
import { smsRouter } from "./server/sms.ts";
import reportsRouter from "./server/reports.ts";
import partnerPnlRouter from "./server/partner_pnl.ts";
import personalExpensesRouter from "./server/personal_expenses.ts";
import zakatRouter from "./server/zakat.ts";
import { cashBookRouter } from "./server/cash_book.ts";
import quotationsRouter from "./server/quotations.ts";
import trackingRouter, { startTrackingSweep } from "./server/tracking.ts";
import { systemResetRouter } from "./server/system_reset.ts";
import { configureSecurity, centralErrorHandler, globalRateLimiter } from "./src/middleware/security.ts";
import { SocketServer } from "./src/sockets/socket.ts";
import { CronScheduler } from "./src/scheduler/cron.ts";
import { ensureSuperAdminExists } from "./src/db/users.ts";
import { runMigrations } from "./src/db/migrate.ts";
import { pool } from "./src/db/index.ts";
import { initRBAC } from "./server/rbac_service.ts";
import { requireAuth, requireApproved } from "./src/middleware/auth.ts";

const BODY_LIMIT = process.env.BODY_LIMIT || "5mb";

async function startServer() {
  assertCoreEnv();

  const app = express();
  const httpServer = createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  // Correct client IP behind a load balancer / Nginx / Render / Cloud Run.
  app.set("trust proxy", trustProxySetting());
  app.disable("x-powered-by");

  // Ensure the attachments upload directory exists.
  try {
    const { UPLOADS_DIR } = await import("./server/attachments.ts");
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  } catch (e) {
    console.warn("[server] could not create uploads dir:", (e as Error).message);
  }

  // Apply pending database migrations (safe no-op if already applied).
  await runMigrations();

  // Ensure the Super Admin account exists, then load RBAC.
  await ensureSuperAdminExists();
  await initRBAC();

  // Security headers, CORS, request-id, XSS sanitiser, API logging.
  configureSecurity(app);

  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

  // Lightweight liveness probe for platforms (no DB, no auth).
  app.get(["/healthz", "/livez"], (_req, res) => res.type("text/plain").status(200).send("ok"));

  // Real-time layer + schedulers.
  SocketServer.init(httpServer);
  CronScheduler.init();
  startTrackingSweep();

  // API routes (rate-limited).
  app.use("/api", globalRateLimiter);
  app.use("/api/auth", authRouter); // native auth - before the /api catch-all
  app.use("/api", apiRouter);
  app.use("/api/enterprise", requireAuth, requireApproved, enterpriseRouter);
  app.use("/api/operations", requireAuth, requireApproved, operationsRouter);
  app.use("/api/finance", requireAuth, requireApproved, financeRouter);
  app.use("/api/hr", requireAuth, requireApproved, hrRouter);
  app.use("/api/gemini", requireAuth, requireApproved, geminiRouter);
  app.use("/api/maintenance", requireAuth, requireApproved, maintenanceRouter);
  app.use("/api/fuel", requireAuth, requireApproved, fuelRouter);
  app.use("/api/partnerships", requireAuth, requireApproved, partnershipsRouter);
  app.use("/api/ledgers", requireAuth, requireApproved, ledgersRouter);
  app.use("/api/parties", requireAuth, requireApproved, partiesRouter);
  app.use("/api/attachments", requireAuth, requireApproved, attachmentsRouter);
  app.use("/api/data", dataioRouter);
  app.use("/api/entities", requireAuth, requireApproved, entitiesRouter);
  app.use("/api/alerts", alertsRouter);
  app.use("/api/sms", smsRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/partner-pnl", partnerPnlRouter);
  app.use("/api/personal-expenses", personalExpensesRouter);
  app.use("/api/zakat", zakatRouter);
  app.use("/api/cash-book", cashBookRouter);
  app.use("/api/quotations", quotationsRouter);
  app.use("/api/tracking", trackingRouter);
  app.use("/api/system", systemResetRouter);

  // Unknown API path -> JSON 404 (never fall through to the SPA).
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  if (!IS_PROD) {
    // Dev: Vite middleware (dynamically imported so `vite` is not required in prod).
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : { server: httpServer },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Prod: serve the built SPA.
    const distPath = path.join(process.cwd(), "dist");
    if (!fs.existsSync(path.join(distPath, "index.html"))) {
      console.error(
        `[server] FATAL: ${distPath}/index.html not found. Run \`npm run build\` before \`npm start\`.`
      );
      process.exit(1);
    }
    const assetsDir = path.join(distPath, "assets") + path.sep;
    app.use(
      express.static(distPath, {
        setHeaders(res, filePath) {
          // Vite hashes everything under /assets -> cache hard & immutable.
          if (filePath.startsWith(assetsDir)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else if (filePath.endsWith("index.html") || filePath.endsWith("sw.js")) {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      })
    );
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  // Central error handler (after everything).
  app.use(centralErrorHandler);

  await new Promise<void>((resolve) => httpServer.listen(PORT, "0.0.0.0", resolve));
  console.log(
    `[ERP] listening on 0.0.0.0:${PORT} | env=${process.env.NODE_ENV || "development"} | jwt=${jwtSecretFingerprint()}`
  );

  // ---- graceful shutdown ----
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[ERP] ${signal} received - shutting down...`);
    const timer = setTimeout(() => {
      console.error("[ERP] forced exit after 15s");
      process.exit(1);
    }, 15_000);
    timer.unref();
    try {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      try { await SocketServer.close?.(); } catch {}
      try { CronScheduler.stop?.(); } catch {}
      try { await pool.end(); } catch {}
      console.log("[ERP] clean shutdown complete");
      process.exit(0);
    } catch (err) {
      console.error("[ERP] error during shutdown:", err);
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

process.on("unhandledRejection", (reason) => {
  console.error("[ERP] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[ERP] Uncaught exception - exiting:", err);
  process.exit(1);
});

startServer().catch((err) => {
  console.error("[ERP] Critical: failed to start:", err);
  process.exit(1);
});
