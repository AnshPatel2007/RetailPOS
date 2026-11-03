import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Employee report and activity details share accounting and scope', () => {
  let data: TestData, token: string;
  const get = (path: string) => request(app).get('/api' + path).set('Authorization', 'Bearer ' + token);
  const sale = (createdAt = new Date(), locationId: string | null = data.location.id) => prisma.sale.create({ data: {
    saleNumber: randomUUID(), userId: data.adminUser.id, locationId, createdAt, total: 22, subtotal: 20, tax: 2, amountPaid: 22, paymentMethod: 'CARD',
    items: { create: { productId: data.product.id, productName: data.product.name, sku: data.product.sku, quantity: 2, price: 10, tax: 2, total: 22, unitCost: 4 } },
  }, include: { items: true } });
  beforeEach(async () => { data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN'); await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } }); });

  it('both employee endpoints and details reconcile later-period returns and voids without exposing wages', async () => {
    await sale(); const old = await sale(new Date('2025-01-01T12:00:00Z'));
    await prisma.refund.create({ data: { saleId: old.id, amount: 11, taxAmount: 1, method: 'CARD', reason: 'One unit', refundedBy: data.adminUser.id } });
    const duplicate = await sale(new Date('2025-01-02T12:00:00Z'));
    await request(app).post('/api/sales/' + duplicate.id + '/void').set('Authorization', 'Bearer ' + token).send({ reason: 'Duplicate' }).expect(200);
    const report = (await get('/reports/employee-sales').expect(200)).body;
    expect(report.summary).toMatchObject({ netCollected: -11, grossCollected: 22, transactions: 1 });
    expect(report.data[0]).toMatchObject({ totalRevenue: -11, totalSales: -11, transactionCount: 1, avgTransaction: 22, averageOrderValue: 22 });
    expect(report.data[0].user).not.toHaveProperty('hourlyRate'); expect(report.data[0].user).not.toHaveProperty('password');
    expect((await get('/reports/employees').expect(200)).body.data).toEqual(report.data);
    const query = '?userId=' + data.adminUser.id + '&startDate=' + encodeURIComponent(report.period.start) + '&endDate=' + encodeURIComponent(report.period.end);
    const detail = (await get('/reports/sales' + query).expect(200)).body.data;
    expect(detail.summary.totalSales).toBe(-11); expect(detail.entries.map((entry: { kind: string }) => entry.kind).sort()).toEqual(['REFUND', 'SALE', 'VOID']);
  });

  it('validates bounded ranges and uses store-local midnight rather than UTC/server dates', async () => {
    for (const at of ['2026-03-08T05:59:59Z', '2026-03-08T06:00:00Z', '2026-03-09T04:59:59Z', '2026-03-09T05:00:00Z']) await sale(new Date(at));
    const report = (await get('/reports/employee-sales?startDate=2026-03-08&endDate=2026-03-08').expect(200)).body;
    expect(report.period.timezone).toBe('America/Chicago'); expect(report.summary.netCollected).toBe(44); expect(report.data[0].transactionCount).toBe(2);
    await get('/reports/employee-sales?startDate=bad').expect(400);
    await get('/reports/employee-sales?startDate=2026-03-09&endDate=2026-03-08').expect(400);
    await get('/reports/employee-sales?startDate=2024-01-01&endDate=2026-01-01').expect(400);
  });

  it('does not truncate employee activity at 50 sales and keeps unavailable legacy history visible', async () => {
    await prisma.sale.createMany({ data: Array.from({ length: 51 }, () => ({ saleNumber: randomUUID(), userId: data.adminUser.id, locationId: data.location.id, total: 1, subtotal: 1, tax: 0, amountPaid: 1, paymentMethod: 'CARD' as const })) });
    const legacy = await sale(new Date('2025-01-01T12:00:00Z')); await prisma.sale.update({ where: { id: legacy.id }, data: { status: 'VOIDED' } });
    const report = (await get('/reports/employee-sales').expect(200)).body;
    expect(report.data[0]).toMatchObject({ transactionCount: 51, totalRevenue: 51 });
    expect(report.historyWarning).toContain('no recorded reversal date');
    const detail = (await get('/reports/sales?userId=' + data.adminUser.id + '&startDate=' + encodeURIComponent(report.period.start)).expect(200)).body.data;
    expect(detail.entries).toHaveLength(50); expect(detail.summary.totalSales).toBe(51);
    expect(detail.pagination.sales).toMatchObject({ total: 51, totalPages: 2 });
    const second = (await get('/reports/sales?userId=' + data.adminUser.id + '&startDate=' + encodeURIComponent(report.period.start) + '&entryPage=2').expect(200)).body.data;
    expect(second.entries).toHaveLength(1); expect(second.summary.totalSales).toBe(51);
  });

  it('rejects foreign-store and cashier requests, while empty assigned stores have empty reports', async () => {
    const other = await prisma.location.create({ data: { name: 'Other', address: 'Other', city: 'Other', state: 'TS', zipCode: '12345', phone: '555', email: 'other@example.test' } });
    await sale(new Date(), other.id); await sale(new Date(), null);
    expect((await get('/reports/employee-sales').expect(200)).body.data).toEqual([]);
    for (const endpoint of ['employee-sales', 'employees']) await get('/reports/' + endpoint + '?locationId=' + other.id).expect(403);
    token = await createTestToken(data.cashierUser.id, 'CASHIER'); await get('/reports/employee-sales').expect(403);
  });
});
