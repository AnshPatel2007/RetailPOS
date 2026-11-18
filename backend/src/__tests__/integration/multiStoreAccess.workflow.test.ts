/**
 * A person keeps a home store and may be given other stores. Each sign-in works in
 * one store at a time: everything they read and write is that store's, with their
 * role there. Losing access sends the session home; an open drawer blocks switching.
 */
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { api, loginUser } from './helpers';
import { hashDeviceToken } from '../../controllers/registerPin.controller';
import { organizationIdOf, syncOwnerAccess } from '../../services/organization.service';

const storeB = { id: 'test-location-2', name: 'Second Store', address: '2 Test St', city: 'Test', state: 'TS', zipCode: '12345',
  phone: '555-0102', email: 'second@store.com', timezone: 'America/Chicago' };

describe('working in more than one store', () => {
  let data: TestData;
  let owner: string;

  beforeEach(async () => {
    data = await seedTestData();
    // Store B belongs to the same business as the seeded store A.
    await prisma.location.create({ data: { ...storeB, organizationId: await organizationIdOf(data.location.id) } });
    await prisma.product.create({ data: { name: 'Store B Soda', sku: 'B-SODA', price: 2, cost: 1, stockQuantity: 10, locationId: storeB.id } });
    owner = await loginUser('admin@test.com', 'Admin123!');
  });

  const switchTo = (token: string, locationId: string) => api.post('/api/auth/switch-store').withAuth(token).withBody({ locationId }).execute();
  const skus = async (token: string) => (await api.get('/api/products').withAuth(token).withQuery({ limit: 100 }).expectSuccess()).body.data.map((p: { sku: string }) => p.sku);

  it('starts at home, reads and writes the switched-to store, and keeps it across a session refresh', async () => {
    await prisma.userStoreAccess.create({ data: { userId: data.adminUser.id, locationId: storeB.id, role: 'MANAGER' } });

    const me = (await api.get('/api/auth/me').withAuth(owner).expectSuccess()).body.data;
    expect(me).toMatchObject({ locationId: data.location.id, homeLocationId: data.location.id, role: 'ADMIN', organization: { storeCount: 2, isOwner: false } });
    expect(me.stores).toEqual([
      { locationId: data.location.id, name: 'Test Store', role: 'ADMIN', isActive: true, isHome: true, isCurrent: true },
      { locationId: storeB.id, name: 'Second Store', role: 'MANAGER', isActive: true, isHome: false, isCurrent: false },
    ]);
    expect(await skus(owner)).toContain('TEST-SKU-001');
    expect(await skus(owner)).not.toContain('B-SODA');

    const switched = await switchTo(owner, storeB.id);
    expect(switched.status).toBe(200);
    expect(switched.body.data.user).toMatchObject({ locationId: storeB.id, homeLocationId: data.location.id, role: 'MANAGER', location: { id: storeB.id, name: 'Second Store' } });
    expect(await skus(owner)).toEqual(['B-SODA']);

    // New records land in the store the session works in.
    const created = await api.post('/api/products').withAuth(owner).withBody({ name: 'Made at B', sku: 'B-NEW', price: 3, cost: 1, stockQuantity: 1 }).expectStatus(201).execute();
    expect(created.body.data.locationId).toBe(storeB.id);
    expect(await prisma.activityLog.findFirst({ where: { action: 'STORE_SWITCHED', userId: data.adminUser.id } }))
      .toMatchObject({ locationId: storeB.id, details: { fromLocationId: data.location.id } });

    // The access token is renewed from the same session, which still works in store B.
    const session = await prisma.refreshToken.findFirstOrThrow({ where: { userId: data.adminUser.id, activeLocationId: storeB.id } });
    const renewed = await request(app).post('/api/auth/refresh').send({ refreshToken: session.token }).expect(200);
    expect((await api.get('/api/auth/me').withAuth(renewed.body.data.token).expectSuccess()).body.data.locationId).toBe(storeB.id);

    // Back home: the session's store is cleared rather than pointing at the home store.
    expect((await switchTo(owner, data.location.id)).body.data.user).toMatchObject({ locationId: data.location.id, role: 'ADMIN' });
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: session.id } })).activeLocationId).toBeNull();
    expect(await skus(owner)).not.toContain('B-NEW');
  });

  it('uses the role at the store being worked in, and owners are ADMIN in every store of their business', async () => {
    await prisma.userStoreAccess.create({ data: { userId: data.adminUser.id, locationId: storeB.id, role: 'MANAGER' } });
    await api.get('/api/payroll').withAuth(owner).expectSuccess();
    await switchTo(owner, storeB.id);
    // ADMIN at home is only MANAGER here: owner-only pages stay closed.
    await api.get('/api/payroll').withAuth(owner).expectError(403);
    await api.get('/api/inventory-transfers').withAuth(owner).expectSuccess();

    const organizationId = await organizationIdOf(data.location.id);
    await prisma.organizationOwner.create({ data: { organizationId, userId: data.adminUser.id } });
    await prisma.$transaction(tx => syncOwnerAccess(tx, organizationId));
    await api.get('/api/payroll').withAuth(owner).expectSuccess();
    expect((await api.get('/api/auth/me').withAuth(owner).expectSuccess()).body.data.organization).toMatchObject({ storeCount: 2, isOwner: true });

    // Stores of one business may send each other stock without a separate link.
    const options = (await api.get('/api/inventory-transfers/options').withAuth(owner).expectSuccess()).body.data;
    expect(options.destinations.map((store: { id: string }) => store.id)).toEqual([data.location.id]);
  });

  it('refuses stores without access, platform admins, and switching with an open drawer', async () => {
    const outside = await prisma.location.create({ data: { ...storeB, id: 'test-location-3', name: 'Other Business', email: 'other@store.com' } });
    const refused = await switchTo(owner, outside.id);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('You do not have access to that store.');

    await prisma.userStoreAccess.create({ data: { userId: data.adminUser.id, locationId: storeB.id, role: 'MANAGER' } });
    await switchTo(owner, storeB.id);
    const shift = await api.post('/api/shifts/clock-in').withAuth(owner).withBody({ startingCash: 100 }).expectStatus(201).execute();
    // The drawer opens in store B, under store B's pay rules.
    expect(await prisma.shift.findUniqueOrThrow({ where: { id: shift.body.data.id } })).toMatchObject({ locationId: storeB.id, payrollTimezone: 'America/Chicago' });
    const blocked = await switchTo(owner, data.location.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('Clock out before switching stores.');
    await prisma.shift.update({ where: { id: shift.body.data.id }, data: { isClosed: true, clockOutAt: new Date() } });
    expect((await switchTo(owner, data.location.id)).status).toBe(200);

    await prisma.user.create({ data: { email: 'platform@test.com', password: await bcrypt.hash('Platform123!', 4), firstName: 'Platform', lastName: 'Admin', role: 'SUPER_ADMIN' } });
    const platform = await loginUser('platform@test.com', 'Platform123!');
    const platformSwitch = await switchTo(platform, storeB.id);
    expect(platformSwitch.status).toBe(403);
    expect((await api.get('/api/auth/stores').withAuth(platform).expectSuccess()).body.data).toEqual([]);
  });

  it('sends the session home when access to the other store is removed', async () => {
    const access = await prisma.userStoreAccess.create({ data: { userId: data.adminUser.id, locationId: storeB.id, role: 'MANAGER' } });
    await switchTo(owner, storeB.id);
    await prisma.userStoreAccess.delete({ where: { id: access.id } });

    const ended = await api.post('/api/products').withAuth(owner).withBody({ name: 'Too late', sku: 'B-LATE', price: 1, cost: 1, stockQuantity: 1 }).expectError(403);
    expect(ended.body.details).toEqual({ code: 'STORE_ACCESS_ENDED' });
    expect(await prisma.product.count({ where: { sku: 'B-LATE' } })).toBe(0);
    // The same sign-in continues at home.
    expect((await api.get('/api/auth/me').withAuth(owner).expectSuccess()).body.data).toMatchObject({ locationId: data.location.id, role: 'ADMIN' });
    expect((await api.get('/api/auth/stores').withAuth(owner).expectSuccess()).body.data.map((s: { locationId: string }) => s.locationId)).toEqual([data.location.id]);
  });

  it('lets staff with access to a store sign in on its register with a PIN, working in that store', async () => {
    await prisma.userStoreAccess.create({ data: { userId: data.cashierUser.id, locationId: storeB.id, role: 'CASHIER' } });
    await prisma.user.update({ where: { id: data.cashierUser.id }, data: { pinHash: await bcrypt.hash('4821', 4) } });
    const deviceToken = 'b'.repeat(43);
    await prisma.registerDevice.create({ data: { locationId: storeB.id, name: 'B Front', tokenHash: hashDeviceToken(deviceToken) } });

    const staff = (await api.post('/api/auth/register-staff').withBody({ deviceToken }).expectSuccess()).body.data.staff;
    expect(staff).toEqual([{ id: data.cashierUser.id, name: 'Cashier U.', role: 'CASHIER' }]);

    const signedIn = (await api.post('/api/auth/pin-login').withBody({ deviceToken, userId: data.cashierUser.id, pin: '4821' }).expectSuccess()).body.data;
    expect(signedIn.user).toMatchObject({ locationId: storeB.id, homeLocationId: data.location.id, role: 'CASHIER' });
    expect(await skus(signedIn.token)).toEqual(['B-SODA']);
    expect(await prisma.activityLog.findFirst({ where: { action: 'LOGIN', userId: data.cashierUser.id }, orderBy: { createdAt: 'desc' } })).toMatchObject({ locationId: storeB.id });

    // Without that access the person is not on store B's register.
    await prisma.userStoreAccess.deleteMany({ where: { userId: data.cashierUser.id, locationId: storeB.id } });
    expect((await api.post('/api/auth/register-staff').withBody({ deviceToken }).expectSuccess()).body.data.staff).toEqual([]);
    await api.post('/api/auth/pin-login').withBody({ deviceToken, userId: data.cashierUser.id, pin: '4821' }).expectError(401);
  });

  it('accepts a manager approval from someone who manages the store without it being their home', async () => {
    const approver = await prisma.user.create({ data: { email: 'roaming@test.com', password: await bcrypt.hash('Manager123!', 4), firstName: 'Roaming', lastName: 'Manager', role: 'CASHIER', locationId: storeB.id } });
    const cashier = await loginUser('cashier@test.com', 'Admin123!');
    const body = { email: 'roaming@test.com', password: 'Manager123!', reason: 'Customer return', request: { method: 'POST', path: '/api/sales/x/refund', body: {} } };
    // A cashier at their home store cannot approve here...
    await api.post('/api/approvals').withAuth(cashier).withBody(body).expectError(403);
    // ...a manager of this store can, wherever their home is.
    await prisma.userStoreAccess.create({ data: { userId: approver.id, locationId: data.location.id, role: 'MANAGER' } });
    await api.post('/api/approvals').withAuth(cashier).withBody(body).expectStatus(201).execute();
  });
});
