/**
 * "Close trip" (Fleet Desk) — the money side of one journey (all its stops), option C:
 *
 *   - every stop's freight is billed to its customer; what has actually come in for it is the
 *     kiraya rows in the truck's khata tagged to that stop (derivedTripId) — received through the
 *     Daily Cash Book ("Kirya jama", linked to the truck) or "Mark received" on the trip;
 *   - a stop is green when received + written off covers its freight, red while money is pending;
 *   - the result is split 50/50 (partnership trucks) only when every stop is green, by closing the
 *     Partner P&L cycle — the paper's صافی بچت, on money actually received.
 *
 * Data helpers only; the routes live in trip_desk.ts. (No import of partnership.ts here, so that
 * partnership.ts can use pendingTripsForPlate without a circular import.)
 */
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { postInvoicePayment } from "./finance_engine.ts";

export const normPlate = (s: string | null | undefined) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The khatas this truck's trip money lives in: its partnership khata, else its app-made khatas. */
export async function khataIdsForPlate(vehicleNumber: string): Promise<number[]> {
  const plate = normPlate(vehicleNumber);
  if (!plate) return [];
  const samePlate = sql`regexp_replace(upper(${schema.truckLedgers.registration}), '[^A-Z0-9]', '', 'g') = ${plate}`;
  const shared = await db
    .select({ id: schema.truckLedgers.id })
    .from(schema.partnershipAccounts)
    .innerJoin(schema.truckLedgers, eq(schema.partnershipAccounts.truckLedgerId, schema.truckLedgers.id))
    .where(and(eq(schema.partnershipAccounts.isDeleted, false), eq(schema.truckLedgers.isDeleted, false), samePlate));
  const manual = await db
    .select({ id: schema.truckLedgers.id })
    .from(schema.truckLedgers)
    .where(and(eq(schema.truckLedgers.isDeleted, false), isNull(schema.truckLedgers.sourceSheet), samePlate));
  return [...new Set([...shared.map((x) => x.id), ...manual.map((x) => x.id)])];
}

export async function rootOf(tripId: number): Promise<number | null> {
  const [t] = await db.select({ id: schema.trips.id, parent: schema.trips.parentTripId }).from(schema.trips).where(eq(schema.trips.id, tripId)).limit(1);
  return t ? t.parent || t.id : null;
}

/** A journey's stops, first leg first, with route, customer and truck. */
export async function journeyStops(rootId: number) {
  return db
    .select({
      trip: schema.trips,
      origin: schema.routes.origin,
      destination: schema.routes.destination,
      customer: schema.contractors.company,
      vehicleNumber: schema.vehicles.vehicleNumber,
    })
    .from(schema.trips)
    .leftJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
    .leftJoin(schema.contractors, eq(schema.trips.contractorId, schema.contractors.id))
    .leftJoin(schema.vehicles, eq(schema.trips.vehicleId, schema.vehicles.id))
    .where(and(eq(schema.trips.isDeleted, false), sql`(${schema.trips.id} = ${rootId} or ${schema.trips.parentTripId} = ${rootId})`))
    .orderBy(asc(schema.trips.legNo), asc(schema.trips.id));
}

