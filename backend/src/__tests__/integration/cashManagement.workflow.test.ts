/**
 * Cash Management Integration Tests
 *
 * Safe drops / paid in / paid out on the open shift, movement-aware expected
 * drawer cash at clock-out, and the Z-report summary.
 */

import { randomUUID } from 'crypto';
import { seedTestData, TestData } from './setup';
import { api, assertResponse, loginUser } from './helpers';

describe('Cash Management Integration Tests', () => {
  let testData: TestData;
  let cashierToken: string;

  beforeEach(async () => {
    testData = await seedTestData();
    cashierToken = await loginUser('cashier@test.com', 'Admin123!');
  });

  const clockIn = async () => {
    await api
      .post('/api/shifts/clock-in')
      .withAuth(cashierToken)
      .withBody({ startingCash: 100 })
      .expectStatus(201)
      .execute();
  };

  it('should reject a cash movement without an open shift', async () => {
    const res = await api
      .post('/api/shifts/cash-movement')
      .withAuth(cashierToken)
      .withBody({ type: 'SAFE_DROP', amount: 20, reason: 'Drop' })
      .expectStatus(404)
      .execute();

    assertResponse.error(res, 'No open shift');
  });

  it('should validate movement type and amount', async () => {
    await clockIn();

    const badType = await api
      .post('/api/shifts/cash-movement')
      .withAuth(cashierToken)
      .withBody({ type: 'WITHDRAWAL', amount: 20, reason: 'x' })
      .expectStatus(400)
      .execute();
    assertResponse.error(badType, 'Type must be one of');

    const badAmount = await api
      .post('/api/shifts/cash-movement')
      .withAuth(cashierToken)
      .withBody({ type: 'SAFE_DROP', amount: -5, reason: 'x' })
      .expectStatus(400)
      .execute();
    assertResponse.error(badAmount, 'Amount must be greater than 0');

    const noReason = await api
      .post('/api/shifts/cash-movement')
      .withAuth(cashierToken)
      .withBody({ type: 'SAFE_DROP', amount: 20 })
      .expectStatus(400)
      .execute();
    assertResponse.error(noReason, 'reason is required');
  });

  it('should include movements in expected drawer cash at clock-out', async () => {
    await clockIn();

    // Cash sale: 2 × $19.99 + 10% tax = $43.98 kept in the drawer
    await api
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

    // Drop $20 to the safe, take $5 back in
    await api
      .post('/api/shifts/cash-movement')
      .withAuth(cashierToken)
      .withBody({ type: 'SAFE_DROP', amount: 20, reason: 'Drawer over limit' })
      .expectStatus(201)
      .execute();
    await api
      .post('/api/shifts/cash-movement')
      .withAuth(cashierToken)
      .withBody({ type: 'PAID_IN', amount: 5, reason: 'Change from safe' })
      .expectStatus(201)
      .execute();

    // Current shift reports the live expected drawer: 100 + 43.98 - 20 + 5
    const current = await api
      .get('/api/shifts/current')
      .withAuth(cashierToken)
      .expectStatus(200)
      .execute();
    expect(current.body.data.cashMovementNet).toBe(-15);
    expect(current.body.data.expectedDrawer).toBe(128.98);

    // Clock out with a perfect count
    const out = await api
      .post('/api/shifts/clock-out')
      .withAuth(cashierToken)
      .withBody({ endingCash: 128.98 })
      .expectStatus(200)
      .execute();

    expect(out.body.data.expectedCash).toBe(128.98);
    expect(out.body.data.cashDifference).toBe(0);
    expect(out.body.data.shiftSummary.cashMovementNet).toBe(-15);
  });

  it('should produce a Z-report with tenders, movements, and drawer math', async () => {
    await clockIn();

    await api
      .post('/api/sales')
      .withAuth(cashierToken)
      .withBody({
        idempotencyKey: randomUUID(),
        items: [{ productId: testData.product.id, quantity: 1, price: 19.99 }],
        paymentMethod: 'CASH',
        amountPaid: 21.99,
      })
      .expectStatus(201)
      .execute();

    await api
      .post('/api/shifts/cash-movement')
      .withAuth(cashierToken)
      .withBody({ type: 'PAID_OUT', amount: 3.5, reason: 'Window cleaner' })
      .expectStatus(201)
      .execute();

    const current = await api
      .get('/api/shifts/current')
      .withAuth(cashierToken)
      .expectStatus(200)
      .execute();
    const shiftId = current.body.data.id;

    const z = await api
      .get(`/api/shifts/${shiftId}/z-report`)
      .withAuth(cashierToken)
      .expectStatus(200)
      .execute();

    const report = z.body.data;
    expect(report.totalTransactions).toBe(1);
    expect(report.tenderBreakdown.CASH.total).toBe(21.99);
    expect(report.cashSales).toBe(21.99);
    expect(report.cashMovements).toHaveLength(1);
    expect(report.cashMovementNet).toBe(-3.5);
    // Open shift → live expectation: 100 + 21.99 - 3.50
    expect(report.expectedCash).toBe(118.49);
    expect(report.isClosed).toBe(false);
  });
});
