/**
 * Recurring entries · ہر ماہ کی اندراجات — salary, rent, an instalment, a permit fee: written
 * once, and on each due day the system puts it in front of you as a draft (AI Accountant →
 * "Enter by AI", and on the Recurring page). Nothing reaches a khata until you approve it, and an
 * approved one can be undone like any other draft.
 *
 *   GET    /api/recurring            the list + what falls due in the next 30 days
 *   POST   /api/recurring            { name, target, template, frequency, dayOfMonth, nextDate, endDate }
 *   PUT    /api/recurring/:id        change it / pause it (isActive)
 *   DELETE /api/recurring/:id
 *   POST   /api/recurring/:id/run    make this one's draft now (for its next date)
 *   POST   /api/recurring/run-due    make every draft that is due
 *
 * target: cash (Daily Cash Book, optionally linked to a truck / party / household) | truck | party
 * template: { direction: In|Out, amount, method, vehicleId, partyId, category, person, description }
 */
import { Router, Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];
const rows = async (q: any) => ((await db.execute(q)) as any).rows as any[];
const TARGETS = ["cash", "truck", "party"];
const FREQ = ["monthly", "weekly", "quarterly", "yearly"];
const isDay = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The next due day after `d` (YYYY-MM-DD), keeping the chosen day of the month. */
export function nextDue(d: string, frequency: string, dayOfMonth?: number | null): string {
  const [y, m, day] = d.split("-").map(Number);
  if (frequency === "weekly") {
    const t = new Date(Date.UTC(y, m - 1, day + 7));
    return t.toISOString().slice(0, 10);
  }
  const step = frequency === "yearly" ? 12 : frequency === "quarterly" ? 3 : 1;
  const want = dayOfMonth || day;
  const last = new Date(Date.UTC(y, m - 1 + step + 1, 0)).getUTCDate(); // days in the target month
  return new Date(Date.UTC(y, m - 1 + step, Math.min(want, last))).toISOString().slice(0, 10);
}

function check(b: any) {
  if (!String(b.name || "").trim()) throw new Error("Give it a name · نام لکھیں");
  if (!TARGETS.includes(b.target)) throw new Error("Choose where it goes · کہاں درج ہو");
  const t = b.template || {};
  if (!(Number(t.amount) > 0)) throw new Error("Enter the amount · رقم درج کریں");
  if (t.direction !== "In" && t.direction !== "Out") throw new Error("Money in or out? · آیا یا گیا");
  if (b.target === "truck" && !t.vehicleId) throw new Error("Pick the truck · ٹرک منتخب کریں");
  if (b.target === "party" && !t.partyId) throw new Error("Pick the party · پارٹی منتخب کریں");
  if (!String(t.description || "").trim()) throw new Error("Write what it is for · تفصیل لکھیں");
  if (!isDay(b.nextDate)) throw new Error("Choose the first date · پہلی تاریخ");
  return {
    name: String(b.name).trim().slice(0, 120),
    target: b.target,
    template: {
      direction: t.direction,
      amount: Math.round(Number(t.amount)),
      method: t.method || "Cash",
      vehicleId: t.vehicleId ? Number(t.vehicleId) : null,
      partyId: t.partyId ? Number(t.partyId) : null,
      category: t.category || null,
      person: t.person || null,
      description: String(t.description).trim().slice(0, 300),
    },
    frequency: FREQ.includes(b.frequency) ? b.frequency : "monthly",
    dayOfMonth: b.dayOfMonth ? Math.min(31, Math.max(1, Number(b.dayOfMonth))) : Number(String(b.nextDate).slice(8, 10)),
    nextDate: b.nextDate,
    endDate: isDay(b.endDate) ? b.endDate : null,
  };
}

/** Make the draft for one recurring entry's next date and move it on. */
async function makeDraft(r: any, userId?: number | null) {
  const t = r.template || {};
  const day = typeof r.next_date === "string" ? r.next_date.slice(0, 10) : new Date(r.next_date).toISOString().slice(0, 10);
  const [d] = await rows(sql`insert into ai_drafts (batch, source, source_name, status, target, entry_date, direction, amount, method, vehicle_id, party_id, category, person, description, source_text, confidence, read_by, created_by)
    values (${`recurring-${day}`}, 'recurring', ${r.name}, 'pending', ${r.target}, ${day}, ${t.direction}, ${t.amount}, ${t.method || "Cash"},
            ${t.vehicleId ?? null}, ${t.partyId ?? null}, ${t.category ?? null}, ${t.person ?? null}, ${t.description}, ${`Recurring: ${r.name}`}, 'high', 'recurring', ${userId ?? r.created_by ?? null})
    returning id`);
  const next = nextDue(day, r.frequency, r.day_of_month);
  const ended = r.end_date && next > String(r.end_date).slice(0, 10);
  await db.execute(sql`update recurring_entries set next_date = ${next}::date, runs = runs + 1, last_run_at = now(), is_active = ${!ended}, updated_at = now() where id = ${r.id}`);
  return d.id as number;
}

