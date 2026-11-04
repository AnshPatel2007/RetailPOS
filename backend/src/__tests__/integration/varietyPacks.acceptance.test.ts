/**
 * Variety packs (spec section 10, acceptance test 8): a mixed pack is its own
 * product; opening one moves its units and cost into the products inside.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getFinancialMetrics } from '../../services/financialMetrics.service';
import { allocateValue } from '../../services/productBundle.service';
import { decimal } from '../../services/inventoryCost.service';

describe('Variety packs', () => {
  let data: TestData, owner: string;
  const post = (path: string, body: object) => request(app).post(path).set('Authorization', 'Bearer ' + owner).send(body);
  const put = (path: string, body: object) => request(app).put(path).set('Authorization', 'Bearer ' + owner).send(body);

  beforeEach(async () => {
    data = await seedTestData();
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, clockInAt: new Date() } });
  });

  const make = (name: string, cost: number, price: number, extra: object = {}) => prisma.product.create({ data: { name, sku: randomUUID(), cost, price,
    stockQuantity: 0, isTaxable: false, locationId: data.location.id, categoryId: data.category.id, ...extra } });
  const opening = async (productId: string, quantity: number, value: number) => {
    const current = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    await post('/api/financial/inventory-costs/opening', { idempotencyKey: randomUUID(), notes: 'Verified physical count and supplier invoice',
      items: [{ productId, quantity, value, expectedVersion: current.stockVersion }] }).expect(200);
  };
  const value = async (productId: string) => {
    const balance = await prisma.inventoryValuation.findUnique({ where: { productId } });
    return { quantity: balance?.quantity ?? 0, value: balance?.value == null ? null : Number(balance.value) };
  };

  describe('variety packs', () => {
    it("8. splits the pack's cost by count: a $24 24-pack of 12 red, 6 blue, 6 orange is $1 each", async () => {
      // Each flavour costs something different alone; the pack's split ignores that.
      const red = await make('Gatorade Red', 1.8, 2.49), blue = await make('Gatorade Blue', 0.5, 2.49), orange = await make('Gatorade Orange', 1.1, 2.49);
      const pack = await make('Gatorade Variety 24-pack', 24, 34.99);
      await opening(pack.id, 2, 48);
      const contents = (await put(`/api/products/${pack.id}/bundle`, { components: [
        { productId: red.id, quantity: 12 }, { productId: blue.id, quantity: 6 }, { productId: orange.id, quantity: 6 }] }).expect(200)).body.data;
      expect(contents).toMatchObject({ itemsPerPack: 24, packUnitCost: 24, costPerItem: 1 });
      expect(contents.components.map((c: { valuePerPack: number }) => c.valuePerPack)).toEqual([12, 6, 6]);

      const key = randomUUID();
      await post(`/api/products/${pack.id}/open-bundle`, { quantity: 2, idempotencyKey: key }).expect(200);
      const replay = (await post(`/api/products/${pack.id}/open-bundle`, { quantity: 2, idempotencyKey: key }).expect(200)).body.data;
      expect(replay.replayed).toBe(true);
      expect(await value(pack.id)).toEqual({ quantity: 0, value: 0 });
      expect(await value(red.id)).toEqual({ quantity: 24, value: 24 });
      expect(await value(blue.id)).toEqual({ quantity: 12, value: 12 });
      expect(await value(orange.id)).toEqual({ quantity: 12, value: 12 });
      // Nothing is gained or lost by opening a pack.
      expect((await getFinancialMetrics({ locationId: data.location.id })).costOfGoodsSold ?? 0).toBe(0);
    });

    it('gives units sold before the pack was opened their per-item cost from the pack', async () => {
      const orange = await make('Orange', 1, 2.49), lemon = await make('Lemon', 2, 2.49);
      const pack = await make('Variety 12-pack', 9, 14.99);
      await opening(pack.id, 1, 9);
      await opening(orange.id, 0, 0);
      // Two oranges were sold from the open pack before anyone recorded opening it.
      await post('/api/sales', { items: [{ productId: orange.id, quantity: 2, price: 2.49 }], paymentMethod: 'CASH', amountPaid: 6, idempotencyKey: randomUUID() }).expect(201);
      expect((await getFinancialMetrics({ locationId: data.location.id })).costOfGoodsSold).toBe(2); // estimated at $1.00
      await put(`/api/products/${pack.id}/bundle`, { components: [{ productId: orange.id, quantity: 6 }, { productId: lemon.id, quantity: 6 }] }).expect(200);
      await post(`/api/products/${pack.id}/open-bundle`, { quantity: 1, idempotencyKey: randomUUID() }).expect(200);
      // $9 / 12 items = $0.75 each, whatever oranges and lemons cost alone.
      expect(await value(orange.id)).toEqual({ quantity: 4, value: 3 }); // 6 at $0.75, 2 already sold
      expect(await value(lemon.id)).toEqual({ quantity: 6, value: 4.5 });
      // The two sold oranges now carry their real cost ($0.75 each).
      expect((await getFinancialMetrics({ locationId: data.location.id })).costOfGoodsSold).toBe(1.5);
    });

    it('rejects packs inside packs and opening packs not on record', async () => {
      const orange = await make('Orange', 1, 2.49), lemon = await make('Lemon', 2, 2.49);
      const pack = await make('Variety pack', 9, 14.99), outer = await make('Party box', 20, 30);
      await put(`/api/products/${pack.id}/bundle`, { components: [{ productId: pack.id, quantity: 2 }] }).expect(400);
      await put(`/api/products/${pack.id}/bundle`, { components: [{ productId: orange.id, quantity: 1 }] }).expect(400);
      await put(`/api/products/${pack.id}/bundle`, { components: [{ productId: orange.id, quantity: 6 }, { productId: lemon.id, quantity: 6 }] }).expect(200);
      await put(`/api/products/${outer.id}/bundle`, { components: [{ productId: pack.id, quantity: 2 }] }).expect(400);
      await post(`/api/products/${pack.id}/open-bundle`, { quantity: 1, idempotencyKey: randomUUID() }).expect(400);
      expect(await prisma.bundleOpening.count()).toBe(0);
      // A product inside a pack cannot be deleted out from under it.
      await request(app).delete(`/api/products/${orange.id}`).set('Authorization', 'Bearer ' + owner).expect(409);
    });

    it('lists packs and variety packs on their own, and keeps variety packs out of single items', async () => {
      const red = await make('Red single', 9, 12.5, { stockQuantity: 25, barcode: '700000000001' });
      const blue = await make('Blue single', 1, 2.49);
      const variety = await make('Mixed box', 24, 34.99, { stockQuantity: 2 });
      await put(`/api/products/${variety.id}/bundle`, { components: [{ productId: red.id, quantity: 12 }, { productId: blue.id, quantity: 12 }] }).expect(200);
      await post(`/api/products/${red.id}/selling-units`, { name: 'Carton', barcode: '700000000010', unitsPerPackage: 10, price: 119.99 }).expect(201);
      const get = (path: string) => request(app).get(path).set('Authorization', 'Bearer ' + owner).expect(200);

      const packs = (await get('/api/products/packs')).body;
      expect(packs.pagination.total).toBe(2);
      expect(packs.data).toEqual([
        expect.objectContaining({ kind: 'PACK', name: 'Carton', containsName: 'Red single', unitsPerPackage: 10, packCost: 90, available: 2, sealedQuantity: 0 }),
        expect.objectContaining({ kind: 'VARIETY', name: 'Mixed box', packCost: 24, stockQuantity: 2, itemsPerPack: 24,
          contents: [{ name: 'Red single', quantity: 12 }, { name: 'Blue single', quantity: 12 }] }),
      ]);
      expect((await get('/api/products/packs?search=mixed')).body.data.map((row: { name: string }) => row.name)).toEqual(['Mixed box']);

      const singles = (await get('/api/products?excludeVarietyPacks=true&limit=100')).body.data.map((row: { id: string }) => row.id);
      expect(singles).toEqual(expect.arrayContaining([red.id, blue.id]));
      expect(singles).not.toContain(variety.id);
    });

    it('splits value exactly, with largest remainders', () => {
      const parts = allocateValue(decimal(10), [decimal(1), decimal(1), decimal(1)]);
      expect(parts.map(Number)).toEqual([3.33333334, 3.33333333, 3.33333333]);
      expect(parts.reduce((sum, part) => sum.plus(part), decimal(0)).toNumber()).toBe(10);
    });
  });

});
