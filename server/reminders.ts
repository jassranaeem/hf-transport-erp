/**
 * Payment reminders · یاد دہانی — who owes us, since when, and a polite message to them.
 *
 *   Parties with a receivable balance (they owe HFK) whose last payment is older than the set
 *   number of days, and customers with overdue invoices. A reminder goes by SMS (the SMS
 *   gateway), email (Console → Email) or WhatsApp (a link: the user presses Send in WhatsApp).
 *
 *   Automatic reminders are OFF until turned on. When on, every few hours the system sends by
 *   SMS / email (never WhatsApp — that needs a person) to whoever is due, at most once per the
 *   set number of days per party, and logs each one.
 *
 *   GET  /api/reminders/config          settings
 *   PUT  /api/reminders/config          save settings
 *   GET  /api/reminders/queue           who is due
 *   POST /api/reminders/send            { partyId | contractorId, channel: sms|email|whatsapp }
 *   GET  /api/reminders/log             last 200 reminders
 */
import { Router, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { sendSms, normalizePhone, smsConfigured } from "./sms.ts";
import { sendMail, mailReady } from "./mail.ts";

export interface ReminderConfig {
  auto: boolean;
  minDays: number; // no payment for this many days
  minAmount: number; // only balances at least this much
  repeatDays: number; // not more than once in this many days per party
  autoChannels: Array<"sms" | "email">;
  template: string; // {name} {amount} {date} {company} {days}
  includeInvoices: boolean;
}
const KEY = "reminder_config";
const DEFAULT: ReminderConfig = {
  auto: false,
  minDays: 30,
  minAmount: 10000,
  repeatDays: 7,
  autoChannels: ["sms"],
  includeInvoices: true,
  template:
    "Assalam o Alaikum {name}. HFK Enterprises ke hisaab ke mutabiq {date} tak aap ki taraf PKR {amount} baqi hain. Meharbani kar ke adaigi kar dein. Shukriya — {company}",
};

const rows = async (q: any) => ((await db.execute(q)) as any).rows as any[];

export async function loadReminderConfig(): Promise<ReminderConfig> {
  try {
    const [row] = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, KEY)).limit(1);
    if (row?.value && typeof row.value === "object") return { ...DEFAULT, ...(row.value as Partial<ReminderConfig>) };
  } catch {
    /* not ready */
  }
  return { ...DEFAULT };
}

async function companyName(): Promise<string> {
  try {
    const [p] = await rows(sql`select coalesce(trade_name, legal_name) n from company_profile where id = 1`);
    return p?.n || "HFK Enterprises";
  } catch {
    return "HFK Enterprises";
  }
}

const dmy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

export function renderReminder(tpl: string, t: { name: string; amount: number; days: number | null; company: string }) {
  return tpl
    .replace(/\{name\}/g, t.name)
    .replace(/\{amount\}/g, Math.round(t.amount).toLocaleString("en-PK"))
    .replace(/\{date\}/g, dmy(new Date()))
    .replace(/\{days\}/g, t.days == null ? "" : String(t.days))
    .replace(/\{company\}/g, t.company);
}

