/**
 * Retail inventory acceptance scenarios (requirements spec, section 20).
 *
 * A physical store never refuses a sale because recorded stock ran out. Every
 * sale still gets a cost treatment, negative balances raise one deduplicated
 * exception, and corrections are auditable. Scenario numbers follow the spec.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getFinancialMetrics } from '../../services/financialMetrics.service';
import { decimal, valueMovement } from '../../services/inventoryCost.service';
import { rankRelatedProducts } from '../../services/inventoryException.service';

describe('Retail inventory acceptance', () => {
  let data: TestData, owner: string;
  const post = (path: string, body: object, token = owner) => request(app).post(path).set('Authorization', 'Bearer ' + token).send(body);
  const get = (path: string, token = owner) => request(app).get(path).set('Authorization', 'Bearer ' + token);

  beforeEach(async () => {
    data = await seedTestData();
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, clockInAt: new Date() } });
    await prisma.product.update({ where: { id: data.product.id }, data: { price: 2.49, isTaxable: false, stockQuantity: 0, cost: 1.5 } });
  });

  const product = () => prisma.product.findUniqueOrThrow({ where: { id: data.product.id } });
  const balance = (productId = data.product.id) => prisma.inventoryValuation.findUniqueOrThrow({ where: { productId } });
  const opening = async (quantity: number, value: number, productId = data.product.id) => {
    const current = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    return post('/api/financial/inventory-costs/opening', { idempotencyKey: randomUUID(), notes: 'Verified physical count and supplier invoice',
      items: [{ productId, quantity, value, expectedVersion: current.stockVersion }] }).expect(200);
  };
  const sell = (quantity: number, productId = data.product.id, price = 2.49, token = owner) =>
    post('/api/sales', { items: [{ productId, quantity, price }], paymentMethod: 'CASH', amountPaid: Math.ceil(quantity * price) + 1, idempotencyKey: randomUUID() }, token);
  const receive = async (quantity: number, unitCost: number, productId = data.product.id) => {
    const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    const order = await prisma.purchaseOrder.create({ data: { orderNumber: 'PO-' + randomUUID(), supplierId: data.supplier.id, locationId: data.location.id,
      status: 'ORDERED', items: { create: { productId, sku: p.sku, productName: p.name, quantity, cost: unitCost, total: quantity * unitCost } } }, include: { items: true } });
    return post('/api/purchase-orders/' + order.id + '/receive', { idempotencyKey: randomUUID(), receivedItems: [{ purchaseOrderItemId: order.items[0].id, quantity, unitCost }] }).expect(200);
  };
  const openException = (productId = data.product.id) => prisma.inventoryException.findUnique({ where: { openProductId: productId } });

  it('1. sells a zero-stock product, goes negative, and opens one exception', async () => {
    await opening(0, 0);
    const sale = (await sell(1).expect(201)).body.data;
    expect((await product()).stockQuantity).toBe(-1);
    const exception = await openException();
    expect(exception).toMatchObject({ status: 'OPEN', latestQuantity: -1, lowestQuantity: -1, occurrenceCount: 1, triggerSaleId: sale.id });
    // Further sales update the same alert instead of creating new ones.
    await sell(2).expect(201);
    expect(await prisma.inventoryException.count()).toBe(1);
    expect(await openException()).toMatchObject({ latestQuantity: -3, lowestQuantity: -3, occurrenceCount: 2 });
  });

  it('2. never reports a 100% margin for a sale beyond recorded stock with a known cost', async () => {
    await opening(2, 3); // two units at $1.50
    const sale = (await sell(3).expect(201)).body.data;
    const line = await prisma.saleItem.findUniqueOrThrow({ where: { id: sale.items[0].id } });
    expect(line.costStatus).toBe('ESTIMATED');
    expect(Number(line.costAmount)).toBe(4.5); // 2 covered at average + 1 estimated at $1.50
    const value = await balance();
    expect(value.quantity).toBe(-1); expect(Number(value.value)).toBe(-1.5);
    const metrics = await getFinancialMetrics({ locationId: data.location.id });
    expect(metrics.costOfGoodsSold).toBe(4.5);
    expect(metrics.grossProfit).toBe(Math.round((7.47 - 4.5) * 100) / 100);
    expect(metrics.costBasis).toBe('ESTIMATED');
    expect(metrics.costCompleteness).toMatchObject({ complete: true, estimated: true, label: 'Includes estimated costs' });
  });

  it('3. completes a sale with no cost source but flags profit as unresolved, not fully profitable', async () => {
    await prisma.product.update({ where: { id: data.product.id }, data: { cost: 0 } });
    await opening(0, 0);
    const sale = (await sell(1).expect(201)).body.data;
    const line = await prisma.saleItem.findUniqueOrThrow({ where: { id: sale.items[0].id } });
    expect(line.costStatus).toBe('UNKNOWN'); expect(line.costAmount).toBeNull();
    const metrics = await getFinancialMetrics({ locationId: data.location.id });
    expect(metrics.costOfGoodsSold).toBeNull(); expect(metrics.grossProfit).toBeNull(); expect(metrics.grossMargin).toBeNull();
    expect(metrics.costCompleteness.complete).toBe(false);
  });

  it('uses an owner-set provisional cost before the catalog price', async () => {
    await prisma.product.update({ where: { id: data.product.id }, data: { cost: 9, provisionalUnitCost: 1.25 } });
    await opening(0, 0);
    const sale = (await sell(2).expect(201)).body.data;
    expect(Number((await prisma.saleItem.findUniqueOrThrow({ where: { id: sale.items[0].id } })).costAmount)).toBe(2.5);
  });

  it('keeps requiring recorded stock for transfers, write-offs and supplier returns', async () => {
    await opening(2, 3);
    await post(`/api/products/${data.product.id}/adjust-inventory`, { quantity: -5, type: 'DAMAGED' }).expect(400);
    expect((await product()).stockQuantity).toBe(2);
    expect(await prisma.inventoryException.count()).toBe(0);
  });

  it('still refuses a product on a recall / prohibited-sale hold', async () => {
    await prisma.product.update({ where: { id: data.product.id }, data: { stockQuantity: 50, saleBlockedReason: 'Manufacturer recall' } });
    const res = await sell(1).expect(409);
    expect(res.body.error).toContain('Manufacturer recall');
  });

  it('11. suggests related SKUs (family + size first) without asserting a cause', async () => {
    const make = (name: string, extra: object) => prisma.product.create({ data: { name, sku: randomUUID(), price: 2.49, cost: 1.5, stockQuantity: 8,
      locationId: data.location.id, categoryId: data.category.id, isTaxable: false, ...extra } });
    await prisma.product.update({ where: { id: data.product.id }, data: { name: 'Gatorade Orange 20 oz', brand: 'Gatorade', productFamily: 'Gatorade Thirst Quencher', variant: 'Orange', size: '20 oz' } });
    const lemon = await make('Gatorade Lemon-Lime 20 oz', { brand: 'Gatorade', productFamily: 'Gatorade Thirst Quencher', variant: 'Lemon-Lime', size: '20 oz' });
    const big = await make('Gatorade Orange 32 oz', { brand: 'Gatorade', productFamily: 'Gatorade Thirst Quencher', variant: 'Orange', size: '32 oz' });
    const unrelated = await prisma.product.create({ data: { name: 'AA Batteries 4 pack', sku: randomUUID(), price: 6, cost: 3, stockQuantity: 5, locationId: data.location.id } });
    await opening(0, 0);
    await sell(3).expect(201);
    const exception = (await openException())!;
    const detail = (await get('/api/inventory-exceptions/' + exception.id).expect(200)).body.data;
    expect(detail.currentQuantity).toBe(-3);
    expect(detail.summary).toContain('3 more units were sold');
    const ids = detail.relatedProducts.map((p: { id: string }) => p.id);
    expect(ids[0]).toBe(lemon.id); // same family and same size ranks first
    expect(ids).toContain(big.id);
    expect(ids).not.toContain(unrelated.id);
    expect(detail.relatedProducts[0].reasons).toContain('Same product family and size');
    expect(detail.possibleCauses.length).toBeGreaterThan(1);
    expect(JSON.stringify(detail)).not.toMatch(/cashier (made|caused)/i);
    const summary = (await get('/api/inventory-exceptions/summary').expect(200)).body.data;
    expect(summary).toMatchObject({ open: 1, unresolved: 1 });
  });

  it('ranks related products deterministically from structured attributes', () => {
    const base = { barcode: null, stockQuantity: 0, categoryId: 'c', supplierIds: ['s'], variant: null };
    const target = { ...base, id: 't', name: 'Coca-Cola 12 oz Can', sku: 't', brand: 'Coca-Cola', productFamily: 'Coke', size: '12 oz' };
    const ranked = rankRelatedProducts(target, [
      { ...base, id: 'a', name: 'Diet Coke 12 oz Can', sku: 'a', brand: 'Coca-Cola', productFamily: 'Coke', size: '12 oz' },
      { ...base, id: 'b', name: 'Sprite 12 oz Can', sku: 'b', brand: 'Coca-Cola', productFamily: 'Sprite', size: '12 oz' },
      { ...base, id: 'c', name: 'Paper towels', sku: 'c', brand: 'Bounty', productFamily: null, size: null, categoryId: 'other', supplierIds: [] },
    ]);
    expect(ranked.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('12. requires reasons for stock changes, records counts with an audit trail, and is retry-safe', async () => {
    await opening(0, 0);
    await sell(3).expect(201);
    // Reasonless adjustments are rejected.
    await post(`/api/products/${data.product.id}/adjust-inventory`, { quantity: 1 }).expect(400);
    await post(`/api/products/${data.product.id}/adjust-inventory`, { quantity: 1, type: 'OTHER' }).expect(400);
    // A retried adjustment applies once.
    const key = randomUUID();
    await post(`/api/products/${data.product.id}/adjust-inventory`, { quantity: 1, type: 'MISSING_RECEIPT', idempotencyKey: key }).expect(200);
    await post(`/api/products/${data.product.id}/adjust-inventory`, { quantity: 1, type: 'MISSING_RECEIPT', idempotencyKey: key }).expect(200);
    expect((await product()).stockQuantity).toBe(-2);
    // Physical count of 5 against -2 records +7 and resolves the exception.
    const exception = (await openException())!;
    const current = await product();
    const counted = (await post(`/api/inventory-exceptions/${exception.id}/count`, { countedQuantity: 5, resolution: 'WRONG_SKU_SOLD',
      notes: 'Orange was rung up as Lemon-Lime', expectedVersion: current.stockVersion, idempotencyKey: randomUUID() }).expect(200)).body.data;
    expect(counted).toMatchObject({ status: 'RESOLVED', resolution: 'WRONG_SKU_SOLD', countedQuantity: 5, resolvedById: data.adminUser.id });
    expect((await product()).stockQuantity).toBe(5);
    const log = await prisma.inventoryLog.findFirstOrThrow({ where: { productId: data.product.id, type: 'EXCEPTION_COUNT' } });
    expect(log).toMatchObject({ quantity: 7, previousQty: -2, newQty: 5, userId: data.adminUser.id });
    expect(await openException()).toBeNull();
    // A later shortfall opens a fresh exception; the resolved one stays as history.
    await sell(6).expect(201);
    expect(await prisma.inventoryException.count()).toBe(2);
  });

  it('12. corrects a wrong-SKU sale line without changing the receipt, and blocks restocking refunds', async () => {
    const lemon = await prisma.product.create({ data: { name: 'Lemon-Lime', sku: randomUUID(), price: 2.49, cost: 1.5, stockQuantity: 0, locationId: data.location.id, isTaxable: false } });
    await opening(5, 7.5); await opening(5, 7.5, lemon.id);
    // Customer bought Lemon-Lime, cashier rang Orange.
    const sale = (await sell(1).expect(201)).body.data;
    const body = { toProductId: lemon.id, quantity: 1, reason: 'Customer bought Lemon-Lime; Orange scanned by mistake', idempotencyKey: randomUUID() };
    await post(`/api/sales/${sale.id}/items/${sale.items[0].id}/correct-product`, body).expect(200);
    await post(`/api/sales/${sale.id}/items/${sale.items[0].id}/correct-product`, body).expect(200); // retry-safe
    expect((await product()).stockQuantity).toBe(5);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: lemon.id } })).stockQuantity).toBe(4);
    const stored = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true } });
    expect(Number(stored.total)).toBe(2.49); expect(stored.items[0].productId).toBe(data.product.id);
    expect(await prisma.saleItemCorrection.count()).toBe(1);
    await post(`/api/sales/${sale.id}/refund`, { amount: 2.49, reason: 'Customer return', restock: true, idempotencyKey: randomUUID() }).expect(409);
  });

  it('13. serializes concurrent sales from a negative balance without lost updates', async () => {
    await opening(0, 0);
    await sell(1).expect(201);
    const results = await Promise.all([sell(2), sell(2)]);
    expect(results.map(r => r.status)).toEqual([201, 201]);
    expect((await product()).stockQuantity).toBe(-5);
    expect((await balance()).quantity).toBe(-5);
    expect(await prisma.inventoryException.count()).toBe(1);
    expect(await openException()).toMatchObject({ latestQuantity: -5, occurrenceCount: 3 });
  });

  it('14. keeps negative stock and exceptions isolated by store', async () => {
    const storeB = await prisma.location.create({ data: { name: 'Store B', address: '1 B St', city: 'B', state: 'TS', zipCode: '22222', phone: '555-0002', email: 'b@store.test', taxRate: 0, isActive: true } });
    const managerB = await prisma.user.create({ data: { email: 'b@test.com', password: 'x', firstName: 'B', lastName: 'Manager', role: 'MANAGER', locationId: storeB.id } });
    const productB = await prisma.product.create({ data: { name: 'Test Product', sku: 'TEST-SKU-001', price: 2.49, cost: 1.5, stockQuantity: 12, locationId: storeB.id } });
    await opening(0, 0);
    await sell(2).expect(201);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productB.id } })).stockQuantity).toBe(12);
    const tokenB = await createTestToken(managerB.id, 'MANAGER');
    const exception = (await openException())!;
    expect(exception.locationId).toBe(data.location.id);
    await get('/api/inventory-exceptions/' + exception.id, tokenB).expect(404);
    expect((await get('/api/inventory-exceptions', tokenB).expect(200)).body.data).toHaveLength(0);
    // A cashier may not resolve exceptions.
    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await post(`/api/inventory-exceptions/${exception.id}/resolve`, { resolution: 'NO_CHANGE_NEEDED' }, cashier).expect(403);
  });

  it('15. a new supplier price updates the average without rewriting earlier sales', async () => {
    await opening(10, 15); // $1.50 each
    const sale = (await sell(3).expect(201)).body.data;
    await receive(10, 1.7);
    const value = await balance();
    expect(value.quantity).toBe(17); expect(Number(value.value)).toBe(27.5); // 7 x 1.50 + 10 x 1.70
    const line = await prisma.saleItem.findUniqueOrThrow({ where: { id: sale.items[0].id } });
    expect(Number(line.costAmount)).toBe(4.5); expect(line.costStatus).toBe('VERIFIED');
  });

  it('16. receiving 24 into -3 leaves 21 and trues up the estimated cost in the current period', async () => {
    await opening(0, 0);
    await sell(3).expect(201); // estimated at $1.50 (catalog cost)
    expect(Number((await balance()).value)).toBe(-4.5);
    await receive(24, 1.6);
    const value = await balance();
    expect((await product()).stockQuantity).toBe(21);
    expect(value.quantity).toBe(21); expect(Number(value.value)).toBe(33.6); // 21 x $1.60, never rebuilt from a negative base
    const receipt = await prisma.inventoryValueEntry.findFirstOrThrow({ where: { productId: data.product.id, kind: 'PURCHASE' } });
    expect(Number(receipt.cogsAmount)).toBe(0.3); // 3 shortfall units x ($1.60 - $1.50)
    const metrics = await getFinancialMetrics({ locationId: data.location.id });
    expect(metrics.inventoryCostAdjustments).toBe(0.3);
    expect(metrics.costOfGoodsSold).toBe(4.8);
    expect(metrics.receivedInventoryPurchases).toBe(38.4);
  });

  it('posts a changed receipt cost in the current period and keeps earlier periods unchanged', async () => {
    await opening(0, 0);
    await receive(10, 1.5);
    const sale = (await sell(4).expect(201)).body.data;
    const receipt = await prisma.inventoryValueEntry.findFirstOrThrow({ where: { productId: data.product.id, kind: 'PURCHASE' } });
    const body = { entryId: receipt.id, value: 16, reason: 'Corrected supplier invoice: ten units at $1.60' };
    const preview = (await post('/api/financial/inventory-costs/corrections/preview', body).expect(200)).body.data;
    expect(preview.recognition).toBe('CURRENT_PERIOD');
    await post('/api/financial/inventory-costs/corrections', { ...body, token: preview.token, idempotencyKey: randomUUID() }).expect(200);
    const correction = await prisma.inventoryValueEntry.findFirstOrThrow({ where: { productId: data.product.id, kind: 'COST_CORRECTION' } });
    expect(Number(correction.cogsAmount)).toBe(0.4); // 4 sold units x $0.10
    expect(Number(correction.valueChange)).toBe(0); // the on-hand share lives in the revised balance
    expect(Number((await balance()).value)).toBe(9.6); // 6 on-hand units x $1.60
    // P&L periods read booked costs; valuation reads the corrected facts.
    const entryId = (await prisma.saleItem.findUniqueOrThrow({ where: { id: sale.items[0].id } })).inventoryEntryId;
    const [reported] = await prisma.$queryRaw<{ cogsAmount: string }[]>`SELECT "cogsAmount" FROM reported_inventory_values WHERE id = ${entryId}`;
    const [valuation] = await prisma.$queryRaw<{ cogsAmount: string }[]>`SELECT "cogsAmount" FROM effective_inventory_values WHERE id = ${entryId}`;
    expect(Number(reported.cogsAmount)).toBe(6); expect(Number(valuation.cogsAmount)).toBe(6.4);
    const before = new Date(correction.createdAt.getTime() - 1);
    expect((await getFinancialMetrics({ locationId: data.location.id }, { lte: before })).costOfGoodsSold).toBe(6);
    expect((await getFinancialMetrics({ locationId: data.location.id })).costOfGoodsSold).toBe(6.4);
  });

  describe('valueMovement math', () => {
    const d = (n: number) => decimal(n);
    it('values a shortfall at the provisional unit cost and a negative position at its own unit cost', () => {
      const crossing = valueMovement({ quantity: 2, value: d(3) }, { quantity: -3, mode: 'AVERAGE', kind: 'SALE', provisionalUnitCost: d(1.5) });
      expect(crossing).toMatchObject({ quantity: -1, costStatus: 'ESTIMATED' });
      expect(crossing.value!.toNumber()).toBe(-1.5); expect(crossing.cogs!.toNumber()).toBe(4.5);
      const deeper = valueMovement({ quantity: -1, value: d(-1.5) }, { quantity: -2, mode: 'AVERAGE', kind: 'SALE', provisionalUnitCost: d(99) });
      expect(deeper.value!.toNumber()).toBe(-4.5); expect(deeper.cogs!.toNumber()).toBe(3);
    });
    it('partially fills a negative position and keeps the remaining shortfall at its provisional cost', () => {
      const partial = valueMovement({ quantity: -10, value: d(-15) }, { quantity: 4, mode: 'FIXED', kind: 'PURCHASE', inputValue: d(8) });
      expect(partial.quantity).toBe(-6); expect(partial.value!.toNumber()).toBe(-9); expect(partial.cogs!.toNumber()).toBe(2);
    });
    it('recognizes the full actual cost when the shortfall had no cost at all', () => {
      const unknown = valueMovement({ quantity: -2, value: null }, { quantity: 5, mode: 'FIXED', kind: 'PURCHASE', inputValue: d(10) });
      expect(unknown.value!.toNumber()).toBe(6); expect(unknown.cogs!.toNumber()).toBe(4);
    });
    it('still refuses returns or corrections that would take a specific receipt below zero', () => {
      expect(() => valueMovement({ quantity: 1, value: d(1) }, { quantity: -2, mode: 'REFERENCE', kind: 'SUPPLIER_RETURN', inputValue: d(-2) })).toThrow();
    });
  });
});
