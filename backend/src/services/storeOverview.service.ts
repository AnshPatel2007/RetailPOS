import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { getFinancialMetrics } from './financialMetrics.service';
import { reportCalendar } from './reportDates.service';
import { salesTrend, todayRanges } from './dashboardReport.service';
import { collectAttention } from './attention.service';
import { AppError } from '../utils/errorHandler';

const openExceptions = ['OPEN', 'RECOUNT_REQUESTED'];

/**
 * My Stores: one card per store the person runs as ADMIN. Today's figures use the
 * same metrics, ranges and trend as each store's own Dashboard, and every figure is read
 * for all stores in one consistent snapshot; the attention count is that store's list.
 */
export async function getStoresOverview(userId: string, currentLocationId: string | null, now = new Date()) {
  const rows = await prisma.userStoreAccess.findMany({
    where: { userId, role: 'ADMIN' },
    select: { location: { select: { id: true, name: true, isActive: true, timezone: true } } },
  });
  if (!rows.length) throw new AppError('Only owners and admins see the store overview', 403);
  const stores = rows.map(row => row.location).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const figures = await prisma.$transaction(async tx => {
    const result = [];
    for (const store of stores) {
      const scope = { locationId: store.id };
      const calendar = reportCalendar(store.timezone, now);
      const ranges = todayRanges(calendar, now);
      const [today, sameTimeYesterday, yesterday, exceptions, lastDrawer] = await Promise.all([
        getFinancialMetrics(scope, ranges.today, tx),
        getFinancialMetrics(scope, ranges.sameTimeYesterday, tx),
        getFinancialMetrics(scope, { gte: calendar.day(-1), lt: calendar.day() }, tx),
        tx.inventoryException.count({ where: { locationId: store.id, status: { in: openExceptions } } }),
        tx.shift.findFirst({
          where: { locationId: store.id, isClosed: true, cashDifference: { not: null }, clockOutAt: { lte: now } },
          orderBy: [{ clockOutAt: 'desc' }, { id: 'desc' }],
          select: { cashDifference: true, clockOutAt: true, user: { select: { firstName: true, lastName: true } } },
        }),
      ]);
      const date = calendar.day(-1).toLocaleDateString('en-CA', { timeZone: store.timezone });
      result.push({ today, sameTimeYesterday, yesterday, date, exceptions, lastDrawer });
    }
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });

  const cards = [];
  for (const [index, store] of stores.entries()) {
    const { today, sameTimeYesterday, yesterday, date, exceptions, lastDrawer } = figures[index];
    const attention = await collectAttention(store.id, now, 'ADMIN');
    cards.push({
      locationId: store.id,
      name: store.name,
      isActive: store.isActive,
      timezone: store.timezone,
      isCurrent: store.id === currentLocationId,
      today: { sales: today.netCollected, transactions: today.transactions, trend: salesTrend(today, sameTimeYesterday), historyWarning: today.historyWarning },
      // A profit with estimated costs is shown as not final, with the reason; a missing cost stays unavailable.
      yesterday: { date, sales: yesterday.netCollected, grossProfit: yesterday.grossProfit, grossMargin: yesterday.grossMargin, costBasis: yesterday.costBasis,
        note: yesterday.grossProfit === null ? yesterday.unavailableReason : yesterday.provisionalReason },
      openStockExceptions: exceptions,
      attentionCount: attention.items.length,
      attentionIncomplete: attention.incomplete,
      lastDrawer: lastDrawer && {
        difference: Number(lastDrawer.cashDifference),
        closedAt: lastDrawer.clockOutAt,
        employeeName: `${lastDrawer.user.firstName} ${lastDrawer.user.lastName}`.trim(),
      },
    });
  }
  return { asOf: now.toISOString(), stores: cards };
}
