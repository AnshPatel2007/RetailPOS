import request from 'supertest';
import { numeric } from '../../utils/money';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('Reviewed inventory imports', () => {
  let data: TestData, token: string;
  const post = (path: string, body: object = {}, auth = token) => request(app).post('/api/products' + path).set('Authorization', 'Bearer ' + auth).send(body);
  const preview = async (csv: string) => (await post('/imports/csv/preview', { csv }).expect(200)).body.data;
  beforeEach(async () => { data = await seedTestData(); token = await createTestToken(data.adminUser.id, 'ADMIN'); });

  it('previews changes without writes, then creates original movement history and applies once under concurrent retries', async () => {
    const staged = await preview('sku,name,price,cost,stock\nNEW-IMPORT,"Coffee, Dark",3.25,1.25,8\n' + data.product.sku + ',,25,,99');
    expect(staged).toMatchObject({ created: 1, updated: 1, errors: [] });
    expect(await prisma.product.count()).toBe(1);
    const responses = await Promise.all([post('/imports/' + staged.id + '/apply'), post('/imports/' + staged.id + '/apply')]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(responses.map(r => r.body.data.replayed).sort()).toEqual([false, true]);
    expect(numeric(await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } }))).toMatchObject({ stockQuantity: 99, price: 25, cost: 10, name: 'Test Product' });
    const created = await prisma.product.findFirstOrThrow({ where: { sku: 'NEW-IMPORT' } });
    expect(created).toMatchObject({ name: 'Coffee, Dark', stockQuantity: 8, locationId: data.location.id });
    const movements = await prisma.inventoryLog.findMany({ where: { sourceId: staged.id } });
    expect(movements).toHaveLength(2); expect(movements.find(m => m.productId === created.id)).toMatchObject({ previousQty: 0, newQty: 8, locationId: data.location.id, stockVersion: created.stockVersion });
    await expect(prisma.inventoryImport.delete({ where: { id: staged.id } })).rejects.toThrow();
  });

  it('a sale after preview invalidates the entire import instead of overwriting stock', async () => {
    const staged = await preview('sku,name,price,stock\nNEW-FIRST,New,3,5\n' + data.product.sku + ',,20,120');
    await request(app).post('/api/shifts/clock-in').set('Authorization', 'Bearer ' + token).send({ startingCash: 100 }).expect(201);
    await request(app).post('/api/sales').set('Authorization', 'Bearer ' + token).send({ idempotencyKey: randomUUID(), items: [{ productId: data.product.id, quantity: 1, price: 19.99 }], paymentMethod: 'CASH', amountPaid: 30 }).expect(201);
    await post('/imports/' + staged.id + '/apply').expect(409);
    expect(await prisma.product.count()).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(99);
    expect((await prisma.inventoryImport.findUniqueOrThrow({ where: { id: staged.id } })).appliedAt).toBeNull();
  });

  it('shows row-specific validation errors and prevents ambiguous or invalid rows from applying', async () => {
    const result = await preview('sku,name,price,stock\nNEW,Name,2.5,3\nNEW,Duplicate,2.5,4\nBAD,Invalid,abc,-1');
    expect(result.id).toBeNull(); expect(result.errors.join(' ')).toContain('Row 3: duplicate SKU'); expect(result.errors.join(' ')).toContain('Row 4:');
    expect(await prisma.inventoryImport.count()).toBe(0); expect(await prisma.product.count()).toBe(1);
    const missingPrice = await preview('sku,name\nNO-PRICE,Missing price'); expect(missingPrice.errors.join(' ')).toContain('new products require name and price');
  });

  it('expiry and another actor cannot change a reviewed import', async () => {
    const staged = await preview('sku,stock\n' + data.product.sku + ',105');
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await post('/imports/' + staged.id + '/apply', {}, cashier).expect(403);
    const otherOwner = await prisma.user.create({ data: { email: 'another-owner@example.test', password: data.adminUser.password, firstName: 'Other', lastName: 'Owner', role: 'ADMIN', locationId: data.location.id } });
    await post('/imports/' + staged.id + '/apply', {}, await createTestToken(otherOwner.id, 'ADMIN')).expect(404);
    const record = await prisma.inventoryImport.findUniqueOrThrow({ where: { id: staged.id } });
    await prisma.inventoryImport.create({ data: { ...record, id: randomUUID(), result: undefined, payload: record.payload as Prisma.InputJsonValue, preview: record.preview as Prisma.InputJsonValue, expiresAt: new Date(Date.now() - 1000) } }).then(async expired => { await post('/imports/' + expired.id + '/apply').expect(409); });
    await expect(prisma.inventoryImport.update({ where: { id: staged.id }, data: { payload: {} } })).rejects.toThrow();
  });

  it('receipt imports use own products and suppliers, require reviewed retail prices, and add stock once', async () => {
    const other = await prisma.location.create({ data: { name: 'Other', address: 'Other', city: 'Other', state: 'TS', zipCode: '12345', phone: '555', email: 'other@example.test' } });
    const foreign = await prisma.product.create({ data: { sku: 'FOREIGN', name: 'Foreign', price: 1, cost: 1, locationId: other.id } });
    await prisma.supplier.create({ data: { name: 'Receipt Supplier', locationId: other.id } });
    const bad = (await post('/imports/receipt/preview', { items: [{ matchedProductId: foreign.id, name: 'Foreign', unitQuantity: 10, unitCost: 1 }] }).expect(200)).body.data;
    expect(bad.id).toBeNull();
    const noPrice = (await post('/imports/receipt/preview', { items: [{ sku: 'NEW-RECEIPT', name: 'New receipt item', unitQuantity: 3, unitCost: 1 }] }).expect(200)).body.data;
    expect(noPrice.id).toBeNull();
    const body = { supplier: 'Receipt Supplier', invoiceNumber: 'INVOICE-1', items: [
      { matchedProductId: data.product.id, name: data.product.name, unitQuantity: 2, unitCost: 11 },
      { sku: 'NEW-RECEIPT', name: 'New receipt item', price: 3.5, unitQuantity: 3, unitCost: 1 },
    ] };
    const staged = (await post('/imports/receipt/preview', body).expect(200)).body.data;
    await post('/imports/' + staged.id + '/apply').expect(200); await post('/imports/' + staged.id + '/apply').expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(102);
    expect(await prisma.supplier.count({ where: { name: body.supplier } })).toBe(2);
    const links = await prisma.productSupplier.findMany({ include: { supplier: true } }); expect(links.every(link => link.supplier.locationId === data.location.id)).toBe(true);
    await post('/apply-receipt', body).expect(428);
  });
});
