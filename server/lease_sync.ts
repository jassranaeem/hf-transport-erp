/**
 * The lease partner and the Daily Cash Book.
 *
 * A truck bought in instalments (an active lease agreement) is paid for by what its trips earn and by
 * the cash the partner brings. When that cash is typed in the Daily Cash Book against the truck as
 * "Qist received", it must count toward what he still has to pay — as if it had been entered on the
 * lease screen. So the cash entry makes (and keeps in step) the lease's instalment:
 *
 *   cash entry typed / changed / removed  ->  instalment made / changed / taken back  ->  balance rebuilt
 *
 * The truck ledger row ("Qist received") is the cash entry's own linked row (cash_book.ts).
 */
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";

const rowsOf = async (q: any) => ((await db.execute(q)) as any).rows as any[];

/** Balance = opening − truck earnings settled − instalments paid. Also opens / closes the agreement. */
export async function recalcLeaseBalance(id: number, userId?: number) {
  const [ag] = await db.select().from(schema.partnerAgreements).where(eq(schema.partnerAgreements.id, id)).limit(1);
  if (!ag) return null;
  const [t] = await rowsOf(sql`select
      (select coalesce(sum(amount_to_company), 0) from partner_settlements where agreement_id = ${id} and not is_deleted)::int settled,
      (select coalesce(sum(amount), 0) from partner_installments where agreement_id = ${id} and not is_deleted)::int paid`);
  const currentBalance = Math.max(0, ag.openingBalance - Number(t.settled) - Number(t.paid));
  await db
    .update(schema.partnerAgreements)
    .set({
      currentBalance,
      status: currentBalance <= 0 ? "Settled" : ag.status === "Settled" ? "Active" : ag.status,
      closeDate: currentBalance <= 0 ? ag.closeDate || new Date() : null,
      updatedAt: new Date(),
      updatedBy: userId,
    })
    .where(eq(schema.partnerAgreements.id, id));
  return { currentBalance, settled: Number(t.settled), paid: Number(t.paid) };
}

/** The lease still being paid for this truck, if any. */
export async function activeLeaseOfVehicle(vehicleId: number | null | undefined) {
  if (!vehicleId) return null;
  const [a] = await rowsOf(sql`select id, agreement_number, current_balance from partner_agreements
    where vehicle_id = ${vehicleId} and not is_deleted and status = 'Active' order by id desc limit 1`);
  return a ? { id: Number(a.id), number: String(a.agreement_number), balance: Number(a.current_balance) } : null;
}

type CashRow = typeof schema.cashTransactions.$inferSelect;

/** Is this cash row a "Qist received" typed against a truck? Reads the truck-ledger row it made. */
async function isQistReceipt(row: CashRow): Promise<boolean> {
  if (row.isDeleted || row.linkType !== "truck" || !row.linkTargetId || row.direction !== "In" || !row.derivedEntryId) return false;
  const [e] = await rowsOf(sql`select category from truck_ledger_entries where id = ${row.derivedEntryId} and not is_deleted`);
  return e?.category === "Qist";
}

/** How much of the lease a new Qist receipt may be (what is still owed, plus what this entry already counts). */
export async function leaseRoomForCash(vehicleId: number, cashId: number | null) {
  const lease = await activeLeaseOfVehicle(vehicleId);
  if (!lease) return null;
  let back = 0;
  if (cashId) {
    const [i] = await rowsOf(sql`select coalesce(sum(amount), 0)::int v from partner_installments where cash_transaction_id = ${cashId} and agreement_id = ${lease.id} and not is_deleted`);
    back = Number(i?.v || 0);
  }
  return { ...lease, room: lease.balance + back };
}

/**
 * Keep the lease's instalment in step with a Daily Cash Book entry (call after it is made, changed or removed).
 * Returns the lease it counts toward, or null.
 */
