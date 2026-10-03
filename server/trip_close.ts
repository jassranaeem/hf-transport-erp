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

// ---------------------------------------------------------------------------------------------
// Which trip a khata row belongs to. A row typed through a trip carries derivedTripId; any other
// row of the truck belongs to the journey whose span holds its date — from the day that journey
// left until the day the truck's NEXT journey left. So a new trip never adds onto the last one.
// ---------------------------------------------------------------------------------------------
export const dayOf = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const ddmmyyyy = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

export interface TripSpan {
  rootId: number;
  tripNumber: string;
  label: string; // "27.09.2026 Quetta → Islamabad"
  fromDay: string; // YYYY-MM-DD, first day counted
  untilDay: string | null; // first day NOT counted (the next trip's day), null = still open
  nextRootId: number | null;
  stopIds: number[];
}

type SpanTrip = { id: number; parent: number | null; legNo: number | null; tripNumber: string; departure: Date | string; origin: string | null; destination: string | null };

/** Group a truck's trips into journeys, oldest first, each with its span. */
export function spansFromTrips(trips: SpanTrip[]): TripSpan[] {
  const byRoot = new Map<number, SpanTrip[]>();
  for (const t of trips) byRoot.set(t.parent || t.id, [...(byRoot.get(t.parent || t.id) || []), t]);
  const list = [...byRoot.entries()].map(([rootId, legs]) => {
    legs.sort((a, b) => (a.legNo || 1) - (b.legNo || 1) || a.id - b.id);
    const first = legs.find((l) => l.id === rootId) || legs[0];
    const start = Math.min(...legs.map((l) => new Date(l.departure).getTime()));
    const fromDay = dayOf(new Date(start))!;
    return {
      rootId,
      tripNumber: first.tripNumber,
      label: `${ddmmyyyy(fromDay)} ${first.origin || "?"} → ${legs[legs.length - 1].destination || "?"}`,
      fromDay,
      untilDay: null as string | null,
      nextRootId: null as number | null,
      stopIds: legs.map((l) => l.id),
      start,
    };
  });
  list.sort((a, b) => a.start - b.start || a.rootId - b.rootId);
  list.forEach((s, i) => {
    const next = list[i + 1];
    if (next) {
      s.untilDay = next.fromDay;
      s.nextRootId = next.rootId;
    }
  });
  return list.map(({ start, ...s }) => s);
}

/** Every journey of one truck (matched by vehicle id or plate), oldest first. */
export async function tripSpansForTruck(vehicleId: number | null | undefined, vehicleNumber: string | null | undefined): Promise<TripSpan[]> {
  const plate = normPlate(vehicleNumber);
  if (!vehicleId && !plate) return [];
  const rows = await db
    .select({
      id: schema.trips.id,
      parent: schema.trips.parentTripId,
      legNo: schema.trips.legNo,
      tripNumber: schema.trips.tripNumber,
      departure: schema.trips.departureTime,
      origin: schema.routes.origin,
      destination: schema.routes.destination,
    })
    .from(schema.trips)
    .leftJoin(schema.vehicles, eq(schema.trips.vehicleId, schema.vehicles.id))
    .leftJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
    .where(
      and(
        eq(schema.trips.isDeleted, false),
        sql`(${vehicleId ? sql`${schema.trips.vehicleId} = ${vehicleId}` : sql`false`} or ${
          plate ? sql`regexp_replace(upper(${schema.vehicles.vehicleNumber}), '[^A-Z0-9]', '', 'g') = ${plate}` : sql`false`
        })`,
      ),
    );
  return spansFromTrips(rows);
}

/** The journey a khata row belongs to, if any. */
export function spanOf(spans: TripSpan[], e: { derivedTripId?: number | null; entryDate?: Date | string | null }): TripSpan | null {
  if (e.derivedTripId) return spans.find((s) => s.stopIds.includes(e.derivedTripId!)) || null;
  const day = dayOf(e.entryDate);
  if (!day) return null;
  return spans.find((s) => s.fromDay <= day && (!s.untilDay || day < s.untilDay)) || null;
}

/** SQL: an (untagged) khata row's date falls inside a journey's span. */
export function inSpan(span: { fromDay: string; untilDay: string | null }, daysBefore = 0) {
  const col = schema.truckLedgerEntries.entryDate;
  return span.untilDay
    ? sql`(${col}::date >= ${span.fromDay}::date - ${daysBefore}::int and ${col}::date < ${span.untilDay}::date)`
    : sql`${col}::date >= ${span.fromDay}::date - ${daysBefore}::int`;
}

