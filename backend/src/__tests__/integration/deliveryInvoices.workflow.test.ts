import fs from 'fs';
import path from 'path';
import request from 'supertest';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';
import { invoiceDirectory } from '../../services/deliveryInvoice.service';
import { normalizeInvoiceText } from '../../services/invoiceMatching.service';

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
});
