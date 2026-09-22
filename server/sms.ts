/**
 * SMS notifications — a driver / party gets a text when a ledger entry hits
 * their account (credit / debit).
 *
 * The gateway is configured from the UI (Console → SMS Gateway) and stored in
 * `system_settings` under key "sms_gateway". No .env editing, no redeploy.
 * `.env` values are used only as a fallback when nothing is saved yet — for
 * "sendpk" specifically, the API key is ALWAYS sourced from the backend
 * `.env.local` (SMS_GATEWAY_KEY) and never accepted through the admin UI /
 * `PUT /api/sms/config` route, so it can never round-trip into the DB or the
 * browser (see the `sendpk` guard in the PUT handler below).
 *
 * Supported providers (pick one in the UI):
 *   - "smsgate"  — SMS Gate / android-sms-gateway (capcom6). Turn any Android
 *                  phone into a gateway; sends on that SIM. No signup needed for
 *                  the local mode. Cloud: https://api.sms-gate.app/3rdparty/v1/message
 *                  Auth: Basic user:pass. Body: {textMessage:{text}, phoneNumbers:[]}
 *   - "textbee"  — textbee.dev. Android phone + free tier.
 *                  POST https://api.textbee.dev/api/v1/gateway/send-sms
 *                  Header: x-api-key. Body: {recipients:[], message}
 *   - "sendpk"   — SendPK (sendpk.com) Fixed-SMS **template** API (current,
 *                  api_key based — NOT the deprecated username/password
 *                  free-text method). POST https://sendpk.com/api/sms.php
 *                  Body: api_key, sender, mobile, template_id, message (JSON
 *                  of ONLY the PTA/SendPK-approved template variable names),
 *                  format=json. Because the message must be JSON keyed by
 *                  whatever variable names SendPK approved for `templateId`
 *                  (names we don't control), `templateVarsTemplate` holds
 *                  that exact JSON shape with `{{token}}` placeholders that
 *                  get substituted from a fixed internal token vocabulary at
 *                  send time — see `renderSendpkMessage()` below.
 *   - "generic"  — any other HTTP SMS API (LifetimeSMS, Zong, a local
 *                  aggregator …): a URL template with {to} and {text}
 *                  placeholders, GET or POST.
 *
 * Until a gateway is enabled every send is logged with status "skipped" so
 * nothing is lost and you can see exactly what WOULD have gone out.
 */
