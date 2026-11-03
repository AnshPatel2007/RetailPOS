import { PaymentMethod, Prisma, SaleStatus } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { getLocationFilter } from '../utils/locationFilter.util';
import { dateCondition, getFinancialBreakdowns, SaleCriteria, recordedSaleSql, saleScope } from './financialMetrics.service';
import { getSalesCollectionMetrics } from './salesCollectionMetrics.service';
import { getReportRange } from './reportDates.service';

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const list = z.string().max(2000).optional().transform(value => value?.split(',').filter(Boolean));
const amount = z.preprocess(value => value === '' || value === undefined ? undefined : value,
  z.coerce.number().finite().nonnegative().max(100_000_000).optional());
const page = z.preprocess(value => value === '' || value === undefined ? 1 : value, z.coerce.number().int().min(1).max(1_000_000_000));
const querySchema = z.object({ userId: list, paymentMethod: list, status: list,
  customerId: z.string().max(100).optional(), minAmount: amount, maxAmount: amount,
  search: z.string().trim().max(200).optional(), page, refundPage: page, voidPage: page,
  entryPage: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
});
const PAGE_SIZE = 50;
const DIRECT_EXPORT_LIMIT = 5000;
const select = {
  id: true, sourceType: true, sourceData: true, saleNumber: true, customerId: true, userId: true, total: true, subtotal: true,
  tax: true, discount: true, paymentMethod: true, amountPaid: true, changeDue: true,
  status: true, createdAt: true, completedAt: true,
  voidEvent: { select: { id: true, createdAt: true, reason: true } },
  items: { select: { id: true, productId: true, productName: true, sku: true, quantity: true, price: true, total: true, discount: true } },
  user: { select: { id: true, firstName: true, lastName: true } },
  customer: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  location: { select: { name: true } },
} satisfies Prisma.SaleSelect;
type SaleRow = Prisma.SaleGetPayload<{ select: typeof select }>;
type EntryKind = 'SALE' | 'REFUND' | 'VOID';
const person = (value: { firstName: string; lastName: string } | null, fallback = 'Unavailable') => value ? value.firstName + ' ' + value.lastName : fallback;
export type SaleReportEntry = { sourceType?: string; storeDate?: string; id: string; saleId: string; saleNumber: string; kind: EntryKind; createdAt: Date;
  employee: string; employeeId: string; customer: string; location: string; method: string; status: string;
  total: number; tax: number | null; discount: number; originalSaleTotal: number; reversalTenders?: Prisma.JsonValue | null; };

/** Page each collection independently. Totals/charts always use the complete filtered
 * range in the same repeatable-read snapshot, including earlier sales returned now.
 * Downloads must explicitly request a complete snapshot; page parameters never trim
 * a download. Large storewide CSVs use the durable export queue instead.
 */
