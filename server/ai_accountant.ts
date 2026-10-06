/**
 * AI Accountant · اے آئی منشی — the bookkeeping a munshi does, done by the system, with a person
 * approving every entry. Nothing the AI reads goes into the books by itself:
 *
 *   read → DRAFT (ai_drafts) → a person checks / edits → Approve → posted through the SAME routes a
 *   person uses (Cash Book, truck khata, party ledger, trip money) with that person's login, so every
 *   rule, duplicate warning, SMS and audit entry is exactly as if they had typed it. Undo deletes the
 *   posted entry through the same routes.
 *
 *   GET  /api/ai-accountant/status
 *   POST /api/ai-accountant/read                 text / voice text and/or files (photo, PDF, Excel, CSV) → drafts
 *   GET  /api/ai-accountant/drafts?status=&batch=
 *   PUT  /api/ai-accountant/drafts/:id           edit a draft before approving
 *   POST /api/ai-accountant/drafts/approve       { ids }  post them
 *   POST /api/ai-accountant/drafts/reject        { ids }
 *   POST /api/ai-accountant/drafts/:id/undo      take a posted draft back out of the books
 *
 *   POST /api/ai-accountant/reclass/propose      { ai?, all? }  proposals for truck-khata rows in "Other"
 *   GET  /api/ai-accountant/reclass?status=&proposed=&confidence=
 *   POST /api/ai-accountant/reclass/apply        { ids } | { proposed, confidence[] }   (a person's choice)
 *   POST /api/ai-accountant/reclass/undo         { ids }
 *   POST /api/ai-accountant/reclass/reject       { ids }
 *
 *   POST /api/ai-accountant/ask                  { question }  answers from the books (read only)
 *   GET  /api/ai-accountant/briefing             today's to-do list (no AI needed)
 *   POST /api/ai-accountant/report               { month }  the month's report, saved
 *   GET  /api/ai-accountant/reports | /reports/:id   DELETE /reports/:id
 *   GET  /api/ai-accountant/reminders            who owes HFK, with a ready message to send
 */
import { Router, Response } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { selfApi as sharedSelfApi } from "./self_api.ts";
import { aiStatus, aiJson, aiText, AiOffError, Attachment } from "./ai/llm.ts";
import { loadDirectory, readByRules, shapeDraft, findDuplicate, Directory, ReadRow, TRUCK_CATEGORIES, MONEY_KINDS, METHODS, KIND_CATEGORY, todayPk, amountIn, dateIn } from "./ai/context.ts";
import { partnershipLedgerForPlate } from "./partnership.ts";
import { tripSpansForTruck } from "./trip_close.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];
const rows = async (q: any) => ((await db.execute(q)) as any).rows as any[];
const n = (v: any) => Math.round(Number(v || 0));
const pkr = (v: number) => "PKR " + Math.round(v).toLocaleString("en-US");
const errMsg = (e: any) => e?.cause?.message || e?.message || String(e);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 10 } });
const D = schema.aiDrafts;

/** The server calling its own API, as the person who asked (their login, their permissions). */
async function selfApi(req: AuthRequest, method: string, path: string, body?: unknown) {
  const json: any = await sharedSelfApi(req, method, path, body);
  // a big payment by someone who is not an approver waits for approval (approvals.ts)
  if (json?.pendingApproval) throw new Error(json.message || `Sent for approval #${json.requestId}`);
  return json;
}

const audit = (req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", table: string, id: number, oldV: unknown, newV: unknown) =>
  logAudit({ action, tableName: table, recordId: id, oldValues: oldV, newValues: newV, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});

// ================================================================== status
router.get("/status", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    const [c] = await rows(sql`select
        (select count(*) from ai_drafts where status in ('pending', 'failed'))::int drafts,
        (select count(*) from ai_reclass where status = 'pending')::int reclass,
        (select count(*) from ai_runs where created_at > now() - interval '1 day')::int runs_today,
        (select count(*) from ai_runs where created_at > now() - interval '1 day' and not ok)::int failed_today`);
    res.json({ ai: aiStatus(), ...c });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

// ================================================================== reading
const SYSTEM_READ = (dir: Directory) => `You are the bookkeeper (munshi) of HFK Enterprises (Pvt) Ltd, a truck transport company in Quetta, Pakistan.
You read slips, receipts, khata (ledger) pages, bank statements, WhatsApp messages and spreadsheets — in English, Roman Urdu, Urdu, sometimes Pashto or Persian — and write down every movement of money as one row each.

Rules:
- Never invent anything. If something is not written, use null and say what is missing in "notes".
- amount: whole Pakistani rupees (hazar = 1,000; lakh = 100,000; crore = 10,000,000). Never a running balance or a total.
- direction: "In" = money came to HFK (received, wusool, jama, kiraya received, deposit into HFK's account); "Out" = HFK paid or gave money.
- date: YYYY-MM-DD. Pakistani dates are day first (03/10/2026 = 3 October 2026). Today is ${dir.today}. "aaj" = today, "kal" = yesterday.
- method: "Cash", "Bank", "Online" (IBFT, Raast, EasyPaisa, JazzCash) or "Cheque".
- plate: the truck's number plate exactly as in the fleet list if it is one of them, otherwise as written; null if no truck.
- party: the person or company the money came from or went to (customer, supplier, partner, broker), as in the party list if clearly the same; null if none.
- kind (only for money spent on a truck on the road): one of ${MONEY_KINDS.join(", ")} (cash = driver's trip cash / kharcha; repair = garage on the road; labour = loading / unloading).
- category (truck khata): one of ${TRUCK_CATEGORIES.join(", ")} — Freight for kiraya; null if unsure.
- person: the driver or person who handled the money, if written.
- description: a short clear description in the words of the paper.
- source_text: the exact words / line you read this row from.
- confidence: "high" (clearly written), "medium" (some guessing), "low" (hard to read or unclear).
- Skip opening / closing balances, page totals, carried-forward lines and headings — they are not money movements.
- personal: true only if it is clearly the owner's household / personal money (ghar, shakhsi).

Reply with JSON only: {"rows":[{"date":…,"direction":…,"amount":…,"method":…,"plate":…,"party":…,"kind":…,"category":…,"person":…,"personal":…,"description":…,"source_text":…,"confidence":…,"notes":[…]}]}`;

const directoryText = (dir: Directory) =>
  `Fleet (plates): ${dir.trucks.map((t) => t.registration).join(", ") || "(none)"}\n\nParties: ${dir.parties.map((p) => p.name).join(" | ") || "(none)"}`;

function toReadRows(json: any): ReadRow[] {
  const list = Array.isArray(json?.rows) ? json.rows : Array.isArray(json) ? json : [];
  return list
    .map((r: any) => ({
      date: typeof r.date === "string" ? r.date.slice(0, 10) : null,
      direction: r.direction === "In" || r.direction === "Out" ? r.direction : null,
      amount: typeof r.amount === "number" ? Math.round(r.amount) : amountIn(String(r.amount ?? "")),
      method: METHODS.includes(r.method) ? r.method : r.method ? "Cash" : null,
      plate: r.plate ? String(r.plate) : null,
      party: r.party ? String(r.party) : null,
      kind: r.kind ? String(r.kind).toLowerCase() : null,
      category: r.category ? String(r.category) : null,
      person: r.person ? String(r.person) : null,
      personal: !!r.personal,
      description: String(r.description || r.source_text || "").slice(0, 300),
      sourceText: String(r.source_text || r.description || "").slice(0, 1000),
      confidence: ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "low",
      notes: Array.isArray(r.notes) ? r.notes.map(String).slice(0, 6) : [],
    }))
    .filter((r: ReadRow) => r.amount > 0);
}

async function readWithAi(dir: Directory, what: string, text: string, files: Attachment[], userId?: number): Promise<ReadRow[]> {
  const json = await aiJson({
    feature: "read",
    system: SYSTEM_READ(dir),
    prompt: `${directoryText(dir)}\n\nRead every money movement in this ${what}:\n\n${text || "(see the attached file)"}`,
    files,
    maxTokens: 16000,
    userId,
  });
  return toReadRows(json);
}

/** A spreadsheet as plain lines "col | col | col" (first 3 sheets, up to 2,000 lines). */
async function sheetLines(buf: Buffer, name: string): Promise<string[]> {
  const lines: string[] = [];
  if (/\.csv$/i.test(name)) {
    for (const l of buf.toString("utf8").replace(/^﻿/, "").split(/\r?\n/)) if (l.trim()) lines.push(l.replace(/,/g, " | "));
    return lines.slice(0, 2000);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  for (const ws of wb.worksheets.slice(0, 3)) {
    lines.push(`# sheet: ${ws.name}`);
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = (row.values as any[]).slice(1).map((v) => {
        if (v == null) return "";
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === "object") return String(v.result ?? v.text ?? (v.richText ? v.richText.map((t: any) => t.text).join("") : ""));
        return String(v);
      });
      if (cells.some((c) => c.trim())) lines.push(cells.join(" | "));
    });
  }
  return lines.slice(0, 2000);
}

