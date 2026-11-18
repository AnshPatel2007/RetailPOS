import request from 'supertest';
import { authenticator } from 'otplib';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { verifyTOTPCode } from '../../services/twoFactor.service';

describe('Two-factor enrollment, recovery and session lifecycle', () => {
  let data: TestData, token: string;
  const post = (path: string, body: object = {}, auth = token) => request(app).post('/api' + path).set('Authorization', 'Bearer ' + auth).send(body);
  const get = (path: string, auth = token) => request(app).get('/api' + path).set('Authorization', 'Bearer ' + auth);
  const enroll = async () => {
    const setup = await post('/auth/2fa/setup', { password: 'Admin123!' }).expect(200);
    const secret = setup.body.data.secret;
    const enabled = await post('/auth/2fa/verify', { code: authenticator.generate(secret) }).expect(200);
    return { secret, backupCodes: enabled.body.data.backupCodes as string[] };
  };
  beforeEach(async () => { data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN'); });

  it('requires the password, expires setup and supports cancelling without changing the active factor', async () => {
    await post('/auth/2fa/setup', {}).expect(400);
    await post('/auth/2fa/setup', { password: 'wrong' }).expect(403);
    const setup = await post('/auth/2fa/setup', { password: 'Admin123!' }).expect(200);
    await prisma.user.update({ where: { id: data.adminUser.id }, data: { twoFactorSetupExpires: new Date(0) } });
    await post('/auth/2fa/verify', { code: authenticator.generate(setup.body.data.secret) }).expect(409);
    await request(app).delete('/api/auth/2fa/setup').set('Authorization', 'Bearer ' + token).expect(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: data.adminUser.id } });
    expect(user.twoFactorEnabled).toBe(false); expect(user.twoFactorSetupSecret).toBeNull(); expect(user.twoFactorSecret).toBeNull();
  });

  it('enables atomically, stores only hashed backup codes and revokes other sessions', async () => {
    const other = await createTestToken(data.adminUser.id, 'ADMIN');
    const { backupCodes } = await enroll();
    expect(backupCodes).toHaveLength(10); expect(new Set(backupCodes).size).toBe(10);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: data.adminUser.id } });
    expect(user.twoFactorSetupSecret).toBeNull(); expect(user.twoFactorSetupExpires).toBeNull();
    expect(user.twoFactorBackupCodes.every(hash => !backupCodes.includes(hash))).toBe(true);
    await get('/auth/me').expect(200); await get('/auth/me', other).expect(401);
    const status = (await get('/auth/2fa/status').expect(200)).body.data;
    expect(status).toEqual({ enabled: true, backupCodesRemaining: 10 });
    expect(JSON.stringify(status)).not.toContain(user.twoFactorSecret);
  });

  it('permits only one of two simultaneous logins with the same recovery code', async () => {
    const { backupCodes } = await enroll();
    const login = { email: data.adminUser.email, password: 'Admin123!', twoFactorCode: backupCodes[0] };
    const responses = await Promise.all([post('/auth/login', login), post('/auth/login', login)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 401]);
    expect((await get('/auth/2fa/status').expect(200)).body.data.backupCodesRemaining).toBe(9);
    expect(await prisma.activityLog.count({ where: { action: '2FA_RECOVERY_USED' } })).toBe(1);
  });

  it('rejects a reused authenticator step as well as a used backup code', async () => {
    const { secret, backupCodes } = await enroll();
    const fresh = authenticator.clone({ epoch: Date.now() + 30000 }).generate(secret);
    expect(await verifyTOTPCode(data.adminUser.id, fresh)).toBe(true);
    expect(await verifyTOTPCode(data.adminUser.id, fresh)).toBe(false);
    expect(await verifyTOTPCode(data.adminUser.id, backupCodes[0])).toBe(true);
    expect(await verifyTOTPCode(data.adminUser.id, backupCodes[0])).toBe(false);
  });

  it('requires both factors to disable, preserves the current session and clears the credentials', async () => {
    const { backupCodes } = await enroll();
    const other = await createTestToken(data.adminUser.id, 'ADMIN');
    await post('/auth/2fa/disable', { password: 'Admin123!' }).expect(400);
    await post('/auth/2fa/disable', { password: 'Admin123!', code: '000000' }).expect(403);
    await post('/auth/2fa/disable', { password: 'Admin123!', code: backupCodes[0] }).expect(200);
    await get('/auth/me').expect(200); await get('/auth/me', other).expect(401);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: data.adminUser.id } });
    expect(user.twoFactorEnabled).toBe(false); expect(user.twoFactorSecret).toBeNull(); expect(user.twoFactorBackupCodes).toEqual([]);
  });

  it('requires both factors to regenerate, invalidates prior codes and other sessions', async () => {
    const { backupCodes } = await enroll(); const other = await createTestToken(data.adminUser.id, 'ADMIN');
    await post('/auth/2fa/backup-codes', { password: 'Admin123!' }).expect(400);
    const regenerated = await post('/auth/2fa/backup-codes', { password: 'Admin123!', code: backupCodes[0] }).expect(200);
    expect(regenerated.body.data.backupCodes).toHaveLength(10);
    expect(await verifyTOTPCode(data.adminUser.id, backupCodes[1])).toBe(false);
    await get('/auth/me').expect(200); await get('/auth/me', other).expect(401);
  });

  it('revokes all sessions for direct factor changes outside the controlled API transaction', async () => {
    await enroll();
    await prisma.user.update({ where: { id: data.adminUser.id }, data: { twoFactorVersion: { increment: 1 } } });
    await get('/auth/me').expect(401);
  });
});
