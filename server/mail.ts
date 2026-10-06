/**
 * Email · ای میل — invoices, statements of account and payment reminders sent from the
 * company's own mailbox (SMTP).
 *
 * The server, user name and "from" are set in the app (Console → Email). The password is
 * NEVER stored in the app or the database: it is read only from the server's environment
 * (SMTP_PASSWORD in .env.local locally, or the Render environment on the live site).
 *
 *   GET  /api/mail/config     settings (+ whether the password is present — never the password)
 *   PUT  /api/mail/config     save settings
 *   POST /api/mail/test       send a test message to an address
 *   POST /api/mail/send       { to, subject, html, text?, attachments?: [{filename, contentBase64}] }
 */
import { Router, Response } from "express";
import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";

export interface MailConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean; // true for 465, false for 587 (STARTTLS)
  user: string;
  fromName: string;
  fromAddress: string;
  replyTo?: string;
}

const KEY = "mail_config";
const DEFAULT: MailConfig = {
  enabled: false,
  host: process.env.SMTP_HOST || "",
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  user: process.env.SMTP_USER || "",
  fromName: "HFK Enterprises",
  fromAddress: process.env.SMTP_FROM || process.env.SMTP_USER || "",
};

export async function loadMailConfig(): Promise<MailConfig> {
  try {
    const [row] = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, KEY)).limit(1);
    if (row?.value && typeof row.value === "object") return { ...DEFAULT, ...(row.value as Partial<MailConfig>) };
  } catch {
    /* table not ready */
  }
  return { ...DEFAULT };
}

const hasPassword = () => !!process.env.SMTP_PASSWORD;

export async function mailReady(): Promise<boolean> {
  const c = await loadMailConfig();
  return c.enabled && !!c.host && !!c.user && hasPassword();
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const c = await loadMailConfig();
  if (!c.enabled) return { ok: false, error: "Email is turned off (Console → Email)" };
  if (!c.host || !c.user) return { ok: false, error: "Email server / user not set (Console → Email)" };
  if (!hasPassword()) return { ok: false, error: "SMTP_PASSWORD is not set on the server" };
  const to = String(opts.to || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: "Not a valid email address" };
  try {
    const t = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: { user: c.user, pass: process.env.SMTP_PASSWORD },
    });
    const info = await t.sendMail({
      from: c.fromName ? `"${c.fromName.replace(/"/g, "")}" <${c.fromAddress || c.user}>` : c.fromAddress || c.user,
      replyTo: c.replyTo || undefined,
      to,
      subject: opts.subject.slice(0, 200),
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments,
    });
    return { ok: true, id: info.messageId };
  } catch (e: any) {
    // never echo the credentials; nodemailer's messages do not include them
    return { ok: false, error: String(e?.message || e).slice(0, 300) };
  }
}

const router = Router();
router.use(requireAuth, requireApproved);
const ADMIN = ["Super Admin", "Admin"];
const SEND = ["Super Admin", "Admin", "Finance Manager", "Accountant"];

router.get("/config", requireRole(SEND), async (_req: AuthRequest, res: Response) => {
  const c = await loadMailConfig();
  res.json({ ...c, passwordSet: hasPassword(), ready: await mailReady() });
});

router.put("/config", requireRole(ADMIN), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const cur = await loadMailConfig();
    const next: MailConfig = {
      enabled: b.enabled ?? cur.enabled,
      host: String(b.host ?? cur.host).trim(),
      port: Number(b.port ?? cur.port) || 587,
      secure: !!(b.secure ?? cur.secure),
      user: String(b.user ?? cur.user).trim(),
      fromName: String(b.fromName ?? cur.fromName).trim(),
      fromAddress: String(b.fromAddress ?? cur.fromAddress).trim(),
      replyTo: String(b.replyTo ?? cur.replyTo ?? "").trim(),
    };
    // a password must never be saved here, even if one is sent
    const [existing] = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, KEY)).limit(1);
    if (existing) await db.update(schema.systemSettings).set({ value: next, updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.systemSettings.key, KEY));
    else await db.insert(schema.systemSettings).values({ key: KEY, value: next, createdBy: req.user?.id });
    await logAudit({ action: "UPDATE", tableName: "system_settings", recordId: 0, oldValues: cur, newValues: next, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.json({ ...next, passwordSet: hasPassword(), ready: await mailReady() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/test", requireRole(ADMIN), async (req: AuthRequest, res: Response) => {
  const r = await sendMail({
    to: req.body?.to,
    subject: "Test email from HFK ERP",
    html: "<p>This is a test email from the HFK Enterprises ERP. If you can read this, email is working.</p>",
  });
  res.status(r.ok ? 200 : 400).json(r);
});

router.post("/send", requireRole(SEND), async (req: AuthRequest, res: Response) => {
  const b = req.body || {};
  const attachments = Array.isArray(b.attachments)
    ? b.attachments.slice(0, 5).map((a: any) => ({ filename: String(a.filename || "file"), content: Buffer.from(String(a.contentBase64 || ""), "base64"), contentType: a.contentType }))
    : undefined;
  const r = await sendMail({ to: b.to, subject: String(b.subject || ""), html: String(b.html || ""), text: b.text, attachments });
  await logAudit({ action: "CREATE", tableName: "email", recordId: 0, oldValues: null, newValues: { to: b.to, subject: b.subject, ok: r.ok, error: r.error }, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
  res.status(r.ok ? 200 : 400).json(r);
});

export default router;
