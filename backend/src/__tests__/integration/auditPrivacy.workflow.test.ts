import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Activity log scope, privacy and date boundaries', () => {
  let data: TestData, owner: string, manager: string, platform: string, partnerId: string;
  beforeEach(async () => {
    data = await seedTestData(); owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
    for (const role of ['MANAGER', 'SUPER_ADMIN'] as const) {
      const user = await prisma.user.create({ data: { firstName: role, lastName: 'Fixture', email: role + '@example.test', password: 'unused', role, locationId: data.location.id } });
      const token = await createTestToken(user.id, role); if (role === 'MANAGER') manager = token; else platform = token;
    }
    partnerId = (await prisma.location.create({ data: { name: 'Partner', address: 'Other', city: 'Other', state: 'TS', zipCode: '12345', phone: '555', email: 'partner@example.test' } })).id;
    await prisma.activityLog.createMany({ data: [
      { action: 'HOURLY_RATE_UPDATED', entity: 'User', locationId: data.location.id, details: { previous: 17, hourlyRate: 23 } },
      { action: 'EMAIL_DELIVERY_RETRY', entity: 'EmailDelivery', locationId: data.location.id, details: { reason: 'Owner private review' } },
      { action: 'UPDATE', entity: 'USER', entityId: 'GENERIC-UPDATE', locationId: data.location.id, details: { shipping: 'Standard', hourlyRate: 23, nested: [{ grossPay: 987, password: 'secret-credential', token: 'secret-token', permitted: 'Visible' }] } },
      { action: 'UPDATE', entity: 'Expense', locationId: data.location.id, details: { category: 'PAYROLL', description: 'Employee wages', amount: 987 } },
      { action: 'PLATFORM_EVENT', locationId: null, details: { apiKey: 'secret-key' } },
      { action: 'PARTNER_EVENT', entity: 'PARTNER_ENTITY', locationId: partnerId },
    ] });
  });
  const get = (token: string, path = '') => request(app).get('/api/audit-logs' + path).set('Authorization', 'Bearer ' + token);

  it('keeps own wage events visible to owners while redacting credentials at any nesting level', async () => {
    const result = (await get(owner).expect(200)).body;
    expect(result.pagination.total).toBe(4); expect(result.data.find((row: { action: string }) => row.action === 'HOURLY_RATE_UPDATED').details.hourlyRate).toBe(23);
    expect(JSON.stringify(result)).not.toMatch(/secret-credential|secret-token|PARTNER_EVENT|PLATFORM_EVENT/);
    const generic = result.data.find((row: { entityId: string }) => row.entityId === 'GENERIC-UPDATE');
    expect(generic.details).toMatchObject({ shipping: 'Standard', hourlyRate: 23, nested: [{ grossPay: 987, password: '[Redacted]', permitted: 'Visible' }] });
  });

  it('blocks wage and owner-delivery events for managers and platform admins, including direct filters', async () => {
    for (const token of [manager, platform]) {
      const path = '?locationId=' + data.location.id;
      const result = (await get(token, path).expect(200)).body;
      expect(result.pagination.total).toBe(2);
      expect(JSON.stringify(result)).not.toMatch(/HOURLY_RATE_UPDATED|EMAIL_DELIVERY_RETRY|987|Owner private review/);
      const generic = result.data.find((row: { entityId: string }) => row.entityId === 'GENERIC-UPDATE');
      expect(generic.details.hourlyRate).toBeUndefined(); expect(generic.details.nested[0].grossPay).toBeUndefined();
      expect(generic.details.nested[0]).toMatchObject({ password: '[Redacted]', permitted: 'Visible' });
      expect((await get(token, path + '&action=HOURLY_RATE_UPDATED').expect(200)).body.data).toEqual([]);
      expect((await get(token, '/actions' + path).expect(200)).body.data).toEqual(['UPDATE']);
      expect((await get(token, '/entities' + path).expect(200)).body.data.sort()).toEqual(['Expense', 'USER']);
    }
  });

  it('uses identical store scope for rows, counts and filter choices and preserves platform events', async () => {
    for (const suffix of ['', '/actions', '/entities']) {
      await get(owner, suffix + '?locationId=' + partnerId).expect(403);
      const scoped = (await get(platform, suffix + '?locationId=' + partnerId).expect(200)).body.data;
      expect(JSON.stringify(scoped)).toContain('PARTNER'); expect(JSON.stringify(scoped)).not.toContain('GENERIC-UPDATE');
    }
    const all = (await get(platform).expect(200)).body.data;
    expect(all.some((row: { action: string }) => row.action === 'PLATFORM_EVENT')).toBe(true);
    expect(JSON.stringify(all)).not.toContain('secret-key');
  });

  it('uses the 25-hour store day and stable pages for the matching period', async () => {
    const times = ['2026-11-01T04:59:59Z', '2026-11-01T05:00:00Z', '2026-11-01T06:30:00Z', '2026-11-01T07:30:00Z', '2026-11-02T05:59:59Z', '2026-11-02T06:00:00Z'];
    await prisma.activityLog.createMany({ data: times.map(time => ({ action: 'DATE_TEST', locationId: data.location.id, createdAt: new Date(time) })) });
    const query = '?action=DATE_TEST&startDate=2026-11-01&endDate=2026-11-01&limit=2';
    const first = (await get(owner, query).expect(200)).body, second = (await get(owner, query + '&page=2').expect(200)).body;
    expect(first.pagination).toMatchObject({ total: 4, totalPages: 2 }); expect(first.timezone).toBe('America/Chicago');
    expect(new Set([...first.data, ...second.data].map(row => row.id)).size).toBe(4);
  });

  it('rejects invalid pagination, dates and cashier access', async () => {
    for (const query of ['page=0', 'limit=201', 'page=abc', 'startDate=2026-02-30', 'startDate=2026-11-02&endDate=2026-11-01']) await get(owner, '?' + query).expect(400);
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    for (const path of ['', '/actions', '/entities']) await get(cashier, path).expect(403);
  });
});
