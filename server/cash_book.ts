/**
 * Daily Cash Book — itemized cash in/out log, grouped by calendar day
 * (midnight to midnight). A day's opening balance is just the running total
 * of every transaction before that day started, so nothing needs to be
 * manually carried forward each morning — log what came in and what went
 * out, to whom, and the running balance (and each day's close) fall out of
 * that automatically.
 *
 * An entry can also be linked to a truck's ledger, a party's ledger, the
 * Personal & Household book, or Zakat (linkType [+ linkTargetId for truck/
 * party]): posting it here also posts a matching entry there (via
 * derivedEntryId), so the same cash movement only has to be typed once.
 * Editing or deleting the cash-book entry keeps the linked one in sync
 * (running balance recomputed too, for truck/party).
 *
 * Deliberately NOT linkable this way: Bills/Payments/Expenses (a Finance
 * expense posts a balanced double-entry to the General Ledger — auto-firing
 * that from a two-field cash row risks an unbalanced or wrong GL posting),
 * Invoices/Quotations (structured documents with line items and tax; an
 * invoice payment already has its own correct flow in Invoices → paidAmount/
 * outstandingBalance), and Partners/Partner P&L/Monthly Report (a partner's
 * cash already flows through their linked Party; P&L and the monthly report
 * are computed views with nothing to post into).
 *
 *   GET    /api/cash-book/day?date=YYYY-MM-DD   one day's opening/entries/closing
 *   GET    /api/cash-book/link-options           trucks + parties, for the "link to" picker
 *   POST   /api/cash-book                       add an in/out entry
 *   PUT    /api/cash-book/:id                   edit an entry
 *   DELETE /api/cash-book/:id                   soft-delete an entry
 *   POST   /api/cash-book/import/preview         upload a dual cash-book .xlsx, see counts before committing
 *   POST   /api/cash-book/import                 commit the same file
 *
 * Mounted at /api/cash-book.
 */
import { Router, Response } from "express";
import multer from "multer";
import { and, asc, eq, inArray, isNull, lt, gte, lte, sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { parseCashbookFlat } from "../src/lib/dataio/cashbook-flat-import.ts";
import { sourceLabelFromFilename } from "../src/lib/dataio/truck-workbook.ts";
import { recompute as recomputeTruckLedger } from "./ledgers.ts";
import { recompute as recomputePartyLedger } from "./parties.ts";
import { partnershipLedgerForPlate } from "./partnership.ts";

const router = Router();
router.use(requireAuth, requireApproved);

const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];
const DIRECTIONS = ["In", "Out"];
// truck/party need a target id (which truck / which party); personal/zakat
// are single global books, so there's nothing to pick.
const LINK_TYPES: Record<string, { needsTarget: boolean }> = {
  truck: { needsTarget: true },
  party: { needsTarget: true },
  personal: { needsTarget: false },
  zakat: { needsTarget: false },
};

const workbookUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const T = schema.cashTransactions;

const audit = (req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", id: number, oldV: unknown, newV: unknown) =>
  logAudit({
    action,
    tableName: "cash_transactions",
    recordId: id,
    oldValues: oldV,
    newValues: newV,
    performedBy: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  }).catch(() => {});

function coerce(b: any): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (b.entryDate !== undefined) patch.entryDate = b.entryDate ? new Date(b.entryDate) : new Date();
  if (b.direction !== undefined) patch.direction = DIRECTIONS.includes(b.direction) ? b.direction : "Out";
  if (b.amount !== undefined) patch.amount = Math.max(0, Math.round(Number(b.amount) || 0));
  if (b.person !== undefined) patch.person = b.person ? String(b.person).trim() : null;
  if (b.description !== undefined) patch.description = b.description ? String(b.description) : null;
  if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes) : null;
  if (b.linkType !== undefined) patch.linkType = b.linkType in LINK_TYPES ? b.linkType : null;
  if (b.linkTargetId !== undefined) patch.linkTargetId = b.linkTargetId ? parseInt(b.linkTargetId) : null;
  return patch;
}

