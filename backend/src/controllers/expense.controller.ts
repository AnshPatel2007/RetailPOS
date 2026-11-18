import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import { expensePeriod, expenseRecordDates, expenseCalendarDate } from '../services/expenseDates.service';
import { parseListFilter } from '../utils/queryFilter.util';
import { assertOwnsRecord, getLocationFilter, isSuperAdmin, resolveWriteLocation } from '../utils/locationFilter.util';
import { assertReceiptAccess, receiptDirectory, saveReceipt } from '../services/receiptAttachment.service';
import { assertPayrollAccess, privateExpenseFilter } from '../utils/financialAccess';
import { z } from 'zod';
import { ExpenseCategory, ExpenseStatus } from '@prisma/client';
import { nextDocumentNumber } from '../services/documentNumber.service';

const expenseSchema = z.object({
  inventoryReceiptId: z.string().min(1).max(100).nullish(),
  category: z.nativeEnum(ExpenseCategory), description: z.string().trim().min(1).max(1000),
  amount: z.coerce.number().finite().positive().max(1_000_000_000), vendor: z.string().max(200).nullish(),
  receiptUrl: z.string().max(500).nullish(), invoiceNumber: z.string().max(200).nullish(),
  expenseDate: z.string().min(1).max(100).optional(), dueDate: z.string().max(100).nullish(), locationId: z.string().optional(),
});

async function validateInventoryReceipt(locationId: string, category: ExpenseCategory, receiptId?: string | null) {
  if (!receiptId) return;
  if (category !== 'INVENTORY_PURCHASE') throw new AppError('Only an inventory purchase can link to a stock receipt', 400);
  if (!await prisma.purchaseReceipt.findFirst({ where: { id: receiptId, purchaseOrder: { locationId } } })) throw new AppError('Inventory receipt is unavailable at this store', 400);
}

/**
 * Get all expenses
 * GET /api/expenses
 */
export const getAllExpenses = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { category, status, startDate, endDate, locationId, limit = 50, offset = 0 } = req.query;

  const scope = getLocationFilter(req, locationId as string);
  const { range: dateFilter, timezone } = await expensePeriod(scope, startDate, endDate);
  const where: any = { locationId: scope.locationId || { not: null }, ...privateExpenseFilter(req) };

  if (category) {
    where.category = category;
  }

  if (status) {
    where.status = status;
  }

  if (dateFilter) {
    where.expenseDate = dateFilter;
  }

  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true, timezone: true,
          },
        },
      },
      orderBy: {
        expenseDate: 'desc',
      },
      take: Math.min(200, Math.max(1, Number(limit) || 50)),
      skip: Math.max(0, Number(offset) || 0),
    }),
    prisma.expense.count({ where }),
  ]);

  res.json({
    success: true,
    data: expenses,
    period: { timezone },
    meta: {
      total,
      limit: Number(limit),
      offset: Number(offset),
    },
  });
});

/**
 * Get expense by ID
 * GET /api/expenses/:id
 */
export const getExpenseById = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      location: {
        select: {
          id: true,
          name: true, timezone: true,
        },
      },
    },
  });

  if (!expense) {
    throw new AppError('Expense not found', 404);
  }
  assertOwnsRecord(req, expense.locationId);
  assertPayrollAccess(req, expense.category);

  res.json({
    success: true,
    data: expense,
  });
});

/**
 * Create new expense
 * POST /api/expenses
 */
export const createExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    inventoryReceiptId,
    category,
    description,
    amount,
    vendor,
    receiptUrl,
    invoiceNumber,
    expenseDate,
    dueDate,
    locationId,
  } = expenseSchema.parse(req.body);

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  // Non-SUPER_ADMIN is always forced to their own store, regardless of body
  const resolvedLocationId = resolveWriteLocation(req, locationId);
  await validateInventoryReceipt(resolvedLocationId, category, inventoryReceiptId);
  assertPayrollAccess(req, category);
  if (receiptUrl) await assertReceiptAccess(req, receiptUrl);

  // Collision-safe expense number (count()+1 raced under concurrent creates)
  const expenseNumber = await nextDocumentNumber('EXP');
  const dates = await expenseRecordDates(resolvedLocationId, expenseDate, dueDate);

  const expense = await prisma.expense.create({
    data: {
      expenseNumber,
      inventoryReceiptId,
      category,
      description,
      amount,
      vendor,
      receiptUrl,
      invoiceNumber,
      expenseDate: new Date(),
      ...dates,
      userId: req.user.id,
      locationId: resolvedLocationId,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      location: {
        select: {
          id: true,
          name: true, timezone: true,
        },
      },
    },
  });

  logger.info(`Expense created: ${expenseNumber} by ${req.user.email}`);

  res.status(201).json({
    success: true,
    data: expense,
    message: 'Expense created successfully',
  });
});

