import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getFinancialMetrics, getProductFinancialMetrics } from '../../services/financialMetrics.service';
import { getAdminDashboard } from '../../services/adminDashboard.service';

describe('Recorded financial metrics across report destinations', () => {
  let data: TestData, token: string;
  const get = (path: string) => request(app).get('/api' + path).set('Authorization', 'Bearer ' + token);
  const createSale = (createdAt = new Date(), unitCost: number | null = 4, locationId?: string) => prisma.sale.create({ data: {
    saleNumber: randomUUID(), userId: data.adminUser.id, locationId: locationId || data.location.id,
    pricingVersion: unitCost === null ? null : 1, createdAt, total: 22, tax: 2, subtotal: 20,
    paymentMethod: 'CASH', amountPaid: 22,
    items: { create: { productId: data.product.id, productName: 'Original item', sku: data.product.sku,
      quantity: 2, price: 10, tax: 2, total: 22, unitCost } },
  }, include: { items: true } });
  beforeEach(async () => { data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN'); });

  it('P&L, overview, comparison, product analysis and dashboard agree after product cost changes', async () => {
    await createSale();
    await prisma.product.update({ where: { id: data.product.id }, data: { cost: 99, name: 'Renamed item' } });
    const pnl = (await get('/financial/reports/pnl').expect(200)).body.data;
    expect(pnl).toMatchObject({ revenue: { grossSales: 20, netSales: 20, taxCollected: 2 }, costOfGoodsSold: 8, grossProfit: 12, netIncome: 12 });
    expect((await get('/reports/overall').expect(200)).body.data.profitability).toMatchObject({ grossProfit: 12, costOfGoodsSold: 8, grossMargin: 60 });
    expect((await get('/analytics/comparison').expect(200)).body.data.monthly.current).toMatchObject({ revenue: 22, netSales: 20, profit: 12 });
    expect((await get('/reports/products').expect(200)).body.data[0]).toMatchObject({ productName: 'Original item', profit: 12, netSales: 20 });
    expect((await get('/analytics/product-matrix').expect(200)).body.data.products[0]).toMatchObject({ profit: 12, margin: 60 });
    expect((await getAdminDashboard('max')).totals.totalProfit).toBe(12);
  });

  it('prior-period full returns reverse cash, tax and restocked cost only in the return period', async () => {
    const sale = await createSale(new Date('2025-01-05T12:00:00Z'));
    await prisma.sale.update({ where: { id: sale.id }, data: { status: 'REFUNDED' } });
    await prisma.refund.create({ data: { saleId: sale.id, amount: 22, taxAmount: 2, pointsRestored: 0, pointsReversed: 0,
      reason: 'Return', refundedBy: data.adminUser.id, items: { create: { saleItemId: sale.items[0].id, quantity: 2, amount: 22, taxAmount: 2, costReturned: 8 } } } });
    const old = await getFinancialMetrics({ locationId: data.location.id }, { gte: new Date('2025-01-01'), lt: new Date('2025-02-01') });
    expect(old).toMatchObject({ grossProfit: 12, netSales: 20, refunds: 0 });
    const returned = await getFinancialMetrics({ locationId: data.location.id }, { gte: new Date('2026-01-01') });
    expect(returned).toMatchObject({ netCollected: -22, netSales: -20, costOfGoodsSold: -8, grossProfit: -12, netTax: -2 });
    expect((await getProductFinancialMetrics({ locationId: data.location.id }, { gte: new Date('2026-01-01') }))[0]).toMatchObject({ quantitySold: -2, profit: -12, revenue: -22 });
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ netSales: 0, costOfGoodsSold: 0, grossProfit: 0, operatingMargin: null });
  });

  it('returns without restocking retain cost and paid payroll remains in aggregate expenses', async () => {
    const sale = await createSale();
    await prisma.refund.create({ data: { saleId: sale.id, amount: 11, taxAmount: 1, pointsRestored: 0, reason: 'Damaged', refundedBy: data.adminUser.id,
      items: { create: { saleItemId: sale.items[0].id, quantity: 1, amount: 11, taxAmount: 1, costReturned: 0, restocked: false } } } });
    for (const [status, amount] of [['PAID', 2], ['APPROVED', 1], ['PENDING', 100], ['REJECTED', 200]] as const) {
      await prisma.expense.create({ data: { expenseNumber: randomUUID(), category: 'PAYROLL', description: 'Gross wages', amount, status, userId: data.adminUser.id, locationId: data.location.id } });
    }
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ netSales: 10, costOfGoodsSold: 8, grossProfit: 2, expenses: 3, operatingProfit: -1 });
  });

  it('legacy cost and refund tax remain unavailable, including product classification and scenarios', async () => {
    const sale = await createSale(new Date(), null);
    const health = (await get('/analytics/business-health').expect(200)).body.data;
    expect(health.profitability).toMatchObject({ costOfGoodsSold: null, grossProfit: null, netMargin: null });
    expect(health.kpis.breakEvenProgress).toBeNull(); expect(health.cashFlow.netCashFlow).toBeNull();
    const matrix = (await get('/analytics/product-matrix').expect(200)).body.data;
    expect(matrix.unavailableCount).toBe(1); expect(matrix.products[0].quadrant).toBe('unavailable');
    await prisma.refund.create({ data: { saleId: sale.id, amount: 5, reason: 'Legacy', refundedBy: data.adminUser.id } });
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ netCollected: 17, netSales: null, netTax: null, grossProfit: null });
    const exported = (await get('/financial/export/sales').expect(200)).body.data;
    expect(exported.totalTax).toBeNull(); expect(exported.entries[1].taxAmount).toBeNull();
  });

  it('accounting exports reconcile refund tax and record every exported entry', async () => {
    const sale = await createSale();
    await prisma.refund.create({ data: { saleId: sale.id, amount: 11, taxAmount: 1, pointsRestored: 0, reason: 'Return', refundedBy: data.adminUser.id,
      items: { create: { saleItemId: sale.items[0].id, quantity: 1, amount: 11, taxAmount: 1, costReturned: 4 } } } });
    const result = (await get('/financial/export/sales').expect(200)).body.data;
    expect(result).toMatchObject({ totalRevenue: 11, totalTax: 1, netSales: 10, recordCount: 2 });
    expect(result.entries.map((e: { taxAmount: number }) => e.taxAmount)).toEqual([2, -1]);
    expect((await prisma.accountingExport.findFirstOrThrow()).recordCount).toBe(2);
  });

  it('what-if uses actual costs and no-change inputs preserve the original amounts', async () => {
    await createSale();
    const result = (await request(app).post('/api/analytics/what-if').set('Authorization', 'Bearer ' + token).send({}).expect(200)).body.data;
    expect(result.scenarios.current).toMatchObject({ revenue: 20, profit: 12, cogs: 8, margin: 60 });
    expect(result.scenarios.difference).toEqual({ revenue: 0, profit: 0, transactions: 0, margin: 0 });
    await request(app).post('/api/analytics/what-if').set('Authorization', 'Bearer ' + token).send({ priceChange: -101 }).expect(400);
  });

  it('empty stores report zero activity with undefined margins, and foreign stores cannot be queried', async () => {
    const other = await prisma.location.create({ data: { name: 'Unrelated store', address: 'Other', city: 'Other', state: 'TS', zipCode: '12345', phone: '5550000000', email: 'other@example.test' } });
    await createSale(new Date(), 4, other.id);
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ grossProfit: 0, netSales: 0, grossMargin: null });
    await get('/financial/reports/pnl?locationId=' + other.id).expect(403);
    await get('/analytics/product-matrix?locationId=' + other.id).expect(403);
    await get('/analytics/product-matrix?days=-1').expect(400);
    await get('/financial/reports/pnl?startDate=bad').expect(400);
  });
});
