/**
 * Sale Workflow Integration Tests
 *
 * Tests complex sale workflows:
 * - Complete sale process
 * - Inventory deduction
 * - Transaction handling
 * - Payment processing
 * - Receipt generation
 * - Multi-item sales
 */

import { prisma, seedTestData, TestData } from './setup';
import { api, assertResponse, assertDatabase, loginUser } from './helpers';

describe('Sale Workflow Integration Tests', () => {
  let testData: TestData;
  let cashierToken: string;

  beforeEach(async () => {
    testData = await seedTestData();
    cashierToken = await loginUser('cashier@test.com', 'Admin123!');
  });

  describe('Complete Sale Process', () => {
    it('should process complete sale with inventory deduction', async () => {
      const initialQuantity = testData.product.quantity;

      const saleData = {
        customerId: testData.customer.id,
        items: [
          {
            productId: testData.product.id,
            quantity: 2,
            price: testData.product.price,
          },
        ],
        paymentMethod: 'CASH',
        amountPaid: 40.00,
        subtotal: 39.98,
        tax: 0.00,
        total: 39.98,
        change: 0.02,
      };

      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody(saleData)
        .expectStatus(201)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.id).toBeDefined();
        expect(data.total).toBe(saleData.total);
        expect(data.customerId).toBe(testData.customer.id);
        expect(data.locationId).toBe(testData.location.id);
        expect(data.items).toBeDefined();
        expect(data.items.length).toBe(1);
        expect(data.items[0].quantity).toBe(2);
      });

      // Verify sale in database
      const sale = await assertDatabase.exists(prisma.sale, {
        id: res.body.data.id,
        locationId: testData.location.id,
      });

      // Verify inventory deduction
      const updatedProduct = await prisma.product.findUnique({
        where: { id: testData.product.id },
      });
      expect(updatedProduct?.quantity).toBe(initialQuantity - 2);

      // Verify sale items created
      const saleItems = await prisma.saleItem.findMany({
        where: { saleId: sale.id },
      });
      expect(saleItems.length).toBe(1);
      expect(saleItems[0].quantity).toBe(2);
    });

    it('should process multi-item sale', async () => {
      // Create additional product
      const product2 = await prisma.product.create({
        data: {
          name: 'Product 2',
          sku: 'SKU-002',
          price: 15.99,
          cost: 8.00,
          quantity: 50,
          categoryId: testData.category.id,
          locationId: testData.location.id,
          isActive: true,
        },
      });

      const saleData = {
        customerId: testData.customer.id,
        items: [
          {
            productId: testData.product.id,
            quantity: 1,
            price: testData.product.price,
          },
          {
            productId: product2.id,
            quantity: 3,
            price: product2.price,
          },
        ],
        paymentMethod: 'CREDIT_CARD',
        subtotal: 67.96, // (19.99 * 1) + (15.99 * 3)
        tax: 0.00,
        total: 67.96,
      };

      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody(saleData)
        .expectStatus(201)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.items.length).toBe(2);
        expect(data.total).toBe(saleData.total);
      });

      // Verify both products' inventory updated
      const updatedProduct1 = await prisma.product.findUnique({
        where: { id: testData.product.id },
      });
      const updatedProduct2 = await prisma.product.findUnique({
        where: { id: product2.id },
      });

      expect(updatedProduct1?.quantity).toBe(testData.product.quantity - 1);
      expect(updatedProduct2?.quantity).toBe(50 - 3);
    });

    it('should fail sale with insufficient stock', async () => {
      const saleData = {
        customerId: testData.customer.id,
        items: [
          {
            productId: testData.product.id,
            quantity: testData.product.quantity + 10, // More than available
            price: testData.product.price,
          },
        ],
        paymentMethod: 'CASH',
        total: 100.00,
      };

      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody(saleData)
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'Insufficient stock');

      // Verify inventory not changed
      const unchangedProduct = await prisma.product.findUnique({
        where: { id: testData.product.id },
      });
      expect(unchangedProduct?.quantity).toBe(testData.product.quantity);
    });

    it('should fail sale with invalid product from different location', async () => {
      // Create product in different location
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

      const saleData = {
        customerId: testData.customer.id,
        items: [
          {
            productId: product2.id, // From different location
            quantity: 1,
            price: 39.99,
          },
        ],
        paymentMethod: 'CASH',
        total: 39.99,
      };

      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .expectStatus(404)
        .execute();

      assertResponse.notFound(res);
    });

    it('should create activity log for sale', async () => {
      const saleData = {
        customerId: testData.customer.id,
        items: [
          {
            productId: testData.product.id,
            quantity: 1,
            price: testData.product.price,
          },
        ],
        paymentMethod: 'CASH',
        total: testData.product.price,
      };

      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody(saleData)
        .expectStatus(201)
        .execute();

      // Verify activity log created
      const activityLog = await prisma.activityLog.findFirst({
        where: {
          entityType: 'SALE',
          entityId: res.body.data.id,
          action: 'CREATE',
          locationId: testData.location.id,
        },
      });

      expect(activityLog).toBeDefined();
      expect(activityLog?.userId).toBe(testData.cashierUser.id);
    });
  });

  describe('Sale Retrieval', () => {
    it('should list sales for current location only', async () => {
      // Create sale in location 1
      const sale1 = await prisma.sale.create({
        data: {
          customerId: testData.customer.id,
          userId: testData.cashierUser.id,
          locationId: testData.location.id,
          paymentMethod: 'CASH',
          subtotal: 19.99,
          tax: 0.00,
          total: 19.99,
          items: {
            create: [
              {
                productId: testData.product.id,
                quantity: 1,
                price: 19.99,
              },
            ],
          },
        },
      });

      // Create location 2 with sale
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
          email: 'cashier2@test.com',
          password: testData.cashierUser.password,
          firstName: 'Cashier',
          lastName: 'User 2',
          role: 'CASHIER',
          locationId: location2.id,
          isActive: true,
        },
      });

      const customer2 = await prisma.customer.create({
        data: {
          email: 'customer2@test.com',
          firstName: 'Customer',
          lastName: 'Two',
          locationId: location2.id,
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
          name: 'Product 2',
          sku: 'L2-SKU-001',
          price: 29.99,
          cost: 15.00,
          quantity: 20,
          categoryId: category2.id,
          locationId: location2.id,
          isActive: true,
        },
      });

      await prisma.sale.create({
        data: {
          customerId: customer2.id,
          userId: user2.id,
          locationId: location2.id,
          paymentMethod: 'CREDIT_CARD',
          subtotal: 29.99,
          tax: 0.00,
          total: 29.99,
          items: {
            create: [
              {
                productId: product2.id,
                quantity: 1,
                price: 29.99,
              },
            ],
          },
        },
      });

      const res = await api
        .get('/api/sales')
        .withAuth(cashierToken)
        .expectStatus(200)
        .execute();

      assertResponse.paginated(res, { hasData: true });

      // Should only see location 1 sale
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].locationId).toBe(testData.location.id);
    });

    it('should get sale by id from same location', async () => {
      const sale = await prisma.sale.create({
        data: {
          customerId: testData.customer.id,
          userId: testData.cashierUser.id,
          locationId: testData.location.id,
          paymentMethod: 'CASH',
          subtotal: 19.99,
          tax: 0.00,
          total: 19.99,
          items: {
            create: [
              {
                productId: testData.product.id,
                quantity: 1,
                price: 19.99,
              },
            ],
          },
        },
      });

      const res = await api
        .get(`/api/sales/${sale.id}`)
        .withAuth(cashierToken)
        .expectStatus(200)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.id).toBe(sale.id);
        expect(data.locationId).toBe(testData.location.id);
        expect(data.items).toBeDefined();
        expect(data.customer).toBeDefined();
      });
    });

    it('should not get sale from different location', async () => {
      // Create sale in different location
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
          email: 'user2@test.com',
          password: testData.cashierUser.password,
          firstName: 'User',
          lastName: 'Two',
          role: 'CASHIER',
          locationId: location2.id,
          isActive: true,
        },
      });

      const customer2 = await prisma.customer.create({
        data: {
          email: 'customer2@test.com',
          firstName: 'Customer',
          lastName: 'Two',
          locationId: location2.id,
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
          name: 'Product 2',
          sku: 'L2-SKU-001',
          price: 29.99,
          cost: 15.00,
          quantity: 20,
          categoryId: category2.id,
          locationId: location2.id,
          isActive: true,
        },
      });

      const sale2 = await prisma.sale.create({
        data: {
          customerId: customer2.id,
          userId: user2.id,
          locationId: location2.id,
          paymentMethod: 'CASH',
          subtotal: 29.99,
          tax: 0.00,
          total: 29.99,
          items: {
            create: [
              {
                productId: product2.id,
                quantity: 1,
                price: 29.99,
              },
            ],
          },
        },
      });

      const res = await api
        .get(`/api/sales/${sale2.id}`)
        .withAuth(cashierToken)
        .expectStatus(404)
        .execute();

      assertResponse.notFound(res);
    });
  });

  describe('Transaction Handling', () => {
    it('should rollback sale if inventory update fails', async () => {
      // This test verifies that database transactions work properly
      // If sale creation fails, inventory should not be deducted

      const saleData = {
        customerId: testData.customer.id,
        items: [
          {
            productId: 'invalid-product-id',
            quantity: 1,
            price: 19.99,
          },
        ],
        paymentMethod: 'CASH',
        total: 19.99,
      };

      const initialQuantity = testData.product.quantity;

      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody(saleData)
        .expectStatus(404)
        .execute();

      assertResponse.notFound(res);

      // Verify inventory unchanged
      const unchangedProduct = await prisma.product.findUnique({
        where: { id: testData.product.id },
      });
      expect(unchangedProduct?.quantity).toBe(initialQuantity);
    });

    it('should maintain data consistency on concurrent sales', async () => {
      const initialQuantity = testData.product.quantity;

      // Simulate two simultaneous sales
      const sale1Promise = api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          customerId: testData.customer.id,
          items: [
            {
              productId: testData.product.id,
              quantity: 5,
              price: testData.product.price,
            },
          ],
          paymentMethod: 'CASH',
          total: testData.product.price * 5,
        })
        .execute();

      const sale2Promise = api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          customerId: testData.customer.id,
          items: [
            {
              productId: testData.product.id,
              quantity: 3,
              price: testData.product.price,
            },
          ],
          paymentMethod: 'CASH',
          total: testData.product.price * 3,
        })
        .execute();

      const [res1, res2] = await Promise.all([sale1Promise, sale2Promise]);

      // Both should succeed
      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);

      // Verify correct inventory deduction
      const updatedProduct = await prisma.product.findUnique({
        where: { id: testData.product.id },
      });

      expect(updatedProduct?.quantity).toBe(initialQuantity - 8); // 5 + 3
    });
  });

  describe('Payment Validation', () => {
    it('should fail with invalid payment method', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          customerId: testData.customer.id,
          items: [
            {
              productId: testData.product.id,
              quantity: 1,
              price: testData.product.price,
            },
          ],
          paymentMethod: 'INVALID_METHOD',
          total: testData.product.price,
        })
        .expectStatus(422)
        .execute();

      assertResponse.validationError(res);
    });

    it('should calculate correct change for cash payment', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          customerId: testData.customer.id,
          items: [
            {
              productId: testData.product.id,
              quantity: 1,
              price: testData.product.price,
            },
          ],
          paymentMethod: 'CASH',
          amountPaid: 50.00,
          total: testData.product.price,
          change: 50.00 - testData.product.price,
        })
        .expectStatus(201)
        .execute();

      assertResponse.success(res, (data) => {
        expect(data.amountPaid).toBe(50.00);
        expect(data.change).toBeCloseTo(50.00 - testData.product.price, 2);
      });
    });
  });
});