/**
 * Update expense
 * PUT /api/expenses/:id
 */
export const updateExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const {
    inventoryReceiptId,
    category,
    description,
    amount,
    vendor,
    receiptUrl,
    invoiceNumber,
    expenseDate,
    dueDate,
    status,
  } = expenseSchema.omit({ locationId: true }).partial().extend({ status: z.nativeEnum(ExpenseStatus).optional() }).parse(req.body);

  const existingExpense = await prisma.expense.findUnique({
    where: { id },
  });

  if (!existingExpense) {
    throw new AppError('Expense not found', 404);
  }
  assertOwnsRecord(req, existingExpense.locationId);
  assertPayrollAccess(req, existingExpense.category);
  if (category) assertPayrollAccess(req, category);
  if (existingExpense.category === 'PAYROLL' && status !== undefined) throw new AppError('Review payroll status in Team & Time / Payroll', 400);
  if (receiptUrl) await assertReceiptAccess(req, receiptUrl);
  if (await prisma.payrollEntry.count({ where: { expenseId: id } })) {
    if (amount !== undefined || category !== undefined || expenseDate !== undefined) throw new AppError('Payroll amounts and periods come from recorded shifts and cannot be edited as a manual expense',400);
  }
  if (!existingExpense.locationId) throw new AppError('Assign this legacy expense to a store before editing it', 409);
  await validateInventoryReceipt(existingExpense.locationId, category || existingExpense.category, inventoryReceiptId === undefined ? existingExpense.inventoryReceiptId : inventoryReceiptId);
  const dates = await expenseRecordDates(existingExpense.locationId, expenseDate, dueDate);

  const expense = await prisma.expense.update({
    where: { id },
    data: {
      ...(category && { category }),
      ...(inventoryReceiptId !== undefined && { inventoryReceiptId }),
      ...(description && { description }),
      ...(amount !== undefined && { amount }),
      ...(vendor !== undefined && { vendor }),
      ...(receiptUrl !== undefined && { receiptUrl }),
      ...(invoiceNumber !== undefined && { invoiceNumber }),
      ...dates,
      ...(status && { status }),
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      location: {
        select: {
          id: true,
          name: true, timezone: true,
        },
      },
    },
  });

  logger.info(`Expense updated: ${expense.expenseNumber}`);

  res.json({
    success: true,
    data: expense,
    message: 'Expense updated successfully',
  });
});

/**
 * Delete expense
 * DELETE /api/expenses/:id
 */
export const deleteExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const expense = await prisma.expense.findUnique({
    where: { id },
  });

  if (!expense) {
    throw new AppError('Expense not found', 404);
  }
  assertOwnsRecord(req, expense.locationId);
  assertPayrollAccess(req, expense.category);

  if (await prisma.payrollEntry.count({ where: { expenseId: id } })) throw new AppError('Payroll expenses cannot be deleted. Review or reject the expense instead.',400);

  await prisma.expense.delete({
    where: { id },
  });

  logger.info(`Expense deleted: ${expense.expenseNumber}`);

  res.json({
    success: true,
    message: 'Expense deleted successfully',
  });
});

/**
 * Approve expense
 * POST /api/expenses/:id/approve
 */
