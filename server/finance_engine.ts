import { db, schema } from "../src/db/index.ts";
import { eq, and, isNull, sql } from "drizzle-orm";
import { logAudit } from "../src/db/audit.ts";
import { SocketServer } from "../src/sockets/socket.ts";
import { notifyDriverOfInvoice } from "./sms.ts";

export interface PostingContext {
  userId?: number;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Helper to get active fiscal year and accounting period
 */
export async function getActivePeriod() {
  const [fy] = await db
    .select()
    .from(schema.fiscalYears)
    .where(eq(schema.fiscalYears.status, "Open"))
    .limit(1);

  if (!fy) return { fiscalYearId: null, accountingPeriodId: null };

  const [ap] = await db
    .select()
    .from(schema.accountingPeriods)
    .where(and(eq(schema.accountingPeriods.fiscalYearId, fy.id), eq(schema.accountingPeriods.status, "Open")))
    .limit(1);

  return {
    fiscalYearId: fy.id,
    accountingPeriodId: ap ? ap.id : null,
  };
}

/**
 * Creates a balanced, double-entry Journal Entry with lines.
 * It strictly checks if debits equal credits before writing to PostgreSQL.
 */
export async function createBalancedJournalEntry(
  entryNumber: string,
  description: string,
  sourceType: "Invoice" | "Payment" | "Bill" | "Expense" | "Manual" | "Closing",
  sourceId: number | null,
  lines: Array<{
    accountId: number;
    description?: string;
    debit: number;
    credit: number;
  }>,
  ctx: PostingContext = {}
) {
  const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);

  if (totalDebit !== totalCredit) {
    throw new Error(
      `Double-Entry Validation Failed: Total Debits (PKR ${totalDebit}) must equal Total Credits (PKR ${totalCredit})`
    );
  }

  const { fiscalYearId, accountingPeriodId } = await getActivePeriod();

  // Create Journal Entry
  const [je] = await db
    .insert(schema.journalEntries)
    .values({
      entryNumber,
      entryDate: new Date(),
      description,
      sourceType,
      sourceId,
      fiscalYearId,
      accountingPeriodId,
      createdBy: ctx.userId,
    })
    .returning();

  // Create Journal Lines
  const insertedLines = [];
  for (const line of lines) {
    const [jl] = await db
      .insert(schema.journalLines)
      .values({
        journalEntryId: je.id,
        accountId: line.accountId,
        description: line.description || description,
        debit: line.debit,
        credit: line.credit,
        createdBy: ctx.userId,
      })
      .returning();
    insertedLines.push(jl);
  }

  // standard auditing log
  await logAudit({
    action: "CREATE",
    tableName: "journal_entries",
    recordId: je.id,
    newValues: { je, lines: insertedLines },
    performedBy: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { journalEntry: je, lines: insertedLines };
}

/**
 * MODULE 8 — DETAILED INVOICE ENGINE & POSTING
 */

async function accountByCode(code: string, name: string, category: string, type: string) {
  const [a] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, code)).limit(1);
  if (a) return a;
  const [created] = await db
    .insert(schema.accounts)
    .values({ code, name, category, type, isActive: true })
    .returning();
  return created;
}

export async function loadCompanyProfile() {
  const [row] = await db.select().from(schema.companyProfile).where(eq(schema.companyProfile.id, 1)).limit(1);
  return row || null;
}

/** Next invoice number: <prefix>-<year>-<4-digit running sequence>. */
async function nextInvoiceNumber(prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  // highest sequence ever used this year + 1 — count ALL rows (incl. soft-deleted)
  // because invoice_number stays UNIQUE even after a soft-delete, so the next
  // number must never reuse one
  const [{ mx }] = await db
    .select({
      mx: sql<number>`coalesce(max((regexp_replace(${schema.invoices.invoiceNumber}, '^.*-', ''))::int), 0)`,
    })
    .from(schema.invoices)
    .where(sql`${schema.invoices.invoiceNumber} like ${like}`);
  return `${prefix}-${year}-${String(Number(mx || 0) + 1).padStart(4, "0")}`;
}

