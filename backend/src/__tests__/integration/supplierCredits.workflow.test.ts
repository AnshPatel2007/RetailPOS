import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { costsWentUp, supplierCreditsOutstanding, AttentionContext } from '../../services/attention.service';

describe('Cost changes at receiving and supplier credits', () => {
  let data: TestData;
  let owner: string;
  beforeEach(async () => {
    data = await seedTestData(); owner = await createTestToken(data.adminUser.id, 'ADMIN');
  });
  const as = (token: string) => ({
    get: (path: string) => request(app).get(path).set('Authorization', 'Bearer ' + token),
    post: (path: string, body: object = {}) => request(app).post(path).set('Authorization', 'Bearer ' + token).send(body),
    put: (path: string, body: object = {}) => request(app).put(path).set('Authorization', 'Bearer ' + token).send(body),
  });
  const api = () => as(owner);
  // Product: price $19.99, cost $10.00. Ten ordered at $10.00.
  const order = () => prisma.purchaseOrder.create({ data: {
    orderNumber: 'PO-' + randomUUID(), supplierId: data.supplier.id, locationId: data.location.id, status: 'ORDERED', totalAmount: 100,
    items: { create: { productId: data.product.id, productName: data.product.name, sku: data.product.sku, quantity: 10, cost: 10, total: 100 } },
  }, include: { items: true } });
  const delivery = (itemId: string, extra: object = {}) => ({ idempotencyKey: randomUUID(), notes: 'Two crushed, one wrong flavor',
    receivedItems: [{ purchaseOrderItemId: itemId, quantity: 7, damagedQty: 2, rejectedQty: 1, unitCost: 10.5 }], ...extra });
  const receive = (orderId: string, itemId: string, extra: object = {}) => api().post('/api/purchase-orders/' + orderId + '/receive', delivery(itemId, extra));
  const context = (now = new Date()) => ({ locationId: data.location.id, now } as AttentionContext);

  it('records the cost before each delivery and a credit for damaged and rejected goods the invoice charged for', async () => {
    const po = await order();
    const payload = delivery(po.items[0].id, { invoiceNumber: 'INV-1' });
    const received = (await api().post('/api/purchase-orders/' + po.id + '/receive', payload).expect(200)).body.data;
    const line = await prisma.purchaseReceiptItem.findFirstOrThrow({ where: { receiptId: received.receipt.id } });
    expect(Number(line.previousUnitCost)).toBe(10);
    expect(Number(line.unitCost)).toBe(10.5);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: data.product.id } })).cost)).toBe(10.5);
    const credits = await prisma.supplierCredit.findMany({ where: { receiptId: received.receipt.id }, orderBy: { reason: 'asc' } });
    expect(credits.map(credit => [credit.reason, Number(credit.amount), credit.status, credit.supplierId])).toEqual([
      ['DAMAGED', 21, 'OPEN', data.supplier.id], ['REJECTED', 10.5, 'OPEN', data.supplier.id]]);
    expect(credits[0].notes).toBe('2 × ' + data.product.name);

    // A retry of the same receipt adds nothing.
    expect((await api().post('/api/purchase-orders/' + po.id + '/receive', payload).expect(200)).body.data.replayed).toBe(true);
    expect(await prisma.supplierCredit.count()).toBe(2);
  });

  it('creates no credit when the invoice did not charge for the problems, or there is no invoice', async () => {
    let po = await order();
    await receive(po.id, po.items[0].id, { invoiceNumber: 'INV-2', supplierBilledForProblems: false }).expect(200);
    po = await order();
    await receive(po.id, po.items[0].id).expect(200);
    expect(await prisma.supplierCredit.count()).toBe(0);
    // Without an invoice number the person can still say the delivery note charged for them.
    po = await order();
    await receive(po.id, po.items[0].id, { supplierBilledForProblems: true }).expect(200);
    expect(await prisma.supplierCredit.count()).toBe(2);
  });

  it('flags a cost rise in the receipt review with the margin and a suggested price, and stores the previous cost', async () => {
    await prisma.priceRule.create({ data: { locationId: data.location.id, scope: 'STORE', scopeId: '', targetMargin: 0.5, rounding: 'CENT' } });
    const items = [{ matchedProductId: data.product.id, name: data.product.name, unitQuantity: 5, unitCost: 10.5 }];
    const preview = (await api().post('/api/products/imports/receipt/preview', { supplier: 'Test Supplier', invoiceNumber: 'INV-3', items }).expect(200)).body.data;
    expect(preview.costAlertPercent).toBe(3);
    expect(preview.rows[0].costReview).toEqual({ name: data.product.name, previousUnitCost: 10, unitCost: 10.5, percentChange: 5, price: 19.99,
      margin: 0.4747, targetMargin: 0.5, suggestedPrice: 21, flagged: true });

    // The owner sets a higher alert: 5% is no longer flagged. An unchanged cost has no review.
    await api().put('/api/locations/my-settings', { purchasing: { costChangeAlertPercent: 10 } }).expect(200);
    const relaxed = (await api().post('/api/products/imports/receipt/preview', { supplier: 'Test Supplier', items }).expect(200)).body.data;
    expect(relaxed.costAlertPercent).toBe(10);
    expect(relaxed.rows[0].costReview.flagged).toBe(false);
    const same = (await api().post('/api/products/imports/receipt/preview', { supplier: 'Test Supplier', items: [{ ...items[0], unitCost: 10 }] }).expect(200)).body.data;
    expect(same.rows[0].costReview).toBeNull();

    await api().post('/api/products/imports/' + preview.id + '/apply').expect(200);
    const line = await prisma.purchaseReceiptItem.findFirstOrThrow({ where: { receipt: { invoiceNumber: 'INV-3' } } });
    expect(Number(line.previousUnitCost)).toBe(10);
    // The attention rule uses the same store setting.
    expect(await costsWentUp(context())).toBeNull();
    await api().put('/api/locations/my-settings', { purchasing: { costChangeAlertPercent: 3 } }).expect(200);
    expect((await costsWentUp(context()))?.sentence).toBe(`${data.product.name} cost 5% more on a delivery this week. Check its price.`);
    expect(await costsWentUp(context(new Date(Date.now() + 8 * 86400000)))).toBeNull();
  });

  it('lists, records and settles credits once, for this store only', async () => {
    const other = await prisma.location.create({ data: { id: 'credits-other-store', name: 'Other Store', address: '1', city: 'C', state: 'TS', zipCode: '1', phone: '1', email: 'other@store.com' } });
    const elsewhere = await prisma.supplier.create({ data: { name: 'Elsewhere Supplier', locationId: other.id } });
    const foreign = await prisma.supplierCredit.create({ data: { locationId: other.id, supplierId: elsewhere.id, reason: 'OTHER', amount: 99, notes: 'Not ours', createdById: data.adminUser.id } });

    await api().post('/api/suppliers/credits', { supplierId: data.supplier.id, reason: 'OTHER', amount: 5 }).expect(400); // Other needs a note
    await api().post('/api/suppliers/credits', { supplierId: elsewhere.id, reason: 'SHORT', amount: 5 }).expect(404);
    const short = (await api().post('/api/suppliers/credits', { supplierId: data.supplier.id, reason: 'SHORT', amount: 12.345, notes: 'Two cases missing' }).expect(201)).body.data;
    expect(short).toMatchObject({ reason: 'SHORT', amount: 12.35, status: 'OPEN', supplier: { name: 'Test Supplier' } });
    await prisma.supplierCredit.create({ data: { locationId: data.location.id, supplierId: data.supplier.id, reason: 'PRICE', amount: 20,
      createdById: data.adminUser.id, createdAt: new Date(Date.now() - 40 * 86400000) } });

    const listed = (await api().get('/api/suppliers/credits').expect(200)).body.data;
    expect(listed.credits.map((credit: { reason: string }) => credit.reason)).toEqual(['SHORT', 'PRICE']);
    expect(listed.summary).toEqual({ openCount: 2, openAmount: 32.35, olderThan30Amount: 20 });
    expect(await supplierCreditsOutstanding(context())).toMatchObject({ severity: 'medium', amount: 32.35, count: 2,
      sentence: 'Suppliers owe you $32.35 in 2 credits; $20.00 of it is more than 30 days old.' });

    const cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    await as(cashier).get('/api/suppliers/credits').expect(403);
    await as(cashier).post('/api/suppliers/credits/' + short.id + '/settle', { status: 'RECEIVED' }).expect(403);
    await api().post('/api/suppliers/credits/' + foreign.id + '/settle', { status: 'RECEIVED' }).expect(404);
    const settled = (await api().post('/api/suppliers/credits/' + short.id + '/settle', { status: 'RECEIVED', notes: 'Credit note CN-7' }).expect(200)).body.data;
    expect(settled).toMatchObject({ status: 'RECEIVED', notes: 'Two cases missing\nCredit note CN-7', settledById: data.adminUser.id });
    await api().post('/api/suppliers/credits/' + short.id + '/settle', { status: 'WRITTEN_OFF' }).expect(409);
    expect((await api().get('/api/suppliers/credits?status=settled').expect(200)).body.data.credits.map((credit: { id: string }) => credit.id)).toEqual([short.id]);
    expect(await prisma.activityLog.count({ where: { action: { in: ['SUPPLIER_CREDIT_CREATED', 'SUPPLIER_CREDIT_SETTLED'] }, locationId: data.location.id } })).toBe(2);

    // A supplier with credits on record is deactivated, not deleted.
    await api().post('/api/suppliers/credits/' + listed.credits[1].id + '/settle', { status: 'WRITTEN_OFF' }).expect(200);
    expect(await supplierCreditsOutstanding(context())).toBeNull();
    await request(app).delete('/api/suppliers/' + data.supplier.id).set('Authorization', 'Bearer ' + owner).expect(400);
  });

  it('a supplier return owes its credit to the supplier the goods came from; supplier history shows cost changes and fill rate', async () => {
    const po = await order();
    await receive(po.id, po.items[0].id, { invoiceNumber: 'INV-4', supplierBilledForProblems: false }).expect(200);
    const receipt = await prisma.inventoryValueEntry.findFirstOrThrow({ where: { kind: 'PURCHASE', productId: data.product.id } });
    const body = { receiptEntryId: receipt.id, quantity: 2, creditAmount: 21, reason: 'Expired on arrival', idempotencyKey: randomUUID() };
    await api().post('/api/financial/inventory-costs/supplier-returns', body).expect(200);
    await api().post('/api/financial/inventory-costs/supplier-returns', body).expect(200); // a retry
    const credits = await prisma.supplierCredit.findMany();
    expect(credits.map(credit => [credit.reason, Number(credit.amount), credit.supplierId, credit.status])).toEqual([['RETURN', 21, data.supplier.id, 'OPEN']]);
    expect(credits[0].notes).toBe(`Returned 2 × ${data.product.name}: Expired on arrival`);

    const performance = (await api().get('/api/suppliers/' + data.supplier.id + '/performance').expect(200)).body.data;
    expect(performance.fillRate).toBe(70); // 7 accepted of 10 ordered on the closed order
    expect(performance.costChanges).toEqual([expect.objectContaining({ productId: data.product.id, previousUnitCost: 10, unitCost: 10.5, percentChange: 5, invoiceNumber: 'INV-4' })]);
  });
});
