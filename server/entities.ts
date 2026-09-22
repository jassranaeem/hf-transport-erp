/**
 * Generic per-entity CRUD API — the server side of the editable spreadsheet grid.
 *
 *   GET    /api/entities                 - list every registered sheet (key, label, columns)
 *   GET    /api/entities/:key            - paginated rows  ?limit&offset&search&sort&dir&f_<col>=
 *   GET    /api/entities/:key/:id        - one row
 *   POST   /api/entities/:key            - create one row
 *   PATCH  /api/entities/:key/:id        - partial update (cell edits)
 *   DELETE /api/entities/:key/:id        - soft-delete (or hard when no isDeleted)
 *   POST   /api/entities/:key/bulk       - [{op:'create'|'update'|'delete', id?, data?}]
 *
 * Everything is driven by the dataio registry (registry.ts) so a new table needs
 * no code here — just a spec. Foreign keys are accepted either as a numeric id or
 * as the target's natural-key string; they come back resolved to the string.
 */
import { Router, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { requireAuth, requireApproved, AuthRequest } from "../src/middleware/auth.ts";
import { hasPermissionServer } from "./rbac_service.ts";
import type { Resource, Action } from "../src/lib/rbac.ts";
import { getEntity, listEntities } from "../src/lib/dataio/registry.ts";
import { db } from "../src/db/index.ts";
import { fetchPage, coerceRecord } from "../src/lib/dataio/engine.ts";
import { logAudit } from "../src/db/audit.ts";
import { recompute as recomputeLedger } from "./ledgers.ts";
import { recompute as recomputeParty } from "./parties.ts";

const router = Router();
router.use(requireAuth, requireApproved);

function entityOr404(req: AuthRequest, res: Response) {
  const spec = getEntity(req.params.key);
  if (!spec) {
    res.status(404).json({ error: `Unknown sheet "${req.params.key}"` });
    return null;
  }
  return spec;
}

function can(role: string | undefined, resource: string | undefined, action: Action): boolean {
  if (role === "Super Admin") return true;
  return hasPermissionServer(role, (resource || "settings") as Resource, action);
}

function guard(action: Action) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const spec = getEntity(req.params.key);
    if (!spec) return res.status(404).json({ error: `Unknown sheet "${req.params.key}"` });
    if (!can(req.user?.role, spec.resource, action)) {
      return res.status(403).json({
        error: `Forbidden: role "${req.user?.role}" cannot ${action} ${spec.label}.`,
      });
    }
    next();
  };
}

/**
 * running-balance rebuild for the khata tables. Needed not just for the two
 * entry tables (a naam/jama row changed) but also for the "Parties List" raw
 * sheet: it lets Opening Balance be typed directly into the grid, and
 * `parties.closingBalance` never auto-syncs to it on its own (schema default
 * is 0, and the dedicated app routes are the only ones that used to call
 * recompute()) — without this, a party created or edited from the raw sheet
 * would show the Opening Balance you typed but a stale/zero Balance over in
 * Party Ledgers until some unrelated entry happened to trigger a recompute.
 * `truck_ledgers` is included too for the same "just wrote the header row"
 * reason, though note its recompute() works differently: a truck ledger's
 * Balance is derived purely from its Received/Paid entries (reset at each
 * section), not from its Opening Balance field — that field is only a
 * reference value captured at import time.
 */
async function afterLedgerWrite(key: string, row: any) {
  try {
    if (key === "truck_ledger_entries" && row?.ledgerId) await recomputeLedger(Number(row.ledgerId));
    else if (key === "party_ledger_entries" && row?.partyId) await recomputeParty(Number(row.partyId));
    else if (key === "truck_ledgers" && row?.id) await recomputeLedger(Number(row.id));
    else if (key === "parties" && row?.id) await recomputeParty(Number(row.id));
  } catch (err) {
    console.error(`[entities] recompute after ${key} write failed:`, err);
  }
}

// -------------------------------------------------------------------- list all
router.get("/", (req: AuthRequest, res: Response) => {
  const role = req.user?.role;
  const all = listEntities().map((e) => ({
    ...e,
    canRead: can(role, e.resource, "read"),
    canWrite: can(role, e.resource, "update"),
  }));
  res.json({ entities: all });
});

