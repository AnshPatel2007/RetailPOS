/**
 * Register catalog: the register keeps its own copy of the store's products and
 * refreshes only what changed ("updatedSince"), including items archived since,
 * and can resolve an exact barcode (UPC/EAN forms of one code match) when its
 * copy has no match.
 */
import { prisma, seedTestData, TestData } from './setup';
import { api, loginUser } from './helpers';
import { barcodeKey, barcodeVariants } from '../../utils/barcode';

describe('register catalog sync and barcode lookup', () => {
  let data: TestData;
  let adminToken: string;
  let cashierToken: string;

  const backdate = async () => {
    await prisma.$executeRaw`UPDATE products SET "updatedAt" = now() - interval '1 day'`;
    await prisma.$executeRaw`UPDATE product_selling_units SET "updatedAt" = now() - interval '1 day'`;
  };
  const sync = (token: string, since: Date) => api.get('/api/products').withAuth(token)
    .withQuery({ updatedSince: since.toISOString(), includeSellingUnits: 'true', limit: 100 }).expectSuccess();

  beforeEach(async () => {
    data = await seedTestData();
    adminToken = await loginUser('admin@test.com', 'Admin123!');
    cashierToken = await loginUser('cashier@test.com', 'Admin123!');
  });

  it('treats UPC-A, EAN-13 and GTIN-14 forms of one code as the same item', () => {
    expect(barcodeKey('049000000443')).toBe('00049000000443');
    expect(barcodeKey(' 0049000000443 ')).toBe('00049000000443');
    expect(barcodeVariants('0049000000443')).toEqual(expect.arrayContaining(['049000000443', '0049000000443', '00049000000443']));
    expect(barcodeVariants('12345670')).toEqual(expect.arrayContaining(['12345670', '000012345670', '00000012345670']));
    // A store's own codes match exactly.
    expect(barcodeVariants('ABC-12')).toEqual(['ABC-12']);
    expect(barcodeVariants('123456')).toEqual(['123456']);
    expect(barcodeKey('1234567890')).toBe('1234567890');
  });

  it('returns only products and packs changed since the last sync, including archived ones', async () => {
    const soda = await prisma.product.create({ data: { name: 'Soda Can', sku: 'SODA', barcode: '049000000443', price: 1.5, cost: 0.6, stockQuantity: 24, locationId: data.location.id } });
    const twelve = await prisma.productSellingUnit.create({ data: { productId: soda.id, locationId: data.location.id, name: '12-pack', barcode: '049000028911', price: 12, unitsPerPackage: 12 } });
    const old = await prisma.productSellingUnit.create({ data: { productId: soda.id, locationId: data.location.id, name: '6-pack', barcode: '049000006889', price: 7, unitsPerPackage: 6 } });
    const chips = await prisma.product.create({ data: { name: 'Chips', sku: 'CHIPS', barcode: '028400090858', price: 2, cost: 1, stockQuantity: 10, locationId: data.location.id } });
    const gum = await prisma.product.create({ data: { name: 'Gum', sku: 'GUM', barcode: '022000005120', price: 1, cost: 0.4, stockQuantity: 10, locationId: data.location.id } });
    await backdate();
    const since = new Date(Date.now() - 60_000);

    const quiet = await sync(cashierToken, since);
    expect(quiet.body.data).toEqual([]);
    expect(new Date(quiet.body.serverTime).getTime()).toBeGreaterThan(since.getTime());
    // Active rows: Test Product, Soda, Chips, Gum, and two packs.
    expect(quiet.body.activeTotal).toBe(6);

    await prisma.product.update({ where: { id: chips.id }, data: { price: 2.25 } });
    await prisma.product.update({ where: { id: gum.id }, data: { isActive: false } });
    await prisma.productSellingUnit.update({ where: { id: twelve.id }, data: { price: 12.5 } });
    await prisma.productSellingUnit.update({ where: { id: old.id }, data: { isActive: false } });

    const changed = await sync(cashierToken, since);
    const rows = changed.body.data as { id: string; isActive: boolean; price: number; sellingUnitId: string | null }[];
    const byId = new Map(rows.map(row => [row.id, row]));
    expect([...byId.keys()].sort()).toEqual([chips.id, gum.id, soda.id, twelve.id, old.id].sort());
    expect(byId.get(chips.id)!.price).toBe(2.25);
    expect(byId.get(gum.id)!.isActive).toBe(false);
    expect(byId.get(twelve.id)!.price).toBe(12.5);
    expect(byId.get(twelve.id)!.sellingUnitId).toBe(twelve.id);
    expect(byId.get(old.id)!.isActive).toBe(false);
    expect(byId.has(data.product.id)).toBe(false);
    // Gum and the 6-pack are archived.
    expect(changed.body.activeTotal).toBe(4);

    await api.get('/api/products').withAuth(cashierToken).withQuery({ updatedSince: 'yesterday-ish' }).expectError(400);
  });

  it('never syncs another store\'s products', async () => {
    const other = await prisma.location.create({ data: { id: 'test-location-2', name: 'Other Store', address: '1', city: 'C', state: 'TS', zipCode: '1', phone: '1', email: 'other@store.com' } });
    await prisma.product.create({ data: { name: 'Elsewhere', sku: 'ELSEWHERE', price: 3, locationId: other.id } });
    const res = await sync(cashierToken, new Date(Date.now() - 60_000));
    expect(res.body.data.map((row: { name: string }) => row.name)).not.toContain('Elsewhere');
    expect(res.body.activeTotal).toBe(1);
  });

  it('resolves an exact barcode to a product, a pack or (for managers) a supplier case', async () => {
    const soda = await prisma.product.create({ data: { name: 'Soda Can', sku: 'SODA', barcode: '049000000443', price: 1.5, cost: 0.6, stockQuantity: 24, locationId: data.location.id } });
    const twelve = await prisma.productSellingUnit.create({ data: { productId: soda.id, locationId: data.location.id, name: '12-pack', barcode: '049000028911', price: 12, unitsPerPackage: 12 } });
    await prisma.productSupplier.create({ data: { productId: soda.id, supplierId: data.supplier.id, packSize: 24, packCost: 14.4, cost: 0.6, packBarcode: '10049000000440' } });
    const other = await prisma.location.create({ data: { id: 'test-location-2', name: 'Other Store', address: '1', city: 'C', state: 'TS', zipCode: '1', phone: '1', email: 'other@store.com' } });
    await prisma.product.create({ data: { name: 'Other Soda', sku: 'SODA', barcode: '049000000443', price: 9, locationId: other.id } });

    const resolve = (token: string, code: string) => api.get('/api/products/resolve-barcode').withAuth(token).withQuery({ code }).expectSuccess();

    // A scanner sending the EAN-13 form still finds the UPC-A product.
    const product = await resolve(cashierToken, '0049000000443');
    expect(product.body.data.matches).toHaveLength(1);
    expect(product.body.data.matches[0]).toMatchObject({ kind: 'PRODUCT', product: { id: soda.id, price: 1.5, sellingUnitId: null } });

    const pack = await resolve(cashierToken, '049000028911');
    expect(pack.body.data.matches).toEqual([expect.objectContaining({ kind: 'PACK', product: expect.objectContaining({ id: twelve.id, sellingUnitId: twelve.id, inventoryProductId: soda.id, unitsPerPackage: 12, price: 12 }) })]);

    // Supplier cases are for receiving: managers only.
    expect((await resolve(cashierToken, '10049000000440')).body.data.matches).toEqual([]);
    const supplierCase = await resolve(adminToken, '10049000000440');
    expect(supplierCase.body.data.matches).toEqual([expect.objectContaining({ kind: 'SUPPLIER_CASE',
      product: expect.objectContaining({ id: soda.id }), supplierCase: { supplierId: data.supplier.id, supplierName: 'Test Supplier', packSize: 24, packCost: 14.4 } })]);

    // Receiving links an open stock exception instead of asking for a shelf count (managers only).
    expect(supplierCase.body.data.matches[0].openExceptionId).toBeNull();
    const exception = await prisma.inventoryException.create({ data: { productId: soda.id, locationId: data.location.id, openProductId: soda.id, lowestQuantity: -2, latestQuantity: -2 } });
    expect((await resolve(adminToken, '049000028911')).body.data.matches[0].openExceptionId).toBe(exception.id);
    expect((await resolve(cashierToken, '049000000443')).body.data.matches[0].openExceptionId).toBeNull();

    // Archived items and unknown codes resolve to nothing.
    await prisma.product.update({ where: { id: soda.id }, data: { isActive: false } });
    expect((await resolve(cashierToken, '049000000443')).body.data.matches).toEqual([]);
    expect((await resolve(cashierToken, '999999999999')).body.data.matches).toEqual([]);
    await api.get('/api/products/resolve-barcode').withAuth(cashierToken).withQuery({ code: '  ' }).expectError(400);
  });
});
