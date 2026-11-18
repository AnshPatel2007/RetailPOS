import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Inventory movement history', () => {
  let data: TestData, owner: string, partnerId: string, manager: string;
  beforeEach(async () => {
    data = await seedTestData(); owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
    const user = await prisma.user.create({ data: { email: 'manager@example.test', firstName: 'Manager', lastName: 'Fixture', password: 'unused', role: 'MANAGER', locationId: data.location.id } });
    manager = await createTestToken(user.id, 'MANAGER');
    partnerId = (await prisma.location.create({ data: { name: 'Partner', address: 'Other', city: 'Other', state: 'TS', zipCode: '12345', phone: '555', email: 'partner@example.test' } })).id;
    const base = { productId: data.product.id, type: 'SALE', quantity: -2, previousQty: 10, newQty: 8, userId: data.adminUser.id };
    await prisma.inventoryLog.createMany({ data: [
      { ...base, locationId: data.location.id, sourceId: 'OWN-SALE', stockVersion: 2 },
      { ...base, locationId: partnerId, sourceId: 'PARTNER-SALE' },
      { ...base, locationId: null, sourceId: 'UNASSIGNED-SALE' },
    ] });
  });
  const get = (token: string, query = '') => request(app).get('/api/products/movements' + query).set('Authorization', 'Bearer ' + token);

  it('gives owners and managers only their store movements and matching counts', async () => {
    for (const token of [owner, manager]) {
      const result = (await get(token).expect(200)).body;
      expect(result.pagination.total).toBe(1);
      expect(result.data[0]).toMatchObject({ sourceId: 'OWN-SALE', quantity: -2, previousQty: 10, newQty: 8, stockVersion: 2, actor: 'Admin User' });
      expect(result.timezone).toBe('America/Chicago');
      expect(JSON.stringify(result)).not.toMatch(/PARTNER-SALE|UNASSIGNED-SALE|hourlyRate|password/);
      await get(token, '?locationId=' + partnerId).expect(403);
    }
  });
  it('filters product names, SKUs, references and movement types before pagination', async () => {
    for (const search of [data.product.name, data.product.sku, 'OWN-SALE']) {
      expect((await get(owner, '?search=' + encodeURIComponent(search) + '&limit=1').expect(200)).body.pagination.total).toBe(1);
    }
    expect((await get(owner, '?type=REFUND').expect(200)).body.data).toEqual([]);
    expect((await get(owner, '?productId=absent').expect(200)).body.pagination.total).toBe(0);
  });
  it('uses store-local day boundaries and stable pagination', async () => {
    const times = ['2026-11-01T04:59:59Z', '2026-11-01T05:00:00Z', '2026-11-01T06:30:00Z', '2026-11-01T07:30:00Z', '2026-11-02T05:59:59Z', '2026-11-02T06:00:00Z'];
    await prisma.inventoryLog.createMany({ data: times.map(time => ({ productId: data.product.id, locationId: data.location.id, type: 'ADJUSTMENT', quantity: 1, previousQty: 8, newQty: 9, createdAt: new Date(time) })) });
    const query = '?startDate=2026-11-01&endDate=2026-11-01&limit=2';
    const first = (await get(owner, query).expect(200)).body, second = (await get(owner, query + '&page=2').expect(200)).body;
    expect(first.pagination.total).toBe(4); expect(new Set([...first.data, ...second.data].map(row => row.id)).size).toBe(4);
  });
  it('rejects cashier access and invalid query bounds', async () => {
    await get(await createTestToken(data.cashierUser.id, 'CASHIER')).expect(403);
    for (const query of ['page=0', 'limit=101', 'page=NaN', 'startDate=2026-02-30', 'startDate=2026-11-02&endDate=2026-11-01']) await get(owner, '?' + query).expect(400);
  });
});
