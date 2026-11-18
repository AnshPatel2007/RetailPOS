import { prisma, seedTestData, TestData } from './setup';
import { api, createTestToken } from './helpers';
import { randomUUID } from 'crypto';

describe('Final checkout quote and locked settlement', () => {
  let data: TestData, token: string;
  const items = () => [{ productId: data.product.id, price: 10, quantity: 1 }];
  beforeEach(async () => {
    data = await seedTestData();
    token = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.product.update({ where: { id: data.product.id }, data: { price: 10 } });
    await prisma.location.update({ where: { id: data.location.id }, data: { cardSurchargePercent: 3 } });
    await prisma.customer.update({ where: { id: data.customer.id }, data: { loyaltyPoints: 1000 } });
    await api.post('/api/shifts/clock-in').withAuth(token).withBody({ startingCash: 0 }).expectStatus(201).execute();
  });
  const quote = (intent = {}) => api.post('/api/sales/quote').withAuth(token).withBody({ items: items(), ...intent }).execute();

  it('recovers a recorded terminal sale after shift rollover but does not book a new payment into another drawer', async () => {
    const shift = await prisma.shift.findFirstOrThrow({ where: { userId: data.adminUser.id, isClosed: false } });
    const payload = { items: items(), paymentMethod: 'CARD', amountPaid: 11.18, expectedTotal: 11.18,
      expectedShiftId: shift.id, idempotencyKey: randomUUID(), payments: [{ paymentMethod: 'CARD', amount: 6, reference: 'TERMINAL-RECOVERY' }, { paymentMethod: 'CASH', amount: 5.18 }] };
    const original = await api.post('/api/sales').withAuth(token).withBody(payload).expectStatus(201).execute();
    await prisma.shift.update({ where: { id: shift.id }, data: { isClosed: true, clockOutAt: new Date() } });
    await api.post('/api/shifts/clock-in').withAuth(token).withBody({ startingCash: 0 }).expectStatus(201).execute();
    const retry = await api.post('/api/sales').withAuth(token).withBody(payload).expectStatus(200).execute();
    expect(retry.body.data.id).toBe(original.body.data.id);
    expect(retry.body.data.shiftId).toBe(shift.id);
    const unsaved = await api.post('/api/sales').withAuth(token).withBody({ ...payload, idempotencyKey: randomUUID() }).expectStatus(409).execute();
    expect(unsaved.body.error).toContain('original drawer session');
    expect(await prisma.sale.count()).toBe(1);
    expect(await prisma.drawerEntry.count()).toBe(1);
    expect(Number((await prisma.drawerEntry.findFirstOrThrow()).amount)).toBe(5.18);
  });

  it('returns the open drawer and the store settings with the prices, so checkout starts with one request', async () => {
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago',
      settings: { receiptSettings: { header: 'Hello', footer: 'Bye', showAddress: true, showTaxBreakdown: false }, internalNote: 'never leaves the server' } } });
    const shift = await prisma.shift.findFirstOrThrow({ where: { userId: data.adminUser.id, isClosed: false } });
    const quoted = await quote();
    expect(quoted.status).toBe(200);
    expect(quoted.body.data.shiftId).toBe(shift.id);
    expect(quoted.body.data.store).toMatchObject({ id: data.location.id, name: 'Test Store', taxRate: 10, cardSurchargePercent: 3, timezone: 'America/Chicago', isActive: true,
      settings: { receiptSettings: { header: 'Hello', footer: 'Bye', showAddress: true, showTaxBreakdown: false } } });
    // Only the supported settings are returned, never arbitrary saved JSON.
    expect(JSON.stringify(quoted.body.data.store)).not.toContain('never leaves the server');
    // The same shape the settings endpoint returns.
    const settings = await api.get('/api/locations/my-settings').withAuth(token).expectSuccess();
    expect(quoted.body.data.store).toEqual(settings.body.data);

    // Someone else's drawer is not this cashier's, and a closed drawer is no drawer.
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    const other = await api.post('/api/sales/quote').withAuth(cashier).withBody({ items: items() }).execute();
    expect(other.status).toBe(200);
    expect(other.body.data.shiftId).toBeNull();
    await api.post('/api/shifts/clock-out').withAuth(token).withBody({ endingCash: 0 }).expectStatus(200).execute();
    expect((await quote()).body.data.shiftId).toBeNull();
  });

  it('quotes customer redemption and card surcharge using the same rules as the sale', async () => {
    const intent = { customerId: data.customer.id, pointsRedeemed: 100, paymentMethod: 'CARD' };
    const quoted = await quote(intent);
    expect(quoted.status).toBe(200);
    expect(quoted.body.data).toMatchObject({ baseTotal: 11, total: 10.3, totalTax: 1, loyaltyDiscount: 1, surcharge: 0.3, redeemedPoints: 100, availablePoints: 1000 });
    const sold = await api.post('/api/sales').withAuth(token).withBody({ ...intent, items: items(), amountPaid: 10.3, expectedTotal: quoted.body.data.total, payments: [{ paymentMethod: 'CARD', amount: 10.3, reference: 'TEST-TERMINAL-1' }] }).expectStatus(201).execute();
    expect(sold.body.data).toMatchObject({ total: 10.3, surcharge: 0.3, loyaltyDiscount: 1, pointsRedeemed: 100 });
  });

  it('quotes a partially entered split without booking payment or redeeming points', async () => {
    const intent = { customerId: data.customer.id, pointsRedeemed: 100, paymentMethod: 'CASH', payments: [{ paymentMethod: 'CARD', amount: 4, reference: 'TEST-TERMINAL-2' }] };
    const quoted = await quote(intent);
    expect(quoted.body.data).toMatchObject({ total: 10.12, surcharge: 0.12 });
    expect(await prisma.sale.count()).toBe(0);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: data.customer.id } })).loyaltyPoints).toBe(1000);
    const sold = await api.post('/api/sales').withAuth(token).withBody({ ...intent, items: items(), amountPaid: 10.12, expectedTotal: quoted.body.data.total, payments: [...intent.payments, { paymentMethod: 'CASH', amount: 6.12 }] }).expectStatus(201).execute();
    expect(sold.body.data.total).toBe(10.12);
  });

  it('rejects foreign and inactive customers without revealing balances', async () => {
    const other = await prisma.location.create({ data: { name: 'Other store', address: '2 Test St', city: 'Test', state: 'TS', zipCode: '12345', phone: '555-0102', email: 'other@example.test' } });
    await prisma.customer.update({ where: { id: data.customer.id }, data: { locationId: other.id } });
    const foreign = await quote({ customerId: data.customer.id });
    expect(foreign.status).toBe(404); expect(foreign.body.data).toBeUndefined();
    await prisma.customer.update({ where: { id: data.customer.id }, data: { locationId: data.location.id, isActive: false } });
    expect((await quote({ customerId: data.customer.id })).status).toBe(404);
  });

  it('rejects stale points balances, missing customers and excessive redemptions', async () => {
    expect((await quote({ pointsRedeemed: 100 })).status).toBe(400);
    await prisma.customer.update({ where: { id: data.customer.id }, data: { loyaltyPoints: 50 } });
    expect((await quote({ customerId: data.customer.id, pointsRedeemed: 100 })).body.error).toContain('Insufficient loyalty');
    await prisma.customer.update({ where: { id: data.customer.id }, data: { loyaltyPoints: 5000 } });
    expect((await quote({ customerId: data.customer.id, pointsRedeemed: 1101 })).body.error).toContain('exceed the sale amount');
  });

  it('revalidates a changed price at commit without changing stock or the drawer', async () => {
    const quoted = await quote();
    const stock = (await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity;
    await prisma.product.update({ where: { id: data.product.id }, data: { price: 12 } });
    await api.post('/api/sales').withAuth(token).withBody({ items: items(), paymentMethod: 'CASH', amountPaid: 11, expectedTotal: quoted.body.data.total }).expectStatus(409).execute();
    expect(await prisma.sale.count()).toBe(0);
    expect(await prisma.drawerEntry.count()).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).stockQuantity).toBe(stock);
    expect((await quote()).body.data.total).toBe(13.2);
  });

  it('rejects a one-cent shortfall, a split discrepancy and fractional payment cents', async () => {
    for (const payment of [
      { amountPaid: 10.99 },
      { amountPaid: 11, payments: [{ paymentMethod: 'CASH', amount: 10.99 }] },
      { amountPaid: 11.001 },
    ]) await api.post('/api/sales').withAuth(token).withBody({ items: items(), paymentMethod: 'CASH', ...payment }).expectStatus(400).execute();
    expect(await prisma.sale.count()).toBe(0);
  });

  it('does not quote an EBT settlement before tender-specific tax and refund validation', async () => {
    await prisma.product.update({ where: { id: data.product.id }, data: { ebtEligible: true } });
    const catalog = await quote();
    expect(catalog.body.data.ebtEligibleTotal).toBe(10);
    const response = await quote({ paymentMethod: 'CASH', payments: [{ paymentMethod: 'EBT', amount: 5 }] });
    expect(response.status).toBe(409);
    expect(response.body.error).toContain('EBT/SNAP checkout is unavailable');
  });

  it('preserves historical EBT records while blocking unvalidated cash refunds and voids', async () => {
    for (const method of ['EBT', 'CASH'] as const) {
      const sale = await prisma.sale.create({ data: {
        saleNumber: 'LEGACY-EBT-' + method, userId: data.adminUser.id, locationId: data.location.id,
        paymentMethod: method, total: 11, amountPaid: 11,
        ...(method === 'CASH' ? { payments: { create: [{ paymentMethod: 'CASH', amount: 6 }, { paymentMethod: 'EBT', amount: 5 }] } } : {}),
      } });
      await api.get('/api/sales/' + sale.id).withAuth(token).expectStatus(200).execute();
      const refunded = await api.post('/api/sales/' + sale.id + '/refund').withAuth(token).withBody({ amount: 1, reason: 'Historical return', refundMethod: 'CASH' }).expectStatus(409).execute();
      expect(refunded.body.error).toContain('original-tender reversal');
      await api.post('/api/sales/' + sale.id + '/void').withAuth(token).withBody({ reason: 'Historical void' }).expectStatus(409).execute();
      expect((await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe('COMPLETED');
    }
    expect(await prisma.refund.count()).toBe(0);
    expect(await prisma.saleVoid.count()).toBe(0);
    expect(await prisma.drawerEntry.count()).toBe(0);
  });

  it('rechecks a disabled payment method at commit and quotes only enabled tenders', async () => {
    const quoted = await quote({ paymentMethod: 'CARD' });
    expect(quoted.status).toBe(200);
    await api.put('/api/locations/my-settings').withAuth(token).withBody({ paymentMethods: { cash: true, card: false, giftCard: false, storeCredit: false } }).expectStatus(200).execute();
    const disabled = await quote({ paymentMethod: 'CARD' });
    expect(disabled.status).toBe(409); expect(disabled.body.error).toContain('CARD is disabled');
    await api.post('/api/sales').withAuth(token).withBody({ items: items(), paymentMethod: 'CARD', amountPaid: quoted.body.data.total,
      expectedTotal: quoted.body.data.total, payments: [{ paymentMethod: 'CARD', amount: quoted.body.data.total, reference: 'TEST-TERMINAL-DISABLED' }],
    }).expectStatus(409).execute();
    expect(await prisma.sale.count()).toBe(0);
    expect((await quote({ paymentMethod: 'CASH' })).body.data.total).toBe(11);
  });
});
