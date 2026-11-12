/**
 * Owners of several stores (upgrade plan, WP 3.3): the My Stores overview shows the
 * same figures as each store's own dashboard; owners give their staff access to their
 * other stores within limits; the platform admin moves stores and names owners; and an
 * owner of several stores gets one morning brief covering all of them.
 */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { prisma, seedTestData, TestData } from './setup';
import { api, createTestToken, loginUser } from './helpers';
import { organizationIdOf, syncOwnerAccess } from '../../services/organization.service';
import { resetOwnerBriefSchedule, runOwnerBriefSchedule } from '../../services/ownerBrief.service';

jest.mock('../../utils/email', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));

const store = (id: string, name: string, organizationId?: string) => ({ id, name, address: '1 Test St', city: 'Test', state: 'TS', zipCode: '12345',
  phone: '555-0100', email: id + '@store.test', timezone: 'America/Chicago', ...(organizationId ? { organizationId } : {}) });

describe('owners of several stores', () => {
  let data: TestData;
  let organizationId: string;
  let owner: string;
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    resetOwnerBriefSchedule();
    data = await seedTestData();
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
    organizationId = await organizationIdOf(data.location.id);
    await prisma.location.create({ data: store('store-b', 'Second Store', organizationId) });
    await prisma.location.create({ data: store('store-c', 'Other Business') });
    await prisma.organizationOwner.create({ data: { organizationId, userId: data.adminUser.id } });
    await prisma.$transaction(tx => syncOwnerAccess(tx, organizationId));
    owner = await loginUser('admin@test.com', 'Admin123!');
  });
  afterAll(() => { if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey; });

  const sell = (locationId: string, total: number, createdAt = new Date(Date.now() - 60000)) => prisma.sale.create({ data: {
    saleNumber: randomUUID(), locationId, userId: data.adminUser.id, createdAt, total, subtotal: total - 1, tax: 1, amountPaid: total, paymentMethod: 'CASH', pricingVersion: 1 } });

  it('shows only the stores the person runs, with the figures their own dashboards show', async () => {
    await sell(data.location.id, 22); await sell(data.location.id, 11); await sell('store-b', 7);
    const short = await prisma.product.create({ data: { name: 'B item', sku: 'B-1', price: 1, cost: 1, stockQuantity: -1, locationId: 'store-b' } });
    await prisma.inventoryException.create({ data: { locationId: 'store-b', productId: short.id, openProductId: short.id, lowestQuantity: -1, latestQuantity: -1 } });

    const overview = (await api.get('/api/organization/overview').withAuth(owner).expectSuccess()).body.data.stores;
    expect(overview.map((card: { name: string }) => card.name)).toEqual(['Second Store', 'Test Store']);
    expect(overview.find((card: { name: string }) => card.name === 'Test Store')).toMatchObject({ isCurrent: true });

    for (const card of overview) {
      await api.post('/api/auth/switch-store').withAuth(owner).withBody({ locationId: card.locationId }).expectSuccess();
      const dashboard = (await api.get('/api/reports/dashboard').withAuth(owner).expectSuccess()).body.data;
      const attention = (await api.get('/api/reports/attention').withAuth(owner).expectSuccess()).body.data;
      expect(card.today).toMatchObject({ sales: dashboard.todaySales, transactions: dashboard.todayTransactions, trend: dashboard.todayTrend });
      expect(card.attentionCount).toBe(attention.items.length);
    }
    expect(overview.find((card: { name: string }) => card.name === 'Test Store').today).toMatchObject({ sales: 33, transactions: 2 });
    expect(overview.find((card: { name: string }) => card.name === 'Second Store')).toMatchObject({ today: { sales: 7, transactions: 1 }, openStockExceptions: 1 });

    // A manager runs no store as ADMIN: no overview.
    const manager = await prisma.user.create({ data: { email: 'manager@test.com', password: 'x', firstName: 'Mia', lastName: 'Manager', role: 'MANAGER', locationId: data.location.id } });
    await api.get('/api/organization/overview').withAuth(await createTestToken(manager.id, 'MANAGER')).expectError(403);
  });

  it('lets owners give their own staff access to their other stores, and nothing more', async () => {
    const grant = (body: object, token = owner) => api.post('/api/organization/access').withAuth(token).withBody(body).execute();
    const given = await grant({ email: 'cashier@test.com', locationId: 'store-b', role: 'CASHIER' });
    expect(given.status).toBe(201);
    expect(await prisma.activityLog.findFirst({ where: { action: 'STORE_ACCESS_GRANTED' } })).toMatchObject({ locationId: 'store-b', entityId: data.cashierUser.id });
    // Changing the role there updates the same access.
    expect((await grant({ email: 'cashier@test.com', locationId: 'store-b', role: 'MANAGER' })).status).toBe(200);
    expect(await prisma.userStoreAccess.count({ where: { userId: data.cashierUser.id } })).toBe(2);

    const list = (await api.get('/api/organization/access').withAuth(owner).expectSuccess()).body.data;
    expect(list.stores.map((s: { name: string }) => s.name)).toEqual(['Second Store', 'Test Store']);
    expect(list.access).toContainEqual(expect.objectContaining({ userId: data.cashierUser.id, locationId: 'store-b', role: 'MANAGER', isHome: false, isOwner: false }));
    expect(list.access).toContainEqual(expect.objectContaining({ userId: data.adminUser.id, locationId: 'store-b', role: 'ADMIN', isOwner: true }));

    // Limits: no ADMIN, no home store, no other business, no strangers, no non-owners.
    expect((await grant({ email: 'cashier@test.com', locationId: 'store-b', role: 'ADMIN' })).status).toBe(400);
    expect((await grant({ email: 'cashier@test.com', locationId: data.location.id, role: 'MANAGER' })).status).toBe(409);
    expect((await grant({ email: 'cashier@test.com', locationId: 'store-c', role: 'CASHIER' })).status).toBe(403);
    const outsider = await prisma.user.create({ data: { email: 'outsider@test.com', password: 'x', firstName: 'Out', lastName: 'Sider', role: 'CASHIER', locationId: 'store-c' } });
    const stranger = await grant({ email: outsider.email, locationId: 'store-b', role: 'CASHIER' });
    expect(stranger.status).toBe(404);
    expect(stranger.body.error).toBe('No one with that email works in your stores');
    const cashierToken = await loginUser('cashier@test.com', 'Admin123!');
    expect((await grant({ email: 'cashier@test.com', locationId: 'store-b', role: 'CASHIER' }, cashierToken)).status).toBe(403);
    await api.get('/api/organization/access').withAuth(cashierToken).expectError(403);

    // Removing: never a home store or an owner's access; never while their drawer is open there.
    const homeRow = list.access.find((row: { userId: string; isHome: boolean }) => row.userId === data.cashierUser.id && row.isHome);
    expect((await api.delete('/api/organization/access/' + homeRow.id).withAuth(owner).execute()).status).toBe(409);
    const ownerRow = list.access.find((row: { userId: string; locationId: string }) => row.userId === data.adminUser.id && row.locationId === 'store-b');
    expect((await api.delete('/api/organization/access/' + ownerRow.id).withAuth(owner).execute()).status).toBe(409);
    await api.post('/api/auth/switch-store').withAuth(cashierToken).withBody({ locationId: 'store-b' }).expectSuccess();
    const shift = await prisma.shift.create({ data: { userId: data.cashierUser.id, locationId: 'store-b', clockInAt: new Date(), startingCash: 50 } });
    const extra = list.access.find((row: { userId: string; locationId: string }) => row.userId === data.cashierUser.id && row.locationId === 'store-b');
    expect((await api.delete('/api/organization/access/' + extra.id).withAuth(owner).execute()).status).toBe(409);
    await prisma.shift.update({ where: { id: shift.id }, data: { isClosed: true, clockOutAt: new Date() } });
    await api.delete('/api/organization/access/' + extra.id).withAuth(owner).expectSuccess();
    // Their session in that store ends with the next request.
    expect((await api.get('/api/products').withAuth(cashierToken).expectError(403)).body.details).toEqual({ code: 'STORE_ACCESS_ENDED' });
  });

  it('lets the platform admin move stores between businesses and name owners', async () => {
    const platform = await prisma.user.create({ data: { email: 'platform@test.com', password: await bcrypt.hash('Platform123!', 4), firstName: 'Plat', lastName: 'Form', role: 'SUPER_ADMIN' } });
    const token = await createTestToken(platform.id, 'SUPER_ADMIN');
    const organizations = (await api.get('/api/organizations').withAuth(token).expectSuccess()).body.data;
    expect(organizations.find((org: { id: string }) => org.id === organizationId)).toMatchObject({
      locations: [{ id: 'store-b' }, { id: data.location.id }], owners: [{ userId: data.adminUser.id }] });
    await api.get('/api/organizations').withAuth(owner).expectError(403);

    // Store C joins the business: its owner now runs it too.
    await api.put('/api/locations/store-c').withAuth(token).withBody({ organizationId }).expectSuccess();
    expect(await prisma.userStoreAccess.findUnique({ where: { userId_locationId: { userId: data.adminUser.id, locationId: 'store-c' } } })).toMatchObject({ role: 'ADMIN' });

    // Store B leaves for a business of its own: the owner's access there ends, and so does staff access across.
    await prisma.userStoreAccess.create({ data: { userId: data.cashierUser.id, locationId: 'store-b', role: 'CASHIER' } });
    const moved = (await api.put('/api/locations/store-b').withAuth(token).withBody({ organizationId: null }).expectSuccess()).body.data;
    expect(moved.organizationId).not.toBe(organizationId);
    expect(await prisma.userStoreAccess.count({ where: { locationId: 'store-b' } })).toBe(0);

    // Owners must be an admin of one of the business's stores.
    const bea = await prisma.user.create({ data: { email: 'bea@test.com', password: 'x', firstName: 'Bea', lastName: 'Admin', role: 'ADMIN', locationId: 'store-c' } });
    expect((await api.post(`/api/organizations/${organizationId}/owners`).withAuth(token).withBody({ email: 'cashier@test.com' }).execute()).status).toBe(400);
    await api.post(`/api/organizations/${organizationId}/owners`).withAuth(token).withBody({ email: bea.email }).expectStatus(201).execute();
    expect(await prisma.userStoreAccess.findUnique({ where: { userId_locationId: { userId: bea.id, locationId: data.location.id } } })).toMatchObject({ role: 'ADMIN' });
    await api.delete(`/api/organizations/${organizationId}/owners/${bea.id}`).withAuth(token).expectSuccess();
    expect((await prisma.userStoreAccess.findMany({ where: { userId: bea.id } })).map(row => row.locationId)).toEqual(['store-c']);
  });

  it('sends an owner of several stores one morning brief, and each store\'s other admins their own', async () => {
    const bea = await prisma.user.create({ data: { email: 'bea@test.com', password: 'x', firstName: 'Bea', lastName: 'Admin', role: 'ADMIN', locationId: 'store-b' } });
    const yesterday = new Date(Date.UTC(2026, 10, 9, 16));
    await sell(data.location.id, 22, yesterday); await sell('store-b', 11, yesterday);
    const at8 = new Date(Date.UTC(2026, 10, 10, 14)); // 08:00 in Chicago

    expect(await runOwnerBriefSchedule(at8)).toBe(2);
    const deliveries = await prisma.emailDelivery.findMany({ orderBy: { recipientEmail: 'asc' } });
    expect(deliveries.map(row => [row.recipientEmail, row.idempotencyKey.split(':')[0]])).toEqual([['admin@test.com', 'brief-owner'], [bea.email, 'brief']]);
    const combined = deliveries[0];
    expect(combined.subject).toBe('Morning brief for your 2 stores: $33.00 | Monday, November 9, 2026');
    expect(combined.html).toContain('Second Store — Monday, November 9, 2026');
    expect(combined.html).toContain('Test Store — Monday, November 9, 2026');
    expect(deliveries[1].locationId).toBe('store-b');
    // Once per day for the owner too.
    resetOwnerBriefSchedule();
    expect(await runOwnerBriefSchedule(new Date(at8.getTime() + 3600000))).toBe(0);
  });
});
