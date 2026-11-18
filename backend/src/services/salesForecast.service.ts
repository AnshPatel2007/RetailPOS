import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/errorHandler';
import { getFinancialBreakdowns, getFinancialMetrics, recordedSaleWhere } from './financialMetrics.service';
import { getReportCalendar } from './reportDates.service';
import { roundMoney } from '../utils/moneyNumbers';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Scope = { locationId?: string };

/** A transparent seasonal baseline, not a probability model or promised revenue. */
export async function getSalesForecastData(scope: Scope, daysInput: unknown = 30, now = new Date()) {
  const days = typeof daysInput === 'string' && /^\d+$/.test(daysInput) ? Number(daysInput) : daysInput;
  if (!Number.isInteger(days) || Number(days) < 1 || Number(days) > 60) throw new AppError('Forecast days must be a whole number from 1 to 60', 400);
  const calendar = await getReportCalendar(scope, now);
  const dateKey = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: calendar.timezone });
  const range = { gte: calendar.day(-90), lt: calendar.day() };
  return prisma.$transaction(async tx => {
    const [first, rows, metrics] = await Promise.all([
      tx.sale.findFirst({ where: { locationId: scope.locationId || { not: null }, ...recordedSaleWhere, createdAt: { lt: range.lt } }, select: { createdAt: true }, orderBy: { createdAt: 'asc' } }),
      getFinancialBreakdowns(scope, range, calendar.timezone, range.gte, tx, ['day']),
      getFinancialMetrics(scope, range, tx),
    ]);
    const firstDay = first ? dateKey(first.createdAt) : null;
    const byDate = new Map(rows.map(row => [row.key, row]));
    const historical = Array.from({ length: 90 }, (_, i) => {
      const date = dateKey(calendar.day(i - 90)), row = byDate.get(date);
      return { date, revenue: row?.total || 0, transactions: row?.count || 0, weekday: new Date(date + 'T12:00:00Z').getUTCDay() };
    }).filter(row => firstDay && row.date >= firstDay);
    const activeDays = historical.filter(row => row.transactions > 0).length;
    const reason = metrics.historyWarning || (historical.length < 28 || activeDays < 7
      ? 'At least 28 complete store dates and 7 dates with sales are required. The current partial day is excluded.' : null);
    const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const average = avg(historical.map(row => row.revenue));
    const patterns = weekdays.map((day, weekday) => {
      const samples = historical.filter(row => row.weekday === weekday);
      return { day, revenue: avg(samples.map(row => row.revenue)), transactions: avg(samples.map(row => row.transactions)),
        low: samples.length ? Math.min(...samples.map(row => row.revenue)) : 0, high: samples.length ? Math.max(...samples.map(row => row.revenue)) : 0,
        observations: samples.length };
    });
    const forecast = reason ? [] : Array.from({ length: Number(days) }, (_, index) => {
      const date = dateKey(calendar.day(index + 1)), pattern = patterns[new Date(date + 'T12:00:00Z').getUTCDay()];
      return { date, dayOfWeek: pattern.day, revenue: roundMoney(pattern.revenue), transactions: Math.round(pattern.transactions),
        // Compatibility names retained, but the UI explicitly labels observed ranges.
        confidenceLow: roundMoney(pattern.low), confidenceHigh: roundMoney(pattern.high) };
    });
    const total = roundMoney(forecast.reduce((sum, row) => sum + row.revenue, 0));
    const forecastAverage = total / Number(days);
    const delta = avg(historical.slice(-7).map(row => row.revenue)) - avg(historical.slice(-14, -7).map(row => row.revenue));
    return {
      status: reason ? 'UNAVAILABLE' : 'ESTIMATE', unavailableReason: reason,
      basis: 'Estimated net collections including tax, after refunds and voids on their reversal dates. Each weekday uses its historical mean; observed low/high values are not confidence intervals. Zero-activity dates count. Closures, holidays and future promotions are not predicted.',
      timezone: calendar.timezone, asOf: now, forecast,
      summary: { totalForecastRevenue: reason ? null : total, avgDailyForecast: reason ? null : roundMoney(forecastAverage),
        historicalAvgDaily: historical.length ? roundMoney(average) : null,
        expectedGrowth: !reason && average > 0 ? roundMoney((forecastAverage - average) / average * 100) : null,
        totalForecastTransactions: reason ? null : forecast.reduce((sum, row) => sum + row.transactions, 0) },
      trends: { direction: delta > 0 ? 'upward' : delta < 0 ? 'downward' : 'flat', basis: 'Last seven complete dates compared with the preceding seven.' },
      dayOfWeekPatterns: patterns.map(pattern => ({ day: pattern.day, multiplier: average > 0 ? roundMoney(pattern.revenue / average) : null, observations: pattern.observations })),
      historicalPeriod: { days: historical.length, dataPoints: activeDays, start: historical[0]?.date || null, end: dateKey(calendar.day(-1)) },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}
