/**
 * Parties (Khata) — a running account for every business relationship:
 * customers, suppliers, lenders, borrowers, transporters, agents, banks.
 * Each party carries its own tax + bank details the user fills in.
 *
 *   debit  = naam  (party ko diya / party par charha)   -> balance goes up (party owes us)
 *   credit = jama  (party se mila)                       -> balance goes down
 *   runningBalance = Σ(debit - credit)   +ve = party se lena baaqi, -ve = party ko dena baaqi
 *
 * Mounted at /api/parties.
 */
import { Router, Response } from "express";
import multer from "multer";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { and, eq, desc, asc, sql, ilike, or, inArray, ne } from "drizzle-orm";
import { logAudit } from "../src/db/audit.ts";
import { parseTruckWorkbook, sourceLabelFromFilename } from "../src/lib/dataio/truck-workbook.ts";
import { sendSms, ledgerSmsText, ledgerSmsTokens } from "./sms.ts";

const router = Router();
router.use(requireAuth, requireApproved);

const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Operations Manager", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];
const workbookUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const audit = (req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", table: string, id: number, oldV: unknown, newV: unknown) =>
  logAudit({ action, tableName: table, recordId: id, oldValues: oldV, newValues: newV, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});

async function nextPartyCode(): Promise<string> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.parties);
  return `PTY-${String((n || 0) + 1).padStart(4, "0")}`;
}

// deterministic O(n) running-balance rebuild for one party (mirrors server/ledgers.ts recompute)
//
// Sort chronologically by entryDate first, not by sectionLabel — sectionLabel
// only encodes the original workbook page an IMPORTED row came from ("Page
// 1", "Page 2", ...), which happens to roughly track date for those rows.
// A manually-added entry (Khata quick-entry, or any entries API write) gets
// sectionLabel "Manual" — and "Manual" sorts alphabetically BEFORE "Page 1"
// ('M' < 'P'), so ordering by sectionLabel first ran a brand-new entry
// through this loop as if it happened FIRST, before an older imported one.
// The running balance is a sequential accumulation, so that one swapped
// row corrupted every runningBalance from that point on — the newest entry
// ended up stamped with a small/negative balance and an old entry ended up
// stamped with what was actually the final total. sectionLabel/srNo/id stay
// as tie-breakers for same-date rows (keeps a sheet's original row order)
// and for the rare row with no parseable date at all (sorts last, via
// Postgres's default NULLS LAST on ascending order).
const CHRONOLOGICAL_ORDER = [
  asc(schema.partyLedgerEntries.entryDate),
  asc(schema.partyLedgerEntries.sectionLabel),
  asc(schema.partyLedgerEntries.srNo),
  asc(schema.partyLedgerEntries.id),
];
export async function recompute(partyId: number) {
  const rows = await db
    .select()
    .from(schema.partyLedgerEntries)
    .where(and(eq(schema.partyLedgerEntries.partyId, partyId), eq(schema.partyLedgerEntries.isDeleted, false)))
    .orderBy(...CHRONOLOGICAL_ORDER);
  const [party] = await db.select().from(schema.parties).where(eq(schema.parties.id, partyId)).limit(1);
  let running = party?.openingBalance || 0;
  let section = "__start__";
  let last = running;
  for (const r of rows) {
    if (r.sectionLabel !== section && section !== "__start__") {
      // sections are page markers only; keep the balance continuous for parties
    }
    section = r.sectionLabel || "";
    running += (r.debit || 0) - (r.credit || 0);
    if (r.isReset) running = 0;
    last = running;
    if (r.runningBalance !== running) {
      await db.update(schema.partyLedgerEntries).set({ runningBalance: running }).where(eq(schema.partyLedgerEntries.id, r.id));
    }
  }
  await db.update(schema.parties).set({ closingBalance: last, updatedAt: new Date() }).where(eq(schema.parties.id, partyId));
  return last;
}

