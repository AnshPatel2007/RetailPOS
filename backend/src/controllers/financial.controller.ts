import { getSalesReportData } from '../services/salesReport.service';
import { nextDocumentNumber } from '../services/documentNumber.service';
import { Response } from 'express';
import { getProfitAndLossWorkbook } from '../services/profitAndLossWorkbook.service';
import { getReportRange, reportCalendar } from '../services/reportDates.service';
import { getFinancialMetrics } from '../services/financialMetrics.service';
import { expenseDebitAccount, isInventoryPurchase } from '../services/expenseAccounting.service';
import { expenseCalendarDate } from '../services/expenseDates.service';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { getLocationFilter, assertOwnsRecord, resolveWriteLocation } from '../utils/locationFilter.util';
import { z } from 'zod';
import { privateExpenseFilter } from '../utils/financialAccess';
import { BudgetPeriod, ExpenseCategory, RecurringFrequency } from '@prisma/client';

const positiveMoney = z.coerce.number().finite().positive().max(1_000_000_000);
const validDate = z.coerce.date();
const budgetSchema = z.object({ category: z.nativeEnum(ExpenseCategory), amount: positiveMoney,
  period: z.nativeEnum(BudgetPeriod).default('MONTHLY'), startDate: validDate,
  endDate: validDate.nullish(), locationId: z.string().min(1).optional(), alertAt: z.coerce.number().min(0).max(100).nullish() });
const recurringSchema = z.object({ description: z.string().trim().min(1).max(500), category: z.nativeEnum(ExpenseCategory),
  amount: positiveMoney, vendor: z.string().max(200).nullish(), frequency: z.nativeEnum(RecurringFrequency),
  dayOfMonth: z.coerce.number().int().min(1).max(31).nullish(), dayOfWeek: z.coerce.number().int().min(0).max(6).nullish(),
  startDate: validDate, endDate: validDate.nullish(), locationId: z.string().min(1).optional() });
const checkPayroll = (req: AuthRequest, category: string) => {
  if (category === 'PAYROLL' && req.user?.role !== 'ADMIN') throw new AppError('Payroll records are owner-only', 403);
};
const ownBudget = async (req: AuthRequest, id: string) => {
  const record = await prisma.budget.findUnique({ where: { id } });
  if (!record) throw new AppError('Budget not found', 404);
  assertOwnsRecord(req, record.locationId); checkPayroll(req, record.category); return record;
};
const ownRecurring = async (req: AuthRequest, id: string) => {
  const record = await prisma.recurringExpense.findUnique({ where: { id } });
  if (!record) throw new AppError('Recurring expense not found', 404);
  assertOwnsRecord(req, record.locationId); checkPayroll(req, record.category); return record;
};

/** Round a number to 2 decimal places (currency precision) */
const rc = (n: number) => Math.round(n * 100) / 100;

// ==================== BUDGETS ====================

/**
 * Get all budgets
 * GET /api/financial/budgets
 */
export const getBudgets = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { category, period, locationId, isActive } = req.query;

  const where: any = { ...getLocationFilter(req, locationId as string), ...privateExpenseFilter(req) };
  if (category) where.category = category;
  if (period) where.period = period;
  if (isActive !== undefined) where.isActive = isActive === 'true';

  const budgets = await prisma.budget.findMany({
    where,
    include: {
      location: { select: { name: true } },
    },
    orderBy: { category: 'asc' },
  });

  // Get actual spending for each budget
  const budgetsWithSpending = await Promise.all(
    budgets.map(async (budget) => {
      const spending = await prisma.expense.aggregate({
        where: {
          category: budget.category,
          expenseDate: {
            gte: budget.startDate,
            lte: budget.endDate || new Date(),
          },
          status: { in: ['APPROVED', 'PAID'] },
          ...(budget.locationId && { locationId: budget.locationId }),
        },
        _sum: { amount: true },
      });

      const spent = spending._sum.amount || 0;
      const remaining = Number(budget.amount) - Number(spent);
      const percentUsed = Number(budget.amount) > 0 ? (Number(spent) / Number(budget.amount)) * 100 : 0;

      return {
        ...budget,
        spent,
        remaining,
        percentUsed: Math.round(percentUsed * 10) / 10,
        isOverBudget: Number(spent) > Number(budget.amount),
        isNearLimit: budget.alertAt ? percentUsed >= Number(budget.alertAt) : false,
      };
    })
  );

  res.json({
    success: true,
    data: budgetsWithSpending,
  });
});

