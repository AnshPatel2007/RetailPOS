import { numeric } from '../../utils/money';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getFinancialMetrics, getProductFinancialMetrics } from '../../services/financialMetrics.service';
import { getAdminDashboard } from '../../services/adminDashboard.service';

describe('Dated immutable void events', () => {
  let data: TestData, token: string;
  const post = (path: string, body: object = {}) => request(app).post('/api' + path).set('Authorization', 'Bearer ' + token).send(body);
  const get = (path: string) => request(app).get('/api' + path).set('Authorization', 'Bearer ' + token);
  const original = (cost: number | null = 4, when = '2025-01-05T12:00:00Z') => prisma.sale.create({ data: {
    saleNumber: randomUUID(), locationId: data.location.id, userId: data.adminUser.id, total: 22, subtotal: 20, tax: 2, paymentMethod: 'CASH', amountPaid: 22,
    createdAt: new Date(when), pricingVersion: cost === null ? null : 1,
    items: { create: { productId: data.product.id, productName: 'Original item', sku: data.product.sku, quantity: 2, price: 10, total: 22, tax: 2, unitCost: cost } },
  } });
  beforeEach(async () => { data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN'); await post('/shifts/clock-in', { startingCash: 100 }).expect(201); });

  it('keeps the original period intact and reverses money, tax and cost in the void period', async () => {
    const sale = await original();
    const oldRange = { gte: new Date('2025-01-01'), lt: new Date('2025-02-01') };
    const before = await getFinancialMetrics({ locationId: data.location.id }, oldRange);
    await prisma.product.update({ where: { id: data.product.id }, data: { cost: 99 } });
    const result = await post('/sales/' + sale.id + '/void', { reason: 'Duplicate transaction', idempotencyKey: randomUUID(), expectedAmount: 22 }).expect(200);
    expect(result.body.data.voidEvent).toMatchObject({ reason: 'Duplicate transaction', amount: 22, taxAmount: 2, costReversed: 8, tenders: { CASH: 22 } });
    expect(await getFinancialMetrics({ locationId: data.location.id }, oldRange)).toEqual(before);
    expect(await getFinancialMetrics({ locationId: data.location.id }, { gte: new Date('2026-01-01') })).toMatchObject({ grossCollected: 0, netCollected: -22, netSales: -20, netTax: -2, costOfGoodsSold: -8, grossProfit: -12, voids: 22, voidCount: 1 });
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ netCollected: 0, grossProfit: 0, costOfGoodsSold: 0 });
    expect((await getProductFinancialMetrics({ locationId: data.location.id }, { gte: new Date('2026-01-01') }))[0]).toMatchObject({ quantitySold: -2, revenue: -22, netSales: -20, profit: -12 });
    expect((await getAdminDashboard('30')).totals).toMatchObject({ totalRevenue: -22, totalProfit: -12, totalVoidAmount: 22 });
    expect((await get('/shifts/current').expect(200)).body.data).toMatchObject({ cashVoids: 22, expectedDrawer: 78 });
  });

  it('shares void-period entries between sales screen, CSV, PDF, accounting export and P&L', async () => {
    const sale = await original(); await post('/sales/' + sale.id + '/void', { reason: 'Duplicate' }).expect(200);
    const query = '?startDate=2026-01-01&endDate=2026-12-31&search=' + sale.saleNumber;
    const report = (await get('/reports/sales' + query).expect(200)).body.data;
    expect(report.entries).toHaveLength(1); expect(report.entries[0]).toMatchObject({ kind: 'VOID', total: -22, tax: -2 });
    expect(report.summary).toMatchObject({ totalSales: -22, totalTax: -2, voids: 22, totalTransactions: 0 });
    expect(report.paymentBreakdown.CASH.total).toBe(-22);
    expect((await get('/reports/sales/export/csv' + query).expect(200)).text).toContain('"VOID"');
    await get('/reports/sales/export/pdf' + query).expect(200);
    const exported = (await get('/financial/export/sales' + query).expect(200)).body.data;
    expect(exported).toMatchObject({ totalRevenue: -22, totalTax: -2, netSales: -20, recordCount: 1 });
    expect(exported.entries[0]).toMatchObject({ entry: 'VOID', debitAccount: 'Sales Voids', amount: -22 });
    expect((await get('/financial/reports/pnl?startDate=2026-01-01&endDate=2026-12-31').expect(200)).body.data).toMatchObject({ netIncome: -12, revenue: { voids: 20, netSales: -20 } });
    const past = (await get('/reports/sales?startDate=2025-01-01&endDate=2025-01-31').expect(200)).body.data;
    expect(past.summary).toMatchObject({ totalSales: 22, totalTransactions: 1, voidCount: 0 });
    expect(past.entries[0]).toMatchObject({ kind: 'SALE', total: 22, status: 'VOIDED' });
  });

  it('concurrent retries create one event, one payout and one stock restoration', async () => {
    const sale = await original(); const before = data.product.stockQuantity;
    const body = { reason: 'Duplicate', idempotencyKey: randomUUID() };
    const results = await Promise.all([post('/sales/' + sale.id + '/void', body), post('/sales/' + sale.id + '/void', body)]);
    expect(results.map(r => r.status)).toEqual([200, 200]); expect(results.filter(r => r.body.replayed)).toHaveLength(1);
    expect(await prisma.saleVoid.count()).toBe(1); expect(await prisma.drawerEntry.count({ where: { type: 'VOID' } })).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(before + 2);
    await post('/sales/' + sale.id + '/void', { ...body, reason: 'Changed request' }).expect(409);
    await post('/sales/' + sale.id + '/void', {}).expect(400);
  });

  it('preserves unknown cost and identifies legacy voids without inventing dates', async () => {
    const missing = await original(null); await post('/sales/' + missing.id + '/void').expect(200);
    expect(numeric((await prisma.saleVoid.findUniqueOrThrow({ where: { saleId: missing.id } })).costReversed)).toBeNull();
    expect(await getFinancialMetrics({ locationId: data.location.id }, { gte: new Date('2026-01-01') })).toMatchObject({ grossProfit: null });
    const legacy = await original(); await prisma.sale.update({ where: { id: legacy.id }, data: { status: 'VOIDED' } });
    const report = (await get('/reports/sales').expect(200)).body.data;
    expect(report.historyWarning).toContain('no recorded reversal date');
    expect((await getProductFinancialMetrics({ locationId: data.location.id }))[0]).toMatchObject({ incompleteVoids: true, profit: null, costBasis: 'UNAVAILABLE' });
    expect(await prisma.saleVoid.count()).toBe(1);
  });

  it('blocks legacy account payments whose original funding identity is unavailable', async () => {
    const sale = await original(null);
    await prisma.sale.update({ where: { id: sale.id }, data: { paymentMethod: 'GIFT_CARD' } });
    const result = await post('/sales/' + sale.id + '/void').expect(409);
    expect(result.body.error).toContain('Original account payment details');
    expect(await prisma.saleVoid.count()).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(data.product.stockQuantity);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe('COMPLETED');
  });

  it('links exact cashier approval and allows confirmation without consuming approval again', async () => {
    const sale = await original(); token = await createTestToken(data.cashierUser.id, 'CASHIER');
    await post('/shifts/clock-in', { startingCash: 100 }).expect(201);
    const path = '/sales/' + sale.id + '/void';
    const body = { reason: 'Duplicate receipt', idempotencyKey: randomUUID(), expectedAmount: 22 };
    await post(path, body).expect(428);
    const approved = await post('/approvals', { email: data.adminUser.email, password: 'Admin123!', reason: 'Verified duplicate', request: { method: 'POST', path: '/api' + path, body } }).expect(201);
    await request(app).post('/api' + path).set('Authorization', 'Bearer ' + token).set('X-Manager-Approval', approved.body.data.token).send(body).expect(200);
    const event = await prisma.saleVoid.findUniqueOrThrow({ where: { saleId: sale.id } });
    const approval = await prisma.managerApproval.findUniqueOrThrow({ where: { id: event.approvalId! } });
    expect(approval.managerId).toBe(data.adminUser.id); expect(event.userId).toBe(data.cashierUser.id);
    expect(approval.consumedAt).not.toBeNull();
    expect((await post(path, body).expect(200)).body.replayed).toBe(true);
    expect(await prisma.saleVoid.count()).toBe(1);
    expect((await get('/auth/me').expect(200)).body.data.role).toBe('CASHIER');
  });

  it('protects event history and rejects stale amounts before any mutation', async () => {
    const sale = await original();
    await post('/sales/' + sale.id + '/void', { expectedAmount: 1 }).expect(409);
    expect(await prisma.saleVoid.count()).toBe(0);
    await post('/sales/' + sale.id + '/void').expect(200);
    const event = await prisma.saleVoid.findUniqueOrThrow({ where: { saleId: sale.id } });
    await expect(prisma.saleVoid.update({ where: { id: event.id }, data: { amount: 1 } })).rejects.toThrow();
    await expect(prisma.saleVoid.delete({ where: { id: event.id } })).rejects.toThrow();
  });
});
