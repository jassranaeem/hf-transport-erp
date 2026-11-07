/**
 * Where a ledger entry came from — so a click on any row of a truck khata or a party ledger can show
 * the whole entry and go to the place it was made.
 *
 *   GET /api/entry-origin/tle/:id    a truck-khata row
 *   GET /api/entry-origin/ple/:id    a party-ledger row
 *
 * → { entry, origin: { kind, title, detail, link? }, related: [...], history: [...] }
 *   kind: trip | cash_book | ai | partnership | profit_share | opening | import | manual
 *   link: { wb, sheet, focus } — the screen (and the record) to open
 */
import { Router, Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth, requireApproved, requireRole, AuthRequest } from "../src/middleware/auth.ts";
import { db } from "../src/db/index.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const READ = ["Super Admin", "Admin", "Operations Manager", "Fleet Manager", "Dispatcher", "Finance Manager", "Accountant", "Auditor"];
const rows = async (q: any) => ((await db.execute(q)) as any).rows as any[];
// the day as the Cash Book counts it (server-local midnight, like its /day)
const localDay = (v: any) => {
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dmy = (d: any) => (d ? new Date(d).toISOString().slice(0, 10).split("-").reverse().join(".") : "");

type Link = { wb: string; sheet: string; focus?: Record<string, any> };
type Origin = { kind: string; title: string; detail?: string; link?: Link };

router.get("/:kind(tle|ple)/:id(\\d+)", requireRole(READ), async (req: AuthRequest, res: Response) => {
  try {
    const kind = req.params.kind;
    const id = parseInt(req.params.id);
    const table = kind === "tle" ? "truck_ledger_entries" : "party_ledger_entries";
    const [e] =
      kind === "tle"
        ? await rows(sql`select e.*, l.registration, l.title ledger_title, l.source_sheet ledger_sheet, u.name created_by_name, u.email created_by_email
            from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id left join users u on u.id = e.created_by where e.id = ${id}`)
        : await rows(sql`select e.*, p.name party_name, u.name created_by_name, u.email created_by_email
            from party_ledger_entries e join parties p on p.id = e.party_id left join users u on u.id = e.created_by where e.id = ${id}`);
    if (!e) return res.status(404).json({ error: "Entry not found" });

    const origins: Origin[] = [];
    const related: Array<{ title: string; detail: string; link?: Link }> = [];
    const who = e.created_by_name || e.created_by_email || null;

    // typed through a trip (Fleet Desk money given / trip created with cash or diesel)
    if (kind === "tle" && e.derived_trip_id) {
      const [t] = await rows(sql`select t.id, coalesce(t.parent_trip_id, t.id) root, t.trip_number, t.departure_time, r.origin, r.destination, v.vehicle_number, d.driver_name
        from trips t left join routes r on r.id = t.route_id left join vehicles v on v.id = t.vehicle_id left join drivers d on d.id = t.driver_id where t.id = ${e.derived_trip_id}`);
      if (t)
        origins.push({
          kind: "trip",
          title: `Trip ${t.trip_number} · ٹرپ`,
          detail: `${dmy(t.departure_time)} · ${t.origin || "?"} → ${t.destination || "?"} · ${t.vehicle_number || ""}${t.driver_name ? ` · driver ${t.driver_name}` : ""}`,
          link: { wb: "fleet", sheet: "fleet_desk", focus: { tripId: t.root } },
        });
    }
    // the daily cash book (an entry there linked to this truck / party writes this row)
    const [ct] = await rows(sql`select id, entry_date, direction, amount, description, person from cash_transactions
      where derived_entry_id = ${id} and link_type = ${kind === "tle" ? "truck" : "party"} and not is_deleted order by id limit 1`);
    if (ct)
      origins.push({
        kind: "cash_book",
        title: "Daily Cash Book · کیش بک",
        detail: `${dmy(ct.entry_date)} · cash ${ct.direction === "In" ? "in" : "out"} PKR ${Number(ct.amount).toLocaleString()}${ct.person ? ` · ${ct.person}` : ""}`,
        link: { wb: "finance", sheet: "cash_book", focus: { date: localDay(ct.entry_date) } },
      });
    // read and posted by the AI Accountant (approved by a person)
    const [ai] = await rows(sql`select d.id, d.source, d.source_name, d.decided_at, u.name approver from ai_drafts d left join users u on u.id = d.decided_by
      where d.status = 'posted' and (
        (d.posted ->> 'table' = ${table} and (d.posted ->> 'id')::int = ${id})
        or (d.posted ->> 'derived')::int = ${id} and ${kind === "tle"})
      order by d.id desc limit 1`).catch(() => []);
    if (ai)
      origins.push({
        kind: "ai",
        title: "AI Accountant · اے آئی منشی",
        detail: `read from ${ai.source}${ai.source_name ? ` (${ai.source_name})` : ""}, approved ${ai.decided_at ? dmy(ai.decided_at) : ""}${ai.approver ? ` by ${ai.approver}` : ""}`,
        link: { wb: "accounting", sheet: "ai_accountant" },
      });
    // a partnership cycle / Partner P&L share written onto the partner's ledger
    if (kind === "ple" && /^PSHIP-\d+$/.test(e.ref_no || "")) {
      const acc = Number(String(e.ref_no).split("-")[1]);
      const [pa] = await rows(sql`select l.registration from partnership_accounts a join truck_ledgers l on l.id = a.truck_ledger_id where a.id = ${acc}`);
      origins.push({
        kind: "partnership",
        title: "Partner P&L · پارٹنرشپ",
        detail: `${e.section_label || "Partnership"}${pa ? ` · truck ${pa.registration}` : ""}`,
        link: { wb: "finance", sheet: "partner_pnl" },
      });
    } else if (kind === "ple" && e.section_label === "Profit share") {
      origins.push({ kind: "profit_share", title: "Partner P&L — profit share · منافع کا حصہ", detail: e.description || "", link: { wb: "finance", sheet: "partner_pnl" } });
    }
    // the khata's opening balance
    if (kind === "tle" && e.method === "Opening")
      origins.push({ kind: "opening", title: "Opening balance · ابتدائی بیلنس", detail: "set on the khata (pencil on the Opening balance box)" });
    // imported from an Excel workbook
    const sheet = kind === "tle" ? e.ledger_sheet || (e.source_row != null ? e.section_label : null) : e.source_row != null ? e.section_label : null;
    if (!origins.length && (e.source_row != null || (kind === "tle" && e.ledger_sheet)))
      origins.push({
        kind: "import",
        title: "Imported from Excel · ایکسل سے",
        detail: `${sheet ? `sheet "${sheet}"` : "workbook"}${e.source_row != null ? `, row ${e.source_row}` : ""}${e.sr_no != null ? ` · Sr# ${e.sr_no}` : ""}`,
      });
    if (!origins.length)
      origins.push({
        kind: "manual",
        title: kind === "tle" ? "Typed in Truck Ledgers · ہاتھ سے درج" : "Typed in Party Ledgers · ہاتھ سے درج",
        detail: who ? `by ${who}` : undefined,
      });

    // money paid out of the driver's cash, and the cash it came out of
    if (kind === "tle" && e.paid_from_entry_id) {
      const [c] = await rows(sql`select id, entry_date, paid, description from truck_ledger_entries where id = ${e.paid_from_entry_id}`);
      if (c) related.push({ title: "Paid out of the driver's cash · ڈرائیور کی نقد میں سے", detail: `${dmy(c.entry_date)} · ${c.description || "Trip cash"}` });
    }
    if (kind === "tle") {
      const spent = await rows(sql`select id, paid, category, description from truck_ledger_entries where paid_from_entry_id = ${id} and not is_deleted order by id`);
      if (spent.length)
        related.push({
          title: "Spent out of this cash · اس نقد میں سے خرچ",
          detail: spent.map((s) => `${s.category} PKR ${Number(s.paid).toLocaleString()}${s.description ? ` (${s.description})` : ""}`).join(" · "),
        });
    }

    // who made it and every change since
    const history = await rows(sql`select a.action, a.created_at, a.old_values, a.new_values, coalesce(u.name, u.email) who
      from audit_logs a left join users u on u.id = a.performed_by where a.table_name = ${table} and a.record_id = ${id} order by a.created_at, a.id limit 50`).catch(() => []);
    const changes = history.map((h) => {
      const o = h.old_values || {};
      const n = h.new_values || {};
      const keys = ["entryDate", "received", "paid", "debit", "credit", "category", "description", "method", "refNo", "isDeleted"];
      const diff = h.action === "UPDATE" ? keys.filter((k) => n[k] !== undefined && JSON.stringify(o[k]) !== JSON.stringify(n[k])).map((k) => `${k}: ${o[k] ?? "—"} → ${n[k]}`) : [];
      return { action: h.action, at: h.created_at, who: h.who, what: diff.join(" · ") || (n.note ? String(n.note) : n.by ? String(n.by) : "") };
    });

    res.json({
      entry: {
        id: e.id,
        date: e.entry_date,
        rawDate: e.raw_date,
        description: e.description,
        category: e.category,
        method: e.method,
        received: kind === "tle" ? e.received : undefined,
        paid: kind === "tle" ? e.paid : undefined,
        debit: kind === "ple" ? e.debit : undefined,
        credit: kind === "ple" ? e.credit : undefined,
        refNo: e.ref_no,
        partyFrom: e.party_from,
        partyTo: e.party_to,
        route: e.route_from || e.route_to ? `${e.route_from || "?"} → ${e.route_to || "?"}` : null,
        cargo: e.cargo,
        section: e.section_label,
        srNo: e.sr_no,
        sheetBalance: e.sheet_balance,
        ledger: kind === "tle" ? e.registration : e.party_name,
        createdAt: e.created_at,
        createdBy: who,
        updatedAt: e.updated_at,
        isDeleted: e.is_deleted,
      },
      origin: origins[0],
      alsoFrom: origins.slice(1),
      related,
      history: changes,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.cause?.message || err.message });
  }
});

export default router;
