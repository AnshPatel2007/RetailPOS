/**
 * Customer CRUD Integration Tests
 *
 * Tests customer operations with:
 * - Full request/response cycle
 * - Real database interactions
 * - Location isolation validation
 * - Input validation
 * - Error handling
 */

import { prisma, seedTestData, TestData } from './setup';
import { api, assertResponse, assertDatabase, loginUser } from './helpers';

describe('Customer CRUD Integration Tests', () => {
  let testData: TestData;
  let adminToken: string;
  let cashierToken: string;

  beforeEach(async () => {
    testData = await seedTestData();
    adminToken = await loginUser('admin@test.com', 'Admin123!');
    cashierToken = await loginUser('cashier@test.com', 'Admin123!');
  });

  describe('POST /api/customers', () => {
    it('should create customer with valid data', async () => {
      const customerData = {
        email: 'newcustomer@test.com',
        firstName: 'New',
        lastName: 'Customer',
        phone: '555-1234',
        address: '123 Main St',
        city: 'Test City',
        state: 'TS',
        zipCode: '12345',
      };

      const res = await api
        .post('/api/customers')
        .withAuth(adminToken)
        .withBody(customerData)
        .expectStatus(201)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.id).toBeDefined();
        expect(data.email).toBe(customerData.email);
        expect(data.firstName).toBe(customerData.firstName);
        expect(data.lastName).toBe(customerData.lastName);
        expect(data.locationId).toBe(testData.location.id);
      });

      // Verify in database
      await assertDatabase.exists(prisma.customer, {
        email: customerData.email,
        locationId: testData.location.id,
      });
    });

    it('should auto-assign locationId from authenticated user', async () => {
      const res = await api
        .post('/api/customers')
        .withAuth(cashierToken)
        .withBody({
          email: 'autocustomer@test.com',
          firstName: 'Auto',
          lastName: 'Customer',
          phone: '555-5555',
        })
        .expectStatus(201)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.locationId).toBe(testData.location.id);
      });
    });

    it('should fail with missing required fields', async () => {
      const res = await api
        .post('/api/customers')
        .withAuth(adminToken)
        .withBody({
          email: 'incomplete@test.com',
          // Missing firstName, lastName
        })
        .expectStatus(422)
        .execute();

      assertResponse.validationError(res);
    });

    it('should fail with invalid email format', async () => {
      const res = await api
        .post('/api/customers')
        .withAuth(adminToken)
        .withBody({
          email: 'invalid-email',
          firstName: 'Test',
          lastName: 'User',
        })
        .expectStatus(422)
        .execute();

      assertResponse.validationError(res);
    });

    it('should fail with duplicate email in same location', async () => {
      const res = await api
        .post('/api/customers')
        .withAuth(adminToken)
        .withBody({
          email: testData.customer.email,
          firstName: 'Duplicate',
          lastName: 'Customer',
        })
        .expectStatus(409)
        .execute();

      assertResponse.error(res, 'already exists');
    });

    it('should allow duplicate email in different location', async () => {
      // Create second location
      const location2 = await prisma.location.create({
        data: {
          id: 'test-location-2',
          name: 'Test Store 2',
          address: '789 Test Ave',
          city: 'Test City 2',
          state: 'TS',
          zipCode: '54321',
          phone: '555-0004',
          email: 'test2@store.com',
          timezone: 'America/New_York',
          isActive: true,
        },
      });

      // Create user for location 2
      const user2 = await prisma.user.create({
        data: {
          email: 'admin2@test.com',
          password: testData.adminUser.password,
          firstName: 'Admin',
          lastName: 'User 2',
          role: 'ADMIN',
          locationId: location2.id,
          isActive: true,
        },
      });

      const token2 = await loginUser('admin2@test.com', 'Admin123!');

      // Should allow same email in different location
      const res = await api
        .post('/api/customers')
        .withAuth(token2)
        .withBody({
          email: testData.customer.email, // Same email as location 1
          firstName: 'Location2',
          lastName: 'Customer',
        })
        .expectStatus(201)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.locationId).toBe(location2.id);
      });
    });
  });

  describe('GET /api/customers', () => {
    it('should list all customers for current location', async () => {
      // Create additional customers
      await prisma.customer.createMany({
        data: [
          {
            email: 'customer2@test.com',
            firstName: 'Customer',
            lastName: 'Two',
            locationId: testData.location.id,
          },
          {
            email: 'customer3@test.com',
            firstName: 'Customer',
            lastName: 'Three',
            locationId: testData.location.id,
          },
        ],
      });

      const res = await api
        .get('/api/customers')
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      assertResponse.paginated(res, { minItems: 3, hasData: true });

      // Verify all customers belong to same location
      res.body.data.forEach((customer: any) => {
        expect(customer.locationId).toBe(testData.location.id);
      });
    });

    it('should not show customers from other locations', async () => {
      // Create second location with customer
      const location2 = await prisma.location.create({
        data: {
          id: 'test-location-2',
          name: 'Test Store 2',
          address: '789 Test Ave',
          city: 'Test City 2',
          state: 'TS',
          zipCode: '54321',
          phone: '555-0004',
          email: 'test2@store.com',
          timezone: 'America/New_York',
          isActive: true,
        },
      });

      await prisma.customer.create({
        data: {
          email: 'location2customer@test.com',
          firstName: 'Location2',
          lastName: 'Customer',
          locationId: location2.id,
        },
      });

      const res = await api
        .get('/api/customers')
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      // Should only see location 1 customer
      assertResponse.success(res, (data) => {
        expect(data.length).toBe(1);
        expect(data[0].locationId).toBe(testData.location.id);
        expect(data[0].email).not.toBe('location2customer@test.com');
      });
    });

    it('should support search by email', async () => {
      const res = await api
        .get('/api/customers')
        .withAuth(adminToken)
        .withQuery({ search: testData.customer.email })
        .expectStatus(200)
        .execute();

      assertResponse.paginated(res, { minItems: 1 });
      expect(res.body.data[0].email).toBe(testData.customer.email);
    });

    it('should support pagination', async () => {
      // Create multiple customers
      await prisma.customer.createMany({
        data: Array.from({ length: 15 }, (_, i) => ({
          email: `customer${i}@test.com`,
          firstName: `Customer`,
          lastName: `${i}`,
          locationId: testData.location.id,
        })),
      });

      const res = await api
        .get('/api/customers')
        .withAuth(adminToken)
        .withQuery({ page: 1, limit: 10 })
        .expectStatus(200)
        .execute();

      assertResponse.paginated(res, { maxItems: 10 });
    });
  });

  describe('GET /api/customers/:id', () => {
    it('should get customer by id from same location', async () => {
      const res = await api
        .get(`/api/customers/${testData.customer.id}`)
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.id).toBe(testData.customer.id);
        expect(data.email).toBe(testData.customer.email);
        expect(data.locationId).toBe(testData.location.id);
      });
    });

    it('should not get customer from different location', async () => {
      // Create second location with customer
      const location2 = await prisma.location.create({
        data: {
          id: 'test-location-2',
          name: 'Test Store 2',
          address: '789 Test Ave',
          city: 'Test City 2',
          state: 'TS',
          zipCode: '54321',
          phone: '555-0004',
          email: 'test2@store.com',
          timezone: 'America/New_York',
          isActive: true,
        },
      });

      const customer2 = await prisma.customer.create({
        data: {
          email: 'location2customer@test.com',
          firstName: 'Location2',
          lastName: 'Customer',
          locationId: location2.id,
        },
      });

      const res = await api
        .get(`/api/customers/${customer2.id}`)
        .withAuth(adminToken)
        .expectStatus(404)
        .execute();

      assertResponse.notFound(res);
    });

    it('should return 404 for non-existent customer', async () => {
      const res = await api
        .get('/api/customers/00000000-0000-0000-0000-000000000000')
        .withAuth(adminToken)
        .expectStatus(404)
        .execute();

      assertResponse.notFound(res);
    });

    it('should fail with invalid UUID format', async () => {
      const res = await api
        .get('/api/customers/invalid-id')
        .withAuth(adminToken)
        .expectStatus(422)
        .execute();

      assertResponse.validationError(res);
    });
  });

  describe('PUT /api/customers/:id', () => {
    it('should update customer from same location', async () => {
      const updates = {
        firstName: 'Updated',
        lastName: 'Name',
        phone: '555-9999',
      };

      const res = await api
        .put(`/api/customers/${testData.customer.id}`)
        .withAuth(adminToken)
        .withBody(updates)
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.id).toBe(testData.customer.id);
        expect(data.firstName).toBe(updates.firstName);
        expect(data.lastName).toBe(updates.lastName);
        expect(data.phone).toBe(updates.phone);
      });

      // Verify in database
      const updated = await assertDatabase.exists(prisma.customer, {
        id: testData.customer.id,
      });
      expect(updated.firstName).toBe(updates.firstName);
    });

    it('should not update customer from different location', async () => {
      // Create second location
      const location2 = await prisma.location.create({
        data: {
          id: 'test-location-2',
          name: 'Test Store 2',
          address: '789 Test Ave',
          city: 'Test City 2',
          state: 'TS',
          zipCode: '54321',
          phone: '555-0004',
          email: 'test2@store.com',
          timezone: 'America/New_York',
          isActive: true,
        },
      });

      const customer2 = await prisma.customer.create({
        data: {
          email: 'location2customer@test.com',
          firstName: 'Location2',
          lastName: 'Customer',
          locationId: location2.id,
        },
      });

      const res = await api
        .put(`/api/customers/${customer2.id}`)
        .withAuth(adminToken)
        .withBody({ firstName: 'Hacked' })
        .expectStatus(404)
        .execute();

      assertResponse.notFound(res);

      // Verify not updated
      const unchanged = await prisma.customer.findUnique({
        where: { id: customer2.id },
      });
      expect(unchanged?.firstName).toBe('Location2');
    });

    it('should fail with invalid email format', async () => {
      const res = await api
        .put(`/api/customers/${testData.customer.id}`)
        .withAuth(adminToken)
        .withBody({ email: 'invalid-email' })
        .expectStatus(422)
        .execute();

      assertResponse.validationError(res);
    });
  });

  describe('DELETE /api/customers/:id', () => {
    it('should delete customer from same location', async () => {
      const res = await api
        .delete(`/api/customers/${testData.customer.id}`)
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      assertResponse.success(res);

      // Verify deleted
      await assertDatabase.notExists(prisma.customer, {
        id: testData.customer.id,
      });
    });

    it('should not delete customer from different location', async () => {
      // Create second location
      const location2 = await prisma.location.create({
        data: {
          id: 'test-location-2',
          name: 'Test Store 2',
          address: '789 Test Ave',
          city: 'Test City 2',
          state: 'TS',
          zipCode: '54321',
          phone: '555-0004',
          email: 'test2@store.com',
          timezone: 'America/New_York',
          isActive: true,
        },
      });

      const customer2 = await prisma.customer.create({
        data: {
          email: 'location2customer@test.com',
          firstName: 'Location2',
          lastName: 'Customer',
          locationId: location2.id,
        },
      });

      const res = await api
        .delete(`/api/customers/${customer2.id}`)
        .withAuth(adminToken)
        .expectStatus(404)
        .execute();

      assertResponse.notFound(res);

      // Verify not deleted
      await assertDatabase.exists(prisma.customer, { id: customer2.id });
    });

    it('should return 404 for non-existent customer', async () => {
      const res = await api
        .delete('/api/customers/00000000-0000-0000-0000-000000000000')
        .withAuth(adminToken)
        .expectStatus(404)
        .execute();

      assertResponse.notFound(res);
    });

    it('should allow cashier to delete customers', async () => {
      const res = await api
        .delete(`/api/customers/${testData.customer.id}`)
        .withAuth(cashierToken)
        .expectStatus(200)
        .execute();

      assertResponse.success(res);
    });
  });
});
