import { Router, Response } from "express";
import { requireAuth, requireRole, requirePermission, AuthRequest } from "../src/middleware/auth.ts";
import { db, schema } from "../src/db/index.ts";
import { eq, desc, and, isNull, sql, lt, gte, or } from "drizzle-orm";
import { logAudit } from "../src/db/audit.ts";
import { SocketServer } from "../src/sockets/socket.ts";
import {
  createBalancedJournalEntry,
  postInvoicePayment,
  createVendorBill,
  payVendorBill,
  createDetailedInvoice,
  updateDetailedInvoice,
} from "./finance_engine.ts";

const router = Router();

// Reusable Audit Helper for finance operations
async function auditFinance(
  req: AuthRequest,
  action: "CREATE" | "UPDATE" | "DELETE",
  tableName: string,
  recordId: number,
  oldValues: any,
  newValues: any
) {
  await logAudit({
    action,
    tableName,
    recordId,
    oldValues,
    newValues,
    performedBy: req.user?.id,
    ipAddress: req.ip || req.socket.remoteAddress || undefined,
    userAgent: req.headers["user-agent"] || undefined,
  });
}

// ---------------------------------------------------------
// 1. CHART OF ACCOUNTS APIs (MODULE 2)
// ---------------------------------------------------------
router.get("/accounts", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.isDeleted, false))
      .orderBy(schema.accounts.code);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/cash-bank/accounts", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.isDeleted, false))
      .orderBy(schema.accounts.code);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/accounts", requireAuth, requirePermission("finance", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const { code, name, type, category, description } = req.body;
    if (!code || !name || !type || !category) {
      return res.status(400).json({ error: "Missing required fields (code, name, type, category)" });
    }

    // Check duplicate code
    const [existing] = await db
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.code, code), eq(schema.accounts.isDeleted, false)))
      .limit(1);

    if (existing) {
      return res.status(400).json({ error: `Account with code ${code} already exists.` });
    }

    const [created] = await db
      .insert(schema.accounts)
      .values({
        code,
        name,
        type,
        category,
        description,
        isActive: true,
        createdBy: req.user?.id,
      })
      .returning();

    await auditFinance(req, "CREATE", "accounts", created.id, null, created);
    res.json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/accounts/:id", requireAuth, requirePermission("finance", "update"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { name, category, isActive, description } = req.body;

    const [old] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Account not found" });

    const [updated] = await db
      .update(schema.accounts)
      .set({
        name,
        category,
        isActive,
        description,
        updatedAt: new Date(),
        updatedBy: req.user?.id,
      })
      .where(eq(schema.accounts.id, id))
      .returning();

    await auditFinance(req, "UPDATE", "accounts", id, old, updated);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------------------------------------------------
// 2. GENERAL LEDGER / JOURNAL ENTRIES APIs (MODULE 1)
// ---------------------------------------------------------
router.get("/journals", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const entries = await db
      .select({
        id: schema.journalEntries.id,
        entryNumber: schema.journalEntries.entryNumber,
        entryDate: schema.journalEntries.entryDate,
        description: schema.journalEntries.description,
        sourceType: schema.journalEntries.sourceType,
        sourceId: schema.journalEntries.sourceId,
      })
      .from(schema.journalEntries)
      .where(eq(schema.journalEntries.isDeleted, false))
      .orderBy(desc(schema.journalEntries.entryDate));

    const result = [];
    for (const je of entries) {
      const lines = await db
        .select({
          id: schema.journalLines.id,
          debit: schema.journalLines.debit,
          credit: schema.journalLines.credit,
          description: schema.journalLines.description,
          accountId: schema.journalLines.accountId,
          accountCode: schema.accounts.code,
          accountName: schema.accounts.name,
        })
        .from(schema.journalLines)
        .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
        .where(eq(schema.journalLines.journalEntryId, je.id));
      
      result.push({ ...je, lines });
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/journals", requireAuth, requirePermission("finance", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const { description, lines } = req.body;
    if (!description || !lines || !Array.isArray(lines) || lines.length < 2) {
      return res.status(400).json({ error: "A manual journal entry requires a description and at least 2 debit/credit lines." });
    }

    const entryNumber = `JE-${Date.now()}`;
    const formattedLines = lines.map((l: any) => ({
      accountId: parseInt(l.accountId),
      description: l.description,
      debit: parseInt(l.debit) || 0,
      credit: parseInt(l.credit) || 0,
    }));

    const result = await createBalancedJournalEntry(
      entryNumber,
      description,
      "Manual",
      null,
      formattedLines,
      {
        userId: req.user?.id,
        ipAddress: req.ip || req.socket.remoteAddress || undefined,
        userAgent: req.headers["user-agent"] || undefined,
      }
    );

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});


