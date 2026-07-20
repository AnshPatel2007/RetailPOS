/**
 * Promotion Workflow Integration Tests
 *
 * End-to-end promotion flows against a real (test) database:
 * - CRUD authorization (manager+ only)
 * - Active-list filtering by schedule
 * - Server-side promo pricing inside createSale (discount, tax base, usage count)
 */

import { randomUUID } from 'crypto';
import { prisma, seedTestData, TestData } from './setup';
import { api, assertResponse, loginUser } from './helpers';

describe('Promotion Workflow Integration Tests', () => {
  let testData: TestData;
  let cashierToken: string;
  let adminToken: string;

  const clockIn = async (token: string) => {
    await api
      .post('/api/shifts/clock-in')
      .withAuth(token)
      .withBody({ startingCash: 100 })
      .expectStatus(201)
      .execute();
  };

  const createPromotion = async (overrides: Record<string, any> = {}) => {
    const res = await api
      .post('/api/promotions')
      .withAuth(adminToken)
      .withBody({
        name: '2 for $30',
        type: 'QUANTITY_PRICE',
        buyQuantity: 2,
        bundlePrice: 30,
        productIds: [testData.product.id],
        ...overrides,
      })
      .expectStatus(201)
      .execute();
    return res.body.data;
  };

  beforeEach(async () => {
    testData = await seedTestData();
    cashierToken = await loginUser('cashier@test.com', 'Admin123!');
    adminToken = await loginUser('admin@test.com', 'Admin123!');
  });

  describe('Authorization', () => {
    it('should reject promotion creation by a cashier', async () => {
      await api
        .post('/api/promotions')
        .withAuth(cashierToken)
        .withBody({
          name: 'Nope',
          type: 'PERCENT_OFF',
          percentOff: 50,
          productIds: [testData.product.id],
        })
        .expectStatus(403)
        .execute();
    });

    it('should reject a promotion that targets nothing', async () => {
      const res = await api
        .post('/api/promotions')
        .withAuth(adminToken)
        .withBody({ name: 'Untargeted', type: 'PERCENT_OFF', percentOff: 10 })
        .expectStatus(400)
        .execute();

      expect(res.body.success).toBe(false);
    });
  });

  describe('Active list', () => {
    it('should return in-window promotions and exclude expired or disabled ones', async () => {
      await createPromotion({ name: 'Live deal' });
      await createPromotion({ name: 'Expired deal', endsAt: '2020-01-01T00:00:00.000Z' });
      const disabled = await createPromotion({ name: 'Disabled deal' });
      await api
        .post(`/api/promotions/${disabled.id}/toggle`)
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      const res = await api
        .get('/api/promotions/active')
        .withAuth(cashierToken)
        .expectStatus(200)
        .execute();

      const names = res.body.data.map((p: any) => p.name);
      expect(names).toContain('Live deal');
      expect(names).not.toContain('Expired deal');
      expect(names).not.toContain('Disabled deal');
    });
  });

  describe('Promo pricing in createSale', () => {
    beforeEach(async () => {
      await clockIn(cashierToken);
    });

    it('should apply the bundle price server-side and tax the discounted amount', async () => {
      const promotion = await createPromotion();

      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          idempotencyKey: randomUUID(),
          items: [{ productId: testData.product.id, quantity: 2, price: 19.99 }],
          paymentMethod: 'CASH',
          amountPaid: 40,
        })
        .expectStatus(201)
        .execute();

      const sale = res.body.data;
      // 2 × $19.99 = $39.98 gross → bundle $30.00 → $9.98 promo discount
      // 10% tax on the discounted $30.00 = $3.00 → total $33.00
      expect(sale.subtotal).toBe(39.98);
      expect(sale.discount).toBe(9.98);
      expect(sale.tax).toBe(3.0);
      expect(sale.total).toBe(33.0);
      expect(sale.changeDue).toBe(7.0);

      // Line records the promotion for reporting
      expect(sale.items[0].promotionId).toBe(promotion.id);
      expect(sale.items[0].promotionName).toBe('2 for $30');
      expect(sale.items[0].promotionDiscount).toBe(9.98);
      expect(sale.items[0].discount).toBe(9.98);

      // Usage counted once per sale
      const updated = await prisma.promotion.findUnique({ where: { id: promotion.id } });
      expect(updated!.timesUsed).toBe(1);
    });

    it('should not discount below a complete bundle', async () => {
      await createPromotion();

      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          idempotencyKey: randomUUID(),
          items: [{ productId: testData.product.id, quantity: 1, price: 19.99 }],
          paymentMethod: 'CASH',
          amountPaid: 25,
        })
        .expectStatus(201)
        .execute();

      const sale = res.body.data;
      expect(sale.discount).toBe(0);
      expect(sale.total).toBe(21.99); // $19.99 + 10% tax
      expect(sale.items[0].promotionId).toBeNull();
    });

    it('should ignore expired promotions when pricing', async () => {
      await createPromotion({ endsAt: '2020-01-01T00:00:00.000Z' });

      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          idempotencyKey: randomUUID(),
          items: [{ productId: testData.product.id, quantity: 2, price: 19.99 }],
          paymentMethod: 'CASH',
          amountPaid: 50,
        })
        .expectStatus(201)
        .execute();

      expect(res.body.data.discount).toBe(0);
      expect(res.body.data.total).toBe(43.98);
    });

    it('should reject payment that only covers the discounted total when no promo applies', async () => {
      // No promotion exists — paying the would-be bundle price is insufficient
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          idempotencyKey: randomUUID(),
          items: [{ productId: testData.product.id, quantity: 2, price: 19.99 }],
          paymentMethod: 'CASH',
          amountPaid: 33,
        })
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'Insufficient payment');
    });
  });
});
