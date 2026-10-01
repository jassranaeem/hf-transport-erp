/**
 * Banks · بینک — each bank's statement brought in and matched to the books.
 *
 * Upload the statement (Excel / CSV) for one of the company's bank accounts; every line is
 * matched to the ledger entry it is — a party payment or receipt made by bank, a truck's online
 * payment, an invoice payment, cash deposited / withdrawn in the Daily Cash Book — automatically
 * when the amount is the same and the dates are close (one clear candidate), or by hand. A line
 * that is no ledger entry is explained instead: bank charges, a transfer between our own banks,
 * bank profit, tax the bank deducted, cash not in the cash book. The books engine (books.ts)
 * then posts each line to that bank's own account; an unexplained line sits in "bank lines not
 * explained" until it is.
 *
 *   GET    /api/bank/accounts                    each bank: opening, statement range & balance, books, unexplained
 *   PUT    /api/bank/accounts/:id/opening        { openingBalance }  the balance on the books' first day
 *   POST   /api/bank/statement/preview           file + bankAccountId → what would be imported
 *   POST   /api/bank/statement/import            same → import, then match automatically
 *   DELETE /api/bank/batch/:batch                undo one import
 *   GET    /api/bank/lines?bank=&status=         status: unexplained | matched | explained | all
 *   GET    /api/bank/lines/:id/candidates        ledger entries this line could be
 *   POST   /api/bank/lines/:id/match             { key }
 *   POST   /api/bank/lines/:id/explain           { kind, note }   kind: charges|transfer|profit|tax|cash|null
 *   POST   /api/bank/lines/:id/unmatch
 *   DELETE /api/bank/lines/:id
 *   POST   /api/bank/auto-match                  { bankAccountId? }
 */
