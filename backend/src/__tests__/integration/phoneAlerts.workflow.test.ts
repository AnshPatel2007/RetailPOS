/**
 * Phone alerts (upgrade plan, WP 8.5): owners and managers turn alerts on for a
 * device; a large refund or void and a drawer that closes off reach the owners once;
 * a gone device is removed; an urgent alert is emailed to owners with no device on.
 * The push service is never called for real.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken, loginUser } from './helpers';
import { alertsSettled, resetPushKeys } from '../../services/storeAlert.service';

const mockSend = jest.fn();
jest.mock('web-push', () => ({ __esModule: true, default: { setVapidDetails: jest.fn(), sendNotification: (...args: unknown[]) => mockSend(...args) } }));

describe('Phone alerts', () => {
  let data: TestData, owner: string, manager: string, cashier: string;
  const saved = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
  const subscribe = (token: string, endpoint: string) => request(app).post('/api/pulse/push/subscribe').set('Authorization', 'Bearer ' + token)
    .send({ endpoint, keys, deviceLabel: 'iPhone' });
  const sentTo = () => mockSend.mock.calls.map(([subscription, payload]) => ({ endpoint: (subscription as { endpoint: string }).endpoint, ...JSON.parse(payload as string) }));
  const clockIn = (token: string) => request(app).post('/api/shifts/clock-in').set('Authorization', 'Bearer ' + token).send({ startingCash: 100 }).expect(201);
  const sell = async (quantity: number) => (await request(app).post('/api/sales').set('Authorization', 'Bearer ' + cashier)
    .send({ idempotencyKey: randomUUID(), items: [{ productId: data.product.id, quantity, price: 19.99 }], paymentMethod: 'CASH', amountPaid: 200 }).expect(201)).body.data;
  const refund = (sale: { id: string; items: { id: string; quantity: number }[] }, key = randomUUID()) => request(app).post(`/api/sales/${sale.id}/refund`)
    .set('Authorization', 'Bearer ' + owner).send({ items: sale.items.map(item => ({ saleItemId: item.id, quantity: item.quantity })), reason: 'Customer returned it', idempotencyKey: key });

  beforeAll(() => { process.env.VAPID_PUBLIC_KEY = 'BTestPublicKey'; process.env.VAPID_PRIVATE_KEY = 'test-private-key'; resetPushKeys(); });
  afterAll(() => {
    for (const [name, value] of [['VAPID_PUBLIC_KEY', saved.publicKey], ['VAPID_PRIVATE_KEY', saved.privateKey]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    resetPushKeys();
  });
  beforeEach(async () => {
    data = await seedTestData();
    owner = await loginUser('admin@test.com', 'Admin123!');
    cashier = await loginUser('cashier@test.com', 'Admin123!');
    const managerUser = await prisma.user.create({ data: { email: 'manager-alerts@test.com', password: data.adminUser.password, firstName: 'Mia', lastName: 'Manager', role: 'MANAGER', locationId: data.location.id } });
    manager = await createTestToken(managerUser.id, 'MANAGER');
  });

  it('turns alerts on for owners and managers, never cashiers, and off again', async () => {
    await subscribe(owner, 'https://push.example.test/owner-phone').expect(201);
    await subscribe(cashier, 'https://push.example.test/cashier-phone').expect(403);
    await subscribe(owner, 'http://push.example.test/not-secure').expect(400);
    const ownerView = (await request(app).get('/api/pulse/settings').set('Authorization', 'Bearer ' + owner).expect(200)).body.data;
    expect(ownerView).toMatchObject({ publicKey: 'BTestPublicKey', amounts: { refundAlertOver: 50, drawerAlertOver: 5 } });
    expect(ownerView.devices.map((device: { deviceLabel: string }) => device.deviceLabel)).toEqual(['iPhone']);
    // Managers turn alerts on too, but never see the owner's amounts.
    const managerView = (await request(app).get('/api/pulse/settings').set('Authorization', 'Bearer ' + manager).expect(200)).body.data;
    expect(managerView.amounts).toBeUndefined();
    await request(app).get('/api/pulse/settings').set('Authorization', 'Bearer ' + cashier).expect(403);
    // Someone else cannot take the owner's device off; the owner can.
    expect((await request(app).delete('/api/pulse/push/subscribe').set('Authorization', 'Bearer ' + manager).send({ endpoint: 'https://push.example.test/owner-phone' }).expect(200)).body.data.removed).toBe(0);
    expect((await request(app).delete('/api/pulse/push/subscribe').set('Authorization', 'Bearer ' + owner).send({ endpoint: 'https://push.example.test/owner-phone' }).expect(200)).body.data.removed).toBe(1);
    // A server without push keys says so instead of pretending.
    delete process.env.VAPID_PUBLIC_KEY; resetPushKeys();
    expect((await subscribe(owner, 'https://push.example.test/owner-phone').expect(409)).body.error).toBe('Phone alerts are not set up on this server yet.');
    process.env.VAPID_PUBLIC_KEY = 'BTestPublicKey'; resetPushKeys();
  });

  it('sends a large refund to the owners\' phones once, and nothing for a small one', async () => {
    await subscribe(owner, 'https://push.example.test/owner-phone').expect(201);
    await subscribe(manager, 'https://push.example.test/manager-phone').expect(201);
    await clockIn(cashier); await clockIn(owner);
    const large = await sell(3); // $59.97 + $6.00 tax
    const key = randomUUID();
    await refund(large, key).expect(200);
    await alertsSettled();
    expect(sentTo()).toEqual([{ endpoint: 'https://push.example.test/owner-phone', title: 'Test Store', tag: expect.stringMatching(/^refund:/),
      body: `Admin refunded $65.97 in cash on sale ${large.saleNumber}.`, url: expect.stringContaining('/alerts/open?store=' + data.location.id) }]);
    // The same refund sent again (a lost response): one alert still.
    expect((await refund(large, key).expect(200)).body.replayed).toBe(true);
    const small = await sell(1); // $21.99
    await refund(small).expect(200);
    await alertsSettled();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.storeAlert.findMany({ select: { kind: true, severity: true, audience: true } })).toEqual([{ kind: 'REFUND', severity: 'medium', audience: 'OWNERS' }]);
    // A test alert reaches each of this person's devices.
    expect((await request(app).post('/api/pulse/push/test').set('Authorization', 'Bearer ' + owner).expect(200)).body.data).toEqual({ devices: 1, sent: 1 });
  });

  it('emails an urgent drawer difference to owners with no device on, and removes a device that is gone', async () => {
    await clockIn(cashier);
    await request(app).post('/api/shifts/clock-out').set('Authorization', 'Bearer ' + cashier).send({ endingCash: 70 }).expect(200);
    await alertsSettled();
    expect(mockSend).not.toHaveBeenCalled();
    const emails = await prisma.emailDelivery.findMany({ select: { recipientEmail: true, subject: true } });
    expect(emails).toEqual([{ recipientEmail: 'admin@test.com', subject: "Test Store: Cashier's drawer closed $30.00 short." }]);
    expect(await prisma.storeAlert.findFirst({ select: { kind: true, severity: true } })).toEqual({ kind: 'DRAWER', severity: 'high' });

    // With a device on, no email: and a device the push service no longer knows is removed.
    await subscribe(owner, 'https://push.example.test/old-phone').expect(201);
    mockSend.mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }));
    await clockIn(cashier);
    await request(app).post('/api/shifts/clock-out').set('Authorization', 'Bearer ' + cashier).send({ endingCash: 125 }).expect(200);
    await alertsSettled();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await prisma.pushSubscription.count()).toBe(0);
    expect(await prisma.emailDelivery.count()).toBe(1);
  });

  it('lets only owners set the amounts; blank turns an alert off', async () => {
    await request(app).put('/api/pulse/settings').set('Authorization', 'Bearer ' + manager).send({ refundAlertOver: 10 }).expect(403);
    await request(app).put('/api/pulse/settings').set('Authorization', 'Bearer ' + owner).send({ refundAlertOver: 0 }).expect(400);
    await request(app).put('/api/pulse/settings').set('Authorization', 'Bearer ' + owner).send({ drawerAlertOver: 1.234 }).expect(400);
    expect((await request(app).put('/api/pulse/settings').set('Authorization', 'Bearer ' + owner).send({ refundAlertOver: null, drawerAlertOver: 12.5 }).expect(200)).body.data.amounts)
      .toEqual({ refundAlertOver: null, drawerAlertOver: 12.5 });
    await subscribe(owner, 'https://push.example.test/owner-phone').expect(201);
    await clockIn(cashier); await clockIn(owner);
    await refund(await sell(5)).expect(200);
    await alertsSettled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(await prisma.storeAlert.count()).toBe(0);
  });
});
