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
    await prisma.product.update({ where: { id: data.product.id }, data: { stockQuantity: 0 } });
    await post('/api/sales', body, token).expect(400);
    expect((await prisma.managerApproval.findFirstOrThrow()).consumedAt).toBeNull();
    expect(await prisma.activityLog.count({ where: { action: 'MANAGER_APPROVAL_USED' } })).toBe(0);
    await prisma.product.update({ where: { id: data.product.id }, data: { stockQuantity: 1 } });
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
});
