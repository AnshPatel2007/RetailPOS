import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { getFinancialBreakdowns, getFinancialMetrics, getProductFinancialMetrics, recordedSaleWhere } from './financialMetrics.service';
import { getReportCalendar } from './reportDates.service';

type Scope = { locationId?: string; userId?: string };
type Calendar = Awaited<ReturnType<typeof getReportCalendar>>;
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const hourMs = 3600000;

async function widgets(scope: Scope, calendar: Calendar, tx: Prisma.TransactionClient, daily: Awaited<ReturnType<typeof getFinancialMetrics>>) {
  const { now, timezone } = calendar;
  // Twelve elapsed hours, with partial first/current buckets; repeated DST hours remain distinct.
  const start = new Date(now.getTime() - 12 * hourMs);
  const [activity, products, shifts] = await Promise.all([
    getFinancialBreakdowns(scope, { gte: start, lte: now }, timezone, calendar.day(), tx, ['epochHour']),
    getProductFinancialMetrics(scope, { gte: calendar.day(), lte: now }, tx),
    tx.shift.findMany({ where: { locationId: scope.locationId || { not: null }, ...(scope.userId ? { userId: scope.userId } : {}), isClosed: false, clockInAt: { lte: now } },
      select: { id: true, clockInAt: true, user: { select: { firstName: true, lastName: true } } }, orderBy: [{ clockInAt: 'asc' }, { id: 'asc' }], take: 10 }),
  ]);
  const shiftActivity = shifts.length ? await getFinancialBreakdowns({ ...scope, criteria: { shiftIds: shifts.map(shift => shift.id) } },
    { lte: now }, timezone, calendar.day(), tx, ['shift']) : [];
  const shiftTotals = new Map(shiftActivity.map(row => [row.key, row]));
  const byHour = new Map(activity.map(row => [Number(row.key), row.total]));
  const firstHour = Math.floor(start.getTime() / hourMs) * hourMs;
  const unallocatedProductTotal = round(daily.netCollected - products.reduce((sum, product) => sum + product.revenue, 0));
  return {
    period: { timezone, asOf: now, today: calendar.day(), hourlyStart: start },
    historyWarning: daily.historyWarning,
    hourlyData: Array.from({ length: 13 }, (_, index) => { const timestamp = firstHour + index * hourMs; return { timestamp, total: byHour.get(timestamp) || 0 }; }),
    topProducts: products.sort((a, b) => b.revenue - a.revenue || a.productId.localeCompare(b.productId)).slice(0, 5)
      .map(product => ({ productId: product.productId, name: product.productName, qty: product.quantitySold, revenue: product.revenue })),
    unallocatedProductTotal,
    productWarning: daily.historyWarning || (unallocatedProductTotal || products.some(p => p.incompleteReturns)
      ? 'Some historical returns have no complete product allocation. Product totals may be incomplete.' : null),
    activeShifts: shifts.map(shift => ({ id: shift.id, employeeName: shift.user.firstName + ' ' + shift.user.lastName, clockInAt: shift.clockInAt,
      totalSales: shiftTotals.get(shift.id)?.total || 0, totalTransactions: shiftTotals.get(shift.id)?.count || 0 })),
  };
}

type Metrics = Awaited<ReturnType<typeof getFinancialMetrics>>;
/** Percent change in sales after refunds; none when the earlier period had no sales or either has incomplete history. */
export const salesTrend = (current: Metrics, previous: Metrics) => previous.netCollected > 0 && !current.historyWarning && !previous.historyWarning
  ? round((current.netCollected - previous.netCollected) / previous.netCollected * 100) : null;

/** Today so far, and yesterday up to the same time of day (the Dashboard's comparison). */
export const todayRanges = (calendar: Calendar, now: Date) => ({
  today: { gte: calendar.day(), lte: now },
  sameTimeYesterday: { gte: calendar.day(-1), lte: new Date(Math.min(now.getTime() - 86400000, calendar.day().getTime() - 1)) },
});

