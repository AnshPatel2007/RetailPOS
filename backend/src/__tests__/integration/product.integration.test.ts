/**
 * Product API Integration Tests
 *
 * Full request/response cycle against a real (test) database:
 * - CRUD, pagination/search, duplicate SKU protection
 * - Inventory adjustment with audit log
 * - Low-stock reporting
 */

import { prisma, seedTestData, TestData } from './setup';
import { api, assertResponse, loginUser } from './helpers';

describe('Product API Integration Tests', () => {
  let testData: TestData;
  let adminToken: string;

  beforeEach(async () => {
    testData = await seedTestData();
    adminToken = await loginUser('admin@test.com', 'Admin123!');
  });

  describe('GET /api/products', () => {
    it('should return paginated products', async () => {
      const res = await api
        .get('/api/products')
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      assertResponse.paginated(res, { hasData: true });
      expect(res.body.data[0].sku).toBe('TEST-SKU-001');
    });

    it('should filter by search term', async () => {
      await prisma.product.create({
        data: {
          name: 'Unique Widget',
          sku: 'WIDGET-001',
          price: 5.0,
          cost: 2.0,
          stockQuantity: 10,
          locationId: testData.location.id,
        },
      });

      const res = await api
        .get('/api/products')
        .withAuth(adminToken)
        .withQuery({ search: 'Widget' })
        .expectStatus(200)
        .execute();

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].sku).toBe('WIDGET-001');
    });
  });

  describe('GET /api/products/:id', () => {
    it('should return a single product', async () => {
      const res = await api
        .get(`/api/products/${testData.product.id}`)
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.id).toBe(testData.product.id);
        expect(data.price).toBe(19.99);
      });
    });

    it('should 404 for unknown product', async () => {
      const res = await api
        .get('/api/products/00000000-0000-4000-8000-000000000000')
        .withAuth(adminToken)
        .expectStatus(404)
        .execute();

      assertResponse.notFound(res);
    });
  });

  describe('POST /api/products', () => {
    it('should create a product', async () => {
      const res = await api
        .post('/api/products')
        .withAuth(adminToken)
        .withBody({
          name: 'Created Product',
          sku: 'CREATED-001',
          price: 12.5,
          cost: 6.0,
          stockQuantity: 25,
        })
        .expectStatus(201)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.sku).toBe('CREATED-001');
      });

      const inDb = await prisma.product.findFirst({ where: { sku: 'CREATED-001' } });
      expect(inDb).not.toBeNull();
      expect(inDb!.stockQuantity).toBe(25);
    });

    it('should reject a duplicate SKU', async () => {
      const res = await api
        .post('/api/products')
        .withAuth(adminToken)
        .withBody({
          name: 'Duplicate SKU Product',
          sku: 'TEST-SKU-001', // seeded product's SKU
          price: 10,
          cost: 5,
        })
        .expectStatus(400)
        .execute();

      assertResponse.error(res);
    });

    it('should reject invalid payloads', async () => {
      const res = await api
        .post('/api/products')
        .withAuth(adminToken)
        .withBody({ name: 'No SKU or price' })
        .expectStatus(400)
        .execute();

      assertResponse.validationError(res);
    });
  });

  describe('PUT /api/products/:id', () => {
    it('should update product price', async () => {
      const res = await api
        .put(`/api/products/${testData.product.id}`)
        .withAuth(adminToken)
        .withBody({ price: 24.99 })
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.price).toBe(24.99);
      });
    });
  });

  describe('DELETE /api/products/:id', () => {
    it('should delete a product', async () => {
      // Fresh product with no sale history
      const product = await prisma.product.create({
        data: {
          name: 'Disposable',
          sku: 'DISPOSABLE-001',
          price: 1.0,
          cost: 0.5,
          stockQuantity: 1,
          locationId: testData.location.id,
        },
      });

      await api
        .delete(`/api/products/${product.id}`)
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      const inDb = await prisma.product.findUnique({ where: { id: product.id } });
      expect(inDb).toBeNull();
    });
  });

  describe('POST /api/products/:id/adjust-inventory', () => {
    it('should adjust stock and write an inventory log', async () => {
      const res = await api
        .post(`/api/products/${testData.product.id}/adjust-inventory`)
        .withAuth(adminToken)
        .withBody({ quantity: -10, type: 'ADJUSTMENT', notes: 'Damaged goods' })
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.stockQuantity).toBe(90); // 100 - 10
      });

      const log = await prisma.inventoryLog.findFirst({
        where: { productId: testData.product.id, type: 'ADJUSTMENT' },
      });
      expect(log).not.toBeNull();
      expect(log!.quantity).toBe(-10);
      expect(log!.previousQty).toBe(100);
      expect(log!.newQty).toBe(90);
    });

    it('should reject adjustments that would go negative', async () => {
      const res = await api
        .post(`/api/products/${testData.product.id}/adjust-inventory`)
        .withAuth(adminToken)
        .withBody({ quantity: -500 })
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'Insufficient stock');
    });
  });

  describe('GET /api/products/low-stock', () => {
    it('should report products at or below their low-stock alert', async () => {
      await prisma.product.update({
        where: { id: testData.product.id },
        data: { stockQuantity: 5 }, // lowStockAlert defaults to 10
      });

      const res = await api
        .get('/api/products/low-stock')
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(Array.isArray(data)).toBe(true);
        expect(data.some((p: any) => p.id === testData.product.id)).toBe(true);
      });
    });

    it('should not report healthy stock', async () => {
      const res = await api
        .get('/api/products/low-stock')
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      expect(res.body.data.some((p: any) => p.id === testData.product.id)).toBe(false);
    });
  });
});