// ---------------------------------------------------------
// 3. ACCOUNTS RECEIVABLE / INVOICING APIs (MODULE 3 & 8)
// ---------------------------------------------------------
router.get("/invoices", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        id: schema.invoices.id,
        invoiceNumber: schema.invoices.invoiceNumber,
        invoiceDate: schema.invoices.invoiceDate,
        dueDate: schema.invoices.dueDate,
        subtotal: schema.invoices.subtotal,
        taxAmount: schema.invoices.taxAmount,
        totalAmount: schema.invoices.totalAmount,
        paidAmount: schema.invoices.paidAmount,
        outstandingBalance: schema.invoices.outstandingBalance,
        status: schema.invoices.status,
        pdfUrl: schema.invoices.pdfUrl,
        paymentTerms: schema.invoices.paymentTerms,
        tripId: schema.invoices.tripId,
        tripNumber: schema.trips.tripNumber,
        contractorId: schema.invoices.contractorId,
        contractorName: schema.contractors.company,
        routeFrom: schema.invoices.routeFrom,
        routeTo: schema.invoices.routeTo,
        advanceReceived: schema.invoices.advanceReceived,
        whtAmount: schema.invoices.whtAmount,
      })
      .from(schema.invoices)
      .leftJoin(schema.trips, eq(schema.invoices.tripId, schema.trips.id))
      .innerJoin(schema.contractors, eq(schema.invoices.contractorId, schema.contractors.id))
      .where(eq(schema.invoices.isDeleted, false))
      .orderBy(desc(schema.invoices.invoiceDate));

    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create a manual (multi-line) detailed invoice