function dayBounds(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 3600_000);
  return { start, end };
}

// the one ledger Trip Desk (and now Cash Book) ever writes to for a truck: its partnership
// khata when it is shared with a partner (see partnershipLedgerForPlate), otherwise hand-entered,
// never tied to a specific old Excel sheet. Created on first use.
//
// Matched by NORMALIZED PLATE, not by vehicleId: the fleet has more than one `vehicles` row
// for the same physical truck in places (old imports spelled the same plate "TLD 918" in one
// batch and "TLD-918" in another, so they never matched as "the same vehicle"). Trusting
// vehicleId alone would let a truck accumulate a second manual ledger just because the picker
// happened to list its other near-duplicate vehicle row — the exact "now there are two TLD 918
// ledgers" bug this replaced. Matching on the plate itself (same normalization used everywhere
// else a truck is looked up) makes ledger resolution correct even while that vehicle-row
// duplication still exists.
async function resolveManualLedgerId(vehicleId: number, userId: number | undefined): Promise<number> {
  const [veh] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId)).limit(1);
  if (!veh) throw new Error("Truck not found");
  const plate = veh.vehicleNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // a truck shared with a partner keeps ONE khata — the one its partnership cycle reads
  const shared = await partnershipLedgerForPlate(veh.vehicleNumber);
  if (shared) return shared;
  const [existing] = await db
    .select()
    .from(schema.truckLedgers)
    .where(
      and(
        eq(schema.truckLedgers.isDeleted, false),
        isNull(schema.truckLedgers.sourceSheet),
        sql`regexp_replace(upper(${schema.truckLedgers.registration}), '[^A-Z0-9]', '', 'g') = ${plate}`,
      ),
    )
    .limit(1);
  if (existing) {
    if (!existing.vehicleId) await db.update(schema.truckLedgers).set({ vehicleId }).where(eq(schema.truckLedgers.id, existing.id));
    return existing.id;
  }
  const [created] = await db
    .insert(schema.truckLedgers)
    .values({ vehicleId, registration: veh.vehicleNumber, title: veh.vehicleNumber, createdBy: userId })
    .returning();
  return created.id;
}

// Parties have the exact same "one sheet, one new row" import history as trucks (see
// server/parties.ts's import: matched by sourceSheet first, exact name only as a fallback) — so the
// same real party can exist as more than one `parties` row if it was ever typed with different
// spacing/case across sheets. Unlike a truck plate we won't aggressively strip everything and risk
// merging two genuinely different companies — only whitespace/case, which is never meaningful in a
// name. Among rows that are identical once trimmed, always resolve to the lowest id (first created),
// so every link for "the same name" converges on one party regardless of which near-duplicate a
// stale picker happened to have selected.
async function resolveCanonicalPartyId(partyId: number): Promise<number> {
  const [p] = await db.select().from(schema.parties).where(eq(schema.parties.id, partyId)).limit(1);
  if (!p) throw new Error("Party not found");
  const norm = p.name.trim().toLowerCase().replace(/\s+/g, " ");
  const [canonical] = await db
    .select({ id: schema.parties.id })
    .from(schema.parties)
    .where(and(eq(schema.parties.isDeleted, false), sql`lower(trim(regexp_replace(${schema.parties.name}, '\\s+', ' ', 'g'))) = ${norm}`))
    .orderBy(asc(schema.parties.id))
    .limit(1);
  return canonical ? canonical.id : partyId;
}