/** Frozen copy of the letterhead / bank / terms as they stand right now. */
export function buildSellerSnapshot(profile: any) {
  if (!profile) return { tradeName: "HF Transport" };
  return {
    tradeName: profile.tradeName,
    legalName: profile.legalName,
    tagline: profile.tagline,
    addressLines: profile.addressLines,
    city: profile.city,
    country: profile.country,
    phones: profile.phones,
    email: profile.email,
    website: profile.website,
    ntn: profile.ntn,
    strn: profile.strn,
    bankAccounts: profile.bankAccountsJson,
    footerNote: profile.invoiceFooterNote,
    terms: profile.invoiceTerms,
    logoDataUrl: profile.logoDataUrl,
  };
}

/**
 * Next system bilty / GR number: BLT-<year>-<4-digit sequence>. Always issued by
 * the system so the consignment number is unique and cannot be faked or reused.
 */
async function nextBiltyNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const like = `BLT-${year}-%`;
  const [{ mx }] = await db
    .select({
      mx: sql<number>`coalesce(max((regexp_replace(${schema.invoices.biltyNumber}, '^.*-', ''))::int), 0)`,
    })
    .from(schema.invoices)
    .where(sql`${schema.invoices.biltyNumber} like ${like}`);
  return `BLT-${year}-${String(Number(mx || 0) + 1).padStart(4, "0")}`;
}

export interface InvoiceLineInput {
  description: string;
  qty?: number;
  unit?: string;
  rate: number;
  amount?: number;
}

export interface DetailedInvoiceInput {
  contractorId: number;
  tripId?: number | null;
  vehicleId?: number | null;
  driverId?: number | null;
  lines: InvoiceLineInput[];
  invoiceDate?: string | Date;
  dueDate?: string | Date;
  paymentTerms?: string;
  salesTaxPercent?: number;
  whtPercent?: number;
  advanceReceived?: number;
  containerNo?: string;
  biltyNumber?: string;
  routeFrom?: string;
  routeTo?: string;
  borderCrossing?: string;
  cargoDescription?: string;
  cargoWeightKg?: number;
  rateBasis?: string;
  bankAccountRef?: string;
  notes?: string;
}