/**
 * Create a budget
 * POST /api/financial/budgets
 */
export const createBudget = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { category, amount, period, startDate, endDate, locationId, alertAt } = budgetSchema.parse(req.body);
  checkPayroll(req, category);
  if (endDate && endDate < startDate) throw new AppError('End date must not precede start date', 400);

  const budget = await prisma.budget.create({
    data: {
      category,
      amount,
      period: period || 'MONTHLY',
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      locationId: resolveWriteLocation(req, locationId),
      alertAt,
    },
    include: {
      location: { select: { name: true } },
    },
  });

  res.status(201).json({
    success: true,
    data: budget,
  });
});

/**
 * Update a budget
 * PUT /api/financial/budgets/:id
 */
export const updateBudget = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { amount, endDate, alertAt, isActive } = budgetSchema.pick({ amount: true, endDate: true, alertAt: true }).partial().extend({ isActive: z.boolean().optional() }).parse(req.body);

  const existing = await ownBudget(req, id);
  if (endDate && endDate < existing.startDate) throw new AppError('End date must not precede start date', 400);

  const budget = await prisma.budget.update({
    where: { id },
    data: {
      ...(amount !== undefined && { amount }),
      ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
      ...(alertAt !== undefined && { alertAt }),
      ...(isActive !== undefined && { isActive }),
    },
    include: {
      location: { select: { name: true } },
    },
  });

  res.json({
    success: true,
    data: budget,
  });
});

/**
 * Delete a budget
 * DELETE /api/financial/budgets/:id
 */
export const deleteBudget = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  await ownBudget(req, id);

  await prisma.budget.delete({
    where: { id },
  });

  res.json({
    success: true,
    message: 'Budget deleted successfully',
  });
});

/**
 * Get budget summary by category
 * GET /api/financial/budgets/summary
 */
export const getBudgetSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const locationFilter = getLocationFilter(req, req.query.locationId as string);

  // Get all active monthly budgets
  const budgets = await prisma.budget.findMany({
    where: {
      isActive: true,
      period: 'MONTHLY',
      startDate: { lte: now },
      OR: [
        { endDate: null },
        { endDate: { gte: now } },
      ],
      ...locationFilter,
    },
  });

  // Get spending by category for current month
  const spending = await prisma.expense.groupBy({
    by: ['category'],
    where: {
      expenseDate: { gte: monthStart },
      status: { in: ['APPROVED', 'PAID'] },
      ...locationFilter,
    },
    _sum: { amount: true },
  });

  const spendingMap = new Map(spending.map(s => [s.category, s._sum.amount || 0]));

  const summary = budgets.map(budget => {
    const spent = spendingMap.get(budget.category) || 0;
    const percentUsed = Number(budget.amount) > 0 ? (Number(spent) / Number(budget.amount)) * 100 : 0;

    return {
      category: budget.category,
      budgeted: budget.amount,
      spent,
      remaining: rc(Number(budget.amount) - Number(spent)),
      percentUsed: Math.round(percentUsed * 10) / 10,
      status: Number(spent) > Number(budget.amount) ? 'over' : percentUsed >= 80 ? 'warning' : 'ok',
    };
  });

  const totalBudgeted = rc(summary.reduce((sum, s) => sum + Number(s.budgeted), 0));
  const totalSpent = rc(summary.reduce((sum, s) => sum + Number(s.spent), 0));

  res.json({
    success: true,
    data: {
      categories: summary,
      totals: {
        budgeted: totalBudgeted,
        spent: totalSpent,
        remaining: rc(totalBudgeted - totalSpent),
        percentUsed: totalBudgeted > 0 ? Math.round((totalSpent / totalBudgeted) * 1000) / 10 : 0,
      },
    },
  });
});

