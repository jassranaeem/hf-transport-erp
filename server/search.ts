/**
 * One search box for the whole app (Ctrl+K) · ہر جگہ تلاش — trucks, khatas, parties, customers,
 * drivers, staff, trips, invoices, quotations, bills and cash-book lines, each with where it opens.
 *
 *   GET /api/search?q=
 */
import { Router, Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth, requireApproved, AuthRequest } from "../src/middleware/auth.ts";
import { db } from "../src/db/index.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const rows = async (q: any) => ((await db.execute(q)) as any).rows as any[];

const FINANCE = ["Super Admin", "Admin", "Finance Manager", "Accountant", "Auditor", "Operations Manager"];

router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const raw = String(req.query.q || "").trim().slice(0, 60);
    if (raw.length < 2) return res.json({ results: [] });
    const like = `%${raw.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    // a plate typed as "tlg704" should find "TLG-704" / "TLG 704"
    const squash = `%${raw.replace(/[^a-z0-9]/gi, "").toLowerCase()}%`;
    const num = /^\d[\d,]*$/.test(raw) ? Number(raw.replace(/,/g, "")) : null;
    const fin = FINANCE.includes(req.user?.role || "");
    const out: any[] = [];
    const add = (group: string, list: any[], map: (r: any) => any) => list.forEach((r) => out.push({ group, ...map(r) }));

    const [trucks, khatas, parties, drivers, trips] = await Promise.all([
      rows(sql`select id, vehicle_number, truck_brand, model from vehicles where not is_deleted and (vehicle_number ilike ${like} or regexp_replace(lower(vehicle_number), '[^a-z0-9]', '', 'g') like ${squash}) order by vehicle_number limit 6`),
      fin ? rows(sql`select id, registration, title, owner_name, closing_balance from truck_ledgers where not is_deleted and (registration ilike ${like} or title ilike ${like} or owner_name ilike ${like} or regexp_replace(lower(registration), '[^a-z0-9]', '', 'g') like ${squash}) order by registration limit 6`) : [],
      fin ? rows(sql`select id, name, party_code, type, phone, closing_balance from parties where not is_deleted and (name ilike ${like} or party_code ilike ${like} or phone ilike ${like}) order by name limit 8`) : [],
      rows(sql`select id, driver_name, mobile, cnic from drivers where not is_deleted and (driver_name ilike ${like} or mobile ilike ${like} or cnic ilike ${like}) order by driver_name limit 6`),
      rows(sql`select t.id, t.trip_number, r.origin, r.destination, t.status, v.vehicle_number from trips t left join vehicles v on v.id = t.vehicle_id left join routes r on r.id = t.route_id
        where not t.is_deleted and (t.trip_number ilike ${like} or r.origin ilike ${like} or r.destination ilike ${like} or v.vehicle_number ilike ${like}) order by t.id desc limit 6`),
    ]);
    add("Trucks", trucks, (r) => ({ title: r.vehicle_number, sub: [r.truck_brand, r.model].filter(Boolean).join(" "), wb: "fleet", sheet: "compliance", focus: { q: r.vehicle_number } }));
    add("Truck khata", khatas, (r) => ({ title: r.registration, sub: `${r.title || ""} · balance ${Number(r.closing_balance || 0).toLocaleString()}`, wb: "khata", sheet: "truck_ledgers", focus: { ledgerId: r.id } }));
    add("Parties", parties, (r) => ({ title: r.name, sub: `${r.party_code} · ${r.type}${r.phone ? " · " + r.phone : ""} · ${Number(r.closing_balance || 0).toLocaleString()}`, wb: "khata", sheet: "parties", focus: { partyId: r.id } }));
    add("Drivers", drivers, (r) => ({ title: r.driver_name, sub: [r.mobile, r.cnic].filter(Boolean).join(" · "), wb: "fleet", sheet: "fleet_desk", focus: { tab: "drivers", q: r.driver_name } }));
    add("Trips", trips, (r) => ({ title: `${r.trip_number} · ${r.vehicle_number || ""}`, sub: `${r.origin || ""} → ${r.destination || ""} · ${r.status || ""}`, wb: "fleet", sheet: "fleet_desk", focus: { tripId: r.id } }));

    if (fin) {
      const [invoices, quotes, bills, customers, cash, staff] = await Promise.all([
        rows(sql`select i.id, i.invoice_number, i.total_amount, i.outstanding_balance, c.company from invoices i left join contractors c on c.id = i.contractor_id
          where not i.is_deleted and (i.invoice_number ilike ${like} or i.bilty_number ilike ${like} or i.container_no ilike ${like} or c.company ilike ${like} ${num ? sql`or i.total_amount = ${num}` : sql``}) order by i.id desc limit 6`),
        rows(sql`select id, quotation_number, client_company, status from quotations where not is_deleted and (quotation_number ilike ${like} or client_company ilike ${like}) order by id desc limit 4`).catch(() => []),
        rows(sql`select id, bill_number, vendor_name, amount, outstanding_balance from bills where not is_deleted and (bill_number ilike ${like} or vendor_name ilike ${like} ${num ? sql`or amount = ${num}` : sql``}) order by id desc limit 4`),
        rows(sql`select id, company, phone, outstanding_balance from contractors where not is_deleted and (company ilike ${like} or phone ilike ${like} or contact_person ilike ${like}) order by company limit 5`),
        num
          ? rows(sql`select id, to_char(entry_date, 'YYYY-MM-DD') d, direction, amount, person, description from cash_transactions where not is_deleted and amount = ${num} order by entry_date desc limit 6`)
          : rows(sql`select id, to_char(entry_date, 'YYYY-MM-DD') d, direction, amount, person, description from cash_transactions where not is_deleted and (person ilike ${like} or description ilike ${like}) order by entry_date desc limit 6`),
        rows(sql`select id, full_name, employee_code from employees where not is_deleted and (full_name ilike ${like} or employee_code ilike ${like}) order by full_name limit 4`).catch(() => []),
      ]);
      add("Invoices", invoices, (r) => ({ title: r.invoice_number, sub: `${r.company || ""} · ${Number(r.total_amount).toLocaleString()}${r.outstanding_balance > 0 ? ` · due ${Number(r.outstanding_balance).toLocaleString()}` : " · paid"}`, wb: "finance", sheet: "invoices", focus: { invoiceId: r.id } }));
      add("Customers", customers, (r) => ({ title: r.company, sub: `${r.phone || ""}${r.outstanding_balance ? ` · owes ${Number(r.outstanding_balance).toLocaleString()}` : ""}`, wb: "finance", sheet: "invoices", focus: { q: r.company } }));
      add("Quotations", quotes, (r) => ({ title: r.quotation_number, sub: `${r.client_company || ""} · ${r.status || ""}`, wb: "finance", sheet: "quotations" }));
      add("Bills", bills, (r) => ({ title: r.bill_number, sub: `${r.vendor_name} · ${Number(r.amount).toLocaleString()}`, wb: "finance", sheet: "bills_payments_expenses" }));
      add("Cash book", cash, (r) => ({ title: `${r.direction} ${Number(r.amount).toLocaleString()} · ${r.d}`, sub: [r.person, r.description].filter(Boolean).join(" — "), wb: "finance", sheet: "cash_book", focus: { date: r.d } }));
      add("Staff", staff, (r) => ({ title: r.full_name, sub: r.employee_code, wb: "hr", sheet: "employees" }));
    }
    res.json({ results: out.slice(0, 60) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
