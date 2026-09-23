/**
 * System Reset & real Backups — a self-service "start fresh" button that
 * doesn't need a developer/AI in the room.
 *
 * `POST /api/system/backup`         - take a real, restorable snapshot now
 * `GET  /api/system/backups`        - list recent backups (real + old legacy rows)
 * `POST /api/system/backups/:id/restore` - restore a snapshot (destructive: replaces current data)
 * `POST /api/system/factory-reset`  - wipe the system back to a fresh install
 *                                     (auto-backs-up first, requires typed confirmation)
 *
 * A "backup" here is a JSON snapshot of every row in every table, stored in
 * `backups.data_json`. This works the same in dev and in a hosted deploy
 * (Render/Neon) since it's plain SQL - no `pg_dump` binary, no local disk
 * file that a redeploy could wipe.
 *
 * IMPORTANT: the pre-existing `/api/enterprise/backups/trigger` and
 * `/api/enterprise/backups/restore` routes (server/enterprise.ts) are LEGACY
 * DEMO CODE that only ever faked success (random file size, hardcoded
 * "SHA256 Match" text, no real dump/restore ever happened). Do not wire
 * anything new to those - this file is the real implementation. The old
 * routes are left in place for now (Console → Backups still calls them) but
 * should be pointed at this file's logic in a follow-up pass.
 */
import { Router, Response } from "express";
import { sql, eq, desc } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { logAudit } from "../src/db/audit.ts";

const router = Router();
router.use(requireAuth, requireApproved);

/** Tables that hold real business records - wiped by a factory reset. Everything
 *  else (login, company letterhead + office locations, integration config,
 *  RBAC, and the backups table itself so a reset can't erase its own safety
 *  net) is preserved - a reset clears the modules' data, not the company's
 *  own setup info. */
const KEEP_TABLES = new Set(["users", "company_profile", "branches", "system_settings", "role_permissions", "backups"]);

async function listPublicTables(): Promise<string[]> {
  const { rows } = await db.execute(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);
  return (rows as any[]).map((r) => r.table_name as string);
}

/** Dump every row of every (non-backups) table into one JSON snapshot. */
async function snapshotDatabase(): Promise<{ tables: Record<string, any[]>; sizeBytes: number; tableCount: number }> {
  const all = await listPublicTables();
  const tables: Record<string, any[]> = {};
  for (const t of all) {
    if (t === "backups") continue; // never snapshot the backups table into itself
    const { rows } = await db.execute(sql.raw(`select * from "${t}"`));
    tables[t] = rows as any[];
  }
  const json = JSON.stringify(tables);
  return { tables, sizeBytes: Buffer.byteLength(json, "utf8"), tableCount: Object.keys(tables).length };
}

async function saveBackup(kind: "manual" | "pre-reset", userId?: number) {
  const snap = await snapshotDatabase();
  const fileName = `${kind === "pre-reset" ? "pre-reset" : "manual"}-backup-${Date.now()}.json`;
  const [row] = await db
    .insert(schema.backups)
    .values({
      fileName,
      fileSize: snap.sizeBytes,
      status: "SUCCESS",
      verified: true,
      dataJson: snap.tables,
      kind,
      createdBy: userId,
    })
    .returning({ id: schema.backups.id, fileName: schema.backups.fileName, fileSize: schema.backups.fileSize, createdAt: schema.backups.createdAt, kind: schema.backups.kind });
  await logAudit({ action: "CREATE", tableName: "backups", recordId: row.id, newValues: { fileName, tableCount: snap.tableCount, kind }, performedBy: userId });
  return row;
}

