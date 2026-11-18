import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Atomic recoverable bulk refunds', () => {
  let data: TestData, token: string;
  const post = (path: string, body: object = {}) => request(app).post('/api' + path).set('Authorization', 'Bearer ' + token).send(body);
  const sale = async (quantity = 1) => (await post('/sales', { items: [{ productId: data.product.id, quantity, price: 10 }], paymentMethod: 'CASH', amountPaid: quantity * 11 }).expect(201)).body.data;
  const payload = (...sales: { id: string; total: number }[]) => ({ idempotencyKey: randomUUID(), reason: 'Reviewed batch returns', sales: sales.map(row => ({ id: row.id, expectedAmount: row.total, refundMethod: 'CASH' })) });
  beforeEach(async () => {
    data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.product.update({ where: { id: data.product.id }, data: { price: 10 } });
    await post('/shifts/clock-in', { startingCash: 100 }).expect(201);
  });

  it('commits one batch under competing reordered retries and confirms after drawer closure', async () => {
    const originals = [await sale(2), await sale()]; const body = payload(...originals);
    const results = await Promise.all([post('/sales/bulk-refund', body), post('/sales/bulk-refund', { ...body, sales: [...body.sales].reverse() })]);
    expect(results.map(result => result.status)).toEqual([200, 200]); expect(results.filter(result => result.body.replayed)).toHaveLength(1);
    expect(await prisma.refund.count()).toBe(2); expect(await prisma.operationReceipt.count()).toBe(1);
    expect(await prisma.drawerEntry.count({ where: { type: 'REFUND' } })).toBe(2);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(100);
    await post('/shifts/clock-out', { endingCash: 100 }).expect(200);
    expect((await post('/sales/bulk-refund', body).expect(200)).body.replayed).toBe(true);
    expect(await prisma.refund.count()).toBe(2);
  });

  it('binds all selected balances, payout methods, references and reason to one request', async () => {
    const originals = [await sale(), await sale()]; const body = payload(...originals);
    await post('/sales/bulk-refund', body).expect(200);
    for (const changed of [
      { ...body, reason: 'Changed' }, { ...body, sales: [body.sales[0]] },
      { ...body, sales: body.sales.map(row => ({ ...row, refundMethod: 'CARD', reference: 'CHANGED' })) },
      { ...body, sales: body.sales.map(row => ({ ...row, expectedAmount: 1 })) },
    ]) await post('/sales/bulk-refund', changed).expect(409);
    expect(await prisma.refund.count()).toBe(2);
  });

  it('rolls the whole batch back if another return changes any reviewed balance', async () => {
    const originals = [await sale(), await sale(2)]; const body = payload(...originals);
    await post('/sales/' + originals[1].id + '/refund', { items: [{ saleItemId: originals[1].items[0].id, quantity: 1 }], reason: 'Earlier return' }).expect(200);
    const preview = (await post('/sales/bulk-refund/preview', { saleIds: originals.map(row => row.id) }).expect(200)).body.data;
    expect(preview.find((row: { id: string }) => row.id === originals[1].id).expectedAmount).toBe(11);
    await post('/sales/bulk-refund', body).expect(409);
    expect(await prisma.refund.count()).toBe(1); expect(await prisma.operationReceipt.count()).toBe(0);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: originals[0].id } })).status).toBe('COMPLETED');
    await post('/sales/bulk-refund', { ...body, sales: body.sales.map(row => ({ ...row, expectedAmount: preview.find((item: { id: string }) => item.id === row.id).expectedAmount })) }).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(100);
  });

  it('returns a points-only purchase without manufacturing a cash payout', async () => {
    await prisma.customer.update({ where: { id: data.customer.id }, data: { loyaltyPoints: 1100 } });
    const original = (await post('/sales', { customerId: data.customer.id, items: [{ productId: data.product.id, quantity: 1, price: 10 }], pointsRedeemed: 1100, paymentMethod: 'CASH', amountPaid: 0 }).expect(201)).body.data;
    expect(original.total).toBe(0);
    const body = payload(original); await post('/sales/bulk-refund', body).expect(200); await post('/sales/bulk-refund', body).expect(200);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: data.customer.id } })).loyaltyPoints).toBe(1100);
    expect(await prisma.drawerEntry.count({ where: { type: 'REFUND' } })).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(100);
  });

  it('requires exact bounded requests and external-card refund evidence', async () => {
    const original = await sale();
    await post('/sales/bulk-refund', { saleIds: [original.id] }).expect(400);
    const body = payload(original);
    await post('/sales/bulk-refund', { ...body, sales: [{ ...body.sales[0], refundMethod: 'CARD' }] }).expect(400);
    await post('/sales/bulk-refund', { ...body, sales: [body.sales[0], body.sales[0]] }).expect(400);
    await post('/sales/bulk-refund', { ...body, sales: [{ ...body.sales[0], expectedAmount: 11.001 }] }).expect(400);
    expect(await prisma.refund.count()).toBe(0);
  });
});
