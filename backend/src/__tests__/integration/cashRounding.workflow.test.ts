/**
 * Cash rounding to 5 cents (upgrade plan, WP 8.7): off by default; only the cash that
 * finishes a sale is rounded and never the exact cents; cards are charged exactly; the
 * sale stays exact while the change, the drawer, the Z-report and the store's figures
 * carry the rounding; a cash refund rounds its own cash part.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getFinancialMetrics } from '../../services/financialMetrics.service';
import { getSalesCollectionMetrics } from '../../services/salesCollectionMetrics.service';

describe('Cash rounding', () => {
  let data: TestData, owner: string, manager: string, productId: string;
  const as = (token: string) => ({ Authorization: 'Bearer ' + token });
  /** A $12.42 item (no tax), paid as given. */
  const sell = (body: Record<string, unknown>, quantity = 1, token = owner) => request(app).post('/api/sales').set(as(token))
    .send({ idempotencyKey: randomUUID(), items: [{ productId, quantity, price: 12.42 }], paymentMethod: 'CASH', ...body });
  const refund = (saleId: string, items: { saleItemId: string; quantity: number }[], body: Record<string, unknown> = {}) => request(app).post(`/api/sales/${saleId}/refund`).set(as(owner))
    .send({ items, reason: 'Returned', idempotencyKey: randomUUID(), ...body });
  const setRounding = (cashRounding: string, token = owner) => request(app).put('/api/locations/my-settings').set(as(token)).send({ cashControl: { blindClose: true, cashRounding } });
  const drawer = async () => (await request(app).get('/api/shifts/current').set(as(owner)).expect(200)).body.data;

  beforeEach(async () => {
    data = await seedTestData();
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
    const managerUser = await prisma.user.create({ data: { email: 'rounding-manager@test.com', password: data.adminUser.password, firstName: 'Mo', lastName: 'Manager', role: 'MANAGER', locationId: data.location.id } });
    manager = await createTestToken(managerUser.id, 'MANAGER');
    productId = (await prisma.product.create({ data: { name: 'Penny Test Item', sku: 'PENNY-1242', price: 12.42, cost: 5, stockQuantity: 50, isTaxable: false, locationId: data.location.id } })).id;
    await request(app).post('/api/shifts/clock-in').set(as(owner)).send({ startingCash: 100 }).expect(201);
  });

  it('is off by default: every sale is exact, and a register cannot round on its own', async () => {
    const settings = (await request(app).get('/api/locations/my-settings').set(as(owner)).expect(200)).body.data.settings;
    expect(settings.cashControl).toEqual({ blindClose: true, cashRounding: 'OFF' });
    expect((await sell({ amountPaid: 20 }).expect(201)).body.data).toMatchObject({ total: 12.42, changeDue: 7.58, cashRounding: 0 });
    expect((await sell({ amountPaid: 20, cashRoundingMode: 'NEAREST' }).expect(409)).body.error).toBe('Cash rounding was changed in Settings. Review the payment and charge again.');
    // Only owners choose it.
    await setRounding('NEAREST', manager).expect(403);
    await setRounding('HALF', owner).expect(400);
  });

  it('rounds only the cash that finishes a sale, never the exact cents or a card', async () => {
    await setRounding('NEAREST').expect(200);
    const fromTwenty = (await sell({ amountPaid: 20, cashRoundingMode: 'NEAREST' }).expect(201)).body.data;
    expect(fromTwenty).toMatchObject({ total: 12.42, amountPaid: 20, changeDue: 7.6, cashRounding: -0.02 });
    // The customer counts out the exact cents: charged exactly.
    expect((await sell({ amountPaid: 12.42, cashRoundingMode: 'NEAREST' }).expect(201)).body.data).toMatchObject({ changeDue: 0, cashRounding: 0 });
    // The rounded amount is enough; less is not.
    expect((await sell({ amountPaid: 12.4, cashRoundingMode: 'NEAREST' }).expect(201)).body.data).toMatchObject({ changeDue: 0, cashRounding: -0.02 });
    expect((await sell({ amountPaid: 12.35, cashRoundingMode: 'NEAREST' }).expect(400)).body.error).toMatch(/^Insufficient payment: received \$12\.35 but the cash due is \$12\.40 \(rounded from \$12\.42\)\. Short by \$0\.05$/);
    // A card is charged exactly; card first and cash for the rest rounds only the $2.42 left.
    expect((await sell({ paymentMethod: 'CARD', amountPaid: 12.42, payments: [{ paymentMethod: 'CARD', amount: 12.42, reference: 'APPROVAL-1' }], cashRoundingMode: 'NEAREST' }).expect(201)).body.data)
      .toMatchObject({ cashRounding: 0, changeDue: 0 });
    expect((await sell({ amountPaid: 15, payments: [{ paymentMethod: 'CARD', amount: 10, reference: 'APPROVAL-2' }, { paymentMethod: 'CASH', amount: 5 }], cashRoundingMode: 'NEAREST' }).expect(201)).body.data)
      .toMatchObject({ total: 12.42, changeDue: 2.6, cashRounding: -0.02 });
    // An older register that does not round is booked exactly.
    expect((await sell({ amountPaid: 20 }).expect(201)).body.data).toMatchObject({ changeDue: 7.58, cashRounding: 0 });

    // The drawer expects the cash that changed hands; its report shows the rounding on its own line.
    const open = await drawer();
    expect(open.cashSales).toBe(12.4 + 12.42 + 12.4 + 2.4 + 12.42);
    expect(open.cashRounding).toBe(-0.06);
    expect(open.expectedDrawer).toBe(100 + 52.04);
    const report = (await request(app).get(`/api/shifts/${open.id}/z-report`).set(as(owner)).expect(200)).body.data;
    expect(report).toMatchObject({ cashRounding: -0.06, totalSales: 74.52 });
    // Sales figures stay exact; the store's figures carry the rounding apart.
    const today = await getFinancialMetrics({ locationId: data.location.id });
    expect(today).toMatchObject({ grossCollected: 74.52, cashRounding: -0.06 });
    const salesReport = await getSalesCollectionMetrics({ locationId: data.location.id }, { gte: new Date(Date.now() - 86400000), lt: new Date(Date.now() + 60000) }, prisma);
    expect(salesReport).toMatchObject({ netCollected: 74.52, cashRounding: -0.06 });
  });

  it('a cash refund rounds its own cash part; a void gives back the cash that was taken', async () => {
    await setRounding('NEAREST').expect(200);
    // Two items for $24.84, paid with $30: $24.85 due (+1 cent), $5.15 change.
    const pair = (await sell({ amountPaid: 30, cashRoundingMode: 'NEAREST' }, 2).expect(201)).body.data;
    expect(pair).toMatchObject({ total: 24.84, changeDue: 5.15, cashRounding: 0.01 });
    const line = pair.items[0].id;
    // One back: its $12.42 of cash paid back as $12.40; the refund amount stays exact.
    const first = (await refund(pair.id, [{ saleItemId: line, quantity: 1 }], { cashRoundingMode: 'NEAREST' }).expect(200)).body.refund;
    expect(first).toMatchObject({ amount: 12.42, cashRounding: -0.02 });
    // A register that does not round pays the exact cents; a mode the owner did not choose is refused.
    await refund(pair.id, [{ saleItemId: line, quantity: 1 }], { cashRoundingMode: 'CUSTOMER' }).expect(409);
    const second = (await refund(pair.id, [{ saleItemId: line, quantity: 1 }]).expect(200)).body.refund;
    expect(second).toMatchObject({ amount: 12.42, cashRounding: 0 });
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: pair.id } })).status).toBe('REFUNDED');

    // In the customer's favor: a sale rounds down, a refund up.
    await setRounding('CUSTOMER').expect(200);
    const favor = (await sell({ amountPaid: 20, cashRoundingMode: 'CUSTOMER' }).expect(201)).body.data;
    expect(favor).toMatchObject({ changeDue: 7.6, cashRounding: -0.02 });
    expect((await refund(favor.id, [{ saleItemId: favor.items[0].id, quantity: 1 }], { cashRoundingMode: 'CUSTOMER' }).expect(200)).body.refund).toMatchObject({ amount: 12.42, cashRounding: 0.03 });

    // A void returns exactly the cash that was taken ($12.40), and takes its rounding back.
    const voided = (await sell({ amountPaid: 20, cashRoundingMode: 'CUSTOMER' }).expect(201)).body.data;
    await request(app).post(`/api/sales/${voided.id}/void`).set(as(owner)).send({ reason: 'Rang twice', idempotencyKey: randomUUID() }).expect(200);
    const entries = await prisma.drawerEntry.findMany({ where: { OR: [{ saleId: voided.id }, { refund: { saleId: pair.id } }] }, orderBy: { createdAt: 'asc' }, select: { type: true, amount: true } });
    expect(entries.map(entry => [entry.type, Number(entry.amount)])).toEqual([['REFUND', -12.4], ['REFUND', -12.42], ['SALE', 12.4], ['VOID', -12.4]]);

    // Every sale was refunded or voided, so the exact amounts net to zero and the drawer is off by the rounding alone:
    // cash 24.85 - 12.40 - 12.42 + 12.40 - 12.45 + 12.40 - 12.40 = -0.02; rounding +0.01 +0.02 +0 -0.02 -0.03 -0.02 +0.02 = -0.02.
    const open = await drawer();
    expect(open.expectedDrawer).toBe(99.98);
    expect(open.cashRounding).toBe(-0.02);
    expect(await getFinancialMetrics({ locationId: data.location.id })).toMatchObject({ cashRounding: -0.02 });
  });
});