import { Router, Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";

const SETTINGS_KEY = "sms_gateway";

export interface SmsConfig {
  enabled: boolean;
  provider: "smsgate" | "textbee" | "generic" | "sendpk";
  /** send endpoint (smsgate/textbee/sendpk have sensible defaults) */
  url: string;
  method: "GET" | "POST";
  /** basic-auth (smsgate) */
  username: string;
  password: string;
  /** api key (textbee: x-api-key; generic: substituted as {key}; sendpk: api_key — env-only, see PUT /config) */
  apiKey: string;
  /** sender / mask id — generic: substituted as {from}; sendpk: the PTA-approved "sender" */
  senderId: string;
  label: string;
  /** auto-SMS the assigned driver on every truck-ledger credit / debit entry */
  notifyDrivers: boolean;
  /** auto-SMS the trip's driver when an invoice is raised */
  notifyInvoices: boolean;
  /** sendpk only: the approved Fixed-SMS template id */
  templateId: string;
  /** sendpk only: approved template's JSON var shape, e.g. {"name":"{{who}}","amount":"{{amount}}"} */
  templateVarsTemplate: string;
}

const ENV_DEFAULT: SmsConfig = {
  enabled: process.env.SMS_ENABLED === "true",
  provider: (process.env.SMS_GATEWAY_PROVIDER as SmsConfig["provider"]) || "generic",
  url: process.env.SMS_GATEWAY_URL || "",
  method: (process.env.SMS_GATEWAY_METHOD || "GET").toUpperCase() === "POST" ? "POST" : "GET",
  username: process.env.SMS_GATEWAY_USER || "",
  password: process.env.SMS_GATEWAY_PASS || "",
  apiKey: process.env.SMS_GATEWAY_KEY || "",
  senderId: process.env.SMS_SENDER_ID || "",
  label: process.env.SMS_PROVIDER || "",
  notifyDrivers: true,
  notifyInvoices: true,
  templateId: process.env.SMS_TEMPLATE_ID || "",
  templateVarsTemplate: process.env.SMS_TEMPLATE_VARS_JSON || "",
};

const PROVIDER_DEFAULT_URL: Record<SmsConfig["provider"], string> = {
  smsgate: "https://api.sms-gate.app/3rdparty/v1/message",
  textbee: "https://api.textbee.dev/api/v1/gateway/send-sms",
  sendpk: "https://sendpk.com/api/sms.php",
  generic: "",
};

/** Per SendPK's published API docs (sendpk.com/api.php) — Fixed-SMS status codes. */
const SENDPK_STATUS_MEANINGS: Record<string, string> = {
  "1": "API key is invalid, expired, or the account is disabled",
  "2": "API key is empty",
  "3": "Reserved (legacy code, unused with api_key auth)",
  "4": "Sender ID is empty",
  "5": "Recipient is empty",
  "6": "Message is empty",
  "7": "Invalid recipient number",
  "8": "Insufficient credit — top up the SendPK balance",
  "9": "SMS rejected by SendPK",
};

/**
 * Fill a SendPK `templateVarsTemplate` (JSON text with `{{token}}`
 * placeholders inside its string values) from a fixed internal token
 * vocabulary, then verify the result is valid JSON before it's ever sent.
 * Never invents variable *names* — those must match what SendPK/PTA actually
 * approved for the configured templateId; only the *values* are substituted.
 */
export function renderSendpkMessage(template: string, tokens: Record<string, string>): string {
  if (!template || !template.trim()) {
    throw new Error(
      "SendPK: no approved template configured (templateVarsTemplate is empty) — " +
        "paste the JSON shape of your approved Fixed-SMS template in Console → SMS Gateway."
    );
  }
  const filled = template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = tokens[key];
    // JSON.stringify a plain string then strip its wrapping quotes -> a
    // properly-escaped fragment safe to splice inside an existing JSON string.
    return JSON.stringify(v === undefined ? "" : v).slice(1, -1);
  });
  try {
    JSON.parse(filled);
  } catch (e: any) {
    throw new Error(`SendPK: templateVarsTemplate is not valid JSON after substitution: ${e.message}`);
  }
  return filled;
}

/** Parse a SendPK response (format=json requested, but the exact success/error shape isn't published, so this tolerates a few common shapes plus the documented plain-text "OK ID:12345"). */
function parseSendpkResponse(raw: string): { ok: boolean; messageId?: string; reason?: string } {
  const text = raw.trim();
  try {
    const j = JSON.parse(text);
    const statusVal = j.status ?? j.Status ?? j.code ?? j.Code ?? j.error ?? j.Error;
    const idVal = j.id ?? j.message_id ?? j.msg_id ?? j.request_id ?? j.data?.id;
    const statusStr = statusVal === undefined ? "" : String(statusVal);
    const ok = /^ok$/i.test(statusStr) || statusStr === "0" || (statusVal === undefined && j.error === undefined);
    return {
      ok,
      messageId: idVal !== undefined ? String(idVal) : undefined,
      reason: ok ? undefined : SENDPK_STATUS_MEANINGS[statusStr] || statusStr || "unknown error",
    };
  } catch {
    const okMatch = /^OK\s*ID:?\s*(\S+)/i.exec(text);
    if (okMatch) return { ok: true, messageId: okMatch[1] };
    const codeMatch = /^([1-9])$/.exec(text);
    if (codeMatch) return { ok: false, reason: SENDPK_STATUS_MEANINGS[codeMatch[1]] || `code ${codeMatch[1]}` };
    return { ok: /^ok/i.test(text), reason: /^ok/i.test(text) ? undefined : text || "empty response" };
  }
}

let cache: { at: number; cfg: SmsConfig } | null = null;
const TTL = 15_000;