// ==================== RECURRING EXPENSES ====================

/**
 * Get all recurring expenses
 * GET /api/financial/recurring-expenses
 */
export const getRecurringExpenses = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { category, isActive } = req.query;

  const where: any = { ...getLocationFilter(req, req.query.locationId as string), ...privateExpenseFilter(req) };
  if (category) where.category = category;
  if (isActive !== undefined) where.isActive = isActive === 'true';

  const recurring = await prisma.recurringExpense.findMany({
    where,
    include: {
      location: { select: { name: true } },
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { nextDueDate: 'asc' },
  });

  res.json({
    success: true,
    data: recurring,
  });
});

/**
 * Create a recurring expense
 * POST /api/financial/recurring-expenses
 */
export const createRecurringExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const {
    description,
    category,
    amount,
    vendor,
    frequency,
    dayOfMonth,
    dayOfWeek,
    startDate,
    endDate,
    locationId,
  } = recurringSchema.parse(req.body);
  checkPayroll(req, category);
  if (endDate && endDate < startDate) throw new AppError('End date must not precede start date', 400);

  // Calculate next due date
  const start = new Date(startDate);
  let nextDueDate = new Date(start);

  if (frequency === 'MONTHLY' && dayOfMonth) {
    nextDueDate.setUTCDate(dayOfMonth);
    if (nextDueDate < start) {
      nextDueDate.setUTCMonth(nextDueDate.getUTCMonth() + 1);
    }
  }

  const recurring = await prisma.recurringExpense.create({
    data: {
      description,
      category,
      amount,
      vendor,
      frequency,
      dayOfMonth,
      dayOfWeek,
      startDate: start,
      endDate: endDate ? new Date(endDate) : null,
      nextDueDate,
      locationId: resolveWriteLocation(req, locationId),
      userId,
    },
    include: {
      location: { select: { name: true } },
      user: { select: { firstName: true, lastName: true } },
    },
  });

  res.status(201).json({
    success: true,
    data: recurring,
  });
});

/**
 * Update a recurring expense
 * PUT /api/financial/recurring-expenses/:id
 */
export const updateRecurringExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { description, amount, vendor, endDate, isActive } = recurringSchema.pick({ description: true, amount: true, vendor: true, endDate: true }).partial().extend({ isActive: z.boolean().optional() }).parse(req.body);

  const existing = await ownRecurring(req, id);
  if (endDate && endDate < existing.startDate) throw new AppError('End date must not precede start date', 400);

  const recurring = await prisma.recurringExpense.update({
    where: { id },
    data: {
      ...(description && { description }),
      ...(amount !== undefined && { amount }),
      ...(vendor !== undefined && { vendor }),
      ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
      ...(isActive !== undefined && { isActive }),
    },
    include: {
      location: { select: { name: true } },
      user: { select: { firstName: true, lastName: true } },
    },
  });

  res.json({
    success: true,
    data: recurring,
  });
});

/**
 * Delete a recurring expense
 * DELETE /api/financial/recurring-expenses/:id
 */
export const deleteRecurringExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  await ownRecurring(req, id);

  await prisma.recurringExpense.delete({
    where: { id },
  });

  res.json({
    success: true,
    message: 'Recurring expense deleted successfully',
  });
});

/**
 * Generate due recurring expenses
 * POST /api/financial/recurring-expenses/generate
 */
