import { numeric } from '../../utils/money';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getAdminDashboard } from '../../services/adminDashboard.service';

describe('Original sale facts and exact loyalty returns', () => {
  let data: TestData, token: string;
  const post = (path: string, body: object) => request(app).post('/api' + path).set('Authorization', 'Bearer ' + token).send(body);
  const sell = async (quantity = 3, pointsRedeemed = 100, extra: object = {}) => (await post('/sales', { customerId: data.customer.id, items: [{ productId: data.product.id, quantity, price: 1 }], paymentMethod: 'CASH', amountPaid: 100, pointsRedeemed, idempotencyKey: randomUUID(), ...extra }).expect(201)).body.data;
  const refund = (id: string, body: object) => post('/sales/' + id + '/refund', { reason: 'Returned goods', idempotencyKey: randomUUID(), ...body });
  beforeEach(async () => {
    data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN');
    await post('/shifts/clock-in', { startingCash: 100 }).expect(201);
    await prisma.product.update({ where: { id: data.product.id }, data: { price: 1, cost: 0.4567 } });
    const openingProduct = await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } });
    await post('/financial/inventory-costs/opening', { idempotencyKey: randomUUID(), notes: 'Verified test opening inventory',
      items: [{ productId: openingProduct.id, quantity: 100, value: 45.67, expectedVersion: openingProduct.stockVersion }] }).expect(200);
    await prisma.customer.update({ where: { id: data.customer.id }, data: { loyaltyPoints: 1000 } });
  });

  it('books original costs, tax rules, discounts and points; later edits cannot rewrite them', async () => {
    const sale = await sell();
    expect(sale).toMatchObject({ pricingVersion: 1, total: 2.3, pointsRedeemed: 100, pointsEarned: 2 });
    expect(sale.items[0]).toMatchObject({ total: 2.3, discount: 1, pointsRedeemed: 100, pointsEarned: 2, taxTreatment: 'STANDARD' });
    expect(Number(sale.items[0].unitCost)).toBe(0.4567); expect(Number(sale.items[0].taxRate)).toBe(10);
    await prisma.product.update({ where: { id: data.product.id }, data: { cost: 99, price: 80, isTaxable: false, name: 'New name' } });
    await prisma.location.update({ where: { id: data.location.id }, data: { taxRate: 40 } });
    const original = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true } });
    expect(numeric(original.total)).toBe(2.3); expect(Number(original.items[0].unitCost)).toBe(0.4567);
    expect((await getAdminDashboard('max')).totals.totalProfit).toBe(0.63);
    await expect(prisma.saleItem.update({ where: { id: sale.items[0].id }, data: { total: 999 } })).rejects.toThrow();
    await expect(prisma.sale.update({ where: { id: sale.id }, data: { total: 999 } })).rejects.toThrow();
  });

  it('successive one-unit returns allocate the final cent and restore exactly the original points', async () => {
    const sale = await sell(); const returned = [];
    for (let i = 0; i < 3; i++) returned.push((await refund(sale.id, { items: [{ saleItemId: sale.items[0].id, quantity: 1 }] }).expect(200)).body);
    const rows = await prisma.refund.findMany({ where: { saleId: sale.id }, orderBy: { createdAt: 'asc' }, include: { items: true } });
    expect(numeric(rows.map(r => r.amount))).toEqual([0.76, 0.77, 0.77]);
    expect(rows.map(r => r.pointsRestored)).toEqual([33, 33, 34]); expect(rows.map(r => r.pointsReversed)).toEqual([0, 1, 1]);
    expect(rows.reduce((n, r) => n + Number(r.taxAmount), 0)).toBeCloseTo(0.3, 8);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: data.customer.id } })).loyaltyPoints).toBe(1000);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(100);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe('REFUNDED');
    expect((await getAdminDashboard('max')).totals.totalProfit).toBe(0);
    await expect(prisma.refund.update({ where: { id: rows[0].id }, data: { amount: 99 } })).rejects.toThrow();
  });

  it('amount-only adjustments followed by unit returns cannot refund money or points twice', async () => {
    const sale = await sell();
    await refund(sale.id, { amount: 0.5 }).expect(200);
    for (let i = 0; i < 3; i++) await refund(sale.id, { items: [{ saleItemId: sale.items[0].id, quantity: 1 }] }).expect(200);
    const rows = await prisma.refund.findMany({ where: { saleId: sale.id }, include: { items: true } });
    expect(rows.reduce((n, r) => n + Math.round(Number(r.amount) * 100), 0)).toBe(230);
    expect(rows.reduce((n, r) => n + (r.pointsRestored || 0), 0)).toBe(100);
    expect(rows.reduce((n, r) => n + (r.pointsReversed || 0), 0)).toBe(2);
    expect(rows.flatMap(r => r.items).reduce((n, r) => n + r.quantity, 0)).toBe(3);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(100);
  });

  it('returns points-only purchases with no cash payout and does not return them twice', async () => {
    const sale = await sell(1, 110, { amountPaid: 0 });
    expect(sale.total).toBe(0);
    const body = { items: [{ saleItemId: sale.items[0].id, quantity: 1 }], idempotencyKey: randomUUID(), expectedAmount: 0 };
    await refund(sale.id, body).expect(200); await refund(sale.id, body).expect(200);
    expect(await prisma.refund.count({ where: { saleId: sale.id } })).toBe(1);
    expect(await prisma.drawerEntry.count({ where: { saleId: sale.id } })).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: data.customer.id } })).loyaltyPoints).toBe(1000);
    await refund(sale.id, { items: body.items }).expect(400);
  });

  it('rejects excess points without spending them or changing stock', async () => {
    await post('/sales', { customerId: data.customer.id, items: [{ productId: data.product.id, quantity: 1, price: 1 }], paymentMethod: 'CASH', amountPaid: 0, pointsRedeemed: 111 }).expect(400);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: data.customer.id } })).loyaltyPoints).toBe(1000);
    expect(await prisma.sale.count()).toBe(0);
  });

  it('void restores redeemed points and reverses earned points exactly once', async () => {
    const sale = await sell();
    await post('/sales/' + sale.id + '/void', {}).expect(200);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: data.customer.id } })).loyaltyPoints).toBe(1000);
    await post('/sales/' + sale.id + '/void', {}).expect(400);
  });

  it('keeps spent earned points as a debt and downgrades the tier after reversal', async () => {
    const sale = await sell(3, 0);
    await prisma.customer.update({ where: { id: data.customer.id }, data: { loyaltyPoints: 0, loyaltyTier: 'GOLD' } });
    await refund(sale.id, { amount: sale.total }).expect(200);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: data.customer.id } })).toMatchObject({ loyaltyPoints: -3, loyaltyTier: 'BRONZE' });
  });

  it('preserves a do-not-restock choice across a later full-balance refund', async () => {
    const sale = await sell();
    await refund(sale.id, { items: [{ saleItemId: sale.items[0].id, quantity: 1 }], restock: false }).expect(200);
    await refund(sale.id, { amount: 1.54 }).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(97);
    await refund(sale.id, { items: [{ saleItemId: sale.items[0].id, quantity: 2 }] }).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(99);
  });

  it('blocks a stale displayed refund amount and safely serializes the last return', async () => {
    const sale = await sell(1, 50);
    const body = { items: [{ saleItemId: sale.items[0].id, quantity: 1 }], expectedAmount: 1.1 };
    await refund(sale.id, body).expect(409);
    const replies = await Promise.all([refund(sale.id, { ...body, expectedAmount: 0.6 }), refund(sale.id, { ...body, expectedAmount: 0.6 })]);
    expect(replies.map(r => r.status).sort()).toEqual([200, 400]);
    expect(await prisma.refund.count({ where: { saleId: sale.id } })).toBe(1);
  });

  it('allocates surcharge and loyalty across lines and refunds the full charged total', async () => {
    await prisma.location.update({ where: { id: data.location.id }, data: { cardSurchargePercent: 3 } });
    const second = await prisma.product.create({ data: { name: 'Second line', sku: 'SECOND', price: 2, cost: 1, locationId: data.location.id, stockQuantity: 10 } });
    const sale = await sell(1, 100, { items: [{ productId: data.product.id, quantity: 1, price: 1 }, { productId: second.id, quantity: 1, price: 2 }], paymentMethod: 'CARD', amountPaid: 2.37 });
    expect(sale.items.reduce((n: number, line: any) => n + Math.round(line.total * 100), 0)).toBe(237);
    for (const item of sale.items) await refund(sale.id, { items: [{ saleItemId: item.id, quantity: 1 }], refundMethod: 'CARD', reference: 'TERMINAL-RETURN-' + item.id }).expect(200);
    const aggregate = await prisma.refund.aggregate({ where: { saleId: sale.id }, _sum: { amount: true, pointsRestored: true, pointsReversed: true } });
    expect(numeric(aggregate._sum.amount)).toBeCloseTo(2.37, 8); expect(aggregate._sum.pointsRestored).toBe(100); expect(aggregate._sum.pointsReversed).toBe(2);
  });

  it('does not infer historical costs for an older sale from current product costs', async () => {
    await prisma.sale.create({ data: { saleNumber: randomUUID(), userId: data.adminUser.id, locationId: data.location.id, total: 1.1, tax: 0.1, paymentMethod: 'CASH', items: { create: { productId: data.product.id, sku: data.product.sku, productName: data.product.name, quantity: 1, price: 1, total: 1.1 } } } });
    const before = await getAdminDashboard('max');
    expect(before.totals.totalProfit).toBeNull(); expect(before.totals.margin).toBeNull();
    await prisma.product.update({ where: { id: data.product.id }, data: { cost: 80 } });
    expect((await getAdminDashboard('max')).totals.totalProfit).toBeNull();
  });

  it('does not invent a historical cost when replaying an offline checkout', async () => {
    const shift = await prisma.shift.findFirstOrThrow({ where: { userId: data.adminUser.id, isClosed: false } });
    const originalTime = new Date().toISOString();
    await prisma.product.update({ where: { id: data.product.id }, data: { cost: 99 } });
    const sale = await sell(1, 0, { offlineCreatedAt: originalTime, offlineShiftId: shift.id, expectedTotal: 1.1 });
    expect(sale.items[0].unitCost).toBeNull();
    expect((await getAdminDashboard('max')).totals.totalProfit).toBeNull();
  });
});
