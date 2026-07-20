/**
 * Compliance Workflow Integration Tests (Phase 2)
 *
 * - Age-restricted items: sale blocked without verification, underage blocked
 *   (with a failed-check audit row), verified sales log the check
 * - EBT tender: capped server-side at the SNAP-eligible portion of the sale
 * - Price-embedded barcodes: label price honored only for flagged products
 */

import { randomUUID } from 'crypto';
import { prisma, seedTestData, TestData } from './setup';
import { api, assertResponse, loginUser } from './helpers';

describe('Compliance Workflow Integration Tests', () => {
  let testData: TestData;
  let cashierToken: string;

  const clockIn = async (token: string) => {
    await api
      .post('/api/shifts/clock-in')
      .withAuth(token)
      .withBody({ startingCash: 100 })
      .expectStatus(201)
      .execute();
  };

  const saleBody = (extra: Record<string, any> = {}) => ({
    idempotencyKey: randomUUID(),
    items: [{ productId: testData.product.id, quantity: 1, price: 19.99 }],
    paymentMethod: 'CASH',
    amountPaid: 50,
    ...extra,
  });

  /** ISO date string for someone exactly `years` years old plus a buffer day */
  const dobForAge = (years: number): string => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  };

  beforeEach(async () => {
    testData = await seedTestData();
    cashierToken = await loginUser('cashier@test.com', 'Admin123!');
    await clockIn(cashierToken);
  });

  describe('Age verification', () => {
    beforeEach(async () => {
      await prisma.product.update({
        where: { id: testData.product.id },
        data: { minimumAge: 21 },
      });
    });

    it('should reject a restricted sale without verification', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody(saleBody())
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'Age verification required');
    });

    it('should reject an underage customer and log the failed check', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody(saleBody({
          ageVerification: { method: 'MANUAL_DOB', birthDate: dobForAge(18) },
        }))
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'must be 21');

      // Declined checks are evidence too
      const failedLog = await prisma.ageVerificationLog.findFirst({
        where: { approved: false },
      });
      expect(failedLog).not.toBeNull();
      expect(failedLog!.minimumAge).toBe(21);
      expect(failedLog!.method).toBe('MANUAL_DOB');
    });

    it('should complete a verified sale and log the check against it', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody(saleBody({
          ageVerification: { method: 'ID_SCAN', birthDate: dobForAge(30) },
        }))
        .expectStatus(201)
        .execute();

      const log = await prisma.ageVerificationLog.findFirst({
        where: { saleId: res.body.data.id },
      });
      expect(log).not.toBeNull();
      expect(log!.approved).toBe(true);
      expect(log!.method).toBe('ID_SCAN');
      expect(log!.minimumAge).toBe(21);
      expect(log!.productNames).toContain('Test Product');
    });

    it('should accept visual verification without a birth date', async () => {
      await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody(saleBody({ ageVerification: { method: 'VISUAL' } }))
        .expectStatus(201)
        .execute();
    });

    it('should require a birth date for non-visual methods', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody(saleBody({ ageVerification: { method: 'MANUAL_DOB' } }))
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'Birth date is required');
    });
  });

  describe('EBT tender', () => {
    it('should reject EBT when nothing in the cart is eligible', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody(saleBody({
          paymentMethod: 'EBT',
          amountPaid: 21.99,
          payments: [{ paymentMethod: 'EBT', amount: 21.99 }],
        }))
        .expectStatus(400)
        .execute();

      assertResponse.error(res, 'EBT can only cover eligible items');
    });

    it('should accept EBT for a fully eligible sale', async () => {
      await prisma.product.update({
        where: { id: testData.product.id },
        data: { ebtEligible: true },
      });

      // $19.99 + 10% tax = $21.99, all eligible
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody(saleBody({
          paymentMethod: 'EBT',
          amountPaid: 21.99,
          payments: [{ paymentMethod: 'EBT', amount: 21.99 }],
        }))
        .expectStatus(201)
        .execute();

      expect(res.body.data.total).toBe(21.99);
      expect(res.body.data.payments[0].paymentMethod).toBe('EBT');
    });

    it('should cap EBT at the eligible portion of a mixed cart', async () => {
      await prisma.product.update({
        where: { id: testData.product.id },
        data: { ebtEligible: true },
      });
      const nonEbt = await prisma.product.create({
        data: {
          id: 'test-product-noebt',
          name: 'Cigarettes',
          sku: 'TEST-SKU-002',
          price: 10.0,
          cost: 5.0,
          stockQuantity: 50,
          locationId: testData.location.id,
          isActive: true,
        },
      });

      // Eligible: $19.99 + $2.00 tax = $21.99; total = $21.99 + $11.00 = $32.99
      const overRes = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          idempotencyKey: randomUUID(),
          items: [
            { productId: testData.product.id, quantity: 1, price: 19.99 },
            { productId: nonEbt.id, quantity: 1, price: 10.0 },
          ],
          paymentMethod: 'EBT',
          amountPaid: 32.99,
          payments: [{ paymentMethod: 'EBT', amount: 32.99 }],
        })
        .expectStatus(400)
        .execute();

      assertResponse.error(overRes, 'EBT can only cover eligible items');

      // Split: EBT for the eligible share, cash for the rest
      const okRes = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          idempotencyKey: randomUUID(),
          items: [
            { productId: testData.product.id, quantity: 1, price: 19.99 },
            { productId: nonEbt.id, quantity: 1, price: 10.0 },
          ],
          paymentMethod: 'CASH',
          amountPaid: 32.99,
          payments: [
            { paymentMethod: 'EBT', amount: 21.99 },
            { paymentMethod: 'CASH', amount: 11.0 },
          ],
        })
        .expectStatus(201)
        .execute();

      expect(okRes.body.data.total).toBe(32.99);
    });
  });

  describe('Price-embedded barcodes', () => {
    it('should honor the label price for flagged products from any role', async () => {
      await prisma.product.update({
        where: { id: testData.product.id },
        data: { priceEmbedded: true },
      });

      // Cashier (not manager) sends the scale price via priceOverride
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          idempotencyKey: randomUUID(),
          items: [
            { productId: testData.product.id, quantity: 1, price: 4.2, priceOverride: true },
          ],
          paymentMethod: 'CASH',
          amountPaid: 10,
        })
        .expectStatus(201)
        .execute();

      expect(res.body.data.items[0].price).toBe(4.2);
      expect(res.body.data.subtotal).toBe(4.2);
    });

    it('should ignore cashier price overrides on unflagged products', async () => {
      const res = await api
        .post('/api/sales')
        .withAuth(cashierToken)
        .withBody({
          idempotencyKey: randomUUID(),
          items: [
            { productId: testData.product.id, quantity: 1, price: 0.01, priceOverride: true },
          ],
          paymentMethod: 'CASH',
          amountPaid: 50,
        })
        .expectStatus(201)
        .execute();

      // Catalog price wins — cashiers can't invent prices for normal products
      expect(res.body.data.items[0].price).toBe(19.99);
    });
  });
});