/** Everything "Close trip" shows for one journey. */
export async function journeyMoney(rootId: number) {
  const legs = await journeyStops(rootId);
  if (!legs.length) return null;
  const root = legs.find((l) => l.trip.id === rootId)?.trip ?? legs[0].trip;
  const vehicleNumber = legs[0].vehicleNumber || "";
  const stopIds = legs.map((l) => l.trip.id);
  const khataIds = await khataIdsForPlate(vehicleNumber);
  // this journey's days: from the day it left until the truck's next trip left
  const spans = await tripSpansForTruck(root.vehicleId, vehicleNumber);
  const span = spans.find((s) => s.rootId === rootId) || spansFromTrips(legs.map((l) => ({ id: l.trip.id, parent: l.trip.parentTripId, legNo: l.trip.legNo, tripNumber: l.trip.tripNumber, departure: l.trip.departureTime, origin: l.origin, destination: l.destination })))[0];

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
            inSpan(span, 2), // a receipt may be written a day or two before the truck leaves
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
            inSpan(span),
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
    span: { fromDay: span.fromDay, untilDay: span.untilDay, nextRootId: span.nextRootId },
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

/**
 * Take back every bill payment "Close trip" posted for a stop (reference TRIP-<stop>): the
 * payment, its link and journal entry, the bill's paid amount / status and the customer's
 * balance. Payments entered elsewhere (Finance) are not touched. Returns the amount reversed.
 */
export async function undoTripPayments(stopId: number): Promise<number> {
  const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.tripId, stopId), eq(schema.invoices.isDeleted, false))).limit(1);
  if (!inv) return 0;
  const pays = await db
    .select({ id: schema.payments.id, amount: schema.invoicePayments.amount, linkId: schema.invoicePayments.id })
    .from(schema.invoicePayments)
    .innerJoin(schema.payments, eq(schema.invoicePayments.paymentId, schema.payments.id))
    .where(and(eq(schema.invoicePayments.invoiceId, inv.id), eq(schema.payments.referenceNumber, `TRIP-${stopId}`)));
  if (!pays.length) return 0;
  const total = pays.reduce((s, x) => s + (x.amount || 0), 0);
  const jes = await db
    .select({ id: schema.journalEntries.id })
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "Payment"), inArray(schema.journalEntries.sourceId, pays.map((x) => x.id))));
  if (jes.length) {
    await db.delete(schema.journalLines).where(inArray(schema.journalLines.journalEntryId, jes.map((x) => x.id)));
    await db.delete(schema.journalEntries).where(inArray(schema.journalEntries.id, jes.map((x) => x.id)));
  }
  await db.delete(schema.invoicePayments).where(inArray(schema.invoicePayments.id, pays.map((x) => x.linkId)));
  await db.delete(schema.payments).where(inArray(schema.payments.id, pays.map((x) => x.id)));
  const paid = Math.max(0, (inv.paidAmount || 0) - total);
  await db
    .update(schema.invoices)
    .set({ paidAmount: paid, outstandingBalance: Math.max(0, inv.totalAmount - paid), status: paid <= 0 ? "Unpaid" : paid >= inv.totalAmount ? "Paid" : "Partially Paid" })
    .where(eq(schema.invoices.id, inv.id));
  const [c] = await db.select({ bal: schema.contractors.outstandingBalance }).from(schema.contractors).where(eq(schema.contractors.id, inv.contractorId)).limit(1);
  if (c) await db.update(schema.contractors).set({ outstandingBalance: (c.bal || 0) + total }).where(eq(schema.contractors.id, inv.contractorId));
  return total;
}

/** After a receipt changes or goes away: the bill's paid amount follows what is received now. */
export async function resyncStopInvoice(stopId: number, userId?: number) {
  await undoTripPayments(stopId);
  return syncStopInvoice(stopId, userId);
}

/** Reopening a trip: remove a stop's bill (with Close trip's payments and its journal entry). */
export async function deleteStopInvoice(stopId: number): Promise<{ ok: boolean; reason?: string }> {
  const [inv] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.tripId, stopId), eq(schema.invoices.isDeleted, false))).limit(1);
  if (!inv) return { ok: true };
  const other = await db
    .select({ id: schema.payments.id })
    .from(schema.invoicePayments)
    .innerJoin(schema.payments, eq(schema.invoicePayments.paymentId, schema.payments.id))
    .where(and(eq(schema.invoicePayments.invoiceId, inv.id), sql`coalesce(${schema.payments.referenceNumber}, '') <> ${`TRIP-${stopId}`}`));
  if (other.length) return { ok: false, reason: `bill ${inv.invoiceNumber} has payments entered in Finance — remove those there first` };
  await undoTripPayments(stopId);
  const [fresh] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id)).limit(1);
  const jes = await db
    .select({ id: schema.journalEntries.id })
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "Invoice"), eq(schema.journalEntries.sourceId, inv.id)));
  if (jes.length) {
    await db.delete(schema.journalLines).where(inArray(schema.journalLines.journalEntryId, jes.map((x) => x.id)));
    await db.delete(schema.journalEntries).where(inArray(schema.journalEntries.id, jes.map((x) => x.id)));
  }
  await db.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, inv.id));
  await db.delete(schema.invoices).where(eq(schema.invoices.id, inv.id));
  const [c] = await db.select({ bal: schema.contractors.outstandingBalance }).from(schema.contractors).where(eq(schema.contractors.id, inv.contractorId)).limit(1);
  if (c) await db.update(schema.contractors).set({ outstandingBalance: Math.max(0, (c.bal || 0) - (fresh?.outstandingBalance || 0)) }).where(eq(schema.contractors.id, inv.contractorId));
  return { ok: true };
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
