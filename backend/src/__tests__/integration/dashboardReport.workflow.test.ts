import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getDashboardReportData, getDashboardWidgetData } from '../../services/dashboardReport.service';
import { getReportCalendar } from '../../services/reportDates.service';
import { generateSaleNumber } from '../../utils/saleNumber';
import { nextDocumentSequence } from '../../services/documentNumber.service';

describe('Store dashboard uses dated financial activity', () => {
  let data: TestData, token: string;
  const get = (path = '/reports/dashboard') => request(app).get('/api' + path).set('Authorization', 'Bearer ' + token);
  const sale = async (createdAt = new Date(), options: { locationId?: string | null; userId?: string; shiftId?: string } = {}) => prisma.sale.create({ data: {
    saleNumber: generateSaleNumber(createdAt, 'America/Chicago', await nextDocumentSequence()), userId: data.adminUser.id, locationId: data.location.id, ...options, createdAt, pricingVersion: 1,
    total: 22, subtotal: 20, tax: 2, amountPaid: 22, paymentMethod: 'CARD',
    items: { create: { productId: data.product.id, productName: 'Original product', sku: data.product.sku, quantity: 2, price: 10, total: 22, tax: 2, unitCost: 4 } },
  }, include: { items: true } });
  const returned = async (original: Awaited<ReturnType<typeof sale>>, createdAt = new Date()) => prisma.refund.create({ data: {
    saleId: original.id, amount: 11, taxAmount: 1, pointsRestored: 0, method: 'CASH', reason: 'One unit', refundedBy: data.adminUser.id, createdAt,
    items: { create: { saleItemId: original.items[0].id, quantity: 1, amount: 11, taxAmount: 1, costReturned: 4 } },
  } });
  const sum = (rows: { total: number }[]) => Math.round(rows.reduce((n, row) => n + row.total, 0) * 100) / 100;
  beforeEach(async () => {
    data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
  });

  it('agrees with receipt dates at 23:59:59 and 00:00:01 and at the seven-day boundary', async () => {
    const before = await sale(new Date('2026-10-24T04:59:59Z'));
    const after = await sale(new Date('2026-10-24T05:00:01Z'));
    await sale(new Date('2026-10-18T04:59:59Z'));
    await sale(new Date('2026-10-18T05:00:01Z'));
    const report = await getDashboardReportData({ locationId: data.location.id }, new Date('2026-10-25T04:20:22Z'));
    expect(before.saleNumber).toMatch(/^S-261023-/);
    expect(after.saleNumber).toMatch(/^S-261024-/);
    expect(report.todaySales).toBe(22); expect(report.todayTransactions).toBe(1);
    expect(report.weekSales).toBe(66);
    expect(report.recentSales).toHaveLength(4);
  });

  it('reconciles cards, hourly collections, product lines and payment labels after earlier returns and voids', async () => {
    await sale(); await returned(await sale(new Date('2025-01-05T12:00:00Z')));
    const voided = await sale(new Date('2025-01-06T12:00:00Z'));
    await request(app).post('/api/sales/' + voided.id + '/void').set('Authorization', 'Bearer ' + token)
      .send({ reason: 'Duplicate terminal receipt', idempotencyKey: randomUUID() }).expect(200);
    const report = (await get().expect(200)).body.data;
    expect(report).toMatchObject({ todaySales: -11, todayTransactions: 1, averageOrderValue: 22, todayRefunds: 11, todayVoids: 22, todayVoidCount: 1 });
    expect(sum(report.hourlyData)).toBe(-11); expect(sum(report.paymentBreakdown)).toBe(-11);
    expect(report.topProducts[0]).toMatchObject({ name: 'Original product', qty: -1, revenue: -11 });
    expect(report.paymentBreakdown.every((p: { percentage: unknown }) => p.percentage === null)).toBe(true);
    expect(report.unallocatedProductTotal).toBe(0);
    expect(report.recentSales.find((s: { id: string }) => s.id === voided.id).status).toBe('VOIDED');
    const overall = (await get('/reports/overall').expect(200)).body.data;
    expect(report.todaySales).toBe(overall.revenue.today.total); expect(report.monthSales).toBe(overall.revenue.month.total);
    const compatible = (await get('/reports/dashboard/hourly').expect(200)).body.data;
    expect(sum(compatible.hourlyData)).toBe(-11); expect(compatible.topProducts).toEqual(report.topProducts);
  });

  it('uses exactly seven and thirty store dates and excludes future sales', async () => {
    const now = new Date('2026-10-17T17:30:00Z'), calendar = await getReportCalendar({ locationId: data.location.id }, now);
    for (const at of [calendar.day(-6), new Date(calendar.day(-6).getTime() - 1), calendar.day(-29), new Date(calendar.day(-29).getTime() - 1), new Date(now.getTime() + 1)]) await sale(at);
    const report = await getDashboardReportData({ locationId: data.location.id }, now);
    expect(report.weekSales).toBe(22); expect(report.monthSales).toBe(66); expect(report.todaySales).toBe(0);
    expect(report.recentSales).toHaveLength(4); expect(report.averageOrderValue).toBeNull();
    expect(report.period.week).toEqual(calendar.day(-6)); expect(report.period.month).toEqual(calendar.day(-29));
  });

  it('keeps midnight, repeated DST hours and the partial twelve-hour boundary accurate', async () => {
    const now = new Date('2026-11-01T09:30:00Z');
    for (const at of ['2026-10-31T21:29:59.999Z', '2026-10-31T21:30:00Z', '2026-11-01T04:59:59Z', '2026-11-01T05:15:00Z', '2026-11-01T06:30:00Z', '2026-11-01T07:30:00Z']) await sale(new Date(at));
    const report = await getDashboardReportData({ locationId: data.location.id }, now);
    expect(report.todaySales).toBe(66); expect(report.topProducts[0].revenue).toBe(66);
    expect(report.hourlyData).toHaveLength(13); expect(sum(report.hourlyData)).toBe(110);
    for (const at of ['2026-11-01T06:00:00Z', '2026-11-01T07:00:00Z']) expect(report.hourlyData.find(row => row.timestamp === Date.parse(at))?.total).toBe(22);
    expect(report.hourlyData[0].total).toBe(22); expect(report.period.timezone).toBe('America/Chicago');
    expect((await getDashboardWidgetData({ locationId: data.location.id }, now)).hourlyData).toEqual(report.hourlyData);
  });

  it('scopes both endpoints to the store and cashier and excludes unassigned platform records', async () => {
    const partner = await prisma.location.create({ data: { name: 'Partner', address: 'Other', city: 'Other', state: 'TS', zipCode: '12345', phone: '5550000000', email: 'partner@example.test' } });
    await sale(); await sale(new Date(), { userId: data.cashierUser.id }); await sale(new Date(), { locationId: partner.id }); await sale(new Date(), { locationId: null });
    for (const userId of [data.adminUser.id, data.cashierUser.id]) await prisma.shift.create({ data: { userId, locationId: data.location.id, clockInAt: new Date(), hourlyRate: 99 } });
    expect((await get().expect(200)).body.data.todaySales).toBe(44);
    for (const endpoint of ['/reports/dashboard', '/reports/dashboard/hourly']) await get(endpoint + '?locationId=' + partner.id).expect(403);
    token = await createTestToken(data.cashierUser.id, 'CASHIER');
    const own = (await get().expect(200)).body.data;
    expect(own.todaySales).toBe(22); expect(own.activeEmployees).toBe(1); expect(own.recentSales).toHaveLength(1);
    for (const endpoint of ['/reports/dashboard', '/reports/dashboard/hourly']) {
      const report = (await get(endpoint).expect(200)).body.data;
      expect(report.activeShifts).toHaveLength(1); expect(report.activeShifts[0].employeeName).toBe('Cashier User');
      expect(JSON.stringify(report)).not.toMatch(/hourlyRate|password/); expect(sum(report.hourlyData)).toBe(22);
    }
    const platform = await getDashboardReportData({}); expect(platform.todaySales).toBe(66); expect(platform.recentSales).toHaveLength(3);
  });

  it('shows valid empty results and omits MISC and untracked items from stock alerts', async () => {
    const empty = await getDashboardReportData({ locationId: data.location.id });
    expect(empty).toMatchObject({ todaySales: 0, averageOrderValue: null, todayTrend: null, lowStockCount: 0, topProducts: [], paymentBreakdown: [] });
    await prisma.product.createMany({ data: [
      { name: 'MISC', sku: 'MISC-001', price: 1, stockQuantity: 0, locationId: data.location.id },
      { name: 'Untracked', sku: 'UNTRACKED', price: 1, stockQuantity: 0, trackInventory: false, locationId: data.location.id },
      { name: 'Low', sku: 'LOW', price: 1, stockQuantity: 2, lowStockAlert: 3, locationId: data.location.id },
      { name: 'Out', sku: 'OUT', price: 1, stockQuantity: 0, lowStockAlert: 3, locationId: data.location.id },
    ] });
    const report = await getDashboardReportData({ locationId: data.location.id });
    expect(report.totalProducts).toBe(4); expect(report.lowStockCount).toBe(2); expect(report.lowStockItems.map(p => p.stock)).toEqual([0, 2]);
  });

  it('reports unallocated legacy returns and unknown reversal dates instead of inventing product allocations or comparisons', async () => {
    await sale(); const original = await sale(new Date('2025-01-01T12:00:00Z'));
    await prisma.refund.create({ data: { saleId: original.id, amount: 5, reason: 'Old return', refundedBy: data.adminUser.id } });
    const unknown = await sale(new Date('2025-02-01T12:00:00Z')); await prisma.sale.update({ where: { id: unknown.id }, data: { status: 'VOIDED' } });
    const report = await getDashboardReportData({ locationId: data.location.id });
    expect(report.todaySales).toBe(17); expect(report.unallocatedProductTotal).toBe(-5); expect(report.productWarning).toBeTruthy();
    expect(report.historyWarning).toContain('no recorded reversal date'); expect(report.monthTrend).toBeNull();
  });

  it('derives active-shift sales from original linked activity instead of cached counters', async () => {
    const shift = await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, clockInAt: new Date('2025-01-01T00:00:00Z'), totalSales: 999, totalTransactions: 999 } });
    await returned(await sale(new Date('2025-01-05T12:00:00Z'), { shiftId: shift.id }));
    const report = await getDashboardReportData({ locationId: data.location.id });
    expect(report.activeShifts[0]).toMatchObject({ id: shift.id, totalSales: 11, totalTransactions: 1 });
    expect(report.todaySales).toBe(-11); expect(report.averageOrderValue).toBeNull();
  });
});
