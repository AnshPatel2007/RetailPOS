import fs from 'fs';
import path from 'path';
import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { invoiceDirectory } from '../../services/deliveryInvoice.service';
import { normalizeInvoiceText } from '../../services/invoiceMatching.service';
import { invoicesToConfirm, AttentionContext } from '../../services/attention.service';
import { numeric } from '../../utils/money';

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const pdf = Buffer.from('%PDF-1.7\n%test\n');

const reading = (extra: object = {}) => ({
  pages: [{ vendor: 'TEST SUPPLIER INC', invoiceNumber: 'INV-77', invoiceDate: '2026-11-14', total: 100, tax: 0, fees: 2, lines: [
    { description: 'TEST PRODUCT', upc: '1234567890', quantity: 2, unit: 'CASE', unitsPerCase: 12, unitPrice: 24, lineTotal: 48 },
    { description: 'ACME COLA 12OZ CAN', quantity: 1, unit: 'CASE', unitsPerCase: 24, unitPrice: 12, lineTotal: 12 },
    { description: 'MYSTERY SNACK 3OZ', quantity: 6, unit: 'EACH', unitPrice: 1, lineTotal: 6 },
    { description: 'RETURN TEST PRODUCT', quantity: -1, unit: 'EACH', unitPrice: 2, lineTotal: -2 },
  ] }],
  ...extra,
});