export async function loadSmsConfig(force = false): Promise<SmsConfig> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.cfg;
  let cfg: SmsConfig = { ...ENV_DEFAULT };
  try {
    const [row] = await db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, SETTINGS_KEY))
      .limit(1);
    if (row?.value && typeof row.value === "object") {
      cfg = { ...cfg, ...(row.value as Partial<SmsConfig>) };
    }
  } catch {
    /* table not ready yet — use env */
  }
  if (!cfg.url && cfg.provider !== "generic") cfg.url = PROVIDER_DEFAULT_URL[cfg.provider];
  // sendpk's api_key is backend-secret-only: it is never accepted from the UI
  // (see PUT /config below), so it always comes straight from .env.local —
  // never from whatever a stale/old DB row happens to hold.
  if (cfg.provider === "sendpk") cfg.apiKey = process.env.SMS_GATEWAY_KEY || "";
  cache = { at: Date.now(), cfg };
  return cfg;
}

export async function saveSmsConfig(patch: Partial<SmsConfig>, userId?: number): Promise<SmsConfig> {
  const current = await loadSmsConfig(true);
  const next: SmsConfig = { ...current, ...patch };
  if (next.provider !== "generic" && (!next.url || next.url === PROVIDER_DEFAULT_URL.smsgate || next.url === PROVIDER_DEFAULT_URL.textbee)) {
    next.url = patch.url || PROVIDER_DEFAULT_URL[next.provider];
  }
  // Defense in depth (belt-and-suspenders alongside the PUT /config guard,
  // for any other caller of this function e.g. POST /test): sendpk's api_key
  // is backend-.env-only, never DB/UI-writable.
  if (next.provider === "sendpk") next.apiKey = process.env.SMS_GATEWAY_KEY || "";
  const [existing] = await db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, SETTINGS_KEY))
    .limit(1);
  if (existing) {
    await db
      .update(schema.systemSettings)
      .set({ value: next, updatedAt: new Date(), updatedBy: userId })
      .where(eq(schema.systemSettings.key, SETTINGS_KEY));
  } else {
    await db.insert(schema.systemSettings).values({ key: SETTINGS_KEY, value: next, createdBy: userId });
  }
  cache = { at: Date.now(), cfg: next };
  return next;
}

export async function smsConfigured(): Promise<boolean> {
  const c = await loadSmsConfig();
  return c.enabled && !!c.url;
}

function maskCfg(c: SmsConfig) {
  const mask = (s: string) => (s ? s.slice(0, 2) + "••••" + s.slice(-2) : "");
  return { ...c, password: c.password ? "••••••" : "", apiKey: mask(c.apiKey), hasPassword: !!c.password, hasApiKey: !!c.apiKey };
}

/** Pakistan-friendly phone normalisation → E.164-ish (+92XXXXXXXXXX). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, "");
  if (!d) return null;
  if (d.startsWith("+")) return d;
  d = d.replace(/^00/, "");
  if (d.startsWith("92")) return "+" + d;
  if (d.startsWith("0")) return "+92" + d.slice(1);
  if (d.length === 10) return "+92" + d;
  return "+" + d;
}

interface SendOpts {
  to: string | null | undefined;
  body: string;
  relatedType?: string;
  relatedId?: number;
  driverId?: number;
  partyId?: number;
  createdBy?: number;
  /**
   * Named values for the sendpk template substitution (who/move/amount/
   * balance/ref/... — whatever the caller has). `text` (the full compiled
   * sentence) is always added automatically so a single-variable template
   * still works without a caller passing anything.
   */
  tokens?: Record<string, string>;
}

/** Build the actual HTTP request for the configured provider. */
function buildRequest(cfg: SmsConfig, to: string, text: string, tokens: Record<string, string> = {}): { url: string; init: RequestInit } {
  if (cfg.provider === "sendpk") {
    const message = renderSendpkMessage(cfg.templateVarsTemplate, { text, to, ...tokens });
    const params = new URLSearchParams({
      api_key: cfg.apiKey,
      sender: cfg.senderId,
      mobile: to.replace(/^\+/, ""), // SendPK expects the bare 92XXXXXXXXXX form
      template_id: cfg.templateId,
      message,
      format: "json",
    });
    return {
      // POST keeps api_key out of server access logs (SendPK's own recommendation).
      url: cfg.url || PROVIDER_DEFAULT_URL.sendpk,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    };
  }
  if (cfg.provider === "smsgate") {
    const init: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64"),
      },
      body: JSON.stringify({ textMessage: { text }, phoneNumbers: [to] }),
    };
    return { url: cfg.url || PROVIDER_DEFAULT_URL.smsgate, init };
  }
  if (cfg.provider === "textbee") {
    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": cfg.apiKey },
      body: JSON.stringify({ recipients: [to], message: text }),
    };
    return { url: cfg.url || PROVIDER_DEFAULT_URL.textbee, init };
  }
  // generic template
  const sub = (s: string) =>
    s
      .replace(/\{to\}/g, encodeURIComponent(to))
      .replace(/\{text\}/g, encodeURIComponent(text))
      .replace(/\{message\}/g, encodeURIComponent(text))
      .replace(/\{key\}/g, encodeURIComponent(cfg.apiKey))
      .replace(/\{from\}/g, encodeURIComponent(cfg.senderId));
  if (cfg.method === "POST") {
    return {
      url: sub(cfg.url),
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, text, message: text, from: cfg.senderId || undefined, apiKey: cfg.apiKey || undefined }),
      },
    };
  }
  return { url: sub(cfg.url), init: { method: "GET" } };
}

