import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { enqueueDigestEmails, processNextEmailDelivery, recoverExpiredEmailDeliveries, retryEmailDelivery } from '../../services/emailDelivery.service';
import { sendEmail } from '../../utils/email';

jest.mock('../../utils/email', () => ({ sendEmail: jest.fn() }));

describe('Durable daily digest delivery', () => {
  let data: TestData, token: string;
  const savedKey = process.env.ANTHROPIC_API_KEY, savedEmails = process.env.DAILY_DIGEST_EMAILS;
  beforeEach(async () => {
    delete process.env.ANTHROPIC_API_KEY; delete process.env.DAILY_DIGEST_EMAILS;
    data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN'); jest.mocked(sendEmail).mockResolvedValue(undefined);
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
    if (savedEmails === undefined) delete process.env.DAILY_DIGEST_EMAILS; else process.env.DAILY_DIGEST_EMAILS = savedEmails;
  });
  const queue = (key = randomUUID()) => enqueueDigestEmails(data.location.id, key, [data.adminUser.email], 'Store summary', '<p>Private store totals</p>');

  it('persists one recipient delivery for concurrent retries of the same request', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([queue(key), queue(key)]);
    expect(a[0].id).toBe(b[0].id); expect(await prisma.emailDelivery.count()).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('lets only one concurrent worker claim a delivery and records provider acceptance', async () => {
    await queue(); const outcomes = await Promise.all([processNextEmailDelivery(), processNextEmailDelivery()]);
    expect(outcomes.sort()).toEqual([false, true]); expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await prisma.emailDelivery.findFirst()).toMatchObject({ status: 'ACCEPTED', attempts: 1, leaseToken: null, errorCode: null });
    expect(await processNextEmailDelivery()).toBe(false);
  });

  it('retains partial success and never automatically resends an uncertain delivery', async () => {
    const second = await prisma.user.create({ data: { email: 'owner2@example.test', firstName: 'Second', lastName: 'Owner', password: 'unused', role: 'ADMIN', locationId: data.location.id } });
    await enqueueDigestEmails(data.location.id, randomUUID(), [data.adminUser.email, second.email], 'Summary', '<p>Totals</p>');
    jest.mocked(sendEmail).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Connection lost after submission'));
    await processNextEmailDelivery(); await processNextEmailDelivery();
    expect(await prisma.emailDelivery.count({ where: { status: 'ACCEPTED' } })).toBe(1);
    expect(await prisma.emailDelivery.count({ where: { status: 'REVIEW', errorCode: 'DELIVERY_UNKNOWN' } })).toBe(1);
    expect(await processNextEmailDelivery()).toBe(false); expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('recovers an expired sending lease into review after a process restart', async () => {
    const [job] = await queue();
    await prisma.emailDelivery.update({ where: { id: job.id }, data: { status: 'SENDING', leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() - 1000), attempts: 1 } });
    expect((await recoverExpiredEmailDeliveries()).count).toBe(1);
    expect(await processNextEmailDelivery()).toBe(false); expect(sendEmail).not.toHaveBeenCalled();
    expect(await prisma.emailDelivery.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'REVIEW', errorCode: 'DELIVERY_UNKNOWN', leaseToken: null });
  });

  it('requires reviewed confirmation for uncertain retries and audits the owner decision', async () => {
    const [job] = await queue(); await prisma.emailDelivery.update({ where: { id: job.id }, data: { status: 'REVIEW' } });
    await expect(retryEmailDelivery(data.location.id, job.id, data.adminUser.id, 'Checked provider logs', false)).rejects.toMatchObject({ statusCode: 409 });
    await retryEmailDelivery(data.location.id, job.id, data.adminUser.id, 'Checked provider logs', true);
    expect(await prisma.activityLog.findFirst({ where: { action: 'EMAIL_DELIVERY_RETRY' } })).toMatchObject({ entityId: job.id, locationId: data.location.id, userId: data.adminUser.id });
    await expect(retryEmailDelivery(data.location.id, job.id, data.adminUser.id, 'Repeated request', true)).rejects.toMatchObject({ statusCode: 409 });
    await processNextEmailDelivery(); expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('keeps missing configuration and explicit rejection in failed state for an intentional retry', async () => {
    const [job] = await queue(); jest.mocked(sendEmail).mockRejectedValueOnce({ code: 'NOT_CONFIGURED' });
    await processNextEmailDelivery();
    expect(await prisma.emailDelivery.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'FAILED', errorCode: 'NOT_CONFIGURED' });
    await retryEmailDelivery(data.location.id, job.id, data.adminUser.id, 'Email provider configured', false);
    await processNextEmailDelivery();
    expect(await prisma.emailDelivery.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'ACCEPTED', attempts: 2 });
  });

  it('rechecks recipient authority and cancels queued emails when access is revoked', async () => {
    const [job] = await queue(); await prisma.user.update({ where: { id: data.adminUser.id }, data: { role: 'MANAGER' } });
    await processNextEmailDelivery(); expect(sendEmail).not.toHaveBeenCalled();
    expect(await prisma.emailDelivery.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'CANCELLED', errorCode: 'RECIPIENT_NO_LONGER_AUTHORIZED' });
  });

  it('keeps recipient history owner-only and omits message bodies and lease tokens', async () => {
    const [job] = await queue();
    const list = await request(app).get('/api/reports/daily-digest/deliveries').set('Authorization', 'Bearer ' + token).expect(200);
    expect(list.body.data).toHaveLength(1); expect(JSON.stringify(list.body)).not.toMatch(/Private store totals|leaseToken|idempotencyKey/);
    for (const role of ['CASHIER', 'MANAGER', 'SUPER_ADMIN'] as const) {
      const user = await prisma.user.create({ data: { email: role + '@example.test', firstName: role, lastName: 'User', password: 'unused', role, locationId: data.location.id } });
      const unauthorized = await createTestToken(user.id, role);
      await request(app).get('/api/reports/daily-digest/deliveries').set('Authorization', 'Bearer ' + unauthorized).expect(403);
    }
    await expect(retryEmailDelivery('other-store', job.id, data.adminUser.id, 'Foreign request', true)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('queues the owner API request idempotently and validates missing request identity', async () => {
    const post = (body: object) => request(app).post('/api/reports/daily-digest/send').set('Authorization', 'Bearer ' + token).send(body);
    await post({}).expect(400);
    const key = randomUUID(); await post({ idempotencyKey: key }).expect(200); await post({ idempotencyKey: key }).expect(200);
    expect(await prisma.emailDelivery.count()).toBe(1); expect(sendEmail).not.toHaveBeenCalled();
  });
});
