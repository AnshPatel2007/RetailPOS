import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getFinancialMetrics } from '../../services/financialMetrics.service';

describe('Owner corrections and explicit legacy-void evidence', () => {
  let data: TestData, token: string;
  const post = (path: string, body: object = {}, auth = token) => request(app).post('/api/financial/reconciliation' + path).set('Authorization', 'Bearer ' + auth).send(body);
  const get = (path: string, auth = token) => request(app).get('/api' + path).set('Authorization', 'Bearer ' + auth);
  beforeEach(async () => { data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN'); });
  const keyBody = () => ({ idempotencyKey: randomUUID(), reason: 'Original ledger correction verified', reference: 'DOCUMENT-1' });

  it('posts a drawer correction once, rejects stale review and confirms after closure', async () => {
    await request(app).post('/api/shifts/clock-in').set('Authorization', 'Bearer ' + token).send({ startingCash: 100 }).expect(201);
    const preview = (await post('/corrections/preview', { kind: 'DRAWER', target: '' }).expect(200)).body.data;
    const body = { ...keyBody(), kind: 'DRAWER', target: '', amount: 10, expectedBalance: preview.balance };
    const responses = await Promise.all([post('/corrections', body), post('/corrections', body)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]); expect(responses.filter(response => response.body.replayed)).toHaveLength(1);
    expect((await get('/shifts/current').expect(200)).body.data.expectedDrawer).toBe(110);
    await post('/corrections', { ...body, ...keyBody(), amount: 1 }).expect(409);
    await request(app).post('/api/shifts/clock-out').set('Authorization', 'Bearer ' + token).send({ endingCash: 110 }).expect(200);
    expect((await post('/corrections', body).expect(200)).body.replayed).toBe(true);
    expect(await prisma.drawerEntry.count({ where: { type: 'CORRECTION' } })).toBe(1);
    expect((await getFinancialMetrics({ locationId: data.location.id })).netCollected).toBe(0);
  });

  it.each(['GIFT_CARD', 'STORE_CREDIT', 'HOUSE_ACCOUNT'])('corrects %s with one balance movement and immutable evidence', async kind => {
    if (kind === 'GIFT_CARD') await prisma.giftCard.create({ data: { code: 'CORRECTION-CARD', locationId: data.location.id, initialBalance: 20, currentBalance: 20 } });
    else if (kind === 'STORE_CREDIT') await prisma.storeCreditAccount.create({ data: { customerId: data.customer.id, locationId: data.location.id, balance: 20 } });
    else await prisma.houseAccount.create({ data: { customerId: data.customer.id, locationId: data.location.id, balance: 20, creditLimit: 100 } });
    const target = kind === 'GIFT_CARD' ? 'CORRECTION-CARD' : data.customer.phone;
    const body = { ...keyBody(), kind, target, amount: -5, expectedBalance: 20 };
    const first = await post('/corrections', body).expect(200); await post('/corrections', body).expect(200);
    expect(first.body.data).toMatchObject({ balanceBefore: 20, balanceAfter: 15, amount: -5 });
    await post('/corrections', { ...body, ...keyBody(), amount: -21, expectedBalance: 15 }).expect(409);
    const history = (await get('/financial/reconciliation/history').expect(200)).body.data;
    expect(history.records).toHaveLength(1); expect(history.records[0].result.reference).toBe('DOCUMENT-1');
    expect((await getFinancialMetrics({ locationId: data.location.id })).netCollected).toBe(0);
  });

  it('rejects inactive-card funding, missing proof, foreign accounts and non-owner access', async () => {
    await prisma.giftCard.create({ data: { code: 'INACTIVE', locationId: data.location.id, initialBalance: 20, currentBalance: 20, isActive: false } });
    const body = { ...keyBody(), kind: 'GIFT_CARD', target: 'INACTIVE', amount: 1, expectedBalance: 20 };
    await post('/corrections', body).expect(409); await post('/corrections', { ...body, reference: '' }).expect(400);
    const manager = await prisma.user.create({ data: { email: 'recon-manager@test.com', password: data.adminUser.password, firstName: 'Manager', lastName: 'User', locationId: data.location.id, role: 'MANAGER' } });
    const managerToken = await createTestToken(manager.id, 'MANAGER');
    await post('/corrections', body, managerToken).expect(403);
    await get('/financial/reconciliation/history', managerToken).expect(403);
    const foreign = await prisma.location.create({ data: { name: 'Foreign', address: 'Other', city: 'Other', state: 'IL', zipCode: '60000', phone: '555', email: 'foreign@test.com' } });
    await prisma.giftCard.create({ data: { code: 'FOREIGN', locationId: foreign.id, initialBalance: 20, currentBalance: 20 } });
    await post('/corrections', { ...body, target: 'FOREIGN' }).expect(404);
    expect(await prisma.operationReceipt.count()).toBe(0);
  });

  it('restricts receipt, history and legacy reads to the assigned owner even for platform users', async () => {
    await prisma.storeCreditAccount.create({ data: { customerId: data.customer.id, locationId: data.location.id, balance: 0 } });
    const body = { ...keyBody(), kind: 'STORE_CREDIT', target: data.customer.phone, amount: 5, expectedBalance: 0 };
    const receipt = (await post('/corrections', body).expect(200)).body.receiptId;
    expect((await get('/financial/reconciliation/receipts/' + receipt).expect(200)).body.data.reference).toBe(body.reference);
    for (const locationId of [null, data.location.id]) {
      const platform = await prisma.user.create({ data: { email: randomUUID()+'@test.com', password: 'unused', firstName: 'Platform', lastName: 'User', role: 'SUPER_ADMIN', locationId } });
      const platformToken = await createTestToken(platform.id, 'SUPER_ADMIN');
      for (const route of ['/history', '/legacy-voids', '/receipts/'+receipt]) await get('/financial/reconciliation'+route, platformToken).expect(403);
    }
    const foreignStore = await prisma.location.create({ data: { name: 'Other owner', address: 'Other', city: 'Other', state: 'IL', zipCode: '60000', phone: '555', email: 'receipt-foreign@test.com' } });
    const foreignOwner = await prisma.user.create({ data: { email: 'receipt-owner@test.com', password: 'unused', firstName: 'Other', lastName: 'Owner', role: 'ADMIN', locationId: foreignStore.id } });
    await get('/financial/reconciliation/receipts/'+receipt, await createTestToken(foreignOwner.id,'ADMIN')).expect(404);
  });

  it('records an attested historical void once without repeating stock, points, accounts or cash', async () => {
    const sale = await prisma.sale.create({ data: { saleNumber: randomUUID(), locationId: data.location.id, userId: data.adminUser.id,
      total: 22, subtotal: 20, tax: 2, paymentMethod: 'CASH', amountPaid: 22, status: 'VOIDED', createdAt: new Date('2025-01-05T12:00:00Z'),
      items: { create: { productId: data.product.id, productName: 'Historical item', sku: data.product.sku, quantity: 2, price: 10, total: 22, tax: 2 } },
    } });
    const beforeCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: data.customer.id } });
    const body = { ...keyBody(), saleId: sale.id, expectedAmount: 22, reversedAt: '2025-02-05T12:00:00Z', confirmedPreviouslyReversed: true, tenders: { CASH: 11, CARD: 11 } };
    await post('/legacy-voids', { ...body, tenders: { CASH: 21 } }).expect(400);
    const results = await Promise.all([post('/legacy-voids', body), post('/legacy-voids', body)]);
    expect(results.map(response => response.status)).toEqual([200, 200]); expect(await prisma.saleVoid.count()).toBe(1);
    expect(await prisma.drawerEntry.count()).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(100);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: data.customer.id } })).toEqual(beforeCustomer);
    expect((await getFinancialMetrics({ locationId: data.location.id }, { gte: new Date('2025-02-01'), lt: new Date('2025-03-01') })).netCollected).toBe(-22);
    expect((await get('/financial/reconciliation/legacy-voids').expect(200)).body.data.sales).toHaveLength(0);
    await post('/legacy-voids', { ...body, ...keyBody() }).expect(409);
  });
});
