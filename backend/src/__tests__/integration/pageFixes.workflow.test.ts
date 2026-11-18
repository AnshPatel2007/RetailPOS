import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { reportCalendar } from '../../services/reportDates.service';

/** Figures the store pages show: each one matches what the store actually holds. */
describe('Page figures and scoping', () => {
  let data: TestData, owner: string, superToken: string;
  const get = (path: string, token = owner) => request(app).get(path).set('Authorization', 'Bearer ' + token);
  const post = (path: string, body: object, token = owner) => request(app).post(path).set('Authorization', 'Bearer ' + token).send(body);
  const put = (path: string, body: object, token = owner) => request(app).put(path).set('Authorization', 'Bearer ' + token).send(body);
  const sale = (overrides: Record<string, unknown> = {}) => prisma.sale.create({ data: {
    saleNumber: randomUUID(), userId: data.adminUser.id, locationId: data.location.id, paymentMethod: 'CASH', total: 11, subtotal: 10, tax: 1,
    items: { create: { productId: data.product.id, sku: data.product.sku, productName: data.product.name, quantity: 1, price: 10, tax: 1, total: 11 } }, ...overrides,
  }, include: { items: true } });
  beforeEach(async () => {
    data = await seedTestData();
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
    const platform = await prisma.user.create({ data: { email: 'platform-pages@test.com', password: data.adminUser.password, firstName: 'Platform', lastName: 'Admin', role: 'SUPER_ADMIN' } });
    superToken = await createTestToken(platform.id, 'SUPER_ADMIN');
  });
  const otherStore = () => prisma.location.create({ data: { name: 'Second Store', address: '2 Side St', city: 'Elsewhere', state: 'TS', zipCode: '22222', phone: '555-0002', email: 'second@store.com', taxRate: 0 } });

  it('customer insights leave out deleted customers and never call no-spend customers VIP or lost', async () => {
    await prisma.customer.updateMany({ data: { totalSpent: 0, lastVisitAt: null } });
    for (let i = 0; i < 8; i++) await prisma.customer.create({ data: { firstName: 'Zero' + i, lastName: 'Spend', locationId: data.location.id, totalSpent: 0 } });
    await prisma.customer.create({ data: { firstName: 'Big', lastName: 'Spender', locationId: data.location.id, totalSpent: 500, visitCount: 10, lastVisitAt: new Date() } });
    await prisma.customer.create({ data: { firstName: 'Gone', lastName: 'Deleted', locationId: data.location.id, totalSpent: 9000, isActive: false, lastVisitAt: new Date() } });
    const insights = (await get('/api/analytics/customer-insights').expect(200)).body.data;
    expect(insights.topCustomers.map((c: { name: string }) => c.name)).not.toContain('Gone Deleted');
    expect(insights.segments.byValue.vip.count).toBe(1);
    expect(insights.segments.byValue.noPurchases.count).toBe(insights.overview.totalCustomers - 1);
    expect(insights.segments.byRecency.lost.count).toBe(0);
    expect(insights.segments.byRecency.noVisits.count).toBe(insights.overview.totalCustomers - 1);
  });

  it('reorder suggestions count stock already on order and leave out refunded units', async () => {
    await prisma.product.update({ where: { id: data.product.id }, data: { stockQuantity: 2, lowStockAlert: 5, trackInventory: true } });
    const suggested = async () => (await get('/api/purchase-orders/suggested').expect(200)).body.data.suppliers
      .flatMap((group: { items: { productId: string; suggestedQty: number; onOrder: number }[] }) => group.items)
      .find((item: { productId: string }) => item.productId === data.product.id);
    expect((await suggested())).toMatchObject({ onOrder: 0 });
    await prisma.purchaseOrder.create({ data: { orderNumber: 'PO-' + randomUUID(), supplierId: data.supplier.id, locationId: data.location.id, status: 'ORDERED',
      items: { create: { productId: data.product.id, sku: data.product.sku, productName: data.product.name, quantity: 20, cost: 1, total: 20 } } } });
    expect(await suggested()).toBeUndefined(); // 2 on hand + 20 coming is well above the alert
    // Refunded units are not demand.
    const sold = await sale({ status: 'REFUNDED', createdAt: new Date(), items: { create: { productId: data.product.id, sku: data.product.sku, productName: data.product.name, quantity: 30, price: 1, tax: 0, total: 30 } } });
    await prisma.refund.create({ data: { saleId: sold.id, amount: 30, reason: 'Returned', refundedBy: data.adminUser.id, items: { create: { saleItemId: sold.items[0].id, quantity: 30, amount: 30 } } } });
    expect(await suggested()).toBeUndefined();
  });

  it('gift card totals show balances left on expired or deactivated cards, and a date expiry lasts the whole store day', async () => {
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
    const issue = (body: object) => post('/api/gift-cards', { amount: 25, paymentMethod: 'PROMOTIONAL', notes: 'Fixture', idempotencyKey: randomUUID(), ...body }).expect(201);
    const card = (await issue({ expiresAt: '2099-01-15' })).body.data;
    expect(new Date(card.expiresAt).toISOString()).toBe('2099-01-16T05:59:59.999Z'); // end of Jan 15 in Chicago (CST)
    const spent = (await issue({})).body.data;
    await prisma.giftCard.update({ where: { id: spent.id }, data: { isActive: false } });
    expect((await get('/api/gift-cards/stats').expect(200)).body.data).toMatchObject({ outstandingBalance: 25, inactiveBalance: 25 });
  });

  it('house accounts report what is owed across every page, not only the one shown', async () => {
    for (let i = 0; i < 3; i++) {
      const customer = await prisma.customer.create({ data: { firstName: 'Tab' + i, lastName: 'Holder', locationId: data.location.id } });
      await prisma.houseAccount.create({ data: { customerId: customer.id, locationId: data.location.id, balance: 10 * (i + 1), creditLimit: 100 } });
    }
    const page = (await get('/api/house-accounts?limit=1').expect(200)).body;
    expect(page.data).toHaveLength(1);
    expect(page.summary.outstanding).toBe(60);
  });

  it('the platform preview of recent sales shows only the previewed store', async () => {
    const second = await otherStore();
    await sale();
    await sale({ locationId: second.id, total: 99 });
    const shown = (await get('/api/sales?locationId=' + data.location.id, superToken).expect(200)).body.data;
    expect(shown.length).toBe(1);
    expect(shown.every((row: { locationId: string }) => row.locationId === data.location.id)).toBe(true);
  });

  it('store edits change only store details, and a deactivated store can be reactivated', async () => {
    const second = await otherStore();
    await put('/api/locations/' + second.id, { name: 'Renamed', settings: { injected: true }, costingActivatedAt: new Date().toISOString() }, superToken).expect(200);
    const saved = await prisma.location.findUniqueOrThrow({ where: { id: second.id } });
    expect(saved.name).toBe('Renamed');
    expect(saved.settings).toBeNull();
    expect(saved.costingActivatedAt).toBeNull();
    await put('/api/locations/' + second.id, { timezone: 'Not/AZone' }, superToken).expect(400);
    await request(app).delete('/api/locations/' + second.id).set('Authorization', 'Bearer ' + superToken).expect(200);
    await put('/api/locations/' + second.id, { isActive: true }, superToken).expect(200);
    expect((await prisma.location.findUniqueOrThrow({ where: { id: second.id } })).isActive).toBe(true);
  });

  it('the expense report counts approved and paid spend, with pending shown apart', async () => {
    for (const [status, amount] of [['APPROVED', 40], ['PAID', 10], ['PENDING', 500]] as const) {
      await prisma.expense.create({ data: { expenseNumber: randomUUID(), category: 'OTHER', description: status, amount, status, userId: data.adminUser.id, locationId: data.location.id } });
    }
    const report = (await get('/api/reports/expenses').expect(200)).body.data;
    expect(report.summary).toMatchObject({ totalExpenses: 50, pendingExpenses: 500 });
    expect(report.expenses).toHaveLength(3);
  });
  it("recurring expenses come due on the store's own date and are booked on that store day", async () => {
    // A store far ahead of UTC: its calendar day is usually not the UTC day.
    const timezone = 'Pacific/Kiritimati';
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone } });
    const calendar = reportCalendar(timezone);
    const storeToday = new Date(Date.UTC(calendar.year, calendar.month - 1, calendar.dayOfMonth));
    const tomorrow = new Date(storeToday.getTime() + 86400000);
    const make = (nextDueDate: Date, description: string) => prisma.recurringExpense.create({ data: { description, category: 'RENT', amount: 100,
      frequency: 'MONTHLY', startDate: nextDueDate, nextDueDate, locationId: data.location.id, userId: data.adminUser.id } });
    await make(storeToday, 'Due today');
    await make(tomorrow, 'Due tomorrow');
    const generated = (await post('/api/financial/recurring-expenses/generate', {}).expect(200)).body.data;
    expect(generated.expenses.map((e: { description: string }) => e.description)).toEqual(['Due today (Auto-generated)']);
    expect(new Date(generated.expenses[0].expenseDate).toISOString()).toBe(calendar.midnight(calendar.year, calendar.month, calendar.dayOfMonth).toISOString());
  });
});
