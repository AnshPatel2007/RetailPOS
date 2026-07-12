/**
 * Customer API Integration Tests
 *
 * Full request/response cycle against a real (test) database:
 * - CRUD, search, validation, soft delete
 * - Phone lookup (exact + partial digits)
 */

import { prisma, seedTestData, TestData } from './setup';
import { api, assertResponse, loginUser } from './helpers';

describe('Customer API Integration Tests', () => {
  let testData: TestData;
  let adminToken: string;

  beforeEach(async () => {
    testData = await seedTestData();
    adminToken = await loginUser('admin@test.com', 'Admin123!');
  });

  describe('GET /api/customers', () => {
    it('should return paginated customers', async () => {
      const res = await api
        .get('/api/customers')
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      assertResponse.paginated(res, { hasData: true });
      expect(res.body.data[0].email).toBe('customer@test.com');
      expect(res.body.pagination.total).toBe(1);
    });

    it('should filter by search term', async () => {
      await prisma.customer.create({
        data: { firstName: 'Alice', lastName: 'Wonder', phone: '555-9999' },
      });

      const res = await api
        .get('/api/customers')
        .withAuth(adminToken)
        .withQuery({ search: 'Alice' })
        .expectStatus(200)
        .execute();

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].firstName).toBe('Alice');
    });

    it('should require authentication', async () => {
      const res = await api.get('/api/customers').expectStatus(401).execute();
      assertResponse.unauthorized(res);
    });
  });

  describe('GET /api/customers/:id', () => {
    it('should return a customer with recent sales', async () => {
      const res = await api
        .get(`/api/customers/${testData.customer.id}`)
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.id).toBe(testData.customer.id);
        expect(data.sales).toBeDefined();
      });
    });

    it('should 404 for unknown customer', async () => {
      const res = await api
        .get('/api/customers/00000000-0000-4000-8000-000000000000')
        .withAuth(adminToken)
        .expectStatus(404)
        .execute();

      assertResponse.notFound(res);
    });
  });

  describe('POST /api/customers', () => {
    it('should create a customer', async () => {
      const res = await api
        .post('/api/customers')
        .withAuth(adminToken)
        .withBody({
          firstName: 'New',
          lastName: 'Person',
          email: 'new.person@test.com',
          phone: '555-7777',
        })
        .expectStatus(201)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.email).toBe('new.person@test.com');
      });

      const inDb = await prisma.customer.findUnique({
        where: { email: 'new.person@test.com' },
      });
      expect(inDb).not.toBeNull();
    });

    it('should reject duplicate email', async () => {
      const res = await api
        .post('/api/customers')
        .withAuth(adminToken)
        .withBody({
          firstName: 'Dupe',
          lastName: 'Email',
          email: 'customer@test.com', // seeded customer's email
          phone: '555-8888',
        })
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'already exists');
    });
  });

  describe('PUT /api/customers/:id', () => {
    it('should update a customer', async () => {
      const res = await api
        .put(`/api/customers/${testData.customer.id}`)
        .withAuth(adminToken)
        .withBody({ firstName: 'Renamed' })
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.firstName).toBe('Renamed');
      });
    });

    it('should 404 when updating an unknown customer', async () => {
      const res = await api
        .put('/api/customers/00000000-0000-4000-8000-000000000000')
        .withAuth(adminToken)
        .withBody({ firstName: 'Ghost' })
        .expectStatus(404)
        .execute();

      assertResponse.notFound(res);
    });
  });

  describe('DELETE /api/customers/:id', () => {
    it('should soft-delete a customer (record kept, inactive, hidden from list)', async () => {
      await api
        .delete(`/api/customers/${testData.customer.id}`)
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      // Still in the database, but inactive
      const inDb = await prisma.customer.findUnique({
        where: { id: testData.customer.id },
      });
      expect(inDb).not.toBeNull();
      expect(inDb!.isActive).toBe(false);

      // No longer listed
      const listRes = await api
        .get('/api/customers')
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();
      expect(listRes.body.data).toHaveLength(0);
    });
  });

  describe('GET /api/customers/search/phone', () => {
    it('should find a customer by exact phone', async () => {
      const res = await api
        .get('/api/customers/search/phone')
        .withAuth(adminToken)
        .withQuery({ phone: '555-0003' })
        .expectStatus(200)
        .execute();

      expect(res.body.success).toBe(true);
      expect(res.body.data?.id).toBe(testData.customer.id);
    });

    it('should find a customer by partial digits (formatting-insensitive)', async () => {
      const res = await api
        .get('/api/customers/search/phone')
        .withAuth(adminToken)
        .withQuery({ phone: '5550003' }) // digits only, stored as 555-0003
        .expectStatus(200)
        .execute();

      expect(res.body.data?.id).toBe(testData.customer.id);
    });

    it('should return null when the partial match is ambiguous', async () => {
      await prisma.customer.create({
        data: { firstName: 'Second', lastName: 'Match', phone: '555-0103' },
      });

      const res = await api
        .get('/api/customers/search/phone')
        .withAuth(adminToken)
        .withQuery({ phone: '555' }) // matches both customers
        .expectStatus(200)
        .execute();

      expect(res.body.data).toBeNull();
    });
  });
});
