/**
 * Every store belongs to an organization, and who may work in which store is kept
 * as access rows. The database keeps both true on its own (triggers), whichever code
 * path creates a store or changes a person's home store or role; owners get ADMIN
 * access to every store of their organization.
 */
import bcrypt from 'bcryptjs';
import { prisma, seedTestData, TestData } from './setup';
import { api, createTestToken } from './helpers';
import { isOwner, organizationIdOf, syncOwnerAccess } from '../../services/organization.service';

const storeFields = (name: string) => ({ name, address: '1 Main St', city: 'Test', state: 'TS', zipCode: '12345', phone: '555-0100', email: name.toLowerCase().replace(/ /g, '') + '@store.test' });
const accessOf = (userId: string) => prisma.userStoreAccess.findMany({ where: { userId }, select: { locationId: true, role: true }, orderBy: { locationId: 'asc' } });

describe('organizations and store access', () => {
  let data: TestData;

  beforeEach(async () => {
    data = await seedTestData();
  });

  it('gives a store created without an organization its own, named after the store', async () => {
    const store = await prisma.location.findUniqueOrThrow({ where: { id: data.location.id }, include: { organization: true } });
    expect(store.organization).toMatchObject({ id: store.organizationId, name: 'Test Store' });
    expect(await organizationIdOf(store.id)).toBe(store.organizationId);

    const second = await prisma.location.create({ data: storeFields('Second Store') });
    expect(second.organizationId).toBeTruthy();
    expect(second.organizationId).not.toBe(store.organizationId);
    expect(await prisma.organization.count()).toBe(2);

    // Taking a store out of its organization gives it a new one of its own; it is never left without.
    const moved = await prisma.location.update({ where: { id: second.id }, data: { organizationId: null } });
    expect(moved.organizationId).toBeTruthy();
    expect(moved.organizationId).not.toBe(second.organizationId);
    await expect(organizationIdOf('no-such-store')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('keeps each person\'s home store access in step with their store and role', async () => {
    expect(await accessOf(data.adminUser.id)).toEqual([{ locationId: data.location.id, role: 'ADMIN' }]);
    expect(await accessOf(data.cashierUser.id)).toEqual([{ locationId: data.location.id, role: 'CASHIER' }]);

    // A role change at home changes the role there.
    await prisma.user.update({ where: { id: data.cashierUser.id }, data: { role: 'MANAGER' } });
    expect(await accessOf(data.cashierUser.id)).toEqual([{ locationId: data.location.id, role: 'MANAGER' }]);

    // Moving to another store moves the access row; access granted elsewhere stays.
    const second = await prisma.location.create({ data: storeFields('Second Store') });
    const third = await prisma.location.create({ data: storeFields('Third Store') });
    await prisma.userStoreAccess.create({ data: { userId: data.cashierUser.id, locationId: third.id, role: 'CASHIER' } });
    await prisma.user.update({ where: { id: data.cashierUser.id }, data: { locationId: second.id } });
    expect(await accessOf(data.cashierUser.id)).toEqual(
      [{ locationId: second.id, role: 'MANAGER' }, { locationId: third.id, role: 'CASHIER' }].sort((a, b) => a.locationId.localeCompare(b.locationId)));

    // A new home where access was already granted takes the home role.
    await prisma.user.update({ where: { id: data.cashierUser.id }, data: { locationId: third.id } });
    expect(await accessOf(data.cashierUser.id)).toEqual([{ locationId: third.id, role: 'MANAGER' }]);

    // New people get their home row on creation; platform admins get none.
    const hire = await prisma.user.create({ data: { email: 'hire@test.com', password: 'x', firstName: 'New', lastName: 'Hire', role: 'CASHIER', locationId: second.id } });
    expect(await accessOf(hire.id)).toEqual([{ locationId: second.id, role: 'CASHIER' }]);
    const platform = await prisma.user.create({ data: { email: 'platform@test.com', password: 'x', firstName: 'Platform', lastName: 'Admin', role: 'SUPER_ADMIN' } });
    expect(await accessOf(platform.id)).toEqual([]);
    await prisma.user.update({ where: { id: hire.id }, data: { role: 'SUPER_ADMIN' } });
    expect(await accessOf(hire.id)).toEqual([]);
    // Unrelated edits leave access alone.
    await prisma.user.update({ where: { id: data.adminUser.id }, data: { firstName: 'Renamed', isActive: false } });
    expect(await accessOf(data.adminUser.id)).toEqual([{ locationId: data.location.id, role: 'ADMIN' }]);
  });

  it('gives owners ADMIN access to every store of their organization, including new ones', async () => {
    const organizationId = await organizationIdOf(data.location.id);
    await prisma.organizationOwner.create({ data: { organizationId, userId: data.adminUser.id } });
    expect(await isOwner(data.adminUser.id, organizationId)).toBe(true);
    expect(await isOwner(data.cashierUser.id, organizationId)).toBe(false);

    const platform = await prisma.user.create({ data: { email: 'platform@test.com', password: await bcrypt.hash('Platform123!', 4), firstName: 'Platform', lastName: 'Admin', role: 'SUPER_ADMIN' } });
    const token = await createTestToken(platform.id, 'SUPER_ADMIN');

    const joined = await api.post('/api/locations').withAuth(token).withBody({ ...storeFields('Second Store'), organizationId }).expectStatus(201).execute();
    expect(joined.body.data.organizationId).toBe(organizationId);
    expect(await prisma.userStoreAccess.findUnique({ where: { userId_locationId: { userId: data.adminUser.id, locationId: joined.body.data.id } } }))
      .toMatchObject({ role: 'ADMIN', createdById: platform.id });
    // Owners only: the cashier of the first store gains nothing.
    expect(await accessOf(data.cashierUser.id)).toEqual([{ locationId: data.location.id, role: 'CASHIER' }]);

    const separate = await api.post('/api/locations').withAuth(token).withBody(storeFields('Other Business')).expectStatus(201).execute();
    expect(separate.body.data.organizationId).not.toBe(organizationId);
    expect(await prisma.organization.findUnique({ where: { id: separate.body.data.organizationId } })).toMatchObject({ name: 'Other Business' });
    expect(await prisma.userStoreAccess.count({ where: { locationId: separate.body.data.id } })).toBe(0);

    const before = await prisma.location.count();
    const unknown = await api.post('/api/locations').withAuth(token).withBody({ ...storeFields('Nowhere'), organizationId: 'no-such-organization' }).expectError(404);
    expect(unknown.body.error).toBe('Organization not found');
    expect(await prisma.location.count()).toBe(before);
  });

  it('raises an owner\'s lower role to ADMIN, skips platform admins and keeps owner access when the home store moves', async () => {
    const organizationId = await organizationIdOf(data.location.id);
    const second = await prisma.location.create({ data: { ...storeFields('Second Store'), organizationId } });
    const owner = await prisma.user.create({ data: { email: 'owner@test.com', password: 'x', firstName: 'Store', lastName: 'Owner', role: 'MANAGER', locationId: second.id } });
    const platform = await prisma.user.create({ data: { email: 'platform@test.com', password: 'x', firstName: 'Platform', lastName: 'Admin', role: 'SUPER_ADMIN' } });
    await prisma.organizationOwner.createMany({ data: [{ organizationId, userId: owner.id }, { organizationId, userId: platform.id }] });

    const result = await prisma.$transaction(tx => syncOwnerAccess(tx, organizationId));
    expect(result).toEqual({ granted: 1, raised: 1 });
    expect(await accessOf(owner.id)).toEqual(
      [{ locationId: data.location.id, role: 'ADMIN' }, { locationId: second.id, role: 'ADMIN' }].sort((a, b) => a.locationId.localeCompare(b.locationId)));
    expect(await accessOf(platform.id)).toEqual([]);
    // Running it again changes nothing.
    expect(await prisma.$transaction(tx => syncOwnerAccess(tx, organizationId))).toEqual({ granted: 0, raised: 0 });

    // An owner whose home moves within the organization keeps ADMIN access to the old home store.
    await prisma.user.update({ where: { id: owner.id }, data: { locationId: data.location.id, role: 'ADMIN' } });
    expect(await accessOf(owner.id)).toEqual(
      [{ locationId: data.location.id, role: 'ADMIN' }, { locationId: second.id, role: 'ADMIN' }].sort((a, b) => a.locationId.localeCompare(b.locationId)));
  });
});
