/**
 * User Management Integration Tests
 *
 * An admin can create/edit/reset/deactivate managers and cashiers at their own
 * store — but never another admin/super-admin account, never assign an admin
 * role, and never touch a different location. Super-admin is unrestricted.
 */

import { prisma, seedTestData, TestData } from './setup';
import { api, assertResponse, loginUser } from './helpers';

describe('User Management Integration Tests', () => {
  let testData: TestData;
  let adminToken: string;

  const STRONG_PW = 'Str0ng!Pass';

  beforeEach(async () => {
    testData = await seedTestData();
    adminToken = await loginUser('admin@test.com', 'Admin123!');
  });

  describe('Admin creating staff', () => {
    it('should let an admin create a cashier and a manager at their own store', async () => {
      const cashier = await api
        .post('/api/users')
        .withAuth(adminToken)
        .withBody({
          firstName: 'New', lastName: 'Cashier', email: 'newcashier@test.com',
          password: STRONG_PW, role: 'CASHIER',
        })
        .expectStatus(201)
        .execute();
      expect(cashier.body.data.locationId).toBe(testData.location.id);
      expect(cashier.body.data.role).toBe('CASHIER');

      const manager = await api
        .post('/api/users')
        .withAuth(adminToken)
        .withBody({
          firstName: 'New', lastName: 'Manager', email: 'newmanager@test.com',
          password: STRONG_PW, role: 'MANAGER',
        })
        .expectStatus(201)
        .execute();
      expect(manager.body.data.locationId).toBe(testData.location.id);
      expect(manager.body.data.role).toBe('MANAGER');
    });

    it('should reject an admin creating another admin or super-admin', async () => {
      const asAdmin = await api
        .post('/api/users')
        .withAuth(adminToken)
        .withBody({
          firstName: 'Sneaky', lastName: 'Admin', email: 'sneakyadmin@test.com',
          password: STRONG_PW, role: 'ADMIN',
        })
        .expectStatus(403)
        .execute();
      assertResponse.error(asAdmin, 'Only super-admin');

      const asSuperAdmin = await api
        .post('/api/users')
        .withAuth(adminToken)
        .withBody({
          firstName: 'Sneaky', lastName: 'Super', email: 'sneakysuper@test.com',
          password: STRONG_PW, role: 'SUPER_ADMIN',
        })
        .expectStatus(403)
        .execute();
      assertResponse.error(asSuperAdmin, 'Only super-admin');
    });

    it('should reject an admin creating a user for a different store', async () => {
      const otherLocation = await prisma.location.create({
        data: {
          name: 'Other Store', address: '1 Other St', city: 'Elsewhere', state: 'OS',
          zipCode: '99999', phone: '555-9999', email: 'other@store.com',
        },
      });

      const res = await api
        .post('/api/users')
        .withAuth(adminToken)
        .withBody({
          firstName: 'Cross', lastName: 'Store', email: 'crossstore@test.com',
          password: STRONG_PW, role: 'CASHIER', locationId: otherLocation.id,
        })
        .expectStatus(403)
        .execute();
      assertResponse.error(res, 'own location');
    });
  });

  describe('Admin editing staff', () => {
    it('should let an admin edit and deactivate their own cashier', async () => {
      const updated = await api
        .put(`/api/users/${testData.cashierUser.id}`)
        .withAuth(adminToken)
        .withBody({ firstName: 'Renamed', isActive: true, role: 'CASHIER' })
        .expectStatus(200)
        .execute();
      expect(updated.body.data.firstName).toBe('Renamed');

      await api
        .delete(`/api/users/${testData.cashierUser.id}`)
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      const check = await prisma.user.findUnique({ where: { id: testData.cashierUser.id } });
      expect(check!.isActive).toBe(false);
    });

    it('should let an admin reset a cashier password and the new password works', async () => {
      await api
        .post(`/api/users/${testData.cashierUser.id}/reset-password`)
        .withAuth(adminToken)
        .withBody({ newPassword: STRONG_PW })
        .expectStatus(200)
        .execute();

      await loginUser('cashier@test.com', STRONG_PW); // throws if login fails
    });

    it('should reject an admin promoting a cashier to admin or super-admin', async () => {
      const toAdmin = await api
        .put(`/api/users/${testData.cashierUser.id}`)
        .withAuth(adminToken)
        .withBody({ role: 'ADMIN' })
        .expectStatus(403)
        .execute();
      assertResponse.error(toAdmin, 'Only super-admin');

      const stillCashier = await prisma.user.findUnique({ where: { id: testData.cashierUser.id } });
      expect(stillCashier!.role).toBe('CASHIER');
    });

    it('should reject an admin moving a cashier to a different store', async () => {
      const otherLocation = await prisma.location.create({
        data: {
          name: 'Other Store', address: '1 Other St', city: 'Elsewhere', state: 'OS',
          zipCode: '99999', phone: '555-9999', email: 'other2@store.com',
        },
      });

      const res = await api
        .put(`/api/users/${testData.cashierUser.id}`)
        .withAuth(adminToken)
        .withBody({ locationId: otherLocation.id })
        .expectStatus(403)
        .execute();
      assertResponse.error(res, 'own location');
    });

    it('should reject an admin modifying, resetting, or deactivating another admin account', async () => {
      const otherAdmin = await prisma.user.create({
        data: {
          email: 'otheradmin@test.com',
          password: testData.adminUser.password,
          firstName: 'Other', lastName: 'Admin',
          role: 'ADMIN', locationId: testData.location.id, isActive: true,
        },
      });

      const editRes = await api
        .put(`/api/users/${otherAdmin.id}`)
        .withAuth(adminToken)
        .withBody({ firstName: 'Hacked' })
        .expectStatus(403)
        .execute();
      assertResponse.error(editRes, 'Only super-admin');

      const resetRes = await api
        .post(`/api/users/${otherAdmin.id}/reset-password`)
        .withAuth(adminToken)
        .withBody({ newPassword: STRONG_PW })
        .expectStatus(403)
        .execute();
      assertResponse.error(resetRes, 'Only super-admin');

      const deleteRes = await api
        .delete(`/api/users/${otherAdmin.id}`)
        .withAuth(adminToken)
        .expectStatus(403)
        .execute();
      assertResponse.error(deleteRes, 'Only super-admin');
    });

    it('should reject a cashier or manager creating/editing any user', async () => {
      const cashierToken = await loginUser('cashier@test.com', 'Admin123!');
      await api
        .post('/api/users')
        .withAuth(cashierToken)
        .withBody({ firstName: 'X', lastName: 'Y', email: 'xy@test.com', password: STRONG_PW, role: 'CASHIER' })
        .expectStatus(403)
        .execute();
    });
  });

  describe('Super-admin is unrestricted', () => {
    it('should let super-admin create an admin, move users across stores, and modify admin accounts', async () => {
      const superAdmin = await prisma.user.create({
        data: {
          email: 'superadmin@test.com',
          password: testData.adminUser.password,
          firstName: 'Super', lastName: 'Admin',
          role: 'SUPER_ADMIN', locationId: null, isActive: true,
        },
      });
      const superToken = await loginUser('superadmin@test.com', 'Admin123!');
      void superAdmin;

      const otherLocation = await prisma.location.create({
        data: {
          name: 'Other Store', address: '1 Other St', city: 'Elsewhere', state: 'OS',
          zipCode: '99999', phone: '555-9999', email: 'other3@store.com',
        },
      });

      // Create an admin for the other store
      const newAdmin = await api
        .post('/api/users')
        .withAuth(superToken)
        .withBody({
          firstName: 'Branch', lastName: 'Admin', email: 'branchadmin@test.com',
          password: STRONG_PW, role: 'ADMIN', locationId: otherLocation.id,
        })
        .expectStatus(201)
        .execute();
      expect(newAdmin.body.data.role).toBe('ADMIN');
      expect(newAdmin.body.data.locationId).toBe(otherLocation.id);

      // Move the seeded cashier to the other store
      const moved = await api
        .put(`/api/users/${testData.cashierUser.id}`)
        .withAuth(superToken)
        .withBody({ locationId: otherLocation.id })
        .expectStatus(200)
        .execute();
      expect(moved.body.data.locationId).toBe(otherLocation.id);

      // Edit the original admin account directly
      const editedAdmin = await api
        .put(`/api/users/${testData.adminUser.id}`)
        .withAuth(superToken)
        .withBody({ firstName: 'Renamed' })
        .expectStatus(200)
        .execute();
      expect(editedAdmin.body.data.firstName).toBe('Renamed');
    });
  });
});
