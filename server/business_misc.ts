/**
 * Smaller business tools in one place:
 *
 *  Currency rates · کرنسی ریٹ   /api/currency
 *    The rate of each foreign currency (USD, Toman, AFN, AED …) to PKR on a day, entered by you —
 *    the system never assumes a rate. Forms use it to turn "$1,100" into PKR and note the rate.
 *      GET  /api/currency               latest rate of each code + the last 100 rates
 *      POST /api/currency               { code, date, rate, note }
 *      DELETE /api/currency/:id
 *
 *  Custom fields · اپنے خانے          /api/custom-fields
 *    Your own extra fields on a party, truck, driver, customer, invoice or khata.
 *      GET  /api/custom-fields?entity=           the fields
 *      POST /api/custom-fields                   { entity, label, fieldType, options }
 *      DELETE /api/custom-fields/:id
 *      GET  /api/custom-fields/values?entity=&recordId=
 *      PUT  /api/custom-fields/values            { entity, recordId, values: { key: value } }
 *
 *  Depreciation register · فرسودگی    /api/depreciation
 *    Each truck's cost, method and rate (given by your accountant — never assumed) → the charge
 *    for each financial year (July–June) and its written-down value. A register only: it does
 *    not post to the books.
 *      GET  /api/depreciation
 *      PUT  /api/depreciation/:vehicleId         { method, ratePercent, usefulLifeYears, salvageValue, startDate, cost }
 */