export async function sendSms(opts: SendOpts) {
  const to = normalizePhone(opts.to);
  if (!to) return null;
  const cfg = await loadSmsConfig();
  const live = cfg.enabled && !!cfg.url;

  const [log] = await db
    .insert(schema.smsLogs)
    .values({
      toPhone: to,
      body: opts.body.slice(0, 640),
      status: live ? "queued" : "skipped",
      provider: cfg.label || cfg.provider || null,
      relatedType: opts.relatedType || null,
      relatedId: opts.relatedId ?? null,
      driverId: opts.driverId ?? null,
      partyId: opts.partyId ?? null,
      createdBy: opts.createdBy ?? null,
    })
    .returning();

  if (!live) return log;

  try {
    const { url, init } = buildRequest(cfg, to, opts.body, opts.tokens);
    const res = await fetch(url, init);
    const raw = (await res.text().catch(() => "")).slice(0, 500);

    if (cfg.provider === "sendpk") {
      // SendPK returns its own status (OK / 1-9), independent of the HTTP code.
      const parsed = parseSendpkResponse(raw);
      const ok = res.ok && parsed.ok;
      await db
        .update(schema.smsLogs)
        .set({
          status: ok ? "sent" : "failed",
          providerRef: parsed.messageId ? `SendPK ID ${parsed.messageId}` : raw.slice(0, 240) || null,
          error: ok ? null : parsed.reason || `HTTP ${res.status}` || null,
          sentAt: new Date(),
        })
        .where(eq(schema.smsLogs.id, log.id));
    } else {
      await db
        .update(schema.smsLogs)
        .set({
          status: res.ok ? "sent" : "failed",
          providerRef: raw.slice(0, 240) || null,
          error: res.ok ? null : `HTTP ${res.status}`,
          sentAt: new Date(),
        })
        .where(eq(schema.smsLogs.id, log.id));
    }
  } catch (e: any) {
    await db
      .update(schema.smsLogs)
      .set({ status: "failed", error: String(e?.message || e).slice(0, 300) })
      .where(eq(schema.smsLogs.id, log.id));
  }
  return log;
}

const PKR = (n: number) => "PKR " + Math.abs(Math.round(n || 0)).toLocaleString("en-PK");

/**
 * Named values for a credit/debit notification — used both to build the
 * plain-English sentence (ledgerSmsText) AND, unchanged, as the {{token}}
 * vocabulary a sendpk `templateVarsTemplate` can reference (who/move/amount/
 * balance/balanceLabel/ref/date).
 */
export function ledgerSmsTokens(params: {
  who: string;
  debit: number;
  credit: number;
  balance: number;
  ref?: string | null;
  date?: string | null;
}): Record<string, string> {
  return {
    who: params.who,
    move: params.debit ? "Debit" : "Credit",
    amount: PKR(params.debit || params.credit),
    balance: PKR(Math.abs(params.balance)),
    balanceLabel: params.balance > 0 ? "receivable" : params.balance < 0 ? "payable" : "clear",
    ref: params.ref || "",
    date: params.date || new Date().toISOString().slice(0, 10),
  };
}

