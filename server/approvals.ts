/**
 * Approvals · منظوری — a big payment waits for the owner.
 *
 * When switched on, money going OUT at or above the set amount — a Daily Cash Book "Out", a
 * party payment (debit) or a truck khata payment — typed by someone who is not an approver is
 * not written yet: it becomes a request. An approver approves it (it is then written exactly as
 * it was typed, through the same screen's route) or rejects it with a note. Approvers' own
 * entries go straight in.
 *
 *   GET  /api/approvals/config | PUT /api/approvals/config
 *   GET  /api/approvals?status=pending|approved|rejected|all
 *   POST /api/approvals/:id/approve    { note? }
 *   POST /api/approvals/:id/reject     { note }
 */
import { Router, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { selfApi } from "./self_api.ts";
import { INTERNAL_CALL_TOKEN } from "../src/middleware/security.ts";

export interface ApprovalConfig {
  enabled: boolean;
  threshold: number;
  approverRoles: string[];
}
const KEY = "approval_config";
const DEFAULT: ApprovalConfig = { enabled: false, threshold: 100000, approverRoles: ["Super Admin", "Admin"] };
const rows = async (q: any) => ((await db.execute(q)) as any).rows as any[];

let cache: { at: number; cfg: ApprovalConfig } | null = null;
export async function loadApprovalConfig(force = false): Promise<ApprovalConfig> {
  if (!force && cache && Date.now() - cache.at < 15_000) return cache.cfg;
  let cfg = { ...DEFAULT };
  try {
    const [row] = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, KEY)).limit(1);
    if (row?.value && typeof row.value === "object") cfg = { ...cfg, ...(row.value as Partial<ApprovalConfig>) };
  } catch {
    /* not ready */
  }
  cache = { at: Date.now(), cfg };
  return cfg;
}

/**
 * Called at the top of a money-out route. If this entry must wait for an approver, it is saved
 * as a request and the route answers 202 — the caller returns at once. Otherwise null.
 */
export async function holdForApproval(
  req: AuthRequest,
  res: Response,
  v: { kind: string; amount: number; summary: string; method: string; path: string; payload: unknown },
): Promise<boolean> {
  const cfg = await loadApprovalConfig();
  if (!cfg.enabled || !(v.amount >= cfg.threshold) || v.amount <= 0) return false;
  if (cfg.approverRoles.includes(req.user?.role || "")) return false;
  // being carried out after approval: only this server can say so (the internal token), and only
  // for a request an approver has just claimed
  if (req.headers["x-approved-request"] && req.headers["x-internal-call"] === INTERNAL_CALL_TOKEN) {
    const [w] = await rows(sql`select 1 from approval_requests where id = ${Number(req.headers["x-approved-request"]) || 0} and status = 'working'`);
    if (w) return false;
  }
  const [r] = await rows(sql`insert into approval_requests (kind, amount, summary, payload, requested_by)
    values (${v.kind}, ${Math.round(v.amount)}, ${v.summary.slice(0, 300)}, ${JSON.stringify({ method: v.method, path: v.path, body: v.payload })}::jsonb, ${req.user?.id ?? null}) returning id`);
  await logAudit({ action: "CREATE", tableName: "approval_requests", recordId: r.id, oldValues: null, newValues: v, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
  res.status(202).json({
    pendingApproval: true,
    requestId: r.id,
    message: `PKR ${Math.round(v.amount).toLocaleString()} is at or above the approval limit — sent for approval (#${r.id}). It is written when approved · منظوری کے لیے بھیج دیا گیا`,
  });
  return true;
}

const router = Router();
router.use(requireAuth, requireApproved);
const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor", "Operations Manager"];

router.get("/config", requireRole(READ), async (_req, res: Response) => res.json(await loadApprovalConfig(true)));

router.put("/config", requireRole(["Super Admin", "Admin"]), async (req: AuthRequest, res: Response) => {
  try {
    const cur = await loadApprovalConfig(true);
    const b = req.body || {};
    const roles = Array.isArray(b.approverRoles) ? b.approverRoles.filter((r: any) => typeof r === "string") : cur.approverRoles;
    const next: ApprovalConfig = {
      enabled: !!(b.enabled ?? cur.enabled),
      threshold: Math.max(1, Math.round(Number(b.threshold ?? cur.threshold) || cur.threshold)),
      approverRoles: roles.includes("Super Admin") ? roles : ["Super Admin", ...roles],
    };
    const [existing] = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, KEY)).limit(1);
    if (existing) await db.update(schema.systemSettings).set({ value: next, updatedAt: new Date(), updatedBy: req.user?.id }).where(eq(schema.systemSettings.key, KEY));
    else await db.insert(schema.systemSettings).values({ key: KEY, value: next, createdBy: req.user?.id });
    cache = null;
    await logAudit({ action: "UPDATE", tableName: "system_settings", recordId: 0, oldValues: cur, newValues: next, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.json(next);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const st = String(req.query.status || "pending");
    const cfg = await loadApprovalConfig();
    const list = await rows(sql`select a.*, u.name requested_by_name, d.name decided_by_name
      from approval_requests a left join users u on u.id = a.requested_by left join users d on d.id = a.decided_by
      where ${st === "all" ? sql`true` : sql`a.status = ${st}`} order by a.created_at desc limit 300`);
    const [c] = await rows(sql`select count(*)::int n from approval_requests where status = 'pending'`);
    res.json({ list, pending: c?.n || 0, canApprove: cfg.approverRoles.includes(req.user?.role || ""), config: cfg });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function decide(req: AuthRequest, res: Response, approve: boolean) {
  const cfg = await loadApprovalConfig();
  if (!cfg.approverRoles.includes(req.user?.role || "")) return res.status(403).json({ error: "Only an approver can decide · صرف منظور کرنے والا" });
  const id = parseInt(req.params.id);
  // claim it, so two clicks cannot write the payment twice
  const [a] = await rows(sql`update approval_requests set status = 'working', updated_at = now() where id = ${id} and status = 'pending' returning *`);
  if (!a) return res.status(409).json({ error: "Already decided" });
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
  if (!approve) {
    await db.execute(sql`update approval_requests set status = 'rejected', decided_by = ${req.user?.id ?? null}, decided_at = now(), decision_note = ${note} where id = ${id}`);
    await logAudit({ action: "UPDATE", tableName: "approval_requests", recordId: id, oldValues: { status: "pending" }, newValues: { status: "rejected", note }, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    return res.json({ ok: true, status: "rejected" });
  }
  try {
    const p = a.payload || {};
    const out = await selfApi(req, p.method || "POST", p.path, p.body, { "x-approved-request": String(id) });
    const ref = out?.id ? `${p.path}#${out.id}` : p.path;
    await db.execute(sql`update approval_requests set status = 'approved', decided_by = ${req.user?.id ?? null}, decided_at = now(), decision_note = ${note}, result_ref = ${ref} where id = ${id}`);
    await logAudit({ action: "UPDATE", tableName: "approval_requests", recordId: id, oldValues: { status: "pending" }, newValues: { status: "approved", ref }, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.json({ ok: true, status: "approved", result: out });
  } catch (e: any) {
    await db.execute(sql`update approval_requests set status = 'pending', decision_note = ${`Could not write it: ${String(e.message).slice(0, 300)}`} where id = ${id}`);
    res.status(400).json({ error: e.message });
  }
}

router.post("/:id(\\d+)/approve", requireRole(READ), (req: AuthRequest, res: Response) => void decide(req, res, true));
router.post("/:id(\\d+)/reject", requireRole(READ), (req: AuthRequest, res: Response) => void decide(req, res, false));

export default router;
