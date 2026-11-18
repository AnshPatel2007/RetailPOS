/**
 * Money Ahead (upgrade plan, WP 8.4): the next 14 store days of money in and out,
 * from one store's records and the owner's planned items; owners only; the alert
 * that a day looks tight.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { loadCashPlan } from '../../services/cashPlan.service';
import { collectAttention } from '../../services/attention.service';
import { payrollPeriod } from '../../services/payroll.service';

describe('Money Ahead', () => {
  let data: TestData, owner: string;
  const zone = 'America/Chicago';
  // Monday, November 16, 2026, 10:00 in the store (UTC-6).
  const now = new Date('2026-11-16T16:00:00Z');
  /** Noon (or 1 PM in daylight time) in the store on a calendar day. */
  const at = (day: string) => new Date(day + 'T18:00:00Z');
  const midnight = (day: string) => new Date(day + 'T06:00:00Z');
  const daysBefore = (count: number) => Array.from({ length: count }, (_, index) => new Date(Date.UTC(2026, 10, 15 - index)).toISOString().slice(0, 10));

  const sell = (day: string, method: 'CASH' | 'CARD', amount: number) => prisma.sale.create({ data: {
    saleNumber: 'S-' + randomUUID().slice(0, 12), locationId: data.location.id, userId: data.adminUser.id, createdAt: at(day), status: 'COMPLETED',
    paymentMethod: method, subtotal: amount, total: amount, amountPaid: amount, payments: { create: { paymentMethod: method, amount } } } });
  const bill = (description: string, amount: number, dueDate: Date | null, status: 'PENDING' | 'PAID' = 'PENDING', locationId = data.location.id) =>
    prisma.expense.create({ data: { expenseNumber: 'EXP-' + randomUUID().slice(0, 8), category: 'RENT', description, amount, dueDate, status, locationId, userId: data.adminUser.id } });
  const deliveries = async (name: string, deliveryDays: number[], received: [string, number][]) => {
    const supplier = await prisma.supplier.create({ data: { name, locationId: data.location.id, deliveryDays } });
    const order = await prisma.purchaseOrder.create({ data: { orderNumber: 'PO-' + randomUUID().slice(0, 8), supplierId: supplier.id, locationId: data.location.id, status: 'RECEIVED',
      items: { create: { productId: data.product.id, sku: data.product.sku, productName: 'Test Product', quantity: 1000, cost: 1, total: 1000 } } }, include: { items: true } });
    for (const [day, value] of received) await prisma.purchaseReceipt.create({ data: { purchaseOrderId: order.id, idempotencyKey: randomUUID(), requestHash: 'test',
      receivedBy: data.adminUser.id, createdAt: at(day), items: { create: { purchaseOrderItemId: order.items[0].id, acceptedQty: 10, inventoryValue: value } } } });
    return supplier;
  };

  beforeEach(async () => {
    data = await seedTestData();
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: zone } });
  });

  const seedStore = async () => {
    // Six weeks of the same takings every day: $100 cash and $100 by card.
    for (const day of daysBefore(42)) { await sell(day, 'CASH', 100); await sell(day, 'CARD', 100); }
    await bill('Rent', 1950, midnight('2026-11-19'));
    await bill('Ice machine repair', 300, midnight('2026-11-10'));
    await bill('Sign paint', 120, null);
    await bill('Already paid', 999, midnight('2026-11-18'), 'PAID');
    const elsewhere = await prisma.location.create({ data: { name: 'Other Store', address: '2 Road', city: 'City', state: 'TX', zipCode: '75001', phone: '555', email: 'other@test.com' } });
    await bill('Their rent', 5000, midnight('2026-11-19'), 'PENDING', elsewhere.id);
    await prisma.recurringExpense.create({ data: { description: 'Cleaning', category: 'MAINTENANCE', amount: 80, frequency: 'WEEKLY', startDate: new Date('2026-11-04T00:00:00Z'),
      nextDueDate: new Date('2026-11-18T00:00:00Z'), locationId: data.location.id, userId: data.adminUser.id } });
    // Budweiser delivers Thursdays (set on the supplier); Coke's Tuesdays are learned from its deliveries.
    const budweiser = await deliveries('Budweiser', [4], [['2026-10-22', 2000], ['2026-10-29', 2100], ['2026-11-05', 2200], ['2026-11-12', 2400]]);
    await deliveries('Coke', [], [['2026-10-27', 500], ['2026-11-03', 600], ['2026-11-10', 700]]);
    // Next week's Budweiser delivery is already ordered: its own amount replaces the usual one.
    await prisma.purchaseOrder.create({ data: { orderNumber: 'PO-NEXT-THU', supplierId: budweiser.id, locationId: data.location.id, status: 'ORDERED', expectedAt: at('2026-11-26'),
      items: { create: { productId: data.product.id, sku: data.product.sku, productName: 'Test Product', quantity: 100, cost: 18, total: 1800 } } } });
    // Three finished weeks of wages, already billed and paid.
    const paidWages = await prisma.expense.create({ data: { expenseNumber: 'EXP-WAGES', category: 'PAYROLL', description: 'Gross wages', amount: 5550, status: 'PAID', locationId: data.location.id, userId: data.adminUser.id } });
    for (const [day, gross] of [['2026-10-28', 1800], ['2026-11-04', 1850], ['2026-11-11', 1900]] as [string, number][]) {
      const period = payrollPeriod(at(day), 'WEEKLY', zone);
      const shift = await prisma.shift.create({ data: { userId: data.cashierUser.id, locationId: data.location.id, clockInAt: at(day), clockOutAt: at(day), isClosed: true } });
      await prisma.payrollEntry.create({ data: { shiftId: shift.id, userId: data.cashierUser.id, locationId: data.location.id, periodStart: period.start, periodEnd: period.end,
        seconds: 3600, hourlyRate: 20, grossPay: gross, expenseId: paidWages.id } });
    }
    await prisma.cashPlanItem.create({ data: { locationId: data.location.id, label: 'Owner draw', direction: 'OUT', amount: 500, repeat: 'MONTHLY', dayOfMonth: 20, createdById: data.adminUser.id } });
    await prisma.cashPlanSetting.create({ data: { locationId: data.location.id, cardDepositDays: 2, startingMoney: 1000, startingMoneyDate: '2026-11-16' } });
  };

  it('plans the next 14 days from the store\'s records and finds the day that runs short', async () => {
    await seedStore();
    const { plan, notes, tightSentence } = await loadCashPlan(data.location.id, now);
    expect(plan.today).toBe('2026-11-16');
    expect(plan.learning).toBe(false);
    const day = (date: string) => plan.days.find(entry => entry.date === date)!;
    const kinds = (date: string) => day(date).entries.map(entry => [entry.kind, entry.label, entry.amount, entry.estimate]);
    // Today: cash sales, Thursday's card sales, and the overdue repair bill. The paid bill and the other store's rent are not here.
    expect(kinds('2026-11-16')).toEqual([['CARD_DEPOSIT', 'Card deposit', 100, true], ['CASH_SALES', 'Cash sales', 100, true], ['BILL', 'Ice machine repair', 300, false]]);
    expect(day('2026-11-16').entries.find(entry => entry.kind === 'BILL')).toMatchObject({ dueDate: '2026-11-10' });
    // Tuesday: the weekend's card sales, and Coke on the day it usually delivers.
    expect(kinds('2026-11-17')).toEqual([['CARD_DEPOSIT', 'Card deposit', 300, true], ['CASH_SALES', 'Cash sales', 100, true], ['DELIVERY', 'Coke delivery', 600, true]]);
    expect(kinds('2026-11-18').filter(([kind]) => kind === 'RECURRING')).toEqual([['RECURRING', 'Cleaning', 80, false]]);
    // Thursday: rent, and about Budweiser's usual delivery (the middle of its last four).
    expect(day('2026-11-19')).toMatchObject({ in: 200, out: 4100, balance: -3080 });
    expect(kinds('2026-11-20').filter(([kind]) => kind === 'PLANNED')).toEqual([['PLANNED', 'Owner draw', 500, false]]);
    expect(kinds('2026-11-23').filter(([kind]) => kind === 'PAYROLL')).toEqual([['PAYROLL', 'Payroll', 1850, true]]);
    expect(day('2026-11-26').entries.find(entry => entry.kind === 'DELIVERY')).toMatchObject({ label: 'Budweiser delivery', amount: 1800, estimate: false, note: 'Order PO-NEXT-THU' });
    expect(plan.totals).toEqual({ in: 2800, out: 9910, lowest: { date: '2026-11-26', balance: -6510 } });
    expect(plan.days.map(entry => entry.balance)).toEqual([900, 700, 820, -3080, -3380, -3280, -3180, -4830, -5030, -4910, -6510, -6310, -6210, -6110]);
    expect(tightSentence).toBe('Thursday looks tight: about $4,100 goes out (Budweiser delivery about $2,150 and Rent $1,950) and about $200 comes in, so the business would be about $3,080 short.');
    expect(notes).toEqual(['1 unpaid bill has no due date and is not in the plan. Add a due date in Finances > Expenses.']);

    // The alert: for owners only.
    const forOwner = await collectAttention(data.location.id, now, 'ADMIN');
    expect(forOwner.items.find(item => item.key === 'cash-tight')).toEqual({ key: 'cash-tight', severity: 'high', href: '/financial?tab=ahead', roles: ['ADMIN'], sentence: tightSentence });
    expect((await collectAttention(data.location.id, now, 'MANAGER')).items.some(item => item.key === 'cash-tight')).toBe(false);
  });

  it('without money today, a day is tight only when far more goes out than comes in; never while learning', async () => {
    await seedStore();
    await prisma.cashPlanSetting.update({ where: { locationId: data.location.id }, data: { startingMoneyDate: '2026-11-15' } });
    const yesterdayMoney = await loadCashPlan(data.location.id, now);
    // Money entered yesterday no longer counts as this morning's.
    expect(yesterdayMoney.plan.startingMoney).toBeNull();
    expect(yesterdayMoney.plan.days.every(day => day.balance === null)).toBe(true);
    expect(yesterdayMoney.tightSentence).toBe('Thursday looks tight: about $4,100 goes out (Budweiser delivery about $2,150 and Rent $1,950) and about $200 comes in.');
    // A store with three weeks of sales is still learning: no alert.
    await prisma.sale.deleteMany({ where: { createdAt: { lt: at('2026-10-26') } } });
    const learning = await loadCashPlan(data.location.id, now);
    expect(learning.plan.learning).toBe(true);
    expect(learning.tightSentence).toBeNull();
    expect((await collectAttention(data.location.id, now, 'ADMIN')).items.some(item => item.key === 'cash-tight')).toBe(false);
  });

  it('is the owner\'s alone, and saves money today, settings and planned items for the owner\'s store only', async () => {
    const call = (method: 'get' | 'put' | 'post' | 'delete', path: string, token = owner, body?: object) => {
      const pending = request(app)[method]('/api/financial/cash-plan' + path).set('Authorization', 'Bearer ' + token);
      return body ? pending.send(body) : pending;
    };
    const managerUser = await prisma.user.create({ data: { email: 'manager-plan@test.com', password: data.adminUser.password, firstName: 'Mia', lastName: 'Manager', role: 'MANAGER', locationId: data.location.id } });
    const managerToken = await createTestToken(managerUser.id, 'MANAGER');
    const cashierToken = await createTestToken(data.cashierUser.id, 'CASHIER');
    await call('get', '', managerToken).expect(403);
    await call('get', '', cashierToken).expect(403);
    await call('put', '/settings', managerToken, { startingMoney: 5 }).expect(403);

    const empty = (await call('get', '').expect(200)).body.data;
    expect(empty.plan.days).toHaveLength(14);
    expect(empty.plan.learning).toBe(true);
    expect(empty.settings).toMatchObject({ cardDepositDays: 2, cardFeePercent: 0, salesTaxFrequency: 'NONE', lotterySweepWeekday: null, startingMoney: null });

    const saved = (await call('put', '/settings', owner, { startingMoney: 8200.5, cardDepositDays: 1, cardFeePercent: 2.75, lotterySweepWeekday: 3 }).expect(200)).body.data;
    expect(saved.settings).toMatchObject({ startingMoney: 8200.5, cardDepositDays: 1, cardFeePercent: 2.75, lotterySweepWeekday: 3 });
    expect(saved.settings.startingMoneyDate).toBe(saved.plan.today);
    expect(saved.plan.startingMoney).toBe(8200.5);
    // Not a week of closed lottery days yet: said plainly.
    expect(saved.notes).toContain('The lottery is left out until a week of lottery days has been closed.');
    await call('put', '/settings', owner, {}).expect(400);
    await call('put', '/settings', owner, { cardDepositDays: 9 }).expect(400);
    await call('put', '/settings', owner, { startingMoney: 10.005 }).expect(400);
    expect((await call('put', '/settings', owner, { startingMoney: null }).expect(200)).body.data.settings).toMatchObject({ startingMoney: null, startingMoneyDate: null });

    await call('post', '/items', owner, { label: 'Tax refund', direction: 'IN', amount: 400, repeat: 'ONCE' }).expect(400);
    const created = (await call('post', '/items', owner, { label: 'Loan payment', direction: 'OUT', amount: 650, repeat: 'WEEKLY', weekday: 5, dayOfMonth: 3 }).expect(201)).body.data;
    const listed = (await call('get', '').expect(200)).body.data.items;
    // Only what its repeat uses is kept.
    expect(listed).toEqual([{ id: created.id, label: 'Loan payment', direction: 'OUT', amount: 650, repeat: 'WEEKLY', date: null, weekday: 5, dayOfMonth: null, endsOn: null }]);
    await call('put', '/items/' + created.id, owner, { label: 'Loan payment', direction: 'OUT', amount: 700, repeat: 'MONTHLY', dayOfMonth: 15 }).expect(200);
    expect((await prisma.cashPlanItem.findUniqueOrThrow({ where: { id: created.id } }))).toMatchObject({ repeat: 'MONTHLY', dayOfMonth: 15, weekday: null });
    // Another store's owner cannot reach it.
    const elsewhere = await prisma.location.create({ data: { name: 'Other Store', address: '2 Road', city: 'City', state: 'TX', zipCode: '75001', phone: '555', email: 'other@test.com' } });
    const otherOwner = await prisma.user.create({ data: { email: 'owner-other@test.com', password: data.adminUser.password, firstName: 'Oli', lastName: 'Owner', role: 'ADMIN', locationId: elsewhere.id } });
    const otherToken = await createTestToken(otherOwner.id, 'ADMIN');
    await call('delete', '/items/' + created.id, otherToken).expect(404);
    expect((await call('get', '', otherToken).expect(200)).body.data.items).toEqual([]);
    await call('delete', '/items/' + created.id, owner).expect(200);
    expect(await prisma.cashPlanItem.count()).toBe(0);
  });
});
