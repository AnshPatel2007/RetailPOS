import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getFinancialMetrics } from '../../services/financialMetrics.service';
import { jobPayload } from '../../services/jobQueue.service';

describe('manager reconciliation of saved register payments', () => {
  let data: TestData, token: string, shiftId: string;
  const at = '2026-10-10T12:30:00Z';
  const post = (body: object, auth = token) => request(app).post('/api/offline/reconcile').set('Authorization', 'Bearer ' + auth).send(body);
  beforeEach(async () => {
    data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN');
    shiftId = (await prisma.shift.create({ data: { userId: data.cashierUser.id, locationId: data.location.id,
      clockInAt: new Date('2026-10-10T12:00:00Z'), clockOutAt: new Date('2026-10-10T13:00:00Z'),
      isClosed: true, startingCash: 100, expectedCash: 100, endingCash: 100, cashDifference: 0 } })).id;
  });
  const body = (disposition = 'HOLD') => ({ idempotencyKey: randomUUID(), localId: randomUUID(), cashierId: data.cashierUser.id, originalShiftId: shiftId,
    kind: 'CASH', disposition, createdAt: at, total: 11, confirmed: true, reason: 'Verified original register evidence', reference: 'ORIGINAL-RECEIPT-1', references: [] });
  const receipt = () => ({ subtotal: 10, discount: 0, tax: 1, amountPaid: 20, changeDue: 9, pointsEarned: 0, ageVerified: false,
    items: [{ productId: data.product.id, productName: 'Original receipt name', sku: data.product.sku, quantity: 1, price: 10, discount: 0, tax: 1, total: 11, pointsEarned: 0 }] });

  it('books verified historical cash once without repricing or changing the counted closing cash', async () => {
    await prisma.webhookEndpoint.create({ data: { createdBy: data.adminUser.id, url: 'https://unreachable.invalid/events', secret: 'offline-event-test-secret', events: ['sale.completed', 'product.low_stock'] } });
    await prisma.product.update({ where: { id: data.product.id }, data: { lowStockAlert: 99 } });
    const input = { ...body('BOOK_CASH'), receipt: receipt() };
    const responses = await Promise.all([post(input), post(input)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(responses.filter(response => response.body.replayed)).toHaveLength(1);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { idempotencyKey: input.localId }, include: { items: true } });
    expect(Number(sale.total)).toBe(11); expect(sale.userId).toBe(data.cashierUser.id); expect(sale.createdAt.toISOString()).toBe(at.replace('Z', '.000Z'));
    expect(sale.items[0].unitCost).toBeNull(); expect(sale.items[0].productName).toBe('Original receipt name');
    const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect([Number(shift.expectedCash), Number(shift.endingCash), Number(shift.cashDifference)]).toEqual([111, 100, -11]);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(99);
    expect(await prisma.drawerEntry.count()).toBe(1);
    expect((await getFinancialMetrics({ locationId: data.location.id })).netCollected).toBe(11);
    const webhookJobs = await prisma.backgroundJob.findMany({ where: { kind: 'WEBHOOK', locationId: data.location.id } });
    expect(webhookJobs).toHaveLength(2);
    const events = webhookJobs.map(job => JSON.parse(jobPayload<{ body: string }>(job).body));
    expect(events.find(event => event.event === 'sale.completed')).toMatchObject({ createdAt: at.replace('Z', '.000Z'), data: { id: sale.id, total: 11, itemCount: 1 } });
    expect(events.find(event => event.event === 'product.low_stock')).toMatchObject({ data: { sku: data.product.sku, stock: 99 } });
    await post({ ...input, reason: 'Changed evidence' }).expect(409);
    await post({ ...input, idempotencyKey: randomUUID() }).expect(409);
  });

  it('rejects incomplete or inconsistent receipt facts and rolls all effects back', async () => {
    const input = { ...body('BOOK_CASH'), receipt: receipt() };
    await post({ ...input, receipt: { ...input.receipt, tax: 2 } }).expect(400);
    await post({ ...input, receipt: { ...input.receipt, pointsEarned: 1 } }).expect(400);
    await post({ ...input, originalShiftId: undefined }).expect(400);
    await prisma.product.update({ where: { id: data.product.id }, data: { stockQuantity: 0 } });
    await post(input).expect(400);
    expect(await prisma.sale.count()).toBe(0); expect(await prisma.operationReceipt.count()).toBe(0);
    expect(await prisma.drawerEntry.count()).toBe(0);
  });

  it('keeps holds as evidence and permits one later final disposition', async () => {
    const input = body();
    expect((await post(input).expect(200)).body.data.status).toBe('HOLD');
    expect(await prisma.sale.count()).toBe(0);
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    const syncOriginal = () => request(app).post('/api/sales').set('Authorization', 'Bearer ' + cashier).send({ idempotencyKey: input.localId, offlineCreatedAt: at,
      offlineShiftId: shiftId, expectedTotal: 11, paymentMethod: 'CASH', amountPaid: 11, items: [{ productId: data.product.id, quantity: 1, price: 10, discount: 0 }] });
    // A hold must also survive a lost response or a different register: the
    // server pauses synchronization, even before IndexedDB receives the receipt.
    expect((await syncOriginal().expect(409)).body.error).toContain('held or reconciled');
    const final = { ...input, idempotencyKey: randomUUID(), disposition: 'NOT_COLLECTED' };
    expect((await post(final).expect(200)).body.data.status).toBe('FINAL');
    await post({ ...final, idempotencyKey: randomUUID() }).expect(409);
    expect(await prisma.operationReceipt.count()).toBe(2);
    await syncOriginal().expect(409);
    expect(await prisma.sale.count()).toBe(0);
  });

  it('matches only the original cashier, store, amount and terminal approval reference', async () => {
    const input = { ...body('MATCH_RECORDED'), kind: 'TERMINAL', references: ['APPROVAL-1'] };
    const sale = await prisma.sale.create({ data: { idempotencyKey: input.localId, saleNumber: randomUUID(), userId: data.cashierUser.id, locationId: data.location.id,
      createdAt: new Date(at), paymentMethod: 'CARD', total: 11, amountPaid: 11, payments: { create: { paymentMethod: 'CARD', amount: 11, reference: 'APPROVAL-1' } } } });
    await post({ ...input, references: ['WRONG'] }).expect(409);
    await post({ ...input, total: 12 }).expect(409);
    expect((await post(input).expect(200)).body.data.saleId).toBe(sale.id);
    expect(await prisma.sale.count()).toBe(1); expect(await prisma.drawerEntry.count()).toBe(0);
  });

  it('blocks cashier decisions and external terminal relabelling, and keeps history store-scoped', async () => {
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await post(body(), cashier).expect(403);
    await post({ ...body('NOT_COLLECTED'), kind: 'TERMINAL' }).expect(400);
    await post({ ...body('BOOK_CASH'), kind: 'TERMINAL', receipt: receipt() }).expect(400);
    await post(body()).expect(200);
    await request(app).get('/api/offline/history').set('Authorization', 'Bearer ' + cashier).expect(403);
    const history = (await request(app).get('/api/offline/history').set('Authorization', 'Bearer ' + token).expect(200)).body.data;
    expect(history.records).toHaveLength(1); expect(history.records[0].result.cashierId).toBe(data.cashierUser.id);
    expect(JSON.stringify(history)).not.toMatch(/password|hourlyRate/);
    await prisma.location.update({ where: { id: data.location.id }, data: { isActive: false } });
    await post(body()).expect(403);
    expect((await request(app).get('/api/offline/history').set('Authorization', 'Bearer ' + token).expect(200)).body.data.records).toHaveLength(1);
  });
});
