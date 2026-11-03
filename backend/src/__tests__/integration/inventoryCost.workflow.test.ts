import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { getFinancialMetrics } from '../../services/financialMetrics.service';
import { decimal, valueMovement } from '../../services/inventoryCost.service';
import { allocateReceiptCosts } from '../../services/receiptCost.service';
import { moveInventory } from '../../services/inventory.service';
import { inventoryReconciliation } from '../../services/inventoryCostReport.service';
import appPrisma from '../../config/database';

describe('Verified inventory valuation and P&L', () => {
  let data: TestData, owner: string;
  const post = (path: string, body: object) => request(app).post(path).set('Authorization', 'Bearer ' + owner).send(body);
  const get = (path: string) => request(app).get(path).set('Authorization', 'Bearer ' + owner);
  beforeEach(async () => {
    data = await seedTestData(); owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, clockInAt: new Date() } });
    await prisma.product.update({ where: { id: data.product.id }, data: { price: 15, isTaxable: false } });
  });
  const opening = async (quantity = 10, value = 80) => {
    const product = await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } });
    return post('/api/financial/inventory-costs/opening', { idempotencyKey: randomUUID(), notes: 'Verified physical count and supplier invoice',
      items: [{ productId: product.id, quantity, value, expectedVersion: product.stockVersion }] }).expect(200);
  };
  const receive = async (quantity = 10, cost = 10, extra = {}) => {
    const order = await prisma.purchaseOrder.create({ data: { orderNumber: 'PO-' + randomUUID(), supplierId: data.supplier.id, locationId: data.location.id,
      status: 'ORDERED', items: { create: { productId: data.product.id, sku: data.product.sku, productName: data.product.name, quantity, cost, total: quantity * cost } } }, include: { items: true } });
    return post('/api/purchase-orders/' + order.id + '/receive', { idempotencyKey: randomUUID(), receivedItems: [{ purchaseOrderItemId: order.items[0].id, quantity, unitCost: cost }], ...extra }).expect(200);
  };
  const sell = (quantity = 3) => post('/api/sales', { items: [{ productId: data.product.id, quantity, price: 15 }], paymentMethod: 'CASH', amountPaid: quantity * 15, idempotencyKey: randomUUID() }).expect(201);
  const balance = () => prisma.inventoryValuation.findUniqueOrThrow({ where: { productId: data.product.id } });

  it.each(['UTC', 'America/Chicago', 'Asia/Tokyo'])('values the complete store day with a %s database session', async databaseTimezone => {
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
    const evening = new Date('2026-10-25T00:30:00Z'); // October 24, 7:30 pm at the store.
    const nextMidnight = new Date('2026-10-25T05:00:00Z');
    await prisma.product.update({ where: { id: data.product.id }, data: { createdAt: evening, stockQuantity: 10 } });
    await prisma.product.create({ data: { name: 'Next day product', sku: randomUUID(), price: 10, cost: 9,
      stockQuantity: 0, locationId: data.location.id, createdAt: nextMidnight } });
    for (const [createdAt, value] of [[evening, 80], [nextMidnight, 90]] as const) {
      await prisma.inventoryValueEntry.create({ data: { productId: data.product.id, locationId: data.location.id, userId: data.adminUser.id,
        kind: 'OPENING', mode: 'OPENING', sourceId: randomUUID(), sourceKey: randomUUID(), quantity: 10,
        quantityBefore: 0, quantityAfter: 10, inputValue: value, valueBefore: 0, valueChange: value, valueAfter: value,
        cogsAmount: 0, createdAt, effectiveAt: createdAt } });
    }
    // Change only this request's transaction; never alter the database's timezone.
    const transact = appPrisma.$transaction.bind(appPrisma);
    const transactionSpy = jest.spyOn(appPrisma, '$transaction').mockImplementation((async (callback: any, options: any) =>
      transact(async tx => {
        await tx.$queryRaw`SELECT set_config('TimeZone', ${databaseTimezone}, true)`;
        return callback(tx);
      }, options)) as typeof appPrisma.$transaction);
    try {
      const before = (await get('/api/financial/inventory-costs/valuation?date=2026-10-23').expect(200)).body.data;
      expect(before.products).toEqual([]); expect(before.pagination.total).toBe(0);
      const statement = (await get('/api/financial/inventory-costs/valuation?date=2026-10-24').expect(200)).body.data;
      expect(statement.products).toHaveLength(1); expect(statement.pagination.total).toBe(1);
      expect(statement.products[0].id).toBe(data.product.id);
      expect(Number(statement.products[0].value)).toBe(80);
      expect(Number(statement.products[0].averageCost)).toBe(8);
      const next = (await get('/api/financial/inventory-costs/valuation?date=2026-10-25').expect(200)).body.data;
      expect(next.products).toHaveLength(2); expect(next.pagination.total).toBe(2);
      expect(Number(next.products.find((product: { id: string }) => product.id === data.product.id).value)).toBe(90);
    } finally { transactionSpy.mockRestore(); }
  });

  it('reports received purchases separately from overlapping expense entries across analytics, P&L and Excel', async () => {
    await prisma.product.update({ where: { id: data.product.id }, data: { stockQuantity: 0 } });
    const empty = (await get('/api/financial/inventory-costs/balances').expect(200)).body.data.products.find((p: { id: string }) => p.id === data.product.id);
    expect(empty).toMatchObject({ quantity: 0, value: 0, averageCost: null, openingConfirmed: false });
    await opening(0, 0);
    await receive(10, 10, { freight: 10, invoiceDiscount: 5, acquisitionTax: 2, invoiceDate: '2025-01-01T12:00:00Z' });
    const receipt = await prisma.purchaseReceipt.findFirstOrThrow();
    expect(await prisma.expense.count()).toBe(0);
    expect((await get('/api/analytics/business-health').expect(200)).body.data.profitability).toMatchObject({
      receivedInventoryPurchases: 107, inventoryPurchases: 0, expenses: 0, costOfGoodsSold: 0, netProfit: 0,
    });
    await prisma.expense.create({ data: { expenseNumber: randomUUID(), category: 'INVENTORY_PURCHASE', amount: 107, status: 'PAID',
      description: 'Payment for the same delivery', inventoryReceiptId: receipt.id, locationId: data.location.id, userId: data.adminUser.id } });
    await prisma.expense.create({ data: { expenseNumber: randomUUID(), category: 'OTHER', amount: 2, status: 'PAID',
      description: 'Operating expense', locationId: data.location.id, userId: data.adminUser.id } });
    await prisma.historicalIncome.create({ data: { locationId: data.location.id, sourceKey: randomUUID(), period: new Date().toISOString().slice(0, 7),
      kind: 'LOTTERY_COMMISSION', amount: 7, recognizedAt: new Date(), notes: 'Verified commission' } });
    await sell(3);
    const health = (await get('/api/analytics/business-health').expect(200)).body.data.profitability;
    expect(health).toMatchObject({ receivedInventoryPurchases: 107, inventoryPurchases: 107, expenses: 2, otherIncome: 7,
      costOfGoodsSold: 32.1, grossProfit: 12.9, netProfit: 17.9 });
    expect(health.netProfit).toBeCloseTo(health.grossProfit - health.expenses + health.otherIncome, 2);
    const pnl = (await get('/api/financial/reports/pnl?workbook=true').expect(200)).body.data;
    expect(pnl).toMatchObject({ receivedInventoryPurchases: 107, inventoryPurchases: 107, costOfGoodsSold: 32.1, otherIncome: 7,
      netIncome: 17.9, operatingExpenses: { total: 2 } });
    const month = pnl.workbook.months.find((m: { metrics: { receivedInventoryPurchases: number } }) => m.metrics.receivedInventoryPurchases > 0);
    expect(month.metrics).toMatchObject({ receivedInventoryPurchases: 107, inventoryPurchases: 107, costOfGoodsSold: 32.1, netProfit: 17.9 });
    expect(month.reconciliation.movements.find((m: { kind: string }) => m.kind === 'PURCHASE').value).toBe(107);
    expect(month.reconciliation.closing.value).toBe(74.9);
    expect((await get('/api/reports/overall').expect(200)).body.data.profitability).toMatchObject({
      receivedInventoryPurchases: 107, totalExpenses: 2, costOfGoodsSold: 32.1, otherIncome: 7, netProfit: 17.9,
    });
  });

  it('uses the weighted average and preserves saved sale costs after supplier price edits', async () => {
    await opening(); await receive();
    const sale = (await sell()).body.data;
    expect(Number(sale.items[0].costAmount)).toBe(27);
    expect(Number((await balance()).value)).toBe(153);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } });
    await request(app).put('/api/products/' + product.id).set('Authorization', 'Bearer ' + owner)
      .send({ cost: 1000, stockQuantity: product.stockQuantity, expectedStockVersion: product.stockVersion }).expect(200);
    expect(Number((await balance()).value)).toBe(153);
    await request(app).put('/api/products/' + product.id).set('Authorization', 'Bearer ' + owner).send({ trackInventory: false }).expect(409);
    await request(app).delete('/api/products/' + product.id).set('Authorization', 'Bearer ' + owner).expect(409);
    let metrics = await getFinancialMetrics({ locationId: data.location.id });
    expect(metrics).toMatchObject({ costOfGoodsSold: 27, grossProfit: 18, grossMargin: 40 });
    await prisma.product.update({ where: { id: data.product.id }, data: { cost: 999 } });
    metrics = await getFinancialMetrics({ locationId: data.location.id });
    expect(metrics.costOfGoodsSold).toBe(27);
    expect(Number((await balance()).value)).toBe(153);
    const pnl = await get('/api/financial/reports/pnl?workbook=true').expect(200);
    expect(pnl.body.data).toMatchObject({ costOfGoodsSold: 27, estimate: null, defaultCostView: 'recorded' });
    expect(pnl.body.data.workbook.months.at(-1).metrics.costOfGoodsSold).toBe(27);
  });

  it('does not wash unknown opening costs with a priced delivery and still permits checkout', async () => {
    await receive(); const sale = (await sell()).body.data;
    expect(sale.items[0].costAmount).toBeNull(); expect((await balance()).value).toBeNull();
    const metrics = await getFinancialMetrics({ locationId: data.location.id });
    expect(metrics.costOfGoodsSold).toBeNull(); expect(metrics.grossProfit).toBeNull(); expect(metrics.netSales).toBe(45);
    expect(metrics.costCompleteness.label).toBe('Cost information incomplete');
  });

  it('distinguishes verified free goods from unknown costs and consumes the final rounding remainder', async () => {
    await opening(10, 0); const sale = (await sell()).body.data;
    expect(Number(sale.items[0].costAmount)).toBe(0);
    expect((await getFinancialMetrics({ locationId: data.location.id })).grossProfit).toBe(45);
    let state = { quantity: 3, value: decimal(1) as ReturnType<typeof decimal> | null };
    let total = decimal(0);
    for (let i = 0; i < 3; i++) { const next = valueMovement(state, { quantity: -1, mode: 'AVERAGE', kind: 'SALE' }); total = total.minus(next.change!); state = next; }
    expect(total.toString()).toBe('1'); expect(state.value?.toString()).toBe('0');
  });

  it('allocates invoice charges and discounts deterministically and converts cases', async () => {
    const costs = allocateReceiptCosts([{ id: 'a', quantity: 10, unitCost: 80, packSize: 10 }, { id: 'b', quantity: 10, unitCost: 100, packSize: 10 }], { freight: 0.01, invoiceDiscount: 20, acquisitionTax: 1 });
    expect(costs.map(c => c.unitCost.toNumber())).toEqual([8, 10]);
    expect(costs.reduce((sum, c) => sum.plus(c.inventoryValue), decimal(0)).toNumber()).toBe(161.01);
    expect(costs.map(c => c.allocatedCharges.toString())).toEqual(['-8.44', '-10.55']);
  });

  it('previews and audits receipt corrections without editing booked sale lines', async () => {
    await opening(); await receive(); const sale = (await sell()).body.data;
    const receipt = await prisma.inventoryValueEntry.findFirstOrThrow({ where: { productId: data.product.id, kind: 'PURCHASE' } });
    const body = { entryId: receipt.id, value: 120, reason: 'Corrected supplier invoice: ten units at twelve dollars' };
    const preview = (await post('/api/financial/inventory-costs/corrections/preview', body).expect(200)).body.data;
    expect(preview.changes.some((row: { kind: string; cogsAmount: string }) => row.kind === 'SALE' && Number(row.cogsAmount) === 30)).toBe(true);
    const confirmed = { ...body, token: preview.token, idempotencyKey: randomUUID() };
    await post('/api/financial/inventory-costs/corrections', confirmed).expect(200);
    await post('/api/financial/inventory-costs/corrections', confirmed).expect(200);
    expect(Number((await balance()).value)).toBe(170);
    expect(Number((await prisma.saleItem.findUniqueOrThrow({ where: { id: sale.items[0].id } })).costAmount)).toBe(27);
    expect((await getFinancialMetrics({ locationId: data.location.id })).costOfGoodsSold).toBe(30);
    expect(await prisma.inventoryCostCorrection.count()).toBe(1);
    await expect(prisma.inventoryValueEntry.update({ where: { id: receipt.id }, data: { valueChange: 1 } })).rejects.toThrow();
  });

  it('removes supplier returns at current carrying cost and separately records credit differences', async () => {
    await opening(); await receive();
    const receipt = await prisma.inventoryValueEntry.findFirstOrThrow({ where: { kind: 'PURCHASE' } });
    const body = { receiptEntryId: receipt.id, quantity: 2, creditAmount: 20, reason: 'Supplier accepted unopened cases', idempotencyKey: randomUUID() };
    const returned = (await post('/api/financial/inventory-costs/supplier-returns', body).expect(200)).body.data;
    expect(Number(returned.carryingValue)).toBe(18); expect(Number(returned.costAdjustment)).toBe(-2);
    await post('/api/financial/inventory-costs/supplier-returns', body).expect(200);
    expect(Number((await balance()).value)).toBe(162);
    expect((await getFinancialMetrics({ locationId: data.location.id })).inventoryCostAdjustments).toBe(-2);
  });

  it('keeps cost approval owner-only and rejects stale opening review', async () => {
    const token = await createTestToken(data.cashierUser.id, 'CASHIER');
    await request(app).get('/api/financial/inventory-costs/balances').set('Authorization', 'Bearer ' + token).expect(403);
    await request(app).get('/api/financial/inventory-costs/opening-review').set('Authorization', 'Bearer ' + token).expect(403);
    await request(app).post('/api/financial/inventory-costs/opening').set('Authorization', 'Bearer ' + token).send({}).expect(403);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } });
    await sell(1);
    await post('/api/financial/inventory-costs/opening', { idempotencyKey: randomUUID(), notes: 'Stale opening', items: [{ productId: product.id, quantity: 100, value: 800, expectedVersion: product.stockVersion }] }).expect(409);
  });

  it('reviews opening costs across pages, excludes known values and confirms a group atomically', async () => {
    const prefix = 'Bulk opening ' + randomUUID();
    const additions = Array.from({ length: 55 }, (_, index) => ({ id: randomUUID(), name: `${prefix} ${String(index).padStart(2, '0')}`,
      sku: randomUUID(), price: 15, cost: 8, stockQuantity: 10, locationId: data.location.id }));
    await prisma.product.createMany({ data: additions });
    await prisma.product.update({ where: { id: additions[0].id }, data: { stockQuantity: 0 } });
    await prisma.inventoryValuation.create({ data: { productId: additions[1].id, locationId: data.location.id, quantity: 10, value: 80 } });
    const confirmed = await prisma.product.findUniqueOrThrow({ where: { id: additions[2].id } });
    await post('/api/financial/inventory-costs/opening', { idempotencyKey: randomUUID(), notes: 'Previously reviewed count sheet',
      items: [{ productId: confirmed.id, quantity: 10, value: 80, expectedVersion: confirmed.stockVersion }] }).expect(200);
    const review = (await get('/api/financial/inventory-costs/opening-review?search=' + encodeURIComponent(prefix)).expect(200)).body.data;
    expect(review.total).toBe(52); expect(review.products).toHaveLength(52);
    for (const excluded of additions.slice(0, 3)) expect(review.products.map((row: { id: string }) => row.id)).not.toContain(excluded.id);
    const rows = review.products.slice(0, 2);
    const payload = { idempotencyKey: randomUUID(), notes: 'Verified multi-product count sheet', items: rows.map((row: { id: string; stockVersion: number }) => ({
      productId: row.id, quantity: 10, value: 80, expectedVersion: row.stockVersion })) };
    // One stale line must reject the entire group, including the preceding valid line.
    await prisma.product.update({ where: { id: rows[1].id }, data: { stockQuantity: 9 } });
    await post('/api/financial/inventory-costs/opening', payload).expect(409);
    expect(await prisma.inventoryValueEntry.count({ where: { sourceId: payload.idempotencyKey } })).toBe(0);
    const fresh = await prisma.product.findUniqueOrThrow({ where: { id: rows[1].id } });
    payload.items[1] = { ...payload.items[1], quantity: 9, value: 72, expectedVersion: fresh.stockVersion };
    const first = await post('/api/financial/inventory-costs/opening', payload).expect(200);
    expect(first.body.data.confirmed).toBe(2);
    const replay = await post('/api/financial/inventory-costs/opening', payload).expect(200);
    expect(replay.body.data).toEqual(first.body.data);
    expect(await prisma.inventoryValueEntry.count({ where: { sourceId: payload.idempotencyKey, kind: 'OPENING' } })).toBe(2);
    expect((await get('/api/financial/inventory-costs/opening-review?search=' + encodeURIComponent(prefix)).expect(200)).body.data.total).toBe(50);
  });

  it('restores original sale cost after later deliveries and leaves amount-only refunds out of stock', async () => {
    await opening(); await receive(); const sale = (await sell()).body.data;
    await receive(10, 20);
    const before = Number((await balance()).value);
    await post('/api/sales/' + sale.id + '/refund', { amount: 5, reason: 'Price adjustment', restock: true, idempotencyKey: randomUUID() }).expect(200);
    expect(Number((await balance()).value)).toBe(before);
    await post('/api/sales/' + sale.id + '/refund', { items: [{ saleItemId: sale.items[0].id, quantity: 1 }], reason: 'Physical return', restock: true, idempotencyKey: randomUUID() }).expect(200);
    expect(Number((await balance()).value)).toBe(before + 9);
    expect((await getFinancialMetrics({ locationId: data.location.id })).costOfGoodsSold).toBe(18);
  });

  it('classifies unsellable physical returns without deducting their cost twice', async () => {
    await opening(); const sale = (await sell()).body.data;
    await post('/api/sales/' + sale.id + '/refund', { items: [{ saleItemId: sale.items[0].id, quantity: 1 }], reason: 'Broken bottle', restock: false, idempotencyKey: randomUUID() }).expect(200);
    expect((await balance()).quantity).toBe(7);
    expect((await getFinancialMetrics({ locationId: data.location.id })).costOfGoodsSold).toBe(24);
    const loss = await prisma.inventoryValueEntry.findFirstOrThrow({ where: { kind: 'RETURN_LOSS' } });
    expect(Number(loss.inputValue)).toBe(8); expect(Number(loss.cogsAmount)).toBe(0);
  });

  it('values count variances at the recorded average and keeps unverified additions incomplete', async () => {
    await opening();
    const move = (quantity: number, type: string) => prisma.$transaction(tx => moveInventory(tx, { productId: data.product.id, locationId: data.location.id,
      userId: data.adminUser.id, type, quantity, sourceId: randomUUID(), notes: 'Verified physical count' }));
    await move(-2, 'CYCLE_COUNT'); expect(Number((await balance()).value)).toBe(64);
    expect((await getFinancialMetrics({ locationId: data.location.id })).inventoryCostAdjustments).toBe(16);
    await move(1, 'CYCLE_COUNT'); expect(Number((await balance()).value)).toBe(72);
    expect((await getFinancialMetrics({ locationId: data.location.id })).inventoryCostAdjustments).toBe(8);
    await move(1, 'ADJUSTMENT'); expect((await balance()).value).toBeNull();
    expect((await getFinancialMetrics({ locationId: data.location.id })).costOfGoodsSold).toBeNull();
    const addition = await prisma.inventoryValueEntry.findFirstOrThrow({ where: { kind: 'ADJUSTMENT' } });
    const correction = { entryId: addition.id, value: 8, reason: 'Original invoice confirms the added unit cost' };
    const preview = (await post('/api/financial/inventory-costs/corrections/preview', correction).expect(200)).body.data;
    await post('/api/financial/inventory-costs/corrections', { ...correction, token: preview.token, idempotencyKey: randomUUID() }).expect(200);
    expect(Number((await balance()).value)).toBe(80);
    expect((await getFinancialMetrics({ locationId: data.location.id })).costOfGoodsSold).toBe(0);
    expect((await prisma.inventoryValueEntry.findUniqueOrThrow({ where: { id: addition.id } })).inputValue).toBeNull();
  });

  it('rejects stale correction previews after checkout and preserves received plus sold value under concurrency', async () => {
    await opening();
    await Promise.all([receive(), sell()]);
    const metrics = await getFinancialMetrics({ locationId: data.location.id });
    expect(Number((await balance()).value) + metrics.costOfGoodsSold!).toBe(180);
    expect((await balance()).quantity).toBe(17);
    const receipt = await prisma.inventoryValueEntry.findFirstOrThrow({ where: { kind: 'PURCHASE' } });
    const body = { entryId: receipt.id, value: 120, reason: 'Corrected invoice' };
    const preview = (await post('/api/financial/inventory-costs/corrections/preview', body).expect(200)).body.data;
    await sell(1);
    await post('/api/financial/inventory-costs/corrections', { ...body, token: preview.token, idempotencyKey: randomUUID() }).expect(409);
    expect(await prisma.inventoryCostCorrection.count()).toBe(0);
  });

  it('rejects duplicate invoice numbers across new receiving operations', async () => {
    await opening(); await receive(10, 10, { invoiceNumber: 'COST-INV-1' });
    const order = await prisma.purchaseOrder.create({ data: { orderNumber: randomUUID(), supplierId: data.supplier.id, locationId: data.location.id, status: 'ORDERED',
      items: { create: { productId: data.product.id, productName: data.product.name, sku: data.product.sku, quantity: 1, cost: 10, total: 10 } } }, include: { items: true } });
    await post('/api/purchase-orders/' + order.id + '/receive', { idempotencyKey: randomUUID(), invoiceNumber: 'cost-inv-1',
      receivedItems: [{ purchaseOrderItemId: order.items[0].id, quantity: 1 }] }).expect(409);
    expect((await balance()).quantity).toBe(20); expect(await prisma.purchaseReceipt.count()).toBe(1);
  });

  it('carries opening inventory between months and keeps invoice dates separate from receipt recognition', async () => {
    const now = new Date(), start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const prior = new Date(start.getTime() - 86400000);
    await prisma.product.update({ where: { id: data.product.id }, data: { stockQuantity: 10 } });
    const entry = await prisma.inventoryValueEntry.create({ data: { productId: data.product.id, locationId: data.location.id, userId: data.adminUser.id,
      kind: 'OPENING', mode: 'OPENING', sourceId: randomUUID(), sourceKey: randomUUID(), quantity: 10, quantityBefore: 0, quantityAfter: 10,
      inputValue: 80, valueBefore: 0, valueChange: 80, valueAfter: 80, cogsAmount: 0, createdAt: prior, effectiveAt: prior } });
    await prisma.inventoryValuation.create({ data: { productId: data.product.id, locationId: data.location.id, quantity: 10, value: 80, verifiedAt: prior, lastEntryId: entry.id } });
    await receive(10, 10, { invoiceDate: prior.toISOString() }); await sell();
    const report = await inventoryReconciliation(data.location.id, { gte: start, lt: new Date(now.getTime() + 60000) });
    expect(report.opening.value).toBe(80); expect(report.closing.value).toBe(153); expect(report.complete).toBe(true);
    expect(report.movements.find(row => row.kind === 'PURCHASE')?.value).toBe(100);
    expect(report.movements.find(row => row.kind === 'SALE')?.value).toBe(-27);
    expect((await getFinancialMetrics({ locationId: data.location.id }, { gte: start })).costOfGoodsSold).toBe(27);
  });

  it('resolves a nontracked missing cost and its returned portion without changing booked sales', async () => {
    await prisma.product.update({ where: { id: data.product.id }, data: { trackInventory: false, stockQuantity: 0 } });
    const sale = (await sell()).body.data;
    await post('/api/sales/' + sale.id + '/refund', { items: [{ saleItemId: sale.items[0].id, quantity: 1 }], reason: 'Returned item', restock: true, idempotencyKey: randomUUID() }).expect(200);
    const body = { entryId: sale.items[0].inventoryEntryId, value: 24, reason: 'Original supplier invoice verified' };
    const preview = (await post('/api/financial/inventory-costs/corrections/preview', body).expect(200)).body.data;
    await post('/api/financial/inventory-costs/corrections', { ...body, token: preview.token, idempotencyKey: randomUUID() }).expect(200);
    expect((await getFinancialMetrics({ locationId: data.location.id })).costOfGoodsSold).toBe(16);
    expect((await prisma.saleItem.findUniqueOrThrow({ where: { id: sale.items[0].id } })).costAmount).toBeNull();
    expect(await prisma.inventoryValuation.count()).toBe(0);
  });

  it('reports documented stock losses at carrying value after supplier price changes', async () => {
    await opening();
    await prisma.product.update({ where: { id: data.product.id }, data: { cost: 999 } });
    await prisma.$transaction(tx => moveInventory(tx, { productId: data.product.id, locationId: data.location.id, userId: data.adminUser.id,
      quantity: -2, type: 'DAMAGED', costKind: 'STOCK_LOSS', notes: 'Two broken bottles' }));
    const health = (await get('/api/reports/stock-health').expect(200)).body.data;
    expect(health.shrinkage.totals.costValue).toBe(16); expect(health.deadStock.totals.stockValue).toBe(64);
    expect((await getFinancialMetrics({ locationId: data.location.id })).inventoryCostAdjustments).toBe(16);
  });

  it('requires explicit confirmation when a delivery has a zero purchase cost', async () => {
    await opening(0, 0);
    const order = await prisma.purchaseOrder.create({ data: { orderNumber: randomUUID(), supplierId: data.supplier.id, locationId: data.location.id, status: 'ORDERED',
      items: { create: { productId: data.product.id, productName: data.product.name, sku: data.product.sku, quantity: 2, cost: 0, total: 0 } } }, include: { items: true } });
    const line = { purchaseOrderItemId: order.items[0].id, quantity: 2, unitCost: 0 };
    await post('/api/purchase-orders/' + order.id + '/receive', { idempotencyKey: randomUUID(), receivedItems: [line] }).expect(400);
    await post('/api/purchase-orders/' + order.id + '/receive', { idempotencyKey: randomUUID(), receivedItems: [{ ...line, zeroCostConfirmed: true }] }).expect(200);
    expect(Number((await balance()).value)).toBe(0); expect((await balance()).quantity).toBe(2);
  });
});