/** Without AI: a sheet with Date / Description / In / Out (or Amount) headers, read column by column. */
function sheetByRules(dir: Directory, lines: string[]): ReadRow[] {
  const out: ReadRow[] = [];
  let head: string[] | null = null;
  const idx = (re: RegExp) => (head ? head.findIndex((h) => re.test(h)) : -1);
  for (const line of lines) {
    const cells = line.split(" | ").map((c) => c.trim());
    if (!head || line.startsWith("# sheet")) {
      if (cells.some((c) => /date|tareekh|تاریخ/i.test(c)) && cells.some((c) => /amount|raqam|رقم|debit|credit|received|paid|jama|naam|in\b|out\b|بنام|جمع/i.test(c))) head = cells.map((c) => c.toLowerCase());
      continue;
    }
    const di = idx(/date|tareekh|تاریخ/i);
    const de = idx(/desc|detail|tafseel|particular|narration|تفصیل|بیان/i);
    const inI = idx(/received|credit|\bin\b|jama|deposit|جمع|وصول/i);
    const outI = idx(/paid|debit|\bout\b|naam|withdraw|بنام|ادا/i);
    const amI = idx(/amount|raqam|رقم/i);
    const vin = inI >= 0 ? amountIn(cells[inI]) : 0;
    const vout = outI >= 0 ? amountIn(cells[outI]) : 0;
    const vam = amI >= 0 ? amountIn(cells[amI]) : 0;
    const amount = vin || vout || vam;
    if (!amount) continue;
    const desc = de >= 0 ? cells[de] : cells.join(" ");
    const r = readByRules(dir, `${desc} ${amount}`)[0];
    const date = di >= 0 ? (dateIn(cells[di], dir.today) || (/^\d{4}-\d{2}-\d{2}/.test(cells[di]) ? cells[di].slice(0, 10) : null)) : null;
    out.push({
      ...(r || { plate: null, party: null, kind: null, category: null, person: null, method: "Cash", confidence: "low", notes: [] as string[] }),
      date,
      amount,
      direction: vin ? "In" : vout ? "Out" : r?.direction || null,
      description: desc.slice(0, 300),
      sourceText: line.slice(0, 1000),
      notes: date ? (r?.notes || []).filter((x) => !/No date/.test(x)) : ["No date in this row · تاریخ نہیں"],
    } as ReadRow);
  }
  return out;
}

router.post("/read", requireRole(WRITE), upload.array("files", 10), async (req: AuthRequest, res: Response) => {
  try {
    const dir = await loadDirectory();
    const st = aiStatus();
    const text = String(req.body?.text || "").trim();
    const source = req.body?.source === "voice" ? "voice" : "text";
    const files = ((req as any).files || []) as Express.Multer.File[];
    if (!text && !files.length) return res.status(400).json({ error: "Type, speak or attach something to read · کچھ لکھیں یا فائل لگائیں" });
    const batch = randomUUID();
    const found: Array<{ row: ReadRow; source: string; sourceName: string | null; by: string }> = [];
    const problems: string[] = [];
    const by = st.on ? `ai:${st.model}` : "rules";

    if (text) {
      const list = st.on ? await readWithAi(dir, "message", text, [], req.user?.id) : readByRules(dir, text);
      for (const row of list) found.push({ row, source, sourceName: null, by });
      if (!list.length) problems.push("No amount found in the text · لکھے ہوئے میں کوئی رقم نہیں ملی");
    }
    for (const f of files) {
      const name = f.originalname || "file";
      try {
        if (/\.(xlsx|csv)$/i.test(name)) {
          const lines = await sheetLines(f.buffer, name);
          let list: ReadRow[] = [];
          if (st.on) for (let i = 0; i < lines.length; i += 150) list.push(...(await readWithAi(dir, "spreadsheet (rows are separated by new lines, columns by |)", lines.slice(i, i + 150).join("\n"), [], req.user?.id)));
          else list = sheetByRules(dir, lines);
          for (const row of list) found.push({ row, source: /\.csv$/i.test(name) ? "csv" : "excel", sourceName: name, by: st.on ? by : "rules" });
          if (!list.length) problems.push(`${name}: no money rows found${st.on ? "" : " (without AI the sheet needs Date and Amount / In / Out headings)"}`);
        } else if (/^image\/|application\/pdf/.test(f.mimetype)) {
          if (!st.on) {
            problems.push(`${name}: reading a photo or PDF needs the AI switched on · تصویر پڑھنے کے لیے اے آئی چاہیے`);
            continue;
          }
          const list = await readWithAi(dir, f.mimetype === "application/pdf" ? "PDF document" : "photo", "", [{ mime: f.mimetype, data: f.buffer, name }], req.user?.id);
          for (const row of list) found.push({ row, source: f.mimetype === "application/pdf" ? "pdf" : "image", sourceName: name, by });
          if (!list.length) problems.push(`${name}: no money found on it · اس میں کوئی رقم نہیں ملی`);
        } else problems.push(`${name}: this kind of file cannot be read (photo, PDF, Excel .xlsx or CSV) · یہ فائل نہیں پڑھی جا سکتی`);
      } catch (e: any) {
        problems.push(`${name}: ${errMsg(e)}`);
      }
    }

    const created: any[] = [];
    for (const f of found.slice(0, 1500)) {
      const d = await shapeDraft(dir, f.row);
      const [row] = await db
        .insert(D)
        .values({
          batch,
          source: f.source,
          sourceName: f.sourceName,
          target: d.target,
          entryDate: d.entryDate,
          direction: d.direction,
          amount: d.amount,
          method: d.method,
          vehicleId: d.vehicleId,
          tripId: d.tripId,
          partyId: d.partyId,
          kind: d.kind,
          category: d.category,
          person: (d as any).personal ? "personal" : d.person,
          description: d.description,
          sourceText: d.sourceText,
          confidence: d.confidence,
          notes: d.notes,
          duplicate: d.duplicate,
          readBy: f.by,
          createdBy: req.user?.id,
        })
        .returning();
      created.push(row);
    }
    await audit(req, "CREATE", "ai_drafts", created[0]?.id || 0, null, { batch, drafts: created.length, files: files.map((f) => f.originalname), by });
    res.json({ batch, drafts: created.length, problems, by });
  } catch (e: any) {
    res.status(e instanceof AiOffError ? 503 : 500).json({ error: errMsg(e) });
  }
});