/** Every active entry that is due (up to today), catching up at most 12 missed dates each. */
export async function runDueRecurring(): Promise<number> {
  let made = 0;
  for (let i = 0; i < 12; i++) {
    const due = await rows(sql`select * from recurring_entries where is_active and not is_deleted and next_date <= current_date
      and (end_date is null or next_date <= end_date) order by next_date limit 200`);
    if (!due.length) break;
    for (const r of due) {
      await makeDraft(r);
      made++;
    }
  }
  return made;
}

export function startRecurringKeeper() {
  const tick = () => runDueRecurring().catch((e) => console.warn("[recurring] run failed:", e?.message));
  setTimeout(tick, 45_000);
  setInterval(tick, 3600_000).unref?.();
}

router.get("/", requireRole(READ), async (_req, res: Response) => {
  try {
    const list = await rows(sql`select r.*, to_char(r.next_date, 'YYYY-MM-DD') next_day, to_char(r.end_date, 'YYYY-MM-DD') end_day,
        v.vehicle_number truck, p.name party
      from recurring_entries r
      left join vehicles v on v.id = (r.template ->> 'vehicleId')::int
      left join parties p on p.id = (r.template ->> 'partyId')::int
      where not r.is_deleted order by r.is_active desc, r.next_date`);
    const pending = await rows(sql`select d.id, d.source_name, d.entry_date, d.amount, d.direction, d.target, d.description, d.status
      from ai_drafts d where d.source = 'recurring' and d.status in ('pending', 'failed') order by d.entry_date, d.id`);
    const monthly = list.filter((r) => r.is_active).reduce((s, r) => {
      const a = Number(r.template?.amount || 0) * (r.template?.direction === "Out" ? -1 : 1);
      return s + (r.frequency === "weekly" ? a * 4.33 : r.frequency === "quarterly" ? a / 3 : r.frequency === "yearly" ? a / 12 : a);
    }, 0);
    res.json({ list, pending, monthly: Math.round(monthly) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const v = check(req.body || {});
    const [r] = await rows(sql`insert into recurring_entries (name, target, template, frequency, day_of_month, next_date, end_date, created_by)
      values (${v.name}, ${v.target}, ${JSON.stringify(v.template)}::jsonb, ${v.frequency}, ${v.dayOfMonth}, ${v.nextDate}::date, ${v.endDate}::date, ${req.user?.id ?? null}) returning *`);
    await logAudit({ action: "CREATE", tableName: "recurring_entries", recordId: r.id, oldValues: null, newValues: r, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    const made = await runDueRecurring(); // a first date in the past is due straight away
    res.json({ ...r, made });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.put("/:id(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await rows(sql`select *, to_char(next_date, 'YYYY-MM-DD') next_day, to_char(end_date, 'YYYY-MM-DD') end_day from recurring_entries where id = ${id} and not is_deleted`);
    if (!old) return res.status(404).json({ error: "Not found" });
    const b = req.body || {};
    if (Object.keys(b).length === 1 && "isActive" in b) {
      await db.execute(sql`update recurring_entries set is_active = ${!!b.isActive}, updated_at = now() where id = ${id}`);
    } else {
      const v = check({ name: old.name, target: old.target, frequency: old.frequency, dayOfMonth: old.day_of_month, nextDate: old.next_day, endDate: old.end_day, ...b, template: { ...old.template, ...(b.template || {}) } });
      await db.execute(sql`update recurring_entries set name = ${v.name}, target = ${v.target}, template = ${JSON.stringify(v.template)}::jsonb, frequency = ${v.frequency},
        day_of_month = ${v.dayOfMonth}, next_date = ${v.nextDate}::date, end_date = ${v.endDate}::date, updated_at = now() where id = ${id}`);
    }
    const [r] = await rows(sql`select * from recurring_entries where id = ${id}`);
    await logAudit({ action: "UPDATE", tableName: "recurring_entries", recordId: id, oldValues: old, newValues: r, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.json(r);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/:id(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id);
  const [r] = await rows(sql`update recurring_entries set is_deleted = true, is_active = false, updated_at = now() where id = ${id} returning *`);
  if (!r) return res.status(404).json({ error: "Not found" });
  await logAudit({ action: "DELETE", tableName: "recurring_entries", recordId: id, oldValues: r, newValues: null, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
  res.json({ ok: true });
});

router.post("/:id(\\d+)/run", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const [r] = await rows(sql`select * from recurring_entries where id = ${parseInt(req.params.id)} and not is_deleted`);
    if (!r) return res.status(404).json({ error: "Not found" });
    const draftId = await makeDraft(r, req.user?.id);
    res.json({ draftId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/run-due", requireRole(WRITE), async (_req, res: Response) => {
  try {
    res.json({ made: await runDueRecurring() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
