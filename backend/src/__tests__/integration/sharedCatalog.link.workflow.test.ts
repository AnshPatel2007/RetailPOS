/**
 * Shared catalog, linking (upgrade plan WP 5.1): an owner reviews which products of
 * their stores are the same item, then links them once; retries never link twice,
 * anything that changed since the review is refused, and nothing from another
 * business or a non-owner gets through.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { organizationIdOf, syncOwnerAccess } from '../../services/organization.service';

const store = (id: string, name: string, organizationId?: string) => ({ id, name, address: '1 Test St', city: 'Test', state: 'TS', zipCode: '12345',
  phone: '555-0100', email: id + '@store.test', ...(organizationId ? { organizationId } : {}) });

describe('Shared catalog: linking existing products', () => {
  let data: TestData, owner: string, organizationId: string;
  const A = 'test-location-1', B = 'store-b';
  const call = (method: 'get' | 'post', url: string, body?: object, auth = owner) => {
    const pending = request(app)[method]('/api/catalog' + url).set('Authorization', 'Bearer ' + auth);
    return body ? pending.send(body) : pending;
  };
  const item = (locationId: string, name: string, sku: string, extra: object = {}) =>
    prisma.product.create({ data: { name, sku, price: 1.25, cost: 0.5, stockQuantity: 10, locationId, ...extra } });

  beforeEach(async () => {
    data = await seedTestData();
    organizationId = await organizationIdOf(A);
    await prisma.location.create({ data: store(B, 'Second Store', organizationId) });
    await prisma.location.create({ data: store('store-c', 'Other Business') });
    await prisma.organizationOwner.create({ data: { organizationId, userId: data.adminUser.id } });
    await prisma.$transaction(tx => syncOwnerAccess(tx, organizationId));
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
  });

  async function stock() {
    const cokeA = await item(A, 'Coca-Cola 12 oz Can', 'COKE-12', { barcode: '049000000443', size: '12 oz', categoryId: data.category.id, price: 1.25 });
    await prisma.productSellingUnit.create({ data: { productId: cokeA.id, locationId: A, name: '12-pack', barcode: '049000028911', unitsPerPackage: 12, price: 12 } });
    const cokeB = await item(B, 'Coke 12oz Can', 'C12', { barcode: '0049000000443', price: 1.35 });
    const packB = await prisma.productSellingUnit.create({ data: { productId: cokeB.id, locationId: B, name: 'Coke 12 pack', barcode: '049000028911', unitsPerPackage: 12, price: 13 } });
    const snackA = await item(A, 'Snack Bar', 'SNACK-1');
    const snackB = await item(B, 'snack bar', 'snack-1');
    const onlyA = await item(A, 'Only Here', 'ONLY-1');
    const foreign = await item('store-c', 'Coca-Cola 12 oz Can', 'COKE-12', { barcode: '049000000443' });
    return { cokeA, cokeB, packB, snackA, snackB, onlyA, foreign };
  }

  it('shows which items match across the stores, with what differs, and saves nothing', async () => {
    const rows = await stock();
    const preview = (await call('post', '/link/preview', { primaryLocationId: A }).expect(200)).body.data;
    expect(preview.groups.map((group: { match: string; members: { productId: string }[] }) => [group.match, group.members.map(member => member.productId)])).toEqual([
      ['BARCODE', [rows.cokeA.id, rows.cokeB.id]],
      ['SKU_NAME', [rows.snackA.id, rows.snackB.id]],
    ]);
    const coke = preview.groups[0];
    expect(coke).toMatchObject({ existingCatalogItemId: null, problem: null, shared: { name: 'Coca-Cola 12 oz Can', sku: 'COKE-12', barcode: '049000000443', size: '12 oz', categoryName: 'Test Category' } });
    expect(coke.members[1]).toMatchObject({ storeName: 'Second Store', name: 'Coke 12oz Can', price: 1.35, packs: [{ name: 'Coke 12 pack', unitsPerPackage: 12 }] });
    expect(coke.differences.map((difference: { field: string }) => difference.field)).toEqual(['name', 'sku', 'barcode', 'size', 'categoryName', 'price']);
    expect(coke.differences.find((difference: { field: string }) => difference.field === 'price')).toMatchObject({ label: 'Price', shared: null,
      stores: [{ storeName: 'Test Store', value: 1.25 }, { storeName: 'Second Store', value: 1.35 }] });
    expect(JSON.stringify(preview)).not.toContain(rows.foreign.id);
    expect(await prisma.catalogItem.count()).toBe(0);
    // The other store as the main one proposes its own names.
    expect((await call('post', '/link/preview', { primaryLocationId: B }).expect(200)).body.data.groups[0].shared.name).toBe('Coke 12oz Can');
    await call('post', '/link/preview', { primaryLocationId: 'store-c' }).expect(400);
  });

  it('links each group once, with its packs; matching copies the shared fields but never prices; a retry returns the first result', async () => {
    const rows = await stock();
    const preview = (await call('post', '/link/preview', { primaryLocationId: A }).expect(200)).body.data;
    const body = { idempotencyKey: randomUUID(), primaryLocationId: A, groups: [
      { fingerprint: preview.groups[0].fingerprint, productIds: preview.groups[0].members.map((member: { productId: string }) => member.productId), makeStoresMatch: false },
      { fingerprint: preview.groups[1].fingerprint, productIds: preview.groups[1].members.map((member: { productId: string }) => member.productId), makeStoresMatch: true },
    ] };
    const applied = (await call('post', '/link/apply', body).expect(200)).body;
    expect(applied).toMatchObject({ replayed: false, data: { linked: 2, products: 4 } });

    const coke = await prisma.catalogItem.findFirstOrThrow({ where: { sku: 'COKE-12' }, include: { packs: true, products: true } });
    expect(coke).toMatchObject({ organizationId, name: 'Coca-Cola 12 oz Can', barcode: '049000000443', categoryName: 'Test Category', createdById: data.adminUser.id });
    expect(Number(coke.defaultPrice)).toBe(1.25);
    expect(coke.packs).toMatchObject([{ name: '12-pack', barcode: '049000028911', unitsPerPackage: 12 }]);
    expect(coke.products.map(product => product.id).sort()).toEqual([rows.cokeA.id, rows.cokeB.id].sort());
    expect((await prisma.productSellingUnit.findUniqueOrThrow({ where: { id: rows.packB.id } })).catalogPackId).toBe(coke.packs[0].id);
    // Not matched: the second store keeps its own name and price.
    expect(await prisma.product.findUniqueOrThrow({ where: { id: rows.cokeB.id } })).toMatchObject({ name: 'Coke 12oz Can', sku: 'C12', priceFollowsCatalog: false });
    // Matched: shared fields copied, price untouched.
    const snackB = await prisma.product.findUniqueOrThrow({ where: { id: rows.snackB.id } });
    expect(snackB).toMatchObject({ name: 'Snack Bar', sku: 'SNACK-1' });
    expect(Number(snackB.price)).toBe(1.25);

    const again = (await call('post', '/link/apply', body).expect(200)).body;
    expect(again).toMatchObject({ replayed: true, receiptId: applied.receiptId, data: applied.data });
    expect(await prisma.catalogItem.count()).toBe(2);
    await call('post', '/link/apply', { ...body, groups: body.groups.slice(0, 1) }).expect(409);
    // Everything that matched is linked now.
    expect((await call('post', '/link/preview', { primaryLocationId: A }).expect(200)).body.data.groups).toEqual([]);

    // The catalog lists each item with its stores, and the stores that do not carry it.
    const list = (await call('get', '?search=coca').expect(200)).body.data;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ name: 'Coca-Cola 12 oz Can', defaultPrice: 1.25,
      listings: [{ storeName: 'Second Store', price: 1.35, priceFollowsCatalog: false }, { storeName: 'Test Store', price: 1.25 }], missingStores: [] });
    expect(list.stores.map((row: { name: string }) => row.name)).toEqual(['Second Store', 'Test Store']);
    expect((await call('get', '?search=049000000443').expect(200)).body.data.items).toHaveLength(1);
  });

  it('refuses a group that changed since the review, or that has two matches in one store', async () => {
    const rows = await stock();
    const preview = (await call('post', '/link/preview', { primaryLocationId: A }).expect(200)).body.data;
    await prisma.product.update({ where: { id: rows.cokeB.id }, data: { name: 'Coke Can 12 oz' } });
    const stale = await call('post', '/link/apply', { idempotencyKey: randomUUID(), primaryLocationId: A,
      groups: [{ fingerprint: preview.groups[0].fingerprint, productIds: [rows.cokeA.id, rows.cokeB.id], makeStoresMatch: false }] }).expect(409);
    expect(stale.body.error).toContain('changed since you reviewed them');
    expect(await prisma.catalogItem.count()).toBe(0);

    await item(B, 'Gum Mint', 'GUM-1', { barcode: '012345678905' });
    await item(B, 'Gum Mint (old)', 'GUM-OLD', { barcode: '0012345678905' });
    await item(A, 'Gum', 'GUM', { barcode: '012345678905' });
    const gum = (await call('post', '/link/preview', { primaryLocationId: A }).expect(200)).body.data.groups.find((group: { shared: { name: string } }) => group.shared.name === 'Gum');
    expect(gum.problem).toContain('Second Store has more than one matching item');
    await call('post', '/link/apply', { idempotencyKey: randomUUID(), primaryLocationId: A,
      groups: [{ fingerprint: gum.fingerprint, productIds: gum.members.map((member: { productId: string }) => member.productId), makeStoresMatch: false }] }).expect(409);
  });

  it('a shared item can start from one store\'s product, and a later product joins it', async () => {
    const rows = await stock();
    const made = (await call('post', '/from-product', { productId: rows.onlyA.id }).expect(200)).body.data;
    expect(made).toMatchObject({ created: true });
    expect((await call('post', '/from-product', { productId: rows.onlyA.id }).expect(200)).body.data).toEqual({ catalogItemId: made.catalogItemId, created: false });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: rows.onlyA.id } })).catalogItemId).toBe(made.catalogItemId);

    // The second store starts selling it: it joins the shared item.
    const onlyB = await item(B, 'only here', 'only-1');
    const join = (await call('post', '/link/preview', { primaryLocationId: A }).expect(200)).body.data.groups.find((group: { existingCatalogItemId: string | null }) => group.existingCatalogItemId);
    expect(join).toMatchObject({ existingCatalogItemId: made.catalogItemId, existingName: 'Only Here', members: [{ productId: onlyB.id }] });
    await call('post', '/link/apply', { idempotencyKey: randomUUID(), primaryLocationId: A, groups: [{ fingerprint: join.fingerprint, productIds: [onlyB.id], makeStoresMatch: true }] }).expect(200);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: onlyB.id } })).toMatchObject({ catalogItemId: made.catalogItemId, name: 'Only Here', sku: 'ONLY-1' });

    // A product whose SKU the catalog already uses cannot start a second item.
    const clash = await item(B, 'Clashing', 'COKE-ISH');
    await prisma.catalogItem.create({ data: { organizationId, name: 'Taken', sku: 'COKE-ISH' } });
    expect((await call('post', '/from-product', { productId: clash.id }).expect(409)).body.error).toContain('already has Taken with this SKU');
    await call('post', '/from-product', { productId: rows.foreign.id }).expect(404);
  });

  it('only owners manage the catalog, and the platform preview cannot change it', async () => {
    const rows = await stock();
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await call('get', '', undefined, cashier).expect(403);
    await call('post', '/link/preview', { primaryLocationId: A }, cashier).expect(403);
    await call('post', '/from-product', { productId: rows.onlyA.id }, cashier).expect(403);
    const manager = await prisma.user.create({ data: { email: 'manager@test.com', password: data.adminUser.password, firstName: 'M', lastName: 'M', role: 'MANAGER', locationId: A } });
    await call('get', '', undefined, await createTestToken(manager.id, 'MANAGER')).expect(403);
    // An admin of a store in another business owns nothing here.
    const otherAdmin = await prisma.user.create({ data: { email: 'other-admin@test.com', password: data.adminUser.password, firstName: 'O', lastName: 'A', role: 'ADMIN', locationId: 'store-c' } });
    await call('get', '', undefined, await createTestToken(otherAdmin.id, 'ADMIN')).expect(403);
    const platform = await prisma.user.create({ data: { email: 'platform@test.com', password: data.adminUser.password, firstName: 'P', lastName: 'A', role: 'SUPER_ADMIN' } });
    expect((await call('post', '/from-product', { productId: rows.onlyA.id }, await createTestToken(platform.id, 'SUPER_ADMIN')).expect(403)).body.error).toBe('Store preview is read-only');
  });
});
