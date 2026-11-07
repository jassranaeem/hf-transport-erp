/**
 * Credit notes · کریڈٹ نوٹ — money taken off an invoice that will never be paid: a shortage the
 * customer deducted, a damage / late claim, a discount agreed afterwards.
 *
 * The invoice keeps its full amount; the credit note lowers what is still owed on it
 * (outstanding = total − paid − credited), and the customer's balance with it. In the books
 * (books.ts, source "cn") it is: Freight deductions (4090) ↔ Accounts Receivable (1100).
 *
 *   GET    /api/credit-notes?invoiceId=     list (newest first)
 *   POST   /api/credit-notes                { invoiceId, noteDate, amount, kind, reason }
 *   DELETE /api/credit-notes/:id            take it back
 */
import { Router, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor", "Operations Manager"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant"];
export const CREDIT_KINDS = ["Shortage", "Damage claim", "Late delivery", "Discount", "Rate difference", "Other"];

const rows = async (q: any) => ((await db.execute(q)) as any).rows as any[];

/** Put an invoice's credited amount, balance and status in line with its credit notes. */
export async function syncInvoiceCredits(invoiceId: number) {
  const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1);
  if (!inv) return null;
  const [s] = await rows(sql`select coalesce(sum(amount), 0)::int c from credit_notes where invoice_id = ${invoiceId} and not is_deleted`);
  const credited = Number(s?.c || 0);
  const paid = inv.paidAmount || 0;
  const outstanding = Math.max(0, inv.totalAmount - paid - credited);
  const settled = paid + credited;
  const status = settled >= inv.totalAmount ? "Paid" : settled > 0 ? "Partially Paid" : inv.status === "Overdue" ? "Overdue" : "Unpaid";
  const delta = (inv.outstandingBalance || 0) - outstanding; // how much less the customer now owes
  await db.update(schema.invoices).set({ creditedAmount: credited, outstandingBalance: outstanding, status, updatedAt: new Date() }).where(eq(schema.invoices.id, invoiceId));
  if (delta) {
    await db.execute(sql`update contractors set outstanding_balance = greatest(0, outstanding_balance - ${delta}) where id = ${inv.contractorId}`);
  }
  return { credited, outstanding, status };
}

router.get("/", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const inv = parseInt(String(req.query.invoiceId || ""));
    const list = await rows(sql`select n.*, i.invoice_number, c.company contractor_name
      from credit_notes n join invoices i on i.id = n.invoice_id left join contractors c on c.id = n.contractor_id
      where not n.is_deleted ${inv ? sql`and n.invoice_id = ${inv}` : sql``}
      order by n.note_date desc, n.id desc limit 500`);
    res.json({ notes: list, kinds: CREDIT_KINDS });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const invoiceId = parseInt(b.invoiceId);
    const amount = Math.round(Number(b.amount));
    if (!invoiceId) return res.status(400).json({ error: "Choose the invoice · انوائس منتخب کریں" });
    if (!(amount > 0)) return res.status(400).json({ error: "Enter the amount taken off · رقم درج کریں" });
    const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.isDeleted, false))).limit(1);
    if (!inv) return res.status(404).json({ error: "Invoice not found" });
    if (amount > (inv.outstandingBalance || 0))
      return res.status(400).json({ error: `Only PKR ${(inv.outstandingBalance || 0).toLocaleString()} is still owed on ${inv.invoiceNumber} — a credit note cannot be more than that · باقی رقم سے زیادہ نہیں ہو سکتا` });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.noteDate || "")) ? `${b.noteDate}T12:00:00` : new Date().toISOString();
    const year = date.slice(0, 4);
    const [n] = await rows(sql`select count(*)::int n from credit_notes where note_number like ${`CN-${year}-%`}`);
    const noteNumber = `CN-${year}-${String((n?.n || 0) + 1).padStart(4, "0")}`;
    const kind = CREDIT_KINDS.includes(b.kind) ? b.kind : "Other";
    const [note] = await rows(sql`insert into credit_notes (note_number, invoice_id, contractor_id, note_date, amount, kind, reason, created_by)
      values (${noteNumber}, ${invoiceId}, ${inv.contractorId}, ${date}::timestamp, ${amount}, ${kind}, ${b.reason ? String(b.reason).slice(0, 500) : null}, ${req.user?.id ?? null}) returning *`);
    const after = await syncInvoiceCredits(invoiceId);
    await logAudit({ action: "CREATE", tableName: "credit_notes", recordId: note.id, oldValues: null, newValues: note, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.json({ note, invoice: after });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [note] = await rows(sql`update credit_notes set is_deleted = true, updated_at = now() where id = ${id} and not is_deleted returning *`);
    if (!note) return res.status(404).json({ error: "Credit note not found" });
    const after = await syncInvoiceCredits(note.invoice_id);
    await logAudit({ action: "DELETE", tableName: "credit_notes", recordId: id, oldValues: note, newValues: null, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
    res.json({ ok: true, invoice: after });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