/** Everyone who is due a reminder now (or every debtor, with `all`). */
export async function reminderQueue(all = false) {
  const cfg = await loadReminderConfig();
  const company = await companyName();
  const parties = await rows(sql`
    with last_pay as (
      select party_id, max(entry_date) filter (where credit > 0) last_credit, max(entry_date) last_any
      from party_ledger_entries where not is_deleted group by party_id),
    last_rem as (select party_id, max(created_at) at from reminder_log where party_id is not null and status in ('sent', 'link') group by party_id)
    select p.id, p.name, p.phone, p.email, p.type, p.closing_balance bal, p.status,
           lp.last_credit, lp.last_any, lr.at last_reminder,
           (current_date - coalesce(lp.last_credit, lp.last_any)::date) days
    from parties p left join last_pay lp on lp.party_id = p.id left join last_rem lr on lr.party_id = p.id
    where not p.is_deleted and p.closing_balance >= ${Math.max(1, cfg.minAmount)}
      and coalesce(p.status, 'Active') <> 'Inactive'
    order by p.closing_balance desc limit 500`);
  const invoices = cfg.includeInvoices
    ? await rows(sql`
      with last_rem as (select (select contractor_id from invoices where id = invoice_id) con, max(created_at) at from reminder_log where invoice_id is not null and status in ('sent', 'link') group by 1)
      select c.id contractor_id, c.company name, c.phone, c.email, sum(i.outstanding_balance)::bigint bal, count(*)::int invoices,
             min(i.due_date) oldest_due, (current_date - min(i.due_date)::date) days, max(lr.at) last_reminder,
             min(i.id) first_invoice_id, string_agg(i.invoice_number, ', ' order by i.due_date) numbers
      from invoices i join contractors c on c.id = i.contractor_id left join last_rem lr on lr.con = c.id
      where not i.is_deleted and i.outstanding_balance > 0 and i.due_date < now()
      group by c.id, c.company, c.phone, c.email
      having sum(i.outstanding_balance) >= ${Math.max(1, cfg.minAmount)}
      order by sum(i.outstanding_balance) desc limit 300`)
    : [];
  const recent = (at: any) => at && Date.now() - new Date(at).getTime() < cfg.repeatDays * 86400000;
  const shape = (r: any, kind: "party" | "invoice") => {
    const days = r.days == null ? null : Number(r.days);
    const bal = Number(r.bal || 0);
    const due = kind === "invoice" ? true : days == null || days >= cfg.minDays;
    return {
      kind,
      partyId: kind === "party" ? r.id : null,
      contractorId: kind === "invoice" ? r.contractor_id : null,
      name: r.name,
      phone: r.phone || null,
      email: r.email || null,
      balance: bal,
      days,
      invoices: kind === "invoice" ? { count: r.invoices, numbers: r.numbers, oldestDue: r.oldest_due } : null,
      firstInvoiceId: kind === "invoice" ? r.first_invoice_id : null,
      lastPayment: r.last_credit || null,
      lastReminder: r.last_reminder || null,
      remindedRecently: !!recent(r.last_reminder),
      due: due && !recent(r.last_reminder),
      message: renderReminder(
        kind === "invoice" ? cfg.template.replace("{date} tak", `{date} tak invoice ${r.numbers} ke`) : cfg.template,
        { name: r.name, amount: bal, days, company },
      ),
    };
  };
  const list = [...parties.map((r) => shape(r, "party")), ...invoices.map((r) => shape(r, "invoice"))];
  return { config: cfg, items: all ? list : list.filter((x) => x.due), all: list.length, company };
}

async function logReminder(v: { partyId?: number | null; invoiceId?: number | null; channel: string; to?: string | null; body: string; amount: number; status: string; error?: string | null; auto?: boolean; userId?: number | null }) {
  await db.execute(sql`insert into reminder_log (party_id, invoice_id, channel, to_address, body, amount, status, error, auto, created_by)
    values (${v.partyId ?? null}, ${v.invoiceId ?? null}, ${v.channel}, ${v.to ?? null}, ${v.body}, ${Math.round(v.amount)}, ${v.status}, ${v.error ?? null}, ${!!v.auto}, ${v.userId ?? null})`);
}

const html = (text: string, company: string) =>
  `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111827;line-height:1.6">
     <p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>
     <p style="color:#6B7280;font-size:12px">${company}</p></div>`;

/** Send one reminder. WhatsApp returns a link instead of sending. */
export async function sendReminder(item: any, channel: "sms" | "email" | "whatsapp", opts: { userId?: number | null; auto?: boolean; company: string }) {
  const base = { partyId: item.partyId, invoiceId: item.kind === "invoice" ? item.firstInvoiceId ?? null : null, body: item.message, amount: item.balance, userId: opts.userId, auto: opts.auto };
  if (channel === "sms") {
    const to = normalizePhone(item.phone);
    if (!to) return { ok: false, error: "No mobile number" };
    if (!(await smsConfigured())) return { ok: false, error: "The SMS gateway is not set up (Console → SMS Gateway)" };
    const log = await sendSms({ to, body: item.message, relatedType: "reminder", partyId: item.partyId ?? undefined, createdBy: opts.userId ?? undefined });
    const [r] = log ? await rows(sql`select status, error from sms_logs where id = ${log.id}`) : [{ status: "failed", error: "not sent" }];
    const ok = r?.status === "sent";
    await logReminder({ ...base, channel, to, status: ok ? "sent" : "failed", error: ok ? null : r?.error });
    return { ok, error: ok ? undefined : r?.error || "SMS failed" };
  }
  if (channel === "email") {
    if (!item.email) return { ok: false, error: "No email address" };
    const r = await sendMail({ to: item.email, subject: `Payment reminder — ${opts.company}`, html: html(item.message, opts.company), text: item.message });
    await logReminder({ ...base, channel, to: item.email, status: r.ok ? "sent" : "failed", error: r.error });
    return r;
  }
  await logReminder({ ...base, channel: "whatsapp", to: item.phone, status: "link" });
  return { ok: true };
}

