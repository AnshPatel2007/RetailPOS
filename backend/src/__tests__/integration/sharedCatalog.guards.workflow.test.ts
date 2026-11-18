/**
 * Shared catalog, store side (upgrade plan WP 5.3): a store cannot change a shared
 * item's shared fields or a price that follows the shared one, from the item form,
 * pack form, bulk tools, Price Review or a stock file; and a transfer between the
 * stores finds the item through the shared catalog.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { organizationIdOf, syncOwnerAccess } from '../../services/organization.service';

const store = (id: string, name: string, organizationId?: string) => ({ id, name, address: '1 Test St', city: 'Test', state: 'TS', zipCode: '12345',
  phone: '555-0100', email: id + '@store.test', ...(organizationId ? { organizationId } : {}) });

describe('Shared catalog: what a store can and cannot change', () => {
  let data: TestData, owner: string, organizationId: string;
  const A = 'test-location-1', B = 'store-b';
  const api = (method: 'get' | 'post' | 'put' | 'patch', url: string, body?: object, auth = owner) => {
    const pending = request(app)[method]('/api' + url).set('Authorization', 'Bearer ' + auth);
    return body ? pending.send(body) : pending;
  };
  const product = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });

  beforeEach(async () => {
    data = await seedTestData();
    organizationId = await organizationIdOf(A);
    await prisma.location.create({ data: store(B, 'Second Store', organizationId) });
    await prisma.organizationOwner.create({ data: { organizationId, userId: data.adminUser.id } });
    await prisma.$transaction(tx => syncOwnerAccess(tx, organizationId));
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
  });

  /** Cola in both stores, linked; the second store kept its own SKU. Its 6-pack in the first store is the shared pack. */
  async function cola() {
    const a = await prisma.product.create({ data: { name: 'Cola 12 oz', sku: 'COLA-12', barcode: '036000291452', price: 1.25, cost: 0.5, stockQuantity: 50, locationId: A } });
    const unit = await prisma.productSellingUnit.create({ data: { productId: a.id, locationId: A, name: 'Cola 6-pack', barcode: '036000291469', unitsPerPackage: 6, price: 6.99 } });
    const b = await prisma.product.create({ data: { name: 'Cola Can', sku: 'COLA-B', barcode: '036000291452', price: 1.35, cost: 0.5, stockQuantity: 5, locationId: B } });
    const id = (await api('post', '/catalog/from-product', { productId: a.id }).expect(200)).body.data.catalogItemId as string;
    await api('post', `/catalog/${id}/link`, { productId: b.id, makeMatch: false }).expect(200);
    return { a, b, unit, id };
  }
  const followAll = async (id: string, price: number) => {
    const { version } = (await api('get', `/catalog/${id}`).expect(200)).body.data;
    await api('put', `/catalog/${id}/price`, { expectedVersion: version, defaultPrice: price, apply: 'ALL' }).expect(200);
  };

  it('a store cannot change a shared item\'s shared fields; its own fields still change', async () => {
    const { a, unit } = await cola();
    const refused = await api('put', `/products/${a.id}`, { name: 'Renamed' }).expect(409);
    expect(refused.body).toMatchObject({ error: 'This is managed in the Shared Catalog.', details: { code: 'SHARED_FIELD', fields: ['name'] } });
    await api('put', `/products/${a.id}`, { name: 'Cola 12 oz', cost: 0.6, lowStockAlert: 3 }).expect(200);
    expect(await product(a.id)).toMatchObject({ lowStockAlert: 3 });
    const soda = await prisma.category.create({ data: { name: 'Soda', locationId: A } });
    await api('put', `/products/${a.id}`, { categoryId: soda.id }).expect(409);
    await api('patch', `/products/${a.id}/selling-units`, { baseUnitName: 'can' }).expect(409);
    await api('put', `/products/${a.id}/selling-units/${unit.id}`, { name: 'Six', expectedVersion: unit.version }).expect(409);
    // Items outside the shared catalog are the store's own.
    await api('put', `/products/${data.product.id}`, { name: 'Our Own Item' }).expect(200);
  });

  it('a price that follows the shared price changes only in the Shared Catalog, and only an owner or admin turns following off', async () => {
    const { a, unit, id } = await cola();
    await followAll(id, 1.5);
    expect((await api('put', `/products/${a.id}`, { price: 1.99 }).expect(409)).body.error).toBe('This price follows the shared catalog. Turn off Follow shared price to set a store price.');
    await api('put', `/products/${a.id}`, { price: 1.5 }).expect(200);
    const manager = await prisma.user.create({ data: { email: 'manager@test.com', password: data.adminUser.password, firstName: 'M', lastName: 'M', role: 'MANAGER', locationId: A } });
    await api('put', `/products/${a.id}`, { priceFollowsCatalog: false }, await createTestToken(manager.id, 'MANAGER')).expect(403);
    await api('put', `/products/${a.id}`, { priceFollowsCatalog: false, price: 1.99 }).expect(200);
    expect(await product(a.id)).toMatchObject({ priceFollowsCatalog: false });
    expect(Number((await product(a.id)).price)).toBe(1.99);
    await api('put', `/products/${a.id}`, { priceFollowsCatalog: true }).expect(200);
    expect(await product(a.id)).toMatchObject({ priceFollowsCatalog: true });
    expect(Number((await product(a.id)).price)).toBe(1.5);
    expect((await api('put', `/products/${data.product.id}`, { priceFollowsCatalog: true }).expect(400)).body.error).toBe('Only items in the shared catalog can follow a shared price');
    // The shared pack's price too.
    const pack = await prisma.catalogPack.findFirstOrThrow({ where: { catalogItemId: id } });
    await api('put', `/catalog/packs/${pack.id}/price`, { expectedVersion: pack.version, defaultPrice: 7.5, apply: 'ALL' }).expect(200);
    const current = await prisma.productSellingUnit.findUniqueOrThrow({ where: { id: unit.id } });
    await api('put', `/products/${a.id}/selling-units/${unit.id}`, { price: 9, expectedVersion: current.version }).expect(409);
  });

  it('bulk tools and Price Review leave following prices alone and say so', async () => {
    const { a, id } = await cola();
    await followAll(id, 1.5);
    const bulk = (await api('post', '/products/bulk-update-price', { productIds: [a.id, data.product.id], priceUpdate: 2.22 }).expect(200)).body.data;
    expect(bulk).toMatchObject({ updatedCount: 1, followingSharedPrice: 1 });
    expect([Number((await product(a.id)).price), Number((await product(data.product.id)).price)]).toEqual([1.5, 2.22]);
    const soda = await prisma.category.create({ data: { name: 'Soda', locationId: A } });
    expect((await api('post', '/products/bulk-update-category', { productIds: [a.id, data.product.id], categoryId: soda.id }).expect(200)).body.data)
      .toMatchObject({ updatedCount: 1, sharedSkipped: 1 });
    // Below cost: Price Review shows it as following the shared price, and applying skips it.
    await prisma.product.update({ where: { id: a.id }, data: { cost: 2 } });
    const review = (await api('get', '/pricing/review').expect(200)).body.data;
    expect(review.find((row: { productId: string; sellingUnitId: string | null }) => row.productId === a.id && !row.sellingUnitId))
      .toMatchObject({ status: 'BELOW_COST', priceFollowsCatalog: true, catalogItemId: id, catalogPackId: null });
    // The shared pack's row names its shared pack, so an owner can price it for every store.
    const pack = await prisma.catalogPack.findFirstOrThrow({ where: { catalogItemId: id } });
    expect(review.find((row: { productId: string; sellingUnitId: string | null }) => row.productId === a.id && row.sellingUnitId))
      .toMatchObject({ catalogItemId: id, catalogPackId: pack.id });
    const applied = (await api('post', '/pricing/apply', { changes: [{ productId: a.id, price: 2.5, expectedPrice: 1.5 }] }).expect(200)).body.data;
    expect(applied).toEqual({ applied: 0, followingSharedPrice: [{ productId: a.id, sellingUnitId: null, name: 'Cola 12 oz' }] });
    expect(Number((await product(a.id)).price)).toBe(1.5);
  });

  it('a stock file cannot change a shared item\'s shared fields or a price that follows the shared one', async () => {
    const { id } = await cola();
    const preview = (csv: string) => api('post', '/products/imports/csv/preview', { csv }).expect(200).then(res => res.body.data);
    expect((await preview('sku,name,barcode\nCOLA-12,Other Name,036000291452')).errors).toEqual(['Row 2: Cola 12 oz is in the Shared Catalog; change its name there']);
    expect((await preview('sku,name,stock\nCOLA-12,Cola 12 oz,40')).id).not.toBeNull();
    await followAll(id, 1.5);
    expect((await preview('sku,price\nCOLA-12,1.99')).errors).toEqual(['Row 2: Cola 12 oz\'s price follows the shared catalog; change it there']);
  });

  it('a transfer between the stores finds the item through the shared catalog, and an item made at the receiving store stays shared', async () => {
    const { a, b } = await cola();
    const receiver = await prisma.user.create({ data: { email: 'second-admin@test.com', password: data.adminUser.password, firstName: 'S', lastName: 'A', role: 'ADMIN', locationId: B } });
    await prisma.shift.create({ data: { userId: receiver.id, locationId: B, clockInAt: new Date() } });
    const receiving = await createTestToken(receiver.id, 'ADMIN');
    const transfer = async (productId: string) => {
      const created = (await api('post', '/inventory-transfers', { toLocationId: B, items: [{ productId, quantity: 5 }] }).expect(201)).body.data;
      await api('post', `/inventory-transfers/${created.id}/ship`).expect(200);
      return created;
    };
    // The second store's cola has its own SKU and name: the shared link finds it.
    const sent = await transfer(a.id);
    await api('post', `/inventory-transfers/${sent.id}/receive`, { idempotencyKey: randomUUID(), items: [{ transferItemId: sent.items[0].id, acceptedQty: 5 }] }, receiving).expect(200);
    expect((await product(b.id)).stockQuantity).toBe(10);

    // Chips are shared but the second store does not carry them yet: the item it creates is linked.
    const chips = await prisma.product.create({ data: { name: 'Chips', sku: 'CHIPS-1', price: 2, cost: 1, stockQuantity: 20, locationId: A } });
    const chipsId = (await api('post', '/catalog/from-product', { productId: chips.id }).expect(200)).body.data.catalogItemId;
    const second = await transfer(chips.id);
    await api('post', `/inventory-transfers/${second.id}/receive`, { idempotencyKey: randomUUID(),
      items: [{ transferItemId: second.items[0].id, acceptedQty: 5, createProduct: true }] }, receiving).expect(200);
    expect(await prisma.product.findFirstOrThrow({ where: { locationId: B, sku: 'CHIPS-1' } })).toMatchObject({ catalogItemId: chipsId, stockQuantity: 5 });
  });
});