import { Router, Response } from "express";
import multer from "multer";
import { createHash, randomBytes } from "crypto";
import { sql, SQL } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { parseBankStatement } from "../src/lib/dataio/bank-statement.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const rows = async (q: SQL) => ((await db.execute(q)) as any).rows as any[];
const err = (e: any) => e?.cause?.message || e?.message || String(e);
export const KINDS: Record<string, string> = {
  charges: "Bank charges · بینک چارجز",
  transfer: "Transfer between our own banks · اپنے بینکوں میں منتقلی",
  profit: "Bank profit · بینک منافع",
  tax: "Tax deducted by the bank · بینک نے ٹیکس کاٹا",
  cash: "Cash deposited / withdrawn, not in the cash book · کیش جو کیش بک میں نہیں",
};
const BANKISH = sql`('Bank', 'Online', 'Cheque', 'Card', 'Bank Transfer', 'Online Transfer')`;
const audit = (req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", id: number, oldV: unknown, newV: unknown) =>
  logAudit({ action, tableName: "bank_statement_lines", recordId: id, oldValues: oldV, newValues: newV, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});

// ---------------------------------------------------------------- what a line could be
/**
 * Ledger entries with the same amount, on the right side, within `days` of the line, not yet
 * matched to another line. Keys are the books' source keys, so the engine knows which entry.
 */
export async function candidatesFor(lineId: number, days = 7) {
  const [l] = await rows(sql`select id, txn_date, withdrawal, deposit from bank_statement_lines where id = ${lineId} and not is_deleted`);
  if (!l) return [];
  const out = Number(l.withdrawal) > 0;
  const amt = out ? Number(l.withdrawal) : Number(l.deposit);
  const d = sql`${new Date(l.txn_date).toISOString().slice(0, 10)}::date`;
  const near = (col: SQL) => sql`${col}::date between ${d} - ${days}::int and ${d} + ${days}::int`;
  const taken = sql`select matched_key from bank_statement_lines where matched_key is not null and not is_deleted and id <> ${lineId}`;
  return rows(sql`select * from (
      select case when e.ref_no like 'PSHIP-%' then 'pship:' else 'ple:' end || e.id key, e.entry_date d, 'Party ledger · ' || p.name what, coalesce(e.description, '') detail, e.method
      from party_ledger_entries e join parties p on p.id = e.party_id
      where not e.is_deleted and e.method in ${BANKISH} and ${out ? sql`e.debit` : sql`e.credit`} = ${amt} and ${near(sql`e.entry_date`)}
        and not exists (select 1 from cash_transactions t where t.link_type = 'party' and t.derived_entry_id = e.id and not t.is_deleted)
      union all
      select 'tle:' || e.id, e.entry_date, 'Truck khata · ' || l.registration, coalesce(e.description, e.category), e.method
      from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
      where not e.is_deleted and not l.is_deleted and (e.method in ${BANKISH} or e.category = 'OnlineTransfer')
        and ${out ? sql`e.paid` : sql`e.received`} = ${amt} and ${near(sql`e.entry_date`)}
      union all
      select 'ct:' || t.id, t.entry_date, 'Cash book · ' || ${out ? "cash in (withdrawn from bank)" : "cash out (deposited in bank)"}, coalesce(t.description, t.person, ''), 'Cash'
      from cash_transactions t
      where not t.is_deleted and t.direction = ${out ? "In" : "Out"} and t.amount = ${amt} and ${near(sql`t.entry_date`)}
      union all
      select 'pe:' || x.id, x.entry_date, 'Household · ' || coalesce(x.payee, x.person, ''), coalesce(x.description, ''), x.method
      from personal_expenses x
      where not x.is_deleted and x.method in ${BANKISH} and x.direction = ${out ? "expense" : "income"} and x.amount = ${amt} and ${near(sql`x.entry_date`)}
      union all
      select 'zk:' || z.id, z.entry_date, 'Zakat · ' || coalesce(z.recipient, ''), coalesce(z.description, ''), z.method
      from zakat_payments z
      where ${out} and not z.is_deleted and z.method in ${BANKISH} and z.amount = ${amt} and ${near(sql`z.entry_date`)}
      union all
      select 'tax:' || x.id, x.entry_date, 'Tax paid to FBR · ' || coalesce(x.cpr_no, ''), coalesce(x.notes, ''), coalesce(x.method, 'Bank')
      from tax_entries x
      where ${out} and not x.is_deleted and x.kind = 'deposited' and x.tax_amount = ${amt} and ${near(sql`x.entry_date`)}
      union all
      select 'pay:' || y.id, y.payment_date, 'Invoice payment · ' || coalesce(y.payment_number, ''), coalesce(y.reference_number, ''), y.payment_method
      from payments y
      where ${!out} and not y.is_deleted and y.payment_method <> 'Cash' and y.amount = ${amt} and ${near(sql`y.payment_date`)}
    ) c
    where c.key not in (${taken})
    order by abs(c.d::date - ${d}), c.key
    limit 12`);
}

/** Match every unexplained line that has exactly one clear candidate (same amount, within 3 days). */
export async function autoMatch(bankAccountId?: number) {
  const list = await rows(sql`select id from bank_statement_lines where not is_deleted and matched_key is null and kind is null
    ${bankAccountId ? sql`and bank_account_id = ${bankAccountId}` : sql``} order by txn_date, id`);
  let matched = 0;
  for (const l of list) {
    const c = await candidatesFor(Number(l.id), 3);
    if (c.length === 1) {
      await db.execute(sql`update bank_statement_lines set matched_key = ${c[0].key}, match_kind = 'auto', updated_at = now() where id = ${l.id} and matched_key is null`);
      matched++;
    }
  }
  return { checked: list.length, matched };
}

// ---------------------------------------------------------------- routes
router.get("/accounts", requireRole(READ), async (_req: AuthRequest, res: Response) => {
  try {
    const [st] = await rows(sql`select to_char(books_start, 'YYYY-MM-DD') d from books_settings where id = 1`).catch(() => [{ d: "2025-07-01" }]);
    const start = st?.d || "2025-07-01";
    const list = await rows(sql`select b.id, b.bank_name, b.account_number, b.iban, b.opening_balance, '12' || lpad(b.id::text, 2, '0') gl_code,
        (select count(*)::int from bank_statement_lines s where s.bank_account_id = b.id and not s.is_deleted) lines,
        (select min(txn_date) from bank_statement_lines s where s.bank_account_id = b.id and not s.is_deleted) first_date,
        (select max(txn_date) from bank_statement_lines s where s.bank_account_id = b.id and not s.is_deleted) last_date,
        (select s.balance from bank_statement_lines s where s.bank_account_id = b.id and not s.is_deleted order by s.txn_date desc, s.id desc limit 1) statement_balance,
        b.opening_balance + coalesce((select sum(deposit - withdrawal) from bank_statement_lines s where s.bank_account_id = b.id and not s.is_deleted and s.txn_date >= ${start}::timestamp), 0) books_balance,
        (select count(*)::int from bank_statement_lines s where s.bank_account_id = b.id and not s.is_deleted and s.matched_key is null and s.kind is null) unexplained
      from bank_accounts b where not b.is_deleted order by b.id`);
    res.json({ booksStart: start, accounts: list.map((a) => ({ ...a, opening_balance: Number(a.opening_balance), statement_balance: a.statement_balance == null ? null : Number(a.statement_balance), books_balance: Number(a.books_balance) })), kinds: KINDS });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.put("/accounts/:id/opening", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const v = Math.round(Number(String(req.body?.openingBalance ?? "").replace(/[^\d.-]/g, "")) || 0);
    const [old] = await rows(sql`select opening_balance from bank_accounts where id = ${id}`);
    await db.execute(sql`update bank_accounts set opening_balance = ${v}, updated_at = now(), updated_by = ${req.user?.id ?? null} where id = ${id}`);
    await logAudit({ action: "UPDATE", tableName: "bank_accounts", recordId: id, oldValues: old, newValues: { opening_balance: v }, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

async function readUpload(req: AuthRequest) {
  const f = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
  if (!f) throw new Error("Choose the statement file · فائل منتخب کریں");
  const bankAccountId = parseInt(String(req.body?.bankAccountId || ""));
  const [bank] = await rows(sql`select id, bank_name, account_number from bank_accounts where id = ${bankAccountId || 0} and not is_deleted`);
  if (!bank) throw new Error("Pick which bank account this statement is for · بینک منتخب کریں");
  const parsed = await parseBankStatement(f.buffer, f.originalname);
  // chronological order (some banks list newest first)
  const list = parsed.rows[0].date > parsed.rows[parsed.rows.length - 1].date ? [...parsed.rows].reverse() : parsed.rows;
  const seen = new Map<string, number>();
  const withHash = list.map((r) => {
    const base = [bank.id, r.date, r.withdrawal, r.deposit, r.balance ?? "", r.description.toLowerCase()].join("|");
    const n = (seen.get(base) || 0) + 1; // identical lines in one file stay apart
    seen.set(base, n);
    return { ...r, hash: createHash("sha1").update(r.balance == null ? `${base}|${n}` : base).digest("hex") };
  });
  const existing = new Set(
    (await rows(sql`select row_hash from bank_statement_lines where bank_account_id = ${bank.id} and not is_deleted and row_hash = any(${`{${withHash.map((r) => r.hash).join(",")}}`}::text[])`)).map((r) => r.row_hash),
  );
  // the statement's own running balance: does each line follow from the one before?
  let breaks = 0;
  for (let i = 1; i < withHash.length; i++) {
    const a = withHash[i - 1];
    const b = withHash[i];
    if (a.balance != null && b.balance != null && a.balance + b.deposit - b.withdrawal !== b.balance) breaks++;
  }
  return { bank, file: f.originalname, parsed, list: withHash, fresh: withHash.filter((r) => !existing.has(r.hash)), duplicates: withHash.length - withHash.filter((r) => !existing.has(r.hash)).length, breaks };
}

router.post("/statement/preview", requireRole(WRITE), upload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    const u = await readUpload(req);
    res.json({
      bank: u.bank,
      file: u.file,
      columns: u.parsed.columns,
      headerRow: u.parsed.headerRow,
      total: u.list.length,
      fresh: u.fresh.length,
      duplicates: u.duplicates,
      skipped: u.parsed.skipped,
      from: u.list[0]?.date,
      to: u.list[u.list.length - 1]?.date,
      withdrawals: u.fresh.reduce((s, r) => s + r.withdrawal, 0),
      deposits: u.fresh.reduce((s, r) => s + r.deposit, 0),
      lastBalance: u.list[u.list.length - 1]?.balance ?? null,
      balanceBreaks: u.breaks,
      warnings: u.parsed.warnings,
      sample: u.list.slice(0, 8),
    });
  } catch (e: any) {
    res.status(400).json({ error: err(e) });
  }
});

router.post("/statement/import", requireRole(WRITE), upload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    const u = await readUpload(req);
    const batch = `BS-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
    for (let i = 0; i < u.fresh.length; i += 500) {
      const chunk = u.fresh.slice(i, i + 500);
      await db.execute(sql`insert into bank_statement_lines (bank_account_id, txn_date, description, ref, withdrawal, deposit, balance, row_hash, source_file, batch, created_by)
        values ${sql.join(
          chunk.map((r) => sql`(${u.bank.id}, ${r.date}::timestamp, ${r.description || null}, ${r.ref || null}, ${r.withdrawal}, ${r.deposit}, ${r.balance}, ${r.hash}, ${u.file}, ${batch}, ${req.user?.id ?? null})`),
          sql`, `,
        )}
        on conflict do nothing`);
    }
    const m = await autoMatch(u.bank.id);
    await logAudit({ action: "CREATE", tableName: "bank_statement_lines", recordId: u.bank.id, oldValues: null, newValues: { batch, file: u.file, imported: u.fresh.length, duplicates: u.duplicates, autoMatched: m.matched }, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.json({ ok: true, batch, imported: u.fresh.length, duplicates: u.duplicates, autoMatched: m.matched, left: m.checked - m.matched });
  } catch (e: any) {
    res.status(400).json({ error: err(e) });
  }
});

router.delete("/batch/:batch", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const gone = await rows(sql`update bank_statement_lines set is_deleted = true, deleted_at = now(), updated_at = now() where batch = ${req.params.batch} and not is_deleted returning id`);
    await logAudit({ action: "DELETE", tableName: "bank_statement_lines", recordId: 0, oldValues: { batch: req.params.batch }, newValues: { removed: gone.length }, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.json({ ok: true, removed: gone.length });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

/** What a matched key is, in words. */
const WHAT = sql`case
    when s.matched_key like 'ple:%' or s.matched_key like 'pship:%' then (select 'Party ledger · ' || p.name || coalesce(' — ' || e.description, '') from party_ledger_entries e join parties p on p.id = e.party_id where e.id = split_part(s.matched_key, ':', 2)::int)
    when s.matched_key like 'tle:%' then (select 'Truck khata · ' || l.registration || coalesce(' — ' || e.description, '') from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id where e.id = split_part(s.matched_key, ':', 2)::int)
    when s.matched_key like 'ct:%' then (select 'Cash book · ' || coalesce(t.description, t.person, '') from cash_transactions t where t.id = split_part(s.matched_key, ':', 2)::int)
    when s.matched_key like 'pe:%' then (select 'Household · ' || coalesce(x.description, x.payee, '') from personal_expenses x where x.id = split_part(s.matched_key, ':', 2)::int)
    when s.matched_key like 'zk:%' then (select 'Zakat · ' || coalesce(z.recipient, '') from zakat_payments z where z.id = split_part(s.matched_key, ':', 2)::int)
    when s.matched_key like 'tax:%' then (select 'Tax paid to FBR · ' || coalesce(x.cpr_no, '') from tax_entries x where x.id = split_part(s.matched_key, ':', 2)::int)
    when s.matched_key like 'pay:%' then (select 'Invoice payment · ' || coalesce(y.payment_number, '') from payments y where y.id = split_part(s.matched_key, ':', 2)::int)
  end`;

router.get("/lines", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const bank = parseInt(String(req.query.bank || "0"));
    const status = String(req.query.status || "unexplained");
    const filter =
      status === "matched" ? sql`and s.matched_key is not null` : status === "explained" ? sql`and s.kind is not null` : status === "all" ? sql`` : sql`and s.matched_key is null and s.kind is null`;
    const list = await rows(sql`select s.id, s.txn_date, s.description, s.ref, s.withdrawal, s.deposit, s.balance, s.matched_key, s.match_kind, s.kind, s.note, s.batch, s.source_file, ${WHAT} what
      from bank_statement_lines s where not s.is_deleted and s.bank_account_id = ${bank} ${filter}
      order by s.txn_date desc, s.id desc limit 1000`);
    res.json(list.map((l) => ({ ...l, withdrawal: Number(l.withdrawal), deposit: Number(l.deposit), balance: l.balance == null ? null : Number(l.balance) })));
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.get("/lines/:id/candidates", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    res.json(await candidatesFor(parseInt(req.params.id), Math.min(30, parseInt(String(req.query.days || "7")) || 7)));
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.post("/lines/:id/match", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const key = String(req.body?.key || "");
    const ok = (await candidatesFor(id, 30)).some((c) => c.key === key);
    if (!ok) return res.status(400).json({ error: "That entry does not fit this line (amount, side or already matched)" });
    const [old] = await rows(sql`select * from bank_statement_lines where id = ${id}`);
    await db.execute(sql`update bank_statement_lines set matched_key = ${key}, match_kind = 'manual', kind = null, updated_at = now(), updated_by = ${req.user?.id ?? null} where id = ${id}`);
    await audit(req, "UPDATE", id, old, { matched_key: key });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.post("/lines/:id/explain", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const kind = req.body?.kind && KINDS[req.body.kind] ? String(req.body.kind) : null;
    const [old] = await rows(sql`select * from bank_statement_lines where id = ${id}`);
    await db.execute(sql`update bank_statement_lines set kind = ${kind}, matched_key = null, match_kind = null, note = ${req.body?.note ? String(req.body.note).slice(0, 300) : null}, updated_at = now(), updated_by = ${req.user?.id ?? null} where id = ${id}`);
    await audit(req, "UPDATE", id, old, { kind });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.post("/lines/:id/unmatch", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await rows(sql`select * from bank_statement_lines where id = ${id}`);
    await db.execute(sql`update bank_statement_lines set matched_key = null, match_kind = null, kind = null, updated_at = now(), updated_by = ${req.user?.id ?? null} where id = ${id}`);
    await audit(req, "UPDATE", id, old, { matched_key: null, kind: null });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.delete("/lines/:id", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await rows(sql`select * from bank_statement_lines where id = ${id}`);
    await db.execute(sql`update bank_statement_lines set is_deleted = true, deleted_at = now(), updated_at = now() where id = ${id}`);
    await audit(req, "DELETE", id, old, null);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

router.post("/auto-match", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    res.json(await autoMatch(req.body?.bankAccountId ? Number(req.body.bankAccountId) : undefined));
  } catch (e: any) {
    res.status(500).json({ error: err(e) });
  }
});

export default router;
