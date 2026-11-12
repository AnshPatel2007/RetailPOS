import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { runAnalyticsTool } from '../../services/analyticsTools.service';
import { collectBriefData, resolveBriefRecipients, sendOwnerBrief } from '../../services/ownerBrief.service';
import { sendEmail } from '../../utils/email';

jest.mock('../../utils/email', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));
const mockProviderCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: class { messages = { create: (...args: unknown[]) => mockProviderCreate(...args) }; } }));

describe('AI tools and daily summaries keep store boundaries', () => {
  let data: TestData, partnerId: string, token: string;
  const now = new Date('2026-11-01T18:00:00Z');
  // The morning brief covers the last complete store day: read it the next morning.
  const nextMorning = new Date('2026-11-02T14:00:00Z');
  const tomorrow = () => new Date(Date.now() + 86400000);
  const input = { startDate: '2026-11-01' };
  const savedEmails = process.env.DAILY_DIGEST_EMAILS, savedBriefEmails = process.env.OWNER_BRIEF_EMAILS, savedKey = process.env.ANTHROPIC_API_KEY;
  beforeEach(async () => {
    delete process.env.DAILY_DIGEST_EMAILS; delete process.env.OWNER_BRIEF_EMAILS; delete process.env.ANTHROPIC_API_KEY;
    data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
    partnerId = (await prisma.location.create({ data: { name: 'Partner', address: 'Other', city: 'Other', state: 'TS', zipCode: '12345', phone: '5550000000', email: 'partner@example.test' } })).id;
    jest.mocked(sendEmail).mockClear();
    mockProviderCreate.mockReset();
  });
  afterAll(() => {
    if (savedEmails === undefined) delete process.env.DAILY_DIGEST_EMAILS; else process.env.DAILY_DIGEST_EMAILS = savedEmails;
    if (savedBriefEmails === undefined) delete process.env.OWNER_BRIEF_EMAILS; else process.env.OWNER_BRIEF_EMAILS = savedBriefEmails;
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
  });
  const sale = (locationId: string | null = data.location.id, createdAt = now) => prisma.sale.create({ data: {
    saleNumber: randomUUID(), locationId, userId: data.adminUser.id, createdAt, total: 22, subtotal: 20, tax: 2, amountPaid: 22, paymentMethod: 'CASH', pricingVersion: 1,
    items: { create: { productId: data.product.id, productName: 'Original item', sku: data.product.sku, quantity: 2, price: 10, total: 22, tax: 2, unitCost: 4 } },
  }, include: { items: true } });
  const refund = (original: Awaited<ReturnType<typeof sale>>) => prisma.refund.create({ data: {
    saleId: original.id, amount: 11, taxAmount: 1, pointsRestored: 0, method: 'CASH', reason: 'One unit', refundedBy: data.adminUser.id, createdAt: now,
    items: { create: { saleItemId: original.items[0].id, quantity: 1, amount: 11, taxAmount: 1, costReturned: 4 } },
  } });

  it('excludes partner and unassigned sales and refunds from AI and morning brief totals', async () => {
    await sale(); await refund(await sale(data.location.id, new Date('2026-10-01T12:00:00Z')));
    await refund(await sale(partnerId)); await refund(await sale(null));
    const metrics = await runAnalyticsTool('get_sales_summary', { ...input, locationId: partnerId }, data.location.id);
    expect(metrics).toMatchObject({ locationId: data.location.id, grossCollected: 22, netCollected: 11, netSales: 10, netTax: 1, transactions: 1, refunds: 11, refundCount: 1 });
    const digest = await collectBriefData(data.location.id, nextMorning);
    expect(digest).toMatchObject({ revenue: 11, transactions: 1, refundAmount: 11, refundCount: 1, timezone: 'America/Chicago', day: '2026-11-01', weekday: 'Sunday' });
    expect(digest.topProducts).toEqual([{ name: 'Original item', units: 1, revenue: 11 }]);
    const products = await runAnalyticsTool('get_top_products', input, data.location.id);
    expect(products).toMatchObject({ products: [{ quantitySold: 1, revenue: 11 }] });
    expect(await runAnalyticsTool('get_tender_breakdown', input, data.location.id)).toMatchObject({ paymentLabels: [{ method: 'CASH', netCollected: 11 }] });
    expect(await runAnalyticsTool('get_employee_sales', input, data.location.id)).toMatchObject({ employees: [{ transactions: 1, netCollected: 11 }] });
    expect(JSON.stringify(metrics)).not.toMatch(/hourlyRate|password|grossPay/);
  });

  it('includes out-of-stock at zero threshold and excludes other stores, MISC and untracked stock', async () => {
    await prisma.product.createMany({ data: [
      { name: 'Own zero', sku: 'ZERO', locationId: data.location.id, price: 1, stockQuantity: 0, lowStockAlert: 0 },
      { name: 'Partner secret', sku: 'PARTNER', locationId: partnerId, price: 1, stockQuantity: 0 },
      { name: 'Unassigned', sku: 'UNASSIGNED', price: 1, stockQuantity: 0 },
      { name: 'MISC', sku: 'MISC-001', locationId: data.location.id, price: 1, stockQuantity: 0 },
      { name: 'Untracked', sku: 'UNTRACKED', locationId: data.location.id, price: 1, stockQuantity: 0, trackInventory: false },
    ] });
    const result = await runAnalyticsTool('get_inventory_alerts', {}, data.location.id);
    expect(result).toMatchObject({ activeTrackedProducts: 2, lowStock: [{ name: 'Own zero', stock: 0 }] });
    expect((await collectBriefData(data.location.id, nextMorning)).lowStock).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/Partner secret|Unassigned|MISC|Untracked/);
  });

  it('subtracts an older sale voided today in both AI metrics and the next morning brief', async () => {
    await sale(data.location.id, new Date());
    const original = await sale(data.location.id, new Date('2025-01-01T12:00:00Z'));
    await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, startingCash: 100, clockInAt: new Date() } });
    await request(app).post('/api/sales/' + original.id + '/void').set('Authorization', 'Bearer ' + token)
      .send({ reason: 'Duplicate record', idempotencyKey: randomUUID() }).expect(200);
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    expect(await runAnalyticsTool('get_sales_summary', { startDate: date }, data.location.id)).toMatchObject({ netCollected: 0, transactions: 1, voids: 22, voidCount: 1 });
    expect(await collectBriefData(data.location.id, tomorrow())).toMatchObject({ revenue: 0, transactions: 1, voidAmount: 22, voidCount: 1 });
  });

  it('keeps model tool calls scoped and refuses a foreign-store chat request before calling the provider', async () => {
    process.env.ANTHROPIC_API_KEY = 'isolated-mock-key';
    await sale(); await sale(partnerId);
    mockProviderCreate.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'read-summary', name: 'get_sales_summary', input: { ...input, locationId: partnerId } }] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'The store collected $22.' }] });
    await request(app).post('/api/analytics/chat').set('Authorization', 'Bearer ' + token).send({ question: 'Show sales' }).expect(200);
    const second = mockProviderCreate.mock.calls[1][0];
    const result = second.messages[second.messages.length - 1].content[0];
    expect(JSON.parse(result.content)).toMatchObject({ locationId: data.location.id, grossCollected: 22 });
    expect(second.system).toContain('America/Chicago');
    mockProviderCreate.mockClear();
    await request(app).post('/api/analytics/chat?locationId=' + partnerId).set('Authorization', 'Bearer ' + token).send({ question: 'Show sales' }).expect(403);
    expect(mockProviderCreate).not.toHaveBeenCalled();
  });

  it('uses store midnight, keeps repeated DST hours distinct and compares the whole day with the same weekday a week earlier', async () => {
    for (const at of ['2026-11-01T04:59:59Z', '2026-11-01T06:30:00Z', '2026-11-01T07:30:00Z', '2026-11-01T18:00:01Z', '2026-10-25T08:00:00Z', '2026-10-25T23:00:00Z']) await sale(data.location.id, new Date(at));
    const hourly = await runAnalyticsTool('get_hourly_sales', { date: '2026-11-01' }, data.location.id) as { hours: { timestamp: string }[] };
    expect(hourly.hours.map(row => row.timestamp)).toEqual(['2026-11-01T06:00:00.000Z', '2026-11-01T07:00:00.000Z', '2026-11-01T18:00:00.000Z']);
    // Sunday Nov 1 (25 hours long) holds three sales; the Sunday before holds two; the sale just before midnight belongs to Saturday.
    expect(await collectBriefData(data.location.id, nextMorning)).toMatchObject({ day: '2026-11-01', revenue: 66, lastWeekRevenue: 44, revenueChange: 22, revenueChangePct: 50 });
  });

  it('fails closed for missing stores and rejects invalid, unbounded or model-supplied tool requests', async () => {
    for (const name of ['get_sales_summary', 'get_inventory_alerts']) await expect(runAnalyticsTool(name, input, null)).rejects.toMatchObject({ statusCode: 403 });
    await expect(collectBriefData('', now)).rejects.toMatchObject({ statusCode: 403 });
    for (const args of [{ startDate: '2026-02-30' }, { startDate: '2026-01-01', endDate: '2025-01-01' }, { startDate: '2020-01-01', endDate: '2026-01-01' }, { ...input, limit: -1 }, { ...input, limit: 1000 }]) {
      await expect(runAnalyticsTool('get_top_products', args, data.location.id)).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(runAnalyticsTool('run_sql', {}, data.location.id)).rejects.toMatchObject({ statusCode: 400 });
    await prisma.location.update({ where: { id: data.location.id }, data: { isActive: false } });
    await expect(collectBriefData(data.location.id, now)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('resolves only active owners of this store, even with a global recipient override', async () => {
    for (const [role, locationId, isActive, email] of [
      ['ADMIN', partnerId, true, 'partner@example.test'], ['SUPER_ADMIN', data.location.id, true, 'platform@example.test'],
      ['ADMIN', data.location.id, false, 'inactive@example.test'], ['MANAGER', data.location.id, true, 'manager@example.test'],
    ] as const) await prisma.user.create({ data: { email, password: 'unused', firstName: 'Other', lastName: 'User', role, locationId, isActive } });
    expect(await resolveBriefRecipients(data.location.id)).toEqual([data.adminUser.email]);
    process.env.DAILY_DIGEST_EMAILS = 'partner@example.test, outsider@example.test, ' + data.adminUser.email;
    expect(await resolveBriefRecipients(data.location.id)).toEqual([data.adminUser.email]);
    process.env.DAILY_DIGEST_EMAILS = 'outsider@example.test';
    expect(await resolveBriefRecipients(data.location.id)).toEqual([]);
    // The newer setting name takes precedence over the older one.
    process.env.OWNER_BRIEF_EMAILS = data.adminUser.email;
    expect(await resolveBriefRecipients(data.location.id)).toEqual([data.adminUser.email]);
  });

  it('queues only a scoped brief without calling the provider and blocks cross-store and cashier requests', async () => {
    await sale(data.location.id, new Date()); await sale(partnerId, new Date());
    const result = await sendOwnerBrief(data.location.id, randomUUID(), tomorrow());
    expect(result.data.revenue).toBe(22);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]).toMatchObject({ recipientEmail: data.adminUser.email, status: 'QUEUED' });
    jest.mocked(sendEmail).mockClear();
    await request(app).post('/api/reports/daily-digest/send?locationId=' + partnerId).set('Authorization', 'Bearer ' + token).expect(403);
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await request(app).post('/api/reports/daily-digest/send').set('Authorization', 'Bearer ' + cashier).expect(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