/** The automatic run: only when switched on, SMS / email only, once per repeat window. */
export async function runAutoReminders() {
  const cfg = await loadReminderConfig();
  if (!cfg.auto) return { skipped: "off" };
  const q = await reminderQueue(false);
  const smsOk = cfg.autoChannels.includes("sms") && (await smsConfigured());
  const mailOk = cfg.autoChannels.includes("email") && (await mailReady());
  let sent = 0;
  for (const item of q.items.slice(0, 100)) {
    const channel = smsOk && normalizePhone(item.phone) ? "sms" : mailOk && item.email ? "email" : null;
    if (!channel) continue;
    const r = await sendReminder(item, channel, { auto: true, company: q.company });
    if (r.ok) sent++;
  }
  return { sent };
}

export function startReminderKeeper() {
  const tick = () => runAutoReminders().catch((e) => console.warn("[reminders] auto run failed:", e?.message));
  setTimeout(tick, 60_000);
  setInterval(tick, 6 * 3600_000).unref?.();
}

const router = Router();
router.use(requireAuth, requireApproved);
const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor", "Operations Manager"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];

router.get("/config", requireRole(READ), async (_req, res: Response) => {
  res.json({ ...(await loadReminderConfig()), smsReady: await smsConfigured(), emailReady: await mailReady() });
});

router.put("/config", requireRole(["Super Admin", "Admin", "Finance Manager"]), async (req: AuthRequest, res: Response) => {
  try {
    const cur = await loadReminderConfig();
    const b = req.body || {};
    const next: ReminderConfig = {
      auto: !!(b.auto ?? cur.auto),
      minDays: Math.max(0, Number(b.minDays ?? cur.minDays) || 0),
      minAmount: Math.max(0, Number(b.minAmount ?? cur.minAmount) || 0),
      repeatDays: Math.max(1, Number(b.repeatDays ?? cur.repeatDays) || 7),
      autoChannels: (Array.isArray(b.autoChannels) ? b.autoChannels : cur.autoChannels).filter((c: string) => c === "sms" || c === "email"),
      includeInvoices: !!(b.includeInvoices ?? cur.includeInvoices),
      template: String(b.template ?? cur.template).slice(0, 600) || DEFAULT.template,
    };
    const [existing] = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, KEY)).limit(1);
    if (existing) await db.update(schema.systemSettings).set({ value: next, updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.systemSettings.key, KEY));
    else await db.insert(schema.systemSettings).values({ key: KEY, value: next, createdBy: req.user?.id });
    await logAudit({ action: "UPDATE", tableName: "system_settings", recordId: 0, oldValues: cur, newValues: next, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.json(next);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/queue", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    res.json(await reminderQueue(req.query.all === "1"));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/send", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const channel = ["sms", "email", "whatsapp"].includes(b.channel) ? b.channel : "sms";
    const q = await reminderQueue(true);
    const item = q.items.find((x) => (b.partyId && x.partyId === Number(b.partyId)) || (b.contractorId && x.contractorId === Number(b.contractorId)));
    if (!item) return res.status(404).json({ error: "Nothing is owed by them above the reminder limit" });
    if (typeof b.message === "string" && b.message.trim()) item.message = b.message.trim().slice(0, 900);
    const r = await sendReminder(item, channel, { userId: req.user?.id, company: q.company });
    res.status(r.ok ? 200 : 400).json({ ...r, message: item.message, phone: item.phone });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/log", requireRole(READ), async (_req, res: Response) => {
  try {
    const list = await rows(sql`select r.*, p.name party_name from reminder_log r left join parties p on p.id = r.party_id order by r.created_at desc limit 200`);
    res.json({ log: list });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