/** Everything "Close trip" shows for one journey. */
export async function journeyMoney(rootId: number) {
  const legs = await journeyStops(rootId);
  if (!legs.length) return null;
  const root = legs.find((l) => l.trip.id === rootId)?.trip ?? legs[0].trip;
  const vehicleNumber = legs[0].vehicleNumber || "";
  const stopIds = legs.map((l) => l.trip.id);
  const khataIds = await khataIdsForPlate(vehicleNumber);
  const since = new Date(Math.min(...legs.map((l) => new Date(l.trip.departureTime).getTime())) - 2 * 24 * 3600_000);

  // money rows tagged to the stops (receipts in, trip cash / diesel out)
  const tagged = await db
    .select({
      id: schema.truckLedgerEntries.id,
      tripId: schema.truckLedgerEntries.derivedTripId,
      entryDate: schema.truckLedgerEntries.entryDate,
      description: schema.truckLedgerEntries.description,
      received: schema.truckLedgerEntries.received,
      paid: schema.truckLedgerEntries.paid,
    })
    .from(schema.truckLedgerEntries)
    .where(and(eq(schema.truckLedgerEntries.isDeleted, false), inArray(schema.truckLedgerEntries.derivedTripId, stopIds)));

  // kiraya received into the truck's khata since the trip began but not yet tied to a stop —
  // e.g. a "Kirya jama" Cash Book entry linked to the truck: "is this Sardar Wali's?"
  const unassigned = khataIds.length
    ? await db
        .select({
          id: schema.truckLedgerEntries.id,
          entryDate: schema.truckLedgerEntries.entryDate,
          rawDate: schema.truckLedgerEntries.rawDate,
          description: schema.truckLedgerEntries.description,
          received: schema.truckLedgerEntries.received,
        })
        .from(schema.truckLedgerEntries)
        .where(
          and(
            eq(schema.truckLedgerEntries.isDeleted, false),
            inArray(schema.truckLedgerEntries.ledgerId, khataIds),
            isNull(schema.truckLedgerEntries.derivedTripId),
            sql`${schema.truckLedgerEntries.received} > 0`,
            sql`${schema.truckLedgerEntries.category} <> 'SafiBachat'`,
            gte(schema.truckLedgerEntries.entryDate, since),
          ),
        )
        .orderBy(desc(schema.truckLedgerEntries.entryDate))
        .limit(40)
    : [];

  // other money out of the truck's khata since the trip began (the paper counts it in the result)
  const [other] = khataIds.length
    ? await db
        .select({ paid: sql<number>`coalesce(sum(${schema.truckLedgerEntries.paid}),0)::bigint` })
        .from(schema.truckLedgerEntries)
        .where(
          and(
            eq(schema.truckLedgerEntries.isDeleted, false),
            inArray(schema.truckLedgerEntries.ledgerId, khataIds),
            isNull(schema.truckLedgerEntries.derivedTripId),
            gte(schema.truckLedgerEntries.entryDate, since),
          ),
        )
    : [{ paid: 0 }];

  const invoices = await db
    .select({ id: schema.invoices.id, tripId: schema.invoices.tripId, number: schema.invoices.invoiceNumber, total: schema.invoices.totalAmount, paid: schema.invoices.paidAmount, status: schema.invoices.status })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.isDeleted, false), inArray(schema.invoices.tripId, stopIds)));

  const stops = legs.map((l) => {
    const receipts = tagged.filter((x) => x.tripId === l.trip.id && (x.received || 0) > 0);
    const received = receipts.reduce((s, x) => s + (x.received || 0), 0);
    const freight = l.trip.revenue || 0;
    const writtenOff = l.trip.freightWrittenOff || 0;
    const pending = Math.max(0, freight - received - writtenOff);
    return {
      id: l.trip.id,
      legNo: l.trip.legNo,
      tripNumber: l.trip.tripNumber,
      status: l.trip.status,
      from: l.origin,
      to: l.destination,
      customer: l.customer,
      cargo: l.trip.cargo,
      freight,
      received,
      writtenOff,
      pending,
      state: freight <= 0 || pending === 0 ? "paid" : received > 0 || writtenOff > 0 ? "partial" : "pending",
      receipts: receipts.map((x) => ({ id: x.id, date: x.entryDate, description: x.description, amount: x.received })),
      invoice: invoices.find((i) => i.tripId === l.trip.id) ?? null,
    };
  });

  const tripPaid = tagged.reduce((s, x) => s + (x.paid || 0), 0);
  const otherPaid = Number(other?.paid || 0);
  const freight = stops.reduce((s, x) => s + x.freight, 0);
  const received = stops.reduce((s, x) => s + x.received, 0);
  const writtenOff = stops.reduce((s, x) => s + x.writtenOff, 0);
  const pending = stops.reduce((s, x) => s + x.pending, 0);
  const expenses = tripPaid + otherPaid;
  return {
    rootId,
    vehicleId: root.vehicleId,
    vehicleNumber,
    route: [legs[0].origin, ...legs.map((l) => l.destination)].filter(Boolean).join(" → "),
    closedAt: root.closedAt,
    splitAt: root.splitAt,
    splitAmount: root.splitAmount,
    splitAccountId: root.splitAccountId,
    allCompleted: legs.every((l) => l.trip.status === "Completed"),
    stops,
    unassigned,
    totals: {
      freight,
      received,
      writtenOff,
      pending,
      tripPaid,
      otherPaid,
      expenses,
      expectedProfit: freight - writtenOff - expenses, // if everything pending comes in
      profitSoFar: received - expenses, // on money actually received
    },
    allPaid: pending === 0,
  };
}

/** Bring a stop's bill up to what has actually been received for it (records the payment). */
export async function syncStopInvoice(stopId: number, userId?: number) {
  const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.tripId, stopId), eq(schema.invoices.isDeleted, false))).limit(1);
  if (!inv) return null; // no bill yet (the trip isn't completed) — synced when it is
  const [r] = await db
    .select({ rec: sql<number>`coalesce(sum(${schema.truckLedgerEntries.received}),0)::bigint` })
    .from(schema.truckLedgerEntries)
    .where(and(eq(schema.truckLedgerEntries.isDeleted, false), eq(schema.truckLedgerEntries.derivedTripId, stopId)));
  const target = Math.min(Number(r?.rec || 0), inv.totalAmount);
  const delta = target - (inv.paidAmount || 0);
  if (delta <= 0) return inv;
  try {
    await postInvoicePayment(inv.id, "Cash", delta, null, `TRIP-${stopId}`, "Kiraya received (Close trip)", { userId });
  } catch (e: any) {
    console.warn(`[trip-close] invoice ${inv.invoiceNumber} payment not posted:`, e?.message);
  }
  return inv;
}

/** Closed journeys of this truck still waiting for money (shown in Partner P&L). */
export async function pendingTripsForPlate(vehicleNumber: string) {
  const plate = normPlate(vehicleNumber);
  if (!plate) return [];
  const roots = await db
    .select({ id: schema.trips.id })
    .from(schema.trips)
    .innerJoin(schema.vehicles, eq(schema.trips.vehicleId, schema.vehicles.id))
    .where(
      and(
        eq(schema.trips.isDeleted, false),
        isNull(schema.trips.parentTripId),
        isNull(schema.trips.splitAt),
        sql`${schema.trips.closedAt} is not null`,
        sql`regexp_replace(upper(${schema.vehicles.vehicleNumber}), '[^A-Z0-9]', '', 'g') = ${plate}`,
      ),
    )
    .orderBy(desc(schema.trips.closedAt))
    .limit(10);
  const out = [];
  for (const r of roots) {
    const m = await journeyMoney(r.id);
    if (m) out.push({ rootId: m.rootId, route: m.route, pending: m.totals.pending, allPaid: m.allPaid, stops: m.stops.map((s) => ({ customer: s.customer, pending: s.pending, state: s.state })) });
  }
  return out;
}
