import { Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { parseEndDate } from '../utils/dateFilter.util';
import { getLocationFilter } from '../utils/locationFilter.util';

/** Round a number to 2 decimal places (currency precision) */
const rc = (n: number) => Math.round(n * 100) / 100;

// ==================== BUDGETS ====================

/**
 * Get all budgets
 * GET /api/financial/budgets
 */
export const getBudgets = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { category, period, locationId, isActive } = req.query;

  const where: any = { ...getLocationFilter(req, locationId as string) };
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
      const remaining = budget.amount - spent;
      const percentUsed = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;

      return {
        ...budget,
        spent,
        remaining,
        percentUsed: Math.round(percentUsed * 10) / 10,
        isOverBudget: spent > budget.amount,
        isNearLimit: budget.alertAt ? percentUsed >= budget.alertAt : false,
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
  const { category, amount, period, startDate, endDate, locationId, alertAt } = req.body;

  const budget = await prisma.budget.create({
    data: {
      category,
      amount,
      period: period || 'MONTHLY',
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      locationId,
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
  const { amount, endDate, alertAt, isActive } = req.body;

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
    const percentUsed = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;

    return {
      category: budget.category,
      budgeted: budget.amount,
      spent,
      remaining: rc(budget.amount - spent),
      percentUsed: Math.round(percentUsed * 10) / 10,
      status: spent > budget.amount ? 'over' : percentUsed >= 80 ? 'warning' : 'ok',
    };
  });

  const totalBudgeted = rc(summary.reduce((sum, s) => sum + s.budgeted, 0));
  const totalSpent = rc(summary.reduce((sum, s) => sum + s.spent, 0));

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

  const where: any = {};
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
  } = req.body;

  // Calculate next due date
  const start = new Date(startDate);
  let nextDueDate = new Date(start);

  if (frequency === 'MONTHLY' && dayOfMonth) {
    nextDueDate.setDate(dayOfMonth);
    if (nextDueDate < start) {
      nextDueDate.setMonth(nextDueDate.getMonth() + 1);
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
      locationId,
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
  const { description, amount, vendor, endDate, isActive } = req.body;

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
export const generateRecurringExpenses = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const now = new Date();

  // Find all due recurring expenses
  const dueExpenses = await prisma.recurringExpense.findMany({
    where: {
      isActive: true,
      nextDueDate: { lte: now },
      OR: [
        { endDate: null },
        { endDate: { gte: now } },
      ],
    },
  });

  const generated: any[] = [];

  for (const recurring of dueExpenses) {
    // Collision-safe expense number (count()+1 raced under concurrent creates)
    const expenseNumber = `EXP-${Date.now()}-${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`;

    // Create the expense
    const expense = await prisma.expense.create({
      data: {
        expenseNumber,
        category: recurring.category,
        description: `${recurring.description} (Auto-generated)`,
        amount: recurring.amount,
        vendor: recurring.vendor,
        expenseDate: recurring.nextDueDate,
        locationId: recurring.locationId,
        userId: recurring.userId,
        status: 'PENDING',
      },
    });

    generated.push(expense);

    // Calculate next due date
    let nextDate = new Date(recurring.nextDueDate);
    switch (recurring.frequency) {
      case 'DAILY':
        nextDate.setDate(nextDate.getDate() + 1);
        break;
      case 'WEEKLY':
        nextDate.setDate(nextDate.getDate() + 7);
        break;
      case 'BIWEEKLY':
        nextDate.setDate(nextDate.getDate() + 14);
        break;
      case 'MONTHLY':
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case 'QUARTERLY':
        nextDate.setMonth(nextDate.getMonth() + 3);
        break;
      case 'YEARLY':
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
    }

    // Update recurring expense with next due date
    await prisma.recurringExpense.update({
      where: { id: recurring.id },
      data: {
        nextDueDate: nextDate,
        lastGenerated: now,
      },
    });
  }

  res.json({
    success: true,
    data: {
      generated: generated.length,
      expenses: generated,
    },
  });
});

// ==================== ACCOUNTING EXPORTS ====================

/**
 * Export sales for accounting
 * GET /api/financial/export/sales
 */
export const exportSales = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate, format = 'CSV' } = req.query;

  const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(1));
  const end = endDate ? parseEndDate(endDate as string) : new Date();
  const locationFilter = getLocationFilter(req, req.query.locationId as string);

  const sales = await prisma.sale.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      status: 'COMPLETED',
      ...locationFilter,
    },
    include: {
      items: true,
      customer: { select: { firstName: true, lastName: true } },
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Refunds issued in the period (includes partial refunds on COMPLETED sales)
  const refunds = await prisma.refund.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      ...(locationFilter.locationId ? { sale: { locationId: locationFilter.locationId } } : {}),
    },
    include: { sale: { select: { saleNumber: true } } },
    orderBy: { createdAt: 'asc' },
  });

  // Format for accounting export
  const journalEntries = [
    ...sales.map(sale => ({
      date: sale.createdAt.toISOString().split('T')[0],
      reference: sale.saleNumber,
      description: `Sale to ${sale.customer ? `${sale.customer.firstName} ${sale.customer.lastName}` : 'Walk-in'}`,
      debitAccount: 'Cash/AR',
      creditAccount: 'Sales Revenue',
      amount: sale.total,
      taxAmount: sale.tax,
      paymentMethod: sale.paymentMethod,
    })),
    ...refunds.map(refund => ({
      date: refund.createdAt.toISOString().split('T')[0],
      reference: refund.sale.saleNumber,
      description: `Refund on sale ${refund.sale.saleNumber}`,
      debitAccount: 'Sales Returns',
      creditAccount: 'Cash/AR',
      amount: -refund.amount,
      taxAmount: 0,
      paymentMethod: refund.method || 'REFUND',
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // Log the export
  await prisma.accountingExport.create({
    data: {
      type: 'SALES',
      format: format as string,
      startDate: start,
      endDate: end,
      recordCount: sales.length,
      userId: req.user!.id,
    },
  });

  res.json({
    success: true,
    data: {
      period: { start, end },
      recordCount: journalEntries.length,
      totalRevenue: rc(
        sales.reduce((sum, s) => sum + s.total, 0) -
          refunds.reduce((sum, r) => sum + r.amount, 0)
      ),
      totalTax: rc(sales.reduce((sum, s) => sum + s.tax, 0)),
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

  const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(1));
  const end = endDate ? parseEndDate(endDate as string) : new Date();
  const locationFilter = getLocationFilter(req, req.query.locationId as string);

  const expenses = await prisma.expense.findMany({
    where: {
      expenseDate: { gte: start, lte: end },
      status: { in: ['APPROVED', 'PAID'] },
      ...locationFilter,
    },
    include: {
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { expenseDate: 'asc' },
  });

  // Format for accounting export
  const journalEntries = expenses.map(expense => ({
    date: expense.expenseDate.toISOString().split('T')[0],
    reference: expense.expenseNumber,
    description: expense.description,
    debitAccount: `Expense - ${expense.category}`,
    creditAccount: expense.status === 'PAID' ? 'Cash/Bank' : 'Accounts Payable',
    amount: expense.amount,
    vendor: expense.vendor,
    category: expense.category,
  }));

  // Log the export
  await prisma.accountingExport.create({
    data: {
      type: 'EXPENSES',
      format: format as string,
      startDate: start,
      endDate: end,
      recordCount: expenses.length,
      userId: req.user!.id,
    },
  });

  res.json({
    success: true,
    data: {
      period: { start, end },
      recordCount: expenses.length,
      totalExpenses: rc(expenses.reduce((sum, e) => sum + e.amount, 0)),
      byCategory: Object.fromEntries(
        Object.entries(
          expenses.reduce((acc: any, e) => {
            acc[e.category] = (acc[e.category] || 0) + e.amount;
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

  const start = startDate ? new Date(startDate as string) : new Date(new Date().getFullYear(), 0, 1);
  const end = endDate ? parseEndDate(endDate as string) : new Date();
  const locationFilter = getLocationFilter(req, req.query.locationId as string);

  // Get revenue
  const salesData = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: start, lte: end },
      status: 'COMPLETED',
      ...locationFilter,
    },
    _sum: { total: true, tax: true },
    _count: { id: true },
  });

  // Get refunds
  const refundsData = await prisma.refund.aggregate({
    where: {
      createdAt: { gte: start, lte: end },
      ...(locationFilter.locationId ? { sale: { locationId: locationFilter.locationId } } : {}),
    },
    _sum: { amount: true },
  });

  // Get expenses by category
  const expensesByCategory = await prisma.expense.groupBy({
    by: ['category'],
    where: {
      expenseDate: { gte: start, lte: end },
      status: { in: ['APPROVED', 'PAID'] },
      ...locationFilter,
    },
    _sum: { amount: true },
  });

  // Calculate COGS (estimate based on 60% of sales)
  const grossSales = salesData._sum.total || 0;
  const refunds = refundsData._sum.amount || 0;
  const netSales = rc(grossSales - refunds);
  const cogs = rc(netSales * 0.6); // Estimated COGS
  const grossProfit = rc(netSales - cogs);

  // Operating expenses
  const operatingExpenses = rc(expensesByCategory.reduce((sum, e) => sum + (e._sum.amount || 0), 0));
  const netIncome = rc(grossProfit - operatingExpenses);

  res.json({
    success: true,
    data: {
      period: { start, end },
      revenue: {
        grossSales,
        refunds,
        netSales,
        taxCollected: salesData._sum.tax || 0,
      },
      costOfGoodsSold: cogs,
      grossProfit,
      operatingExpenses: {
        total: operatingExpenses,
        byCategory: expensesByCategory.map(e => ({
          category: e.category,
          amount: e._sum.amount || 0,
        })),
      },
      netIncome,
      margins: {
        gross: netSales > 0 ? Math.round((grossProfit / netSales) * 1000) / 10 : 0,
        net: netSales > 0 ? Math.round((netIncome / netSales) * 1000) / 10 : 0,
      },
    },
  });
});

/**
 * Get export history
 * GET /api/financial/exports
 */
export const getExportHistory = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const exports = await prisma.accountingExport.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json({
    success: true,
    data: exports,
  });
});
