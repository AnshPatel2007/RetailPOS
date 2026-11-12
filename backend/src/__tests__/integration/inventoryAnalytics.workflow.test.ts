import { randomUUID } from 'crypto';
import { prisma, seedTestData, TestData } from './setup';
import { abcAnalysis, salesAnomalies } from '../../services/inventoryAnalytics.service';
import { employeeActivity } from '../../services/employeeActivity.service';

describe('dated inventory and activity analytics', () => {
  let data: TestData;
  const now = new Date('2026-11-01T18:00:00Z');
  beforeEach(async () => {
    data = await seedTestData();
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
  });
  const sell = (at: string, quantity = 1, locationId = data.location.id) => prisma.sale.create({ data: {
    saleNumber: randomUUID(), userId: data.cashierUser.id, locationId, createdAt: new Date(at), pricingVersion: 1,
    paymentMethod: 'CASH', subtotal: quantity * 10, tax: quantity, total: quantity * 11, amountPaid: quantity * 11,
    items: { create: { productId: data.product.id, productName: data.product.name, sku: data.product.sku,
      quantity, price: 10, total: quantity * 11, tax: quantity, unitCost: 4 } },
  }, include: { items: true } });
  const refund = (sale: Awaited<ReturnType<typeof sell>>, at: string) => prisma.refund.create({ data: {
    saleId: sale.id, amount: 11, taxAmount: 1, pointsRestored: 0, method: 'CASH', reason: 'One unit returned', refundedBy: data.adminUser.id,
    createdAt: new Date(at), items: { create: { saleItemId: sale.items[0].id, quantity: 1, amount: 11, taxAmount: 1, costReturned: 4 } },
  } });

  it('leaves sparse anomaly history unavailable instead of reporting zero dollars as an estimate', async () => {
    await sell('2026-10-31T12:00:00Z');
    expect(await salesAnomalies({ locationId: data.location.id }, now)).toMatchObject({ status: 'UNAVAILABLE', summary: { avgDailyRevenue: null, revenueStdDev: null }, dailyAnomalies: [] });
  });

  it('includes zero-activity dates and subtracts a return on its own date', async () => {
    const original = await sell('2026-09-01T12:00:00Z');
    for (const day of [3, 7, 11, 15, 19, 23, 27]) await sell(`2026-10-${String(day).padStart(2, '0')}T12:00:00Z`);
    await refund(original, '2026-10-31T12:00:00Z');
    await sell('2026-11-01T12:00:00Z', 100);
    const result = await salesAnomalies({ locationId: data.location.id }, now);
    expect(result).toMatchObject({ status: 'OBSERVED', summary: { avgDailyRevenue: 1.1 }, period: { start: '2026-09-02', end: '2026-10-31', timezone: 'America/Chicago' } });
    expect(result.dailyAnomalies.every(row => row.date < '2026-11-01')).toBe(true);
  });

  it('ranks a single dominant SKU as A and keeps negative collections unranked', async () => {
    await sell('2026-11-01T12:00:00Z');
    expect(await abcAnalysis({ locationId: data.location.id }, 1, now)).toMatchObject({ products: [{ classification: 'A', turnoverRate: null }], summary: { classA: { count: 1 } } });
    await refund(await sell('2026-09-01T12:00:00Z'), '2026-11-01T13:00:00Z');
    await refund(await sell('2026-09-02T12:00:00Z'), '2026-11-01T14:00:00Z');
    expect(await abcAnalysis({ locationId: data.location.id }, 1, now)).toMatchObject({ products: [{ revenue: -11, classification: 'UNRANKED', revenuePercentage: null }], summary: { totalRevenue: -11 } });
  });

  it('clips closed hours at store midnight and reconciles employee net collections to the team', async () => {
    await prisma.shift.create({ data: { userId: data.cashierUser.id, locationId: data.location.id, startingCash: 0,
      clockInAt: new Date('2026-10-31T23:00:00Z'), clockOutAt: new Date('2026-11-01T07:00:00Z') } });
    await sell('2026-11-01T06:30:00Z');
    await refund(await sell('2026-09-01T12:00:00Z'), '2026-11-01T07:30:00Z');
    await sell('2026-11-01T18:00:01Z', 100);
    const result = await employeeActivity({ locationId: data.location.id }, 1, now);
    expect(result.leaderboard.find(row => row.id === data.cashierUser.id)?.metrics).toMatchObject({ hoursWorked: 2, totalSales: 1, totalRevenue: 0, avgTransaction: 11, refunds: 1, refundRate: 100 });
    expect(result.teamStats).toMatchObject({ totalRevenue: 0, totalTransactions: 1 });
    expect(result.leaderboard.reduce((sum, row) => sum + row.metrics.totalRevenue, 0)).toBe(result.teamStats.totalRevenue);
    expect(JSON.stringify(result)).not.toMatch(/hourlyRate|grossPay|password/);
  });
});
