/**
 * Native authentication for HF Transport ERP.
 *
 * Replaces Firebase Auth with a self-hosted system:
 *   - email + password (bcrypt) accounts
 *   - "Sign in with Google" via Google Identity Services (verify the Google
 *     ID token against Google's public certs - no client secret needed)
 *   - stateless sessions: the server issues a signed JWT the browser sends as
 *     `Authorization: Bearer <token>` (same wire format the app already used).
 *
 * The Super Admin is whoever logs in as SUPER_ADMIN_EMAIL
 * (default jassranaeem@gmail.com) - see getOrCreateUser in ../../db/users.ts.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

export const SUPER_ADMIN_EMAIL = (
  process.env.SUPER_ADMIN_EMAIL || "jassranaeem@gmail.com"
).toLowerCase();

/** Roles a new user may request at sign-up (Super Admin is never requestable). */
export const REQUESTABLE_ROLES = [
  "Admin",
  "Operations Manager",
  "Fleet Manager",
  "Dispatcher",
  "Finance Manager",
  "Accountant",
  "HR Manager",
  "Fuel Manager",
  "Workshop Manager",
  "Auditor",
  "Driver",
  "Viewer",
] as const;

export function isRequestableRole(role: unknown): role is (typeof REQUESTABLE_ROLES)[number] {
  return typeof role === "string" && (REQUESTABLE_ROLES as readonly string[]).includes(role);
}

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "production"
    ? ""
    : "dev-insecure-jwt-secret-change-me");

if (!JWT_SECRET) {
  console.error(
    "\n[auth] FATAL: JWT_SECRET is not set. Generate one with:\n" +
      "        node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"\n" +
      "      and put it in .env.local before starting in production.\n"
  );
  process.exit(1);
}

const JWT_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS) || 7 * 24 * 60 * 60; // 7 days
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

// -------------------------------------------------------------------------
// passwords
// -------------------------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function passwordProblem(pw: string): string | null {
  if (typeof pw !== "string" || pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 200) return "Password is too long.";
  return null;
}

export function emailProblem(email: string): string | null {
  if (typeof email !== "string") return "Email is required.";
  const e = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "Enter a valid email address.";
  if (e.length > 200) return "Email is too long.";
  return null;
}

// -------------------------------------------------------------------------
// JWT sessions
// -------------------------------------------------------------------------

export interface SessionClaims {
  uid: string;
  email: string;
}

export function issueSession(claims: SessionClaims): { token: string; expiresIn: number } {
  const token = jwt.sign(claims, JWT_SECRET, { expiresIn: JWT_TTL_SECONDS });
  return { token, expiresIn: JWT_TTL_SECONDS };
}

export function verifySession(token: string): SessionClaims | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    if (!decoded || typeof decoded.uid !== "string" || typeof decoded.email !== "string") {
      return null;
    }
    return { uid: decoded.uid, email: decoded.email };
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------
// Google Sign-In
// -------------------------------------------------------------------------

let googleClient: OAuth2Client | null = null;
function getGoogleClient() {
  if (!googleClient) googleClient = new OAuth2Client(GOOGLE_CLIENT_ID || undefined);
  return googleClient;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export function isGoogleConfigured() {
  return !!GOOGLE_CLIENT_ID;
}

export function googleClientId() {
  return GOOGLE_CLIENT_ID;
}

/** Verify a Google Identity Services ID token and return the profile. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Google sign-in is not configured on the server (GOOGLE_CLIENT_ID missing).");
  }
  const ticket = await getGoogleClient().verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  });
  const p = ticket.getPayload();
  if (!p || !p.sub || !p.email) throw new Error("Invalid Google token.");
  return {
    sub: p.sub,
    email: p.email.toLowerCase(),
    emailVerified: !!p.email_verified,
    name: p.name || p.given_name || null,
    picture: p.picture || null,
  };
}

// -------------------------------------------------------------------------
// misc
// -------------------------------------------------------------------------

export function newUid() {
  return crypto.randomUUID();
}

/** A short, human-typeable temporary password (for admin resets). */
export function tempPassword() {
  return "Hf-" + crypto.randomBytes(6).toString("base64url") + "-26";
}
