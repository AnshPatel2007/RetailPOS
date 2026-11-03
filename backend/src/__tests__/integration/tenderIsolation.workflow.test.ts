import { numeric } from '../../utils/money';
import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Tender store ownership and checkout/reversal lock order', () => {
  let data: TestData;
  let owner: string;
  beforeEach(async () => {
    data = await seedTestData(); owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, clockInAt: new Date() } });
  });
  const post = (path: string, body: object) => request(app).post(path).set('Authorization', 'Bearer ' + owner).send(body);
  const sale = (paymentMethod = 'CASH', reference?: string, productId = data.product.id) => ({
    items: [{ productId, quantity: 1, price: 19.99 }], paymentMethod, amountPaid: 21.99, customerId: data.customer.id,
    payments: [{ paymentMethod, amount: 21.99, ...(reference ? { reference } : {}) }],
  });

  it('a transfer connection cannot authorize gift-card spending from another store or an unassigned card', async () => {
    const other = await prisma.location.create({ data: { name: 'Partner', address: '2 Test St', city: 'Test', state: 'TS', zipCode: '12345', phone: '555', email: 'partner@test.com' } });
    const [locationAId, locationBId] = [data.location.id, other.id].sort();
    await prisma.storeConnection.create({ data: { locationAId, locationBId, createdBy: data.adminUser.id } });
    for (const locationId of [other.id, null]) {
      const card = await prisma.giftCard.create({ data: { code: locationId || 'UNASSIGNED', locationId, initialBalance: 50, currentBalance: 50 } });
      await post('/api/sales', sale('GIFT_CARD', card.code)).expect(404);
      expect(numeric((await prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } })).currentBalance)).toBe(50);
    }
    expect(await prisma.sale.count()).toBe(0); expect(await prisma.inventoryLog.count()).toBe(0);
  });

  it.each(['STORE_CREDIT', 'HOUSE_ACCOUNT'])('an unassigned %s account cannot bypass ownership through checkout', async method => {
    if (method === 'STORE_CREDIT') await prisma.storeCreditAccount.create({ data: { customerId: data.customer.id, balance: 100 } });
    else await prisma.houseAccount.create({ data: { customerId: data.customer.id, creditLimit: 100 } });
    await post('/api/sales', sale(method)).expect(404);
    expect(await prisma.sale.count()).toBe(0); expect(await prisma.inventoryLog.count()).toBe(0);
  });

  it('a store-credit refund and another checkout for the same customer settle without losing balances or stock', async () => {
    const original = (await post('/api/sales', sale()).expect(201)).body.data;
    const second = await prisma.product.create({ data: { name: 'Second', sku: 'SECOND', price: 19.99, cost: 10, stockQuantity: 100, locationId: data.location.id } });
    const account = await prisma.storeCreditAccount.create({ data: { customerId: data.customer.id, locationId: data.location.id, balance: 30 } });
    const responses = await Promise.all([
      post('/api/sales/' + original.id + '/refund', { amount: original.total, items: [{ saleItemId: original.items[0].id, quantity: 1 }], reason: 'Return', refundMethod: 'STORE_CREDIT' }),
      post('/api/sales', sale('STORE_CREDIT', undefined, second.id)),
    ]);
    expect(responses.map(response => response.status)).toEqual([200, 201]);
    expect(numeric((await prisma.storeCreditAccount.findUniqueOrThrow({ where: { id: account.id } })).balance)).toBeCloseTo(30, 2);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(100);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: second.id } })).stockQuantity).toBe(99);
    expect(await prisma.storeCreditTransaction.count({ where: { accountId: account.id } })).toBe(2);
  });

  it('two simultaneous loyalty redemptions use the current locked points balance', async () => {
    await prisma.customer.update({ where: { id: data.customer.id }, data: { loyaltyPoints: 500 } });
    const second = await prisma.product.create({ data: { name: 'Second', sku: 'SECOND', price: 19.99, cost: 10, stockQuantity: 100, locationId: data.location.id } });
    const responses = await Promise.all([data.product.id, second.id].map(productId => post('/api/sales', { ...sale('CASH', undefined, productId), pointsRedeemed: 500 })));
    expect(responses.map(response => response.status).sort()).toEqual([201, 400]);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: data.customer.id } })).loyaltyPoints).toBe(16);
    expect(await prisma.sale.count()).toBe(1);
  });

  it('checkout cannot attach another store\'s customer, an unassigned customer, or an inactive customer', async () => {
    const other = await prisma.location.create({ data: { name: 'Other', address: '2 Test St', city: 'Test', state: 'TS', zipCode: '12345', phone: '555', email: 'other@test.com' } });
    for (const [locationId, isActive, expected] of [[other.id, true, 404], [null, true, 404], [data.location.id, false, 400]] as const) {
      await prisma.customer.update({ where: { id: data.customer.id }, data: { locationId, isActive, loyaltyPoints: 500 } });
      await post('/api/sales', { ...sale(), pointsRedeemed: 500 }).expect(expected);
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: data.customer.id } })).loyaltyPoints).toBe(500);
    }
    expect(await prisma.sale.count()).toBe(0); expect(await prisma.inventoryLog.count()).toBe(0);
  });
});
