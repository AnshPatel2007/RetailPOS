import { numeric } from '../../utils/money';
import { randomUUID } from 'crypto';
import { prisma, seedTestData, TestData } from './setup';
import { api, createTestToken } from './helpers';

describe('Review regressions', () => {
  let data: TestData;
  let cashier: string;
  let admin: string;
  let shift: any;
  const payload = () => ({ idempotencyKey: randomUUID(), items: [{ productId: data.product.id, quantity: 2, price: 19.99 }], paymentMethod: 'CASH', amountPaid: 100 });
  const sale = async () => (await api.post('/api/sales').withAuth(cashier).withBody(payload()).expectStatus(201).execute()).body.data;

  beforeEach(async () => {
    data = await seedTestData();
    cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    admin = await createTestToken(data.adminUser.id, 'ADMIN');
    await api.post('/api/shifts/clock-in').withAuth(admin).withBody({ startingCash: 100 }).expectStatus(201).execute();
    shift = (await api.post('/api/shifts/clock-in').withAuth(cashier).withBody({ startingCash: 100 }).expectStatus(201).execute()).body.data;
  });

  it('cannot elevate privileges through the alternate registration endpoint', async () => {
    await prisma.user.update({ where: { id: data.cashierUser.id }, data: { role: 'MANAGER' } });
    await api.get('/api/auth/me').withAuth(cashier).expectStatus(401).execute();
    cashier = await createTestToken(data.cashierUser.id, 'MANAGER');
    await api.post('/api/auth/register').withAuth(cashier).withBody({ email: 'elevated@test.com', password: 'Str0ng!Pass', firstName: 'New', lastName: 'User', role: 'ADMIN' }).expectStatus(403).execute();
    expect(await prisma.user.findUnique({ where: { email: 'elevated@test.com' } })).toBeNull();
  });

  it('demotion applies to an already issued token', async () => {
    await prisma.user.update({ where: { id: data.adminUser.id }, data: { role: 'CASHIER' } });
    await api.get('/api/users').withAuth(admin).expectStatus(401).execute();
    await api.get('/api/users').withAuth(await createTestToken(data.adminUser.id, 'CASHIER')).expectStatus(403).execute();
  });

  it('two stores can each make their first sale on the same day', async () => {
    const first = await sale();
    const store = await prisma.location.create({ data: { name: 'Second store', address: '2 Test St', city: 'Test', state: 'TS', zipCode: '12345', phone: '555-0002', email: 'second-store@test.com' } });
    const user = await prisma.user.create({ data: { email: 'second@test.com', firstName: 'Second', lastName: 'Cashier', password: data.cashierUser.password, role: 'CASHIER', locationId: store.id } });
    const product = await prisma.product.create({ data: { name: 'Second product', sku: 'SECOND', price: 10, cost: 5, stockQuantity: 10, locationId: store.id } });
    const token = await createTestToken(user.id, 'CASHIER');
    await api.post('/api/shifts/clock-in').withAuth(token).withBody({ startingCash: 0 }).expectStatus(201).execute();
    const second = await api.post('/api/sales').withAuth(token).withBody({ ...payload(), items: [{ productId: product.id, quantity: 1, price: 10 }] }).expectStatus(201).execute();
    expect(second.body.data.saleNumber).not.toBe(first.saleNumber);
  });

  it('offline replay after a lost response returns the committed sale without deducting stock twice', async () => {
    const body = payload();
    const first = await api.post('/api/sales').withAuth(cashier).withBody(body).expectStatus(201).execute();
    const replay = await api.post('/api/sales').withAuth(cashier).withBody({ ...body, offlineShiftId: shift.id, offlineCreatedAt: new Date().toISOString(), expectedTotal: first.body.data.total }).expectStatus(200).execute();
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(await prisma.sale.count()).toBe(1);
    expect((await prisma.product.findUnique({ where: { id: data.product.id } }))!.stockQuantity).toBe(98);
  });

  it('replays a cash sale against its original closed shift and timestamp', async () => {
    const checkoutTime = new Date();
    await prisma.shift.update({ where: { id: shift.id }, data: { clockOutAt: new Date(checkoutTime.getTime() + 1000), isClosed: true } });
    const response = await api.post('/api/sales').withAuth(cashier).withBody({ ...payload(), offlineShiftId: shift.id, offlineCreatedAt: checkoutTime.toISOString(), expectedTotal: 43.98 }).expectStatus(201).execute();
    expect(response.body.data.shiftId).toBe(shift.id);
    expect(response.body.data.createdAt).toBe(checkoutTime.toISOString());
  });

  it('does not silently reprice an offline sale', async () => {
    await api.post('/api/sales').withAuth(cashier).withBody({ ...payload(), offlineShiftId: shift.id, offlineCreatedAt: new Date().toISOString(), expectedTotal: 40 }).expectStatus(409).execute();
    expect(await prisma.sale.count()).toBe(0);
    expect((await prisma.product.findUnique({ where: { id: data.product.id } }))!.stockQuantity).toBe(100);
  });

  it('serializes concurrent refunds of the same sale', async () => {
    const original = await sale();
    const results = await Promise.all([1, 2].map(() => api.post(`/api/sales/${original.id}/refund`).withAuth(admin).withBody({ items: [{ saleItemId: original.items[0].id, quantity: 2 }], reason: 'Return' }).execute()));
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    expect(await prisma.refund.count()).toBe(1);
    expect((await prisma.product.findUnique({ where: { id: data.product.id } }))!.stockQuantity).toBe(100);
  });

  it('bulk refund after an item refund restores only the remaining unit', async () => {
    const original = await sale();
    await api.post(`/api/sales/${original.id}/refund`).withAuth(admin).withBody({ items: [{ saleItemId: original.items[0].id, quantity: 1 }], reason: 'First unit' }).expectStatus(200).execute();
    const preview = await api.post('/api/sales/bulk-refund/preview').withAuth(admin).withBody({ saleIds: [original.id] }).expectStatus(200).execute();
    await api.post('/api/sales/bulk-refund').withAuth(admin).withBody({ idempotencyKey: randomUUID(), reason: 'Remaining unit', sales: [{ id: original.id, expectedAmount: preview.body.data[0].expectedAmount, refundMethod: 'CASH' }] }).expectStatus(200).execute();
    expect((await prisma.product.findUnique({ where: { id: data.product.id } }))!.stockQuantity).toBe(100);
  });

  it('exchange returns share refund history and cannot be repeated', async () => {
    const original = await sale();
    const body = { originalSaleId: original.id, type: 'RETURN_ONLY', reason: 'Return', returnedItems: [{ productId: data.product.id, quantity: 2, price: 99999 }] };
    await api.post('/api/exchanges').withAuth(admin).withBody(body).expectStatus(201).execute();
    const refund = await prisma.refund.findFirst({ where: { saleId: original.id } });
    expect(numeric(refund!.amount)).toBe(original.total);
    await api.post('/api/exchanges').withAuth(admin).withBody(body).expectStatus(400).execute();
    expect((await prisma.product.findUnique({ where: { id: data.product.id } }))!.stockQuantity).toBe(100);
  });

  it('exchange rejects a product that was not on the original sale', async () => {
    const original = await sale();
    const other = await prisma.product.create({ data: { name: 'Other', sku: 'OTHER', price: 10, cost: 5, stockQuantity: 7, locationId: data.location.id } });
    await api.post('/api/exchanges').withAuth(admin).withBody({ originalSaleId: original.id, type: 'RETURN_ONLY', reason: 'Return', returnedItems: [{ productId: other.id, quantity: 5 }] }).expectStatus(400).execute();
    expect((await prisma.product.findUnique({ where: { id: other.id } }))!.stockQuantity).toBe(7);
  });

  it('financial reports and exports net a fully refunded sale to zero', async () => {
    const original = await sale();
    await api.post(`/api/sales/${original.id}/refund`).withAuth(admin).withBody({ amount: original.total, reason: 'Return' }).expectStatus(200).execute();
    const pnl = await api.get('/api/financial/reports/pnl').withAuth(admin).expectStatus(200).execute();
    expect(pnl.body.data.revenue.netSales).toBe(0);
    const exported = await api.get('/api/financial/export/sales').withAuth(admin).expectStatus(200).execute();
    expect(exported.body.data.totalRevenue).toBe(0);
  });
});