export async function getSalesReportData(req: AuthRequest, options: { forExport?: boolean } = {}) {
  const scope = getLocationFilter(req, req.query.locationId as string);
  const period = await getReportRange(scope, req.query.startDate, req.query.endDate);
  const q = querySchema.parse(req.query);
  if (q.minAmount !== undefined && q.maxAmount !== undefined && q.minAmount > q.maxAmount) throw new AppError('Minimum amount must not exceed maximum amount', 400);
  if (q.paymentMethod?.some(value => !Object.values(PaymentMethod).includes(value as PaymentMethod)) || q.status?.some(value => !Object.values(SaleStatus).includes(value as SaleStatus))) throw new AppError('Select a valid payment method or sale status', 400);
  const criteria: SaleCriteria = { userIds: q.userId, paymentMethods: q.paymentMethod, statuses: q.status,
    customerId: q.customerId, minAmount: q.minAmount, maxAmount: q.maxAmount, search: q.search };
  const filteredScope = { ...scope, criteria };
  // All row searches and aggregates share the SQL filter; literal wildcard text is
  // not expanded into a large application-side customer-ID list.
  const originalFilter = Prisma.sql`${saleScope(filteredScope)} AND ${q.status?.length ? Prisma.sql`TRUE` : recordedSaleSql}`;
  const activity = Prisma.sql`WITH activity AS (
    SELECT s.id, 'SALE'::text AS kind, s."createdAt" AS occurred FROM sales s
      WHERE ${originalFilter} AND ${dateCondition(Prisma.sql`s."createdAt"`, period.range)}
    UNION ALL
    SELECT r.id, 'REFUND'::text, r."createdAt" FROM refunds r JOIN sales s ON s.id = r."saleId"
      WHERE ${originalFilter} AND s.status IN ('COMPLETED', 'REFUNDED') AND ${dateCondition(Prisma.sql`r."createdAt"`, period.range)}
    UNION ALL
    SELECT v.id, 'VOID'::text, v."createdAt" FROM sale_voids v JOIN sales s ON s.id = v."saleId"
      WHERE ${originalFilter} AND ${dateCondition(Prisma.sql`v."createdAt"`, period.range)}
  )`;
  const data = await prisma.$transaction(async tx => {
    // Broad date ranges and selective filters need their actual cardinalities.
    // Generic prepared plans underestimated a 90,000-sale range and repeated
    // thousands of probes. This setting expires with this report transaction.
    await tx.$executeRawUnsafe('SET LOCAL plan_cache_mode = force_custom_plan');
    // The measured 90,000-sale report spilled its scoped tender/date aggregates
    // at PostgreSQL's 4 MB default. Bound this report's workspace to 16 MB per
    // executor node; the server/session default is restored at transaction end.
    await tx.$executeRawUnsafe("SET LOCAL work_mem = '16MB'");
    const metrics = await getSalesCollectionMetrics(filteredScope, period.range, tx, { includeUnbookedRows: !!q.status?.length });
    const total = (kind: EntryKind) => metrics.entryCounts[kind];
    const entryCount = total('SALE') + total('REFUND') + total('VOID');
    if (options.forExport && entryCount > DIRECT_EXPORT_LIMIT) throw new AppError('Direct CSV and PDF downloads support up to 5,000 entries. Narrow this report, or open Reports > Exports to queue a full store sales CSV.', 413);
    const paging = (requested: number, count: number) => ({ page: Math.min(requested, Math.max(1, Math.ceil(count / PAGE_SIZE))), pageSize: PAGE_SIZE, total: count, totalPages: Math.max(1, Math.ceil(count / PAGE_SIZE)) });
    const pagination = { sales: paging(q.page, total('SALE')), refunds: paging(q.refundPage, total('REFUND')), voids: paging(q.voidPage, total('VOID')), entries: paging(q.entryPage || 1, entryCount), entryCount };
    // Fetch each page directly from its dated table. Ranking the union first
    // sorted every matching row even for the first 50 transactions.
    const pageIds = options.forExport
      ? Prisma.sql`${activity} SELECT id, kind FROM activity`
      : q.entryPage
        ? Prisma.sql`${activity} SELECT id, kind FROM activity ORDER BY occurred DESC, id ASC LIMIT ${PAGE_SIZE} OFFSET ${(pagination.entries.page - 1) * PAGE_SIZE}`
        : Prisma.sql`(SELECT s.id, 'SALE'::text AS kind FROM sales s
            WHERE ${originalFilter} AND ${dateCondition(Prisma.sql`s."createdAt"`, period.range)}
            ORDER BY s."createdAt" DESC, s.id ASC LIMIT ${PAGE_SIZE} OFFSET ${(pagination.sales.page - 1) * PAGE_SIZE})
          UNION ALL (SELECT r.id, 'REFUND'::text AS kind FROM refunds r JOIN sales s ON s.id = r."saleId"
            WHERE ${originalFilter} AND s.status IN ('COMPLETED', 'REFUNDED') AND ${dateCondition(Prisma.sql`r."createdAt"`, period.range)}
            ORDER BY r."createdAt" DESC, r.id ASC LIMIT ${PAGE_SIZE} OFFSET ${(pagination.refunds.page - 1) * PAGE_SIZE})
          UNION ALL (SELECT v.id, 'VOID'::text AS kind FROM sale_voids v JOIN sales s ON s.id = v."saleId"
            WHERE ${originalFilter} AND ${dateCondition(Prisma.sql`v."createdAt"`, period.range)}
            ORDER BY v."createdAt" DESC, v.id ASC LIMIT ${PAGE_SIZE} OFFSET ${(pagination.voids.page - 1) * PAGE_SIZE})`;
    const [ids, breakdowns] = await Promise.all([
      tx.$queryRaw<{ id: string; kind: EntryKind }[]>(pageIds),
      getFinancialBreakdowns(filteredScope, period.range, period.timezone, period.end, tx, ['day', 'employee', 'payment']),
    ]);
    const rowIds = (kind: EntryKind) => ids.filter(row => row.kind === kind).map(row => row.id);
    const [sales, refunds, voids, employees] = await Promise.all([
      tx.sale.findMany({ where: { id: { in: rowIds('SALE') } }, select, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
      tx.refund.findMany({ where: { id: { in: rowIds('REFUND') } }, select: { id: true, createdAt: true, amount: true, taxAmount: true, method: true, tenders: true, reason: true, sale: { select } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
      tx.saleVoid.findMany({ where: { id: { in: rowIds('VOID') } }, select: { id: true, createdAt: true, amount: true, taxAmount: true, reason: true, tenders: true, sale: { select } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
      // Retain inactive original sellers in attribution; never expose wage fields.
      tx.user.findMany({ where: { OR: [
        { ...(scope.locationId ? { locationId: scope.locationId } : { locationId: { not: null } }), role: { not: 'SUPER_ADMIN' } },
        { id: { in: breakdowns.filter(row => row.kind === 'employee').map(row => row.key) } },
      ] }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }] }),
    ]);
    return { sales, refunds, voids, employees, metrics, breakdowns, pagination, entriesPartial: !options.forExport && ids.length < entryCount };
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
  const { sales, refunds, voids, employees, metrics, breakdowns, pagination, entriesPartial } = data;
  const base = (sale: SaleRow) => ({ saleId: sale.id, saleNumber: sale.saleNumber, sourceType: sale.sourceType, employee: sale.sourceType === 'DAILY_SUMMARY' ? 'Not supplied (daily summary)' : person(sale.user), employeeId: sale.sourceType === 'DAILY_SUMMARY' ? '' : sale.userId,
    customer: sale.sourceType === 'DAILY_SUMMARY' ? 'Not supplied' : person(sale.customer, 'Walk-in'), location: sale.location?.name || '', status: sale.status, originalSaleTotal: Number(sale.total) });
  const exportDates = new Intl.DateTimeFormat('en-CA', { timeZone: period.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const entries: SaleReportEntry[] = [
    ...sales.map(sale => { const booked = sale.status === 'COMPLETED' || sale.status === 'REFUNDED' || !!sale.voidEvent; return {
      ...base(sale), id: sale.id, kind: 'SALE' as const, createdAt: sale.createdAt, method: sale.paymentMethod,
      total: Number(booked ? sale.total : 0), tax: Number(booked ? sale.tax : 0), discount: Number(booked ? sale.discount : 0),
    }; }),
    ...refunds.map(refund => ({ ...base(refund.sale), id: refund.id, kind: 'REFUND' as const, createdAt: refund.createdAt,
      method: refund.method || 'UNAVAILABLE', reversalTenders: refund.tenders, total: -Number(refund.amount), tax: refund.taxAmount === null ? null : -Number(refund.taxAmount), discount: 0 })),
    ...voids.map(event => ({ ...base(event.sale), id: event.id, kind: 'VOID' as const, createdAt: event.createdAt,
      method: event.sale.paymentMethod, reversalTenders: event.tenders, total: -Number(event.amount), tax: -Number(event.taxAmount), discount: 0 })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
    .map(entry => ({ ...entry, storeDate: exportDates.format(entry.createdAt) }));
  const paymentBreakdown: Record<string, { count: number | null; total: number }> = {};
  const employeeBreakdown: Record<string, { name: string; count: number | null; total: number }> = {};
  const dailyBreakdown: Record<string, { count: number | null; total: number }> = {};
  const names = new Map(employees.map(user => [user.id, person(user)]));
  for (const row of breakdowns) {
    if (row.kind === 'payment') paymentBreakdown[row.key] = { count: row.count, total: row.total };
    else if (row.kind === 'employee') employeeBreakdown[row.key] = { name: names.get(row.key) || 'Unavailable', count: row.count, total: row.total };
    else if (row.kind === 'day') dailyBreakdown[row.key] = { count: row.count, total: row.total };
  }
  return { sales, refunds, voids: voids.map(event => ({ ...event, amount: Number(event.amount), taxAmount: Number(event.taxAmount) })), employees, entries, entriesPartial, pagination, period, paymentBreakdown, employeeBreakdown, dailyBreakdown,
    historyWarning: metrics.historyWarning,
    summary: { totalSales: metrics.netCollected, grossCollected: metrics.grossCollected, refunds: metrics.refunds, refundCount: metrics.refundCount,
      voids: metrics.voids, voidCount: metrics.voidCount,
      historicalSummaries: metrics.historicalSummaries, totalTransactions: metrics.transactions, averageOrderValue: metrics.transactions === null ? null : metrics.transactions ? round(metrics.grossCollected / metrics.transactions) : 0,
      totalTax: metrics.netTax, netSales: metrics.netSales, totalDiscount: metrics.discounts },
  };
}

export function salesReportCSV(report: Awaited<ReturnType<typeof getSalesReportData>>) {
  if (report.entriesPartial) throw new AppError('Reload the complete report before exporting; a report page cannot be exported as the full range.', 409);
  const { Parser } = require('json2csv');
  const text = (value: string) => /^[=+@\-\t\r]/.test(value) ? "'" + value : value;
  const fields = ['Entry', 'Record ID', 'Sale Number', 'Timestamp', 'Store Date', 'Timezone', 'Employee', 'Customer', 'Payment Method', 'Reversal tender allocations', 'Total', 'Tax', 'Discount', 'Original Sale Total', 'Status', 'Location'];
  return new Parser({ fields }).parse(report.entries.map(entry => ({
    'Entry': entry.sourceType === 'DAILY_SUMMARY' ? 'DAILY_SUMMARY' : entry.kind, 'Record ID': entry.id, 'Sale Number': text(entry.saleNumber), Timestamp: entry.sourceType === 'DAILY_SUMMARY' ? '' : entry.createdAt.toISOString(),
    'Store Date': new Intl.DateTimeFormat('en-CA', { timeZone: report.period.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(entry.createdAt),
    Timezone: report.period.timezone, Employee: text(entry.employee), Customer: text(entry.customer), 'Payment Method': entry.sourceType === 'DAILY_SUMMARY' ? 'Card recorded; remainder unspecified' : entry.method,
    'Reversal tender allocations': entry.reversalTenders ? JSON.stringify(entry.reversalTenders) : '',
    Total: entry.total.toFixed(2), Tax: entry.tax === null ? 'Unavailable' : entry.tax.toFixed(2), Discount: entry.sourceType === 'DAILY_SUMMARY' ? 'Unavailable' : entry.discount.toFixed(2),
    'Original Sale Total': entry.originalSaleTotal.toFixed(2), Status: entry.status, Location: text(entry.location),
  })));
}
