/**
 * Manufacturer scan data and the store's own days (upgrade plan, WP 8.3).
 *
 * The export lists one store's items sold, returned and voided on the store's own
 * days, a pack by its own barcode; and the sales and shift lists read a date as the
 * store's day, never the server's.
 */
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData, TestData } from './setup';
import { createTestToken } from './helpers';

describe('scan data export and store-day date filters', () => {
  let data: TestData, owner: string;
  // America/Chicago in November is UTC-6.
  const local = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 10, day, hour + 6, minute));
  const exportCsv = (query: Record<string, string>, token = owner) =>
    request(app).get('/api/reports/scan-data/export/csv').query(query).set('Authorization', 'Bearer ' + token);
  const rows = (csv: string) => csv.trim().split('\r\n').map(line => line.slice(1, -1).split('","'));

  const sell = (createdAt: Date, lines: { productId: string; sku: string; name: string; quantity: number; price: number; discount?: number; tax: number; sellingUnitId?: string; unitsPerPackage?: number; promotionName?: string }[], status: 'COMPLETED' | 'VOIDED' = 'COMPLETED', locationId = data.location.id) =>
    prisma.sale.create({ include: { items: true }, data: {
      saleNumber: 'S-' + randomUUID().slice(0, 12), locationId, userId: data.adminUser.id, createdAt, status, paymentMethod: 'CASH', pricingVersion: 1,
      subtotal: lines.reduce((sum, line) => sum + line.price * line.quantity, 0), tax: lines.reduce((sum, line) => sum + line.tax, 0),
      total: lines.reduce((sum, line) => sum + line.price * line.quantity - (line.discount ?? 0) + line.tax, 0), amountPaid: 500,
      items: { create: lines.map(line => ({ productId: line.productId, sku: line.sku, productName: line.name, quantity: line.quantity, price: line.price,
        discount: line.discount ?? 0, tax: line.tax, total: Math.round((line.price * line.quantity - (line.discount ?? 0) + line.tax) * 100) / 100,
        sellingUnitId: line.sellingUnitId ?? null, unitsPerPackage: line.unitsPerPackage ?? 1, promotionName: line.promotionName ?? null,
        promotionDiscount: line.promotionName ? line.discount ?? 0 : 0 })) },
    } });

  beforeEach(async () => {
    data = await seedTestData();
    owner = await createTestToken(data.adminUser.id, 'ADMIN');
    await prisma.location.update({ where: { id: data.location.id }, data: { timezone: 'America/Chicago' } });
    await prisma.product.update({ where: { id: data.product.id }, data: { barcode: '012345678905', categoryId: data.category.id } });
  });

  it('lists the store\'s sales, returns and voids of the chosen categories on the store\'s own days', async () => {
    const carton = await prisma.productSellingUnit.create({ data: { productId: data.product.id, locationId: data.location.id, name: 'Carton', barcode: '012345678912', unitsPerPackage: 10, price: 80 } });
    const single = { productId: data.product.id, sku: data.product.sku, name: 'Smokes single' };
    // 8:30 PM on Nov 9 in the store: already Nov 10 on a UTC server.
    const evening = await sell(local(9, 20, 30), [
      { ...single, quantity: 2, price: 10, discount: 1, tax: 1.9, promotionName: 'Two-pack deal' },
      { ...single, name: 'Smokes carton', quantity: 1, price: 80, tax: 8, sellingUnitId: carton.id, unitsPerPackage: 10 },
    ]);
    const afternoon = await sell(local(9, 14), [{ ...single, quantity: 1, price: 10, tax: 1 }], 'VOIDED');
    // One of the two singles comes back at 9 PM; the afternoon sale is voided at 10 PM.
    const singleLine = evening.items.find(item => !item.sellingUnitId)!;
    await prisma.refund.create({ data: { saleId: evening.id, amount: 10.45, taxAmount: 0.95, reason: 'Returned', refundedBy: data.adminUser.id, createdAt: local(9, 21),
      items: { create: { saleItemId: singleLine.id, quantity: 1, amount: 10.45, taxAmount: 0.95 } } } });
    await prisma.saleVoid.create({ data: { saleId: afternoon.id, locationId: data.location.id, userId: data.adminUser.id, reason: 'Rang twice', amount: 11, taxAmount: 1,
      discount: 0, items: [], tenders: { CASH: 11 }, requestHash: 'test', createdAt: local(9, 22) } });
    // Neither another category nor another store is exported.
    const other = await prisma.category.create({ data: { name: 'Snacks', locationId: data.location.id } });
    const chips = await prisma.product.create({ data: { name: 'Chips', sku: 'CHIPS', price: 2, locationId: data.location.id, categoryId: other.id } });
    await sell(local(9, 15), [{ productId: chips.id, sku: 'CHIPS', name: 'Chips', quantity: 1, price: 2, tax: 0.2 }]);
    const elsewhere = await prisma.location.create({ data: { name: 'Other Store', address: '2 Road', city: 'City', state: 'TX', zipCode: '75001', phone: '555', email: 'other@test.com' } });
    const theirs = await prisma.product.create({ data: { name: 'Their smokes', sku: 'THEIRS', price: 10, locationId: elsewhere.id, categoryId: data.category.id } });
    await sell(local(9, 16), [{ productId: theirs.id, sku: 'THEIRS', name: 'Their smokes', quantity: 1, price: 10, tax: 1 }], 'COMPLETED', elsewhere.id);

    const response = await exportCsv({ startDate: '2026-11-09', endDate: '2026-11-09', categoryIds: data.category.id }).expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    const [header, ...lines] = rows(response.text);
    expect(header).toEqual(['Transaction Date', 'Transaction Time', 'Store ID', 'Store Name', 'Transaction ID', 'Type', 'UPC', 'Units Per Pack', 'SKU',
      'Item Description', 'Category', 'Quantity', 'Unit Price', 'Total Discount', 'Promotion Flag', 'Promotion Name', 'Final Price', 'Tax']);
    const pick = (line: string[]) => [line[0], line[1], line[4] === evening.saleNumber ? 'evening' : 'afternoon', line[5], line[6], line[7], line[11], line[12], line[13], line[14], line[16], line[17]];
    // Oldest first; two lines of one sale may come in either order.
    const byTimeAndCode = (a: string[], b: string[]) => (a[1] + a[4]).localeCompare(b[1] + b[4]);
    expect(lines.map(pick).sort(byTimeAndCode)).toEqual([
      ['2026-11-09', '14:00:00', 'afternoon', 'Sale', '012345678905', '1', '1', '10.00', '0.00', 'N', '10.00', '1.00'],
      ['2026-11-09', '20:30:00', 'evening', 'Sale', '012345678905', '1', '2', '10.00', '1.00', 'Y', '19.00', '1.90'],
      ['2026-11-09', '20:30:00', 'evening', 'Sale', '012345678912', '10', '1', '80.00', '0.00', 'N', '80.00', '8.00'],
      ['2026-11-09', '21:00:00', 'evening', 'Return', '012345678905', '1', '-1', '10.00', '-0.50', 'Y', '-9.50', '-0.95'],
      ['2026-11-09', '22:00:00', 'afternoon', 'Void', '012345678905', '1', '-1', '10.00', '0.00', 'N', '-10.00', '-1.00'],
    ]);
    expect(lines.map(line => line[1])).toEqual(['14:00:00', '20:30:00', '20:30:00', '21:00:00', '22:00:00']);
    expect(lines.every(line => line[2] === data.location.id && line[3] === 'Test Store' && line[10] === 'Test Category')).toBe(true);

    // The next store day starts at midnight in the store: nothing of the above is in it.
    expect(rows((await exportCsv({ startDate: '2026-11-10', endDate: '2026-11-10', categoryIds: data.category.id }).expect(200)).text)).toHaveLength(1);
  });

  it('needs one store, the days and a category', async () => {
    await exportCsv({ startDate: '2026-11-09', endDate: '2026-11-09' }).expect(400);
    await exportCsv({ startDate: '2026-11-09', categoryIds: data.category.id }).expect(400);
    await exportCsv({ startDate: '2026-11-09', endDate: 'Nov 9', categoryIds: data.category.id }).expect(400);
    const platform = await prisma.user.create({ data: { email: 'platform@test.com', password: data.adminUser.password, firstName: 'Platform', lastName: 'Admin', role: 'SUPER_ADMIN' } });
    const platformToken = await createTestToken(platform.id, 'SUPER_ADMIN');
    const all = await exportCsv({ startDate: '2026-11-09', endDate: '2026-11-09', categoryIds: data.category.id }, platformToken).expect(400);
    expect(all.body.error).toBe('Choose a store to export its scan data');
    // Previewing a store exports that store.
    await exportCsv({ startDate: '2026-11-09', endDate: '2026-11-09', categoryIds: data.category.id, locationId: data.location.id }, platformToken).expect(200);
  });

  it('reads the sales and shift lists\' dates as the store\'s days', async () => {
    const sale = await sell(local(9, 20, 30), [{ productId: data.product.id, sku: data.product.sku, name: 'Test', quantity: 1, price: 10, tax: 1 }]);
    await prisma.shift.create({ data: { userId: data.adminUser.id, locationId: data.location.id, clockInAt: local(9, 19), clockOutAt: local(9, 23), isClosed: true } });
    const list = async (path: string, day: string) => (await request(app).get('/api' + path).query({ startDate: day, endDate: day })
      .set('Authorization', 'Bearer ' + owner).expect(200)).body.data as { id: string }[];
    expect((await list('/sales', '2026-11-09')).map(row => row.id)).toEqual([sale.id]);
    expect(await list('/sales', '2026-11-10')).toEqual([]);
    expect(await list('/shifts', '2026-11-09')).toHaveLength(1);
    expect(await list('/shifts', '2026-11-10')).toHaveLength(0);
    await request(app).get('/api/sales').query({ startDate: '2026-11-10', endDate: '2026-11-09' }).set('Authorization', 'Bearer ' + owner).expect(400);
  });
});
