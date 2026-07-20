/**
 * Suggested Orders Integration Tests
 *
 * Velocity/threshold-based reorder suggestions grouped by supplier.
 */

import { prisma, seedTestData, TestData } from './setup';
import { api, loginUser } from './helpers';

describe('Suggested Orders Integration Tests', () => {
  let testData: TestData;
  let adminToken: string;

  beforeEach(async () => {
    testData = await seedTestData();
    adminToken = await loginUser('admin@test.com', 'Admin123!');
  });

  it('should not suggest products with healthy stock', async () => {
    // Seed product: 100 on hand, no sales history
    const res = await api
      .get('/api/purchase-orders/suggested')
      .withAuth(adminToken)
      .expectStatus(200)
      .execute();

    const allItems = res.body.data.suppliers.flatMap((s: any) => s.items);
    expect(allItems.find((i: any) => i.productId === testData.product.id)).toBeUndefined();
  });

  it('should suggest a below-threshold product, grouped under its supplier', async () => {
    // PO creation validates UUIDs, so use auto-UUID records (the seed fixtures
    // use readable string ids)
    const supplier = await prisma.supplier.create({
      data: { name: 'UUID Vendor', isActive: true },
    });
    const product = await prisma.product.create({
      data: {
        name: 'Low Widget',
        sku: 'LOW-WIDGET-1',
        price: 12.99,
        cost: 6,
        stockQuantity: 3,
        lowStockAlert: 10,
        locationId: testData.location.id,
        isActive: true,
      },
    });
    await prisma.productSupplier.create({
      data: { productId: product.id, supplierId: supplier.id, cost: 8.5, leadTime: 4 },
    });

    const res = await api
      .get('/api/purchase-orders/suggested')
      .withAuth(adminToken)
      .expectStatus(200)
      .execute();

    const group = res.body.data.suppliers.find((s: any) => s.supplierId === supplier.id);
    expect(group).toBeDefined();
    expect(group.leadTimeDays).toBe(4);

    const item = group.items.find((i: any) => i.productId === product.id);
    expect(item).toBeDefined();
    expect(item.stock).toBe(3);
    expect(item.cost).toBe(8.5); // supplier cost wins over product cost
    // No sales velocity → restore to 2× threshold: 20 - 3 = 17
    expect(item.suggestedQty).toBe(17);

    // The suggestion converts straight into a real PO
    const po = await api
      .post('/api/purchase-orders')
      .withAuth(adminToken)
      .withBody({
        supplierId: supplier.id,
        items: [{ productId: item.productId, quantity: item.suggestedQty, cost: item.cost }],
      })
      .expectStatus(201)
      .execute();

    expect(po.body.data.totalAmount).toBe(Math.round(17 * 8.5 * 100) / 100);
  });

  it('should group unlinked products under "No supplier linked"', async () => {
    await prisma.product.update({
      where: { id: testData.product.id },
      data: { stockQuantity: 0, lowStockAlert: 10 },
    });

    const res = await api
      .get('/api/purchase-orders/suggested')
      .withAuth(adminToken)
      .expectStatus(200)
      .execute();

    const unassigned = res.body.data.suppliers.find((s: any) => s.supplierId === null);
    expect(unassigned).toBeDefined();
    const item = unassigned.items.find((i: any) => i.productId === testData.product.id);
    expect(item).toBeDefined();
    expect(item.urgent).toBe(true); // out of stock
  });
});