// ===========================================================================
// self-service Excel import  (same per-sheet, non-destructive rules as trucks)
// ===========================================================================
router.post("/import-workbook", requireRole(WRITE), workbookUpload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload an .xlsx workbook in the 'file' field." });
    const name = (req.file.originalname || "").toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xlsm")) {
      return res.status(400).json({ error: "File must be an Excel .xlsx workbook." });
    }
    // reuse the truck-workbook parser — same "SR#|DATE|…|RECEIVED|PAID|BALANCE" per-sheet shape
    const { ledgers, report } = await parseTruckWorkbook(req.file.buffer, sourceLabelFromFilename(req.file.originalname));
    if (ledgers.length === 0) {
      return res.status(400).json({ error: "No party-ledger sheets recognised.", skippedSheets: report.skippedSheets });
    }

    let partiesInserted = 0;
    let partiesUpdated = 0;
    let entriesInserted = 0;
    let entriesUpdated = 0;
    let entriesRemoved = 0;
    const failedSheets: Array<{ sheet: string; error: string }> = [];

    for (const L of ledgers) {
      try {
        const partyName = (L.ownerName ? `${L.title}`.replace(/\s+/g, " ").trim() : L.title || L.registration).slice(0, 200);
        let [party] = await db.select().from(schema.parties).where(eq(schema.parties.sourceSheet, L.sourceSheet)).limit(1);
        if (!party) [party] = await db.select().from(schema.parties).where(eq(schema.parties.name, partyName)).limit(1);
        if (!party) {
          [party] = await db
            .insert(schema.parties)
            .values({
              partyCode: await nextPartyCode(),
              name: partyName,
              type: "Other",
              openingBalance: L.openingBalance || 0,
              closingBalance: L.closingBalance || 0,
              sourceSheet: L.sourceSheet,
              notes: L.partnership ? `Imported. ${L.partnership.rawLines.join(" | ").slice(0, 300)}` : null,
              createdBy: req.user?.id,
            })
            .returning();
          partiesInserted++;
        } else {
          await db
            .update(schema.parties)
            .set({ name: partyName, sourceSheet: L.sourceSheet, isDeleted: false, deletedAt: null, updatedAt: new Date(), updatedBy: req.user?.id })
            .where(eq(schema.parties.id, party.id));
          partiesUpdated++;
        }

        const existing = await db
          .select({ id: schema.partyLedgerEntries.id, sourceRow: schema.partyLedgerEntries.sourceRow })
          .from(schema.partyLedgerEntries)
          .where(and(eq(schema.partyLedgerEntries.partyId, party.id), sql`${schema.partyLedgerEntries.sourceRow} is not null`));
        const byRow = new Map<number, number>();
        for (const r of existing) if (r.sourceRow != null) byRow.set(r.sourceRow, r.id);
        const seen = new Set<number>();

        for (const e of L.entries) {
          const vals = {
            partyId: party.id,
            srNo: e.srNo,
            entryDate: e.entryDate,
            rawDate: e.rawDate || null,
            description: e.description || null,
            refNo: null as string | null,
            method: e.method,
            debit: e.paid, // party ko diya
            credit: e.received, // party se mila
            runningBalance: e.runningBalance,
            sheetBalance: e.sheetBalance,
            category: e.category,
            sectionLabel: e.sectionLabel,
            isReset: e.isReset,
            sourceRow: e.sourceRow,
            needsReview: e.needsReview,
            reviewReason: e.reviewReason,
          };
          if (e.sourceRow != null && byRow.has(e.sourceRow)) {
            seen.add(e.sourceRow);
            await db
              .update(schema.partyLedgerEntries)
              .set({ ...vals, updatedAt: new Date(), updatedBy: req.user?.id, isDeleted: false, deletedAt: null })
              .where(eq(schema.partyLedgerEntries.id, byRow.get(e.sourceRow)!));
            entriesUpdated++;
          } else {
            await db.insert(schema.partyLedgerEntries).values({ ...vals, createdBy: req.user?.id });
            entriesInserted++;
          }
        }
        for (const [row, id] of byRow.entries()) {
          if (seen.has(row)) continue;
          await db
            .update(schema.partyLedgerEntries)
            .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id })
            .where(eq(schema.partyLedgerEntries.id, id));
          entriesRemoved++;
        }
        await recompute(party.id);
      } catch (err: any) {
        failedSheets.push({ sheet: L.sourceSheet, error: String(err?.message || err).slice(0, 300) });
      }
    }

    await logAudit({
      action: "CREATE",
      tableName: "parties",
      recordId: partiesInserted + partiesUpdated,
      newValues: { file: req.file.originalname, partiesInserted, partiesUpdated, entriesInserted },
      performedBy: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    }).catch(() => {});

    res.json({
      message:
        `Imported ${partiesInserted + partiesUpdated} parties (${partiesInserted} new, ${partiesUpdated} updated) — ` +
        `${entriesInserted} new entries, ${entriesUpdated} updated, ${entriesRemoved} removed.` +
        (failedSheets.length ? ` ${failedSheets.length} sheet(s) failed.` : ""),
      partiesInserted,
      partiesUpdated,
      entriesInserted,
      entriesUpdated,
      entriesRemoved,
      failedSheets,
      report: { totals: report.totals, skippedSheets: report.skippedSheets, ledgers: report.ledgers },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Import failed" });
  }
});

