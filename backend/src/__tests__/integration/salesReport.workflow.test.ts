import request from 'supertest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Sales report and export parity', () => {
  let data: TestData, token: string;
  const get = (suffix = '', query: object = {}) => request(app).get('/api/reports/sales' + suffix).query(query).set('Authorization', 'Bearer ' + token);
  const sale = (createdAt: Date, total = 22) => prisma.sale.create({ data: {
    saleNumber: 'REPORT-' + randomUUID(), locationId: data.location.id, userId: data.adminUser.id, customerId: data.customer.id,
    createdAt, subtotal: total / 1.1, total, tax: total - total / 1.1, amountPaid: total, paymentMethod: 'CASH', pricingVersion: 1,
    items: { create: { productId: data.product.id, productName: 'Original item', sku: data.product.sku, quantity: 2, price: total / 2.2, total, tax: total - total / 1.1, unitCost: 4 } },
  }, include: { items: true } });
  beforeEach(async () => { data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN'); });

  it('retains a fully returned original sale and reports the return in its own period, including both exports', async () => {
    const original = await sale(new Date('2025-01-05T12:00:00Z'));
    await prisma.sale.update({ where: { id: original.id }, data: { status: 'REFUNDED' } });
    await prisma.refund.create({ data: { saleId: original.id, createdAt: new Date('2025-02-06T12:00:00Z'), amount: 22, taxAmount: 2, method: 'CASH', reason: 'Returned', refundedBy: data.adminUser.id,
      pointsRestored: 0, pointsReversed: 0, items: { create: { saleItemId: original.items[0].id, quantity: 2, amount: 22, taxAmount: 2, costReturned: 8 } } } });
    const january = (await get('', { startDate: '2025-01-01', endDate: '2025-01-31' }).expect(200)).body.data;
    expect(january.sales).toHaveLength(1); expect(january.summary).toMatchObject({ totalSales: 22, totalTax: 2, totalTransactions: 1, refunds: 0 });
    const query = { startDate: '2025-02-01', endDate: '2025-02-28' };
    const february = (await get('', query).expect(200)).body.data;
    expect(february.sales).toHaveLength(0); expect(february.refunds).toHaveLength(1);
    expect(february.summary).toMatchObject({ totalSales: -22, totalTax: -2, netSales: -20, totalTransactions: 0, refunds: 22 });
    expect(february.entries[0]).toMatchObject({ kind: 'REFUND', total: -22, tax: -2 });
    const csv = await get('/export/csv', query).expect(200);
    expect(csv.text).toContain('"REFUND"'); expect(csv.text).toContain('"-22.00","-2.00"'); expect(csv.text).toContain('2025-02-06');
    const pdf = await get('/export/pdf', query).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf'); expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    const target = path.resolve(__dirname, '../../../../.local/sales-return-report.pdf'); fs.writeFileSync(target, pdf.body);
  });

  it('rows, summaries and downloads share all filters, including literal search and min/max amounts', async () => {
    const included = await sale(new Date('2025-03-06T12:00:00Z'));
    await sale(new Date('2025-03-06T13:00:00Z'), 44);
    const query = { startDate: '2025-03-01', endDate: '2025-03-31', userId: data.adminUser.id, customerId: data.customer.id,
      paymentMethod: 'CASH', minAmount: 20, maxAmount: 30, search: data.customer.firstName + ' ' + data.customer.lastName };
    const result = (await get('', query).expect(200)).body.data;
    expect(result.sales.map((s: { id: string }) => s.id)).toEqual([included.id]); expect(result.summary.totalSales).toBe(22);
    const csv = await get('/export/csv', query).expect(200); expect(csv.text.trim().split(/\r?\n/)).toHaveLength(2); expect(csv.text).toContain(included.saleNumber);
    expect((await get('', { ...query, search: '%' }).expect(200)).body.data.summary.totalSales).toBe(0);
    expect((await get('', { ...query, search: '%' }).expect(200)).body.data.sales).toHaveLength(0);
    expect((await get('', { ...query, userId: data.cashierUser.id }).expect(200)).body.data.summary.totalSales).toBe(0);
    for (const suffix of ['', '/export/csv', '/export/pdf']) await get(suffix, { minAmount: 30, maxAmount: 20 }).expect(400);
  });

  it('uses the store calendar even when the server and browser have another timezone', async () => {
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
    const included = await sale(new Date('2025-03-10T04:30:00Z'));
    await sale(new Date('2025-03-10T05:30:00Z'));
    const query = { startDate: '2025-03-09', endDate: '2025-03-09' };
    const result = (await get('', query).expect(200)).body.data;
    expect(result.sales.map((s: { id: string }) => s.id)).toEqual([included.id]); expect(result.summary.totalSales).toBe(22);
    expect(result.dailyBreakdown).toEqual({ '2025-03-09': { count: 1, total: 22 } });
    const csv = await get('/export/csv', query).expect(200); expect(csv.text).toContain('2025-03-09'); expect(csv.text).toContain('America/Chicago');
  });

  it('legacy returns keep tax unavailable and tender breakdowns use the actual recorded refund method', async () => {
    const original = await sale(new Date());
    await prisma.refund.create({ data: { saleId: original.id, amount: 11, method: 'STORE_CREDIT', reason: 'Legacy credit', refundedBy: data.adminUser.id } });
    const result = (await get().expect(200)).body.data;
    expect(result.summary).toMatchObject({ totalSales: 11, netSales: null, totalTax: null });
    expect(result.paymentBreakdown).toEqual({ CASH: { count: 1, total: 22 }, STORE_CREDIT: { count: 0, total: -11 } });
    expect((await get('/export/csv').expect(200)).text).toContain('"-11.00","Unavailable"');
  });

  it('void audit rows contribute zero and store/cashier boundaries apply to all formats', async () => {
    const original = await sale(new Date()); await prisma.sale.update({ where: { id: original.id }, data: { status: 'VOIDED' } });
    const result = (await get('', { status: 'VOIDED' }).expect(200)).body.data;
    expect(result.sales).toHaveLength(1); expect(result.summary.totalSales).toBe(0); expect(result.entries[0]).toMatchObject({ total: 0, originalSaleTotal: 22 });
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    for (const suffix of ['', '/export/csv', '/export/pdf']) {
      await get(suffix, { locationId: 'unrelated-store' }).expect(403);
      await request(app).get('/api/reports/sales' + suffix).set('Authorization', 'Bearer ' + cashier).expect(403);
    }
    await get('', { paymentMethod: 'INVALID' }).expect(400);
  });

  it('empty exports still contain a valid header and empty reports have zero activity', async () => {
    const result = (await get().expect(200)).body.data; expect(result.summary).toMatchObject({ totalSales: 0, totalTransactions: 0 });
    expect((await get('/export/csv').expect(200)).text).toContain('"Entry","Record ID"');
    await get('/export/pdf').expect(200);
  });

  it('counts unbooked audit rows separately from financial totals under explicit status filters', async () => {
    await sale(new Date());
    for (const status of ['PENDING', 'HOLD', 'VOIDED'] as const) {
      const original = await sale(new Date());
      await prisma.sale.update({ where: { id: original.id }, data: { status } });
    }
    const booked = (await get().expect(200)).body.data;
    expect(booked.pagination.sales.total).toBe(1);
    expect(booked.summary).toMatchObject({ totalSales: 22, totalTransactions: 1, totalTax: 2 });
    const audit = (await get('', { status: 'PENDING,HOLD,VOIDED' }).expect(200)).body.data;
    expect(audit.sales).toHaveLength(3); expect(audit.pagination.sales.total).toBe(3);
    expect(audit.summary).toMatchObject({ totalSales: 0, totalTransactions: 0, totalTax: 0 });
    expect(audit.entries.every((entry: { total: number }) => entry.total === 0)).toBe(true);
    expect(audit.historyWarning).toContain('Older voids');
    const mixed = (await get('', { status: 'COMPLETED,PENDING' }).expect(200)).body.data;
    expect(mixed.pagination.sales.total).toBe(2);
    expect(mixed.summary).toMatchObject({ totalSales: 22, totalTransactions: 1, totalTax: 2 });
  });

  it('pages large reports with complete totals while guarding synchronous downloads', async () => {
    await prisma.sale.createMany({ data: Array.from({ length: 5001 }, (_, index) => ({ saleNumber: 'LIMIT-' + index,
      locationId: data.location.id, userId: data.adminUser.id, subtotal: 1, total: 1, amountPaid: 1, paymentMethod: 'CASH' as const })) });
    const first = (await get().expect(200)).body.data;
    expect(first.sales).toHaveLength(50); expect(first.summary.totalSales).toBe(5001);
    expect(first.pagination.sales).toMatchObject({ page: 1, total: 5001, totalPages: 101 });
    const last = (await get('', { page: 101 }).expect(200)).body.data;
    expect(last.sales).toHaveLength(1); expect(last.summary.totalSales).toBe(5001);
    expect(last.paymentBreakdown).toEqual(first.paymentBreakdown);
    for (const suffix of ['/export/csv', '/export/pdf']) {
      const response = await get(suffix, { page: 101 }).expect(413);
      expect(response.body.error).toContain('queue a full store sales CSV');
    }
    const narrowed = (await get('', { search: 'LIMIT-5000' }).expect(200)).body.data;
    expect(narrowed.sales).toHaveLength(1); expect(narrowed.summary.totalSales).toBe(1);
  });

  it('uses deterministic server pages and exports the complete filtered range regardless of page parameters', async () => {
    const at = new Date('2025-03-07T12:00:00Z');
    await prisma.sale.createMany({ data: Array.from({ length: 101 }, (_, index) => ({ saleNumber: 'PAGED-' + index,
      locationId: data.location.id, userId: data.adminUser.id, subtotal: 1, total: 1, amountPaid: 1, createdAt: at, paymentMethod: 'CASH' as const })) });
    const query = { startDate: '2025-03-01', endDate: '2025-03-31' };
    const first = (await get('', query).expect(200)).body.data;
    const second = (await get('', { ...query, page: 2 }).expect(200)).body.data;
    const last = (await get('', { ...query, page: 3 }).expect(200)).body.data;
    expect(first.sales).toHaveLength(50); expect(second.sales).toHaveLength(50); expect(last.sales).toHaveLength(1);
    expect(new Set([...first.sales, ...second.sales, ...last.sales].map(row => row.id)).size).toBe(101);
    expect(second.summary).toEqual(first.summary); expect(last.dailyBreakdown).toEqual(first.dailyBreakdown);
    const csv = await get('/export/csv', { ...query, page: 3 }).expect(200);
    expect(csv.text.trim().split(/\r?\n/)).toHaveLength(102); expect(csv.text).toContain('PAGED-0'); expect(csv.text).toContain('PAGED-100');
    await get('/export/pdf', { ...query, page: 3 }).expect(200);
    const clamped = (await get('', { ...query, page: 1_000_000_000 }).expect(200)).body.data;
    expect(clamped.pagination.sales.page).toBe(3); expect(clamped.sales.map((row: { id: string }) => row.id)).toEqual(last.sales.map((row: { id: string }) => row.id));
    for (const params of [{ page: 0 }, { page: 1.5 }, { refundPage: 'bad' }, { voidPage: 1_000_000_001 }, { entryPage: Number.MAX_SAFE_INTEGER + 1 }, { entryPage: -1 }]) await get('', params).expect(400);
  });

  it('pages later-period refunds and voids independently and supports combined employee activity pages', async () => {
    const original = await sale(new Date('2025-01-01T12:00:00Z'), 112);
    const reversalAt = new Date('2025-04-02T12:00:00Z');
    await prisma.refund.createMany({ data: Array.from({ length: 51 }, (_, index) => ({ saleId: original.id, createdAt: reversalAt, amount: 1, taxAmount: 0,
      method: 'CASH' as const, reason: 'Historical return ' + index, refundedBy: data.adminUser.id })) });
    const voidedIds = Array.from({ length: 51 }, () => randomUUID());
    await prisma.sale.createMany({ data: voidedIds.map((id, index) => ({ id, saleNumber: 'PAGED-VOID-' + index,
      locationId: data.location.id, userId: data.adminUser.id, subtotal: 1, total: 1, amountPaid: 1, createdAt: new Date('2025-01-01T12:00:00Z'), status: 'VOIDED' as const, paymentMethod: 'CASH' as const })) });
    await prisma.saleVoid.createMany({ data: voidedIds.map(saleId => ({ saleId, locationId: data.location.id, userId: data.adminUser.id,
      reason: 'Recorded duplicate', amount: 1, taxAmount: 0, discount: 0, items: [], tenders: { CASH: 1 }, requestHash: 'fixture-' + saleId, createdAt: reversalAt })) });
    const query = { startDate: '2025-04-01', endDate: '2025-04-30' };
    const first = (await get('', query).expect(200)).body.data;
    const second = (await get('', { ...query, refundPage: 2 }).expect(200)).body.data;
    expect(first.sales).toHaveLength(0); expect(first.refunds).toHaveLength(50); expect(second.refunds).toHaveLength(1);
    expect(first.voids).toHaveLength(50); expect(second.voids).toHaveLength(50);
    const bothSecond = (await get('', { ...query, refundPage: 2, voidPage: 2 }).expect(200)).body.data;
    expect(bothSecond.voids).toHaveLength(1); expect(bothSecond.refunds).toHaveLength(1);
    expect(first.pagination.refunds).toMatchObject({ page: 1, total: 51, totalPages: 2 });
    expect(first.summary).toMatchObject({ totalSales: -102, totalTransactions: 0, refundCount: 51, voidCount: 51 }); expect(second.summary).toEqual(first.summary);
    const activity = (await get('', { ...query, entryPage: 3 }).expect(200)).body.data;
    expect(activity.entries).toHaveLength(2); expect(activity.pagination.entries).toMatchObject({ page: 3, total: 102, totalPages: 3 });
    expect((await get('/export/csv', { ...query, refundPage: 2, entryPage: 2 }).expect(200)).text.trim().split(/\r?\n/)).toHaveLength(103);
  });
});