export async function getDashboardWidgetData(scope: Scope, now = new Date()) {
  const calendar = await getReportCalendar(scope, now);
  return prisma.$transaction(async tx => widgets(scope, calendar, tx, await getFinancialMetrics(scope, { gte: calendar.day(), lte: now }, tx)),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}

/** One snapshot for all store dashboard cards and charts. Existing field names remain compatible. */
export async function getDashboardReportData(scope: Scope, now = new Date()) {
  const calendar = await getReportCalendar(scope, now);
  const today = calendar.day(), week = calendar.day(-6), month = calendar.day(-29);
  const where = { locationId: scope.locationId || { not: null } };
  const catalog = { ...where, isActive: true, sku: { not: 'MISC-001' } };
  const lowStock = { ...catalog, trackInventory: true, stockQuantity: { lte: prisma.product.fields.lowStockAlert } };
  return prisma.$transaction(async tx => {
    const [daily, yesterday, weekly, previousWeek, monthly, previousMonth, lowStockCount, lowStockItems,
      totalProducts, totalCustomers, activeEmployees, recentSales, payments] = await Promise.all([
      getFinancialMetrics(scope, todayRanges(calendar, now).today, tx),
      // Today so far is compared with yesterday up to the same time, not all of yesterday.
      getFinancialMetrics(scope, todayRanges(calendar, now).sameTimeYesterday, tx),
      getFinancialMetrics(scope, { gte: week, lte: now }, tx),
      getFinancialMetrics(scope, { gte: calendar.day(-13), lt: week }, tx),
      getFinancialMetrics(scope, { gte: month, lte: now }, tx),
      getFinancialMetrics(scope, { gte: calendar.day(-59), lt: month }, tx),
      tx.product.count({ where: lowStock }),
      tx.product.findMany({ where: lowStock, select: { id: true, name: true, sku: true, stockQuantity: true, lowStockAlert: true }, orderBy: [{ stockQuantity: 'asc' }, { id: 'asc' }], take: 5 }),
      tx.product.count({ where: catalog }),
      tx.customer.count({ where: { ...where, isActive: true } }),
      tx.shift.count({ where: { ...where, ...(scope.userId ? { userId: scope.userId } : {}), isClosed: false, clockInAt: { lte: now } } }),
      tx.sale.findMany({ where: { ...where, ...(scope.userId ? { userId: scope.userId } : {}), ...recordedSaleWhere, createdAt: { lte: now } },
        select: { id: true, saleNumber: true, status: true, total: true, paymentMethod: true, createdAt: true, customer: { select: { firstName: true, lastName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 5 }),
      getFinancialBreakdowns(scope, { gte: today, lte: now }, calendar.timezone, today, tx, ['payment']),
    ]);
    const details = await widgets(scope, calendar, tx, daily);
    const meaningfulShares = daily.netCollected > 0 && payments.every(payment => payment.total >= 0);
    return {
      ...details, period: { ...details.period, week, month },
      todaySales: daily.netCollected, todayTransactions: daily.transactions, todayTrend: salesTrend(daily, yesterday),
      weekSales: weekly.netCollected, weekTrend: salesTrend(weekly, previousWeek), monthSales: monthly.netCollected, monthTrend: salesTrend(monthly, previousMonth),
      averageOrderValue: daily.transactions ? round(daily.grossCollected / daily.transactions) : null,
      todayRefunds: daily.refunds, todayRefundCount: daily.refundCount, todayVoids: daily.voids, todayVoidCount: daily.voidCount,
      lowStockCount, lowStockItems: lowStockItems.map(product => ({ id: product.id, name: product.name, sku: product.sku, stock: product.stockQuantity, alert: product.lowStockAlert })),
      totalProducts, totalCustomers, activeEmployees,
      recentSales: recentSales.map(({ customer, ...sale }) => ({ ...sale, customerName: customer ? customer.firstName + ' ' + customer.lastName : null })),
      paymentBreakdown: payments.map(payment => ({ method: payment.key, total: payment.total, count: payment.count, percentage: meaningfulShares ? round(payment.total / daily.netCollected * 100) : null }))
        .sort((a, b) => b.total - a.total || a.method.localeCompare(b.method)),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}
