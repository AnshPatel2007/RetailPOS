/**
 * Sale Workflow Integration Tests
 *
 * End-to-end sale flows against a real (test) database:
 * - Shift requirement, cash/split/gift-card payments
 * - Inventory deduction and restore
 * - Loyalty earn + redemption
 * - Item-level refunds with restock and tender credit-back
 * - Voids and idempotency
 */

import { randomUUID } from 'crypto';
import { prisma, seedTestData, TestData } from './setup';
import { api, assertResponse, loginUser } from './helpers';

describe('Sale Workflow Integration Tests', () => {
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

  /** Cash sale of `quantity` seeded products; returns the created sale */
  const makeCashSale = async (
    token: string,
    quantity = 2,
    extra: Record<string, any> = {}
  ) => {
    const res = await api
      .post('/api/sales')
      .withAuth(token)
      .withBody({
        idempotencyKey: randomUUID(),
        items: [{ productId: testData.product.id, quantity, price: 19.99 }],
        paymentMethod: 'CASH',
        amountPaid: 100,
        ...extra,
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

  describe('Shift requirement', () => {
    it('should reject a sale when the cashier is not clocked in', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          items: [{ productId: testData.product.id, quantity: 1, price: 19.99 }],
          paymentMethod: 'CASH',
          amountPaid: 50,
        })
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'clock in');
    });
  });

  describe('Cash sale', () => {
    beforeEach(async () => {
      await clockIn(cashierToken);
    });

    it('should complete a sale with correct totals, change, and stock deduction', async () => {
      const sale = await makeCashSale(cashierToken, 2, { amountPaid: 50 });

      // $19.99 × 2 = $39.98 subtotal, 10% tax = $4.00, total $43.98
      expect(sale.subtotal).toBe(39.98);
      expect(sale.tax).toBe(4.0);
      expect(sale.total).toBe(43.98);
      expect(sale.changeDue).toBe(6.02);
      expect(sale.status).toBe('COMPLETED');
      expect(sale.payments).toHaveLength(1);
      expect(sale.payments[0].paymentMethod).toBe('CASH');

      // Stock decremented and logged
      const product = await prisma.product.findUnique({ where: { id: testData.product.id } });
      expect(product!.stockQuantity).toBe(98);

      const log = await prisma.inventoryLog.findFirst({
        where: { productId: testData.product.id, type: 'SALE' },
      });
      expect(log).not.toBeNull();
      expect(log!.quantity).toBe(-2);
    });

    it('should reject a sale exceeding available stock', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          items: [{ productId: testData.product.id, quantity: 101, price: 19.99 }],
          paymentMethod: 'CASH',
          amountPaid: 5000,
        })
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'Insufficient stock');

      // No stock touched
      const product = await prisma.product.findUnique({ where: { id: testData.product.id } });
      expect(product!.stockQuantity).toBe(100);
    });

    it('should reject insufficient payment', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          items: [{ productId: testData.product.id, quantity: 2, price: 19.99 }],
          paymentMethod: 'CASH',
          amountPaid: 10,
        })
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'Insufficient payment');
    });

    it('should return the existing sale for a duplicate idempotency key', async () => {
      const idempotencyKey = randomUUID();

      const first = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          idempotencyKey,
          items: [{ productId: testData.product.id, quantity: 1, price: 19.99 }],
          paymentMethod: 'CASH',
          amountPaid: 50,
        })
        .expectStatus(201)
        .execute();

      const second = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          idempotencyKey,
          items: [{ productId: testData.product.id, quantity: 1, price: 19.99 }],
          paymentMethod: 'CASH',
          amountPaid: 50,
        })
        .expectStatus(200)
        .execute();

      expect(second.body.data.id).toBe(first.body.data.id);

      // Only one sale exists, stock deducted once
      expect(await prisma.sale.count()).toBe(1);
      const product = await prisma.product.findUnique({ where: { id: testData.product.id } });
      expect(product!.stockQuantity).toBe(99);
    });

    it('should reject split payments that do not sum to the amount paid', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          items: [{ productId: testData.product.id, quantity: 1, price: 19.99 }],
          paymentMethod: 'CASH',
          amountPaid: 21.99,
          payments: [
            { paymentMethod: 'CASH', amount: 10 },
            { paymentMethod: 'CARD', amount: 5 },
          ],
        })
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'Split payments');
    });
  });

  describe('Loyalty', () => {
    beforeEach(async () => {
      await clockIn(cashierToken);
    });

    it('should award points and update customer stats on sale', async () => {
      await makeCashSale(cashierToken, 2, { customerId: testData.customer.id });

      const customer = await prisma.customer.findUnique({
        where: { id: testData.customer.id },
      });
      expect(customer!.loyaltyPoints).toBe(43); // floor(43.98)
      expect(customer!.totalSpent).toBe(43.98);
      expect(customer!.visitCount).toBe(1);
    });

    it('should apply point redemption as a discount on the amount due', async () => {
      await prisma.customer.update({
        where: { id: testData.customer.id },
        data: { loyaltyPoints: 1000 },
      });

      // 500 points = $5 off the $43.98 total → $38.98 due
      const sale = await makeCashSale(cashierToken, 2, {
        customerId: testData.customer.id,
        pointsRedeemed: 500,
        amountPaid: 38.98,
      });

      expect(sale.total).toBe(38.98);
      expect(sale.discount).toBe(5);

      const customer = await prisma.customer.findUnique({
        where: { id: testData.customer.id },
      });
      // 1000 - 500 redeemed + 38 earned
      expect(customer!.loyaltyPoints).toBe(538);
    });

    it('should reject redeeming more points than the customer has', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          items: [{ productId: testData.product.id, quantity: 1, price: 19.99 }],
          paymentMethod: 'CASH',
          amountPaid: 50,
          customerId: testData.customer.id,
          pointsRedeemed: 999,
        })
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'Insufficient loyalty points');
    });
  });

  describe('Gift card payments', () => {
    let cardCode: string;

    beforeEach(async () => {
      await clockIn(cashierToken);
      const cardRes = await api
        .post('/api/gift-cards')
        .withAuth(adminToken)
        .withBody({ amount: 50 })
        .expectStatus(201)
        .execute();
      cardCode = cardRes.body.data.code;
    });

    it('should debit the gift card when used as tender', async () => {
      // 1 unit: $19.99 + $2.00 tax = $21.99
      await makeCashSale(cashierToken, 1, {
        paymentMethod: 'GIFT_CARD',
        amountPaid: 21.99,
        payments: [{ paymentMethod: 'GIFT_CARD', amount: 21.99, reference: cardCode }],
      });

      const card = await prisma.giftCard.findUnique({ where: { code: cardCode } });
      expect(card!.currentBalance).toBe(28.01); // 50 - 21.99

      const txn = await prisma.giftCardTransaction.findFirst({
        where: { giftCardId: card!.id, type: 'REDEEM' },
      });
      expect(txn).not.toBeNull();
      expect(txn!.amount).toBe(-21.99);
    });

    it('should reject payment from a nonexistent gift card and roll back the sale', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          items: [{ productId: testData.product.id, quantity: 1, price: 19.99 }],
          paymentMethod: 'GIFT_CARD',
          amountPaid: 21.99,
          payments: [{ paymentMethod: 'GIFT_CARD', amount: 21.99, reference: 'FAKE-CARD' }],
        })
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'Gift card not found');

      // Whole transaction rolled back: no sale, stock untouched
      expect(await prisma.sale.count()).toBe(0);
      const product = await prisma.product.findUnique({ where: { id: testData.product.id } });
      expect(product!.stockQuantity).toBe(100);
    });

    it('should reject payment exceeding the gift card balance', async () => {
      // Drain the card to $1
      const card = await prisma.giftCard.findUnique({ where: { code: cardCode } });
      await prisma.giftCard.update({
        where: { id: card!.id },
        data: { currentBalance: 1 },
      });

      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          items: [{ productId: testData.product.id, quantity: 1, price: 19.99 }],
          paymentMethod: 'GIFT_CARD',
          amountPaid: 21.99,
          payments: [{ paymentMethod: 'GIFT_CARD', amount: 21.99, reference: cardCode }],
        })
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'Insufficient gift card balance');
    });
  });

  describe('Refunds', () => {
    beforeEach(async () => {
      await clockIn(cashierToken);
    });

    it('should refund selected items, restock them, and track refundable balance', async () => {
      const sale = await makeCashSale(cashierToken, 2); // total 43.98, stock 98
      const saleItemId = sale.items[0].id;

      // Return 1 of 2 units — refunds its prorated share ($21.99)
      const res = await api
        .post(`/api/sales/${sale.id}/refund`)
        .withAuth(adminToken)
        .withBody({
          reason: 'Customer returned one unit',
          items: [{ saleItemId, quantity: 1 }],
          refundMethod: 'CASH',
        })
        .expectStatus(200)
        .execute();

      expect(res.body.data.status).toBe('COMPLETED'); // partial refund
      expect(res.body.data.refunds).toHaveLength(1);
      expect(res.body.data.refunds[0].amount).toBe(21.99);
      expect(res.body.data.refunds[0].items).toHaveLength(1);

      // Returned unit restocked
      const product = await prisma.product.findUnique({ where: { id: testData.product.id } });
      expect(product!.stockQuantity).toBe(99);

      // Refunding the second unit completes the refund
      const res2 = await api
        .post(`/api/sales/${sale.id}/refund`)
        .withAuth(adminToken)
        .withBody({
          reason: 'Returned the rest',
          items: [{ saleItemId, quantity: 1 }],
          refundMethod: 'CASH',
        })
        .expectStatus(200)
        .execute();

      expect(res2.body.data.status).toBe('REFUNDED');
      const productAfter = await prisma.product.findUnique({ where: { id: testData.product.id } });
      expect(productAfter!.stockQuantity).toBe(100);
    });

    it('should reject refunding more units than were sold', async () => {
      const sale = await makeCashSale(cashierToken, 2);
      const saleItemId = sale.items[0].id;

      const res = await api
        .post(`/api/sales/${sale.id}/refund`)
        .withAuth(adminToken)
        .withBody({
          reason: 'Too many',
          items: [{ saleItemId, quantity: 3 }],
        })
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'Cannot refund');
    });

    it('should credit a gift card when refunding to the original tender', async () => {
      // Issue card and pay with it
      const cardRes = await api
        .post('/api/gift-cards')
        .withAuth(adminToken)
        .withBody({ amount: 50 })
        .expectStatus(201)
        .execute();
      const cardCode = cardRes.body.data.code;

      const sale = await makeCashSale(cashierToken, 1, {
        paymentMethod: 'GIFT_CARD',
        amountPaid: 21.99,
        payments: [{ paymentMethod: 'GIFT_CARD', amount: 21.99, reference: cardCode }],
      });

      // Refund the item back to the gift card
      await api
        .post(`/api/sales/${sale.id}/refund`)
        .withAuth(adminToken)
        .withBody({
          reason: 'Return to card',
          items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
          refundMethod: 'GIFT_CARD',
        })
        .expectStatus(200)
        .execute();

      const card = await prisma.giftCard.findUnique({ where: { code: cardCode } });
      expect(card!.currentBalance).toBe(50); // fully restored

      const refundTxn = await prisma.giftCardTransaction.findFirst({
        where: { giftCardId: card!.id, type: 'REFUND' },
      });
      expect(refundTxn).not.toBeNull();
      expect(refundTxn!.amount).toBe(21.99);
    });

    it('should restore inventory on a money-only full refund', async () => {
      const sale = await makeCashSale(cashierToken, 2);

      await api
        .post(`/api/sales/${sale.id}/refund`)
        .withAuth(adminToken)
        .withBody({ amount: 43.98, reason: 'Full refund' })
        .expectStatus(200)
        .execute();

      const product = await prisma.product.findUnique({ where: { id: testData.product.id } });
      expect(product!.stockQuantity).toBe(100);

      const saleAfter = await prisma.sale.findUnique({ where: { id: sale.id } });
      expect(saleAfter!.status).toBe('REFUNDED');
    });

    it('should reject refunds beyond the refundable balance', async () => {
      const sale = await makeCashSale(cashierToken, 2);

      const res = await api
        .post(`/api/sales/${sale.id}/refund`)
        .withAuth(adminToken)
        .withBody({ amount: 99, reason: 'Too much' })
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'exceeds refundable balance');
    });
  });

  describe('Voids', () => {
    beforeEach(async () => {
      await clockIn(cashierToken);
    });

    it('should void a sale, restore stock, and reverse customer stats', async () => {
      const sale = await makeCashSale(cashierToken, 2, { customerId: testData.customer.id });

      await api
        .post(`/api/sales/${sale.id}/void`)
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      const saleAfter = await prisma.sale.findUnique({ where: { id: sale.id } });
      expect(saleAfter!.status).toBe('VOIDED');

      const product = await prisma.product.findUnique({ where: { id: testData.product.id } });
      expect(product!.stockQuantity).toBe(100);

      const customer = await prisma.customer.findUnique({ where: { id: testData.customer.id } });
      expect(customer!.totalSpent).toBe(0);
      expect(customer!.loyaltyPoints).toBe(0);
      expect(customer!.visitCount).toBe(0);
    });

    it('should reject voiding an already-voided sale', async () => {
      const sale = await makeCashSale(cashierToken, 1);

      await api
        .post(`/api/sales/${sale.id}/void`)
        .withAuth(adminToken)
        .expectStatus(200)
        .execute();

      const res = await api
        .post(`/api/sales/${sale.id}/void`)
        .withAuth(adminToken)
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'already voided');
    });
  });
});