router.post("/invoices", requireAuth, requirePermission("finance", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.contractorId || !Array.isArray(b.lines) || b.lines.length === 0) {
      return res.status(400).json({ error: "contractorId and at least one line are required" });
    }
    const inv = await createDetailedInvoice(b, {
      userId: req.user?.id,
      ipAddress: req.ip || req.socket.remoteAddress || undefined,
      userAgent: req.headers["user-agent"] || undefined,
    });
    await auditFinance(req, "CREATE", "invoices", inv.id, null, inv);
    res.status(201).json(inv);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Edit an existing invoice (fix a mistake). Recomputes totals / status / GL.
router.put("/invoices/:id(\\d+)", requireAuth, requirePermission("finance", "update"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const before = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
    const updated = await updateDetailedInvoice(id, req.body || {}, {
      userId: req.user?.id,
      ipAddress: req.ip || req.socket.remoteAddress || undefined,
      userAgent: req.headers["user-agent"] || undefined,
    });
    await auditFinance(req, "UPDATE", "invoices", id, before[0] || null, updated);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// One invoice with lines + snapshots (for the printable document)
// NB: numeric-only param so it does not shadow /invoices/aging
router.get("/invoices/:id(\\d+)", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [inv] = await db
      .select({
        invoice: schema.invoices,
        contractorName: schema.contractors.company,
        tripNumber: schema.trips.tripNumber,
        vehicleNumber: schema.vehicles.vehicleNumber,
        driverName: schema.drivers.driverName,
      })
      .from(schema.invoices)
      .leftJoin(schema.contractors, eq(schema.invoices.contractorId, schema.contractors.id))
      .leftJoin(schema.trips, eq(schema.invoices.tripId, schema.trips.id))
      .leftJoin(schema.vehicles, eq(schema.invoices.vehicleId, schema.vehicles.id))
      .leftJoin(schema.drivers, eq(schema.invoices.driverId, schema.drivers.id))
      .where(and(eq(schema.invoices.id, id), eq(schema.invoices.isDeleted, false)))
      .limit(1);
    if (!inv) return res.status(404).json({ error: "Invoice not found" });

    const lines = await db
      .select()
      .from(schema.invoiceLines)
      .where(and(eq(schema.invoiceLines.invoiceId, id), eq(schema.invoiceLines.isDeleted, false)))
      .orderBy(schema.invoiceLines.sortOrder);

    const payments = await db
      .select({
        amount: schema.invoicePayments.amount,
        paymentNumber: schema.payments.paymentNumber,
        paymentDate: schema.payments.paymentDate,
        paymentMethod: schema.payments.paymentMethod,
      })
      .from(schema.invoicePayments)
      .leftJoin(schema.payments, eq(schema.invoicePayments.paymentId, schema.payments.id))
      .where(eq(schema.invoicePayments.invoiceId, id));

    res.json({
      ...inv.invoice,
      contractorName: inv.contractorName,
      tripNumber: inv.tripNumber,
      vehicleNumber: inv.vehicleNumber,
      driverName: inv.driverName,
      lines,
      payments,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/invoices/aging", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const invoicesList = await db
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.isDeleted, false), sql`${schema.invoices.outstandingBalance} > 0`));

    let bucketCurrent = 0; // Not due yet
    let bucket30 = 0;  // 1-30 days overdue
    let bucket60 = 0;  // 31-60 days overdue
    let bucket90 = 0;  // 61-90 days overdue
    let bucket120 = 0; // 91-120 days overdue
    let bucketOver = 0; // 120+ days overdue

    for (const inv of invoicesList) {
      const due = new Date(inv.dueDate);
      const diffTime = now.getTime() - due.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        bucketCurrent += inv.outstandingBalance;
      } else if (diffDays <= 30) {
        bucket30 += inv.outstandingBalance;
      } else if (diffDays <= 60) {
        bucket60 += inv.outstandingBalance;
      } else if (diffDays <= 90) {
        bucket90 += inv.outstandingBalance;
      } else if (diffDays <= 120) {
        bucket120 += inv.outstandingBalance;
      } else {
        bucketOver += inv.outstandingBalance;
      }
    }

    res.json({
      current: bucketCurrent,
      overdue30: bucket30,
      overdue60: bucket60,
      overdue90: bucket90,
      overdue120: bucket120,
      overdue120Plus: bucketOver,
      totalAR: bucketCurrent + bucket30 + bucket60 + bucket90 + bucket120 + bucketOver,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/invoices/:id/payments", requireAuth, requirePermission("finance", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { paymentMethod, amount, bankAccountId, referenceNumber, notes } = req.body;

    if (!paymentMethod || !amount) {
      return res.status(400).json({ error: "Missing required payment details (paymentMethod, amount)" });
    }

    const ctx = {
      userId: req.user?.id,
      ipAddress: req.ip || req.socket.remoteAddress || undefined,
      userAgent: req.headers["user-agent"] || undefined,
    };

    const result = await postInvoicePayment(
      id,
      paymentMethod,
      parseInt(amount),
      bankAccountId ? parseInt(bankAccountId) : null,
      referenceNumber || "",
      notes || "",
      ctx
    );

    res.json({
      message: "Contractor Invoice payment recorded successfully & ledger entries posted.",
      ...result,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});


// ---------------------------------------------------------
// 4. ACCOUNTS PAYABLE / VENDOR BILLING APIs (MODULE 4 & 11)
// ---------------------------------------------------------
router.get("/bills", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select()
      .from(schema.bills)
      .where(eq(schema.bills.isDeleted, false))
      .orderBy(desc(schema.bills.billDate));
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/bills/aging", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const billsList = await db
      .select()
      .from(schema.bills)
      .where(and(eq(schema.bills.isDeleted, false), sql`${schema.bills.outstandingBalance} > 0`));

    let bucketCurrent = 0;
    let bucket30 = 0;
    let bucket60 = 0;
    let bucket90 = 0;
    let bucketOver = 0;

    for (const bill of billsList) {
      const due = new Date(bill.dueDate);
      const diffTime = now.getTime() - due.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        bucketCurrent += bill.outstandingBalance;
      } else if (diffDays <= 30) {
        bucket30 += bill.outstandingBalance;
      } else if (diffDays <= 60) {
        bucket60 += bill.outstandingBalance;
      } else if (diffDays <= 90) {
        bucket90 += bill.outstandingBalance;
      } else {
        bucketOver += bill.outstandingBalance;
      }
    }

    res.json({
      current: bucketCurrent,
      overdue30: bucket30,
      overdue60: bucket60,
      overdue90: bucket90,
      overdue90Plus: bucketOver,
      totalAP: bucketCurrent + bucket30 + bucket60 + bucket90 + bucketOver,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/bills", requireAuth, requirePermission("finance", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const { vendorType, vendorId, vendorName, dueDate, amount, expenseTypeCode, notes } = req.body;
    if (!vendorType || !vendorName || !dueDate || !amount || !expenseTypeCode) {
      return res.status(400).json({ error: "Missing required vendor billing fields." });
    }

    const ctx = {
      userId: req.user?.id,
      ipAddress: req.ip || req.socket.remoteAddress || undefined,
      userAgent: req.headers["user-agent"] || undefined,
    };

    const createdBill = await createVendorBill(
      vendorType,
      vendorId ? parseInt(vendorId) : null,
      vendorName,
      new Date(dueDate),
      parseInt(amount),
      expenseTypeCode,
      notes || "",
      ctx
    );

    res.json(createdBill);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/bills/:id/payments", requireAuth, requirePermission("finance", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { paymentMethod, amount, bankAccountId, referenceNumber } = req.body;

    if (!paymentMethod || !amount) {
      return res.status(400).json({ error: "Missing payment method or amount." });
    }

    const ctx = {
      userId: req.user?.id,
      ipAddress: req.ip || req.socket.remoteAddress || undefined,
      userAgent: req.headers["user-agent"] || undefined,
    };

    const result = await payVendorBill(
      id,
      paymentMethod,
      parseInt(amount),
      bankAccountId ? parseInt(bankAccountId) : null,
      referenceNumber || "",
      ctx
    );

    res.json({
      message: "Vendor payment applied & GL reconciled.",
      ...result,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});


// ---------------------------------------------------------
// 5. BANK MANAGEMENT APIs (MODULE 5)
// ---------------------------------------------------------
router.get("/banks", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const accountsList = await db
      .select()
      .from(schema.bankAccounts)
      .where(eq(schema.bankAccounts.isDeleted, false));
    res.json(accountsList);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * True cash position — sum of every Cash/Bank Chart-of-Accounts account's
 * real GL balance (debit - credit across journal_lines, since these are
 * Asset accounts). Executive BI's "Cash Position" tile used to sum
 * `bank_accounts.currentBalance` instead — a separate operational table for
 * registered bank accounts only. A payment made with paymentMethod "Cash"
 * (no bankAccountId) correctly posts to the 1001 Petty Cash GL account but
 * has no bank_accounts row to update, so real cash collected showed as
 * PKR 0 forever on that tile even though the books were correct. This reads
 * the actual ledger instead, so it reflects cash *and* bank money together,
 * regardless of which payment method was used to receive it.
 */
router.get("/cash-position", requireAuth, requirePermission("finance", "read"), async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db
      .select({
        accountId: schema.accounts.id,
        code: schema.accounts.code,
        name: schema.accounts.name,
        category: schema.accounts.category,
        balance: sql<number>`coalesce(sum(${schema.journalLines.debit}) - sum(${schema.journalLines.credit}), 0)::bigint`,
      })
      .from(schema.accounts)
      .leftJoin(schema.journalLines, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(eq(schema.accounts.isDeleted, false), or(eq(schema.accounts.category, "Cash"), eq(schema.accounts.category, "Bank"))))
      .groupBy(schema.accounts.id, schema.accounts.code, schema.accounts.name, schema.accounts.category);

    const total = rows.reduce((sum, r) => sum + Number(r.balance || 0), 0);
    res.json({ total, accounts: rows.map((r) => ({ ...r, balance: Number(r.balance || 0) })) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/banks", requireAuth, requirePermission("finance", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const { bankName, branchName, accountNumber, iban, openingBalance } = req.body;
    if (!bankName || !accountNumber || !iban) {
      return res.status(400).json({ error: "Missing required bank details (bankName, accountNumber, iban)" });
    }

    const [created] = await db
      .insert(schema.bankAccounts)
      .values({
        bankName,
        branchName,
        accountNumber,
        iban,
        openingBalance: parseInt(openingBalance) || 0,
        currentBalance: parseInt(openingBalance) || 0,
        status: "Active",
        createdBy: req.user?.id,
      })
      .returning();

    await auditFinance(req, "CREATE", "bank_accounts", created.id, null, created);
    res.json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/banks/transfer", requireAuth, requirePermission("finance", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const { sourceAccountId, destAccountId, amount, reference } = req.body;
    if (!sourceAccountId || !destAccountId || !amount) {
      return res.status(400).json({ error: "Missing transfer fields (source, destination, amount)" });
    }

    const parsedAmount = parseInt(amount);

    // 1. Fetch bank configurations
    const [srcBank] = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, parseInt(sourceAccountId))).limit(1);
    const [destBank] = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, parseInt(destAccountId))).limit(1);

    if (!srcBank || !destBank) {
      return res.status(404).json({ error: "One or both bank accounts not found." });
    }

    if (srcBank.currentBalance < parsedAmount) {
      return res.status(400).json({ error: "Insufficient balance for this bank transfer." });
    }

    // 2. Perform safe updates
    await db.update(schema.bankAccounts).set({ currentBalance: srcBank.currentBalance - parsedAmount }).where(eq(schema.bankAccounts.id, srcBank.id));
    await db.update(schema.bankAccounts).set({ currentBalance: destBank.currentBalance + parsedAmount }).where(eq(schema.bankAccounts.id, destBank.id));

    // 3. Balanced Ledger Posting for Inter bank transfers
    const [bankGL] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, "1002")).limit(1);
    if (bankGL) {
      await createBalancedJournalEntry(
        `JE-TRF-${Date.now()}`,
        `Inter-Bank Funds Transfer: ${srcBank.bankName} to ${destBank.bankName} (${reference || "no ref"})`,
        "Payment",
        null,
        [
          {
            accountId: bankGL.id, // HBL Bank (Recipient Debit)
            description: `Interbank debit for ${destBank.bankName}`,
            debit: parsedAmount,
            credit: 0,
          },
          {
            accountId: bankGL.id, // HBL Bank (Sender Credit)
            description: `Interbank credit for ${srcBank.bankName}`,
            debit: 0,
            credit: parsedAmount,
          },
        ],
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.socket.remoteAddress || undefined,
          userAgent: req.headers["user-agent"] || undefined,
        }
      );
    }

    res.json({ message: "Funds transferred successfully & audit logs posted." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------------------------------------------------
// 6. PETTY CASH MANAGEMENT APIs (MODULE 6)
// ---------------------------------------------------------
router.get("/cash-closing", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        id: schema.cashClosings.id,
        closingDate: schema.cashClosings.closingDate,
        openingBalance: schema.cashClosings.openingBalance,
        cashIn: schema.cashClosings.cashIn,
        cashOut: schema.cashClosings.cashOut,
        closingBalance: schema.cashClosings.closingBalance,
        declaredBalance: schema.cashClosings.declaredBalance,
        discrepancy: schema.cashClosings.discrepancy,
        status: schema.cashClosings.status,
        notes: schema.cashClosings.notes,
        approvedBy: schema.cashClosings.approvedBy,
        approverName: schema.users.name,
      })
      .from(schema.cashClosings)
      .leftJoin(schema.users, eq(schema.cashClosings.approvedBy, schema.users.id))
      .where(eq(schema.cashClosings.isDeleted, false))
      .orderBy(desc(schema.cashClosings.closingDate));
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/cash-closing", requireAuth, requirePermission("finance", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const { openingBalance, cashIn, cashOut, declaredBalance, notes } = req.body;
    if (openingBalance === undefined || cashIn === undefined || cashOut === undefined || declaredBalance === undefined) {
      return res.status(400).json({ error: "Missing cash closing parameters (opening, in, out, declared)" });
    }

    const calculatedBalance = parseInt(openingBalance) + parseInt(cashIn) - parseInt(cashOut);
    const discrepancy = parseInt(declaredBalance) - calculatedBalance;

    const [created] = await db
      .insert(schema.cashClosings)
      .values({
        closingDate: new Date(),
        openingBalance: parseInt(openingBalance),
        cashIn: parseInt(cashIn),
        cashOut: parseInt(cashOut),
        closingBalance: calculatedBalance,
        declaredBalance: parseInt(declaredBalance),
        discrepancy,
        status: "Draft",
        notes,
        createdBy: req.user?.id,
      })
      .returning();

    await auditFinance(req, "CREATE", "cash_closings", created.id, null, created);
    res.json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/cash-closing/:id/approve", requireAuth, requirePermission("finance", "update"), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const [old] = await db.select().from(schema.cashClosings).where(eq(schema.cashClosings.id, id)).limit(1);
    if (!old) return res.status(404).json({ error: "Closing not found." });

    const [updated] = await db
      .update(schema.cashClosings)
      .set({
        status: "Approved",
        approvedBy: req.user?.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.cashClosings.id, id))
      .returning();

    await auditFinance(req, "UPDATE", "cash_closings", id, old, updated);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------------------------------------------------
// 7. EXPENSE MANAGEMENT APIs (MODULE 7)
// ---------------------------------------------------------
router.get("/expenses", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const list = await db
      .select({
        id: schema.expenses.id,
        expenseNumber: schema.expenses.expenseNumber,
        expenseType: schema.expenses.expenseType,
        amount: schema.expenses.amount,
        expenseDate: schema.expenses.expenseDate,
        paymentMethod: schema.expenses.paymentMethod,
        receiptUrl: schema.expenses.receiptUrl,
        status: schema.expenses.status,
        notes: schema.expenses.notes,
        tripId: schema.expenses.tripId,
        tripNumber: schema.trips.tripNumber,
        vehicleId: schema.expenses.vehicleId,
        vehicleNumber: schema.vehicles.vehicleNumber,
        driverId: schema.expenses.driverId,
        driverName: schema.drivers.driverName,
        department: schema.expenses.department,
        costCenter: schema.expenses.costCenter,
      })
      .from(schema.expenses)
      .leftJoin(schema.trips, eq(schema.expenses.tripId, schema.trips.id))
      .leftJoin(schema.vehicles, eq(schema.expenses.vehicleId, schema.vehicles.id))
      .leftJoin(schema.drivers, eq(schema.expenses.driverId, schema.drivers.id))
      .where(eq(schema.expenses.isDeleted, false))
      .orderBy(desc(schema.expenses.expenseDate));

    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/expenses", requireAuth, requirePermission("finance", "create"), async (req: AuthRequest, res: Response) => {
  try {
    const {
      tripId,
      vehicleId,
      driverId,
      contractorId,
      department,
      costCenter,
      expenseType,
      amount,
      paymentMethod,
      bankAccountId,
      notes,
    } = req.body;

    if (!expenseType || !amount || !paymentMethod) {
      return res.status(400).json({ error: "Missing required expense details (expenseType, amount, method)" });
    }

    const parsedAmount = parseInt(amount);
    const expenseNumber = `EXP-2026-${Date.now()}`;

    // Map expense types to GL codes
    const expenseCodeMap: Record<string, string> = {
      Fuel: "5001",
      Salary: "5002",
      Maintenance: "5003",
      Insurance: "5004",
      Toll: "5005",
      Repairs: "5003",
      Depreciation: "5006",
      Miscellaneous: "5099",
    };

    const targetGLCode = expenseCodeMap[expenseType] || "5099";

    const [created] = await db
      .insert(schema.expenses)
      .values({
        expenseNumber,
        tripId: tripId ? parseInt(tripId) : null,
        vehicleId: vehicleId ? parseInt(vehicleId) : null,
        driverId: driverId ? parseInt(driverId) : null,
        contractorId: contractorId ? parseInt(contractorId) : null,
        department,
        costCenter,
        expenseType,
        amount: parsedAmount,
        expenseDate: new Date(),
        paymentMethod,
        bankAccountId: bankAccountId ? parseInt(bankAccountId) : null,
        status: "Approved", // Auto-approved for operational speed
        notes,
        createdBy: req.user?.id,
      })
      .returning();

    // 2. Reduce Bank/Cash Account
    if (bankAccountId) {
      const [bank] = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, parseInt(bankAccountId))).limit(1);
      if (bank) {
        await db
          .update(schema.bankAccounts)
          .set({ currentBalance: Math.max((bank.currentBalance || 0) - parsedAmount, 0) })
          .where(eq(schema.bankAccounts.id, bank.id));
      }
    }

    // 3. Post balanced double-entry
    // Debit: Target Expense account (e.g., 5001 - Fuel, 5005 - Toll)
    // Credit: Cash/Bank Account (1001/1002)
    const [expenseGL] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, targetGLCode)).limit(1);
    let creditAccountCode = "1001"; // Physical Cash default
    if (bankAccountId) {
      creditAccountCode = "1002"; // Bank
    }
    const [cashOrBankGL] = await db.select().from(schema.accounts).where(eq(schema.accounts.code, creditAccountCode)).limit(1);

    if (expenseGL && cashOrBankGL) {
      await createBalancedJournalEntry(
        `JE-EXP-${String(created.id).padStart(4, "0")}`,
        `Operational expense: ${expenseType} (${notes || "no notes"})`,
        "Expense",
        created.id,
        [
          {
            accountId: expenseGL.id,
            description: `Debit Operational Expense: ${expenseType}`,
            debit: parsedAmount,
            credit: 0,
          },
          {
            accountId: cashOrBankGL.id,
            description: `Credit ${cashOrBankGL.name} for expense payment`,
            debit: 0,
            credit: parsedAmount,
          },
        ],
        {
          userId: req.user?.id,
          ipAddress: req.ip || req.socket.remoteAddress || undefined,
          userAgent: req.headers["user-agent"] || undefined,
        }
      );
    }

    await auditFinance(req, "CREATE", "expenses", created.id, null, created);
    res.json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------------------------------------------------
// 8. PROFITABILITY ANALYTICS ENGINE APIs (MODULE 10)
// ---------------------------------------------------------
router.get("/profitability/summary", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    // We compute actual dynamic metrics based on database records:
    // Invoiced revenue minus associated expenses (Fuel, Maintenance, Tolls, Salaries)
    
    // Total Revenue — the real GL (every Income-type account's credit minus
    // debit across journal_lines), NOT the separate `invoices` table. Same
    // bug class as totalExpenses below: real freight revenue collected on a
    // truck khata (imported in bulk, no formal Invoice record behind it —
    // see src/lib/dataio/truck-workbook-import.ts) posts straight to the GL
    // Freight Revenue account and was invisible here while this only summed
    // `invoices.totalAmount`, even though /api/finance/reports/income-
    // statement (which already reads the real GL) showed the correct number.
    const revGL = await db.execute(sql`
      SELECT COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) AS total
      FROM accounts a
      JOIN journal_lines jl ON jl.account_id = a.id AND jl.is_deleted = false
      WHERE a.is_deleted = false AND a.is_active = true AND a.type = 'Income'
    `);
    const totalRevenue = Number((revGL.rows[0] as any)?.total || 0);

    // Total Expenses — the real Chart-of-Accounts GL (every Expense-type
    // account's debit minus credit across journal_lines), NOT the separate
    // `expenses` table. This used to sum only `expenses`, which is one of
    // several paths that post to an Expense account — a vendor bill (Finance
    // → Bills / the Vendor Portal) posts straight to the GL via
    // createVendorBill() and never touches the `expenses` table at all, so
    // any cost recorded that way was invisible here (Total Operational
    // Costs stuck at 0, Net Profit overstated to 100% margin) even though
    // /api/finance/reports/income-statement — which already reads the real
    // GL — showed the correct number. Same underlying bug as the Cash
    // Position tile: a dashboard reading a narrower table instead of the
    // ledger everything actually posts to.
    const expGL = await db.execute(sql`
      SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) AS total
      FROM accounts a
      JOIN journal_lines jl ON jl.account_id = a.id AND jl.is_deleted = false
      WHERE a.is_deleted = false AND a.is_active = true AND a.type = 'Expense'
    `);
    const totalExpenses = Number((expGL.rows[0] as any)?.total || 0);

    const netProfit = totalRevenue - totalExpenses;

    // Vehicle specific profitability
    const vehicleProfitability = await db.execute(sql`
      SELECT 
        v.id as "vehicleId",
        v.vehicle_number as "vehicleNumber",
        COALESCE(SUM(inv.total_amount), 0) as "revenue",
        COALESCE((SELECT SUM(amount) FROM expenses WHERE vehicle_id = v.id AND is_deleted = false), 0) as "expenses"
      FROM vehicles v
      LEFT JOIN trips t ON t.vehicle_id = v.id AND t.is_deleted = false
      LEFT JOIN invoices inv ON inv.trip_id = t.id AND inv.is_deleted = false
      WHERE v.is_deleted = false
      GROUP BY v.id, v.vehicle_number
      ORDER BY "revenue" DESC
    `);

    // Driver specific profitability
    const driverProfitability = await db.execute(sql`
      SELECT 
        d.id as "driverId",
        d.driver_name as "driverName",
        COALESCE(SUM(inv.total_amount), 0) as "revenue",
        COALESCE((SELECT SUM(amount) FROM expenses WHERE driver_id = d.id AND is_deleted = false), 0) as "expenses"
      FROM drivers d
      LEFT JOIN trips t ON t.driver_id = d.id AND t.is_deleted = false
      LEFT JOIN invoices inv ON inv.trip_id = t.id AND inv.is_deleted = false
      WHERE d.is_deleted = false
      GROUP BY d.id, d.driver_name
      ORDER BY "revenue" DESC
    `);

    // Route specific profitability
    const routeProfitability = await db.execute(sql`
      SELECT 
        r.id as "routeId",
        CONCAT(r.origin, ' ➔ ', r.destination) as "routeName",
        COALESCE(SUM(inv.total_amount), 0) as "revenue",
        COALESCE((SELECT SUM(amount) FROM expenses WHERE trip_id = t.id AND is_deleted = false), 0) as "expenses"
      FROM routes r
      LEFT JOIN trips t ON t.route_id = r.id AND t.is_deleted = false
      LEFT JOIN invoices inv ON inv.trip_id = t.id AND inv.is_deleted = false
      WHERE r.is_deleted = false
      GROUP BY r.id, r.origin, r.destination, t.id
    `);

    res.json({
      summary: {
        totalRevenue,
        totalExpenses,
        netProfit,
        profitMargin: totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) + "%" : "0%",
      },
      vehicles: vehicleProfitability.rows,
      drivers: driverProfitability.rows,
      routes: routeProfitability.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------------------------------------------------
// 9. FINANCIAL STATEMENTS & REPORTS (MODULE 13 & 14)
// ---------------------------------------------------------

// Trial Balance: Total Debits vs Total Credits
router.get("/reports/trial-balance", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const rawTB = await db.execute(sql`
      SELECT 
        a.id as "accountId",
        a.code as "accountCode",
        a.name as "accountName",
        a.type as "accountType",
        COALESCE(SUM(jl.debit), 0) as "totalDebit",
        COALESCE(SUM(jl.credit), 0) as "totalCredit"
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id AND jl.is_deleted = false
      WHERE a.is_deleted = false AND a.is_active = true
      GROUP BY a.id, a.code, a.name, a.type
      ORDER BY a.code
    `);
    res.json(rawTB.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Balance Sheet: Assets, Liabilities, Equity
router.get("/reports/balance-sheet", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const rawBS = await db.execute(sql`
      SELECT 
        a.code as "accountCode",
        a.name as "accountName",
        a.type as "accountType",
        a.category as "accountCategory",
        COALESCE(SUM(jl.debit), 0) as "totalDebit",
        COALESCE(SUM(jl.credit), 0) as "totalCredit"
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id AND jl.is_deleted = false
      WHERE a.is_deleted = false AND a.is_active = true AND a.type IN ('Asset', 'Liability', 'Equity')
      GROUP BY a.code, a.name, a.type, a.category
      ORDER BY a.code
    `);

    // Format nicely
    const assets: any[] = [];
    const liabilities: any[] = [];
    const equity: any[] = [];

    rawBS.rows.forEach((row: any) => {
      // Net book value calculations:
      // Asset = Debit - Credit
      // Liability/Equity = Credit - Debit
      const debitVal = Number(row.totalDebit);
      const creditVal = Number(row.totalCredit);
      const balance = row.accountType === "Asset" ? (debitVal - creditVal) : (creditVal - debitVal);

      const item = {
        code: row.accountCode,
        name: row.accountName,
        category: row.accountCategory,
        balance,
      };

      if (row.accountType === "Asset") {
        assets.push(item);
      } else if (row.accountType === "Liability") {
        liabilities.push(item);
      } else {
        equity.push(item);
      }
    });

    // Assets = Liabilities + Equity only held with a "Retained Earnings" /
    // "Current Period Net Income" line inside Equity — nothing in this app
    // ever posts one, since there's no period-close routine that rolls
    // Income/Expense into Equity at year-end. Without it, every real
    // transaction pushes the books further out of balance: revenue and
    // expense entries move Assets and Liabilities (via AR/AP/Cash), but
    // their P&L side (Income/Expense accounts) sits outside this query
    // entirely (it only selects Asset/Liability/Equity types) — so Equity
    // stayed frozen at whatever it started at (often 0) while Assets grew
    // with every invoice and payment. A live/interim balance sheet is
    // conventionally presented with current, not-yet-closed earnings
    // folded into Equity this way — same Income-minus-Expense GL query the
    // Income Statement report already uses, so the two stay consistent.
    const plGL = await db.execute(sql`
      SELECT a.type as "accountType", COALESCE(SUM(jl.debit), 0) as "totalDebit", COALESCE(SUM(jl.credit), 0) as "totalCredit"
      FROM accounts a
      JOIN journal_lines jl ON jl.account_id = a.id AND jl.is_deleted = false
      WHERE a.is_deleted = false AND a.is_active = true AND a.type IN ('Income', 'Expense')
      GROUP BY a.type
    `);
    let totalIncome = 0;
    let totalExpense = 0;
    for (const row of plGL.rows as any[]) {
      const debitVal = Number(row.totalDebit);
      const creditVal = Number(row.totalCredit);
      if (row.accountType === "Income") totalIncome += creditVal - debitVal;
      else totalExpense += debitVal - creditVal;
    }
    const currentPeriodNetIncome = totalIncome - totalExpense;
    if (currentPeriodNetIncome !== 0) {
      equity.push({
        code: "3900",
        name: "Current Period Net Income (Retained Earnings)",
        category: "Equity",
        balance: currentPeriodNetIncome,
      });
    }

    res.json({ assets, liabilities, equity });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Income Statement / Profit & Loss
router.get("/reports/income-statement", requireAuth, requirePermission("finance", "read"), async (req: AuthRequest, res: Response) => {
  try {
    const rawIS = await db.execute(sql`
      SELECT 
        a.code as "accountCode",
        a.name as "accountName",
        a.type as "accountType",
        a.category as "accountCategory",
        COALESCE(SUM(jl.debit), 0) as "totalDebit",
        COALESCE(SUM(jl.credit), 0) as "totalCredit"
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id AND jl.is_deleted = false
      WHERE a.is_deleted = false AND a.is_active = true AND a.type IN ('Income', 'Expense')
      GROUP BY a.code, a.name, a.type, a.category
      ORDER BY a.code
    `);

    const income: any[] = [];
    const expenses: any[] = [];

    rawIS.rows.forEach((row: any) => {
      const debitVal = Number(row.totalDebit);
      const creditVal = Number(row.totalCredit);
      const balance = row.accountType === "Income" ? (creditVal - debitVal) : (debitVal - creditVal);

      const item = {
        code: row.accountCode,
        name: row.accountName,
        category: row.accountCategory,
        balance,
      };

      if (row.accountType === "Income") {
        income.push(item);
      } else {
        expenses.push(item);
      }
    });

    res.json({ income, expenses });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
