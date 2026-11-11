/**
 * Stock losses by cause (upgrade plan, WP 2.2).
 *
 * Every stock change records why it happened on its value entry. The report
 * groups real losses by cause at cost, and keeps paper corrections (records
 * that were wrong, stock that was never lost) out of the loss total.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { moveInventory } from '../../services/inventory.service';
import { reclassStock } from '../../services/stockCorrection.service';
import { classifyStockDecrease, getStockLossReport } from '../../services/stockLossReport.service';

describe('Stock losses by cause', () => {
  let data: TestData, owner: string;
  const post = (path: string, body: object, token = owner) => request(app).post('/api' + path).set('Authorization', 'Bearer ' + token).send(body);
  const get = (path: string, token = owner) => request(app).get('/api' + path).set('Authorization', 'Bearer ' + token);
  const report = async () => (await get('/financial/inventory-costs/losses').expect(200)).body.data;
  const adjust = (quantity: number, type: string, productId = data.product.id, notes?: string) =>
    post(`/products/${productId}/adjust-inventory`, { quantity, type, notes }).expect(200);
  const opening = async (productId: string, quantity: number, value: number) => {
    const current = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    await post('/financial/inventory-costs/opening', { idempotencyKey: randomUUID(), notes: 'Counted with the supplier invoice',
      items: [{ productId, quantity, value, expectedVersion: current.stockVersion }] }).expect(200);
  };
  const loss = (body: { losses: { cause: string }[] }, cause: string) => body.losses.find(row => row.cause === cause);
  const correction = (body: { corrections: { kind: string }[] }, kind: string) => body.corrections.find(row => row.kind === kind);

  beforeEach(async () => {
    data = await seedTestData();
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.product.update({ where: { id: data.product.id }, data: { stockQuantity: 0, cost: 1.5, price: 2.5 } });
    await opening(data.product.id, 40, 60); // 40 units at $1.50
  });

  it('puts each write-off under its cause at cost, and stores the cause on the entry', async () => {
    for (const reason of ['DAMAGED', 'EXPIRED', 'WASTE', 'THEFT', 'LOST']) await adjust(-1, reason);
    await adjust(-2, 'DAMAGED');
    await adjust(-1, 'OTHER', data.product.id, 'Sample given to a rep');
    await adjust(-1, 'MISCOUNT');
    const body = await report();
    expect(loss(body, 'DAMAGED')).toMatchObject({ label: 'Damaged', events: 2, units: 3, amount: 4.5, missingValues: 0 });
    for (const cause of ['EXPIRED', 'WASTE', 'THEFT', 'LOST', 'OTHER', 'COUNT_SHORTFALL']) expect(loss(body, cause)).toMatchObject({ events: 1, units: 1, amount: 1.5 });
    expect(body.losses.map((row: { cause: string }) => row.cause)).toEqual(['DAMAGED', 'EXPIRED', 'WASTE', 'THEFT', 'LOST', 'COUNT_SHORTFALL', 'OTHER']);
    expect(body.total).toMatchObject({ events: 8, units: 9, amount: 13.5 });
    expect(body.found).toMatchObject({ events: 0, amount: 0 }); expect(body.netLoss).toBe(13.5);
    expect(body.corrections).toEqual([]);
    expect(body.period.timezone).toBeTruthy();
    const entries = await prisma.inventoryValueEntry.findMany({ where: { productId: data.product.id, quantity: { lt: 0 } }, orderBy: { sequence: 'asc' } });
    expect(entries.map(entry => entry.reason)).toEqual(['DAMAGED', 'EXPIRED', 'WASTE', 'THEFT', 'LOST', 'DAMAGED', 'OTHER', 'MISCOUNT']);
  });

  it('keeps paper corrections out of the loss total', async () => {
    const other = await prisma.product.create({ data: { name: 'Blue Razz', sku: 'BLUE-RAZZ', price: 2.5, cost: 1.5, stockQuantity: 0, locationId: data.location.id } });
    await opening(other.id, 10, 15);
    // Wrong product rung up: one unit moves between the two records. Nothing was lost.
    await prisma.$transaction(tx => reclassStock(tx, { locationId: data.location.id, userId: data.adminUser.id, fromProductId: data.product.id,
      toProductId: other.id, quantity: 1, reason: 'SOLD_AS_OTHER', idempotencyKey: randomUUID() }));
    await adjust(-2, 'SOLD_WITHOUT_SCANNING'); // sold on the misc key: cost of sales, not shrink
    await adjust(3, 'MISSING_RECEIPT');        // a delivery that was never entered
    await adjust(-1, 'THEFT');
    const body = await report();
    expect(correction(body, 'WRONG_PRODUCT')).toMatchObject({ label: 'Wrong product rung up', events: 1, units: 1, amount: 1.5 });
    expect(correction(body, 'UNSCANNED_SALE')).toMatchObject({ events: 1, units: 2, amount: 3 });
    expect(correction(body, 'LATE_DELIVERY')).toMatchObject({ events: 1, units: 3, amount: 4.5 });
    expect(body.losses).toHaveLength(1); expect(body.total).toMatchObject({ events: 1, units: 1, amount: 1.5 });
    const reclass = await prisma.inventoryValueEntry.findMany({ where: { kind: 'STOCK_RECLASS' } });
    expect(reclass.map(entry => entry.reason)).toEqual(['WRONG_SKU_SOLD', 'WRONG_SKU_SOLD']);
  });

  it('counts a transfer loss, offsets shortfalls with stock found in a count, and names approved count differences', async () => {
    const move = (movement: Partial<Parameters<typeof moveInventory>[1]>) => prisma.$transaction(tx => moveInventory(tx, {
      productId: data.product.id, locationId: data.location.id, userId: data.adminUser.id, type: 'CYCLE_COUNT', ...movement }));
    await move({ type: 'TRANSFER_LOSS', reason: 'TRANSFER_DAMAGED_OR_MISSING', quantity: 0, valueMode: 'FIXED', valueInput: 3, referenceQuantity: 2 });
    await move({ reason: 'COUNT_DIFFERENCE', setQuantity: 38 });  // a count finds 2 fewer
    await move({ reason: 'COUNT_DIFFERENCE', setQuantity: 39 });  // the next count finds 1 more
    const body = await report();
    expect(loss(body, 'TRANSFER_LOSS')).toMatchObject({ label: 'Lost or damaged in a transfer', events: 1, units: 2, amount: 3 });
    expect(loss(body, 'COUNT_SHORTFALL')).toMatchObject({ events: 1, units: 2, amount: 3 });
    expect(body.total.amount).toBe(6);
    expect(body.found).toMatchObject({ events: 1, units: 1, amount: 1.5 }); expect(body.netLoss).toBe(4.5);
  });

  it('reads the cause of older rows from the stock log or the resolved exception, and says so when there is none', async () => {
    // Rows written before the cause was stored on the value entry (reason is null).
    const legacy = (type: string, costKind: string) => prisma.$transaction(tx => moveInventory(tx, { productId: data.product.id,
      locationId: data.location.id, userId: data.adminUser.id, type, costKind, quantity: -1 }));
    await legacy('EXPIRED', 'STOCK_LOSS');    // the stock log still says why
    await legacy('ADJUSTMENT', 'STOCK_LOSS'); // nothing says why
    const counted = await legacy('EXCEPTION_COUNT', 'STOCK_LOSS');
    await prisma.inventoryException.create({ data: { productId: data.product.id, locationId: data.location.id, status: 'RESOLVED', lowestQuantity: -1,
      latestQuantity: 0, resolution: 'DAMAGED', adjustmentEntryId: counted.inventoryEntry.id, resolvedAt: new Date() } });
    expect(await prisma.inventoryValueEntry.count({ where: { kind: 'STOCK_LOSS', reason: null } })).toBe(3);
    const body = await report();
    expect(loss(body, 'EXPIRED')).toMatchObject({ events: 1, amount: 1.5 });
    expect(loss(body, 'DAMAGED')).toMatchObject({ events: 1, amount: 1.5 });
    expect(loss(body, 'NOT_RECORDED')).toMatchObject({ label: 'Reason not recorded', events: 1, amount: 1.5 });
  });

  it('leaves an unknown cost unavailable instead of counting it as zero', async () => {
    const unvalued = await prisma.product.create({ data: { name: 'No cost on record', sku: 'NO-COST', price: 3, cost: 0, stockQuantity: 5, locationId: data.location.id } });
    await adjust(-1, 'DAMAGED', unvalued.id);
    await adjust(-1, 'DAMAGED');
    const body = await report();
    expect(loss(body, 'DAMAGED')).toMatchObject({ events: 2, units: 2, amount: null, knownAmount: 1.5, missingValues: 1 });
    expect(body.total.amount).toBeNull(); expect(body.netLoss).toBeNull();
  });

  it('reports one store and one period only, to managers and owners of that store', async () => {
    await adjust(-1, 'THEFT');
    const storeB = await prisma.location.create({ data: { id: 'test-location-2', name: 'Second Store', address: '2 Test St', city: 'Test', state: 'TS', zipCode: '12345', phone: '555-0102', email: 'second@store.com' } });
    const ownerB = await prisma.user.create({ data: { email: 'owner-b@test.com', password: await bcrypt.hash('password123', 4), firstName: 'Owner', lastName: 'B', role: 'ADMIN', locationId: storeB.id } });
    const productB = await prisma.product.create({ data: { name: 'Store B item', sku: 'B-ITEM', price: 5, cost: 2, stockQuantity: 0, locationId: storeB.id } });
    const tokenB = await createTestToken(ownerB.id, 'ADMIN');
    const current = await prisma.product.findUniqueOrThrow({ where: { id: productB.id } });
    await post('/financial/inventory-costs/opening', { idempotencyKey: randomUUID(), notes: 'Counted with the supplier invoice',
      items: [{ productId: productB.id, quantity: 10, value: 20, expectedVersion: current.stockVersion }] }, tokenB).expect(200);
    await post(`/products/${productB.id}/adjust-inventory`, { quantity: -4, type: 'DAMAGED' }, tokenB).expect(200);
    expect((await report()).total).toMatchObject({ events: 1, amount: 1.5 });
    const other = (await get('/financial/inventory-costs/losses', tokenB).expect(200)).body.data;
    expect(other.total).toMatchObject({ events: 1, units: 4, amount: 8 });
    // A store owner cannot ask for another store's losses.
    await get('/financial/inventory-costs/losses?locationId=' + storeB.id).expect(403);
    // Nothing happened last year.
    expect((await get('/financial/inventory-costs/losses?startDate=2025-01-01&endDate=2025-12-31').expect(200)).body.data).toMatchObject({ losses: [], corrections: [], total: { events: 0, amount: 0 } });
    expect(await getStockLossReport(storeB.id, {})).toMatchObject({ total: { events: 1, amount: 8 } });
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await get('/financial/inventory-costs/losses', cashier).expect(403);
  });

  it('classifies a decrease by how it was costed and why it happened', () => {
    const place = (kind: string, reason: string | null) => classifyStockDecrease(kind, reason).cause;
    expect(place('TRANSFER_LOSS', 'TRANSFER_DAMAGED_OR_MISSING')).toBe('TRANSFER_LOSS');
    expect(place('UNRECORDED_SALE', 'SOLD_WITHOUT_SCANNING')).toBe('UNSCANNED_SALE');
    expect(place('COUNT', 'WRONG_SKU_SOLD')).toBe('WRONG_PRODUCT');
    expect(place('STOCK_LOSS', 'THEFT')).toBe('THEFT');
    expect(place('CYCLE_COUNT', 'COUNT_DIFFERENCE')).toBe('COUNT_SHORTFALL');
    expect(place('CYCLE_COUNT', null)).toBe('COUNT_SHORTFALL');
    expect(place('IMPORT', 'STOCK_FILE_IMPORT')).toBe('COUNT_SHORTFALL');
    expect(place('ADJUSTMENT', 'MANUAL_COUNT')).toBe('COUNT_SHORTFALL');
    expect(place('ADJUSTMENT', 'RETURNED')).toBe('OTHER');
    expect(place('STOCK_LOSS', 'OTHER')).toBe('OTHER');
    expect(place('STOCK_LOSS', null)).toBe('NOT_RECORDED');
    expect(place('STOCK_LOSS', 'EXCEPTION_COUNT')).toBe('NOT_RECORDED'); // a movement word is not a cause
    expect(classifyStockDecrease('COUNT', 'RECEIVED_AS_OTHER').group).toBe('CORRECTION');
    expect(classifyStockDecrease('STOCK_LOSS', 'DAMAGED').group).toBe('LOSS');
  });
});