export async function syncLeaseFromCash(row: CashRow, userId?: number): Promise<{ number: string; balance: number } | null> {
  const [existing] = await rowsOf(sql`select id, agreement_id from partner_installments where cash_transaction_id = ${row.id} and not is_deleted order by id limit 1`);
  const lease = (await isQistReceipt(row)) ? await activeLeaseOfVehicle(row.linkTargetId) : null;

  // not (or no longer) a Qist on a lease truck: the instalment it made goes
  if (!lease) {
    if (existing) {
      await db.execute(sql`update partner_installments set is_deleted = true where id = ${existing.id}`);
      await recalcLeaseBalance(Number(existing.agreement_id), userId);
    }
    return null;
  }

  const day = row.entryDate.toISOString().slice(0, 10);
  const what = `From the Daily Cash Book${row.description ? ` — ${row.description}` : ""}`.slice(0, 300);
  if (existing && Number(existing.agreement_id) === lease.id) {
    await db.execute(sql`update partner_installments set amount = ${row.amount}, pay_date = ${`${day}T12:00:00`}::timestamp, khata_entry_id = ${row.derivedEntryId} where id = ${existing.id}`);
  } else {
    if (existing) {
      await db.execute(sql`update partner_installments set is_deleted = true where id = ${existing.id}`);
      await recalcLeaseBalance(Number(existing.agreement_id), userId);
    }
    await db.execute(sql`insert into partner_installments (agreement_id, pay_date, amount, method, notes, cash_transaction_id, khata_entry_id, created_by)
      values (${lease.id}, ${`${day}T12:00:00`}::timestamp, ${row.amount}, 'Cash', ${what}, ${row.id}, ${row.derivedEntryId}, ${userId ?? null})`);
  }
  const bal = await recalcLeaseBalance(lease.id, userId);
  return { number: lease.number, balance: bal?.currentBalance ?? lease.balance };
}

/** For the day's rows: where else each truck / party entry shows (the lease, the partnership). */
export async function alsoInFor(rows: Array<{ id: number; linkType: string | null; linkTargetId: number | null; resolvedLedgerId?: number | null }>) {
  const out = new Map<number, string[]>();
  const truckIds = [...new Set(rows.filter((r) => r.linkType === "truck" && r.linkTargetId).map((r) => r.linkTargetId as number))];
  const ledgerIds = [...new Set(rows.map((r) => r.resolvedLedgerId).filter((x): x is number => !!x))];
  const partyIds = [...new Set(rows.filter((r) => r.linkType === "party" && r.linkTargetId).map((r) => r.linkTargetId as number))];
  const leases = truckIds.length
    ? await rowsOf(sql`select vehicle_id, agreement_number from partner_agreements where not is_deleted and status = 'Active' and vehicle_id = any(${`{${truckIds.join(",")}}`}::int[])`)
    : [];
  const pships = ledgerIds.length
    ? await rowsOf(sql`select truck_ledger_id from partnership_accounts where not is_deleted and truck_ledger_id = any(${`{${ledgerIds.join(",")}}`}::int[])`)
    : [];
  const partyShips = partyIds.length
    ? await rowsOf(sql`select pa.partner_party_id, pa.hfk_party_id, l.registration from partnership_accounts pa join truck_ledgers l on l.id = pa.truck_ledger_id
        where not pa.is_deleted and (pa.partner_party_id = any(${`{${partyIds.join(",")}}`}::int[]) or pa.hfk_party_id = any(${`{${partyIds.join(",")}}`}::int[]))`)
    : [];
  for (const r of rows) {
    const tags: string[] = [];
    if (r.linkType === "truck" && r.linkTargetId) {
      const l = leases.find((x) => Number(x.vehicle_id) === r.linkTargetId);
      if (l) tags.push(`Lease ${l.agreement_number}`);
      if (r.resolvedLedgerId && pships.some((p) => Number(p.truck_ledger_id) === r.resolvedLedgerId)) tags.push("Partner P&L");
    } else if (r.linkType === "party" && r.linkTargetId) {
      const p = partyShips.find((x) => Number(x.partner_party_id) === r.linkTargetId || Number(x.hfk_party_id) === r.linkTargetId);
      if (p) tags.push(`Partner P&L party · ${p.registration}`);
    }
    if (tags.length) out.set(r.id, tags);
  }
  return out;
}
