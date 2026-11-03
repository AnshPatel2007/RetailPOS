import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { getReportCalendar } from './reportDates.service';
import { getFinancialBreakdowns, getFinancialMetrics } from './financialMetrics.service';
import { roundMoney } from '../utils/moneyNumbers';

export async function employeeActivity(scope: { locationId?: string }, daysInput: unknown = 30, now = new Date()) {
  const days = z.coerce.number().int().min(1).max(366).parse(daysInput), calendar = await getReportCalendar(scope, now), start = calendar.day(1 - days);
  const scopeSql = scope.locationId ? Prisma.sql`s."locationId" = ${scope.locationId}` : Prisma.sql`s."locationId" IS NOT NULL`;
  return prisma.$transaction(async tx => {
    const [activity, totals, hours, returns] = await Promise.all([
      getFinancialBreakdowns(scope, { gte: start, lte: now }, calendar.timezone, start, tx, ['employee']),
      getFinancialMetrics(scope, { gte: start, lte: now }, tx),
      tx.$queryRaw<{ userId: string; hours: number }[]>`SELECT s."userId", SUM(EXTRACT(EPOCH FROM (LEAST(s."clockOutAt", (${now}::timestamptz AT TIME ZONE 'UTC')) - GREATEST(s."clockInAt", (${start}::timestamptz AT TIME ZONE 'UTC')))) / 3600)::double precision AS hours
        FROM shifts s WHERE ${scopeSql} AND s."clockOutAt" IS NOT NULL AND s."clockOutAt" > (${start}::timestamptz AT TIME ZONE 'UTC') AND s."clockInAt" < (${now}::timestamptz AT TIME ZONE 'UTC') GROUP BY s."userId"`,
      tx.$queryRaw<{ userId: string; count: number }[]>`SELECT s."userId", COUNT(r.id)::int AS count FROM refunds r JOIN sales s ON s.id = r."saleId"
        WHERE ${scopeSql} AND r."createdAt" >= (${start}::timestamptz AT TIME ZONE 'UTC') AND r."createdAt" <= (${now}::timestamptz AT TIME ZONE 'UTC') GROUP BY s."userId"`,
    ]);
    const staff = await tx.user.findMany({ where: { OR: [{ locationId: scope.locationId || { not: null }, role: { in: ['ADMIN', 'MANAGER', 'CASHIER'] } },
      { id: { in: activity.map(row => row.key) } }] }, select: { id: true, firstName: true, lastName: true, role: true } });
    const byId = new Map(activity.map(row => [row.key, row])), hoursById = new Map(hours.map(row => [row.userId, row.hours])), returnsById = new Map(returns.map(row => [row.userId, row.count]));
    const employees = staff.map(user => {
      const row = byId.get(user.id), hoursWorked = hoursById.get(user.id) || 0, count = row?.count || 0, revenue = row?.total || 0, refunds = returnsById.get(user.id) || 0;
      return { id: user.id, name: user.firstName + ' ' + user.lastName, role: user.role, metrics: { totalSales: count, totalRevenue: revenue,
        avgTransaction: count ? roundMoney((row?.gross || 0) / count) : 0, hoursWorked: roundMoney(hoursWorked),
        revenuePerHour: hoursWorked > 0 ? roundMoney(revenue / hoursWorked) : 0, transactionsPerHour: hoursWorked > 0 ? roundMoney(count / hoursWorked) : 0,
        refunds, refundRate: count ? roundMoney(refunds / count * 100) : null } };
    });
    const max = (values: number[]) => Math.max(...values, 1);
    const maxRevenue = max(employees.map(row => row.metrics.totalRevenue)), maxCount = max(employees.map(row => row.metrics.totalSales)),
      maxAverage = max(employees.map(row => row.metrics.avgTransaction)), maxEfficiency = max(employees.map(row => row.metrics.revenuePerHour));
    const leaderboard = employees.map(row => ({ ...row, rank: 0, badges: row.metrics.totalRevenue > 0 && row.metrics.totalRevenue === maxRevenue ? ['Top Seller'] : [],
      score: row.metrics.totalSales ? Math.round(Math.max(0, row.metrics.totalRevenue) / maxRevenue * 30 + row.metrics.totalSales / maxCount * 25
        + row.metrics.avgTransaction / maxAverage * 20 + Math.max(0, row.metrics.revenuePerHour) / maxEfficiency * 20 + Math.max(0, 5 - (row.metrics.refundRate || 0))) : 0,
    })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    leaderboard.forEach((row, index) => { row.rank = index + 1; });
    return { leaderboard, teamStats: { totalRevenue: totals.netCollected, totalTransactions: totals.transactions,
      avgScore: leaderboard.length ? Math.round(leaderboard.reduce((sum, row) => sum + row.score, 0) / leaderboard.length) : 0, topPerformer: leaderboard[0]?.name || 'N/A' },
      period: { days, startDate: start.toISOString(), endDate: now.toISOString(), timezone: calendar.timezone },
      scoringWeights: { revenue: '30%', transactions: '25%', avgTransaction: '20%', efficiency: '20%', quality: '5%' }, historyWarning: totals.historyWarning,
      basis: 'Descriptive activity score, not a payroll or employee evaluation. Net collections include dated returns/voids attributed to the original seller. Original purchase count and gross order average remain separate. Hours include only closed shifts clipped to the selected store-calendar period; wages are never included. Return-event ratios are not purchase-cohort return rates.' };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}
