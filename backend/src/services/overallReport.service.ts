import { valueProducts, sumInventoryValue } from './inventoryValueRead.service';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { getFinancialBreakdowns, getFinancialMetrics, getProductFinancialMetrics } from './financialMetrics.service';
import { getReportCalendar } from './reportDates.service';

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
type Scope = { locationId?: string };

export async function getOverallReportData(scope: Scope, now = new Date()) {
  const calendar = await getReportCalendar(scope, now);
  const where = { locationId: scope.locationId || { not: null } };
  // Rolling local-calendar windows include today, ending at one captured instant.
  const today = calendar.day(), week = calendar.day(-6), month = calendar.day(-29), year = calendar.day(-364);
  const monthRange = { gte: month, lte: now };
  return prisma.$transaction(async tx => {
    const [daily, weekly, previousWeek, monthly, previousMonth, yearly, activity, productMetrics,
      totalCustomers, newCustomers, returningCustomers, topCustomers, customerValue, products, expenses] = await Promise.all([
      getFinancialMetrics(scope, { gte: today, lte: now }, tx),
      getFinancialMetrics(scope, { gte: week, lte: now }, tx),
      getFinancialMetrics(scope, { gte: calendar.day(-13), lt: week }, tx),
      getFinancialMetrics(scope, monthRange, tx),
      getFinancialMetrics(scope, { gte: calendar.day(-59), lt: month }, tx),
      getFinancialMetrics(scope, { gte: year, lte: now }, tx),
      getFinancialBreakdowns(scope, monthRange, calendar.timezone, today, tx),
      getProductFinancialMetrics(scope, monthRange, tx),
      tx.customer.count({ where: { ...where, isActive: true } }),
      tx.customer.count({ where: { ...where, isActive: true, createdAt: monthRange } }),
      tx.customer.count({ where: { ...where, isActive: true, visitCount: { gt: 1 } } }),
      tx.customer.findMany({ where: { ...where, isActive: true }, select: { id: true, firstName: true, lastName: true, email: true, totalSpent: true, visitCount: true, lastVisitAt: true }, orderBy: [{ totalSpent: 'desc' }, { id: 'asc' }], take: 10 }),
      tx.customer.aggregate({ where: { ...where, isActive: true, totalSpent: { gt: 0 } }, _avg: { totalSpent: true } }),
      tx.product.findMany({ where: { ...where, isActive: true, sku: { not: 'MISC-001' } }, select: { id: true, name: true, sku: true, cost: true, price: true, stockQuantity: true, lowStockAlert: true, trackInventory: true } }),
      tx.expense.groupBy({ by: ['category'], where: { ...where, expenseDate: monthRange, status: { in: ['APPROVED', 'PAID'] } }, _sum: { amount: true }, _count: true }),
    ]);
    const employeeActivity = activity.filter(row => row.kind === 'employee');
    const [employees, categories] = await Promise.all([
      tx.user.findMany({ where: { id: { in: employeeActivity.map(row => row.key) } }, select: { id: true, firstName: true, lastName: true } }),
      tx.product.findMany({ where: { ...where, id: { in: productMetrics.map(row => row.productId) } }, select: { id: true, category: { select: { id: true, name: true } } } }),
    ]);
    const employeeNames = new Map(employees.map(employee => [employee.id, employee.firstName + ' ' + employee.lastName]));
    const categoryNames = new Map(categories.map(product => [product.id, product.category]));
    const categoryTotals = new Map<string, { name: string; revenue: number; quantity: number }>();
    for (const product of productMetrics) {
      const category = categoryNames.get(product.productId);
      const key = category?.id || 'uncategorized';
      const entry = categoryTotals.get(key) || { name: category?.name || 'Uncategorized', revenue: 0, quantity: 0 };
      entry.revenue = round(entry.revenue + product.revenue); entry.quantity += product.quantitySold;
      categoryTotals.set(key, entry);
    }
    // Old amount-only returns may have no line allocation. Keep the gap visible.
    const unallocated = round(monthly.netCollected - productMetrics.reduce((sum, product) => sum + product.revenue, 0));
    if (unallocated) categoryTotals.set('unallocated-history', { name: 'Unallocated historical activity', revenue: unallocated, quantity: 0 });
    const dayKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: calendar.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    const byDay = new Map(activity.filter(row => row.kind === 'day').map(row => [row.key, row]));
    const byHour = new Map(activity.filter(row => row.kind === 'hour').map(row => [Number(row.key), row]));
    const dailySales = Array.from({ length: 30 }, (_, index) => {
      const date = dayKey(calendar.day(index - 29)), bucket = byDay.get(date);
      return { date, sales: bucket?.total || 0, transactions: bucket ? bucket.count : 0 };
    });
    const hourlySales = Array.from({ length: 24 }, (_, hour) => ({ hour, sales: byHour.get(hour)?.total || 0, transactions: byHour.get(hour)?.count || 0 }));
    const paymentActivity = activity.filter(row => row.kind === 'payment');
    const meaningfulShares = monthly.netCollected > 0 && paymentActivity.every(row => row.total >= 0);
    const tracked = products.filter(product => product.trackInventory);
    const inventoryValue = sumInventoryValue(await valueProducts(tx, tracked));
    const retailValue = round(tracked.reduce((sum, product) => sum + Number(product.price) * product.stockQuantity, 0));
    const lowStock = tracked.filter(product => product.stockQuantity > 0 && product.stockQuantity <= product.lowStockAlert);
    const outOfStock = tracked.filter(product => product.stockQuantity <= 0);
    const expenseTotal = monthly.recordedExpenses;
    const growth = (current: typeof daily, previous: typeof daily) => previous.netCollected > 0 && !current.historyWarning && !previous.historyWarning
      ? round((current.netCollected - previous.netCollected) / previous.netCollected * 100) : null;
    const summary = (metrics: typeof daily) => ({ total: metrics.netCollected, transactions: metrics.transactions,
      grossCollected: metrics.grossCollected, netSales: metrics.netSales, tax: metrics.netTax, discount: metrics.discounts,
      refunds: metrics.refunds, voids: metrics.voids, historyWarning: metrics.historyWarning });
    const average = (metrics: typeof daily) => metrics.transactions === null ? null : metrics.transactions ? round(metrics.grossCollected / metrics.transactions) : 0;
    return {
      period: { timezone: calendar.timezone, asOf: now, start: month, windows: { today, week, month, year } },
      historyWarning: yearly.historyWarning,
      revenue: { today: summary(daily), week: { ...summary(weekly), growth: growth(weekly, previousWeek) }, month: { ...summary(monthly), growth: growth(monthly, previousMonth) }, year: summary(yearly) },
      profitability: { grossProfit: monthly.grossProfit, grossMargin: monthly.grossMargin, otherIncome: monthly.otherIncome, netProfit: monthly.netProfit, netMargin: monthly.netProfit !== null && monthly.netSales ? Math.round(monthly.netProfit / monthly.netSales * 10000) / 100 : null,
        costOfGoodsSold: monthly.costOfGoodsSold, netSales: monthly.netSales, costBasis: monthly.costBasis, unavailableReason: monthly.unavailableReason,
        totalExpenses: monthly.expenses, inventoryPurchases: monthly.inventoryPurchases, receivedInventoryPurchases: monthly.receivedInventoryPurchases,
        recordedSaleCosts: monthly.recordedSaleCosts, inventoryCostAdjustments: monthly.inventoryCostAdjustments, costCompleteness: monthly.costCompleteness },
      averageOrderValue: { today: average(daily), week: average(weekly), month: average(monthly) },
      customers: { total: totalCustomers, new: newCustomers, returning: returningCustomers, retentionRate: totalCustomers ? round(returningCustomers / totalCustomers * 100) : 0,
        avgLifetimeValue: round(Number(customerValue._avg.totalSpent || 0)), topCustomers },
      inventory: { totalProducts: products.length, inventoryValue, retailValue, potentialProfit: inventoryValue === null ? null : round(retailValue - inventoryValue), lowStockCount: lowStock.length,
        outOfStockCount: outOfStock.length, stockTurnover: null, stockTurnoverReason: 'Historical average inventory is required to calculate turnover.',
        lowStockItems: lowStock.slice(0, 10).map(product => ({ id: product.id, name: product.name, sku: product.sku, stock: product.stockQuantity, alert: product.lowStockAlert })),
        outOfStockItems: outOfStock.slice(0, 10).map(product => ({ id: product.id, name: product.name, sku: product.sku })) },
      topProducts: [...productMetrics].sort((a, b) => b.revenue - a.revenue || a.productId.localeCompare(b.productId)).slice(0, 10).map(product => ({ productId: product.productId, name: product.productName, quantitySold: product.quantitySold, revenue: product.revenue })),
      salesByCategory: [...categoryTotals.values()].sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name)),
      categoryBasis: 'Current product categories; signed activity includes returns and voids in their reversal period.',
      paymentMethods: paymentActivity.map(row => ({ method: row.key, total: row.total, count: row.count, percentage: meaningfulShares ? round(row.total / monthly.netCollected * 100) : null })).sort((a, b) => b.total - a.total || a.method.localeCompare(b.method)),
      employeePerformance: employeeActivity.map(row => ({ id: row.key, name: employeeNames.get(row.key) || 'Unknown', totalSales: row.total, transactions: row.count,
        avgOrderValue: row.count ? round(row.gross / row.count) : 0 })).sort((a, b) => b.totalSales - a.totalSales || a.id.localeCompare(b.id)),
      expenses: { total: expenseTotal, count: expenses.reduce((sum, expense) => sum + expense._count, 0), breakdown: expenses.map(expense => ({ category: expense.category,
        total: round(Number(expense._sum.amount || 0)), count: expense._count, percentage: expenseTotal > 0 ? round(Number((expense._sum.amount || 0)) / expenseTotal * 100) : 0 })).sort((a, b) => b.total - a.total) },
      trends: { dailySales, hourlySales },
      refundsAndVoids: { refunds: { total: monthly.refunds, count: monthly.refundCount }, voids: { total: monthly.voids, count: monthly.voidCount } },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}