// ----------------------------------------------------------------- column meta
router.get("/:key/meta", guard("read"), (req: AuthRequest, res: Response) => {
  const spec = entityOr404(req, res);
  if (!spec) return;
  res.json({
    key: spec.key,
    label: spec.label,
    resource: spec.resource,
    softDelete: !!spec.softDelete,
    canWrite: can(req.user?.role, spec.resource, "update"),
    canDelete: can(req.user?.role, spec.resource, "delete"),
    fields: spec.fields.map((f) => ({
      column: f.column,
      field: f.field,
      type: f.type,
      required: !!f.required,
      readonly: !!f.readonly,
      naturalKey: !!f.naturalKey,
      enumValues: f.enumValues ?? null,
      ref: f.ref ?? null,
      note: f.note ?? null,
    })),
  });
});

// ---------------------------------------------------------------------- list
router.get("/:key", guard("read"), async (req: AuthRequest, res: Response) => {
  const spec = entityOr404(req, res);
  if (!spec) return;

  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (k.startsWith("f_") && typeof v === "string") filters[k.slice(2)] = v;
  }

  try {
    const { rows, total } = await fetchPage(spec, {
      limit: Number(req.query.limit) || 100,
      offset: Number(req.query.offset) || 0,
      search: (req.query.search as string) || undefined,
      sort: (req.query.sort as string) || undefined,
      dir: req.query.dir === "asc" ? "asc" : "desc",
      filters,
      resolveRefs: true,
      includeDeleted: req.query.includeDeleted === "1",
    });
    res.json({
      key: spec.key,
      label: spec.label,
      rows,
      total,
      limit: Number(req.query.limit) || 100,
      offset: Number(req.query.offset) || 0,
      canWrite: can(req.user?.role, spec.resource, "update"),
      canDelete: can(req.user?.role, spec.resource, "delete"),
      fields: spec.fields.map((f) => ({
        column: f.column,
        field: f.field,
        type: f.type,
        required: !!f.required,
        readonly: !!f.readonly,
        naturalKey: !!f.naturalKey,
        enumValues: f.enumValues ?? null,
        ref: f.ref ?? null,
      })),
    });
  } catch (err: any) {
    console.error(`[entities] list ${spec.key} failed:`, err);
    res.status(500).json({ error: err.message || "List failed" });
  }
});