// ---- create / update / remove the linked truck-ledger or party-ledger entry that
// mirrors a cash-book row, so the two stay in step with a single edit here. ----------
async function syncLink(row: typeof T.$inferSelect, userId: number | undefined) {
  // removing a link is handled by the caller (unlinkDerivedEntry), which still has the
  // OLD linkType/derivedEntryId to soft-delete the right row; nothing to do here for that case.
  if (!row.linkType) return;
  const cfg = LINK_TYPES[row.linkType];
  if (!cfg || (cfg.needsTarget && !row.linkTargetId)) return;

  const description = row.description || row.person || (row.direction === "In" ? "Cash book income" : "Cash book expense");
  if (row.linkType === "truck") {
    // linkTargetId is the TRUCK (vehicleId), never a specific truck_ledgers row: a truck can have many
    // legacy ledgers (one per old Excel sheet it was ever imported from), all showing the same plate, so
    // picking one of those by id from a list would silently post into whichever old sheet happened to be
    // chosen. Always resolve to that truck's own hand-entered ledger — the same one Trip Desk posts to —
    // creating it if the truck doesn't have one yet.
    if (row.derivedEntryId) {
      const [existing] = await db.select().from(schema.truckLedgerEntries).where(eq(schema.truckLedgerEntries.id, row.derivedEntryId)).limit(1);
      if (!existing) return;
      await db
        .update(schema.truckLedgerEntries)
        .set({
          entryDate: row.entryDate,
          rawDate: row.entryDate.toISOString().slice(0, 10),
          received: row.direction === "In" ? row.amount : 0,
          paid: row.direction === "Out" ? row.amount : 0,
          direction: row.direction,
          description,
          updatedAt: new Date(),
        })
        .where(eq(schema.truckLedgerEntries.id, row.derivedEntryId));
      await recomputeTruckLedger(existing.ledgerId);
    } else {
      const ledgerId = await resolveManualLedgerId(row.linkTargetId!, userId);
      const [entry] = await db
        .insert(schema.truckLedgerEntries)
        .values({
          ledgerId,
          entryDate: row.entryDate,
          rawDate: row.entryDate.toISOString().slice(0, 10),
          method: "Cash",
          description,
          received: row.direction === "In" ? row.amount : 0,
          paid: row.direction === "Out" ? row.amount : 0,
          category: "Other",
          direction: row.direction,
          sectionLabel: "Manual",
          createdBy: userId,
        })
        .returning();
      await db.update(T).set({ derivedEntryId: entry.id }).where(eq(T.id, row.id));
      await recomputeTruckLedger(ledgerId);
    }
  } else if (row.linkType === "party") {
    // cash IN (office received) = party paid us = credit; cash OUT (office paid) = debit
    const debit = row.direction === "Out" ? row.amount : 0;
    const credit = row.direction === "In" ? row.amount : 0;
    if (row.derivedEntryId) {
      const [existing] = await db.select().from(schema.partyLedgerEntries).where(eq(schema.partyLedgerEntries.id, row.derivedEntryId)).limit(1);
      if (!existing) return;
      await db
        .update(schema.partyLedgerEntries)
        .set({ entryDate: row.entryDate, rawDate: row.entryDate.toISOString().slice(0, 10), debit, credit, description, updatedAt: new Date() })
        .where(eq(schema.partyLedgerEntries.id, row.derivedEntryId));
      await recomputePartyLedger(existing.partyId);
    } else {
      const partyId = await resolveCanonicalPartyId(row.linkTargetId!);
      const [entry] = await db
        .insert(schema.partyLedgerEntries)
        .values({
          partyId,
          entryDate: row.entryDate,
          rawDate: row.entryDate.toISOString().slice(0, 10),
          method: "Cash",
          description,
          debit,
          credit,
          category: "Other",
          sectionLabel: "Manual",
          createdBy: userId,
        })
        .returning();
      await db.update(T).set({ derivedEntryId: entry.id }).where(eq(T.id, row.id));
      await recomputePartyLedger(partyId);
    }
  } else if (row.linkType === "personal") {
    // Household direction (income/expense) mirrors the cash-book direction; no running
    // balance to recompute here, it's a plain dated list like the cash book itself.
    if (row.derivedEntryId) {
      await db
        .update(schema.personalExpenses)
        .set({ entryDate: row.entryDate, direction: row.direction === "In" ? "income" : "expense", amount: row.amount, person: row.person, payee: row.person, description, updatedAt: new Date() })
        .where(eq(schema.personalExpenses.id, row.derivedEntryId));
    } else {
      const [entry] = await db
        .insert(schema.personalExpenses)
        .values({
          entryDate: row.entryDate,
          direction: row.direction === "In" ? "income" : "expense",
          category: "Other",
          person: row.person,
          payee: row.person,
          description,
          amount: row.amount,
          method: "Cash",
          createdBy: userId,
        })
        .returning();
      await db.update(T).set({ derivedEntryId: entry.id }).where(eq(T.id, row.id));
    }
  } else if (row.linkType === "zakat") {
    // Zakat given is always an outflow, whatever direction was picked on the cash-book row.
    if (row.derivedEntryId) {
      await db
        .update(schema.zakatPayments)
        .set({ entryDate: row.entryDate, amount: row.amount, recipient: row.person, description, updatedAt: new Date() })
        .where(eq(schema.zakatPayments.id, row.derivedEntryId));
    } else {
      const [entry] = await db
        .insert(schema.zakatPayments)
        .values({ entryDate: row.entryDate, amount: row.amount, recipient: row.person, description, method: "Cash", createdBy: userId })
        .returning();
      await db.update(T).set({ derivedEntryId: entry.id }).where(eq(T.id, row.id));
    }
  }
}

