/**
 * Register PIN sign-in: a PIN only works on a register a manager set up for the
 * same store, wrong PINs lock PIN sign-in (not the password), and nothing about
 * the PIN or the register secret is ever returned.
 */
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { api, loginUser } from './helpers';
import { isGuessablePin, hashDeviceToken } from '../../controllers/registerPin.controller';

describe('register PIN sign-in', () => {
  let data: TestData;
  let adminToken: string;
  let cashierToken: string;

  const setUpRegister = async (token = adminToken, name = 'Front counter') => {
    const res = await api.post('/api/auth/registers').withAuth(token).withBody({ name }).expectStatus(201).execute();
    return res.body.data as { id: string; name: string; storeName: string; token: string };
  };

  beforeEach(async () => {
    data = await seedTestData();
    adminToken = await loginUser('admin@test.com', 'Admin123!');
    cashierToken = await loginUser('cashier@test.com', 'Admin123!');
  });

  it('treats repeated and straight-run PINs as guessable', () => {
    for (const pin of ['1111', '1234', '9876', '0123', '7890', '000000', '543210']) expect(isGuessablePin(pin)).toBe(true);
    for (const pin of ['2580', '1357', '4821', '135791']) expect(isGuessablePin(pin)).toBe(false);
  });

  it('sets a PIN with the password, refuses guessable ones and never returns the hash', async () => {
    await api.put('/api/auth/pin').withAuth(cashierToken).withBody({ currentPassword: 'wrong', pin: '4821' }).expectError(401);
    const guessable = await api.put('/api/auth/pin').withAuth(cashierToken).withBody({ currentPassword: 'Admin123!', pin: '1234' }).expectError(400);
    expect(guessable.body.error).toMatch(/harder to guess/);
    const short = await api.put('/api/auth/pin').withAuth(cashierToken).withBody({ currentPassword: 'Admin123!', pin: '12' }).expectError(400);
    expect(short.body.error).toBe('A PIN is 4 to 6 digits');
    await api.put('/api/auth/pin').withAuth(cashierToken).withBody({ currentPassword: 'Admin123!', pin: '4821' }).expectSuccess();

    const me = await api.get('/api/auth/me').withAuth(cashierToken).expectSuccess();
    expect(me.body.data.hasPin).toBe(true);
    expect(me.body.data.pinHash).toBeUndefined();
    const stored = await prisma.user.findUnique({ where: { id: data.cashierUser.id } });
    expect(await bcrypt.compare('4821', stored!.pinHash!)).toBe(true);
    // Setting a PIN is not an authority change: the existing session keeps working.
    await api.get('/api/auth/me').withAuth(cashierToken).expectSuccess();
    expect(await prisma.activityLog.count({ where: { userId: data.cashierUser.id, action: 'PIN_SET' } })).toBe(1);
  });

  it('keeps two-step sign-in accounts on email, password and code', async () => {
    await prisma.user.update({ where: { id: data.cashierUser.id }, data: { twoFactorEnabled: true } });
    const res = await api.put('/api/auth/pin').withAuth(cashierToken).withBody({ currentPassword: 'Admin123!', pin: '4821' }).execute();
    expect([401, 403]).toContain(res.status); // the 2FA change may also end the session
  });

  it('only managers and owners set up registers; the secret is stored as a hash', async () => {
    await api.post('/api/auth/registers').withAuth(cashierToken).withBody({ name: 'Mine' }).expectError(403);
    const register = await setUpRegister();
    expect(register.token.length).toBeGreaterThan(30);
    const row = await prisma.registerDevice.findUnique({ where: { id: register.id } });
    expect(row!.tokenHash).toBe(hashDeviceToken(register.token));
    expect(JSON.stringify(row)).not.toContain(register.token);
    const list = await api.get('/api/auth/registers').withAuth(adminToken).expectSuccess();
    expect(list.body.data).toEqual([expect.objectContaining({ id: register.id, name: 'Front counter', createdBy: 'Admin U.' })]);
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash|token"/);
  });

  it('signs staff in by name and PIN on a set-up register only', async () => {
    const register = await setUpRegister();
    // Nobody has a PIN yet: the register lists no one.
    let staff = await api.post('/api/auth/register-staff').withBody({ deviceToken: register.token }).expectSuccess();
    expect(staff.body.data.staff).toEqual([]);
    await api.put('/api/auth/pin').withAuth(cashierToken).withBody({ currentPassword: 'Admin123!', pin: '4821' }).expectSuccess();
    staff = await api.post('/api/auth/register-staff').withBody({ deviceToken: register.token }).expectSuccess();
    expect(staff.body.data).toEqual({ register: { id: register.id, name: 'Front counter', storeName: 'Test Store' }, staff: [{ id: data.cashierUser.id, name: 'Cashier U.', role: 'CASHIER' }] });

    // A made-up register secret is refused.
    await api.post('/api/auth/register-staff').withBody({ deviceToken: 'x'.repeat(43) }).expectError(401);
    await api.post('/api/auth/pin-login').withBody({ deviceToken: 'x'.repeat(43), userId: data.cashierUser.id, pin: '4821' }).expectError(401);

    const res = await api.post('/api/auth/pin-login').withBody({ deviceToken: register.token, userId: data.cashierUser.id, pin: '4821' }).expectSuccess();
    expect(res.body.data.user).toMatchObject({ id: data.cashierUser.id, role: 'CASHIER', hasPin: true });
    expect((res.headers['set-cookie'] as unknown as string[]).some(cookie => cookie.startsWith('refreshToken='))).toBe(true);
    await api.get('/api/auth/me').withAuth(res.body.data.token).expectSuccess();
    const login = await prisma.activityLog.findFirst({ where: { userId: data.cashierUser.id, action: 'LOGIN' }, orderBy: { createdAt: 'desc' } });
    expect(login!.details).toMatchObject({ method: 'PIN', registerId: register.id });
    expect((await prisma.registerDevice.findUnique({ where: { id: register.id } }))!.lastUsedAt).not.toBeNull();
  });

  it('pauses PIN sign-in after five wrong PINs without locking the password', async () => {
    const register = await setUpRegister();
    await api.put('/api/auth/pin').withAuth(cashierToken).withBody({ currentPassword: 'Admin123!', pin: '4821' }).expectSuccess();
    const attempt = (pin: string) => api.post('/api/auth/pin-login').withBody({ deviceToken: register.token, userId: data.cashierUser.id, pin }).execute();
    const first = await attempt('0000');
    expect(first.status).toBe(401); expect(first.body.error).toBe('Wrong PIN. 4 tries left.');
    for (let index = 0; index < 3; index++) expect((await attempt('0000')).status).toBe(401);
    const fifth = await attempt('0000');
    expect(fifth.status).toBe(423); expect(fifth.body.error).toMatch(/PIN sign-in is paused/);
    // Even the right PIN waits out the pause; the password still signs in.
    expect((await attempt('4821')).status).toBe(423);
    await loginUser('cashier@test.com', 'Admin123!');
    await prisma.user.update({ where: { id: data.cashierUser.id }, data: { pinLockoutUntil: new Date(Date.now() - 1000) } });
    expect((await attempt('4821')).status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: data.cashierUser.id } }))!.pinFailedAttempts).toBe(0);
  });

  it('refuses other stores, removed registers and inactive staff', async () => {
    const register = await setUpRegister();
    await api.put('/api/auth/pin').withAuth(cashierToken).withBody({ currentPassword: 'Admin123!', pin: '4821' }).expectSuccess();
    const otherStore = await prisma.location.create({ data: { id: 'test-location-2', name: 'Other Store', address: '9 Other St', city: 'Test City', state: 'TS', zipCode: '12345', phone: '555-0002', email: 'other@store.com', taxRate: 0, isActive: true } });
    const outsider = await prisma.user.create({ data: { id: 'test-outsider-1', email: 'outsider@test.com', password: await bcrypt.hash('Admin123!', 10), firstName: 'Out', lastName: 'Sider', role: 'CASHIER', locationId: otherStore.id, pinHash: await bcrypt.hash('4821', 10) } });
    await api.post('/api/auth/pin-login').withBody({ deviceToken: register.token, userId: outsider.id, pin: '4821' }).expectError(401);
    const staff = await api.post('/api/auth/register-staff').withBody({ deviceToken: register.token }).expectSuccess();
    expect(staff.body.data.staff.map((person: { id: string }) => person.id)).toEqual([data.cashierUser.id]);

    await api.delete('/api/auth/registers/' + register.id).withAuth(cashierToken).expectError(403);
    await api.delete('/api/auth/registers/' + register.id).withAuth(adminToken).expectSuccess();
    const removed = await api.post('/api/auth/pin-login').withBody({ deviceToken: register.token, userId: data.cashierUser.id, pin: '4821' }).expectError(401);
    expect(removed.body.error).toMatch(/no longer set up/);
    expect((await api.get('/api/auth/registers').withAuth(adminToken).expectSuccess()).body.data).toEqual([]);

    const second = await setUpRegister(adminToken, 'Back counter');
    await prisma.user.update({ where: { id: data.cashierUser.id }, data: { isActive: false } });
    await api.post('/api/auth/pin-login').withBody({ deviceToken: second.token, userId: data.cashierUser.id, pin: '4821' }).expectError(401);
  });

  it('switching cashier ends the previous session on that browser, but not after a wrong PIN', async () => {
    const register = await setUpRegister();
    await api.put('/api/auth/pin').withAuth(adminToken).withBody({ currentPassword: 'Admin123!', pin: '2580' }).expectSuccess();
    const cashier = await request(app).post('/api/auth/login').send({ email: 'cashier@test.com', password: 'Admin123!' }).expect(200);
    const cookie = (cashier.headers['set-cookie'] as unknown as string[]).find(value => value.startsWith('refreshToken='))!.split(';')[0];
    await request(app).post('/api/auth/pin-login').set('Cookie', cookie).send({ deviceToken: register.token, userId: data.adminUser.id, pin: '0000' }).expect(401);
    await api.get('/api/auth/me').withAuth(cashier.body.data.token).expectSuccess();
    await request(app).post('/api/auth/pin-login').set('Cookie', cookie).send({ deviceToken: register.token, userId: data.adminUser.id, pin: '2580' }).expect(200);
    await api.get('/api/auth/me').withAuth(cashier.body.data.token).expectError(401);
    const ended = await prisma.activityLog.findFirst({ where: { userId: data.cashierUser.id, action: 'LOGOUT' } });
    expect(ended!.details).toMatchObject({ reason: 'Switched cashier on register', registerId: register.id });
  });

  it('unlocks the signed-in person with their own PIN, and a PIN can be removed', async () => {
    await api.post('/api/auth/pin/verify').withAuth(cashierToken).withBody({ pin: '4821' }).expectError(403);
    await api.put('/api/auth/pin').withAuth(cashierToken).withBody({ currentPassword: 'Admin123!', pin: '4821' }).expectSuccess();
    // A wrong PIN is not an expired session: 422, so the app does not try to renew it.
    await api.post('/api/auth/pin/verify').withAuth(cashierToken).withBody({ pin: '4822' }).expectError(422);
    await api.post('/api/auth/pin/verify').withAuth(cashierToken).withBody({ pin: '4821' }).expectSuccess();
    await api.delete('/api/auth/pin').withAuth(cashierToken).expectSuccess();
    expect((await api.get('/api/auth/me').withAuth(cashierToken).expectSuccess()).body.data.hasPin).toBe(false);
  });
});
