import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { AttentionContext, likelyMixUp } from '../../services/attention.service';
import { mixUpHistory } from '../../services/inventoryException.service';

describe('Mis-scan suggestions that learn from past mix-ups', () => {
  let data: TestData;
  let owner: string;
  beforeEach(async () => { data = await seedTestData(); owner = await createTestToken(data.adminUser.id, 'ADMIN'); });
  const product = (name: string, price: number, stockQuantity: number) => prisma.product.create({ data: { name, sku: name.toUpperCase().replace(/ /g, '-'), price, cost: 5, stockQuantity, locationId: data.location.id } });
  const mixedUp = (fromProductId: string, toProductId: string, daysAgo = 10, locationId = data.location.id) => prisma.saleItemCorrection.create({ data: {
    saleId: randomUUID(), saleItemId: randomUUID(), locationId, fromProductId, toProductId, quantity: 1, reason: 'WRONG_PRODUCT', userId: data.adminUser.id,
    idempotencyKey: randomUUID(), createdAt: new Date(Date.now() - daysAgo * 86400000) } });
  const negative = (productId: string, quantity: number) => prisma.inventoryException.create({ data: { productId, locationId: data.location.id, openProductId: productId, lowestQuantity: quantity, latestQuantity: quantity } });
  const context = () => ({ locationId: data.location.id, now: new Date() } as AttentionContext);

  it('counts past mix-ups in both directions for 180 days, at this store only', async () => {
    const blue = await product('Blue Razz', 19.99, -4), grape = await product('Grape', 18.99, 9), mint = await product('Mint', 17.49, 2);
    const other = await prisma.location.create({ data: { id: 'mixups-other-store', name: 'Other Store', address: '1', city: 'C', state: 'TS', zipCode: '1', phone: '1', email: 'other@store.com' } });
    await mixedUp(blue.id, grape.id); await mixedUp(grape.id, blue.id); await mixedUp(blue.id, grape.id, 40);
    await mixedUp(blue.id, mint.id, 200); // too long ago
    await mixedUp(blue.id, mint.id, 5, other.id); // another store
    expect([...(await mixUpHistory(prisma, blue.id, data.location.id)).entries()]).toEqual([[grape.id, 3]]);

    // The exception page ranks the item mixed up before first, however different it looks.
    const exception = await negative(blue.id, -4);
    const detail = (await request(app).get('/api/inventory-exceptions/' + exception.id).set('Authorization', 'Bearer ' + owner).expect(200)).body.data;
    expect(detail.relatedProducts[0]).toMatchObject({ id: grape.id, mixedUp: 3 });
    expect(detail.relatedProducts[0].reasons).toContain('Mixed up before (3 times)');

    expect(await likelyMixUp(context())).toMatchObject({ key: 'likely-mix-up', count: 1, href: '/inventory/stock-control/exceptions',
      sentence: 'Blue Razz shows −4 while Grape shows 9 and they were mixed up 3 times before. Count both.' });
  });

  it('suggests counting an item at the same price, but only when it has stock to find', async () => {
    const cola = await product('Cola Cherry', 2.49, -2);
    const lime = await product('Cola Lime', 2.49, 0);
    await negative(cola.id, -2);
    expect(await likelyMixUp(context())).toBeNull(); // the same-price partner has nothing on the shelf
    await prisma.product.update({ where: { id: lime.id }, data: { stockQuantity: 6 } });
    expect((await likelyMixUp(context()))?.sentence).toBe('Cola Cherry shows −2 while Cola Lime, at the same price, shows 6. Count both.');
  });
});