async function unlinkDerivedEntry(oldLinkType: string | null, derivedEntryId: number | null) {
  if (!derivedEntryId) return;
  if (oldLinkType === "truck") {
    const [old] = await db.select().from(schema.truckLedgerEntries).where(eq(schema.truckLedgerEntries.id, derivedEntryId)).limit(1);
    if (old) {
      await db.update(schema.truckLedgerEntries).set({ isDeleted: true, deletedAt: new Date() }).where(eq(schema.truckLedgerEntries.id, derivedEntryId));
      await recomputeTruckLedger(old.ledgerId);
    }
  } else if (oldLinkType === "party") {
    const [old] = await db.select().from(schema.partyLedgerEntries).where(eq(schema.partyLedgerEntries.id, derivedEntryId)).limit(1);
    if (old) {
      await db.update(schema.partyLedgerEntries).set({ isDeleted: true, deletedAt: new Date() }).where(eq(schema.partyLedgerEntries.id, derivedEntryId));
      await recomputePartyLedger(old.partyId);
    }
  } else if (oldLinkType === "personal") {
    await db.update(schema.personalExpenses).set({ isDeleted: true, deletedAt: new Date() }).where(eq(schema.personalExpenses.id, derivedEntryId));
  } else if (oldLinkType === "zakat") {
    await db.update(schema.zakatPayments).set({ isDeleted: true, deletedAt: new Date() }).where(eq(schema.zakatPayments.id, derivedEntryId));
  }
}

