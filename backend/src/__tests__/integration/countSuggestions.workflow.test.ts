import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Suggested spot counts and stock accuracy', () => {
  let data: TestData;
  let owner: string;
  beforeEach(async () => { data = await seedTestData(); owner = await createTestToken(data.adminUser.id, 'ADMIN'); });
  const get = (path: string, token = owner) => request(app).get(path).set('Authorization', 'Bearer ' + token);
  const post = (path: string, body: object) => request(app).post(path).set('Authorization', 'Bearer ' + owner).send(body);
  const put = (path: string, body: object) => request(app).put(path).set('Authorization', 'Bearer ' + owner).send(body);
  const product = (name: string, extra: object = {}) => prisma.product.create({ data: { name, sku: name.toUpperCase(), price: 5, cost: 2, stockQuantity: 40, lowStockAlert: 5, locationId: data.location.id, ...extra } });
  const approveCount = async (productIds: string[], counted: (productId: string) => number) => {
    const count = (await post('/api/cycle-counts', { type: 'PARTIAL', productIds }).expect(201)).body.data;
    await put(`/api/cycle-counts/${count.id}/items`, { items: count.items.map((line: { id: string; productId: string }) => ({ id: line.id, countedQty: counted(line.productId) })) }).expect(200);
    await post(`/api/cycle-counts/${count.id}/submit`, {}).expect(200);
    await post(`/api/cycle-counts/${count.id}/approve`, {}).expect(200);
    return count;
  };

  it('suggests uncounted and recently adjusted items first and leaves out exceptions, open counts, untracked items and other stores', async () => {
    await prisma.product.update({ where: { id: data.product.id }, data: { isActive: false } });
    const counted = await product('Counted');
    const fresh = await product('Fresh');
    const adjusted = await product('Adjusted');
    const short = await product('Short', { stockQuantity: 2 });
    const problem = await product('Problem');
    const onCount = await product('OnCount');
    await product('Untracked', { trackInventory: false, stockQuantity: 0 });
    const other = await prisma.location.create({ data: { id: 'counts-other-store', name: 'Other Store', address: '1', city: 'C', state: 'TS', zipCode: '1', phone: '1', email: 'other@store.com' } });
    await prisma.product.create({ data: { name: 'Elsewhere', sku: 'ELSEWHERE', price: 5, stockQuantity: 9, locationId: other.id } });

    // Counted just now on a count that matched (no stock moved, so no stock log), and adjusted by hand today.
    await approveCount([counted.id], () => 40);
    await post(`/api/products/${adjusted.id}/adjust-inventory`, { quantity: -1, type: 'DAMAGED' }).expect(200);
    await prisma.inventoryException.create({ data: { productId: problem.id, locationId: data.location.id, openProductId: problem.id, lowestQuantity: -1, latestQuantity: -1 } });
    await post('/api/cycle-counts', { type: 'PARTIAL', productIds: [onCount.id] }).expect(201);

    const suggested = (await get('/api/cycle-counts/suggested?limit=10').expect(200)).body.data;
    expect(suggested.map((row: { name: string }) => row.name)).toEqual(['Adjusted', 'Short', 'Fresh', 'Counted']);
    expect(suggested[0]).toMatchObject({ productId: adjusted.id, score: 55, reasons: ['Never counted', 'Stock adjusted by hand in the last 14 days'] });
    expect(suggested[1]).toMatchObject({ productId: short.id, score: 50, reasons: ['Never counted', 'Only 2 on record, quick to count'] });
    expect(suggested[2]).toMatchObject({ productId: fresh.id, score: 40 });
    expect(suggested[3]).toMatchObject({ productId: counted.id, score: 0, reasons: [] });
    expect((await get('/api/cycle-counts/suggested?limit=2').expect(200)).body.data).toHaveLength(2);

    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await get('/api/cycle-counts/suggested', cashier).expect(403);
  });

  it('reports the share of items on counts approved in the last 30 days that matched the record', async () => {
    expect((await get('/api/cycle-counts/accuracy').expect(200)).body.data).toEqual({ counted: 0, matched: 0, accuracy: null });
    const items = await Promise.all(['A', 'B', 'C', 'D'].map(name => product('Item ' + name)));
    const count = await approveCount(items.map(item => item.id), productId => productId === items[3].id ? 37 : 40);
    expect((await get('/api/cycle-counts/accuracy').expect(200)).body.data).toEqual({ counted: 4, matched: 3, accuracy: 0.75 });

    // Counts approved more than 30 days ago no longer count.
    await prisma.cycleCount.update({ where: { id: count.id }, data: { completedAt: new Date(Date.now() - 31 * 86400000) } });
    expect((await get('/api/cycle-counts/accuracy').expect(200)).body.data.counted).toBe(0);
  });
});