// ================================================================== drafts
router.get("/drafts", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const status = String(req.query.status || "open");
    const where =
      status === "open" ? sql`d.status in ('pending', 'failed', 'posting')` : status === "all" ? sql`true` : sql`d.status = ${status}`;
    const batch = typeof req.query.batch === "string" && req.query.batch ? sql`and d.batch = ${req.query.batch}` : sql``;
    const list = await rows(sql`select d.*, v.vehicle_number truck, p.name party, t.trip_number trip, u.name created_by_name
      from ai_drafts d left join vehicles v on v.id = d.vehicle_id left join parties p on p.id = d.party_id left join trips t on t.id = d.trip_id
      left join users u on u.id = d.created_by
      where ${where} ${batch} order by d.id desc limit 500`);
    res.json({ drafts: list });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

router.put("/drafts/:id(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(D).where(eq(D.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Draft not found" });
    if (!["pending", "failed"].includes(old.status)) return res.status(400).json({ error: "Only a draft that is not posted can be changed · صرف غیر درج مسودہ بدلا جا سکتا ہے" });
    const b = req.body || {};
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (b.target !== undefined) patch.target = ["cash", "truck", "party", "trip"].includes(b.target) ? b.target : old.target;
    if (b.entryDate !== undefined) patch.entryDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.entryDate)) ? b.entryDate : null;
    if (b.direction !== undefined) patch.direction = b.direction === "In" || b.direction === "Out" ? b.direction : null;
    if (b.amount !== undefined) patch.amount = Math.max(0, Math.round(Number(b.amount) || 0));
    if (b.method !== undefined) patch.method = METHODS.includes(b.method) ? b.method : "Cash";
    for (const k of ["vehicleId", "tripId", "partyId"]) if (b[k] !== undefined) patch[k] = b[k] ? parseInt(b[k]) : null;
    if (b.kind !== undefined) patch.kind = MONEY_KINDS.includes(b.kind) ? b.kind : null;
    if (b.category !== undefined) patch.category = TRUCK_CATEGORIES.includes(b.category) ? b.category : null;
    for (const k of ["person", "description"]) if (b[k] !== undefined) patch[k] = b[k] ? String(b[k]).slice(0, 300) : null;
    const next = { ...old, ...patch };
    patch.duplicate = await findDuplicate({ entryDate: next.entryDate, amount: next.amount, vehicleId: next.vehicleId, partyId: next.target === "trip" ? null : next.partyId, direction: next.direction as any, target: next.target as any });
    if (old.status === "failed") {
      patch.status = "pending";
      patch.error = null;
    }
    const [row] = await db.update(D).set(patch).where(eq(D.id, id)).returning();
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

/** The truck's own hand-entered khata — the one Cash Book and Fleet Desk post to (shared khata first). */
async function truckKhata(vehicleId: number): Promise<number | null> {
  const [v] = await rows(sql`select vehicle_number from vehicles where id = ${vehicleId}`);
  if (!v) return null;
  const shared = await partnershipLedgerForPlate(v.vehicle_number);
  if (shared) return shared;
  const [l] = await rows(sql`select l.id from truck_ledgers l where not l.is_deleted and l.source_sheet is null
      and regexp_replace(upper(l.registration), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(${v.vehicle_number}), '[^A-Z0-9]', '', 'g') order by l.id limit 1`);
  return l?.id || null;
}

/** Post one approved draft through the ordinary route; returns where it landed. */
async function postDraft(req: AuthRequest, d: typeof D.$inferSelect): Promise<{ table: string; id: number; derived?: number | null }> {
  if (!d.amount || d.amount <= 0) throw new Error("No amount · رقم نہیں");
  if (!d.entryDate) throw new Error("No date · تاریخ نہیں");
  if (d.direction !== "In" && d.direction !== "Out") throw new Error("Choose money In or Out · آیا یا گیا منتخب کریں");
  const desc = d.description || d.sourceText || (d.direction === "In" ? "Received" : "Paid");
  if (d.target === "trip") {
    if (!d.tripId) throw new Error("Pick the trip · ٹرپ منتخب کریں");
    if (d.direction !== "Out") throw new Error("Trip money is money given (Out) · ٹرپ پر دی گئی رقم");
    const kind = d.kind && MONEY_KINDS.includes(d.kind as any) ? d.kind : "other";
    const e = await selfApi(req, "POST", `/api/trip-desk/${d.tripId}/money`, { kind, amount: d.amount, date: d.entryDate, note: desc, method: d.method || "Cash" });
    return { table: "truck_ledger_entries", id: e.id };
  }
  if (d.target === "cash") {
    const linkType = d.vehicleId ? "truck" : d.partyId ? "party" : d.person === "personal" ? "personal" : undefined;
    const c = await selfApi(req, "POST", "/api/cash-book", {
      entryDate: `${d.entryDate}T12:00:00`,
      direction: d.direction,
      amount: d.amount,
      person: d.person && d.person !== "personal" ? d.person : undefined,
      description: desc,
      ...(linkType ? { linkType, linkTargetId: linkType === "truck" ? d.vehicleId : linkType === "party" ? d.partyId : undefined } : {}),
    });
    // the Cash Book writes the truck's khata row as "Other"; give it the category that was approved
    if (linkType === "truck" && c.derivedEntryId && d.category && d.category !== "Other")
      await selfApi(req, "PUT", `/api/ledgers/entries/${c.derivedEntryId}`, { category: d.category }).catch(() => null);
    return { table: "cash_transactions", id: c.id, derived: c.derivedEntryId || null };
  }
  if (d.target === "truck") {
    if (!d.vehicleId) throw new Error("Pick the truck · ٹرک منتخب کریں");
    const ledgerId = await truckKhata(d.vehicleId);
    if (!ledgerId) throw new Error("This truck has no khata of its own yet — post it as Cash, or give it a trip in Fleet Desk first · اس ٹرک کا کھاتہ نہیں");
    const e = await selfApi(req, "POST", `/api/ledgers/${ledgerId}/entries`, {
      entryDate: `${d.entryDate}T12:00:00`,
      received: d.direction === "In" ? d.amount : 0,
      paid: d.direction === "Out" ? d.amount : 0,
      method: d.method || "Cash",
      description: desc,
      category: d.category || "Other",
    });
    return { table: "truck_ledger_entries", id: e.id };
  }
  if (d.target === "party") {
    if (!d.partyId) throw new Error("Pick the party · پارٹی منتخب کریں");
    // money HFK received from the party = credit; money HFK paid the party = debit (as the Cash Book does)
    const e = await selfApi(req, "POST", `/api/parties/${d.partyId}/entries`, {
      entryDate: `${d.entryDate}T12:00:00`,
      debit: d.direction === "Out" ? d.amount : 0,
      credit: d.direction === "In" ? d.amount : 0,
      method: d.method || "Cash",
      description: desc,
    });
    return { table: "party_ledger_entries", id: e.id };
  }
  throw new Error("Choose where it goes (Cash Book, truck, party or trip) · کہاں درج کرنا ہے؟");
}