export async function createDetailedInvoice(input: DetailedInvoiceInput, ctx: PostingContext = {}) {
  const profile = await loadCompanyProfile();
  const [contractor] = await db
    .select()
    .from(schema.contractors)
    .where(eq(schema.contractors.id, input.contractorId))
    .limit(1);
  if (!contractor) throw new Error(`Contractor #${input.contractorId} not found.`);

  const lines = (input.lines || []).filter((l) => l && l.description);
  if (!lines.length) throw new Error("At least one invoice line is required.");
  const normLines = lines.map((l, i) => {
    const qty = Number(l.qty ?? 1) || 1;
    const rate = Math.round(Number(l.rate) || 0);
    const amount = l.amount != null ? Math.round(Number(l.amount)) : Math.round(qty * rate);
    return { sortOrder: i, description: l.description, qty: String(qty), unit: l.unit || "trip", rate, amount };
  });

  const subtotal = normLines.reduce((s, l) => s + l.amount, 0);
  // No sales tax / income-tax-withheld on freight invoices — the invoice total is
  // simply the sum of the line items. (Columns kept at 0 for schema compatibility.)
  const salesTaxPercent = 0;
  const whtPercent = 0;
  const taxAmount = 0;
  const whtAmount = 0;
  const totalAmount = subtotal;
  const advanceReceived = Math.max(0, Math.round(Number(input.advanceReceived) || 0));
  const outstandingBalance = totalAmount - advanceReceived;

  const prefix = profile?.invoicePrefix || "INV";
  const invoiceNumber = await nextInvoiceNumber(prefix);
  const biltyNumber =
    input.biltyNumber && String(input.biltyNumber).trim()
      ? String(input.biltyNumber).trim()
      : await nextBiltyNumber();
  const invoiceDate = input.invoiceDate ? new Date(input.invoiceDate) : new Date();
  const dueDate = input.dueDate
    ? new Date(input.dueDate)
    : new Date(invoiceDate.getTime() + 30 * 86400000);

  const sellerSnapshot = buildSellerSnapshot(profile);
  const billToSnapshot = {
    company: contractor.company,
    contactPerson: contractor.contactPerson,
    phone: contractor.phone,
    email: contractor.email,
    address: contractor.address,
    ntn: contractor.ntn,
    strn: contractor.strn,
  };

  const [inv] = await db
    .insert(schema.invoices)
    .values({
      invoiceNumber,
      tripId: input.tripId ?? null,
      contractorId: input.contractorId,
      vehicleId: input.vehicleId ?? null,
      driverId: input.driverId ?? null,
      invoiceDate,
      dueDate,
      subtotal,
      taxAmount,
      totalAmount,
      paidAmount: advanceReceived,
      outstandingBalance,
      status: outstandingBalance <= 0 ? "Paid" : advanceReceived > 0 ? "Partially Paid" : "Unpaid",
      pdfUrl: null,
      paymentTerms: input.paymentTerms || profile?.defaultPaymentTerms || "Net 30",
      sellerSnapshotJson: sellerSnapshot,
      billToSnapshotJson: billToSnapshot,
      containerNo: input.containerNo || null,
      biltyNumber,
      routeFrom: input.routeFrom || null,
      routeTo: input.routeTo || null,
      borderCrossing: input.borderCrossing || null,
      cargoDescription: input.cargoDescription || null,
      cargoWeightKg: input.cargoWeightKg ? Math.round(input.cargoWeightKg) : null,
      rateBasis: input.rateBasis || null,
      advanceReceived,
      bankAccountRef: input.bankAccountRef || null,
      salesTaxPercent: String(salesTaxPercent),
      whtPercent: String(whtPercent),
      whtAmount,
      notes: input.notes || null,
      createdBy: ctx.userId,
    })
    .returning();

  await db.insert(schema.invoiceLines).values(normLines.map((l) => ({ ...l, invoiceId: inv.id, createdBy: ctx.userId })));

  // contractor AR balance
  await db
    .update(schema.contractors)
    .set({ outstandingBalance: (contractor.outstandingBalance || 0) + Math.max(0, outstandingBalance) })
    .where(eq(schema.contractors.id, contractor.id));

  // balanced GL posting:  Dr AR (total - wht) + Dr WHT-Receivable (wht) = Cr Revenue (subtotal) + Cr Sales Tax Payable (tax)
  const ar = await accountByCode("1100", "Accounts Receivable", "Accounts Receivable", "Asset");
  const rev = await accountByCode("4000", "Freight Revenue", "Revenue", "Income");
  const tax = await accountByCode("2100", "Sales Tax Payable", "Miscellaneous", "Liability");
  const wht = await accountByCode("1102", "Advance Income Tax (WHT) Receivable", "Miscellaneous", "Asset");
  const glLines = [
    { accountId: ar.id, description: `AR — invoice ${invoiceNumber}`, debit: totalAmount - whtAmount, credit: 0 },
    { accountId: rev.id, description: `Freight revenue — ${invoiceNumber}`, debit: 0, credit: subtotal },
    { accountId: tax.id, description: `Sales tax payable — ${invoiceNumber}`, debit: 0, credit: taxAmount },
  ];
  if (whtAmount > 0) glLines.push({ accountId: wht.id, description: `WHT withheld by customer — ${invoiceNumber}`, debit: whtAmount, credit: 0 });
  await createBalancedJournalEntry(
    `JE-INV-${String(inv.id).padStart(4, "0")}`,
    `Billing ${invoiceNumber}${input.tripId ? ` (trip #${input.tripId})` : ""}`,
    "Invoice",
    inv.id,
    glLines,
    ctx
  );

  SocketServer.broadcastNotification(null, {
    id: Math.floor(Math.random() * 100000),
    userId: null,
    type: "Finance",
    title: "Invoice generated",
    message: `Invoice ${invoiceNumber} for ${contractor.company} — PKR ${totalAmount.toLocaleString()}.`,
    isRead: false,
    channel: "all",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    createdBy: ctx.userId || null,
    updatedBy: null,
    deletedBy: null,
    isDeleted: false,
  });

  // auto-SMS the trip's driver that an invoice was raised for their trip
  notifyDriverOfInvoice({
    invoiceNumber,
    driverId: input.driverId ?? null,
    vehicleId: input.vehicleId ?? null,
    amount: totalAmount,
    dueDate,
    routeFrom: input.routeFrom ?? null,
    routeTo: input.routeTo ?? null,
    invoiceId: inv.id,
    userId: ctx.userId,
  }).catch((err) => console.error("[finance] invoice SMS failed:", err?.message));

  return inv;
}

/**
 * Edit an existing invoice — fix a mistake before it is settled. Header fields
 * and line items can change; the invoice number, bilty number and the seller
 * snapshot stay frozen. Totals, status, the contractor's AR balance and the GL
 * entry are all recomputed, and the change is written to the audit log.
 */
export async function updateDetailedInvoice(
  id: number,
  input: Partial<DetailedInvoiceInput>,
  ctx: PostingContext = {}
) {
  const [existing] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, id), eq(schema.invoices.isDeleted, false)))
    .limit(1);
  if (!existing) throw new Error(`Invoice #${id} not found.`);

  const contractorId = input.contractorId ?? existing.contractorId;
  const [contractor] = await db
    .select()
    .from(schema.contractors)
    .where(eq(schema.contractors.id, contractorId))
    .limit(1);
  if (!contractor) throw new Error(`Contractor #${contractorId} not found.`);

  let normLines: Array<{ sortOrder: number; description: string; qty: string; unit: string; rate: number; amount: number }> | null = null;
  if (Array.isArray(input.lines) && input.lines.length) {
    const good = input.lines.filter((l) => l && l.description);
    if (!good.length) throw new Error("At least one invoice line is required.");
    normLines = good.map((l, i) => {
      const qty = Number(l.qty ?? 1) || 1;
      const rate = Math.round(Number(l.rate) || 0);
      const amount = l.amount != null ? Math.round(Number(l.amount)) : Math.round(qty * rate);
      return { sortOrder: i, description: l.description, qty: String(qty), unit: l.unit || "trip", rate, amount };
    });
  }
  const subtotal = normLines ? normLines.reduce((s, l) => s + l.amount, 0) : existing.subtotal;
  const totalAmount = subtotal; // no tax on freight invoices

  const oldAdvance = Number(existing.advanceReceived || 0);
  const extraPaid = Math.max(0, Number(existing.paidAmount || 0) - oldAdvance); // payments recorded after issue
  const advanceReceived =
    input.advanceReceived != null ? Math.max(0, Math.round(Number(input.advanceReceived))) : oldAdvance;
  const paidAmount = advanceReceived + extraPaid;
  const outstandingBalance = totalAmount - paidAmount;
  const status = outstandingBalance <= 0 ? "Paid" : paidAmount > 0 ? "Partially Paid" : "Unpaid";

  const patch: Record<string, unknown> = {
    contractorId,
    subtotal,
    totalAmount,
    taxAmount: 0,
    whtAmount: 0,
    salesTaxPercent: "0",
    whtPercent: "0",
    paidAmount,
    outstandingBalance,
    status,
    updatedAt: new Date(),
    updatedBy: ctx.userId,
  };
  for (const k of ["paymentTerms", "containerNo", "routeFrom", "routeTo", "borderCrossing", "cargoDescription", "rateBasis", "notes"]) {
    if ((input as any)[k] !== undefined) patch[k] = (input as any)[k] || null;
  }
  if (input.invoiceDate !== undefined) patch.invoiceDate = input.invoiceDate ? new Date(input.invoiceDate) : existing.invoiceDate;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate ? new Date(input.dueDate) : existing.dueDate;
  if (input.cargoWeightKg !== undefined) patch.cargoWeightKg = input.cargoWeightKg ? Math.round(Number(input.cargoWeightKg)) : null;
  if (input.vehicleId !== undefined) patch.vehicleId = input.vehicleId || null;
  if (input.driverId !== undefined) patch.driverId = input.driverId || null;
  if (input.advanceReceived != null) patch.advanceReceived = advanceReceived;
  if (contractorId !== existing.contractorId) {
    patch.billToSnapshotJson = {
      company: contractor.company,
      contactPerson: contractor.contactPerson,
      phone: contractor.phone,
      email: contractor.email,
      address: contractor.address,
      ntn: contractor.ntn,
      strn: contractor.strn,
    };
  }

  const [updated] = await db.update(schema.invoices).set(patch).where(eq(schema.invoices.id, id)).returning();

  if (normLines) {
    await db.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id));
    await db.insert(schema.invoiceLines).values(normLines.map((l) => ({ ...l, invoiceId: id, createdBy: ctx.userId })));
  }

  // move the AR balance: off the old contractor if it changed, and by the delta
  const newAr = Math.max(0, outstandingBalance);
  const oldAr = Math.max(0, Number(existing.outstandingBalance || 0));
  if (contractorId !== existing.contractorId) {
    const [oldC] = await db.select().from(schema.contractors).where(eq(schema.contractors.id, existing.contractorId)).limit(1);
    if (oldC) {
      await db
        .update(schema.contractors)
        .set({ outstandingBalance: Math.max(0, (oldC.outstandingBalance || 0) - oldAr) })
        .where(eq(schema.contractors.id, oldC.id));
    }
    await db
      .update(schema.contractors)
      .set({ outstandingBalance: (contractor.outstandingBalance || 0) + newAr })
      .where(eq(schema.contractors.id, contractorId));
  } else if (newAr !== oldAr) {
    await db
      .update(schema.contractors)
      .set({ outstandingBalance: (contractor.outstandingBalance || 0) + (newAr - oldAr) })
      .where(eq(schema.contractors.id, contractorId));
  }

  // re-post the GL entry for this invoice with the new figures
  const jes = await db
    .select()
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "Invoice"), eq(schema.journalEntries.sourceId, id)));
  for (const je of jes) {
    await db.delete(schema.journalLines).where(eq(schema.journalLines.journalEntryId, je.id));
    await db.delete(schema.journalEntries).where(eq(schema.journalEntries.id, je.id));
  }
  const ar = await accountByCode("1100", "Accounts Receivable", "Accounts Receivable", "Asset");
  const rev = await accountByCode("4000", "Freight Revenue", "Revenue", "Income");
  if (totalAmount > 0) {
    await createBalancedJournalEntry(
      `JE-INV-${String(id).padStart(4, "0")}`,
      `Billing ${existing.invoiceNumber} (edited)`,
      "Invoice",
      id,
      [
        { accountId: ar.id, description: `AR — invoice ${existing.invoiceNumber}`, debit: totalAmount, credit: 0 },
        { accountId: rev.id, description: `Freight revenue — ${existing.invoiceNumber}`, debit: 0, credit: totalAmount },
      ],
      ctx
    );
  }

  await logAudit({
    action: "UPDATE",
    tableName: "invoices",
    recordId: id,
    oldValues: existing,
    newValues: updated,
    performedBy: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  const lines = await db
    .select()
    .from(schema.invoiceLines)
    .where(and(eq(schema.invoiceLines.invoiceId, id), eq(schema.invoiceLines.isDeleted, false)))
    .orderBy(schema.invoiceLines.sortOrder);
  return { ...updated, lines };
}

/**
 * When a trip reaches 'Completed', auto-generate a DETAILED freight invoice.
 */
export async function triggerAutoInvoicing(tripId: number, ctx: PostingContext = {}) {
  const [existingInvoice] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.tripId, tripId), eq(schema.invoices.isDeleted, false)))
    .limit(1);
  if (existingInvoice) {
    console.log(`[Finance Engine] Trip #${tripId} already invoiced (${existingInvoice.invoiceNumber}). Skipping.`);
    return existingInvoice;
  }

  const [row] = await db
    .select({
      trip: schema.trips,
      routeOrigin: schema.routes.origin,
      routeDest: schema.routes.destination,
      vehicleNumber: schema.vehicles.vehicleNumber,
      containerType: schema.vehicles.containerType,
      driverName: schema.drivers.driverName,
    })
    .from(schema.trips)
    .leftJoin(schema.routes, eq(schema.trips.routeId, schema.routes.id))
    .leftJoin(schema.vehicles, eq(schema.trips.vehicleId, schema.vehicles.id))
    .leftJoin(schema.drivers, eq(schema.trips.driverId, schema.drivers.id))
    .where(eq(schema.trips.id, tripId))
    .limit(1);
  if (!row?.trip) throw new Error(`Trip #${tripId} not found in database.`);
  const trip = row.trip;

  return createDetailedInvoice(
    {
      contractorId: trip.contractorId,
      tripId,
      vehicleId: trip.vehicleId,
      driverId: trip.driverId,
      routeFrom: row.routeOrigin || undefined,
      routeTo: row.routeDest || undefined,
      rateBasis: "per trip",
      lines: [
        {
          description: `Freight — ${row.vehicleNumber || "vehicle"} · ${row.routeOrigin || "?"} → ${row.routeDest || "?"}` +
            (row.driverName ? ` · driver ${row.driverName}` : ""),
          qty: 1,
          unit: "trip",
          rate: trip.revenue,
          amount: trip.revenue,
        },
      ],
      containerNo: row.containerType || undefined,
      notes: `Auto-generated on completion of trip ${trip.tripNumber}.`,
    },
    ctx
  );
}