// ---- take a backup on demand -------------------------------------------
router.post("/backup", requireRole(["Super Admin"]), async (req: AuthRequest, res: Response) => {
  try {
    const row = await saveBackup("manual", req.user?.id);
    res.json({ backup: row, message: `Backup "${row.fileName}" saved (${row.fileSize?.toLocaleString()} bytes).` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- list backups (real ones have dataJson; pre-migration legacy rows don't) ----
router.get("/backups", async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db
      .select({
        id: schema.backups.id,
        fileName: schema.backups.fileName,
        fileSize: schema.backups.fileSize,
        status: schema.backups.status,
        verified: schema.backups.verified,
        kind: schema.backups.kind,
        createdAt: schema.backups.createdAt,
        restorable: sql<boolean>`(${schema.backups.dataJson} is not null)`,
      })
      .from(schema.backups)
      .orderBy(desc(schema.backups.createdAt))
      .limit(30);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- restore a snapshot (destructive: replaces everything it covers) ----
router.post("/backups/:id(\\d+)/restore", requireRole(["Super Admin"]), async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const { confirmText } = req.body || {};
  if (confirmText !== "RESTORE BACKUP") {
    return res.status(400).json({ error: 'Type "RESTORE BACKUP" exactly to confirm - this replaces current data.' });
  }
  try {
    const [b] = await db.select().from(schema.backups).where(eq(schema.backups.id, id)).limit(1);
    if (!b) return res.status(404).json({ error: "Backup not found" });
    if (!b.dataJson) {
      return res.status(400).json({ error: "This backup has no restorable data (an old simulated entry from before real backups existed)." });
    }
    const snapshot = b.dataJson as Record<string, any[]>;
    // Only restore tables that still exist today (a snapshot from before a
    // schema change might name a table that's since been dropped/renamed).
    const { rows: existing } = await db.execute(sql`
      select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
    `);
    const existingSet = new Set((existing as any[]).map((r) => r.table_name as string));
    const tablesInSnapshot = Object.keys(snapshot).filter((t) => t !== "backups" && existingSet.has(t));

    // One transaction: defer FK checks for the session (table owner/superuser
    // only) so tables can be reloaded in any order, then let Postgres's own
    // json_populate_recordset do all the type coercion (dates, jsonb, numerics)
    // instead of hand-building typed INSERTs ourselves.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.execute(sql.raw(`TRUNCATE TABLE ${tablesInSnapshot.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`));
      for (const t of tablesInSnapshot) {
        const rowsForTable = snapshot[t];
        if (!rowsForTable || rowsForTable.length === 0) continue;
        const tableIdent = sql.raw(`"${t}"`);
        await tx.execute(sql`
          insert into ${tableIdent}
          select * from json_populate_recordset(NULL::${tableIdent}, ${JSON.stringify(rowsForTable)}::json)
        `);
        // json_populate_recordset doesn't advance serial sequences - fix each
        // table's "id" sequence so the next insert doesn't collide.
        await tx.execute(sql.raw(`
          select setval(seq, coalesce(mx, 1))
          from (
            select pg_get_serial_sequence('${t}', 'id') as seq, (select max(id) from "${t}") as mx
          ) s
          where seq is not null
        `));
      }
    });

    await logAudit({ action: "UPDATE", tableName: "backups", recordId: id, newValues: { restored: true, tables: tablesInSnapshot.length }, performedBy: req.user?.id });
    res.json({ ok: true, restoredTables: tablesInSnapshot.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- factory reset: wipe every business table back to a fresh install ----
router.post("/factory-reset", requireRole(["Super Admin"]), async (req: AuthRequest, res: Response) => {
  const { confirmText } = req.body || {};
  if (confirmText !== "RESET SYSTEM") {
    return res.status(400).json({ error: 'Type "RESET SYSTEM" exactly to confirm - this deletes all fleet/finance/HR/fuel data.' });
  }
  try {
    // Always back up first - a reset must never be a one-way door.
    const backup = await saveBackup("pre-reset", req.user?.id);

    const all = await listPublicTables();
    const toWipe = all.filter((t) => !KEEP_TABLES.has(t));
    await db.execute(sql.raw(`TRUNCATE TABLE ${toWipe.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`));

    await logAudit({
      action: "DELETE",
      tableName: "SYSTEM_FACTORY_RESET",
      newValues: { wipedTables: toWipe.length, backupId: backup.id, backupFileName: backup.fileName },
      performedBy: req.user?.id,
    });

    res.json({
      ok: true,
      wipedTables: toWipe.length,
      backup: { id: backup.id, fileName: backup.fileName },
      message: `System reset to fresh. A backup ("${backup.fileName}") was saved first — restore it from Console → Backups if this was a mistake.`,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export const systemResetRouter = router;
