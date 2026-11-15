/**
 * Shared catalog, changing items (upgrade plan WP 5.2): an owner edits an item once
 * and every store that carries it changes; a clash in one store refuses the whole
 * change; shared prices reach the stores chosen; items are added to a store with no
 * stock and their packs; a store's own item can be linked or unlinked.
 */
import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { organizationIdOf, syncOwnerAccess } from '../../services/organization.service';

const store = (id: string, name: string, organizationId?: string) => ({ id, name, address: '1 Test St', city: 'Test', state: 'TS', zipCode: '12345',
  phone: '555-0100', email: id + '@store.test', ...(organizationId ? { organizationId } : {}) });

describe('Shared catalog: editing, prices and adding to stores', () => {
  let data: TestData, owner: string, organizationId: string;
  const A = 'test-location-1', B = 'store-b', D = 'store-d';
  const call = (method: 'get' | 'post' | 'put', url: string, body?: object, auth = owner) => {
    const pending = request(app)[method]('/api/catalog' + url).set('Authorization', 'Bearer ' + auth);
    return body ? pending.send(body) : pending;
  };
  const item = (locationId: string, name: string, sku: string, extra: object = {}) =>
    prisma.product.create({ data: { name, sku, price: 1.25, cost: 0.5, stockQuantity: 10, locationId, ...extra } });
  const product = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });

  beforeEach(async () => {
    data = await seedTestData();
    organizationId = await organizationIdOf(A);
    await prisma.location.create({ data: store(B, 'Second Store', organizationId) });
    await prisma.location.create({ data: store(D, 'Third Store', organizationId) });
    await prisma.location.create({ data: store('store-c', 'Other Business') });
    await prisma.organizationOwner.create({ data: { organizationId, userId: data.adminUser.id } });
    await prisma.$transaction(tx => syncOwnerAccess(tx, organizationId));
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
  });

  /** Cola, carried by the first two stores and linked; the first store's 6-pack is the shared pack. */
  async function cola() {
    const a = await item(A, 'Cola 12 oz', 'COLA-12', { barcode: '036000291452' });
    const unitA = await prisma.productSellingUnit.create({ data: { productId: a.id, locationId: A, name: 'Cola 6-pack', barcode: '036000291469', unitsPerPackage: 6, price: 6.99 } });
    const b = await item(B, 'Cola 12oz', 'COLA-12', { barcode: '036000291452', price: 1.35 });
    const id = (await call('post', '/from-product', { productId: a.id }).expect(200)).body.data.catalogItemId as string;
    await call('post', `/${id}/link`, { productId: b.id, makeMatch: true }).expect(200);
    const version = (await call('get', `/${id}`).expect(200)).body.data.version as number;
    return { a, b, unitA, id, version };
  }

  it('an edit reaches every store that carries the item, and a stale version is refused', async () => {
    const { a, b, id, version } = await cola();
    expect((await product(b.id)).name).toBe('Cola 12 oz');
    const edited = (await call('put', `/${id}`, { expectedVersion: version, fields: { name: 'Cola Classic 12 oz', size: '12 oz', categoryName: 'Soft Drinks', minimumAge: null } }).expect(200)).body.data;
    expect(edited).toMatchObject({ name: 'Cola Classic 12 oz', size: '12 oz', categoryName: 'Soft Drinks', version: version + 1 });
    for (const id of [a.id, b.id]) expect(await prisma.product.findUniqueOrThrow({ where: { id }, include: { category: true } }))
      .toMatchObject({ name: 'Cola Classic 12 oz', size: '12 oz', category: { name: 'Soft Drinks' } });
    expect(await prisma.category.count({ where: { name: 'Soft Drinks' } })).toBe(2);
    expect(await prisma.activityLog.count({ where: { action: 'CATALOG_ITEM_UPDATED' } })).toBe(2);
    // Prices are the stores' own: an edit never touches them.
    expect(Number((await product(b.id)).price)).toBe(1.35);
    expect((await call('put', `/${id}`, { expectedVersion: version, fields: { name: 'Again' } }).expect(409)).body.error).toContain('Someone else changed this item');
    await call('put', `/${id}`, { expectedVersion: version + 1, fields: {} }).expect(400);
  });

  it('a clash in one store refuses the whole change and names the store', async () => {
    const { a, id, version } = await cola();
    await item(B, 'Other Cola', 'OTHER', { barcode: '012345678905' });
    const refused = await call('put', `/${id}`, { expectedVersion: version, fields: { name: 'Renamed', barcode: '012345678905' } }).expect(409);
    expect(refused.body.error).toBe('Second Store: Barcode already belongs to Other Cola. Nothing was changed.');
    expect(await product(a.id)).toMatchObject({ name: 'Cola 12 oz', barcode: '036000291452' });
    expect(await prisma.catalogItem.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: 'Cola 12 oz', version });
    await prisma.catalogItem.create({ data: { organizationId, name: 'Another', sku: 'ANOTHER' } });
    expect((await call('put', `/${id}`, { expectedVersion: version, fields: { sku: 'ANOTHER' } }).expect(409)).body.error).toBe('Another shared item already has this SKU');
  });

  it('a shared price reaches the stores that follow it, all stores, or the stores chosen', async () => {
    const { a, b, unitA, id, version } = await cola();
    const followers = (await call('put', `/${id}/price`, { expectedVersion: version, defaultPrice: 1.49, apply: 'FOLLOWING' }).expect(200)).body.data;
    expect(followers).toMatchObject({ updated: 0, item: { defaultPrice: 1.49 } });
    expect(Number((await product(a.id)).price)).toBe(1.25);
    const all = (await call('put', `/${id}/price`, { expectedVersion: version + 1, defaultPrice: 1.59, apply: 'ALL' }).expect(200)).body.data;
    expect(all.updated).toBe(2);
    for (const row of [await product(a.id), await product(b.id)]) {
      expect(Number(row.price)).toBe(1.59);
      expect(row.priceFollowsCatalog).toBe(true);
      expect(row.priceChangedAt).not.toBeNull(); // the shelf label is due
    }
    await prisma.product.update({ where: { id: b.id }, data: { priceFollowsCatalog: false } });
    expect((await call('put', `/${id}/price`, { expectedVersion: version + 2, defaultPrice: 1.69, apply: 'FOLLOWING' }).expect(200)).body.data.updated).toBe(1);
    expect([Number((await product(a.id)).price), Number((await product(b.id)).price)]).toEqual([1.69, 1.59]);
    await call('put', `/${id}/price`, { expectedVersion: version + 3, defaultPrice: 1.79, apply: { locationIds: [B] } }).expect(200);
    expect(await product(b.id)).toMatchObject({ priceFollowsCatalog: true });
    expect([Number((await product(a.id)).price), Number((await product(b.id)).price)]).toEqual([1.69, 1.79]);
    expect((await call('put', `/${id}/price`, { expectedVersion: version + 4, defaultPrice: 2, apply: { locationIds: [D] } }).expect(400)).body.error).toBe('Third Store does not carry this item');
    // A shared pack price works the same way.
    const pack = (await prisma.catalogPack.findFirstOrThrow({ where: { catalogItemId: id } }));
    await call('put', `/packs/${pack.id}/price`, { expectedVersion: pack.version, defaultPrice: 7.49, apply: 'ALL' }).expect(200);
    expect(await prisma.productSellingUnit.findUniqueOrThrow({ where: { id: unitA.id } })).toMatchObject({ priceFollowsCatalog: true, catalogPackId: pack.id });
    expect(Number((await prisma.productSellingUnit.findUniqueOrThrow({ where: { id: unitA.id } })).price)).toBe(7.49);
  });

  it('adding an item to a store creates it with no stock, its packs and the shared price; an item already there is offered to link', async () => {
    const { id } = await cola();
    const added = (await call('post', `/${id}/publish`, { locationId: D, followPrice: true, lowStockAlert: 4 }).expect(200)).body.data;
    const created = await prisma.product.findUniqueOrThrow({ where: { id: added.productId }, include: { sellingUnits: true } });
    expect(created).toMatchObject({ locationId: D, name: 'Cola 12 oz', sku: 'COLA-12', barcode: '036000291452', stockQuantity: 0, lowStockAlert: 4,
      catalogItemId: id, priceFollowsCatalog: true, trackInventory: true });
    expect([Number(created.price), Number(created.cost)]).toEqual([1.25, 0]);
    expect(created.sellingUnits).toMatchObject([{ name: 'Cola 6-pack', barcode: '036000291469', unitsPerPackage: 6, priceFollowsCatalog: true }]);
    expect(Number(created.sellingUnits[0].price)).toBe(6.99);
    expect(added.item.missingStores).toEqual([]);
    expect((await call('post', `/${id}/publish`, { locationId: D, followPrice: true }).expect(409)).body.error).toBe('Third Store already carries Cola 12 oz');
    await call('post', `/${id}/publish`, { locationId: 'store-c', followPrice: true }).expect(400);

    // The second store already sells chips under the same SKU: link it instead.
    const chipsA = await item(A, 'Chips', 'CHIPS-1', { price: 2 });
    const chipsB = await item(B, 'Chips Original', 'CHIPS-1', { price: 2.25 });
    const chips = (await call('post', '/from-product', { productId: chipsA.id }).expect(200)).body.data.catalogItemId;
    const conflict = await call('post', `/${chips}/publish`, { locationId: B, followPrice: false, price: 2.5 }).expect(409);
    expect(conflict.body).toMatchObject({ error: 'Second Store already has Chips Original with this SKU. Link it instead.', details: { code: 'PRODUCT_EXISTS', existingProductId: chipsB.id } });
    await call('post', `/${chips}/link`, { productId: chipsB.id, makeMatch: true }).expect(200);
    expect(await product(chipsB.id)).toMatchObject({ catalogItemId: chips, name: 'Chips' });
    // Its own price, not following.
    const own = (await call('post', `/${chips}/publish`, { locationId: D, followPrice: false, price: 2.5 }).expect(200)).body.data;
    expect(await product(own.productId)).toMatchObject({ priceFollowsCatalog: false });
    expect(Number((await product(own.productId)).price)).toBe(2.5);
    // An item with no shared price cannot follow one.
    const noPrice = await prisma.catalogItem.create({ data: { organizationId, name: 'Loose Candy', sku: 'CANDY' } });
    expect((await call('post', `/${noPrice.id}/publish`, { locationId: D, followPrice: true }).expect(400)).body.error).toBe('Loose Candy has no shared price yet');
  });

  it('adding many items to a new store lists what was added and what was skipped', async () => {
    const { id } = await cola();
    const chipsA = await item(A, 'Chips', 'CHIPS-1', { price: 2 });
    const chips = (await call('post', '/from-product', { productId: chipsA.id }).expect(200)).body.data.catalogItemId;
    await item(D, 'Our Chips', 'CHIPS-1');
    const result = (await call('post', '/publish', { itemIds: [id, chips, '00000000-0000-4000-8000-000000000000'], locationId: D, followPrice: true }).expect(200)).body.data;
    expect(result.created.map((row: { catalogItemId: string }) => row.catalogItemId)).toEqual([id]);
    expect(result.skipped).toMatchObject([
      { catalogItemId: chips, reason: 'Third Store already has Our Chips with this SKU. Link it instead.' },
      { catalogItemId: '00000000-0000-4000-8000-000000000000', reason: 'Shared item not found', existingProductId: null },
    ]);
    expect(await prisma.product.count({ where: { locationId: D, catalogItemId: id, stockQuantity: 0 } })).toBe(1);
    await call('post', '/publish', { itemIds: [id], locationId: 'store-c', followPrice: true }).expect(400);
  });

  it('unlinking leaves the store\'s item as its own', async () => {
    const { b, id, version } = await cola();
    await call('put', `/${id}/price`, { expectedVersion: version, defaultPrice: 1.5, apply: 'ALL' }).expect(200);
    const after = (await call('post', `/${id}/unlink`, { productId: b.id }).expect(200)).body.data;
    expect(after.listings.map((row: { storeName: string }) => row.storeName)).toEqual(['Test Store']);
    expect(after.missingStores.map((row: { storeName: string }) => row.storeName)).toEqual(['Second Store', 'Third Store']);
    expect(await product(b.id)).toMatchObject({ catalogItemId: null, priceFollowsCatalog: false, name: 'Cola 12 oz' });
    await call('post', `/${id}/unlink`, { productId: b.id }).expect(404);
  });

  it('a new shared pack reaches every store, a store\'s own pack of that size refuses it, and pack edits reach every store', async () => {
    const { a, b, id, version } = await cola();
    const added = (await call('post', `/${id}/packs`, { expectedVersion: version, name: 'Cola 12-pack', barcode: '036000291476', unitsPerPackage: 12, defaultPrice: 13.99 }).expect(200)).body.data;
    expect(added.packs.map((pack: { unitsPerPackage: number }) => pack.unitsPerPackage)).toEqual([6, 12]);
    const twelve = added.packs.find((pack: { unitsPerPackage: number }) => pack.unitsPerPackage === 12);
    const units = await prisma.productSellingUnit.findMany({ where: { catalogPackId: twelve.id } });
    expect(units.map(unit => [unit.productId, unit.unitsPerPackage, Number(unit.price), unit.priceFollowsCatalog]).sort())
      .toEqual([[a.id, 12, 13.99, true], [b.id, 12, 13.99, true]].sort());
    await call('post', `/${id}/packs`, { expectedVersion: added.version, name: 'Cola 12-pack', barcode: '036000291483', unitsPerPackage: 12 }).expect(409);

    await prisma.productSellingUnit.create({ data: { productId: b.id, locationId: B, name: 'Cola Case', barcode: '036000291490', unitsPerPackage: 24, price: 25 } });
    const refused = await call('post', `/${id}/packs`, { expectedVersion: added.version, name: 'Cola 24-pack', barcode: '036000291506', unitsPerPackage: 24 }).expect(409);
    expect(refused.body.error).toContain('Second Store already sells Cola Case, a 24-unit pack of this item');
    expect(await prisma.catalogPack.count({ where: { catalogItemId: id } })).toBe(2);

    const pack = await prisma.catalogPack.findUniqueOrThrow({ where: { id: twelve.id } });
    await call('put', `/packs/${pack.id}`, { expectedVersion: pack.version, name: 'Cola Fridge Pack', barcode: '036000291513' }).expect(200);
    expect((await prisma.productSellingUnit.findMany({ where: { catalogPackId: pack.id } })).map(unit => [unit.name, unit.barcode])).toEqual([
      ['Cola Fridge Pack', '036000291513'], ['Cola Fridge Pack', '036000291513']]);
    await call('put', `/packs/${pack.id}`, { expectedVersion: pack.version, name: 'Stale' }).expect(409);
  });

  it('only owners change the catalog; the platform preview cannot', async () => {
    const { id, version } = await cola();
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await call('put', `/${id}`, { expectedVersion: version, fields: { name: 'X' } }, cashier).expect(403);
    await call('post', `/${id}/publish`, { locationId: D, followPrice: true }, cashier).expect(403);
    const platform = await prisma.user.create({ data: { email: 'platform@test.com', password: data.adminUser.password, firstName: 'P', lastName: 'A', role: 'SUPER_ADMIN' } });
    expect((await call('put', `/${id}/price`, { expectedVersion: version, defaultPrice: 2, apply: 'ALL' }, await createTestToken(platform.id, 'SUPER_ADMIN')).expect(403)).body.error).toBe('Store preview is read-only');
  });
});
