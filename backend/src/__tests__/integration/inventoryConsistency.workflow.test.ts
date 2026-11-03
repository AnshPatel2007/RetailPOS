import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Versioned inventory and cycle-count isolation', () => {
  let data: TestData;
  let owner: string;
  beforeEach(async () => {
    data = await seedTestData(); owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, clockInAt: new Date() } });
  });
  const post = (path: string, body: object = {}) => request(app).post(path).set('Authorization', 'Bearer ' + owner).send(body);
  const create = async () => (await post('/api/cycle-counts', { type: 'FULL' }).expect(201)).body.data;
  const enter = (id: string, items: object[]) => request(app).put('/api/cycle-counts/' + id + '/items').set('Authorization', 'Bearer ' + owner).send({ items });
  const review = async (quantity: number) => {
    const count = await create();
    await enter(count.id, [{ id: count.items[0].id, countedQty: quantity }]).expect(200);
    await post('/api/cycle-counts/' + count.id + '/submit').expect(200);
    return count;
  };
  const stock = () => prisma.product.findUniqueOrThrow({ where: { id: data.product.id } });
  const sale = () => post('/api/sales', { items: [{ productId: data.product.id, price: 19.99, quantity: 1 }], paymentMethod: 'CASH', amountPaid: 30 });

  it('rejects item IDs belonging to a different count without partial changes', async () => {
    const first = await create(); const second = await create();
    await enter(first.id, [{ id: first.items[0].id, countedQty: 4 }, { id: second.items[0].id, countedQty: 7 }]).expect(400);
    expect(await prisma.cycleCountItem.count({ where: { countedQty: { not: null } } })).toBe(0);
  });

  it('requires a recount if stock moved, even when it returned to the same quantity', async () => {
    const count = await review(98);
    await post('/api/products/' + data.product.id + '/adjust-inventory', { quantity: -1 }).expect(200);
    await post('/api/products/' + data.product.id + '/adjust-inventory', { quantity: 1 }).expect(200);
    await post('/api/cycle-counts/' + count.id + '/approve').expect(409);
    expect((await stock()).stockQuantity).toBe(100);
    await post('/api/cycle-counts/' + count.id + '/refresh').expect(200);
    const refreshed = await prisma.cycleCountItem.findUniqueOrThrow({ where: { id: count.items[0].id } });
    expect(refreshed.countedQty).toBeNull(); expect(refreshed.stockVersion).toBe(2);
    await enter(count.id, [{ id: refreshed.id, countedQty: 99 }]).expect(200);
    await post('/api/cycle-counts/' + count.id + '/submit').expect(200);
    await post('/api/cycle-counts/' + count.id + '/approve').expect(200);
    expect((await stock()).stockQuantity).toBe(99);
    const log = await prisma.inventoryLog.findFirstOrThrow({ where: { sourceId: count.id } });
    expect(log).toMatchObject({ previousQty: 100, newQty: 99, quantity: -1, stockVersion: 3, locationId: data.location.id });
  });

  it('serializes duplicate approval and leaves one stock movement', async () => {
    const count = await review(98);
    const results = await Promise.all([post('/api/cycle-counts/' + count.id + '/approve'), post('/api/cycle-counts/' + count.id + '/approve')]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.inventoryLog.count({ where: { sourceId: count.id } })).toBe(1);
    expect((await stock()).stockQuantity).toBe(98);
    expect(await prisma.activityLog.count({ where: { action: 'CYCLE_COUNT_APPROVED', entityId: count.id, locationId: data.location.id } })).toBe(1);
    const audit = await request(app).get('/api/audit-logs').set('Authorization', 'Bearer ' + owner).expect(200);
    expect(JSON.stringify(audit.body)).toContain(count.id);
  });

  it('a simultaneous sale cannot be overwritten by count approval', async () => {
    const count = await review(98);
    const [approved, sold] = await Promise.all([post('/api/cycle-counts/' + count.id + '/approve'), sale()]);
    expect(sold.status).toBe(201); expect([200, 409]).toContain(approved.status);
    expect((await stock()).stockQuantity).toBe(approved.status === 200 ? 97 : 99);
  });

  it('concurrent adjustments and sales retain every unit and an unbroken history', async () => {
    const responses = await Promise.all([sale(), post('/api/products/' + data.product.id + '/adjust-inventory', { quantity: 5 }), post('/api/products/' + data.product.id + '/adjust-inventory', { quantity: -3 })]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 200, 201]);
    expect((await stock()).stockQuantity).toBe(101);
    const logs = await prisma.inventoryLog.findMany({ where: { productId: data.product.id }, orderBy: { stockVersion: 'asc' } });
    expect(logs).toHaveLength(3);
    expect(logs[0].previousQty).toBe(100);
    for (let i = 1; i < logs.length; i++) expect(logs[i].previousQty).toBe(logs[i - 1].newQty);
    expect(logs[2].newQty).toBe(101);
  });

  it('legacy counts without versions cannot be approved until refreshed and recounted', async () => {
    const count = await review(98);
    await prisma.cycleCountItem.update({ where: { id: count.items[0].id }, data: { stockVersion: null } });
    await post('/api/cycle-counts/' + count.id + '/approve').expect(409);
    await post('/api/cycle-counts/' + count.id + '/refresh').expect(200);
    expect((await prisma.cycleCountItem.findUniqueOrThrow({ where: { id: count.items[0].id } })).countedQty).toBeNull();
  });

  it('rejects stale absolute bulk stock updates and fractional or negative count quantities', async () => {
    const count = await create();
    for (const countedQty of [-1, 1.5]) await enter(count.id, [{ id: count.items[0].id, countedQty }]).expect(400);
    const version = (await stock()).stockVersion;
    await sale().expect(201);
    await post('/api/products/bulk-update-stock', { updates: [{ productId: data.product.id, quantity: 10, type: 'set', expectedVersion: version }] }).expect(409);
    expect((await stock()).stockQuantity).toBe(99);
  });

  it('editing a stale product quantity preserves a concurrent sale and rolls back other edits', async () => {
    const snapshot = await stock();
    await sale().expect(201);
    await request(app).put('/api/products/' + data.product.id).set('Authorization', 'Bearer ' + owner).send({ name: 'Should roll back', stockQuantity: 50, expectedStockVersion: snapshot.stockVersion }).expect(409);
    expect((await stock()).stockQuantity).toBe(99); expect((await stock()).name).toBe(data.product.name);
    const current = await stock();
    await request(app).put('/api/products/' + data.product.id).set('Authorization', 'Bearer ' + owner).send({ stockQuantity: 50, expectedStockVersion: current.stockVersion }).expect(200);
    const latest = await prisma.inventoryLog.findFirstOrThrow({ where: { productId: data.product.id }, orderBy: { stockVersion: 'desc' } });
    expect(latest).toMatchObject({ previousQty: 99, newQty: 50, quantity: -49 });
  });

  it.each(['refund', 'void'])('a concurrent %s and sale preserve stock and traceable movement versions', async operation => {
    const original = (await sale().expect(201)).body.data;
    const [reversed, sold] = await Promise.all([
      post('/api/sales/' + original.id + '/' + operation, { amount: original.total, reason: 'Return', ...(operation === 'refund' ? { items: [{ saleItemId: original.items[0].id, quantity: 1 }] } : {}) }), sale(),
    ]);
    expect(reversed.status).toBe(200); expect(sold.status).toBe(201);
    expect((await stock()).stockQuantity).toBe(99);
    const logs = await prisma.inventoryLog.findMany({ where: { productId: data.product.id }, orderBy: { stockVersion: 'asc' } });
    expect(logs).toHaveLength(3);
    for (let i = 1; i < logs.length; i++) expect(logs[i].previousQty).toBe(logs[i - 1].newQty);
    const reversal = logs.find(log => log.type === 'RETURN')!;
    expect(reversal.sourceId).toBe(operation === 'void' ? original.id : (await prisma.refund.findFirstOrThrow()).id);
    expect(reversal.locationId).toBe(data.location.id); expect(reversal.quantity).toBe(1);
    expect(logs[2].newQty).toBe(99);
  });

  it('a returned item invalidates a count captured before that return', async () => {
    const original = (await sale().expect(201)).body.data;
    const count = await review(99);
    await post('/api/sales/' + original.id + '/refund', { items: [{ saleItemId: original.items[0].id, quantity: 1 }], reason: 'Return' }).expect(200);
    await post('/api/cycle-counts/' + count.id + '/approve').expect(409);
    expect((await stock()).stockQuantity).toBe(100);
  });
});