/**
 * MODULE 9 — PAYMENT ENGINE & RECEIVABLES UPDATE
 * Post contractor payments against outstanding invoices and update the General Ledger.
 */
export async function postInvoicePayment(
  invoiceId: number,
  paymentMethod: string,
  amount: number,
  bankAccountId: number | null,
  referenceNumber: string,
  notes: string,
  ctx: PostingContext = {}
) {
  const [inv] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, invoiceId))
    .limit(1);

  if (!inv) {
    throw new Error("Invoice not found");
  }

  if (amount <= 0) {
    throw new Error("Payment amount must be greater than 0");
  }

  // Look up (and require) the Chart-of-Accounts rows the double-entry
  // posting at the end of this function needs, BEFORE writing anything.
  // This used to run last: the payment record, invoice balance, contractor
  // balance and bank balance were all already inserted/updated by the time
  // this check ran, so a missing Cash/Bank account threw only after five
  // other tables had already been mutated — the route's catch turned that
  // into an HTTP error, but the half-posted payment (AR down, invoice
  // "Partially Paid", no matching GL journal) was already permanently in
  // the database with nothing to roll it back. Checking first means a
  // missing account fails clean, with zero side effects.
  const [arAccount] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, "1100")).limit(1);
  const receivingAccountCode = bankAccountId ? "1002" /* HBL Bank */ : "1001" /* Petty Cash */;
  const [cashOrBankAcc] = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.code, receivingAccountCode))
    .limit(1);
  if (!arAccount || !cashOrBankAcc) {
    throw new Error("Standard accounts (1100 - AR, and cash/bank ledger) must exist in Chart of Accounts.");
  }

  const paymentNumber = `PAY-2026-${Date.now()}`;

  // 1. Create Payment record
  const [pay] = await db
    .insert(schema.payments)
    .values({
      paymentNumber,
      contractorId: inv.contractorId,
      bankAccountId,
      paymentDate: new Date(),
      paymentMethod,
      amount,
      referenceNumber,
      notes,
      status: "Posted",
      createdBy: ctx.userId,
    })
    .returning();

  // 2. Link payment to invoice
  await db.insert(schema.invoicePayments).values({
    paymentId: pay.id,
    invoiceId: inv.id,
    amount,
    createdBy: ctx.userId,
  });

  // 3. Update Invoice Balances
  const newPaidAmount = (inv.paidAmount || 0) + amount;
  const newOutstanding = Math.max(inv.totalAmount - newPaidAmount, 0);
  const newStatus = newOutstanding === 0 ? "Paid" : "Partially Paid";

  await db
    .update(schema.invoices)
    .set({
      paidAmount: newPaidAmount,
      outstandingBalance: newOutstanding,
      status: newStatus,
    })
    .where(eq(schema.invoices.id, invoiceId));

  // 4. Update contractor outstanding balance
  const [contractor] = await db
    .select()
    .from(schema.contractors)
    .where(eq(schema.contractors.id, inv.contractorId))
    .limit(1);

  if (contractor) {
    const updatedBalance = Math.max((contractor.outstandingBalance || 0) - amount, 0);
    await db
      .update(schema.contractors)
      .set({ outstandingBalance: updatedBalance })
      .where(eq(schema.contractors.id, inv.contractorId));
  }

  // 5. Update Bank Account balance if applicable
  if (bankAccountId) {
    const [bank] = await db
      .select()
      .from(schema.bankAccounts)
      .where(eq(schema.bankAccounts.id, bankAccountId))
      .limit(1);
    if (bank) {
      await db
        .update(schema.bankAccounts)
        .set({ currentBalance: (bank.currentBalance || 0) + amount })
        .where(eq(schema.bankAccounts.id, bankAccountId));
    }
  }

  // 6. Post balanced double-entry
  // Debit: Cash/Bank (Code: 1001 or 1002 depending on bankAccountId)
  // Credit: Accounts Receivable (Code: 1100)
  // (arAccount / cashOrBankAcc were already looked up and validated above,
  // before anything was written.)
  await createBalancedJournalEntry(
    `JE-PAY-${String(pay.id).padStart(4, "0")}`,
    `Received payment for invoice ${inv.invoiceNumber}`,
    "Payment",
    pay.id,
    [
      {
        accountId: cashOrBankAcc.id,
        description: `Debit Cash/Bank for payment ${paymentNumber}`,
        debit: amount,
        credit: 0,
      },
      {
        accountId: arAccount.id,
        description: `Credit Accounts Receivable for invoice ${inv.invoiceNumber}`,
        debit: 0,
        credit: amount,
      },
    ],
    ctx
  );

  return { payment: pay, invoiceOutstanding: newOutstanding };
}

