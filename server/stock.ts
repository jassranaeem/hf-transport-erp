/**
 * Parts stock & purchase orders · اسٹاک اور خریداری آرڈر — for the workshop: tyres, filters,
 * oil, batteries, spare parts.
 *
 *   Items      what is kept (code, unit, re-order level); on hand = Σ moves
 *   Moves      in (bought / returned), out (fitted on a truck), adjust (count correction)
 *   POs        an order to a supplier; "Receive" puts the lines in stock and makes the supplier's
 *              bill (Bills, payable 2000 ↔ maintenance 5003), so the order, the stock and the
 *              payable always agree.
 *
 *   GET/POST /api/stock/items · PUT/DELETE /api/stock/items/:id
 *   GET /api/stock/moves?itemId= · POST /api/stock/moves · DELETE /api/stock/moves/:id
 *   GET/POST /api/stock/po · PUT /api/stock/po/:id · POST /api/stock/po/:id/receive · POST /api/stock/po/:id/cancel
 */
import { Router, Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db } from "../src/db/index.ts";
import { logAudit } from "../src/db/audit.ts";
import { createVendorBill } from "./finance_engine.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const READ = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor", "Operations Manager", "Fleet Manager", "Maintenance Manager"];
const WRITE = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Operations Manager", "Fleet Manager", "Maintenance Manager"];
const rows = async (q: any) => ((await db.execute(q)) as any).rows as any[];
const audit = (req: AuthRequest, action: "CREATE" | "UPDATE" | "DELETE", table: string, id: number, o: unknown, n: unknown) =>
  logAudit({ action, tableName: table, recordId: id, oldValues: o, newValues: n, performedBy: req.user?.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => {});
const isDay = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const onHand = async (itemId: number) => Number((await rows(sql`select coalesce(sum(qty), 0)::int q from stock_moves where item_id = ${itemId} and not is_deleted`))[0]?.q || 0);

// ---------------------------------------------------------------- items
router.get("/items", requireRole(READ), async (_req, res: Response) => {
  try {
    const items = await rows(sql`select i.*, coalesce(m.q, 0)::int on_hand, coalesce(m.q, 0) * i.last_cost value, m.last_move
      from stock_items i left join (select item_id, sum(qty) q, max(move_date) last_move from stock_moves where not is_deleted group by 1) m on m.item_id = i.id
      where not i.is_deleted order by i.name`);
    const low = items.filter((i) => i.reorder_level > 0 && i.on_hand <= i.reorder_level).length;
    res.json({ items, totals: { items: items.length, value: items.reduce((s, i) => s + Number(i.value || 0), 0), low } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/items", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ error: "Write the item's name · نام لکھیں" });
    const code = String(b.code || "").trim() || `ITM-${String(Number((await rows(sql`select count(*)::int n from stock_items`))[0].n) + 1).padStart(4, "0")}`;
    const [r] = await rows(sql`insert into stock_items (code, name, unit, category, reorder_level, last_cost, notes, created_by)
      values (${code}, ${name}, ${b.unit || "pcs"}, ${b.category || null}, ${Math.max(0, Number(b.reorderLevel) || 0)}, ${Math.max(0, Math.round(Number(b.lastCost) || 0))}, ${b.notes || null}, ${req.user?.id ?? null}) returning *`);
    await audit(req, "CREATE", "stock_items", r.id, null, r);
    res.json(r);
  } catch (e: any) {
    res.status(e.message?.includes("stock_items_code_idx") ? 400 : 500).json({ error: e.message?.includes("stock_items_code_idx") ? "That code is already used" : e.message });
  }
});

router.put("/items/:id(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const b = req.body || {};
    const [old] = await rows(sql`select * from stock_items where id = ${id}`);
    if (!old) return res.status(404).json({ error: "Not found" });
    const [r] = await rows(sql`update stock_items set name = ${b.name ?? old.name}, unit = ${b.unit ?? old.unit}, category = ${b.category ?? old.category},
      reorder_level = ${Math.max(0, Number(b.reorderLevel ?? old.reorder_level) || 0)}, last_cost = ${Math.max(0, Math.round(Number(b.lastCost ?? old.last_cost) || 0))},
      notes = ${b.notes ?? old.notes}, updated_at = now() where id = ${id} returning *`);
    await audit(req, "UPDATE", "stock_items", id, old, r);
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/items/:id(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id);
  if ((await onHand(id)) !== 0) return res.status(400).json({ error: "There is still stock of it — issue or adjust it to zero first" });
  const [r] = await rows(sql`update stock_items set is_deleted = true where id = ${id} returning *`);
  await audit(req, "DELETE", "stock_items", id, r, null);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- moves
router.get("/moves", requireRole(READ), async (req, res: Response) => {
  try {
    const itemId = parseInt(String(req.query.itemId || ""));
    const list = await rows(sql`select m.*, to_char(m.move_date, 'YYYY-MM-DD') as day, i.name item, i.unit, v.vehicle_number truck, p.po_number, u.name by_name
      from stock_moves m join stock_items i on i.id = m.item_id left join vehicles v on v.id = m.vehicle_id left join purchase_orders p on p.id = m.po_id left join users u on u.id = m.created_by
      where not m.is_deleted ${itemId ? sql`and m.item_id = ${itemId}` : sql``} order by m.move_date desc, m.id desc limit 300`);
    res.json({ moves: list });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/moves", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const itemId = parseInt(b.itemId);
    const kind = ["in", "out", "adjust"].includes(b.kind) ? b.kind : null;
    const q = Math.round(Number(b.qty));
    if (!itemId || !kind || !q) return res.status(400).json({ error: "Choose the item, in / out and the quantity" });
    if (kind === "out" && !b.vehicleId) return res.status(400).json({ error: "Which truck was it fitted on? · کس ٹرک پر لگا" });
    const qty = kind === "in" ? Math.abs(q) : kind === "out" ? -Math.abs(q) : q;
    const have = await onHand(itemId);
    if (have + qty < 0) return res.status(400).json({ error: `Only ${have} in stock · صرف ${have} موجود ہیں` });
    const [item] = await rows(sql`select * from stock_items where id = ${itemId} and not is_deleted`);
    if (!item) return res.status(404).json({ error: "Item not found" });
    const cost = Math.max(0, Math.round(Number(b.unitCost) || (kind === "in" ? 0 : item.last_cost)));
    const [m] = await rows(sql`insert into stock_moves (item_id, move_date, qty, unit_cost, kind, vehicle_id, notes, created_by)
      values (${itemId}, ${isDay(b.date) ? `${b.date}T12:00:00` : new Date().toISOString()}::timestamp, ${qty}, ${cost}, ${kind}, ${b.vehicleId ? Number(b.vehicleId) : null}, ${b.notes || null}, ${req.user?.id ?? null}) returning *`);
    if (kind === "in" && cost) await db.execute(sql`update stock_items set last_cost = ${cost}, updated_at = now() where id = ${itemId}`);
    await audit(req, "CREATE", "stock_moves", m.id, null, m);
    res.json({ ...m, onHand: have + qty });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/moves/:id(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  const [m] = await rows(sql`select * from stock_moves where id = ${parseInt(req.params.id)} and not is_deleted`);
  if (!m) return res.status(404).json({ error: "Not found" });
  if (m.po_id) return res.status(400).json({ error: "This came from a purchase order — it stays with the order" });
  if ((await onHand(m.item_id)) - m.qty < 0) return res.status(400).json({ error: "Taking it back would leave less than zero in stock" });
  await db.execute(sql`update stock_moves set is_deleted = true where id = ${m.id}`);
  await audit(req, "DELETE", "stock_moves", m.id, m, null);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- purchase orders
function cleanLines(lines: any): Array<{ itemId: number | null; name: string; qty: number; rate: number; amount: number }> {
  return (Array.isArray(lines) ? lines : [])
    .map((l: any) => {
      const qty = Math.max(0, Math.round(Number(l.qty) || 0));
      const rate = Math.max(0, Math.round(Number(l.rate) || 0));
      return { itemId: l.itemId ? Number(l.itemId) : null, name: String(l.name || "").trim().slice(0, 120), qty, rate, amount: qty * rate };
    })
    .filter((l) => (l.itemId || l.name) && l.qty > 0);
}

router.get("/po", requireRole(READ), async (_req, res: Response) => {
  try {
    const list = await rows(sql`select p.*, to_char(p.order_date, 'YYYY-MM-DD') order_day, to_char(p.expected_date, 'YYYY-MM-DD') expected_day, b.bill_number, b.outstanding_balance bill_due
      from purchase_orders p left join bills b on b.id = p.bill_id where not p.is_deleted order by p.order_date desc, p.id desc limit 300`);
    res.json({ list });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/po", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const vendor = String(b.vendorName || "").trim();
    const lines = cleanLines(b.lines);
    if (!vendor) return res.status(400).json({ error: "Who is it ordered from? · سپلائر" });
    if (!lines.length) return res.status(400).json({ error: "Add at least one line with a quantity" });
    const date = isDay(b.orderDate) ? b.orderDate : new Date().toISOString().slice(0, 10);
    const [n] = await rows(sql`select count(*)::int n from purchase_orders where po_number like ${`PO-${date.slice(0, 4)}-%`}`);
    const poNumber = `PO-${date.slice(0, 4)}-${String((n?.n || 0) + 1).padStart(4, "0")}`;
    const total = lines.reduce((s, l) => s + l.amount, 0);
    const [r] = await rows(sql`insert into purchase_orders (po_number, vendor_name, party_id, order_date, expected_date, lines, total, notes, created_by)
      values (${poNumber}, ${vendor}, ${b.partyId ? Number(b.partyId) : null}, ${`${date}T12:00:00`}::timestamp, ${isDay(b.expectedDate) ? `${b.expectedDate}T12:00:00` : null}::timestamp,
              ${JSON.stringify(lines)}::jsonb, ${total}, ${b.notes || null}, ${req.user?.id ?? null}) returning *`);
    await audit(req, "CREATE", "purchase_orders", r.id, null, r);
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/po/:id(\\d+)", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await rows(sql`select * from purchase_orders where id = ${id} and not is_deleted`);
    if (!old) return res.status(404).json({ error: "Not found" });
    if (old.status !== "Open") return res.status(400).json({ error: `It is already ${old.status.toLowerCase()} — it cannot be changed` });
    const b = req.body || {};
    const lines = b.lines ? cleanLines(b.lines) : old.lines;
    const total = lines.reduce((s: number, l: any) => s + l.amount, 0);
    const [r] = await rows(sql`update purchase_orders set vendor_name = ${String(b.vendorName ?? old.vendor_name)}, lines = ${JSON.stringify(lines)}::jsonb, total = ${total},
      expected_date = ${isDay(b.expectedDate) ? `${b.expectedDate}T12:00:00` : old.expected_date}::timestamp, notes = ${b.notes ?? old.notes}, updated_at = now() where id = ${id} returning *`);
    await audit(req, "UPDATE", "purchase_orders", id, old, r);
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/po/:id(\\d+)/cancel", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id);
  const [r] = await rows(sql`update purchase_orders set status = 'Cancelled', updated_at = now() where id = ${id} and status = 'Open' returning *`);
  if (!r) return res.status(400).json({ error: "Only an open order can be cancelled" });
  await audit(req, "UPDATE", "purchase_orders", id, { status: "Open" }, { status: "Cancelled" });
  res.json(r);
});

router.post("/po/:id(\\d+)/receive", requireRole(WRITE), async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id);
  // claim it so a double click cannot receive (and bill) it twice
  const [po] = await rows(sql`update purchase_orders set status = 'Receiving', updated_at = now() where id = ${id} and status = 'Open' and not is_deleted returning *`);
  if (!po) return res.status(400).json({ error: "Only an open order can be received" });
  try {
    const day = isDay(req.body?.date) ? req.body.date : new Date().toISOString().slice(0, 10);
    for (const l of po.lines as any[]) {
      let itemId = l.itemId;
      if (!itemId) {
        const [found] = await rows(sql`select id from stock_items where lower(name) = lower(${l.name}) and not is_deleted limit 1`);
        itemId = found?.id;
        if (!itemId) {
          const n = Number((await rows(sql`select count(*)::int n from stock_items`))[0].n) + 1;
          const [made] = await rows(sql`insert into stock_items (code, name, last_cost, created_by) values (${`ITM-${String(n).padStart(4, "0")}`}, ${l.name}, ${l.rate}, ${req.user?.id ?? null}) returning id`);
          itemId = made.id;
        }
      }
      await db.execute(sql`insert into stock_moves (item_id, move_date, qty, unit_cost, kind, po_id, notes, created_by)
        values (${itemId}, ${`${day}T12:00:00`}::timestamp, ${l.qty}, ${l.rate}, 'in', ${id}, ${`Received on ${po.po_number}`}, ${req.user?.id ?? null})`);
      if (l.rate) await db.execute(sql`update stock_items set last_cost = ${l.rate}, updated_at = now() where id = ${itemId}`);
    }
    let billId: number | null = null;
    if (po.total > 0) {
      const due = new Date(`${day}T12:00:00`);
      due.setDate(due.getDate() + 30);
      const r: any = await createVendorBill("Parts Supplier", po.party_id, po.vendor_name, due, po.total, "5003", `Purchase order ${po.po_number}`, { userId: req.user?.id });
      billId = r?.bill?.id ?? r?.id ?? null;
    }
    const [done] = await rows(sql`update purchase_orders set status = 'Received', bill_id = ${billId}, updated_at = now() where id = ${id} returning *`);
    await audit(req, "UPDATE", "purchase_orders", id, { status: "Open" }, { status: "Received", billId });
    res.json(done);
  } catch (e: any) {
    await db.execute(sql`update purchase_orders set status = 'Open' where id = ${id} and status = 'Receiving'`);
    // the stock moves of a failed receive are taken back so the order can be received again
    await db.execute(sql`update stock_moves set is_deleted = true where po_id = ${id}`);
    res.status(400).json({ error: e.message });
  }
});

export default router;
