import prisma from '../config/database';
import { getFinancialBreakdowns, getFinancialMetrics } from './financialMetrics.service';
import { getReportRange } from './reportDates.service';
import { AppError } from '../utils/errorHandler';

export async function getEmployeeReportData(scope: { locationId?: string }, start: unknown, end: unknown) {
  const period = await getReportRange(scope, start, end, 'month');
  const day = (date: Date) => Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: period.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date));
  const lastInstant = new Date(period.end.getTime() - Number(period.endExclusive));
  if (!period.start || (day(lastInstant) - day(period.start)) / 86400000 + 1 > 366) {
    throw new AppError('Select an employee report period of one year or less.', 400);
  }
  return prisma.$transaction(async tx => {
    const [activity, metrics] = await Promise.all([
      getFinancialBreakdowns(scope, period.range, period.timezone, period.start!, tx),
      getFinancialMetrics(scope, period.range, tx),
    ]);
    const staff = activity.filter(row => row.kind === 'employee');
    const users = await tx.user.findMany({ where: { id: { in: staff.map(row => row.key) } }, select: { id: true, firstName: true, lastName: true, email: true, role: true } });
    const byId = new Map(users.map(user => [user.id, user]));
    const rows = staff.map(row => {
      // No sales in the period (only refunds or voids) means no average, not $0.
      const average = row.count ? Math.round(row.gross / row.count * 100) / 100 : null;
      return { user: byId.get(row.key) || { id: row.key, firstName: 'Unknown', lastName: '', email: '', role: 'UNAVAILABLE' },
        totalRevenue: row.total, totalSales: row.total, grossCollected: row.gross,
        transactionCount: row.count, avgTransaction: average, averageOrderValue: average };
    }).sort((a, b) => b.totalRevenue - a.totalRevenue || a.user.id.localeCompare(b.user.id));
    return { rows, period, historyWarning: metrics.historyWarning,
      summary: { netCollected: metrics.netCollected, grossCollected: metrics.grossCollected, transactions: metrics.transactions } };
  }, { isolationLevel: 'RepeatableRead', timeout: 15000 });
}