/**
 * MODULE 11 — ACCOUNTS PAYABLE & VENDOR RECONCILIATION
 * Post balanced transactions for vendor billing (e.g., fuel invoice, workshops bills).
 */
export async function createVendorBill(
  vendorType: string,
  vendorId: number | null,
  vendorName: string,
  dueDate: Date,
  amount: number,
  expenseTypeCode: string, // Account code of expense (e.g. 5001 - Fuel, 5003 - Maintenance)
  notes: string,
  ctx: PostingContext = {}
) {
  const billNumber = `BILL-2026-${Date.now()}`;

  // Check accounts exist BEFORE creating the bill — same fix as
  // postInvoicePayment/payVendorBill above: otherwise a missing expense
  // account leaves an unpaid bill in the database with no GL entry behind it.
  const [apAccount] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, "2000")).limit(1);
  const [expenseAccount] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, expenseTypeCode)).limit(1);
  if (!apAccount || !expenseAccount) {
    throw new Error(`Accounts (2000 - AP, and expense ledger ${expenseTypeCode}) must exist in Chart of Accounts.`);
  }

  // 1. Create Bill record
  const [bill] = await db
    .insert(schema.bills)
    .values({
      billNumber,
      vendorType,
      vendorId,
      vendorName,
      billDate: new Date(),
      dueDate,
      amount,
      paidAmount: 0,
      outstandingBalance: amount,
      status: "Unpaid",
      notes,
      createdBy: ctx.userId,
    })
    .returning();

  // 2. Post balanced double-entry
  // Debit: Expense Account (e.g. 5001 - Fuel, 5003 - Maintenance)
  // Credit: Accounts Payable (2000)
  await createBalancedJournalEntry(
    `JE-BILL-${String(bill.id).padStart(4, "0")}`,
    `Vendor bill from ${vendorName} (${vendorType})`,
    "Bill",
    bill.id,
    [
      {
        accountId: expenseAccount.id,
        description: `Debit ${expenseAccount.name} for ${notes}`,
        debit: amount,
        credit: 0,
      },
      {
        accountId: apAccount.id,
        description: `Credit Accounts Payable for Bill ${billNumber}`,
        debit: 0,
        credit: amount,
      },
    ],
    ctx
  );

  return bill;
}

