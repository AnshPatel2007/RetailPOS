import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Manager approvals without changing the cashier session', () => {
  let data: TestData;
  let cashier: string;
  let owner: string;
  beforeEach(async () => {
    data = await seedTestData();
    cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.shift.create({ data: { userId: data.cashierUser.id, locationId: data.location.id, startingCash: 100, clockInAt: new Date() } });
  });
  const post = (path: string, body: object, approval?: string, auth = cashier) => {
    const call = request(app).post(path).set('Authorization', `Bearer ${auth}`);
    if (approval) call.set('X-Manager-Approval', approval);
    return call.send(body);
  };
  const checkout = () => ({ items: [{ productId: data.product.id, quantity: 1, price: 10, priceOverride: true }], paymentMethod: 'CASH', amountPaid: 20, expectedTotal: 11, idempotencyKey: randomUUID() });
  const issue = async (body: object, path = '/api/sales') => {
    const response = await post('/api/approvals', { email: data.adminUser.email, password: 'Admin123!', reason: 'Damaged packaging', request: { method: 'POST', path, body } }).expect(201);
    expect(response.body.data).not.toHaveProperty('user');
    expect(response.headers['set-cookie']).toBeUndefined();
    return response.body.data.token as string;
  };

  it('requires exact approval, keeps the cashier as actor, and preserves sale idempotency', async () => {
    const body = checkout();
    await post('/api/sales', body).expect(428);
    expect(await prisma.sale.count()).toBe(0);
    const token = await issue(body);
    await post('/api/sales', { ...body, amountPaid: 30 }, token).expect(428);
    const sale = await post('/api/sales', body, token).expect(201);
    expect(sale.body.data.userId).toBe(data.cashierUser.id);
    await post('/api/sales', body, token).expect(200);
    expect(await prisma.sale.count()).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(99);
    const approval = await prisma.managerApproval.findFirstOrThrow();
    expect(approval.consumedAt).not.toBeNull();
    const audit = await prisma.activityLog.findFirstOrThrow({ where: { action: 'MANAGER_APPROVAL_USED' } });
    expect(audit.userId).toBe(data.cashierUser.id);
    expect(audit.details).toMatchObject({ managerId: data.adminUser.id, cashierId: data.cashierUser.id });
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${cashier}`).expect(200).then(r => expect(r.body.data.role).toBe('CASHIER'));
  });

  it('rolls approval consumption back when checkout fails', async () => {
    const body = checkout(); const token = await issue(body);
    // Recorded stock no longer fails a checkout; a recall hold still does.
    await prisma.product.update({ where: { id: data.product.id }, data: { saleBlockedReason: 'Manufacturer recall' } });
    await post('/api/sales', body, token).expect(409);
    expect((await prisma.managerApproval.findFirstOrThrow()).consumedAt).toBeNull();
    expect(await prisma.activityLog.count({ where: { action: 'MANAGER_APPROVAL_USED' } })).toBe(0);
    await prisma.product.update({ where: { id: data.product.id }, data: { saleBlockedReason: null } });
    await post('/api/sales', body, token).expect(201);
  });

  it('rejects an expired approval and a manager whose authority was revoked', async () => {
    const body = checkout(); const token = await issue(body);
    await prisma.managerApproval.updateMany({ data: { expiresAt: new Date(0) } });
    await post('/api/sales', body, token).expect(428);
    const newToken = await issue(body);
    await prisma.user.update({ where: { id: data.adminUser.id }, data: { role: 'CASHIER' } });
    await post('/api/sales', body, newToken).expect(403);
    expect(await prisma.sale.count()).toBe(0);
  });

  it('requires the manager to belong to this store and satisfy enabled 2FA', async () => {
    const body = { email: data.adminUser.email, password: 'Admin123!', reason: 'Review', request: { method: 'POST', path: '/api/sales', body: checkout() } };
    await prisma.user.update({ where: { id: data.adminUser.id }, data: { twoFactorEnabled: true } });
    await post('/api/approvals', body).expect(403);
    await prisma.user.update({ where: { id: data.adminUser.id }, data: { twoFactorEnabled: false, locationId: null } });
    await post('/api/approvals', body).expect(403);
    expect(await prisma.managerApproval.count()).toBe(0);
  });

  it('does not grant approval for another cashier or unrelated action', async () => {
    const body = checkout(); const token = await issue(body);
    const other = await prisma.user.create({ data: { email: 'another-cashier@test.com', password: data.cashierUser.password, firstName: 'Another', lastName: 'Cashier', role: 'CASHIER', locationId: data.location.id } });
    await prisma.shift.create({ data: { userId: other.id, locationId: data.location.id, clockInAt: new Date() } });
    await post('/api/sales', body, token, await createTestToken(other.id, 'CASHIER')).expect(428);
    await post('/api/approvals', { email: data.adminUser.email, password: 'Admin123!', reason: 'Invalid action', request: { method: 'POST', path: '/api/users', body: {} } }).expect(400);
    await post('/api/expenses', {}, token).expect(403);
  });

  it('consumes a refund approval once, even under simultaneous requests', async () => {
    await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, clockInAt: new Date() } });
    const sale = await post('/api/sales', checkout(), undefined, owner).expect(201);
    const path = `/api/sales/${sale.body.data.id}/refund`;
    const body = { amount: 1, reason: 'Price adjustment', refundMethod: 'CASH' };
    await post(path, body).expect(428);
    const token = await issue(body, path);
    const results = await Promise.all([post(path, body, token), post(path, body, token)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 428]);
    expect(await prisma.refund.count()).toBe(1);
  });
  it('approves a discount at the register before payment: any tender, once, for those exact lines', async () => {
    const line = { productId: data.product.id, quantity: 1, price: 10, priceOverride: true };
    const issued = await post('/api/approvals', { email: data.adminUser.email, password: 'Admin123!', reason: 'Damaged box',
      request: { method: 'POST', path: '/api/sales/discount-approval', body: { items: [line] } } }).expect(201);
    expect(issued.body.data.expiresIn).toBe(900);
    const token = issued.body.data.token as string;
    // The payment is chosen after approval: the manager approved the line, not the tender.
    const sale = (paid: number) => ({ items: [line], paymentMethod: 'CASH', amountPaid: paid, expectedTotal: 11, idempotencyKey: randomUUID() });
    // A changed price is a different discount and needs its own approval.
    await post('/api/sales', { ...sale(20), items: [{ ...line, price: 9 }], expectedTotal: 9.9 }, token).expect(428);
    await post('/api/sales', sale(50), token).expect(201);
    // Single use: the next sale with the same lines needs a new approval.
    await post('/api/sales', sale(20), token).expect(428);
    expect(await prisma.sale.count()).toBe(1);
    // A register approval never authorizes a refund.
    const sold = await prisma.sale.findFirstOrThrow();
    await post(`/api/sales/${sold.id}/refund`, { amount: 1, reason: 'Price adjustment', refundMethod: 'CASH' }, token).expect(428);
    // Nothing to approve is refused, and an expired register approval is not accepted.
    await post('/api/approvals', { email: data.adminUser.email, password: 'Admin123!', reason: 'None', request: { method: 'POST', path: '/api/sales/discount-approval', body: { items: [{ productId: data.product.id, quantity: 1, price: 10 }] } } }).expect(400);
    const late = (await post('/api/approvals', { email: data.adminUser.email, password: 'Admin123!', reason: 'Damaged box',
      request: { method: 'POST', path: '/api/sales/discount-approval', body: { items: [line] } } }).expect(201)).body.data.token as string;
    await prisma.managerApproval.updateMany({ where: { consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await post('/api/sales', sale(20), late).expect(428);
  });
});
