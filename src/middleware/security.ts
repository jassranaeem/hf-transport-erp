import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { LoggerService } from "../logger/logger.ts";
import { IS_PROD, corsOrigins } from "../config/env.ts";

/**
 * Request IDs middleware
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const reqId = req.headers["x-request-id"] || `req-${Math.random().toString(36).substring(2, 11)}`;
  req.headers["x-request-id"] = reqId;
  res.setHeader("x-request-id", reqId);
  next();
}

/**
 * XSS Sanitization Middleware
 */
import { filterXSS } from "xss";

export function xssSanitizeMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === "string") {
        req.body[key] = filterXSS(req.body[key]);
      }
    }
  }
  if (req.query) {
    for (const key in req.query) {
      if (typeof req.query[key] === "string") {
        req.query[key] = filterXSS(req.query[key] as string);
      }
    }
  }
  next();
}

/**
 * API Request Logger Middleware
 */
export function apiLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  
  res.on("finish", async () => {
    const duration = Date.now() - start;
    const userId = (req as any).user?.id || null;
    const statusCode = res.statusCode;

    // Log the API details to PostgreSQL
    await LoggerService.logApi(
      req.method,
      req.originalUrl || req.url,
      statusCode,
      duration,
      {
        ipAddress: req.ip || req.socket.remoteAddress || undefined,
        userAgent: req.headers["user-agent"] || undefined,
        userId: userId || undefined,
      }
    );
  });
  next();
}

/**
 * Global API rate limiter. Generous, because an authenticated ERP dashboard
 * legitimately polls a lot; it exists to stop abuse, not normal use. Device
 * telemetry (/api/tracking/ingest, /api/tracking/traccar) is exempt - it has
 * its own token auth and can be high volume.
 */
export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: Number(process.env.RATE_LIMIT_PER_MIN) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
  skip: (req) =>
    req.path.startsWith("/tracking/ingest") || req.path.startsWith("/tracking/traccar"),
});

export const authRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please slow down." },
});

/**
 * Unified Centralized Express Error Interceptor
 */
export async function centralErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const statusCode = err.status || err.statusCode || 500;
  const severity = statusCode >= 500 ? "high" : "low";
  const userId = (req as any).user?.id || null;

  // Full detail always goes to the log store.
  try {
    await LoggerService.logError(err, {
      severity,
      requestPath: req.originalUrl || req.url,
      requestMethod: req.method,
      requestBody: req.body ? req.body : null,
      userId: userId || undefined,
    });
  } catch {
    console.error("[errorHandler] failed to persist error:", err?.message || err);
  }

  // In production, never leak internal messages / stack for 5xx to the client.
  const isServerError = statusCode >= 500;
  const clientMessage =
    IS_PROD && isServerError
      ? "An internal error occurred. Reference the request id when contacting support."
      : err.message || "An unexpected error occurred";

  if (res.headersSent) return next(err);
  res.status(statusCode).json({
    error: clientMessage,
    requestId: req.headers["x-request-id"] || null,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Configures global middleware security chain on Express App
 */
export function configureSecurity(app: any) {
  const isProd = IS_PROD;

  // Content-Security-Policy.
  // helmet's default CSP blocks everything cross-origin, which breaks
  // (a) "Sign in with Google" (Google Identity Services), (b) the map tiles
  // on the live map, (c) the socket.io upgrade. We start from helmet's
  // safe defaults and open up only what this app actually talks to. In
  // development it is disabled so Vite's HMR / eval bundling keeps working.
  const base = helmet.contentSecurityPolicy.getDefaultDirectives();
  const csp = {
    ...base,
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      // Esri ArcGIS Online — street/satellite/topographic map tiles. NOT the
      // raw OpenStreetMap tile server: that one 403s real app traffic per its
      // own usage policy (osm.wiki/Blocked), and CARTO's "free" basemap tiles
      // (tried next) turned out to nag for a signup API key too. Esri's
      // service needs no key and is already relied on for the other layers.
      "https://server.arcgisonline.com",
      "https://*.googleusercontent.com", // Google profile pictures
    ],
    "connect-src": [
      "'self'",
      "https://accounts.google.com",
      "https://oauth2.googleapis.com",
      "https://www.googleapis.com",
      "ws:",
      "wss:",
    ],
    "script-src": [
      "'self'",
      "https://accounts.google.com/gsi/client",
      "https://www.gstatic.com",
    ],
    "frame-src": [
      "'self'",
      "https://accounts.google.com",
    ],
    "style-src": ["'self'", "'unsafe-inline'", "https://accounts.google.com/gsi/style", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    "worker-src": ["'self'", "blob:"],
  };
  delete (csp as Record<string, unknown>)["upgrade-insecure-requests"]; // allow http://localhost during self-hosting

  app.use(
    helmet({
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: isProd ? { directives: csp } : false,
      // 180-day HSTS in production (served over HTTPS behind the platform/nginx).
      hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
    })
  );

  // CORS: same-origin only unless an explicit allowlist is provided.
  const allowlist = corsOrigins();
  const isLocalhostOrigin = (origin: string) =>
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
  if (isProd && allowlist.length > 0) {
    app.use(
      cors({
        origin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
          // non-browser / same-origin requests have no Origin header
          if (!origin || allowlist.includes(origin.replace(/\/$/, ""))) return cb(null, true);
          cb(new Error(`Origin ${origin} not allowed by CORS`));
        },
        credentials: true,
      })
    );
  } else if (!isProd) {
    // dev: allow the configured allowlist AND any localhost origin (the Vite
    // dev port varies, and the in-app browser attaches an Origin header even
    // for same-origin requests).
    app.use(
      cors({
        origin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
          if (!origin || isLocalhostOrigin(origin) || allowlist.includes(origin.replace(/\/$/, "")))
            return cb(null, true);
          cb(new Error(`Origin ${origin} not allowed by CORS`));
        },
        credentials: true,
      })
    );
  }
  // In production with no allowlist: no CORS middleware => browser blocks
  // cross-origin, which is the safe default for a single-origin app.

  app.use(requestIdMiddleware);
  app.use(xssSanitizeMiddleware);
  app.use(apiLoggingMiddleware);
}
