import { numeric } from '../../utils/money';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Drawer reconciliation and transaction boundaries', () => {
  let data: TestData, owner: string, cashier: string;
  const post = (token: string, path: string, body: object = {}) => request(app).post('/api' + path).set('Authorization', 'Bearer ' + token).send(body);
  const get = (token: string, path: string) => request(app).get('/api' + path).set('Authorization', 'Bearer ' + token);
  const start = async (token: string) => (await post(token, '/shifts/clock-in', { startingCash: 100 }).expect(201)).body.data;
  const sell = (token: string, extra: object = {}) => post(token, '/sales', { idempotencyKey: randomUUID(), items: [{ productId: data.product.id, price: 19.99, quantity: 2 }], paymentMethod: 'CASH', amountPaid: 50, ...extra });
  const refund = (saleId: string, extra: object = {}) => post(owner, '/sales/' + saleId + '/refund', { amount: 10, reason: 'Customer return', refundMethod: 'CASH', ...extra });
  const current = async (token = owner) => (await get(token, '/shifts/current').expect(200)).body.data;
  beforeEach(async () => {
    data = await seedTestData();
    // The drawer arithmetic is checked through a cashier's own figures here, so blind
    // close is off for this store (cashControl.workflow.test.ts covers it on).
    await prisma.location.update({ where: { id: data.location.id }, data: { settings: { cashControl: { blindClose: false } } } });
    owner = await createTestToken(data.adminUser.id, 'ADMIN'); cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
  });

  it('pays a prior-shift cash refund from the current drawer and preserves the closed Z-report', async () => {
    const originalShift = await start(cashier);
    const sale = (await sell(cashier).expect(201)).body.data;
    await post(cashier, '/shifts/clock-out', { endingCash: 143.98 }).expect(200);
    const before = (await get(owner, '/shifts/' + originalShift.id + '/z-report').expect(200)).body.data;
    const paying = await start(owner);
    await refund(sale.id, { amount: sale.total }).expect(200);
    expect(await current()).toMatchObject({ expectedDrawer: 56.02, cashRefunds: 43.98, totalCashSales: 0, totalTransactions: 0 });
    const entries = await prisma.drawerEntry.findMany({ where: { type: 'REFUND' } });
    expect(entries).toHaveLength(1); expect(entries[0]).toMatchObject({ shiftId: paying.id, saleId: sale.id, userId: data.adminUser.id });
    const after = (await get(owner, '/shifts/' + originalShift.id + '/z-report').expect(200)).body.data;
    expect(after).toEqual(before);
    const closed = (await post(owner, '/shifts/clock-out', { endingCash: 56.02 }).expect(200)).body.data;
    expect(closed).toMatchObject({ expectedCash: 56.02, cashDifference: 0 });
    const z = (await get(owner, '/shifts/' + paying.id + '/z-report').expect(200)).body.data;
    expect(z).toMatchObject({ expectedCash: 56.02, cashRefunds: 43.98, cashDifference: 0 });
  });

  it('nets split-tender change once and keeps partial/full refund payouts separate', async () => {
    const shift = await start(owner);
    const sale = (await sell(owner, { payments: [{ paymentMethod: 'CARD', amount: 20 }, { paymentMethod: 'CASH', amount: 30 }] }).expect(201)).body.data;
    expect(await current()).toMatchObject({ totalCashSales: 23.98, expectedDrawer: 123.98, tenderBreakdown: { CASH: { total: 23.98 }, CARD: { total: 20 } } });
    await refund(sale.id, { amount: 13.98 }).expect(200);
    expect((await current()).expectedDrawer).toBe(110);
    await refund(sale.id, { amount: 30, refundMethod: undefined, refundTenders: [
      { sourcePaymentId: sale.payments.find((payment: any) => payment.paymentMethod === 'CASH').id, method: 'CASH', amount: 10 },
      { sourcePaymentId: sale.payments.find((payment: any) => payment.paymentMethod === 'CARD').id, method: 'CARD', amount: 20, reference: 'TERMINAL-REFUND-20' },
    ] }).expect(200);
    expect(await current()).toMatchObject({ cashRefunds: 23.98, expectedDrawer: 100, totalCashSales: 23.98 });
    const out = (await post(owner, '/shifts/clock-out', { endingCash: 100 }).expect(200)).body.data.shiftSummary;
    const z = (await get(owner, '/shifts/' + shift.id + '/z-report').expect(200)).body.data;
    for (const key of ['cashSales', 'cashRefunds', 'cashVoids', 'cashMovementNet', 'expectedCash', 'totalSales', 'totalTax']) expect(out[key]).toEqual(z[key]);
    expect(out.paymentBreakdown.CASH.total).toBe(23.98);
  });

  it('requires the actor to open a drawer before paying cash, but permits a card refund without one', async () => {
    await start(cashier); const sale = (await sell(cashier).expect(201)).body.data;
    await refund(sale.id).expect(400);
    await post(owner, '/sales/' + sale.id + '/void').expect(400);
    expect(await prisma.refund.count()).toBe(0);
    await refund(sale.id, { refundMethod: 'CARD', reference: 'WRONG-ORIGINAL-TENDER' }).expect(400);
    const cardSale = (await sell(cashier, { paymentMethod: 'CARD', amountPaid: 43.98 }).expect(201)).body.data;
    await refund(cardSale.id, { refundMethod: 'CARD', reference: 'TERMINAL-REFUND-10' }).expect(200);
    expect((await current(cashier)).expectedDrawer).toBe(143.98);
    expect(await prisma.drawerEntry.count({ where: { type: 'REFUND' } })).toBe(0);
  });

  it('a later cash void pays only net cash from its own drawer and leaves original counters intact', async () => {
    const original = await start(cashier); const sale = (await sell(cashier).expect(201)).body.data;
    await post(cashier, '/shifts/clock-out', { endingCash: 143.98 }).expect(200);
    const paying = await start(owner);
    await post(owner, '/sales/' + sale.id + '/void').expect(200);
    expect(await current()).toMatchObject({ cashVoids: 43.98, expectedDrawer: 56.02 });
    expect(numeric(await prisma.shift.findUnique({ where: { id: original.id } }))).toMatchObject({ totalSales: 43.98, totalTransactions: 1, expectedCash: 143.98 });
    expect(await prisma.drawerEntry.findFirst({ where: { type: 'VOID' } })).toMatchObject({ shiftId: paying.id });
    await post(owner, '/sales/' + sale.id + '/void').expect(400);
    expect(await prisma.drawerEntry.count({ where: { type: 'VOID' } })).toBe(1);
  });

  it('concurrent partial-refund retries create one payout and replay after the drawer is closed', async () => {
    await start(owner); const sale = (await sell(owner).expect(201)).body.data;
    const idempotencyKey = randomUUID();
    const responses = await Promise.all([refund(sale.id, { idempotencyKey }), refund(sale.id, { idempotencyKey })]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(await prisma.refund.count()).toBe(1);
    expect(await prisma.drawerEntry.count({ where: { type: 'REFUND' } })).toBe(1);
    await post(owner, '/shifts/clock-out', { endingCash: 133.98 }).expect(200);
    await refund(sale.id, { idempotencyKey }).expect(200);
    await refund(sale.id, { idempotencyKey, amount: 11 }).expect(409);
    expect(await prisma.refund.count()).toBe(1);
  });

  it('cash-movement retries are exact, audited once and usable after clock-out', async () => {
    await start(owner);
    const body = { idempotencyKey: randomUUID(), type: 'PAID_OUT', amount: 3.50, reason: 'Supplies' };
    const responses = await Promise.all([post(owner, '/shifts/cash-movement', body), post(owner, '/shifts/cash-movement', body)]);
    expect(responses.map(r => r.status)).toEqual([201, 201]);
    expect(responses[0].body.data.id).toBe(responses[1].body.data.id);
    expect((await current()).expectedDrawer).toBe(96.5);
    await post(owner, '/shifts/clock-out', { endingCash: 96.5 }).expect(200);
    await post(owner, '/shifts/cash-movement', body).expect(201);
    await post(owner, '/shifts/cash-movement', { ...body, amount: 4 }).expect(409);
    expect(await prisma.activityLog.count({ where: { action: 'CASH_MOVEMENT' } })).toBe(1);
  });

  for (const operation of ['sale', 'refund', 'movement'] as const) {
    it('reconciles or rejects a concurrent ' + operation + ' at clock-out', async () => {
      const shift = await start(owner);
      const sale = (await sell(owner).expect(201)).body.data;
      const operationRequest = operation === 'sale' ? sell(owner) : operation === 'refund' ? refund(sale.id) : post(owner, '/shifts/cash-movement', { type: 'SAFE_DROP', amount: 10, reason: 'Safe' });
      const [mutation, closed] = await Promise.all([operationRequest, post(owner, '/shifts/clock-out', { endingCash: 143.98 })]);
      expect([200, 201, 400, 404, 409]).toContain(mutation.status);
      expect(closed.status).toBe(200);
      const sum = await prisma.drawerEntry.aggregate({ where: { shiftId: shift.id }, _sum: { amount: true } });
      expect(closed.body.data.expectedCash).toBe(Math.round((100 + Number(sum._sum.amount)) * 100) / 100);
      if (mutation.status >= 400) {
        expect(await prisma.sale.count()).toBe(1); expect(await prisma.refund.count()).toBe(0); expect(await prisma.cashMovement.count()).toBe(0);
      }
    });
  }

  it('manager closure records the same expected cash without inventing an actual count', async () => {
    const shift = await start(cashier); await sell(cashier).expect(201);
    const closed = (await post(owner, '/shifts/' + shift.id + '/close').expect(200)).body.data;
    expect(closed).toMatchObject({ expectedCash: 143.98, endingCash: null, cashDifference: null });
    expect((await get(owner, '/shifts/' + shift.id + '/z-report').expect(200)).body.data.expectedCash).toBe(143.98);
  });

  it('rejects non-cash overpayment instead of inventing cash change', async () => {
    await start(owner);
    await sell(owner, { paymentMethod: 'CARD' }).expect(400);
    await sell(owner, { payments: [{ paymentMethod: 'CARD', amount: 49 }, { paymentMethod: 'CASH', amount: 1 }] }).expect(400);
    expect(await prisma.sale.count()).toBe(0); expect((await current()).expectedDrawer).toBe(100);
  });

  it('validates drawer counts without accepting negative, missing or sub-cent money', async () => {
    await post(owner, '/shifts/clock-in', { startingCash: -1 }).expect(400);
    await start(owner);
    for (const endingCash of [undefined, -1, 1.001, '100']) await post(owner, '/shifts/clock-out', { endingCash }).expect(400);
    expect((await current()).isClosed).toBe(false);
  });

  it('does not pay an extra cent or accept a fractional-cent cash refund', async () => {
    await start(owner); const sale = (await sell(owner).expect(201)).body.data;
    await refund(sale.id, { amount: 43.99 }).expect(400);
    await refund(sale.id, { amount: 10.001 }).expect(400);
    expect(await prisma.refund.count()).toBe(0);
    expect((await current()).expectedDrawer).toBe(143.98);
  });

  it('flags incomplete legacy history and preserves the original recorded closed expectation', async () => {
    const shift = await start(owner); await sell(owner).expect(201);
    await prisma.shift.update({ where: { id: shift.id }, data: { drawerHistoryComplete: false, isClosed: true, expectedCash: 130, endingCash: 129, cashDifference: -1 } });
    const report = (await get(owner, '/shifts/' + shift.id + '/z-report').expect(200)).body.data;
    expect(report).toMatchObject({ expectedCash: 130, endingCash: 129, cashDifference: -1, drawerHistoryComplete: false, calculatedExpected: 143.98 });
    expect(report.reconciliationWarning).toContain('manual reconciliation');
  });

  it('enforces append-only ledger entries and denies another store access to a Z-report', async () => {
    const shift = await start(owner); await sell(owner).expect(201);
    const entry = await prisma.drawerEntry.findFirstOrThrow();
    await expect(prisma.drawerEntry.update({ where: { id: entry.id }, data: { amount: 0 } })).rejects.toThrow();
    await expect(prisma.drawerEntry.delete({ where: { id: entry.id } })).rejects.toThrow();
    const other = await prisma.location.create({ data: { name: 'Other', address: '', city: '', state: '', zipCode: '', phone: '', email: 'other@test.com' } });
    await prisma.user.update({ where: { id: data.cashierUser.id }, data: { role: 'ADMIN', locationId: other.id } });
    const token = await createTestToken(data.cashierUser.id, 'ADMIN');
    await get(token, '/shifts/' + shift.id + '/z-report').expect(403);
  });
});
