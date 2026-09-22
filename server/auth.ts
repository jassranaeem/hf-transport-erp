/**
 * Native authentication API (replaces Firebase Auth).
 *
 *   POST /api/auth/register        { email, password, name?, phone?, department? }
 *   POST /api/auth/login           { email, password }
 *   POST /api/auth/google          { credential }         (Google ID token from GIS)
 *   GET  /api/auth/me
 *   POST /api/auth/logout
 *   POST /api/auth/change-password { currentPassword, newPassword }
 *   GET  /api/auth/config          -> { googleClientId }  (public, for the GIS button)
 *
 * Sessions are stateless JWTs returned as { token } and sent back by the client
 * as `Authorization: Bearer <token>`.
 */
import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, AuthRequest } from "../src/middleware/auth.ts";
import {
  getUserByEmail,
  registerLocalUser,
  getOrCreateUser,
  touchLastLogin,
  ensureSuperAdminRole,
  setUserPassword,
  setRequestedRole,
} from "../src/db/users.ts";
import {
  hashPassword,
  verifyPassword,
  passwordProblem,
  emailProblem,
  issueSession,
  verifyGoogleIdToken,
  isGoogleConfigured,
  googleClientId,
  REQUESTABLE_ROLES,
  isRequestableRole,
} from "../src/lib/auth/index.ts";
import { logAudit } from "../src/db/audit.ts";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please wait a few minutes." },
});

function publicUser(u: any) {
  return {
    id: u.id,
    uid: u.uid,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    phone: u.phone,
    department: u.department,
    authProvider: u.authProvider,
    requestedRole: u.requestedRole ?? null,
  };
}

const ipOf = (req: Request) => req.ip || req.socket.remoteAddress || undefined;
const uaOf = (req: Request) => (req.headers["user-agent"] as string) || undefined;

// ---------------------------------------------------------------------------

router.get("/config", (_req, res: Response) => {
  res.json({
    googleClientId: isGoogleConfigured() ? googleClientId() : null,
    requestableRoles: REQUESTABLE_ROLES,
  });
});

router.post("/register", authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, name, phone, department, requestedRole } = req.body || {};
    const eProb = emailProblem(email);
    if (eProb) return res.status(400).json({ error: eProb });
    const pProb = passwordProblem(password);
    if (pProb) return res.status(400).json({ error: pProb });
    if (requestedRole && !isRequestableRole(requestedRole)) {
      return res.status(400).json({ error: "Invalid requested role." });
    }

    const passwordHash = await hashPassword(password);
    const user = await registerLocalUser({
      email,
      passwordHash,
      name: name?.trim() || null,
      phone: phone?.trim() || null,
      department: department?.trim() || null,
      requestedRole: requestedRole || null,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });

    const { token, expiresIn } = issueSession({ uid: user.uid, email: user.email });
    res.json({
      token,
      expiresIn,
      user: publicUser(user),
      message:
        user.role === "Super Admin"
          ? "Account created."
          : "Account created. Access is pending administrator approval.",
    });
  } catch (err: any) {
    if (err.code === "EMAIL_TAKEN") return res.status(409).json({ error: err.message });
    res.status(500).json({ error: err.message || "Registration failed" });
  }
});

router.post("/login", authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    let user = await getUserByEmail(String(email));
    // Constant-ish response: always run a hash compare
    const ok = user ? await verifyPassword(String(password), user.passwordHash) : await verifyPassword(String(password), null);
    if (!user || !ok) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    if (!user.passwordHash) {
      return res.status(401).json({ error: "This account uses Google sign-in. Use the Google button." });
    }

    user = await ensureSuperAdminRole(user);
    await touchLastLogin(user.id);
    await logAudit({
      action: "LOGIN",
      performedBy: user.id,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });

    const { token, expiresIn } = issueSession({ uid: user.uid, email: user.email });
    res.json({ token, expiresIn, user: publicUser(user) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Login failed" });
  }
});

router.post("/google", authLimiter, async (req: Request, res: Response) => {
  try {
    const { credential, requestedRole } = req.body || {};
    if (!credential) return res.status(400).json({ error: "Missing Google credential." });
    if (!isGoogleConfigured()) {
      return res.status(400).json({ error: "Google sign-in is not configured on the server." });
    }
    if (requestedRole && !isRequestableRole(requestedRole)) {
      return res.status(400).json({ error: "Invalid requested role." });
    }

    const profile = await verifyGoogleIdToken(String(credential));
    if (!profile.emailVerified) {
      return res.status(401).json({ error: "Your Google email is not verified." });
    }

    const user = await getOrCreateUser(
      `google:${profile.sub}`,
      profile.email,
      profile.name || undefined,
      ipOf(req),
      uaOf(req),
      undefined,
      undefined,
      "google",
      requestedRole || null
    );

    await touchLastLogin(user.id);
    await logAudit({ action: "LOGIN", performedBy: user.id, ipAddress: ipOf(req), userAgent: uaOf(req) });

    const { token, expiresIn } = issueSession({ uid: user.uid, email: user.email });
    res.json({ token, expiresIn, user: publicUser(user) });
  } catch (err: any) {
    res.status(401).json({ error: err.message || "Google sign-in failed" });
  }
});

router.get("/me", requireAuth, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// A still-pending user tells the admin which role they need.
router.post("/request-role", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { requestedRole } = req.body || {};
    if (!isRequestableRole(requestedRole)) {
      return res.status(400).json({ error: "Choose a valid role." });
    }
    if (req.user!.status === "Approved") {
      return res.status(400).json({ error: "Your account is already approved." });
    }
    await setRequestedRole(req.user!.id, requestedRole);
    await logAudit({
      action: "UPDATE",
      tableName: "users",
      recordId: req.user!.id,
      newValues: { requestedRole },
      performedBy: req.user!.id,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    res.json({ message: `Role request submitted: ${requestedRole}. An administrator will review it.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Could not submit role request" });
  }
});

router.post("/logout", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await logAudit({
      action: "LOGOUT",
      performedBy: req.user!.id,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
  } catch {
    /* best effort */
  }
  res.json({ message: "Signed out. Discard the token client-side." });
});

router.post("/change-password", requireAuth, authLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const pProb = passwordProblem(newPassword);
    if (pProb) return res.status(400).json({ error: pProb });

    const user = await getUserByEmail(req.user!.email);
    if (!user) return res.status(404).json({ error: "Account not found." });

    // If the account already has a password, require the current one.
    if (user.passwordHash) {
      const ok = await verifyPassword(String(currentPassword || ""), user.passwordHash);
      if (!ok) return res.status(401).json({ error: "Current password is incorrect." });
    }

    await setUserPassword(user.id, String(newPassword));
    await logAudit({
      action: "UPDATE",
      tableName: "users",
      recordId: user.id,
      oldValues: { action: "password_change" },
      newValues: { action: "password_changed" },
      performedBy: user.id,
      ipAddress: ipOf(req),
      userAgent: uaOf(req),
    });
    res.json({ message: "Password updated." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Could not update password" });
  }
});

export default router;
