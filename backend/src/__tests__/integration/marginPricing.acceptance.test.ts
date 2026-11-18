/**
 * Target-margin pricing (spec sections 13-14, acceptance test 9). Suggested
 * prices round up to the store's ending; prices change only when applied.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { roundUp, suggestPrice } from '../../services/pricing.service';

describe('Margin pricing', () => {
  let data: TestData, owner: string;
  const post = (path: string, body: object) => request(app).post(path).set('Authorization', 'Bearer ' + owner).send(body);
  const put = (path: string, body: object) => request(app).put(path).set('Authorization', 'Bearer ' + owner).send(body);
  const get = (path: string) => request(app).get(path).set('Authorization', 'Bearer ' + owner);

  beforeEach(async () => {
    data = await seedTestData();
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, clockInAt: new Date() } });
  });

  const make = (name: string, cost: number, price: number, extra: object = {}) => prisma.product.create({ data: { name, sku: randomUUID(), cost, price,
    stockQuantity: 0, isTaxable: false, locationId: data.location.id, categoryId: data.category.id, ...extra } });

  describe('margin pricing', () => {
    it('9. suggests $2.15 for a $1.50 cost at 30% (2.1428 rounded up), never rounding below target', () => {
      expect(suggestPrice(1.5, 0.3)).toMatchObject({ rawPrice: 2.1429, price: 2.15, margin: 0.3023, markup: 0.4333, grossProfit: 0.65 });
      expect(roundUp(2.1429, 'NICKEL')).toBe(2.15);
      expect(roundUp(2.1429, 'NINE')).toBe(2.19);
      expect(roundUp(2.1429, 'NINETY_NINE')).toBe(2.99);
      expect(roundUp(2.1, 'CENT')).toBe(2.1);
      expect(suggestPrice(1.47, 0.3)!.price).toBe(2.1);
      expect(() => suggestPrice(1, 1)).toThrow();
    });

    it('uses the most specific rule: product, then brand, then category, then store', async () => {
      const drink = await make('Gatorade Orange 20 oz', 1.5, 1.99, { brand: 'Gatorade' });
      await put('/api/pricing/rules', { scope: 'STORE', targetMargin: 0.3 }).expect(200);
      await put('/api/pricing/rules', { scope: 'STORE', scopeId: 'x', targetMargin: 0.3 }).expect(400);
      const suggestion = async () => (await get(`/api/pricing/suggest?productId=${drink.id}&cost=1.5&price=1.99`).expect(200)).body.data;
      expect((await suggestion()).rule.source).toBe('store default');
      await put('/api/pricing/rules', { scope: 'CATEGORY', scopeId: data.category.id, targetMargin: 0.4, minMargin: 0.3 }).expect(200);
      expect(await suggestion()).toMatchObject({ rule: { source: 'category', targetMargin: 0.4 }, suggestion: { price: 2.5 }, warnings: ['Margin is below the 30% minimum'] });
      await put('/api/pricing/rules', { scope: 'BRAND', scopeId: 'GATORADE', targetMargin: 0.35, rounding: 'NINE' }).expect(200);
      expect(await suggestion()).toMatchObject({ rule: { source: 'brand' }, suggestion: { price: 2.39 } });
      await put('/api/pricing/rules', { scope: 'PRODUCT', scopeId: drink.id, targetMargin: 0.25 }).expect(200);
      expect((await suggestion()).rule.source).toBe('product');
      const rules = (await get('/api/pricing/rules').expect(200)).body.data;
      expect(rules.map((rule: { label: string }) => rule.label)).toEqual(expect.arrayContaining(['All products', data.category.name, 'gatorade', drink.name]));
    });

    it('lists items under target or below cost, and applies only reviewed prices', async () => {
      await put('/api/pricing/rules', { scope: 'STORE', targetMargin: 0.3 }).expect(200);
      const under = await make('Under target', 1.5, 1.99);
      const loss = await make('Below cost', 3, 2.5);
      await make('Fine', 1, 2);
      await prisma.productSellingUnit.create({ data: { productId: under.id, locationId: data.location.id, name: '12-pack', barcode: 'REVIEW-12', unitsPerPackage: 12, price: 15 } });
      const review = (await get('/api/pricing/review').expect(200)).body.data;
      expect(review.map((row: { name: string; status: string }) => [row.name, row.status])).toEqual([
        ['Under target (12-pack)', 'BELOW_COST'], ['Below cost', 'BELOW_COST'], ['Under target', 'UNDER_TARGET'],
      ]);
      expect(review.find((row: { name: string }) => row.name === 'Under target')).toMatchObject({ unitCost: 1.5, costBasis: 'CATALOG', suggestedPrice: 2.15, targetMargin: 0.3 });
      expect(review[0]).toMatchObject({ unitCost: 18, suggestedPrice: 25.72 });

      await post('/api/pricing/apply', { changes: [{ productId: under.id, price: 2.15, expectedPrice: 2.5 }] }).expect(409);
      await post('/api/pricing/apply', { changes: [{ productId: under.id, price: 2.15, expectedPrice: 1.99 }, { productId: loss.id, price: 4.29, expectedPrice: 2.5 }] }).expect(200);
      expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: under.id } })).price)).toBe(2.15);
      expect((await get('/api/pricing/review').expect(200)).body.data).toHaveLength(1); // only the pack remains
    });
  });
});