// ----------------------------------------------------------------------- get one
router.get("/:key/:id(\\d+)", guard("read"), async (req: AuthRequest, res: Response) => {
  const spec = entityOr404(req, res);
  if (!spec) return;
  const table: any = spec.table;
  try {
    const found = await db.select().from(table).where(eq(table.id, Number(req.params.id))).limit(1);
    if (!found.length) return res.status(404).json({ error: "Row not found" });
    res.json({ row: found[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Fetch failed" });
  }
});

// ------------------------------------------------------------------------ create
router.post("/:key", guard("create"), async (req: AuthRequest, res: Response) => {
  const spec = entityOr404(req, res);
  if (!spec) return;
  const table: any = spec.table;
  try {
    const { values, errors } = await coerceRecord(spec, req.body || {}, undefined, { isCreate: true });
    if (errors.length) return res.status(400).json({ error: errors[0].message, errors });
    values.createdBy = req.user!.id;
    values.updatedBy = req.user!.id;
    const inserted = (await db.insert(table).values(values).returning()) as any[];
    const row = inserted[0];
    await afterLedgerWrite(spec.key, row);
    await logAudit({
      action: "CREATE",
      tableName: spec.key,
      recordId: row?.id ?? 0,
      newValues: values,
      performedBy: req.user!.id,
      ipAddress: req.ip || undefined,
      userAgent: req.headers["user-agent"] || undefined,
    });
    res.status(201).json({ row });
  } catch (err: any) {
    console.error(`[entities] create ${spec.key} failed:`, err);
    res.status(400).json({ error: err.message?.split("\n")[0] || "Create failed" });
  }
});

// ------------------------------------------------------------------------ update
router.patch("/:key/:id(\\d+)", guard("update"), async (req: AuthRequest, res: Response) => {
  const spec = entityOr404(req, res);
  if (!spec) return;
  const table: any = spec.table;
  const id = Number(req.params.id);
  try {
    const { values, errors } = await coerceRecord(spec, req.body || {});
    if (errors.length) return res.status(400).json({ error: errors[0].message, errors });
    if (Object.keys(values).length === 0) return res.status(400).json({ error: "No editable fields in payload" });
    values.updatedBy = req.user!.id;
    values.updatedAt = new Date();
    const [row] = await db.update(table).set(values).where(eq(table.id, id)).returning();
    if (!row) return res.status(404).json({ error: "Row not found" });
    await afterLedgerWrite(spec.key, row);
    await logAudit({
      action: "UPDATE",
      tableName: spec.key,
      recordId: id,
      newValues: values,
      performedBy: req.user!.id,
      ipAddress: req.ip || undefined,
      userAgent: req.headers["user-agent"] || undefined,
    });
    res.json({ row });
  } catch (err: any) {
    console.error(`[entities] update ${spec.key}#${id} failed:`, err);
    res.status(400).json({ error: err.message?.split("\n")[0] || "Update failed" });
  }
});

// ------------------------------------------------------------------------ delete
router.delete("/:key/:id(\\d+)", guard("delete"), async (req: AuthRequest, res: Response) => {
  const spec = entityOr404(req, res);
  if (!spec) return;
  const table: any = spec.table;
  const id = Number(req.params.id);
  try {
    const del = (spec.softDelete && table.isDeleted
      ? await db
          .update(table)
          .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user!.id })
          .where(eq(table.id, id))
          .returning()
      : await db.delete(table).where(eq(table.id, id)).returning()) as any[];
    const row = del[0];
    if (!row) return res.status(404).json({ error: "Row not found" });
    await afterLedgerWrite(spec.key, row);
    await logAudit({
      action: "DELETE",
      tableName: spec.key,
      recordId: id,
      oldValues: { id },
      performedBy: req.user!.id,
      ipAddress: req.ip || undefined,
      userAgent: req.headers["user-agent"] || undefined,
    });
    res.json({ ok: true, id });
  } catch (err: any) {
    console.error(`[entities] delete ${spec.key}#${id} failed:`, err);
    res.status(400).json({ error: err.message?.split("\n")[0] || "Delete failed" });
  }
});

// -------------------------------------------------------------------------- bulk
router.post("/:key/bulk", async (req: AuthRequest, res: Response) => {
  const spec = entityOr404(req, res);
  if (!spec) return;
  const table: any = spec.table;
  const ops: { op: "create" | "update" | "delete"; id?: number; data?: Record<string, unknown> }[] =
    Array.isArray(req.body?.ops) ? req.body.ops : [];
  if (!ops.length) return res.status(400).json({ error: "ops[] is required" });

  const role = req.user?.role;
  const need = new Set(ops.map((o) => o.op === "create" ? "create" : o.op === "delete" ? "delete" : "update"));
  for (const a of need) {
    if (!can(role, spec.resource, a as Action)) {
      return res.status(403).json({ error: `Forbidden: role "${role}" cannot ${a} ${spec.label}.` });
    }
  }

  const result = { created: 0, updated: 0, deleted: 0, errors: [] as { index: number; message: string }[] };
  const touched: any[] = [];

  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    try {
      if (o.op === "delete") {
        if (!o.id) throw new Error("delete needs an id");
        // Read the row first so afterLedgerWrite gets its real ledgerId/partyId —
        // o.data from the client and a bare {id} both lack that, which used to
        // silently skip the recompute() after a bulk delete from the grid,
        // leaving running_balance/closing_balance stale until an unrelated
        // edit on the same ledger/party happened to trigger a recompute.
        const [existing] = await db.select().from(table).where(eq(table.id, o.id)).limit(1);
        if (spec.softDelete && table.isDeleted) {
          await db.update(table).set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user!.id }).where(eq(table.id, o.id));
        } else {
          await db.delete(table).where(eq(table.id, o.id));
        }
        result.deleted++;
        touched.push(existing || o.data || { id: o.id });
        continue;
      }
      const { values, errors } = await coerceRecord(spec, o.data || {}, undefined, { isCreate: o.op === "create" });
      if (errors.length) throw new Error(errors[0].message);
      if (o.op === "create") {
        values.createdBy = req.user!.id;
        values.updatedBy = req.user!.id;
        const ins = (await db.insert(table).values(values).returning()) as any[];
        result.created++;
        touched.push(ins[0]);
      } else {
        if (!o.id) throw new Error("update needs an id");
        values.updatedBy = req.user!.id;
        values.updatedAt = new Date();
        const [row] = await db.update(table).set(values).where(eq(table.id, o.id)).returning();
        result.updated++;
        touched.push(row);
      }
    } catch (err: any) {
      result.errors.push({ index: i, message: err.message?.split("\n")[0] || "Row failed" });
    }
  }

  for (const row of touched) await afterLedgerWrite(spec.key, row);

  await logAudit({
    action: "UPDATE",
    tableName: `entities_bulk:${spec.key}`,
    recordId: result.created + result.updated + result.deleted,
    newValues: { ...result, errors: result.errors.length },
    performedBy: req.user!.id,
    ipAddress: req.ip || undefined,
    userAgent: req.headers["user-agent"] || undefined,
  });

  res.status(result.errors.length && !(result.created + result.updated + result.deleted) ? 400 : 200).json(result);
});

export default router;
