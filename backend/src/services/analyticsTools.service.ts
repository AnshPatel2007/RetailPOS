import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/errorHandler';
import { getFinancialBreakdowns, getFinancialMetrics, getProductFinancialMetrics } from './financialMetrics.service';
import { getReportRange } from './reportDates.service';

/** Model-supplied arguments never choose the store or become database queries. */
export async function runAnalyticsTool(name: string, input: unknown, locationId: string | null): Promise<unknown> {
  if (!locationId) throw new AppError('A store assignment is required', 403);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Invalid tool arguments', 400);
  const args = input as Record<string, unknown>;
  const scope = { locationId };
  if (name === 'get_inventory_alerts') {
    const store = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } });
    if (!store) throw new AppError('Store not found', 404);
    const where = { locationId, isActive: true, trackInventory: true, sku: { not: 'MISC-001' } };
    return prisma.$transaction(async tx => {
      const [lowStock, stock] = await Promise.all([
        tx.product.findMany({ where: { ...where, OR: [{ stockQuantity: { lte: 0 } }, { stockQuantity: { lte: prisma.product.fields.lowStockAlert } }] },
          select: { name: true, sku: true, stockQuantity: true, lowStockAlert: true }, orderBy: [{ stockQuantity: 'asc' }, { id: 'asc' }], take: 15 }),
        tx.product.aggregate({ where, _count: true, _sum: { stockQuantity: true } }),
      ]);
      return { locationId, asOf: new Date(), lowStock: lowStock.map(p => ({ name: p.name, sku: p.sku, stock: p.stockQuantity, threshold: p.lowStockAlert })),
        activeTrackedProducts: stock._count, totalUnitsOnHand: stock._sum.stockQuantity || 0, alertLimit: 15 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  if (!['get_sales_summary', 'get_top_products', 'get_tender_breakdown', 'get_hourly_sales', 'get_employee_sales'].includes(name)) throw new AppError('Unknown analytics tool', 400);
  const start = name === 'get_hourly_sales' ? args.date : args.startDate;
  const end = name === 'get_hourly_sales' ? args.date : args.endDate ?? start;
  if (typeof start !== 'string' || typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new AppError('Use YYYY-MM-DD dates', 400);
  const period = await getReportRange(scope, start, end);
  if (period.end.getTime() - period.start!.getTime() > 367 * 86400000) throw new AppError('Select at most one year per query', 400);
  const limit = args.limit ?? 10;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 25) throw new AppError('Product limit must be between 1 and 25', 400);
  return prisma.$transaction(async tx => {
    const metrics = await getFinancialMetrics(scope, period.range, tx);
    const context = { locationId, currency: 'USD', period: { startDate: start, endDate: end, timezone: period.timezone }, historyWarning: metrics.historyWarning };
    if (name === 'get_sales_summary') return { ...context, ...metrics,
      averageOrderValue: metrics.transactions ? Math.round(metrics.grossCollected / metrics.transactions * 100) / 100 : null,
      definition: 'Net sales exclude tax. Net collected includes tax and subtracts refunds and voids on their reversal dates. Expenses include payroll totals, never wage details.' };
    if (name === 'get_top_products') {
      const products = await getProductFinancialMetrics(scope, period.range, tx);
      return { ...context, products: products.sort((a, b) => b.revenue - a.revenue || a.productId.localeCompare(b.productId)).slice(0, Number(limit)),
        definition: 'Signed product activity: original sales less returns and voids in this period. Revenue includes tax. Incomplete historical allocations are flagged.' };
    }
    const kind = name === 'get_tender_breakdown' ? 'payment' : name === 'get_hourly_sales' ? 'epochHour' : 'employee';
    const rows = await getFinancialBreakdowns(scope, period.range, period.timezone, period.start!, tx, [kind]);
    if (kind === 'employee') {
      const users = await tx.user.findMany({ where: { id: { in: rows.map(row => row.key) } }, select: { id: true, firstName: true, lastName: true } });
      const names = new Map(users.map(user => [user.id, user.firstName + ' ' + user.lastName]));
      return { ...context, employees: rows.map(row => ({ employee: names.get(row.key) || 'Unknown', transactions: row.count, netCollected: row.total })).sort((a, b) => b.netCollected - a.netCollected),
        definition: 'Dated net collections attributed to the original seller; no wage or timekeeping details.' };
    }
    if (kind === 'epochHour') return { ...context, hours: rows.map(row => ({ timestamp: new Date(Number(row.key)).toISOString(), transactions: row.count, netCollected: row.total })).sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      definition: 'Elapsed-hour buckets, displayed in the store timezone. Repeated daylight-saving hours remain separate.' };
    return { ...context, paymentLabels: rows.map(row => ({ method: row.key, transactions: row.count, netCollected: row.total })),
      definition: 'Original sale payment labels and actual refund methods. Includes SPLIT as a label; this is not tender settlement or cash drawer reconciliation.' };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}