export const generateRecurringExpenses = asyncHandler(async (req: AuthRequest, res: Response) => {
  const now = new Date();
  const scope = getLocationFilter(req, req.query.locationId as string);
  // Recurring dates are calendar days kept at UTC midnight. One is due once the store's own
  // date reaches it, so a US store is not charged the evening before. (+14 h covers every zone;
  // each store's exact day is checked below.)
  const due = await prisma.recurringExpense.findMany({
    where: { ...scope, isActive: true, nextDueDate: { lte: new Date(now.getTime() + 14 * 3600_000) },
      ...(req.user?.role !== 'ADMIN' ? { category: { not: 'PAYROLL' as const } } : {}) },
    select: { id: true }, orderBy: { id: 'asc' }, take: 1000,
  });
  const generated = [];
  for (const row of due) {
    const entries = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM recurring_expenses WHERE id = ${row.id} FOR UPDATE`;
      const recurring = await tx.recurringExpense.findUniqueOrThrow({ where: { id: row.id } });
      assertOwnsRecord(req, recurring.locationId);
      if (!recurring.isActive) return [];
      const store = await tx.location.findUnique({ where: { id: recurring.locationId! }, select: { timezone: true } });
      const calendar = reportCalendar(store?.timezone || 'UTC', now);
      const storeToday = new Date(Date.UTC(calendar.year, calendar.month - 1, calendar.dayOfMonth));
      // An expense is dated at the store's midnight of its calendar day, like any typed expense.
      const storeDay = (day: Date) => calendar.midnight(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
      const created = [];
      let nextDate = new Date(recurring.nextDueDate);
      for (let i = 0; i < 366 && nextDate <= storeToday && (!recurring.endDate || nextDate <= recurring.endDate); i++) {
        const number = 'REC-' + recurring.id + '-' + nextDate.getTime();
        const exists = await tx.expense.findFirst({ where: { OR: [{ referenceKey: number }, { expenseNumber: number }] } });
        if (!exists) created.push(await tx.expense.create({ data: {
          expenseNumber: await nextDocumentNumber('EXP', tx), referenceKey: number, category: recurring.category,
          description: recurring.description + ' (Auto-generated)', amount: recurring.amount,
          vendor: recurring.vendor, expenseDate: storeDay(nextDate), locationId: recurring.locationId,
          userId: recurring.userId, status: 'PENDING',
        } }));
        const next = new Date(nextDate);
        const days = ({ DAILY: 1, WEEKLY: 7, BIWEEKLY: 14 } as Record<string, number>)[recurring.frequency];
        if (days) next.setUTCDate(next.getUTCDate() + days);
        else {
          const months = ({ MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 } as Record<string, number>)[recurring.frequency];
          if (!months) throw new AppError('Unsupported recurring frequency', 400);
          const day = recurring.dayOfMonth || recurring.startDate.getUTCDate();
          next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + months);
          const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
          next.setUTCDate(Math.min(day, last));
        }
        nextDate = next;
      }
      await tx.recurringExpense.update({ where: { id: recurring.id }, data: { nextDueDate: nextDate, lastGenerated: now } });
      return created;
    });
    generated.push(...entries);
  }
  res.json({ success: true, data: { generated: generated.length, expenses: generated } });
});

// ==================== ACCOUNTING EXPORTS ====================

/**
 * Export sales for accounting
 * GET /api/financial/export/sales
 */
export const exportSales = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, format = 'CSV' } = req.query;

  const locationFilter = getLocationFilter(req, req.query.locationId as string);
  const { start, end, timezone, endExclusive } = await getReportRange(locationFilter, startDate, endDate, 'month');

  const report = await getSalesReportData({ ...req, query: { ...req.query, startDate: start!.toISOString(), endDate: endDate || end.toISOString() } } as unknown as AuthRequest, { forExport: true });
  const journalEntries = [...report.entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).map(entry => ({
    date: expenseCalendarDate(entry.createdAt, timezone), reference: entry.saleNumber, entry: entry.sourceType === 'DAILY_SUMMARY' ? 'DAILY_SUMMARY' : entry.kind,
    description: entry.sourceType === 'DAILY_SUMMARY' ? 'Historical daily sales summary' : entry.kind === 'SALE' ? 'Sale to ' + entry.customer : entry.kind + ' on sale ' + entry.saleNumber,
    debitAccount: entry.sourceType === 'DAILY_SUMMARY' ? 'Historical settlement not supplied' : entry.kind === 'SALE' ? 'Cash/AR' : entry.kind === 'VOID' ? 'Sales Voids' : 'Sales Returns',
    creditAccount: entry.kind === 'SALE' ? 'Sales Revenue' : 'Cash/AR',
    amount: entry.total, taxAmount: entry.tax, paymentMethod: entry.sourceType === 'DAILY_SUMMARY' ? 'Card recorded; remainder unspecified' : entry.method,
  })).sort((a, b) => a.date.localeCompare(b.date));

  // Log the export
  await prisma.accountingExport.create({
    data: {
      type: 'SALES',
      format: format as string,
      startDate: start!,
      // Store the last instant covered, so the history shows the chosen last day, not the next one.
      endDate: endExclusive ? new Date(end.getTime() - 1) : end,
      recordCount: journalEntries.length,
      userId: req.user!.id,
      locationId: locationFilter.locationId,
    },
  });

  res.json({
    success: true,
    data: {
      period: { start, end, timezone, endExclusive },
      recordCount: journalEntries.length,
      totalRevenue: report.summary.totalSales, totalTax: report.summary.totalTax, netSales: report.summary.netSales,
      historyWarning: report.historyWarning, voids: report.summary.voids,
      unavailableReason: report.summary.totalTax === null ? 'Original refund tax allocations are unavailable.' : null,
      entries: journalEntries,
    },
  });
});

/**
 * Export expenses for accounting
 * GET /api/financial/export/expenses
 */
export const exportExpenses = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, format = 'CSV' } = req.query;

  const locationFilter = getLocationFilter(req, req.query.locationId as string);
  const { range, start, end, timezone, endExclusive } = await getReportRange(locationFilter, startDate, endDate, 'month');
  const assignedStore = { locationId: locationFilter.locationId || { not: null } };
  const calendarDate = (date: Date) => expenseCalendarDate(date, timezone);

  const expenses = await prisma.expense.findMany({
    where: {
      ...privateExpenseFilter(req),
      expenseDate: range,
      status: { in: ['APPROVED', 'PAID'] },
      ...assignedStore,
    },
    include: {
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { expenseDate: 'asc' },
  });

  // Format for accounting export
  const journalEntries = expenses.map(expense => ({
    date: calendarDate(expense.expenseDate),
    reference: expense.expenseNumber,
    description: expense.description,
    debitAccount: expenseDebitAccount(expense.category),
    creditAccount: expense.sourceType === 'MONTHLY_SUMMARY' ? 'Historical settlement not supplied' : expense.status === 'PAID' ? 'Cash/Bank' : 'Accounts Payable',
    amount: Number(expense.amount),
    vendor: expense.vendor,
    category: expense.category,
  }));

  // Non-owners receive aggregate payroll cost without employee names, rates,
  // individual obligations or attachments. Do not understate expenses.
  if (req.user!.role !== 'ADMIN') {
    const payroll = await prisma.expense.groupBy({
      by: ['status'],
      where: { ...assignedStore, category: 'PAYROLL', status: { in: ['APPROVED', 'PAID'] }, expenseDate: range },
      _sum: { amount: true },
    });
    for (const row of payroll) journalEntries.push({
      date: calendarDate(new Date(end.getTime() - Number(endExclusive))), reference: `PAYROLL-SUMMARY-${row.status}`,
      description: 'Aggregate payroll expense for the selected period',
      debitAccount: 'Expense - PAYROLL', creditAccount: row.status === 'PAID' ? 'Cash/Bank' : 'Accounts Payable',
      amount: rc(Number(row._sum.amount || 0)), vendor: null, category: 'PAYROLL',
    });
  }

  // Log the export
  await prisma.accountingExport.create({
    data: {
      type: 'EXPENSES',
      format: format as string,
      startDate: start!,
      // Store the last instant covered, so the history shows the chosen last day, not the next one.
      endDate: endExclusive ? new Date(end.getTime() - 1) : end,
      recordCount: journalEntries.length,
      userId: req.user!.id,
      locationId: locationFilter.locationId,
    },
  });

  res.json({
    success: true,
    data: {
      period: { start, end, timezone, endExclusive },
      recordCount: journalEntries.length,
      totalExpenses: rc(journalEntries.reduce((sum, e) => sum + Number(e.amount), 0)),
      operatingExpenses: rc(journalEntries.filter(e => !isInventoryPurchase(e.category)).reduce((sum, e) => sum + Number(e.amount), 0)),
      inventoryPurchases: rc(journalEntries.filter(e => isInventoryPurchase(e.category)).reduce((sum, e) => sum + Number(e.amount), 0)),
      byCategory: Object.fromEntries(
        Object.entries(
          journalEntries.reduce((acc: any, e) => {
            acc[e.category] = (acc[e.category] || 0) + Number(e.amount);
            return acc;
          }, {})
        )
      ),
      entries: journalEntries,
    },
  });
});

/**
 * Generate P&L report
 * GET /api/financial/reports/pnl
 */
export const getProfitAndLoss = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate } = req.query;

  const locationFilter = getLocationFilter(req, req.query.locationId as string);
  const { range, start, end, timezone, endExclusive } = await getReportRange(locationFilter, startDate, endDate, 'year');

  const { metrics, expensesByCategory, store, snapshotAt, workbook } = await prisma.$transaction(async tx => {
    const metrics = await getFinancialMetrics(locationFilter, range, tx);
    const expensesByCategory = await tx.expense.groupBy({ by: ['category'],
      where: { expenseDate: range, status: { in: ['APPROVED', 'PAID'] }, locationId: locationFilter.locationId || { not: null } },
      _sum: { amount: true } });
    const store = locationFilter.locationId ? await tx.location.findUniqueOrThrow({ where: { id: locationFilter.locationId }, select: { id: true, name: true } }) : null;
    const workbook = req.query.workbook === 'true' ? await getProfitAndLossWorkbook(tx, locationFilter, range, timezone) : undefined;
    return { metrics, expensesByCategory, store, snapshotAt: new Date(), workbook };
  }, { isolationLevel: 'RepeatableRead', timeout: 60000 });

  res.json({ success: true, data: {
    scope: { locationId: store?.id || null, storeName: store?.name || 'All stores' }, snapshotAt, workbook,
    period: { start, end, timezone, endExclusive },
    revenue: { grossSales: metrics.grossSales, refunds: metrics.refundsBeforeTax,
      netSales: metrics.netSales, taxCollected: metrics.netTax, voids: metrics.voidsBeforeTax,
      grossCollected: metrics.grossCollected, netCollected: metrics.netCollected },
    costOfGoodsSold: metrics.costOfGoodsSold, grossProfit: metrics.grossProfit,
    recordedSaleCosts: metrics.recordedSaleCosts, inventoryCostAdjustments: metrics.inventoryCostAdjustments,
    costCompleteness: metrics.costCompleteness, receivedInventoryPurchases: metrics.receivedInventoryPurchases,
    operatingExpenses: { total: metrics.expenses, byCategory: expensesByCategory.filter(e => !isInventoryPurchase(e.category)).map(e => ({ category: e.category, amount: rc(Number(e._sum.amount || 0)) })) },
    inventoryPurchases: metrics.inventoryPurchases, recordedExpenses: metrics.recordedExpenses,
    otherIncome: metrics.otherIncome, lotteryEarnings: metrics.lotteryEarnings, earningsCompleteness: metrics.earningsCompleteness,
    netIncome: metrics.netProfit, margins: { gross: metrics.grossMargin, net: metrics.netProfit !== null && metrics.netSales ? rc(metrics.netProfit / metrics.netSales * 100) : null },
    costBasis: metrics.costBasis, unavailableReason: metrics.unavailableReason, provisionalReason: metrics.provisionalReason, historyWarning: metrics.historyWarning,
    estimate: null, defaultCostView: 'recorded',
  } });
});

/**
 * Get export history
 * GET /api/financial/exports
 */
export const getExportHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
  const exports = await prisma.accountingExport.findMany({
    where: getLocationFilter(req, req.query.locationId as string),
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json({
    success: true,
    data: exports,
  });
});