import { Router, Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";

const rows = async (q: any) => ((await db.execute(q)) as any).rows as any[];
const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor", "Operations Manager"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];
const ADMIN = ["Super Admin", "Admin"];
const audit = (req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", table: string, id: number, o: unknown, n: unknown) =>
  logAudit({ action, tableName: table, recordId: id, oldValues: o, newValues: n, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
const isDay = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ======================================================================== currency
export const currencyRouter = Router();
currencyRouter.use(requireAuth, requireApproved);
export const CURRENCIES: Record<string, string> = { USD: "US Dollar", TMN: "Iranian Toman", IRR: "Iranian Rial", AFN: "Afghani", AED: "UAE Dirham", SAR: "Saudi Riyal", CNY: "Chinese Yuan", EUR: "Euro", GBP: "Pound" };

currencyRouter.get("/", requireRole(READ), async (_req, res: Response) => {
  try {
    const latest = await rows(sql`select distinct on (code) id, code, to_char(rate_date, 'YYYY-MM-DD') rate_date, rate::float rate, note from currency_rates order by code, rate_date desc, id desc`);
    const history = await rows(sql`select r.id, r.code, to_char(r.rate_date, 'YYYY-MM-DD') rate_date, r.rate::float rate, r.note, u.name by_name from currency_rates r left join users u on u.id = r.created_by order by r.rate_date desc, r.id desc limit 100`);
    res.json({ latest, history, currencies: CURRENCIES });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

currencyRouter.post("/", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const code = String(b.code || "").toUpperCase().trim();
    const rate = Number(b.rate);
    if (!/^[A-Z]{3}$/.test(code)) return res.status(400).json({ error: "Choose the currency" });
    if (!(rate > 0)) return res.status(400).json({ error: "Enter the rate in PKR · ریٹ لکھیں" });
    const date = isDay(b.date) ? b.date : new Date().toISOString().slice(0, 10);
    const [r] = await rows(sql`insert into currency_rates (code, rate_date, rate, note, created_by) values (${code}, ${date}::date, ${rate}, ${b.note || null}, ${req.user?.id ?? null})
      on conflict (code, rate_date) do update set rate = excluded.rate, note = excluded.note, created_by = excluded.created_by returning *`);
    await audit(req, "CREATE", "currency_rates", r.id, null, r);
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

currencyRouter.delete("/:id(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  const [r] = await rows(sql`delete from currency_rates where id = ${parseInt(req.params.id)} returning *`);
  if (!r) return res.status(404).json({ error: "Not found" });
  await audit(req, "DELETE", "currency_rates", r.id, r, null);
  res.json({ ok: true });
});

// ======================================================================== custom fields
export const customFieldsRouter = Router();
customFieldsRouter.use(requireAuth, requireApproved);
export const CF_ENTITIES: Record<string, string> = { party: "Parties", vehicle: "Trucks", driver: "Drivers", contractor: "Customers", invoice: "Invoices", truck_ledger: "Truck khata", employee: "Staff" };
const CF_TYPES = ["text", "number", "date", "select", "yesno"];

customFieldsRouter.get("/", async (req, res: Response) => {
  try {
    const entity = String(req.query.entity || "");
    const list = await rows(sql`select id, entity, key, label, field_type, options, sort from custom_fields where not is_deleted ${entity ? sql`and entity = ${entity}` : sql``} order by entity, sort, id`);
    res.json({ fields: list, entities: CF_ENTITIES, types: CF_TYPES });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

customFieldsRouter.post("/", requireRole(ADMIN), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    if (!CF_ENTITIES[b.entity]) return res.status(400).json({ error: "Choose where the field goes" });
    const label = String(b.label || "").trim().slice(0, 60);
    if (!label) return res.status(400).json({ error: "Give the field a name · نام لکھیں" });
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `f${Date.now()}`;
    const type = CF_TYPES.includes(b.fieldType) ? b.fieldType : "text";
    const options = type === "select" ? (Array.isArray(b.options) ? b.options : String(b.options || "").split(",")).map((o: string) => String(o).trim()).filter(Boolean).slice(0, 40) : [];
    const [r] = await rows(sql`insert into custom_fields (entity, key, label, field_type, options, sort, created_by)
      values (${b.entity}, ${key}, ${label}, ${type}, ${JSON.stringify(options)}::jsonb, ${Number(b.sort) || 0}, ${req.user?.id ?? null})
      on conflict (entity, key) do update set label = excluded.label, field_type = excluded.field_type, options = excluded.options, is_deleted = false returning *`);
    await audit(req, "CREATE", "custom_fields", r.id, null, r);
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

customFieldsRouter.delete("/:id(\\d+)", requireRole(ADMIN), async (req: AuthRequest, res: Response) => {
  const [r] = await rows(sql`update custom_fields set is_deleted = true where id = ${parseInt(req.params.id)} returning *`);
  if (!r) return res.status(404).json({ error: "Not found" });
  await audit(req, "DELETE", "custom_fields", r.id, r, null);
  res.json({ ok: true });
});

customFieldsRouter.get("/values", async (req, res: Response) => {
  try {
    const entity = String(req.query.entity || "");
    const id = parseInt(String(req.query.recordId || ""));
    if (!CF_ENTITIES[entity] || !id) return res.status(400).json({ error: "entity and recordId are required" });
    const vals = await rows(sql`select key, value from custom_field_values where entity = ${entity} and record_id = ${id}`);
    res.json({ values: Object.fromEntries(vals.map((v) => [v.key, v.value])) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

customFieldsRouter.put("/values", requireRole(WRITE.concat(["Operations Manager", "HR Manager", "Fleet Manager"])), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const id = parseInt(b.recordId);
    if (!CF_ENTITIES[b.entity] || !id) return res.status(400).json({ error: "entity and recordId are required" });
    const keys = new Set((await rows(sql`select key from custom_fields where entity = ${b.entity} and not is_deleted`)).map((r) => r.key));
    const values = b.values && typeof b.values === "object" ? b.values : {};
    for (const [k, v] of Object.entries(values)) {
      if (!keys.has(k)) continue;
      const val = v == null || v === "" ? null : String(v).slice(0, 1000);
      await db.execute(sql`insert into custom_field_values (entity, record_id, key, value, updated_by, updated_at) values (${b.entity}, ${id}, ${k}, ${val}, ${req.user?.id ?? null}, now())
        on conflict (entity, record_id, key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`);
    }
    await audit(req, "UPDATE", `custom_field_values:${b.entity}`, id, null, values);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ======================================================================== depreciation
export const depreciationRouter = Router();
depreciationRouter.use(requireAuth, requireApproved);

/** Charge for each financial year (July–June) from the start date to the current year. */
export function depreciationSchedule(s: { cost: number; method: string; ratePercent: number | null; usefulLifeYears: number | null; salvage: number; start: string }, today = new Date()) {
  const out: Array<{ fy: string; opening: number; charge: number; closing: number }> = [];
  const cost = Math.max(0, s.cost || 0);
  if (!cost || !s.start) return out;
  const [sy, sm] = s.start.split("-").map(Number);
  let fy = sm >= 7 ? sy : sy - 1; // the year that holds the start date
  const lastFy = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  let wdv = cost;
  const salvage = Math.min(cost, Math.max(0, s.salvage || 0));
  const straightYearly = s.method === "straight" && s.usefulLifeYears ? (cost - salvage) / s.usefulLifeYears : 0;
  for (let i = 0; fy <= lastFy && i < 60; fy++, i++) {
    // months owned in this year: the first year from the start month, the rest a full 12
    const months = i === 0 ? 12 - ((sm - 7 + 12) % 12) : 12;
    let charge = 0;
    if (s.method === "straight") charge = (straightYearly * months) / 12;
    else if (s.ratePercent) charge = (wdv * (s.ratePercent / 100) * months) / 12;
    charge = Math.min(Math.round(charge), Math.max(0, wdv - salvage));
    out.push({ fy: `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`, opening: Math.round(wdv), charge, closing: Math.round(wdv - charge) });
    wdv -= charge;
  }
  return out;
}

depreciationRouter.get("/", requireRole(READ), async (_req, res: Response) => {
  try {
    const list = await rows(sql`select v.id vehicle_id, v.vehicle_number, v.truck_brand, v.model, v.purchase_cost, to_char(v.purchase_date, 'YYYY-MM-DD') purchase_date,
        d.method, d.rate_percent::float rate_percent, d.useful_life_years, d.salvage_value, to_char(d.start_date, 'YYYY-MM-DD') start_date, d.cost, d.notes
      from vehicles v left join asset_depreciation d on d.vehicle_id = v.id where not v.is_deleted order by v.vehicle_number`);
    const out = list.map((r) => {
      const cost = Number(r.cost ?? r.purchase_cost ?? 0);
      const start = r.start_date || r.purchase_date;
      const set = !!(r.method && (r.rate_percent || r.useful_life_years));
      const schedule = set ? depreciationSchedule({ cost, method: r.method, ratePercent: r.rate_percent, usefulLifeYears: r.useful_life_years, salvage: Number(r.salvage_value || 0), start }) : [];
      const thisYear = schedule[schedule.length - 1] || null;
      const accumulated = schedule.reduce((s, y) => s + y.charge, 0);
      return {
        ...r,
        cost,
        start,
        set,
        missing: !cost ? "cost" : !start ? "date" : !set ? "rate" : null,
        thisYear,
        accumulated,
        wdv: cost - accumulated,
        schedule,
      };
    });
    const totals = out.reduce((t, r) => ({ cost: t.cost + r.cost, accumulated: t.accumulated + r.accumulated, wdv: t.wdv + (r.set ? r.wdv : r.cost), thisYear: t.thisYear + (r.thisYear?.charge || 0) }), { cost: 0, accumulated: 0, wdv: 0, thisYear: 0 });
    res.json({ list: out, totals });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

depreciationRouter.put("/:vehicleId(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const vid = parseInt(req.params.vehicleId);
    const b = req.body || {};
    const method = b.method === "straight" ? "straight" : "reducing";
    const rate = b.ratePercent === "" || b.ratePercent == null ? null : Number(b.ratePercent);
    const life = b.usefulLifeYears === "" || b.usefulLifeYears == null ? null : Math.round(Number(b.usefulLifeYears));
    if (method === "reducing" && rate != null && !(rate > 0 && rate < 100)) return res.status(400).json({ error: "Rate must be between 0 and 100 %" });
    if (method === "straight" && life != null && !(life > 0 && life <= 50)) return res.status(400).json({ error: "Useful life must be 1–50 years" });
    const [old] = await rows(sql`select * from asset_depreciation where vehicle_id = ${vid}`);
    const [r] = await rows(sql`insert into asset_depreciation (vehicle_id, method, rate_percent, useful_life_years, salvage_value, start_date, cost, notes, updated_by, updated_at)
      values (${vid}, ${method}, ${rate}, ${life}, ${Math.max(0, Math.round(Number(b.salvageValue) || 0))}, ${isDay(b.startDate) ? b.startDate : null}::date,
              ${b.cost === "" || b.cost == null ? null : Math.round(Number(b.cost))}, ${b.notes || null}, ${req.user?.id ?? null}, now())
      on conflict (vehicle_id) do update set method = excluded.method, rate_percent = excluded.rate_percent, useful_life_years = excluded.useful_life_years,
        salvage_value = excluded.salvage_value, start_date = excluded.start_date, cost = excluded.cost, notes = excluded.notes, updated_by = excluded.updated_by, updated_at = now()
      returning *`);
    await audit(req, old ? "UPDATE" : "CREATE", "asset_depreciation", r.id, old || null, r);
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
