/**
 * Compliance Workflow Integration Tests (Phase 2)
 *
 * - Age-restricted items: sale blocked without verification, underage blocked
 *   (with a failed-check audit row), verified sales log the check
 * - EBT tender: disabled until tax allocation and original-tender returns are validated
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

  describe('EBT launch boundary', () => {
    it.each([
      ['ineligible cart', false, 'EBT', [{ paymentMethod: 'EBT', amount: 21.99 }]],
      ['eligible cart', true, 'EBT', [{ paymentMethod: 'EBT', amount: 21.99 }]],
      ['mixed tenders', true, 'CASH', [{ paymentMethod: 'EBT', amount: 10 }, { paymentMethod: 'CASH', amount: 11.99 }]],
    ])('blocks %s without recording payment or changing inventory', async (_label, eligible, method, payments) => {
      await prisma.product.update({ where: { id: testData.product.id }, data: { ebtEligible: eligible as boolean } });
      const res = await api.post('/api/sales').withAuth(cashierToken)
        .withBody(saleBody({ paymentMethod: method, amountPaid: 21.99, payments })).expectStatus(409).execute();
      assertResponse.error(res, 'EBT/SNAP checkout is unavailable');
      expect(await prisma.sale.count()).toBe(0);
      expect(await prisma.drawerEntry.count()).toBe(0);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: testData.product.id } })).stockQuantity).toBe(100);
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

    it('requires manager approval for cashier price overrides on unflagged products', async () => {
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
        .expectStatus(428)
        .execute();

      expect(res.body.error).toContain('Manager approval');
      expect(await prisma.sale.count()).toBe(0);
    });
  });
});