/** Standard credit/debit notification text. */
export function ledgerSmsText(params: {
  who: string;
  debit: number;
  credit: number;
  balance: number;
  ref?: string | null;
  date?: string | null;
}): string {
  const t = ledgerSmsTokens(params);
  const bal = t.balanceLabel === "clear" ? "Balance clear" : `Balance ${t.balanceLabel} ${t.balance}`;
  return `HF Transport - ${t.who}: ${t.move} ${t.amount}${t.ref ? ` (Ref ${t.ref})` : ""}. ${bal}.`;
}

// ---------------------------------------------------------------------------
// driver resolution + the two auto-notifications (fire-and-forget)
// ---------------------------------------------------------------------------

/** Find the driver (and mobile) for a truck / trip so the SMS auto-addresses. */
export async function resolveDriver(opts: {
  driverId?: number | null;
  vehicleId?: number | null;
}): Promise<{ id: number; name: string; mobile: string | null } | null> {
  try {
    if (opts.driverId) {
      const [d] = await db
        .select({ id: schema.drivers.id, name: schema.drivers.driverName, mobile: schema.drivers.mobile })
        .from(schema.drivers)
        .where(eq(schema.drivers.id, opts.driverId))
        .limit(1);
      if (d) return d;
    }
    if (opts.vehicleId) {
      const [d] = await db
        .select({ id: schema.drivers.id, name: schema.drivers.driverName, mobile: schema.drivers.mobile })
        .from(schema.drivers)
        .where(
          and(
            eq(schema.drivers.assignedVehicleId, opts.vehicleId),
            eq(schema.drivers.isDeleted, false),
          ),
        )
        .limit(1);
      if (d) return d;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Truck-ledger credit/debit → text the assigned driver. No per-driver setup. */
export async function notifyDriverOfLedgerEntry(params: {
  vehicleId?: number | null;
  driverId?: number | null;
  registration: string;
  received: number;
  paid: number;
  balance: number;
  ref?: string | null;
  entryId: number;
  userId?: number;
}) {
  const cfg = await loadSmsConfig();
  if (cfg.notifyDrivers === false) return;
  const drv = await resolveDriver({ driverId: params.driverId, vehicleId: params.vehicleId });
  if (!drv?.mobile) return;
  const ledgerParams = {
    who: `Truck ${params.registration}`,
    debit: params.paid,
    credit: params.received,
    balance: params.balance,
    ref: params.ref,
  };
  await sendSms({
    to: drv.mobile,
    body: ledgerSmsText(ledgerParams),
    tokens: ledgerSmsTokens(ledgerParams),
    relatedType: "truck_ledger_entry",
    relatedId: params.entryId,
    driverId: drv.id,
    createdBy: params.userId,
  });
}

/** Invoice raised → text the trip's driver a one-line summary. */
export async function notifyDriverOfInvoice(params: {
  invoiceNumber: string;
  driverId?: number | null;
  vehicleId?: number | null;
  amount: number;
  dueDate?: Date | string | null;
  routeFrom?: string | null;
  routeTo?: string | null;
  invoiceId: number;
  userId?: number;
}) {
  const cfg = await loadSmsConfig();
  if (cfg.notifyInvoices === false) return;
  const drv = await resolveDriver({ driverId: params.driverId, vehicleId: params.vehicleId });
  if (!drv?.mobile) return;
  const route = [params.routeFrom, params.routeTo].filter(Boolean).join(" > ");
  const due = params.dueDate ? new Date(params.dueDate).toISOString().slice(0, 10) : null;
  const body =
    `HF Transport - Invoice ${params.invoiceNumber} raised${route ? ` for trip ${route}` : ""}. ` +
    `Amount ${PKR(params.amount)}${due ? `, due ${due}` : ""}.`;
  await sendSms({
    to: drv.mobile,
    body,
    tokens: {
      invoiceNumber: params.invoiceNumber,
      amount: PKR(params.amount),
      dueDate: due || "",
      route,
    },
    relatedType: "invoice",
    relatedId: params.invoiceId,
    driverId: drv.id,
    createdBy: params.userId,
  });
}

// ------------------------------------------------------------------- routes
export const smsRouter = Router();
smsRouter.use(requireAuth, requireApproved);

smsRouter.get("/status", async (_req: AuthRequest, res: Response) => {
  const c = await loadSmsConfig();
  res.json({
    enabled: c.enabled,
    configured: c.enabled && !!c.url,
    provider: c.provider,
    label: c.label,
  });
});

smsRouter.get("/config", requireRole(["Admin", "Super Admin"]), async (_req: AuthRequest, res: Response) => {
  const c = await loadSmsConfig(true);
  res.json({
    config: maskCfg(c),
    providerDefaults: PROVIDER_DEFAULT_URL,
    guide: {
      smsgate:
        "Install 'SMS Gate' (capcom6) on an Android phone with a working SIM → it shows a username + password. Paste them here. For local mode use http://<phone-ip>:8080/message; for cloud leave the default URL.",
      textbee:
        "Install 'textbee' app, create a free account at textbee.dev, register the device, copy the API key here.",
      sendpk:
        "SendPK (sendpk.com) Fixed-SMS template API. The API key lives only in the server's .env.local (SMS_GATEWAY_KEY) — it is never entered here. Fill in your PTA-approved Sender ID, the approved Template ID, and paste the template's JSON variable shape using {{who}}, {{move}}, {{amount}}, {{balance}}, {{balanceLabel}}, {{ref}}, {{date}} (ledger notifications) or {{invoiceNumber}}, {{amount}}, {{dueDate}}, {{route}} (invoice notifications) — e.g. {\"name\":\"{{who}}\",\"amount\":\"{{amount}}\"} — matching whatever variable NAMES SendPK actually approved for that template.",
      generic:
        "Any other Pakistani SMS API (LifetimeSMS, Zong corporate, a local aggregator). Put the full send URL with {to} and {text} placeholders — e.g. https://api.example.com/send?api_key={key}&sender={from}&mobile={to}&message={text}. Pick GET or POST as the provider requires.",
    },
  });
});

smsRouter.put("/config", requireRole(["Admin", "Super Admin"]), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const patch: Partial<SmsConfig> = {};
    for (const k of [
      "enabled", "provider", "url", "method", "username", "senderId", "label",
      "notifyDrivers", "notifyInvoices", "templateId", "templateVarsTemplate",
    ] as const) {
      if (b[k] !== undefined) (patch as any)[k] = b[k];
    }
    // only overwrite secrets when a non-masked value is supplied
    if (typeof b.password === "string" && b.password && !/^•+$/.test(b.password)) patch.password = b.password;
    // sendpk's api_key is backend-.env-only — silently ignore any apiKey the
    // UI tries to send for it so it can never round-trip into the DB.
    const nextProvider = (b.provider as SmsConfig["provider"]) || (await loadSmsConfig()).provider;
    if (nextProvider !== "sendpk" && typeof b.apiKey === "string" && b.apiKey && !b.apiKey.includes("••")) {
      patch.apiKey = b.apiKey;
    }
    const saved = await saveSmsConfig(patch, req.user?.id);
    res.json({ ok: true, config: maskCfg(saved) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

smsRouter.get("/logs", async (req: AuthRequest, res: Response) => {
  const limit = Math.min(500, parseInt(req.query.limit as string) || 100);
  const rows = await db.select().from(schema.smsLogs).orderBy(desc(schema.smsLogs.createdAt)).limit(limit);
  res.json({ configured: await smsConfigured(), logs: rows });
});

smsRouter.post("/test", requireRole(["Super Admin", "Admin"]), async (req: AuthRequest, res: Response) => {
  const to = String(req.body?.to || "");
  if (!to) return res.status(400).json({ error: "to (phone) required" });
  // if a config patch is sent along, save it first so the test uses it
  if (req.body?.config) await saveSmsConfig(req.body.config, req.user?.id);
  const log = await sendSms({
    to,
    body: req.body?.body || "HF Transport ERP - SMS gateway test. If you got this, SMS is working.",
    // sendpk only: sample {{token}} values to try the approved template with,
    // e.g. {"who":"Test Driver","amount":"PKR 1,000","balance":"PKR 1,000","balanceLabel":"receivable"}
    tokens: req.body?.tokens && typeof req.body.tokens === "object" ? req.body.tokens : undefined,
    relatedType: "test",
    createdBy: req.user?.id,
  });
  const [fresh] = log ? await db.select().from(schema.smsLogs).where(eq(schema.smsLogs.id, log.id)).limit(1) : [null];
  res.json({ configured: await smsConfigured(), log: fresh || log });
});
