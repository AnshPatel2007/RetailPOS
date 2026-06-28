/**
 * Product CRUD Integration Tests
 *
 * Tests product operations with:
 * - Location isolation
 * - Category and supplier relationships
 * - Inventory tracking
 * - Stock level validation
 */

import { prisma, seedTestData, TestData } from './setup';
import { api, assertResponse, assertDatabase, loginUser } from './helpers';

describe('Product CRUD Integration Tests', () => {
  let testData: TestData;
  let adminToken: string;
  let cashierToken: string;

  beforeEach(async () => {
    testData = await seedTestData();
    adminToken = await loginUser('admin@test.com', 'Admin123!');
    cashierToken = await loginUser('cashier@test.com', 'Admin123!');
  });

  describe('POST /api/products', () => {
    it('should create product with valid data', async () => {
      const productData = {
        name: 'New Product',
        sku: 'NEW-SKU-001',
        barcode: '9876543210',
        price: 29.99,
        cost: 15.00,
        quantity: 50,
        categoryId: testData.category.id,
        supplierId: testData.supplier.id,
        isActive: true,
      };

      const res = await api
        .post('/api/products')
        .withAuth(adminToken)
        .withBody(productData)
        .expectStatus(201)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.id).toBeDefined();
        expect(data.name).toBe(productData.name);
        expect(data.sku).toBe(productData.sku);
        expect(data.price).toBe(productData.price);
        expect(data.locationId).toBe(testData.location.id);
        expect(data.category).toBeDefined();
        expect(data.supplier).toBeDefined();
      });

      // Verify in database
      await assertDatabase.exists(prisma.product, {
        sku: productData.sku,
        locationId: testData.location.id,
      });
    });

    it('should auto-assign locationId from authenticated user', async () => {
      const res = await api
        .post('/api/products')
        .withAuth(cashierToken)
        .withBody({
          name: 'Auto Product',
          sku: 'AUTO-SKU-001',
          price: 19.99,
          cost: 10.00,
          quantity: 25,
          categoryId: testData.category.id,
        })
        .expectStatus(201)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.locationId).toBe(testData.location.id);
      });
    });

    it('should fail with duplicate SKU in same location', async () => {
      const res = await api
        .post('/api/products')
        .withAuth(adminToken)
        .withBody({
          name: 'Duplicate Product',
          sku: testData.product.sku,
          price: 19.99,
          cost: 10.00,
          quantity: 25,
        })
        .expectStatus(409)
        .execute();

      assertResponse.error(res, 'already exists');
    });

    it('should allow same SKU in different location', async () => {
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

      const category2 = await prisma.category.create({
        data: {
          name: 'Category 2',
          locationId: location2.id,
        },
      });

      const res = await api
        .post('/api/products')
        .withAuth(token2)
        .withBody({
          name: 'Location 2 Product',
          sku: testData.product.sku, // Same SKU as location 1
          price: 29.99,
          cost: 15.00,
          quantity: 30,
          categoryId: category2.id,
        })
        .expectStatus(201)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.locationId).toBe(location2.id);
        expect(data.sku).toBe(testData.product.sku);
      });
    });

    it('should fail with missing required fields', async () => {
      const res = await api
        .post('/api/products')
        .withAuth(adminToken)
        .withBody({
          name: 'Incomplete Product',
          // Missing SKU, price, cost, quantity
        })
        .expectStatus(422)
        .execute();

      assertResponse.validationError(res);
    });

    it('should fail with negative price', async () => {
      const res = await api
        .post('/api/products')
        .withAuth(adminToken)
        .withBody({
          name: 'Invalid Product',
          sku: 'INVALID-001',
          price: -10.00,
          cost: 5.00,
          quantity: 10,
        })
        .expectStatus(422)
        .execute();

      assertResponse.validationError(res);
    });

    it('should fail with negative quantity', async () => {
      const res = await api
        .post('/api/products')
        .withAuth(adminToken)
        .withBody({
          name: 'Invalid Product',
          sku: 'INVALID-002',
          price: 10.00,
          cost: 5.00,
          quantity: -5,
        })
        .expectStatus(422)
        .execute();

      assertResponse.validationError(res);
    });

    it('should fail with invalid category from different location', async () => {
      // Create category in different location
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

      const category2 = await prisma.category.create({
        data: {
          id: 'category-location-2',
          name: 'Category 2',
          locationId: location2.id,
        },
      });

      const res = await api
        .post('/api/products')
        .withAuth(adminToken)
        .withBody({
          name: 'Cross Location Product',
          sku: 'CROSS-001',
          price: 10.00,
          cost: 5.00,
          quantity: 10,
          categoryId: category2.id, // From different location
        })
        .expectStatus(400)
        .execute();

      assertResponse.error(res);
    });
  });

  describe('GET /api/products', () => {
    it('should list all products for current location', async () => {
      // Create additional products
      await prisma.product.createMany({
        data: [
          {
            name: 'Product 2',
            sku: 'SKU-002',
            price: 15.99,
            cost: 8.00,
            quantity: 30,
            categoryId: testData.category.id,
            locationId: testData.location.id,
            isActive: true,
          },
          {
            name: 'Product 3',
            sku: 'SKU-003',
            price: 25.99,
            cost: 12.00,
            quantity: 20,
            categoryId: testData.category.id,
            locationId: testData.location.id,
            isActive: true,
          },
        ],
      });

      const res = await api
        .get('/api/products')
        .withAuth(cashierToken)
        .expectStatus(200)
        .execute();

      assertResponse.paginated(res, { minItems: 3, hasData: true });

      // Verify all products belong to same location
      res.body.data.forEach((product: any) => {
        expect(product.locationId).toBe(testData.location.id);
      });
    });

    it('should not show products from other locations', async () => {
      // Create second location with product
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

      const category2 = await prisma.category.create({
        data: {
          name: 'Category 2',
          locationId: location2.id,
        },
      });

      await prisma.product.create({
        data: {
          name: 'Location 2 Product',
          sku: 'L2-SKU-001',
          price: 39.99,
          cost: 20.00,
          quantity: 15,
          categoryId: category2.id,
          locationId: location2.id,
          isActive: true,
        },
      });

      const res = await api
        .get('/api/products')
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      // Should only see location 1 products
      assertResponse.success(res, (data) => {
        expect(data.length).toBe(1);
        expect(data[0].locationId).toBe(testData.location.id);
      });
    });

    it('should support search by name', async () => {
      const res = await api
        .get('/api/products')
        .withAuth(cashierToken)
        .withQuery({ search: testData.product.name })
        .expectStatus(200)
        .execute();

      assertResponse.paginated(res, { hasData: true });
      expect(res.body.data[0].name).toBe(testData.product.name);
    });

    it('should support filtering by category', async () => {
      const res = await api
        .get('/api/products')
        .withAuth(cashierToken)
        .withQuery({ categoryId: testData.category.id })
        .expectStatus(200)
        .execute();

      assertResponse.paginated(res, { hasData: true });
      res.body.data.forEach((product: any) => {
        expect(product.categoryId).toBe(testData.category.id);
      });
    });

    it('should support low stock filter', async () => {
      // Create low stock product
      await prisma.product.create({
        data: {
          name: 'Low Stock Product',
          sku: 'LOW-STOCK-001',
          price: 19.99,
          cost: 10.00,
          quantity: 3,
          categoryId: testData.category.id,
          locationId: testData.location.id,
          isActive: true,
        },
      });

      const res = await api
        .get('/api/products')
        .withAuth(cashierToken)
        .withQuery({ lowStock: 'true', threshold: 5 })
        .expectStatus(200)
        .execute();

      assertResponse.paginated(res, { hasData: true });
      res.body.data.forEach((product: any) => {
        expect(product.quantity).toBeLessThanOrEqual(5);
      });
    });
  });

  describe('PUT /api/products/:id', () => {
    it('should update product from same location', async () => {
      const updates = {
        name: 'Updated Product',
        price: 24.99,
        quantity: 75,
      };

      const res = await api
        .put(`/api/products/${testData.product.id}`)
        .withAuth(adminToken)
        .withBody(updates)
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.name).toBe(updates.name);
        expect(data.price).toBe(updates.price);
        expect(data.quantity).toBe(updates.quantity);
      });

      // Verify in database
      const updated = await assertDatabase.exists(prisma.product, {
        id: testData.product.id,
      });
      expect(updated.name).toBe(updates.name);
    });

    it('should not update product from different location', async () => {
      // Create second location with product
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

      const category2 = await prisma.category.create({
        data: {
          name: 'Category 2',
          locationId: location2.id,
        },
      });

      const product2 = await prisma.product.create({
        data: {
          name: 'Location 2 Product',
          sku: 'L2-SKU-001',
          price: 39.99,
          cost: 20.00,
          quantity: 15,
          categoryId: category2.id,
          locationId: location2.id,
          isActive: true,
        },
      });

      const res = await api
        .put(`/api/products/${product2.id}`)
        .withAuth(adminToken)
        .withBody({ name: 'Hacked Product' })
        .expectStatus(404)
        .execute();

      assertResponse.notFound(res);

      // Verify not updated
      const unchanged = await prisma.product.findUnique({
        where: { id: product2.id },
      });
      expect(unchanged?.name).toBe('Location 2 Product');
    });
  });

  describe('DELETE /api/products/:id', () => {
    it('should delete product from same location', async () => {
      const res = await api
        .delete(`/api/products/${testData.product.id}`)
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      assertResponse.success(res);

      // Verify deleted
      await assertDatabase.notExists(prisma.product, {
        id: testData.product.id,
      });
    });

    it('should not delete product from different location', async () => {
      // Create second location with product
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

      const category2 = await prisma.category.create({
        data: {
          name: 'Category 2',
          locationId: location2.id,
        },
      });

      const product2 = await prisma.product.create({
        data: {
          name: 'Location 2 Product',
          sku: 'L2-SKU-001',
          price: 39.99,
          cost: 20.00,
          quantity: 15,
          categoryId: category2.id,
          locationId: location2.id,
          isActive: true,
        },
      });

      const res = await api
        .delete(`/api/products/${product2.id}`)
        .withAuth(adminToken)
        .expectStatus(404)
        .execute();

      assertResponse.notFound(res);

      // Verify not deleted
      await assertDatabase.exists(prisma.product, { id: product2.id });
    });
  });

  describe('Inventory Tracking', () => {
    it('should track quantity changes in activity log', async () => {
      const originalQuantity = testData.product.quantity;

      await api
        .put(`/api/products/${testData.product.id}`)
        .withAuth(adminToken)
        .withBody({ quantity: originalQuantity + 50 })
        .expectStatus(200)
        .execute();

      // Verify activity log
      const activityLogs = await prisma.activityLog.findMany({
        where: {
          entityType: 'PRODUCT',
          entityId: testData.product.id,
          action: 'UPDATE',
        },
      });

      expect(activityLogs.length).toBeGreaterThan(0);
      expect(activityLogs[0].locationId).toBe(testData.location.id);
    });

    it('should prevent negative quantity', async () => {
      const res = await api
        .put(`/api/products/${testData.product.id}`)
        .withAuth(adminToken)
        .withBody({ quantity: -10 })
        .expectStatus(422)
        .execute();

      assertResponse.validationError(res);
    });
  });
});