// ===========================================================================
// PARTIES master
// ===========================================================================
router.get("/", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(500, parseInt(req.query.limit as string) || 60);
    const offset = parseInt(req.query.offset as string) || 0;
    const search = ((req.query.search as string) || "").trim();
    const type = (req.query.type as string) || "";
    const cond = [eq(schema.parties.isDeleted, false)];
    if (search) {
      cond.push(
        or(
          ilike(schema.parties.name, `%${search}%`),
          ilike(schema.parties.phone, `%${search}%`),
          ilike(schema.parties.ntn, `%${search}%`),
          ilike(schema.parties.city, `%${search}%`),
          ilike(schema.parties.partyCode, `%${search}%`)
        ) as any
      );
    }
    if (type) cond.push(eq(schema.parties.type, type));

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.parties).where(and(...cond));
    const rows = await db
      .select()
      .from(schema.parties)
      .where(and(...cond))
      .orderBy(asc(schema.parties.name))
      .limit(limit)
      .offset(offset);

    const ids = rows.map((r) => r.id);
    const stats = ids.length
      ? await db
          .select({
            partyId: schema.partyLedgerEntries.partyId,
            entries: sql<number>`count(*)::int`,
            debit: sql<number>`coalesce(sum(${schema.partyLedgerEntries.debit}),0)::bigint`,
            credit: sql<number>`coalesce(sum(${schema.partyLedgerEntries.credit}),0)::bigint`,
            needReview: sql<number>`count(*) filter (where ${schema.partyLedgerEntries.needsReview})::int`,
          })
          .from(schema.partyLedgerEntries)
          .where(and(inArray(schema.partyLedgerEntries.partyId, ids), eq(schema.partyLedgerEntries.isDeleted, false)))
          .groupBy(schema.partyLedgerEntries.partyId)
      : [];
    const byId = new Map(stats.map((s) => [s.partyId, s]));

    res.json({
      total,
      limit,
      offset,
      parties: rows.map((r) => {
        const s = byId.get(r.id);
        return {
          ...r,
          entryCount: s?.entries || 0,
          totalDebit: Number(s?.debit || 0),
          totalCredit: Number(s?.credit || 0),
          needsReviewCount: s?.needReview || 0,
        };
      }),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/summary", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    const byType = await db
      .select({ type: schema.parties.type, n: sql<number>`count(*)::int` })
      .from(schema.parties)
      .where(eq(schema.parties.isDeleted, false))
      .groupBy(schema.parties.type);
    const [bal] = await db
      .select({
        parties: sql<number>`count(*)::int`,
        receivable: sql<number>`coalesce(sum(${schema.parties.closingBalance}) filter (where ${schema.parties.closingBalance} > 0),0)::bigint`,
        payable: sql<number>`coalesce(-sum(${schema.parties.closingBalance}) filter (where ${schema.parties.closingBalance} < 0),0)::bigint`,
      })
      .from(schema.parties)
      .where(eq(schema.parties.isDeleted, false));
    res.json({
      totals: {
        parties: bal?.parties || 0,
        totalReceivable: Number(bal?.receivable || 0),
        totalPayable: Number(bal?.payable || 0),
        net: Number(bal?.receivable || 0) - Number(bal?.payable || 0),
      },
      byType,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Dues & alerts — the "kisko dena / kis se lena / kisko NAHI dena" board.
 *   receiving = healthy receivable  (Active parties, balance > 0)
 *   payable   = what we owe          (Active parties, balance < 0)
 *   net       = receiving - payable
 *   dead      = stuck receivable     (Blocked / Inactive parties, balance > 0)
 *   doNotPay  = Blocked parties we owe (disputed — hold payment)
 *   overdue   = any non-zero balance with no ledger entry for 45+ days
 */
const OVERDUE_DAYS = 45;
const BANK_METHODS = ["Online", "Cheque", "Bank", "Bank Transfer", "IBFT", "RTGS", "Wire"];

router.get("/alerts", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    const [agg] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${schema.parties.status} = 'Active')::int`,
        blocked: sql<number>`count(*) filter (where ${schema.parties.status} = 'Blocked')::int`,
        inactive: sql<number>`count(*) filter (where ${schema.parties.status} = 'Inactive')::int`,
        receiving: sql<number>`coalesce(sum(${schema.parties.closingBalance}) filter (where ${schema.parties.closingBalance} > 0 and ${schema.parties.status} = 'Active'),0)::bigint`,
        payable: sql<number>`coalesce(-sum(${schema.parties.closingBalance}) filter (where ${schema.parties.closingBalance} < 0 and ${schema.parties.status} = 'Active'),0)::bigint`,
        dead: sql<number>`coalesce(sum(${schema.parties.closingBalance}) filter (where ${schema.parties.closingBalance} > 0 and ${schema.parties.status} in ('Blocked','Inactive')),0)::bigint`,
      })
      .from(schema.parties)
      .where(eq(schema.parties.isDeleted, false));

    // last ledger activity per party. Falls back to createdAt (always set)
    // when an entry's entryDate is blank — without this, a party whose only
    // entries happen to have no date (e.g. the grid date-input bug that used
    // to blank the field after a couple keystrokes — see SheetGrid.tsx)
    // showed lastAt as NULL, which the overdue filter below reads as "no
    // activity ever" and flags as 45+ days overdue even for a brand-new,
    // same-day entry.
    const last = await db
      .select({
        partyId: schema.partyLedgerEntries.partyId,
        lastAt: sql<string>`max(coalesce(${schema.partyLedgerEntries.entryDate}, ${schema.partyLedgerEntries.createdAt}))`,
      })
      .from(schema.partyLedgerEntries)
      .where(eq(schema.partyLedgerEntries.isDeleted, false))
      .groupBy(schema.partyLedgerEntries.partyId);
    const lastBy = new Map(last.map((r) => [r.partyId, r.lastAt ? new Date(r.lastAt) : null]));

    const slim = {
      id: schema.parties.id,
      partyCode: schema.parties.partyCode,
      name: schema.parties.name,
      phone: schema.parties.phone,
      type: schema.parties.type,
      status: schema.parties.status,
      balance: schema.parties.closingBalance,
      notes: schema.parties.notes,
    };

    const collectFrom = await db
      .select(slim)
      .from(schema.parties)
      .where(and(eq(schema.parties.isDeleted, false), eq(schema.parties.status, "Active"), sql`${schema.parties.closingBalance} > 0`))
      .orderBy(desc(schema.parties.closingBalance))
      .limit(15);

    const payTo = await db
      .select(slim)
      .from(schema.parties)
      .where(and(eq(schema.parties.isDeleted, false), eq(schema.parties.status, "Active"), sql`${schema.parties.closingBalance} < 0`))
      .orderBy(asc(schema.parties.closingBalance))
      .limit(15);

    const doNotPay = await db
      .select(slim)
      .from(schema.parties)
      .where(and(eq(schema.parties.isDeleted, false), eq(schema.parties.status, "Blocked")))
      .orderBy(sql`abs(${schema.parties.closingBalance}) desc`)
      .limit(30);

    // overdue: non-zero balance, no activity in 45+ days
    const nonZero = await db
      .select(slim)
      .from(schema.parties)
      .where(and(eq(schema.parties.isDeleted, false), ne(schema.parties.closingBalance, 0), ne(schema.parties.status, "Blocked")))
      .orderBy(sql`abs(${schema.parties.closingBalance}) desc`)
      .limit(2000);
    const cutoff = Date.now() - OVERDUE_DAYS * 86400_000;
    const overdue = nonZero
      .map((p) => {
        const la = lastBy.get(p.id) || null;
        return { ...p, lastEntryAt: la ? la.toISOString() : null, daysSince: la ? Math.round((Date.now() - la.getTime()) / 86400_000) : null };
      })
      .filter((p) => !p.lastEntryAt || (lastBy.get(p.id)?.getTime() ?? 0) < cutoff)
      .slice(0, 30);

    const withLast = (list: any[]) =>
      list.map((p) => {
        const la = lastBy.get(p.id) || null;
        return { ...p, lastEntryAt: la ? la.toISOString() : null, daysSince: la ? Math.round((Date.now() - la.getTime()) / 86400_000) : null };
      });

    res.json({
      totals: {
        receiving: Number(agg?.receiving || 0),
        payable: Number(agg?.payable || 0),
        net: Number(agg?.receiving || 0) - Number(agg?.payable || 0),
        dead: Number(agg?.dead || 0),
        counts: {
          total: agg?.total || 0,
          active: agg?.active || 0,
          blocked: agg?.blocked || 0,
          inactive: agg?.inactive || 0,
        },
      },
      collectFrom: withLast(collectFrom),
      payTo: withLast(payTo),
      doNotPay: withLast(doNotPay),
      overdue,
      overdueDays: OVERDUE_DAYS,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "name is required" });
    const [created] = await db
      .insert(schema.parties)
      .values({
        partyCode: b.partyCode || (await nextPartyCode()),
        name: b.name,
        type: b.type || "Other",
        phone: b.phone || null,
        address: b.address || null,
        city: b.city || null,
        ntn: b.ntn || null,
        strn: b.strn || null,
        bankName: b.bankName || null,
        bankAccountTitle: b.bankAccountTitle || null,
        bankAccountNo: b.bankAccountNo || null,
        iban: b.iban || null,
        openingBalance: Math.round(Number(b.openingBalance) || 0),
        closingBalance: Math.round(Number(b.openingBalance) || 0),
        notes: b.notes || null,
        status: b.status || "Active",
        smsAlerts: !!b.smsAlerts,
        createdBy: req.user?.id,
      })
      .returning();
    await audit(req, "CREATE", "parties", created.id, null, created);
    res.status(201).json(created);
  } catch (e: any) {
    res.status(String(e.message).includes("unique") ? 409 : 500).json({ error: e.message });
  }
});

router.put("/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.parties).where(eq(schema.parties.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Party not found" });
    const b = req.body || {};
    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user?.id };
    for (const k of ["name", "type", "phone", "address", "city", "ntn", "strn", "bankName", "bankAccountTitle", "bankAccountNo", "iban", "notes", "status"]) {
      if (b[k] !== undefined) patch[k] = b[k] || null;
    }
    if (b.smsAlerts !== undefined) patch.smsAlerts = !!b.smsAlerts;
    if (b.openingBalance !== undefined) patch.openingBalance = Math.round(Number(b.openingBalance) || 0);
    const [updated] = await db.update(schema.parties).set(patch).where(eq(schema.parties.id, id)).returning();
    if (b.openingBalance !== undefined) await recompute(id);
    await audit(req, "UPDATE", "parties", id, old, updated);
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await db
      .update(schema.parties)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id })
      .where(eq(schema.parties.id, id));
    await audit(req, "DELETE", "parties", id, null, null);
    res.json({ message: "Party deleted" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// PARTY LEDGER
// ===========================================================================
router.get("/:id", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [party] = await db.select().from(schema.parties).where(eq(schema.parties.id, id)).limit(1);
    if (!party) return res.status(404).json({ error: "Party not found" });

    const limit = Math.min(5000, parseInt(req.query.limit as string) || 2000);
    const offset = parseInt(req.query.offset as string) || 0;
    const cond = [eq(schema.partyLedgerEntries.partyId, id), eq(schema.partyLedgerEntries.isDeleted, false)];
    if (req.query.needsReview === "1") cond.push(eq(schema.partyLedgerEntries.needsReview, true));
    if (req.query.category) cond.push(eq(schema.partyLedgerEntries.category, req.query.category as string));

    const entriesRaw = await db
      .select()
      .from(schema.partyLedgerEntries)
      .where(and(...cond))
      .orderBy(...CHRONOLOGICAL_ORDER) // must match recompute()'s order, or displayed rows won't line up with their own stored runningBalance
      .limit(limit)
      .offset(offset);

    // how many receipts / proofs each entry carries
    const entryIds = entriesRaw.map((e) => e.id);
    const attCounts = entryIds.length
      ? await db
          .select({ entityId: schema.attachments.entityId, n: sql<number>`count(*)::int` })
          .from(schema.attachments)
          .where(
            and(
              eq(schema.attachments.entityType, "party_ledger_entry"),
              inArray(schema.attachments.entityId, entryIds),
              eq(schema.attachments.isDeleted, false),
            ),
          )
          .groupBy(schema.attachments.entityId)
      : [];
    const attBy = new Map(attCounts.map((a) => [a.entityId, a.n]));
    const entries = entriesRaw.map((e) => ({ ...e, attachmentCount: attBy.get(e.id) || 0 }));

    const [agg] = await db
      .select({
        debit: sql<number>`coalesce(sum(${schema.partyLedgerEntries.debit}),0)::bigint`,
        credit: sql<number>`coalesce(sum(${schema.partyLedgerEntries.credit}),0)::bigint`,
        entries: sql<number>`count(*)::int`,
      })
      .from(schema.partyLedgerEntries)
      .where(and(eq(schema.partyLedgerEntries.partyId, id), eq(schema.partyLedgerEntries.isDeleted, false)));

    res.json({
      party,
      entries,
      totals: {
        totalDebit: Number(agg?.debit || 0),
        totalCredit: Number(agg?.credit || 0),
        entries: agg?.entries || 0,
        balance: party.closingBalance,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/entries", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const partyId = parseInt(req.params.id);
    const [party] = await db.select().from(schema.parties).where(eq(schema.parties.id, partyId)).limit(1);
    if (!party) return res.status(404).json({ error: "Party not found" });
    const b = req.body || {};
    const debit = Math.max(0, Math.round(Number(b.debit) || 0));
    const credit = Math.max(0, Math.round(Number(b.credit) || 0));
    const amount = debit > 0 ? debit : credit;
    const refKey = String(b.refNo || b.description || "").trim().toLowerCase();

    // "yeh banda double dey raha hai" — same party, amount, date, ref already recorded?
    let dupWarning: string | null = null;
    if (amount > 0 && b.entryDate) {
      const existing = await db
        .select({ id: schema.partyLedgerEntries.id, date: schema.partyLedgerEntries.rawDate })
        .from(schema.partyLedgerEntries)
        .where(
          and(
            eq(schema.partyLedgerEntries.partyId, partyId),
            eq(schema.partyLedgerEntries.isDeleted, false),
            sql`to_char(${schema.partyLedgerEntries.entryDate}, 'YYYY-MM-DD') = ${String(b.entryDate).slice(0, 10)}`,
            sql`(case when ${schema.partyLedgerEntries.debit} > 0 then ${schema.partyLedgerEntries.debit} else ${schema.partyLedgerEntries.credit} end) = ${amount}`,
            refKey
              ? sql`lower(trim(coalesce(${schema.partyLedgerEntries.refNo}, ${schema.partyLedgerEntries.description}, ''))) = ${refKey}`
              : sql`1=1`,
          ),
        )
        .limit(1);
      if (existing.length) {
        dupWarning = `DUPLICATE: PKR ${amount.toLocaleString()} on ${String(b.entryDate).slice(0, 10)}${refKey ? ` (ref "${b.refNo || b.description}")` : ""} is already recorded for ${party.name}. Yeh banda double to nahi de raha?`;
      }
    }

    const [created] = await db
      .insert(schema.partyLedgerEntries)
      .values({
        partyId,
        srNo: b.srNo != null ? Number(b.srNo) : null,
        entryDate: b.entryDate ? new Date(b.entryDate) : null,
        rawDate: b.entryDate ? String(b.entryDate).slice(0, 10) : null,
        description: b.description || null,
        refNo: b.refNo || null,
        method: b.method || null,
        debit,
        credit,
        category: b.category || "Other",
        sectionLabel: b.sectionLabel || "Manual",
        needsReview: !!dupWarning,
        reviewReason: dupWarning ? "Possible duplicate — same amount + date + ref already recorded" : null,
        createdBy: req.user?.id,
      })
      .returning();
    const newBalance = await recompute(partyId);
    await audit(req, "CREATE", "party_ledger_entries", created.id, null, created);

    // SMS the party if they opted in and have a phone
    if (party.smsAlerts && party.phone) {
      const ledgerParams = {
        who: party.name,
        debit: created.debit || 0,
        credit: created.credit || 0,
        balance: newBalance,
        ref: created.refNo,
        date: created.rawDate,
      };
      sendSms({
        to: party.phone,
        body: ledgerSmsText(ledgerParams),
        tokens: ledgerSmsTokens(ledgerParams),
        relatedType: "party_ledger_entry",
        relatedId: created.id,
        partyId,
        createdBy: req.user?.id,
      }).catch((err) => console.error("[parties] sms failed:", err?.message));
    }

    res.status(201).json({ ...created, duplicateWarning: dupWarning });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/entries/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.partyLedgerEntries).where(eq(schema.partyLedgerEntries.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Entry not found" });
    const b = req.body || {};
    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user?.id };
    for (const k of ["description", "refNo", "method", "category", "sectionLabel", "reviewReason"]) {
      if (b[k] !== undefined) patch[k] = b[k] || null;
    }
    if (b.entryDate !== undefined) {
      patch.entryDate = b.entryDate ? new Date(b.entryDate) : null;
      patch.rawDate = b.entryDate ? String(b.entryDate).slice(0, 10) : old.rawDate;
    }
    if (b.debit !== undefined) patch.debit = Math.max(0, Math.round(Number(b.debit) || 0));
    if (b.credit !== undefined) patch.credit = Math.max(0, Math.round(Number(b.credit) || 0));
    if (b.srNo !== undefined) patch.srNo = b.srNo != null ? Number(b.srNo) : null;
    if (b.needsReview !== undefined) patch.needsReview = !!b.needsReview;
    const [updated] = await db.update(schema.partyLedgerEntries).set(patch).where(eq(schema.partyLedgerEntries.id, id)).returning();
    await recompute(old.partyId);
    await audit(req, "UPDATE", "party_ledger_entries", id, old, updated);
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/entries/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.partyLedgerEntries).where(eq(schema.partyLedgerEntries.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Entry not found" });
    await db
      .update(schema.partyLedgerEntries)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id })
      .where(eq(schema.partyLedgerEntries.id, id));
    await recompute(old.partyId);
    await audit(req, "DELETE", "party_ledger_entries", id, old, null);
    res.json({ message: "Entry deleted" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