export const approveExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const existingExpense = await prisma.expense.findUnique({
    where: { id },
  });

  if (!existingExpense) {
    throw new AppError('Expense not found', 404);
  }
  assertOwnsRecord(req, existingExpense.locationId);
  assertPayrollAccess(req, existingExpense.category);
  if (existingExpense.category === 'PAYROLL') throw new AppError('Review payroll in Team & Time / Payroll', 400);

  if (existingExpense.status !== 'PENDING') {
    throw new AppError('Only pending expenses can be approved', 400);
  }

  const expense = await prisma.expense.update({
    where: { id },
    data: {
      status: 'APPROVED',
      approvedBy: req.user.id,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  logger.info(`Expense approved: ${expense.expenseNumber} by ${req.user.email}`);

  res.json({
    success: true,
    data: expense,
    message: 'Expense approved successfully',
  });
});

/**
 * Reject expense
 * POST /api/expenses/:id/reject
 */
export const rejectExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const existingExpense = await prisma.expense.findUnique({
    where: { id },
  });

  if (!existingExpense) {
    throw new AppError('Expense not found', 404);
  }
  assertOwnsRecord(req, existingExpense.locationId);
  assertPayrollAccess(req, existingExpense.category);
  if (existingExpense.category === 'PAYROLL') throw new AppError('Review payroll in Team & Time / Payroll', 400);

  if (existingExpense.status !== 'PENDING') {
    throw new AppError('Only pending expenses can be rejected', 400);
  }

  const expense = await prisma.expense.update({
    where: { id },
    data: {
      status: 'REJECTED',
      approvedBy: req.user.id,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  logger.info(`Expense rejected: ${expense.expenseNumber} by ${req.user.email}`);

  res.json({
    success: true,
    data: expense,
    message: 'Expense rejected successfully',
  });
});

/**
 * Upload receipt file
 * POST /api/expenses/upload-receipt
 */
export const uploadReceipt = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  // Return the file URL
  const fileUrl = await saveReceipt(req, req.file);

  res.json({
    success: true,
    data: {
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
    },
    message: 'Receipt uploaded successfully',
  });
});

