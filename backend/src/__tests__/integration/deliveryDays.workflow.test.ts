import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { AttentionContext, supplierOrderDueTomorrow } from '../../services/attention.service';
import { addDays } from '../../services/reorderPlan';
import { storeDay } from '../../services/reorder.service';

describe('Supplier delivery days and the reorder plan', () => {
  let data: TestData;
  let owner: string;
  const zone = 'America/Chicago';
  beforeEach(async () => {
    data = await seedTestData(); owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: zone } });
  });
  const call = (method: 'get' | 'put', path: string, body?: object) => {
    const pending = request(app)[method](path).set('Authorization', 'Bearer ' + owner);
    return body ? pending.send(body) : pending;
  };
  const weekdayOf = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay();
  /** Thirty sold in the last month: one a day. */
  const sellThirty = () => prisma.sale.create({ data: {
    saleNumber: randomUUID(), userId: data.cashierUser.id, locationId: data.location.id, createdAt: new Date(Date.now() - 5 * 86400000), pricingVersion: 1,
    paymentMethod: 'CASH', subtotal: 300, tax: 0, total: 300, amountPaid: 300,
    items: { create: { productId: data.product.id, productName: data.product.name, sku: data.product.sku, quantity: 30, price: 10, total: 300, tax: 0, unitCost: 4 } },
  } });

  it('saves delivery days in weekday order and plans the supplier to its next and following delivery', async () => {
    await call('put', '/api/suppliers/' + data.supplier.id, { deliveryDays: [7] }).expect(400);
    const saved = (await call('put', '/api/suppliers/' + data.supplier.id, { deliveryDays: [5, 2, 2], leadTimeDays: 1 }).expect(200)).body.data;
    expect(saved.deliveryDays).toEqual([2, 5]);

    await prisma.product.update({ where: { id: data.product.id }, data: { stockQuantity: 3, lowStockAlert: 0 } });
    await prisma.productSupplier.create({ data: { productId: data.product.id, supplierId: data.supplier.id, cost: 4 } });
    await sellThirty();
    const plan = (await call('get', '/api/purchase-orders/suggested').expect(200)).body.data;
    const today = storeDay(zone);
    expect(plan.today).toBe(today.date);
    const group = plan.suppliers.find((row: { supplierId: string }) => row.supplierId === data.supplier.id);
    expect(group).toMatchObject({ basis: 'DELIVERY_DAYS', deliveryDays: [2, 5], leadTimeDays: 1 });
    expect([2, 5]).toContain(weekdayOf(group.nextDelivery));
    expect([2, 5]).toContain(weekdayOf(group.followingDelivery));
    expect(group.nextDelivery > today.date && group.followingDelivery > group.nextDelivery).toBe(true);
    expect(group.items[0]).toMatchObject({ productId: data.product.id, velocityPerDay: 1, stock: 3 });
  });

  it('suggests the weekdays deliveries arrived on at least three days in the last eight weeks, without saving them', async () => {
    const order = await prisma.purchaseOrder.create({ data: { orderNumber: 'PO-DAYS', supplierId: data.supplier.id, locationId: data.location.id, status: 'ORDERED', totalAmount: 0 } });
    const receivedOn = (daysAgo: number, hourUtc = 17) => {
      const at = new Date(Date.now() - daysAgo * 86400000);
      at.setUTCHours(hourUtc, 0, 0, 0);
      return prisma.purchaseReceipt.create({ data: { purchaseOrderId: order.id, idempotencyKey: randomUUID(), requestHash: 'x', receivedBy: data.adminUser.id, createdAt: at } });
    };
    // Three different weeks on one weekday, twice on the same day of another weekday (one day only), and one too long ago.
    await Promise.all([receivedOn(7), receivedOn(14), receivedOn(21), receivedOn(10), receivedOn(10, 18), receivedOn(70)]);
    const expected = weekdayOf(storeDay(zone, new Date(Date.now() - 7 * 86400000)).date);
    const suggestion = (await call('get', `/api/suppliers/${data.supplier.id}/delivery-days/suggestion`).expect(200)).body.data;
    expect(suggestion).toEqual({ weekdays: [expected], deliveries: 4, weeks: 8 });
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: data.supplier.id } })).deliveryDays).toEqual([]);
  });

  it('says the day before an order must go in how many items will run out before the following delivery', async () => {
    const today = storeDay(zone);
    // A lead time of one day and a delivery two days out: the order must go in tomorrow.
    const deliveryDay = weekdayOf(addDays(today.date, 2));
    await prisma.supplier.update({ where: { id: data.supplier.id }, data: { deliveryDays: [deliveryDay], leadTimeDays: 1 } });
    await prisma.product.update({ where: { id: data.product.id }, data: { stockQuantity: 3, lowStockAlert: 0 } });
    await prisma.productSupplier.create({ data: { productId: data.product.id, supplierId: data.supplier.id, cost: 4 } });
    await sellThirty();
    const context = { locationId: data.location.id, now: new Date() } as AttentionContext;
    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][deliveryDay];
    expect(await supplierOrderDueTomorrow(context)).toEqual({ key: 'order-due-tomorrow', severity: 'medium', count: 1,
      href: '/inventory/purchasing/suggestions?supplier=' + data.supplier.id,
      sentence: `Test Supplier delivers ${weekday}; order by tomorrow. 1 item will run out before the following delivery.` });

    // A day later the order is due today, not tomorrow: no reminder.
    await prisma.supplier.update({ where: { id: data.supplier.id }, data: { deliveryDays: [weekdayOf(addDays(today.date, 1))] } });
    expect(await supplierOrderDueTomorrow(context)).toBeNull();
    await prisma.supplier.update({ where: { id: data.supplier.id }, data: { deliveryDays: [] } });
    expect(await supplierOrderDueTomorrow(context)).toBeNull();
  });
});