describe('Delivery invoices: sending and reviewing', () => {
  let data: TestData, admin: string, cashier: string, acme: { id: string };
  const send = (auth: string, testReading: object | null = reading(), files: { bytes: Buffer; name: string; type: string }[] = [{ bytes: jpeg, name: 'page1.jpg', type: 'image/jpeg' }]) => {
    let call = request(app).post('/api/delivery-invoices').set('Authorization', 'Bearer ' + auth);
    for (const file of files) call = call.attach('pages', file.bytes, { filename: file.name, contentType: file.type });
    return testReading ? call.field('testReading', JSON.stringify(testReading)) : call;
  };
  const get = (url: string, auth = admin) => request(app).get('/api/delivery-invoices' + url).set('Authorization', 'Bearer ' + auth);
  const patch = (id: string, body: object, auth = admin) => request(app).patch('/api/delivery-invoices/' + id).set('Authorization', 'Bearer ' + auth).send(body);
  const post = (url: string, body: object = {}, auth = admin) => request(app).post('/api/delivery-invoices' + url).set('Authorization', 'Bearer ' + auth).send(body);

  // Never call the real AI service from tests: readings are prepared (testReading).
  const savedKey = process.env.ANTHROPIC_API_KEY;
  beforeAll(() => { delete process.env.ANTHROPIC_API_KEY; });
  beforeEach(async () => {
    data = await seedTestData();
    admin = await createTestToken(data.adminUser.id, 'ADMIN');
    cashier = await createTestToken(data.cashierUser.id, 'CASHIER');
    acme = await prisma.product.create({ data: { sku: 'ACME-12', name: 'Acme Cola 12 oz Can', price: 1.25, cost: 0.45, stockQuantity: 10, locationId: data.location.id } });
  });
  afterAll(() => {
    fs.rmSync(invoiceDirectory, { recursive: true, force: true });
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it('a cashier sends an invoice; the owner sees every line matched, sure first by barcode', async () => {
    const sent = await send(cashier).expect(201);
    // The person who sent it sees the status, not the costs.
    expect(sent.body.data).toMatchObject({ status: 'READY', vendorName: 'TEST SUPPLIER INC', invoiceNumber: 'INV-77', lineCount: 4, pageCount: 1 });
    expect(sent.body.data.lines).toBeUndefined();
    const id = sent.body.data.id;

    const invoice = (await get('/' + id).expect(200)).body.data;
    expect(invoice.supplier).toEqual({ id: data.supplier.id, name: 'Test Supplier' });
    expect(invoice.lines.map((line: { tier: string }) => line.tier)).toEqual(['SURE', 'CHECK', 'NEW', 'CREDIT']);
    expect(invoice.lines[0]).toMatchObject({ reason: 'Barcode 1234567890', product: { productId: data.product.id }, confirmed: true,
      unitsPerCase: 12, unitsSource: 'PRINTED', units: 24, unitCost: 2, current: { cost: 10, price: 19.99, stockQuantity: 100 }, costChange: -80 });
    expect(invoice.lines[1]).toMatchObject({ reason: 'The closest name', product: { productId: acme.id }, confirmed: false, units: 24, unitCost: 0.5 });
    expect(invoice.lines[2]).toMatchObject({ product: null, confirmed: false, units: 6, suggestion: { name: 'Mystery Snack 3 oz', categoryId: null } });
    expect(invoice.lines[3]).toMatchObject({ skip: true, confirmed: true, units: 0 });
    expect(invoice.counts).toMatchObject({ sure: 1, check: 1, new: 1, credit: 1, waiting: 2, skipped: 1, units: 54 });
    expect(invoice.warnings).toEqual([{ code: 'TOTALS_DIFFER', message: 'The lines do not add up to the invoice total', amount: 34 }]);

    // The photo is kept and only people who may see the invoice get it.
    const photo = await get(`/${id}/pages/1`).buffer(true).parse((res, done) => { const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => done(null, Buffer.concat(chunks))); }).expect(200);
    expect(photo.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.compare(photo.body, jpeg)).toBe(0);
    const otherCashier = await prisma.user.create({ data: { email: 'second-cashier@test.com', password: data.cashierUser.password, firstName: 'Second', lastName: 'Cashier', role: 'CASHIER', locationId: data.location.id } });
    const second = await createTestToken(otherCashier.id, 'CASHIER');
    await get('/' + id, second).expect(404);
    await get(`/${id}/pages/1`, second).expect(404);
    await get('/' + id, cashier).expect(200);
    expect((await get('', second).expect(200)).body.data).toEqual([]);
    expect((await get('', cashier).expect(200)).body.data.map((row: { id: string }) => row.id)).toEqual([id]);
    expect((await get('').expect(200)).body.data[0]).toMatchObject({ id, status: 'READY', createdBy: { id: data.cashierUser.id, name: 'Cashier User' }, counts: { waiting: 2 } });

    // Only owners and managers decide.
    await patch(id, { version: invoice.version, lines: [{ index: 1, confirmed: true }] }, cashier).expect(403);
  });

  it('another store never sees it, and the platform preview cannot send one', async () => {
    const id = (await send(cashier).expect(201)).body.data.id;
    const other = await prisma.location.create({ data: { name: 'Other', address: 'x', city: 'x', state: 'TS', zipCode: '1', phone: '1', email: 'other@test.com' } });
    const otherOwner = await prisma.user.create({ data: { email: 'other-owner@test.com', password: data.adminUser.password, firstName: 'O', lastName: 'O', role: 'ADMIN', locationId: other.id } });
    const otherToken = await createTestToken(otherOwner.id, 'ADMIN');
    await get('/' + id, otherToken).expect(404);
    await get(`/${id}/pages/1`, otherToken).expect(404);
    await patch(id, { version: 2, lines: [] }, otherToken).expect(404);
    await post(`/${id}/discard`, {}, otherToken).expect(404);
    expect((await get('', otherToken).expect(200)).body.data).toEqual([]);
    const platform = await prisma.user.create({ data: { email: 'platform@test.com', password: data.adminUser.password, firstName: 'P', lastName: 'A', role: 'SUPER_ADMIN' } });
    const preview = await send(await createTestToken(platform.id, 'SUPER_ADMIN')).expect(403);
    expect(preview.body.error).toBe('Store preview is read-only');
  });

  it('refuses files that are not invoice photos or a PDF', async () => {
    expect((await send(cashier, reading(), []).expect(400)).body.error).toContain('Take a photo of the invoice');
    expect((await send(cashier, reading(), [{ bytes: Buffer.from('<html>hi</html>'), name: 'page.jpg', type: 'image/jpeg' }]).expect(400)).body.error).toContain('JPEG, PNG');
    expect((await send(cashier, reading(), [{ bytes: pdf, name: 'a.pdf', type: 'application/pdf' }, { bytes: jpeg, name: 'b.jpg', type: 'image/jpeg' }]).expect(400)).body.error).toContain('PDF on its own');
    const six = Array.from({ length: 6 }, (_, i) => ({ bytes: jpeg, name: `p${i}.jpg`, type: 'image/jpeg' }));
    expect((await send(cashier, reading(), six).expect(400)).body.error).toContain('up to 5 photos');
    expect(await prisma.deliveryInvoice.count()).toBe(0);
    // Without the AI key (and no prepared reading) nothing is kept.
    expect((await send(cashier, null).expect(503)).body.error).toContain('not set up');
    expect(await prisma.deliveryInvoice.count()).toBe(0);
  });

  it('the owner confirms, adds a new item and skips, with a version check on every change', async () => {
    const id = (await send(cashier).expect(201)).body.data.id;
    const start = (await get('/' + id).expect(200)).body.data;
    await patch(id, { version: start.version + 5, lines: [{ index: 1, confirmed: true }] }).expect(409);
    expect((await patch(id, { version: start.version, lines: [{ index: 2, confirmed: true }] }).expect(400)).body.error).toContain('choose the item, add it as new, or skip it');

    const newItem = { name: 'Mystery Snack 3 oz', price: 1.99, categoryId: data.category.id, barcode: null, minimumAge: null, ebtEligible: true, isTaxable: false };
    const decided = (await patch(id, { version: start.version, lines: [{ index: 1, confirmed: true }, { index: 2, newItem }] }).expect(200)).body.data;
    expect(decided.version).toBe(start.version + 1);
    expect(decided.lines[1]).toMatchObject({ confirmed: true, touched: true, product: { productId: acme.id } });
    expect(decided.lines[2]).toMatchObject({ confirmed: true, product: null, newItem });
    expect(decided.counts.waiting).toBe(0);

    // A new item without a price still waits; an item from another store is refused.
    const unpriced = (await patch(id, { version: decided.version, lines: [{ index: 2, newItem: { ...newItem, price: null } }] }).expect(200)).body.data;
    expect(unpriced.lines[2].confirmed).toBe(false);
    const other = await prisma.location.create({ data: { name: 'Other', address: 'x', city: 'x', state: 'TS', zipCode: '1', phone: '1', email: 'other@test.com' } });
    const foreign = await prisma.product.create({ data: { sku: 'FOREIGN', name: 'Foreign', price: 1, cost: 1, locationId: other.id } });
    await patch(id, { version: unpriced.version, lines: [{ index: 2, product: { productId: foreign.id } }] }).expect(400);
    await patch(id, { version: unpriced.version, lines: [{ index: 2, newItem: { ...newItem, categoryId: '00000000-0000-4000-8000-000000000000' } }] }).expect(400);

    // Changing the case size and the quantity received; skipping a line.
    const changed = (await patch(id, { version: unpriced.version, lines: [{ index: 0, unitsPerCase: 6, receivedQuantity: 3 }, { index: 2, skip: true }] }).expect(200)).body.data;
    expect(changed.lines[0]).toMatchObject({ unitsPerCase: 6, unitsSource: 'SET', receivedQuantity: 3, units: 18, unitCost: 4, confirmed: true });
    expect(changed.lines[2]).toMatchObject({ skip: true, confirmed: true });
    expect(changed.counts).toMatchObject({ waiting: 0, skipped: 2, units: 42 });
    // Header details can be corrected.
    const header = (await patch(id, { version: changed.version, invoiceNumber: 'INV-78', invoiceDate: '2026-11-13', total: 66 }).expect(200)).body.data;
    expect(header).toMatchObject({ invoiceNumber: 'INV-78', invoiceDate: '2026-11-13', total: 66 });
  });

  it('a different supplier brings its confirmed matches; lines a person decided stay as they are', async () => {
    const id = (await send(cashier).expect(201)).body.data.id;
    const start = (await get('/' + id).expect(200)).body.data;
    const coke = await prisma.supplier.create({ data: { name: 'Coke Bottlers', locationId: data.location.id } });
    await prisma.invoiceItemMatch.create({ data: { locationId: data.location.id, supplierId: coke.id, normalizedText: normalizeInvoiceText('ACME COLA 12OZ CAN'), productId: acme.id, unitsPerCase: 24 } });
    await prisma.invoiceItemMatch.create({ data: { locationId: data.location.id, supplierId: coke.id, normalizedText: normalizeInvoiceText('MYSTERY SNACK 3OZ'), productId: acme.id } });
    const touched = (await patch(id, { version: start.version, lines: [{ index: 2, skip: true }] }).expect(200)).body.data;
    const moved = (await patch(id, { version: touched.version, supplierId: coke.id }).expect(200)).body.data;
    expect(moved.supplier).toEqual({ id: coke.id, name: 'Coke Bottlers' });
    expect(moved.lines[1]).toMatchObject({ tier: 'SURE', reason: 'You confirmed this item on an earlier invoice', confirmed: true, unitsPerCase: 24, units: 24 });
    expect(moved.lines[2]).toMatchObject({ tier: 'NEW', skip: true });
    // Barcode matches do not depend on the supplier.
    expect(moved.lines[0]).toMatchObject({ tier: 'SURE', product: { productId: data.product.id } });
    await patch(id, { version: moved.version, supplierId: '00000000-0000-4000-8000-000000000000' }).expect(400);
  });

  it('suggestions picked by AI are to check, never sure, and new items get a name, category and age', async () => {
    const picks = [
      { line: 1, candidate: 1, confidence: 'high', name: 'Acme Cola 12 oz Can', category: '', minimumAge: 0 },
      { line: 2, candidate: 0, confidence: 'low', name: 'Mystery Snack Chips 3 oz', category: 'test category', minimumAge: 21 },
    ];
    const id = (await send(cashier, reading({ picks })).expect(201)).body.data.id;
    const invoice = (await get('/' + id).expect(200)).body.data;
    expect(invoice.lines[1]).toMatchObject({ tier: 'CHECK', reason: 'Looks like this item', confirmed: false, product: { productId: acme.id } });
    expect(invoice.lines[2]).toMatchObject({ tier: 'NEW', suggestion: { name: 'Mystery Snack Chips 3 oz', categoryId: data.category.id, minimumAge: 21 } });
  });

  it('a failed read is kept to read again; a read that stopped counts as failed', async () => {
    const failed = (await send(cashier, { fail: 'Photo 1 is too blurry to read.' }).expect(201)).body.data;
    expect(failed).toMatchObject({ status: 'FAILED', error: 'Photo 1 is too blurry to read.' });
    const again = (await post(`/${failed.id}/read`, { testReading: reading() }, cashier).expect(200)).body.data;
    expect(again).toMatchObject({ status: 'READY', lineCount: 4, error: null });
    // A ready invoice is read again only by an owner or manager.
    await post(`/${failed.id}/read`, { testReading: reading() }, cashier).expect(403);
    expect((await post(`/${failed.id}/read`, { testReading: reading() }).expect(200)).body.data.status).toBe('READY');

    await prisma.deliveryInvoice.update({ where: { id: failed.id }, data: { status: 'READING' } });
    await prisma.$executeRaw`UPDATE delivery_invoices SET "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '10 minutes' WHERE id = ${failed.id}`;
    expect((await get('/' + failed.id).expect(200)).body.data).toMatchObject({ status: 'FAILED', error: 'Reading stopped before it finished. Read it again.' });
    expect((await post(`/${failed.id}/read`, { testReading: reading() }).expect(200)).body.data.status).toBe('READY');
  });

  it('warns about an invoice already received from the supplier, and a second photo of it', async () => {
    const order = await prisma.purchaseOrder.create({ data: { orderNumber: 'INV-9001', supplierId: data.supplier.id, locationId: data.location.id, status: 'RECEIVED' } });
    await prisma.purchaseReceipt.create({ data: { purchaseOrderId: order.id, idempotencyKey: 'k', requestHash: 'h', receivedBy: data.adminUser.id, invoiceNumber: 'inv-77' } });
    const first = (await send(cashier).expect(201)).body.data.id;
    const second = (await send(cashier).expect(201)).body.data.id;
    const codes = (await get('/' + second).expect(200)).body.data.warnings.map((warning: { code: string }) => warning.code);
    expect(codes).toEqual(['ALREADY_RECEIVED', 'ANOTHER_COPY', 'TOTALS_DIFFER']);
    expect((await get('/' + first).expect(200)).body.data.warnings.map((warning: { code: string }) => warning.code)).toContain('ANOTHER_COPY');
  });

  it('discarding deletes the photos; the sender may discard their own until it is received', async () => {
    const sent = (await send(cashier).expect(201)).body.data;
    const files = (await prisma.deliveryInvoicePage.findMany({ where: { invoiceId: sent.id } })).map(page => path.join(invoiceDirectory, page.filename));
    expect(files.every(file => fs.existsSync(file))).toBe(true);
    const otherCashier = await prisma.user.create({ data: { email: 'second-cashier@test.com', password: data.cashierUser.password, firstName: 'Second', lastName: 'Cashier', role: 'CASHIER', locationId: data.location.id } });
    await post(`/${sent.id}/discard`, {}, await createTestToken(otherCashier.id, 'CASHIER')).expect(404);
    expect((await post(`/${sent.id}/discard`, {}, cashier).expect(200)).body.data.status).toBe('DISCARDED');
    expect(files.some(file => fs.existsSync(file))).toBe(false);
    expect(await prisma.deliveryInvoicePage.count({ where: { invoiceId: sent.id } })).toBe(0);
    expect(await prisma.activityLog.count({ where: { entityId: sent.id, action: 'INVOICE_DISCARDED' } })).toBe(1);
    await get(`/${sent.id}/pages/1`).expect(404);
    await patch(sent.id, { version: 99, lines: [] }).expect(409);
    expect((await get('').expect(200)).body.data).toEqual([]);
    expect((await get('?status=discarded').expect(200)).body.data.map((row: { id: string }) => row.id)).toEqual([sent.id]);
  });

  const newItem = { name: 'Mystery Snack 3 oz', price: 1.99, categoryId: 'test-category-1', barcode: null, minimumAge: null, ebtEligible: true, isTaxable: false };
  const decideAll = async (id: string) => {
    const start = (await get('/' + id).expect(200)).body.data;
    return (await patch(id, { version: start.version, lines: [{ index: 1, confirmed: true }, { index: 2, newItem }] }).expect(200)).body.data;
  };
  const stock = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).stockQuantity;
  const invoiceNumbered = (invoiceNumber: string) => reading({ pages: [{ ...reading().pages[0], invoiceNumber }] });

  it('the OK receives stock and costs once, and remembers every line for the next invoice', async () => {
    const id = (await send(cashier).expect(201)).body.data.id;
    const start = (await get('/' + id).expect(200)).body.data;
    expect((await post(`/${id}/receive`, { version: start.version }).expect(400)).body.error).toBe('Line 2: choose the item, add it as new, or skip it (and 1 more)');
    await post(`/${id}/receive`, { version: start.version }, cashier).expect(403);
    const decided = await decideAll(id);
    await post(`/${id}/receive`, { version: decided.version - 1 }).expect(409);
    const received = (await post(`/${id}/receive`, { version: decided.version }).expect(200)).body.data;
    expect(received).toMatchObject({ status: 'RECEIVED', replayed: false, receivedBy: { id: data.adminUser.id } });
    expect(received.purchaseOrderId).toBeTruthy();
    expect(received.purchaseReceiptId).toBeTruthy();

    expect(await stock(data.product.id)).toBe(124);
    expect(await stock(acme.id)).toBe(34);
    const created = await prisma.product.findFirstOrThrow({ where: { locationId: data.location.id, name: 'Mystery Snack 3 oz' } });
    expect(numeric(created)).toMatchObject({ stockQuantity: 6, price: 1.99, categoryId: data.category.id, ebtEligible: true, isTaxable: false, minimumAge: null });
    expect(created.sku).toMatch(/^ITEM-\d+$/);

    const receipt = await prisma.purchaseReceipt.findUniqueOrThrow({ where: { id: received.purchaseReceiptId }, include: { items: { include: { purchaseOrderItem: true } }, purchaseOrder: true } });
    expect(receipt).toMatchObject({ invoiceNumber: 'INV-77', purchaseOrder: { supplierId: data.supplier.id } });
    expect(Number(receipt.freight)).toBe(2);
    const byProduct = new Map(receipt.items.map(item => [item.purchaseOrderItem.productId, item]));
    expect(byProduct.get(data.product.id)).toMatchObject({ acceptedQty: 24, packSize: 12 });
    expect(Number(byProduct.get(data.product.id)!.previousUnitCost)).toBe(10);
    expect(byProduct.get(acme.id)).toMatchObject({ acceptedQty: 24, packSize: 24 });

    // Remembered: each line of this supplier, and its case size and case cost.
    const learned = await prisma.invoiceItemMatch.findMany({ where: { supplierId: data.supplier.id }, orderBy: { normalizedText: 'asc' } });
    expect(learned.map(row => [row.normalizedText, row.productId, row.unitsPerCase])).toEqual([
      ['acme cola 12oz can', acme.id, 24], ['mystery snack 3oz', created.id, null], ['test product', data.product.id, 12]]);
    expect(numeric(await prisma.productSupplier.findUniqueOrThrow({ where: { productId_supplierId: { productId: acme.id, supplierId: data.supplier.id } } })))
      .toMatchObject({ packSize: 24, packCost: 12, cost: 0.5 });

    // Pressing OK again changes nothing; a received invoice stays as it is.
    expect((await post(`/${id}/receive`, { version: decided.version }).expect(200)).body.data).toMatchObject({ status: 'RECEIVED', replayed: true });
    expect(await stock(data.product.id)).toBe(124);
    await post(`/${id}/discard`).expect(409);
    await patch(id, { version: received.version, lines: [] }).expect(409);
    expect(await prisma.activityLog.count({ where: { entityId: id, action: 'INVOICE_RECEIVED' } })).toBe(1);
    // The order it became shows its photos.
    expect((await get(`?purchaseOrderId=${received.purchaseOrderId}`).expect(200)).body.data).toMatchObject([{ id, status: 'RECEIVED', pageCount: 1 }]);
    expect((await get(`/${id}`).expect(200)).body.data).toMatchObject({ categories: [{ id: data.category.id, name: 'Test Category' }], costAlertPercent: 3, warnings: [] });

    // The next invoice from this supplier is all sure: one tap.
    const next = (await send(cashier, invoiceNumbered('INV-78')).expect(201)).body.data.id;
    const second = (await get('/' + next).expect(200)).body.data;
    expect(second.lines.map((line: { tier: string }) => line.tier)).toEqual(['SURE', 'SURE', 'SURE', 'CREDIT']);
    expect(second.lines[2]).toMatchObject({ product: { productId: created.id }, reason: 'You confirmed this item on an earlier invoice' });
    expect(second.counts.waiting).toBe(0);
    await post(`/${next}/receive`, { version: second.version }).expect(200);
    expect(await stock(created.id)).toBe(12);
    expect((await prisma.invoiceItemMatch.findFirstOrThrow({ where: { supplierId: data.supplier.id, productId: created.id } })).confirmations).toBe(2);
  });

  it('a retry after a lost answer finishes the same receipt; a try that was never applied is thrown away', async () => {
    const id = (await send(cashier).expect(201)).body.data.id;
    const decided = await decideAll(id);
    const done = (await post(`/${id}/receive`, { version: decided.version }).expect(200)).body.data;
    const importId = (await prisma.deliveryInvoice.findUniqueOrThrow({ where: { id } })).importId;
    // Applied, but the server stopped before marking the invoice received.
    await prisma.deliveryInvoice.update({ where: { id }, data: { status: 'READY', version: decided.version, purchaseOrderId: null, purchaseReceiptId: null, receivedAt: null, receivedById: null } });
    await prisma.invoiceItemMatch.deleteMany();
    expect((await patch(id, { version: decided.version, invoiceNumber: 'CHANGED' }).expect(409)).body.error).toContain('Press Receive again to finish it');
    const again = (await post(`/${id}/receive`, { version: decided.version }).expect(200)).body.data;
    expect(again).toMatchObject({ status: 'RECEIVED', purchaseReceiptId: done.purchaseReceiptId, purchaseOrderId: done.purchaseOrderId, invoiceNumber: 'INV-77' });
    expect((await prisma.deliveryInvoice.findUniqueOrThrow({ where: { id } })).importId).toBe(importId);
    expect(await stock(data.product.id)).toBe(124);
    expect(await prisma.purchaseReceipt.count()).toBe(1);
    expect(await prisma.invoiceItemMatch.count()).toBe(3);

    // Reviewed but never applied: changing the invoice or pressing OK throws it away first.
    const other = (await send(cashier, invoiceNumbered('INV-79')).expect(201)).body.data.id;
    const ready = (await get('/' + other).expect(200)).body.data;
    const leftover = async () => (await request(app).post('/api/products/imports/receipt/preview').set('Authorization', 'Bearer ' + admin)
      .send({ supplier: 'Test Supplier', items: [{ matchedProductId: data.product.id, name: 'Test Product', unitQuantity: 5, unitCost: 2 }] }).expect(200)).body.data.id as string;
    const first = await leftover();
    await prisma.deliveryInvoice.update({ where: { id: other }, data: { importId: first } });
    const changed = (await patch(other, { version: ready.version, invoiceNumber: 'INV-79' }).expect(200)).body.data;
    expect(await prisma.inventoryImport.findUnique({ where: { id: first } })).toBeNull();
    const second = await leftover();
    await prisma.deliveryInvoice.update({ where: { id: other }, data: { importId: second } });
    await post(`/${other}/receive`, { version: changed.version }).expect(200);
    expect(await prisma.inventoryImport.findUnique({ where: { id: second } })).toBeNull();
    expect(await stock(data.product.id)).toBe(148);
  });

  it('an invoice number already received from the supplier is refused, and can still be discarded', async () => {
    const first = (await send(cashier).expect(201)).body.data.id;
    const second = (await send(cashier).expect(201)).body.data.id;
    await post(`/${first}/receive`, { version: (await decideAll(first)).version }).expect(200);
    const blocked = await post(`/${second}/receive`, { version: (await decideAll(second)).version }).expect(409);
    expect(blocked.body.error).toContain('already received');
    expect(await stock(data.product.id)).toBe(124);
    expect(await prisma.product.count({ where: { name: 'Mystery Snack 3 oz' } })).toBe(1);
    expect((await post(`/${second}/discard`).expect(200)).body.data.status).toBe('DISCARDED');
  });

  it('the alert lists invoices waiting for an OK and opens the oldest', async () => {
    const context = (now = new Date()) => ({ locationId: data.location.id, now } as AttentionContext);
    expect(await invoicesToConfirm(context())).toBeNull();
    const first = (await send(cashier).expect(201)).body.data.id;
    expect(await invoicesToConfirm(context())).toEqual({ key: 'invoices-to-confirm', severity: 'medium', count: 1, amount: 100,
      href: `/inventory/purchasing/receive?invoice=${first}`, sentence: '1 delivery invoice is waiting for your OK (TEST SUPPLIER INC, $100.00).' });
    await send(cashier, { fail: 'Too blurry.' }).expect(201);
    // Still being read: not waiting for anyone yet.
    await prisma.deliveryInvoice.create({ data: { locationId: data.location.id, createdById: data.cashierUser.id, status: 'READING' } });
    expect(await invoicesToConfirm(context())).toMatchObject({ count: 2, amount: 100, href: `/inventory/purchasing/receive?invoice=${first}`,
      sentence: '2 delivery invoices are waiting for your OK (TEST SUPPLIER INC). 1 could not be read.' });
    // Two days on, the oldest is urgent and the read that never finished counts as failed.
    expect(await invoicesToConfirm(context(new Date(Date.now() + 2 * 86400000 + 60000)))).toMatchObject({ severity: 'high', count: 3,
      sentence: '3 delivery invoices are waiting for your OK (TEST SUPPLIER INC). 2 could not be read.' });
    await post(`/${first}/receive`, { version: (await decideAll(first)).version }).expect(200);
    expect(await invoicesToConfirm(context())).toMatchObject({ count: 1, sentence: '1 delivery invoice is waiting for your OK. It could not be read.' });
  });
});