router.get("/link-options", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    // one row per truck (not per legacy Excel ledger) — see resolveManualLedgerId for why.
    // Also collapse near-duplicate vehicle rows for the same plate ("TLD 918" vs "TLD-918" from
    // different old imports) to one option, so the picker itself doesn't offer the same truck twice.
    const vehicleRows = await db
      .select({ id: schema.vehicles.id, registration: schema.vehicles.vehicleNumber })
      .from(schema.vehicles)
      .where(eq(schema.vehicles.isDeleted, false))
      .orderBy(asc(schema.vehicles.id));
    const seenPlate = new Set<string>();
    const trucks = vehicleRows.filter((v) => {
      const plate = v.registration.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (seenPlate.has(plate)) return false;
      seenPlate.add(plate);
      return true;
    });
    trucks.sort((a, b) => a.registration.localeCompare(b.registration));

    // same de-duplication for parties, but conservative: only whitespace/case are folded, never
    // parts of the name — collapsing "Dawood" into "Muhammad Dawood Mercedes Autos" needs a human,
    // not a guess (see resolveCanonicalPartyId for the write-time half of this).
    const partyRows = await db
      .select({ id: schema.parties.id, name: schema.parties.name })
      .from(schema.parties)
      .where(eq(schema.parties.isDeleted, false))
      .orderBy(asc(schema.parties.id));
    const seenName = new Set<string>();
    const parties = partyRows.filter((p) => {
      const norm = p.name.trim().toLowerCase().replace(/\s+/g, " ");
      if (seenName.has(norm)) return false;
      seenName.add(norm);
      return true;
    });
    parties.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ trucks, parties });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/day", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ""))
      ? String(req.query.date)
      : new Date().toISOString().slice(0, 10);
    const { start, end } = dayBounds(dateStr);

    const [openingRow] = await db
      .select({
        in: sql<number>`coalesce(sum(case when ${T.direction}='In' then ${T.amount} else 0 end),0)::bigint`,
        out: sql<number>`coalesce(sum(case when ${T.direction}='Out' then ${T.amount} else 0 end),0)::bigint`,
      })
      .from(T)
      .where(and(eq(T.isDeleted, false), lt(T.entryDate, start)));
    const openingBalance = Number(openingRow?.in || 0) - Number(openingRow?.out || 0);

    const entries = await db
      .select()
      .from(T)
      .where(and(eq(T.isDeleted, false), gte(T.entryDate, start), lte(T.entryDate, end)))
      .orderBy(asc(T.entryDate), asc(T.id));

    const totalIn = entries.filter((e) => e.direction === "In").reduce((s, e) => s + e.amount, 0);
    const totalOut = entries.filter((e) => e.direction === "Out").reduce((s, e) => s + e.amount, 0);

    // resolve where a linked entry ACTUALLY landed (its real ledgerId / partyId), not the
    // possibly-stale linkTargetId that was picked at the time — so "open this entry" always
    // lands on the right ledger even if the picker's vehicle/party row has since changed.
    const truckDerivedIds = entries.filter((e) => e.linkType === "truck" && e.derivedEntryId).map((e) => e.derivedEntryId!);
    const partyDerivedIds = entries.filter((e) => e.linkType === "party" && e.derivedEntryId).map((e) => e.derivedEntryId!);
    const [truckTargets, partyTargets] = await Promise.all([
      truckDerivedIds.length
        ? db.select({ id: schema.truckLedgerEntries.id, ledgerId: schema.truckLedgerEntries.ledgerId }).from(schema.truckLedgerEntries).where(inArray(schema.truckLedgerEntries.id, truckDerivedIds))
        : Promise.resolve([]),
      partyDerivedIds.length
        ? db.select({ id: schema.partyLedgerEntries.id, partyId: schema.partyLedgerEntries.partyId }).from(schema.partyLedgerEntries).where(inArray(schema.partyLedgerEntries.id, partyDerivedIds))
        : Promise.resolve([]),
    ]);
    const truckLedgerById = new Map(truckTargets.map((t) => [t.id, t.ledgerId]));
    const partyIdById = new Map(partyTargets.map((t) => [t.id, t.partyId]));
    const entriesWithTargets = entries.map((e) => ({
      ...e,
      resolvedLedgerId: e.linkType === "truck" && e.derivedEntryId ? truckLedgerById.get(e.derivedEntryId) ?? null : null,
      resolvedPartyId: e.linkType === "party" && e.derivedEntryId ? partyIdById.get(e.derivedEntryId) ?? null : null,
    }));

    res.json({
      date: dateStr,
      openingBalance,
      entries: entriesWithTargets,
      totalIn,
      totalOut,
      closingBalance: openingBalance + totalIn - totalOut,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const patch = coerce(req.body || {});
    if (!patch.amount) return res.status(400).json({ error: "Amount is required" });
    if (patch.direction === undefined) patch.direction = "Out";
    if (patch.entryDate === undefined) patch.entryDate = new Date();
    if (typeof patch.linkType === "string" && LINK_TYPES[patch.linkType]?.needsTarget && !patch.linkTargetId) {
      return res.status(400).json({ error: "Pick which truck or party this belongs to · کونسا ٹرک یا پارٹی، منتخب کریں" });
    }
    const [row] = await db.insert(T).values({ ...patch, createdBy: req.user?.id } as any).returning();
    await syncLink(row, req.user?.id);
    const [fresh] = await db.select().from(T).where(eq(T.id, row.id)).limit(1);
    await audit(req, "CREATE", row.id, null, fresh);
    res.json(fresh);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(T).where(eq(T.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Entry not found" });
    const patch = coerce(req.body || {});
    const effectiveLinkType = "linkType" in patch ? (patch.linkType as string | null) : old.linkType;
    const effectiveTargetId = "linkTargetId" in patch ? patch.linkTargetId : old.linkTargetId;
    if (effectiveLinkType && LINK_TYPES[effectiveLinkType]?.needsTarget && !effectiveTargetId) {
      return res.status(400).json({ error: "Pick which truck or party this belongs to · کونسا ٹرک یا پارٹی، منتخب کریں" });
    }

    const linkChanged =
      ("linkType" in patch && patch.linkType !== old.linkType) || ("linkTargetId" in patch && patch.linkTargetId !== old.linkTargetId);
    if (linkChanged && old.derivedEntryId) {
      await unlinkDerivedEntry(old.linkType, old.derivedEntryId);
      patch.derivedEntryId = null;
    }

    const [row] = await db
      .update(T)
      .set({ ...patch, updatedAt: new Date(), updatedBy: req.user?.id })
      .where(eq(T.id, id))
      .returning();
    await syncLink(row, req.user?.id);
    const [fresh] = await db.select().from(T).where(eq(T.id, id)).limit(1);
    await audit(req, "UPDATE", id, old, fresh);
    res.json(fresh);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ---- import from Excel (dual cash-book shape) --------------------------
router.post("/import/preview", requireRole(WRITE), workbookUpload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload an .xlsx workbook in the 'file' field." });
    const { rows, totalIn, totalOut, skippedSheets } = await parseCashbookFlat(req.file.buffer, sourceLabelFromFilename(req.file.originalname));
    res.json({
      rowCount: rows.length,
      totalIn,
      totalOut,
      skippedSheets,
      sample: rows.slice(0, 10),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Could not read this workbook" });
  }
});

// Batched bulk upsert instead of one row at a time - a few hundred round
// trips instead of thousands, which is what made large imports (e.g. 3500+
// rows) take several minutes.
const IMPORT_BATCH_SIZE = 500;

router.post("/import", requireRole(WRITE), workbookUpload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload an .xlsx workbook in the 'file' field." });
    const { rows, skippedSheets } = await parseCashbookFlat(req.file.buffer, sourceLabelFromFilename(req.file.originalname));

    for (let i = 0; i < rows.length; i += IMPORT_BATCH_SIZE) {
      const chunk = rows.slice(i, i + IMPORT_BATCH_SIZE).map((r) => ({
        entryDate: r.entryDate || new Date(),
        direction: r.direction,
        amount: r.amount,
        person: r.person,
        description: r.description,
        sourceSheet: r.sourceSheet,
        sourceRow: r.sourceRow,
        createdBy: req.user?.id,
        isDeleted: false,
        deletedAt: null,
      }));
      await db
        .insert(T)
        .values(chunk as any)
        .onConflictDoUpdate({
          target: [T.sourceSheet, T.sourceRow, T.direction],
          set: {
            entryDate: sql`excluded.entry_date`,
            amount: sql`excluded.amount`,
            person: sql`excluded.person`,
            description: sql`excluded.description`,
            isDeleted: false,
            deletedAt: null,
            updatedAt: new Date(),
            updatedBy: req.user?.id,
          },
        });
    }

    res.json({ message: `Imported ${rows.length} entries.`, count: rows.length, skippedSheets });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Import failed" });
  }
});

router.delete("/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(T).where(eq(T.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Entry not found" });
    await db
      .update(T)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: req.user?.id })
      .where(eq(T.id, id));
    await unlinkDerivedEntry(old.linkType, old.derivedEntryId);
    await audit(req, "DELETE", id, old, null);
    res.json({ message: "Entry deleted" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export const cashBookRouter = router;
