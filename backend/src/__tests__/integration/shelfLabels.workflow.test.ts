import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { AttentionContext, labelsOutOfDate } from '../../services/attention.service';

describe('Shelf labels to print after price changes', () => {
  let data: TestData;
  let owner: string;
  beforeEach(async () => { data = await seedTestData(); owner = await createTestToken(data.adminUser.id, 'ADMIN'); });
  const call = (method: 'get' | 'post' | 'put', path: string, body?: object, token = owner) => {
    const pending = request(app)[method](path).set('Authorization', 'Bearer ' + token);
    return body ? pending.send(body) : pending;
  };
  const pending = async () => (await call('get', '/api/products/labels/pending').expect(200)).body.data;
  const changedAt = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).priceChangedAt;
  const product = (sku: string, price = 2) => prisma.product.create({ data: { name: 'Label ' + sku, sku, barcode: sku + '-CODE', price, cost: 1, locationId: data.location.id } });

  it('stamps a price change through every write path, and nothing else', async () => {
    const [form, review, csv, raw] = await Promise.all(['FORM', 'REVIEW', 'CSV', 'RAW'].map(sku => product(sku)));
    expect(await changedAt(form.id)).toBeNull(); // a new item starts with no recorded change

    // A change that leaves the price alone, or changes something else, is not a price change.
    await call('put', '/api/products/' + form.id, { name: 'Label FORM renamed', price: 2 }).expect(200);
    expect(await changedAt(form.id)).toBeNull();

    const before = Date.now() - 1000;
    await call('put', '/api/products/' + form.id, { price: 2.49 }).expect(200);
    await call('post', '/api/pricing/apply', { changes: [{ productId: review.id, price: 2.79, expectedPrice: 2 }] }).expect(200);
    const staged = (await call('post', '/api/products/imports/csv/preview', { csv: 'sku,price\nCSV,2.99' }).expect(200)).body.data;
    await call('post', '/api/products/imports/' + staged.id + '/apply').expect(200);
    await prisma.product.update({ where: { id: raw.id }, data: { price: 3.09 } });
    for (const item of [form, review, csv, raw]) {
      const stamped = await changedAt(item.id);
      // Stored in UTC like every other time, whatever the database session's zone.
      expect(stamped!.getTime()).toBeGreaterThan(before);
      expect(stamped!.getTime()).toBeLessThan(Date.now() + 1000);
    }

    // A pack's own price, changed from its form.
    const pack = await prisma.productSellingUnit.create({ data: { productId: form.id, locationId: data.location.id, name: '6-pack', barcode: 'FORM-6', price: 12, unitsPerPackage: 6 } });
    expect(pack.priceChangedAt).toBeNull();
    await call('put', `/api/products/${form.id}/selling-units/${pack.id}`, { price: 13.5, expectedVersion: pack.version }).expect(200);
    expect((await prisma.productSellingUnit.findUniqueOrThrow({ where: { id: pack.id } })).priceChangedAt).not.toBeNull();
  });

  it('lists changed labels for this store, marks printed ones, and lists them again after the next change', async () => {
    const cola = await product('COLA'), chips = await product('CHIPS'), archived = await product('OLD');
    const pack = await prisma.productSellingUnit.create({ data: { productId: cola.id, locationId: data.location.id, name: '12-pack', barcode: 'COLA-12', price: 20, unitsPerPackage: 12 } });
    const other = await prisma.location.create({ data: { id: 'labels-other-store', name: 'Other Store', address: '1', city: 'C', state: 'TS', zipCode: '1', phone: '1', email: 'other@store.com' } });
    const elsewhere = await prisma.product.create({ data: { name: 'Elsewhere', sku: 'COLA', price: 2, cost: 1, locationId: other.id } });
    for (const id of [cola.id, chips.id, archived.id, elsewhere.id]) await prisma.product.update({ where: { id }, data: { price: 2.5 } });
    await prisma.product.update({ where: { id: archived.id }, data: { isActive: false } });
    await prisma.productSellingUnit.update({ where: { id: pack.id }, data: { price: 21 } });

    const list = await pending();
    expect(list.total).toBe(3);
    expect(list.items.map((item: { name: string }) => item.name).sort()).toEqual(['Label CHIPS', 'Label COLA', 'Label COLA (12-pack)']);
    expect(list.items.find((item: { kind: string }) => item.kind === 'PACK')).toMatchObject({ id: pack.id, productId: cola.id, sellingUnitId: pack.id, barcode: 'COLA-12', price: 21 });
    const context = { locationId: data.location.id, now: new Date() } as AttentionContext;
    expect(await labelsOutOfDate(context)).toMatchObject({ count: 3, href: '/inventory?labels=pending', sentence: '3 shelf labels are out of date after price changes. Print new ones.' });

    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await call('get', '/api/products/labels/pending', undefined, cashier).expect(403);
    await call('post', '/api/products/labels/printed', {}, owner).expect(400);
    const stamp = (id: string) => list.items.find((item: { id: string }) => item.id === id).priceChangedAt;

    // Cola's price changes again after the list was read: its label printed with the old price stays listed.
    await prisma.product.update({ where: { id: cola.id }, data: { price: 2.75 } });
    const marked = (await call('post', '/api/products/labels/printed', { products: [{ id: cola.id, priceChangedAt: stamp(cola.id) }, { id: chips.id, priceChangedAt: stamp(chips.id) },
      { id: elsewhere.id, priceChangedAt: new Date().toISOString() }], sellingUnits: [{ id: pack.id, priceChangedAt: stamp(pack.id) }] }).expect(200)).body.data;
    expect(marked).toEqual({ marked: 2 }); // chips and the pack; not the changed cola, not another store's item
    expect((await pending()).items.map((item: { id: string }) => item.id)).toEqual([cola.id]);
    expect(await prisma.activityLog.count({ where: { action: 'SHELF_LABELS_PRINTED', locationId: data.location.id } })).toBe(1);

    // Printing the current cola label clears the list; the next price change brings chips back.
    const fresh = (await pending()).items[0];
    await call('post', '/api/products/labels/printed', { products: [{ id: cola.id, priceChangedAt: fresh.priceChangedAt }] }).expect(200);
    expect((await pending()).total).toBe(0);
    expect(await labelsOutOfDate(context)).toBeNull();
    await call('put', '/api/products/' + chips.id, { price: 2.29 }).expect(200);
    expect((await pending()).items.map((item: { id: string }) => item.id)).toEqual([chips.id]);
  });
});
