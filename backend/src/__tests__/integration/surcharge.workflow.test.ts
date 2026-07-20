/**
 * Card Surcharge (Cash-Discount Program) Integration Tests
 *
 * Surcharge is a % of the card-paid share of the pre-surcharge total,
 * configured per location. Cash pays nothing; splits pay it only on the
 * card portion. The server computes it from the location rate.
 */

import { randomUUID } from 'crypto';
import { prisma, seedTestData, TestData } from './setup';
import { api, assertResponse, loginUser } from './helpers';

describe('Card Surcharge Integration Tests', () => {
  let testData: TestData;
  let cashierToken: string;

  beforeEach(async () => {
    testData = await seedTestData();
    cashierToken = await loginUser('cashier@test.com', 'Admin123!');
    await prisma.location.update({
      where: { id: testData.location.id },
      data: { cardSurchargePercent: 3 },
    });
    await api
      .post('/api/shifts/clock-in')
      .withAuth(cashierToken)
      .withBody({ startingCash: 100 })
      .expectStatus(201)
      .execute();
  });

  const items = [{ productId: 'test-product-1', quantity: 1, price: 19.99 }];
  // $19.99 + 10% tax = $21.99 pre-surcharge

  it('should add the surcharge to a full card payment', async () => {
    // 3% of $21.99 = $0.66 → due $22.65
    const res = await api
      .post('/api/sales')
      .withAuth(cashierToken)
      .withBody({
        idempotencyKey: randomUUID(),
        items,
        paymentMethod: 'CARD',
        amountPaid: 22.65,
        payments: [{ paymentMethod: 'CARD', amount: 22.65, reference: 'txn-1' }],
      })
      .expectStatus(201)
      .execute();

    expect(res.body.data.surcharge).toBe(0.66);
    expect(res.body.data.total).toBe(22.65);
    expect(res.body.data.changeDue).toBe(0);
  });

  it('should reject a card payment that ignores the surcharge', async () => {
    const res = await api
      .post('/api/sales')
      .withAuth(cashierToken)
      .withBody({
        idempotencyKey: randomUUID(),
        items,
        paymentMethod: 'CARD',
        amountPaid: 21.99,
        payments: [{ paymentMethod: 'CARD', amount: 21.99 }],
      })
      .expectStatus(400)
      .execute();

    assertResponse.error(res, 'card surcharge');
  });

  it('should charge no surcharge on cash (the cash discount)', async () => {
    const res = await api
      .post('/api/sales')
      .withAuth(cashierToken)
      .withBody({
        idempotencyKey: randomUUID(),
        items,
        paymentMethod: 'CASH',
        amountPaid: 25,
      })
      .expectStatus(201)
      .execute();

    expect(res.body.data.surcharge).toBe(0);
    expect(res.body.data.total).toBe(21.99);
    expect(res.body.data.changeDue).toBe(3.01);
  });

  it('should surcharge only the card share of a split payment', async () => {
    // Card $10 → surcharge 3% × $10 = $0.30 → due $22.29
    const res = await api
      .post('/api/sales')
      .withAuth(cashierToken)
      .withBody({
        idempotencyKey: randomUUID(),
        items,
        paymentMethod: 'CASH',
        amountPaid: 22.29,
        payments: [
          { paymentMethod: 'CARD', amount: 10, reference: 'txn-2' },
          { paymentMethod: 'CASH', amount: 12.29 },
        ],
      })
      .expectStatus(201)
      .execute();

    expect(res.body.data.surcharge).toBe(0.3);
    expect(res.body.data.total).toBe(22.29);
  });

  it('should not surcharge anything when the program is off', async () => {
    await prisma.location.update({
      where: { id: testData.location.id },
      data: { cardSurchargePercent: 0 },
    });

    const res = await api
      .post('/api/sales')
      .withAuth(cashierToken)
      .withBody({
        idempotencyKey: randomUUID(),
        items,
        paymentMethod: 'CARD',
        amountPaid: 21.99,
        payments: [{ paymentMethod: 'CARD', amount: 21.99 }],
      })
      .expectStatus(201)
      .execute();

    expect(res.body.data.surcharge).toBe(0);
    expect(res.body.data.total).toBe(21.99);
  });
});
