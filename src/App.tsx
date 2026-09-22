/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  enterpriseFetch,
  registerTokenGetter,
  setSessionToken,
  getStoredToken,
} from "../client/api.ts";
import { DbUser, AuditLog, HealthStatus } from "./types.ts";
import WorkbookShell from "./components/workbook/WorkbookShell.tsx";
import { 
  motion, 
  AnimatePresence 
} from "motion/react";
import { 
  Shield, 
  LogOut, 
  Activity, 
  Users, 
  Database, 
  RefreshCw, 
  Search, 
  Filter, 
  ChevronRight, 
  UserCheck, 
  Trash2,
  Globe,
  Clock, 
  CheckCircle, 
  AlertTriangle 
} from "lucide-react";

// Google Identity Services global (loaded from accounts.google.com/gsi/client)
declare global {
  interface Window {
    google?: any;
  }
}

export default function App() {
  const [dbUser, setDbUser] = useState<DbUser | null>(null);
  const googleInited = useRef(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [requestableRoles, setRequestableRoles] = useState<string[]>([]);
  const [requestedRoleInput, setRequestedRoleInput] = useState("");
  const requestedRoleRef = useRef("");
  useEffect(() => { requestedRoleRef.current = requestedRoleInput; }, [requestedRoleInput]);
  const [roleSubmitting, setRoleSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [mainTab, setMainTab] = useState<"rbac" | "infrastructure">("rbac");

  // Registration & Login Form State
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [departmentInput, setDepartmentInput] = useState("Fleet Operations");
  const [authLoading, setAuthLoading] = useState(false);
  
  // Users List State
  const [usersList, setUsersList] = useState<DbUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersSearch, setUsersSearch] = useState("");
  const [usersRoleFilter, setUsersRoleFilter] = useState("");
  const [usersLimit] = useState(5);
  const [usersOffset, setUsersOffset] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);

  // Audit Logs State
  const [auditLogsList, setAuditLogsList] = useState<AuditLog[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [auditLimit] = useState(10);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  
  // Selected log for detailed values view
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Error/Success banner state
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Restore an existing session from the stored token, and prime Google sign-in.
  useEffect(() => {
    (async () => {
      const token = getStoredToken();
      if (token) {
        // A transient hiccup (rate-limited, a mid-deploy restart, a network
        // blip) must not look like a logout: retry once before giving up, and
        // even then only ever clear the stored token on a genuine 401 - never
        // on a 429/500/502/503 or a network error.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetch("/api/auth/me", {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              const data = await res.json();
              setDbUser(data.user);
              break;
            }
            if (res.status === 401) {
              setSessionToken(null); // genuinely invalid / expired token
              break;
            }
            if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
          } catch {
            if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
            /* offline - stay logged out, token kept for retry */
          }
        }
      }
      setLoading(false);
    })();

    initGoogleSignIn();
    fetchHealth();
  }, []);

  // Load Google Identity Services and configure the credential callback.
  const initGoogleSignIn = async () => {
    if (googleInited.current) return;
    try {
      const cfg = await fetch("/api/auth/config").then((r) => r.json());
      if (Array.isArray(cfg.requestableRoles)) setRequestableRoles(cfg.requestableRoles);
      if (!cfg.googleClientId) return; // Google not configured -> button stays hidden
      await new Promise<void>((resolve, reject) => {
        if (window.google?.accounts?.id) return resolve();
        const s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load Google Sign-In"));
        document.head.appendChild(s);
      });
      window.google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: async (resp: any) => {
          // requested role only matters for a first-time Google sign-up
          await completeAuth("/api/auth/google", {
            credential: resp.credential,
            requestedRole: requestedRoleRef.current || undefined,
          });
        },
      });
      googleInited.current = true;
      setGoogleReady(true);
    } catch (err) {
      console.warn("[Auth] Google sign-in unavailable:", err);
    }
  };

  const submitRoleRequest = async () => {
    if (!requestedRoleInput) {
      showFeedback("error", "Please choose the role you're requesting.");
      return;
    }
    setRoleSubmitting(true);
    try {
      const data = await enterpriseFetch("/api/auth/request-role", {
        method: "POST",
        body: JSON.stringify({ requestedRole: requestedRoleInput }),
      });
      showFeedback("success", data.message || "Role request submitted.");
      await reloadUserProfile();
    } catch (err: any) {
      showFeedback("error", err.message || "Could not submit role request");
    } finally {
      setRoleSubmitting(false);
    }
  };

  // Shared: POST to an auth endpoint, store the token, load the user.
  const completeAuth = async (
    path: string,
    body: Record<string, unknown>
  ): Promise<boolean> => {
    setAuthLoading(true);
    setLoading(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      setSessionToken(data.token);
      registerTokenGetter(async () => data.token); // ensure immediate calls carry it
      setDbUser(data.user);
      showFeedback("success", data.message || `Signed in as ${data.user.email}`);
      return true;
    } catch (err: any) {
      showFeedback("error", err.message || "Authentication failed");
      return false;
    } finally {
      setAuthLoading(false);
      setLoading(false);
    }
  };

  // Fetch admin lists (user & audit management is Super Admin only).
  const isSuperAdmin = dbUser?.role === "Super Admin";
  useEffect(() => {
    if (isSuperAdmin) fetchUsers();
  }, [isSuperAdmin, usersOffset, usersSearch, usersRoleFilter]);

  useEffect(() => {
    if (isSuperAdmin) fetchAuditLogs();
  }, [isSuperAdmin, auditOffset, auditSearch, auditActionFilter]);

  const showFeedback = (type: "success" | "error", message: string) => {
    if (message && (message.includes("AbortError") || message.toLowerCase().includes("aborted") || message.includes("Abort"))) {
      console.warn("Ignoring aborted request error:", message);
      return;
    }
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback((prev) => (prev?.message === message ? null : prev));
    }, 5000);
  };

  const fetchHealth = async () => {
    setHealthLoading(true);
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      } else {
        setHealth(null);
      }
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  };

  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const queryParams = new URLSearchParams({
        limit: usersLimit.toString(),
        offset: usersOffset.toString(),
      });
      if (usersSearch) queryParams.append("search", usersSearch);
      if (usersRoleFilter) queryParams.append("role", usersRoleFilter);

      const res = await enterpriseFetch(`/api/users?${queryParams.toString()}`);
      setUsersList(res.data);
      setUsersTotal(res.pagination.total);
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to fetch users");
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const queryParams = new URLSearchParams({
        limit: auditLimit.toString(),
        offset: auditOffset.toString(),
      });
      if (auditSearch) queryParams.append("search", auditSearch);
      if (auditActionFilter) queryParams.append("action", auditActionFilter);

      const res = await enterpriseFetch(`/api/audit-logs?${queryParams.toString()}`);
      setAuditLogsList(res.data);
      setAuditTotal(res.pagination.total);
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to fetch audit logs");
    } finally {
      setAuditLoading(false);
    }
  };

  // Sign in with Google (Google Identity Services one-tap / prompt).
  const handleLogin = async () => {
    setAuthLoading(true);
    try {
      if (!googleInited.current) await initGoogleSignIn();
      if (!googleInited.current || !window.google?.accounts?.id) {
        showFeedback(
          "error",
          "Google sign-in is not configured. Ask the admin to set GOOGLE_CLIENT_ID, or use email + password."
        );
        return;
      }
      window.google.accounts.id.prompt((notif: any) => {
        if (notif?.isNotDisplayed?.() || notif?.isSkippedMoment?.()) {
          showFeedback("error", "Google prompt was dismissed. Try again or use email + password.");
        }
      });
    } catch (err: any) {
      showFeedback("error", err.message || "Google sign-in failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !passwordInput) {
      showFeedback("error", "Please enter both email and password.");
      return;
    }
    await completeAuth("/api/auth/login", { email: emailInput, password: passwordInput });
  };

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !passwordInput || !nameInput) {
      showFeedback("error", "Name, email and password are required.");
      return;
    }
    if (passwordInput.length < 8) {
      showFeedback("error", "Password must be at least 8 characters.");
      return;
    }
    await completeAuth("/api/auth/register", {
      email: emailInput,
      password: passwordInput,
      name: nameInput,
      phone: phoneInput,
      department: departmentInput,
      requestedRole: requestedRoleInput || undefined,
    });
  };

  const reloadUserProfile = async () => {
    setLoading(true);
    try {
      const data = await enterpriseFetch("/api/auth/me");
      setDbUser(data.user);
      showFeedback("success", `Current status: ${data.user.role}`);
    } catch (err: any) {
      console.error("Error reloading profile:", err);
      showFeedback("error", "Failed to refresh user profile.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      try {
        await enterpriseFetch("/api/auth/logout", { method: "POST" });
      } catch {
        /* best effort - audit only */
      }
      setSessionToken(null);
      registerTokenGetter(null);
      try {
        window.google?.accounts?.id?.disableAutoSelect?.();
      } catch {
        /* ignore */
      }
      setDbUser(null);
      setUsersList([]);
      setAuditLogsList([]);
      showFeedback("success", "Successfully logged out");
    } catch (err: any) {
      showFeedback("error", err.message || "Logout failed");
    }
  };

  const handleRoleChange = async (targetId: number, newRole: string, status?: string) => {
    try {
      await enterpriseFetch(`/api/users/${targetId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role: newRole, status }),
      });
      showFeedback("success", "User role and status updated successfully");
      fetchUsers();
      fetchAuditLogs(); // Refresh log timeline
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to update user role");
    }
  };

  const handleDeleteUser = async (targetId: number) => {
    if (!confirm("Are you sure you want to soft delete this user? They will lose platform access immediately.")) {
      return;
    }
    try {
      await enterpriseFetch(`/api/users/${targetId}`, {
        method: "DELETE",
      });
      showFeedback("success", "User soft deleted successfully");
      fetchUsers();
      fetchAuditLogs();
    } catch (err: any) {
      showFeedback("error", err.message || "Failed to delete user");
    }
  };

  const roles = [
    "Super Admin",
    "Admin",
    "Finance Manager",
    "HR Manager",
    "Fleet Manager",
    "Dispatcher",
    "Operations Manager",
    "Maintenance Manager",
    "Fuel Manager",
    "Auditor",
    "Accountant",
    "Driver",
    "Viewer",
    "Pending"
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-10 h-10 text-[#24539B] animate-spin" />
          <p className="font-sans text-xs font-semibold tracking-wider text-slate-500">LOADING ENTERPRISE SUITE...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased selection:bg-[#24539B]/10 selection:text-[#16305C]">
      
      {/* Toast Feedback Banner */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border ${
              feedback.type === "success" 
                ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
                : "bg-rose-50 border-rose-200 text-rose-800"
            }`}
          >
            {feedback.type === "success" ? (
              <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <span className="text-sm font-semibold">{feedback.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      {!dbUser ? (
        /* LOGIN / SIGNUP COMPONENT */
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-100 animate-fadeIn">
          <div className="max-w-md w-full">
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white border border-slate-200 rounded-2xl shadow-xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-[3px] bg-[#24539B]" />
              
              {/* Header */}
              <div className="p-8 pb-4 text-center border-b border-slate-100">
                <img src="/hfk-logo.png" alt="HFK Enterprises" className="h-14 w-auto mx-auto mb-3" />
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-sans">HFK Enterprises</h2>
                
                {/* Mode Selector Tab */}
                <div className="flex bg-slate-100 p-1 rounded-xl mt-6">
                  <button
                    onClick={() => { setAuthMode("login"); setFeedback(null); }}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
                      authMode === "login" 
                        ? "bg-white text-slate-900 shadow-sm" 
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => { setAuthMode("signup"); setFeedback(null); }}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition ${
                      authMode === "signup" 
                        ? "bg-white text-slate-900 shadow-sm" 
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Create Account
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="p-8 pt-6">
                {authMode === "login" ? (
                  /* SIGN IN FORM */
                  <form onSubmit={handleEmailLogin} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
                        Corporate Email Address
                      </label>
                      <input
                        type="email"
                        required
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder="e.g. yourname@hfkenterprisespvtltd.com"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#2C5CAE] focus:ring-1 focus:ring-[#2C5CAE] transition font-sans text-slate-900"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
                        Account Password
                      </label>
                      <input
                        type="password"
                        required
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#2C5CAE] focus:ring-1 focus:ring-[#2C5CAE] transition font-sans text-slate-900"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={authLoading}
                      className="w-full bg-[#24539B] hover:bg-[#1E4480] disabled:bg-[#7C99C4] text-white font-semibold py-3 px-4 rounded-xl shadow-sm text-sm transition cursor-pointer hover:scale-[1.01] active:scale-[0.99] mt-2"
                    >
                      {authLoading ? "Authorizing ERP Session..." : "Secure Sign In"}
                    </button>
                  </form>
                ) : (
                  /* SIGN UP / REGISTER FORM */
                  <form onSubmit={handleEmailSignup} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        placeholder="e.g. Captain James Vance"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#2C5CAE] focus:ring-1 focus:ring-[#2C5CAE] transition font-sans text-slate-900"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
                        Email Address
                      </label>
                      <input
                        type="email"
                        required
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder="e.g. jvance@hftransport.com"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#2C5CAE] focus:ring-1 focus:ring-[#2C5CAE] transition font-sans text-slate-900"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
                        Secure Password
                      </label>
                      <input
                        type="password"
                        required
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder="Min 8 characters"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#2C5CAE] focus:ring-1 focus:ring-[#2C5CAE] transition font-sans text-slate-900"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
                          Phone Number
                        </label>
                        <input
                          type="tel"
                          required
                          value={phoneInput}
                          onChange={(e) => setPhoneInput(e.target.value)}
                          placeholder="+1 (555) 0199"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#2C5CAE] focus:ring-1 focus:ring-[#2C5CAE] transition font-sans text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
                          Department
                        </label>
                        <select
                          value={departmentInput}
                          onChange={(e) => setDepartmentInput(e.target.value)}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#2C5CAE] focus:ring-1 focus:ring-[#2C5CAE] transition font-sans text-slate-900"
                        >
                          <option value="Fleet Operations">Fleet Operations</option>
                          <option value="Finance & Accounting">Finance & Accounting</option>
                          <option value="Human Resources">Human Resources</option>
                          <option value="Workshop & Maintenance">Workshop & Maintenance</option>
                          <option value="Logistics & Dispatch">Logistics & Dispatch</option>
                          <option value="Auditing">Auditing</option>
                          <option value="Administration">Administration</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
                        Requested Role
                      </label>
                      <select
                        required
                        value={requestedRoleInput}
                        onChange={(e) => setRequestedRoleInput(e.target.value)}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#2C5CAE] focus:ring-1 focus:ring-[#2C5CAE] transition font-sans text-slate-900"
                      >
                        <option value="">— Which role are you requesting? —</option>
                        {requestableRoles.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-400 mt-1">An administrator reviews and approves this.</p>
                    </div>

                    <button
                      type="submit"
                      disabled={authLoading}
                      className="w-full bg-[#24539B] hover:bg-[#1E4480] disabled:bg-[#7C99C4] text-white font-semibold py-3 px-4 rounded-xl shadow-sm text-sm transition cursor-pointer hover:scale-[1.01] active:scale-[0.99] mt-2"
                    >
                      {authLoading ? "Submitting Registration Request..." : "Request ERP Credentials"}
                    </button>
                  </form>
                )}

                {googleReady && (
                  <>
                    <div className="relative flex items-center justify-center my-6">
                      <div className="border-t border-slate-100 w-full" />
                      <span className="absolute bg-white px-3 text-[10px] uppercase font-mono tracking-widest text-slate-400">
                        or
                      </span>
                    </div>
                    {authMode === "signup" && !requestedRoleInput && (
                      <p className="text-[11px] text-amber-600 mb-2 text-center">
                        Pick a "Requested Role" above first, then continue with Google.
                      </p>
                    )}
                    <button
                      onClick={handleLogin}
                      disabled={authLoading}
                      className="w-full border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 font-semibold py-2.5 px-4 rounded-xl text-xs shadow-sm flex items-center justify-center gap-2.5 transition cursor-pointer"
                    >
                      <Globe className="w-4 h-4 text-slate-400" />
                      <span>{authLoading ? "Opening Google…" : "Continue with Google"}</span>
                    </button>
                  </>
                )}

                {/* Secure Notice */}
                <div className="border-t border-slate-100 mt-6 pt-5 text-center">
                  <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                    All signup requests default to a restricted <strong>Pending Approval</strong> state. The first registered system account is auto-escalated to <strong>Super Admin</strong>.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      ) : dbUser.role === "Pending" ? (
        /* PENDING APPROVAL VIEW */
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 animate-fadeIn">
          <div className="max-w-md w-full">
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white border border-amber-200 rounded-2xl p-8 shadow-xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-[3px] bg-amber-500" />
              <div className="text-center mb-6">
                <div className="inline-flex bg-amber-50 border border-amber-100 p-4 rounded-full mb-4">
                  <Shield className="w-8 h-8 text-amber-500" />
                </div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 font-sans">Account Activation Pending</h2>
                <p className="text-xs text-amber-600 font-semibold font-mono mt-1">Your account is awaiting administrator approval.</p>
                
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 mt-6 text-left">
                  <p className="text-sm text-slate-600 leading-relaxed font-sans">
                    Welcome to <strong>HFK Enterprises</strong>. Your profile has been created successfully, but access is restricted.
                  </p>
                  
                  <div className="mt-4 space-y-1.5 border-t border-slate-150 pt-3">
                    <p className="text-xs text-slate-500 font-mono">
                      Status: <span className="text-amber-600 font-bold uppercase">Pending Approval</span>
                    </p>
                    <p className="text-xs text-slate-500 font-mono">
                      Registered Email: <span className="text-[#24539B] font-semibold">{dbUser.email}</span>
                    </p>
                    {(dbUser as any).requestedRole ? (
                      <p className="text-xs text-slate-500 font-mono">
                        Requested Role: <span className="text-slate-700 font-semibold uppercase">{(dbUser as any).requestedRole}</span>
                        <span className="text-amber-600"> — awaiting approval</span>
                      </p>
                    ) : null}
                    {dbUser.department && (
                      <p className="text-xs text-slate-500 font-mono">
                        Department: <span className="text-slate-700 font-medium">{dbUser.department}</span>
                      </p>
                    )}
                  </div>

                  {!(dbUser as any).requestedRole && (
                    <div className="mt-4 border-t border-slate-150 pt-3">
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
                        Which role do you need?
                      </label>
                      <select
                        value={requestedRoleInput}
                        onChange={(e) => setRequestedRoleInput(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#2C5CAE]"
                      >
                        <option value="">— Select a role —</option>
                        {requestableRoles.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <button
                        onClick={submitRoleRequest}
                        disabled={roleSubmitting || !requestedRoleInput}
                        className="w-full mt-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-medium py-2 px-4 rounded-lg text-sm transition cursor-pointer"
                      >
                        {roleSubmitting ? "Submitting…" : "Submit role request"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <button
                  onClick={reloadUserProfile}
                  className="w-full bg-[#24539B] hover:bg-[#1E4480] text-white font-medium py-2.5 px-4 rounded-xl text-sm flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4 text-[#D3DFEF] animate-spin" />
                  Check Status
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full border border-slate-200 hover:bg-slate-50 text-slate-600 font-medium py-2.5 px-4 rounded-xl text-sm flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      ) : (
        /* CORE ENTERPRISE WORKSPACE - EXCEL-STYLE WORKBOOK SHELL */
        <WorkbookShell
          dbUser={dbUser}
          showFeedback={showFeedback}
          handleLogout={handleLogout}
          apiHealth={health}
          apiHealthLoading={healthLoading}
          fetchHealth={fetchHealth}
          legacyProps={{
            usersList,
            usersTotal,
            usersSearch,
            setUsersSearch,
            usersRoleFilter,
            setUsersRoleFilter,
            usersOffset,
            setUsersOffset,
            usersLoading,
            handleRoleChange,
            handleDeleteUser,
            roles,
            auditLogsList,
            auditTotal,
            auditSearch,
            setAuditSearch,
            auditActionFilter,
            setAuditActionFilter,
            auditOffset,
            setAuditOffset,
            auditLoading,
          }}
        />
      )}
    </div>
  );
}
