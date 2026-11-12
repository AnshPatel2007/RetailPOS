/**
 * Attention list and morning brief (upgrade plan, WP 2.3).
 *
 * Each rule fires on its own condition with a computed sentence, amount and
 * link; a clean store has nothing to show; the brief covers the last complete
 * store day, goes out once per store day, and never prints a number that the
 * records did not produce.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { collectAttention } from '../../services/attention.service';
import { collectBriefData, narrativeNumbersSupported, resetOwnerBriefSchedule, runOwnerBriefSchedule, sendOwnerBrief, templateNarrative } from '../../services/ownerBrief.service';

const mockProviderCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: class { messages = { create: (...args: unknown[]) => mockProviderCreate(...args) }; } }));
jest.mock('../../utils/email', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));

describe('Attention list and morning brief', () => {
  let data: TestData, owner: string;
  // 09:00 on Tuesday Nov 10 in the store (America/Chicago); "yesterday" is Monday Nov 9.
  const now = new Date('2026-11-10T15:00:00Z');
  const yesterdayAt = (hour: number) => new Date(Date.UTC(2026, 10, 9, hour + 6));
  const daysAgoAt = (days: number, hour = 12) => new Date(Date.UTC(2026, 10, 10 - days, hour + 6));
  const saved = { key: process.env.ANTHROPIC_API_KEY, hour: process.env.OWNER_BRIEF_HOUR, digestHour: process.env.DAILY_DIGEST_HOUR };
  const attention = async (role = 'ADMIN') => collectAttention(data.location.id, now, role);
  const keys = async (role = 'ADMIN') => (await attention(role)).items.map(item => item.key);
  const finding = async (key: string) => (await attention()).items.find(item => item.key === key);
  const sale = (createdAt: Date, line: { unitCost?: number | null; costAmount?: number | null; costStatus?: 'VERIFIED' | 'ESTIMATED' } = { unitCost: 4 }, total = 22) =>
    prisma.sale.create({ data: { saleNumber: randomUUID(), locationId: data.location.id, userId: data.adminUser.id, createdAt, total, subtotal: total - 2, tax: 2,
      amountPaid: total, paymentMethod: 'CASH', pricingVersion: line.unitCost === null && line.costAmount == null ? null : 1,
      items: { create: { productId: data.product.id, productName: 'Test Product', sku: data.product.sku, quantity: 2, price: (total - 2) / 2, tax: 2, total, ...line } } },
    include: { items: true } });

  beforeEach(async () => {
    delete process.env.ANTHROPIC_API_KEY; delete process.env.OWNER_BRIEF_HOUR; delete process.env.DAILY_DIGEST_HOUR;
    mockProviderCreate.mockReset(); resetOwnerBriefSchedule();
    data = await seedTestData();
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
  });
  afterAll(() => {
    for (const [name, value] of [['ANTHROPIC_API_KEY', saved.key], ['OWNER_BRIEF_HOUR', saved.hour], ['DAILY_DIGEST_HOUR', saved.digestHour]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });

  it('shows nothing on a clean store, with yesterday and bills-due figures', async () => {
    await sale(yesterdayAt(10));
    const result = await attention();
    expect(result).toMatchObject({ items: [], incomplete: false, timezone: 'America/Chicago',
      figures: { yesterday: { date: '2026-11-09', sales: 22, grossProfit: 12, grossMargin: 60, costBasis: 'HISTORICAL' }, billsDue: { count: 0, amount: 0, overdue: 0 } } });
  });

  it('names open stock exceptions and the oldest one', async () => {
    const other = await prisma.product.create({ data: { name: 'Blue Razz', sku: 'BLUE-RAZZ', price: 2.5, cost: 1.5, stockQuantity: -2, locationId: data.location.id } });
    await prisma.inventoryException.createMany({ data: [
      { productId: other.id, openProductId: other.id, locationId: data.location.id, lowestQuantity: -2, latestQuantity: -2, firstNegativeAt: daysAgoAt(9) },
      { productId: data.product.id, openProductId: data.product.id, locationId: data.location.id, status: 'RECOUNT_REQUESTED', lowestQuantity: -1, latestQuantity: -1, firstNegativeAt: daysAgoAt(2) },
      { productId: data.product.id, locationId: data.location.id, status: 'RESOLVED', lowestQuantity: -5, latestQuantity: 0, firstNegativeAt: daysAgoAt(30),
        resolution: 'MISCOUNT', resolvedAt: daysAgoAt(29) },
    ] });
    expect(await keys()).toEqual(['stock-exceptions']);
    expect(await finding('stock-exceptions')).toEqual({ key: 'stock-exceptions', severity: 'high', count: 2, href: '/inventory/stock-control/exceptions',
      sentence: '2 items sold more than recorded stock and are waiting for a count. The oldest is Blue Razz, since Nov 1.' });
  });

  it('says when yesterday\'s profit is not final or unavailable', async () => {
    const estimated = await sale(yesterdayAt(10), { unitCost: 1.5, costAmount: 4.5, costStatus: 'ESTIMATED' });
    await prisma.inventoryException.create({ data: { productId: data.product.id, openProductId: data.product.id, locationId: data.location.id,
      lowestQuantity: -1, latestQuantity: -1, firstNegativeAt: yesterdayAt(10), triggerSaleId: estimated.id } });
    expect(await keys()).toEqual(['stock-exceptions', 'profit-not-confirmed']);
    expect(await finding('profit-not-confirmed')).toMatchObject({ severity: 'medium', amount: 4.5, count: 1, href: '/inventory/stock-control/exceptions',
      sentence: 'Yesterday\'s profit is not final. Includes $4.50 of estimated cost for 1 stock exception. Resolve it in Stock Control to confirm profit.' });
    expect((await attention()).figures.yesterday).toMatchObject({ grossProfit: 15.5, costBasis: 'PROVISIONAL' });

    await prisma.inventoryException.deleteMany();
    await sale(yesterdayAt(11), { unitCost: null });
    expect(await finding('profit-not-confirmed')).toMatchObject({ count: 1, href: '/financial?tab=inventory&costTab=missing',
      sentence: 'Yesterday\'s profit is unavailable: 1 sale or stock record has no cost on record.' });
  });

  it('reports drawers that closed off by $5 or more in the last 24 hours', async () => {
    const close = (userId: string, cashDifference: number, clockOutAt: Date) => prisma.shift.create({ data: { userId, locationId: data.location.id,
      clockInAt: new Date(clockOutAt.getTime() - 8 * 3600000), clockOutAt, isClosed: true, startingCash: 100, endingCash: 100 + cashDifference, cashDifference } });
    await close(data.cashierUser.id, -12.5, daysAgoAt(1, 20));
    await close(data.adminUser.id, 3, daysAgoAt(1, 22));      // within $5: fine
    await close(data.adminUser.id, -40, daysAgoAt(2, 10));     // more than a day ago
    expect(await finding('drawer-difference')).toEqual({ key: 'drawer-difference', severity: 'medium', count: 1, amount: 12.5, href: '/team-time/shifts',
      sentence: 'Cashier\'s drawer closed $12.50 short in the last 24 hours.' });
    await close(data.adminUser.id, 25, daysAgoAt(0, 7));
    expect(await finding('drawer-difference')).toMatchObject({ severity: 'high', count: 2, amount: 37.5,
      sentence: '2 drawers closed with a difference in the last 24 hours: Admin $25.00 over, Cashier $12.50 short.' });
  });

  it('flags prices below cost and below the minimum margin', async () => {
    await prisma.product.create({ data: { name: 'Loss leader', sku: 'LOSS', price: 1, cost: 2, stockQuantity: 5, locationId: data.location.id } });
    expect(await finding('prices-below-target')).toEqual({ key: 'prices-below-target', severity: 'high', count: 1, href: '/inventory/purchasing/price-review',
      sentence: '1 item is priced below what it costs.' });
    expect(await keys()).toEqual(['prices-below-target']);
  });

  it('lists unpaid bills due this week, overdue first', async () => {
    const bill = (amount: number, dueDate: Date, status: 'PENDING' | 'APPROVED' | 'PAID') => prisma.expense.create({ data: { expenseNumber: randomUUID(),
      category: 'UTILITIES', description: 'Bill', amount, status, dueDate, locationId: data.location.id, userId: data.adminUser.id } });
    await bill(100, daysAgoAt(-3), 'PENDING');
    await bill(50, daysAgoAt(2), 'APPROVED');
    await bill(75, daysAgoAt(-1), 'PAID');     // already paid
    await bill(80, daysAgoAt(-10), 'PENDING'); // due later
    const result = await attention();
    expect(result.figures.billsDue).toEqual({ count: 2, amount: 150, overdue: 1 });
    expect(result.items).toEqual([{ key: 'bills-due', severity: 'high', count: 2, amount: 150, href: '/financial?tab=expenses',
      sentence: '2 unpaid bills totaling $150.00 are due by Nov 17; 1 is already overdue ($50.00).' }]);
  });

  it('flags purchase orders past their expected delivery', async () => {
    const order = (status: string, expectedAt: Date) => prisma.purchaseOrder.create({ data: { orderNumber: 'PO-' + randomUUID().slice(0, 8), supplierId: data.supplier.id,
      locationId: data.location.id, status, expectedAt } });
    const late = await order('ORDERED', daysAgoAt(5));
    await order('PARTIALLY_RECEIVED', daysAgoAt(-2)); await order('RECEIVED', daysAgoAt(9));
    expect(await finding('orders-overdue')).toEqual({ key: 'orders-overdue', severity: 'medium', count: 1, href: '/inventory/purchasing/orders',
      sentence: `The order from Test Supplier (${late.orderNumber}) was expected Nov 5 and has not been received.` });
  });

  it('flags a day with unusually many refunds and voids', async () => {
    for (let index = 0; index < 3; index++) {
      const original = await sale(yesterdayAt(9 + index));
      await prisma.refund.create({ data: { saleId: original.id, amount: 11, taxAmount: 1, pointsRestored: 0, method: 'CASH', reason: 'Return', refundedBy: data.adminUser.id,
        createdAt: yesterdayAt(15), items: { create: { saleItemId: original.items[0].id, quantity: 1, amount: 11, taxAmount: 1, costReturned: 4 } } } });
    }
    expect(await keys()).toEqual(['refunds-high']);
    expect(await finding('refunds-high')).toEqual({ key: 'refunds-high', severity: 'medium', count: 3, amount: 33, href: '/insights/reports/sales',
      sentence: 'Yesterday had 3 refunds and voids totaling $33.00; a usual day has fewer than 1.' });
  });

  it('lists stock added without a supplier invoice at its estimated cost', async () => {
    await prisma.product.update({ where: { id: data.product.id }, data: { stockQuantity: 0 } });
    const current = await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } });
    await request(app).post('/api/financial/inventory-costs/opening').set('Authorization', 'Bearer ' + owner).send({ idempotencyKey: randomUUID(),
      notes: 'Counted with the supplier invoice', items: [{ productId: data.product.id, quantity: 10, value: 15, expectedVersion: current.stockVersion }] }).expect(200);
    await request(app).post(`/api/products/${data.product.id}/adjust-inventory`).set('Authorization', 'Bearer ' + owner).send({ quantity: 3, type: 'MISSING_RECEIPT' }).expect(200);
    expect(await finding('deliveries-without-invoice')).toEqual({ key: 'deliveries-without-invoice', severity: 'low', count: 1, amount: 4.5,
      href: '/inventory/stock-control/exceptions?view=unmatched',
      sentence: '1 stock addition has no supplier invoice yet ($4.50 at estimated cost). Match it to confirm the cost.' });
  });

  it('shows failed emails and exports to the owner only', async () => {
    await prisma.backgroundJob.create({ data: { idempotencyKey: randomUUID(), kind: 'EMAIL', status: 'REVIEW', locationId: data.location.id, label: 'Receipt', payload: 'x' } });
    await prisma.backgroundJob.create({ data: { idempotencyKey: randomUUID(), kind: 'EMAIL', status: 'FAILED', locationId: 'another-store', label: 'Receipt', payload: 'x' } });
    expect(await finding('job-failures')).toEqual({ key: 'job-failures', severity: 'medium', count: 1, href: '/settings/jobs', roles: ['ADMIN', 'SUPER_ADMIN'],
      sentence: '1 email or export did not go through this week and needs a look.' });
    expect(await keys('MANAGER')).toEqual([]);
  });

  it('notices a sales day far from the recent pattern', async () => {
    await prisma.sale.createMany({ data: Array.from({ length: 40 }, (_, index) => ({ saleNumber: randomUUID(), locationId: data.location.id, userId: data.adminUser.id,
      createdAt: daysAgoAt(index + 2), total: 22, subtotal: 20, tax: 2, amountPaid: 22, paymentMethod: 'CASH' as const, pricingVersion: 1 })) });
    await sale(yesterdayAt(12), { unitCost: 4 }, 220);
    expect(await finding('unusual-sales-day')).toEqual({ key: 'unusual-sales-day', severity: 'low', amount: 220, href: '/insights/reports/overview',
      sentence: 'Yesterday\'s sales of $220.00 were well above the usual $22.00 for recent days.' });
  });

  it('orders findings by severity and serves them to owners and managers of this store only', async () => {
    await prisma.product.create({ data: { name: 'Loss leader', sku: 'LOSS', price: 1, cost: 2, stockQuantity: 5, locationId: data.location.id } });
    await prisma.purchaseOrder.create({ data: { orderNumber: 'PO-LATE', supplierId: data.supplier.id, locationId: data.location.id, status: 'ORDERED', expectedAt: daysAgoAt(5) } });
    await prisma.backgroundJob.create({ data: { idempotencyKey: randomUUID(), kind: 'EMAIL', status: 'FAILED', locationId: data.location.id, label: 'Receipt', payload: 'x' } });
    const body = (await request(app).get('/api/reports/attention').set('Authorization', 'Bearer ' + owner).expect(200)).body.data;
    expect(body.items.map((item: { key: string }) => item.key)).toEqual(['prices-below-target', 'orders-overdue', 'job-failures']);
    const manager = await prisma.user.create({ data: { email: 'manager@test.com', password: 'unused', firstName: 'Manager', lastName: 'User', role: 'MANAGER', locationId: data.location.id } });
    const managerToken = await createTestToken(manager.id, 'MANAGER');
    const managerView = (await request(app).get('/api/reports/attention').set('Authorization', 'Bearer ' + managerToken).expect(200)).body.data;
    expect(managerView.items.map((item: { key: string }) => item.key)).toEqual(['prices-below-target', 'orders-overdue']);
    await request(app).get('/api/reports/attention').set('Authorization', 'Bearer ' + await createTestToken(data.cashierUser.id, 'CASHIER')).expect(403);
    const other = await prisma.location.create({ data: { id: 'test-location-2', name: 'Second Store', address: '2 Test St', city: 'Test', state: 'TS', zipCode: '12345', phone: '555-0102', email: 'second@store.com' } });
    await request(app).get('/api/reports/attention?locationId=' + other.id).set('Authorization', 'Bearer ' + owner).expect(403);
  });

  it('accepts only numbers that the records produced', () => {
    const data = { revenue: 1234.5, revenueChangePct: 12.34, grossMargin: 31.25, transactions: 87, date: 'Monday, November 9, 2026', day: '2026-11-09', asOf: '2026-11-10T15:00:00.000Z',
      attention: [{ sentence: '2 items sold more than recorded stock. The oldest is Cola 12-pack, since Nov 1.' }] };
    expect(narrativeNumbersSupported('Monday, November 9, 2026: sales were $1,234.50 across 87 sales, up 12.3% (12%).', data)).toBe(true);
    expect(narrativeNumbersSupported('Margin held at 31.25%. Count the Cola 12-pack: 2 items since Nov 1.', data)).toBe(true);
    expect(narrativeNumbersSupported('Sales were $1,234.50, about $14 per sale.', data)).toBe(false);      // worked out, not recorded
    expect(narrativeNumbersSupported('Expect around $1,300 tomorrow.', data)).toBe(false);
    expect(narrativeNumbersSupported('A quiet day with no surprises.', data)).toBe(true);
    expect(narrativeNumbersSupported('About $15 an hour.', data)).toBe(false); // 15 appears only inside a timestamp
  });

  it('writes the brief for the whole of yesterday and falls back to the template when the summary invents a number', async () => {
    await sale(yesterdayAt(10)); await sale(daysAgoAt(8, 10), { unitCost: 4 }, 44); await sale(daysAgoAt(0, 1));
    const brief = await collectBriefData(data.location.id, now);
    expect(brief).toMatchObject({ day: '2026-11-09', weekday: 'Monday', revenue: 22, transactions: 1, lastWeekRevenue: 44, revenueChange: -22, revenueChangePct: -50,
      grossProfit: 12, grossMargin: 60, profitBasis: 'HISTORICAL', profitNote: null, attention: [], attentionTotal: 0 });
    expect(templateNarrative(brief)).toBe('On Monday the store took in $22.00 after refunds across 1 sale, down 50% on the Monday before. '
      + 'Gross profit was $12.00 (60% of sales before tax). Top seller: Test Product (2 units, $22.00). Nothing needs attention today.');

    process.env.ANTHROPIC_API_KEY = 'mock-key';
    mockProviderCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Monday brought in $22.00, half of the Monday before, with an average sale of $11.' }] });
    const invented = await sendOwnerBrief(data.location.id, 'invented', now);
    expect(invented).toMatchObject({ ai: false, narrative: templateNarrative(brief) });
    mockProviderCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Monday brought in $22.00, down 50% on the Monday before, with $12.00 gross profit.' }] });
    const written = await sendOwnerBrief(data.location.id, 'written', now);
    expect(written).toMatchObject({ ai: true, narrative: 'Monday brought in $22.00, down 50% on the Monday before, with $12.00 gross profit.' });
    const email = await prisma.emailDelivery.findFirstOrThrow({ where: { idempotencyKey: { startsWith: 'brief:' + data.location.id + ':written:' } } });
    expect(email.subject).toBe('Test Store morning brief: $22.00 | Monday, November 9, 2026');
    expect(email.html).toContain('Needs attention today'); expect(email.html).toContain('Nothing needs attention right now.');
  });

  it('sends one brief per store day from 7:00 store time, unless the owner turned it off', async () => {
    await sale(yesterdayAt(10));
    const at = (localHour: number) => new Date(Date.UTC(2026, 10, 10, localHour + 6));
    expect(await runOwnerBriefSchedule(at(6))).toBe(0);                 // before 7:00
    expect(await runOwnerBriefSchedule(at(8))).toBe(1);                 // a server that was down at 7:00 still sends it
    expect(await runOwnerBriefSchedule(at(9))).toBe(0);                 // same day: not again
    resetOwnerBriefSchedule();                                          // a restart forgets, the database does not
    expect(await runOwnerBriefSchedule(at(10))).toBe(0);
    expect(await prisma.emailDelivery.count({ where: { idempotencyKey: { startsWith: 'brief:' + data.location.id + ':2026-11-10:' } } })).toBe(1);
    expect(await runOwnerBriefSchedule(new Date(Date.UTC(2026, 10, 11, 18)))).toBe(0); // the next day, after noon: too late

    await prisma.location.update({ where: { id: data.location.id }, data: { settings: { notificationSettings: {
      lowStockAlerts: true, endOfDayReports: false, emailNotifications: false, notificationEmail: '' } } } });
    resetOwnerBriefSchedule();
    expect(await runOwnerBriefSchedule(new Date(Date.UTC(2026, 10, 12, 14)))).toBe(0);

    process.env.OWNER_BRIEF_HOUR = '5';
    await prisma.location.update({ where: { id: data.location.id }, data: { settings: {} } });
    resetOwnerBriefSchedule();
    expect(await runOwnerBriefSchedule(new Date(Date.UTC(2026, 10, 12, 11)))).toBe(1); // 05:00 store time
  });
});