/**
 * Pay vendor bill and automatically reconcile balances and General Ledger.
 */
export async function payVendorBill(
  billId: number,
  paymentMethod: string,
  amount: number,
  bankAccountId: number | null,
  referenceNumber: string,
  ctx: PostingContext = {}
) {
  const [bill] = await db
    .select()
    .from(schema.bills)
    .where(eq(schema.bills.id, billId))
    .limit(1);

  if (!bill) {
    throw new Error("Vendor bill not found");
  }

  if (amount <= 0) {
    throw new Error("Payment amount must be greater than 0");
  }

  // Same fix as postInvoicePayment above: verify the Chart-of-Accounts rows
  // the GL posting needs BEFORE touching the bill / bank balances, so a
  // missing account fails clean instead of leaving the bill marked paid
  // with no matching journal entry.
  const [apAccount] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, "2000")).limit(1);
  const paymentAccountCode = bankAccountId ? "1002" /* HBL Bank */ : "1001" /* Petty Cash */;
  const [cashOrBankAcc] = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.code, paymentAccountCode))
    .limit(1);
  if (!apAccount || !cashOrBankAcc) {
    throw new Error("Standard accounts (2000 - AP, and cash/bank ledger) must exist in Chart of Accounts.");
  }

  // 1. Update bill balances
  const newPaidAmount = (bill.paidAmount || 0) + amount;
  const newOutstanding = Math.max(bill.amount - newPaidAmount, 0);
  const newStatus = newOutstanding === 0 ? "Paid" : "Partially Paid";

  await db
    .update(schema.bills)
    .set({
      paidAmount: newPaidAmount,
      outstandingBalance: newOutstanding,
      status: newStatus,
    })
    .where(eq(schema.bills.id, billId));

  // 2. Reduce cash/bank balance if applicable
  if (bankAccountId) {
    const [bank] = await db
      .select()
      .from(schema.bankAccounts)
      .where(eq(schema.bankAccounts.id, bankAccountId))
      .limit(1);
    if (bank) {
      await db
        .update(schema.bankAccounts)
        .set({ currentBalance: Math.max((bank.currentBalance || 0) - amount, 0) })
        .where(eq(schema.bankAccounts.id, bankAccountId));
    }
  }

  // 3. Post balanced double-entry
  // Debit: Accounts Payable (2000)
  // Credit: Cash/Bank (1001 or 1002 depending on bankAccountId)
  // (apAccount / cashOrBankAcc were already looked up and validated above.)
  await createBalancedJournalEntry(
    `JE-BILLPAY-${Date.now()}`,
    `Paid bill ${bill.billNumber} to ${bill.vendorName}`,
    "Payment",
    bill.id,
    [
      {
        accountId: apAccount.id,
        description: `Debit Accounts Payable for paying Bill ${bill.billNumber}`,
        debit: amount,
        credit: 0,
      },
      {
        accountId: cashOrBankAcc.id,
        description: `Credit ${cashOrBankAcc.name} for paying Bill ${bill.billNumber}`,
        debit: 0,
        credit: amount,
      },
    ],
    ctx
  );

  return { billOutstanding: newOutstanding };
}
