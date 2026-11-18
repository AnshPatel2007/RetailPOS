import { randomUUID } from 'crypto';
import { prisma, seedTestData, TestData } from './setup';
import { api, createTestToken } from './helpers';
import { getFinancialMetrics } from '../../services/financialMetrics.service';
import { reportCalendar } from '../../services/reportDates.service';

describe('Super-admin dashboard', () => {
  let data: TestData;
  let superToken: string;
  let ownerToken: string;
  beforeEach(async () => {
    data = await seedTestData();
    ownerToken = await createTestToken(data.adminUser.id, 'ADMIN');
    const superAdmin = await prisma.user.create({ data: { email: 'platform@test.com', password: data.adminUser.password, firstName: 'Platform', lastName: 'Admin', role: 'SUPER_ADMIN' } });
    superToken = await createTestToken(superAdmin.id, 'SUPER_ADMIN');
  });
  const overview = async (period: string | number = 30) => (await api.get('/api/locations/stats/overview').withAuth(superToken).withQuery({ period }).expectStatus(200).execute()).body.data;
  const sale = async (overrides: any = {}) => prisma.sale.create({ data: {
    saleNumber: randomUUID(), userId: data.adminUser.id, locationId: data.location.id, paymentMethod: 'CASH', total: 110, subtotal: 100, tax: 10,
    items: { create: { productId: data.product.id, sku: data.product.sku, productName: data.product.name, quantity: 2, price: 50, tax: 10, total: 110 } }, ...overrides,
  } });

  it('deducts original recorded costs and approved expenses, excluding tax from operating margin', async () => {
    await sale({ pricingVersion: 1, items: { create: { productId: data.product.id, sku: data.product.sku, productName: data.product.name, quantity: 2, price: 50, tax: 10, total: 110, unitCost: 10 } } });
    await prisma.expense.create({ data: { expenseNumber: randomUUID(), category: 'OTHER', description: 'Approved expense', amount: 30, status: 'APPROVED', userId: data.adminUser.id, locationId: data.location.id } });
    await prisma.expense.create({ data: { expenseNumber: randomUUID(), category: 'OTHER', description: 'Pending expense', amount: 999, status: 'PENDING', userId: data.adminUser.id, locationId: data.location.id } });
    const result = await overview();
    expect(result.totals).toMatchObject({ totalRevenue: 110, totalTransactions: 1, totalTaxCharged: 10, totalExpenses: 30, totalProfit: 50, margin: 50 });
    expect(result.locations[0]).toMatchObject({ costOfGoodsSold: 20, costBasis: 'HISTORICAL', profit: 50, margin: 50 });
  });

  it('does not claim 100% margins when cost data is missing or there are no sales', async () => {
    expect((await overview()).totals.margin).toBeNull();
    await prisma.product.update({ where: { id: data.product.id }, data: { cost: 0 } });
    await sale();
    const result = await overview();
    expect(result.totals.totalProfit).toBeNull();
    expect(result.totals.margin).toBeNull();
    expect(result.locations[0].unavailableReason).toBe('Cost information incomplete. Review missing inventory and sale costs.');
  });

  it('deducts partial and full refunds once, uses refund dates, and excludes voided sales', async () => {
    const partial = await sale();
    const full = await sale({ total: 55, tax: 5, status: 'REFUNDED' });
    const older = await sale({ createdAt: new Date(Date.now() - 800 * 86400000) });
    await sale({ status: 'VOIDED', total: 999 });
    await prisma.refund.createMany({ data: [
      { saleId: partial.id, amount: 22, reason: 'Partial', refundedBy: data.adminUser.id },
      { saleId: full.id, amount: 55, reason: 'Full', refundedBy: data.adminUser.id },
      { saleId: older.id, amount: 40, reason: 'Older sale, current refund', refundedBy: data.adminUser.id },
    ] });
    const result = await overview();
    expect(result.totals).toMatchObject({ totalGrossCollected: 165, totalRevenue: 48, totalTransactions: 2, totalRefunds: 3, totalRefundAmount: 117, totalProfit: null, margin: null });
    expect(result.locations[0].unavailableReason).toBe('Older voids have no recorded reversal date; historical profit requires review.');
  });

  it('adds newly created stores and keeps inactive store history in the same totals', async () => {
    const first = await overview();
    expect(first.totals.totalStores).toBe(1);
    const created = await api.post('/api/locations').withAuth(superToken).withBody({ name: 'New Partner', address: '2 Main St', city: 'Chicago', state: 'IL', zipCode: '60601', phone: '555-2222', email: 'new@store.test', taxRate: 0 }).expectStatus(201).execute();
    const storeId = created.body.data.id;
    const empty = await overview();
    expect(empty.totals.totalStores).toBe(2);
    expect(empty.locations.find((store: any) => store.locationId === storeId)).toMatchObject({ revenue: 0, transactions: 0, productCount: 0, margin: null });
    const product = await prisma.product.create({ data: { name: 'Partner stock', sku: 'PARTNER', price: 20, cost: 10, stockQuantity: 0, locationId: storeId } });
    await sale({ locationId: storeId, total: 20, tax: 0, items: { create: { productId: product.id, sku: product.sku, productName: product.name, quantity: 1, price: 20, total: 20, unitCost: 10 } } });
    const updated = await overview();
    expect(updated.totals).toMatchObject({ totalRevenue: 20, totalProfit: 10, margin: 50, totalOutOfStock: 1, totalProducts: 2 });
    await prisma.location.update({ where: { id: storeId }, data: { isActive: false } });
    const inactive = await overview();
    expect(inactive.totals).toMatchObject({ totalStores: 2, activeStores: 1, totalRevenue: 20 });
    expect(inactive.locations.find((store: any) => store.locationId === storeId).isActive).toBe(false);
  });

  it('supports rolling periods and MAX without limiting current stock/shift counts to the period', async () => {
    await sale({ createdAt: new Date(Date.now() - 2 * 86400000) });
    await sale({ createdAt: new Date(Date.now() - 800 * 86400000), total: 50, tax: 0 });
    await prisma.product.update({ where: { id: data.product.id }, data: { stockQuantity: 2, lowStockAlert: 5 } });
    await prisma.product.create({ data: { name: 'Misc', sku: 'MISC-001', price: 0, locationId: data.location.id } });
    await prisma.shift.create({ data: { userId: data.cashierUser.id, locationId: data.location.id, clockInAt: new Date(Date.now() - 2 * 86400000) } });
    expect((await overview(1)).totals).toMatchObject({ totalTransactions: 0, totalLowStock: 1, totalOutOfStock: 0, totalProducts: 1, totalActiveShifts: 1 });
    for (const period of [7, 30, 90, 365]) expect((await overview(period)).totals.totalTransactions).toBe(1);
    const allTime = await overview('max');
    expect(allTime.totals.totalTransactions).toBe(2);
    expect(allTime.rangeStart).toBeNull();
    for (const invalid of ['0', '-1', 'NaN', '30junk', '999999']) await api.get('/api/locations/stats/overview').withAuth(superToken).withQuery({ period: invalid }).expectStatus(400).execute();
  });

  it('keeps payroll with store admins and the cross-store dashboard with super admins', async () => {
    await api.get('/api/payroll').withAuth(ownerToken).expectStatus(200).execute();
    await api.get('/api/payroll').withAuth(superToken).withQuery({ locationId: data.location.id }).expectStatus(403).execute();
    await api.put('/api/payroll/employees/' + data.cashierUser.id + '/rate').withAuth(superToken).withBody({ hourlyRate: 99 }).expectStatus(403).execute();
    await api.get('/api/locations/stats/overview').withAuth(ownerToken).expectStatus(403).execute();
    await api.get('/api/locations/stats/overview').withAuth(await createTestToken(data.cashierUser.id, 'CASHIER')).expectStatus(403).execute();
    await api.get('/api/reports/dashboard').withAuth(ownerToken).expectStatus(200).execute();
  });
  it('store list totals match the store dashboard: after refunds, no voided or pending sales, store-local today', async () => {
    const plain = (await api.get('/api/locations').withAuth(superToken).expectStatus(200).execute()).body.data;
    expect(plain[0].todayRevenue).toBeUndefined(); // store pickers do not pay for sales totals
    const today = await sale({ pricingVersion: 1, items: { create: { productId: data.product.id, sku: data.product.sku, productName: data.product.name, quantity: 2, price: 50, tax: 10, total: 110, unitCost: 10 } } });
    await sale({ status: 'PENDING', total: 500 });
    await sale({ status: 'HOLD', total: 400 });
    await sale({ status: 'VOIDED', total: 300 });
    await sale({ createdAt: new Date(Date.now() - 40 * 86400000), total: 70, tax: 0 });
    await prisma.refund.create({ data: { saleId: today.id, amount: 22, taxAmount: 2, reason: 'Partial', refundedBy: data.adminUser.id } });
    const [store] = (await api.get('/api/locations').withAuth(superToken).withQuery({ include: 'stats' }).expectStatus(200).execute()).body.data;
    const location = await prisma.location.findUniqueOrThrow({ where: { id: data.location.id } });
    const now = new Date();
    const dashboardToday = await getFinancialMetrics({ locationId: data.location.id }, { gte: reportCalendar(location.timezone || 'UTC', now).day(), lte: now });
    expect(store).toMatchObject({ todayRevenue: dashboardToday.netCollected, totalRevenue: 158, totalSales: 2 });
    expect(store.todayRevenue).toBe(88);
    const detail = (await api.get(`/api/locations/${data.location.id}/stats`).withAuth(superToken).withQuery({ period: 30 }).expectStatus(200).execute()).body.data;
    expect(detail).toMatchObject({ totalRevenue: 158, periodRevenue: 88, periodTransactions: 1, averageOrderValue: 110 });
    expect(detail.topProducts[0]).toMatchObject({ productId: data.product.id, name: data.product.name });
    expect(detail.userPerformance[0]).toMatchObject({ userId: data.adminUser.id, userName: `${data.adminUser.firstName} ${data.adminUser.lastName}`, total: 88 });
    await api.get(`/api/locations/${data.location.id}/stats`).withAuth(superToken).withQuery({ period: 'junk' }).expectStatus(400).execute();
  });
});
