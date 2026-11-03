import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData } from './setup';
import { createTestToken } from './helpers';

async function fixture(surcharge = 0) {
  const data = await seedTestData(), token = await createTestToken(data.adminUser.id, 'ADMIN');
  await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, clockInAt: new Date() } });
  await prisma.product.update({ where: { id: data.product.id }, data: { price: 100, isTaxable: false } });
  await prisma.location.update({ where: { id: data.location.id }, data: { cardSurchargePercent: surcharge } });
  const payments = [{ paymentMethod: 'CASH', amount: 20 }, { paymentMethod: 'CARD', amount: 78.81, reference: 'APPROVED-7881' }];
  const body = { idempotencyKey: randomUUID(), items: [{ productId: data.product.id, quantity: 1, price: 100 }], paymentMethod: 'CARD', payments, amountPaid: 98.81 };
  const post = (path: string, value: object) => request(app).post(path).set('Authorization', 'Bearer ' + token).send(value);
  return { data, body, post };
}

it('rejects unfinished payments and commits exact mixed payments once without losing a cent', async () => {
  const { data, body, post } = await fixture();
  await post('/api/sales', body).expect(400);
  expect(await prisma.sale.count()).toBe(0);
  expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(data.product.stockQuantity);
  const complete = { ...body, amountPaid: 100, expectedTotal: 100, payments: [...body.payments, { paymentMethod: 'CASH', amount: 1.19 }] };
  const saved = (await post('/api/sales', complete).expect(201)).body.data;
  expect(saved.total).toBe(100); expect(saved.changeDue).toBe(0); expect(saved.payments).toHaveLength(3);
  expect((await post('/api/sales', complete).expect(200)).body.data.id).toBe(saved.id);
  expect(await prisma.sale.count()).toBe(1);
  expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(data.product.stockQuantity - 1);
});

it('uses the actual approved card share for surcharge and allows final cash change', async () => {
  const { body, post } = await fixture(3);
  const payments = [...body.payments, { paymentMethod: 'CASH', amount: 4 }];
  const quote = (await post('/api/sales/quote', { items: body.items, payments }).expect(200)).body.data;
  expect(quote.total).toBe(102.36); expect(quote.surcharge).toBe(2.36);
  const saved = (await post('/api/sales', { ...body, payments, amountPaid: 102.81, expectedTotal: 102.36 }).expect(201)).body.data;
  expect(saved.total).toBe(102.36); expect(saved.changeDue).toBe(0.45);
});

it('rejects duplicate terminal approvals and excessive payment entries without changing stock', async () => {
  const { data, body, post } = await fixture();
  const duplicate = [{ paymentMethod: 'CARD', amount: 50, reference: 'SAME-APPROVAL' }, { paymentMethod: 'CARD', amount: 50, reference: ' SAME-APPROVAL ' }];
  const result = await post('/api/sales', { ...body, amountPaid: 100, payments: duplicate }).expect(400);
  expect(result.body.error).toMatch(/counted twice/);
  await post('/api/sales', { ...body, amountPaid: 105, payments: Array.from({ length: 21 }, () => ({ paymentMethod: 'CASH', amount: 5 })) }).expect(400);
  expect(await prisma.sale.count()).toBe(0);
  expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(data.product.stockQuantity);
});
