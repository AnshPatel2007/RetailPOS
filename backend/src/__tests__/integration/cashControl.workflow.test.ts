/**
 * Blind drawer close: a cashier counts the drawer before seeing what it should
 * hold. Nothing sent to a cashier with an open drawer gives the figure away;
 * the difference shows once the drawer is closed. Managers and owners always
 * see it, and the owner can turn the rule off.
 */
import bcrypt from 'bcryptjs';
import { prisma, seedTestData, TestData } from './setup';
import { api, createTestToken, loginUser } from './helpers';

describe('blind drawer close', () => {
  let data: TestData;
  let owner: string;
  let cashier: string;

  const CASH_FIELDS = ['expectedDrawer', 'expectedCash', 'calculatedExpected', 'cashSales', 'totalCashSales', 'cashRefunds', 'cashVoids',
    'cashMovementNet', 'cashGiftFunding', 'cashHousePayments', 'tenderBreakdown', 'paymentBreakdown', 'drawerEntries', 'sales'];
  const cashSale = (token: string) => api.post('/api/sales').withAuth(token)
    .withBody({ items: [{ productId: data.product.id, price: 10, quantity: 1 }], paymentMethod: 'CASH', amountPaid: 20 }).expectStatus(201).execute();
  const current = async (token: string) => (await api.get('/api/shifts/current').withAuth(token).expectSuccess()).body.data;

  beforeEach(async () => {
    data = await seedTestData();
    owner = await loginUser('admin@test.com', 'Admin123!');
    cashier = await loginUser('cashier@test.com', 'Admin123!');
    await prisma.product.update({ where: { id: data.product.id }, data: { price: 10 } });
    for (const token of [owner, cashier]) await api.post('/api/shifts/clock-in').withAuth(token).withBody({ startingCash: 100 }).expectStatus(201).execute();
  });

  it('is on by default and shows a cashier their shift without any figure for what the drawer should hold', async () => {
    const settings = await api.get('/api/locations/my-settings').withAuth(cashier).expectSuccess();
    expect(settings.body.data.settings.cashControl).toEqual({ blindClose: true });
    await cashSale(cashier);
    const shift = await current(cashier);
    expect(shift).toMatchObject({ blindClose: true, startingCash: 100, totalSales: 11, totalTransactions: 1, isClosed: false });
    for (const field of CASH_FIELDS) expect(shift).not.toHaveProperty(field);
    // No expected amount anywhere in what was sent (starting 100 + cash sale 11).
    expect(JSON.stringify(shift)).not.toContain('111');

    // The report and the dashboard's cash total would give it away too.
    const report = await api.get('/api/shifts/' + shift.id + '/z-report').withAuth(cashier).expectError(409);
    expect(report.body.error).toContain('Count and close your drawer first');
    const dashboard = await api.get('/api/reports/dashboard').withAuth(cashier).expectSuccess();
    expect(dashboard.body.data.paymentBreakdown).toEqual([]);
    expect(dashboard.body.data.paymentBreakdownHidden).toBe(true);
    expect(dashboard.body.data.todaySales).toBe(11);
  });

  it('reveals the expected amount and the difference once the cashier has counted and closed', async () => {
    await cashSale(cashier);
    const shiftId = (await current(cashier)).id;
    const closed = await api.post('/api/shifts/clock-out').withAuth(cashier).withBody({ endingCash: 108 }).expectSuccess();
    expect(closed.body.data.shiftSummary).toMatchObject({ expectedCash: 111, endingCash: 108, cashDifference: -3 });
    const report = await api.get('/api/shifts/' + shiftId + '/z-report').withAuth(cashier).expectSuccess();
    expect(report.body.data).toMatchObject({ isClosed: true, expectedCash: 111, cashDifference: -3 });
  });

  it('always shows owners and managers the expected amount, including for a cashier\'s open drawer', async () => {
    await cashSale(owner);
    await cashSale(cashier);
    const mine = await current(owner);
    expect(mine.blindClose).toBeUndefined();
    expect(mine).toMatchObject({ expectedDrawer: 111, totalCashSales: 11 });
    const cashierShift = await prisma.shift.findFirstOrThrow({ where: { userId: data.cashierUser.id, isClosed: false } });
    const report = await api.get('/api/shifts/' + cashierShift.id + '/z-report').withAuth(owner).expectSuccess();
    expect(report.body.data.expectedCash).toBe(111);
    const dashboard = await api.get('/api/reports/dashboard').withAuth(owner).expectSuccess();
    expect(dashboard.body.data.paymentBreakdownHidden).toBeUndefined();
    expect(dashboard.body.data.paymentBreakdown).toEqual([expect.objectContaining({ method: 'CASH', total: 22 })]);
  });

  it('lets only the owner turn it off, after which a cashier sees the expected amount again', async () => {
    const manager = await prisma.user.create({ data: { email: 'manager@test.com', password: await bcrypt.hash('Admin123!', 4), firstName: 'Manager', lastName: 'User', role: 'MANAGER', locationId: data.location.id } });
    const managerToken = await createTestToken(manager.id, 'MANAGER');
    const refused = await api.put('/api/locations/my-settings').withAuth(managerToken).withBody({ cashControl: { blindClose: false } }).expectError(403);
    expect(refused.body.error).toContain('Only the store owner');
    await api.put('/api/locations/my-settings').withAuth(cashier).withBody({ cashControl: { blindClose: false } }).expectError(403);
    await api.put('/api/locations/my-settings').withAuth(owner).withBody({ cashControl: { blindClose: 'no' } }).expectError(400);

    const saved = await api.put('/api/locations/my-settings').withAuth(owner).withBody({ cashControl: { blindClose: false } }).expectSuccess();
    expect(saved.body.data.settings.cashControl).toEqual({ blindClose: false });
    await cashSale(cashier);
    const shift = await current(cashier);
    expect(shift.blindClose).toBeUndefined();
    expect(shift).toMatchObject({ expectedDrawer: 111, totalCashSales: 11 });
    await api.get('/api/shifts/' + shift.id + '/z-report').withAuth(cashier).expectSuccess();
    const dashboard = await api.get('/api/reports/dashboard').withAuth(cashier).expectSuccess();
    expect(dashboard.body.data.paymentBreakdown).toEqual([expect.objectContaining({ method: 'CASH', total: 11 })]);
    // The other settings are untouched by the change.
    expect((await prisma.activityLog.findFirstOrThrow({ where: { action: 'STORE_SETTINGS_UPDATED' }, orderBy: { createdAt: 'desc' } })).details).toMatchObject({ sections: ['cashControl'] });
  });
});
