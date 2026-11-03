import { numeric } from '../../utils/money';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { inventoryReconciliation } from '../../services/inventoryCostReport.service';
import { getFinancialMetrics } from '../../services/financialMetrics.service';

describe('Transfer deliveries, mapping and physical return accounting', () => {
  let data: TestData, sourceToken: string, destinationToken: string, destinationId: string, destinationProductId: string;
  beforeEach(async () => {
    data = await seedTestData(); sourceToken = await createTestToken(data.adminUser.id, 'ADMIN');
    const destination = await prisma.location.create({ data: { name: 'Destination', address: '2 Test St', city: 'Test', state: 'TS', zipCode: '12345', phone: '555', email: 'destination@test.com', taxRate: 10 } });
    destinationId = destination.id;
    const user = await prisma.user.create({ data: { email: 'destination-owner@test.com', password: data.adminUser.password, firstName: 'Receiving', lastName: 'Owner', role: 'ADMIN', locationId: destination.id } });
    destinationToken = await createTestToken(user.id, 'ADMIN');
    await prisma.shift.create({ data: { userId: user.id, locationId: destination.id, clockInAt: new Date() } });
    const [locationAId, locationBId] = [data.location.id, destination.id].sort();
    await prisma.storeConnection.create({ data: { locationAId, locationBId, createdBy: data.adminUser.id } });
    const product = await prisma.product.create({ data: { name: data.product.name, sku: data.product.sku, barcode: data.product.barcode, locationId: destination.id, price: 19.99, cost: 10, stockQuantity: 5 } });
    destinationProductId = product.id;
  });
  const post = (path: string, token: string, body: object = {}) => request(app).post(path).set('Authorization', 'Bearer ' + token).send(body);
  const read = (path: string, token: string) => request(app).get(path).set('Authorization', 'Bearer ' + token);
  const create = async () => (await post('/api/inventory-transfers', sourceToken, { toLocationId: destinationId, items: [{ productId: data.product.id, quantity: 10 }] }).expect(201)).body.data;
  const ship = async () => { const transfer = await create(); await post('/api/inventory-transfers/' + transfer.id + '/ship', sourceToken).expect(200); return transfer; };
  const receive = (id: string, payload: object) => post('/api/inventory-transfers/' + id + '/receive', destinationToken, payload);
  const payload = (transferItemId: string, acceptedQty: number, extra: object = {}) => ({ idempotencyKey: randomUUID(), items: [{ transferItemId, acceptedQty, ...extra }] });
  const sourceStock = async () => (await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity;
  const destinationStock = async () => (await prisma.product.findUniqueOrThrow({ where: { id: destinationProductId } })).stockQuantity;

  it('conserves partial deliveries, damaged/missing units and goods physically returned to source', async () => {
    const transfer = await ship(), itemId = transfer.items[0].id;
    expect(await sourceStock()).toBe(90);
    const first = await receive(transfer.id, payload(itemId, 4)).expect(200);
    expect(first.body.data).toMatchObject({ status: 'PARTIALLY_RECEIVED', pendingDelivery: 6, pendingReturn: 0 });
    await receive(transfer.id, { ...payload(itemId, 2, { damagedQty: 1, missingQty: 1, sentBackQty: 2 }), notes: 'One damaged, one confirmed lost, two dispatched back' }).expect(200);
    expect(await sourceStock()).toBe(90); expect(await destinationStock()).toBe(11);
    const returned = await post('/api/inventory-transfers/' + transfer.id + '/receive-return', sourceToken, { ...payload(itemId, 1, { damagedQty: 1 }), notes: 'One returned unit is damaged' }).expect(200);
    expect(returned.body.data).toMatchObject({ status: 'CLOSED', pendingDelivery: 0, pendingReturn: 0 });
    expect(await sourceStock()).toBe(91);
    const item = await prisma.transferItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item).toMatchObject({ receivedQty: 6, damagedQty: 1, missingQty: 1, sentBackQty: 2, returnedQty: 1, returnDamagedQty: 1, destinationProductId });
    expect((await sourceStock()) + (await destinationStock()) + item.damagedQty + item.missingQty + item.returnDamagedQty).toBe(105);
    const logs = await prisma.inventoryLog.findMany({ where: { productId: data.product.id }, orderBy: { stockVersion: 'asc' } });
    expect(logs.map(log => log.quantity)).toEqual([-10, 1]); expect(logs[1].previousQty).toBe(logs[0].newQty);
    expect(logs[0].sourceId).toBe(transfer.id); expect(logs[1].sourceId).toBe(returned.body.data.receipt.id);
  });

  it('never restores stock on cancel or return request, and enforces which store confirms each movement', async () => {
    const transfer = await ship(), path = '/api/inventory-transfers/' + transfer.id;
    await post(path + '/cancel', sourceToken).expect(409);
    await post(path + '/request-return', sourceToken, { idempotencyKey: randomUUID(), notes: 'Please send the unreceived shipment back' }).expect(200);
    expect(await sourceStock()).toBe(90);
    await post(path + '/receive-return', sourceToken, payload(transfer.items[0].id, 1)).expect(400);
    await post(path + '/receive-return', destinationToken, payload(transfer.items[0].id, 1)).expect(403);
    await post(path + '/receive', sourceToken, payload(transfer.items[0].id, 1)).expect(403);
    expect(await sourceStock()).toBe(90); expect(await destinationStock()).toBe(5);
    const history = await read(path + '/receipts', destinationToken).expect(200);
    expect(history.body.data[0].kind).toBe('REQUEST_RETURN');
  });

  it('duplicate concurrent delivery retries add stock once and changing the saved request is rejected', async () => {
    const transfer = await ship(), body = payload(transfer.items[0].id, 10);
    const results = await Promise.all([receive(transfer.id, body), receive(transfer.id, body)]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(results[0].body.data.receipt.id).toBe(results[1].body.data.receipt.id);
    expect(await destinationStock()).toBe(15); expect(await prisma.transferReceipt.count()).toBe(1);
    await receive(transfer.id, { ...body, items: [{ transferItemId: transfer.items[0].id, acceptedQty: 9 }] }).expect(409);
  });

  it('two different receipts cannot collectively exceed what was shipped', async () => {
    const transfer = await ship();
    const results = await Promise.all([receive(transfer.id, payload(transfer.items[0].id, 7)), receive(transfer.id, payload(transfer.items[0].id, 7))]);
    expect(results.map(result => result.status).sort()).toEqual([200, 400]);
    expect(await destinationStock()).toBe(12); expect(await prisma.transferReceipt.count()).toBe(1);
  });

  it('requires explicit product mapping for a same-SKU identity conflict and keeps that mapping stable', async () => {
    const transfer = await ship(), itemId = transfer.items[0].id;
    await prisma.product.update({ where: { id: destinationProductId }, data: { name: 'Different product', barcode: '999999' } });
    const options = await read('/api/inventory-transfers/' + transfer.id + '/mapping-options', destinationToken).expect(200);
    expect(options.body.data[0].automaticProductId).toBeNull();
    await receive(transfer.id, payload(itemId, 1)).expect(409);
    await receive(transfer.id, payload(itemId, 1, { destinationProductId: data.product.id })).expect(409);
    expect(await prisma.transferReceipt.count()).toBe(0);
    await receive(transfer.id, payload(itemId, 1, { destinationProductId })).expect(200);
    const other = await prisma.product.create({ data: { name: 'Another', sku: 'OTHER', price: 1, locationId: destinationId } });
    await receive(transfer.id, payload(itemId, 1, { destinationProductId: other.id })).expect(409);
    expect(await destinationStock()).toBe(6);
  });

  it('removing a connection preserves existing delivery/return access but blocks new transfers and draft shipping', async () => {
    const transfer = await ship(), draft = await create();
    await prisma.storeConnection.deleteMany();
    await post('/api/inventory-transfers', sourceToken, { toLocationId: destinationId, items: [{ productId: data.product.id, quantity: 1 }] }).expect(403);
    await post('/api/inventory-transfers/' + draft.id + '/ship', sourceToken).expect(403);
    await receive(transfer.id, { ...payload(transfer.items[0].id, 8, { sentBackQty: 2 }), notes: 'Two sent back after link removal' }).expect(200);
    await post('/api/inventory-transfers/' + transfer.id + '/receive-return', sourceToken, payload(transfer.items[0].id, 2)).expect(200);
    expect(await sourceStock()).toBe(92); expect(await destinationStock()).toBe(13);
  });

  it('creates a destination product only on explicit confirmation using the shipment snapshot', async () => {
    await prisma.product.delete({ where: { id: destinationProductId } });
    const transfer = await ship(), itemId = transfer.items[0].id;
    await prisma.product.update({ where: { id: data.product.id }, data: { name: 'Changed after shipment', sku: 'CHANGED', cost: 99, barcode: 'CHANGED' } });
    await receive(transfer.id, payload(itemId, 10)).expect(409);
    await receive(transfer.id, payload(itemId, 10, { createProduct: true })).expect(200);
    const target = await prisma.product.findFirstOrThrow({ where: { locationId: destinationId } });
    expect(numeric(target)).toMatchObject({ name: data.product.name, sku: data.product.sku, barcode: data.product.barcode, cost: 10, stockQuantity: 10 });
  });

  it('legacy shipments without a snapshot require a reviewed destination choice', async () => {
    const transfer = await ship();
    await prisma.$executeRaw`UPDATE transfer_items SET "productSnapshot" = NULL WHERE id = ${transfer.items[0].id}`;
    await receive(transfer.id, payload(transfer.items[0].id, 10)).expect(409);
    await receive(transfer.id, payload(transfer.items[0].id, 10, { destinationProductId })).expect(200);
  });

  it('a destination sale and receipt preserve both stock changes and history', async () => {
    const transfer = await ship();
    const results = await Promise.all([
      receive(transfer.id, payload(transfer.items[0].id, 10)),
      post('/api/sales', destinationToken, { items: [{ productId: destinationProductId, price: 19.99, quantity: 1 }], paymentMethod: 'CASH', amountPaid: 30 }),
    ]);
    expect(results.map(result => result.status)).toEqual([200, 201]); expect(await destinationStock()).toBe(14);
    const logs = await prisma.inventoryLog.findMany({ where: { productId: destinationProductId }, orderBy: { stockVersion: 'asc' } });
    expect(logs).toHaveLength(2); expect(logs[1].previousQty).toBe(logs[0].newQty); expect(logs[1].newQty).toBe(14);
  });

  it('a returned shipment can be confirmed once, including simultaneous retries after closure', async () => {
    const transfer = await ship(), itemId = transfer.items[0].id;
    await receive(transfer.id, { ...payload(itemId, 0, { sentBackQty: 10 }), notes: 'Whole shipment dispatched back' }).expect(200);
    const path = '/api/inventory-transfers/' + transfer.id + '/receive-return';
    await post(path, sourceToken, payload(itemId, 11)).expect(400);
    const body = { ...payload(itemId, 8, { damagedQty: 1, missingQty: 1 }), notes: 'Eight usable; one damaged; one confirmed lost' };
    const results = await Promise.all([post(path, sourceToken, body), post(path, sourceToken, body)]);
    expect(results.map(result => result.status)).toEqual([200, 200]); expect(await sourceStock()).toBe(98);
    expect(await prisma.inventoryLog.count({ where: { type: 'TRANSFER_RETURN' } })).toBe(1);
  });

  it('validates item IDs, quantity categories and reasons without partial changes', async () => {
    const transfer = await ship(), other = await create(), itemId = transfer.items[0].id;
    const bad = [payload(other.items[0].id, 1), payload(itemId, 11), payload(itemId, -1), payload(itemId, 0.5), payload(itemId, 1, { damagedQty: 1 }), { idempotencyKey: randomUUID(), items: [{ transferItemId: itemId, acceptedQty: 1 }, { transferItemId: itemId, acceptedQty: 1 }] }, {}];
    for (const body of bad) await receive(transfer.id, body).expect(400);
    expect(await prisma.transferReceipt.count()).toBe(0); expect(await destinationStock()).toBe(5);
  });

  it('keeps paginated history private to the two stores involved', async () => {
    const transfer = await ship(), path = '/api/inventory-transfers/' + transfer.id;
    for (let i = 0; i < 21; i++) await post(path + '/request-return', sourceToken, { idempotencyKey: randomUUID(), notes: 'Return request ' + i }).expect(200);
    const first = await read(path + '/receipts', destinationToken).expect(200);
    expect(first.body.data).toHaveLength(20); expect(first.body.pagination.total).toBe(21);
    const second = await read(path + '/receipts?page=2', sourceToken).expect(200); expect(second.body.data).toHaveLength(1);
    await prisma.user.update({ where: { id: data.adminUser.id }, data: { locationId: null } });
    await read(path + '/receipts', sourceToken).expect(401);
  });

  it('does not ship to a deactivated destination or change stock when cancelling a draft', async () => {
    const transfer = await create();
    await prisma.location.update({ where: { id: destinationId }, data: { isActive: false } });
    await post('/api/inventory-transfers/' + transfer.id + '/ship', sourceToken).expect(400);
    await post('/api/inventory-transfers/' + transfer.id + '/cancel', sourceToken).expect(200);
    expect(await sourceStock()).toBe(100); expect(await prisma.inventoryLog.count()).toBe(0);
  });

  it('carries dispatch costs through partial deliveries, losses and audited source corrections', async () => {
    const opening = async (token: string, productId: string, quantity: number, value: number) => {
      const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
      await post('/api/financial/inventory-costs/opening', token, { idempotencyKey: randomUUID(), notes: 'Verified physical opening',
        items: [{ productId, quantity, value, expectedVersion: product.stockVersion }] }).expect(200);
    };
    await opening(sourceToken, data.product.id, 100, 800); await opening(destinationToken, destinationProductId, 5, 25);
    const transfer = await ship(), itemId = transfer.items[0].id;
    const range = { gte: new Date(Date.now() - 60000), lt: new Date(Date.now() + 60000) };
    expect((await inventoryReconciliation(data.location.id, range)).inTransit).toMatchObject({ quantity: 10, value: 80 });
    await receive(transfer.id, { ...payload(itemId, 4, { damagedQty: 2 }), notes: 'Two damaged in transit' }).expect(200);
    expect(Number((await prisma.inventoryValuation.findUniqueOrThrow({ where: { productId: destinationProductId } })).value)).toBe(57);
    expect((await inventoryReconciliation(data.location.id, range)).inTransit).toMatchObject({ quantity: 4, value: 32 });
    expect((await getFinancialMetrics({ locationId: data.location.id })).inventoryCostAdjustments).toBe(16);
    const original = await prisma.inventoryValueEntry.findFirstOrThrow({ where: { productId: data.product.id, kind: 'OPENING' } });
    const body = { entryId: original.id, value: 1000, reason: 'Opening invoice verified at ten dollars per unit' };
    const preview = (await post('/api/financial/inventory-costs/corrections/preview', sourceToken, body).expect(200)).body.data;
    await post('/api/financial/inventory-costs/corrections', sourceToken, { ...body, token: preview.token, idempotencyKey: randomUUID() }).expect(200);
    expect(Number((await prisma.inventoryValuation.findUniqueOrThrow({ where: { productId: destinationProductId } })).value)).toBe(65);
    expect((await inventoryReconciliation(data.location.id, range)).inTransit).toMatchObject({ quantity: 4, value: 40 });
    expect((await getFinancialMetrics({ locationId: data.location.id })).inventoryCostAdjustments).toBe(20);
    expect(Number((await prisma.inventoryValueEntry.findUniqueOrThrow({ where: { id: original.id } })).inputValue)).toBe(800);
  });
});
