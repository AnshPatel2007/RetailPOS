import { valueProducts } from './inventoryValueRead.service';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { getReportCalendar } from './reportDates.service';
import { getFinancialBreakdowns, getFinancialMetrics, getProductFinancialMetrics, recordedSaleWhere } from './financialMetrics.service';
import { roundMoney } from '../utils/moneyNumbers';

type Scope = { locationId?: string };
const scopeSql = (scope: Scope) => scope.locationId ? Prisma.sql`s."locationId" = ${scope.locationId}` : Prisma.sql`s."locationId" IS NOT NULL`;
const recorded = Prisma.sql`(s.status IN ('COMPLETED','REFUNDED') OR (s.status = 'VOIDED' AND EXISTS (SELECT 1 FROM sale_voids v WHERE v."saleId" = s.id)))`;
const dateFormatters = new Map<string,Intl.DateTimeFormat>();
const dateKey = (date: Date, timezone: string) => {
  let formatter=dateFormatters.get(timezone);
  if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});dateFormatters.set(timezone,formatter);}
  return formatter.format(date);
};

export async function salesAnomalies(scope: Scope, now = new Date()) {
  const calendar = await getReportCalendar(scope, now), end = calendar.day(), start = calendar.day(-60);
  return prisma.$transaction(async tx => {
    const [rows, metrics, first, units, transactions] = await Promise.all([
      getFinancialBreakdowns(scope, { gte: start, lt: end }, calendar.timezone, start, tx, ['day']),
      getFinancialMetrics(scope, { gte: start, lt: end }, tx),
      tx.sale.findFirst({ where: { locationId: scope.locationId || { not: null }, ...recordedSaleWhere, createdAt: { lt: end } }, select: { createdAt: true }, orderBy: { createdAt: 'asc' } }),
      tx.$queryRaw<{ productId: string; day: string; quantity: number }[]>`
        WITH activity AS (
          SELECT si."productId", s."createdAt" AS at, si.quantity AS quantity FROM sale_items si JOIN sales s ON s.id = si."saleId" WHERE ${scopeSql(scope)} AND ${recorded}
          UNION ALL SELECT si."productId", r."createdAt", -ri.quantity FROM refund_items ri JOIN refunds r ON r.id = ri."refundId" JOIN sale_items si ON si.id = ri."saleItemId" JOIN sales s ON s.id = r."saleId" WHERE ${scopeSql(scope)}
          UNION ALL SELECT si."productId", v."createdAt", -si.quantity FROM sale_voids v JOIN sales s ON s.id = v."saleId" JOIN sale_items si ON si."saleId" = s.id WHERE ${scopeSql(scope)}
        ) SELECT "productId", TO_CHAR((at AT TIME ZONE 'UTC') AT TIME ZONE ${calendar.timezone}, 'YYYY-MM-DD') AS day, SUM(quantity)::int AS quantity FROM activity
          WHERE at >= (${start}::timestamptz AT TIME ZONE 'UTC') AND at < (${end}::timestamptz AT TIME ZONE 'UTC') GROUP BY "productId",day`,
      tx.$queryRaw<{ id: string; total: Prisma.Decimal; createdAt: Date; z: number | null }[]>`
        WITH sizes AS (SELECT s.id,s.total,s."createdAt", AVG(s.total) OVER () AS avg, STDDEV_POP(s.total) OVER () AS sd, COUNT(*) OVER () AS n
          FROM sales s WHERE ${scopeSql(scope)} AND ${recorded} AND s."createdAt" >= (${start}::timestamptz AT TIME ZONE 'UTC') AND s."createdAt" < (${end}::timestamptz AT TIME ZONE 'UTC'))
        SELECT id,total,"createdAt", ((total-avg)/NULLIF(sd,0))::double precision AS z FROM sizes WHERE n >= 20 AND ABS((total-avg)/NULLIF(sd,0)) > 2.5 ORDER BY ABS((total-avg)/NULLIF(sd,0)) DESC,id LIMIT 10`,
    ]);
    const map = new Map(rows.map(row => [row.key, row])), firstDate = first ? dateKey(first.createdAt, calendar.timezone) : null;
    const series = Array.from({ length: 60 }, (_, index) => {
      const day = dateKey(calendar.day(index - 60), calendar.timezone), row = map.get(day);
      return { date: day, revenue: row?.total || 0, transactions: row?.count || 0 };
    }).filter(row => firstDate && row.date >= firstDate);
    const reason = metrics.historyWarning || (series.length < 28 || series.filter(row => row.transactions > 0).length < 7 ? 'At least 28 complete store dates and seven dates with sales are required. Zero-activity dates after the first recorded sale are included.' : null);
    const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const deviation = (values: number[]) => Math.sqrt(average(values.map(value => (value - average(values)) ** 2)));
    const dailyAnomalies: { date: string; revenue: number; expected: number; deviation: number; zScore: number | null; type: string; severity: string }[] = [];
    if (!reason) for (let index = Math.max(14, series.length - 7); index < series.length; index++) {
      const baseline = series.slice(Math.max(0, index - 28), index).map(row => row.revenue), mean = average(baseline), sd = deviation(baseline), row = series[index];
      const score = sd ? (row.revenue - mean) / sd : null;
      if ((score !== null && Math.abs(score) > 2.5) || (score === null && row.revenue !== mean)) dailyAnomalies.push({ date: row.date, revenue: row.revenue, expected: roundMoney(mean), deviation: roundMoney(row.revenue - mean), zScore: score === null ? null : roundMoney(score), type: row.revenue > mean ? 'spike' : 'drop', severity: score !== null && Math.abs(score) > 3 ? 'high' : 'medium' });
    }
    const productDays = new Map<string, Map<string, number>>();
    units.forEach(row => { const days = productDays.get(row.productId) || new Map(); days.set(row.day, row.quantity); productDays.set(row.productId, days); });
    const products = await tx.product.findMany({ where: { id: { in: [...productDays.keys()] }, locationId: scope.locationId || { not: null }, sku: { not: 'MISC-001' } }, select: { id: true, name: true } });
    const lastDay = series[series.length - 1]?.date, productAnomalies: { productId: string; productName: string; lastQuantity: number; avgQuantity: number; zScore: number | null; type: string }[] = [];
    if (!reason && lastDay) for (const product of products) {
      const days = productDays.get(product.id)!;
      const values = series.slice(-29, -1).map(row => days.get(row.date) || 0);
      if (values.filter(value => value !== 0).length < 7) continue;
      const mean = average(values), sd = deviation(values), lastQuantity = days.get(lastDay) || 0, score = sd ? (lastQuantity - mean) / sd : null;
      if ((score !== null && Math.abs(score) > 2.5) || (score === null && lastQuantity !== mean)) productAnomalies.push({ productId: product.id, productName: product.name, lastQuantity, avgQuantity: roundMoney(mean), zScore: score === null ? null : roundMoney(score), type: lastQuantity > mean ? 'surge' : 'decline' });
    }
    const values = series.map(row => row.revenue);
    return { status: reason ? 'UNAVAILABLE' : 'OBSERVED', unavailableReason: reason,
      basis: 'Dated net collections include tax and subtract returns/voids on their reversal dates. Complete store dates include zero activity. Last-seven-date and last-product-date observations compare against earlier dates, not against a baseline containing the observation. Flags indicate unusual observations, not fraud or a promised future result.',
      period: { start: series[0]?.date || null, end: dateKey(calendar.day(-1), calendar.timezone), timezone: calendar.timezone, asOf: now },
      summary: { dailyAnomalies: dailyAnomalies.length, productAnomalies: productAnomalies.length, transactionAnomalies: reason ? 0 : transactions.length,
        avgDailyRevenue: reason ? null : roundMoney(average(values)), revenueStdDev: reason ? null : roundMoney(deviation(values)) },
      dailyAnomalies, productAnomalies, transactionAnomalies: reason ? [] : transactions.map(row => ({ saleId: row.id, total: Number(row.total), date: row.createdAt, type: Number(row.z) > 0 ? 'high_value' : 'low_value', zScore: row.z })),
      insights: reason ? [reason] : [`${dailyAnomalies.length} unusual complete dates and ${productAnomalies.length} unusual product observations.`, 'Original transaction-size outliers are separate from dated net collections. Calendar closures and promotions can explain flags.'] };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}

export async function abcAnalysis(scope: Scope, daysInput: unknown = 90, now = new Date(), pageInput: unknown = 1) {
  const page = z.coerce.number().int().min(1).max(100000).parse(pageInput), limit = 50;
  const days = z.coerce.number().int().min(1).max(366).parse(daysInput), calendar = await getReportCalendar(scope, now), start = calendar.day(1 - days);
  return prisma.$transaction(async tx => {
    const [activity, products, counts] = await Promise.all([
      getProductFinancialMetrics(scope, { gte: start, lte: now }, tx),
      tx.product.findMany({ where: { locationId: scope.locationId || { not: null }, sku: { not: 'MISC-001' } }, select: { id: true, stockQuantity: true, cost: true, category: { select: { name: true } } } }),
      tx.$queryRaw<{ productId: string; count: number }[]>`SELECT si."productId", COUNT(DISTINCT s.id)::int AS count FROM sale_items si JOIN sales s ON s.id = si."saleId"
        WHERE ${scopeSql(scope)} AND ${recorded} AND s."createdAt" >= (${start}::timestamptz AT TIME ZONE 'UTC') AND s."createdAt" <= (${now}::timestamptz AT TIME ZONE 'UTC') GROUP BY si."productId"`,
    ]);
    const byId = new Map((await valueProducts(tx, products)).map(product => [product.id, product])), countById = new Map(counts.map(row => [row.productId, row.count]));
    const ranked = activity.filter(row => byId.has(row.productId)).sort((a, b) => b.revenue - a.revenue || a.productId.localeCompare(b.productId));
    const eligible = (row: typeof ranked[number]) => row.revenue > 0 && !row.incompleteReturns && !row.incompleteVoids;
    const positiveRevenue = ranked.reduce((sum, row) => sum + (eligible(row) ? row.revenue : 0), 0); let cumulative = 0;
    const rows = ranked.map(row => {
      const product = byId.get(row.productId)!, preceding = positiveRevenue > 0 ? cumulative / positiveRevenue * 100 : 0;
      cumulative += eligible(row) ? row.revenue : 0;
      const classification = row.revenue <= 0 || row.incompleteReturns || row.incompleteVoids ? 'UNRANKED' : preceding < 80 ? 'A' : preceding < 95 ? 'B' : 'C';
      return { id: row.productId, name: row.productName, sku: row.sku, category: product.category?.name || 'Uncategorized', revenue: row.revenue,
        quantity: row.quantitySold, transactions: countById.get(row.productId) || 0, stockQuantity: product.stockQuantity,
        inventoryValue: product.inventoryValue, turnoverRate: null, classification,
        revenuePercentage: positiveRevenue > 0 && eligible(row) ? roundMoney(row.revenue / positiveRevenue * 100) : null,
        cumulativePercentage: positiveRevenue > 0 && eligible(row) ? roundMoney(cumulative / positiveRevenue * 100) : null };
    });
    const summary = (classification: string) => {
      const selected = rows.filter(row => row.classification === classification), revenue = roundMoney(selected.reduce((sum, row) => sum + row.revenue, 0));
      return { count: selected.length, percentage: rows.length ? roundMoney(selected.length / rows.length * 100) : 0, revenue, revenuePercentage: positiveRevenue > 0 ? roundMoney(Math.max(0, revenue) / positiveRevenue * 100) : null };
    };
    return { products: rows.slice((page - 1) * limit, page * limit), pareto: rows.filter(row => row.classification !== 'UNRANKED').slice(0, 30), pagination: { page, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) }, summary: { totalProducts: rows.length, totalRevenue: roundMoney(rows.reduce((sum, row) => sum + row.revenue, 0)), rankingRevenue: roundMoney(positiveRevenue),
      classA: summary('A'), classB: summary('B'), classC: summary('C'), unranked: summary('UNRANKED') },
      period: { days, startDate: start.toISOString(), endDate: now.toISOString(), timezone: calendar.timezone },
      basis: 'ABC ranks positive net collections including tax, after dated returns and voids. Nonpositive or incomplete activity is unranked. Current stock value is not historical average inventory; turnover remains unavailable.' };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}
