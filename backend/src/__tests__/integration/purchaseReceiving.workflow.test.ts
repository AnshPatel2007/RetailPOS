import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Purchase receiving, retries and concurrent inventory', () => {
  let data: TestData;
  let owner: string;
  beforeEach(async () => {
    data = await seedTestData(); owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, clockInAt: new Date() } });
  });
  const post = (path: string, body: object = {}) => request(app).post(path).set('Authorization', 'Bearer ' + owner).send(body);
  const create = (status = 'ORDERED') => prisma.purchaseOrder.create({ data: {
    orderNumber: 'PO-' + randomUUID(), supplierId: data.supplier.id, locationId: data.location.id, status, totalAmount: 100,
    items: { create: { productId: data.product.id, productName: data.product.name, sku: data.product.sku, quantity: 10, cost: 10, total: 100 } },
  }, include: { items: true } });
  const stock = () => prisma.product.findUniqueOrThrow({ where: { id: data.product.id } });
  const body = (itemId: string, quantity: number, extra = {}) => ({ idempotencyKey: randomUUID(), receivedItems: [{ purchaseOrderItemId: itemId, quantity }], ...extra });

  it('keeps partial receipts open and separates usable stock from damaged and rejected units', async () => {
    const order = await create(); const path = '/api/purchase-orders/' + order.id + '/receive';
    const first = await post(path, body(order.items[0].id, 3)).expect(200);
    expect(first.body.data).toMatchObject({ status: 'PARTIALLY_RECEIVED', remaining: 7 });
    expect((await stock()).stockQuantity).toBe(103);
    await post(path, { idempotencyKey: randomUUID(), receivedItems: [{ purchaseOrderItemId: order.items[0].id, quantity: 4, damagedQty: 2, rejectedQty: 1 }] }).expect(400);
    await post(path, { idempotencyKey: randomUUID(), receivedItems: [{ purchaseOrderItemId: order.items[0].id, quantity: 4, damagedQty: 2, rejectedQty: 1 }], notes: 'Two crushed; one incorrect variant' }).expect(200);
    expect((await stock()).stockQuantity).toBe(107);
    const current = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, receipts: true } });
    expect(current.status).toBe('RECEIVED'); expect(current.receipts).toHaveLength(2);
    expect(current.items[0]).toMatchObject({ receivedQty: 7, damagedQty: 2, rejectedQty: 1 });
  });

  it('simultaneous retries create one receipt and one stock movement, including a retry after closure', async () => {
    const order = await create(); const path = '/api/purchase-orders/' + order.id + '/receive'; const payload = body(order.items[0].id, 10);
    const replies = await Promise.all([post(path, payload), post(path, payload)]);
    expect(replies.map(r => r.status)).toEqual([200, 200]);
    expect(replies.map(r => r.body.data.replayed).sort()).toEqual([false, true]);
    expect(replies[0].body.data.receipt.id).toBe(replies[1].body.data.receipt.id);
    expect((await stock()).stockQuantity).toBe(110);
    expect(await prisma.inventoryLog.count({ where: { type: 'PURCHASE' } })).toBe(1);
    await post(path, { ...payload, receivedItems: [{ purchaseOrderItemId: order.items[0].id, quantity: 9 }] }).expect(409);
    await post(path, payload).expect(200);
    expect(await prisma.purchaseReceipt.count()).toBe(1);
    const receiptId = replies[0].body.data.receipt.id;
    expect(await prisma.activityLog.count({ where: { action: 'PURCHASE_RECEIVED', entityId: receiptId, locationId: data.location.id } })).toBe(1);
    const audit = await request(app).get('/api/audit-logs').set('Authorization', 'Bearer ' + owner).expect(200);
    expect(JSON.stringify(audit.body)).toContain(receiptId);
  });

  it('receiving and selling at the same time retain both stock movements', async () => {
    const order = await create();
    const responses = await Promise.all([
      post('/api/purchase-orders/' + order.id + '/receive', body(order.items[0].id, 10)),
      post('/api/sales', { items: [{ productId: data.product.id, price: 19.99, quantity: 1 }], paymentMethod: 'CASH', amountPaid: 30 }),
    ]);
    expect(responses.map(r => r.status)).toEqual([200, 201]);
    expect((await stock()).stockQuantity).toBe(109);
    const logs = await prisma.inventoryLog.findMany({ where: { productId: data.product.id }, orderBy: { stockVersion: 'asc' } });
    expect(logs).toHaveLength(2); expect(logs[0].previousQty).toBe(100);
    expect(logs[1].previousQty).toBe(logs[0].newQty); expect(logs[1].newQty).toBe(109);
  });

  it('two separate deliveries cannot collectively exceed the ordered quantity', async () => {
    const order = await create(); const path = '/api/purchase-orders/' + order.id + '/receive';
    const responses = await Promise.all([post(path, body(order.items[0].id, 7)), post(path, body(order.items[0].id, 7))]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
    expect((await stock()).stockQuantity).toBe(107); expect(await prisma.purchaseReceipt.count()).toBe(1);
  });

  it('closing a short order requires a reason and retains the missing quantity without adding stock', async () => {
    const order = await create(); const path = '/api/purchase-orders/' + order.id;
    await post(path + '/receive', body(order.items[0].id, 3)).expect(200);
    await post(path + '/cancel').expect(409);
    await post(path + '/status', { status: 'RECEIVED' }).expect(400);
    await post(path + '/receive', { idempotencyKey: randomUUID(), receivedItems: [], finalDelivery: true }).expect(400);
    const closed = await post(path + '/receive', { idempotencyKey: randomUUID(), receivedItems: [], finalDelivery: true, notes: 'Supplier cannot supply the remaining seven units' }).expect(200);
    expect(closed.body.data).toMatchObject({ status: 'RECEIVED', remaining: 7 });
    expect((await stock()).stockQuantity).toBe(103);
    expect(await prisma.purchaseReceipt.count()).toBe(2);
    await request(app).delete(path).set('Authorization', 'Bearer ' + owner).expect(400);
  });

  it('cancellation racing with receiving cannot create stock on a cancelled order', async () => {
    const order = await create(); const path = '/api/purchase-orders/' + order.id;
    const [received, cancelled] = await Promise.all([post(path + '/receive', body(order.items[0].id, 10)), post(path + '/cancel')]);
    const current = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } });
    if (current.status === 'CANCELLED') {
      expect(cancelled.status).toBe(200); expect(received.status).toBe(400); expect((await stock()).stockQuantity).toBe(100);
      expect(await prisma.purchaseReceipt.count()).toBe(0);
    } else {
      expect(current.status).toBe('RECEIVED'); expect(received.status).toBe(200); expect(cancelled.status).toBe(400); expect((await stock()).stockQuantity).toBe(110);
    }
  });

  it('rejects foreign items, excess quantities and missing retry keys without partially receiving anything', async () => {
    const order = await create(); const other = await create(); const path = '/api/purchase-orders/' + order.id + '/receive';
    for (const payload of [body(other.items[0].id, 1), body(order.items[0].id, 11), { receivedItems: [{ purchaseOrderItemId: order.items[0].id, quantity: 1 }] }, body(order.items[0].id, -1)]) {
      await post(path, payload).expect(400);
    }
    expect((await stock()).stockQuantity).toBe(100); expect(await prisma.purchaseReceipt.count()).toBe(0);
  });

  it('rejects cross-store access and invalid draft replacement without deleting the original items', async () => {
    const order = await create('PENDING');
    const otherLocation = await prisma.location.create({ data: { name: 'Unconnected store', address: '2 Test St', city: 'Test', state: 'TS', zipCode: '12345', phone: '555-0102', email: 'other@test.com' } });
    const otherProduct = await prisma.product.create({ data: { name: 'Foreign', sku: randomUUID(), price: 1, cost: 1, locationId: otherLocation.id } });
    await request(app).put('/api/purchase-orders/' + order.id).set('Authorization', 'Bearer ' + owner).send({ items: [{ productId: otherProduct.id, quantity: 1, cost: 1 }] }).expect(404);
    expect(await prisma.purchaseOrderItem.count({ where: { purchaseOrderId: order.id } })).toBe(1);
    expect((await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: order.items[0].id } })).quantity).toBe(10);
    await prisma.purchaseOrder.update({ where: { id: order.id }, data: { locationId: otherLocation.id } });
    await post('/api/purchase-orders/' + order.id + '/receive', body(order.items[0].id, 1)).expect(403);
    await request(app).get('/api/purchase-orders/' + order.id).set('Authorization', 'Bearer ' + owner).expect(404);
    expect(await prisma.purchaseReceipt.count()).toBe(0);
  });

  it('requires ordering before receiving and never allows status changes to bypass inventory', async () => {
    const order = await create('PENDING'); const path = '/api/purchase-orders/' + order.id;
    await post(path + '/receive', body(order.items[0].id, 10)).expect(409);
    await post(path + '/status', { status: 'RECEIVED' }).expect(400);
    await post(path + '/status', { status: 'ORDERED' }).expect(200);
    await post(path + '/status', { status: 'PENDING' }).expect(409);
    await request(app).delete(path).set('Authorization', 'Bearer ' + owner).expect(409);
    await post(path + '/receive', body(order.items[0].id, 10)).expect(200);
  });
});
