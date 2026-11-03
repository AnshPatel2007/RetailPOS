import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { config } from '../../config';
import { createLoginSession } from '../../services/session.service';

describe('Server session revocation and password workflows', () => {
  let data: TestData;
  beforeEach(async () => { data = await seedTestData(); });
  const login = async (email = 'admin@test.com', password = 'Admin123!') => {
    const response = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
    const token = response.body.data.token as string;
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find(value => value.startsWith('refreshToken='))!.split(';')[0];
    return { token, cookie, sessionId: (jwt.decode(token) as { sessionId: string }).sessionId };
  };
  const me = (token: string) => request(app).get('/api/auth/me').set('Authorization', 'Bearer ' + token);
  const post = (path: string, token: string, body: object = {}) => request(app).post(path).set('Authorization', 'Bearer ' + token).send(body);
  const refresh = (cookie: string) => request(app).post('/api/auth/refresh').set('Cookie', cookie).send({});

  it('logout revokes access and renewal for one device while another device stays signed in', async () => {
    const first = await login(), second = await login();
    await me(first.token).expect(200);
    await post('/api/auth/logout', first.token).set('Cookie', first.cookie).expect(200);
    await me(first.token).expect(401); await refresh(first.cookie).expect(401);
    await me(second.token).expect(200); await refresh(second.cookie).expect(200);
    await post('/api/auth/logout', first.token).expect(200);
    expect(await prisma.activityLog.count({ where: { action: 'LOGOUT' } })).toBe(1);
  });

  it('an expired access token can still sign out using its HttpOnly refresh cookie; foreign browser origins cannot', async () => {
    const session = await login();
    const expired = jwt.sign({ userId: data.adminUser.id, sessionId: session.sessionId }, config.jwt.secret, { expiresIn: -1 });
    await post('/api/auth/logout', expired).set('Cookie', session.cookie).set('Origin', 'https://unrelated.example').expect(403);
    await me(session.token).expect(200);
    const response = await post('/api/auth/logout', expired).set('Cookie', session.cookie).expect(200);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    await me(session.token).expect(401); await refresh(session.cookie).expect(401);
  });

  it('logout-all revokes every current access token and refresh token', async () => {
    const a = await login(), b = await login();
    await post('/api/auth/logout-all', a.token).expect(200);
    for (const session of [a, b]) { await me(session.token).expect(401); await refresh(session.cookie).expect(401); }
    await me((await login()).token).expect(200);
  });

  it('session revocation is scoped to its owner and immediately invalidates the selected device', async () => {
    const a = await login(), b = await login(), foreign = await login('cashier@test.com', 'Admin123!');
    const revoke = (id: string) => request(app).delete('/api/auth/sessions/' + id).set('Authorization', 'Bearer ' + a.token);
    await revoke(foreign.sessionId).expect(404); await me(foreign.token).expect(200);
    await revoke(b.sessionId).expect(200); await me(b.token).expect(401); await refresh(b.cookie).expect(401); await me(a.token).expect(200);
  });

  it.each(['/api/auth/change-password', '/api/users/change-password'])('changing a password via %s revokes all devices and enforces the shared policy', async path => {
    const a = await login(), b = await login();
    await post(path, a.token, { currentPassword: 'Admin123!', newPassword: 'weak12', confirmPassword: 'weak12' }).expect(400);
    await me(a.token).expect(200);
    await post(path, a.token, { currentPassword: 'Admin123!', newPassword: 'Updated123!', confirmPassword: 'Updated123!' }).expect(200);
    for (const session of [a, b]) { await me(session.token).expect(401); await refresh(session.cookie).expect(401); }
    await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'Admin123!' }).expect(401);
    await me((await login('admin@test.com', 'Updated123!')).token).expect(200);
  });

  it('an owner reset invalidates the employee sessions without revoking the owner', async () => {
    const owner = await login(), cashier = await login('cashier@test.com', 'Admin123!');
    await post('/api/users/' + data.cashierUser.id + '/reset-password', owner.token, { newPassword: 'Updated123!' }).expect(200);
    await me(cashier.token).expect(401); await refresh(cashier.cookie).expect(401); await me(owner.token).expect(200);
  });

  it('a reset token is consumed once under simultaneous requests and all old sessions are revoked', async () => {
    const session = await login(), reset = 'fixture-password-reset';
    await prisma.user.update({ where: { id: data.adminUser.id }, data: { passwordResetToken: createHash('sha256').update(reset).digest('hex'), passwordResetExpires: new Date(Date.now() + 60000) } });
    const resetRequest = () => request(app).post('/api/auth/reset-password').send({ token: reset, password: 'Updated123!' });
    const results = await Promise.all([resetRequest(), resetRequest()]);
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    await me(session.token).expect(401); await refresh(session.cookie).expect(401);
    expect(await prisma.activityLog.count({ where: { action: 'PASSWORD_RESET' } })).toBe(1);
  });

  it.each(['role', 'store', 'deactivation'])('%s changes revoke existing sessions even if the original authority is restored', async change => {
    const session = await login();
    const update = change === 'role' ? { role: 'CASHIER' as const } : change === 'store' ? { locationId: null } : { isActive: false };
    await prisma.user.update({ where: { id: data.adminUser.id }, data: update });
    await me(session.token).expect(401); await refresh(session.cookie).expect(401);
    await prisma.user.update({ where: { id: data.adminUser.id }, data: { role: 'ADMIN', locationId: data.location.id, isActive: true } });
    await me(session.token).expect(401); await refresh(session.cookie).expect(401);
    await me((await login()).token).expect(200);
  });

  it('ordinary profile edits and rolled-back security changes leave a valid session usable', async () => {
    const session = await login();
    await prisma.user.update({ where: { id: data.adminUser.id }, data: { firstName: 'Updated', hourlyRate: 25 } });
    await me(session.token).expect(200);
    await expect(prisma.$transaction(async tx => { await tx.user.update({ where: { id: data.adminUser.id }, data: { password: 'not-committed' } }); throw new Error('rollback'); })).rejects.toThrow('rollback');
    await me(session.token).expect(200); await refresh(session.cookie).expect(200);
  });

  it('rejects unbound tokens, expired sessions and a token bound to another user session', async () => {
    const session = await login(), other = await login('cashier@test.com', 'Admin123!');
    await me(jwt.sign({ userId: data.adminUser.id }, config.jwt.secret)).expect(401);
    await me(jwt.sign({ userId: data.adminUser.id, sessionId: other.sessionId }, config.jwt.secret)).expect(401);
    await prisma.refreshToken.update({ where: { id: session.sessionId }, data: { expiresAt: new Date(0) } });
    await me(session.token).expect(401); await refresh(session.cookie).expect(401);
  });

  it('a password change during sign-in cannot create a usable session from previously verified credentials', async () => {
    const old = await prisma.user.findUniqueOrThrow({ where: { id: data.adminUser.id } });
    await prisma.user.update({ where: { id: old.id }, data: { password: 'changed' } });
    await expect(createLoginSession(old, 'unused-session-secret', 'test')).rejects.toMatchObject({ statusCode: 401 });
    expect(await prisma.refreshToken.count()).toBe(0);
  });
});
