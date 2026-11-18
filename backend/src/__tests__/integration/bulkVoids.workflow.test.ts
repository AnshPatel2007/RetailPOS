import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Recoverable atomic bulk voids', () => {
  let data: TestData, token: string;
  const post = (path: string, body: object = {}, auth = token) => request(app).post('/api' + path).set('Authorization', 'Bearer ' + auth).send(body);
  const original = (locationId?: string) => prisma.sale.create({ data: {
    saleNumber: randomUUID(), locationId: locationId || data.location.id, userId: data.adminUser.id,
    total: 22, subtotal: 20, tax: 2, paymentMethod: 'CASH', amountPaid: 22,
    items: { create: { productId: data.product.id, productName: 'Original item', sku: data.product.sku, quantity: 2, price: 10, total: 22, tax: 2, unitCost: 4 } },
  } });
  const payload = (...sales: { id: string }[]) => ({ idempotencyKey: randomUUID(), reason: 'Duplicate batch', sales: sales.map(sale => ({ id: sale.id, expectedAmount: 22 })) });
  const stock = async () => (await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity;
  beforeEach(async () => {
    data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN');
    await post('/shifts/clock-in', { startingCash: 100 }).expect(201);
  });

  it('concurrent reordered retries save one batch and confirm it after the paying drawer closes', async () => {
    const sales = await Promise.all([original(), original()]); const body = payload(...sales);
    const results = await Promise.all([post('/sales/bulk-void', body), post('/sales/bulk-void', { ...body, sales: [...body.sales].reverse() })]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(results.filter(result => result.body.replayed)).toHaveLength(1);
    expect(await prisma.saleVoid.count()).toBe(2);
    expect(await prisma.drawerEntry.count({ where: { type: 'VOID' } })).toBe(2);
    expect(await prisma.activityLog.count({ where: { action: 'VOID' } })).toBe(2);
    expect(await stock()).toBe(data.product.stockQuantity + 4);
    await post('/shifts/clock-out', { endingCash: 56 }).expect(200);
    expect((await post('/sales/bulk-void', body).expect(200)).body).toMatchObject({ replayed: true, data: { voidedCount: 2 } });
    expect(await prisma.drawerEntry.count({ where: { type: 'VOID' } })).toBe(2);
    expect(await stock()).toBe(data.product.stockQuantity + 4);
  });

  it('binds the retry key to every member, amount, reason and actor', async () => {
    const sales = (await Promise.all([original(), original(), original()])).sort((a, b) => a.id.localeCompare(b.id));
    const body = payload(sales[0], sales[1]); await post('/sales/bulk-void', body).expect(200);
    for (const changed of [
      { ...body, reason: 'Changed reason' },
      { ...body, sales: [body.sales[0], { ...body.sales[1], expectedAmount: 21 }] },
      { ...body, sales: [body.sales[0]] },
      { ...body, sales: [body.sales[0], { id: sales[2].id, expectedAmount: 22 }] },
      { ...body, sales: [{ id: sales[2].id, expectedAmount: 22 }] },
    ]) await post('/sales/bulk-void', changed).expect(409);
    const manager = await prisma.user.create({ data: { email: 'other-manager@test.com', password: data.adminUser.password, firstName: 'Other', lastName: 'Manager', role: 'MANAGER', locationId: data.location.id } });
    await post('/sales/bulk-void', body, await createTestToken(manager.id, 'MANAGER')).expect(409);
    await post('/sales/' + sales[0].id + '/void', { idempotencyKey: body.idempotencyKey, reason: body.reason, expectedAmount: 22 }).expect(409);
    expect(await prisma.saleVoid.count()).toBe(2);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: sales[2].id } })).status).toBe('COMPLETED');
  });

  it('rolls back earlier members when a later amount is stale, and permits a corrected request', async () => {
    const sales = (await Promise.all([original(), original()])).sort((a, b) => a.id.localeCompare(b.id));
    const body = payload(...sales);
    await post('/sales/bulk-void', { ...body, sales: [body.sales[0], { ...body.sales[1], expectedAmount: 23 }] }).expect(409);
    expect(await prisma.saleVoid.count()).toBe(0); expect(await prisma.drawerEntry.count()).toBe(0);
    expect(await prisma.activityLog.count({ where: { action: 'VOID' } })).toBe(0);
    expect(await stock()).toBe(data.product.stockQuantity);
    expect(await prisma.sale.count({ where: { status: 'COMPLETED' } })).toBe(2);
    await post('/sales/bulk-void', body).expect(200);
  });

  it('serializes competing selections using one key without voiding the second selection', async () => {
    const sales = await Promise.all([original(), original()]); const first = payload(sales[0]);
    const results = await Promise.all([post('/sales/bulk-void', first), post('/sales/bulk-void', { ...payload(sales[1]), idempotencyKey: first.idempotencyKey })]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(await prisma.saleVoid.count()).toBe(1); expect(await stock()).toBe(data.product.stockQuantity + 2);
  });

  it('rejects foreign sales and forbidden roles without any partial mutation', async () => {
    const foreign = await prisma.location.create({ data: { name: 'Foreign store', address: 'Other address', city: 'Other', state: 'IL', zipCode: '60000', phone: '555', email: 'foreign@test.com' } });
    const sales = await Promise.all([original(), original(foreign.id)]);
    await post('/sales/bulk-void', payload(...sales)).expect(403);
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await post('/sales/bulk-void', payload(sales[0]), cashier).expect(403);
    const platform = await prisma.user.create({ data: { email: 'platform@test.com', password: data.adminUser.password, firstName: 'Platform', lastName: 'User', role: 'SUPER_ADMIN' } });
    await post('/sales/bulk-void', payload(sales[0]), await createTestToken(platform.id, 'SUPER_ADMIN')).expect(403);
    expect(await prisma.saleVoid.count()).toBe(0); expect(await stock()).toBe(data.product.stockQuantity);
  });

  it('restores split cash and gift-card tenders once on batch replay', async () => {
    const sale = await original();
    const card = await prisma.giftCard.create({ data: { code: 'BULK-GIFT', initialBalance: 15, currentBalance: 5, locationId: data.location.id } });
    await prisma.sale.update({ where: { id: sale.id }, data: { paymentMethod: 'OTHER', payments: { create: [
      { paymentMethod: 'CASH', amount: 12 }, { paymentMethod: 'GIFT_CARD', amount: 10, reference: card.code },
    ] } } });
    const body = payload(sale);
    await post('/sales/bulk-void', body).expect(200); await post('/sales/bulk-void', body).expect(200);
    expect(Number((await prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } })).currentBalance)).toBe(15);
    expect(await prisma.giftCardTransaction.count({ where: { giftCardId: card.id } })).toBe(1);
    expect(Number((await prisma.drawerEntry.findFirstOrThrow({ where: { type: 'VOID' } })).amount)).toBe(-12);
    expect((await prisma.saleVoid.findUniqueOrThrow({ where: { saleId: sale.id } })).tenders).toEqual({ CASH: 12, GIFT_CARD: 10 });
  });

  it('requires a complete bounded request with unique sales and whole-cent amounts', async () => {
    const sale = await original(); const body = payload(sale);
    for (const invalid of [
      { saleIds: [sale.id] }, { ...body, idempotencyKey: 'bad-key' }, { ...body, reason: ' ' },
      { ...body, sales: [] }, { ...body, sales: [body.sales[0], body.sales[0]] },
      { ...body, sales: [{ ...body.sales[0], expectedAmount: 22.001 }] },
      { ...body, sales: Array.from({ length: 51 }, () => ({ id: randomUUID(), expectedAmount: 22 })) },
    ]) await post('/sales/bulk-void', invalid).expect(400);
    expect(await prisma.saleVoid.count()).toBe(0);
  });
});
