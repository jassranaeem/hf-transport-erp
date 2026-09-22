/**
 * Centralised environment loader + production guardrails.
 *
 * IMPORTANT: this module must be imported *before* any module that reads
 * `process.env` at import time (db pool, auth, gemini client). In `server.ts`
 * it is the very first import for exactly this reason.
 *
 * In development it loads `.env.local` then `.env`. In production nothing is
 * loaded from disk - the platform (Docker, Render, Cloud Run, systemd) injects
 * real environment variables, which always win.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";

export const IS_PROD = process.env.NODE_ENV === "production";

// Real env vars always win; files only fill what is still missing.
if (!IS_PROD) {
  const loadedFrom: string[] = [];
  for (const file of [".env.local", ".env"]) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      dotenv.config({ path: fullPath, quiet: true });
      loadedFrom.push(file);
    }
  }
  console.log(
    loadedFrom.length
      ? `[env] Loaded environment from: ${loadedFrom.join(", ")}`
      : "[env] No .env file found - relying on injected process.env."
  );
} else {
  console.log("[env] production mode - using injected environment only.");
}

function fatal(msg: string): never {
  console.error(`\n[env] FATAL: ${msg}\n`);
  process.exit(1);
}

const WEAK_JWT_SECRETS = new Set([
  "",
  "dev-insecure-jwt-secret-change-me",
  "changeme",
  "secret",
]);

/**
 * Validate configuration. Boots the app in dev with warnings; refuses to start
 * in production if anything is unsafe.
 */
export function assertCoreEnv() {
  // --- database (always required) ---
  const hasDbUrl = !!process.env.DATABASE_URL;
  const hasDiscreteDb =
    !!process.env.SQL_HOST && !!process.env.SQL_USER && !!process.env.SQL_DB_NAME;
  if (!hasDbUrl && !hasDiscreteDb) {
    fatal(
      "No database configuration. Set DATABASE_URL (recommended), or " +
        "SQL_HOST + SQL_USER + SQL_PASSWORD + SQL_DB_NAME."
    );
  }

  // --- JWT session secret ---
  const jwt = process.env.JWT_SECRET || "";
  if (IS_PROD) {
    if (WEAK_JWT_SECRETS.has(jwt) || jwt.length < 32) {
      fatal(
        "JWT_SECRET must be a strong random string (>= 32 chars) in production.\n" +
          "       node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
      );
    }
  } else if (!jwt) {
    console.warn("[env] WARNING: JWT_SECRET not set - using an insecure dev default.");
  }

  // --- dev-only auth bypass must never be on in production ---
  if (IS_PROD && process.env.DEV_AUTH_BYPASS === "true") {
    fatal("DEV_AUTH_BYPASS=true is set with NODE_ENV=production. Remove it.");
  }

  // --- super admin ---
  if (IS_PROD && !process.env.SUPER_ADMIN_PASSWORD && !process.env.SUPER_ADMIN_PASSWORD_HASH) {
    console.warn(
      "[env] WARNING: no SUPER_ADMIN_PASSWORD set. A random password will be " +
        "generated and printed to the logs on first boot - capture it, then rotate it."
    );
  }

  // --- reverse proxy awareness (needed for correct client IPs / rate limiting) ---
  if (IS_PROD && !process.env.TRUST_PROXY) {
    console.warn(
      "[env] INFO: TRUST_PROXY not set. If you run behind a load balancer / Nginx / " +
        "Render / Cloud Run, set TRUST_PROXY=1 so rate-limiting and audit logs see real client IPs."
    );
  }

  // --- CORS ---
  if (IS_PROD && !process.env.CORS_ORIGINS && !process.env.APP_URL) {
    console.warn(
      "[env] INFO: neither CORS_ORIGINS nor APP_URL set - cross-origin browser " +
        "requests will be rejected (same-origin only). Set CORS_ORIGINS to a comma-separated allowlist if needed."
    );
  }

  // --- informational ---
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn("[env] INFO: GOOGLE_CLIENT_ID not set - 'Sign in with Google' is disabled.");
  }
  if (!process.env.GEMINI_API_KEY) {
    console.warn("[env] WARNING: GEMINI_API_KEY not set - AI features will fail.");
  }
  if (IS_PROD && !process.env.REDIS_URL) {
    console.warn(
      "[env] WARNING: REDIS_URL not set - cache and background queues use an in-memory " +
        "fallback. Fine for a single instance; set REDIS_URL before scaling horizontally."
    );
  }
}

/** Parse the CORS allowlist. Empty => same-origin only. */
export function corsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS || process.env.APP_URL || "";
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/** `trust proxy` value for Express, from TRUST_PROXY env. */
export function trustProxySetting(): boolean | number | string {
  const v = process.env.TRUST_PROXY;
  if (!v) return false;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v; // e.g. "loopback, linklocal, uniquelocal" or a subnet
}

/** Stable fingerprint of the JWT secret - lets you see at a glance if it changed. */
export function jwtSecretFingerprint(): string {
  return crypto
    .createHash("sha256")
    .update(process.env.JWT_SECRET || "unset")
    .digest("hex")
    .slice(0, 8);
}