router.post("/drafts/approve", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((x: any) => parseInt(x)).filter((x: number) => x > 0).slice(0, 300);
  const results: any[] = [];
  for (const id of ids) {
    // claim it first, so a double click can never post the same draft twice
    const [d] = await db.update(D).set({ status: "posting", updatedAt: new Date() }).where(and(eq(D.id, id), inArray(D.status, ["pending", "failed"]))).returning();
    if (!d) {
      results.push({ id, ok: false, error: "Already posted or not open" });
      continue;
    }
    try {
      const posted = await postDraft(req, d);
      await db.update(D).set({ status: "posted", posted, error: null, decidedBy: req.user?.id, decidedAt: new Date(), updatedAt: new Date() }).where(eq(D.id, id));
      await audit(req, "UPDATE", "ai_drafts", id, { status: "pending" }, { status: "posted", posted });
      results.push({ id, ok: true, posted });
    } catch (e: any) {
      await db.update(D).set({ status: "failed", error: errMsg(e).slice(0, 500), updatedAt: new Date() }).where(eq(D.id, id));
      results.push({ id, ok: false, error: errMsg(e) });
    }
  }
  res.json({ posted: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
});

router.post("/drafts/reject", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const ids: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((x: any) => parseInt(x)).filter((x: number) => x > 0);
    if (!ids.length) return res.json({ rejected: 0 });
    const list = await db.update(D).set({ status: "rejected", decidedBy: req.user?.id, decidedAt: new Date(), updatedAt: new Date() }).where(and(inArray(D.id, ids), inArray(D.status, ["pending", "failed"]))).returning({ id: D.id });
    res.json({ rejected: list.length });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

router.post("/drafts/:id(\\d+)/undo", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [d] = await db.select().from(D).where(eq(D.id, id)).limit(1);
    if (!d || d.status !== "posted" || !d.posted) return res.status(400).json({ error: "Only a posted draft can be undone" });
    const p = d.posted as { table: string; id: number };
    const path =
      d.target === "trip"
        ? `/api/trip-desk/entry/${p.id}`
        : p.table === "cash_transactions"
          ? `/api/cash-book/${p.id}`
          : p.table === "truck_ledger_entries"
            ? `/api/ledgers/entries/${p.id}`
            : `/api/parties/entries/${p.id}`;
    await selfApi(req, "DELETE", path);
    await db.update(D).set({ status: "undone", updatedAt: new Date() }).where(eq(D.id, id));
    await audit(req, "UPDATE", "ai_drafts", id, { status: "posted" }, { status: "undone", removed: p });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

/** A truck's journeys (latest first) for the draft editor's trip picker. */
router.get("/trips", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const vid = parseInt(String(req.query.vehicleId));
    if (!vid) return res.json({ trips: [] });
    const [v] = await rows(sql`select vehicle_number from vehicles where id = ${vid}`);
    const spans = await tripSpansForTruck(vid, v?.vehicle_number);
    res.json({ trips: spans.reverse().slice(0, 8).map((s) => ({ id: s.rootId, label: `${s.tripNumber} · ${s.label}${s.untilDay ? "" : " (current)"}`, open: !s.untilDay })) });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

// ================================================================== "Other" → a real category
const RECLASS_RULES: Array<[string, "high" | "medium" | "low", RegExp]> = [
  ["Diesel", "high", /\b(diesel|disel|deisel|dsl|hsd)\b|ڈیزل/i],
  ["Toll", "high", /\b(toll|motorway)\b|ٹول/i],
  ["Tyre", "high", /\b(tyre|tyres|tire|tires|puncture)\b|ٹائر|پنکچر/i],
  ["Battery", "high", /\b(battery|batteries)\b|بیٹری/i],
  ["MobilOil", "high", /\b(mobil|mobile oil|engine oil|oil change|filter)\b|موبل/i],
  ["Salary", "high", /\b(salary|tankhwah|tankhwa|tankha|wages)\b|تنخواہ/i],
  ["Carnet", "high", /\bcarnet\b/i],
  ["Visa", "high", /\b(visa|passport)\b|ویزا/i],
  ["Insurance", "high", /\b(insurance|insurence)\b|بیمہ|انشورنس/i],
  ["Permit", "medium", /\b(permit|route permit|token tax|fitness)\b|پرمٹ|ٹوکن/i],
  ["Garage", "medium", /\b(garage|workshop|repair|mistri|mechanic|welding|denting|paint)\b|مستری|مرمت|ورکشاپ/i],
  ["PartsBill", "medium", /\b(parts|spare|purza|kaman|bearing|clutch|brake|pump)\b|پرزے|پرزہ/i],
  ["Khurak", "medium", /\b(khurak|khana|food|hotel|roti|chai)\b|خوراک|کھانا|ہوٹل/i],
  ["Labour", "medium", /\b(mazdoori|mazdori|labour|labor|loading|unloading|palledari)\b|مزدوری|لوڈنگ/i],
  ["TomanFX", "medium", /\b(toman|tuman|riyal|exchange|currency)\b|تومان|ریال/i],
  ["TripCash", "low", /\b(kharcha|kharch|driver cash|advance|pocket)\b|خرچہ|خرچ|ایڈوانس/i],
  ["Freight", "medium", /\b(kiraya|kirya|kiraa|karaya|kiraiya|freight|bilty)\b|کرایہ|کرایا|بلٹی/i],
];
const IN_CATS = ["Freight", "TomanFX", "Capital"];

router.post("/reclass/propose", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const dir = await loadDirectory();
    const allYears = !!req.body?.all;
    const list = await rows(sql`select e.id, e.description, e.received, e.paid, coalesce(nullif(e.category, ''), 'Other') cat
      from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
      where not e.is_deleted and not l.is_deleted and coalesce(nullif(e.category, ''), 'Other') = 'Other' and (e.received > 0 or e.paid > 0)
        and ${allYears ? sql`true` : sql`e.entry_date >= ${dir.booksStart}::timestamp`}
        and not exists (select 1 from ai_reclass r where r.entry_id = e.id and r.status in ('pending', 'rejected'))
      order by e.entry_date desc nulls last, e.id desc limit 20000`);
    let byRules = 0;
    const unmatched: any[] = [];
    for (const r of list) {
      const d = String(r.description || "");
      const hits = RECLASS_RULES.filter(([cat, , re]) => re.test(d) && (n(r.received) > 0 ? IN_CATS.includes(cat) : cat !== "Freight"));
      if (!hits.length) {
        unmatched.push(r);
        continue;
      }
      const [cat, conf] = hits[0];
      await db
        .insert(schema.aiReclass)
        .values({ entryId: r.id, fromCategory: r.cat, proposed: cat, confidence: hits.length > 1 ? "low" : conf, reason: hits.length > 1 ? `words for ${hits.map((h) => h[0]).join(" / ")}` : `"${(d.match(hits[0][2]) || [""])[0]}"`, byAi: false })
        .onConflictDoNothing();
      byRules++;
    }
    let byAi = 0;
    const st = aiStatus();
    const aiLimit = Math.min(Number(req.body?.aiLimit) || 400, 2000);
    if (req.body?.ai && st.on && unmatched.length) {
      for (let i = 0; i < Math.min(unmatched.length, aiLimit); i += 100) {
        const chunk = unmatched.slice(i, i + 100);
        const json = await aiJson({
          feature: "reclass",
          userId: req.user?.id,
          system: `You classify rows of a Pakistani truck-transport company's truck ledger (khata). Each row is money received (In) or paid (Out) for one truck, described in English, Roman Urdu or Urdu.
Choose the category from: ${TRUCK_CATEGORIES.filter((c) => c !== "Other" && c !== "OnlineTransfer").join(", ")}; or "Other" when the words do not say what the money was for (a person's or bank's name alone is NOT enough).
Freight = kiraya / freight received. TripCash = cash given to the driver for the trip. Capital = buying the truck or its instalments. TomanFX = Iranian toman / currency exchange.
Money In can only be Freight, TomanFX, Capital or Other.
Reply with JSON only: {"rows":[{"id":…,"category":…,"confidence":"high|medium|low","reason":"the words that decided it"}]}`,
          prompt: chunk.map((r) => `${r.id} | ${n(r.received) > 0 ? "In" : "Out"} ${n(r.received) || n(r.paid)} | ${String(r.description || "").slice(0, 160)}`).join("\n"),
        });
        for (const x of Array.isArray(json?.rows) ? json.rows : []) {
          const row = chunk.find((r) => r.id === Number(x.id));
          if (!row || !TRUCK_CATEGORIES.includes(x.category) || x.category === "Other" || x.category === "OnlineTransfer") continue;
          if (n(row.received) > 0 && !IN_CATS.includes(x.category)) continue;
          await db
            .insert(schema.aiReclass)
            .values({ entryId: row.id, fromCategory: row.cat, proposed: x.category, confidence: ["high", "medium", "low"].includes(x.confidence) ? x.confidence : "low", reason: String(x.reason || "").slice(0, 200), byAi: true })
            .onConflictDoNothing();
          byAi++;
        }
      }
    }
    res.json({ looked: list.length, byRules, byAi, noProposal: list.length - byRules - byAi, aiUsed: !!(req.body?.ai && st.on) });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

router.get("/reclass", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const status = String(req.query.status || "pending");
    const prop = typeof req.query.proposed === "string" && req.query.proposed ? sql`and r.proposed = ${req.query.proposed}` : sql``;
    const conf = typeof req.query.confidence === "string" && req.query.confidence ? sql`and r.confidence = ${req.query.confidence}` : sql``;
    const list = await rows(sql`select r.*, e.description, e.received, e.paid, to_char(e.entry_date, 'YYYY-MM-DD') date, e.category current_category, l.registration truck, e.ledger_id
      from ai_reclass r join truck_ledger_entries e on e.id = r.entry_id join truck_ledgers l on l.id = e.ledger_id
      where r.status = ${status} ${prop} ${conf} order by e.entry_date desc nulls last, r.id desc limit 1000`);
    const summary = await rows(sql`select r.proposed, r.confidence, count(*)::int rows, sum(greatest(e.received, e.paid))::bigint amount
      from ai_reclass r join truck_ledger_entries e on e.id = r.entry_id where r.status = ${status} group by 1, 2 order by 1, 2`);
    res.json({ rows: list, summary });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

/** The proposals a person picked: by id, or a whole category at the chosen confidence levels. */
async function pickReclass(b: any, status: string) {
  if (Array.isArray(b?.ids) && b.ids.length) return db.select().from(schema.aiReclass).where(and(inArray(schema.aiReclass.id, b.ids.map((x: any) => parseInt(x)).filter((x: number) => x > 0)), eq(schema.aiReclass.status, status)));
  if (b?.proposed && Array.isArray(b?.confidence) && b.confidence.length)
    return db.select().from(schema.aiReclass).where(and(eq(schema.aiReclass.proposed, String(b.proposed)), inArray(schema.aiReclass.confidence, b.confidence.map(String)), eq(schema.aiReclass.status, status)));
  return [];
}

router.post("/reclass/apply", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const picked = await pickReclass(req.body, "pending");
    if (!picked.length) return res.json({ applied: 0, skipped: 0 });
    const [st] = await rows(sql`select to_char(locked_through, 'YYYY-MM-DD') l from books_settings where id = 1`).catch(() => [{}]);
    let applied = 0;
    const skipped: Array<{ id: number; why: string }> = [];
    await db.transaction(async (tx) => {
      for (const r of picked) {
        const [e] = ((await tx.execute(sql`select id, category, to_char(entry_date, 'YYYY-MM-DD') d, is_deleted from truck_ledger_entries where id = ${r.entryId} for update`)) as any).rows;
        const cur = e ? e.category || "Other" : null;
        if (!e || e.is_deleted) skipped.push({ id: r.id, why: "entry deleted" });
        else if (cur !== (r.fromCategory || "Other")) skipped.push({ id: r.id, why: `already changed to ${cur}` });
        else if (st?.l && e.d && e.d <= st.l) skipped.push({ id: r.id, why: `month closed (through ${st.l})` });
        else {
          await tx.execute(sql`update truck_ledger_entries set category = ${r.proposed}, updated_at = now(), updated_by = ${req.user?.id ?? null} where id = ${r.entryId}`);
          await tx.update(schema.aiReclass).set({ status: "applied", decidedBy: req.user?.id, decidedAt: new Date() }).where(eq(schema.aiReclass.id, r.id));
          await logAudit({ action: "UPDATE", tableName: "truck_ledger_entries", recordId: r.entryId, oldValues: { category: cur }, newValues: { category: r.proposed, by: "AI Accountant category review", proposal: r.id }, performedBy: req.user?.id, ipAddress: req.ip }, tx);
          applied++;
        }
      }
    });
    res.json({ applied, skipped: skipped.length, skippedList: skipped.slice(0, 50) });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

router.post("/reclass/undo", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const picked = await pickReclass(req.body, "applied");
    let undone = 0;
    await db.transaction(async (tx) => {
      for (const r of picked) {
        const [e] = ((await tx.execute(sql`select category from truck_ledger_entries where id = ${r.entryId} for update`)) as any).rows;
        if (!e || e.category !== r.proposed) continue; // changed by hand since — leave it
        await tx.execute(sql`update truck_ledger_entries set category = ${r.fromCategory || "Other"}, updated_at = now(), updated_by = ${req.user?.id ?? null} where id = ${r.entryId}`);
        await tx.update(schema.aiReclass).set({ status: "undone", decidedBy: req.user?.id, decidedAt: new Date() }).where(eq(schema.aiReclass.id, r.id));
        await logAudit({ action: "UPDATE", tableName: "truck_ledger_entries", recordId: r.entryId, oldValues: { category: r.proposed }, newValues: { category: r.fromCategory || "Other", by: "AI Accountant category review — undo", proposal: r.id }, performedBy: req.user?.id, ipAddress: req.ip }, tx);
        undone++;
      }
    });
    res.json({ undone });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

router.post("/reclass/reject", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const picked = await pickReclass(req.body, "pending");
    if (picked.length) await db.update(schema.aiReclass).set({ status: "rejected", decidedBy: req.user?.id, decidedAt: new Date() }).where(inArray(schema.aiReclass.id, picked.map((r) => r.id)));
    res.json({ rejected: picked.length });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

// ================================================================== ask the books
const okDay = (s: any) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const qs = (o: Record<string, any>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== "") as any).toString();
const trim = (v: any, max = 12000) => {
  const s = JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…(cut)" : s;
};

type Tool = { about: string; args: string; run: (req: AuthRequest, a: any) => Promise<any> };
const TOOLS: Record<string, Tool> = {
  profit_and_loss: { about: "income, expenses and profit by account for a period", args: "from, to (YYYY-MM-DD)", run: (req, a) => selfApi(req, "GET", `/api/statements/pnl?${qs({ from: okDay(a.from), to: okDay(a.to) })}`) },
  profit_by_truck: {
    about: "income, expenses and profit of each truck for a period",
    args: "from, to",
    run: async (req, a) => {
      const r = await selfApi(req, "GET", `/api/statements/pnl-trucks?${qs({ from: okDay(a.from), to: okDay(a.to) })}`);
      return { ...r, trucks: r.trucks.map((t: any) => ({ truck: t.label, income: t.income, expenses: t.expenses, profit: t.profit, top: t.lines.sort((x: any, y: any) => y.amount - x.amount).slice(0, 4).map((l: any) => `${l.name} ${l.amount}`) })) };
    },
  },
  profit_by_month: { about: "profit and each account month by month", args: "from, to", run: (req, a) => selfApi(req, "GET", `/api/statements/pnl-months?${qs({ from: okDay(a.from), to: okDay(a.to) })}`) },
  balance_sheet: { about: "assets, liabilities and equity on a date", args: "asOf", run: (req, a) => selfApi(req, "GET", `/api/statements/balance-sheet?${qs({ asOf: okDay(a.asOf) })}`) },
  cash_flow: { about: "where cash and bank money came from and went in a period", args: "from, to", run: (req, a) => selfApi(req, "GET", `/api/statements/cash-flow?${qs({ from: okDay(a.from), to: okDay(a.to) })}`) },
  partners: { about: "each truck partner's account: opening, share, taken, closing", args: "from, to", run: (req, a) => selfApi(req, "GET", `/api/statements/partners?${qs({ from: okDay(a.from), to: okDay(a.to) })}`) },
  receivables_payables: {
    about: "who owes HFK (collect from) and whom HFK owes (pay to), overdue parties",
    args: "",
    run: async (req) => {
      const r = await selfApi(req, "GET", "/api/parties/alerts");
      const slim = (l: any[]) => (l || []).slice(0, 15).map((p) => ({ id: p.id, name: p.name, balance: p.closingBalance, lastEntry: p.lastEntryAt?.slice(0, 10), daysSince: p.daysSince }));
      return { totals: r.totals, collectFrom: slim(r.collectFrom), payTo: slim(r.payTo), overdue: slim(r.overdue) };
    },
  },
  party_ledger: {
    about: "one party's balance and its latest entries (balance > 0 means the party owes HFK)",
    args: "name, from?, to?",
    run: async (_req, a) => {
      const dir = await loadDirectory();
      const { matchParty } = await import("./ai/context.ts");
      const m = matchParty(dir, a.name);
      if (!m.party) return { error: `No party named "${a.name}"`, similar: dir.parties.filter((p) => p.norm.includes(String(a.name || "").toLowerCase().slice(0, 4))).slice(0, 8).map((p) => p.name) };
      const [p] = await rows(sql`select id, name, closing_balance, phone, status from parties where id = ${m.party.id}`);
      const f = okDay(a.from), t = okDay(a.to);
      const list = await rows(sql`select id, to_char(entry_date, 'YYYY-MM-DD') date, debit, credit, description, method from party_ledger_entries
        where party_id = ${p.id} and not is_deleted ${f ? sql`and entry_date >= ${f}::timestamp` : sql``} ${t ? sql`and entry_date < (${t}::date + 1)::timestamp` : sql``}
        order by entry_date desc nulls last, id desc limit 25`);
      const [tot] = await rows(sql`select coalesce(sum(debit), 0)::bigint debit, coalesce(sum(credit), 0)::bigint credit from party_ledger_entries
        where party_id = ${p.id} and not is_deleted ${f ? sql`and entry_date >= ${f}::timestamp` : sql``} ${t ? sql`and entry_date < (${t}::date + 1)::timestamp` : sql``}`);
      return { party: p.name, balance: p.closing_balance, matchedFrom: a.name, sure: m.sure, periodDebit: tot.debit, periodCredit: tot.credit, latest: list };
    },
  },
  truck_khata: {
    about: "one truck's money in its khata for a period: received / paid by category, and latest entries",
    args: "plate, from?, to?",
    run: async (_req, a) => {
      const dir = await loadDirectory();
      const { matchTruck } = await import("./ai/context.ts");
      const t = matchTruck(dir, a.plate);
      if (!t) return { error: `No truck "${a.plate}"` };
      const f = okDay(a.from), to = okDay(a.to);
      const where = sql`not e.is_deleted and not l.is_deleted and regexp_replace(upper(l.registration), '[^A-Z0-9]', '', 'g') = ${t.plate}
        ${f ? sql`and e.entry_date >= ${f}::timestamp` : sql``} ${to ? sql`and e.entry_date < (${to}::date + 1)::timestamp` : sql``}`;
      const byCat = await rows(sql`select coalesce(nullif(e.category, ''), 'Other') category, sum(e.received)::bigint received, sum(e.paid)::bigint paid, count(*)::int entries
        from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id where ${where} group by 1 order by 3 desc`);
      const latest = await rows(sql`select e.id, to_char(e.entry_date, 'YYYY-MM-DD') date, e.received, e.paid, e.category, e.description
        from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id where ${where} order by e.entry_date desc nulls last, e.id desc limit 20`);
      return { truck: t.registration, byCategory: byCat, latest };
    },
  },
  trips: {
    about: "trips (journeys) of a truck or of all trucks, latest first, with status",
    args: "plate?",
    run: async (_req, a) => {
      const dir = await loadDirectory();
      const { matchTruck } = await import("./ai/context.ts");
      const t = a.plate ? matchTruck(dir, a.plate) : null;
      return rows(sql`select t.id, t.trip_number, v.vehicle_number truck, to_char(t.departure_time, 'YYYY-MM-DD') departed, t.status, r.origin, r.destination, t.leg_no
        from trips t join vehicles v on v.id = t.vehicle_id left join routes r on r.id = t.route_id
        where not t.is_deleted ${t ? sql`and t.vehicle_id = ${t.id}` : sql``} order by t.departure_time desc limit 30`);
    },
  },
  cash: {
    about: "cash book: money in / out and cash in hand for a period, and the latest entries",
    args: "from?, to?",
    run: async (req, a) => {
      const r = await selfApi(req, "GET", `/api/cash-book/summary?${qs({ from: okDay(a.from), to: okDay(a.to), by: "month" })}`);
      const latest = await rows(sql`select id, to_char(entry_date, 'YYYY-MM-DD') date, direction, amount, description, link_type from cash_transactions where not is_deleted order by entry_date desc, id desc limit 15`);
      return { summary: r, latest };
    },
  },
  search_entries: {
    about: "find entries by words in the description (truck khata, party ledgers, cash book)",
    args: "text, from?, to?",
    run: async (_req, a) => {
      const w = `%${String(a.text || "").slice(0, 60)}%`;
      const f = okDay(a.from), t = okDay(a.to);
      const range = (col: any) => sql`${f ? sql`and ${col} >= ${f}::timestamp` : sql``} ${t ? sql`and ${col} < (${t}::date + 1)::timestamp` : sql``}`;
      return rows(sql`(select 'truck khata' book, e.id, to_char(e.entry_date, 'YYYY-MM-DD') date, e.received money_in, e.paid money_out, e.description, l.registration who
          from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id where not e.is_deleted and e.description ilike ${w} ${range(sql`e.entry_date`)} order by e.entry_date desc nulls last limit 15)
        union all (select 'party ledger', e.id, to_char(e.entry_date, 'YYYY-MM-DD'), e.credit, e.debit, e.description, p.name
          from party_ledger_entries e join parties p on p.id = e.party_id where not e.is_deleted and e.description ilike ${w} ${range(sql`e.entry_date`)} order by e.entry_date desc nulls last limit 15)
        union all (select 'cash book', id, to_char(entry_date, 'YYYY-MM-DD'), case when direction = 'In' then amount else 0 end, case when direction = 'Out' then amount else 0 end, description, person
          from cash_transactions where not is_deleted and description ilike ${w} ${range(sql`entry_date`)} order by entry_date desc limit 15)`);
    },
  },
  books_check: { about: "how many mistakes Books Check finds now (red = definite, amber = look once)", args: "", run: (req) => selfApi(req, "GET", "/api/books-check/summary") },
  tax: { about: "tax withheld, paid to FBR and still owed for a period", args: "from, to", run: (req, a) => selfApi(req, "GET", `/api/tax/summary?${qs({ from: okDay(a.from), to: okDay(a.to) })}`) },
  banks: { about: "HFK's bank accounts with opening balances and statement status", args: "", run: (req) => selfApi(req, "GET", "/api/bank/accounts") },
};

router.post("/ask", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const question = String(req.body?.question || "").trim().slice(0, 2000);
    if (!question) return res.status(400).json({ error: "Ask something · کچھ پوچھیں" });
    if (!aiStatus().on) throw new AiOffError();
    const history = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-4).map((h: any) => `Q: ${String(h.q || "").slice(0, 400)}\nA: ${String(h.a || "").slice(0, 800)}`).join("\n\n");
    const today = todayPk();
    const fy = Number(today.slice(5, 7)) >= 7 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
    const plan = await aiJson({
      feature: "ask-plan",
      userId: req.user?.id,
      system: `You help the owner of HFK Enterprises (a truck transport company in Quetta) get answers from the company's books. Today is ${today}; the financial year runs 1 July – 30 June (this year: ${fy}-07-01 to ${fy + 1}-06-30); the books start 2025-07-01.
Pick the data you need (at most 4 lookups) from these tools:
${Object.entries(TOOLS).map(([k, t]) => `- ${k}(${t.args}): ${t.about}`).join("\n")}
Reply with JSON only: {"calls":[{"tool":"…","args":{…}}]}. Use [] only if the question is not about HFK's money or business.`,
      prompt: `${history ? `Earlier in this conversation:\n${history}\n\n` : ""}Question: ${question}`,
    });
    const calls = (Array.isArray(plan?.calls) ? plan.calls : []).filter((c: any) => TOOLS[c?.tool]).slice(0, 4);
    const data: any[] = [];
    for (const c of calls) {
      try {
        data.push({ tool: c.tool, args: c.args || {}, result: await TOOLS[c.tool].run(req, c.args || {}) });
      } catch (e: any) {
        data.push({ tool: c.tool, args: c.args || {}, error: errMsg(e) });
      }
    }
    const answer = await aiText({
      feature: "ask-answer",
      userId: req.user?.id,
      maxTokens: 2500,
      system: `You are HFK Enterprises' accountant answering the owner. Answer ONLY from the data given; if the data does not answer it, say so and say where in the ERP to look. Never invent a figure.
Write in the language of the question (Roman Urdu if it is in Roman Urdu, Urdu script if Urdu, else English). Short and clear: the answer first, then the 2–5 figures that support it. Money as "PKR 1,234,567" (Pakistani readers also like lakh: add "(12.3 lakh)" for big amounts). Mention the period the figures cover.
If the books show something worrying (a loss, an overdue party, mistakes in Books Check), say it in one line.`,
      prompt: `${history ? `Earlier:\n${history}\n\n` : ""}Question: ${question}\n\nData from the books:\n${data.map((d) => `## ${d.tool} ${JSON.stringify(d.args)}\n${d.error ? "ERROR: " + d.error : trim(d.result)}`).join("\n\n") || "(no data looked up)"}`,
    });
    res.json({ answer, used: data.map((d) => ({ tool: d.tool, args: d.args, ok: !d.error })) });
  } catch (e: any) {
    res.status(e instanceof AiOffError ? 503 : 500).json({ error: errMsg(e) });
  }
});

// ================================================================== today's to-do list
router.get("/briefing", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const today = todayPk();
    const dir = await loadDirectory();
    const items: Array<{ level: "red" | "amber" | "green" | "info"; title: string; urdu: string; detail?: string; link?: { wb: string; sheet: string } }> = [];
    const [c] = await rows(sql`select
        (select count(*) from cash_transactions where not is_deleted and (entry_date + interval '5 hours')::date = ${today}::date)::int cash_today,
        (select to_char(max(entry_date + interval '5 hours'), 'YYYY-MM-DD') from cash_transactions where not is_deleted) cash_last,
        (select max(day) from cash_closings where not is_deleted and day is not null) count_last,
        (select count(*) from ai_drafts where status in ('pending', 'failed'))::int drafts,
        (select count(*) from ai_reclass where status = 'pending')::int reclass,
        (select count(*) from truck_ledger_entries e where not e.is_deleted and e.entry_date is null and (e.received > 0 or e.paid > 0)
            and exists (select 1 from truck_ledger_entries x where x.ledger_id = e.ledger_id and not x.is_deleted and x.entry_date >= ${dir.booksStart}::timestamp))::int tle_undated,
        (select count(*) from party_ledger_entries e where not e.is_deleted and e.entry_date is null and (e.debit > 0 or e.credit > 0)
            and exists (select 1 from party_ledger_entries x where x.party_id = e.party_id and not x.is_deleted and x.entry_date >= ${dir.booksStart}::timestamp))::int ple_undated,
        (select count(*) from bank_statement_lines where not is_deleted and matched_key is null)::int bank_unmatched,
        (select count(*) from bank_accounts where not is_deleted and coalesce(opening_balance, 0) = 0)::int bank_no_opening,
        (select count(*) from bank_accounts where not is_deleted)::int banks`);
    const ago = (d: string | null) => (d ? Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime()) / 86400_000) : null);

    if (c.cash_today) items.push({ level: "green", title: `Cash Book: ${c.cash_today} entr${c.cash_today === 1 ? "y" : "ies"} today`, urdu: `آج کیش بک میں ${c.cash_today} اندراج`, link: { wb: "finance", sheet: "cash_book" } });
    else items.push({ level: "amber", title: `Nothing in the Cash Book today${c.cash_last ? ` (last entry ${c.cash_last})` : ""}`, urdu: "آج کیش بک میں کچھ نہیں لکھا گیا", detail: "Write today's cash in / out — or tell the AI Accountant in a sentence.", link: { wb: "finance", sheet: "cash_book" } });
    const cd = ago(c.count_last);
    if (cd === 0) items.push({ level: "green", title: "Cash counted today", urdu: "آج کیش گن لیا گیا" });
    else items.push({ level: cd == null || cd > 7 ? "red" : "amber", title: c.count_last ? `Cash last counted ${cd} day(s) ago (${c.count_last})` : "Cash has never been counted", urdu: "گلے کا کیش گن کر لکھیں", detail: "Count the notes at closing time and write the count — the system tells you if any is short.", link: { wb: "finance", sheet: "cash_book" } });
    if (c.drafts) items.push({ level: "amber", title: `${c.drafts} AI draft(s) waiting for your approval`, urdu: `${c.drafts} مسودے منظوری کے منتظر`, link: { wb: "accounting", sheet: "ai_accountant" } });
    if (c.reclass) items.push({ level: "info", title: `${c.reclass} category proposal(s) to review`, urdu: "کیٹیگری کی تجاویز دیکھیں", link: { wb: "accounting", sheet: "ai_accountant" } });
    try {
      const bc = await selfApi(req, "GET", "/api/books-check/summary");
      if (bc.red) items.push({ level: "red", title: `Books Check: ${bc.red} definite mistake(s)`, urdu: `حساب صحت: ${bc.red} یقینی غلطیاں`, detail: bc.amber ? `and ${bc.amber} to look at once` : undefined, link: { wb: "accounting", sheet: "books_check" } });
      else if (bc.amber) items.push({ level: "amber", title: `Books Check: ${bc.amber} item(s) to look at`, urdu: "حساب صحت دیکھیں", link: { wb: "accounting", sheet: "books_check" } });
      else items.push({ level: "green", title: "Books Check: nothing wrong", urdu: "حساب صحت: سب ٹھیک" });
    } catch {}
    if (c.tle_undated || c.ple_undated)
      items.push({ level: "red", title: `${c.tle_undated + c.ple_undated} khata / party row(s) have no date`, urdu: "بغیر تاریخ کے اندراج — تاریخ لکھیں", detail: `truck khata ${c.tle_undated}, party ledgers ${c.ple_undated}. The books cannot place them in a month, so balances in the books differ from the ledgers until each gets its date.`, link: { wb: "accounting", sheet: "books_check" } });
    if (c.banks && c.bank_no_opening) items.push({ level: "amber", title: `${c.bank_no_opening} of ${c.banks} bank(s) have no opening balance (${dir.booksStart})`, urdu: "بینک کا ابتدائی بیلنس لکھیں", link: { wb: "accounting", sheet: "banks" } });
    if (c.bank_unmatched) items.push({ level: "amber", title: `${c.bank_unmatched} bank statement line(s) not matched`, urdu: "بینک اسٹیٹمنٹ کی لائنیں ملائیں", link: { wb: "accounting", sheet: "banks" } });
    const lastMonthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
    if (!dir.lockedThrough || dir.lockedThrough < lastMonthEnd)
      items.push({ level: "info", title: `Close last month when it is checked (books open after ${dir.lockedThrough || "the start"})`, urdu: "پچھلا مہینہ چیک کر کے بند کریں", detail: "Closing stops old entries being changed by mistake. Statements → close month.", link: { wb: "accounting", sheet: "statements" } });
    try {
      const al = await selfApi(req, "GET", "/api/parties/alerts");
      const od = (al.overdue || []).filter((p: any) => p.closingBalance > 0);
      if (od.length) items.push({ level: "amber", title: `${od.length} part${od.length === 1 ? "y owes" : "ies owe"} HFK and paid nothing in ${al.overdueDays}+ days`, urdu: "پرانی وصولی — یاد دہانی بھیجیں", detail: `${pkr(od.reduce((s: number, p: any) => s + p.closingBalance, 0))} in total. See Reminders.`, link: { wb: "accounting", sheet: "ai_accountant" } });
    } catch {}
    const st = aiStatus();
    if (!st.on) items.push({ level: "info", title: "AI is off — the AI Accountant reads only simple typed lines and Excel with headings", urdu: "اے آئی بند ہے — تصویر/PDF پڑھنے کے لیے چابی لگائیں", detail: "Add ANTHROPIC_API_KEY (or GEMINI_API_KEY) in Render → Environment to read photos, PDFs and to ask questions." });
    const order = { red: 0, amber: 1, info: 2, green: 3 };
    items.sort((a, b) => order[a.level] - order[b.level]);
    res.json({ today, items });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

// ================================================================== the month's report
router.post("/report", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(String(req.body?.month)) ? String(req.body.month) : todayPk().slice(0, 7);
    const from = `${month}-01`;
    const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const prevTo = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
    const prevFrom = `${prevTo.slice(0, 7)}-01`;
    const [pnl, prev, trucks, flow, alerts, check] = await Promise.all([
      selfApi(req, "GET", `/api/statements/pnl?${qs({ from, to })}`),
      selfApi(req, "GET", `/api/statements/pnl?${qs({ from: prevFrom, to: prevTo })}`),
      selfApi(req, "GET", `/api/statements/pnl-trucks?${qs({ from, to })}`),
      selfApi(req, "GET", `/api/statements/cash-flow?${qs({ from, to })}`).catch(() => null),
      selfApi(req, "GET", "/api/parties/alerts").catch(() => null),
      selfApi(req, "GET", "/api/books-check/summary").catch(() => null),
    ]);
    const tr = (trucks.trucks || []).filter((t: any) => t.truck).map((t: any) => ({ truck: t.label, income: t.income, expenses: t.expenses, profit: t.profit }));
    const data = {
      month,
      from,
      to,
      income: pnl.totalIncome,
      expenses: pnl.totalExpenses,
      profit: pnl.profit,
      previous: { month: prevTo.slice(0, 7), income: prev.totalIncome, expenses: prev.totalExpenses, profit: prev.profit },
      topExpenses: [...(pnl.expenses || [])].sort((a: any, b: any) => b.amount - a.amount).slice(0, 6),
      income_lines: pnl.income,
      trucks: { count: tr.length, best: [...tr].sort((a, b) => b.profit - a.profit).slice(0, 5), worst: [...tr].sort((a, b) => a.profit - b.profit).slice(0, 5), losing: tr.filter((t: any) => t.profit < 0).length },
      cashFlow: flow,
      receivables: alerts?.totals || null,
      booksCheck: check,
    };
    let narrative: string;
    let by = "rules";
    if (aiStatus().on) {
      narrative = await aiText({
        feature: "report",
        userId: req.user?.id,
        maxTokens: 3000,
        system: `You are HFK Enterprises' accountant writing the monthly report for the owner (a truck transport company, Quetta). Use ONLY the figures given; never invent. Write two parts: first "Roman Urdu" (simple, the way the owner speaks), then "English". Each part: 1) the month in one line (profit or loss, vs last month); 2) income and the biggest expenses; 3) trucks that earned most / lost money and why it may be (only if the figures show it); 4) money to collect / pay; 5) what to do next (max 4 points, e.g. Books Check mistakes, losing trucks, overdue parties). Money as "PKR 1,234,567". Plain text with short headings, no tables.
Meaning of some accounts: "Truck expenses — not classified" = truck-khata money whose truck is known but whose kind (diesel, tyre…) is not written (category Other) — the fix is to give those rows a category; review accounts hold money the system could not place for sure. A "truck" named like a sheet or office (e.g. SHEET1, DAFTER) is an imported khata, not a real truck — say so if it tops a list.`,
        prompt: JSON.stringify(data),
      });
      by = `ai:${aiStatus().model}`;
    } else {
      const ch = data.profit - data.previous.profit;
      narrative = [
        `${month} — ${data.profit >= 0 ? "Munafa" : "Nuqsan"} ${pkr(Math.abs(data.profit))} (pichhle mahine ${pkr(data.previous.profit)}, farq ${ch >= 0 ? "+" : "−"}${pkr(Math.abs(ch))}).`,
        `Aamdani ${pkr(data.income)} · Kharcha ${pkr(data.expenses)}.`,
        `Sab se bade kharche: ${data.topExpenses.map((e: any) => `${e.name} ${pkr(e.amount)}`).join(", ") || "—"}.`,
        `Trucks: ${data.trucks.count}; nuqsan wale ${data.trucks.losing}. Sab se zyada munafa: ${data.trucks.best.map((t: any) => `${t.truck} ${pkr(t.profit)}`).join(", ") || "—"}.`,
        data.receivables ? `Lena hai ${pkr(data.receivables.receiving)} · dena hai ${pkr(data.receivables.payable)}.` : "",
        data.booksCheck ? `Books Check: ${data.booksCheck.red} pakki ghaltiyan, ${data.booksCheck.amber} dekhne wali.` : "",
        "",
        `(Written by the system's rules — switch the AI on for a fuller report.)`,
      ].filter(Boolean).join("\n");
    }
    const [saved] = await db.insert(schema.aiReports).values({ kind: "month", period: month, title: `Monthly report ${month}`, data: { ...data, by }, narrative, createdBy: req.user?.id }).returning();
    res.json(saved);
  } catch (e: any) {
    res.status(e instanceof AiOffError ? 503 : 500).json({ error: errMsg(e) });
  }
});

router.get("/reports", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ reports: await rows(sql`select id, kind, period, title, created_at, data ->> 'by' by from ai_reports order by id desc limit 60`) });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});
router.get("/reports/:id(\\d+)", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const [r] = await db.select().from(schema.aiReports).where(eq(schema.aiReports.id, parseInt(req.params.id))).limit(1);
    if (!r) return res.status(404).json({ error: "Report not found" });
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});
router.delete("/reports/:id(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    await db.delete(schema.aiReports).where(eq(schema.aiReports.id, parseInt(req.params.id)));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

// ================================================================== reminders (who owes HFK)
router.get("/reminders", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    const list = await rows(sql`select p.id, p.name, p.phone, p.closing_balance balance, p.status,
        (select to_char(max(e.entry_date), 'YYYY-MM-DD') from party_ledger_entries e where e.party_id = p.id and not e.is_deleted) last_entry,
        (select to_char(max(e.entry_date), 'YYYY-MM-DD') from party_ledger_entries e where e.party_id = p.id and not e.is_deleted and e.credit > 0) last_payment
      from parties p where not p.is_deleted and p.status <> 'Blocked' and p.closing_balance > 0 order by p.closing_balance desc limit 200`);
    const msg = (p: any) => ({
      roman: `Assalam o Alaikum ${p.name} sahib. HFK Enterprises ke hisaab ke mutabiq aap ki taraf PKR ${n(p.balance).toLocaleString("en-US")} baqaya hai${p.last_payment ? ` (aakhri adaigi ${p.last_payment})` : ""}. Meharbani farma kar adaigi kar dein, ya hisaab mein farq ho to hamein bata dein. Shukriya — HFK Enterprises, Quetta.`,
      urdu: `السلام علیکم ${p.name} صاحب۔ ایچ ایف کے انٹرپرائزز کے حساب کے مطابق آپ کی طرف ${n(p.balance).toLocaleString("en-US")} روپے بقایا ہیں${p.last_payment ? ` (آخری ادائیگی ${p.last_payment})` : ""}۔ مہربانی فرما کر ادائیگی کر دیں، یا حساب میں فرق ہو تو ہمیں بتا دیں۔ شکریہ — ایچ ایف کے انٹرپرائزز، کوئٹہ۔`,
    });
    res.json({ parties: list.map((p) => ({ ...p, balance: n(p.balance), message: msg(p) })) });
  } catch (e: any) {
    res.status(500).json({ error: errMsg(e) });
  }
});

export default router;