export const downloadReceipt = asyncHandler(async (req: AuthRequest, res: Response) => {
  const filename = await assertReceiptAccess(req, `/api/expenses/receipts/${req.params.filename}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.download(filename, filename, { root: receiptDirectory });
});

/**
 * Bulk approve expenses
 * POST /api/expenses/bulk-approve
 */
export const bulkApproveExpenses = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { expenseIds } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  if (!Array.isArray(expenseIds) || expenseIds.length === 0) {
    throw new AppError('No expense IDs provided', 400);
  }

  if (!isSuperAdmin(req)) {
    const targets = await prisma.expense.findMany({
      where: { id: { in: expenseIds } },
      select: { id: true, locationId: true, category: true },
    });
    for (const t of targets) {
      assertOwnsRecord(req, t.locationId);
      assertPayrollAccess(req, t.category);
        if (t.category === 'PAYROLL') throw new AppError('Review payroll in Team & Time / Payroll', 400);
    }
  }

  // Update all pending expenses
  const result = await prisma.expense.updateMany({
    where: {
      id: { in: expenseIds },
      status: 'PENDING',
    },
    data: {
      status: 'APPROVED',
      approvedBy: req.user.id,
    },
  });

  logger.info(`Bulk approved ${result.count} expenses by ${req.user.email}`);

  res.json({
    success: true,
    data: { count: result.count },
    message: `${result.count} expense(s) approved successfully`,
  });
});

/**
 * Bulk reject expenses
 * POST /api/expenses/bulk-reject
 */
export const bulkRejectExpenses = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { expenseIds } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  if (!Array.isArray(expenseIds) || expenseIds.length === 0) {
    throw new AppError('No expense IDs provided', 400);
  }

  if (!isSuperAdmin(req)) {
    const targets = await prisma.expense.findMany({
      where: { id: { in: expenseIds } },
      select: { id: true, locationId: true, category: true },
    });
    for (const t of targets) {
      assertOwnsRecord(req, t.locationId);
      assertPayrollAccess(req, t.category);
        if (t.category === 'PAYROLL') throw new AppError('Review payroll in Team & Time / Payroll', 400);
    }
  }

  // Update all pending expenses
  const result = await prisma.expense.updateMany({
    where: {
      id: { in: expenseIds },
      status: 'PENDING',
    },
    data: {
      status: 'REJECTED',
      approvedBy: req.user.id,
    },
  });

  logger.info(`Bulk rejected ${result.count} expenses by ${req.user.email}`);

  res.json({
    success: true,
    data: { count: result.count },
    message: `${result.count} expense(s) rejected successfully`,
  });
});

/** The same rows the Expenses list shows: its search box, amount range and, unless a
 * status is chosen, everything except rejected expenses. */
function listedExpenseFilter(query: AuthRequest['query'], hasStatus: boolean): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (!hasStatus) filter.status = { not: 'REJECTED' };
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search) filter.OR = ['expenseNumber', 'description', 'vendor', 'invoiceNumber']
    .map(field => ({ [field]: { contains: search, mode: 'insensitive' } }));
  const min = Number(query.minAmount), max = Number(query.maxAmount);
  const amount: Record<string, number> = {};
  if (query.minAmount !== undefined && query.minAmount !== '' && Number.isFinite(min)) amount.gte = min;
  if (query.maxAmount !== undefined && query.maxAmount !== '' && Number.isFinite(max)) amount.lte = max;
  if (Object.keys(amount).length) filter.amount = amount;
  return filter;
}

/**
 * Export expenses to CSV
 * GET /api/expenses/export/csv
 */
export const exportExpensesCSV = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { Parser } = require('json2csv');
  const { category, status, startDate, endDate, locationId } = req.query;

  const scope = getLocationFilter(req, locationId as string);
  const { range: dateFilter, timezone } = await expensePeriod(scope, startDate, endDate);
  const where: any = { locationId: scope.locationId || { not: null }, ...privateExpenseFilter(req) };

  const categoryFilter = parseListFilter(category);
  if (categoryFilter) where.category = categoryFilter;
  const statusFilter = parseListFilter(status);
  if (statusFilter) where.status = statusFilter;
  Object.assign(where, listedExpenseFilter(req.query, !!statusFilter));

  if (dateFilter) {
    where.expenseDate = dateFilter;
  }

  const expenses = await prisma.expense.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true } },
      location: { select: { name: true, timezone: true } },
    },
    orderBy: { expenseDate: 'desc' },
  });

  // Transform data for CSV
  const csvData = expenses.map((exp) => ({
    'Expense Number': exp.expenseNumber,
    'Date': expenseCalendarDate(exp.expenseDate, timezone),
    'Category': exp.category,
    'Description': exp.description,
    'Vendor': exp.vendor || '',
    'Invoice Number': exp.invoiceNumber || '',
    'Amount': exp.amount,
    'Status': exp.status,
    'Location': exp.location?.name || '',
    'Created By': `${exp.user.firstName} ${exp.user.lastName}`,
    'Due Date': exp.dueDate ? expenseCalendarDate(exp.dueDate, timezone) : '',
    'Paid Date': exp.paidDate ? expenseCalendarDate(exp.paidDate, timezone) : '',
  }));

  const parser = new Parser();
  const csv = parser.parse(csvData);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=expenses-export.csv');
  res.send(csv);
});

/**
 * Export expenses to PDF
 * GET /api/expenses/export/pdf
 */
export const exportExpensesPDF = asyncHandler(async (req: AuthRequest, res: Response) => {
  const PDFDocument = require('pdfkit');
  const { category, status, startDate, endDate, locationId } = req.query;

  const scope = getLocationFilter(req, locationId as string);
  const { range: dateFilter, timezone } = await expensePeriod(scope, startDate, endDate);
  const where: any = { locationId: scope.locationId || { not: null }, ...privateExpenseFilter(req) };

  const categoryFilter = parseListFilter(category);
  if (categoryFilter) where.category = categoryFilter;
  const statusFilter = parseListFilter(status);
  if (statusFilter) where.status = statusFilter;
  Object.assign(where, listedExpenseFilter(req.query, !!statusFilter));

  if (dateFilter) {
    where.expenseDate = dateFilter;
  }

  const expenses = await prisma.expense.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true } },
      location: { select: { name: true, timezone: true } },
    },
    orderBy: { expenseDate: 'desc' },
  });

  // Calculate summary
  const totalExpenses = expenses.reduce((sum, exp) => sum + Number(exp.amount), 0);
  const avgExpense = expenses.length > 0 ? totalExpenses / expenses.length : 0;

  const byStatus = expenses.reduce((acc: any, exp) => {
    if (!acc[exp.status]) acc[exp.status] = { count: 0, total: 0 };
    acc[exp.status].count++;
    acc[exp.status].total += Number(exp.amount);
    return acc;
  }, {});

  const byCategory = expenses.reduce((acc: any, exp) => {
    if (!acc[exp.category]) acc[exp.category] = { count: 0, total: 0 };
    acc[exp.category].count++;
    acc[exp.category].total += Number(exp.amount);
    return acc;
  }, {});

  // PDF helpers (same as report controller)
  const PRIMARY = '#2563eb';
  const DARK = '#1e293b';
  const MUTED = '#64748b';
  const BG = '#f8fafc';

  const doc = new PDFDocument({ margin: 50, bufferPages: true });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=expense-report.pdf');
  doc.pipe(res);

  // Header banner
  doc.rect(0, 0, doc.page.width, 80).fill(PRIMARY);
  doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold')
    .text('Expense Report', 50, 25);
  doc.fontSize(10).font('Helvetica').text('POS System', 50, 52);
  doc.fontSize(9).text(`Generated: ${new Date().toLocaleString()}`, doc.page.width - 250, 30, { width: 200, align: 'right' });
  if (startDate || endDate) {
    doc.text(`Period: ${startDate || 'All'} to ${endDate || 'All'}`, doc.page.width - 250, 45, { width: 200, align: 'right' });
  }
  doc.fillColor(DARK);
  doc.y = 100;

  // Summary boxes
  const summaryItems = [
    { label: 'TOTAL EXPENSES', value: `$${totalExpenses.toFixed(2)}` },
    { label: 'NUMBER OF EXPENSES', value: expenses.length.toString() },
    { label: 'AVERAGE EXPENSE', value: `$${avgExpense.toFixed(2)}` },
  ];
  const boxW = (doc.page.width - 100) / 3;
  const sy = doc.y;
  doc.rect(50, sy, doc.page.width - 100, 50).fill(BG).stroke('#e2e8f0');
  summaryItems.forEach((item, i) => {
    const x = 50 + i * boxW + 15;
    doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(item.label, x, sy + 10);
    doc.fillColor(DARK).fontSize(13).font('Helvetica-Bold').text(item.value, x, sy + 22);
  });
  doc.fillColor(DARK);
  doc.y = sy + 65;

  // By Status
  doc.fillColor(PRIMARY).fontSize(12).font('Helvetica-Bold').text('Expenses by Status');
  doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor(PRIMARY).lineWidth(1.5).stroke();
  doc.moveDown(0.5);

  const statusHeader = [
    { label: 'STATUS', x: 60, width: 120 },
    { label: 'COUNT', x: 200, width: 80, align: 'right' },
    { label: 'AMOUNT', x: 300, width: 100, align: 'right' },
    { label: '% OF TOTAL', x: 420, width: 80, align: 'right' },
  ];
  let ty = doc.y;
  doc.rect(50, ty, doc.page.width - 100, 18).fill('#eef2ff');
  doc.fillColor(DARK).fontSize(8).font('Helvetica-Bold');
  statusHeader.forEach(c => doc.text(c.label, c.x, ty + 5, { width: c.width, align: (c.align as any) || 'left' }));
  doc.font('Helvetica');
  doc.y = ty + 20;

  Object.entries(byStatus).forEach(([s, d]: [string, any], i) => {
    const ry = doc.y;
    if (i % 2 === 0) doc.rect(50, ry - 1, doc.page.width - 100, 15).fill(BG);
    doc.fillColor(DARK).fontSize(8);
    doc.text(s, 60, ry + 2, { width: 120 });
    doc.text(d.count.toString(), 200, ry + 2, { width: 80, align: 'right' });
    doc.text(`$${d.total.toFixed(2)}`, 300, ry + 2, { width: 100, align: 'right' });
    doc.text(`${(d.total / totalExpenses * 100).toFixed(1)}%`, 420, ry + 2, { width: 80, align: 'right' });
    doc.y = ry + 15;
  });

  // By Category
  doc.moveDown(1);
  doc.fillColor(PRIMARY).fontSize(12).font('Helvetica-Bold').text('Expenses by Category');
  doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor(PRIMARY).lineWidth(1.5).stroke();
  doc.moveDown(0.5);

  ty = doc.y;
  doc.rect(50, ty, doc.page.width - 100, 18).fill('#eef2ff');
  doc.fillColor(DARK).fontSize(8).font('Helvetica-Bold');
  doc.text('CATEGORY', 60, ty + 5, { width: 150 });
  doc.text('COUNT', 220, ty + 5, { width: 80, align: 'right' });
  doc.text('AMOUNT', 320, ty + 5, { width: 100, align: 'right' });
  doc.text('% OF TOTAL', 440, ty + 5, { width: 80, align: 'right' });
  doc.font('Helvetica');
  doc.y = ty + 20;

  Object.entries(byCategory).sort((a: any, b: any) => b[1].total - a[1].total).forEach(([c, d]: [string, any], i) => {
    const ry = doc.y;
    if (i % 2 === 0) doc.rect(50, ry - 1, doc.page.width - 100, 15).fill(BG);
    doc.fillColor(DARK).fontSize(8);
    doc.text(c, 60, ry + 2, { width: 150 });
    doc.text(d.count.toString(), 220, ry + 2, { width: 80, align: 'right' });
    doc.text(`$${d.total.toFixed(2)}`, 320, ry + 2, { width: 100, align: 'right' });
    doc.text(`${(d.total / totalExpenses * 100).toFixed(1)}%`, 440, ry + 2, { width: 80, align: 'right' });
    doc.y = ry + 15;
  });

  // Expense details
  doc.addPage();
  doc.fillColor(PRIMARY).fontSize(12).font('Helvetica-Bold').text(`Expense Details (${expenses.length} records)`);
  doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor(PRIMARY).lineWidth(1.5).stroke();
  doc.moveDown(0.5);

  ty = doc.y;
  doc.rect(50, ty, doc.page.width - 100, 18).fill('#eef2ff');
  doc.fillColor(DARK).fontSize(7).font('Helvetica-Bold');
  doc.text('EXP #', 50, ty + 5, { width: 65 });
  doc.text('DATE', 115, ty + 5, { width: 55 });
  doc.text('DESCRIPTION', 170, ty + 5, { width: 110 });
  doc.text('CATEGORY', 280, ty + 5, { width: 65 });
  doc.text('VENDOR', 345, ty + 5, { width: 70 });
  doc.text('STATUS', 415, ty + 5, { width: 45 });
  doc.text('AMOUNT', 460, ty + 5, { width: 85, align: 'right' });
  doc.font('Helvetica');
  doc.y = ty + 20;

  expenses.forEach((exp, i) => {
    if (doc.y > doc.page.height - 50) doc.addPage();
    const ry = doc.y;
    if (i % 2 === 0) doc.rect(50, ry - 1, doc.page.width - 100, 15).fill(BG);
    doc.fillColor(DARK).fontSize(7);
    doc.text(exp.expenseNumber, 50, ry + 2, { width: 65 });
    doc.text(expenseCalendarDate(exp.expenseDate, timezone), 115, ry + 2, { width: 55 });
    doc.text(exp.description.substring(0, 22), 170, ry + 2, { width: 110 });
    doc.text(exp.category.substring(0, 12), 280, ry + 2, { width: 65 });
    doc.text((exp.vendor || '-').substring(0, 12), 345, ry + 2, { width: 70 });
    doc.text(exp.status, 415, ry + 2, { width: 45 });
    doc.text(`$${exp.amount.toFixed(2)}`, 460, ry + 2, { width: 85, align: 'right' });
    doc.y = ry + 15;
  });

  // Footer with page numbers
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(MUTED).fontSize(7).font('Helvetica');
    doc.text(`Page ${i + 1} of ${pages.count}`, 50, doc.page.height - 30, { align: 'center', width: doc.page.width - 100 });
  }

  doc.end();
});
