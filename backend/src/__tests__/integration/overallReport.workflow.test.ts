import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getOverallReportData } from '../../services/overallReport.service';
import { getReportCalendar } from '../../services/reportDates.service';

describe('Overall report reconciles its cards and breakdowns', () => {
  let data: TestData, token: string;
  const get = (path: string) => request(app).get('/api' + path).set('Authorization', 'Bearer ' + token);
  const sale = (createdAt = new Date(), locationId: string | null = data.location.id) => prisma.sale.create({ data: {
    saleNumber: randomUUID(), userId: data.adminUser.id, locationId, createdAt, pricingVersion: 1,
    total: 22, subtotal: 20, tax: 2, amountPaid: 22, paymentMethod: 'CARD',
    items: { create: { productId: data.product.id, productName: 'Original product', sku: data.product.sku,
      quantity: 2, price: 10, total: 22, tax: 2, unitCost: 4 } },
  }, include: { items: true } });
  const sum = (rows: object[], key: string) => Math.round(rows.reduce((n, row) => n + Number((row as Record<string, unknown>)[key]), 0) * 100) / 100;
  beforeEach(async () => {
    data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
  });

  it('deducts prior-period returns and voids consistently across cards, charts, staff and payment labels', async () => {
    await sale();
    const returned = await sale(new Date('2025-01-05T12:00:00Z'));
    await prisma.refund.create({ data: { saleId: returned.id, amount: 11, taxAmount: 1, pointsRestored: 0, method: 'CASH', reason: 'One unit', refundedBy: data.adminUser.id,
      items: { create: { saleItemId: returned.items[0].id, quantity: 1, amount: 11, taxAmount: 1, costReturned: 4 } } } });
    const voided = await sale(new Date('2025-01-06T12:00:00Z'));
    await request(app).post('/api/sales/' + voided.id + '/void').set('Authorization', 'Bearer ' + token).send({ reason: 'Duplicate terminal receipt', idempotencyKey: randomUUID() }).expect(200);
    const report = (await get('/reports/overall').expect(200)).body.data;
    expect(report.revenue.month).toMatchObject({ total: -11, tax: -1, netSales: -10, transactions: 1, grossCollected: 22 });
    expect(report.profitability).toMatchObject({ grossProfit: -6, costOfGoodsSold: -4 });
    expect(report.refundsAndVoids).toEqual({ refunds: { total: 11, count: 1 }, voids: { total: 22, count: 1 } });
    for (const [rows, key] of [[report.trends.dailySales, 'sales'], [report.trends.hourlySales, 'sales'], [report.employeePerformance, 'totalSales'], [report.paymentMethods, 'total'], [report.salesByCategory, 'revenue']] as const) expect(sum(rows, key)).toBe(-11);
    expect(report.employeePerformance[0]).toMatchObject({ transactions: 1, totalSales: -11, avgOrderValue: 22 });
    expect(report.paymentMethods.every((row: { percentage: number | null }) => row.percentage === null)).toBe(true);
    expect(report.topProducts[0]).toMatchObject({ revenue: -11, quantitySold: -1 });
    const query = '?startDate=' + encodeURIComponent(report.period.start) + '&endDate=' + encodeURIComponent(report.period.asOf);
    expect((await get('/reports/sales' + query).expect(200)).body.data.summary.totalSales).toBe(-11);
    expect((await get('/financial/export/sales' + query).expect(200)).body.data.totalRevenue).toBe(-11);
  });

  it('uses exactly 30 local dates and excludes future activity from each period', async () => {
    const now = new Date('2026-10-16T17:00:00Z'), calendar = await getReportCalendar({ locationId: data.location.id }, now);
    await sale(calendar.day(-29));
    await sale(new Date(calendar.day(-29).getTime() - 1));
    await sale(new Date(now.getTime() + 1));
    const report = await getOverallReportData({ locationId: data.location.id }, now);
    expect(report.revenue.month.total).toBe(22); expect(report.revenue.year.total).toBe(44);
    expect(report.trends.dailySales).toHaveLength(30);
    expect(report.trends.dailySales[0]).toMatchObject({ date: '2026-09-17', sales: 22 });
    expect(sum(report.trends.dailySales, 'sales')).toBe(report.revenue.month.total);
    expect(report.revenue.week.growth).toBeNull();
  });

  it('groups midnight and both repeated daylight-saving hours in the store calendar', async () => {
    const now = new Date('2026-11-01T09:00:00Z');
    for (const at of ['2026-11-01T04:59:59Z', '2026-11-01T05:15:00Z', '2026-11-01T06:30:00Z', '2026-11-01T07:30:00Z']) await sale(new Date(at));
    const report = await getOverallReportData({ locationId: data.location.id }, now);
    expect(report.revenue.today.total).toBe(66);
    expect(report.trends.hourlySales[0]).toMatchObject({ sales: 22, transactions: 1 });
    expect(report.trends.hourlySales[1]).toMatchObject({ sales: 44, transactions: 2 });
    expect(report.trends.dailySales.find(row => row.date === '2026-10-31')?.sales).toBe(22);
    expect(report.trends.dailySales.find(row => row.date === '2026-11-01')?.sales).toBe(66);
    expect(sum(report.trends.hourlySales, 'sales')).toBe(report.revenue.today.total);
  });

  it('keeps legacy allocation gaps and missing void dates visible instead of inventing profit', async () => {
    await sale(); const old = await sale(new Date('2025-01-01T12:00:00Z'));
    await prisma.refund.create({ data: { saleId: old.id, amount: 5, reason: 'Old amount-only return', refundedBy: data.adminUser.id } });
    const unknownVoid = await sale(new Date('2025-02-01T12:00:00Z'));
    await prisma.sale.update({ where: { id: unknownVoid.id }, data: { status: 'VOIDED' } });
    const report = await getOverallReportData({ locationId: data.location.id });
    expect(report.revenue.month.total).toBe(17); expect(report.revenue.today.tax).toBeNull();
    expect(report.historyWarning).toContain('no recorded reversal date');
    expect(report.profitability.netProfit).toBeNull(); expect(report.revenue.month.growth).toBeNull();
    expect(report.salesByCategory).toContainEqual({ name: 'Unallocated historical activity', revenue: -5, quantity: 0 });
    expect(sum(report.salesByCategory, 'revenue')).toBe(17);
  });

  it('blocks cross-store and cashier access and excludes unassigned records from platform aggregates', async () => {
    const other = await prisma.location.create({ data: { name: 'Partner', address: 'Other', city: 'Other', state: 'TS', zipCode: '12345', phone: '5550000000', email: 'partner@example.test' } });
    await sale(new Date(), other.id); await sale(new Date(), null);
    expect((await get('/reports/overall').expect(200)).body.data.revenue.month.total).toBe(0);
    await get('/reports/overall?locationId=' + other.id).expect(403);
    token = await createTestToken(data.cashierUser.id, 'CASHIER'); await get('/reports/overall').expect(403);
    const platform = await getOverallReportData({});
    expect(platform.revenue.month.total).toBe(22); expect(sum(platform.trends.dailySales, 'sales')).toBe(22);
    expect(platform.period.timezone).toBe('UTC');
  });

  it('keeps empty states honest and excludes MISC/untracked quantities from inventory value', async () => {
    const empty = await getOverallReportData({ locationId: data.location.id });
    expect(empty.revenue.month).toMatchObject({ total: 0, transactions: 0, growth: null });
    expect(empty.profitability.grossMargin).toBeNull(); expect(empty.paymentMethods).toEqual([]);
    await prisma.product.createMany({ data: [
      { name: 'MISC', sku: 'MISC-001', price: 100, cost: 100, stockQuantity: 100, locationId: data.location.id },
      { name: 'Service', sku: 'SERVICE', price: 100, cost: 100, stockQuantity: 100, trackInventory: false, locationId: data.location.id },
    ] });
    const report = await getOverallReportData({ locationId: data.location.id });
    expect(report.inventory.inventoryValue).toBe(empty.inventory.inventoryValue);
    expect(report.inventory.totalProducts).toBe(empty.inventory.totalProducts + 1);
    expect(report.inventory.stockTurnover).toBeNull();
  });
});
