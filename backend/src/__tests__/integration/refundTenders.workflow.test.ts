import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getFinancialBreakdowns } from '../../services/financialMetrics.service';

describe('Original-tender return settlement', () => {
  let data: TestData, token: string;
  const post = (path: string, body: object) => request(app).post('/api' + path).set('Authorization', 'Bearer ' + token).send(body);
  const sell = (payments: object[], extra: object = {}) => post('/sales', { customerId: data.customer.id, idempotencyKey: randomUUID(),
    items: [{ productId: data.product.id, price: 19.99, quantity: 1 }], paymentMethod: 'CASH', amountPaid: 21.99, payments, ...extra });
  const refund = (saleId: string, extra: object = {}) => post('/sales/' + saleId + '/refund', { idempotencyKey: randomUUID(), amount: 21.99, reason: 'Reviewed return', ...extra });
  beforeEach(async () => {
    data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN');
    await post('/shifts/clock-in', { startingCash: 100 }).expect(201);
  });

  it('returns mixed cash/card sources once, nets change and reports actual tender payouts', async () => {
    const original = (await sell([{ paymentMethod: 'CASH', amount: 20 }, { paymentMethod: 'CARD', amount: 10, reference: 'CHARGE-10' }], { amountPaid: 30 }).expect(201)).body.data;
    const body = { idempotencyKey: randomUUID(), items: [{ saleItemId: original.items[0].id, quantity: 1 }], refundTenders: original.payments.map((payment: any) => ({ sourcePaymentId: payment.id,
      method: payment.paymentMethod, amount: payment.paymentMethod === 'CASH' ? 11.99 : 10,
      ...(payment.paymentMethod === 'CARD' ? { reference: 'TERMINAL-RETURN-10' } : {}) })) };
    const results = await Promise.all([refund(original.id, body), refund(original.id, body)]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    const recorded = await prisma.refund.findFirstOrThrow({ where: { saleId: original.id } });
    expect(recorded.method).toBe('SPLIT'); expect(recorded.tenders).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'CASH', amount: 11.99 }), expect.objectContaining({ method: 'CARD', amount: 10, originalReference: 'CHARGE-10', reference: 'TERMINAL-RETURN-10' }),
    ]));
    expect(await prisma.drawerEntry.count({ where: { type: 'REFUND' } })).toBe(1);
    expect(Number((await prisma.drawerEntry.findFirstOrThrow({ where: { type: 'REFUND' } })).amount)).toBe(-11.99);
    const breakdown = await getFinancialBreakdowns({ locationId: data.location.id }, {}, 'UTC', new Date(), prisma, ['payment', 'employee']);
    expect(breakdown.filter(row => row.kind === 'payment')).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'CASH', total: 0, gross: 11.99, count: 1 }), expect.objectContaining({ key: 'CARD', total: 0, gross: 10, count: 1 }),
    ]));
    expect(breakdown.find(row => row.kind === 'employee')).toMatchObject({ total: 0, count: 1 });
    await expect(prisma.refund.update({ where: { id: recorded.id }, data: { tenders: [] } })).rejects.toThrow();
    await expect(prisma.salePayment.update({ where: { id: original.payments[0].id }, data: { amount: 999 } })).rejects.toThrow();
    await post('/shifts/clock-out', { endingCash: 100 }).expect(200);
    expect((await refund(original.id, body).expect(200)).body.replayed).toBe(true);
    expect(await prisma.refund.count()).toBe(1); expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(100);
  });

  it('does not convert cash into card, exceed cash retained, or pay before terminal evidence', async () => {
    const original = (await sell([{ paymentMethod: 'CASH', amount: 20 }, { paymentMethod: 'CARD', amount: 10 }], { amountPaid: 30 }).expect(201)).body.data;
    await refund(original.id, { amount: 12, refundMethod: 'CASH' }).expect(400);
    await refund(original.id, { amount: 1, refundTenders: [{ sourcePaymentId: original.payments.find((payment: any) => payment.paymentMethod === 'CASH').id, method: 'CARD', amount: 1, reference: 'WRONG' }] }).expect(400);
    await refund(original.id, { amount: 10, refundMethod: 'CARD' }).expect(400);
    expect(await prisma.refund.count()).toBe(0); expect(await prisma.drawerEntry.count({ where: { type: 'REFUND' } })).toBe(0);
  });

  it('restores only the original gift card, with an explicit linked-customer credit alternative', async () => {
    const card = await prisma.giftCard.create({ data: { code: 'ORIGINAL-GIFT', currentBalance: 50, initialBalance: 50, locationId: data.location.id } });
    const wrong = await prisma.giftCard.create({ data: { code: 'OTHER-GIFT', currentBalance: 0, initialBalance: 0, locationId: data.location.id } });
    const original = (await sell([{ paymentMethod: 'GIFT_CARD', amount: 21.99, reference: card.code }], { paymentMethod: 'GIFT_CARD' }).expect(201)).body.data;
    await refund(original.id, { refundMethod: 'CASH' }).expect(400);
    await refund(original.id, { refundMethod: 'GIFT_CARD', reference: wrong.code }).expect(400);
    await refund(original.id, { amount: 10, refundMethod: 'STORE_CREDIT' }).expect(200);
    await refund(original.id, { amount: 11.99, refundMethod: 'GIFT_CARD' }).expect(200);
    expect(Number((await prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } })).currentBalance)).toBe(40);
    expect(Number((await prisma.giftCard.findUniqueOrThrow({ where: { id: wrong.id } })).currentBalance)).toBe(0);
    expect(Number((await prisma.storeCreditAccount.findUniqueOrThrow({ where: { customerId: data.customer.id } })).balance)).toBe(10);
    expect(await prisma.drawerEntry.count({ where: { type: 'REFUND' } })).toBe(0);
  });

  it('reverses house-account debt once and refuses negative debt after an earlier payment', async () => {
    const account = await prisma.houseAccount.create({ data: { customerId: data.customer.id, locationId: data.location.id, balance: 0, creditLimit: 100 } });
    const original = (await sell([{ paymentMethod: 'HOUSE_ACCOUNT', amount: 21.99 }], { paymentMethod: 'HOUSE_ACCOUNT' }).expect(201)).body.data;
    await refund(original.id, { amount: 10, refundMethod: 'HOUSE_ACCOUNT' }).expect(200);
    expect(Number((await prisma.houseAccount.findUniqueOrThrow({ where: { id: account.id } })).balance)).toBe(11.99);
    // A prior legitimate debt payment leaves less debt than this return.
    await prisma.houseAccount.update({ where: { id: account.id }, data: { balance: 0 } });
    await refund(original.id, { amount: 11.99, refundMethod: 'HOUSE_ACCOUNT' }).expect(409);
    await refund(original.id, { amount: 11.99, refundMethod: 'STORE_CREDIT' }).expect(200);
    expect(Number((await prisma.houseAccount.findUniqueOrThrow({ where: { id: account.id } })).balance)).toBe(0);
    expect(Number((await prisma.storeCreditAccount.findUniqueOrThrow({ where: { customerId: data.customer.id } })).balance)).toBe(11.99);
    expect(await prisma.houseAccountTransaction.count({ where: { accountId: account.id, type: 'ADJUSTMENT' } })).toBe(1);
  });

  it('a partially allocated batch rolls back every payout when one source is invalid', async () => {
    const first = (await sell([{ paymentMethod: 'CASH', amount: 21.99 }]).expect(201)).body.data;
    const second = (await sell([{ paymentMethod: 'CARD', amount: 21.99 }], { paymentMethod: 'CARD' }).expect(201)).body.data;
    await post('/sales/bulk-refund', { idempotencyKey: randomUUID(), reason: 'Reviewed batch', sales: [
      { id: first.id, expectedAmount: 21.99, refundMethod: 'CASH' }, { id: second.id, expectedAmount: 21.99, refundMethod: 'CASH' },
    ] }).expect(400);
    expect(await prisma.refund.count()).toBe(0); expect(await prisma.operationReceipt.count()).toBe(0);
    expect(await prisma.drawerEntry.count({ where: { type: 'REFUND' } })).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(98);
  });

  it('restores multiple original gift cards independently without allowing an arbitrary destination', async () => {
    const first = await prisma.giftCard.create({ data: { code: 'GIFT-SOURCE-A', currentBalance: 30, initialBalance: 30, locationId: data.location.id } });
    const second = await prisma.giftCard.create({ data: { code: 'GIFT-SOURCE-B', currentBalance: 30, initialBalance: 30, locationId: data.location.id } });
    const original = (await sell([{ paymentMethod: 'GIFT_CARD', amount: 10, reference: first.code }, { paymentMethod: 'GIFT_CARD', amount: 11.99, reference: second.code }], { paymentMethod: 'GIFT_CARD' }).expect(201)).body.data;
    await refund(original.id, { refundMethod: 'GIFT_CARD', reference: 'UNRELATED-GIFT' }).expect(400);
    const result = (await refund(original.id, { refundMethod: 'GIFT_CARD' }).expect(200)).body.refund;
    expect(result.tenders).toHaveLength(2);
    for (const id of [first.id, second.id]) expect(Number((await prisma.giftCard.findUniqueOrThrow({ where: { id } })).currentBalance)).toBe(30);
    expect(await prisma.drawerEntry.count({ where: { type: 'REFUND' } })).toBe(0);
  });

  it('keeps ambiguous legacy split refund history blocked instead of inventing source allocations', async () => {
    const original = (await sell([{ paymentMethod: 'CASH', amount: 11.99 }, { paymentMethod: 'CARD', amount: 10 }]).expect(201)).body.data;
    await prisma.refund.create({ data: { saleId: original.id, amount: 5, method: 'STORE_CREDIT', refundedBy: data.adminUser.id, reason: 'Historic refund; missing original source snapshots' } });
    const before = await prisma.drawerEntry.count();
    await refund(original.id, { amount: 1, refundMethod: 'CASH' }).expect(409);
    const details = (await request(app).get('/api/sales/' + original.id).set('Authorization', 'Bearer ' + token).expect(200)).body.data;
    expect(details.refundTenderOptions).toEqual([]); expect(details.refundTenderError).toContain('no complete original-tender allocation');
    expect(await prisma.refund.count()).toBe(1); expect(await prisma.drawerEntry.count()).toBe(before);
  });
});
