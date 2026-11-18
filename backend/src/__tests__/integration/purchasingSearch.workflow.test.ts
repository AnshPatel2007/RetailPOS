import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Purchasing search and selectors', () => {
  let data: TestData, token: string;
  beforeEach(async () => {
    data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
    await prisma.purchaseOrder.createMany({ data: Array.from({ length: 25 }, (_, index) => ({
      orderNumber: 'SEARCH-' + String(index).padStart(2, '0'), supplierId: data.supplier.id, locationId: data.location.id, totalAmount: 10,
      createdAt: new Date('2026-10-01T' + String(index % 24).padStart(2, '0') + ':00:00Z'),
    })) });
  });
  const get = (path: string) => request(app).get('/api/' + path).set('Authorization', 'Bearer ' + token);
  it('searches all orders before paging and uses matching summary counts', async () => {
    const result = (await get('purchase-orders?search=SEARCH-00').expect(200)).body;
    expect(result.pagination.total).toBe(1); expect(result.data[0].orderNumber).toBe('SEARCH-00');
    const bySupplier = (await get('purchase-orders?search=' + encodeURIComponent(data.supplier.name) + '&limit=10&page=3').expect(200)).body;
    expect(bySupplier.pagination).toMatchObject({ total: 25, totalPages: 3 }); expect(bySupplier.data).toHaveLength(5);
  });
  it('keeps partner records out of order and supplier searches', async () => {
    const partner = await prisma.location.create({ data: { name: 'Partner', address: 'Test', city: 'Test', state: 'IL', zipCode: '60000', phone: '555', email: 'partner@example.test' } });
    const supplier = await prisma.supplier.create({ data: { name: 'FOREIGN-PURCHASING', locationId: partner.id } });
    await prisma.purchaseOrder.create({ data: { orderNumber: 'FOREIGN-PURCHASING', supplierId: supplier.id, locationId: partner.id, totalAmount: 10 } });
    for (const resource of ['suppliers', 'purchase-orders']) {
      expect((await get(resource + '?search=FOREIGN-PURCHASING').expect(200)).body.pagination.total).toBe(0);
      await get(resource + '?locationId=' + partner.id).expect(403);
    }
  });
  it('makes suppliers beyond the first page selectable and excludes inactive suppliers', async () => {
    await prisma.supplier.createMany({ data: Array.from({ length: 23 }, (_, i) => ({ name: 'Supplier ' + String(i).padStart(2, '0'), locationId: data.location.id, isActive: i !== 22 })) });
    const result = (await get('suppliers?search=Supplier&limit=10&page=3&isActive=true').expect(200)).body;
    expect(result.pagination.total).toBe(23); expect(result.data).toHaveLength(3);
    expect((await get('suppliers?search=Supplier%2022&isActive=true').expect(200)).body.pagination.total).toBe(0);
  });
  it('validates bounded requests and interprets order dates in the store timezone', async () => {
    for (const resource of ['suppliers', 'purchase-orders']) for (const query of ['page=0', 'limit=101', 'sortBy=password', 'search=' + 'a'.repeat(201)]) await get(resource + '?' + query).expect(400);
    await get('purchase-orders?startDate=2026-02-30').expect(400);
    await get('purchase-orders?status=BAD').expect(400);
    const result = (await get('purchase-orders?startDate=2026-09-30&endDate=2026-09-30').expect(200)).body;
    expect(result.pagination.total).toBe(6);
  });
});
