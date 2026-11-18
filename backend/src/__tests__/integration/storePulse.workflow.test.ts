/**
 * Store Pulse (upgrade plan, WP 8.6): six weeks of a Chicago store's drawers and sales
 * teach it when the store opens, closes and sells; the scheduler pass then raises each
 * alert once to owners and managers (phones mocked) and closes it when the store is
 * back to normal. Store times are passed in; the endpoints use the real clock.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { alertsSettled, resetPushKeys } from '../../services/storeAlert.service';
import { recordHeartbeat, runStorePulse, setClosedToday } from '../../services/storePulse.service';
import { collectAttention } from '../../services/attention.service';
import { storeDay } from '../../services/reorder.service';
import { hashDeviceToken } from '../../controllers/registerPin.controller';

const mockSend = jest.fn();
jest.mock('web-push', () => ({ __esModule: true, default: { setVapidDetails: jest.fn(), sendNotification: (...args: unknown[]) => mockSend(...args) } }));

describe('Store Pulse', () => {
  const zone = 'America/Chicago';
  /** A store time: daylight time (UTC-5) until November 1, 2026, then UTC-6. */
  const at = (local: string) => new Date(local + ':00' + (local.slice(0, 10) < '2026-11-01' ? '-05:00' : '-06:00'));
  const dayBefore = (date: string, back: number) => new Date(Date.parse(date + 'T12:00:00Z') - back * 86400000).toISOString().slice(0, 10);
  let data: TestData, owner: string, manager: string, cashier: string, managerId: string;
  const saved = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
  const subscribe = (token: string, endpoint: string) => request(app).post('/api/pulse/push/subscribe').set('Authorization', 'Bearer ' + token).send({ endpoint, keys }).expect(201);
  const saleRow = (createdAt: Date) => ({ saleNumber: 'S-' + randomUUID().slice(0, 12), locationId: data.location.id, userId: data.cashierUser.id, createdAt,
    status: 'COMPLETED' as const, paymentMethod: 'CASH' as const, subtotal: 5, total: 5, amountPaid: 5 });
  const sale = (local: string) => prisma.sale.create({ data: saleRow(at(local)) });
  const openDrawer = (local: string) => prisma.shift.create({ data: { userId: data.cashierUser.id, locationId: data.location.id, clockInAt: at(local), isClosed: false } });
  const openAlerts = () => prisma.storeAlert.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: 'asc' }, select: { kind: true, sentence: true } });
  const pulse = async (local: string) => { await runStorePulse(at(local)); await alertsSettled(); };

  beforeAll(() => { process.env.VAPID_PUBLIC_KEY = 'BTestPublicKey'; process.env.VAPID_PRIVATE_KEY = 'test-private-key'; resetPushKeys(); });
  afterAll(() => {
    for (const [name, value] of [['VAPID_PUBLIC_KEY', saved.publicKey], ['VAPID_PRIVATE_KEY', saved.privateKey]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    resetPushKeys();
  });
  beforeEach(async () => {
    data = await seedTestData();
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: zone } });
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
    cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    const managerUser = await prisma.user.create({ data: { email: 'pulse-manager@test.com', password: data.adminUser.password, firstName: 'Mia', lastName: 'Manager', role: 'MANAGER', locationId: data.location.id } });
    managerId = managerUser.id;
    manager = await createTestToken(managerUser.id, 'MANAGER');
    // Six weeks before Tuesday, November 10: open 6:00 AM to 11:00 PM, closed on Sundays, six sales between 5 and 6 PM.
    const shifts = [], sales = [];
    for (let back = 1; back <= 42; back++) {
      const day = dayBefore('2026-11-10', back);
      if (new Date(day + 'T12:00:00Z').getUTCDay() === 0) continue;
      shifts.push({ userId: data.cashierUser.id, locationId: data.location.id, clockInAt: at(day + 'T06:00'), clockOutAt: at(day + 'T23:00'), isClosed: true });
      for (const minute of ['05', '15', '25', '35', '45', '55']) sales.push(saleRow(at(`${day}T17:${minute}`)));
    }
    await prisma.shift.createMany({ data: shifts });
    await prisma.sale.createMany({ data: sales });
  });

  it('tells owners and managers once that nobody has clocked in, and closes it when someone does', async () => {
    await subscribe(owner, 'https://push.example.test/owner');
    await subscribe(manager, 'https://push.example.test/manager');
    // A second store with no history is still learning: never an alert.
    await prisma.location.create({ data: { name: 'New Store', address: '2 Road', city: 'City', state: 'TX', zipCode: '75001', phone: '555', email: 'new@test.com', timezone: zone } });
    await pulse('2026-11-10T06:19');
    expect(await openAlerts()).toEqual([]);
    await pulse('2026-11-10T06:25');
    const alert = await prisma.storeAlert.findFirstOrThrow({ where: { locationId: data.location.id } });
    expect(alert).toMatchObject({ key: 'pulse:not-open:2026-11-10', kind: 'PULSE_NOT_OPEN', severity: 'high', audience: 'LEADS', href: '/team-time/shifts', resolvedAt: null,
      sentence: 'Nobody had clocked in by 6:25 AM. On Tuesdays the store usually opens by 6:00 AM.' });
    expect(mockSend.mock.calls.map(([device]) => (device as { endpoint: string }).endpoint).sort()).toEqual(['https://push.example.test/manager', 'https://push.example.test/owner']);
    // Every minute after: still one alert and no second notification; an owner has a phone on, so no email.
    await pulse('2026-11-10T06:26');
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(await prisma.storeAlert.count()).toBe(1);
    expect(await prisma.emailDelivery.count()).toBe(0);
    // Managers see it under Alerts and on the Shifts page; cashiers never.
    expect((await collectAttention(data.location.id, at('2026-11-10T06:26'), 'MANAGER')).items)
      .toContainEqual(expect.objectContaining({ key: 'nobody-on-register', severity: 'high', sentence: alert.sentence, href: '/team-time/shifts' }));
    const status = (await request(app).get('/api/pulse/status').set('Authorization', 'Bearer ' + manager).expect(200)).body.data;
    expect(status.alerts.map((open: { sentence: string }) => open.sentence)).toEqual([alert.sentence]);
    expect(status).toMatchObject({ openDrawers: 0, closedToday: false });
    await request(app).get('/api/pulse/status').set('Authorization', 'Bearer ' + cashier).expect(403);

    await openDrawer('2026-11-10T06:31');
    await pulse('2026-11-10T06:32');
    expect((await prisma.storeAlert.findUniqueOrThrow({ where: { id: alert.id } })).resolvedAt).toEqual(at('2026-11-10T06:32'));
    expect((await collectAttention(data.location.id, at('2026-11-10T06:32'), 'MANAGER')).items.map(item => item.key)).not.toContain('nobody-on-register');
  });

  it('a quiet register: no sale for as long as five usual sales take, closed by the next sale', async () => {
    await openDrawer('2026-11-10T06:00');
    await sale('2026-11-10T17:00');
    // Six sales usually between 5 and 6 PM: five take 50 minutes.
    await pulse('2026-11-10T17:49');
    expect(await openAlerts()).toEqual([]);
    await pulse('2026-11-10T17:50');
    expect(await openAlerts()).toEqual([{ kind: 'PULSE_QUIET', sentence: 'No sale since 5:00 PM. Tuesday between 5 and 6 PM usually has about 6 sales.' }]);
    await sale('2026-11-10T17:52');
    await pulse('2026-11-10T17:53');
    expect(await openAlerts()).toEqual([]);
  });

  it('a register not heard from while its cashier\'s drawer is open; signing out is not lost', async () => {
    const token = 'register-secret-' + randomUUID();
    const device = await prisma.registerDevice.create({ data: { locationId: data.location.id, name: 'Register 1', tokenHash: hashDeviceToken(token) } });
    const beat = (person: string, deviceToken = token) => request(app).post('/api/pulse/heartbeat').set('Authorization', 'Bearer ' + person).send({ deviceToken });
    // The register reports in: at most one write a minute, and only its own store's people.
    expect((await beat(cashier).expect(200)).body.data.recorded).toBe(true);
    expect((await beat(cashier).expect(200)).body.data.recorded).toBe(false);
    const seen = await prisma.registerHeartbeat.findUniqueOrThrow({ where: { registerDeviceId: device.id } });
    expect(seen.userId).toBe(data.cashierUser.id);
    const elsewhere = await prisma.location.create({ data: { name: 'Other Store', address: '2 Road', city: 'City', state: 'TX', zipCode: '75001', phone: '555', email: 'other@test.com' } });
    const theirs = 'register-secret-' + randomUUID();
    await prisma.registerDevice.create({ data: { locationId: elsewhere.id, name: 'Their Register', tokenHash: hashDeviceToken(theirs) } });
    await beat(cashier, theirs).expect(404);
    await beat(cashier, 'not-a-register-token-at-all').expect(404);
    await beat(cashier, 'short').expect(400);

    // At store time: Register 1 last heard at 2:10 PM while the cashier's drawer is open.
    await prisma.registerHeartbeat.deleteMany();
    await openDrawer('2026-11-10T06:00');
    await recordHeartbeat(device.id, data.cashierUser.id, seen.sessionId!, at('2026-11-10T14:10'));
    await pulse('2026-11-10T14:14');
    expect(await openAlerts()).toEqual([]);
    await pulse('2026-11-10T14:15');
    expect(await openAlerts()).toEqual([{ kind: 'PULSE_REGISTER',
      sentence: 'Register 1 has not been heard from since 2:10 PM and Cashier\'s drawer is still open. If only its connection is down, it can keep taking cash sales.' }]);
    await recordHeartbeat(device.id, data.cashierUser.id, seen.sessionId!, at('2026-11-10T14:20'));
    await pulse('2026-11-10T14:21');
    expect(await openAlerts()).toEqual([]);
    // Signed out (the register waits at the sign-in screen): silent, though the drawer is still open.
    await request(app).post('/api/auth/logout').set('Authorization', 'Bearer ' + cashier).expect(200);
    await pulse('2026-11-10T14:40');
    expect(await openAlerts()).toEqual([]);
    // A revoked register is no longer one.
    await prisma.registerDevice.update({ where: { id: device.id }, data: { revokedAt: new Date() } });
    await beat(await createTestToken(data.cashierUser.id, 'CASHIER')).expect(404);
  });

  it('a drawer left open an hour after the usual closing, until it is closed', async () => {
    const drawer = await openDrawer('2026-11-10T16:00');
    await sale('2026-11-10T22:41');
    await pulse('2026-11-10T23:59');
    expect(await openAlerts()).toEqual([]);
    await pulse('2026-11-11T00:05');
    expect(await openAlerts()).toEqual([{ kind: 'PULSE_LEFT_OPEN',
      sentence: 'Cashier\'s drawer is still open at 12:05 AM. On Tuesdays the store usually closes by 11:00 PM; the last sale was at 10:41 PM.' }]);
    await prisma.shift.update({ where: { id: drawer.id }, data: { isClosed: true, clockOutAt: at('2026-11-11T00:10') } });
    await pulse('2026-11-11T00:11');
    expect(await openAlerts()).toEqual([]);
  });

  it('"closed today" silences the opening alert until tomorrow, and owners switch alerts off', async () => {
    await pulse('2026-11-10T06:25');
    expect(await openAlerts()).toHaveLength(1);
    await setClosedToday(data.location.id, managerId, true, at('2026-11-10T06:30'));
    expect(await openAlerts()).toEqual([]);
    await pulse('2026-11-10T09:00');
    expect(await openAlerts()).toEqual([]);
    await pulse('2026-11-11T06:25');
    expect(await openAlerts()).toEqual([{ kind: 'PULSE_NOT_OPEN', sentence: 'Nobody had clocked in by 6:25 AM. On Wednesdays the store usually opens by 6:00 AM.' }]);

    // The endpoint marks the store's own day; managers may, cashiers may not.
    await request(app).post('/api/pulse/closed-today').set('Authorization', 'Bearer ' + cashier).send({ closed: true }).expect(403);
    expect((await request(app).post('/api/pulse/closed-today').set('Authorization', 'Bearer ' + manager).send({ closed: true }).expect(200)).body.data.closedDay)
      .toBe(storeDay(zone, new Date()).date);
    expect((await request(app).get('/api/pulse/status').set('Authorization', 'Bearer ' + manager).expect(200)).body.data.closedToday).toBe(true);
    expect((await request(app).post('/api/pulse/closed-today').set('Authorization', 'Bearer ' + manager).send({ closed: false }).expect(200)).body.data.closedDay).toBeNull();

    // Only owners switch an alert off; it closes at once and stays off.
    await pulse('2026-11-12T06:25');
    expect(await openAlerts()).toHaveLength(1);
    await request(app).put('/api/pulse/settings').set('Authorization', 'Bearer ' + manager).send({ pulse: { notOpen: false } }).expect(403);
    expect((await request(app).put('/api/pulse/settings').set('Authorization', 'Bearer ' + owner).send({ pulse: { notOpen: false } }).expect(200)).body.data.pulse)
      .toEqual({ notOpen: false, quiet: true, register: true, leftOpen: true });
    expect(await openAlerts()).toEqual([]);
    await pulse('2026-11-13T06:25');
    expect(await openAlerts()).toEqual([]);
    expect((await request(app).get('/api/pulse/settings').set('Authorization', 'Bearer ' + manager).expect(200)).body.data.pulse).toBeUndefined();
  });
});
