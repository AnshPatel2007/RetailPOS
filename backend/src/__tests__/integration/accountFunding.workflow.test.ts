import { numeric } from '../../utils/money';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Account funding, receipts and concurrent balances', () => {
  let data: TestData, owner: string, cashier: string, manager: string;
  const post = (path: string, body: object, token = owner) => request(app).post('/api' + path).set('Authorization', 'Bearer ' + token).send(body);
  const get = (path: string, token = owner) => request(app).get('/api' + path).set('Authorization', 'Bearer ' + token);
  const funding = (amount: number, extra: object = {}) => ({ amount, paymentMethod: 'CASH', idempotencyKey: randomUUID(), ...extra });
  const start = async (token = owner) => (await post('/shifts/clock-in', { startingCash: 100 }, token).expect(201)).body.data;
  const house = (balance = 100) => prisma.houseAccount.create({ data: { customerId: data.customer.id, locationId: data.location.id, creditLimit: 500, balance } });
  const gift = (balance = 30) => prisma.giftCard.create({ data: { code: randomUUID(), initialBalance: balance, currentBalance: balance, locationId: data.location.id } });
  const sell = (method: string, token = cashier, reference?: string) => post('/sales', {
    customerId: data.customer.id, idempotencyKey: randomUUID(), items: [{ productId: data.product.id, quantity: 1, price: 19.99 }],
    paymentMethod: method, amountPaid: 21.99, payments: [{ paymentMethod: method, amount: 21.99, reference }],
  }, token);
  const drawer = async () => (await get('/shifts/current').expect(200)).body.data;
  beforeEach(async () => {
    data = await seedTestData(); owner = await createTestToken(data.adminUser.id, 'ADMIN'); cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    const user = await prisma.user.create({ data: { email: 'manager@test.com', password: data.adminUser.password, firstName: 'Manager', lastName: 'Test', role: 'MANAGER', locationId: data.location.id } });
    manager = await createTestToken(user.id, 'MANAGER');
  });

  it('requires an explicit funding method and cash drawer or approved terminal reference', async () => {
    await post('/gift-cards', { amount: 20 }).expect(400);
    await post('/gift-cards', funding(20)).expect(400);
    await post('/gift-cards', funding(20, { paymentMethod: 'CARD' })).expect(400);
    const result = (await post('/gift-cards', funding(20, { paymentMethod: 'CARD', reference: 'TERMINAL-123' })).expect(201)).body;
    expect(result.receipt).toMatchObject({ paymentMethod: 'CARD', reference: 'TERMINAL-123', amount: 20, balanceBefore: 0, balanceAfter: 20, shiftId: null });
    expect(await prisma.drawerEntry.count()).toBe(0);
  });

  it('issues a gift card once through concurrent retries and replays after deactivation and shift closure', async () => {
    await start(); const body = funding(20);
    const results = await Promise.all([post('/gift-cards', body), post('/gift-cards', body)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 201]);
    expect(results[0].body.data.id).toBe(results[1].body.data.id);
    const id = results[0].body.data.id;
    expect(await prisma.giftCard.count()).toBe(1); expect(await prisma.giftCardTransaction.count()).toBe(1);
    expect(await drawer()).toMatchObject({ expectedDrawer: 120, cashGiftFunding: 20, totalSales: 0 });
    await post('/gift-cards/' + id + '/deactivate', {}).expect(200);
    await post('/shifts/clock-out', { endingCash: 120 }).expect(200);
    const replay = (await post('/gift-cards', body).expect(200)).body;
    expect(replay.replayed).toBe(true); expect(replay.receipt.amount).toBe(20);
    await post('/gift-cards', { ...body, amount: 21 }).expect(409);
    expect(await prisma.accountOperation.count()).toBe(1);
  });

  it('serializes reload and checkout with continuous balance history', async () => {
    await start(); await start(cashier); const card = await gift();
    const responses = await Promise.all([post('/gift-cards/' + card.id + '/reload', funding(10)), sell('GIFT_CARD', cashier, card.code)]);
    expect(responses.map(r => r.status)).toEqual([200, 201]);
    expect(numeric((await prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } })).currentBalance)).toBeCloseTo(18.01, 8);
    const rows = await prisma.giftCardTransaction.findMany({ where: { giftCardId: card.id } });
    expect(rows).toHaveLength(2);
    const first = rows.find(t => Number(t.balanceBefore) === 30)!; const last = rows.find(t => t.id !== first.id)!;
    expect(numeric(last.balanceBefore)).toBe(numeric(first.balanceAfter)); expect(numeric(last.balanceAfter)).toBeCloseTo(18.01, 8);
    expect((await drawer()).cashGiftFunding).toBe(10);
  });

  it('allows only one competing checkout when a gift card cannot cover both', async () => {
    await start(); await start(cashier); const card = await gift();
    const results = await Promise.all([sell('GIFT_CARD', cashier, card.code), sell('GIFT_CARD', owner, card.code)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 400]);
    expect(numeric((await prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } })).currentBalance)).toBeCloseTo(8.01, 8);
    expect(await prisma.sale.count()).toBe(1);
  });

  it('requires owner authority and a reason for promotional grants', async () => {
    await post('/gift-cards', funding(20, { paymentMethod: 'PROMOTIONAL', notes: 'Community prize' }), manager).expect(403);
    await post('/gift-cards', funding(20, { paymentMethod: 'PROMOTIONAL' })).expect(400);
    const result = (await post('/gift-cards', funding(20, { paymentMethod: 'PROMOTIONAL', notes: 'Community prize' })).expect(201)).body;
    expect(result.receipt.reason).toBe('Community prize'); expect(await prisma.drawerEntry.count()).toBe(0);
  });

  it('rejects inactive or expired card reloads, invalid amounts and forged debit routes', async () => {
    await start(); const card = await gift();
    for (const amount of [0, -1, 1.001, '20']) await post('/gift-cards/' + card.id + '/reload', funding(amount as number)).expect(400);
    await prisma.giftCard.update({ where: { id: card.id }, data: { expiresAt: new Date(0) } });
    await post('/gift-cards/' + card.id + '/reload', funding(10)).expect(400);
    await post('/gift-cards/' + card.code + '/redeem', { amount: 10 }, cashier).expect(409);
    await post('/store-credit/' + data.customer.id + '/debit', { amount: 10 }, cashier).expect(409);
    expect(await prisma.accountOperation.count()).toBe(0);
  });

  it('cannot create or fund accounts for a customer at a connected partner or without a store', async () => {
    const foreign = await prisma.location.create({ data: { name: 'Partner', address: '', city: '', state: '', zipCode: '', phone: '', email: 'partner@test.com' } });
    const [locationAId, locationBId] = [data.location.id, foreign.id].sort();
    await prisma.storeConnection.create({ data: { locationAId, locationBId, createdBy: data.adminUser.id } });
    for (const locationId of [foreign.id, null]) {
      const customer = await prisma.customer.create({ data: { firstName: 'Foreign', lastName: 'Customer', locationId } });
      await post('/house-accounts', { customerId: customer.id, creditLimit: 100 }).expect(403);
      await post('/store-credit/' + customer.id + '/credit', { amount: 10, source: 'GOODWILL', notes: 'Test credit', idempotencyKey: randomUUID() }).expect(403);
      await post('/gift-cards', funding(20, { customerId: customer.id, paymentMethod: 'PROMOTIONAL', notes: 'Test grant' })).expect(403);
    }
    expect(await prisma.houseAccount.count()).toBe(0); expect(await prisma.accountOperation.count()).toBe(0);
  });

  it('preserves a simultaneous house purchase and repayment in distinct drawers', async () => {
    await start(); await start(cashier); const account = await house(50);
    const results = await Promise.all([post('/house-accounts/' + account.id + '/payment', funding(15)), sell('HOUSE_ACCOUNT')]);
    expect(results.map(r => r.status)).toEqual([200, 201]);
    expect(numeric((await prisma.houseAccount.findUniqueOrThrow({ where: { id: account.id } })).balance)).toBe(56.99);
    expect(await drawer()).toMatchObject({ expectedDrawer: 115, cashHousePayments: 15, totalSales: 0 });
    const rows = await prisma.houseAccountTransaction.findMany({ where: { accountId: account.id } });
    const first = rows.find(t => Number(t.balanceBefore) === 50)!; const last = rows.find(t => t.id !== first.id)!;
    expect(numeric(last.balanceBefore)).toBe(numeric(first.balanceAfter)); expect(numeric(last.balanceAfter)).toBe(56.99);
  });

  it('prevents concurrent overpayments and preserves exact payment retries after closure', async () => {
    const shift = await start(); const account = await house();
    const path = '/house-accounts/' + account.id + '/payment';
    const first = funding(80), second = funding(80);
    const results = await Promise.all([post(path, first), post(path, second)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    expect(numeric((await prisma.houseAccount.findUniqueOrThrow({ where: { id: account.id } })).balance)).toBe(20);
    await post('/shifts/clock-out', { endingCash: 180 }).expect(200);
    const winning = results[0].status === 200 ? first : second;
    const replay = (await post(path, winning).expect(200)).body;
    expect(replay.replayed).toBe(true); expect(replay.receipt.balanceAfter).toBe(20);
    expect((await get('/shifts/' + shift.id + '/z-report').expect(200)).body.data).toMatchObject({ expectedCash: 180, cashHousePayments: 80, cashSales: 0 });
    expect(await prisma.houseAccountTransaction.count()).toBe(1);
  });

  it('permits debt repayment on a frozen account while preventing new charges', async () => {
    await start(); await start(cashier); const account = await house();
    await prisma.houseAccount.update({ where: { id: account.id }, data: { isActive: false } });
    await post('/house-accounts/' + account.id + '/payment', funding(10)).expect(200);
    await sell('HOUSE_ACCOUNT').expect(400);
    await post('/house-accounts/' + account.id + '/payment', funding(90.01)).expect(400);
  });

  it('serializes account creation and records reasoned credit without pretending to collect cash', async () => {
    const path = '/store-credit/' + data.customer.id + '/credit';
    const body = { amount: 10, source: 'GOODWILL', notes: 'Customer goodwill', idempotencyKey: randomUUID() };
    const results = await Promise.all([post(path, body), post(path, { ...body, amount: 20, idempotencyKey: randomUUID() })]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(await prisma.storeCreditAccount.count()).toBe(1);
    expect(numeric((await prisma.storeCreditAccount.findUniqueOrThrow({ where: { customerId: data.customer.id } })).balance)).toBe(30);
    await post(path, body).expect(200); expect(await prisma.storeCreditTransaction.count()).toBe(2);
    expect(await prisma.drawerEntry.count()).toBe(0);
    const history = (await get(path.replace('/credit', '/transactions')).expect(200)).body.data;
    expect(history[0].operation).toMatchObject({ paymentMethod: 'GOODWILL', reason: 'Customer goodwill', userId: data.adminUser.id });
    expect(history[0].operation.requestHash).toBeUndefined();
  });

  it('prevents direct credits from impersonating refunds or using an owner-only correction', async () => {
    const path = '/store-credit/' + data.customer.id + '/credit';
    const body = { amount: 10, source: 'GOODWILL', notes: 'Customer goodwill', idempotencyKey: randomUUID() };
    await post(path, { ...body, saleId: randomUUID() }).expect(400);
    await post(path, { ...body, notes: ' ' }).expect(400);
    await post(path, { ...body, source: 'CORRECTION' }, manager).expect(403);
    await post(path, body, cashier).expect(403);
    await post(path, { ...body, source: 'CORRECTION' }).expect(200);
  });

  it('keeps competing store-credit checkouts within the recorded balance', async () => {
    await start(); await start(cashier);
    await post('/store-credit/' + data.customer.id + '/credit', { amount: 30, source: 'GOODWILL', notes: 'Test opening credit', idempotencyKey: randomUUID() }).expect(200);
    const results = await Promise.all([sell('STORE_CREDIT', owner), sell('STORE_CREDIT', cashier)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 400]);
    expect(numeric((await prisma.storeCreditAccount.findUniqueOrThrow({ where: { customerId: data.customer.id } })).balance)).toBeCloseTo(8.01, 8);
  });

  it('preserves an immutable funding receipt and never deletes account transaction history', async () => {
    const response = (await post('/gift-cards', funding(20, { paymentMethod: 'PROMOTIONAL', notes: 'Opening grant' })).expect(201)).body;
    await expect(prisma.accountOperation.update({ where: { id: response.receipt.id }, data: { amount: 21 } })).rejects.toThrow();
    await expect(prisma.accountOperation.delete({ where: { id: response.receipt.id } })).rejects.toThrow();
    await expect(prisma.giftCard.delete({ where: { id: response.data.id } })).rejects.toThrow();
    const detail = (await get('/gift-cards/' + response.data.id).expect(200)).body.data;
    expect(detail.transactions[0].operation).toMatchObject({ amount: 20, paymentMethod: 'PROMOTIONAL' });
  });
});
